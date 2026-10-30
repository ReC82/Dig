/**
 * server/blockCatalog.js — Catalogue de blocs administrable (#37, étape A).
 *
 * Principes :
 *   - le catalogue publié est versionné : chaque publication (ou retour arrière) ajoute une
 *     version complète à `block_catalog_versions` (ajout seul) ; la version en vigueur est la
 *     plus récente. La version 1 est la conversion à l'identique des 14 blocs d'origine, relus
 *     directement dans public/js/blocks.js (aucune probabilité modifiée) ;
 *   - l'admin travaille sur un brouillon unique (`block_catalog_draft`), validé côté serveur,
 *     simulé (10 000 / 100 000 tirages) puis publié atomiquement ; journal `block_catalog_audit`
 *     en ajout seul ;
 *   - un type n'est jamais supprimé une fois publié (les sauvegardes y font référence) : il se
 *     désactive. Aucune profondeur maximale pour un nouveau type ; la borne des deux blocs de
 *     surface d'origine (terre meuble ≤ 12 m, argile ≤ 22 m) est conservée telle quelle comme
 *     « borne héritée » jusqu'à décision du propriétaire ;
 *   - le budget de dégâts anti-bot (#25) suit le catalogue : PV minimum par profondeur calculés
 *     sur TOUTES les versions publiées (jamais plus strict que l'origine, cf. antibot.js).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const db      = require('./db');
const antibot = require('./antibot');

const CATEGORIES = ['terre', 'pierre', 'minerai', 'coffre', 'gemme'];
const RARITIES   = ['commun', 'peu-commun', 'rare', 'epique', 'legendaire'];
const BOOSTED    = new Set(['rare', 'epique', 'legendaire']);
const LANGS      = ['fr', 'en', 'nl'];
const MAX_TYPES  = 200;
/** Mêmes constantes que public/js/blocks.js (Chance #32, PV et récompense par mètre). */
const LUCK_PER_LEVEL = 0.10;
const HP_SCALE_PER_M = 0.12;
const REWARD_SCALE_PER_M = 0.05;

const ID_RE     = /^[a-z][a-z0-9_]{1,39}$/;
const HEX_RE    = /^#[0-9a-fA-F]{3,8}$/;
const COLOR_RE  = /^(#[0-9a-fA-F]{3,8}|linear-gradient\(\d{1,3}deg,\s?#[0-9a-fA-F]{3,8},\s?#[0-9a-fA-F]{3,8}\))$/;
const IMAGE_RE  = /^\/assets\/[A-Za-z0-9_\-/.]+\.(webp|png|svg)$/;

class CatalogError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

const conn = () => db.getDb();

// ── Catalogue d'origine ───────────────────────────────────────────────────────

let _origin = null;

/** Les 14 blocs d'origine, lus dans public/js/blocks.js (source unique), au format catalogue. */
function originTypes() {
  if (_origin) return _origin.map(t => ({ ...t }));
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'blocks.js'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${code}\n;this.Blocks = Blocks;`, ctx);
  _origin = ctx.Blocks.TYPES.map(t => ({
    id: String(t.name).replace(/^block\./, ''),
    names: null,
    category: t.category,
    icon: t.icon,
    image: null,
    rarity: t.rarityKey,
    color: t.color,
    accent: t.accent,
    hpBase: t.hpBase,
    reward: t.reward,
    minDepth: t.minDepth,
    maxDepth: t.maxDepth ?? null,
    weight: t.weight,
    active: true,
  }));
  return _origin.map(t => ({ ...t }));
}

// ── Schéma et migration ───────────────────────────────────────────────────────

/** Tables (ajout seul) et version 1 = catalogue d'origine. Idempotent. */
function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS block_catalog_versions (
      version     INTEGER PRIMARY KEY,
      types       TEXT    NOT NULL,
      source      TEXT    NOT NULL CHECK (source IN ('origin', 'publish', 'rollback')),
      note        TEXT,
      from_version INTEGER,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS block_catalog_draft (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      types       TEXT    NOT NULL,
      based_on    INTEGER NOT NULL,
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS block_catalog_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      action      TEXT    NOT NULL,
      version     INTEGER,
      details     TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_block_catalog_versions_no_update BEFORE UPDATE ON block_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'block_catalog_versions est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_block_catalog_versions_no_delete BEFORE DELETE ON block_catalog_versions
      BEGIN SELECT RAISE(ABORT, 'block_catalog_versions est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_block_catalog_audit_no_update BEFORE UPDATE ON block_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'block_catalog_audit est en ajout seul (#37)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_block_catalog_audit_no_delete BEFORE DELETE ON block_catalog_audit
      BEGIN SELECT RAISE(ABORT, 'block_catalog_audit est en ajout seul (#37)'); END;
  `);
  conn().transaction(() => {
    if (conn().prepare('SELECT 1 FROM block_catalog_versions LIMIT 1').get()) return;
    conn().prepare("INSERT INTO block_catalog_versions (version, types, source, note) VALUES (1, ?, 'origin', ?)")
      .run(JSON.stringify(originTypes()), 'Conversion à l\'identique des 14 blocs d\'origine (#37)');
    _audit('migrate', 1, { types: originTypes().length });
  })();
  _invalidate();
  refreshAntibot();
}

