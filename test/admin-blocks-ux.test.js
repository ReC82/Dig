/**
 * Admin → 🧱 Blocs (#37, recette du 31/10 16:25) : tri sur toutes les colonnes, fiche modale
 * ouverte par clic sur la ligne, aperçu agrandi. Le tri est exécuté tel qu'écrit dans admin.js
 * (extrait et évalué dans un bac à sable), le balisage est contrôlé dans index.html.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');

/** Fonctions de tri d'admin.js, avec un catalogue et un visuel simulés. */
function sorter() {
  const start = JS.indexOf('let _bkSort =');
  const end = JS.indexOf('function bkWorking()');
  assert.ok(start > 0 && end > start, 'bloc de tri introuvable dans admin.js');
  const ctx = {
    _bk: { publishedIds: ['pierre', 'charbon', 'quartz', 'obsidienne'] },
    I18n: { has: k => ['block.pierre', 'block.charbon'].includes(k), t: k => ({ 'block.pierre': 'Pierre', 'block.charbon': 'Charbon' })[k] },
    bkVisual: t => ({ kind: t.vis }),
  };
  vm.createContext(ctx);
  vm.runInContext(`${JS.slice(start, end)}\nthis.bkSortTypes = bkSortTypes; this.bkNameFr = bkNameFr;`, ctx);
  return ctx;
}

const TYPES = [
  { id: 'quartz', names: { fr: 'Quartz' }, category: 'minerai', rarity: 'peu-commun', hpBase: 45, reward: 70, minDepth: 150, weight: 14, active: true, vis: 'emoji' },
  { id: 'pierre', names: null, category: 'pierre', rarity: 'commun', hpBase: 12, reward: 5, minDepth: 5, weight: 60, active: true, vis: 'v1' },
  { id: 'charbon', names: null, category: 'minerai', rarity: 'peu-commun', hpBase: 28, reward: 22, minDepth: 8, weight: 22, active: true, vis: 'v1' },
  { id: 'obsidienne', names: { fr: 'Obsidienne' }, category: 'pierre', rarity: 'legendaire', hpBase: 60, reward: 40, minDepth: 200, weight: 16, active: false, vis: 'emoji' },
  { id: 'cuivre', names: { fr: 'Cuivre oxydé' }, category: 'minerai', rarity: 'rare', hpBase: 80, reward: 120, minDepth: null, weight: 9, active: true, vis: 'catalog' },
];
const ids = list => list.map(t => t.id);

test('tri par défaut : apparition croissante, valeur absente en fin, sens inversé au second clic', () => {
  const { bkSortTypes } = sorter();
  assert.deepStrictEqual(ids(bkSortTypes(TYPES)), ['pierre', 'charbon', 'quartz', 'obsidienne', 'cuivre']);
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'minDepth', dir: 'desc' })), ['obsidienne', 'quartz', 'charbon', 'pierre', 'cuivre']);
});

test('nombres triés numériquement (PV, récompense, poids), pas comme du texte', () => {
  const { bkSortTypes } = sorter();
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'hpBase', dir: 'asc' })), ['pierre', 'charbon', 'quartz', 'obsidienne', 'cuivre']);
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'reward', dir: 'desc' })), ['cuivre', 'quartz', 'obsidienne', 'charbon', 'pierre']);
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'weight', dir: 'asc' })), ['cuivre', 'quartz', 'obsidienne', 'charbon', 'pierre']);
});

test('rareté : ordre métier commun → légendaire, égalité départagée par nom FR (stable)', () => {
  const { bkSortTypes } = sorter();
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'rarity', dir: 'asc' })), ['pierre', 'charbon', 'quartz', 'cuivre', 'obsidienne']);
  // En décroissant, l'égalité reste en ordre alphabétique du nom (Charbon avant Quartz).
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'rarity', dir: 'desc' })), ['obsidienne', 'cuivre', 'charbon', 'quartz', 'pierre']);
});

test('nom FR : traductions intégrées pour les blocs d\'origine, ordre français', () => {
  const { bkSortTypes, bkNameFr } = sorter();
  assert.strictEqual(bkNameFr(TYPES[1]), 'Pierre');
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'name', dir: 'asc' })), ['charbon', 'cuivre', 'obsidienne', 'pierre', 'quartz']);
});

test('probabilité, statut, catégorie et source du visuel', () => {
  const { bkSortTypes } = sorter();
  const odds = new Map([['pierre', 0.6], ['charbon', 0.3], ['quartz', 0.1]]);
  const changed = new Set(['quartz']);
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'prob', dir: 'desc' }, { odds, changed })), ['pierre', 'charbon', 'quartz', 'cuivre', 'obsidienne']);
  // actif inchangé < actif modifié < actif nouveau < désactivé
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'status', dir: 'asc' }, { odds, changed })), ['charbon', 'pierre', 'quartz', 'cuivre', 'obsidienne']);
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'category', dir: 'asc' })), ['charbon', 'cuivre', 'quartz', 'obsidienne', 'pierre']);
  // image personnalisée → v1 → emoji
  assert.deepStrictEqual(ids(bkSortTypes(TYPES, { key: 'visual', dir: 'asc' })), ['cuivre', 'charbon', 'pierre', 'obsidienne', 'quartz']);
});

test('le tri ne modifie pas la liste d\'origine', () => {
  const { bkSortTypes } = sorter();
  const before = JSON.stringify(TYPES);
  bkSortTypes(TYPES, { key: 'rarity', dir: 'desc' });
  assert.strictEqual(JSON.stringify(TYPES), before);
});

test('index.html : 11 colonnes triables avec aria-sort, fiche en dialogue modal, aperçu agrandi', () => {
  const thead = HTML.slice(HTML.indexOf('<table class="bk-table">'), HTML.indexOf('<tbody id="bk-body">'));
  const keys = [...thead.matchAll(/data-sort="([a-zA-Z]+)" aria-sort="none"><button type="button" class="bk-sort-btn"/g)].map(m => m[1]);
  assert.deepStrictEqual(keys, ['visual', 'id', 'name', 'category', 'rarity', 'hpBase', 'reward', 'minDepth', 'weight', 'prob', 'status']);
  assert.match(HTML, /<dialog id="bk-dialog" class="bk-dialog" aria-labelledby="bk-form-title">/);
  assert.match(HTML, /id="btn-bk-close"/);
  assert.match(HTML, /id="bk-zoom"/);
  assert.match(HTML, /<option value="emoji">Sans illustration \(emoji\)<\/option>/);
});

test('admin.js : plus de bouton « Modifier » dans la liste, ligne cliquable au clavier', () => {
  const render = JS.slice(JS.indexOf('function bkRenderTable()'), JS.indexOf('function bkZoomShow('));
  assert.doesNotMatch(render, /addButtonCell\(tr, 'Modifier'/);
  assert.match(render, /tr\.tabIndex = 0/);
  assert.match(render, /e\.key !== 'Enter' && e\.key !== ' '/);
  assert.match(render, /Cliquez pour consulter ou modifier ce bloc/);
});
