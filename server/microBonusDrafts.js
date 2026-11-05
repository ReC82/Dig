'use strict';
/**
 * microBonusDrafts.js — Micro-bonus de dégâts fractionnaires en BROUILLON (#81, étape C).
 *
 * Le panel admin peut préparer des bonus déclaratifs (modèle public/js/microBonus.js : intensité au
 * centième, cible, calendrier Europe/Brussels, souvenir d'événement lié) et les prévisualiser :
 * texte affiché, état à une date donnée, simulation de l'effet sur le nombre de coups.
 *
 * Garde-fous (demande du propriétaire du 05/11/2026) :
 *   - le seul statut possible est `draft` (contrainte CHECK en base, refus explicite à l'API) ;
 *   - aucune route joueur ne lit cette table : le jeu ne reçoit aucun bonus (GameState.eventBonuses
 *     reste vide) ; activer un effet demandera une décision du propriétaire et un développement dédié ;
 *   - lier un souvenir ne modifie ni l'objet, ni ses chances, ni ses détenteurs ;
 *   - rien n'est supprimé : « archiver » masque le brouillon, chaque écriture est journalisée.
 */

const db = require('./db');
const MicroBonus = require('../public/js/microBonus');

const conn = () => db.getDb();
const MAX_LABEL = 80;
const MAX_NOTE = 600;
const MAX_DRAFTS = 200;

class DraftError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function init(c = conn()) {
  c.exec(`
    CREATE TABLE IF NOT EXISTS micro_bonus_drafts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT NOT NULL,
      note        TEXT NOT NULL DEFAULT '',
      effect      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'draft' CHECK (status = 'draft'),
      archived    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
    CREATE TABLE IF NOT EXISTS micro_bonus_draft_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id    INTEGER NOT NULL,
      action      TEXT NOT NULL,
      effect      TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );
  `);
}

