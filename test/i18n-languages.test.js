/**
 * Langues extensibles et pilote italien (ticket #59) :
 * - registre central BCP 47 partagé navigateur/serveur, aucun module ne recode « fr/en/nl/es » ;
 * - une langue preview reste masquée au public (accès testeur ?lang=it), « planned » inaccessible ;
 * - repli français explicite, pluriels Intl, chargement du fichier de langue généré ;
 * - file de traduction IA idempotente et reprenable, corrections humaines protégées, contrôles qualité ;
 * - pilote italien complet, à jour et sans erreur ; garde-fou d'activation.
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
const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-i18n-59-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const LANGS = require('../public/js/languages');
const lib   = require('../tools/i18n/lib');
const check = require('../tools/i18n/check');
const translate = require('../tools/i18n/translate');

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Charge languages.js + i18n.js (+ fichiers de langue) comme dans le navigateur. */
function browser({ search = '', stored = {}, locales = [] } = {}) {
  const store = new Map(Object.entries(stored));
  const appended = [];
  const ctx = {
    console, Intl, URLSearchParams,
    location: { search },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: {
      documentElement: {}, querySelectorAll: () => [], head: { appendChild: el => appended.push(el) },
      createElement: () => ({}),
    },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('public/js/languages.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\n;this.I18n = I18n; this.t = t;`, ctx);
  for (const l of locales) vm.runInContext(read(`public/js/locales/${l}.js`), ctx);
  return { ctx, store, appended };
}

test('registre : codes BCP 47 uniques, français actif et repli, statuts valides', () => {
  const codes = LANGS.LANGUAGES.map(l => l.code);
  assert.strictEqual(new Set(codes).size, codes.length);
  for (const l of LANGS.LANGUAGES) {
    assert.match(l.code, /^[a-z]{2,3}(-[A-Z]{2}|-[a-z]{4})?$/, l.code);
    assert.ok(['active', 'preview', 'planned'].includes(l.status), l.code);
    assert.ok(l.nativeName && l.englishName && l.intl && l.script && l.dir, l.code);
  }
  assert.strictEqual(LANGS.FALLBACK, 'fr');
  assert.strictEqual(LANGS.get('fr').status, 'active');
  assert.deepStrictEqual([...LANGS.ACTIVE], ['fr', 'en', 'nl', 'es']);
  assert.strictEqual(LANGS.get('it').status, 'preview');
  assert.strictEqual(LANGS.get('ru').status, 'planned');
  assert.strictEqual(LANGS.get('ru').script, 'Cyrl');
  assert.strictEqual(LANGS.normalize('it-IT'), 'it');
  assert.strictEqual(LANGS.normalize('IT'), 'it');
  assert.strictEqual(LANGS.normalize('pt_BR'), null);
  assert.strictEqual(LANGS.normalize(''), null);
  // Les langues intégrées sont exactement celles du dictionnaire de i18n.js
  assert.deepStrictEqual(Object.keys(lib.builtinDictionaries()), LANGS.LANGUAGES.filter(l => l.builtin).map(l => l.code));
});

test('serveur : tous les modules de contenu lisent le registre (langues actives seulement)', () => {
  const { CONTENT_LANGS } = require('../server/languages');
  assert.deepStrictEqual([...CONTENT_LANGS], [...LANGS.ACTIVE]);
  for (const m of ['shop', 'news', 'badges', 'collectionCatalog', 'blockCatalog', 'relicCatalog']) {
    assert.deepStrictEqual([...require(`../server/${m}`).LANGS], [...CONTENT_LANGS], m);
  }
  // Une langue preview ne bloque aucune publication (non exigée dans les contenus)
  assert.ok(!CONTENT_LANGS.includes('it'));
  // Plus aucune liste « fr/en/nl/es » recodée en dur dans le serveur ni l'admin
  for (const f of ['shop', 'news', 'badges', 'collectionCatalog', 'blockCatalog', 'relicCatalog', 'monthlyEvents', 'seasonThemes', 'badgeAi', 'collectionAi', 'blockAi']) {
    assert.doesNotMatch(read(`server/${f}.js`), /\['fr', 'en', 'nl', 'es'\]|fr: 'French', en: 'English'/, f);
  }
  assert.doesNotMatch(read('public/admin/admin.js'), /_LANGS = \['fr', 'en', 'nl', 'es'\]/);
  // Le registre est chargé avant i18n.js dans le jeu et l'admin
  for (const f of ['public/index.html', 'public/admin/index.html']) {
    const html = read(f);
    assert.ok(html.indexOf('js/languages.js') > 0 && html.indexOf('js/languages.js') < html.indexOf('js/i18n.js'), f);
  }
});

test('jeu : l’italien est masqué au public, ouvert au testeur par ?lang=it, « planned » refusé', () => {
  const pub = browser();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(pub.ctx.I18n.LANGS.map(l => l.code))), ['fr', 'en', 'nl', 'es']);
  assert.strictEqual(pub.ctx.I18n.getCurrent(), 'fr');

  const tester = browser({ search: '?lang=it' });
  assert.strictEqual(tester.store.get('dig_lang'), 'it');
  assert.strictEqual(tester.store.get('dig_lang_preview'), '1');
  assert.ok(tester.ctx.I18n.LANGS.some(l => l.code === 'it' && l.label === 'Italiano'));

  const ru = browser({ search: '?lang=ru' });
  assert.strictEqual(ru.store.get('dig_lang'), undefined);
  assert.ok(!ru.ctx.I18n.LANGS.some(l => l.code === 'ru'));
  ru.ctx.I18n.setLang('ru');
  assert.strictEqual(ru.ctx.I18n.getCurrent(), 'fr');
  assert.strictEqual(ru.ctx.I18n.registerLocale('ru', { nav: { dig: 'Копать' } }), false);
});

