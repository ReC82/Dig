/**
 * server/monthlyEvents.js — Événements mensuels (#56, demande du propriétaire du 02/11/2026).
 *
 * Distincts des saisons hebdomadaires (#16/#48) : un événement a ses propres dates (heure de
 * Bruxelles), ses objets exclusifs et ses souvenirs, qui ne sont JAMAIS remis à zéro par une
 * saison. Aucun gain économique : un objet d'événement est un souvenir (ni pièces, ni gemmes).
 *
 *   - Événement (`monthly_events`) : identifiant, icône, noms et accroches FR/EN/NL/ES, début/fin
 *     (UTC en base, saisis en heure de Bruxelles dans l'admin), public ou TEST (réservé à une liste
 *     de comptes), statut enregistré `draft` | `scheduled`. État affiché : brouillon, planifié
 *     (avant le début), actif, terminé. Rien n'est supprimé ; chaque modification ajoute une
 *     révision (`monthly_event_revisions`) restaurable et une ligne au journal.
 *   - Objets (`monthly_event_items`) : icône, image facultative, consigne d'illustration, noms et
 *     descriptions humoristiques FR/EN/NL/ES, rareté, chance en % PAR BLOC ÉLIGIBLE, profondeur
 *     minimale, catégories de blocs (vide = toutes), activé.
 *   - Drop côté serveur uniquement, à la sauvegarde : seuls les blocs VALIDÉS par le serveur
 *     (compteurs `blocks:<type>` de #38, bornés par la profondeur retenue #9/#25) minés depuis le
 *     dernier passage comptent ; tirage par `crypto` (le client ne peut ni choisir ni rejouer).
 *     Curseur par joueur et par événement initialisé au premier passage pendant l'événement :
 *     la progression d'avant l'événement ne compte pas. Chaque objet s'obtient une seule fois par
 *     joueur (clé primaire), même en cas de requêtes simultanées ou de redémarrage.
 *   - Planifier = l'événement est figé (modification impossible sans le repasser en brouillon) ;
 *     public : barème confirmé explicitement. Repasser en brouillon arrête aussitôt les drops ;
 *     les objets déjà trouvés restent acquis.
 *   - Calendrier : une proposition par mois (fêtes calculées : Nouvel An, Nouvel An chinois,
 *     carnaval, Pâques, Halloween, Noël… ; mois sans fête : « thème à choisir », jamais imposé),
 *     date limite de préparation, lien vers l'événement existant.
 *   - IA (#37, blockAi.guardedJson : clé côté serveur, quota, plafond, journal) : proposition de
 *     thème, objets et traductions, TOUJOURS enregistrée en brouillon de test.
 *   - Contenu préparé (`server/content/events/*.json`) importé une seule fois en brouillon.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const db = require('./db');

const conn = () => db.getDb();

const LANGS = ['fr', 'en', 'nl', 'es'];
const LANG_LABELS = { fr: 'French', en: 'English', nl: 'Dutch', es: 'Spanish' };
const TZ = 'Europe/Brussels';
const RARITIES = ['commun', 'peu-commun', 'rare', 'epique', 'legendaire'];
const CATEGORIES = ['terre', 'pierre', 'minerai', 'coffre', 'gemme'];
const ID_RE = /^[a-z][a-z0-9_]{2,39}$/;
const MAX = { name: 60, tagline: 240, desc: 320, brief: 600, items: 12, testers: 20, durationDays: 62, concept: 600 };
const MAX_BLOCKS_PER_SAVE = 2000;   // au-delà, le curseur avance sans tirage (aucune rafale d'objets)
const PREP_DAYS = 21;               // préparation conseillée avant le début
const ANNOUNCE_DAYS = 7;            // annonce « à venir » dans le centre d'actualités (#50)
const CONTENT_DIR = path.join(__dirname, 'content', 'events');

class EventError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const J = (v, d) => { try { return v == null ? d : JSON.parse(v); } catch (_) { return d; } };

// ── Schéma (ajout seul, idempotent) ───────────────────────────────────────────

function init(c = conn()) {
  c.exec(`
    CREATE TABLE IF NOT EXISTS monthly_events (
      id          TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'draft',
      audience    TEXT NOT NULL DEFAULT 'test',
      icon        TEXT NOT NULL DEFAULT '🎉',
      names       TEXT NOT NULL,
      taglines    TEXT NOT NULL,
      starts_at   TEXT NOT NULL,
      ends_at     TEXT NOT NULL,
      testers     TEXT NOT NULL DEFAULT '[]',
      source      TEXT NOT NULL DEFAULT 'manual',
      revision    INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS monthly_event_items (
      event_id    TEXT NOT NULL,
      id          TEXT NOT NULL,
      sort        INTEGER NOT NULL DEFAULT 0,
      icon        TEXT NOT NULL,
      image       TEXT,
      brief       TEXT NOT NULL DEFAULT '',
      names       TEXT NOT NULL,
      descs       TEXT NOT NULL,
      rarity      TEXT NOT NULL,
      chance_pct  REAL NOT NULL,
      min_depth   INTEGER NOT NULL DEFAULT 0,
      drop_from   TEXT NOT NULL DEFAULT '[]',
      enabled     INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (event_id, id)
    );
    CREATE TABLE IF NOT EXISTS monthly_event_finds (
      user_id   INTEGER NOT NULL,
      event_id  TEXT NOT NULL,
      item_id   TEXT NOT NULL,
      found_at  TEXT NOT NULL,
      depth     INTEGER,
      PRIMARY KEY (user_id, event_id, item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_monthly_event_finds_event ON monthly_event_finds(event_id, item_id);
    CREATE TABLE IF NOT EXISTS monthly_event_cursors (
      user_id     INTEGER NOT NULL,
      event_id    TEXT NOT NULL,
      ref_counts  TEXT NOT NULL,
      blocks      INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS monthly_event_revisions (
      event_id  TEXT NOT NULL,
      revision  INTEGER NOT NULL,
      content   TEXT NOT NULL,
      action    TEXT NOT NULL,
      at        TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, revision)
    );
    CREATE TABLE IF NOT EXISTS monthly_event_log (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      at        TEXT NOT NULL DEFAULT (datetime('now')),
      event_id  TEXT,
      action    TEXT NOT NULL,
      details   TEXT
    );
    CREATE TABLE IF NOT EXISTS monthly_event_ai (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      concept     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      error       TEXT,
      event_id    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS monthly_event_meta (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL
    );
  `);
}

function _log(eventId, action, details = null) {
  conn().prepare('INSERT INTO monthly_event_log (event_id, action, details) VALUES (?, ?, ?)')
    .run(eventId, action, details ? JSON.stringify(details) : null);
}

// ── Dates (heure de Bruxelles) ────────────────────────────────────────────────

const _iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function _tzOffsetMs(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}

/** « 2026-12-01T00:00 » (heure de Bruxelles) → ISO UTC. */
function brusselsToUtc(local) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(String(local ?? '').trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ms = guess - _tzOffsetMs(guess);
  ms = guess - _tzOffsetMs(ms);   // changement d'heure : second passage
  return Number.isFinite(ms) ? _iso(ms) : null;
}

