/**
 * server/relicCatalog.js — Catalogue de reliques administrable (#64, étape A).
 *
 * Même principe que le catalogue de blocs (#37) :
 *   - versions publiées en ajout seul (`relic_catalog_versions`) ; la version 1 est la conversion à
 *     l'identique des six reliques d'origine, relues dans public/js/relics.js (coûts, niveaux,
 *     effets) et public/js/i18n.js (noms et descriptions FR/EN/NL/ES) : aucune valeur modifiée ;
 *   - un brouillon unique (`relic_catalog_draft`), validé côté serveur, comparé à la version en
 *     vigueur puis publié explicitement ; journal `relic_catalog_audit` en ajout seul ;
 *   - une relique publiée n'est jamais supprimée (les sauvegardes y font référence) : elle
 *     s'archive. Une relique archivée ne se débloque ni ne s'améliore plus, mais ses détenteurs
 *     gardent leur niveau ET son bonus (aucune perte de progression) ;
 *   - seuls les six effets réellement calculés par le moteur sont proposés, avec des bornes qui
 *     respectent le budget anti-bot (#25 : dégâts/clic, dégâts auto, réduction de PV) ;
 *   - le nombre de niveaux ne peut pas baisser (niveaux déjà possédés par des joueurs).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const db = require('./db');

const LANGS = [...require('./languages').CONTENT_LANGS];   // registre des langues (#59)
const MAX_RELICS = 40;
const MAX_LEVEL = 10;
const COST_MAX = 100_000;
const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
const IMAGE_RE = /^\/media\/icons\/[a-f0-9]{16}\.webp$/;

/**
 * Effets réellement appliqués par le moteur (public/js/relics.js → applyBonuses) : chaque type
 * documente son calcul, ses bornes par niveau et, le cas échéant, le plafond total (somme des
 * reliques actives ou archivées de ce type au niveau maximum) imposé par l'anti-bot (#25).
 */
const EFFECTS = {
  damage_flat: {
    label: 'Dégâts par clic', unit: 'dégâts', integer: true, min: 1, max: 10, totalMax: 10,
    formula: 'Dégâts d\'un clic = niveau de pioche + somme des bonus « dégâts par clic ».',
    antibot: 'Plafond anti-bot #25 : pioche 15 + 10 = 25 dégâts par clic au maximum.',
  },
  coins_pct: {
    label: 'Pièces gagnées', unit: '%', pct: true, min: 0.01, max: 5,
    formula: 'Pièces d\'un bloc × (1 + 0,3 × Sac) × (1 + somme des bonus « pièces »).',
  },
  relic_fragment_bonus: {
    label: 'Fragments des coffres', unit: 'fragments', integer: true, min: 1, max: 20, onlyId: 'shard_magnet',
    formula: 'Fragments d\'un coffre = fragments tirés + bonus (calcul serveur pour la boutique de coffres).',
    antibot: 'Réservé à l\'Aimant à éclats : le serveur calcule ce bonus à partir de son seul niveau.',
  },
  luck_pct: {
    label: 'Chance / blocs rares', unit: '%', pct: true, min: 0.01, max: 5,
    formula: 'Poids des blocs rares, épiques et légendaires × (1 + 0,10 × Chance + somme des bonus « Chance »).',
  },
  hp_reduction: {
    label: 'PV des blocs', unit: '%', pct: true, min: 0.01, max: 0.5, totalMax: 0.5,
    formula: 'PV d\'un bloc × (1 − somme des réductions), réduction totale plafonnée à 90 % par le moteur.',
    antibot: 'Plafond anti-bot #25 : 50 % de réduction au maximum.',
  },
  autodig_bonus: {
    label: 'Auto-dig', unit: 'dégâts/s', integer: true, min: 1, max: 14, totalMax: 14,
    formula: 'Dégâts automatiques par seconde = niveau d\'Auto-Dig + somme des bonus « auto-dig ».',
    antibot: 'Plafond anti-bot #25 : Auto-Dig 6 + 14 = 20 dégâts/s au maximum.',
  },
};