test('jeu : chargement du fichier italien, repli français explicite, pluriels italiens', () => {
  const b = browser({ stored: { dig_lang: 'it', dig_lang_preview: '1' } });
  b.ctx.I18n.init();
  assert.strictEqual(b.ctx.I18n.getCurrent(), 'it');
  assert.strictEqual(b.ctx.document.documentElement.lang, 'it');
  assert.strictEqual(b.appended.length, 1);
  assert.match(b.appended[0].src, /^js\/locales\/it\.js$/);
  // Avant chargement (ou si le fichier est injoignable) : français, jamais la clé technique
  assert.strictEqual(b.ctx.t('nav.shop'), 'Boutique');
  vm.runInContext(read('public/js/locales/it.js'), b.ctx);
  assert.strictEqual(b.ctx.t('nav.shop'), 'Negozio');
  assert.strictEqual(b.ctx.t('settings.lang_title'), 'Lingua');
  assert.strictEqual(b.ctx.t('upgrade.pickaxe.desc', { damage: 1, s: '' }), '1 danno per clic');
  assert.strictEqual(b.ctx.t('upgrade.pickaxe.desc', { damage: 3, s: 's' }), '3 danni per clic');
  assert.strictEqual(b.ctx.t('ui.daily_reward_gems', { amount: '1', s: '' }), '💎 1 gemma');
  assert.strictEqual(b.ctx.I18n.intl(), 'it-IT');
  // Clé absente de l'italien → texte français
  const p = browser({ stored: { dig_lang: 'it', dig_lang_preview: '1' } });
  p.ctx.I18n.init();
  p.ctx.I18n.registerLocale('it', { nav: { shop: 'Negozio' } });
  assert.strictEqual(p.ctx.t('nav.shop'), 'Negozio');
  assert.strictEqual(p.ctx.t('nav.daily'), 'Quotidien');
  // Les langues intégrées ne peuvent pas être écrasées par un fichier
  assert.strictEqual(p.ctx.I18n.registerLocale('fr', { nav: { shop: 'X' } }), false);
});

test('pluriels : catégories Intl (few/many pour le russe) choisies d\u2019après la langue', () => {
  const b = browser({ stored: { dig_lang: 'it', dig_lang_preview: '1' } });
  b.ctx.I18n.init();
  b.ctx.I18n.registerLocale('it', { x: { y: { $n: 'k', one: 'uno {k}', many: 'molti {k}', other: 'altri {k}' } } });
  assert.strictEqual(b.ctx.t('x.y', { k: 1 }), 'uno 1');
  assert.strictEqual(b.ctx.t('x.y', { k: 7 }), 'altri 7');
  assert.strictEqual(b.ctx.t('x.y', { k: '1' }), 'uno 1', 'nombre formaté accepté');
  const pr = new Intl.PluralRules('ru-RU');
  assert.deepStrictEqual([1, 2, 5, 21].map(n => pr.select(n)), ['one', 'few', 'many', 'one']);
});

