/**
 * server/missionCatalog.js — Catalogue de missions quotidiennes administrable (#68, étape A).
 *
 * Même principe que les catalogues de blocs (#37) et de reliques (#64) :
 *   - versions publiées en ajout seul (`mission_catalog_versions`) ; la version 1 est la conversion
 *     à l'identique des six missions du jeu, relues dans public/js/dailyMissions.js (objectifs,
 *     récompenses) et public/js/i18n.js (noms et descriptions FR/EN/NL/ES), avec la rotation
 *     d'origine (3 missions par jour, tirage uniforme commun à tous, date du navigateur) ;
 *   - un brouillon unique (`mission_catalog_draft`) validé côté serveur, comparé à la version en
 *     vigueur puis publié explicitement ; journal `mission_catalog_audit` en ajout seul ;
 *   - une mission publiée n'est jamais supprimée (les sauvegardes du jour y font référence) :
 *     elle s'archive ;
 *   - seuls les compteurs réellement tenus par le moteur sont proposés (TYPES) ; les autres
 *     demandes du ticket sont listées comme indisponibles, avec la raison.
 *
 * ÉTAPE A : le jeu N'UTILISE PAS ce catalogue (drapeau `missions_catalog_live` absent / OFF).
 * Les missions des joueurs restent celles de public/js/dailyMissions.js. Le catalogue sert à
 * préparer les missions, les illustrer (atelier d'icônes) et simuler la rotation adaptative
 * (profondeur, ancienneté, améliorations restantes, objectifs atteignables) avant toute décision.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const db = require('./db');
const blockCatalog = require('./blockCatalog');

const LANGS = [...require('./languages').CONTENT_LANGS];   // registre des langues (#59)
const MAX_MISSIONS = 60;
const MAX_BANDS = 8;
const MAX_TARGETS = 8;
const DEPTH_MAX = 100_000;
const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
const IMAGE_RE = /^\/media\/icons\/[a-f0-9]{16}\.webp$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Catégories de répartition (au plus N par jour d'une même catégorie, réglage de rotation). */
const CATEGORIES = {
  minage:      'Minage',
  exploration: 'Exploration',
  tresors:     'Trésors',
  progression: 'Progression',
};

/**
 * Compteurs réellement tenus par le moteur (public/js/gameState.js, upgrades.js, chests.js).
 * Progression d'une mission = valeur du compteur − valeur au premier affichage du jour.
 * `cap` : objectif maximal accepté (garde-fou de saisie, pas un barème).
 */
const TYPES = {
  break_blocks: {
    label: 'Casser des blocs', unit: 'blocs', category: 'minage', cap: 5000, stat: 'stats.blocksDestroyed',
    event: 'Chaque bloc détruit, au clic ou par l\'Auto-Dig (GameState.onBlockDestroyed).',
    validation: 'Compté par le navigateur ; les blocs crédités sont bornés côté serveur par la progression de la partie et l\'anti-bot (#25 : plafond de blocs par minute).',
    limits: 'Le moteur ne distingue pas les blocs cassés à la main de ceux de l\'Auto-Dig.',
  },
  earn_coins: {
    label: 'Gagner des pièces', unit: 'pièces', category: 'progression', cap: 10_000_000, stat: 'stats.totalCoinsEarned',
    event: 'Pièces des blocs détruits (Sac, reliques, boosts compris) et pièces des coffres minés.',
    validation: 'Compté par le navigateur ; le solde de pièces de la sauvegarde est contrôlé par la révision de sauvegarde (#18) et les règles économiques.',
    limits: 'Les pièces gagnent 5 % par mètre de profondeur : un objectif fixe devient trivial en profondeur (prévoir des tranches).',
  },
  open_chests: {
    label: 'Ouvrir des coffres minés', unit: 'coffres', category: 'tresors', cap: 50, stat: 'stats.chestsFound',
    event: 'Chaque bloc coffre détruit dans la mine (catégorie « coffre » du catalogue de blocs).',
    validation: 'Compté par le navigateur ; le tirage des blocs est reproductible (#35) et vérifiable côté serveur.',
    limits: 'Les coffres achetés en boutique ne comptent PAS (compteur distinct absent du moteur).',
    blockCategory: 'coffre',
  },
  buy_upgrades: {
    label: 'Acheter des améliorations', unit: 'achats', category: 'progression', cap: 20, stat: 'stats.totalUpgradesBought',
    event: 'Chaque achat de la boutique d\'améliorations : pioche, Chance, Sac, Auto-Dig, fragment de relique, relance de bloc.',
    validation: 'Compté par le navigateur ; niveaux et pièces dépensées contrôlés dans la sauvegarde.',
    limits: 'Une relance de bloc (jusqu\'à 99 par saison) compte comme un achat : la mission reste toujours faisable avec des pièces. La rotation adaptative ne compte que les niveaux restants (pioche, Chance, Sac, Auto-Dig, fragments).',
    needsUpgrades: true,
  },
  find_gems: {
    label: 'Trouver des gemmes', unit: 'gemmes', category: 'tresors', cap: 30, stat: 'stats.gemsFound',
    event: 'Chaque bloc gemme qui rapporte une gemme (catégorie « gemme », gain de gemme actif).',
    validation: 'Compté par le navigateur ; gemmes plafonnées par le grand livre serveur (#49, allocation quotidienne).',
    limits: 'Aucune gemme n\'apparaît avant la profondeur minimale des blocs gemmes (35 m dans le catalogue d\'origine).',
    blockCategory: 'gemme',
  },
  depth_gain: {
    label: 'Descendre de X mètres', unit: 'm', category: 'exploration', cap: 5000, stat: 'depth',
    event: 'Chaque mètre gagné (1 bloc détruit = 1 m) ; une baisse (fin de saison) conserve le gain du jour (B11).',
    validation: 'Profondeur bornée côté serveur (règle de profondeur, #29 et #35).',
    limits: 'La profondeur repart à 1 m à chaque saison : la progression du jour est conservée.',
  },
};

/** Demandes du ticket sans compteur dans le moteur : non proposées, avec la raison (étape B). */
const UNAVAILABLE = [
  { id: 'break_manual', label: 'Casser X blocs à la main (hors Auto-Dig)', reason: 'Aucun compteur séparé : il faut un compteur « clics manuels » dans le moteur et la sauvegarde.' },
  { id: 'open_shop_chests', label: 'Ouvrir X coffres achetés', reason: 'Les achats de coffres sont connus du serveur (boutique de coffres) mais pas du compteur du jour ; à brancher à l\'activation.' },
  { id: 'collect_fragments', label: 'Collecter X fragments de relique', reason: 'Pas de cumul des fragments gagnés (seul le solde est sauvegardé).' },
  { id: 'use_pickaxe', label: 'Utiliser une pioche / ses charges', reason: 'Dépend de la pioche à charges (#71), pas encore livrée.' },
];