/** ISO UTC → « 2026-12-01T00:00 » (heure de Bruxelles). */
function utcToBrussels(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms + _tzOffsetMs(ms)).toISOString().slice(0, 16);
}

function _date(v, label) {
  if (typeof v !== 'string') throw new EventError(400, `${label} : date manquante.`);
  const utc = /Z$/.test(v) ? (Number.isFinite(Date.parse(v)) ? _iso(Date.parse(v)) : null) : brusselsToUtc(v);
  if (!utc) throw new EventError(400, `${label} : date invalide (AAAA-MM-JJTHH:MM, heure de Bruxelles).`);
  return utc;
}

// ── Validation ────────────────────────────────────────────────────────────────

const _str = (v, max) => String(v ?? '').replace(/[<>\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);

function _texts(raw, max) {
  const out = {};
  for (const l of LANGS) out[l] = _str(raw?.[l], max);
  return out;
}

function _emoji(v, d) {
  const s = _str(v, 16);
  return s && !/[A-Za-z0-9]/.test(s) ? s : d;
}

const IMAGE_RE = /^\/(api\/collections\/images\/[0-9a-f]{64}\.(png|jpg|webp)|media\/icons\/[a-f0-9]{16}\.webp)$/;

function normalizeItem(input, where) {
  const id = String(input?.id ?? '').trim();
  if (!ID_RE.test(id)) throw new EventError(400, `${where} : identifiant invalide (minuscules, chiffres, _ ; 3 à 40 caractères).`);
  const names = _texts(input.names, MAX.name);
  if (!names.fr) throw new EventError(400, `${where} : nom FR obligatoire.`);
  const rarity = String(input.rarity ?? 'commun');
  if (!RARITIES.includes(rarity)) throw new EventError(400, `${where} : rareté invalide (${RARITIES.join(', ')}).`);
  const chance = Number(input.chancePct);
  if (!Number.isFinite(chance) || chance < 0.001 || chance > 100) throw new EventError(400, `${where} : chance entre 0,001 et 100 % par bloc.`);
  const minDepth = Number(input.minDepth ?? 0);
  if (!Number.isInteger(minDepth) || minDepth < 0 || minDepth > 100000) throw new EventError(400, `${where} : profondeur minimale entière de 0 à 100000.`);
  const dropFrom = Array.isArray(input.dropFrom) ? [...new Set(input.dropFrom.map(String))] : [];
  if (dropFrom.some(c => !CATEGORIES.includes(c))) throw new EventError(400, `${where} : catégories de blocs : ${CATEGORIES.join(', ')}.`);
  const image = input.image ? String(input.image) : null;
  if (image && !IMAGE_RE.test(image)) throw new EventError(400, `${where} : image attendue depuis l'atelier ou le téléversement admin.`);
  return {
    id, icon: _emoji(input.icon, '🎁'), image, brief: _str(input.brief, MAX.brief), names, descs: _texts(input.descs, MAX.desc),
    rarity, chancePct: Math.round(chance * 1000) / 1000, minDepth, dropFrom: CATEGORIES.filter(c => dropFrom.includes(c)), enabled: input.enabled !== false,
  };
}

function normalizeEvent(input = {}) {
  const id = String(input.id ?? '').trim();
  if (!ID_RE.test(id)) throw new EventError(400, 'Identifiant d\'événement invalide (minuscules, chiffres, _ ; 3 à 40 caractères).');
  const names = _texts(input.names, MAX.name);
  if (!names.fr) throw new EventError(400, 'Nom FR de l\'événement obligatoire.');
  const startsAt = _date(input.startsAt, 'Début');
  const endsAt = _date(input.endsAt, 'Fin');
  const dur = Date.parse(endsAt) - Date.parse(startsAt);
  if (dur < 10 * 60_000) throw new EventError(400, 'La fin doit suivre le début d\'au moins 10 minutes.');
  if (dur > MAX.durationDays * 86_400_000) throw new EventError(400, `Durée maximale : ${MAX.durationDays} jours.`);
  const audience = input.audience === 'public' ? 'public' : 'test';
  const testers = Array.isArray(input.testers) ? [...new Set(input.testers.map(x => _str(x, 40)).filter(Boolean))] : [];
  if (testers.length > MAX.testers) throw new EventError(400, `${MAX.testers} testeurs au plus.`);
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length > MAX.items) throw new EventError(400, `${MAX.items} objets au plus.`);
  const norm = items.map((it, i) => normalizeItem(it, `Objet ${i + 1}`));
  const ids = new Set();
  for (const it of norm) {
    if (ids.has(it.id)) throw new EventError(400, `Objet « ${it.id} » en double.`);
    ids.add(it.id);
  }
  return { id, icon: _emoji(input.icon, '🎉'), names, taglines: _texts(input.taglines, MAX.tagline), startsAt, endsAt, audience, testers, items: norm };
}

