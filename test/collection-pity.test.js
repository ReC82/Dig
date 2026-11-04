/**
 * Chance croissante des collections (#39, décision du propriétaire du 04/11) : barème validé et
 * rétrocompatible, modèle appliqué au brouillon seulement, objet jamais tiré par le jeu, tirage
 * serveur sur les blocs validés (compteur par joueur et par objet, chance bornée à 100 %, un seul
 * exemplaire), aucune attribution rétroactive, rejeu sans effet, fin de saison, rafale, sauvegarde
 * falsifiée, et de bout en bout : routes admin protégées, sauvegarde, redémarrage, session unique.
 * Base temporaire hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_PITY || '3174';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-pity-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const catalog      = require('../server/collectionCatalog');
const pity         = require('../server/collectionPity');
const ds           = require('../tools/balance/collection-drop-sim.js');

let season;
let userSeq = 0;
const ALWAYS = () => 0;
const NEVER = () => 0.999999;
const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });

function newUser() {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`pity_${++userSeq}`, 'x').lastInsertRowid;
}
function setAccepted(userId, depth) {
  db.upsertDepthTracking(userId, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: depth, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
}
/** Minage validé (#38) : profondeur retenue + compteurs cumulés crédités par badges.processSave. */
function mine(userId, depth, minedByType) {
  setAccepted(userId, depth);
  badges.processSave(userId, { stats: { minedByType } });
}
const row = (u, id) => db.getDb().prepare('SELECT fails, found_at FROM collection_pity WHERE user_id = ? AND item_id = ?').get(u, id);

const OBJ = (id, rarity, from, minDepth, chance, extra = {}) => ({ id, seriesId: 'pity_serie', names: tx(`Objet ${id}`), stories: tx(`Histoire ${id}`),
  rarity, icon: '🏮', image: null, drop: { from, minDepth, chance }, dropEnabled: true, active: true, ...extra });

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  catalog.init();
  pity.init();
  season = db.getActiveSeason();
  assert.ok(season, 'saison active du seed');
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('barème : pityStep facultatif, borné, arrondi ; objets existants inchangés', () => {
  const base = OBJ('x_obj', 'rare', ['minerai'], 40, 0.02);
  assert.deepStrictEqual(catalog.normalizeItem(base).drop, { from: ['minerai'], minDepth: 40, chance: 0.02 }, 'sans hausse : même JSON qu\'avant');
  assert.deepStrictEqual(catalog.normalizeItem({ ...base, drop: { ...base.drop, pityStep: 0 } }).drop, { from: ['minerai'], minDepth: 40, chance: 0.02 });
  assert.strictEqual(catalog.normalizeItem({ ...base, drop: { ...base.drop, pityStep: 0.0010000001 } }).drop.pityStep, 0.001);
  for (const bad of [-0.001, 0.06, 'abc']) {
    assert.throws(() => catalog.normalizeItem({ ...base, drop: { ...base.drop, pityStep: bad } }), e => e.status === 400 && /hausse/.test(e.message), String(bad));
  }
  assert.strictEqual(pity.chanceAt({ chance: 0.03, pityStep: 0.003 }, 0), 0.03);
  assert.ok(Math.abs(pity.chanceAt({ chance: 0.03, pityStep: 0.003 }, 10) - 0.06) < 1e-12);
  assert.strictEqual(pity.chanceAt({ chance: 0.03, pityStep: 0.003 }, 10_000), 1, 'bornée à 100 %');
  assert.strictEqual(pity.chanceAt({ chance: 0.04 }, 500), 0.04, 'barème fixe');
});