/** Réglages de rotation : bornes et sens (documentés dans le panel). */
const ROTATION_FIELDS = {
  mode:           'origin = tirage uniforme commun à tous (jeu actuel) ; adaptive = pondéré, par joueur, selon la progression',
  perDay:         'Missions par jour (1 à 5)',
  maxPerCategory: 'Au plus N missions d\'une même catégorie le même jour',
  repeatDays:     'Fenêtre anti-répétition : jours précédents examinés (0 à 7)',
  repeatFactor:   'Poids d\'une mission déjà tirée dans la fenêtre (0 = exclue si possible, 1 = aucun effet)',
  perPlayer:      'Rotation propre à chaque joueur (sinon la même pour tous)',
  dayBlocks:      'Référence de blocs cassés par jour pour plafonner les objectifs atteignables (coffres, gemmes, mètres, blocs)',
  timezone:       'Changement de jour : « browser » (minuit du navigateur, jeu actuel) ou « Europe/Brussels »',
};
const ORIGIN_ROTATION = { mode: 'origin', perDay: 3, maxPerCategory: 5, repeatDays: 0, repeatFactor: 1, perPlayer: false, dayBlocks: 0, timezone: 'browser' };

class CatalogError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Catalogue d'origine ───────────────────────────────────────────────────────

let _origin = null;
let _client = null;

function _load(file, name, ctx) {
  vm.runInContext(`${fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8')}\n;this.${name} = ${name};`, ctx);
  return ctx[name];
}

/** Module client des missions (pool d'origine), chargé hors navigateur. */
function clientMissions() {
  if (!_client) {
    const ctx = { window: {}, navigator: { language: 'fr' }, t: k => k };
    vm.createContext(ctx);
    _client = { DailyMissions: _load('dailyMissions.js', 'DailyMissions', ctx), I18n: _load('i18n.js', 'I18n', ctx) };
  }
  return _client;
}

/**
 * Récompense d'origine → barème du catalogue : pièces = arrondi(objectif × coinsPerUnit),
 * gemmes = `gems` si objectif ≥ gemsFromTarget. Vérifié sur chaque objectif (tests).
 */
function _originReward(def) {
  const coinsPerUnit = def.rewardFn(1000).coins / 1000;
  const withGems = def.targets.filter(n => def.rewardFn(n).gems > 0);
  return withGems.length
    ? { coinsPerUnit, gems: def.rewardFn(withGems[0]).gems, gemsFromTarget: withGems[0] }
    : { coinsPerUnit, gems: 0, gemsFromTarget: 1 };
}

/** Les six missions d'origine, au format catalogue (valeurs identiques au jeu). */
function originMissions() {
  if (!_origin) {
    const { DailyMissions, I18n } = clientMissions();
    const texts = (key) => Object.fromEntries(LANGS.map(l => [l, I18n.get(key, l) ?? '']));
    _origin = DailyMissions.POOL.map(d => ({
      id: d.id,
      active: true,
      type: d.id,                              // les six identifiants d'origine sont aussi les types
      category: TYPES[d.id].category,
      icon: d.icon,
      image: null,
      names: texts(`mission.${d.id}.name`),
      descs: texts(`mission.${d.id}.desc`),
      weight: 10,
      minAccountDays: 0,
      maxAccountDays: null,
      bands: [{ fromDepth: 1, targets: [...d.targets] }],
      reward: _originReward(d),
    }));
  }
  return JSON.parse(JSON.stringify(_origin));
}

/**
 * Proposition de barème adaptatif (#68) — NON appliquée : chargée dans le brouillon uniquement sur
 * clic, publiée seulement après accord du propriétaire. Récompenses par unité inchangées ; seuls
 * les objectifs suivent la profondeur et la rotation devient pondérée, par joueur, anti-répétition.
 */
const PROPOSAL = {
  rotation: { mode: 'adaptive', perDay: 3, maxPerCategory: 2, repeatDays: 2, repeatFactor: 0.25, perPlayer: true, dayBlocks: 100, timezone: 'Europe/Brussels' },
  missions: {
    break_blocks: { weight: 10, bands: [{ fromDepth: 1, targets: [20, 40, 60] }, { fromDepth: 100, targets: [50, 75, 100] }] },
    earn_coins:   { weight: 8, bands: [{ fromDepth: 1, targets: [500, 1000, 2000] }, { fromDepth: 50, targets: [5000, 10000, 20000] }, { fromDepth: 150, targets: [30000, 60000, 100000] }, { fromDepth: 300, targets: [100000, 200000, 400000] }] },
    open_chests:  { weight: 10, bands: [{ fromDepth: 1, targets: [1, 2, 3] }, { fromDepth: 100, targets: [2, 3, 4, 5] }] },
    buy_upgrades: { weight: 6, bands: [{ fromDepth: 1, targets: [1, 2, 3] }, { fromDepth: 80, targets: [2, 3, 4] }] },
    find_gems:    { weight: 8, bands: [{ fromDepth: 35, targets: [1, 2] }, { fromDepth: 120, targets: [1, 2, 3] }] },
    depth_gain:   { weight: 10, bands: [{ fromDepth: 1, targets: [10, 20, 30] }, { fromDepth: 100, targets: [20, 30, 50] }, { fromDepth: 250, targets: [30, 50, 75] }] },
  },
};

/**
 * Profils de simulation (recette : débutant 20 m, régulier 100 m, avancé 250 m, très avancé 500 m).
 * Activité : 1 bloc = 1 m ; le jeu actif fait 130 à 200 m/h (rapport #49, « une heure à équipement
 * figé ») ; débutant ≈ 30 min, régulier ≈ 45 min, avancés ≈ 1 h par jour.
 */
