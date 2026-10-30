/**
 * Boutique payante sans fournisseur de paiement (ticket #11).
 * Charge public/js/monetization.js dans un contexte isolé avec un GameState
 * factice et vérifie qu'aucun article (gemmes, skins, boosts) n'est accordé.
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

function load() {
  const boosts = [];
  const GameState = {
    gems: 7,
    monetization: { adLastWatched: 0, pickaxeSkin: null },
    setCoinBoost(mult, ms) { boosts.push({ mult, ms }); },
  };
  const ctx = vm.createContext({ GameState, console });
  vm.runInContext(`${read('public/js/monetization.js')}\nthis.Monetization = Monetization;`, ctx);
  return { Monetization: ctx.Monetization, GameState, boosts };
}

test('les paiements sont désactivés par défaut', () => {
  const { Monetization } = load();
  assert.strictEqual(Monetization.PAYMENTS_ENABLED, false);
  assert.strictEqual(Monetization._fakePurchase, undefined);
});

test('aucun article du catalogue n\'est accordé sans paiement', () => {
  const { Monetization, GameState, boosts } = load();
  const types = new Set(Monetization.SHOP_ITEMS.map(i => i.type));
  assert.deepStrictEqual([...types].sort(), ['boost', 'gems', 'skin']);

  for (const item of Monetization.SHOP_ITEMS) {
    let success = 0, cancel = 0;
    const r = Monetization.purchase(item.id, () => { success++; }, () => { cancel++; });
    assert.strictEqual(r, false, item.id);
    assert.strictEqual(success, 0, `${item.id} : onSuccess appelé`);
    assert.strictEqual(cancel, 1, `${item.id} : onCancel non appelé`);
  }
  assert.strictEqual(GameState.gems, 7);
  assert.strictEqual(GameState.monetization.pickaxeSkin, null);
  assert.deepStrictEqual(boosts, []);
});

test('même en forçant PAYMENTS_ENABLED, rien n\'est accordé sans SDK', () => {
  const { Monetization, GameState, boosts } = load();
  Monetization.PAYMENTS_ENABLED = true;
  for (const item of Monetization.SHOP_ITEMS) {
    let success = 0;
    Monetization.purchase(item.id, () => { success++; });
    assert.strictEqual(success, 0, item.id);
  }
  assert.strictEqual(GameState.gems, 7);
  assert.strictEqual(GameState.monetization.pickaxeSkin, null);
  assert.deepStrictEqual(boosts, []);
});

test('article inconnu : refusé sans erreur', () => {
  const { Monetization } = load();
  let cancel = 0;
  assert.strictEqual(Monetization.purchase('nope', null, () => { cancel++; }), false);
  assert.strictEqual(cancel, 1);
});

test('la boutique désactive les boutons sans fournisseur et les textes existent', () => {
  const main = read('public/js/main.js');
  assert.match(main, /owned \|\| !enabled \? 'disabled' : ''/);
  assert.match(main, /if \(!owned && enabled\)/);
  const i18n = read('public/js/i18n.js');
  assert.strictEqual((i18n.match(/btn_soon:/g) || []).length, 4);
  assert.strictEqual((i18n.match(/disclaimer_live:/g) || []).length, 4);
  assert.doesNotMatch(read('public/js/monetization.js') + main, /_fakePurchase\s*\(/);
});