/** Points à régler avant de planifier (bloquants) et avertissements. */
function readiness(ev) {
  const blocking = [], warnings = [];
  if (!ev.items.length) blocking.push('Aucun objet.');
  if (!ev.items.some(i => i.enabled)) blocking.push('Aucun objet activé : rien ne tomberait.');
  for (const l of LANGS) {
    if (!ev.names[l]) blocking.push(`Nom de l'événement ${l.toUpperCase()} manquant.`);
    for (const it of ev.items) {
      if (!it.names[l]) blocking.push(`« ${it.names.fr || it.id} » : nom ${l.toUpperCase()} manquant.`);
      if (!it.descs[l]) blocking.push(`« ${it.names.fr || it.id} » : description ${l.toUpperCase()} manquante.`);
    }
  }
  if (ev.audience === 'test' && !ev.testers.length) blocking.push('Événement TEST sans testeur : personne ne le verrait.');
  if (ev.audience === 'public') {
    for (const it of ev.items) if (!it.image) warnings.push(`« ${it.names.fr} » : pas d'illustration (l'icône emoji sera affichée).`);
    if (Date.parse(ev.startsAt) - Date.now() < ANNOUNCE_DAYS * 86_400_000) warnings.push(`Début dans moins de ${ANNOUNCE_DAYS} jours : annonce tardive.`);
  }
  for (const it of ev.items) if (it.enabled && it.chancePct > 5 && ev.audience === 'public') warnings.push(`« ${it.names.fr} » : ${it.chancePct} % par bloc, très élevé pour un événement public.`);
  return { ready: blocking.length === 0, blocking, warnings };
}

// ── Lecture ───────────────────────────────────────────────────────────────────

function _itemRow(r) {
  return { id: r.id, icon: r.icon, image: r.image, brief: r.brief, names: J(r.names, {}), descs: J(r.descs, {}), rarity: r.rarity,
    chancePct: r.chance_pct, minDepth: r.min_depth, dropFrom: J(r.drop_from, []), enabled: !!r.enabled };
}

function stateOf(ev, nowMs = Date.now()) {
  if (ev.status !== 'scheduled') return 'draft';
  if (nowMs < Date.parse(ev.startsAt)) return 'planned';
  if (nowMs < Date.parse(ev.endsAt)) return 'active';
  return 'ended';
}

function _eventRow(r, nowMs = Date.now()) {
  if (!r) return null;
  const ev = { id: r.id, status: r.status, audience: r.audience, icon: r.icon, names: J(r.names, {}), taglines: J(r.taglines, {}),
    startsAt: r.starts_at, endsAt: r.ends_at, testers: J(r.testers, []), source: r.source, revision: r.revision,
    createdAt: r.created_at, updatedAt: r.updated_at,
    items: conn().prepare('SELECT * FROM monthly_event_items WHERE event_id = ? ORDER BY sort, id').all(r.id).map(_itemRow) };
  ev.state = stateOf(ev, nowMs);
  return ev;
}

function getEvent(id, nowMs) { return _eventRow(conn().prepare('SELECT * FROM monthly_events WHERE id = ?').get(id), nowMs); }
function listEvents(nowMs) { return conn().prepare('SELECT * FROM monthly_events ORDER BY starts_at DESC, id').all().map(r => _eventRow(r, nowMs)); }

const _content = ev => ({ id: ev.id, icon: ev.icon, names: ev.names, taglines: ev.taglines, startsAt: ev.startsAt, endsAt: ev.endsAt,
  audience: ev.audience, testers: ev.testers, items: ev.items });

// ── Écriture ──────────────────────────────────────────────────────────────────

function _write(ev, { status, source, action }) {
  const c = conn();
  const prev = c.prepare('SELECT revision FROM monthly_events WHERE id = ?').get(ev.id);
  const revision = prev ? prev.revision + 1 : 1;
  c.prepare(`INSERT INTO monthly_events (id, status, audience, icon, names, taglines, starts_at, ends_at, testers, source, revision)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, audience = excluded.audience, icon = excluded.icon, names = excluded.names,
        taglines = excluded.taglines, starts_at = excluded.starts_at, ends_at = excluded.ends_at, testers = excluded.testers,
        revision = excluded.revision, updated_at = datetime('now')`)
    .run(ev.id, status, ev.audience, ev.icon, JSON.stringify(ev.names), JSON.stringify(ev.taglines), ev.startsAt, ev.endsAt,
      JSON.stringify(ev.testers), source, revision);
  c.prepare('DELETE FROM monthly_event_items WHERE event_id = ?').run(ev.id);   // objets de la fiche (définition admin, jamais les trouvailles)
  const ins = c.prepare(`INSERT INTO monthly_event_items (event_id, id, sort, icon, image, brief, names, descs, rarity, chance_pct, min_depth, drop_from, enabled)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  ev.items.forEach((it, i) => ins.run(ev.id, it.id, i, it.icon, it.image, it.brief, JSON.stringify(it.names), JSON.stringify(it.descs),
    it.rarity, it.chancePct, it.minDepth, JSON.stringify(it.dropFrom), it.enabled ? 1 : 0));
  c.prepare('INSERT INTO monthly_event_revisions (event_id, revision, content, action) VALUES (?,?,?,?)')
    .run(ev.id, revision, JSON.stringify({ ..._content(ev), status }), action);
  _log(ev.id, action, { revision });
  return revision;
}

function _assertItemsNotReused(ev) {
  // Un objet déjà trouvé ne peut ni disparaître ni changer d'identifiant : le souvenir doit rester affichable
  const found = conn().prepare('SELECT DISTINCT item_id FROM monthly_event_finds WHERE event_id = ?').all(ev.id).map(r => r.item_id);
  const ids = new Set(ev.items.map(i => i.id));
  const lost = found.filter(id => !ids.has(id));
  if (lost.length) throw new EventError(409, `Objets déjà trouvés par des joueurs, impossibles à retirer : ${lost.join(', ')} (désactivez-les plutôt).`);
}

function createEvent(input, { source = 'manual' } = {}) {
  const ev = normalizeEvent(input);
  return db.runTransaction(() => {
    if (conn().prepare('SELECT 1 FROM monthly_events WHERE id = ?').get(ev.id)) throw new EventError(409, `L'événement « ${ev.id} » existe déjà.`);
    _write(ev, { status: 'draft', source, action: 'create' });
    return getEvent(ev.id);
  });
}

