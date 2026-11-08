'use strict';
/**
 * souvenirBonus.js — Bonus des souvenirs d'événements : proposition LISIBLE, jamais appliquée (#81,
 * demande du propriétaire du 08/11/2026, en lien avec #56, #86 et #93).
 *
 * Décision ferme du propriétaire (06/11) : un souvenir trouvé est possédé à vie ; son petit bonus est
 * soit constant, soit actif sur un calendrier récurrent ; jamais consommable ni limité à 15 minutes.
 * Le système reste INACTIF en production tant que cumul et impact au classement ne sont pas simulés
 * et que le barème n'est pas approuvé.
 *
 * Ce module :
 *   - résout les bonus d'un inventaire selon la règle proposée « un seul bonus par TYPE de souvenir
 *     et par joueur, quel que soit le nombre d'exemplaires » (resolve) ; le résultat ne dépend que de
 *     l'inventaire ACTUEL : réévaluation immédiate, idempotente, sans rétroactivité ;
 *   - modélise un transfert d'exemplaire (échanges #93, futur) pour vérifier la règle (transfer) ;
 *   - prépare la fiche « Bonus du souvenir » de l'admin : brouillons #81 liés, deux variantes
 *     chiffrées à arbitrer, gain réel selon la profondeur, effet cumulé (30 + 31 souvenirs) et
 *     plafonds anti-avantage des vétérans (itemSheet / cumulative).
 * Rien ici n'écrit en base, ne crée de brouillon ni ne transmet un bonus au jeu.
 */

const db = require('./db');
const MicroBonus = require('../public/js/microBonus');
const drafts = require('./microBonusDrafts');

const conn = () => db.getDb();
const cents = v => Math.round(Number(v) * 100);

/**
 * Variantes chiffrées à ARBITRER (rapport #86 § 7.2, plafonds globaux recommandés) — non validées,
 * jamais enregistrées ni appliquées. `cap` : plafond du cumul de TOUS les souvenirs d'un joueur.
 */
const VARIANTS = [
  { key: 'constant', label: 'A — constante', perType: 0.01, cap: 0.05, schedule: {}, daysPerWeek: 7,
    help: '+0,01 dégât par coup sur tous les blocs, toujours actif, pour chaque type de souvenir possédé ; cumul plafonné à +0,05.' },
  { key: 'thursday', label: 'B — calendaire (jeudi)', perType: 0.03, cap: 0.10, schedule: { weekdays: [4] }, daysPerWeek: 1,
    help: '+0,03 dégât par coup sur tous les blocs, le jeudi seulement (heure de Bruxelles), pour chaque type de souvenir possédé ; cumul plafonné à +0,10.' },
];
const DEPTHS = [1, 10, 30, 50, 100];
const BASES = [1, 2, 5];
const COUNTS = [1, 5, 10, 30, 61];

const keyOf = (eventId, itemId) => `${eventId}/${itemId}`;

/** Inventaire { 'événement/objet': quantité } (objet ou Map) → Map des quantités entières > 0. */
function _owned(owned) {
  const m = new Map();
  const entries = owned instanceof Map ? owned.entries() : Object.entries(owned || {});
  for (const [k, q] of entries) {
    const n = Math.floor(Number(q));
    if (Number.isFinite(n) && n > 0) m.set(String(k), n);
  }
  return m;
}

/**
 * Bonus d'un joueur à un instant, selon la règle « un seul bonus par TYPE de souvenir ».
 *   owned   : { 'événement/objet': quantité } — 1 ou 12 exemplaires donnent le même bonus ;
 *   bonuses : effets #81 portant `source: { eventId, itemId }` (le premier lié à un type compte,
 *             les suivants sont ignorés et signalés) ;
 *   cap     : plafond du cumul (≤ STACK_CAP) ; block : bloc frappé ({ id, category }) ou null (tous).
 * Fonction pure de l'inventaire courant : la rappeler après un transfert donne immédiatement le
 * nouvel état, la rappeler deux fois donne le même résultat, et rien n'est recalculé dans le passé.
 */
