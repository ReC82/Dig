/**
 * server/seasonThemes.js — Saisons thématiques automatiques (#48).
 *
 * Identités séparées (diagnostic du 03/11 : « Mimosa » est la LIGUE de départ, pas la saison) :
 *   - saison  : table `seasons` (numéro « Saison 46-2026 », bornes UTC, statut) — inchangée ;
 *   - thème   : table `season_themes` — nom public inédit FR/EN/NL/ES, accroche, icône, rattaché à une
 *               saison quand elle commence ;
 *   - ligue   : table `leagues` (palier durable, promotions #19) — jamais renommée ici ;
 *   - collection : série du catalogue #39 (brouillon puis publication par l'admin), liée au thème.
 *
 * Fonctionnement (sans intervention humaine, sans IA, sans dépense) :
 *   - `sync(now)` est appelé par le planificateur des saisons (chaque minute) et par GET /api/seasons/current.
 *     Idempotent, rejouable après un redémarrage : tout l'état est en base ;
 *   - la saison suivante est préparée dès qu'elle commence dans moins de `season_prep_days` jours (7 par
 *     défaut : en hebdomadaire, dès le début de la saison en cours — donc toujours ≥ J-3) ;
 *   - préparation : un « pack de saison » rédigé à l'avance (server/content/seasons/*.json : nom, accroche,
 *     collection avec objets, histoires, raretés et consignes d'illustration propres à chaque objet) s'il
 *     en reste un d'inutilisé ; sinon un nom de repli déterministe (deux mots d'un lexique traduit,
 *     choisis à partir de la semaine) sans collection ;
 *   - la collection d'un pack entre dans le BROUILLON du catalogue (#39 importPack : drops inactifs, jamais
 *     publiée ici) et ses consignes d'illustration dans l'atelier (#40 : aucune image générée ici) ;
 *   - une saison qui commence sans thème préparé (clôture exceptionnelle, déploiement en cours de saison)
 *     reçoit un nom de repli, sans collection ;
 *   - annonce joueur `season_announce_hours` (24 h) avant le début : nom, accroche, icône ; la collection
 *     n'est évoquée (nom et nombre d'objets, aucun secret ni probabilité) que si l'admin l'a publiée.
 *
 * Unicité durable : chaque nom attribué est inscrit dans `season_theme_names` (clé normalisée : accents,
 * casse, articles et ordre des mots ignorés). Une clé n'est jamais supprimée ni réattribuée, même si le
 * thème est rejeté ou renommé. Les noms de ligues et les mots exclus par l'admin sont refusés. La clé
 * primaire garantit l'unicité même en cas de concurrence.
 *
 * Aucune influence sur la rotation, les classements, les points ou les drops : une panne ici est tracée
 * et ignorée par l'appelant.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const db   = require('./db');
const cal  = require('./seasonCalendar');

const LANGS = [...require('./languages').CONTENT_LANGS];
const PACKS_DIR = path.join(__dirname, 'content', 'seasons');
const HISTORY_LIMIT = 6;

const DEFAULTS = { season_themes_public: 'true', season_prep_days: '7', season_announce_hours: '24' };

class ThemeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let _initFor = null;
/** Connexion, tables créées au premier usage (une base rouverte par les tests est réinitialisée). */
const conn = () => { const c = db.getDb(); if (_initFor !== c) { _initFor = c; init(c); } return c; };