function updateEvent(id, input) {
  const ev = normalizeEvent({ ...input, id });
  return db.runTransaction(() => {
    const cur = getEvent(id);
    if (!cur) throw new EventError(404, 'Événement introuvable.');
    if (cur.status !== 'draft') throw new EventError(409, 'Événement planifié : repassez-le en brouillon pour le modifier (les drops s\'arrêtent).');
    _assertItemsNotReused(ev);
    _write(ev, { status: 'draft', source: cur.source, action: 'update' });
    return getEvent(id);
  });
}

/**
 * Planifie (publie) un événement : figé, visible et actif à ses dates.
 * Public : barème confirmé (`confirmRates`) et confirmation de publication (`confirmPublic`).
 */
function scheduleEvent(id, { confirmRates = false, confirmPublic = false, nowMs = Date.now() } = {}) {
  return db.runTransaction(() => {
    const ev = getEvent(id, nowMs);
    if (!ev) throw new EventError(404, 'Événement introuvable.');
    if (ev.status === 'scheduled') return ev;
    if (Date.parse(ev.endsAt) <= nowMs) throw new EventError(409, 'Date de fin passée : changez les dates.');
    const r = readiness(ev);
    if (!r.ready) throw new EventError(409, `Événement incomplet : ${r.blocking.join(' ')}`);
    if (ev.audience === 'public' && !(confirmRates && confirmPublic)) {
      throw new EventError(409, 'Événement public : cochez « barème validé » et « publication validée par le propriétaire ».');
    }
    _write(ev, { status: 'scheduled', source: ev.source, action: ev.audience === 'public' ? 'schedule_public' : 'schedule_test' });
    return getEvent(id, nowMs);
  });
}

/** Repasse en brouillon : drops arrêtés aussitôt, objets trouvés conservés. */
function unscheduleEvent(id) {
  return db.runTransaction(() => {
    const ev = getEvent(id);
    if (!ev) throw new EventError(404, 'Événement introuvable.');
    if (ev.status === 'draft') return ev;
    _write(ev, { status: 'draft', source: ev.source, action: 'unschedule' });
    return getEvent(id);
  });
}

function listRevisions(id) {
  return conn().prepare('SELECT revision, action, at, content FROM monthly_event_revisions WHERE event_id = ? ORDER BY revision DESC LIMIT 50').all(id)
    .map(r => { const c = J(r.content, {}); return { revision: r.revision, action: r.action, at: r.at, status: c.status, items: (c.items || []).length, startsAt: c.startsAt, endsAt: c.endsAt }; });
}

/** Restaure le contenu d'une révision, en brouillon (jamais une planification automatique). */
function restoreRevision(id, revision) {
  return db.runTransaction(() => {
    const cur = getEvent(id);
    if (!cur) throw new EventError(404, 'Événement introuvable.');
    if (cur.status !== 'draft') throw new EventError(409, 'Repassez d\'abord l\'événement en brouillon.');
    const row = conn().prepare('SELECT content FROM monthly_event_revisions WHERE event_id = ? AND revision = ?').get(id, revision);
    if (!row) throw new EventError(404, 'Révision introuvable.');
    const ev = normalizeEvent(J(row.content, {}));
    _assertItemsNotReused(ev);
    _write(ev, { status: 'draft', source: cur.source, action: `restore_${revision}` });
    return getEvent(id);
  });
}

function listLog(limit = 100) {
  return conn().prepare('SELECT * FROM monthly_event_log ORDER BY id DESC LIMIT ?').all(limit)
    .map(r => ({ at: r.at, eventId: r.event_id, action: r.action, details: J(r.details, null) }));
}

// ── Drops (serveur) ───────────────────────────────────────────────────────────

function _userIdsOf(usernames) {
  if (!usernames.length) return new Set();
  const q = conn().prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE');
  return new Set(usernames.map(u => q.get(u)?.id).filter(Boolean));
}

function _isTester(ev, userId) { return _userIdsOf(ev.testers).has(userId); }

/** Événements actifs visibles par ce joueur (public, ou TEST dont il est testeur). */
function activeFor(userId, nowMs = Date.now()) {
  return conn().prepare("SELECT * FROM monthly_events WHERE status = 'scheduled' AND starts_at <= ? AND ends_at > ?").all(_iso(nowMs), _iso(nowMs))
    .map(r => _eventRow(r, nowMs)).filter(ev => ev.audience === 'public' || (userId && _isTester(ev, userId)));
}

function _rand() { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; }

/**
 * Après une sauvegarde acceptée ET le crédit des statistiques fiables (badges.processSave) :
 * tire les objets des événements actifs sur les blocs validés minés depuis le dernier passage.
 * Ne lève jamais vers l'appelant pour une donnée client (aucune n'est lue ici).
 * @returns {Array<{eventId, itemId, icon, image, names, eventNames}>}
 */