test('modèle « chance croissante » : brouillon seulement, taux du propriétaire, autres raretés inchangées, idempotent', () => {
  const v0 = catalog.getPublished().version;
  catalog.upsertDraftSeries({ id: 'pity_serie', names: tx('Série test'), seasonId: season.id, icon: '🏮' });
  const items = [
    OBJ('p_commun', 'commun', ['terre', 'pierre'], 5, 0.03, { dropEnabled: false, image: '/assets/x.png' }),
    OBJ('p_peu', 'peu-commun', ['pierre', 'minerai'], 20, 0.02, { dropEnabled: false }),
    OBJ('p_leg', 'legendaire', ['gemme'], 100, 0.05, { dropEnabled: false }),
    OBJ('p_rare', 'rare', ['minerai'], 40, 0.015, { dropEnabled: false }),
  ];
  for (const i of items) catalog.upsertDraftItem(i);
  const r = catalog.applyPresetToDraft('pity_serie', 'croissant');
  assert.deepStrictEqual(r.changed.map(c => c.id).sort(), ['p_commun', 'p_leg', 'p_rare']);
  const d = new Map(catalog.getDraft().items.filter(i => i.seriesId === 'pity_serie').map(i => [i.id, i]));
  assert.deepStrictEqual(d.get('p_commun').drop, { from: ['terre', 'pierre'], minDepth: 5, chance: 0.04 });
  assert.deepStrictEqual(d.get('p_rare').drop, { from: ['minerai'], minDepth: 40, chance: 0.02, pityStep: 0.001 });
  assert.deepStrictEqual(d.get('p_leg').drop, { from: ['gemme'], minDepth: 100, chance: 0.03, pityStep: 0.003 });
  assert.deepStrictEqual(d.get('p_peu').drop, items[1].drop, 'peu commun : aucun taux inventé');
  assert.ok([...d.values()].every(i => i.dropEnabled === false), 'aucun drop activé');
  assert.strictEqual(d.get('p_commun').image, '/assets/x.png', 'image inchangée');
  assert.strictEqual(catalog.getPublished().version, v0, 'rien publié');
  assert.deepStrictEqual(catalog.applyPresetToDraft('pity_serie', 'croissant').changed, [], 'idempotent');
  assert.throws(() => catalog.applyPresetToDraft('pity_serie', 'autre'), e => e.status === 400);
  assert.throws(() => catalog.applyPresetToDraft('inconnue', 'croissant'), e => e.status === 404);
  // Simulation : brouillon (= modèle) fusionné, brouillon sans hausse comparé
  const scales = pity.simulationScales('pity_serie');
  assert.deepStrictEqual(scales.map(s => s.key), ['BROUILLON', 'SANS_HAUSSE']);
  assert.deepStrictEqual(scales[0].also, [catalog.PITY_PRESETS.croissant.label], 'modèle identique au brouillon : une seule colonne');
});

test('sans objet publié à chance croissante : aucun tirage, aucune écriture', () => {
  const u = newUser();
  mine(u, 150, { rubis: 10 });
  assert.deepStrictEqual(pity.liveItems(), []);
  assert.deepStrictEqual(pity.processSave(u, {}, { rand: ALWAYS }), []);
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM collection_pity_cursor').get().n, 0);
});