function init(c = conn()) {
  c.exec(`
    CREATE TABLE IF NOT EXISTS season_themes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      week_key      TEXT    NOT NULL,
      planned_start TEXT    NOT NULL,
      season_id     INTEGER UNIQUE,
      name_key      TEXT    NOT NULL,
      names         TEXT    NOT NULL,
      taglines      TEXT    NOT NULL,
      icon          TEXT    NOT NULL,
      source        TEXT    NOT NULL CHECK (source IN ('pack', 'fallback')),
      pack          TEXT,
      series_id     TEXT,
      status        TEXT    NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'active', 'archived', 'rejected')),
      notes         TEXT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_season_themes_week ON season_themes(week_key, status);
    CREATE TABLE IF NOT EXISTS season_theme_names (
      name_key   TEXT PRIMARY KEY,
      label      TEXT NOT NULL,
      theme_id   INTEGER,
      reason     TEXT NOT NULL CHECK (reason IN ('assigned', 'excluded')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS season_theme_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_id   INTEGER,
      action     TEXT NOT NULL,
      details    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const stmt = c.prepare('INSERT INTO admin_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING');
  for (const [k, v] of Object.entries(DEFAULTS)) stmt.run(k, v);
}

// ── Réglages (panel admin, sans redéploiement) ────────────────────────────────

const CONFIG_RULES = {
  season_themes_public:  ['true ou false attendu', v => v === 'true' || v === 'false'],
  season_prep_days:      ['entier de 3 à 14 attendu (jours avant le début)', v => /^\d+$/.test(v) && +v >= 3 && +v <= 14],
  season_announce_hours: ['entier de 0 à 168 attendu (heures avant le début, 0 = pas d\'annonce)', v => /^\d+$/.test(v) && +v <= 168],
};

/** Validation d'un réglage des thèmes ; null si la clé n'est pas un réglage des thèmes. */
function validateConfigValue(key, raw) {
  const rule = CONFIG_RULES[key];
  if (!rule) return null;
  const v = String(raw).trim().toLowerCase();
  return rule[1](v) ? { value: v } : { error: `${key} : ${rule[0]}.` };
}

function settings(config = db.getAdminConfig()) {
  const get = k => { const c = validateConfigValue(k, config[k] ?? DEFAULTS[k]); return c.error ? DEFAULTS[k] : c.value; };
  return {
    public: get('season_themes_public') === 'true',
    prepDays: +get('season_prep_days'),
    announceHours: +get('season_announce_hours'),
  };
}

// ── Noms : normalisation et unicité ───────────────────────────────────────────

const STOP = new Set(('et and en y e de des du la le les l d the of van het een el los las un une a '
  + 'saison saisons season seasons seizoen temporada').split(' '));

/** Clé d'unicité : sans accents ni casse, sans articles/liaisons, mots triés (« B et A » = « A et B »). */
function nameKey(text) {
  return [...new Set(String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w)))].sort().join(' ');
}

function _registry() {
  const assigned = new Set(), excluded = [];
  for (const r of conn().prepare('SELECT name_key, reason FROM season_theme_names').all()) {
    if (r.reason === 'excluded') excluded.push(r.name_key.split(' ')); else assigned.add(r.name_key);
  }
  return { assigned, excluded };
}

/** Clés réservées d'office : ligues existantes et futures (paliers durables, jamais un nom de saison). */
function _leagueKeys() {
  const names = ['Mimosa', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Émeraude', 'Maître', 'Grand Maître'];
  try { for (const l of db.getAllLeagues()) names.push(l.name); } catch (_) { /* table absente (tests) */ }
  return new Set(names.map(nameKey));
}

/** Raison du refus d'un nom (null = libre). */
function _nameProblem(names, reg = _registry(), leagues = _leagueKeys()) {
  const key = nameKey(names.fr);
  if (!key) return 'nom vide';
  if (reg.assigned.has(key)) return 'nom déjà utilisé';
  if (leagues.has(key)) return 'nom de ligue';
  for (const l of LANGS) {
    const words = new Set(nameKey(names[l]).split(' '));
    if (reg.excluded.some(ex => ex.every(w => words.has(w)))) return 'nom ou mot exclu';
  }
  return null;
}

// ── Repli déterministe sans IA ────────────────────────────────────────────────
// Deux mots d'un lexique traduit (pluriels sans article, accords inutiles) : 630 paires, puis triplets.

const LEXICON = [
  ['taupes', 'moles', 'mollen', 'topos', '⛏️'], ['lanternes', 'lanterns', 'lantaarns', 'faroles', '🏮'],
  ['pioches', 'pickaxes', 'houwelen', 'picos', '⛏️'], ['grottes', 'caves', 'grotten', 'cuevas', '🕳️'],
  ['géodes', 'geodes', 'geodes', 'geodas', '💎'], ['fossiles', 'fossils', 'fossielen', 'fósiles', '🦴'],
  ['lucioles', 'fireflies', 'vuurvliegjes', 'luciérnagas', '✨'], ['champignons', 'mushrooms', 'paddenstoelen', 'setas', '🍄'],
  ['dragons', 'dragons', 'draken', 'dragones', '🐉'], ['fantômes', 'ghosts', 'spoken', 'fantasmas', '👻'],
  ['comètes', 'comets', 'kometen', 'cometas', '☄️'], ['boussoles', 'compasses', 'kompassen', 'brújulas', '🧭'],
  ['chaudrons', 'cauldrons', 'ketels', 'calderos', '🫕'], ['clochettes', 'bells', 'belletjes', 'campanillas', '🔔'],
  ['cartes au trésor', 'treasure maps', 'schatkaarten', 'mapas del tesoro', '🗺️'], ['gnomes', 'gnomes', 'kabouters', 'gnomos', '🍄'],
  ['volcans', 'volcanoes', 'vulkanen', 'volcanes', '🌋'], ['météorites', 'meteorites', 'meteorieten', 'meteoritos', '🌠'],
  ['coquillages', 'seashells', 'schelpen', 'conchas', '🐚'], ['chauves-souris', 'bats', 'vleermuizen', 'murciélagos', '🦇'],
  ['wagonnets', 'mine carts', 'mijnkarretjes', 'vagonetas', '🛤️'], ['sabliers', 'hourglasses', 'zandlopers', 'relojes de arena', '⏳'],
  ['couronnes', 'crowns', 'kronen', 'coronas', '👑'], ['parapluies', 'umbrellas', "paraplu's", 'paraguas', '☂️'],
  ['escargots', 'snails', 'slakken', 'caracoles', '🐌'], ['moustaches', 'moustaches', 'snorren', 'bigotes', '🥸'],
  ['gaufres', 'waffles', 'wafels', 'gofres', '🧇'], ['frites', 'fries', 'frietjes', 'patatas fritas', '🍟'],
  ['fanfares', 'brass bands', 'fanfares', 'charangas', '🎺'], ['pigeons', 'pigeons', 'duiven', 'palomas', '🕊️'],
  ['grenouilles', 'frogs', 'kikkers', 'ranas', '🐸'], ['nuages', 'clouds', 'wolken', 'nubes', '☁️'],
  ['dés', 'dice', 'dobbelstenen', 'dados', '🎲'], ['tambours', 'drums', 'trommels', 'tambores', '🥁'],
  ['étoiles', 'stars', 'sterren', 'estrellas', '⭐'], ['hiboux', 'owls', 'uilen', 'búhos', '🦉'],
];

const _cap = s => s.charAt(0).toLocaleUpperCase() + s.slice(1);
const _title = s => s.split(' ').map(w => (w === 'and' ? w : _cap(w))).join(' ');

/** Liaison « et » de chaque langue (espagnol : « e » devant un son « i »). */
function _join(lang, words) {
  const last = words[words.length - 1], head = words.slice(0, -1).join(', ');
  const and = { fr: 'et', en: 'and', nl: 'en', es: /^h?i(?!e)/i.test(last) ? 'e' : 'y' }[lang];
  return `${head} ${and} ${last}`;
}

function _fallbackTexts(idx) {
  const words = idx.map(i => LEXICON[i]);
  const list = LANGS.map((l, k) => words.map(w => w[k]));
  const names = {}, taglines = {};
  LANGS.forEach((l, k) => {
    names[l] = l === 'en' ? _title(_join(l, list[k])) : _cap(_join(l, list[k]));
  });
  taglines.fr = `Une semaine placée sous le signe des ${_join('fr', list[0].map((w, k) => (k ? `des ${w}` : w)))}.`;
  taglines.en = `A week under the sign of ${_join('en', list[1])}.`;
  taglines.nl = `Een week in het teken van ${_join('nl', list[2])}.`;
  taglines.es = `Una semana bajo el signo de ${_join('es', list[3])}.`;
  return { names, taglines, icon: words[0][4] };
}

function _hash(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** Candidats de repli pour une semaine, dans un ordre déterministe (même semaine → même ordre). */
function* _fallbackCandidates(seed) {
  const n = LEXICON.length;
  const pairs = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs.push([a, b]);
  const h = _hash(seed);
  // Pas de parcours premier avec le nombre de paires (630 = 2·3²·5·7) : 11·k + décalage couvre tout
  for (let k = 0; k < pairs.length; k++) {
    const [a, b] = pairs[(h + 11 * k) % pairs.length];
    yield (h >> 3) % 2 ? [b, a] : [a, b];
  }
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) yield [a, b, c];
}

function fallbackTheme(seed, reg = _registry(), leagues = _leagueKeys()) {
  for (const idx of _fallbackCandidates(seed)) {
    const t = _fallbackTexts(idx);
    if (!_nameProblem(t.names, reg, leagues)) return t;
  }
  throw new ThemeError(503, 'Lexique de repli épuisé : ajoutez un pack de saison.');
}

// ── Packs de saison (contenu rédigé à l'avance) ───────────────────────────────

/**
 * Dossier des packs : DIG_SEASON_PACKS (chemin, ou « 0 » pour aucun ; aussi aucun si
 * DIG_PREPARED_COLLECTIONS=0, qui coupe tout contenu préparé) ; aucun en NODE_ENV=test (bases
 * neuves des tests : repli seul, sauf dossier passé explicitement).
 */
function defaultPacksDir() {
  const env = process.env.DIG_SEASON_PACKS;
  if (env === '0' || process.env.DIG_PREPARED_COLLECTIONS === '0') return null;   // contenu préparé désactivé
  if (env) return env;
  return process.env.NODE_ENV === 'test' ? null : PACKS_DIR;
}

const PACK_RE = /^[a-z0-9_]{3,60}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;

const _clean = (v, max) => String(v ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);

function _texts(input, max) {
  const out = {};
  for (const l of LANGS) out[l] = _clean(input?.[l], max);
  return out;
}

/** Packs valides du dossier, triés par nom de fichier ; un pack invalide est ignoré (tracé). */
function loadPacks(dir = defaultPacksDir()) {
  if (!dir) return [];
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!PACK_RE.test(String(p.pack ?? ''))) throw new Error('identifiant de pack invalide');
      if (p.preferredWeek != null && !WEEK_RE.test(p.preferredWeek)) throw new Error('preferredWeek attendu au format 2026-W46');
      const names = _texts(p.names, 40), taglines = _texts(p.taglines, 160);
      if (LANGS.some(l => names[l].length < 2 || !taglines[l])) throw new Error('nom ou accroche manquant dans une langue');
      out.push({ pack: p.pack, file: f, preferredWeek: p.preferredWeek ?? null, names, taglines,
        icon: _clean(p.icon, 8) || '🗓️', collection: p.collection ?? null });
    } catch (err) {
      console.warn(`[seasonThemes] pack ${f} ignoré : ${err.message}`);
    }
  }
  return out;
}

function _usedPacks() {
  return new Set(conn().prepare('SELECT pack FROM season_themes WHERE pack IS NOT NULL').all().map(r => r.pack));
}

/** Pack utilisable pour une semaine : jamais utilisé, nom libre, semaine préférée = celle-ci ou aucune. */
function _pickPack(weekKey, reg, leagues, dir) {
  const used = _usedPacks();
  const free = loadPacks(dir).filter(p => !used.has(p.pack) && !_nameProblem(p.names, reg, leagues));
  return free.find(p => p.preferredWeek === weekKey) ?? free.find(p => !p.preferredWeek) ?? null;
}

// ── Préparation, rattachement, archivage ──────────────────────────────────────

const weekKeyOf = date => { const { year, week } = cal.isoWeek(date); return `${year}-W${String(week).padStart(2, '0')}`; };

function _event(themeId, action, details = null) {
  conn().prepare('INSERT INTO season_theme_events (theme_id, action, details) VALUES (?, ?, ?)')
    .run(themeId, action, details ? JSON.stringify(details).slice(0, 2000) : null);
}

function _row(r) {
  if (!r) return null;
  return { id: r.id, weekKey: r.week_key, plannedStart: r.planned_start, seasonId: r.season_id, nameKey: r.name_key,
    names: JSON.parse(r.names), taglines: JSON.parse(r.taglines), icon: r.icon, source: r.source, pack: r.pack,
    seriesId: r.series_id, status: r.status, notes: r.notes, createdAt: r.created_at, updatedAt: r.updated_at };
}

const getTheme = id => _row(conn().prepare('SELECT * FROM season_themes WHERE id = ?').get(id));
const themeForSeason = seasonId => _row(conn().prepare('SELECT * FROM season_themes WHERE season_id = ?').get(seasonId));

function _insertTheme({ weekKey, plannedStart, seasonId = null, texts, source, pack = null, status = 'prepared' }) {
  const key = nameKey(texts.names.fr);
  const id = conn().prepare(`INSERT INTO season_themes (week_key, planned_start, season_id, name_key, names, taglines, icon, source, pack, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(weekKey, plannedStart, seasonId, key, JSON.stringify(texts.names), JSON.stringify(texts.taglines), texts.icon, source, pack, status)
    .lastInsertRowid;
  // Clé primaire : un nom déjà réservé fait échouer toute la transaction (unicité même en concurrence)
  conn().prepare("INSERT INTO season_theme_names (name_key, label, theme_id, reason) VALUES (?, ?, ?, 'assigned')").run(key, texts.names.fr, id);
  return id;
}

/** Collection du pack dans le brouillon du catalogue (#39), consignes d'illustration dans l'atelier (#40). */
function _importCollection(themeId, pack, seasonId) {
  if (!pack.collection) return;
  let note = null, seriesId = null;
  try {
    const r = require('./collectionAi').importPack(pack.collection, { seasonId });
    seriesId = r.seriesId ?? pack.collection.series?.id ?? null;
    if (r.status === 'open') note = `Collection laissée en proposition IA n° ${r.proposal} : ${r.error}`;
    if (r.status === 'already') note = `Collection déjà importée auparavant (proposition n° ${r.proposal}).`;
    _event(themeId, 'collection', { status: r.status, proposal: r.proposal, seriesId });
  } catch (err) {
    note = `Collection non importée : ${err.message}`;
    console.warn(`[seasonThemes] collection du pack ${pack.pack} : ${err.message}`);
  }
  conn().prepare("UPDATE season_themes SET series_id = ?, notes = ?, updated_at = datetime('now') WHERE id = ?").run(seriesId, note, themeId);
}

/**
 * Crée un thème (préparé, ou directement actif si `seasonId`) : pack si permis et disponible, sinon repli.
 * Transaction IMMÉDIATE : relit d'abord si un autre appel l'a déjà créé (idempotence).
 */
function _create({ weekKey, plannedStart, seasonId = null, allowPack, dir }) {
  const run = conn().transaction(() => {
    const existing = seasonId != null ? themeForSeason(seasonId)
      : _row(conn().prepare("SELECT * FROM season_themes WHERE week_key = ? AND status = 'prepared' AND season_id IS NULL ORDER BY id LIMIT 1").get(weekKey));
    if (existing) return { theme: existing, created: false };
    const reg = _registry(), leagues = _leagueKeys();
    const pack = allowPack ? _pickPack(weekKey, reg, leagues, dir) : null;
    const texts = pack ? { names: pack.names, taglines: pack.taglines, icon: pack.icon } : fallbackTheme(weekKey, reg, leagues);
    const id = _insertTheme({ weekKey, plannedStart, seasonId, texts, source: pack ? 'pack' : 'fallback', pack: pack?.pack ?? null,
      status: seasonId != null ? 'active' : 'prepared' });
    _event(id, seasonId != null ? 'created_active' : 'prepared', { weekKey, plannedStart, seasonId, source: pack ? 'pack' : 'fallback', pack: pack?.pack ?? null });
    return { theme: getTheme(id), created: true, pack };
  });
  const r = run.immediate();
  if (r.created) {
    if (r.pack) _importCollection(r.theme.id, r.pack, seasonId);
    console.log(`[seasonThemes] Thème ${r.theme.status === 'active' ? 'attribué' : 'préparé'} : « ${r.theme.names.fr} » (${r.theme.source}, ${weekKey})`);
  }
  return getTheme(r.theme.id);
}

/** Rattache la série du thème à la saison dans le brouillon, si elle n'est pas encore publiée. */
function _linkSeries(theme, seasonId) {
  if (!theme.seriesId) return;
  try {
    const catalog = require('./collectionCatalog');
    if (catalog.getPublished().series.some(s => s.id === theme.seriesId)) return;
    const s = catalog.getDraft()?.series.find(x => x.id === theme.seriesId);
    if (s && s.seasonId == null) catalog.upsertDraftSeries({ ...s, seasonId });
  } catch (err) {
    console.warn(`[seasonThemes] série ${theme.seriesId} non rattachée à la saison ${seasonId} : ${err.message}`);
  }
}

/** Thème de la saison active : le thème préparé pour sa semaine, sinon un nom de repli (sans collection). */
function _attach(season, dir) {
  const current = themeForSeason(season.id);
  if (current) return current;
  const start = cal.parseUtc(season.start_at) ?? new Date();
  const weekKey = weekKeyOf(start);
  const attached = conn().transaction(() => {
    if (themeForSeason(season.id)) return themeForSeason(season.id);
    const limit = cal.fmtUtc(new Date(start.getTime() + cal.DAY_MS));
    const cand = conn().prepare(`SELECT * FROM season_themes WHERE status = 'prepared' AND season_id IS NULL
      AND (week_key = ? OR planned_start <= ?) ORDER BY (week_key = ?) DESC, planned_start, id LIMIT 1`).get(weekKey, limit, weekKey);
    if (!cand) return null;
    conn().prepare("UPDATE season_themes SET season_id = ?, status = 'active', updated_at = datetime('now') WHERE id = ?").run(season.id, cand.id);
    _event(cand.id, 'attached', { seasonId: season.id, seasonName: season.name });
    return getTheme(cand.id);
  }).immediate();
  if (attached) {
    _linkSeries(attached, season.id);
    console.log(`[seasonThemes] « ${attached.names.fr} » commence avec ${season.name}`);
    return attached;
  }
  return _create({ weekKey, plannedStart: season.start_at, seasonId: season.id, allowPack: false, dir });
}

/** Prochain début de saison (lecture seule, même calcul que la rotation : saison programmée comprise). */
function nextStart(active, now) {
  const end = cal.parseUtc(active?.end_at);
  if (!end) return null;
  const plan = require('./seasons').planNextSeason(end, now);
  return plan.start ?? null;
}

/**
 * Passe du planificateur (idempotente) : archive les thèmes des saisons closes, attribue un thème à la
 * saison active, prépare la suivante dans l'horizon. `force` : préparer la suivante sans attendre l'horizon.
 */
function sync(now = new Date(), { force = false, dir = defaultPacksDir() } = {}) {
  const active = db.getActiveSeason();
  // Lecture d'abord : appelée à chaque GET /api/seasons/current, la passe n'écrit que s'il y a lieu
  const stale = "status = 'active' AND season_id IN (SELECT id FROM seasons WHERE status != 'active')";
  const archived = conn().prepare(`SELECT 1 FROM season_themes WHERE ${stale} LIMIT 1`).get()
    ? conn().prepare(`UPDATE season_themes SET status = 'archived', updated_at = datetime('now') WHERE ${stale}`).run().changes : 0;
  if (!active) return { active: null, next: null, archived };
  const current = _attach(active, dir);
  const start = nextStart(active, now);
  let next = null;
  if (start) {
    const weekKey = weekKeyOf(start);
    next = _row(conn().prepare("SELECT * FROM season_themes WHERE week_key = ? AND status = 'prepared' AND season_id IS NULL ORDER BY id LIMIT 1").get(weekKey));
    const { prepDays } = settings();
    if (!next && (force || start.getTime() - now.getTime() <= prepDays * cal.DAY_MS)) {
      next = _create({ weekKey, plannedStart: cal.fmtUtc(start), allowPack: true, dir });
    }
  }
  return { active: current, next, nextStart: start, archived };
}

// ── Vue joueur ────────────────────────────────────────────────────────────────

function _publishedSeries(seriesId) {
  if (!seriesId) return null;
  try {
    const p = require('./collectionCatalog').getPublished();
    const s = p.series.find(x => x.id === seriesId && x.active !== false);
    if (!s) return null;
    return { id: s.id, names: s.names, icon: s.icon, count: p.items.filter(i => i.seriesId === s.id && i.active !== false).length };
  } catch (_) { return null; }
}

const _publicTheme = t => t && { names: t.names, taglines: t.taglines, icon: t.icon };

/**
 * Thème, collection (seulement si publiée), annonce de la saison suivante et historique, pour
 * GET /api/seasons/current. Aucune information de préparation, de brouillon ou de probabilité.
 */
function publicView(season, now = new Date()) {
  const s = settings();
  if (!s.public || !season) return { theme: null, collection: null, next: null, history: [] };
  const theme = themeForSeason(season.id);
  let next = null;
  const start = nextStart(season, now);
  if (start && s.announceHours > 0 && now >= new Date(start.getTime() - s.announceHours * 3_600_000) && now < start) {
    const t = _row(conn().prepare("SELECT * FROM season_themes WHERE week_key = ? AND status = 'prepared' AND season_id IS NULL ORDER BY id LIMIT 1").get(weekKeyOf(start)));
    if (t) next = { startAt: cal.fmtUtc(start), theme: _publicTheme(t), collection: _publishedSeries(t.seriesId) };
  }
  const history = conn().prepare(`SELECT s.id, s.name, s.start_at, s.end_at, t.names, t.icon FROM seasons s
    LEFT JOIN season_themes t ON t.season_id = s.id WHERE s.status IN ('closed', 'archived') ORDER BY s.start_at DESC LIMIT ?`)
    .all(HISTORY_LIMIT).map(r => ({ id: r.id, name: r.name, startAt: r.start_at, endAt: r.end_at,
      theme: r.names ? { names: JSON.parse(r.names), icon: r.icon } : null }));
  return { theme: _publicTheme(theme), collection: _publishedSeries(theme?.seriesId), next, history };
}

// ── Vue et actions admin ──────────────────────────────────────────────────────

function _collectionStatus(seriesId) {
  if (!seriesId) return null;
  const catalog = require('./collectionCatalog');
  const pub = catalog.getPublished(), draft = catalog.getDraft();
  const inPub = pub.series.find(s => s.id === seriesId), inDraft = draft?.series.find(s => s.id === seriesId);
  const src = inDraft ? draft : pub;
  const items = src.items.filter(i => i.seriesId === seriesId && i.active !== false);
  const out = { id: seriesId, names: (inDraft ?? inPub)?.names ?? null, icon: (inDraft ?? inPub)?.icon ?? null,
    published: !!inPub, inDraft: !!inDraft, seasonId: (inDraft ?? inPub)?.seasonId ?? null, items: items.length,
    withImage: items.filter(i => i.image).length, missing: items.filter(i => !i.image).map(i => ({ id: i.id, name: i.names?.fr ?? i.id })) };
  if (!inPub && !inDraft) out.problem = 'Série absente du catalogue (brouillon supprimé ?).';
  try {
    const plan = require('./iconStudio').seriesPlan(seriesId);
    out.proposals = plan.items.filter(i => i.state === 'has_proposal').length;
    out.toGenerate = plan.todo;
    out.estTotalUsd = plan.estTotalUsd;
  } catch (_) { /* atelier indisponible : seules les images du catalogue sont comptées */ }
  return out;
}

function _adminTheme(t) {
  return t && { ...t, collection: _collectionStatus(t.seriesId) };
}

function adminView(now = new Date()) {
  const s = settings();
  const active = db.getActiveSeason();
  const start = active ? nextStart(active, now) : null;
  const nextWeek = start ? weekKeyOf(start) : null;
  const next = nextWeek ? _row(conn().prepare("SELECT * FROM season_themes WHERE week_key = ? AND status = 'prepared' AND season_id IS NULL ORDER BY id LIMIT 1").get(nextWeek)) : null;
  const used = _usedPacks();
  const packs = loadPacks(defaultPacksDir()).map(p => ({ pack: p.pack, name: p.names.fr, icon: p.icon, preferredWeek: p.preferredWeek,
    items: p.collection?.items?.length ?? 0, used: used.has(p.pack) }));
  // Dépense et plafonds des images (#40, administrés par le propriétaire) : lecture seule, aucun appel
  const spent = (() => {
    try {
      const st = require('./iconStudio').status();
      const pick = ['configured', 'reason', 'studioSpentUsd', 'studioCapUsd', 'globalSpentUsd', 'globalCapUsd', 'remainingUsd', 'perImageUsd', 'imagesToday', 'maxImagesPerDay'];
      return Object.fromEntries(pick.filter(k => st[k] !== undefined).map(k => [k, st[k]]));
    } catch (_) { return null; }
  })();
  return {
    now: cal.fmtUtc(now), settings: s,
    current: active ? { season: { id: active.id, name: active.name, startAt: active.start_at, endAt: active.end_at, status: active.status },
      theme: _adminTheme(themeForSeason(active.id)) } : null,
    next: start ? { weekKey: nextWeek, startAt: cal.fmtUtc(start),
      prepareAt: cal.fmtUtc(new Date(start.getTime() - s.prepDays * cal.DAY_MS)),
      announceAt: s.announceHours > 0 ? cal.fmtUtc(new Date(start.getTime() - s.announceHours * 3_600_000)) : null,
      announced: s.public && s.announceHours > 0 && now >= new Date(start.getTime() - s.announceHours * 3_600_000),
      theme: _adminTheme(next) } : null,
    themes: conn().prepare('SELECT * FROM season_themes ORDER BY id DESC LIMIT 30').all().map(_row),
    exclusions: conn().prepare("SELECT name_key AS key, label, created_at AS createdAt FROM season_theme_names WHERE reason = 'excluded' ORDER BY created_at DESC").all(),
    packs, imageBudget: spent,
    events: conn().prepare('SELECT * FROM season_theme_events ORDER BY id DESC LIMIT 20').all()
      .map(e => ({ id: e.id, themeId: e.theme_id, action: e.action, details: e.details ? JSON.parse(e.details) : null, createdAt: e.created_at })),
  };
}

function _editable(id) {
  const t = getTheme(id);
  if (!t) throw new ThemeError(404, 'Thème introuvable.');
  if (!['prepared', 'active'].includes(t.status)) throw new ThemeError(409, 'Thème archivé ou rejeté : non modifiable.');
  return t;
}

/** Édition facultative (noms, accroches, icône) ; un nouveau nom doit être libre, l'ancien reste réservé. */
function updateTheme(id, input = {}) {
  return conn().transaction(() => {
    const t = _editable(id);
    const names = input.names ? _texts({ ...t.names, ...input.names }, 40) : t.names;
    const taglines = input.taglines ? _texts({ ...t.taglines, ...input.taglines }, 160) : t.taglines;
    const icon = input.icon != null ? _clean(input.icon, 8) : t.icon;
    if (LANGS.some(l => names[l].length < 2)) throw new ThemeError(400, 'Nom de 2 à 40 caractères dans chaque langue.');
    if (LANGS.some(l => !taglines[l])) throw new ThemeError(400, 'Accroche obligatoire dans chaque langue.');
    if (!icon || [...icon].length > 4 || /[\s<>&"']/.test(icon)) throw new ThemeError(400, 'Icône : un emoji.');
    const key = nameKey(names.fr);
    if (key !== t.nameKey) {
      const problem = _nameProblem(names);
      if (problem) throw new ThemeError(409, `Nom refusé : ${problem}.`);
      conn().prepare("INSERT INTO season_theme_names (name_key, label, theme_id, reason) VALUES (?, ?, ?, 'assigned')").run(key, names.fr, id);
    }
    conn().prepare("UPDATE season_themes SET name_key = ?, names = ?, taglines = ?, icon = ?, updated_at = datetime('now') WHERE id = ?")
      .run(key, JSON.stringify(names), JSON.stringify(taglines), icon, id);
    _event(id, 'edited', { from: t.names.fr, to: names.fr });
    return getTheme(id);
  }).immediate();
}

/**
 * « Autre nom » pour un thème préparé : l'ancien est rejeté (nom réservé à jamais, éventuellement exclu),
 * un nom de repli inédit le remplace en gardant la même collection.
 */
function rerollTheme(id, { exclude = false } = {}) {
  const r = conn().transaction(() => {
    const t = getTheme(id);
    if (!t) throw new ThemeError(404, 'Thème introuvable.');
    if (t.status !== 'prepared') throw new ThemeError(409, 'Seul un thème préparé (saison pas encore commencée) peut changer de nom ; modifiez sinon le nom à la main.');
    conn().prepare("UPDATE season_themes SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(id);
    if (exclude) _exclude(t.names.fr);
    const texts = fallbackTheme(`${t.weekKey}#${id}`);
    const nid = _insertTheme({ weekKey: t.weekKey, plannedStart: t.plannedStart, texts, source: 'fallback' });
    conn().prepare('UPDATE season_themes SET series_id = ? WHERE id = ?').run(t.seriesId, nid);
    _event(id, 'rejected', { replacedBy: nid, excluded: !!exclude });
    _event(nid, 'prepared', { replaces: id, source: 'fallback' });
    return nid;
  }).immediate();
  return getTheme(r);
}

function _exclude(label) {
  const clean = _clean(label, 60);
  const key = nameKey(clean);
  if (!key) throw new ThemeError(400, 'Mot ou nom à exclure manquant.');
  conn().prepare("INSERT INTO season_theme_names (name_key, label, reason) VALUES (?, ?, 'excluded') ON CONFLICT(name_key) DO NOTHING").run(key, clean);
  return key;
}

function addExclusion(label) {
  const key = _exclude(label);
  _event(null, 'excluded', { key, label: _clean(label, 60) });
  return key;
}

function removeExclusion(key) {
  const r = conn().prepare("DELETE FROM season_theme_names WHERE name_key = ? AND reason = 'excluded'").run(String(key ?? ''));
  if (!r.changes) throw new ThemeError(404, 'Exclusion introuvable (un nom déjà attribué reste réservé).');
  _event(null, 'exclusion_removed', { key });
}

/** Thème (nom FR + icône) de chaque saison qui en a un, pour la liste admin des saisons (lecture seule). */
function themesBySeason() {
  const out = {};
  for (const r of conn().prepare('SELECT season_id, names, icon FROM season_themes WHERE season_id IS NOT NULL').all()) {
    out[r.season_id] = { name: JSON.parse(r.names).fr ?? null, icon: r.icon };
  }
  return out;
}

module.exports = {
  ThemeError, themesBySeason, LANGS, LEXICON, PACKS_DIR, defaultPacksDir, init, settings, validateConfigValue, nameKey, weekKeyOf, fallbackTheme, loadPacks,
  sync, nextStart, publicView, adminView, getTheme, themeForSeason, updateTheme, rerollTheme, addExclusion, removeExclusion,
};
