/**
 * Boutique de cadeaux (#34, recettes E à K du 03/11) :
 * - « 1 pt » / « 2 pts » partout (prix, bouton « Il manque … », solde, confirmation), dans les 4 langues ;
 * - confirmation d'échange et d'annulation dans une fenêtre Dig (plus de window.confirm natif) ;
 * - fiche admin d'article : sections, une langue à la fois, champs « réel » seulement si Réel (valeurs
 *   conservées), options repliées, aperçu joueur, sélecteur d'emoji, protection des saisies (#61).
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
const main = read('public/js/main.js'), html = read('public/index.html');
const adminJs = read('public/admin/admin.js'), adminHtml = read('public/admin/index.html');
const body = (src, name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)));

function i18nFor(lang) {
  const store = new Map([['dig_lang', lang]]);
  const ctx = {
    console, Intl, URLSearchParams, location: { search: '' },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: { documentElement: {}, querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({}) },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('public/js/languages.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\n;this.I18n = I18n; this.t = t;`, ctx);
  ctx.I18n.setLang(lang);
  return ctx.t;
}

test('points : « 1 pt » au singulier, « n pts » au pluriel (prix, manque, solde, gains)', () => {
  const fr = i18nFor('fr');
  assert.strictEqual(fr('giftshop.cost', { n: '1' }), '1 pt');
  assert.strictEqual(fr('giftshop.cost', { n: '2' }), '2 pts');
  assert.strictEqual(fr('giftshop.cost', { n: '1 500' }), '1 500 pts');
  assert.strictEqual(fr('giftshop.b_short', { n: '1' }), 'Il manque 1 pt');
  assert.strictEqual(fr('giftshop.b_short', { n: '3' }), 'Il manque 3 pts');
  assert.strictEqual(fr('points.pts', { n: '0' }), '0 pt');               // français : 0 est singulier
  assert.strictEqual(fr('points.pts', { n: '1' }), '1 pt');
  assert.match(fr('points.potential', { rank: '1', n: '40', tier: 'Or', pts: '1' }), /\+1 pt$/);
  assert.match(fr('points.potential', { rank: '1', n: '40', tier: 'Or', pts: '5' }), /\+5 pts$/);
  assert.strictEqual(fr('season.last.me_points', { n: '1' }), '+1 pt crédité');
  assert.strictEqual(fr('season.last.me_points', { n: '4' }), '+4 pts crédités');
  const en = i18nFor('en'), nl = i18nFor('nl'), es = i18nFor('es');
  assert.deepStrictEqual([en('giftshop.cost', { n: '1' }), en('giftshop.cost', { n: '0' }), en('giftshop.b_short', { n: '1' })], ['1 pt', '0 pts', '1 pt missing']);
  assert.deepStrictEqual([nl('giftshop.cost', { n: '1' }), nl('giftshop.cost', { n: '2' })], ['1 pt', '2 ptn']);
  assert.deepStrictEqual([es('giftshop.cost', { n: '1' }), es('giftshop.cost', { n: '2' }), es('giftshop.b_short', { n: '1' })], ['1 pt', '2 pts', 'Faltan 1 pt']);
  // Plus aucun « {n} pts » figé dans le dictionnaire : uniquement des formes plurielles
  assert.doesNotMatch(read('public/js/i18n.js'), /^\s*\w+:\s*'[^']*\{(n|pts)\} pt[sn]\b[^']*',\s*$/m);
});

test('échange et annulation : fenêtre Dig, plus de window.confirm, aucun double envoi', () => {
  for (const fn of ['_shopExchange', '_shopCancel']) {
    const b = body(main, fn);
    assert.doesNotMatch(b, /\bconfirm\(/, `${fn} : confirm() natif`);
    assert.match(b, /await _shopConfirm\(\{/, fn);
  }
  assert.match(body(main, '_shopExchange'), /m_before[\s\S]*m_after/, 'solde avant / après');
  assert.match(body(main, '_shopCancel'), /c_refund[\s\S]*_shopData\.balance \+ o\.cost/, 'remboursement et solde après');
  const c = body(main, '_shopConfirm');
  assert.match(c, /!modal\.hidden\) return Promise\.resolve\(false\)/, 'une seule fenêtre à la fois');
  assert.match(c, /e\.key === 'Escape'/);
  assert.match(c, /e\.key === 'Tab'/, 'focus gardé dans la fenêtre');
  assert.match(c, /e\.target === modal/, 'clic sur le fond = refus');
  assert.match(c, /ok\.disabled = true/, 'un seul « oui »');
  assert.match(c, /escapeHtml\(itemTitle\)/);
  assert.match(c, /back\.focus\(\)/, 'focus initial sur Annuler');
  assert.match(html, /<div id="shop-confirm-modal" hidden role="dialog" aria-modal="true" aria-labelledby="shop-confirm-title"/);
  for (const lang of ['fr', 'en', 'nl', 'es']) {
    const t = i18nFor(lang);
    for (const k of ['m_title', 'm_cost', 'm_before', 'm_after', 'm_note', 'm_ok', 'm_back', 'c_refund', 'c_after', 'c_note', 'c_ok', 'c_back']) {
      assert.ok(i18nFor(lang)(`giftshop.${k}`) !== `giftshop.${k}`, `${lang} ${k}`);
    }
    assert.match(t('giftshop.c_title', { id: 7 }), /#7/);
  }
});

test('admin : fiche article structurée, une langue à la fois, champs réels conditionnels', () => {
  const d = adminHtml.slice(adminHtml.indexOf('<dialog id="sh-dialog"'), adminHtml.indexOf('</dialog>', adminHtml.indexOf('<dialog id="sh-dialog"')));
  // Ordre : article, prix et disponibilité, textes, puis cadeau réel et options avancées repliés
  const order = ['sh-sec-id', 'sh-cost', 'sh-visible', 'sh-langs', 'sh-real-box', 'sh-adv-box'].map(id => d.indexOf(`id="${id}"`));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), `ordre des sections ${order}`);
  assert.match(d, /<details id="sh-real-box" class="nw-sec hidden">/);
  assert.match(d, /<details id="sh-adv-box" class="nw-sec">/, 'options avancées fermées par défaut');
  for (const id of ['sh-face', 'sh-currency', 'sh-territories', 'sh-age']) {
    assert.ok(d.indexOf(`id="${id}"`) > d.indexOf('id="sh-real-box"') && d.indexOf(`id="${id}"`) < d.indexOf('id="sh-adv-box"'), id);
  }
  for (const l of ['en', 'nl', 'es']) assert.match(d, new RegExp(`<div class="sh-lang-fields hidden" data-lang="${l}">`));
  assert.match(d, /<div class="sh-lang-fields" data-lang="fr">/);
  assert.match(d, /id="sh-preview"/);
  const r = body(adminJs, 'shRefresh');
  assert.match(r, /realBox\.classList\.toggle\('hidden', !real\)/);
  assert.doesNotMatch(r, /\.value = ''/, 'changer de sorte ne vide aucun champ');
  assert.match(r, /sh-real-kept/);
  assert.match(body(adminJs, 'shLang'), /d\.dataset\.lang !== l/);
  // Recette #34-L : aperçu « Prix à définir », pas de « Échanger » pour un article incomplet ou masqué
  const p = body(adminJs, 'shPreview');
  assert.match(p, /'Prix à définir'/);
  assert.doesNotMatch(p, /'\? pts'/);
  assert.match(p, /missing\.length \? 'À compléter' : !it\.visible \? 'Masqué'/);
});

test('admin : sélecteur d\'emoji (catégories, recherche, choix au clic, saisie libre)', () => {
  assert.match(adminHtml, /id="btn-sh-emoji" aria-expanded="false" aria-controls="sh-emoji-panel"/);
  assert.match(adminHtml, /<input id="sh-icon" type="text"/, 'saisie ou collage libre conservés');
  const cats = adminJs.slice(adminJs.indexOf('const SH_EMOJIS = {'), adminJs.indexOf('};', adminJs.indexOf('const SH_EMOJIS = {')));
  assert.ok((cats.match(/\['/g) || []).length >= 50, 'au moins 50 emojis');
  assert.match(cats, /'Cadeaux'/);
  const rnd = body(adminJs, 'shEmojiRender');
  assert.match(rnd, /shNorm\(k\)\.includes\(q\)/, 'recherche sans accents');
  assert.match(rnd, /document\.getElementById\('sh-icon'\)\.value = e/);
  assert.match(adminJs, /e\.stopPropagation\(\);\s+\/\/ Échap ferme le sélecteur, pas la fiche/);
});

test('admin : saisies protégées à la fermeture (#61), confirmations Dig des commandes', () => {
  assert.match(adminJs, /admDialogSetup\('sh-dialog', \{ canClose: shCanClose \}\)/);
  const setup = body(adminJs, 'admDialogSetup');
  assert.match(setup, /if \(canClose\) dlg\.addEventListener\('cancel', e => \{ e\.preventDefault\(\); request\(\); \}\)/);
  assert.match(body(adminJs, 'shCanClose'), /admConfirm\(\{/);
  assert.match(body(adminJs, 'shOpenSheet'), /_shSnap = JSON\.stringify\(shReadForm\(\)\)/);
  assert.doesNotMatch(body(adminJs, 'shopTransition'), /\bconfirm\(/);
  assert.match(body(adminJs, 'shopTransition'), /await admConfirm\(\{/);
});