const PROFILES = [
  { id: 'debutant', label: 'Débutant', depth: 20, accountDays: 1, blocksPerDay: 60, upgrades: { pickaxe: 2, luck: 0, bag: 1, autodig: 0, fragment_shop: 0 } },
  { id: 'regulier', label: 'Régulier', depth: 100, accountDays: 14, blocksPerDay: 120, upgrades: { pickaxe: 8, luck: 4, bag: 5, autodig: 2, fragment_shop: 2 } },
  { id: 'avance', label: 'Avancé', depth: 250, accountDays: 60, blocksPerDay: 170, upgrades: { pickaxe: 15, luck: 12, bag: 12, autodig: 6, fragment_shop: 10 } },
  { id: 'tres_avance', label: 'Très avancé', depth: 500, accountDays: 120, blocksPerDay: 160, upgrades: { pickaxe: 15, luck: 12, bag: 12, autodig: 6, fragment_shop: 10 } },
];
/** Niveaux maximaux d'achat comptés par « Acheter des améliorations » (public/js/upgrades.js). */
const UPGRADE_MAX = { pickaxe: 15, luck: 12, bag: 12, autodig: 6, fragment_shop: 10 };

// ── Schéma ────────────────────────────────────────────────────────────────────

/** Tables (ajout seul) et version 1 = catalogue d'origine. Idempotent. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS mission_catalog_versions (
      version      INTEGER PRIMARY KEY,
      content      TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK (source IN ('origin', 'publish', 'rollback')),
      note         TEXT,
      from_version INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mission_catalog_draft (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      content     TEXT    NOT NULL,
      based_on    INTEGER NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mission_catalog_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      action      TEXT    NOT NULL,
      version     INTEGER,
      details     TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_mission_catalog_versions_no_update BEFORE UPDATE ON mission_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'mission_catalog_versions est en ajout seul (#68)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_mission_catalog_versions_no_delete BEFORE DELETE ON mission_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'mission_catalog_versions est en ajout seul (#68)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_mission_catalog_audit_no_update BEFORE UPDATE ON mission_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'mission_catalog_audit est en ajout seul (#68)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_mission_catalog_audit_no_delete BEFORE DELETE ON mission_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'mission_catalog_audit est en ajout seul (#68)'); END;
  `);
  conn().transaction(() => {
    if (conn().prepare('SELECT 1 FROM mission_catalog_versions LIMIT 1').get()) return;
    const content = { missions: originMissions(), rotation: { ...ORIGIN_ROTATION } };
    conn().prepare("INSERT INTO mission_catalog_versions (version, content, source, note) VALUES (1, ?, 'origin', ?)")
      .run(JSON.stringify(content), 'Conversion à l\'identique des six missions quotidiennes du jeu (#68)');
    _audit('migrate', 1, { missions: content.missions.length });
  })();
  _invalidate();
}

function _audit(action, version, details) {
  conn().prepare('INSERT INTO mission_catalog_audit (action, version, details) VALUES (?, ?, ?)')
    .run(action, version, details == null ? null : JSON.stringify(details));
}

// ── Lecture ───────────────────────────────────────────────────────────────────

let _published = null;
function _invalidate() { _published = null; }

function _row(r) {
  if (!r) return null;
  const c = JSON.parse(r.content);
  return { version: r.version, missions: c.missions, rotation: c.rotation, source: r.source, note: r.note, fromVersion: r.from_version, createdAt: r.created_at };
}

function getPublished() {
  if (!_published) _published = _row(conn().prepare('SELECT * FROM mission_catalog_versions ORDER BY version DESC LIMIT 1').get());
  return _published ?? { version: 0, missions: originMissions(), rotation: { ...ORIGIN_ROTATION }, source: 'origin' };
}

function getVersion(version) {
  return _row(conn().prepare('SELECT * FROM mission_catalog_versions WHERE version = ?').get(Number(version)));
}

function listVersions() {
  return conn().prepare('SELECT version, source, note, from_version AS fromVersion, created_at AS createdAt FROM mission_catalog_versions ORDER BY version DESC').all();
}

function getDraft() {
  const r = conn().prepare('SELECT * FROM mission_catalog_draft WHERE id = 1').get();
  if (!r) return null;
  const c = JSON.parse(r.content);
  return { missions: c.missions, rotation: c.rotation, basedOn: r.based_on, updatedAt: r.updated_at };
}

function publishedIds() {
  const ids = new Set();
  for (const r of conn().prepare('SELECT content FROM mission_catalog_versions').all()) for (const x of JSON.parse(r.content).missions) ids.add(x.id);
  return ids;
}

/** Drapeau d'activation en jeu (étape B). Toujours OFF à l'étape A : le jeu garde ses missions. */
function isLive() { return false; }

// ── Validation ────────────────────────────────────────────────────────────────