test('tirage serveur : compteur par joueur et par objet, profondeur, catégories, un exemplaire, rejeu, pas de rétroactif', () => {
  for (const i of catalog.getDraft().items.filter(x => x.seriesId === 'pity_serie')) catalog.upsertDraftItem({ ...i, dropEnabled: true });
  catalog.publishDraft({ confirmDrops: true, confirmIncomplete: true });
  assert.deepStrictEqual(pity.liveItems().map(i => i.id).sort(), ['p_leg', 'p_rare']);
  // Le jeu ne tire jamais ces objets, même un ancien client (dropEnabled false dans le catalogue public)
  const pub = new Map(catalog.publicCatalog().items.map(i => [i.id, i]));
  assert.deepStrictEqual([pub.get('p_leg').dropEnabled, pub.get('p_leg').serverDrop], [false, true]);
  assert.deepStrictEqual([pub.get('p_commun').dropEnabled, pub.get('p_commun').serverDrop], [true, undefined]);

  const u = newUser(), v = newUser();
  mine(u, 50, { rubis: 5, charbon: 5 });
  assert.deepStrictEqual(pity.processSave(u, {}, { rand: ALWAYS }), [], '1er passage : recalage sans tirage');
  assert.strictEqual(row(u, 'p_rare'), undefined);
  // 50 m : rare (≥ 40 m) éligible sur les minerais seulement ; légendaire (≥ 100 m) pas encore
  mine(u, 60, { rubis: 9, charbon: 8, minerai_fer: 2, pierre: 30 });
  assert.deepStrictEqual(pity.processSave(u, {}, { rand: NEVER }), []);
  assert.strictEqual(row(u, 'p_rare').fails, 5, '3 charbons + 2 fers ratés');
  assert.strictEqual(row(u, 'p_leg'), undefined, 'profondeur insuffisante : rien compté');
  assert.deepStrictEqual(pity.processSave(u, {}, { rand: ALWAYS }), [], 'rejeu (aucun nouveau bloc validé) : rien');
  // Hausse : la chance du 6e tirage vaut 2 % + 5 × 0,1 pt = 2,5 % → un tirage à 0,024 réussit, à 0,026 échoue
  mine(u, 70, { rubis: 9, charbon: 9, minerai_fer: 2, pierre: 30 });
  assert.deepStrictEqual(pity.processSave(u, {}, { rand: () => 0.026 }), []);
  assert.strictEqual(row(u, 'p_rare').fails, 6);
  mine(u, 80, { rubis: 9, charbon: 10, minerai_fer: 2, pierre: 30 });
  const got = pity.processSave(u, {}, { rand: () => 0.0259 });   // 2 % + 6 × 0,1 = 2,6 %
  assert.deepStrictEqual(got.map(f => f.itemId), ['p_rare']);
  assert.ok(row(u, 'p_rare').found_at);
  mine(u, 90, { rubis: 9, charbon: 30, minerai_fer: 2, pierre: 30 });
  assert.deepStrictEqual(pity.processSave(u, {}, { rand: ALWAYS }), [], 'un seul exemplaire');
  // Compteurs individuels : l'autre joueur part de zéro
  mine(v, 120, { diamant: 1 });
  pity.processSave(v, {}, { rand: NEVER });
  mine(v, 120, { diamant: 4, rubis: 3 });
  pity.processSave(v, {}, { rand: NEVER });
  assert.strictEqual(row(v, 'p_leg').fails, 6);
  assert.strictEqual(row(u, 'p_leg'), undefined);
  // Objet déjà dans la sauvegarde (tombé avant, coffre…) : jamais tiré une seconde fois
  mine(v, 120, { diamant: 8, rubis: 3 });
  assert.deepStrictEqual(pity.processSave(v, { collection: ['p_leg'] }, { rand: ALWAYS }), []);
  const stats = pity.adminStats();
  assert.strictEqual(stats.p_rare.found, 1);
  assert.strictEqual(stats.p_leg.players, 1);
});

test('rafale au-delà du plafond : curseur avancé sans tirage ; fin de saison : plus de tirage, objets conservés', () => {
  const u = newUser();
  mine(u, 150, { rubis: 1 });
  pity.processSave(u, {}, { rand: NEVER });
  // Défense en profondeur : badges.processSave ne crédite déjà qu'un bloc par mètre nouvellement retenu
  const far = 150 + pity.MAX_BLOCKS_PER_SAVE + 10;
  mine(u, far, { rubis: 1 + pity.MAX_BLOCKS_PER_SAVE + 1 });
  assert.deepStrictEqual(pity.processSave(u, {}, { rand: ALWAYS }), []);
  assert.strictEqual(row(u, 'p_leg'), undefined);
  mine(u, far + 5, { rubis: 3 + pity.MAX_BLOCKS_PER_SAVE });
  assert.deepStrictEqual(pity.processSave(u, {}, { rand: ALWAYS }).map(f => f.itemId), ['p_leg'], 'après la rafale, tirage normal');

  db.getDb().prepare("UPDATE seasons SET status = 'closed' WHERE id = ?").run(season.id);
  try {
    assert.deepStrictEqual(pity.liveItems(), [], 'saison terminée : série plus tirée');
    const w = newUser();
    mine(w, 150, { rubis: 10 });
    assert.deepStrictEqual(pity.processSave(w, {}, { rand: ALWAYS }), []);
    assert.deepStrictEqual(pity.mergeInto(u, { collection: [] }).collection, ['p_leg'], 'objet acquis conservé');
  } finally { db.getDb().prepare("UPDATE seasons SET status = 'active' WHERE id = ?").run(season.id); }
});

