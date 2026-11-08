/**
 * Atelier d'icônes, ticket #89 : filtre par événement et recherche globale des reliques.
 * - chaque objet d'événement de la liste porte son événement (id, nom, emoji, état, public/TEST) ;
 * - les six reliques du jeu sont des cibles `relic:<id>` de l'atelier (famille « Reliques ») ;
 * - recherche du panel sans casse, accents, ligatures ni apostrophes (« Oeil » → « Œil du mineur ») ;
 * - filtre « Événement », statut en clair, liens directs (événement / relique) qui ciblent famille et événement.
 * Aucun appel IA (aucune génération), aucune dépense.
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-icon-filters-89-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db     = require('../server/db');
const blocks = require('../server/blockCatalog');
const coll   = require('../server/collectionCatalog');
const relics = require('../server/relicCatalog');
const ev     = require('../server/monthlyEvents');
const studio = require('../server/iconStudio');

db.initDb();
blocks.init();
coll.init();
relics.init();
studio.init();
ev.init();
studio.setFakeTransport({ image: async () => { throw new Error('aucune génération attendue (#89)'); } });

const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });
const item = id => ({ id, icon: '🪨', rarity: 'commun', chancePct: 25, minDepth: 0, dropFrom: [], names: tx(`Objet ${id}`), descs: tx(`Desc ${id}`) });
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const DAY = 86_400_000;

ev.createEvent({ id: 'nov_test89', icon: '🏛️', audience: 'public', testers: [], names: tx('Novembre déterre l\'Histoire'), taglines: tx('n'),
  startsAt: iso(Date.now() + 2 * DAY), endsAt: iso(Date.now() + 20 * DAY), items: [item('nov_brique'), item('nov_casque')] });
ev.createEvent({ id: 'lab_test89', icon: '🧪', audience: 'test', testers: [], names: tx('Labo'), taglines: tx('t'),
  startsAt: iso(Date.now() - 3 * DAY), endsAt: iso(Date.now() - DAY), items: [item('lab_tube')] });

// Fonctions pures du panel, extraites de admin.js (même code que celui servi au navigateur)
const ADMIN_JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
function extract(name) {
  const m = ADMIN_JS.match(new RegExp(`\\n(function ${name}\\([^]*?\\n}\\n|const ${name} = [^\\n]*\\n)`));
  assert.ok(m, `${name} introuvable dans admin.js`);
  return m[1];
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(['icFold', 'icMatches', 'IC_EV_STATES', 'icEventStatus', 'icEventPass'].map(extract).join('\n')
  + '\nthis.api = { icFold, icMatches, icEventStatus, icEventPass };', sandbox);
const { icFold, icMatches, icEventStatus, icEventPass } = sandbox.api;

test('liste de l\'atelier : chaque objet d\'événement porte son événement et son statut', () => {
  const list = studio.listTargets().filter(t => t.kind === 'event');
  const brique = list.find(t => t.key === 'event:nov_test89/nov_brique');
  assert.ok(brique);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(brique.event)),
    { id: 'nov_test89', name: 'Novembre déterre l\'Histoire', icon: '🏛️', state: 'draft', audience: 'public' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(list.find(t => t.key === 'event:lab_test89/lab_tube').event)),
    { id: 'lab_test89', name: 'Labo', icon: '🧪', state: 'draft', audience: 'test' });
  assert.ok(studio.listTargets().filter(t => t.kind !== 'event').every(t => t.event === undefined), 'champ réservé aux objets d\'événement');
  // La fiche détaillée garde son propre champ `event` (#65 : retour vers la fiche d'événement)
  assert.strictEqual(studio.getTarget('event:nov_test89/nov_brique').event.itemId, 'nov_brique');
});

test('les six reliques du jeu sont des cibles de l\'atelier, trouvables sans accents ni ligatures', () => {
  const rel = studio.listTargets().filter(t => t.kind === 'relic');
  const names = rel.map(t => t.name);
  for (const n of ['Œil du mineur', 'Cœur d\'or', 'Aimant à éclats', 'Lentille fissurée', 'Griffe d\'obsidienne', 'Moteur antique']) assert.ok(names.includes(n), n);
  assert.strictEqual(rel.length, 6);
  const find = q => rel.filter(t => icMatches(t, q)).map(t => t.name);
  assert.deepStrictEqual(find('Oeil'), ['Œil du mineur']);
  assert.deepStrictEqual(find('OEIL mineur'), ['Œil du mineur']);
  assert.deepStrictEqual(find('Coeur'), ['Cœur d\'or']);
  assert.deepStrictEqual(find('coeur d\'or'), ['Cœur d\'or']);
  assert.deepStrictEqual(find('coeur d’or'), ['Cœur d\'or'], 'apostrophe typographique');
  assert.deepStrictEqual(find('coeur dor'), ['Cœur d\'or']);
  assert.deepStrictEqual(find('aimant a eclats'), ['Aimant à éclats']);
  assert.deepStrictEqual(find('lentille fissuree'), ['Lentille fissurée']);
  assert.deepStrictEqual(find('obsidienne'), ['Griffe d\'obsidienne']);
  assert.deepStrictEqual(find('moteur'), ['Moteur antique']);
  assert.strictEqual(find('relique').length, 6, 'le nom de la famille est cherchable');
  assert.strictEqual(find('').length, 6);
});

test('normalisation de la recherche', () => {
  assert.strictEqual(icFold('Œil du MINEUR'), 'oeil du mineur');
  assert.strictEqual(icFold('Cœur d’or'), 'coeur dor');
  assert.strictEqual(icFold('Ægide — éclat!'), 'aegide eclat');
  assert.strictEqual(icFold(null), '');
});

test('filtre Événement et statut en clair', () => {
  const list = studio.listTargets().filter(t => t.kind === 'event');
  const keys = f => list.filter(t => icEventPass(t, f)).map(t => t.key).sort();
  assert.deepStrictEqual(keys('ev:nov_test89'), ['event:nov_test89/nov_brique', 'event:nov_test89/nov_casque']);
  assert.deepStrictEqual(keys('aud:test'), ['event:lab_test89/lab_tube']);
  assert.strictEqual(keys('').length, 3);
  assert.deepStrictEqual(keys('ev:inconnu'), []);
  // recherche dans l'événement : le nom de l'événement est aussi cherchable
  assert.strictEqual(list.filter(t => icMatches(t, 'novembre histoire')).length, 2);
  assert.strictEqual(icEventStatus({ state: 'draft', audience: 'public' }), 'Brouillon');
  assert.strictEqual(icEventStatus({ state: 'active', audience: 'public' }), 'Actif');
  assert.strictEqual(icEventStatus({ state: 'ended', audience: 'public' }), 'Terminé');
  assert.strictEqual(icEventStatus({ state: 'draft', audience: 'test' }), 'TEST · Brouillon');
});

test('panel : menu Événement, état vide avec repli, liens directs ciblés, filtre dans l\'adresse', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  assert.match(html, /<select id="ic-event"[^>]*aria-label="Événement"/);
  assert.match(ADMIN_JS, /\['ic-kind', 'ic-event', 'ic-state', 'ic-zone'\]\.forEach/);
  assert.match(ADMIN_JS, /Chercher dans « \$\{icOptText\('ic-kind', kind\)\} »/, 'action directe vers la famille qui trouve');
  assert.match(ADMIN_JS, /icFocusOn\(saved\.studioKey, ev\.id\);\n {2}icOpen\(saved\.studioKey\);/, 'fiche d\'objet d\'événement → événement et objet ciblés');
  assert.match(ADMIN_JS, /icFocusOn\(`relic:\$\{id\}`\);\n {2}icOpen\(`relic:\$\{id\}`\);/, 'fiche de relique → famille Reliques');
  // Filtre dans l'adresse, sans entrée d'historique (décision #50-F/#70 : le retour navigateur ne contourne aucune fiche)
  assert.match(extract('icSaveFilters'), /history\.replaceState\(history\.state, '', url\)/);
  assert.match(ADMIN_JS, /icRestoreFilters\(\);\n {2}icRenderGrid\(\);/);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