const _round = (n) => Math.round(n * 10000) / 10000;
function _text(v, max) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
const _isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Normalise une mission saisie ; lève CatalogError au premier défaut bloquant. */
function normalizeMission(input) {
  if (!input || typeof input !== 'object') throw new CatalogError(400, 'Mission invalide.');
  const id = String(input.id ?? '').trim();
  if (!ID_RE.test(id)) throw new CatalogError(400, `Identifiant « ${id} » invalide (a-z, 0-9, _ ; 2 à 40 caractères).`);
  const where = `« ${id} »`;
  const type = String(input.type ?? '');
  const def = TYPES[type];
  if (!def) throw new CatalogError(400, `${where} : type inconnu (compteurs du moteur uniquement).`);
  const category = String(input.category || def.category);
  if (!CATEGORIES[category]) throw new CatalogError(400, `${where} : catégorie inconnue.`);
  const weight = Number(input.weight);
  if (!_isInt(weight, 1, 100)) throw new CatalogError(400, `${where} : poids entier de 1 à 100.`);
  const minAccountDays = Number(input.minAccountDays ?? 0);
  if (!_isInt(minAccountDays, 0, 3650)) throw new CatalogError(400, `${where} : ancienneté minimale entière de 0 à 3650 jours.`);
  const maxAccountDays = input.maxAccountDays == null || input.maxAccountDays === '' ? null : Number(input.maxAccountDays);
  if (maxAccountDays != null && (!_isInt(maxAccountDays, minAccountDays, 3650))) {
    throw new CatalogError(400, `${where} : ancienneté maximale entière ≥ ancienneté minimale (ou vide).`);
  }
  const rawBands = Array.isArray(input.bands) ? input.bands : [];
  if (!rawBands.length || rawBands.length > MAX_BANDS) throw new CatalogError(400, `${where} : 1 à ${MAX_BANDS} tranches de profondeur.`);
  const bands = rawBands.map((b, i) => {
    const fromDepth = Number(b?.fromDepth);
    if (!_isInt(fromDepth, 1, DEPTH_MAX)) throw new CatalogError(400, `${where} : tranche ${i + 1}, profondeur de départ entière de 1 à ${DEPTH_MAX}.`);
    const targets = (Array.isArray(b?.targets) ? b.targets : []).map(Number);
    if (!targets.length || targets.length > MAX_TARGETS) throw new CatalogError(400, `${where} : tranche dès ${fromDepth} m, 1 à ${MAX_TARGETS} objectifs.`);
    targets.forEach(n => {
      if (!_isInt(n, 1, def.cap)) throw new CatalogError(400, `${where} : tranche dès ${fromDepth} m, objectifs entiers de 1 à ${def.cap} ${def.unit}.`);
    });
    if (new Set(targets).size !== targets.length) throw new CatalogError(400, `${where} : tranche dès ${fromDepth} m, objectif en double.`);
    return { fromDepth, targets: [...targets].sort((a, c) => a - c) };
  });
  bands.sort((a, c) => a.fromDepth - c.fromDepth);
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].fromDepth === bands[i - 1].fromDepth) throw new CatalogError(400, `${where} : deux tranches commencent à ${bands[i].fromDepth} m.`);
  }
  const r = input.reward ?? {};
  const coinsPerUnit = Number(r.coinsPerUnit);
  if (!Number.isFinite(coinsPerUnit) || coinsPerUnit < 0 || coinsPerUnit > 1000) throw new CatalogError(400, `${where} : pièces par unité de 0 à 1000.`);
  const gems = Number(r.gems ?? 0);
  if (!_isInt(gems, 0, 5)) throw new CatalogError(400, `${where} : gemmes de récompense entières de 0 à 5.`);
  const gemsFromTarget = Number(r.gemsFromTarget ?? 1);
  if (!_isInt(gemsFromTarget, 1, def.cap)) throw new CatalogError(400, `${where} : seuil des gemmes entier de 1 à ${def.cap}.`);
  const names = {}, descs = {};
  for (const l of LANGS) {
    names[l] = _text(input.names?.[l], 40);
    descs[l] = _text(input.descs?.[l], 120);
  }
  if (!names.fr) throw new CatalogError(400, `${where} : nom français obligatoire.`);
  if (!descs.fr.includes('{t}')) throw new CatalogError(400, `${where} : la description française doit contenir {t} (l'objectif).`);
  const icon = _text(input.icon, 8);
  if (!icon) throw new CatalogError(400, `${where} : icône (emoji) obligatoire, elle sert de repli à l'image.`);
  const image = input.image ? String(input.image) : null;
  if (image && !IMAGE_RE.test(image)) throw new CatalogError(400, `${where} : image invalide (atelier d'icônes uniquement).`);
  return {
    id, active: input.active !== false, type, category, icon, image, names, descs, weight, minAccountDays, maxAccountDays,
    bands, reward: { coinsPerUnit: _round(coinsPerUnit), gems, gemsFromTarget },
  };
}

function normalizeRotation(input) {
  const r = input ?? {};
  const mode = r.mode === 'adaptive' ? 'adaptive' : r.mode === 'origin' ? 'origin' : null;
  if (!mode) throw new CatalogError(400, 'Rotation : mode « origin » ou « adaptive ».');
  const n = (k, min, max) => {
    const v = Number(r[k]);
    if (!_isInt(v, min, max)) throw new CatalogError(400, `Rotation : ${ROTATION_FIELDS[k]} — entier de ${min} à ${max}.`);
    return v;
  };
  const repeatFactor = Number(r.repeatFactor);
  if (!Number.isFinite(repeatFactor) || repeatFactor < 0 || repeatFactor > 1) throw new CatalogError(400, 'Rotation : poids anti-répétition de 0 à 1.');
  const timezone = r.timezone === 'Europe/Brussels' ? 'Europe/Brussels' : r.timezone === 'browser' ? 'browser' : null;
  if (!timezone) throw new CatalogError(400, 'Rotation : changement de jour « browser » ou « Europe/Brussels ».');
  return {
    mode, perDay: n('perDay', 1, 5), maxPerCategory: n('maxPerCategory', 1, 5), repeatDays: n('repeatDays', 0, 7),
    repeatFactor: _round(repeatFactor), perPlayer: r.perPlayer === true, dayBlocks: n('dayBlocks', 0, 20000), timezone,
  };
}

/**
 * Valide un catalogue complet (brouillon avant publication).
 * @returns {{ errors: string[], warnings: string[], missions: object[], rotation: object|null }}
 */
function validateCatalog(raw, rotationRaw, { requiredIds = publishedIds() } = {}) {
  const errors = [], warnings = [];
  let rotation = null;
  try { rotation = normalizeRotation(rotationRaw); } catch (err) { if (!(err instanceof CatalogError)) throw err; errors.push(err.message); }
  if (!Array.isArray(raw) || !raw.length) return { errors: [...errors, 'Catalogue vide.'], warnings, missions: [], rotation };
  if (raw.length > MAX_MISSIONS) errors.push(`Au plus ${MAX_MISSIONS} missions.`);
  const missions = [];
  const seen = new Set();
  for (const m of raw) {
    try {
      const x = normalizeMission(m);
      if (seen.has(x.id)) { errors.push(`Identifiant « ${x.id} » en double.`); continue; }
      seen.add(x.id);
      missions.push(x);
    } catch (err) {
      if (!(err instanceof CatalogError)) throw err;
      errors.push(err.message);
    }
  }
  for (const id of requiredIds) {
    if (!seen.has(id)) errors.push(`« ${id} » est déjà publiée : elle ne peut pas être supprimée, seulement archivée.`);
  }
  const active = missions.filter(x => x.active);
  if (rotation && active.length < rotation.perDay) errors.push(`${rotation.perDay} missions par jour mais seulement ${active.length} mission(s) active(s).`);
  for (const x of missions) {
    if (!x.active) warnings.push(`« ${x.id} » est archivée : plus jamais tirée ; une mission déjà attribuée aujourd'hui reste réclamable.`);
    for (const l of LANGS) {
      if (!x.names[l]) warnings.push(`« ${x.id} » : nom ${l.toUpperCase()} manquant (repli sur le français).`);
      else if (x.descs[l] && !x.descs[l].includes('{t}')) warnings.push(`« ${x.id} » : description ${l.toUpperCase()} sans {t} (objectif non affiché).`);
    }
  }
  if (rotation?.mode === 'origin' && missions.some(x => x.bands.length > 1)) {
    warnings.push('Rotation « origin » : seule la première tranche de profondeur est utilisée (comme le jeu actuel).');
  }
  return { errors, warnings, missions, rotation };
}