/** Règle d'obtention appliquée par le moteur (documentée, non paramétrable à cette étape). */
const OBTAIN_RULE = 'Déblocage puis amélioration contre des fragments de relique (coffres minés et boutique de coffres). Les reliques sont permanentes : jamais remises à zéro par les saisons.';

class CatalogError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Catalogue d'origine ───────────────────────────────────────────────────────

let _origin = null;

function _load(file, name) {
  const ctx = { window: {}, navigator: { language: 'fr' } };
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(__dirname, '..', 'public', 'js', file), 'utf8')}\n;this.${name} = ${name};`, ctx);
  return ctx[name];
}

/** Les six reliques d'origine, au format catalogue (valeurs identiques au jeu). */
function originRelics() {
  if (!_origin) {
    const Relics = _load('relics.js', 'Relics');
    const I18n = _load('i18n.js', 'I18n');
    const texts = (key) => Object.fromEntries(LANGS.map(l => [l, I18n.get(key, l) ?? '']));
    _origin = Relics.DEFS.map(d => ({
      id: d.id,
      active: true,
      icon: d.icon,
      image: null,
      names: texts(d.name),
      descs: texts(d.desc),
      maxLevel: d.maxLevel,
      costs: [...d.costs],
      effect: d.bonus.type,
      values: [...d.bonus.values],
    }));
  }
  return JSON.parse(JSON.stringify(_origin));
}

// ── Schéma ────────────────────────────────────────────────────────────────────

/** Tables (ajout seul) et version 1 = catalogue d'origine. Idempotent. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS relic_catalog_versions (
      version      INTEGER PRIMARY KEY,
      relics       TEXT    NOT NULL,
      source       TEXT    NOT NULL CHECK (source IN ('origin', 'publish', 'rollback')),
      note         TEXT,
      from_version INTEGER,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS relic_catalog_draft (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      relics      TEXT    NOT NULL,
      based_on    INTEGER NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS relic_catalog_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      action      TEXT    NOT NULL,
      version     INTEGER,
      details     TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_relic_catalog_versions_no_update BEFORE UPDATE ON relic_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'relic_catalog_versions est en ajout seul (#64)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_relic_catalog_versions_no_delete BEFORE DELETE ON relic_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'relic_catalog_versions est en ajout seul (#64)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_relic_catalog_audit_no_update BEFORE UPDATE ON relic_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'relic_catalog_audit est en ajout seul (#64)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_relic_catalog_audit_no_delete BEFORE DELETE ON relic_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'relic_catalog_audit est en ajout seul (#64)'); END;
  `);
  conn().transaction(() => {
    if (conn().prepare('SELECT 1 FROM relic_catalog_versions LIMIT 1').get()) return;
    conn().prepare("INSERT INTO relic_catalog_versions (version, relics, source, note) VALUES (1, ?, 'origin', ?)")
      .run(JSON.stringify(originRelics()), 'Conversion à l\'identique des six reliques d\'origine (#64)');
    _audit('migrate', 1, { relics: originRelics().length });
  })();
  _invalidate();
}

function _audit(action, version, details) {
  conn().prepare('INSERT INTO relic_catalog_audit (action, version, details) VALUES (?, ?, ?)')
    .run(action, version, details == null ? null : JSON.stringify(details));
}

// ── Lecture ───────────────────────────────────────────────────────────────────

let _published = null;
let _ready = false;
function _invalidate() { _published = null; _ready = true; }

function _row(r) {
  return r ? { version: r.version, relics: JSON.parse(r.relics), source: r.source, note: r.note, fromVersion: r.from_version, createdAt: r.created_at } : null;
}

function getPublished() {
  if (!_published) _published = _row(conn().prepare('SELECT * FROM relic_catalog_versions ORDER BY version DESC LIMIT 1').get());
  return _published ?? { version: 0, relics: originRelics(), source: 'origin' };
}

function getVersion(version) {
  return _row(conn().prepare('SELECT * FROM relic_catalog_versions WHERE version = ?').get(Number(version)));
}

function listVersions() {
  return conn().prepare('SELECT version, source, note, from_version AS fromVersion, created_at AS createdAt FROM relic_catalog_versions ORDER BY version DESC').all();
}