function processSave(userId, { nowMs = Date.now(), rand = _rand } = {}) {
  const events = activeFor(userId, nowMs);
  if (!events.length) return [];
  const blockCatalog = require('./blockCatalog');
  const badges = require('./badges');
  const catOf = new Map(blockCatalog.getPublished().types.map(t => [t.id, t.category]));
  const t = db.getDepthTracking(userId);
  const season = db.getActiveSeason();
  const depth = t && season && t.season_id === season.id ? t.accepted_depth : 0;
  return db.runTransaction(() => {
    const stats = badges.validatedStats(userId);
    const counts = {};
    for (const [k, v] of Object.entries(stats)) if (k.startsWith('blocks:')) counts[k.slice(7)] = v;
    const out = [];
    for (const ev of events) {
      const cur = conn().prepare('SELECT * FROM monthly_event_cursors WHERE user_id = ? AND event_id = ?').get(userId, ev.id);
      const ref = cur ? J(cur.ref_counts, {}) : null;
      const delta = {};
      let total = 0;
      if (ref) for (const [id, v] of Object.entries(counts)) { const d = v - (ref[id] ?? 0); if (d > 0) { delta[id] = d; total += d; } }
      conn().prepare(`INSERT INTO monthly_event_cursors (user_id, event_id, ref_counts, blocks) VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id, event_id) DO UPDATE SET ref_counts = excluded.ref_counts, blocks = blocks + excluded.blocks, updated_at = datetime('now')`)
        .run(userId, ev.id, JSON.stringify(counts), total);
      if (!total || total > MAX_BLOCKS_PER_SAVE) {
        if (total > MAX_BLOCKS_PER_SAVE) _log(ev.id, 'skip_burst', { userId, blocks: total });
        continue;
      }
      const owned = new Set(conn().prepare('SELECT item_id FROM monthly_event_finds WHERE user_id = ? AND event_id = ?').all(userId, ev.id).map(r => r.item_id));
      for (const it of ev.items) {
        if (!it.enabled || owned.has(it.id) || depth < it.minDepth) continue;
        let n = 0;
        for (const [id, d] of Object.entries(delta)) if (!it.dropFrom.length || it.dropFrom.includes(catOf.get(id))) n += d;
        if (!n) continue;
        const pAny = 1 - Math.pow(1 - it.chancePct / 100, n);
        if (rand() >= pAny) continue;
        const r = conn().prepare('INSERT OR IGNORE INTO monthly_event_finds (user_id, event_id, item_id, found_at, depth) VALUES (?,?,?,?,?)')
          .run(userId, ev.id, it.id, _iso(nowMs), depth);
        if (r.changes) out.push({ eventId: ev.id, itemId: it.id, icon: it.icon, image: it.image, names: it.names, rarity: it.rarity, eventNames: ev.names });
      }
    }
    return out;
  });
}

// ── Vue joueur ────────────────────────────────────────────────────────────────

/**
 * Événements en cours (objets : trouvé ou « ? »), à venir (publics, annoncés J-7) et souvenirs
 * de TOUS les événements (y compris terminés ou repassés en brouillon).
 */
function publicView(userId = null, nowMs = Date.now()) {
  const finds = userId ? conn().prepare('SELECT event_id, item_id, found_at FROM monthly_event_finds WHERE user_id = ? ORDER BY found_at').all(userId) : [];
  const foundAt = new Map(finds.map(f => [`${f.event_id}/${f.item_id}`, f.found_at]));
  const itemView = (ev, it) => {
    const at = foundAt.get(`${ev.id}/${it.id}`) ?? null;
    return at ? { id: it.id, found: true, foundAt: at, icon: it.icon, image: it.image, names: it.names, descs: it.descs, rarity: it.rarity }
      : { id: it.id, found: false, rarity: it.rarity };
  };
  const active = activeFor(userId, nowMs).map(ev => ({ id: ev.id, icon: ev.icon, names: ev.names, taglines: ev.taglines, startsAt: ev.startsAt,
    endsAt: ev.endsAt, test: ev.audience === 'test', items: ev.items.filter(i => i.enabled || foundAt.has(`${ev.id}/${i.id}`)).map(i => itemView(ev, i)) }));
  const activeIds = new Set(active.map(e => e.id));
  const upcoming = conn().prepare("SELECT * FROM monthly_events WHERE status = 'scheduled' AND audience = 'public' AND starts_at > ? AND starts_at <= ? ORDER BY starts_at")
    .all(_iso(nowMs), _iso(nowMs + ANNOUNCE_DAYS * 86_400_000)).map(r => _eventRow(r, nowMs))
    .map(ev => ({ id: ev.id, icon: ev.icon, names: ev.names, taglines: ev.taglines, startsAt: ev.startsAt, endsAt: ev.endsAt, count: ev.items.filter(i => i.enabled).length }));
  const souvenirs = [];
  for (const evId of [...new Set(finds.map(f => f.event_id))]) {
    if (activeIds.has(evId)) continue;
    const ev = getEvent(evId, nowMs);
    if (!ev) continue;
    souvenirs.push({ id: ev.id, icon: ev.icon, names: ev.names, endsAt: ev.endsAt,
      items: ev.items.filter(i => foundAt.has(`${ev.id}/${i.id}`)).map(i => itemView(ev, i)) });
  }
  return { active, upcoming, souvenirs };
}

// ── Simulation ────────────────────────────────────────────────────────────────

/** Part des blocs d'une catégorie à une profondeur donnée (poids du catalogue publié, atténuation comprise). */
function categoryShare(depth) {
  const types = require('./blockCatalog').getPublished().types.filter(t => (t.minDepth ?? 0) <= depth);
  const w = t => (t.fadeFrom != null && depth >= t.fadeFrom ? (t.fadeWeight ?? t.weight) : t.weight) || 0;
  const total = types.reduce((s, t) => s + w(t), 0) || 1;
  const share = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
  for (const t of types) share[t.category] = (share[t.category] ?? 0) + w(t) / total;
  return share;
}

/**
 * Pour chaque objet, à une profondeur donnée : blocs nécessaires en moyenne / médiane, et chance
 * de l'obtenir pour un joueur qui mine `blocksPerDay` blocs validés pendant toute la durée.
 */
function simulate(input, { depth = 50, blocksPerDay = 300 } = {}) {
  const ev = input.items ? { ...input, items: input.items.map((it, i) => normalizeItem(it, `Objet ${i + 1}`)) } : input;
  const days = Math.max(0, (Date.parse(ev.endsAt) - Date.parse(ev.startsAt)) / 86_400_000) || 0;
  const share = categoryShare(depth);
  return {
    depth, blocksPerDay, days: Math.round(days * 10) / 10,
    items: ev.items.map(it => {
      const elig = depth < it.minDepth ? 0 : (it.dropFrom.length ? it.dropFrom.reduce((s, c) => s + (share[c] || 0), 0) : 1);
      const p = (it.chancePct / 100) * elig;
      const blocks = Math.round(blocksPerDay * days);
      return { id: it.id, name: it.names.fr, eligibleShare: Math.round(elig * 1000) / 1000, perBlock: p,
        meanBlocks: p > 0 ? Math.round(1 / p) : null, medianBlocks: p > 0 ? Math.round(Math.log(2) / -Math.log1p(-p)) : null,
        chanceOverEvent: p > 0 ? Math.round((1 - Math.pow(1 - p, blocks)) * 1000) / 10 : 0 };
    }),
  };
}

