/**
 * Navigation du panel admin (#70) : menu groupé construit depuis un registre unique (ADM_NAV), recherche
 * « Aller à une rubrique », menu réductible / déroulant, rubrique retenue dans le fragment d'URL (#50-F),
 * signal d'anomalie réel uniquement. Parcours Chromium : test/e2e/admin-nav.e2e.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');

const ctx = {};
vm.runInNewContext(`${JS.slice(JS.indexOf('const ADM_NAV_GROUPS = ['), JS.indexOf('const admNavItem ='))}
  this.G = ADM_NAV_GROUPS; this.N = ADM_NAV; this.D = ADM_NAV_DEFAULT;`, ctx);
const sections = [...HTML.matchAll(/<section id="tab-([\w-]+)" class="tab-content/g)].map(m => m[1]);

test('registre : chaque section a exactement une rubrique, et inversement', () => {
  const ids = ctx.N.map(t => t.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'identifiants uniques');
  assert.deepStrictEqual([...ids].sort(), [...sections].sort());
  assert.ok(ids.includes(ctx.D), 'rubrique par défaut connue');
  for (const t of ctx.N) {
    assert.match(t.id, /^[a-z-]+$/, t.id);   // admTabBtn n'accepte que ce format (fragment d'URL)
    assert.ok(t.label && t.icon && Number.isFinite(t.order), `${t.id} : libellé, icône, ordre`);
    assert.ok(ctx.G.some(g => g.id === t.group), `${t.id} : groupe ${t.group} inconnu`);
  }
  const orders = ctx.N.map(t => `${t.group}:${t.order}`);
  assert.strictEqual(new Set(orders).size, orders.length, 'ordre sans ex-aequo dans un groupe');
});

test('regroupement demandé : cinq familles (pas de tableau de bord artificiel), rubriques à leur place', () => {
  assert.deepStrictEqual([...ctx.G.map(g => g.id)], ['game', 'competition', 'content', 'visuals', 'ops']);
  const at = id => ctx.N.find(t => t.id === id).group;
  for (const id of ['blocks', 'rewards', 'upgrades', 'relics', 'missions', 'economy']) assert.strictEqual(at(id), 'game', id);
  for (const id of ['season-overview', 'seasons', 'leagues', 'leaderboard', 'points', 'contest']) assert.strictEqual(at(id), 'competition', id);
  for (const id of ['collections', 'badges', 'events', 'news']) assert.strictEqual(at(id), 'content', id);
  assert.strictEqual(at('icons'), 'visuals');
  for (const id of ['beta', 'security', 'ads', 'config']) assert.strictEqual(at(id), 'ops', id);
  // doublon d'intitulé levé : « Ligues & Saisons » / « Saisons »
  const labels = ctx.N.map(t => t.label);
  assert.strictEqual(new Set(labels).size, labels.length, 'libellés distincts');
  assert.ok(!labels.includes('Saisons') && labels.includes('Saison en cours') && labels.includes('Historique des saisons'));
});

test('chargements branchés : chaque rubrique chargée l\'est par le registre (plus de chaîne de if)', () => {
  assert.doesNotMatch(JS, /btn\.dataset\.tab === '/);
  for (const t of ctx.N) {
    if (!t.load) continue;
    for (const fn of String(t.load).match(/load\w+(?=\()/g)) assert.match(JS, new RegExp(`function ${fn}\\(`), `${t.id} : ${fn}`);
  }
  for (const id of ['news', 'events', 'rewards', 'blocks', 'upgrades', 'missions', 'config', 'season-overview']) {
    assert.ok(ctx.N.find(t => t.id === id).load, `${id} chargé à l'ouverture`);
  }
});

test('HTML : plus aucun lien d\'onglet codé en dur, menu accessible', () => {
  assert.doesNotMatch(HTML, /class="tab-btn/);
  assert.match(HTML, /<nav class="admin-nav" id="admin-nav" aria-label="[^"]+">/);
  assert.match(HTML, /id="nav-menu-btn"[^>]*aria-expanded="false" aria-controls="nav-panel"/);
  assert.match(HTML, /id="nav-collapse-btn"[^>]*aria-pressed="false"/);
  assert.match(HTML, /id="nav-search" type="search"[^>]*aria-label=/);
  assert.match(HTML, /<main class="admin-main" id="admin-main">[\s\S]*<section id="tab-seasons" class="tab-content">[\s\S]*<\/main>/);
  // le menu construit pose aria-expanded / aria-current et n'injecte aucun HTML
  const build = JS.slice(JS.indexOf('function admNavBuild('), JS.indexOf('function admNavSetGroup('));
  assert.doesNotMatch(build, /innerHTML/);
  assert.match(JS, /setAttribute\('aria-expanded', String\(open\)\)/);
  assert.match(JS, /b\.setAttribute\('aria-current', 'page'\)/);
});

test('CSS : plus de bandeau d\'onglets sur plusieurs lignes, menu latéral / déroulant', () => {
  assert.doesNotMatch(CSS, /\.admin-nav \{[^}]*flex-wrap: wrap/);
  assert.match(CSS, /\.admin-shell \{ display: grid; grid-template-columns: 236px minmax\(0, 1fr\);/);
  assert.match(CSS, /\.admin-shell\.nav-collapsed \{ grid-template-columns: 58px/);
  assert.match(CSS, /@media \(max-width: 900px\) \{\n  \.admin-shell, \.admin-shell\.nav-collapsed \{ display: block; \}/);
  assert.match(CSS, /\.nav-panel \{ display: none; \}\n  \.admin-nav\.is-open \.nav-panel \{ display: block;/);
  // libellés masqués visuellement en mode icônes, pas supprimés (lecteurs d'écran)
  assert.match(CSS, /\.nav-collapsed \.tab-btn \.nav-lbl \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip:/);
});

test('rubrique retenue dans l\'URL sans entrée d\'historique ; préférences seulement visuelles en local', () => {
  assert.match(JS, /history\.replaceState\(null, '', `\$\{location\.pathname\}\$\{location\.search\}#\$\{id\}`\)/);
  assert.doesNotMatch(JS, /history\.pushState/);
  const prefs = JS.slice(JS.indexOf('function admNavPrefs('), JS.indexOf('const admNavFold'));
  assert.match(prefs, /collapsed: !!p\.collapsed, closed: Array\.isArray\(p\.closed\)/);
  // la rubrique courante ne passe pas par le stockage local
  assert.strictEqual((JS.match(/localStorage\./g) || []).length, 2);
});

test('signal d\'anomalie : uniquement sur des faits serveur (pas de faux signal hors ligne)', () => {
  assert.match(JS, /if \(ok \|\| status === 404\) admNavFlag\('season-overview', ok \? null : 'aucune saison active'\);/);
  assert.match(JS, /admNavFlag\('upgrades', suspended \? `\$\{suspended\} amélioration\(s\) suspendue\(s\) en urgence` : null\);/);
  assert.strictEqual((JS.match(/admNavFlag\('/g) || []).length, 2, 'aucun autre signal');
});

test('recherche « Aller à une rubrique » : sans accents, par libellé, groupe ou mot-clé', () => {
  const fold = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const find = q => [...ctx.N].filter(t => fold(`${t.label} ${t.id} ${ctx.G.find(g => g.id === t.group).label} ${t.keywords ?? ''}`).includes(fold(q))).map(t => t.id);
  assert.deepStrictEqual(find('mensuel'), ['events']);
  assert.deepStrictEqual(find('evenement'), ['news', 'events', 'collections', 'badges'], 'nom du groupe : toutes ses rubriques');
  assert.ok(find('ligues & saisons').includes('season-overview'), 'ancien intitulé retrouvé');
  assert.ok(find('missions').includes('missions'));
  assert.deepStrictEqual(find('amelio'), ['upgrades']);
  assert.ok(find('visuels').includes('icons'));
  assert.match(JS, /admNavFold\(`\$\{t\.label\} \$\{t\.id\} \$\{g\.label\} \$\{t\.keywords \?\? ''\}`\)\.includes\(f\)/);
});