function getDraft() {
  const r = conn().prepare('SELECT * FROM relic_catalog_draft WHERE id = 1').get();
  return r ? { relics: JSON.parse(r.relics), basedOn: r.based_on, updatedAt: r.updated_at } : null;
}

function publishedIds() {
  const ids = new Set();
  for (const r of conn().prepare('SELECT relics FROM relic_catalog_versions').all()) for (const x of JSON.parse(r.relics)) ids.add(x.id);
  return ids;
}

/** Niveau maximum publié par relique (toutes versions) : le nombre de niveaux ne peut pas baisser. */
function _publishedMaxLevels() {
  const max = new Map();
  for (const r of conn().prepare('SELECT relics FROM relic_catalog_versions').all()) {
    for (const x of JSON.parse(r.relics)) max.set(x.id, Math.max(max.get(x.id) ?? 0, x.maxLevel));
  }
  return max;
}

/** Catalogue public consommé par le jeu (GET /api/relics/catalog). */
function publicCatalog() {
  const p = getPublished();
  return { version: p.version, relics: p.relics };
}

/** Valeurs de l'Aimant à éclats en vigueur (calcul serveur des fragments de coffre). */
function shardMagnetValues() {
  if (!_ready) return null;   // catalogue non initialisé (tests unitaires sans base) : valeurs d'origine
  const r = getPublished().relics.find(x => x.id === 'shard_magnet' && x.effect === 'relic_fragment_bonus');
  return r ? [...r.values] : null;
}

// ── Validation ────────────────────────────────────────────────────────────────

const _round = (n) => Math.round(n * 10000) / 10000;

function _text(v, max) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }

/** Normalise une relique saisie ; lève CatalogError au premier défaut bloquant. */
function normalizeRelic(input) {
  if (!input || typeof input !== 'object') throw new CatalogError(400, 'Relique invalide.');
  const id = String(input.id ?? '').trim();
  if (!ID_RE.test(id)) throw new CatalogError(400, `Identifiant « ${id} » invalide (a-z, 0-9, _ ; 2 à 40 caractères).`);
  const where = `« ${id} »`;
  const effect = String(input.effect ?? '');
  const def = EFFECTS[effect];
  if (!def) throw new CatalogError(400, `${where} : effet inconnu.`);
  if (def.onlyId && def.onlyId !== id) throw new CatalogError(400, `${where} : l'effet « ${def.label} » est réservé à « ${def.onlyId} » (${def.antibot})`);
  const maxLevel = Number(input.maxLevel);
  if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > MAX_LEVEL) throw new CatalogError(400, `${where} : nombre de niveaux entier de 1 à ${MAX_LEVEL}.`);
  const costs = Array.isArray(input.costs) ? input.costs.map(Number) : [];
  const values = Array.isArray(input.values) ? input.values.map(Number) : [];
  if (costs.length !== maxLevel || values.length !== maxLevel) throw new CatalogError(400, `${where} : un coût et une valeur par niveau (${maxLevel}).`);
  costs.forEach((c, i) => {
    if (!Number.isInteger(c) || c < 1 || c > COST_MAX) throw new CatalogError(400, `${where} : coût du niveau ${i + 1} entier de 1 à ${COST_MAX}.`);
  });
  values.forEach((v, i) => {
    if (!Number.isFinite(v) || v < def.min || v > def.max || (def.integer && !Number.isInteger(v))) {
      const shown = def.pct ? `${def.min * 100} % à ${def.max * 100} %` : `${def.min} à ${def.max}`;
      throw new CatalogError(400, `${where} : bonus du niveau ${i + 1} ${def.integer ? 'entier ' : ''}de ${shown}.`);
    }
    if (i > 0 && v < values[i - 1]) throw new CatalogError(400, `${where} : le bonus total ne peut pas baisser d'un niveau au suivant (niveau ${i + 1}).`);
  });
  const names = {}, descs = {};
  for (const l of LANGS) {
    names[l] = _text(input.names?.[l], 40);
    descs[l] = _text(input.descs?.[l], 200);
  }
  if (!names.fr) throw new CatalogError(400, `${where} : nom français obligatoire.`);
  const icon = _text(input.icon, 8);
  if (!icon) throw new CatalogError(400, `${where} : icône (emoji) obligatoire, elle sert de repli à l'image.`);
  const image = input.image ? String(input.image) : null;
  if (image && !IMAGE_RE.test(image)) throw new CatalogError(400, `${where} : image invalide (atelier d'icônes uniquement).`);
  return {
    id, active: input.active !== false, icon, image, names, descs, maxLevel, costs,
    effect, values: values.map(v => (def.integer ? v : _round(v))),
  };
}

