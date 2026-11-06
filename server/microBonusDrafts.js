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

// Modèle du moteur (public/js/blocks.js, Blocks.spawn) repris à l'identique :
//   - PV = ceil(hpBase × (1 + 0,12 × (profondeur − 1))), sans relique de réduction de PV ;
//   - poids à la profondeur : `weight`, ou `fadeWeight` au-delà de `fadeFrom` ;
//   - nature du bloc (ce que le joueur voit, ce que vise le bonus) tirée AVEC la Chance
//     (poids × (1 + 0,10 × niveau) pour les raretés rare/épique/légendaire) ;
//   - PV tirés SÉPARÉMENT, sur le même pool SANS Chance (#32 option A) : un bloc « Pierre »
//     peut donc avoir la résistance d'un autre bloc. Le bonus suit la nature, pas la résistance.
const LUCK_PER_LEVEL = 0.10;
const LUCK_MAX = 12;
const BOOSTED = new Set(['rare', 'epique', 'legendaire']);
const _hits = (hp, dmg) => Math.ceil(Math.round(hp * 100) / Math.round(dmg * 100));
const _fr = (v, digits = 2) => Number(v).toLocaleString('fr-BE', { maximumFractionDigits: digits });

function _pool(types, depth, luckMult) {
  const scale = 1 + (depth - 1) * 0.12;
  return types.filter(t => t.active !== false && depth >= t.minDepth).map(t => {
    const w = t.fadeFrom != null && t.fadeWeight > 0 && depth > t.fadeFrom ? t.fadeWeight : t.weight;
    return { t, w, wl: w * (BOOSTED.has(t.rarity ?? t.rarityKey) ? luckMult : 1), hp: Math.ceil(t.hpBase * scale) };
  });
}

/**
 * Effet d'un bonus supposé actif sur le minage à une profondeur, pour quelques dégâts de base :
 * espérance exacte (pas de tirage aléatoire) du nombre de coups manuels par bloc, sans et avec bonus.
 *   E0 = Σ p(PV) × ceil(PV ÷ base)                       (p : pool sans Chance)
 *   Eb = Σ p(PV) × ceil(PV ÷ (base + bonus))             (bloc visé)
 *   E1 = part × Eb + (1 − part) × E0                      (part : blocs visés, avec Chance)
 * fewerHitsPct = (1 − E1/E0) × 100 ; moreBlocksPct = (E0/E1 − 1) × 100 ; savedPer100 = (E0 − E1) × 100.
 * savedPer100Sd : écart-type du nombre de coups économisés sur 100 blocs (blocs indépendants).
 * zero : aucun bloc possible ne demande un coup de moins (vrai zéro, pas un arrondi).
 */
function simulate(effect, { depth = 50, luck = 0, bases = [1, 2, 5, 10, 15, 25], types = _types() } = {}) {
  const d = Math.max(1, Math.min(10_000, Math.floor(Number(depth) || 1)));
  const luckLevel = Math.max(0, Math.min(LUCK_MAX, Math.floor(Number(luck) || 0)));
  const pool = _pool(types, d, 1 + luckLevel * LUCK_PER_LEVEL);
  const W = pool.reduce((s, e) => s + e.w, 0) || 1;
  const WL = pool.reduce((s, e) => s + e.wl, 0) || 1;
  const share = pool.reduce((s, e) => s + (MicroBonus.appliesTo(effect, { id: e.t.id, category: e.t.category }) ? e.wl : 0), 0) / WL;
  const anyBlock = [{ ...effect, target: { type: 'all' }, schedule: {} }];
  const rows = bases.map(base => {
    const withBonus = MicroBonus.clickDamage(base, anyBlock);
    let e0 = 0, eb = 0, changed = 0, s1 = 0, s2 = 0;
    for (const e of pool) {
      const p = e.w / W, h0 = _hits(e.hp, base), hb = _hits(e.hp, withBonus);
      e0 += p * h0; eb += p * hb;
      if (hb < h0) changed += p;
      s1 += p * (h0 - hb); s2 += p * (h0 - hb) ** 2;
    }
    const e1 = share * eb + (1 - share) * e0;
    const mean = share * s1, varS = share * s2 - mean * mean;
    const zero = share === 0 || changed === 0;
    return {
      base, withBonus,
      hitsBefore: +e0.toFixed(2), hitsAfter: +e1.toFixed(2), hitsTargetAfter: +eb.toFixed(2),
      fewerHitsPct: zero ? 0 : +((1 - e1 / e0) * 100).toFixed(2),
      moreBlocksPct: zero ? 0 : +((e0 / e1 - 1) * 100).toFixed(2),
      savedPer100: zero ? 0 : +((e0 - e1) * 100).toFixed(1),
      savedPer100Sd: zero ? 0 : +(Math.sqrt(Math.max(0, varS) * 100)).toFixed(1),
      changedShare: +(changed * 100).toFixed(1), targetShare: +(share * 100).toFixed(1), zero,
    };
  });
  const names = _names(types).blocks;
  const blocks = pool.map(e => ({
    id: e.t.id, name: names[e.t.id], hp: e.hp,
    chance: +(e.w / W * 100).toFixed(2), chanceLuck: +(e.wl / WL * 100).toFixed(2),
    targeted: MicroBonus.appliesTo(effect, { id: e.t.id, category: e.t.category }),
  })).sort((a, b) => b.chance - a.chance);
  return { depth: d, luck: luckLevel, bonus: effect.value, rows, blocks };
}

