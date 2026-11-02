/**
 * Boost de pièces : un nouveau boost ne réduit jamais la durée restante (ticket #47).
 * Charge public/js/gameState.js (et chests.js) dans un contexte isolé avec une
 * horloge simulée.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MIN  = 60_000;
const T0   = 1_800_000_000_000;

function load(now = T0) {
  const clock = { now };
  const ctx = vm.createContext({ console, Date: { now: () => clock.now } });
  vm.runInContext(
    `${read('public/js/gameState.js')}\n${read('public/js/chests.js')}\n` +
    'this.GameState = GameState; this.Chests = Chests;', ctx);
  return { GameState: ctx.GameState, Chests: ctx.Chests, clock };
}

const remaining = (GS, clock) => GS.coinBoost.expiresAt - clock.now;

test('#47 : ×2 avec 6 min restantes + coffre ×2 3 min → 9 min, jamais 3', () => {
  const { GameState, Chests, clock } = load();
  GameState.setCoinBoost(2, 10 * MIN);
  clock.now += 4 * MIN;                                  // 6 min restantes
  assert.strictEqual(remaining(GameState, clock), 6 * MIN);

  // Coffre-bloc rare dont le tirage tombe sur « boost ×2 3 min »
  const row  = Chests.TABLES.rare.find(r => r.type === 'boost' && r.mult === 2);
  assert.ok(row, 'la table rare contient un boost ×2');
  const total = Chests.TABLES.rare.reduce((s, r) => s + r.weight, 0);
  let before = 0;
  for (const r of Chests.TABLES.rare) { if (r === row) break; before += r.weight; }
  const reward = Chests.open('rare', () => (before + row.weight / 2) / total);

  assert.strictEqual(reward.type, 'boost');
  assert.strictEqual(remaining(GameState, clock), 6 * MIN + row.minutes * MIN);
  assert.strictEqual(GameState.getCoinBoostMultiplier(), 2);
});

test('aucun boost actif : durée = récompense', () => {
  const { GameState, clock } = load();
  GameState.setCoinBoost(2, 3 * MIN);
  assert.strictEqual(remaining(GameState, clock), 3 * MIN);
  assert.strictEqual(GameState.getCoinBoostMultiplier(), 2);
});

test('boost expiré : repart de maintenant, pas de l’ancienne expiration', () => {
  const { GameState, clock } = load();
  GameState.setCoinBoost(3, 5 * MIN);
  clock.now += 20 * MIN;
  assert.strictEqual(GameState.getCoinBoostMultiplier(), 1);
  GameState.setCoinBoost(2, 3 * MIN);
  assert.strictEqual(remaining(GameState, clock), 3 * MIN);
  assert.strictEqual(GameState.coinBoost.multiplier, 2);
});

test('gain plus long ou plus court : la durée restante ne diminue jamais', () => {
  for (const [left, gain] of [[1, 15], [6, 3], [6, 6], [20, 1]]) {
    const { GameState, clock } = load();
    GameState.setCoinBoost(2, left * MIN);
    const before = remaining(GameState, clock);
    GameState.setCoinBoost(2, gain * MIN);
    assert.ok(remaining(GameState, clock) >= before, `${left} min + ${gain} min`);
    assert.strictEqual(remaining(GameState, clock), (left + gain) * MIN);
  }
});

test('multiplicateurs différents : le plus fort est conservé, la durée s’ajoute', () => {
  const a = load();
  a.GameState.setCoinBoost(3, 5 * MIN);
  a.GameState.setCoinBoost(2, 3 * MIN);                  // ×2 pendant un ×3
  assert.strictEqual(a.GameState.getCoinBoostMultiplier(), 3);
  assert.strictEqual(remaining(a.GameState, a.clock), 8 * MIN);

  const b = load();
  b.GameState.setCoinBoost(2, 6 * MIN);
  b.GameState.setCoinBoost(3, 5 * MIN);                  // ×3 pendant un ×2
  assert.strictEqual(b.GameState.getCoinBoostMultiplier(), 3);
  assert.strictEqual(remaining(b.GameState, b.clock), 11 * MIN);
});

test('valeurs invalides : boost actif inchangé', () => {
  const { GameState } = load();
  GameState.setCoinBoost(2, 6 * MIN);
  const snap = { ...GameState.coinBoost };
  for (const [m, d] of [[2, 0], [2, -MIN], [2, NaN], [1, MIN], [NaN, MIN], [2, undefined]]) {
    GameState.setCoinBoost(m, d);
    assert.deepStrictEqual({ ...GameState.coinBoost }, snap);
  }
});

test('toutes les sources passent par setCoinBoost (aucune écriture directe de expiresAt)', () => {
  const files = ['main.js', 'chests.js', 'daily.js', 'monetization.js'];
  for (const f of files) {
    const src = read(`public/js/${f}`);
    assert.ok(!/coinBoost\.expiresAt\s*[+\-]?=(?!=)/.test(src), `${f} écrit coinBoost.expiresAt directement`);
  }
  const main = read('public/js/main.js');
  assert.match(main, /_applyShopChestReward[\s\S]*?setCoinBoost\(reward\.mult/);
  assert.match(main, /btn-bonus-boost[\s\S]*?setCoinBoost\(2, 2 \* 60_000\)/);
});
