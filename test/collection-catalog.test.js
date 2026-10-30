/**
 * Tests des collections saisonnières, ticket #39 (étape A) :
 * - migration : la version 1 reprend à l'identique les 8 trouvailles du client (ordre, blocs
 *   sources, profondeurs, chances) ; mêmes tirages avant/après application du catalogue ;
 * - séries de saison : drop seulement pendant la saison, puis archives ;
 * - validation : rien de publié supprimable, nom FR, caractères < > refusés, images sûres ;
 * - publication : nouveau drop refusé sans « barème validé », version périmée refusée, retour
 *   arrière (ajouts désactivés), journal et versions en ajout seul ;
 * - images : signature PNG/JPEG/WebP, taille maximale, dédoublonnage ;
 * - date/quantité trouvées enregistrées dans la sauvegarde (aucune date inventée) ;
 * - routes HTTP : catalogue public, images, administration protégée (port ≠ 3000).
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const vm       = require('vm');
const { spawn } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_COLLECTIONS || '3151';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-collections-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const catalog = require('../server/collectionCatalog');

db.initDb();
catalog.init();
const conn = () => db.getDb();

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function loadClient(seasonId = 1) {
  const ctx = { Math: Object.create(Math), t: k => k, console, I18n: { getCurrent: () => 'es' } };
  ctx.GameState = { collection: [], collectionMeta: {}, seasonStats: { seasonId } };
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(ROOT, 'public/js/collection.js'), 'utf8');
  vm.runInContext(`${code}\n;this.Collection = Collection;`, ctx);
  return ctx;
}

/** Générateur déterministe (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const CATS = ['terre', 'pierre', 'minerai', 'coffre', 'gemme'];

/** Rejoue 20 000 blocs et renvoie la séquence des trouvailles (identifiant, n° de bloc). */
function playDrops(client, seed) {
  const rand = rng(seed), pick = rng(seed + 1);
  const out = [];
  for (let n = 0; n < 20000; n++) {
    const f = client.Collection.tryDrop({ category: CATS[Math.floor(pick() * CATS.length)] }, 1 + (n % 120), rand);
    if (f) out.push(`${f.id}@${n}`);
  }
  return out;
}

test('migration : version 1 = les 8 trouvailles du client, mêmes tirages, idempotente', () => {
  catalog.init();
  assert.strictEqual(conn().prepare('SELECT COUNT(*) n FROM collection_catalog_versions').get().n, 1);
  const v1 = catalog.getPublished();
  assert.deepStrictEqual([v1.version, v1.series.length, v1.items.length], [1, 1, 8]);
  const builtin = loadClient().Collection.FINDS;
  assert.deepStrictEqual(v1.items.map(i => i.id), JSON.parse(JSON.stringify(builtin.map(f => f.id))));
  for (const [k, i] of v1.items.entries()) {
    const f = builtin[k];
    assert.deepStrictEqual(JSON.parse(JSON.stringify([i.drop.from, i.drop.minDepth, i.drop.chance, i.icon])),
      JSON.parse(JSON.stringify([f.dropFrom, f.minDepth, f.chance, f.icon])), i.id);
    assert.ok(i.dropEnabled && i.active && i.seriesId === 'origines');
    for (const l of catalog.LANGS) assert.ok(i.names[l] && i.stories[l], `${i.id} ${l}`);
  }
  // Mêmes trouvailles, mêmes blocs, avec le catalogue intégré et avec le catalogue publié
  for (const seed of [1, 39, 2026]) {
    const a = loadClient(), b = loadClient();
    assert.ok(b.Collection.applyCatalog(catalog.publicCatalog()));
    assert.deepStrictEqual(playDrops(b, seed), playDrops(a, seed), `graine ${seed}`);
  }
});

test('client : nom et histoire dans la langue du joueur, repli FR et noms intégrés', () => {
  const c = loadClient();
  assert.strictEqual(c.Collection.displayName(c.Collection.getById('fossil')), 'find.fossil.name'); // intégré (avant catalogue)
  c.Collection.applyCatalog(catalog.publicCatalog());
  const fossil = c.Collection.getById('fossil');
  assert.strictEqual(c.Collection.displayName(fossil), 'Fósil');
  assert.match(c.Collection.story(fossil), /dinosaurio/);
  assert.strictEqual(c.Collection.displayName({ id: 'x', names: { fr: 'Truc' } }), 'Truc');
  assert.strictEqual(c.Collection.seriesName(c.Collection.SERIES[0], 'nl'), 'Collectie van de oorsprong');
});

