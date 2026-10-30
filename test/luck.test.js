/**
 * Tests de la Chance (ticket #32) : probabilités exactes des blocs (Blocks.blockOdds), tirage en
 * deux temps (nature avec Chance à +10 %/niveau, PV sans Chance — option A validée), libellé et
 * aperçu de la carte Chance (FR/EN/NL) et outil tools/balance/luck-sim.js (avant/après).
 * Aucun serveur ni base de données.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');

function loadBrowser(lang = 'fr') {
  const ctx = vm.createContext({
    Math, Object, Array, Number, String, Boolean, JSON, Date, Set, Intl,
    console, localStorage: { getItem: () => lang, setItem() {} },
    navigator: { language: lang }, document: { documentElement: {}, querySelectorAll: () => [] },
    GameState: { depth: 100, upgrades: { luck: 0, bag: 0, autodig: 0 }, relicBonuses: {} },
  });
  for (const f of ['i18n.js', 'balance.js', 'blocks.js', 'upgrades.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext('I18n.init()', ctx);
  return vm.runInContext('({ Blocks, Upgrades, GameState, I18n, t })', ctx);
}

test('blockOdds : probabilités exactes, somme = 1, poids des raretés boostées × (1 + 0,1 × Chance)', () => {
  const { Blocks } = loadBrowser();
  for (const depth of [1, 5, 40, 100, 250]) {
    for (const luck of [0, 1, 7, 12]) {
      const odds = Blocks.blockOdds(depth, luck);
      const sum = odds.reduce((s, e) => s + e.p, 0);
      assert.ok(Math.abs(sum - 1) < 1e-12, `somme ${sum} à ${depth} m, Chance ${luck}`);
    }
  }
  // 100 m : 170 de poids commun/peu commun + terre et argile atténuées (2,1 + 1,35, aucune profondeur
  // maximale, #22), 23 de poids rare+ (or 8, bois 6, fer 3, rubis 4, émeraude 2)
  const common = 170 + 2.1 + 1.35;
  assert.ok(Math.abs(Blocks.rareShare(100, 0) - 23 / (common + 23)) < 1e-12);
  assert.ok(Math.abs(Blocks.rareShare(100, 7) - (23 * 1.7) / (common + 23 * 1.7)) < 1e-12);
  assert.strictEqual(Blocks.rareShare(3, 12), 0, 'aucun bloc rare avant 5 m');
});

test('_pickType : fréquences tirées conformes à blockOdds', () => {
  const { Blocks, GameState } = loadBrowser();
  GameState.upgrades.luck = 7;
  const N = 60000;
  const counts = new Map();
  for (let i = 0; i < N; i++) {
    const t = Blocks._pickType(100);
    counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  }
  for (const { type, p } of Blocks.blockOdds(100)) {
    const f = (counts.get(type.name) ?? 0) / N;
    assert.ok(Math.abs(f - p) < 0.012, `${type.name} : ${f} vs ${p}`);
  }
});

test('spawn : PV tirés sans Chance (profondeur neutre), nature et récompense avec Chance', () => {
  const { Blocks, GameState } = loadBrowser();
  const draw = (luck, luckPct = 0) => {
    GameState.upgrades.luck = luck;
    GameState.relicBonuses = { luckPct };
    const N = 40000;
    let hp = 0, rare = 0, reward = 0;
    for (let i = 0; i < N; i++) {
      const b = Blocks.spawn(100);
      assert.strictEqual(b.hp, b.maxHp);
      assert.strictEqual(b.reward, Math.ceil(b.type.reward * (1 + 99 * 0.05)), 'récompense = celle du bloc affiché');
      hp += b.hp; reward += b.reward;
      if (Blocks._BOOSTED_RARITIES.has(b.type.rarityKey)) rare++;
    }
    return { hp: hp / N, rare: rare / N, reward: reward / N, expectedRare: Blocks.rareShare(100, luck) };
  };
  // Espérance exacte des PV sans Chance à 100 m.
  const scale = 1 + 99 * 0.12;
  const expectedHp = Blocks.blockOdds(100, 0).reduce((s, e) => s + e.p * Math.ceil(e.type.hpBase * scale), 0);
  const c0 = draw(0), c12 = draw(12), relic = draw(12, 1.3);
  for (const r of [c0, c12, relic]) {
    assert.ok(Math.abs(r.hp / expectedHp - 1) < 0.03, `PV moyens ${r.hp} vs ${expectedHp}`);
  }
  for (const r of [c0, c12, relic]) {
    assert.ok(Math.abs(r.rare - r.expectedRare) < 0.012, `part rare ${r.rare} vs ${r.expectedRare}`);
  }
  assert.ok(c12.rare > c0.rare * 1.7 && c12.reward > c0.reward * 1.4, 'la Chance enrichit sans ralentir');
  // Résistance minimale inchangée (server/antibot.js s'appuie sur le plus petit hpBase tirable hors
  // blocs atténués) : seuls terre meuble et argile, atténuées au-delà de 12 / 22 m, descendent plus bas.
  GameState.upgrades.luck = 12;
  const faded = new Set(Blocks.TYPES.filter(t => t.fadeFrom != null && 30 > t.fadeFrom).map(t => Math.ceil(t.hpBase * (1 + 29 * 0.12))));
  for (let i = 0; i < 5000; i++) {
    const hp = Blocks.spawn(30).maxHp;
    assert.ok(hp >= Math.ceil(8 * (1 + 29 * 0.12)) || faded.has(hp), String(hp));
  }
});

test('getLuckPreview : part rare maintenant → niveau suivant, relique incluse, null au max', () => {
  const { Upgrades, GameState } = loadBrowser();
  const p0 = Upgrades.getLuckPreview(100, 0);
  assert.strictEqual(p0.depth, 100);
  assert.ok(p0.next > p0.now);
  GameState.relicBonuses.luckPct = 1.3;
  const withRelic = Upgrades.getLuckPreview(100, 0);
  assert.ok(withRelic.now > p0.now, 'la Lentille fêlée augmente la part rare');
  assert.strictEqual(Upgrades.getLuckPreview(100, 12).next, null);
});

test('carte Chance : libellé et aperçu traduits FR/EN/NL, séparateur décimal de la langue', () => {
  const expected = {
    fr: ['À 100m : 11,7% de blocs rares\u00a0→\u00a012,7%', 'À 100m : 22,6% de blocs rares', 'Aucun bloc rare avant 5m', 'Plus de rares, sans ralentir'],
    en: ['At 100m: 11.7% rare blocks\u00a0→\u00a012.7%', 'At 100m: 22.6% rare blocks', 'No rare blocks before 5m', 'More rares, no slowdown'],
    nl: ['Op 100m: 11,7% zeldzame blokken\u00a0→\u00a012,7%', 'Op 100m: 22,6% zeldzame blokken', 'Geen zeldzame blokken vóór 5m', 'Meer zeldzame, niet trager'],
  };
  for (const [lang, [mid, max, none, desc]] of Object.entries(expected)) {
    const { Upgrades, GameState, I18n } = loadBrowser(lang);
    assert.strictEqual(I18n.getCurrent(), lang);
    const luck = Upgrades.DEFS.find(d => d.id === 'luck');
    GameState.depth = 100;
    assert.strictEqual(luck.preview(0), mid);
    assert.strictEqual(luck.preview(12), max);
    GameState.depth = 3;
    assert.strictEqual(luck.preview(4), none);
    // Plus de « +140 % chance de blocs rares » (un poids, pas une probabilité).
    assert.strictEqual(luck.describe(7), desc);
    assert.ok(!/\d/.test(luck.describe(7)));
  }
});

test('luck-sim : reproductible ; avant #32 la Chance ralentissait, après elle est neutre en profondeur', () => {
  const sim = require('../tools/balance/luck-sim');
  const o = { depth0: 100, seconds: 1800, damage: 9, cps: 6, autodig: 4, bag: 8 };
  const a = sim.simulate({ ...o, luck: 7, seed: 42 });
  const b = sim.simulate({ ...o, luck: 7, seed: 42 });
  assert.deepStrictEqual(a, b, 'même graine, même résultat');
  const run = (luck, variant) => sim.distribution({ ...o, luck, variant }, 30);
  const old0 = run(0, 'avant'), old7 = run(7, 'avant'), new0 = run(0), new7 = run(7);
  assert.ok(old7.meters.mean < old0.meters.mean * 0.92, 'avant : Chance 7 descendait nettement moins vite');
  assert.ok(Math.abs(new7.meters.mean / new0.meters.mean - 1) < 0.03, 'après : profondeur neutre');
  assert.ok(new7.coins.mean > new0.coins.mean * 1.3, 'après : Chance 7 rapporte toujours plus de pièces');
  // Espérances exactes : PV moyens identiques à toute Chance, +35 % avant à Chance 12.
  assert.strictEqual(sim.expectedAt(100, 12).meanHp, sim.expectedAt(100, 0).meanHp);
  assert.ok(sim.expectedAt(100, 12, {}, 'avant').meanHp > sim.expectedAt(100, 0).meanHp * 1.3);
});
