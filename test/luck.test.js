/**
 * Tests de l'audit Chance (ticket #32) : probabilités exactes des blocs (Blocks.blockOdds),
 * tirage inchangé, aperçu du niveau suivant sur la carte Chance (FR/EN/NL) et outil de
 * simulation tools/balance/luck-sim.js (reproductible, branché sur le vrai code du jeu).
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

test('blockOdds : probabilités exactes, somme = 1, poids des raretés boostées × (1 + 0,2 × Chance)', () => {
  const { Blocks } = loadBrowser();
  for (const depth of [1, 5, 40, 100, 250]) {
    for (const luck of [0, 1, 7, 12]) {
      const odds = Blocks.blockOdds(depth, luck);
      const sum = odds.reduce((s, e) => s + e.p, 0);
      assert.ok(Math.abs(sum - 1) < 1e-12, `somme ${sum} à ${depth} m, Chance ${luck}`);
    }
  }
  // 100 m : 170 de poids commun/peu commun, 23 de poids rare+ (or 8, bois 6, fer 3, rubis 4, émeraude 2)
  assert.ok(Math.abs(Blocks.rareShare(100, 0) - 23 / 193) < 1e-12);
  assert.ok(Math.abs(Blocks.rareShare(100, 7) - (23 * 2.4) / (170 + 23 * 2.4)) < 1e-12);
  assert.strictEqual(Blocks.rareShare(3, 12), 0, 'aucun bloc rare avant 5 m');
});

test('_pickType : fréquences tirées conformes à blockOdds (tirage inchangé)', () => {
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

test('carte Chance : aperçu traduit FR/EN/NL, séparateur décimal de la langue', () => {
  const expected = {
    fr: ['À 100m : 11,9% de blocs rares\u00a0→\u00a014,0%', 'À 100m : 31,5% de blocs rares', 'Aucun bloc rare avant 5m'],
    en: ['At 100m: 11.9% rare blocks\u00a0→\u00a014.0%', 'At 100m: 31.5% rare blocks', 'No rare blocks before 5m'],
    nl: ['Op 100m: 11,9% zeldzame blokken\u00a0→\u00a014,0%', 'Op 100m: 31,5% zeldzame blokken', 'Geen zeldzame blokken vóór 5m'],
  };
  for (const [lang, [mid, max, none]] of Object.entries(expected)) {
    const { Upgrades, GameState, I18n } = loadBrowser(lang);
    assert.strictEqual(I18n.getCurrent(), lang);
    const luck = Upgrades.DEFS.find(d => d.id === 'luck');
    GameState.depth = 100;
    assert.strictEqual(luck.preview(0), mid);
    assert.strictEqual(luck.preview(12), max);
    GameState.depth = 3;
    assert.strictEqual(luck.preview(4), none);
  }
});

test('luck-sim : reproductible et cohérent avec le constat du rapport #32', () => {
  const sim = require('../tools/balance/luck-sim');
  const o = { depth0: 100, seconds: 1800, damage: 9, cps: 6, autodig: 4, bag: 8 };
  const a = sim.simulate({ ...o, luck: 7, seed: 42 });
  const b = sim.simulate({ ...o, luck: 7, seed: 42 });
  assert.deepStrictEqual(a, b, 'même graine, même résultat');
  const d0 = sim.distribution({ ...o, luck: 0 }, 20);
  const d7 = sim.distribution({ ...o, luck: 7 }, 20);
  assert.ok(d7.meters.mean < d0.meters.mean, 'Chance 7 descend moins vite que Chance 0');
  assert.ok(d7.coins.mean > d0.coins.mean, 'Chance 7 rapporte plus de pièces');
  const e0 = sim.expectedAt(100, 0), e12 = sim.expectedAt(100, 12);
  assert.ok(e12.meanHp > e0.meanHp * 1.3, 'PV moyens +35 % à Chance 12');
});