function resolve(owned, bonuses, { nowMs = Date.now(), cap = MicroBonus.STACK_CAP, block = null } = {}) {
  const inv = _owned(owned);
  const byType = new Map();
  const ignored = [];
  for (const b of bonuses || []) {
    if (!b?.source) continue;
    const k = keyOf(b.source.eventId, b.source.itemId);
    if (byType.has(k)) ignored.push(k); else byType.set(k, b);
  }
  const capC = Math.min(cents(cap), cents(MicroBonus.STACK_CAP));
  const types = [];
  let raw = 0;
  for (const [k, b] of byType) {
    const qty = inv.get(k) ?? 0;
    if (!qty) continue;
    const active = MicroBonus.isActiveAt(b, nowMs) && (!block || MicroBonus.appliesTo(b, block));
    const v = active ? Math.min(cents(b.value), cents(MicroBonus.VALUE_MAX)) : 0;
    raw += v;
    types.push({ key: k, qty, value: b.value, active, counted: v / 100 });
  }
  return { types, ignored, raw: raw / 100, total: Math.min(raw, capC) / 100, capped: raw > capC };
}

/**
 * Transfert de `qty` exemplaire(s) d'un souvenir entre deux inventaires (modèle des échanges #93).
 * Pur : renvoie les nouveaux inventaires, refuse un transfert impossible. Le bonus se réévalue en
 * rappelant resolve() sur les inventaires renvoyés : le donneur garde son bonus tant qu'il lui reste
 * un exemplaire, le perd avec le dernier ; le receveur ne gagne rien s'il possédait déjà ce type.
 */
function transfer(from, to, key, qty = 1) {
  const a = _owned(from), b = _owned(to);
  const n = Math.floor(Number(qty));
  if (!(n > 0)) throw new Error('Quantité invalide.');
  if ((a.get(key) ?? 0) < n) throw new Error('Exemplaire non possédé : transfert refusé.');
  if (a.get(key) === n) a.delete(key); else a.set(key, a.get(key) - n);
  b.set(key, (b.get(key) ?? 0) + n);
  return { from: Object.fromEntries(a), to: Object.fromEntries(b) };
}

// ── Gains chiffrés (simulateur #81 audité, server/microBonusDrafts.simulate) ─────────────────────

/** % de blocs détruits en plus à nombre de coups égal (classement #73) pour un bonus « tous les blocs ». */
function _gainTable(value, { depths = DEPTHS, bases = BASES } = {}) {
  if (!(cents(value) > 0)) return depths.map(depth => ({ depth, cells: bases.map(base => ({ base, pct: 0, zero: true })) }));
  const v = Math.min(cents(value), cents(MicroBonus.STACK_CAP)) / 100;
  const effect = { kind: 'damage_flat', value: v, target: { type: 'all' }, schedule: {} };
  return depths.map(depth => {
    const sim = drafts.simulate(effect, { depth, bases });
    return { depth, cells: sim.rows.map(r => ({ base: r.base, pct: r.moreBlocksPct, zero: r.zero })) };
  });
}

/** Gain d'un brouillon lié (cible et Chance 0 incluses) aux profondeurs repères, en % de blocs. */
function _draftGains(effect, { depths = DEPTHS, bases = BASES } = {}) {
  return depths.map(depth => {
    const sim = drafts.simulate(effect, { depth, bases });
    return { depth, cells: sim.rows.map(r => ({ base: r.base, pct: r.moreBlocksPct, zero: r.zero })) };
  });
}

// ── Lecture des souvenirs et des brouillons liés ─────────────────────────────────────────────────

const _json = (s, d) => { try { return JSON.parse(s); } catch (_) { return d; } };