/** Écarts entre deux catalogues, champ par champ (missions + réglages de rotation). */
function diff(from, to) {
  const before = new Map(from.missions.map(x => [x.id, x]));
  const changes = [];
  for (const x of to.missions) {
    const b = before.get(x.id);
    if (!b) { changes.push({ id: x.id, kind: 'added' }); continue; }
    const fields = Object.keys(x).filter(k => JSON.stringify(x[k] ?? null) !== JSON.stringify(b[k] ?? null))
      .map(k => ({ field: k, before: b[k] ?? null, after: x[k] ?? null }));
    if (fields.length) changes.push({ id: x.id, kind: 'changed', fields });
  }
  const rf = Object.keys(ROTATION_FIELDS).filter(k => JSON.stringify(from.rotation?.[k] ?? null) !== JSON.stringify(to.rotation?.[k] ?? null))
    .map(k => ({ field: k, before: from.rotation?.[k] ?? null, after: to.rotation?.[k] ?? null }));
  if (rf.length) changes.push({ id: '(rotation)', kind: 'rotation', fields: rf });
  return changes;
}

// ── Brouillon, publication, retour arrière ────────────────────────────────────

function _saveDraft(missions, rotation, basedOn) {
  conn().prepare(`INSERT INTO mission_catalog_draft (id, content, based_on, updated_at) VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET content = excluded.content, based_on = excluded.based_on, updated_at = excluded.updated_at`)
    .run(JSON.stringify({ missions, rotation }), basedOn);
}

function _draftOrCurrent() {
  const current = getPublished();
  // Copie : la version en vigueur est en cache et ne doit jamais être modifiée en place
  return getDraft() ?? { ...JSON.parse(JSON.stringify({ missions: current.missions, rotation: current.rotation })), basedOn: current.version };
}

/** Brouillon identique à la version en vigueur : supprimé (aucun changement en attente). */
function _dropIfClean() {
  const draft = getDraft();
  const current = getPublished();
  if (!draft || draft.basedOn !== current.version || draft.missions.length !== current.missions.length) return false;
  if (diff(current, draft).length) return false;
  conn().prepare('DELETE FROM mission_catalog_draft WHERE id = 1').run();
  _audit('draft_clean', null, null);
  return true;
}

/** Ajoute ou modifie une mission dans le brouillon (créé depuis la version en vigueur si absent). */
function upsertDraftMission(input) {
  const x = normalizeMission(input);
  return conn().transaction(() => {
    const draft = _draftOrCurrent();
    const i = draft.missions.findIndex(m => m.id === x.id);
    if (i < 0 && draft.missions.length >= MAX_MISSIONS) throw new CatalogError(400, `Au plus ${MAX_MISSIONS} missions.`);
    const before = i >= 0 ? draft.missions[i] : null;
    if (i >= 0) draft.missions[i] = x; else draft.missions.push(x);
    _saveDraft(draft.missions, draft.rotation, draft.basedOn);
    _audit(i >= 0 ? 'draft_update' : 'draft_add', null, { id: x.id, changes: before ? diff({ missions: [before] }, { missions: [x] })[0]?.fields ?? [] : null });
    return { mission: x, draftDropped: _dropIfClean() };
  })();
}

/** Modifie les réglages de rotation dans le brouillon. */
function setDraftRotation(input) {
  const rotation = normalizeRotation(input);
  return conn().transaction(() => {
    const draft = _draftOrCurrent();
    const changes = diff({ missions: [], rotation: draft.rotation }, { missions: [], rotation }).flatMap(c => c.fields);
    _saveDraft(draft.missions, rotation, draft.basedOn);
    _audit('draft_rotation', null, { changes });
    return { rotation, draftDropped: _dropIfClean() };
  })();
}

/**
 * Charge la proposition de barème adaptatif dans le brouillon (objectifs par tranche de
 * profondeur, poids, rotation). Rien n'est publié ; récompenses par unité inchangées.
 */
function loadProposalIntoDraft() {
  return conn().transaction(() => {
    const draft = _draftOrCurrent();
    for (const m of draft.missions) {
      const p = PROPOSAL.missions[m.id];
      if (p) Object.assign(m, JSON.parse(JSON.stringify(p)));
    }
    const v = validateCatalog(draft.missions, PROPOSAL.rotation);
    if (v.errors.length) throw new CatalogError(400, 'Proposition incompatible avec le brouillon.', v.errors);
    _saveDraft(v.missions, v.rotation, draft.basedOn);
    _audit('draft_proposal', null, { missions: Object.keys(PROPOSAL.missions) });
    return { draftDropped: _dropIfClean() };
  })();
}

/** Remet UNE mission publiée à son état en vigueur dans le brouillon. */
function revertDraftMission(id) {
  return conn().transaction(() => {
    const draft = getDraft();
    const pub = getPublished().missions.find(m => m.id === id);
    if (!pub) throw new CatalogError(409, `« ${id} » n'est pas dans la version en vigueur : retirez-la du brouillon.`);
    const i = draft ? draft.missions.findIndex(m => m.id === id) : -1;
    if (i < 0 || !diff({ missions: [pub] }, { missions: [draft.missions[i]] }).length) throw new CatalogError(409, `« ${id} » n'a aucune modification dans le brouillon.`);
    draft.missions[i] = pub;
    _saveDraft(draft.missions, draft.rotation, draft.basedOn);
    _audit('draft_revert', null, { id });
    return { mission: pub, draftDropped: _dropIfClean() };
  })();
}

/** Retire du brouillon une mission jamais publiée. */
function removeDraftMission(id) {
  return conn().transaction(() => {
    if (publishedIds().has(id)) throw new CatalogError(409, `« ${id} » est déjà publiée : archivez-la au lieu de la supprimer.`);
    const draft = getDraft();
    if (!draft || !draft.missions.some(m => m.id === id)) throw new CatalogError(404, 'Mission absente du brouillon.');
    _saveDraft(draft.missions.filter(m => m.id !== id), draft.rotation, draft.basedOn);
    _audit('draft_remove', null, { id });
    _dropIfClean();
  })();
}

function discardDraft() {
  const r = conn().prepare('DELETE FROM mission_catalog_draft WHERE id = 1').run();
  if (r.changes) _audit('draft_discard', null, null);
  return r.changes > 0;
}