test('date et quantité trouvées : enregistrées à la trouvaille, jamais inventées', () => {
  const c = loadClient(7);
  c.GameState.collection = ['fossil'];              // trouvé avant #39 : aucune métadonnée
  c.Collection.applyCatalog(catalog.publicCatalog());
  c.Collection.add('crystal', 1_700_000_000_000);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.GameState.collectionMeta)), { crystal: { at: 1_700_000_000_000, n: 1, season: 7 } });
  c.Collection.add('crystal', 1_800_000_000_000);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.GameState.collectionMeta.crystal)), { at: 1_700_000_000_000, n: 2, season: 7 });
  assert.deepStrictEqual([...c.GameState.collection], ['fossil', 'crystal']);
  assert.strictEqual(c.GameState.collectionMeta.fossil, undefined);
  // Sauvegarde : collectionMeta sérialisé et relu (save.js)
  const save = fs.readFileSync(path.join(ROOT, 'public/js/save.js'), 'utf8');
  assert.match(save, /collectionMeta: \{ \.\.\.GameState\.collectionMeta \}/);
  assert.match(save, /GameState\.collectionMeta = \(data\.collectionMeta/);
});

const SEASON = () => db.createSeason('Saison test', '2026-10-01T00:00:00Z', '2026-12-01T00:00:00Z', 'closed');
const ITEM = (over = {}) => ({ id: 'flocon', seriesId: 'hiver', names: { fr: 'Flocon éternel', en: 'Eternal Snowflake' },
  stories: { fr: 'Il ne fond jamais.' }, rarity: 'rare', icon: '❄️', image: null,
  drop: { from: ['pierre'], minDepth: 5, chance: 0.5 }, dropEnabled: true, active: true, ...over });

test('validation : nom FR, caractères dangereux, images, rien de publié supprimable', () => {
  const code = fn => { try { fn(); } catch (e) { return e.status ?? e.message; } return 'ok'; };
  assert.strictEqual(code(() => catalog.normalizeItem(ITEM())), 'ok');
  assert.strictEqual(code(() => catalog.normalizeItem(ITEM({ names: { en: 'x' } }))), 400);
  assert.strictEqual(code(() => catalog.normalizeItem(ITEM({ stories: { fr: '<img src=x onerror=alert(1)>' } }))), 400);
  assert.strictEqual(code(() => catalog.normalizeItem(ITEM({ image: 'javascript:alert(1)' }))), 400);
  assert.strictEqual(code(() => catalog.normalizeItem(ITEM({ image: '/assets/../../etc/passwd.png' }))), 400);
  assert.strictEqual(code(() => catalog.normalizeItem(ITEM({ image: `/api/collections/images/${'a'.repeat(64)}.png` }))), 'ok');
  assert.strictEqual(code(() => catalog.normalizeItem(ITEM({ drop: { from: ['lave'], minDepth: 5, chance: 0.1 } }))), 400);
  assert.strictEqual(code(() => catalog.normalizeItem(ITEM({ drop: { from: ['pierre'], minDepth: 5, chance: 0.9 } }))), 400);
  assert.strictEqual(code(() => catalog.normalizeSeries({ id: 'hiver', names: { fr: 'Hiver' }, seasonId: 999999, icon: '❄️' })), 400);
  const v1 = catalog.getPublished();
  const v = catalog.validateContent({ series: v1.series, items: v1.items.slice(1) });
  assert.ok(v.errors.some(e => /fossil.*déjà publié/.test(e)));
});

test('publication : drop nouveau sous confirmation, version périmée refusée, retour arrière, ajout seul', () => {
  const season = SEASON();
  // Texte seul sur un objet d'origine : aucune confirmation de barème demandée
  const fossil = catalog.getPublished().items.find(i => i.id === 'fossil');
  catalog.upsertDraftItem({ ...fossil, stories: { ...fossil.stories, fr: 'Nouvelle histoire.' } });
  assert.deepStrictEqual(catalog.buildAdminView().draft.drops, []);
  const p2 = catalog.publishDraft({ note: 'texte' });
  assert.strictEqual(p2.version, 2);

  // Série de saison + nouvel objet avec drop : refusé sans « barème validé »
  catalog.upsertDraftSeries({ id: 'hiver', names: { fr: 'Hiver' }, seasonId: season.id, icon: '❄️' });
  catalog.upsertDraftItem(ITEM());
  assert.throws(() => catalog.removeDraftEntry('series', 'hiver'), e => e.status === 409);   // encore utilisée
  assert.throws(() => catalog.publishDraft({}), e => e.status === 409 && /barème/.test(e.message));
  assert.throws(() => catalog.publishDraft({ confirmDrops: true, expectedBasedOn: 1 }), e => e.status === 409);
  const p3 = catalog.publishDraft({ confirmDrops: true });
  assert.strictEqual(p3.version, 3);
  assert.deepStrictEqual(p3.drops.map(d => d.id), ['flocon']);
  assert.ok(catalog.listAudit().some(a => a.action === 'publish' && a.details.dropsConfirmed));

  // Client : l'objet de la saison ne tombe que pendant sa saison, puis passe en archives
  const sid = catalog.getPublished().series.find(s => s.id === 'hiver').seasonId;
  const during = loadClient(sid), after = loadClient(sid + 1);
  for (const c of [during, after]) c.Collection.applyCatalog(catalog.publicCatalog());
  assert.ok(during.Collection.canDrop(during.Collection.getById('flocon')));
  assert.ok(!after.Collection.canDrop(after.Collection.getById('flocon')));
  assert.ok(after.Collection.isArchived(after.Collection.SERIES.find(s => s.id === 'hiver')));
  assert.ok(after.Collection.canDrop(after.Collection.getById('fossil')));   // permanente
  assert.strictEqual(catalog.publicCatalog().seasons[sid].name, 'Saison test');

  // Retour arrière vers v1 : série et objet ajoutés conservés mais désactivés
  const rb = catalog.rollbackTo(1);
  assert.deepStrictEqual([rb.version, rb.restored], [4, 1]);
  const v4 = catalog.getPublished();
  assert.strictEqual(v4.items.find(i => i.id === 'flocon').active, false);
  assert.strictEqual(v4.series.find(s => s.id === 'hiver').active, false);
  assert.strictEqual(v4.items.find(i => i.id === 'fossil').stories.fr, fossil.stories.fr);

  // Ajout seul
  assert.throws(() => conn().prepare('UPDATE collection_catalog_versions SET note = 1').run(), /ajout seul/);
  assert.throws(() => conn().prepare('DELETE FROM collection_catalog_versions').run(), /ajout seul/);
  assert.throws(() => conn().prepare('DELETE FROM collection_catalog_audit').run(), /ajout seul/);
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]);

