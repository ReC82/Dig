'use strict';
/**
 * #41 — Identité DIG! : propositions de logo compactes (aperçu ?logo=…, rien d'activé par défaut)
 * et icônes Profil / Paramètres différenciées dans l'en-tête.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LogoPreview = require('../public/js/logoPreview.js');

test('aperçu ?logo= : propositions connues et emblèmes de l\'atelier seulement', () => {
  assert.strictEqual(LogoPreview.resolve('a'), 'assets/logo/a-lingot.svg');
  assert.strictEqual(LogoPreview.resolve(' D '), 'assets/logo/d-pioche.svg');
  assert.strictEqual(LogoPreview.resolve('media:0123456789abcdef'), '/media/icons/0123456789abcdef.webp');
  for (const bad of [null, '', 'e', 'toString', '__proto__', '../a', 'media:123', 'media:0123456789abcdeg',
    'media:0123456789abcdef/../x', 'javascript:alert(1)', 'https://exemple.test/logo.svg']) {
    assert.strictEqual(LogoPreview.resolve(bad), null, String(bad));
  }
});

test('propositions SVG : fichiers sûrs et encombrement compact (≤ 150 px de large à 40 px de haut)', () => {
  for (const [id, rel] of Object.entries(LogoPreview.PROPOSALS)) {
    const svg = read(path.join('public', rel));
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, id);
    assert.doesNotMatch(svg, /<script|on\w+=|href=|<image|@import|url\((?!#)/i, `${id} : aucun contenu actif ni ressource externe`);
    const [, , w, h] = svg.match(/viewBox="([-\d. ]+)"/)[1].trim().split(/\s+/).map(Number);
    assert.ok(w / h * 40 <= 150, `${id} : ${Math.round(w / h * 40)} px de large à 40 px de haut`);
  }
});

test('logo par défaut inchangé : titre texte, aperçu chargé mais inactif sans ?logo=', () => {
  const html = read('public/index.html');
  assert.match(html, /<h1 id="game-logo">⛏ DIG!<\/h1>/);
  assert.match(html, /<script src="js\/logoPreview\.js"><\/script>/);
});

test('en-tête : Profil (personne) et Paramètres (engrenage) différenciés, labels et zones tactiles', () => {
  const html = read('public/index.html');
  const btn = id => html.match(new RegExp(`<button id="${id}"[\\s\\S]*?</button>`))[0];
  const profile = btn('btn-account'), settings = btn('btn-settings');
  assert.match(profile, /data-i18n-aria="account\.header_aria"/);
  assert.match(settings, /data-i18n-aria="settings\.title"/);
  assert.match(profile, /<circle /, 'tête de la silhouette');
  assert.doesNotMatch(profile, /👤|⚙/);
  assert.doesNotMatch(settings, /👤|⚙/);
  assert.notStrictEqual(profile.match(/<svg[\s\S]*<\/svg>/)[0], settings.match(/<svg[\s\S]*<\/svg>/)[0]);
  for (const b of [profile, settings]) {
    assert.match(b, /aria-hidden="true"/, 'pictogramme décoratif, le libellé porte le sens');
    assert.match(b, /type="button"/);
  }
  const i18n = read('public/js/i18n.js');
  assert.strictEqual((i18n.match(/header_aria: +'/g) ?? []).length, 3, 'libellé Profil en fr, en et nl');
  assert.match(i18n, /data-i18n-title/);
  const css = read('public/css/style.css');
  const rule = css.match(/\.header-btns button \{[\s\S]*?\}/)[0];
  assert.match(rule, /width: 44px;/);
  assert.match(rule, /height: 44px;/);
  assert.match(css, /\.header-btns \{\s*position: absolute;/, 'boutons hors du flux : hauteur d\'en-tête inchangée');
});

test('atelier d\'icônes : cible « logo » (emblème compact, sans texte) générable depuis le panel', () => {
  const { UI_TARGETS } = require('../server/iconStudio.js');
  const logo = UI_TARGETS.find(u => u.id === 'logo');
  assert.ok(logo);
  assert.match(logo.details, /no text/);
  assert.match(read('public/admin/admin.js'), /key === 'ui:logo'[\s\S]{0,200}\/\?logo=media:\$\{a\.sha\}/);
});