test('contrôles qualité : variables, balises, écriture, oubli, langue improbable', () => {
  const ce = (code, fr, text, key = 'x.y') => check.checkEntry(code, key, fr, text);
  assert.deepStrictEqual(ce('it', 'Niveau {cur} → {next}', 'Livello {cur} → {next}').errors, []);
  assert.match(ce('it', 'Niveau {cur} → {next}', 'Livello {cur}').errors[0], /variables/);
  assert.match(ce('it', 'Gagné {n}', 'Vinto {num}').errors[0], /variables/);
  assert.deepStrictEqual(ce('it', '{n} coffre{s}', '{n} forzieri').errors, [], '{s} facultatif');
  assert.match(ce('it', '<b>{n}</b> pièces', '{n} monete').errors[0], /balises/);
  assert.match(ce('it', 'Bonjour', '').errors[0], /vide/);
  assert.match(ce('ru', 'Creuser le bloc', 'Dig the block').errors[0], /cyrillique/);
  assert.deepStrictEqual(ce('ru', 'Creuser le bloc', 'Копать блок').errors, []);
  assert.match(ce('it', 'Pierre', 'Привет').errors[0], /cyrilliques/);
  assert.match(ce('it', 'Réclamer la récompense', 'Réclamer la récompense', 'ui.btn_claim').warnings[0], /identique/);
  assert.match(ce('it', 'Les objets restent dans ta collection pour toujours', 'Les objets restent dans ta collection pour toujours avec des amis').warnings.join(), /identique|improbable/);
  assert.match(ce('it', 'Dig', 'Scavare in profondità adesso', 'nav.dig').warnings.join(), /mobile/);
  assert.match(ce('it', '🎉 Événements', 'Eventi').warnings.join(), /emoji/);
  // Pluriel : forme « other » obligatoire, variables de toutes les formes réunies
  assert.deepStrictEqual(ce('it', '{n} gemme{s}', { $n: 'n', one: '{n} gemma', other: '{n} gemme' }).errors, []);
  assert.match(ce('it', '{n} gemme{s}', { $n: 'n', one: '{n} gemma' }).errors[0], /forme invalide/);
});