/** Événements non-test et leur nombre de souvenirs activés, publiés ou proposés (Novembre 30, Noël 5 + 26 = 31…). */
function _events() {
  try {
    return conn().prepare(`SELECT e.id, e.names, e.status, e.audience, e.starts_at,
        (SELECT COUNT(*) FROM monthly_event_items i WHERE i.event_id = e.id AND i.enabled = 1) AS n,
        (SELECT COUNT(*) FROM monthly_event_items i WHERE i.event_id = e.id AND i.enabled = 1 AND i.proposal = 1) AS p
      FROM monthly_events e ORDER BY e.starts_at, e.id`).all()
      .map(r => ({ id: r.id, name: _json(r.names, {}).fr || r.id, status: r.status, audience: r.audience, count: r.n, proposals: r.p }));
  } catch (_) { return []; }
}

/** Brouillons #81 non archivés liés à un souvenir (du plus ancien au plus récent). */
function _linkedDrafts() {
  return drafts.list().filter(d => d.effect?.source).sort((a, b) => a.id - b.id);
}

/**
 * Effet cumulé et plafonds : pour chaque variante, un détenteur de N types de souvenirs (1, 5, 10,
 * 30 = tout Novembre, 61 = Novembre + Noël) face à un joueur sans souvenir. Les brouillons réellement
 * liés aujourd'hui sont résumés à part (en production : aucun).
 */
function cumulative({ nowMs = Date.now() } = {}) {
  const events = _events().filter(e => e.audience !== 'test');
  const total = events.reduce((s, e) => s + e.count, 0);
  const counts = [...new Set([...COUNTS.filter(n => n < total), ...events.map((_, i) => events.slice(0, i + 1).reduce((s, e) => s + e.count, 0)), total])]
    .filter(n => n > 0).sort((a, b) => a - b);
  const variants = VARIANTS.map(v => ({
    key: v.key, label: v.label, help: v.help, perType: v.perType, cap: v.cap, daysPerWeek: v.daysPerWeek,
    rows: counts.map(n => {
      const raw = Math.round(n * v.perType * 100) / 100;
      const eff = Math.min(raw, v.cap);
      const at = _gainTable(eff, { depths: [10, 50, 100], bases: [1] }).map(g => g.cells[0]);
      const free = _gainTable(Math.min(raw, MicroBonus.STACK_CAP), { depths: [50], bases: [1] })[0].cells[0];
      return { count: n, raw, effective: eff, capped: raw > v.cap, gains: at.map((c, i) => ({ depth: [10, 50, 100][i], ...c })),
        week50: +(at[1].pct * v.daysPerWeek / 7).toFixed(2), uncapped50: free.pct };
    }),
  }));
  const linked = _linkedDrafts();
  const allOwned = Object.fromEntries(linked.map(d => [keyOf(d.effect.source.eventId, d.effect.source.itemId), 1]));
  const now = resolve(allOwned, linked.map(d => d.effect), { nowMs });
  return {
    events: events.map(e => ({ id: e.id, name: e.name, status: e.status, count: e.count, proposals: e.proposals })),
    totalSouvenirs: total, variants,
    linked: { drafts: linked.length, types: now.types.length, ignored: now.ignored, rawNow: now.raw, totalNow: now.total, stackCap: MicroBonus.STACK_CAP },
    caps: [
      'Plafond global : le cumul de tous les souvenirs d\'un joueur ne dépasse jamais le plafond de la variante (+0,05 en A, +0,10 le jeudi en B), quel que soit le nombre de souvenirs.',
      'Un seul bonus par type de souvenir : les doubles (#93) n\'ajoutent rien ; un échange ne crée jamais de puissance par la quantité.',
      'Départ de saison protégé (à décider) : aucun bonus les 2 premiers jours d\'une saison, ou seulement au-delà de 50 m.',
      'Rattrapage gratuit pour les joueurs arrivés plus tard : souvenir encore trouvable plus tard ou reçu par échange (#93), jamais contre de l\'argent.',
      'Aucun bonus achetable, aucun lien avec les fragments ou la boutique (#85).',
    ],
    hypotheses: [
      'Gain = blocs détruits en plus à nombre de coups égal (le classement #73 compte les blocs détruits à la main). Pioche de 1 dégât (début de saison) ; Chance 0 ; catalogue de blocs publié.',
      'Simulateur #81 audité le 06/11 (calcul indépendant + Monte-Carlo sur le vrai tirage des blocs). Moyennes exactes, sans tirage au sort.',
      'Moyenne sur la semaine = gain du jour actif × jours actifs ÷ 7, en supposant le même temps de jeu chaque jour.',
      'Chaque saison remet la profondeur à 1 : le début de partie (petits dégâts) revient chaque semaine.',
    ],
  };
}