/**
 * Explications en français non technique d'une simulation : exemple guidé, moyenne pondérée,
 * raison d'un 0 %, écart dû au hasard. Chaque nombre est tiré de la simulation (aucun chiffre fictif).
 */
function explain(sim) {
  const v = sim.bonus, out = [];
  const h5 = _hits(5, 1), h5b = _hits(5, 1 + v);
  out.push(`Exemple simple : un bloc de 5 PV. Avec 1 dégât par coup, il faut 5 coups. Avec 1 + ${_fr(v)} = ${_fr(1 + v)} dégât par coup : 5 ÷ ${_fr(1 + v)} = ${_fr(5 / (1 + v))}, arrondi au coup entier supérieur → ${h5b} coup${h5b > 1 ? 's' : ''}`
    + (h5b < h5 ? ` : ${h5 - h5b} coup${h5 - h5b > 1 ? 's' : ''} de moins.` : ' : aucun coup de moins (le dernier coup reste nécessaire).'));
  const r1 = sim.rows[0];
  if (r1) {
    out.push(`Moyenne à ${sim.depth} m avec ${_fr(r1.base)} dégât de base : ${_fr(r1.targetShare, 1)} % des blocs rencontrés sont visés par le bonus. Sur ces blocs, il faut en moyenne ${_fr(r1.hitsTargetAfter)} coups au lieu de ${_fr(r1.hitsBefore)} ; les autres blocs ne changent pas. `
      + `Moyenne avec bonus = ${_fr(r1.targetShare, 1)} % × ${_fr(r1.hitsTargetAfter)} + ${_fr(100 - r1.targetShare, 1)} % × ${_fr(r1.hitsBefore)} ≈ ${_fr(r1.hitsAfter)} coups par bloc.`);
    if (!r1.zero) {
      const lo = Math.max(0, r1.savedPer100 - 1.96 * r1.savedPer100Sd), hi = r1.savedPer100 + 1.96 * r1.savedPer100Sd;
      out.push(`Hasard : ${_fr(r1.savedPer100, 1)} coups économisés pour 100 blocs est une moyenne. Sur 100 blocs réellement minés, le résultat varie selon les blocs tirés : environ entre ${_fr(lo, 0)} et ${_fr(hi, 0)} coups dans 95 % des cas. Plus on mine de blocs, plus on se rapproche de la moyenne.`);
    }
  }
  const zero = sim.rows.find(r => r.zero && r.targetShare > 0);
  const small = [...sim.rows].reverse().find(r => !r.zero);
  if (zero) {
    out.push(`Pourquoi 0 % avec ${_fr(zero.base)} dégâts de base ? Un coup de moins n'est gagné que si le bonus fait passer le nombre de coups au nombre entier inférieur. À ${sim.depth} m, aucun bloc possible n'est dans ce cas : c'est un vrai zéro, pas un arrondi de l'affichage.`);
  } else if (small && small.changedShare < 100) {
    const ex = sim.blocks.find(b => _hits(b.hp, small.base) === _hits(b.hp, small.withBonus));
    if (ex) {
      out.push(`Pourquoi un gain si faible avec ${_fr(small.base)} dégâts de base ? Un coup de moins n'est gagné que si le bonus fait passer le nombre de coups au nombre entier inférieur. Exemple : ${ex.hp} PV ÷ ${_fr(small.base)} = ${_fr(ex.hp / small.base)} → ${_hits(ex.hp, small.base)} coups ; ÷ ${_fr(small.withBonus)} = ${_fr(ex.hp / small.withBonus)} → toujours ${_hits(ex.hp, small.withBonus)} coups. `
        + `Seules ${_fr(small.changedShare, 1)} % des résistances possibles à ${sim.depth} m franchissent ce seuil.`);
    }
  }
  return out;
}