function stats(id) {
  const rows = conn().prepare('SELECT item_id, COUNT(*) AS n FROM monthly_event_finds WHERE event_id = ? GROUP BY item_id').all(id);
  const players = conn().prepare('SELECT COUNT(*) AS n FROM monthly_event_cursors WHERE event_id = ?').get(id).n;
  return { players, finds: Object.fromEntries(rows.map(r => [r.item_id, r.n])) };
}

// ── Calendrier proposé ────────────────────────────────────────────────────────

function _easter(y) {   // algorithme grégorien anonyme
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

// Nouvel An chinois (dates publiées, aucun calcul astronomique ici)
const CHINESE_NEW_YEAR = { 2026: '02-17', 2027: '02-06', 2028: '01-26', 2029: '02-13', 2030: '02-03', 2031: '01-23', 2032: '02-11' };

const _d = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const _ymd = dt => dt.toISOString().slice(0, 10);
const _add = (dt, days) => new Date(dt.getTime() + days * 86_400_000);

/** Fêtes de l'année : { key, month, date, fr, window: [début, fin[ par défaut } */
function holidays(y) {
  const easter = _easter(y);
  const mardiGras = _add(easter, -47);
  const list = [
    { key: 'nouvel_an', fr: 'Nouvel An', date: _d(y, 1, 1), window: [_d(y, 1, 1), _d(y, 1, 15)] },
    { key: 'carnaval', fr: 'Carnaval (Mardi gras)', date: mardiGras, window: [_add(mardiGras, -12), _add(mardiGras, 2)] },
    { key: 'saint_valentin', fr: 'Saint-Valentin', date: _d(y, 2, 14), window: [_d(y, 2, 7), _d(y, 2, 16)] },
    { key: 'paques', fr: 'Pâques', date: easter, window: [_add(easter, -10), _add(easter, 2)] },
    { key: 'poisson_avril', fr: 'Poisson d\'avril', date: _d(y, 4, 1), window: [_d(y, 4, 1), _d(y, 4, 3)] },
    { key: 'fete_musique', fr: 'Fête de la musique', date: _d(y, 6, 21), window: [_d(y, 6, 14), _d(y, 6, 23)] },
    { key: 'fete_nationale', fr: 'Fête nationale belge', date: _d(y, 7, 21), window: [_d(y, 7, 14), _d(y, 7, 23)] },
    { key: 'rentree', fr: 'Rentrée', date: _d(y, 9, 1), window: [_d(y, 8, 28), _d(y, 9, 12)] },
    { key: 'halloween', fr: 'Halloween', date: _d(y, 10, 31), window: [_d(y, 10, 17), _d(y, 11, 3)] },
    { key: 'saint_nicolas', fr: 'Saint-Nicolas', date: _d(y, 12, 6), window: [_d(y, 11, 29), _d(y, 12, 8)] },
    { key: 'noel', fr: 'Noël', date: _d(y, 12, 25), window: [_d(y, 12, 1), _d(y + 1, 1, 1)] },
  ];
  if (CHINESE_NEW_YEAR[y]) {
    const cny = new Date(`${y}-${CHINESE_NEW_YEAR[y]}T00:00:00Z`);
    list.push({ key: 'nouvel_an_chinois', fr: 'Nouvel An chinois', date: cny, window: [_add(cny, -5), _add(cny, 9)] });
  }
  return list.map(h => ({ ...h, month: h.date.getUTCMonth() + 1 })).sort((a, b) => a.date - b.date);
}

// Fête retenue en priorité pour un mois qui en compte plusieurs (les autres restent des alternatives)
const PRIORITY = ['noel', 'halloween', 'paques', 'carnaval', 'nouvel_an_chinois', 'nouvel_an', 'fete_nationale', 'fete_musique', 'rentree', 'saint_valentin', 'saint_nicolas', 'poisson_avril'];
// Mois sans grande fête : idées à valider, jamais imposées
const IDEAS = {
  5: ['Fossiles et dinosaures', 'Jardin souterrain en fleurs'], 6: ['Fête de la musique souterraine'],
  8: ['Nuit des étoiles filantes (Perséides)', 'Trésor des pirates'], 9: ['Rentrée des mineurs', 'Champignons des bois'],
  11: ['Brouillard et lanternes', 'Mines englouties'],
};

/**
 * Calendrier de l'année : une proposition par mois, avec l'événement existant qui la couvre,
 * l'échéance de préparation (début − 21 j) et l'annonce (début − 7 j).
 */
function proposeCalendar(year, nowMs = Date.now()) {
  const hs = holidays(year);
  const events = listEvents(nowMs);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const inMonth = hs.filter(h => h.month === m).sort((a, b) => PRIORITY.indexOf(a.key) - PRIORITY.indexOf(b.key));
    const main = inMonth[0] ?? null;
    const pad = n => String(n).padStart(2, '0');   // bornes du mois en heure de Bruxelles
    const monthStart = Date.parse(brusselsToUtc(`${year}-${pad(m)}-01T00:00`));
    const monthEnd = Date.parse(brusselsToUtc(m === 12 ? `${year + 1}-01-01T00:00` : `${year}-${pad(m + 1)}-01T00:00`));
    const covering = events.filter(e => Date.parse(e.startsAt) < monthEnd && Date.parse(e.endsAt) > monthStart)
      .map(e => ({ id: e.id, icon: e.icon, name: e.names.fr, state: e.state, audience: e.audience }));
    const start = main ? main.window[0] : null;
    months.push({
      month: m, year,
      holiday: main ? { key: main.key, name: main.fr, date: _ymd(main.date) } : null,
      alternatives: inMonth.slice(1).map(h => ({ key: h.key, name: h.fr, date: _ymd(h.date) })),
      ideas: main ? [] : (IDEAS[m] ?? ['Thème original à choisir']),
      suggested: main ? { startsAt: `${_ymd(main.window[0])}T00:00`, endsAt: `${_ymd(main.window[1])}T00:00` } : null,
      prepareBy: start ? _ymd(_add(start, -PREP_DAYS)) : null,
      announceAt: start ? _ymd(_add(start, -ANNOUNCE_DAYS)) : null,
      late: start ? nowMs > _add(start, -PREP_DAYS).getTime() && !covering.length : false,
      events: covering,
    });
  }
  return { year, timezone: TZ, prepDays: PREP_DAYS, announceDays: ANNOUNCE_DAYS, months };
}