test('sauvegarde : objets serveur réinjectés, objets « serveur seul » falsifiés retirés, objets jeu intacts', () => {
  const u = newUser();
  const forged = pity.mergeInto(u, { collection: ['fossil', 'p_leg', 'p_commun'], collectionMeta: { p_leg: { at: 1, n: 1 } } }, { strip: true });
  assert.deepStrictEqual(forged.collection, ['fossil', 'p_commun']);
  assert.deepStrictEqual(forged.collectionMeta, {});
  assert.deepStrictEqual(pity.mergeInto(u, { collection: ['p_leg'] }).collection, ['p_leg'], 'sans strip (lecture) : rien retiré');
  const owner = db.getDb().prepare("SELECT user_id FROM collection_pity WHERE item_id = 'p_rare' AND found_at IS NOT NULL").get().user_id;
  const kept = pity.mergeInto(owner, { collection: ['p_rare'] }, { strip: true });
  assert.deepStrictEqual(kept.collection, ['p_rare']);
  const merged = pity.mergeInto(owner, {}, { strip: true });
  assert.deepStrictEqual(merged.collection, ['p_rare']);
  assert.strictEqual(merged.collectionMeta.p_rare.n, 1);
  assert.strictEqual(merged.collectionMeta.p_rare.season, season.id);
  // Objet tombé dans le jeu avant de passer en chance croissante : légitime, jamais retiré
  assert.ok(!catalog.serverOnlyIds().has('p_commun'));
  const legacy = catalog.getPublished().items.find(i => i.id === 'p_commun');
  catalog.upsertDraftItem({ ...legacy, drop: { ...legacy.drop, pityStep: 0.002 } });
  catalog.publishDraft({ confirmDrops: true, confirmIncomplete: true });
  assert.ok(!catalog.serverOnlyIds().has('p_commun'), 'déjà tombé côté jeu dans une version publiée');
  assert.ok(catalog.serverOnlyIds().has('p_leg'));
  assert.deepStrictEqual(pity.mergeInto(u, { collection: ['p_commun'] }, { strip: true }).collection, ['p_commun']);
});

test('simulateur : les objets à chance croissante sont tirés indépendamment (comme le serveur) ; reproductible', () => {
  const a = ds.run(['BASE', 'CROISSANT'], ds.PROFILES.regulier, { runs: 8 });
  const b = ds.run(['BASE', 'CROISSANT'], ds.PROFILES.regulier, { runs: 8 });
  assert.deepStrictEqual(a, b);
  const scales = { X: { label: 'x', items: ds.SCALES.CROISSANT.items } };
  const rows = ds.summarize(ds.runAll(['X'], { runs: 4, scales }), scales);
  assert.strictEqual(rows.length, ds.PERIODS.reduce((n, [, s]) => n + s.length, 0));
  for (const r of rows) for (const k of ['all', 'rare', 'legendary', 'legendaryJ1']) assert.ok(r.scales.X[k] >= 0 && r.scales.X[k] <= 1, `${r.profile} ${k}`);
});

// ── HTTP de bout en bout ──────────────────────────────────────────────────────

