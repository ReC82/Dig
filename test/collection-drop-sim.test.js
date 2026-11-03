/**
 * Outil tools/balance/collection-drop-sim.js (#39, demande du propriétaire du 03/11) : le barème
 * BASE reprend le brouillon Saint-Martin relevé en production, le tirage reproduit
 * Collection.tryDrop (au plus un objet par bloc, origines d'abord), la simulation est
 * reproductible et le barème testé ne change pas la partie simulée. Aucun serveur ni base.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('path');

const ds = require(path.join(__dirname, '..', 'tools', 'balance', 'collection-drop-sim.js'));
const sim = require(path.join(__dirname, '..', 'tools', 'balance', 'economy-sim.js'));

test('BASE = brouillon Saint-Martin du 03/11 (6 objets, ordre du catalogue)', () => {
  assert.deepStrictEqual(ds.SCALES.BASE.items.map(i => [i.id, i.rarity, i.from.join('+'), i.minDepth, i.chance]), [
    ['lanterne_betterave', 'commun', 'terre+pierre', 5, 0.03],
    ['plume_oie_bavarde', 'peu-commun', 'pierre+minerai', 20, 0.02],
    ['demi_manteau_martin', 'legendaire', 'gemme', 100, 0.05],
    ['fer_cheval_martin', 'rare', 'minerai', 40, 0.015],
    ['bonbon_porte_a_porte', 'commun', 'terre+pierre', 5, 0.03],
    ['lampion_chante_faux', 'peu-commun', 'pierre+minerai', 20, 0.02],
  ]);
  for (const k of Object.keys(ds.SCALES)) assert.strictEqual(ds.SCALES[k].items.length, 6, k);
});

test('reproductible ; même flux de blocs quel que soit le barème', () => {
  const a = ds.run(['BASE', 'PROGRESSIF'], ds.PROFILES.debutant, { runs: 6 });
  const b = ds.run(['BASE', 'PROGRESSIF'], ds.PROFILES.debutant, { runs: 6 });
  assert.deepStrictEqual(a, b);
  assert.deepStrictEqual(a.BASE.eligible, a.PROGRESSIF.eligible);
  // Communs : trouvés par presque tous dès 5 m ; ne dépasse jamais 100 %
  for (const v of Object.values(a.BASE.found)) assert.ok(v >= 0 && v <= 1);
  assert.ok(a.BASE.found.lanterne_betterave >= 0.8);
});

test('le crochet par bloc ne change pas la partie simulée par #49', () => {
  const rules = sim.currentRules();
  const plain = sim.simulatePlayers({ profile: sim.PROFILES.debutant, rules, runs: 2, seed: 5 });
  let blocks = 0;
  const hooked = sim.simulatePlayers({ profile: sim.PROFILES.debutant, rules, runs: 2, seed: 5, options: { onBlock: () => { blocks++; } } });
  assert.deepStrictEqual(hooked, plain);
  assert.ok(blocks > 100);
});

test('variantes du 03/11 14:23 : ACCESSIBLE = valeurs seules ; CROISSANT = chance croissante (pityStep)', () => {
  assert.ok(ds.SCALES.ACCESSIBLE.items.every(i => !i.pityStep));
  const leg = ds.SCALES.CROISSANT.items.find(i => i.rarity === 'legendaire');
  assert.deepStrictEqual([leg.chance, leg.pityStep, leg.minDepth], [0.03, 0.003, 100]);
  // Même départ (3 %) : la chance croissante ne peut que faire trouver le légendaire plus souvent
  ds.SCALES.FLAT3 = { label: 'test', items: ds.SCALES.CROISSANT.items.map(i => ({ ...i, pityStep: 0 })) };
  try {
    const r = ds.run(['FLAT3', 'CROISSANT'], ds.PROFILES.regulier, { runs: 40 });
    assert.ok(r.CROISSANT.found.demi_manteau_martin >= r.FLAT3.found.demi_manteau_martin);
    const byDay = r.CROISSANT.foundByDay.demi_manteau_martin;
    assert.strictEqual(byDay[6], r.CROISSANT.found.demi_manteau_martin);
    for (let d = 1; d < 7; d++) assert.ok(byDay[d] >= byDay[d - 1]);
  } finally { delete ds.SCALES.FLAT3; }
});