/** Publication atomique du brouillon (refusée si invalide ou si la version a changé entre-temps). */
function publishDraft({ note, expectedBasedOn } = {}) {
  const result = conn().transaction(() => {
    const draft = getDraft();
    if (!draft) throw new CatalogError(409, 'Aucun brouillon à publier.');
    const current = getPublished();
    if (draft.basedOn !== current.version || (expectedBasedOn != null && Number(expectedBasedOn) !== current.version)) {
      throw new CatalogError(409, `Le brouillon part de la version ${draft.basedOn}, la version en vigueur est la ${current.version} : rechargez.`);
    }
    const v = validateCatalog(draft.missions, draft.rotation);
    if (v.errors.length) throw new CatalogError(400, 'Brouillon invalide.', v.errors);
    const changes = diff(current, v);
    if (!changes.length) throw new CatalogError(409, 'Aucun changement par rapport à la version en vigueur.');
    const version = current.version + 1;
    conn().prepare("INSERT INTO mission_catalog_versions (version, content, source, note, from_version) VALUES (?, ?, 'publish', ?, ?)")
      .run(version, JSON.stringify({ missions: v.missions, rotation: v.rotation }), _text(note, 300) || null, current.version);
    conn().prepare('DELETE FROM mission_catalog_draft WHERE id = 1').run();
    _audit('publish', version, { changes });
    return { version, changes, warnings: v.warnings };
  })();
  _invalidate();
  return result;
}

/** Retour arrière : publie une NOUVELLE version reprenant une version antérieure (missions ajoutées depuis : archivées). */
function rollbackTo(target, { note } = {}) {
  const result = conn().transaction(() => {
    const old = getVersion(target);
    if (!old) throw new CatalogError(404, 'Version introuvable.');
    const current = getPublished();
    if (old.version === current.version) throw new CatalogError(409, 'Cette version est déjà en vigueur.');
    const ids = new Set(old.missions.map(x => x.id));
    const missions = [...old.missions, ...current.missions.filter(x => !ids.has(x.id)).map(x => ({ ...x, active: false }))];
    const v = validateCatalog(missions, old.rotation);
    if (v.errors.length) throw new CatalogError(400, 'Retour arrière impossible.', v.errors);
    const version = current.version + 1;
    conn().prepare("INSERT INTO mission_catalog_versions (version, content, source, note, from_version) VALUES (?, ?, 'rollback', ?, ?)")
      .run(version, JSON.stringify({ missions: v.missions, rotation: v.rotation }), _text(note, 300) || `Retour à la version ${old.version}`, old.version);
    conn().prepare('DELETE FROM mission_catalog_draft WHERE id = 1').run();
    _audit('rollback', version, { to: old.version, changes: diff(current, v) });
    return { version, restored: old.version };
  })();
  _invalidate();
  return result;
}

function listAudit(limit = 100) {
  return conn().prepare('SELECT * FROM mission_catalog_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
}

// ── Rotation : tirage reproductible et adaptation au joueur ───────────────────

/** Hash et LCG identiques à public/js/dailyMissions.js (rotation d'origine reproduite à l'identique). */
function _hash(str) {
  let h = 0xdeadbeef;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x9e3779b9);
    h ^= h >>> 16;
  }
  return h >>> 0;
}
const _lcg = (n) => ((n * 1664525 + 1013904223) >>> 0);

function rewardFor(m, target) {
  return { coins: Math.round(target * m.reward.coinsPerUnit), gems: target >= m.reward.gemsFromTarget ? m.reward.gems : 0 };
}

/** Rotation d'origine : 3 missions distinctes, tirage uniforme commun à tous (jeu actuel). */
function _planOrigin(missions, rotation, dateStr) {
  let rng = _hash(dateStr);
  const pool = missions.filter(m => m.active);
  const out = [];
  for (let i = 0; i < rotation.perDay && pool.length; i++) {
    rng = _lcg(rng);
    const m = pool.splice(rng % pool.length, 1)[0];
    rng = _lcg(rng);
    const targets = m.bands[0].targets;
    const target = targets[rng % targets.length];
    out.push({ id: m.id, type: m.type, target, reward: rewardFor(m, target) });
  }
  return out;
}

const _blockTypes = () => {
  try { return blockCatalog.getPublished().types; } catch (_) { return blockCatalog.originTypes(); }
};

/**
 * Quantités attendues pour `blocks` blocs cassés à partir de `depth` (catalogue de blocs publié,
 * Chance du joueur) : coffres minés, gemmes, pièces (base × Sac, hors reliques et boosts).
 */
function expectedPerDay(profile, blocks, types = _blockTypes()) {
  const luck = profile.upgrades?.luck ?? 0;
  const bag = 1 + (profile.upgrades?.bag ?? 0) * 0.3;
  const byId = new Map(types.map(t => [t.id, t]));
  const out = { blocks, meters: blocks, chests: 0, gems: 0, coins: 0 };
  if (!blocks) return out;
  const step = Math.max(1, Math.ceil(blocks / 60));
  for (let b = 0; b < blocks; b += step) {
    const d = profile.depth + b;
    const n = Math.min(step, blocks - b);
    for (const o of blockCatalog.odds(types, d, luck)) {
      const t = byId.get(o.id);
      if (t.category === 'coffre') out.chests += o.p * n;
      if (t.category === 'gemme' && t.gemReward !== false) out.gems += o.p * n;
      out.coins += o.p * n * Math.ceil(t.reward * (1 + (d - 1) * 0.05)) * bag;
    }
  }
  out.chests = _round(out.chests); out.gems = _round(out.gems); out.coins = Math.round(out.coins);
  return out;
}

function _remainingUpgrades(profile) {
  const u = profile.upgrades ?? {};
  return Object.entries(UPGRADE_MAX).reduce((s, [k, max]) => s + Math.max(0, max - (Number(u[k]) || 0)), 0);
}

/** Quantité attendue du compteur d'un type pour une journée de référence (null = non estimable). */
function _expectedCount(type, exp) {
  switch (type) {
    case 'break_blocks': return exp.blocks;
    case 'depth_gain': return exp.meters;
    case 'open_chests': return exp.chests;
    case 'find_gems': return exp.gems;
    case 'earn_coins': return exp.coins;
    default: return null;
  }
}

/**
 * Éligibilité et objectifs possibles d'une mission pour un profil (rotation adaptative).
 * @returns {{ ok: boolean, reason?: string, band?: object, targets?: number[], cap?: number|null }}
 */