/** Hypothèses de la simulation, affichées telles quelles. */
function hypotheses(sim) {
  return [
    `Profondeur ${sim.depth} m, catalogue de blocs publié, PV = PV de base × (1 + 0,12 × (profondeur − 1)) arrondi au supérieur, sans relique de réduction de PV.`,
    'Dans le jeu, la nature d\'un bloc (ce que le joueur voit, par exemple « Pierre ») et sa résistance (PV) sont tirées séparément (#32) : un bloc « Pierre » peut avoir les PV d\'un autre bloc du même tirage. Le bonus suit la nature visible ; la simulation utilise donc la répartition complète des PV.',
    `Part de blocs visés calculée avec la Chance au niveau ${sim.luck} (la Chance augmente les blocs rares, épiques et légendaires, donc diminue la part des blocs communs).`,
    'Chaque coup est un coup manuel à pleine puissance (le bonus ne s\'applique ni à l\'Auto-Dig ni à la pioche émoussée). Les chiffres sont des moyennes exactes, calculées sans tirage au sort.',
  ];
}

/** Minuit (00:00) d'un jour civil de Bruxelles, en ms UTC (UTC+1 l'hiver, UTC+2 l'été). */
function _brusselsMidnight(ymd) {
  const base = Date.parse(`${ymd}T00:00:00Z`);
  for (const h of [1, 2]) {
    const ms = base - h * 3_600_000;
    if (MicroBonus.brusselsDay(ms).ymd === ymd && MicroBonus.brusselsDay(ms - 60_000).ymd !== ymd) return ms;
  }
  return base;
}

/** Ce que ferait le calendrier SI le bonus était publié (un brouillon n'est jamais appliqué). */
function _would(st) {
  return {
    active: 'Serait actif',
    inactive: 'Serait inactif',
    ended: `Serait terminé (${st.text.replace(/^Terminé le /, 'fin le ')})`,
    upcoming: `Pas encore commencé (${st.text.replace(/^Commence le /, 'début le ')})`,
  }[st.code] ?? st.text;
}