/**
 * Valide un catalogue complet (brouillon avant publication).
 * @returns {{ errors: string[], warnings: string[], relics: object[] }}
 */
function validateCatalog(raw, { requiredIds = publishedIds(), maxLevels = _publishedMaxLevels() } = {}) {
  const errors = [], warnings = [];
  if (!Array.isArray(raw) || !raw.length) return { errors: ['Catalogue vide.'], warnings, relics: [] };
  if (raw.length > MAX_RELICS) errors.push(`Au plus ${MAX_RELICS} reliques.`);
  const relics = [];
  const seen = new Set();
  for (const r of raw) {
    try {
      const x = normalizeRelic(r);
      if (seen.has(x.id)) { errors.push(`Identifiant « ${x.id} » en double.`); continue; }
      seen.add(x.id);
      relics.push(x);
    } catch (err) {
      if (!(err instanceof CatalogError)) throw err;
      errors.push(err.message);
    }
  }
  for (const id of requiredIds) {
    if (!seen.has(id)) errors.push(`« ${id} » est déjà publiée (sauvegardes) : elle ne peut pas être supprimée, seulement archivée.`);
  }
  for (const x of relics) {
    const prev = maxLevels.get(x.id);
    if (prev && x.maxLevel < prev) errors.push(`« ${x.id} » : ${prev} niveaux déjà publiés, le nombre de niveaux ne peut pas baisser.`);
    if (!x.active) warnings.push(`« ${x.id} » est archivée : plus de déblocage ni d'amélioration, les détenteurs gardent niveau et bonus.`);
    for (const l of LANGS) if (!x.names[l]) warnings.push(`« ${x.id} » : nom ${l.toUpperCase()} manquant (repli sur le français).`);
  }
  // Plafonds totaux (anti-bot #25) : toutes les reliques d'un même effet au niveau maximum.
  for (const [type, def] of Object.entries(EFFECTS)) {
    if (def.totalMax == null) continue;
    const total = _round(relics.filter(x => x.effect === type).reduce((s, x) => s + x.values[x.maxLevel - 1], 0));
    if (total > def.totalMax) {
      errors.push(`Effet « ${def.label} » : ${total} au total au niveau maximum, plafond ${def.totalMax} (${def.antibot}).`);
    }
  }
  return { errors, warnings, relics };
}

/** Écarts entre deux catalogues, champ par champ. */
function diff(from, to) {
  const before = new Map(from.map(x => [x.id, x]));
  const changes = [];
  for (const x of to) {
    const b = before.get(x.id);
    if (!b) { changes.push({ id: x.id, kind: 'added' }); continue; }
    const fields = Object.keys(x).filter(k => JSON.stringify(x[k] ?? null) !== JSON.stringify(b[k] ?? null))
      .map(k => ({ field: k, before: b[k] ?? null, after: x[k] ?? null }));
    if (fields.length) changes.push({ id: x.id, kind: 'changed', fields });
  }
  return changes;
}

/**
 * Détenteurs par relique et par niveau (sauvegardes cloud), pour mesurer l'impact d'une
 * modification. Lecture seule ; les anciennes sauvegardes (liste d'identifiants) comptent niveau 1.
 */
function holders() {
  const out = {};
  let saves = 0;
  for (const r of conn().prepare('SELECT data FROM user_saves').iterate()) {
    let data;
    try { data = JSON.parse(r.data); } catch (_) { continue; }
    saves++;
    const relics = data?.relics;
    const entries = Array.isArray(relics) ? relics.map(id => [id, 1]) : Object.entries(relics ?? {});
    for (const [id, lvl] of entries) {
      const level = Number(lvl);
      if (!Number.isInteger(level) || level < 1) continue;
      out[id] ??= {};
      out[id][level] = (out[id][level] ?? 0) + 1;
    }
  }
  return { saves, byRelic: out };
}