test('outil : file idempotente, reprise, plafonds, rejet des variables cassées, humain protégé', async () => {
  const work = path.join(dir, 'store');
  process.env.DIG_I18N_DIR = work;
  process.env.DIG_I18N_PUBLIC_DIR = path.join(dir, 'public');
  try {
    const src = lib.source();
    const total = Object.keys(src).length;
    // Simulation : aucun appel, estimation seulement
    const dry = await translate.run('it', { apply: false });
    assert.strictEqual(dry.queued, total);
    assert.ok(dry.estimateUsd > 0 && dry.estimateUsd < 0.5);
    // Langue « planned » : refusée (pas de lancement automatique du russe)
    await assert.rejects(translate.run('ru', { apply: true, provider: translate.fakeProvider() }), /planned/);
    await assert.rejects(translate.run('fr', { apply: true, provider: translate.fakeProvider() }), /intégrée/);

    // Deux lots au plus par lancement → reprise au lancement suivant sans refaire le travail
    const p1 = translate.fakeProvider();
    const r1 = await translate.run('it', { apply: true, provider: p1, batchSize: 50, maxBatches: 2 });
    assert.strictEqual(r1.done, 2);
    assert.match(r1.stoppedBy, /limite de 2 lot/);
    assert.strictEqual(r1.accepted, 100);
    assert.strictEqual(lib.queue('it', src, lib.loadStore('it')).length, total - 100);
    const journal = fs.readFileSync(path.join(work, 'journal.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.strictEqual(journal.length, 2);
    assert.ok(journal.every(j => j.lang === 'it' && j.keys === 50 && typeof j.cost_usd === 'number' && !/sk-|Bearer/.test(JSON.stringify(j))));

    // Plafond de la commande
    const r2 = await translate.run('it', { apply: true, provider: { ...translate.fakeProvider(), prices: { input: 1, output: 1 } }, batchSize: 50, maxBatches: 99, maxUsd: 0.0001 });
    assert.strictEqual(r2.done, 0);
    assert.match(r2.stoppedBy, /plafond de la commande/);
    // Plafond local partagé
    const broke = { ...translate.fakeProvider(), prices: { input: 1, output: 1 }, spent: () => 5, budgetUsd: 1 };
    const r3 = await translate.run('it', { apply: true, provider: broke, maxUsd: 10 });
    assert.match(r3.stoppedBy, /plafond local/);

    // Un modèle qui casse les variables : traduction rejetée, la clé reste en file
    const bad = { ...translate.fakeProvider(), async call(msgs) {
      const items = JSON.parse(msgs[1].content);
      return { data: { translations: items.map(i => ({ key: i.key, text: 'testo senza variabili' })) }, cost: 0, model: 'bad' };
    } };
    const before = lib.queue('it', src, lib.loadStore('it')).length;
    const r4 = await translate.run('it', { apply: true, provider: bad, maxBatches: 99, batchSize: 1000 });
    assert.ok(r4.rejected.some(x => /variables/.test(x.reason)));
    const after = lib.queue('it', src, lib.loadStore('it')).length;
    assert.ok(after > 0 && after < before, 'seules les clés sans variable sont acceptées');

    // Tout traduire, puis relancer : file vide (idempotent), aucun appel
    await translate.run('it', { apply: true, provider: translate.fakeProvider(), batchSize: 1000, maxBatches: 99 });
    assert.strictEqual(lib.queue('it', src, lib.loadStore('it')).length, 0);
    let calls = 0;
    const spy = { ...translate.fakeProvider(), async call() { calls++; return { data: { translations: [] }, cost: 0 }; } };
    const r5 = await translate.run('it', { apply: true, provider: spy });
    assert.strictEqual(r5.queued, 0);
    assert.strictEqual(calls, 0);

    // Correction humaine : prioritaire, jamais retraduite même si le français change
    const { correct } = require('../tools/i18n/cli');
    correct('it', 'nav.shop', 'Bottega', 'Giulia');
    assert.throws(() => correct('it', 'upgrade.next_level', 'Livello', 'Giulia'), /variables/);
    assert.throws(() => correct('it', 'nope.key', 'x', 'Giulia'), /inconnue/);
    const s = lib.loadStore('it');
    assert.strictEqual(s.entries['nav.shop'].origin, 'human');
    s.entries['nav.shop'].src = 'ancienne';        // le français a changé depuis la correction
    s.entries['nav.daily'].src = 'ancienne';       // et pour une traduction IA
    lib.saveStore('it', s);
    const q = lib.queue('it', src, lib.loadStore('it')).map(r => r.key);
    assert.deepStrictEqual(q, ['nav.daily'], 'IA périmée retraduite, humain jamais');
    assert.deepStrictEqual(check.report('it').reviewKeys, ['nav.shop'], 'humain signalé « à revoir »');
    await translate.run('it', { apply: true, provider: translate.fakeProvider() });
    assert.strictEqual(lib.loadStore('it').entries['nav.shop'].text, 'Bottega');

    // Fichier publié : contient la correction, exclut une entrée en erreur (repli FR)
    const s2 = lib.loadStore('it');
    s2.entries['upgrade.next_level'].text = 'Livello rotto';
    lib.saveStore('it', s2);
    const out = lib.build('it', { check });
    assert.strictEqual(out.count, total - 1);
    const pub = fs.readFileSync(out.file, 'utf8');
    assert.match(pub, /"shop": "Bottega"/);
    assert.doesNotMatch(pub, /Livello rotto/);

    // Import CSV d'une relecture native
    const csv = path.join(dir, 'review.csv');
    fs.writeFileSync(csv, '﻿"key";"fr";"it";"origin";"state";"notes";"correction"\n"nav.collection";"Collection";"x";"ai";"ok";"";"Raccolta"\n"nav.dig";"Dig";"x";"ai";"ok";"";""\n');
    const { parseCsv } = require('../tools/i18n/cli');
    assert.strictEqual(parseCsv('"a";"b ""c"""\n')[0][1], 'b "c"');
    const rows = parseCsv(fs.readFileSync(csv, 'utf8').replace(/^﻿/, ''));
    assert.strictEqual(rows[1][6], 'Raccolta');
  } finally {
    delete process.env.DIG_I18N_DIR;
    delete process.env.DIG_I18N_PUBLIC_DIR;
  }
});

test('pilote italien : complet, sans erreur, fichier publié à jour', () => {
  const r = check.report('it');
  assert.strictEqual(r.coverage, 100);
  assert.strictEqual(r.errors, 0, JSON.stringify(r.issues.filter(i => i.errors.length)));
  assert.strictEqual(r.missing + r.stale + r.orphan, 0);
  // Le fichier versionné correspond exactement à la mémoire de traduction
  const tmp = path.join(dir, 'pub-check');
  process.env.DIG_I18N_PUBLIC_DIR = tmp;
  try {
    lib.build('it', { check });
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'it.js'), 'utf8'), read('public/js/locales/it.js'), 'relancer : node tools/i18n/cli.js build it');
  } finally { delete process.env.DIG_I18N_PUBLIC_DIR; }
  // L'italien n'est pas le français recopié
  const it = lib.loadStore('it').entries;
  const src = lib.source();
  const same = Object.keys(src).filter(k => typeof src[k] === 'string' && it[k].text === src[k] && /\p{L}{4}/u.test(src[k]));
  assert.ok(same.length <= 15, same.join(', '));
});