function eligibility(m, profile, rotation, exp = null) {
  if (!m.active) return { ok: false, reason: 'archivée' };
  const days = profile.accountDays ?? 0;
  if (days < m.minAccountDays) return { ok: false, reason: `compte de moins de ${m.minAccountDays} jour(s)` };
  if (m.maxAccountDays != null && days > m.maxAccountDays) return { ok: false, reason: `compte de plus de ${m.maxAccountDays} jour(s)` };
  const band = [...m.bands].reverse().find(b => profile.depth >= b.fromDepth);
  if (!band) return { ok: false, reason: `profondeur < ${m.bands[0].fromDepth} m` };
  const def = TYPES[m.type];
  let cap = null;
  if (def.needsUpgrades) {
    cap = _remainingUpgrades(profile);
    if (!cap) return { ok: false, reason: 'toutes les améliorations sont au maximum', band };
  }
  if (def.blockCategory) {
    const any = _blockTypes().some(t => t.active !== false && t.category === def.blockCategory && (def.blockCategory !== 'gemme' || t.gemReward !== false) && profile.depth >= t.minDepth);
    if (!any) return { ok: false, reason: `aucun bloc « ${def.blockCategory} » à ${profile.depth} m`, band };
  }
  if (rotation.dayBlocks > 0) {
    const e = exp ?? expectedPerDay(profile, rotation.dayBlocks);
    const n = _expectedCount(m.type, e);
    if (n != null) cap = cap == null ? Math.floor(n) : Math.min(cap, Math.floor(n));
  }
  const targets = cap == null ? band.targets : band.targets.filter(t => t <= cap);
  if (!targets.length) return { ok: false, reason: `objectif minimal ${band.targets[0]} > atteignable en une journée de référence (${cap})`, band, cap };
  return { ok: true, band, targets, cap };
}

/** Générateur déterministe (mulberry32) à partir d'une graine. */
function _rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Missions d'un jour. Reproductible : même date + même joueur (si `perPlayer`) + même profil +
 * même historique → mêmes missions.
 * @param {object} catalog  { missions, rotation }
 * @param {object} opts     { date 'YYYY-MM-DD', profile, playerKey, history: [[ids du jour J-1], [J-2]…] }
 */
function planDay(catalog, { date, profile, playerKey = '', history = [] }) {
  const { missions, rotation } = catalog;
  if (rotation.mode === 'origin') return { missions: _planOrigin(missions, rotation, date), excluded: [] };
  const rand = _rng(_hash(rotation.perPlayer ? `${date}|${playerKey}` : date));
  const exp = rotation.dayBlocks > 0 ? expectedPerDay(profile, rotation.dayBlocks) : null;
  // Anti-répétition dégressive : tirée hier → × facteur ; il y a k jours → × facteur^((N−k+1)/N)
  const penalty = (id) => history.slice(0, rotation.repeatDays).reduce((f, ids, k) =>
    (ids.includes(id) ? f * rotation.repeatFactor ** ((rotation.repeatDays - k) / rotation.repeatDays) : f), 1);
  const excluded = [];
  let pool = [];
  for (const m of missions) {
    const e = eligibility(m, profile, rotation, exp);
    if (!e.ok) { if (m.active) excluded.push({ id: m.id, reason: e.reason }); continue; }
    pool.push({ m, targets: e.targets, w: m.weight * penalty(m.id) });
  }
  // Facteur 0 : mission exclue seulement s'il reste assez de missions ; sinon poids minimal
  if (pool.filter(p => p.w > 0).length < rotation.perDay) pool = pool.map(p => ({ ...p, w: p.w || p.m.weight * 0.01 }));
  const out = [];
  const perCat = {};
  while (out.length < rotation.perDay) {
    const cand = pool.filter(p => p.w > 0 && (perCat[p.m.category] ?? 0) < rotation.maxPerCategory);
    if (!cand.length) break;
    const total = cand.reduce((s, p) => s + p.w, 0);
    let r = rand() * total;
    let pick = cand[cand.length - 1];
    for (const p of cand) { r -= p.w; if (r <= 0) { pick = p; break; } }
    pool = pool.filter(p => p !== pick);
    perCat[pick.m.category] = (perCat[pick.m.category] ?? 0) + 1;
    const target = pick.targets[Math.floor(rand() * pick.targets.length)];
    out.push({ id: pick.m.id, type: pick.m.type, target, reward: rewardFor(pick.m, target) });
  }
  return { missions: out, excluded };
}

function _addDays(dateStr, n) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function _profile(p) {
  const base = PROFILES.find(x => x.id === p?.id) ?? {};
  const depth = Number(p?.depth ?? base.depth);
  if (!_isInt(depth, 1, DEPTH_MAX)) throw new CatalogError(400, `Profil : profondeur entière de 1 à ${DEPTH_MAX}.`);
  const accountDays = Number(p?.accountDays ?? base.accountDays ?? 0);
  if (!_isInt(accountDays, 0, 3650)) throw new CatalogError(400, 'Profil : ancienneté entière de 0 à 3650 jours.');
  const blocksPerDay = Number(p?.blocksPerDay ?? base.blocksPerDay ?? 1000);
  if (!_isInt(blocksPerDay, 0, 20000)) throw new CatalogError(400, 'Profil : blocs par jour, entier de 0 à 20 000.');
  const upgrades = {};
  for (const [k, max] of Object.entries(UPGRADE_MAX)) {
    const v = Number(p?.upgrades?.[k] ?? base.upgrades?.[k] ?? (k === 'pickaxe' ? 1 : 0));
    if (!_isInt(v, 0, max)) throw new CatalogError(400, `Profil : niveau « ${k} » entier de 0 à ${max}.`);
    upgrades[k] = v;
  }
  return { id: String(p?.id ?? base.id ?? 'perso').slice(0, 20), label: _text(p?.label ?? base.label ?? 'Profil', 30), depth, accountDays, blocksPerDay, upgrades };
}

/**
 * Simulateur (aucune écriture) : pour chaque profil, `days` journées successives depuis `start`,
 * avec l'historique anti-répétition, la complétion estimée (activité du profil) et la répartition.
 * `source` : 'published' | 'draft' | 'proposal' (proposition de barème appliquée au brouillon, en mémoire).
 */
