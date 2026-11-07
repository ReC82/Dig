/**
 * Tables de récompenses administrables, ticket #37 (objectif 4, recette du 04/11) :
 * - migration : v1 = tables d'origine à l'identique (boutique #20 et coffres minés du client) ;
 * - validation : types, bornes, poids > 0, limite par saison, boucle de profit refusée ;
 * - brouillon → publication atomique (version périmée refusée), retour arrière, journal en ajout seul ;
 * - effet réel : le tirage serveur (rollChest) et la description publique suivent la version publiée ;
 * - client : Chests.applyTables applique une table valide et ignore une réponse invalide ;
 * - routes HTTP : admin protégées (401), cycle complet, catalogue public avec `mined`.
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
const PORT  = process.env.DIG_TEST_PORT_REWARDS || '3174';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-rewards-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const rewards   = require('../server/rewardTables');
const chestShop = require('../server/chestShop');

db.initDb();
rewards.init();
rewards.init();   // idempotent

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function loadChests() {
  const ctx = vm.createContext({ Math, GameState: {} });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js/chests.js'), 'utf8') + ';this.Chests = Chests;', ctx);
  return ctx.Chests;
}
const plain = o => JSON.parse(JSON.stringify(o));

test('v1 = tables d\'origine à l\'identique, une seule fois', () => {
  const p = rewards.getPublished();
  assert.strictEqual(p.version, 1);
  assert.strictEqual(rewards.listVersions().length, 1);
  for (const id of ['simple', 'rare', 'antique']) {
    assert.deepStrictEqual(p.tables.shop[id].table, chestShop.SHOP_CHESTS[id].table, id);
    assert.strictEqual(p.tables.shop[id].maxPerSeason, chestShop.SHOP_CHESTS[id].maxPerSeason, id);
  }
  assert.deepStrictEqual(p.tables.mined, plain(loadChests().TABLES));
  // Description publique inchangée par rapport aux tables codées
  const desc = chestShop.describeChests({});
  assert.deepStrictEqual(desc.chests.find(c => c.id === 'antique').table.map(r => r.weight), [30, 25, 18, 10, 12, 4, 1]);
  assert.deepStrictEqual(desc.mined, p.tables.mined);
  // La v1 se valide telle quelle avec les prix par défaut
  assert.deepStrictEqual(rewards.validateTables(p.tables).errors, []);
});

test('validation : types, bornes, limite, boucle de profit', () => {
  const t = rewards.getPublished().tables;
  const bad = structuredClone(t);
  bad.shop.simple.table.push({ weight: 0, type: 'coins', min: 10, max: 5 });
  bad.mined.commun.push({ weight: 1, type: 'collection' });
  bad.shop.antique.maxPerSeason = 0;
  const v = rewards.validateTables(bad);
  assert.ok(v.errors.some(e => /Boutique simple, ligne 5 : poids/.test(e)), v.errors.join('\n'));
  assert.ok(v.errors.some(e => /min \(10\) > max \(5\)/.test(e)));
  assert.ok(v.errors.some(e => /Coffre miné commun, ligne 4 : type « collection »/.test(e)));
  assert.ok(v.errors.some(e => /Boutique antique : limite/.test(e)));

  const profit = structuredClone(t);
  profit.shop.simple.table = [{ weight: 1, type: 'coins', min: 2000, max: 3000 }];
  assert.ok(rewards.validateTables(profit).errors.some(e => /boucle de profit/.test(e)));
  // Le prix effectif (⚙ Config) est pris en compte
  assert.deepStrictEqual(rewards.validateTables(profit, { costs: { simple: 5000, rare: 15000, antique: 80000 } }).errors, []);

  const extra = structuredClone(t);
  extra.shop.mega = { maxPerSeason: null, table: [] };
  assert.ok(rewards.validateTables(extra).errors.some(e => /Coffres inconnus : mega/.test(e)));
});

test('brouillon → publication → effet sur le tirage serveur → retour arrière, journal en ajout seul', () => {
  const t = rewards.getPublished().tables;
  // Brouillon identique : aucun brouillon conservé
  assert.strictEqual(rewards.saveDraft(t).draft, null);
  assert.strictEqual(rewards.getDraft(), null);

  t.shop.simple.table = [{ weight: 1, type: 'boost', mult: 2, minutes: 7 }];
  t.shop.antique.maxPerSeason = 3;
  t.mined.epique[0].min = 700;
  const saved = rewards.saveDraft(t);
  assert.deepStrictEqual(saved.changes.map(c => `${c.family}.${c.id}`), ['shop.simple', 'shop.antique', 'mined.epique']);
  // Rien ne change en jeu tant que le brouillon n'est pas publié
  assert.strictEqual(chestShop.describeChests({}).chests[0].table.length, 4);
  assert.strictEqual(chestShop.describeChests({}).chests[2].maxPerSeason, 5);

  assert.throws(() => rewards.publishDraft({ expectedBasedOn: 7 }), e => e.status === 409);
  const pub = rewards.publishDraft({ note: 'essai' });
  assert.strictEqual(pub.version, 2);
  assert.strictEqual(rewards.getDraft(), null);
  for (let i = 0; i < 20; i++) {
    const r = chestShop.rollChest('simple', { coins: 10_000 }).reward;
    assert.deepStrictEqual(r, { type: 'boost', mult: 2, minutes: 7 });
  }
  const data = { coins: 1e6, shopChestsBought: { antique: 3 } };
  assert.throws(() => chestShop.rollChest('antique', data), /Limite saisonnière/);
  assert.strictEqual(chestShop.describeChests({}).mined.epique[0].min, 700);

  const rb = rewards.rollbackTo(1);
  assert.deepStrictEqual(rb, { version: 3, restored: 1, priceChanges: [], pricesKept: true });
  // #88 : la nouvelle version mémorise les prix en vigueur (v1 n'en a pas : prix gardés)
  assert.deepStrictEqual(rewards.getPublished().tables, rewards.withCosts(rewards.getVersion(1).tables, require('../server/economy').DEFAULT_CHEST_COSTS));
  assert.throws(() => rewards.rollbackTo(3), e => e.status === 409);

  assert.throws(() => db.getDb().prepare('UPDATE reward_table_versions SET note = 1').run(), /ajout seul/);
  assert.throws(() => db.getDb().prepare('DELETE FROM reward_table_audit').run(), /ajout seul/);
  assert.deepStrictEqual(rewards.listAudit().map(a => a.action).slice(0, 4), ['rollback', 'publish', 'draft_save', 'migrate']);
});

test('simulation : fréquences observées proches des probabilités', () => {
  const res = rewards.simulate(rewards.getPublished().tables, { n: 100_000 });
  assert.strictEqual(res.length, 6);
  for (const r of res) {
    for (const row of r.rows) assert.ok(Math.abs(row.observed - row.chance) < 0.6, `${r.id} ${row.chance} / ${row.observed}`);
    assert.ok(Math.abs(r.observedCoins - r.expectedCoins) <= Math.max(50, r.expectedCoins * 0.03), `${r.id} pièces`);
  }
});

test('client : Chests.applyTables applique une table valide, ignore une réponse invalide', () => {
  const Chests = loadChests();
  const orig = plain(Chests.TABLES);
  assert.strictEqual(Chests.applyTables(undefined), false);
  assert.strictEqual(Chests.applyTables({ commun: [{ weight: 1, type: 'coins', min: 5, max: 1 }], rare: orig.rare, epique: orig.epique }), false);
  assert.strictEqual(Chests.applyTables({ commun: orig.commun }), false);
  assert.deepStrictEqual(plain(Chests.TABLES), orig);
  const next = structuredClone(orig);
  next.commun = [{ weight: 1, type: 'relics', amount: 9 }];
  assert.strictEqual(Chests.applyTables(next), true);
  assert.deepStrictEqual(plain(Chests.TABLES.commun), next.commun);
});

test('routes HTTP : protégées, cycle complet, catalogue public (serveur de test)', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'),
      ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  t.after(() => server.kill());
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, `serveur de test non démarré :\n${log}`);
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(BASE + url, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  for (const [m, u] of [['GET', '/api/admin/rewards'], ['PUT', '/api/admin/rewards/draft'], ['DELETE', '/api/admin/rewards/draft'],
    ['POST', '/api/admin/rewards/simulate'], ['POST', '/api/admin/rewards/publish'], ['POST', '/api/admin/rewards/rollback'], ['GET', '/api/admin/rewards/audit']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  const view = (await call('GET', '/api/admin/rewards')).body;
  assert.strictEqual(view.published.version, 1);
  assert.strictEqual(view.published.stats.shop.simple.stats.rows.reduce((s, r) => s + r.chance, 0), 100);
  assert.deepStrictEqual(view.costs, { simple: 2000, rare: 15000, antique: 80000 });

  const tables = structuredClone(view.published.tables);
  tables.mined.commun = [{ weight: 3, type: 'coins', min: 100, max: 200 }, { weight: 1, type: 'relics', amount: 2 }];
  const put = await call('PUT', '/api/admin/rewards/draft', { tables });
  assert.strictEqual(put.status, 200);
  assert.deepStrictEqual(put.body.errors, []);
  const sim = await call('POST', '/api/admin/rewards/simulate', { source: 'draft', n: 10000 });
  assert.strictEqual(sim.status, 200);
  assert.strictEqual(sim.body.results.find(r => r.id === 'commun' && r.family === 'mined').rows[0].chance, 75);
  assert.strictEqual((await call('GET', '/api/shop/chests', undefined, { auth: false })).body.mined.commun.length, 3, 'brouillon invisible');
  const pub = await call('POST', '/api/admin/rewards/publish', { note: 'test', basedOn: 1 });
  assert.strictEqual(pub.status, 200, JSON.stringify(pub.body));
  assert.deepStrictEqual((await call('GET', '/api/shop/chests', undefined, { auth: false })).body.mined.commun, tables.mined.commun);
  const rb = await call('POST', '/api/admin/rewards/rollback', { version: 1 });
  assert.strictEqual(rb.status, 200);
  assert.strictEqual((await call('GET', '/api/shop/chests', undefined, { auth: false })).body.mined.commun.length, 3);
  const bad = await call('PUT', '/api/admin/rewards/draft', { tables: null });
  assert.strictEqual(bad.status, 400);
  assert.ok((await call('GET', '/api/admin/rewards/audit')).body.audit.length >= 4);
});

test('panel admin : onglet Coffres & drops présent et branché', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  assert.match(js, /\{ id: 'rewards',\s+group: 'game'[^\n]*load: \(\) => loadRewards\(\) \}/, 'rubrique du menu (#70), branchée');
  assert.match(html, /<section id="tab-rewards"[\s\S]*id="btn-refresh-rewards"[\s\S]*<dialog id="rw-dialog"/);
  assert.match(js, /admRefreshButton\('btn-refresh-rewards'/);
  assert.match(js, /admDialogSetup\('rw-dialog'/);
});