test('garde-fou d’activation : une langue non intégrée « active » doit être complète et sans erreur', () => {
  for (const l of LANGS.LANGUAGES.filter(x => !x.builtin && x.status !== 'planned')) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', 'js', 'locales', `${l.code}.js`)), `fichier publié manquant pour ${l.code}`);
    if (l.status === 'active') {
      const r = check.report(l.code);
      assert.ok(r.coverage >= 98 && r.errors === 0, `${l.code} : couverture ${r.coverage} %, ${r.errors} erreur(s)`);
    }
  }
  for (const l of LANGS.LANGUAGES.filter(x => x.status === 'planned')) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'js', 'locales', `${l.code}.js`)), `${l.code} planned ne doit rien publier`);
  }
});

test('textes oubliés : toute clé littérale du code existe en français', () => {
  const r = check.scanCode();
  assert.ok(r.used > 300);
  assert.deepStrictEqual(r.missing, []);
});

test('recettes #59-A/C/D : pluriels NL/ES, formulations EN/NL/ES de la page Collection', () => {
  const { ctx } = browser();
  const tr = (lang, key, params) => { ctx.I18n.setLang(lang); return ctx.t(key, params); };
  const NNBSP = ' ', NBSP = ' ';
  // Néerlandais : vrai pluriel « scherven », jamais « scherfs »
  assert.strictEqual(tr('nl', 'ui.relic_cost', { n: 5, s: 's' }), `🔮${NNBSP}5 scherven`);
  assert.strictEqual(tr('nl', 'ui.relic_cost', { n: 1, s: '' }), `🔮${NNBSP}1 scherf`);
  assert.strictEqual(tr('nl', 'ui.relic_shortfall', { n: 3 }), `(nog 3${NBSP}nodig)`);
  assert.strictEqual(tr('nl', 'relic.bonus_types.autodig_bonus', { n: 2 }), '+2 automatische schade per seconde');
  assert.strictEqual(tr('nl', 'events.souvenirs'), 'Evenementherinneringen');
  assert.strictEqual(tr('nl', 'ui.daily_reward_gems', { amount: 3, s: 's' }), '💎 3 edelstenen');
  // Anglais : « damage » indénombrable, « more needed »
  assert.strictEqual(tr('en', 'relic.bonus_types.damage_flat', { n: 2, s: 's' }), '+2 damage per click');
  assert.strictEqual(tr('en', 'relic.bonus_types.relic_fragment_bonus', { n: 1, s: '' }), '+1 fragment per chest');
  assert.strictEqual(tr('en', 'ui.relic_shortfall', { n: 3 }), `(3${NBSP}more needed)`);
  assert.strictEqual(tr('en', 'events.souvenirs'), 'Event keepsakes');
  // Espagnol : « por clic », « falta/faltan »
  assert.strictEqual(tr('es', 'relic.bonus_types.damage_flat', { n: 2 }), '+2 de daño por clic');
  assert.strictEqual(tr('es', 'relic.bonus_types.relic_fragment_bonus', { n: 1, s: '' }), '+1 fragmento por cofre');
  assert.strictEqual(tr('es', 'ui.relic_shortfall', { n: 1 }), `(falta${NNBSP}1)`);
  assert.strictEqual(tr('es', 'ui.relic_shortfall', { n: 3 }), `(faltan${NNBSP}3)`);
  // Aucun « {s} » ne reste dans les textes néerlandais (le pluriel NL n'est pas un simple « s »)
  const flat = lib.flatten(lib.builtinDictionaries().nl);
  for (const [k, v] of Object.entries(flat)) {
    for (const s of typeof v === 'string' ? [v] : Object.values(v)) assert.ok(!/\{s\d?\}/.test(s), `nl ${k} : ${s}`);
  }
  // Le coût et le manque restent séparés par un vrai espace (plus de flex qui l'avale)
  assert.doesNotMatch(read('public/css/style.css').match(/\.relic-cost \{[^}]*\}/)[0], /display:\s*flex/);
});