function simulate({ source = 'draft', profiles = PROFILES, days = 7, start = null, playerKey = 'joueur-test' } = {}) {
  if (!_isInt(Number(days), 1, 31)) throw new CatalogError(400, 'Simulation : 1 à 31 jours.');
  if (start != null && !DATE_RE.test(String(start))) throw new CatalogError(400, 'Simulation : date de départ AAAA-MM-JJ.');
  if (!Array.isArray(profiles) || !profiles.length || profiles.length > 6) throw new CatalogError(400, 'Simulation : 1 à 6 profils.');
  const cat = _sourceCatalog(source);
  const startDate = start ?? new Date().toISOString().slice(0, 10);
  const key = _text(playerKey, 40) || 'joueur-test';
  const types = _blockTypes();
  return {
    source, version: cat.version, rotation: cat.rotation, start: startDate, days: Number(days),
    profiles: profiles.map(p0 => {
      const profile = _profile(p0);
      const activity = expectedPerDay(profile, profile.blocksPerDay, types);
      const history = [];
      const freq = {};
      const cats = {};
      let distinctSets = new Set();
      let repeats = 0, completed = 0, assigned = 0, coins = 0, gems = 0;
      const plan = [];
      for (let i = 0; i < Number(days); i++) {
        const date = _addDays(startDate, i);
        const { missions, excluded } = planDay(cat, { date, profile, playerKey: key, history });
        const prev = new Set(history[0] ?? []);
        const rows = missions.map(x => {
          const m = cat.missions.find(y => y.id === x.id);
          const expected = x.type === 'buy_upgrades' ? Math.min(_remainingUpgrades(profile), 3) : _expectedCount(x.type, activity);
          const done = expected != null && expected >= x.target;
          freq[x.id] = (freq[x.id] ?? 0) + 1;
          cats[m.category] = (cats[m.category] ?? 0) + 1;
          if (prev.has(x.id)) repeats++;
          assigned++;
          if (done) { completed++; coins += x.reward.coins; gems += x.reward.gems; }
          return { ...x, name: m.names.fr, icon: m.icon, image: m.image, text: _fill(m.descs.fr, x.target), expected: expected == null ? null : _round(expected), done, repeated: prev.has(x.id) };
        });
        distinctSets.add(missions.map(x => `${x.id}:${x.target}`).sort().join(','));
        plan.push({ date, missions: rows, excluded });
        history.unshift(missions.map(x => x.id));
      }
      return {
        profile, activity, plan,
        stats: { assigned, completed, completionRate: assigned ? _round(completed / assigned) : 0, repeatsFromYesterday: repeats,
          distinctDays: distinctSets.size, frequency: freq, categories: cats, coinsIfCompleted: coins, gemsIfCompleted: gems },
      };
    }),
  };
}

function _fill(desc, n) {
  return String(desc ?? '').replace(/\{t\}/g, String(n)).replace(/\{s\}/g, n > 1 ? 's' : '');
}

function _sourceCatalog(source) {
  const pub = getPublished();
  if (source === 'published') return { version: pub.version, missions: pub.missions, rotation: pub.rotation };
  const draft = getDraft();
  const base = draft ? { version: `brouillon (base v${draft.basedOn})`, missions: draft.missions, rotation: draft.rotation }
    : { version: pub.version, missions: pub.missions, rotation: pub.rotation };
  if (source === 'draft') return base;
  if (source === 'proposal') {
    const missions = JSON.parse(JSON.stringify(base.missions)).map(m => (PROPOSAL.missions[m.id] ? { ...m, ...JSON.parse(JSON.stringify(PROPOSAL.missions[m.id])) } : m));
    return { version: `proposition sur ${base.version}`, missions, rotation: { ...PROPOSAL.rotation } };
  }
  throw new CatalogError(400, 'Simulation : source « published », « draft » ou « proposal ».');
}

/**
 * Aperçu d'UNE mission (saisie de la fiche, non enregistrée) à 20, 100, 250 et 500 m : éligibilité,
 * objectifs possibles, récompenses, raison d'exclusion — avec la rotation du brouillon (ou celle
 * fournie) et les profils de référence.
 */
function previewMission(input, { rotation = null } = {}) {
  const m = normalizeMission(input);
  const rot = rotation ? normalizeRotation(rotation) : (getDraft()?.rotation ?? getPublished().rotation);
  const adaptive = rot.mode === 'adaptive' ? rot : { ...PROPOSAL.rotation, mode: 'adaptive' };
  return {
    rotationUsed: adaptive, rotationIsProposal: rot.mode !== 'adaptive',
    rows: PROFILES.map(p0 => {
      const profile = _profile(p0);
      const e = eligibility(m, profile, adaptive);
      const targets = e.ok ? e.targets : [];
      return { profile: { id: profile.id, label: profile.label, depth: profile.depth, accountDays: profile.accountDays }, ok: e.ok, reason: e.reason ?? null,
        bandFrom: e.band?.fromDepth ?? null, cap: e.cap ?? null, targets,
        rewards: targets.map(t => ({ target: t, ...rewardFor(m, t), text: _fill(m.descs.fr, t) })) };
    }),
  };
}

/** Vue admin : version en vigueur, brouillon validé et ses écarts, versions, types, profils. */
function buildAdminView() {
  const published = getPublished();
  const draft = getDraft();
  const validation = draft ? validateCatalog(draft.missions, draft.rotation) : null;
  const changes = draft ? diff(published, validation) : [];
  const pending = draft && (changes.length || draft.basedOn !== published.version || draft.missions.length !== published.missions.length);
  return {
    live: isLive(),
    published,
    draft: pending ? { ...draft, errors: validation.errors, warnings: validation.warnings, changes } : null,
    publishedIds: [...publishedIds()],
    versions: listVersions(),
    types: TYPES, unavailable: UNAVAILABLE, categories: CATEGORIES, rotationFields: ROTATION_FIELDS,
    proposal: PROPOSAL, profiles: PROFILES, upgradeMax: UPGRADE_MAX,
    langs: LANGS,
    limits: { maxMissions: MAX_MISSIONS, maxBands: MAX_BANDS, maxTargets: MAX_TARGETS },
  };
}

module.exports = {
  CatalogError, TYPES, UNAVAILABLE, CATEGORIES, ROTATION_FIELDS, ORIGIN_ROTATION, PROPOSAL, PROFILES, LANGS,
  init, clientMissions, originMissions, getPublished, getVersion, getDraft, listVersions, publishedIds, isLive,
  normalizeMission, normalizeRotation, validateCatalog, diff,
  upsertDraftMission, setDraftRotation, loadProposalIntoDraft, revertDraftMission, removeDraftMission, discardDraft,
  publishDraft, rollbackTo, listAudit, buildAdminView,
  rewardFor, expectedPerDay, eligibility, planDay, simulate, previewMission,
};