function _audit(action, version, details) {
  conn().prepare('INSERT INTO block_catalog_audit (action, version, details) VALUES (?, ?, ?)')
    .run(action, version ?? null, details ? JSON.stringify(details) : null);
}

// ── Lecture ───────────────────────────────────────────────────────────────────

let _publishedCache = null;
function _invalidate() { _publishedCache = null; }

function _row(r) {
  return r && { version: r.version, types: JSON.parse(r.types), source: r.source, note: r.note,
    fromVersion: r.from_version, createdAt: r.created_at };
}

/** Version en vigueur { version, types, … }. */
function getPublished() {
  if (!_publishedCache) {
    _publishedCache = _row(conn().prepare('SELECT * FROM block_catalog_versions ORDER BY version DESC LIMIT 1').get());
  }
  return structuredClone(_publishedCache);
}

function getVersion(version) {
  return _row(conn().prepare('SELECT * FROM block_catalog_versions WHERE version = ?').get(version));
}

function listVersions(limit = 50) {
  return conn().prepare('SELECT version, source, note, from_version, created_at, types FROM block_catalog_versions ORDER BY version DESC LIMIT ?')
    .all(limit).map(r => {
      const types = JSON.parse(r.types);
      return { version: r.version, source: r.source, note: r.note, fromVersion: r.from_version, createdAt: r.created_at,
        types: types.length, active: types.filter(t => t.active).length };
    });
}

function getDraft() {
  const r = conn().prepare('SELECT * FROM block_catalog_draft WHERE id = 1').get();
  return r ? { types: JSON.parse(r.types), basedOn: r.based_on, updatedAt: r.updated_at } : null;
}

/** Catalogue public (jeu) : version en vigueur, types inactifs compris (reprise du bloc #35). */
function publicCatalog() {
  const p = getPublished();
  return { version: p.version, types: p.types };
}

/** Identifiants présents dans au moins une version publiée (jamais supprimables). */
function publishedIds() {
  const ids = new Set();
  for (const r of conn().prepare('SELECT types FROM block_catalog_versions').all()) {
    for (const t of JSON.parse(r.types)) ids.add(t.id);
  }
  return ids;
}

// ── Validation ────────────────────────────────────────────────────────────────

