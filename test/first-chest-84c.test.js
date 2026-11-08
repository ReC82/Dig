/**
 * Recette #84-C (premier coffre) : en français, les fenêtres de coffre parlent de « pièces »
 * (plus de « coins ») et le titre ne fait plus de faute d'accord (« Vieille caisse ouvert ! »).
 */
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function frT() {
  const store = new Map([['dig_lang', 'fr']]);
  const el = () => ({ textContent: '', innerHTML: '', setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} } });
  const ctx = {
    console, location: { search: '' }, navigator: {},
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: { documentElement: { lang: 'fr' }, querySelectorAll: () => [], getElementById: () => null, createElement: el },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('public/js/languages.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\n;this.I18n = I18n; this.t = t;`, ctx);
  ctx.I18n.init();
  return ctx.t;
}

test('#84-C : vocabulaire des récompenses de coffre en français', () => {
  const t = frT();
  assert.strictEqual(t('ui.chest_title', { name: 'Vieille caisse' }), 'Coffre ouvert : Vieille caisse');
  assert.strictEqual(t('ui.chest_reward_boost', { mult: 2, minutes: 3 }), '⚡ Boost ×2 des pièces des blocs — 3 min');
  assert.strictEqual(t('ui.daily_reward_boost', { mult: 2, minutes: 10 }), '⚡ ×2 pièces pendant 10 min');
  assert.match(t('shop_chest.simple.desc'), /^Pièces, fragments ou boost/);
  for (const k of ['ui.chest_reward_coins', 'ui.chest_reward_relics', 'ui.chest_reward_boost', 'ui.daily_reward_boost',
    'shop_chest.simple.desc', 'shop_chest.rare.desc', 'shop_chest.antique.desc', 'chest_odds.boost']) {
    assert.doesNotMatch(t(k, { amount: 1, s: '', mult: 2, minutes: 3 }), /coins/i, k);
  }
});