test('recettes #59-G/H : Verbeteringen et kansen van kisten en NL, unité « m » espacée', () => {
  const { ctx } = browser({ locales: ['it'] });
  const tr = (lang, key, params) => { ctx.I18n.setLang(lang); return ctx.t(key, params); };
  const NBSP = ' ';
  // #59-G — écran Verbeteringen
  assert.strictEqual(tr('nl', 'upgrade.fragment_shop.desc_none'), '1 relikwiescherf kopen');
  assert.strictEqual(tr('nl', 'upgrade.block_reroll.desc_none'), 'Huidig blok vervangen');
  assert.strictEqual(tr('nl', 'upgrade.luck.desc'), 'Meer zeldzame blokken, zonder trager te graven');
  assert.strictEqual(tr('nl', 'upgrade.autodig.desc', { dmg: 2 }), '2 automatische schade per seconde');
  assert.strictEqual(tr('nl', 'upgrade.autodig.effect', { cur: 2, next: 3 }), `Automatische schade per seconde: 2${NBSP}→${NBSP}3`);
  assert.strictEqual(tr('nl', 'shopguide.title'), 'Waar gebruik je welke valuta?');
  assert.strictEqual(tr('nl', 'upgrade.luck.preview_max', { depth: 75, now: 12 }), `Op 75${NBSP}m: 12% zeldzame blokken`);
  // #59-H — fenêtre « beloningen en kansen » (il s'agit bien de fragments de relique)
  assert.strictEqual(tr('nl', 'chest_odds.unlimited'), 'Onbeperkt te openen.');
  assert.strictEqual(tr('nl', 'chest_odds.relics', { n: 1 }), '🔮 1 relikwiescherf');
  assert.strictEqual(tr('nl', 'chest_odds.relics', { n: 3 }), '🔮 3 relikwiescherven');
  assert.strictEqual(tr('nl', 'chest_odds.boost', { mult: 2, minutes: 5 }), `⚡ 2× zoveel munten uit blokken — 5${NBSP}min`);
  // Unité de profondeur : « 75 m » dans toutes les langues, jamais « 75m »
  for (const lang of ['fr', 'en', 'nl', 'es', 'it']) {
    assert.strictEqual(tr(lang, 'stats.depth_val', { n: 75 }), `75${NBSP}m`, lang);
    for (const key of ['upgrade.luck.preview', 'upgrade.luck.preview_max', 'upgrade.luck.preview_none', 'quest.depth25.desc']) {
      assert.doesNotMatch(tr(lang, key, { depth: 75, now: 1, next: 2 }), /\dm\b/, `${lang} ${key}`);
    }
  }
});

test('recette du 08/11 : cartes des coffres en NL sans « Coins » anglais', () => {
  const { ctx } = browser({ locales: ['it'] });
  ctx.I18n.setLang('nl');
  assert.strictEqual(ctx.t('shop_chest.simple.desc'), 'Munten, fragmenten of een boost — kleine gegarandeerde beloningen.');
  for (const k of ['simple', 'rare', 'antique']) {
    assert.doesNotMatch(ctx.t(`shop_chest.${k}.desc`), /\bcoins?\b/i, k);
    assert.doesNotMatch(ctx.t(`shop_chest.${k}.name`), /\bcoins?\b/i, k);
  }
});