const _int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Normalise un type saisi (types et longueurs) ; lève CatalogError si un champ est invalide. */
function normalizeType(input, { legacyIds = new Set(originTypes().map(t => t.id)) } = {}) {
  if (!input || typeof input !== 'object') throw new CatalogError(400, 'Type de bloc manquant.');
  const id = String(input.id ?? '').trim();
  const where = `« ${id || '?'} »`;
  if (!ID_RE.test(id)) throw new CatalogError(400, `Identifiant ${where} invalide : 2 à 40 caractères a-z, 0-9, _, commençant par une lettre.`);

  let names = null;
  if (input.names && typeof input.names === 'object') {
    names = {};
    for (const l of LANGS) {
      const v = String(input.names[l] ?? '').trim().slice(0, 40);
      if (/[<>]/.test(v)) throw new CatalogError(400, `${where} : nom ${l} invalide.`);
      if (v) names[l] = v;
    }
    if (!Object.keys(names).length) names = null;
  }
  if (!legacyIds.has(id) && !names?.fr) throw new CatalogError(400, `${where} : nom FR obligatoire pour un nouveau bloc.`);

  const category = String(input.category ?? '');
  if (!CATEGORIES.includes(category)) throw new CatalogError(400, `${where} : catégorie invalide (${CATEGORIES.join(', ')}).`);
  const rarity = String(input.rarity ?? '');
  if (!RARITIES.includes(rarity)) throw new CatalogError(400, `${where} : rareté invalide (${RARITIES.join(', ')}).`);
  const icon = String(input.icon ?? '').trim();
  if (!icon || [...icon].length > 4 || /[<>&"'\s]/.test(icon)) throw new CatalogError(400, `${where} : icône (emoji, 1 à 4 caractères) invalide.`);
  const image = input.image ? String(input.image).trim() : null;
  if (image && (!IMAGE_RE.test(image) || image.includes('..'))) throw new CatalogError(400, `${where} : image attendue sous /assets/… (.webp, .png ou .svg).`);
  const color = String(input.color ?? '').trim();
  if (!COLOR_RE.test(color)) throw new CatalogError(400, `${where} : couleur invalide (#rrggbb ou linear-gradient(145deg,#…,#…)).`);
  const accent = String(input.accent ?? '').trim();
  if (!HEX_RE.test(accent)) throw new CatalogError(400, `${where} : couleur d'accent invalide (#rrggbb).`);

  const hpBase = Number(input.hpBase), reward = Number(input.reward), minDepth = Number(input.minDepth), weight = Number(input.weight);
  if (!_int(hpBase, 1, 1e6)) throw new CatalogError(400, `${where} : PV de base entier de 1 à 1 000 000.`);
  if (!_int(reward, 0, 1e9)) throw new CatalogError(400, `${where} : récompense entière de 0 à 1 000 000 000.`);
  if (!_int(minDepth, 1, 1e6)) throw new CatalogError(400, `${where} : profondeur minimale (dès X m) entière ≥ 1.`);
  if (!(Number.isFinite(weight) && weight > 0 && weight <= 1e6)) throw new CatalogError(400, `${where} : poids d'apparition > 0 requis (pour retirer un bloc, le désactiver).`);
  let maxDepth = input.maxDepth === null || input.maxDepth === undefined || input.maxDepth === '' ? null : Number(input.maxDepth);
  if (maxDepth !== null) {
    if (!legacyIds.has(id)) throw new CatalogError(400, `${where} : pas de profondeur maximale pour un nouveau bloc (#37).`);
    if (!_int(maxDepth, minDepth, 1e6)) throw new CatalogError(400, `${where} : borne héritée ≥ profondeur minimale.`);
  }
  return { id, names, category, icon, image, rarity, color, accent, hpBase, reward, minDepth, maxDepth,
    weight: Math.round(weight * 1000) / 1000, active: input.active !== false };
}

/** Points de rupture : profondeurs où le pool change. */
function _breakpoints(types) {
  const cuts = new Set([1]);
  for (const t of types) { cuts.add(t.minDepth); if (t.maxDepth != null) cuts.add(t.maxDepth + 1); }
  return [...cuts].sort((a, b) => a - b);
}

const _available = (t, d) => t.active && d >= t.minDepth && (t.maxDepth == null || d <= t.maxDepth);

/**
 * Valide un catalogue complet (brouillon avant publication).
 * @returns {{ errors: string[], warnings: string[], types: object[] }}
 */
function validateCatalog(rawTypes, { requiredIds = publishedIds() } = {}) {
  const errors = [], warnings = [];
  if (!Array.isArray(rawTypes) || !rawTypes.length) return { errors: ['Catalogue vide.'], warnings, types: [] };
  if (rawTypes.length > MAX_TYPES) errors.push(`Au plus ${MAX_TYPES} types de blocs.`);
  const types = [];
  const seen = new Set();
  for (const raw of rawTypes) {
    try {
      const t = normalizeType(raw);
      if (seen.has(t.id)) { errors.push(`Identifiant « ${t.id} » en double.`); continue; }
      seen.add(t.id);
      types.push(t);
    } catch (err) {
      if (!(err instanceof CatalogError)) throw err;
      errors.push(err.message);
    }
  }
  for (const id of requiredIds) {
    if (!seen.has(id)) errors.push(`« ${id} » est déjà publié (sauvegardes) : il ne peut pas être supprimé, seulement désactivé.`);
  }
  for (const d of _breakpoints(types)) {
    if (!types.some(t => _available(t, d))) errors.push(`Aucun bloc actif à ${d} m : chaque profondeur doit avoir au moins un bloc.`);
  }
  for (const t of types) {
    if (t.maxDepth != null) warnings.push(`« ${t.id} » garde une borne héritée (jusqu'à ${t.maxDepth} m) : à valider par le propriétaire.`);
    if (!t.active) warnings.push(`« ${t.id} » est désactivé : il n'apparaît plus (les blocs en cours restent valides).`);
  }
  return { errors, warnings, types };
}

// ── Probabilités et simulation ────────────────────────────────────────────────

function _pool(types, depth, luckLevel) {
  const mult = 1 + Math.max(0, luckLevel) * LUCK_PER_LEVEL;
  return types.filter(t => _available(t, depth)).map(t => ({ t, w: t.weight * (BOOSTED.has(t.rarity) ? mult : 1) }));
}

/** Probabilités normalisées à une profondeur (Chance du joueur `luckLevel`). */
function odds(types, depth, luckLevel = 0) {
  const pool = _pool(types, depth, luckLevel);
  const total = pool.reduce((s, e) => s + e.w, 0);
  return pool.map(e => ({ id: e.t.id, p: total > 0 ? e.w / total : 0 }));
}

/** Générateur déterministe (mulberry32) : simulations reproductibles. */
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
 * Simule `n` tirages par profondeur (même algorithme que le client) et compare aux probabilités
 * théoriques. Retourne, par profondeur : PV moyens, récompense moyenne et détail par type.
 */
function simulate(types, { depths = [1, 10, 25, 50, 100, 150, 250], n = 10000, luckLevel = 0, seed = 37 } = {}) {
  if (![10000, 100000].includes(n)) throw new CatalogError(400, 'Simulation : 10 000 ou 100 000 tirages.');
  if (!Array.isArray(depths) || !depths.length || depths.length > 12 || !depths.every(d => _int(d, 1, 1e6))) {
    throw new CatalogError(400, 'Simulation : 1 à 12 profondeurs entières ≥ 1.');
  }
  if (!_int(luckLevel, 0, 100)) throw new CatalogError(400, 'Simulation : niveau de Chance entier de 0 à 100.');
  const rand = _rng(seed);
  return depths.map(depth => {
    const pool = _pool(types, depth, luckLevel);
    const total = pool.reduce((s, e) => s + e.w, 0);
    const counts = new Map(pool.map(e => [e.t.id, 0]));
    for (let i = 0; i < n && total > 0; i++) {
      let r = rand() * total;
      let pick = pool[pool.length - 1].t;
      for (const e of pool) { r -= e.w; if (r <= 0) { pick = e.t; break; } }
      counts.set(pick.id, counts.get(pick.id) + 1);
    }
    const neutral = _pool(types, depth, 0);
    const neutralTotal = neutral.reduce((s, e) => s + e.w, 0);
    const hpScale = 1 + (depth - 1) * HP_SCALE_PER_M;
    return {
      depth,
      avgHp: neutralTotal > 0 ? neutral.reduce((s, e) => s + (e.w / neutralTotal) * Math.ceil(e.t.hpBase * hpScale), 0) : 0,
      avgReward: total > 0 ? pool.reduce((s, e) => s + (e.w / total) * Math.ceil(e.t.reward * (1 + (depth - 1) * REWARD_SCALE_PER_M)), 0) : 0,
      types: pool.map(e => ({ id: e.t.id, rarity: e.t.rarity, p: e.w / total, observed: counts.get(e.t.id) / n }))
        .sort((a, b) => b.p - a.p),
    };
  });
}

/** Écarts brouillon ↔ version publiée, champ par champ (aperçu avant publication). */
function diff(fromTypes, toTypes) {
  const before = new Map(fromTypes.map(t => [t.id, t]));
  const changes = [];
  for (const t of toTypes) {
    const b = before.get(t.id);
    if (!b) { changes.push({ id: t.id, kind: 'added' }); continue; }
    const fields = Object.keys(t).filter(k => JSON.stringify(t[k] ?? null) !== JSON.stringify(b[k] ?? null))
      .map(k => ({ field: k, before: b[k] ?? null, after: t[k] ?? null }));
    if (fields.length) changes.push({ id: t.id, kind: 'changed', fields });
  }
  return changes;
}

// ── Anti-bot (#25) ────────────────────────────────────────────────────────────

/** Segments de PV minimum sur toutes les versions publiées → budget de dégâts. */
function minHpSegments() {
  const all = [];
  for (const r of conn().prepare('SELECT types FROM block_catalog_versions').all()) all.push(...JSON.parse(r.types).filter(t => t.active));
  const cuts = _breakpoints(all);
  const segs = [];
  for (let i = 0; i < cuts.length; i++) {
    const from = cuts[i];
    const to = i + 1 < cuts.length ? cuts[i + 1] - 1 : Infinity;
    const avail = all.filter(t => _available(t, from));
    if (!avail.length) continue;
    const hpBase = Math.min(...avail.map(t => t.hpBase));
    const last = segs[segs.length - 1];
    if (last && last.hpBase === hpBase && last.to === from - 1) last.to = to; else segs.push({ from, to, hpBase });
  }
  return segs;
}

function refreshAntibot() {
  return antibot.setMinHpSegments(minHpSegments());
}

// ── Brouillon, publication, retour arrière ────────────────────────────────────

function _saveDraft(types, basedOn) {
  conn().prepare(`INSERT INTO block_catalog_draft (id, types, based_on, updated_at) VALUES (1, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET types = excluded.types, based_on = excluded.based_on, updated_at = excluded.updated_at`)
    .run(JSON.stringify(types), basedOn);
}

/** Ajoute ou modifie un type dans le brouillon (créé depuis la version en vigueur si absent). */
function upsertDraftType(input) {
  const t = normalizeType(input);
  return conn().transaction(() => {
    const draft = getDraft() ?? { types: getPublished().types, basedOn: getPublished().version };
    const i = draft.types.findIndex(x => x.id === t.id);
    if (i < 0 && draft.types.length >= MAX_TYPES) throw new CatalogError(400, `Au plus ${MAX_TYPES} types de blocs.`);
    const before = i >= 0 ? draft.types[i] : null;
    if (i >= 0) draft.types[i] = t; else draft.types.push(t);
    _saveDraft(draft.types, draft.basedOn);
    _audit(i >= 0 ? 'draft_update' : 'draft_add', null, { id: t.id, changes: before ? diff([before], [t])[0]?.fields ?? [] : null });
    return t;
  })();
}

/** Retire du brouillon un type jamais publié. */
function removeDraftType(id) {
  return conn().transaction(() => {
    if (publishedIds().has(id)) throw new CatalogError(409, `« ${id} » est déjà publié : désactivez-le au lieu de le supprimer.`);
    const draft = getDraft();
    if (!draft || !draft.types.some(t => t.id === id)) throw new CatalogError(404, 'Type absent du brouillon.');
    _saveDraft(draft.types.filter(t => t.id !== id), draft.basedOn);
    _audit('draft_remove', null, { id });
  })();
}

function discardDraft() {
  const r = conn().prepare('DELETE FROM block_catalog_draft WHERE id = 1').run();
  if (r.changes) _audit('draft_discard', null, null);
  return r.changes > 0;
}

/** Publication atomique du brouillon (refusée si invalide ou si la version a changé entre-temps). */
function publishDraft({ note, expectedBasedOn } = {}) {
  const result = conn().transaction(() => {
    const draft = getDraft();
    if (!draft) throw new CatalogError(409, 'Aucun brouillon à publier.');
    const current = getPublished();
    if (draft.basedOn !== current.version || (expectedBasedOn != null && expectedBasedOn !== current.version)) {
      throw new CatalogError(409, `Le brouillon part de la version ${draft.basedOn}, la version en vigueur est la ${current.version} : rechargez.`);
    }
    const v = validateCatalog(draft.types);
    if (v.errors.length) throw new CatalogError(400, 'Brouillon invalide.', v.errors);
    const changes = diff(current.types, v.types);
    if (!changes.length) throw new CatalogError(409, 'Aucun changement par rapport à la version en vigueur.');
    const version = current.version + 1;
    conn().prepare("INSERT INTO block_catalog_versions (version, types, source, note, from_version) VALUES (?, ?, 'publish', ?, ?)")
      .run(version, JSON.stringify(v.types), String(note ?? '').trim().slice(0, 300) || null, current.version);
    conn().prepare('DELETE FROM block_catalog_draft WHERE id = 1').run();
    _audit('publish', version, { changes });
    return { version, changes, warnings: v.warnings };
  })();
  _invalidate();
  refreshAntibot();
  return result;
}

/**
 * Retour arrière : publie une NOUVELLE version reprenant le contenu d'une version antérieure.
 * Les types ajoutés depuis sont conservés mais désactivés (sauvegardes compatibles).
 */
function rollbackTo(target, { note } = {}) {
  const result = conn().transaction(() => {
    const old = getVersion(target);
    if (!old) throw new CatalogError(404, 'Version introuvable.');
    const current = getPublished();
    if (old.version === current.version) throw new CatalogError(409, 'Cette version est déjà en vigueur.');
    const ids = new Set(old.types.map(t => t.id));
    const types = [...old.types, ...current.types.filter(t => !ids.has(t.id)).map(t => ({ ...t, active: false }))];
    const v = validateCatalog(types);
    if (v.errors.length) throw new CatalogError(400, 'Retour arrière impossible.', v.errors);
    const version = current.version + 1;
    conn().prepare("INSERT INTO block_catalog_versions (version, types, source, note, from_version) VALUES (?, ?, 'rollback', ?, ?)")
      .run(version, JSON.stringify(v.types), String(note ?? '').trim().slice(0, 300) || `Retour à la version ${old.version}`, old.version);
    _audit('rollback', version, { to: old.version, changes: diff(current.types, v.types) });
    return { version, restored: old.version };
  })();
  _invalidate();
  refreshAntibot();
  return result;
}

function listAudit(limit = 100) {
  return conn().prepare('SELECT * FROM block_catalog_audit ORDER BY id DESC LIMIT ?').all(limit)
    .map(a => ({ ...a, details: a.details ? JSON.parse(a.details) : null }));
}

/** Vue admin : version en vigueur, brouillon validé, écarts, versions, segments anti-bot. */
function buildAdminView() {
  const published = getPublished();
  const draft = getDraft();
  const validation = draft ? validateCatalog(draft.types) : null;
  return {
    published,
    draft: draft && { ...draft, errors: validation.errors, warnings: validation.warnings, changes: diff(published.types, validation.types) },
    publishedIds: [...publishedIds()],
    legacyIds: originTypes().map(t => t.id),
    versions: listVersions(),
    antibotSegments: antibot.getMinHpSegments().map(s => ({ ...s, to: s.to === Infinity ? null : s.to })),
    categories: CATEGORIES,
    rarities: RARITIES,
  };
}

module.exports = {
  CatalogError, CATEGORIES, RARITIES,
  init, originTypes, getPublished, getVersion, getDraft, listVersions, publicCatalog, publishedIds,
  normalizeType, validateCatalog, odds, simulate, diff, minHpSegments, refreshAntibot,
  upsertDraftType, removeDraftType, discardDraft, publishDraft, rollbackTo, listAudit, buildAdminView,
};
