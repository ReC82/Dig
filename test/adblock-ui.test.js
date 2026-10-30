/**
 * Interface du jeu et bloqueurs de publicité (ticket #46).
 *
 * Le bouton « Doubler la récompense » portait la classe `ad-btn` : la règle cosmétique générique
 * `##.ad-btn` d'EasyList (uBlock Origin, AdBlock, Adblock Plus, Brave…) le masquait sur les
 * ordinateurs équipés d'un bloqueur, alors qu'il restait visible sur téléphone.
 * Les identifiants et classes de l'interface du jeu ne doivent donc contenir aucun segment
 * « publicitaire » (ad, ads, advert, sponsor, promo…), que ces listes visent largement.
 * Seule la bannière publicitaire réelle (#45, créée par public/js/ads.js) peut en porter.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const AD_SEGMENT = /^(ad|ads|adv|advert|adverts|advertising|advertisement|sponsor|sponsored|promo|promoted|pub)$/i;
const isAdLike = name => name.split(/[-_]/).some(seg => AD_SEGMENT.test(seg));

test('index.html : aucun id ni classe de l\'interface ne ressemble à de la publicité', () => {
  const html = read('public/index.html');
  const names = new Set();
  for (const m of html.matchAll(/\b(?:id|class)="([^"]+)"/g)) for (const n of m[1].split(/\s+/)) names.add(n);
  assert.ok(names.size > 50, 'analyse de index.html incomplète');
  assert.deepStrictEqual([...names].filter(isAdLike), []);
});

test('style.css / main.js / monetization.js : aucun sélecteur publicitaire pour l\'interface du jeu', () => {
  const css = read('public/css/style.css')
    // la bannière réelle (#45), sa demande de consentement et son réglage gardent leurs noms
    .replace(/[#.](?:ad-top|has-ad-top|ad-top-collapsed|ad-consent[\w-]*|settings-ad-[\w-]+)\b/g, '');
  const sel = [...css.matchAll(/[#.]([a-zA-Z][\w-]*)/g)].map(m => m[1]);
  assert.deepStrictEqual([...new Set(sel.filter(isAdLike))], []);
  for (const f of ['public/js/main.js', 'public/js/monetization.js']) {
    const js = read(f);
    const ids = [...js.matchAll(/getElementById\(\s*['"]([\w-]+)['"]/g), ...js.matchAll(/querySelector(?:All)?\(\s*['"][#.]([\w-]+)/g)].map(m => m[1]);
    assert.deepStrictEqual([...new Set(ids.filter(isAdLike))], [], f);
  }
});

test('bouton bonus et sa modale : noms neutres présents et reliés', () => {
  const html = read('public/index.html');
  assert.match(html, /<button id="btn-bonus-boost" class="bonus-btn"/);
  assert.match(html, /<div id="bonus-modal" hidden role="dialog" aria-modal="true" aria-labelledby="bonus-card-title">/);
  assert.match(html, /id="bonus-card-title"/);
  for (const id of ['bonus-timer', 'bonus-countdown', 'btn-close-bonus', 'btn-skip-bonus', 'bonus-bar-fill']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  const main = read('public/js/main.js');
  assert.match(main, /getElementById\('btn-bonus-boost'\)\.addEventListener\('click'/);
  assert.match(main, /dataset\.bonusState = 'ready'/);
  const css = read('public/css/style.css');
  for (const s of ['ready', 'cooldown', 'used']) assert.match(css, new RegExp(`\\.bonus-btn\\[data-bonus-state="${s}"\\]`));
});
