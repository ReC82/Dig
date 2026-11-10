/**
 * Aide du joueur (ticket #78) :
 * - bouton Aide tout à gauche de l'en-tête (avant la cloche), intitulé accessible traduit, fiche modale ;
 * - source unique : chaque rubrique (titre, résumé de 2 à 5 phrases, précisions) existe en fr/en/nl/es
 *   et dans le fichier italien publié ; aucune clé technique affichée ;
 * - contenu fidèle au jeu : pas de chiffres d'équilibrage, pas de fonction désactivée promise
 *   (publicité réelle, concours, pioche à charges, achat de gemmes) ; classement = blocs manuels validés ;
 * - ? contextuels : présents près de Collection, Événements, Reliques, Saison, Classement, Pioche, Auto-Dig,
 *   Gemmes, Fragments… et chacun pointe vers une rubrique existante ;
 * - aucune action de jeu depuis help.js (ni sauvegarde, ni achat, ni requête, ni changement d'onglet).
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
const html = read('public/index.html');
const main = read('public/js/main.js');
const helpSrc = read('public/js/help.js');

/** languages.js + i18n.js (+ italien) + help.js, comme dans le navigateur (sans DOM réel). */
function load(lang = 'fr') {
  const store = new Map([['dig_lang', lang]]);
  if (lang === 'it') store.set('dig_lang_preview', '1');
  const ctx = {
    console, Intl, URLSearchParams,
    location: { search: '' },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: { documentElement: {}, querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({}) },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('public/js/languages.js'), ctx);
  vm.runInContext(read('public/js/escapeHtml.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\n;this.I18n = I18n; this.t = t;`, ctx);
  vm.runInContext(read('public/js/locales/it.js'), ctx);
  vm.runInContext(`${helpSrc}\n;this.DigHelp = DigHelp;`, ctx);
  ctx.I18n.init();
  return ctx;
}

const LANGS = ['fr', 'en', 'nl', 'es', 'it'];
const sentences = s => s.split(/(?<=[.!?…])\s+(?=\p{Lu}|«|“|„|¿|¡)/u).filter(x => x.trim()).length;

test('en-tête : bouton Aide tout à gauche, avant la cloche, intitulé accessible et fiche modale', () => {
  const left = html.slice(html.indexOf('<div class="header-left">'), html.indexOf('<h1 id="game-logo"'));
  assert.ok(left.indexOf('id="btn-help"') > 0 && left.indexOf('id="btn-help"') < left.indexOf('id="btn-news"'), 'Aide avant la cloche');
  const btn = left.slice(left.indexOf('<button id="btn-help"'), left.indexOf('</button>', left.indexOf('id="btn-help"')));
  for (const a of ['type="button"', 'aria-label="Aide — comment jouer"', 'data-i18n-aria="help.btn_aria"', 'aria-haspopup="dialog"', 'aria-controls="help-panel"', 'aria-expanded="false"'])
    assert.ok(btn.includes(a), a);
  assert.ok(/<svg class="hdr-ico"[^>]*aria-hidden="true"/.test(btn), 'pictogramme décoratif');
  assert.match(html, /<div id="help-panel" hidden role="dialog" aria-modal="true" aria-labelledby="help-panel-title">/);
  assert.ok(html.indexOf('js/help.js') > 0 && html.indexOf('js/help.js') < html.indexOf('js/main.js'), 'help.js chargé avant main.js');
  assert.match(main, /DigHelp\.init\(\)/);
});

test('source unique : chaque rubrique et chaque question existent dans toutes les langues du jeu', () => {
  for (const lang of LANGS) {
    const c = load(lang);
    assert.strictEqual(c.I18n.getCurrent(), lang);
    const H = c.DigHelp;
    const keys = ['help.title', 'help.btn_aria', 'help.close', 'help.more', 'help.tip_aria', 'help.fallback', 'help.footer',
      'help.intro.title', 'help.intro.step1', 'help.intro.step4', ...H.GROUPS.map(g => `help.groups.${g.id}`), 'help.groups.faq'];
    for (const id of Object.keys(H.TOPICS)) keys.push(`help.topics.${id}.title`, `help.topics.${id}.short`);
    for (const f of H.FAQ) keys.push(`help.faq.${f}.q`, `help.faq.${f}.a`);
    for (const k of keys) assert.ok(c.I18n.has(k, lang), `${lang} ${k}`);
    // Résumé d'une bulle : 2 à 5 phrases, variables remplacées (libellés réels des onglets et boutons)
    for (const id of Object.keys(H.TOPICS)) {
      const s = c.t(`help.topics.${id}.short`);
      const n = sentences(s);
      assert.ok(n >= 2 && n <= 5, `${lang} ${id} : ${n} phrase(s)`);
    }
  }
});

test('contenu : pas de chiffres d’équilibrage ni de fonction désactivée promise ; règles métier respectées', () => {
  const c = load('fr');
  const fr = c.I18n.get;
  const all = [];
  // Dictionnaire français de l'aide, lu dans i18n.js tel qu'il est servi
  const src = read('public/js/i18n.js');
  const block = src.slice(src.indexOf('    fr: {'), src.indexOf('    en: {'));
  const helpBlock = block.slice(block.indexOf('help: {'), block.indexOf('\n      },\n', block.indexOf('help: {')));
  assert.ok(helpBlock.length > 2000);
  for (const [k, v] of helpBlock.split('\n').filter(l => /:\s'/.test(l)).map(l => l.trim().split(/:\s(.*)/s))) all.push([k, v]);
  for (const [k, v] of all) {
    const txt = v.replace(/\{\w+\}/g, '');
    assert.ok(!/\d/.test(txt.replace(/\b7\b/g, '')), `chiffre figé dans ${k} : ${v}`);   // seule la série de 7 jours est structurelle
    assert.ok(!/publicit|concours|réserve de coups|charges?\b|acheter des gemmes|argent réel/i.test(txt), `fonction non disponible dans ${k}`);
  }
  assert.ok(fr('help.topics.ranking.short', 'fr').includes('Auto-Dig ne comptent pas'));
  assert.ok(/uniquement du nombre de blocs que tu as cassés toi-même, validés par le serveur/.test(fr('help.topics.ranking.short', 'fr')));
  assert.ok(/profondeur/i.test(fr('help.faq.rank_depth.q', 'fr')));
  assert.ok(/Bientôt/.test(fr('help.topics.gems.more1', 'fr')), 'la boutique de gemmes est annoncée fermée');
  assert.ok(/souvenirs/.test(fr('help.topics.events.short', 'fr')) && /origines/.test(fr('help.topics.events.more1', 'fr')), 'événements ≠ collection d’origine');
  // Les libellés cités sont ceux du jeu, dans la langue du joueur
  const en = load('en');
  assert.ok(en.t('help.topics.boosts.short', { btn_double: en.t('ui.btn_watch_ad') }).includes('“Double the reward”'));
});

test('? contextuels : présents aux bons endroits et reliés à une rubrique existante', () => {
  const c = load('fr');
  const ids = new Set(Object.keys(c.DigHelp.TOPICS));
  const used = [...html.matchAll(/data-help="(\w+)"/g)].map(m => m[1]).concat([...main.matchAll(/DigHelp\.tipHtml\('(\w+)'\)/g)].map(m => m[1]));
  const upg = main.match(/const UPGRADE_HELP = \{([^}]*)\}/)[1];
  used.push(...[...upg.matchAll(/:\s*'(\w+)'/g)].map(m => m[1]));
  for (const id of used) assert.ok(ids.has(id), `rubrique inconnue : ${id}`);
  for (const id of ['collection', 'events', 'relics', 'season', 'ranking', 'pickaxe', 'autodig', 'gems', 'fragments', 'chests', 'daily', 'missions', 'badges', 'leagues', 'upgrades'])
    assert.ok(used.includes(id), `? manquant : ${id}`);
  // Les titres statiques gardent leur texte traduit dans un <span> (applyTranslations ne doit pas effacer le ?)
  assert.ok(!/data-i18n="[^"]+"[^>]*>[^<]*<button[^>]*help-tip-btn/.test(html.replace(/<span data-i18n/g, '')));
  for (const k of ['ui.view_collection', 'ui.section_relics', 'badges.section', 'ui.view_upgrades', 'ui.section_shop_chests'])
    assert.match(html, new RegExp(`<span data-i18n="${k.replace('.', '\\.')}"( data-ui-lead="\\w+")?>`), k);   // pictogramme de tête remplaçable (#67-B)
  // Bouton rendu : intitulé « Aide : <rubrique> », ouvre une bulle, symbole décoratif
  const b = c.DigHelp.tipHtml('relics');
  assert.ok(b.includes('aria-label="Aide : Reliques"') && b.includes('aria-haspopup="dialog"') && b.includes('<span aria-hidden="true">?</span>'));
  assert.strictEqual(c.DigHelp.tipHtml('inconnu'), '');
  const nl = load('nl');
  assert.ok(nl.DigHelp.tipHtml('ranking').includes('aria-label="Hulp: Klassement"'));
});

test('aucune action de jeu depuis l’aide : ni sauvegarde, ni achat, ni requête, ni changement d’onglet', () => {
  const code = helpSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const re of [/Save\./, /fetch\(/, /GameState/, /purchase|buy\(/, /switchView/, /localStorage/])
    assert.ok(!re.test(code), `help.js ne doit pas contenir ${re}`);
  // Textes insérés échappés (aucun HTML venant des traductions)
  assert.ok(/_esc\(short\(id\)\)/.test(helpSrc) && /_esc\(title\(id\)\)/.test(helpSrc));
  // Fermeture : Échap, ✕, clic à côté ; focus rendu au bouton d'origine
  assert.match(helpSrc, /e\.key === 'Escape'/);
  assert.match(helpSrc, /_panelOpener/);
});