test('HTTP : admin protégé, modèle et simulation en arrière-plan, objet serveur à la sauvegarde, redémarrage, session unique', async () => {
  const httpDb = path.join(dir, 'http.sqlite');
  const adminSecret = crypto.randomBytes(16).toString('hex');
  const env = { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: adminSecret, SESSION_SECRET: crypto.randomBytes(16).toString('hex') };
  let log = '';
  const start = async () => {
    const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout.on('data', d => { log += d; });
    server.stderr.on('data', d => { log += d; });
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, log);
    return server;
  };
  const stop = server => new Promise(r => { server.once('exit', r); server.kill('SIGTERM'); });
  const admin = { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' };
  const call = (method, p, body, headers = admin) => fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let server = await start();
  try {
    for (const [m, p] of [['GET', '/api/admin/collections/simulation'], ['POST', '/api/admin/collections/simulation'], ['POST', '/api/admin/collections/draft/series/x/preset']]) {
      assert.strictEqual((await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'POST' ? '{}' : undefined })).status, 401, p);
    }
    const seasonId = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season.id;
    assert.strictEqual((await call('PUT', '/api/admin/collections/draft/series/pity_serie', { series: { id: 'pity_serie', names: tx('Série'), seasonId, icon: '🏮' } })).status, 200);
    const it = OBJ('h_leg', 'legendaire', ['terre'], 1, 0.03, { dropEnabled: false });
    assert.strictEqual((await call('PUT', '/api/admin/collections/draft/items/h_leg', { item: it })).status, 200);
    const pr = await (await call('POST', '/api/admin/collections/draft/series/pity_serie/preset', { preset: 'croissant' })).json();
    assert.deepStrictEqual(pr.changed.map(c => c.after), [{ from: ['terre'], minDepth: 1, chance: 0.03, pityStep: 0.003 }]);
    const view = await (await call('GET', '/api/admin/collections')).json();
    assert.strictEqual(view.published.items.some(i => i.id === 'h_leg'), false, 'modèle : brouillon seulement');
    assert.strictEqual(view.pityPresets.croissant.rarities.legendaire.pityStep, 0.003);
    // Simulation : réponse immédiate, calcul en arrière-plan, un seul à la fois
    const s1 = await (await call('POST', '/api/admin/collections/simulation', { seriesId: 'pity_serie', runs: 50 })).json();
    assert.strictEqual(s1.simulation.status, 'running');
    assert.strictEqual((await call('POST', '/api/admin/collections/simulation', { seriesId: 'pity_serie', runs: 50 })).status, 409);
    let st;
    for (let i = 0; i < 300; i++) {
      st = await (await call('GET', '/api/admin/collections/simulation')).json();
      if (st.simulation.status !== 'running') break;
      await new Promise(r => setTimeout(r, 200));
    }
    assert.strictEqual(st.simulation.status, 'done', JSON.stringify(st.simulation.error));
    assert.ok(st.simulation.result.rows.length >= 9);
    assert.ok(st.simulation.result.rows.every(r => r.scales.BROUILLON.legendary >= 0));
    assert.strictEqual((await call('POST', '/api/admin/collections/simulation', { seriesId: 'pity_serie', runs: 10 })).status, 400);

    // Publication (le test publie dans SA base temporaire ; jamais en production sans le propriétaire)
    assert.strictEqual((await call('PUT', '/api/admin/collections/draft/items/h_leg', { item: { ...it, drop: { ...it.drop, pityStep: 0.003 }, dropEnabled: true } })).status, 200);
    const pub = await call('POST', '/api/admin/collections/publish', { confirmDrops: true, confirmIncomplete: true });
    assert.strictEqual(pub.status, 200, await pub.clone().text());
    const cat = await (await fetch(`${BASE}/api/collections/catalog`)).json();
    assert.strictEqual(cat.items.find(i => i.id === 'h_leg').dropEnabled, false, 'jeu : jamais tiré localement');

    const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pityhttp', email: 'pityhttp@example.invalid', password: 'secret123' }) });
    assert.strictEqual(reg.status, 200);
    const cookie = reg.headers.get('set-cookie').split(';')[0];
    const player = { Cookie: cookie, 'Content-Type': 'application/json' };
    const send = (ss, mined, extra = {}) => call('POST', '/api/me/save', { data: { coins: 10, lastSaveTime: Date.now(), collection: ['h_leg'],
      stats: { minedByType: mined }, seasonStats: { seasonId, ...ss } }, ...extra }, player).then(async r => ({ status: r.status, body: await r.json() }));
    const r0 = await send({ maxDepth: 0, manualBlocks: 0, manualClicks: 0, autoBlocks: 0 }, {});
    assert.strictEqual(r0.status, 200);
    assert.strictEqual(r0.body.collectionFinds, undefined);
    const saved0 = await (await call('GET', '/api/me/save', null, player)).json();
    assert.deepStrictEqual(saved0.save.data.collection, [], 'objet « serveur seul » falsifié retiré de la sauvegarde');
    // Compteur avancé directement en base : chance de 3 % + 400 × 0,3 pt = 100 % au prochain tirage
    const Database = require('better-sqlite3');
    const raw = new Database(httpDb);
    const uid = raw.prepare("SELECT id FROM users WHERE username = 'pityhttp'").get().id;
    raw.prepare("INSERT INTO collection_pity (user_id, item_id, fails) VALUES (?, 'h_leg', 400)").run(uid);
    raw.close();
    await new Promise(r => setTimeout(r, 1100));
    const r1 = await send({ maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 }, { terre_meuble: 3 });
    assert.deepStrictEqual((r1.body.collectionFinds || []).map(f => f.itemId), ['h_leg'], JSON.stringify(r1.body));
    const r2 = await send({ maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 }, { terre_meuble: 3 });
    assert.strictEqual(r2.body.collectionFinds, undefined, 'rejeu : rien de plus');

    // Redémarrage : la trouvaille et le compteur restent (base), réinjectés à la lecture
    await stop(server);
    server = await start();
    const saved = await (await call('GET', '/api/me/save', null, player)).json();
    assert.deepStrictEqual(saved.save.data.collection, ['h_leg']);
    assert.strictEqual(saved.save.data.coins, 10, 'aucune autre donnée modifiée');

    // Session de jeu unique (#35) : un autre appareil ne peut ni sauvegarder ni déclencher de tirage
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    assert.strictEqual((await call('POST', '/api/me/play/claim', { controllerId: a }, player)).status, 200);
    const rb = await send({ maxDepth: 4, manualBlocks: 3, manualClicks: 6, autoBlocks: 0 }, { terre_meuble: 3 }, { controllerId: b });
    assert.strictEqual(rb.status, 409);
    assert.ok(rb.body.notController);
    const counters = await (await call('GET', '/api/admin/collections/simulation')).json();
    assert.deepStrictEqual(counters.counters.h_leg, { players: 1, found: 1, maxFails: 400 });
  } finally {
    await stop(server);
  }
});

