/**
 * Recette #81-B (06/11/2026) : audit mathématique du simulateur de micro-bonus.
 *
 * Le simulateur doit reproduire le moteur réel (public/js/blocks.js) : la nature d'un bloc (ce que
 * vise le bonus) et sa résistance (PV) sont tirées SÉPARÉMENT (#32). Trois vérifications :
 *   1. calcul alternatif indépendant (table de blocs recopiée, aucune fonction du moteur) ;
 *   2. Monte-Carlo sur le vrai Blocks.spawn (graine fixe, reproductible) ;
 *   3. bornes : vrai zéro, profondeurs, Chance, dates repères (changements d'heure inclus).
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-mb-81b-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db = require('../server/db');
const MicroBonus = require('../public/js/microBonus');
const drafts = require('../server/microBonusDrafts');
const blockCatalog = require('../server/blockCatalog');

db.initDb();
drafts.init();
const ORIGIN = blockCatalog.originTypes();
const PIERRE = { kind: 'damage_flat', value: 0.25, target: { type: 'block', id: 'pierre' }, schedule: {} };

// ── 1. Calcul indépendant ────────────────────────────────────────────────────
// Table recopiée à la main du catalogue d'origine (= catalogue publié v4 jusqu'à 149 m).
// [id, rareté, PV de base, profondeur min., poids, atténué au-delà de, poids atténué]
const TABLE = [
  ['terre_meuble', 'commun', 3, 1, 70, 12, 2.1], ['argile', 'commun', 6, 4, 45, 22, 1.35],
  ['pierre', 'commun', 12, 5, 60], ['gres', 'commun', 20, 12, 40], ['granite', 'peu-commun', 38, 25, 28],
  ['charbon', 'peu-commun', 28, 8, 22], ['minerai_fer', 'peu-commun', 55, 20, 15], ['minerai_or', 'rare', 90, 40, 8],
  ['vieille_caisse', 'commun', 8, 1, 5], ['coffre_bois', 'rare', 18, 5, 6], ['coffre_fer', 'epique', 40, 30, 3],
  ['rubis', 'epique', 110, 35, 4], ['emeraude', 'legendaire', 200, 70, 2], ['diamant', 'legendaire', 350, 120, 1],
];

/** Espérance des coups par bloc, écrite sans aucune fonction du jeu ni du serveur. */
function independent(depth, base, bonus, targetId, luck = 0) {
  const rows = TABLE.filter(r => depth >= r[3]).map(([id, rar, hpb, , w, ff, fw]) => ({
    id, hp: Math.ceil(hpb * (1 + (depth - 1) * 0.12)),
    w: ff != null && depth > ff ? fw : w,
    boost: ['rare', 'epique', 'legendaire'].includes(rar),
  }));
  const W = rows.reduce((s, r) => s + r.w, 0);
  const WL = rows.reduce((s, r) => s + r.w * (r.boost ? 1 + 0.1 * luck : 1), 0);
  const share = rows.filter(r => r.id === targetId).reduce((s, r) => s + r.w * (r.boost ? 1 + 0.1 * luck : 1), 0) / WL;
  // ceil(PV / dégâts) en centièmes entiers : ex. 83 PV ÷ 1,25 → ceil(8300 / 125) = 67
  const coups = (hp, d) => Math.ceil((hp * 100) / Math.round(d * 100));
  let sans = 0, vise = 0;
  for (const r of rows) { sans += r.w / W * coups(r.hp, base); vise += r.w / W * coups(r.hp, base + bonus); }
  return { sans, avec: share * vise + (1 - share) * sans, share };
}

test('table recopiée identique au catalogue d\'origine (le calcul indépendant porte sur les vraies valeurs)', () => {
  for (const [id, rar, hpb, min, w, ff, fw] of TABLE) {
    const t = ORIGIN.find(x => x.id === id);
    assert.ok(t, id);
    assert.deepStrictEqual([t.rarity ?? t.rarityKey, t.hpBase, t.minDepth, t.weight, t.fadeFrom ?? undefined, t.fadeWeight || undefined],
      [rar, hpb, min, w, ff, fw], id);
  }
});