// ── Brouillon, publication, retour arrière ────────────────────────────────────

function _saveDraft(relics, basedOn) {
  conn().prepare(`INSERT INTO relic_catalog_draft (id, relics, based_on, updated_at) VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET relics = excluded.relics, based_on = excluded.based_on, updated_at = excluded.updated_at`)
    .run(JSON.stringify(relics), basedOn);
}

/** Brouillon identique à la version en vigueur : supprimé (aucun changement en attente). */
function _dropIfClean() {
  const draft = getDraft();
  const current = getPublished();
  if (!draft || draft.basedOn !== current.version || draft.relics.length !== current.relics.length) return false;
  if (diff(current.relics, draft.relics).length) return false;
  conn().prepare('DELETE FROM relic_catalog_draft WHERE id = 1').run();
  _audit('draft_clean', null, null);
  return true;
}

/** Ajoute ou modifie une relique dans le brouillon (créé depuis la version en vigueur si absent). */
function upsertDraftRelic(input) {
  const x = normalizeRelic(input);
  return conn().transaction(() => {
    const current = getPublished();
    // Copie : la version en vigueur est en cache et ne doit jamais être modifiée en place
    const draft = getDraft() ?? { relics: JSON.parse(JSON.stringify(current.relics)), basedOn: current.version };
    const i = draft.relics.findIndex(r => r.id === x.id);
    if (i < 0 && draft.relics.length >= MAX_RELICS) throw new CatalogError(400, `Au plus ${MAX_RELICS} reliques.`);
    const before = i >= 0 ? draft.relics[i] : null;
    if (i >= 0) draft.relics[i] = x; else draft.relics.push(x);
    _saveDraft(draft.relics, draft.basedOn);
    _audit(i >= 0 ? 'draft_update' : 'draft_add', null, { id: x.id, changes: before ? diff([before], [x])[0]?.fields ?? [] : null });
    const draftDropped = _dropIfClean();
    return { relic: x, draftDropped };
  })();
}

/** Remet UNE relique publiée à son état en vigueur dans le brouillon (rien n'est publié). */
function revertDraftRelic(id) {
  return conn().transaction(() => {
    const draft = getDraft();
    const pub = getPublished().relics.find(r => r.id === id);
    if (!pub) throw new CatalogError(409, `« ${id} » n'est pas dans la version en vigueur : retirez-la du brouillon.`);
    const i = draft ? draft.relics.findIndex(r => r.id === id) : -1;
    if (i < 0 || !diff([pub], [draft.relics[i]]).length) throw new CatalogError(409, `« ${id} » n'a aucune modification dans le brouillon.`);
    draft.relics[i] = pub;
    _saveDraft(draft.relics, draft.basedOn);
    _audit('draft_revert', null, { id });
    return { relic: pub, draftDropped: _dropIfClean() };
  })();
}

/** Retire du brouillon une relique jamais publiée. */
function removeDraftRelic(id) {
  return conn().transaction(() => {
    if (publishedIds().has(id)) throw new CatalogError(409, `« ${id} » est déjà publiée : archivez-la au lieu de la supprimer.`);
    const draft = getDraft();
    if (!draft || !draft.relics.some(r => r.id === id)) throw new CatalogError(404, 'Relique absente du brouillon.');
    _saveDraft(draft.relics.filter(r => r.id !== id), draft.basedOn);
    _audit('draft_remove', null, { id });
    _dropIfClean();
  })();
}

