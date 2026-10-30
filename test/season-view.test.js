/**
 * Onglet Saison (ticket #31) : résultat figé de la saison précédente (#29), points crédités
 * (#33), accès boutique (#34), règles du mérite, états vide / non participant / erreur.
 * Le bloc de rendu de public/js/main.js est exécuté seul, avec les vraies traductions.
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

function load({ account = { username: 'lody' }, points = null, lang = 'fr' } = {}) {
  const main  = read('public/js/main.js');
  const start = main.indexOf('/** Date UTC du serveur');
  const end   = main.indexOf('// ── Points de récompense saisonniers (#33)');
  assert.ok(start > 0 && end > start, 'bloc de rendu introuvable');
  const store = new Map([['dig_lang', lang]]);
  const ctx = vm.createContext({
    console, Date, JSON, Math, Number, String, Array, Object, isNaN, encodeURIComponent,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    navigator: { language: lang },
    document: { querySelector: () => null, getElementById: () => null, documentElement: {}, querySelectorAll: () => [] },
  });
  ctx.window = ctx;
  vm.runInContext(read('public/js/escapeHtml.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\nthis.I18n = I18n;`, ctx);
  ctx.I18n.init?.();
  ctx.t = (k, p) => ctx.I18n.t(k, p);
  ctx._account = account;
  ctx._pointsData = points;
  vm.runInContext(`${main.slice(start, end)}\nthis.setLast = v => { _lastResult = v; };\nthis.html = () => _lastResultHtml();`, ctx);
  return ctx;
}

const DATA = {
  season:   { id: 6, name: 'Saison 44-2026', startAt: '2026-10-26 00:00:00', endAt: '2026-10-30 15:45:00', status: 'closed' },
  snapshot: { createdAt: '2026-10-30 15:45:11', source: 'close', participants: 4, eligible: 3, prizeMode: 'simulation', hash: 'a'.repeat(64) },
  standings: [
    { rank: 1, userId: 7, username: 'alice<b>', league: { icon: '🌼' }, maxDepth: 1279, eligible: true },
    { rank: 2, userId: 1, username: 'lody', league: null, maxDepth: 279, eligible: true },
    { rank: 3, userId: 9, username: null, league: null, maxDepth: 12, eligible: true },
    { rank: null, userId: 4, username: 'zero', league: null, maxDepth: 0, eligible: false },
  ],
  me: { rank: 2, userId: 1, username: 'lody', maxDepth: 279, eligible: true },
};

test('résultat figé : podium échappé, rang du joueur, points crédités, preuve publique', () => {
  const ctx = load({ points: { mode: 'live', awards: [{ seasonId: 6, mode: 'live', points: 117 }] } });
  ctx.setLast({ state: 'ok', data: DATA });
  const h = ctx.html();
  assert.match(h, /Résultat — Saison 44-2026/);
  assert.match(h, /4 participant\(s\) · 3 classé\(s\)/);
  assert.ok(h.includes('alice&lt;b&gt;') && !h.includes('alice<b>'), 'pseudonyme échappé');
  assert.match(h, /Compte supprimé/);
  assert.ok(!h.includes('zero'), 'les non-classés ne sont pas sur le podium');
  assert.match(h, /class="last-me"/);
  assert.match(h, /Ton résultat : rang #2 sur 3 · 279 m · \+117 pts crédités/);
  assert.ok(h.includes('a'.repeat(64)), 'empreinte affichée');
  assert.match(h, /href="\/api\/seasons\/6\/standings"/);
  assert.ok(!/tirage|probabilit|Amazon|carte cadeau/i.test(h), 'aucune probabilité ni prix réel annoncé');
});

test('résultat figé : simulation, non participant, non classé, visiteur', () => {
  let ctx = load({ points: { mode: 'simulation', awards: [{ seasonId: 6, mode: 'simulation', points: 40 }] } });
  ctx.setLast({ state: 'ok', data: DATA });
  assert.match(ctx.html(), /\+40 pts \(simulation, non crédités\)/);

  ctx = load();
  ctx.setLast({ state: 'ok', data: { ...DATA, me: null } });
  assert.match(ctx.html(), /Tu n'as pas participé à cette saison/);

  ctx.setLast({ state: 'ok', data: { ...DATA, me: { ...DATA.standings[3] } } });
  assert.match(ctx.html(), /Tu n'étais pas classé/);

  ctx = load({ account: null });
  ctx.setLast({ state: 'ok', data: { ...DATA, me: null } });
  const h = ctx.html();
  assert.match(h, /alice/);
  assert.ok(!h.includes('Ton résultat') && !h.includes('pas participé'));
});

test('résultat figé : aucun participant, pas encore de saison figée, erreur avec Réessayer', () => {
  const ctx = load();
  ctx.setLast({ state: 'ok', data: { ...DATA, snapshot: { ...DATA.snapshot, participants: 0, eligible: 0 }, standings: [], me: null } });
  assert.match(ctx.html(), /Aucun participant classé : pas de vainqueur ni de points/);
  ctx.setLast({ state: 'none' });
  assert.strictEqual(ctx.html(), '');
  ctx.setLast({ state: 'error' });
  assert.match(ctx.html(), /role="alert"/);
  assert.match(ctx.html(), /data-season-retry/);
});

test('traductions EN/NL du résultat figé', () => {
  for (const [lang, re] of [['en', /Your result: rank #2 of 3/], ['nl', /Jouw resultaat: rang #2 van 3/]]) {
    const ctx = load({ lang });
    ctx.setLast({ state: 'ok', data: DATA });
    assert.match(ctx.html(), re, lang);
  }
});

test('onglet Saison branché : carte du résultat, règles du mérite, accès boutique, erreur', () => {
  const main = read('public/js/main.js');
  assert.match(main, /<div id="season-last">\$\{_lastResultHtml\(\)\}<\/div>\s*<div id="season-points">/);
  for (const k of ['season.merit.join', 'season.merit.order', 'season.merit.freeze', 'season.merit.points'])
    assert.ok(main.includes(`t('${k}'`), k);
  assert.match(main, /data-scroll-shop/);
  assert.match(main, /el\.innerHTML = `<div class="view-title-bar">\$\{t\('season\.title'\)\}<\/div>\$\{_seasonErrorHtml\(\)\}`/);
  const fr = read('public/js/i18n.js');
  assert.match(fr, /Aucun tirage au sort/);
});
