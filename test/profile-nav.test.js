'use strict';
/**
 * #63 — En-tête joueur : personne → Profil, engrenage → Paramètres (deux vues distinctes).
 * Contrôles statiques ; le parcours réel (PC 1280×900, smartphone 390×844) est dans
 * test/e2e/profile-settings.e2e.js (serveur de test uniquement).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('public/index.html');
const main = read('public/js/main.js');
const fnBody = name => {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const next = main.indexOf('\nfunction ', start + 10);
  const nextAsync = main.indexOf('\nasync function ', start + 10);
  return main.slice(start, Math.min(...[next, nextAsync].filter(i => i > 0)));
};

test('en-tête : chaque bouton pilote sa propre vue', () => {
  assert.match(html, /<div id="view-profile" class="view hidden"><\/div>/);
  assert.match(html, /<div id="view-settings" class="view hidden"><\/div>/);
  assert.match(html, /<button id="btn-account"[^>]*aria-controls="view-profile"/);
  assert.match(html, /<button id="btn-settings"[^>]*aria-controls="view-settings"/);
  assert.match(main, /getElementById\('btn-account'\)\.addEventListener\('click', \(\) => _toggleHeaderView\('profile'\)\)/);
  assert.match(main, /getElementById\('btn-settings'\)\.addEventListener\('click', \(\) => _toggleHeaderView\('settings'\)\)/);
  assert.doesNotMatch(main, /getElementById\('btn-account'\)[^\n]*\n[^\n]*\n[^\n]*\n\s*switchView\('settings'\)/, 'plus de raccourci Profil → Paramètres');
});

test('navigation : les vues d\'en-tête laissent l\'onglet du bas intact (retour sans perdre le bloc)', () => {
  const sw = fnBody('switchView');
  assert.match(main, /const HEADER_VIEWS = \{ profile: 'btn-account', settings: 'btn-settings' \};/);
  assert.match(sw, /if \(!\(viewId in HEADER_VIEWS\)\)/);
  assert.match(sw, /setAttribute\('aria-current', 'page'\)/);
  assert.match(sw, /if \(viewId === 'profile'\) \{\s*renderProfile\(\);/);
  const toggle = fnBody('_toggleHeaderView');
  assert.match(toggle, /if \(isViewActive\(viewId\)\) \{ switchView\(_previousView\); return; \}/);
  assert.match(toggle, /_previousView = activeBtn \? activeBtn\.dataset\.view : 'dig';/);
  // Langue changée ou compte relu : la vue Profil ouverte est re-rendue
  assert.match(main, /if \(isViewActive\('profile'\)\)\s+renderProfile\(\);/);
});

test('Profil : lecture seule, sans réglage du compte ; Paramètres : sans statistiques du profil', () => {
  const profile = fnBody('renderProfile');
  for (const forbidden of [/<input/, /<form/, /password/i, /btn-account-logout/, /lang-picker/, /notif-history/, /_account\.email\b|acc\.email\b/]) {
    assert.doesNotMatch(profile, forbidden, `Profil : ${forbidden}`);
  }
  assert.match(profile, /escapeHtml\(name\)/, 'pseudo échappé');
  assert.match(profile, /_pointsData \?/, 'points de saison seulement s\'ils sont déjà chargés (aucun appel en plus)');
  assert.match(profile, /PROFILE_BADGES_TTL/, 'décompte des badges gardé une minute');
  const settings = fnBody('renderSettings');
  assert.doesNotMatch(settings, /profile-|GameState\.stats/);
  for (const kept of ['_accountSectionHtml()', 'lang-picker', 'notif-history', 'DigAds.settingsSectionHtml()', '/legal/confidentialite']) {
    assert.ok(settings.includes(kept), `Paramètres conserve ${kept}`);
  }
});

test('textes du Profil : mêmes clés en fr, en, nl et es ; libellé du bouton « Profil »', () => {
  const ctx = { console, Intl, URLSearchParams, location: { search: '' },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: {}, querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({}) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('public/js/languages.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\n;this.I18n = I18n; this.t = t;`, ctx);
  const keys = (read('public/js/i18n.js').match(/^      profile: \{[\s\S]*?^      \},/m)[0].match(/^        (\w+):/gm) || [])
    .map(k => k.trim().slice(0, -1));
  assert.ok(keys.length >= 20, keys.join());
  const expected = { fr: 'Profil', en: 'Profile', nl: 'Profiel', es: 'Perfil' };
  for (const lang of ['fr', 'en', 'nl', 'es']) {
    ctx.I18n.setLang(lang);
    assert.strictEqual(ctx.t('account.header_aria'), expected[lang], lang);
    assert.strictEqual(ctx.t('profile.title'), expected[lang], lang);
    for (const k of keys) assert.notStrictEqual(ctx.t(`profile.${k}`), `profile.${k}`, `${lang} profile.${k}`);
    if (lang !== 'fr') assert.notStrictEqual(ctx.t('profile.public_info'), (ctx.I18n.setLang('fr'), ctx.t('profile.public_info')));
    ctx.I18n.setLang(lang);
    assert.match(ctx.t('profile.member_since', { date: 'X' }), /X/);
  }
});

test('CSS : liens du Profil ≥ 44 px, bouton d\'en-tête actif visible', () => {
  const css = read('public/css/style.css');
  assert.match(css.match(/\.profile-link \{[\s\S]*?\}/)[0], /min-height: 44px;/);
  assert.match(css, /\.header-btns button\.is-active \{/);
});
