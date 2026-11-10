/**
 * Recette #84-D (08/11) : dans l'onglet Saison, les points de récompense tiennent sur une ligne
 * repliée par défaut (« Points de récompense · Solde : 10 pts › ») ; dépliés, ils gardent le crédit,
 * l'estimation, le barème, l'historique et la boutique de cadeaux (une seule entrée, plus de lien
 * en double). Le bloc de rendu de public/js/main.js est exécuté seul, avec les vraies traductions.
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

function load({ points, shop, openFold = false, shopMsg = null }) {
  const main  = read('public/js/main.js');
  const start = main.indexOf('// ── Points de récompense saisonniers (#33)');
  const end   = main.indexOf('async function _shopAction(');
  assert.ok(start > 0 && end > start, 'bloc de rendu introuvable');
  const store = new Map([['dig_lang', 'fr']]);
  const ctx = vm.createContext({
    console, Date, JSON, Math, Number, String, Array, Object, isNaN, encodeURIComponent,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    navigator: { language: 'fr' },
    UiIcons: require('../public/js/uiIcons.js'),   // pictogrammes de l'atelier (#67) : emoji d'origine ici
    document: {
      querySelector: s => (s === '#season-points > .points-fold' && openFold ? { open: true } : null),
      getElementById: () => null, documentElement: {}, querySelectorAll: () => [], addEventListener: () => {},
    },
  });
  ctx.window = ctx;
  vm.runInContext(read('public/js/escapeHtml.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\nthis.I18n = I18n;`, ctx);
  ctx.I18n.init?.();
  ctx.t = (k, p) => ctx.I18n.t(k, p);
  ctx._account = { username: 'lody' };
  ctx._shopGuideHtml = () => '<nav class="shop-guide"></nav>';
  vm.runInContext(`${main.slice(start, end)}
    this.render = (p, s, m) => { _pointsData = p; _shopData = s; _shopMsg = m; return _pointsHtml(); };`, ctx);
  return () => ctx.render(points, shop, shopMsg);
}

const POINTS = {
  mode: 'live', balance: 10, potential: { rank: 2, points: 25, eligibleCount: 5, tier: 't1' },
  scale: { tiers: [{ id: 't1', rankMax: 3, points: 25 }] },
  history: [{ kind: 'season_award', delta: 10, seasonId: 6, seasonName: 'Saison 44-2026' }], awards: [],
};
const SHOP = { balance: 10, items: [], orders: [], realEnabled: true, notice: null };

test('points de récompense : une ligne repliée par défaut, solde dans le résumé', () => {
  const h = load({ points: POINTS, shop: SHOP })();
  assert.match(h, /^\s*<details class="points-card points-fold season-fold">/);
  const summary = h.match(/<summary class="points-head">([\s\S]*?)<\/summary>/)[1];
  assert.match(summary, /Points de récompense/);
  assert.match(summary.replace(/<[^>]+>/g, ''), /Solde :\s*10 pts/);
  assert.ok(!/Crédit réel|barème|boutique/i.test(summary), 'le résumé tient sur une ligne');
});

test('dépliés : crédit, estimation, barème, historique et boutique conservés, sans doublon', () => {
  const h = load({ points: POINTS, shop: SHOP })();
  const body = h.slice(h.indexOf('</summary>'));
  assert.match(body, /points-live-banner/);
  assert.match(body, /points-potential/);
  assert.match(body, /points-scale/);
  assert.match(body, /points-history/);
  assert.match(body, /Saison 44-2026/);
  assert.match(body, /<div id="season-shop">\s*<details class="points-card shop-card season-fold">/);
  assert.match(body, /Boutique de cadeaux/);
  assert.ok(!h.includes('data-scroll-shop'), 'plus de bouton « Ouvrir la boutique » en double');
  assert.strictEqual(h.split('id="season-shop"').length, 2, 'une seule boutique');
  assert.strictEqual(h.split('Solde :').length, 2, 'solde affiché une seule fois (résumé des points)');
});

test('état conservé : reste déplié après actualisation, et déplié après un échange', () => {
  assert.match(load({ points: POINTS, shop: SHOP, openFold: true })(), /<details class="points-card points-fold season-fold" open>/);
  assert.match(load({ points: POINTS, shop: SHOP, shopMsg: { ok: true, text: 'ok' } })(), /<details class="points-card points-fold season-fold" open>/);
});

test('points indisponibles : la boutique reste accessible seule ; rien sans compte', () => {
  const h = load({ points: null, shop: SHOP })();
  assert.match(h, /^<div id="season-shop">/);
  assert.match(h, /Solde :/, 'boutique seule : solde dans son résumé');
  assert.strictEqual(load({ points: null, shop: null })(), '');
});
