/**
 * Localisation espagnole et sélecteur de langues compact (ticket #42) :
 * - les 4 langues (fr, en, nl, es) ont exactement les mêmes clés et les mêmes variables {x} ;
 * - l'espagnol est une vraie traduction (pas le français recopié) ;
 * - drapeaux en SVG intégré, sans identifiant (répétables), + libellé de la langue ;
 * - sélecteur compact accessible dans Paramètres, écran de premier lancement en 4 langues ;
 * - repli documenté des noms de blocs, e-mails, boutique de cadeaux et catalogue de blocs en ES.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const ROOT = path.join(__dirname, '..');
const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-i18n-es-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function loadI18n(stored) {
  const store = new Map(stored ? [['dig_lang', stored]] : []);
  const ctx = {
    console,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: { documentElement: {}, querySelectorAll: () => [] },
  };
  vm.createContext(ctx);
  vm.runInContext(`${read('public/js/i18n.js').replace('return { init,', 'return { _T: T, init,')}\n;this.I18n = I18n; this.t = t;`, ctx);
  return ctx;
}

const flat = (o, p = '', out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, out); else out[key] = v;
  }
  return out;
};
// Variables de contenu (les marques de pluriel {s}, {s1}… dépendent de la grammaire de chaque langue)
const vars = s => [...new Set([...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).filter(v => !/^s\d?$/.test(v)))].sort().join(',');

test('i18n : fr, en, nl et es ont les mêmes clés et les mêmes variables', () => {
  const T = loadI18n().I18n._T;
  assert.deepStrictEqual([...Object.keys(T)], ['fr', 'en', 'nl', 'es']);
  const F = Object.fromEntries(Object.keys(T).map(l => [l, flat(T[l])]));
  for (const lang of ['en', 'nl', 'es']) {
    assert.deepStrictEqual(Object.keys(F.fr).filter(k => !(k in F[lang])), [], `clés absentes en ${lang}`);
    assert.deepStrictEqual(Object.keys(F[lang]).filter(k => !(k in F.fr)), [], `clés en trop en ${lang}`);
    for (const [k, v] of Object.entries(F[lang])) {
      assert.strictEqual(typeof v, 'string', `${lang}.${k}`);
      assert.ok(v.trim(), `${lang}.${k} vide`);
      assert.strictEqual(vars(v), vars(F.fr[k]), `${lang}.${k} : variables différentes du français`);
    }
  }
});

test('i18n : l\'espagnol est traduit, pas le français recopié', () => {
  const T = loadI18n().I18n._T;
  const fr = flat(T.fr), es = flat(T.es);
  // Identiques admis : nombres/variables seuls, emoji, noms propres ou mots communs (Rare, Popular…)
  const same = Object.keys(fr).filter(k => fr[k] === es[k] && /[a-zà-ÿ]{4,}/i.test(fr[k].replace(/\{\w+\}/g, '')));
  assert.ok(same.length <= 12, `trop de textes identiques au français : ${same.join(', ')}`);
  assert.strictEqual(es['settings.lang_title'], 'Idioma');
  assert.strictEqual(es['nav.shop'], 'Tienda');
  assert.strictEqual(es['block.minerai_or'], 'Mineral de oro');
  assert.match(es['season.merit.order'], /servidor/);
});

test('langue mémorisée et repli : es choisi puis rechargé, clé inconnue → français puis clé', () => {
  let ctx = loadI18n();
  ctx.I18n.init();
  assert.strictEqual(ctx.I18n.getCurrent(), 'fr');
  ctx.I18n.setLang('es');
  assert.strictEqual(ctx.I18n.getCurrent(), 'es');
  assert.strictEqual(ctx.document.documentElement.lang, 'es');
  assert.strictEqual(ctx.t('ui.btn_upgrade'), 'Mejorar');
  assert.strictEqual(ctx.t('stats.depth_val', { n: 42 }), '42m');

  ctx = loadI18n('es');
  ctx.I18n.init();
  assert.strictEqual(ctx.I18n.getCurrent(), 'es', 'choix mémorisé (localStorage dig_lang)');
  assert.strictEqual(ctx.t('cle.inconnue'), 'cle.inconnue');
  assert.strictEqual(ctx.I18n.has('block.pierre'), true);
  assert.strictEqual(ctx.I18n.has('block.poussiere'), false);
  ctx.I18n.setLang('xx');
  assert.strictEqual(ctx.I18n.getCurrent(), 'es', 'langue inconnue ignorée');
});

test('drapeaux : SVG intégré décoratif, sans identifiant, avec libellé de langue', () => {
  const { LANGS } = loadI18n().I18n;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(LANGS.map(l => [l.code, l.label]))),
    [['fr', 'Français'], ['en', 'English'], ['nl', 'Nederlands'], ['es', 'Español']]);
  for (const l of LANGS) {
    assert.match(l.flagSvg, /^<svg class="lang-flag" viewBox="[^"]+" aria-hidden="true" focusable="false">.*<\/svg>$/, l.code);
    assert.doesNotMatch(l.flagSvg, /\bid=|url\(#|<script|on\w+=/, `${l.code} : pas d'identifiant ni de script`);
  }
});

test('sélecteur compact : bouton drapeau + langue, liste dépliante accessible', () => {
  const main = read('public/js/main.js');
  const settings = main.match(/function renderSettings\(\) \{[\s\S]*?\n\}/)[0];
  assert.match(settings, /class="lang-current" id="lang-current"/);
  assert.match(settings, /aria-expanded="false" aria-controls="lang-menu"/);
  assert.match(settings, /class="lang-menu" id="lang-menu"[^>]*hidden/);
  assert.match(settings, /aria-pressed="\$\{lang\.code === current\}"/);
  assert.match(settings, /\$\{lang\.flagSvg\}\s*<span class="lang-option-name">\$\{lang\.label\}<\/span>/);
  const picker = main.match(/function _bindLangPicker\(container\) \{[\s\S]*?\n\}/)[0];
  assert.match(picker, /'Escape'/);
  assert.match(picker, /pointerdown/);
  assert.match(picker, /I18n\.setLang\(btn\.dataset\.lang\)/);

  const css = read('public/css/style.css');
  assert.match(css, /\.lang-menu\[hidden\] \{ display: none; \}/);
  assert.match(css, /\.lang-current \{[^}]*min-height: 44px/, 'cible tactile ≥ 44 px');
  assert.match(css, /#lang-pick-list \{[^}]*grid-template-columns: 1fr 1fr/, 'premier lancement : grille 2 × 2');
  assert.match(read('public/index.html'), /Kies je taal · Elige tu idioma/);
});

test('noms de blocs : catalogue → traduction intégrée de la langue → français', () => {
  const i = loadI18n('es');
  i.I18n.init();
  const ctx = { Math: Object.create(Math), console, I18n: i.I18n, t: i.t };
  ctx.GameState = { upgrades: { luck: 0 }, relicBonuses: { hpReduction: 0 }, blockSeq: 0, blockSeed: 1, gems: 0 };
  vm.createContext(ctx);
  vm.runInContext(`${read('public/js/blocks.js')}\n;this.Blocks = Blocks;`, ctx);
  const B = ctx.Blocks;
  // Minerai de l'étape B publié sans nom ES (catalogue de production avant #42)
  const quartz = { name: 'block.quartz', names: { fr: 'Quartz', en: 'Quartz', nl: 'Kwarts' } };
  assert.strictEqual(B.displayName(quartz), 'Cuarzo');
  assert.strictEqual(B.displayName({ name: 'block.saphir', names: { fr: 'Saphir' } }), 'Zafiro');
  assert.strictEqual(B.displayName({ ...quartz, names: { ...quartz.names, es: 'Cuarzo blanco' } }), 'Cuarzo blanco', 'nom ES du catalogue prioritaire');
  assert.strictEqual(B.displayName({ name: 'block.poussiere', names: { fr: 'Poussière' } }), 'Poussière', 'bloc sans traduction → FR');
  assert.strictEqual(B.displayName({ name: 'block.pierre', names: null }), 'Piedra', 'bloc d\'origine');
});

test('e-mails de compte en espagnol, langue inconnue → français', () => {
  const mailer = require('../server/mailer');
  assert.strictEqual(mailer.pickLang('es'), 'es');
  assert.strictEqual(mailer.pickLang('de'), 'fr');
  for (const kind of ['test', 'verify', 'reset', 'emailChanged', 'socialLinked', 'socialUnlinked']) {
    const m = mailer.compose(kind, { to: 'a@example.com', username: 'Ana', lang: 'es', arg: 'https://x.test/l' });
    assert.match(m.text, /^Hola Ana:/, kind);
    assert.match(m.text, /— DIG!$/, kind);
    assert.match(m.subject, /^DIG! — /, kind);
  }
});

test('boutique de cadeaux et catalogue de blocs : textes ES acceptés et conservés', () => {
  const shop = require('../server/shop');
  const catalog = require('../server/blockCatalog');
  assert.ok(shop.LANGS.includes('es') && catalog.LANGS.includes('es'));
  const item = shop.validateItem({ kind: 'virtual', cost: 10,
    texts: { fr: { title: 'Badge', description: '', conditions: '' }, es: { title: 'Insignia', description: 'Desc', conditions: '' } } });
  const texts = typeof item.texts === 'string' ? JSON.parse(item.texts) : item.texts;
  assert.strictEqual(texts.es.title, 'Insignia');
  const t = catalog.normalizeType({ id: 'opale', names: { fr: 'Opale', es: 'Ópalo' }, category: 'gemme', rarity: 'rare',
    icon: '💠', color: '#ffffff', accent: '#000000', hpBase: 10, reward: 10, minDepth: 5, weight: 1 }, { legacyIds: new Set() });
  assert.deepStrictEqual(t.names, { fr: 'Opale', es: 'Ópalo' });
  const admin = read('public/admin/index.html');
  for (const id of ['bk-name-es', 'sh-es-title', 'sh-es-description', 'sh-es-conditions']) assert.match(admin, new RegExp(`id="${id}"`));
});