const _dmy = ymd => ymd.split('-').reverse().join('/');
const _shift = (ymd, days) => new Date(Date.parse(`${ymd}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * États sur des dates repères : bascules lundi↔mardi et octobre↔novembre, et, si le calendrier a
 * des dates, la veille du début à 23:59, le début à 00:00, la fin à 23:59 et le lendemain à 00:00.
 */
function stateSamples(effect, nowMs = Date.now()) {
  const samples = [{ label: 'Maintenant', ms: nowMs }];
  const add = (label, ms) => samples.push({ label, ms });
  const y = new Date(nowMs).getUTCFullYear();
  add('Lun. 02/11/2026 23:59 Bruxelles', Date.parse('2026-11-02T22:59:00Z'));
  add('Mar. 03/11/2026 00:00 Bruxelles', Date.parse('2026-11-02T23:00:00Z'));
  add(`31/10/${y} 23:59 Bruxelles`, Date.parse(`${y}-10-31T22:59:00Z`));
  add(`01/11/${y} 00:00 Bruxelles`, Date.parse(`${y}-10-31T23:00:00Z`));
  const s = effect.schedule || {};
  if (s.from) {
    add(`Veille du début, ${_dmy(_shift(s.from, -1))} 23:59 Bruxelles`, _brusselsMidnight(s.from) - 60_000);
    add(`Début, ${_dmy(s.from)} 00:00 Bruxelles`, _brusselsMidnight(s.from));
  }
  if (s.to) {
    add(`Fin, ${_dmy(s.to)} 23:59 Bruxelles`, _brusselsMidnight(_shift(s.to, 1)) - 60_000);
    add(`Lendemain de la fin, ${_dmy(_shift(s.to, 1))} 00:00 Bruxelles`, _brusselsMidnight(_shift(s.to, 1)));
  }
  return samples.map(x => {
    const st = MicroBonus.stateAt(effect, x.ms, 'fr');
    return { label: x.label, code: st.code, text: _would(st) };
  });
}

/** Souvenirs d'événements existants (liste lisible pour le champ « Souvenir lié »). */
function _souvenirs() {
  try {
    const rows = conn().prepare(`SELECT i.event_id, i.id, i.names AS item_names, e.names AS event_names, e.status
      FROM monthly_event_items i JOIN monthly_events e ON e.id = i.event_id ORDER BY e.starts_at DESC, i.sort, i.id`).all();
    const fr = j => { try { const o = JSON.parse(j); return o.fr || o.en || ''; } catch (_) { return ''; } };
    return rows.map(r => ({ eventId: r.event_id, itemId: r.id, label: `${fr(r.event_names) || r.event_id} — ${fr(r.item_names) || r.id}`, eventStatus: r.status }));
  } catch (_) { return []; }   // tables des événements absentes (tests, scripts)
}

/** Aperçu complet d'un bonus (enregistré ou non) : textes FR/EN, état, dates repères, simulation. */
function preview(effectInput, { depth, luck, nowMs = Date.now() } = {}) {
  let effect;
  try { effect = MicroBonus.normalize(effectInput); }
  catch (err) { throw new DraftError(400, err.message); }
  const types = _types();
  const names = _names(types);
  const warnings = [];
  if (effect.target.type === 'block' && !types.some(t => t.id === effect.target.id)) warnings.push(`Bloc « ${effect.target.id} » absent du catalogue publié : l'effet ne s'appliquerait à aucun bloc.`);
  if (effect.source && !_souvenirs().some(x => x.eventId === effect.source.eventId && x.itemId === effect.source.itemId)) {
    warnings.push('Souvenir lié introuvable (événement/objet) : le lien est conservé tel quel, sans effet.');
  }
  if (!effect.schedule.from && !effect.schedule.to && !effect.schedule.months && !effect.schedule.weekdays && !effect.schedule.monthDays) {
    warnings.push('Effet permanent : avantage durable au classement pour les détenteurs (voir les alternatives du rapport #81).');
  }
  const simulation = simulate(effect, { depth, luck, types });
  const state = MicroBonus.stateAt(effect, nowMs, 'fr');
  return {
    effect,
    text: { fr: MicroBonus.describe(effect, 'fr', names), en: MicroBonus.describe(effect, 'en', names) },
    state: { ...state, would: _would(state), next: MicroBonus.describeNext(effect, nowMs, 'fr') },
    samples: stateSamples(effect, nowMs),
    simulation,
    explain: explain(simulation),
    hypotheses: hypotheses(simulation),
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
    drafts: list({ archived: true }).map(d => {
      const st = d.effect ? MicroBonus.stateAt(d.effect, Date.now(), 'fr') : null;
      return { ...d, text: d.effect ? MicroBonus.describe(d.effect, 'fr', names) : '', state: st && { ...st, would: _would(st) } };
    }),
    log: listLog(50),
    examples: EXAMPLES,
    categories: MicroBonus.CATEGORIES,
    blocks: types.map(t => ({ id: t.id, name: names.blocks[t.id], category: t.category })),
    souvenirs: _souvenirs(),
    luckMax: LUCK_MAX,
    limits: { min: MicroBonus.VALUE_MIN, max: MicroBonus.VALUE_MAX, stackCap: MicroBonus.STACK_CAP },
  };
}

module.exports = { init, DraftError, normalizeInput, list, get, create, update, setArchived, listLog, simulate, explain, hypotheses, stateSamples, preview, adminSummary, EXAMPLES, LUCK_MAX };
