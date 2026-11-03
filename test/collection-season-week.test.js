/**
 * Collections rattachées à une saison FUTURE pas encore créée (#39, recette du 03/11/2026).
 *
 * Scénario calqué sur la production du 03/11 : « Saison 45-2026 » active, thème 2026-W46 « La Saison
 * des Lanternes » préparé (#48) avec la série « Les Trésors de la Saint-Martin » en brouillon, importée
 * « Permanente » faute de saison future en base.
 *   - la série du thème est rattachée à sa semaine (seasonWeek 2026-W46), une seule fois, sans écraser
 *     un choix ultérieur de l'admin ; les nouveaux packs arrivent directement rattachés à leur semaine ;
 *   - publiée AVANT la création de sa saison : absente du catalogue public (ni visible ni obtenable,
 *     même par un client ancien), aucun drop ;
 *   - rotation du 09/11 : résolution automatique (seasonId = saison 46 dans le catalogue public, sans
 *     réécrire la version publiée), drops pendant la saison seulement, archives ensuite ;
 *   - semaine sans thème : résolue par la saison qui commence cette semaine-là ; semaine passée sans
 *     saison : bloquante ; seasonId explicite prioritaire ; format validé.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const vm     = require('vm');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-colweek-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
process.env.DIG_SEASON_PACKS = path.join(__dirname, '..', 'server', 'content', 'seasons');

const db      = require('../server/db');
const seasons = require('../server/seasons');
const themes  = require('../server/seasonThemes');
const catalog = require('../server/collectionCatalog');
const ai      = require('../server/collectionAi');
const studio  = require('../server/iconStudio');

const ROOT = path.join(__dirname, '..');
const conn = () => db.getDb();
const at   = iso => new Date(iso);

function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

function tick(now) {
  let active;
  for (let i = 0; i < 2; i++) {
    active = quiet(() => seasons.checkAndRotateSeason(now));
    quiet(() => themes.sync(now));
  }
  return active;
}

function loadClient(seasonId) {
  const ctx = { Math: Object.create(Math), t: k => k, console, I18n: { getCurrent: () => 'fr' } };
  ctx.GameState = { collection: [], collectionMeta: {}, seasonStats: { seasonId } };
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'public/js/collection.js'), 'utf8')}\n;this.Collection = Collection;`, ctx);
  ctx.Collection.applyCatalog(catalog.publicCatalog());
  return ctx.Collection;
}

const realFetch = global.fetch;
global.fetch = () => { throw new Error('aucun appel réseau attendu'); };
test.after(() => { global.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });

const SM = 'tresors_saint_martin';

test('saison future par semaine : rattachement, publication anticipée sans drop, résolution à la rotation, archives', (t) => {
  const T0 = at('2026-11-03T10:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0.getTime() });
  db.initDb();
  studio.init(); catalog.init(); ai.init(); themes.init();

  const s45 = tick(T0);
  assert.strictEqual(s45.name, 'Saison 45-2026');
  const theme = themes.adminView(T0).next.theme;
  assert.strictEqual(theme.weekKey, '2026-W46');
  assert.strictEqual(theme.seriesId, SM);
  // Nouveau pack : série directement rattachée à la semaine de sa saison
  const sm = () => catalog.getDraft().series.find(s => s.id === SM);
  assert.strictEqual(sm().seasonId, null);
  assert.strictEqual(sm().seasonWeek, '2026-W46');

  // État de la production (série importée « Permanente » avant le 03/11) : corrigé une seule fois
  catalog.upsertDraftSeries({ ...sm(), seasonWeek: null });
  conn().prepare("DELETE FROM season_theme_events WHERE action = 'series_week'").run();
  assert.strictEqual(sm().seasonWeek, undefined);
  tick(T0);
  assert.strictEqual(sm().seasonWeek, '2026-W46', 'Permanente → semaine du thème');
  assert.ok(catalog.listAudit().some(a => a.action === 'draft_update_series' && a.details.id === SM));
  // Choix ultérieur de l'admin respecté (jamais réécrit)
  catalog.upsertDraftSeries({ ...sm(), seasonWeek: null });
  tick(T0);
  assert.strictEqual(sm().seasonWeek, undefined, 'choix de l\'admin conservé');
  catalog.upsertDraftSeries({ ...sm(), seasonWeek: '2026-W46' });

  // Admin : semaine proposée avec le nom du thème ; contrôle « saison future », non bloquant
  const view = catalog.buildAdminView();
  const w46 = view.futureWeeks.find(f => f.week === '2026-W46');
  assert.ok(w46, 'semaine W46 proposée');
  assert.strictEqual(w46.themeName, 'La Saison des Lanternes');
  assert.strictEqual(w46.monday, '2026-11-09 00:00:00');
  assert.ok(!view.futureWeeks.some(f => f.week === '2026-W45'), 'semaine en cours (saison créée) non proposée');
  let r = view.draft.readiness.find(x => x.seriesId === SM);
  assert.strictEqual(r.schedule, 'future');
  assert.strictEqual(r.needsPermanent, false);
  assert.ok(!r.blocking.some(b => /Permanente|saison/i.test(b)), r.blocking.join(' | '));
  assert.ok(r.info.some(i => /2026-W46.*invisible des joueurs et sans drop/.test(i)));

  // Série complète (illustrations, drops validés) publiée seule AVANT la création de la saison
  for (const i of catalog.getDraft().items.filter(x => x.seriesId === SM)) {
    catalog.upsertDraftItem({ ...i, image: `/assets/test/${i.id}.webp`, dropEnabled: true });
  }
  const before = catalog.getPublished().version;
  const pub = quiet(() => catalog.publishSeries(SM, { confirmDrops: true }));
  assert.strictEqual(pub.version, before + 1);
  assert.ok(pub.drops.every(d => d.seasonWeek === '2026-W46' && d.seasonId === null));
  const v = catalog.getPublished();
  assert.strictEqual(v.series.find(s => s.id === SM).seasonWeek, '2026-W46');
  const ids = v.items.filter(i => i.seriesId === SM).map(i => i.id);
  assert.strictEqual(ids.length, 6);

  // Jeu avant le 09/11 : série et objets absents du catalogue public → ni visibles ni obtenables
  let pc = catalog.publicCatalog();
  assert.ok(!pc.series.some(s => s.id === SM) && !pc.items.some(i => ids.includes(i.id)));
  let c = loadClient(s45.id);
  assert.ok(ids.every(id => !c.getById(id) || !c.canDrop(c.getById(id))));
  assert.ok(c.canDrop(c.getById('fossil')), 'collection des origines inchangée');

  // Rotation du 09/11 : saison 46 créée, thème attaché, série résolue sans réécrire la version publiée
  const now = at('2026-11-09T00:00:30Z');
  t.mock.timers.setTime(now.getTime());
  const s46 = tick(now);
  assert.strictEqual(s46.name, 'Saison 46-2026');
  assert.strictEqual(themes.themeForSeason(s46.id).id, theme.id);
  assert.strictEqual(catalog.weekSeasonId('2026-W46'), s46.id);
  assert.strictEqual(catalog.getPublished().version, before + 1, 'aucune nouvelle version');
  pc = catalog.publicCatalog();
  assert.strictEqual(pc.series.find(s => s.id === SM).seasonId, s46.id);
  assert.strictEqual(pc.seasons[s46.id].name, 'Saison 46-2026');
  assert.strictEqual(pc.items.filter(i => i.seriesId === SM).length, 6);
  c = loadClient(s46.id);
  assert.ok(ids.every(id => c.canDrop(c.getById(id))), 'drops pendant la saison 46');
  assert.ok(!c.isArchived(c.SERIES.find(s => s.id === SM)));
  const late = loadClient(s45.id);   // joueur pas encore synchronisé : toujours aucun drop
  assert.ok(ids.every(id => !late.canDrop(late.getById(id))));
  assert.strictEqual(themes.publicView(s46, now).collection.count, 6);

  // Clôture : saison 47 → archives, plus aucun drop
  const n47 = at('2026-11-16T00:00:30Z');
  t.mock.timers.setTime(n47.getTime());
  const s47 = tick(n47);
  c = loadClient(s47.id);
  assert.ok(c.isArchived(c.SERIES.find(s => s.id === SM)));
  assert.ok(ids.every(id => !c.canDrop(c.getById(id))));
  assert.strictEqual(catalog.publicCatalog().series.find(s => s.id === SM).seasonId, s46.id, 'rattachement stable');
  t.mock.timers.reset();
});

test('semaine sans thème, semaine passée, priorité du seasonId, format', () => {
  const now = new Date();
  const T4 = fr => ({ fr, en: `${fr} en`, nl: `${fr} nl`, es: `${fr} es` });
  // Résolution par la saison qui commence dans la semaine (sans thème)
  const s = db.createSeason('Saison test W10', '2099-03-02 00:00:00', '2099-03-08 23:59:59', 'scheduled');
  assert.strictEqual(catalog.weekSeasonId('2099-W10'), s.id);
  assert.strictEqual(catalog.weekSeasonId('2099-W11'), null);
  assert.strictEqual(catalog.weekMonday('2027-W53'), null, '2027 n\'a que 52 semaines');
  assert.strictEqual(catalog.weekMonday('2026-W53').toISOString(), '2026-12-28T00:00:00.000Z', '2026 a 53 semaines');
  assert.strictEqual(catalog.weekMonday('2026-W46').toISOString(), '2026-11-09T00:00:00.000Z');
  assert.strictEqual(catalog.weekMonday('2027-W01').toISOString(), '2027-01-04T00:00:00.000Z');

  assert.throws(() => catalog.upsertDraftSeries({ id: 'semaine_bad', names: T4('X'), seasonWeek: '2026-W99', icon: '🧪' }), e => e.status === 400 && /semaine/.test(e.message));
  const explicit = catalog.upsertDraftSeries({ id: 'semaine_id', names: T4('X'), seasonId: s.id, seasonWeek: '2099-W11', icon: '🧪' });
  assert.strictEqual(explicit.seasonId, s.id);
  assert.strictEqual(explicit.seasonWeek, undefined, 'seasonId explicite prioritaire');

  // Semaine passée sans saison créée : bloquante
  catalog.upsertDraftSeries({ id: 'semaine_passee', names: T4('Passée'), seasonWeek: '2020-W10', icon: '🧪' });
  const r = catalog.seriesReadiness(catalog.getDraft(), 'semaine_passee', { now });
  assert.ok(r.blocking.some(b => /2020-W10.*passée sans saison/.test(b)));
  const fut = catalog.upsertDraftSeries({ id: 'semaine_future', names: T4('Future'), seasonWeek: '2099-W11', icon: '🧪' });
  assert.strictEqual(fut.seasonWeek, '2099-W11');
  const rf = catalog.seriesReadiness(catalog.getDraft(), 'semaine_future', { now });
  assert.strictEqual(rf.schedule, 'future');
  // Saison créée pour la semaine : résolue
  catalog.upsertDraftSeries({ id: 'semaine_w10', names: T4('W10'), seasonWeek: '2099-W10', icon: '🧪' });
  const r10 = catalog.seriesReadiness(catalog.getDraft(), 'semaine_w10', { now });
  assert.strictEqual(r10.schedule, 'scheduled');
  assert.strictEqual(r10.season.id, s.id);
  for (const id of ['semaine_id', 'semaine_passee', 'semaine_future', 'semaine_w10']) catalog.removeDraftEntry('series', id);
});

// Recette du 03/11 (11:21 UTC) : l'aperçu latéral de la fiche objet affichait « Permanente » pour une
// série rattachée à une semaine future (seasonId null, seasonWeek 2026-W46).
test('admin : libellé de saison — une série future n\'est jamais présentée comme permanente', () => {
  const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  const src = JS.match(/function coSeasonLabel\([\s\S]*?\n}\n/)[0];
  const ctx = vm.createContext({ _co: { futureWeeks: [{ week: '2026-W46', label: '2026-W46 (09/11 → 15/11)', themeName: 'La Saison des Lanternes' }], seasons: [] } });
  vm.runInContext(`${src};this.coSeasonLabel = coSeasonLabel;`, ctx);
  const label = ctx.coSeasonLabel(null, '2026-W46');
  assert.match(label, /Saison future/);
  assert.doesNotMatch(label, /Permanente/);
  assert.match(ctx.coSeasonLabel(null, null), /Permanente/);
  // Tous les appels transmettent la semaine (aucun appel à un seul argument, cause de l'anomalie).
  const calls = [...JS.matchAll(/coSeasonLabel\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)].map(m => m[1]).filter(a => !a.startsWith('id,'));
  assert.ok(calls.length >= 4);
  for (const a of calls) assert.ok(a.includes(','), `appel sans semaine : coSeasonLabel(${a})`);
  assert.match(JS, /co-preview-series'\)\.textContent = [^\n]*coSeasonLabel\(s\.seasonId, s\.seasonWeek\)/);
});
