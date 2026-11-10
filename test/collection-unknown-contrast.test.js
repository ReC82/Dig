'use strict';
/**
 * Cases « à découvrir » de Collection (événements et séries) — recette du propriétaire du 10/11 (#56) :
 * lisibles sur le fond sombre (AA : texte ≥ 4,5:1, contour et « ? » ≥ 3:1), sans rien divulguer.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(ROOT, 'public/css/style.css'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');

const vars = Object.fromEntries([...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map(m => [m[1], m[2]]));
const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** Déclarations (fusionnées) des règles dont le sélecteur est exactement `sel`. */
const rule = sel => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`(?:^|\\}|\\*/)\\s*${esc}\\s*\\{([^}]*)\\}`, 'gm'))].map(m => m[1]).join(';');
};
const prop = (decls, name) => { const m = decls.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`)); return m && m[1].trim(); };
const hexIn = v => (v.match(/#[0-9a-f]{6}\b/i) || [])[0];

test('carte inconnue : plus aucune opacité ni niveau de gris qui l\'efface', () => {
  const card = rule('.find-card:not(.found)');
  assert.ok(card, 'règle présente');
  assert.ok(!/opacity|grayscale/.test(card), card);
  assert.ok(/dashed/.test(prop(card, 'border')), 'contour pointillé discernable');
});

test('carte inconnue : contrastes AA sur les deux fonds de la carte et sur la page', () => {
  const backgrounds = [vars.surface, vars.surface2, vars.bg];
  assert.ok(backgrounds.every(Boolean), JSON.stringify(vars));
  const border = hexIn(prop(rule('.find-card:not(.found)'), 'border'));
  const icon = rule('.find-card:not(.found) .find-icon');
  const glyph = hexIn(prop(icon, 'color'));
  const ring = hexIn(prop(icon, 'border'));
  const name = hexIn(prop(rule('.find-card:not(.found) .find-name'), 'color'));
  for (const bg of backgrounds) {
    assert.ok(ratio(name, bg) >= 4.5, `texte « À découvrir » ${name} / ${bg} = ${ratio(name, bg).toFixed(2)}`);
    assert.ok(ratio(glyph, bg) >= 4.5, `« ? » ${glyph} / ${bg}`);
    assert.ok(ratio(border, bg) >= 3, `contour ${border} / ${bg} = ${ratio(border, bg).toFixed(2)}`);
    assert.ok(ratio(ring, bg) >= 3, `cercle ${ring} / ${bg}`);
  }
});

test('carte inconnue : libellé traduit « À découvrir », jamais la rareté ni le nom', () => {
  assert.ok(!main.includes("'???'"), 'plus de « ??? »');
  assert.strictEqual((main.match(/t\('collection\.to_discover'\)/g) || []).length, 2, 'événements + séries de collection');
  // La rareté n'apparaît en classe qu'une fois l'objet trouvé
  assert.ok(main.includes("find-rarity-${it.found ? escapeHtml(it.rarity) : 'unknown'}"));
  assert.ok(main.includes("find-rarity-${isFound ? find.rarity || 'commun' : 'unknown'}"));
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  for (const txt of ['À découvrir', 'To discover', 'Te ontdekken', 'Por descubrir']) assert.ok(i18n.includes(`to_discover: '${txt}'`), txt);
  assert.ok(fs.readFileSync(path.join(ROOT, 'public/js/locales/it.js'), 'utf8').includes('"to_discover": "Da scoprire"'));
});