function discardDraft() {
  const r = conn().prepare('DELETE FROM relic_catalog_draft WHERE id = 1').run();
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
    const v = validateCatalog(draft.relics);
    if (v.errors.length) throw new CatalogError(400, 'Brouillon invalide.', v.errors);
    const changes = diff(current.relics, v.relics);
    if (!changes.length) throw new CatalogError(409, 'Aucun changement par rapport à la version en vigueur.');
    const version = current.version + 1;
    conn().prepare("INSERT INTO relic_catalog_versions (version, relics, source, note, from_version) VALUES (?, ?, 'publish', ?, ?)")
      .run(version, JSON.stringify(v.relics), _text(note, 300) || null, current.version);
    conn().prepare('DELETE FROM relic_catalog_draft WHERE id = 1').run();
    _audit('publish', version, { changes });
    return { version, changes, warnings: v.warnings };
  })();
  _invalidate();
  return result;
}

/**
 * Retour arrière : publie une NOUVELLE version reprenant une version antérieure. Les reliques
 * ajoutées depuis sont gardées mais archivées ; le nombre de niveaux ne baisse jamais (une
 * relique dont les niveaux ont été allongés garde ses niveaux actuels au-delà de l'ancienne fin).
 */
function rollbackTo(target, { note } = {}) {
  const result = conn().transaction(() => {
    const old = getVersion(target);
    if (!old) throw new CatalogError(404, 'Version introuvable.');
    const current = getPublished();
    if (old.version === current.version) throw new CatalogError(409, 'Cette version est déjà en vigueur.');
    const now = new Map(current.relics.map(x => [x.id, x]));
    const ids = new Set(old.relics.map(x => x.id));
    const relics = [
      ...old.relics.map(x => {
        const cur = now.get(x.id);
        if (!cur || cur.maxLevel <= x.maxLevel) return x;
        return { ...x, maxLevel: cur.maxLevel, costs: [...x.costs, ...cur.costs.slice(x.maxLevel)],
          values: [...x.values, ...cur.values.slice(x.maxLevel).map(v => Math.max(v, x.values[x.maxLevel - 1]))] };
      }),
      ...current.relics.filter(x => !ids.has(x.id)).map(x => ({ ...x, active: false })),
    ];
    const v = validateCatalog(relics);
    if (v.errors.length) throw new CatalogError(400, 'Retour arrière impossible.', v.errors);
    const version = current.version + 1;
    conn().prepare("INSERT INTO relic_catalog_versions (version, relics, source, note, from_version) VALUES (?, ?, 'rollback', ?, ?)")
      .run(version, JSON.stringify(v.relics), _text(note, 300) || `Retour à la version ${old.version}`, old.version);
    conn().prepare('DELETE FROM relic_catalog_draft WHERE id = 1').run();
    _audit('rollback', version, { to: old.version, changes: diff(current.relics, v.relics) });
    return { version, restored: old.version };
  })();
  _invalidate();
  return result;
}

function listAudit(limit = 100) {
  return conn().prepare('SELECT * FROM relic_catalog_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
}

/** Vue admin : version en vigueur, brouillon validé et ses écarts, versions, détenteurs, effets. */
function buildAdminView() {
  const published = getPublished();
  const draft = getDraft();
  const validation = draft ? validateCatalog(draft.relics) : null;
  const changes = draft ? diff(published.relics, validation.relics) : [];
  const pending = draft && (changes.length || draft.basedOn !== published.version || draft.relics.length !== published.relics.length);
  return {
    published,
    draft: pending ? { ...draft, errors: validation.errors, warnings: validation.warnings, changes } : null,
    publishedIds: [...publishedIds()],
    publishedMaxLevels: Object.fromEntries(_publishedMaxLevels()),
    versions: listVersions(),
    holders: holders(),
    effects: EFFECTS,
    obtainRule: OBTAIN_RULE,
    langs: LANGS,
    limits: { maxLevel: MAX_LEVEL, costMax: COST_MAX, maxRelics: MAX_RELICS },
  };
}

module.exports = {
  CatalogError, EFFECTS, LANGS, OBTAIN_RULE,
  init, originRelics, getPublished, getVersion, getDraft, listVersions, publicCatalog, publishedIds, shardMagnetValues,
  normalizeRelic, validateCatalog, diff, holders,
  upsertDraftRelic, revertDraftRelic, removeDraftRelic, discardDraft, publishDraft, rollbackTo, listAudit, buildAdminView,
};