test('50 m, +0,25 sur Pierre : simulateur = calcul indépendant, pour chaque dégât de base', () => {
  const sim = drafts.simulate(PIERRE, { depth: 50, types: ORIGIN });
  for (const r of sim.rows) {
    const x = independent(50, r.base, 0.25, 'pierre');
    assert.strictEqual(r.hitsBefore, +x.sans.toFixed(2), `base ${r.base} sans`);
    assert.strictEqual(r.hitsAfter, +x.avec.toFixed(2), `base ${r.base} avec`);
    assert.strictEqual(r.fewerHitsPct, +((1 - x.avec / x.sans) * 100).toFixed(2), `base ${r.base} %`);
    assert.strictEqual(r.moreBlocksPct, +((x.sans / x.avec - 1) * 100).toFixed(2), `base ${r.base} blocs en plus`);
    assert.strictEqual(r.savedPer100, +((x.sans - x.avec) * 100).toFixed(1), `base ${r.base} /100 blocs`);
    assert.strictEqual(r.targetShare, +(x.share * 100).toFixed(1));
  }
  // Valeurs de référence du rapport #81-B (ancienne simulation : 188,98 / 95,68 / 38,89 / 19,91 / 13,47 / 8,3)
  assert.deepStrictEqual(sim.rows.map(r => [r.base, r.hitsBefore, r.hitsAfter, r.fewerHitsPct]), [
    [1, 193.92, 182.12, 6.09], [2, 97.23, 93.94, 3.38], [5, 39.2, 38.62, 1.48],
    [10, 19.91, 19.77, 0.67], [15, 13.47, 13.43, 0.32], [25, 8.3, 8.29, 0.13],
  ]);
  assert.strictEqual(sim.rows[0].targetShare, 30.9);   // 60 / 194,45 = 30,86 %
  assert.ok(sim.rows.every(r => !r.zero), 'aux dégâts 10/15/25 le gain est faible mais réel (pas 0 %)');
});

test('autres profondeurs et Chance : simulateur = calcul indépendant', () => {
  for (const depth of [5, 12, 13, 30, 75, 149]) {
    for (const luck of [0, 5, 12]) {
      const sim = drafts.simulate(PIERRE, { depth, luck, types: ORIGIN });
      for (const r of sim.rows) {
        const x = independent(depth, r.base, 0.25, 'pierre', luck);
        assert.strictEqual(r.hitsAfter, +x.avec.toFixed(2), `${depth} m, Chance ${luck}, base ${r.base}`);
        assert.strictEqual(r.targetShare, +(x.share * 100).toFixed(1));
      }
    }
  }
  const s0 = drafts.simulate(PIERRE, { depth: 50, luck: 0, types: ORIGIN }).rows[0].targetShare;
  const s12 = drafts.simulate(PIERRE, { depth: 50, luck: 12, types: ORIGIN }).rows[0].targetShare;
  assert.ok(s12 < s0, 'la Chance diminue la part de Pierre (bloc commun)');
});

test('vrai zéro : bloc absent à cette profondeur, ou aucun seuil franchi', () => {
  const absent = drafts.simulate(PIERRE, { depth: 4, types: ORIGIN });   // Pierre dès 5 m
  assert.ok(absent.rows.every(r => r.zero && r.targetShare === 0 && r.hitsAfter === r.hitsBefore));
  // 1 m : PV 3 et 8 ; à 25 dégâts, 1 coup avec ou sans +0,01
  const tiny = drafts.simulate({ ...PIERRE, value: 0.01, target: { type: 'all' } }, { depth: 1, bases: [25], types: ORIGIN });
  assert.deepStrictEqual([tiny.rows[0].zero, tiny.rows[0].changedShare, tiny.rows[0].fewerHitsPct], [true, 0, 0]);
  const ex = drafts.explain(tiny);
  assert.ok(ex.some(t => /vrai zéro/.test(t)), ex.join('\n'));
});

// ── 2. Monte-Carlo sur le vrai moteur ────────────────────────────────────────

function engine() {
  const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, Date, JSON, Math, Object, Array, Number, String, Boolean, Set, Map, Intl,
    I18n: { getCurrent: () => 'fr' } });
  for (const f of ['gameState.js', 'microBonus.js', 'blocks.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8'), ctx, { filename: f });
  return vm.runInContext('({ GameState, Blocks, MicroBonus })', ctx);
}

