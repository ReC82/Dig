/**
 * Tests unitaires de public/js/save.js (ticket #18) : sérialisation unique (seasonStats et
 * shopChestsBought conservés, cf. audit B9), aller-retour sans perte et purge à la déconnexion.
 * Les scripts du navigateur sont exécutés dans un contexte vm avec un localStorage factice.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

function loadBrowserScripts() {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const ctx = vm.createContext({ localStorage, Date, JSON, Math, Object, Array, Number, String, Boolean });
  for (const f of ['gameState.js', 'save.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
    vm.runInContext(`${src}\nthis.${f === 'save.js' ? 'Save = Save' : 'GameState = GameState'};`, ctx);
  }
  return { ctx, store };
}

test('serialize() contient seasonStats et shopChestsBought, et l\'aller-retour est sans perte', () => {
  const { ctx } = loadBrowserScripts();
  const { GameState, Save } = ctx;
  GameState.coins = 1234;
  GameState.depth = 17;
  GameState.shopChestsBought.rare = 2;
  GameState.seasonStats.seasonId = 9;
  GameState.seasonStats.maxDepth = 17;
  GameState.monetization.pickaxeSkin = 'golden';

  const data = Save.serialize(42);
  assert.strictEqual(data.lastSaveTime, 42);
  assert.strictEqual(data.saveVersion, Save.SAVE_VERSION);
  assert.strictEqual(data.shopChestsBought.rare, 2);
  assert.strictEqual(data.seasonStats.seasonId, 9);

  const copy = JSON.parse(JSON.stringify(data));
  GameState.reset();
  Save.loadFromData(copy);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(Save.serialize(42))), copy);
});

test('writeLocal() écrit sans déclencher onSave ; un onglet désactivé n\'écrit plus rien', () => {
  const { ctx, store } = loadBrowserScripts();
  const { GameState, Save } = ctx;
  let calls = 0;
  Save.onSave = () => { calls++; };
  GameState.coins = 5;
  Save.writeLocal(7);
  assert.strictEqual(JSON.parse(store.get(Save.KEY)).coins, 5);
  assert.strictEqual(calls, 0);

  Save.save();
  assert.strictEqual(calls, 1);

  Save.disabled = true;
  GameState.coins = 999;
  Save.save();
  Save.writeLocal();
  assert.strictEqual(JSON.parse(store.get(Save.KEY)).coins, 5);
  assert.strictEqual(calls, 1);
});

test('purge() : progression, cosmétiques et stats de saison remis à zéro, save locale supprimée', () => {
  const { ctx, store } = loadBrowserScripts();
  const { GameState, Save } = ctx;
  GameState.coins = 50;
  GameState.gems = 3;
  GameState.monetization.pickaxeSkin = 'diamond';
  GameState.seasonStats.maxDepth = 30;
  Save.save();
  assert.ok(store.has(Save.KEY));

  Save.purge();
  assert.ok(!store.has(Save.KEY));
  assert.strictEqual(GameState.coins, 0);
  assert.strictEqual(GameState.gems, 0);
  assert.strictEqual(GameState.monetization.pickaxeSkin, null);
  assert.strictEqual(GameState.seasonStats.maxDepth, 0);
});