/**
 * Fiche « ✨ Bonus du souvenir » d'un objet : état réel (toujours inactif en jeu), brouillons #81
 * liés avec leur texte, leur calendrier et leur gain selon la profondeur, deux variantes chiffrées
 * pour CE souvenir seul, et le cumul de tous les souvenirs (même résumé pour chaque fiche).
 */
function itemSheet(eventId, itemId, { nowMs = Date.now() } = {}) {
  const linked = _linkedDrafts().filter(d => d.effect.source.eventId === eventId && d.effect.source.itemId === itemId);
  const describe = e => drafts.preview(e, { nowMs }).text.fr;
  const draftsOut = linked.map((d, i) => {
    const st = MicroBonus.stateAt(d.effect, nowMs, 'fr');
    const permanent = !Object.keys(d.effect.schedule || {}).length;
    return {
      id: d.id, label: d.label, text: describe(d.effect), counted: i === 0,
      kind: permanent ? 'Constant (toujours actif)' : 'Calendaire',
      calendar: permanent ? 'Toujours actif tant que le souvenir est possédé.' : `${MicroBonus.describeSchedule(d.effect.schedule, 'fr')} (heure de Bruxelles).`,
      wouldNow: { active: 'Serait actif maintenant', inactive: 'Serait inactif maintenant', ended: 'Calendrier terminé', upcoming: 'Pas encore commencé' }[st.code] ?? st.text,
      next: MicroBonus.describeNext(d.effect, nowMs, 'fr'),
      gains: _draftGains(d.effect),
    };
  });
  const variants = VARIANTS.map(v => ({
    key: v.key, label: v.label, help: v.help,
    text: MicroBonus.describe({ kind: 'damage_flat', value: v.perType, target: { type: 'all' }, schedule: v.schedule }, 'fr'),
    gains: _gainTable(v.perType),
  }));
  return {
    eventId, itemId,
    status: linked.length
      ? `🔒 Brouillon — inactif en jeu (${linked.length} brouillon${linked.length > 1 ? 's' : ''} lié${linked.length > 1 ? 's' : ''}).`
      : '🔒 Aucun bonus défini — inactif en jeu.',
    drafts: draftsOut,
    multipleWarning: linked.length > 1 ? 'Plusieurs brouillons liés à ce souvenir : avec la règle « un bonus par type », seul le premier (le plus ancien) compterait.' : '',
    variants,
    depths: DEPTHS, bases: BASES,
    cumulative: cumulative({ nowMs }),
    rules: [
      'Possession : le souvenir trouvé reste à vie dans la collection ; seul le calendrier peut suspendre puis réactiver son effet (jamais consommé, jamais 15 minutes).',
      'Un seul bonus par TYPE de souvenir et par joueur : posséder 1 ou 5 exemplaires donne le même bonus.',
      'Échange (#93, futur) : le bonus se recalcule immédiatement à partir de l\'inventaire. Le donneur le garde tant qu\'il lui reste un exemplaire et le perd avec le dernier ; le receveur ne gagne rien s\'il avait déjà ce souvenir. Aucun effet rétroactif : les blocs déjà minés ne sont jamais recalculés.',
      'Tant que le propriétaire n\'a pas approuvé un barème, aucun bonus n\'est transmis au jeu.',
    ],
  };
}

module.exports = { VARIANTS, DEPTHS, BASES, keyOf, resolve, transfer, cumulative, itemSheet };
