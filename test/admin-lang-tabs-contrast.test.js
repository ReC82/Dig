/**
 * Onglets de langue du panel admin (#56, recette du 04/11) : en thème sombre, les onglets inactifs
 * EN/NL/ES affichaient un texte noir (couleur par défaut d'un <button>) sur fond gris foncé.
 * Le style commun .co-lang-btn (Événements, objets d'événement, Boutique, Blocs, Collections,
 * Badges, Actualités) doit fixer une couleur lisible (contraste ≥ 4,5:1) pour chaque état.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');

const vars = Object.fromEntries([...CSS.match(/:root\s*\{([^}]*)\}/)[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const rule = sel => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`(?:^|\\n)${esc}(?:\\s*,[^{]*)?\\s*\\{([^}]*)\\}`));
  assert.ok(m, `règle ${sel} absente`);
  return m[1];
};
const prop = (body, name) => {
  const m = body.match(new RegExp(`(?:^|[;\\s{])${name}:\\s*([^;]+);`));
  if (!m) return null;
  const v = m[1].trim();
  const r = v.match(/^var\(--([\w-]+)\)$/);
  return r ? vars[r[1]] : v;
};
const lum = hex => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map(c => c + c).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('onglet de langue inactif : couleur de texte explicite et lisible sur son fond', () => {
  const base = rule('.co-lang-btn');
  const color = prop(base, 'color'), bg = prop(base, 'background');
  assert.ok(color && bg, 'couleur de texte et fond explicites');
  assert.ok(ratio(color, bg) >= 4.5, `contraste ${ratio(color, bg).toFixed(2)}`);
  for (const st of ['ok', 'name', 'none']) {
    const c = prop(rule(`.co-lang-btn.co-lang--${st}`), 'color');
    assert.ok(ratio(c, bg) >= 4.5, `${st} : contraste ${ratio(c, bg).toFixed(2)}`);
    // Survol : le fond change, le texte doit rester lisible.
    assert.ok(ratio(c, prop(rule('.co-lang-btn:hover'), 'background')) >= 4.5, `${st} au survol`);
  }
});

test('onglet actif différencié (fond or, texte foncé), focus clavier visible', () => {
  const on = rule('.co-lang-btn[aria-pressed="true"]');
  assert.ok(ratio(prop(on, 'color'), prop(on, 'background')) >= 4.5);
  assert.notStrictEqual(prop(on, 'background'), prop(rule('.co-lang-btn'), 'background'));
  assert.match(rule('.co-lang-btn:focus-visible'), /outline:\s*2px solid/);
});

test('les règles d\'état des onglets passent après la règle de base (le contour coloré n\'est pas écrasé)', () => {
  const i = CSS.indexOf('\n.co-lang-btn {');
  for (const st of ['ok', 'name', 'none']) assert.ok(CSS.indexOf(`.co-lang-btn.co-lang--${st}`) > i, st);
});

test('Événements : les onglets portent l\'état de complétude et gardent l\'indicateur ✓ / ·', () => {
  const i = JS.indexOf('function evLangTabs(');
  const f = JS.slice(i, JS.indexOf('\n}\n', i));
  assert.match(f, /co-lang-btn co-lang--\$\{done \? 'ok' : 'none'\}/);
  assert.match(f, /done \? '✓' : '·'/);
});