const _str = (v, max) => String(v ?? '').replace(/[<>\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);

/** Saisie admin → { label, note, effect } validés. Toute demande d'activation est refusée. */
function normalizeInput(input = {}) {
  if (input.status != null && input.status !== 'draft') {
    throw new DraftError(400, 'Activation impossible : un micro-bonus reste en brouillon tant que le propriétaire n\'a pas validé valeur, durée et équité (#81).');
  }
  const label = _str(input.label, MAX_LABEL);
  if (!label) throw new DraftError(400, 'Nom du brouillon requis.');
  let effect;
  try { effect = MicroBonus.normalize(input.effect); }
  catch (err) { throw new DraftError(400, err.message); }
  return { label, note: _str(input.note, MAX_NOTE), effect };
}

function _row(r) {
  let effect = null;
  try { effect = JSON.parse(r.effect); } catch (_) { /* brouillon illisible : affiché sans effet */ }
  return { id: r.id, label: r.label, note: r.note, effect, status: r.status, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at };
}

function _log(c, id, action, effect) {
  c.prepare('INSERT INTO micro_bonus_draft_log (draft_id, action, effect) VALUES (?,?,?)').run(id, action, effect ? JSON.stringify(effect) : null);
}

function list({ archived = false } = {}) {
  return conn().prepare(`SELECT * FROM micro_bonus_drafts ${archived ? '' : 'WHERE archived = 0'} ORDER BY id DESC`).all().map(_row);
}

function get(id) {
  const r = conn().prepare('SELECT * FROM micro_bonus_drafts WHERE id = ?').get(id);
  if (!r) throw new DraftError(404, 'Brouillon introuvable.');
  return _row(r);
}

function create(input) {
  const d = normalizeInput(input);
  const c = conn();
  const n = c.prepare('SELECT COUNT(*) AS n FROM micro_bonus_drafts').get().n;
  if (n >= MAX_DRAFTS) throw new DraftError(400, `Au plus ${MAX_DRAFTS} brouillons.`);
  return c.transaction(() => {
    const id = Number(c.prepare('INSERT INTO micro_bonus_drafts (label, note, effect) VALUES (?,?,?)').run(d.label, d.note, JSON.stringify(d.effect)).lastInsertRowid);
    _log(c, id, 'create', d.effect);
    return get(id);
  })();
}

function update(id, input) {
  get(id);
  const d = normalizeInput(input);
  const c = conn();
  return c.transaction(() => {
    c.prepare(`UPDATE micro_bonus_drafts SET label = ?, note = ?, effect = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`)
      .run(d.label, d.note, JSON.stringify(d.effect), id);
    _log(c, id, 'update', d.effect);
    return get(id);
  })();
}

function setArchived(id, archived) {
  get(id);
  const c = conn();
  c.transaction(() => {
    c.prepare(`UPDATE micro_bonus_drafts SET archived = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`).run(archived ? 1 : 0, id);
    _log(c, id, archived ? 'archive' : 'unarchive', null);
  })();
  return get(id);
}

function listLog(limit = 100) {
  return conn().prepare('SELECT * FROM micro_bonus_draft_log ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(500, limit)));
}

// ── Aperçu et simulation ──────────────────────────────────────────────────────

/** Noms FR des blocs (catalogue publié) et des catégories, pour les textes de l'aperçu. */
function _names(types) {
  const blocks = {};
  for (const t of types) blocks[t.id] = t.names?.fr || (t.id.charAt(0).toUpperCase() + t.id.slice(1)).replace(/_/g, ' ');
  return { blocks, categories: { terre: 'Terre', pierre: 'Pierre', minerai: 'Minerai', coffre: 'Coffre', gemme: 'Gemme' } };
}

function _types() {
  try {
    const pub = require('./blockCatalog').getPublished();
    if (pub && Array.isArray(pub.types) && pub.types.length) return pub.types;
  } catch (_) { /* catalogue non initialisé (scripts, tests) */ }
  return require('./blockCatalog').originTypes();
}

/**
 * Effet d'un bonus supposé actif sur le minage à une profondeur : coups moyens par bloc (pool
 * neutre, PV sans relique, comme Blocks.spawn) avec et sans bonus, pour quelques dégâts de base.
 * Calcul en centièmes (Blocks.hitsToBreak) : aucun arrondi intermédiaire.
 */
function simulate(effect, { depth = 50, bases = [1, 2, 5, 10, 15, 25], types = _types() } = {}) {
  const d = Math.max(1, Math.min(10_000, Math.floor(Number(depth) || 1)));
  const scale = 1 + (d - 1) * 0.12;
  const pool = types.filter(t => t.active !== false && d >= t.minDepth)
    .map(t => ({ t, w: t.fadeFrom != null && t.fadeWeight > 0 && d > t.fadeFrom ? t.fadeWeight : t.weight, hp: Math.ceil(t.hpBase * scale) }));
  const total = pool.reduce((s, e) => s + e.w, 0) || 1;
  const hits = (hp, dmg) => Math.ceil(Math.round(hp * 100) / Math.round(dmg * 100));
  const rows = bases.map(base => {
    let h0 = 0, h1 = 0, share = 0;
    for (const e of pool) {
      const block = { id: e.t.id, category: e.t.category };
      const applies = MicroBonus.appliesTo(effect, block);
      h0 += e.w * hits(e.hp, base);
      h1 += e.w * hits(e.hp, MicroBonus.clickDamage(base, [{ ...effect, schedule: {} }], { block }));
      if (applies) share += e.w;
    }
    h0 /= total; h1 /= total;
    return { base, hitsBefore: +h0.toFixed(2), hitsAfter: +h1.toFixed(2), gainPct: +((h0 / h1 - 1) * 100).toFixed(1), targetShare: +(share / total * 100).toFixed(1) };
  });
  return { depth: d, rows };
}

/** États sur des dates repères (bascules lundi↔mardi, octobre↔novembre, fin d'une plage…). */
function stateSamples(effect, nowMs = Date.now()) {
  const samples = [{ label: 'Maintenant', ms: nowMs }];
  const add = (label, iso) => samples.push({ label, ms: Date.parse(iso) });
  const y = new Date(nowMs).getUTCFullYear();
  add('Lun. 02/11/2026 23:59 Bruxelles', '2026-11-02T22:59:00Z');
  add('Mar. 03/11/2026 00:00 Bruxelles', '2026-11-02T23:00:00Z');
  add(`31/10/${y} 23:59 Bruxelles`, `${y}-10-31T22:59:00Z`);
  add(`01/11/${y} 00:00 Bruxelles`, `${y}-10-31T23:00:00Z`);
  return samples.map(s => {
    const st = MicroBonus.stateAt(effect, s.ms, 'fr');
    return { label: s.label, code: st.code, text: st.code === 'active' ? 'Actif' : st.text };
  });
}

/** Aperçu complet d'un bonus (enregistré ou non) : textes FR/EN, état, dates repères, simulation. */
function preview(effectInput, { depth, nowMs = Date.now() } = {}) {
  let effect;
  try { effect = MicroBonus.normalize(effectInput); }
  catch (err) { throw new DraftError(400, err.message); }
  const types = _types();
  const names = _names(types);
  const warnings = [];
  if (effect.target.type === 'block' && !types.some(t => t.id === effect.target.id)) warnings.push(`Bloc « ${effect.target.id} » absent du catalogue publié : l'effet ne s'appliquerait à aucun bloc.`);
  if (effect.source) {
    const it = conn().prepare('SELECT names FROM monthly_event_items WHERE event_id = ? AND id = ?').get(effect.source.eventId, effect.source.itemId);
    if (!it) warnings.push('Souvenir lié introuvable (événement/objet) : le lien est conservé tel quel, sans effet.');
  }
  if (!effect.schedule.from && !effect.schedule.to && !effect.schedule.months && !effect.schedule.weekdays) {
    warnings.push('Effet permanent : avantage durable au classement pour les détenteurs (voir les alternatives du rapport #81).');
  }
  return {
    effect,
    text: { fr: MicroBonus.describe(effect, 'fr', names), en: MicroBonus.describe(effect, 'en', names) },
    state: MicroBonus.stateAt(effect, nowMs, 'fr'),
    samples: stateSamples(effect, nowMs),
    simulation: simulate(effect, { depth, types }),
    limits: { min: MicroBonus.VALUE_MIN, max: MicroBonus.VALUE_MAX, stackCap: MicroBonus.STACK_CAP },
    warnings,
  };
}

/** Exemples de configuration (valeurs fictives NON validées) proposés dans le formulaire. */
const EXAMPLES = [
  { label: 'Exemple — +0,25 sur la pierre', effect: { kind: 'damage_flat', value: 0.25, target: { type: 'block', id: 'pierre' }, schedule: {} } },
  { label: 'Exemple — +0,1 le lundi', effect: { kind: 'damage_flat', value: 0.1, target: { type: 'all' }, schedule: { weekdays: [1] } } },
  { label: 'Exemple — +0,2 en novembre', effect: { kind: 'damage_flat', value: 0.2, target: { type: 'all' }, schedule: { months: [11] } } },
  { label: 'Exemple — +0,15 sur les minerais, 30 jours', effect: { kind: 'damage_flat', value: 0.15, target: { type: 'category', id: 'minerai' }, schedule: { from: '2026-12-01', to: '2026-12-30' } } },
];

function adminSummary() {
  const types = _types();
  const names = _names(types);
  return {
    drafts: list({ archived: true }).map(d => ({ ...d, text: d.effect ? MicroBonus.describe(d.effect, 'fr', names) : '', state: d.effect ? MicroBonus.stateAt(d.effect, Date.now(), 'fr') : null })),
    log: listLog(50),
    examples: EXAMPLES,
    categories: MicroBonus.CATEGORIES,
    blocks: types.map(t => ({ id: t.id, name: names.blocks[t.id], category: t.category })),
    limits: { min: MicroBonus.VALUE_MIN, max: MicroBonus.VALUE_MAX, stackCap: MicroBonus.STACK_CAP },
  };
}

module.exports = { init, DraftError, normalizeInput, list, get, create, update, setArchived, listLog, simulate, stateSamples, preview, adminSummary, EXAMPLES };