test('Monte-Carlo (Blocks.spawn réel, 20 000 blocs) : coups économisés conformes au simulateur', () => {
  const { GameState, Blocks, MicroBonus: MB } = engine();
  GameState.blockSeed = 81_2026;
  GameState.blockSeq = 0;
  const N = 20_000;
  const bases = [1, 10];
  const saved = bases.map(() => 0);
  for (let i = 0; i < N; i++) {
    const b = Blocks.spawn(50);
    bases.forEach((base, k) => {
      // comme main.js : bonus selon la nature visible du bloc (Blocks.current.type)
      const dmg = MB.clickDamage(base, [PIERRE], { block: b.type });
      saved[k] += Blocks.hitsToBreak(b.hp, base) - Blocks.hitsToBreak(b.hp, dmg);
    });
  }
  const sim = drafts.simulate(PIERRE, { depth: 50, bases, types: ORIGIN });
  bases.forEach((base, k) => {
    const r = sim.rows[k];
    const mc = saved[k] / N * 100;               // coups économisés pour 100 blocs
    const se = r.savedPer100Sd / Math.sqrt(N / 100);
    assert.ok(Math.abs(mc - r.savedPer100) < 4 * se, `base ${base} : Monte-Carlo ${mc.toFixed(1)} vs simulateur ${r.savedPer100} (± ${se.toFixed(2)})`);
  });
  // L'ancien modèle (PV liés à la nature) annonçait 494 coups/100 blocs à base 1 et 0 à base 10 : écarté
  assert.ok(saved[0] / N * 100 > 1000 && saved[1] > 0);
});

// ── 3. Explications et dates repères ─────────────────────────────────────────

test('explications : exemple 5 PV, moyenne pondérée, chiffres repris de la simulation', () => {
  const sim = drafts.simulate(PIERRE, { depth: 50, types: ORIGIN });
  const ex = drafts.explain(sim);
  assert.match(ex[0], /5 ÷ 1,25 = 4.*4 coups : 1 coup de moins/);
  assert.match(ex[1], /30,9 % × 155,68 \+ 69,1 % × 193,92 ≈ 182,12/);
  assert.match(ex[2], /1\s180 coups économisés pour 100 blocs/);
  assert.match(ex[3], /83 PV ÷ 25 = 3,32 → 4 coups ; ÷ 25,25 = 3,29 → toujours 4 coups/);
  const small = drafts.explain(drafts.simulate({ ...PIERRE, value: 0.1 }, { depth: 50, types: ORIGIN }));
  assert.match(small[0], /5 ÷ 1,1 = 4,55.*5 coups : aucun coup de moins/);
  const hyp = drafts.hypotheses(sim);
  assert.ok(hyp.some(h => /tirées séparément/.test(h)) && hyp.some(h => /Chance au niveau 0/.test(h)));
});

test('dates repères : bornes incluses à 00:00 / 23:59 Bruxelles, changements d\'heure compris', () => {
  const s = drafts.stateSamples({ ...PIERRE, schedule: { from: '2026-03-29', to: '2026-10-25' } }, Date.parse('2026-11-06T12:00:00Z'));
  const by = l => s.find(x => x.label.startsWith(l));
  assert.strictEqual(by('Veille du début').code, 'upcoming');
  assert.strictEqual(by('Début').code, 'active');
  assert.strictEqual(by('Fin').code, 'active');
  assert.strictEqual(by('Lendemain de la fin').code, 'ended');
  assert.match(by('Début').label, /29\/03\/2026 00:00/);
  assert.match(by('Lendemain de la fin').label, /26\/10\/2026 00:00/);
  // un seul jour, en hiver (UTC+1) : actif de 00:00 à 23:59 seulement
  const one = drafts.stateSamples({ ...PIERRE, schedule: { from: '2026-12-24', to: '2026-12-24' } }, Date.parse('2026-11-06T12:00:00Z'));
  assert.deepStrictEqual(one.slice(-4).map(x => x.code), ['upcoming', 'active', 'active', 'ended']);
  // vocabulaire : jamais « Actif » seul pour un brouillon
  assert.ok(s.every(x => /^(Serait|Pas encore)/.test(x.text)), JSON.stringify(s));
  const p = drafts.preview(PIERRE, { depth: 50, nowMs: Date.parse('2026-11-06T12:00:00Z') });
  assert.strictEqual(p.state.would, 'Serait actif');
  assert.ok(p.explain.length >= 3 && p.hypotheses.length === 4 && p.simulation.blocks.length > 0);
});

test('souvenir lié : liste lisible des objets d\'événements, lien inconnu signalé', () => {
  const sum = drafts.adminSummary();
  assert.ok(Array.isArray(sum.souvenirs));
  assert.strictEqual(sum.luckMax, 12);
  const p = drafts.preview({ ...PIERRE, source: { eventId: 'noel_test', itemId: 'boule_test' } }, { depth: 50 });
  assert.ok(p.warnings.some(w => /introuvable/.test(w)));
});
