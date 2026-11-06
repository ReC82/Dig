/**
 * Simulateur pay-to-win du lot de 10 fragments (#85) : reproductible, sans effet sur le jeu,
 * l'écart payeur / non-payeur ne vient que des fragments ajoutés (mêmes graines).
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const sim    = require('../tools/balance/economy-sim');
const packs  = require('../tools/balance/fragment-pack-sim');
const { variantRules } = require('../tools/balance/fragment-rarity-sim');

test('emploi du temps : heures de jeu cohérentes avec le profil', () => {
  for (const pid of packs.PROFILE_IDS) {
    const o = sim.PROFILES[pid];
    const weekH = o.days.length * (o.activeMin + o.idleMin) / 60;
    assert.ok(Math.abs(packs.playedAt(o, 7 * 86_400) / 3600 - weekH) < 1e-9, pid);
    assert.strictEqual(packs.playedAt(o, 0), 0);
  }
});

test('mêmes graines : 0 lot identique, achats ⇒ jamais moins de reliques ; mission + 1 lot = 2 lots en S1', () => {
  const rules = variantRules('actuel');
  const sc = Object.fromEntries(packs.SCENARIOS.map(s => [s.id, s]));
  for (let r = 0; r < 4; r++) {
    const a = packs.playOne('debutant', rules, sc.none.packsAt, r);
    const b = packs.playOne('debutant', rules, sc.none.packsAt, r);
    assert.deepStrictEqual(a, b, 'reproductible');
    const one = packs.playOne('debutant', rules, sc.once1.packsAt, r);
    assert.ok(one.seasons[0].relics >= a.seasons[0].relics);
    const m1 = packs.playOne('debutant', rules, sc.missionOnce1.packsAt, r, sc.missionOnce1.freeAt);
    const two = packs.playOne('debutant', rules, sc.once2.packsAt, r);
    assert.deepStrictEqual(m1.seasons, two.seasons);
  }
});

test('rapport : toutes les lignes, aucun accès au jeu ni à une base', () => {
  const { markdown, all } = packs.report({ runs: 6, variants: ['actuel'] });
  assert.match(markdown, /Obtenir 10 fragments gratuitement/);
  for (const s of packs.SCENARIOS) assert.ok(markdown.includes(s.label), s.label);
  assert.deepStrictEqual(Object.keys(all).sort(), ['assidu|actuel', 'debutant|actuel', 'regulier|actuel']);
  assert.strictEqual(all['regulier|actuel'].scenarios.each10[3].cumulPacks, 40);
});
