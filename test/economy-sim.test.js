/**
 * Tests de l'outil d'audit économique tools/balance/economy-sim.js (ticket #49) : le tirage
 * rapide reproduit les probabilités exactes du jeu (Blocks.spawn), les coffres de la boutique
 * suivent server/chestShop.rollChest, les sources de gemmes sont celles du code, la simulation
 * est reproductible et les variantes proposées ne modifient pas le jeu.
 * Aucun serveur ni base de données.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('path');

const sim = require(path.join(__dirname, '..', 'tools', 'balance', 'economy-sim.js'));
const { SHOP_CHESTS, rollChest } = require(path.join(__dirname, '..', 'server', 'chestShop'));

test('economy-sim : catalogue v3 publié (22 blocs) et gemmes réelles', () => {
  const { G } = sim;
  assert.strictEqual(G.Blocks.TYPES.length, 22);
  const rules = sim.currentRules();
  // 1 gemme par bloc qui en rapporte ; saphir, améthyste et cristal ancien n'en rapportent pas
  assert.deepStrictEqual(rules.gemsPerBlock, { rubis: 1, emeraude: 1, diamant: 1 });
  assert.deepStrictEqual(Array.from(rules.dailyGems), [0, 0, 1, 0, 2, 0, 4]);
  assert.deepStrictEqual(Array.from(rules.autodigCosts, c => c.gems), [0, 0, 4, 8, 18, 35]);
  assert.strictEqual(rules.questGems, 1);
  assert.strictEqual(rules.economy.chestCosts.simple, 800);   // réglage de production du 02/11
});

test('economy-sim : le tirage rapide suit Blocks.spawn (nature avec Chance, PV sans Chance)', () => {
  const { G } = sim;
  const depth = 122, luck = 5;
  G.GameState.upgrades.luck = luck;
  G.GameState.relicBonuses = {};
  G.GameState.blockSeed = 12345;
  G.GameState.blockSeq = 0;
  const N = 40_000;
  let gemReal = 0, hpReal = 0;
  for (let i = 0; i < N; i++) {
    const b = G.Blocks.spawn(depth);
    if (b.type.isGem) gemReal++;
    hpReal += b.hp;
  }
  const odds = sim.oddsAt(depth, luck, 0);
  const random = sim.rng(1);
  let gemFast = 0, hpFast = 0;
  for (let i = 0; i < N; i++) {
    let x = random() * odds.type.cum.at(-1);
    const type = odds.type.types[odds.type.cum.findIndex(c => x <= c)];
    x = random() * odds.hp.cum.at(-1);
    const hpType = odds.hp.types[odds.hp.cum.findIndex(c => x <= c)];
    if (type.isGem) gemFast++;
    hpFast += Math.ceil(hpType.hpBase * (1 + (depth - 1) * 0.12));
  }
  const exact = sim.exactOdds(depth, luck).gem;
  assert.ok(Math.abs(gemReal / N - exact) < 0.004, `jeu ${gemReal / N} vs exact ${exact}`);
  assert.ok(Math.abs(gemFast / N - exact) < 0.004, `outil ${gemFast / N} vs exact ${exact}`);
  assert.ok(Math.abs(hpFast / hpReal - 1) < 0.03, `PV moyens outil/jeu ${hpFast / hpReal}`);
});

test('economy-sim : espérance des coffres de la boutique = rollChest', () => {
  const N = 30_000;
  let coins = 0, frags = 0;
  const data = { coins: 0, relicFragments: 0, relics: { shard_magnet: 2 }, collection: [] };
  for (let i = 0; i < N; i++) {
    data.coins = 1_000; data.shopChestsBought = {}; data.relicFragments = 0;
    const { reward } = rollChest('simple', data, { chest_cost_simple: '1000' });
    if (reward.type === 'coins') coins += reward.amount;
    frags += data.relicFragments;
  }
  const e = sim.chestExpectation(SHOP_CHESTS.simple.table, 2, 1, true);
  assert.ok(Math.abs(coins / N / e.coins - 1) < 0.03, `pièces ${coins / N} vs ${e.coins}`);
  assert.ok(Math.abs(frags / N / e.frags - 1) < 0.05, `fragments ${frags / N} vs ${e.frags}`);
});

test('economy-sim : simulation reproductible et cohérente', () => {
  const rules = sim.currentRules();
  const run = () => sim.simulatePlayers({ profile: sim.PROFILES.regulier, rules, runs: 3, seasons: 2, seed: 11 });
  const a = run(), b = run();
  assert.deepStrictEqual(a, b);
  for (const player of a) {
    for (const m of player) {
      const earned = m.gems.blocks + m.gems.daily + m.gems.missions + m.gems.quest + m.gems.mineChests;
      assert.strictEqual(m.gemsEarned, earned);
      assert.strictEqual(m.gems.mineChests, 0);                 // aucune gemme en coffre aujourd'hui
      assert.ok(m.gemsSpent <= 65, 'Auto-Dig 3→6 : 65 gemmes au plus par saison');
      assert.ok(m.maxDepth > 100);
    }
  }
  // Fin de saison : gemmes plafonnées à 100 (gems_cap)
  const s = sim.simulatePlayers({ profile: sim.PROFILES.assidu, rules, runs: 2, seasons: 4, seed: 3 });
  for (const player of s) {
    for (const m of player) if (m.gemsBeforeCap > 100) assert.strictEqual(m.gemsLostCap, m.gemsBeforeCap - 100);
  }
});

test('economy-sim : les variantes A et B ne modifient pas les règles du jeu', () => {
  const before = JSON.stringify(sim.currentRules().gemsPerBlock);
  const A = sim.VARIANTS.A(sim.currentRules());
  const B = sim.VARIANTS.B(sim.currentRules());
  assert.strictEqual(A.gemsPerBlock.saphir, 1);
  assert.strictEqual(B.autodigCosts[5].gems, 60);
  assert.strictEqual(JSON.stringify(sim.currentRules().gemsPerBlock), before);
  assert.deepStrictEqual(Array.from(sim.G.Balance.AUTODIG, c => c.gems), [0, 0, 4, 8, 18, 35]);
  const h = sim.hourAt({ ...sim.FIXED[1], rules: A }, 20);
  assert.ok(h.meters.p50 > 100 && h.gems.mean > 0);
});

test('economy-sim (04/11) : courbe (b) = actuelle jusqu\'à 200 m puis plus lente ; (c) encore plus lente', () => {
  const { coinScale, COIN_CURVES } = sim;
  for (const d of [1, 2, 50, 122, 199, 200]) {
    assert.strictEqual(coinScale(COIN_CURVES.b, d), coinScale(null, d), `${d} m`);
    assert.strictEqual(coinScale(COIN_CURVES.c, d), coinScale(null, d), `${d} m`);
  }
  assert.ok(Math.abs(coinScale(null, 200) - 10.95) < 1e-9);                 // blocks.js : 1 + 0,05 × 199
  for (const d of [201, 300, 1000, 3000]) {
    assert.ok(coinScale(COIN_CURVES.b, d) < coinScale(null, d));
    assert.ok(coinScale(COIN_CURVES.c, d) < coinScale(COIN_CURVES.b, d));
  }
  assert.ok(Math.abs(coinScale(COIN_CURVES.b, 300) - (10.95 + 100 * 0.02)) < 1e-9);
  assert.ok(Math.abs(coinScale(COIN_CURVES.c, 300) - (10.95 + 100 * 0.01)) < 1e-9);
  // En saison : même graine, moins de pièces avec la courbe (b), rien de changé sous 200 m
  const run = rules => sim.summarize(sim.simulatePlayers({ profile: sim.PROFILES.regulier, rules, runs: 2, seed: 5 }));
  const a = run(sim.currentRules()), b = run(sim.withCurve(sim.currentRules(), 'b'));
  assert.ok(b.coinsEarned.p50 < a.coinsEarned.p50 * 0.8, `${b.coinsEarned.p50} vs ${a.coinsEarned.p50}`);
});

test('economy-sim (04/11) : limites 20 simples / 10 rares / 5 antiques respectées', () => {
  const opts = { chests: 'none', shopBuy: true, shopOpenings: sim.SHOP_OPENINGS.regulier };
  const lim = sim.simulatePlayers({ profile: sim.PROFILES.regulier, rules: sim.COMBOS['A + limites 20/10'](), runs: 3, seasons: 2, seed: 8, options: opts });
  for (const player of lim) {
    for (const m of player) {
      assert.ok(m.shop.simple <= 20 && m.shop.rare <= 10 && m.shop.antique <= 5, JSON.stringify(m.shop));
      assert.strictEqual(m.shop.simple + m.shop.rare + m.shop.antique, m.shopChestsBought);
      assert.ok(m.shop.hitLimit && m.shop.blocked);                       // 60 M de pièces : limites atteintes
    }
  }
  const free = sim.simulatePlayers({ profile: sim.PROFILES.regulier, rules: sim.COMBOS['A seul'](), runs: 3, seasons: 1, seed: 8, options: opts });
  for (const [m] of free) {
    assert.ok(m.shop.antique <= 5);
    assert.strictEqual(m.shopChestsBought, sim.SHOP_OPENINGS.regulier);    // illimité : le budget d'ouvertures limite
    assert.ok(!m.shop.hitLimit && !m.shop.blocked);
  }
});

test('economy-sim (04/11) : combinaisons reproductibles et sans effet sur le jeu', () => {
  const opts = { chests: 'none', shopBuy: true, shopOpenings: 50 };
  const run = () => sim.simulatePlayers({ profile: sim.PROFILES.debutant, rules: sim.COMBOS['A + limites + courbe (c)'](), runs: 3, seasons: 2, seed: 13, options: opts });
  assert.deepStrictEqual(run(), run());
  const rules = sim.currentRules();
  assert.strictEqual(rules.coinCurve, null);
  assert.deepStrictEqual(rules.shopLimits, { simple: null, rare: null, antique: 5 });
  assert.strictEqual(SHOP_CHESTS.simple.maxPerSeason, null);
  assert.strictEqual(SHOP_CHESTS.rare.maxPerSeason, null);
  assert.deepStrictEqual(Object.keys(sim.COMBOS).map(k => sim.COMBOS[k]().id),
    ['actuel', 'actuel+limites l20_10', 'A', 'A+limites l20_10', 'A+limites l20_10+courbe b', 'A+limites l20_10+courbe c']);
});

test('economy-sim (#68, 05/11) : bonus trois missions par palier de profondeur, compté seulement les journées complètes', () => {
  const base = sim.currentRules();
  assert.deepStrictEqual(base.missionSetBands, []);
  const bands = [{ fromDepth: 1, coins: 300, gems: 1 }, { fromDepth: 300, coins: 40000, gems: 2 }];
  const run = rules => sim.simulatePlayers({ profile: sim.PROFILES.debutant, rules, runs: 4, seasons: 1, seed: 21 });
  const a = run(base), b = run({ ...base, missionSetBands: bands });
  let extra = 0;
  a.forEach((player, i) => {
    const [ma] = player, [mb] = b[i];
    const dg = mb.gems.missions - ma.gems.missions;
    assert.ok(dg >= 0 && dg <= 2 * 7, `gemmes de missions +${dg}`);
    extra += dg;
  });
  assert.ok(extra > 0, 'au moins une journée complète sur 4 joueurs');
});