// ── Événement TEST (gabarit) ──────────────────────────────────────────────────

/**
 * Gabarit d'un événement TEST non public : 3 objets à probabilités FORTES (test uniquement),
 * réservé aux comptes donnés, de `minutes` minutes à partir de maintenant. Créé en brouillon.
 */
function createTestEvent({ testers = [], minutes = 120, nowMs = Date.now() } = {}) {
  const stamp = new Date(nowMs).toISOString().replace(/\D/g, '').slice(2, 12);
  const dur = Math.min(Math.max(Number(minutes) || 120, 10), 7 * 24 * 60);
  const tx = (fr, en, nl, es) => ({ fr, en, nl, es });
  return createEvent({
    id: `test_${stamp}`, icon: '🧪', audience: 'test', testers,
    names: tx('Événement test', 'Test event', 'Testevenement', 'Evento de prueba'),
    taglines: tx('Réservé aux testeurs : probabilités augmentées.', 'Testers only: boosted odds.', 'Alleen voor testers: verhoogde kansen.', 'Solo para testers: probabilidades aumentadas.'),
    startsAt: _iso(nowMs), endsAt: _iso(nowMs + dur * 60_000),
    items: [
      { id: 'test_caillou', icon: '🪨', rarity: 'commun', chancePct: 25, minDepth: 0, dropFrom: [],
        names: tx('Caillou de test', 'Test pebble', 'Testkiezel', 'Guijarro de prueba'),
        descs: tx('Il ne sert à rien, et c\'est justement ce qu\'on teste.', 'It does nothing, which is exactly what we are testing.', 'Het doet niets, en dat is precies wat we testen.', 'No sirve para nada, y eso es justo lo que probamos.') },
      { id: 'test_boulon', icon: '🔩', rarity: 'rare', chancePct: 10, minDepth: 0, dropFrom: ['pierre', 'minerai'],
        names: tx('Boulon de test', 'Test bolt', 'Testbout', 'Tornillo de prueba'),
        descs: tx('Tombe seulement de la pierre ou du minerai.', 'Only drops from stone or ore.', 'Valt alleen uit steen of erts.', 'Solo cae de piedra o mineral.') },
      { id: 'test_ticket', icon: '🎟️', rarity: 'epique', chancePct: 40, minDepth: 0, dropFrom: ['coffre'],
        names: tx('Ticket de test', 'Test ticket', 'Testticket', 'Billete de prueba'),
        descs: tx('Tombe seulement d\'un coffre.', 'Only drops from a chest.', 'Valt alleen uit een kist.', 'Solo cae de un cofre.') },
    ],
  }, { source: 'test' });
}

// ── Contenu préparé (une seule fois, en brouillon) ────────────────────────────

function importPrepared(dir = CONTENT_DIR) {
  if (!fs.existsSync(dir)) return [];
  const done = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    const key = `prepared:${f}`;
    if (conn().prepare('SELECT 1 FROM monthly_event_meta WHERE key = ?').get(key)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.runTransaction(() => {
        if (!conn().prepare('SELECT 1 FROM monthly_events WHERE id = ?').get(raw.id)) createEvent(raw, { source: 'prepared' });
        conn().prepare('INSERT INTO monthly_event_meta (key, value) VALUES (?, ?)').run(key, new Date().toISOString());
      });
      done.push(raw.id);
      console.log(`[events] événement préparé « ${raw.id} » ajouté en brouillon (${f})`);
    } catch (err) {
      console.error(`[events] import de ${f} impossible :`, err.message);
    }
  }
  return done;
}

// ── IA : proposition de thème, objets et traductions ─────────────────────────

const _jobs = new Map();
const INTERRUPTED = 'Génération interrompue (redémarrage du serveur) : relancez-la.';

function _aiSchema() {
  const str = { type: 'string' };
  const texts = { type: 'object', additionalProperties: false, required: LANGS, properties: Object.fromEntries(LANGS.map(l => [l, str])) };
  return {
    type: 'object', additionalProperties: false, required: ['id', 'icon', 'names', 'taglines', 'items', 'review'],
    properties: {
      id: str, icon: str, names: texts, taglines: texts, review: str,
      items: { type: 'array', items: { type: 'object', additionalProperties: false,
        required: ['id', 'icon', 'names', 'descs', 'rarity', 'brief', 'dropFrom'],
        properties: { id: str, icon: str, names: texts, descs: texts, brief: str, rarity: { type: 'string', enum: RARITIES },
          dropFrom: { type: 'array', items: { type: 'string', enum: CATEGORIES } } } } },
    },
  };
}

function _aiMessages(concept, count) {
  const langs = LANGS.map(l => `${l} (${LANG_LABELS[l]})`).join(', ');
  const system = [
    'You design a limited-time monthly EVENT for DIG!, an idle clicker mining game for all ages: players dig blocks (dirt, stone, ore, chests, gems) and may unearth exclusive collectible souvenirs.',
    `Create ${count} collectible items fitting the theme given by the admin. Items are absurd but recognisable, rooted in the folklore, traditions, songs or pop culture of the theme; each item has its OWN joke and a different silhouette.`,
    'Real facts only if true; any invented anecdote is told as a legend ("it is said that…"). Protected works are only evoked, never named or copied; no brands, no living people.',
    `Write every text natively and idiomatically in ${langs}. names: max 40 chars. descs: 1-2 funny sentences, max 260 chars. taglines: one sentence announcing the event, max 160 chars.`,
    'brief: concrete English image prompt for ONE game icon of the item (shape, material, colours, one funny detail), no text in the image.',
    'rarity: spread from commun to legendaire (one rarest item). dropFrom: block categories where it is buried (empty = any).',
    'id: lowercase snake_case, 3-40 chars, starting with a letter; item ids prefixed by the event id. icon: exactly one emoji.',
    'review: one short French paragraph reviewing variety, humour and any sensitive reference.',
  ];
  return [{ role: 'system', content: system.join('\n') }, { role: 'user', content: `Theme / brief from the admin:\n${concept}` }];
}

