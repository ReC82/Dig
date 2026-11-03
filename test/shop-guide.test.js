/**
 * Guide des trois boutiques (#34, recette UX croisée du 03/11) : coffres (pièces, Amélios), gemmes et
 * cosmétiques (argent réel, Boutique), cadeaux (points de saison, Saison). Le même bandeau en tête de
 * chacune dit où l'on est, quelle monnaie est utilisée, et mène aux deux autres — sans déplacer ni
 * fusionner aucun achat.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const main = read('public/js/main.js'), html = read('public/index.html'), i18n = read('public/js/i18n.js');
const body = name => main.slice(main.indexOf(`function ${name}(`), main.indexOf('\n}\n', main.indexOf(`function ${name}(`)));

test('le guide est en tête des trois boutiques, la courante marquée « ici »', () => {
  assert.match(body('renderShopChests'), /_shopGuideHtml\('chests'\)/);
  assert.match(body('renderShop'), /_shopGuideHtml\('gems'\)/);
  assert.match(body('_shopHtml'), /_shopGuideHtml\('gifts'\)/);
  assert.match(html, /id="shop-chests-anchor"[^>]*>.*\n\s*<div id="shop-guide-chests"><\/div>\n\s*<div id="shop-chests-list">/);
  const g = body('_shopGuideHtml');
  assert.match(g, /aria-current="page"/);
  assert.match(g, /data-shop-guide=/);
  assert.match(g, /PAYMENTS_ENABLED \? 'shopguide\.gems_cur' : 'shopguide\.gems_cur_soon'/, 'gemmes : « bientôt » tant que les paiements sont coupés');
});

test('chaque lien mène à l’onglet existant, sans déplacer les achats', () => {
  const go = body('_goToShop');
  assert.match(go, /switchView\('upgrades'\)[\s\S]*shop-chests-anchor/);
  assert.match(go, /switchView\('shop'\)/);
  assert.match(go, /switchView\('season'\)[\s\S]*_revealGiftShop\(\)/);
  // Les actions d'achat restent à leur place d'origine
  assert.match(body('renderShopChests'), /openShopChest\(def\.id\)/);
  assert.match(body('_fillShopGrid'), /Monetization\.purchase\(/);
  assert.ok(!/openShopChest|Monetization\.purchase|_shopExchange/.test(go + body('_shopGuideHtml')));
});

test('textes du guide en fr, en, nl, es et section « Coffres de saison »', () => {
  for (const key of ['title', 'aria', 'chests', 'chests_cur', 'gems', 'gems_cur', 'gems_cur_soon', 'gifts', 'gifts_cur', 'here']) {
    const block = [...i18n.matchAll(/shopguide: \{([\s\S]*?)\n {6}\}/g)].map(m => m[1]);
    assert.strictEqual(block.length, 4, 'fr, en, nl, es');
    for (const b of block) assert.match(b, new RegExp(`\\b${key}:\\s+'`), key);
  }
  assert.match(i18n, /section_shop_chests:\s+'📦 Coffres de saison'/);
  assert.ok(!/Boutique de saison/.test(i18n + html), 'plus de troisième « boutique » ambiguë');
});