test('images : signature contrôlée, taille maximale, dédoublonnage', () => {
  const a = catalog.storeImage(`data:image/png;base64,${PNG.toString('base64')}`, 'flocon <b>');
  assert.match(a.url, /^\/api\/collections\/images\/[0-9a-f]{64}\.png$/);
  assert.strictEqual(catalog.storeImage(PNG.toString('base64')).duplicate, true);
  assert.strictEqual(catalog.listImages()[0].label, 'flocon b');
  assert.throws(() => catalog.storeImage(`data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`), e => e.status === 400);
  assert.throws(() => catalog.storeImage(Buffer.concat([PNG, Buffer.alloc(400 * 1024)]).toString('base64')), e => e.status === 413);
  assert.ok(catalog.getImage(a.sha256, 'png'));
  assert.strictEqual(catalog.getImage(a.sha256, 'webp'), null);
});

test('routes : catalogue public, images, administration protégée', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'), ADMIN_SECRET: ADMIN,
      SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  const exited = new Promise(r => server.on('exit', r));
  t.after(async () => { server.kill(); await exited; });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, `serveur de test non démarré :\n${log}`);
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
  };

  const pub = await call('GET', '/api/collections/catalog', undefined, { auth: false });
  assert.strictEqual(pub.status, 200);
  assert.deepStrictEqual([pub.body.version, pub.body.series.length, pub.body.items.length], [1, 1, 8]);

  for (const [m, u] of [['GET', '/api/admin/collections'], ['PUT', '/api/admin/collections/draft/items/flocon'],
    ['PUT', '/api/admin/collections/draft/series/hiver'], ['POST', '/api/admin/collections/publish'], ['POST', '/api/admin/collections/rollback'],
    ['POST', '/api/admin/collections/images'], ['DELETE', '/api/admin/collections/draft'], ['GET', '/api/admin/collections/audit']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  assert.strictEqual((await call('PUT', '/api/admin/collections/draft/items/autre', { item: ITEM({ seriesId: 'origines' }) })).status, 400);
  assert.strictEqual((await call('PUT', '/api/admin/collections/draft/items/flocon', { item: ITEM({ seriesId: 'origines', dropEnabled: false }) })).status, 200);
  const view = await call('GET', '/api/admin/collections');
  assert.strictEqual(view.status, 200);
  assert.deepStrictEqual(view.body.draft.drops, []);
  const p = await call('POST', '/api/admin/collections/publish', { note: 'test', expectedBasedOn: 1 });
  assert.deepStrictEqual([p.status, p.body.version], [200, 2]);
  assert.strictEqual((await call('GET', '/api/collections/catalog', undefined, { auth: false })).body.items.length, 9);

  const img = await call('POST', '/api/admin/collections/images', { data: PNG.toString('base64'), label: 'test' });
  assert.strictEqual(img.status, 200);
  const res = await fetch(BASE + img.body.url);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'image/png');
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(PNG));
  assert.strictEqual((await fetch(`${BASE}/api/collections/images/${'0'.repeat(64)}.png`)).status, 404);
  assert.strictEqual((await fetch(`${BASE}/api/collections/images/..%2Fdig.sqlite`)).status, 404);
});