function _aiFake(concept) {
  const tx = s => ({ fr: s, en: s, nl: s, es: s });
  return { id: 'ia_test', icon: '🎉', names: tx(`Test IA : ${concept.slice(0, 30)}`), taglines: tx('Proposition de test.'), review: 'Proposition de test : aucune IA appelée.',
    items: [1, 2, 3].map(i => ({ id: `ia_test_obj${i}`, icon: '🎁', names: tx(`Objet ${i}`), descs: tx(`Description ${i}.`), brief: `test item ${i}`, rarity: RARITIES[i], dropFrom: [] })) };
}

/** Rend un identifiant libre : base, base_2, base_3… */
function _freeId(base) {
  let id = ID_RE.test(base) ? base : 'evenement_ia';
  for (let n = 2; conn().prepare('SELECT 1 FROM monthly_events WHERE id = ?').get(id); n++) id = `${base.slice(0, 36)}_${n}`;
  return id;
}

const DEFAULT_CHANCE = { commun: 1, 'peu-commun': 0.6, rare: 0.3, epique: 0.15, legendaire: 0.05 };

/**
 * Lance une proposition IA (arrière-plan). Résultat : un événement TEST en brouillon, dates
 * proposées (`startsAt`/`endsAt`, heure de Bruxelles), barème par défaut selon la rareté.
 */
function startAiDraft({ concept, startsAt, endsAt, itemCount = 4 } = {}) {
  const text = _str(concept, MAX.concept);
  if (text.length < 5) throw new EventError(400, 'Décrivez le thème (5 à 600 caractères).');
  const s = _date(startsAt, 'Début'), e = _date(endsAt, 'Fin');
  const count = Math.min(Math.max(Number(itemCount) || 4, 2), 8);
  const blockAi = require('./blockAi');
  try { blockAi.precheckText(); } catch (err) { throw new EventError(err.status ?? 503, err.message); }
  const id = conn().prepare('INSERT INTO monthly_event_ai (concept) VALUES (?)').run(text).lastInsertRowid;
  const job = (async () => {
    try {
      const out = await blockAi.guardedJson({ kind: 'event-text', source: 'admin-events', name: 'dig_event', schema: _aiSchema(),
        messages: _aiMessages(text, count), fake: () => _aiFake(text) });
      const r = out.data ?? {};
      const evId = _freeId(String(r.id ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 30));
      const seen = new Set();
      const items = (Array.isArray(r.items) ? r.items : []).slice(0, count).map((it, i) => {
        let iid = String(it.id ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z]+/, '').slice(0, 40);
        if (!ID_RE.test(iid) || seen.has(iid)) iid = `${evId.slice(0, 30)}_obj${i + 1}`;
        seen.add(iid);
        const rarity = RARITIES.includes(it.rarity) ? it.rarity : 'commun';
        return { id: iid, icon: it.icon, names: it.names, descs: it.descs, brief: it.brief, rarity, chancePct: DEFAULT_CHANCE[rarity],
          minDepth: 0, dropFrom: Array.isArray(it.dropFrom) ? it.dropFrom.filter(c => CATEGORIES.includes(c)) : [], enabled: true };
      });
      const ev = createEvent({ id: evId, icon: r.icon, names: r.names, taglines: r.taglines, startsAt: s, endsAt: e, audience: 'test', testers: [], items }, { source: 'ai' });
      _log(ev.id, 'ai_review', { review: _str(r.review, 600) });
      conn().prepare("UPDATE monthly_event_ai SET status = 'done', event_id = ?, updated_at = datetime('now') WHERE id = ?").run(ev.id, id);
    } catch (err) {
      conn().prepare("UPDATE monthly_event_ai SET status = 'error', error = ?, updated_at = datetime('now') WHERE id = ?").run(String(err.message || err).slice(0, 400), id);
      throw err;
    } finally {
      _jobs.delete(id);
    }
  })();
  _jobs.set(id, job);
  job.catch(() => { /* état « error » enregistré */ });
  return { job: getAiJob(id), promise: job };
}

function getAiJob(id) {
  const r = conn().prepare('SELECT * FROM monthly_event_ai WHERE id = ?').get(id);
  if (!r) return null;
  const interrupted = r.status === 'pending' && !_jobs.has(r.id);
  return { id: r.id, concept: r.concept, status: interrupted ? 'error' : r.status, error: interrupted ? INTERRUPTED : r.error, eventId: r.event_id, createdAt: r.created_at };
}

function listAiJobs(limit = 5) {
  return conn().prepare('SELECT id FROM monthly_event_ai ORDER BY id DESC LIMIT ?').all(limit).map(r => getAiJob(r.id));
}

// ── Admin : vue d'ensemble ────────────────────────────────────────────────────

function adminView(nowMs = Date.now()) {
  const events = listEvents(nowMs).map(ev => ({ ...ev, startsLocal: utcToBrussels(ev.startsAt), endsLocal: utcToBrussels(ev.endsAt),
    readiness: readiness(ev), stats: stats(ev.id) }));
  const y = new Date(nowMs).getUTCFullYear();
  return { timezone: TZ, rarities: RARITIES, categories: CATEGORIES, langs: LANGS, events,
    calendar: [proposeCalendar(y, nowMs), proposeCalendar(y + 1, nowMs)], ai: listAiJobs(), log: listLog(60) };
}

module.exports = {
  EventError, LANGS, RARITIES, CATEGORIES, init, brusselsToUtc, utcToBrussels, normalizeEvent, readiness, stateOf,
  getEvent, listEvents, createEvent, updateEvent, scheduleEvent, unscheduleEvent, listRevisions, restoreRevision, listLog,
  activeFor, processSave, publicView, categoryShare, simulate, stats, holidays, proposeCalendar, createTestEvent, importPrepared,
  startAiDraft, getAiJob, listAiJobs, adminView, MAX_BLOCKS_PER_SAVE,
};