test('jeu : objet à chance croissante jamais tiré localement (même neuf ou ancien client) ; trouvaille serveur ajoutée une fois', () => {
  const vm = require('vm');
  const ctx = { Math: Object.create(Math), t: k => k, console, I18n: { getCurrent: () => 'fr' } };
  ctx.GameState = { collection: [], collectionMeta: {}, seasonStats: { seasonId: season.id } };
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'public/js/collection.js'), 'utf8')}\n;this.Collection = Collection;`, ctx);
  const C = ctx.Collection;
  assert.ok(C.applyCatalog(catalog.publicCatalog()));
  const leg = C.getById('p_leg');
  assert.strictEqual(JSON.stringify([leg.serverDrop, leg.dropEnabled, C.canDrop(leg)]), '[true,false,false]');
  const gem = { category: 'gemme' };
  for (let k = 0; k < 200; k++) assert.notStrictEqual(C.tryDrop(gem, 500, () => 0)?.id, 'p_leg');
  ctx.GameState.collection = [];
  const added = C.addServerFinds([{ itemId: 'p_leg', names: tx('x') }, { itemId: 'p_leg' }, null]);
  assert.strictEqual(JSON.stringify(added.map(f => f.id)), '["p_leg"]');
  assert.deepStrictEqual([...ctx.GameState.collection], ['p_leg']);
  assert.strictEqual(ctx.GameState.collectionMeta.p_leg.season, season.id);
  assert.strictEqual(C.addServerFinds([{ itemId: 'p_leg' }]).length, 0, 'déjà possédé : pas de seconde annonce');
});
