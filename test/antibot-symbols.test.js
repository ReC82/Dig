'use strict';
/**
 * Pictogrammes du défi anti-bot (#25, recette du 07/11) : l'emoji 🪙 « pièce » s'affichait en carré
 * vide. Chaque symbole tiré par le serveur doit avoir un SVG local dans le client (aucun emoji ni
 * texte dépendant d'une police) et un nom lisible dans chaque langue (aria-label, version texte).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SYMBOLS } = require('../server/antibotResponses');

const ROOT = path.join(__dirname, '..');
const gate = fs.readFileSync(path.join(ROOT, 'public/js/antibotGate.js'), 'utf8');
const SVG = eval('(' + gate.match(/const _SVG = (\{[\s\S]*?\n  \});/)[1] + ')');

test('chaque symbole du serveur a un pictogramme SVG local', () => {
  assert.deepStrictEqual(Object.keys(SVG).sort(), SYMBOLS.slice().sort());
  for (const [sym, body] of Object.entries(SVG)) {
    assert.match(body, /^<(path|g|circle)\b/, sym);
    assert.doesNotMatch(body, /<text|<image|href=|url\(/i, `${sym} : ni texte, ni image distante`);
    assert.doesNotMatch(body, /\p{Extended_Pictographic}/u, `${sym} : aucun emoji`);
  }
});

test('le client n\'affiche plus l\'emoji du serveur et a un repli texte', () => {
  assert.doesNotMatch(gate, /tile\.icon/);
  assert.match(gate, /antibot-tile-name/);
});

test('chaque symbole a un nom dans chaque langue', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  const it = fs.readFileSync(path.join(ROOT, 'public/js/locales/it.js'), 'utf8');
  for (const sym of SYMBOLS) {
    const n = (i18n.match(new RegExp(`\\bsym_${sym}\\b`, 'g')) || []).length;
    assert.strictEqual(n, 4, `sym_${sym} : fr, en, nl, es`);
    assert.match(it, new RegExp(`sym_${sym}`), `sym_${sym} : it`);
  }
});

test('les SVG sont des fragments valides (balises équilibrées)', () => {
  for (const [sym, body] of Object.entries(SVG)) {
    const open = (body.match(/<g\b/g) || []).length, close = (body.match(/<\/g>/g) || []).length;
    assert.strictEqual(open, close, sym);
    assert.ok(/\/>$|<\/g>$/.test(body), sym);
  }
});
