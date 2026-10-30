/**
 * Tests de cohérence des sauvegardes cloud (ticket #18) : révision serveur, rejet des
 * sauvegardes obsolètes (409), reset admin conservé, coffre et révision.
 * Lance le serveur sur un port de test avec une base temporaire (hors server/data/).
 * Ne touche ni au service dig, ni au port 3000, ni à la base de production.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_SAVE || '3118';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

let dir, dbPath, server, db;

async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: dbPath, ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/api/version`); return; } catch (_) {}
    if (server.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Serveur de test non démarré :\n${log}`);
}

/** Client HTTP minimal qui conserve le cookie de session. */
function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

async function newPlayer(name) {
  const call = client();
  const r = await call('POST', '/api/register', { username: name, email: `${name}@example.invalid`, password: 'secret123' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  return { call, id: r.body.user.id };
}

const blob = extra => ({ coins: 0, depth: 1, relicFragments: 0, collection: [], shopChestsBought: { simple: 0, rare: 0, antique: 0 }, ...extra });
const save = (call, data, baseRevision) =>
  call('POST', '/api/me/save', baseRevision === undefined ? { data } : { data, baseRevision });
const saveRow = id => db.prepare('SELECT data, version FROM user_saves WHERE user_id = ?').get(id);
const admin   = (call, method, url, body) => call(method, url, body, { Authorization: `Bearer ${ADMIN}` });

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-save-test-'));
  dbPath = path.join(dir, 'save-test.sqlite');
  await startServer();
  db = new Database(dbPath);
});

test.after(() => {
  if (db) db.close();
  if (server) server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('première sauvegarde (baseRevision null) puis révisions successives', async () => {
  const { call, id } = await newPlayer('revbasic');
  let r = await save(call, blob({ coins: 10, lastSaveTime: 1 }), null);
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.revision, 1);

  r = await save(call, blob({ coins: 20, lastSaveTime: 2 }), 1);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.revision, 2);
  assert.strictEqual(r.body.version, 2); // alias historique

  r = await call('GET', '/api/me/save');
  assert.strictEqual(r.body.save.revision, 2);
  assert.strictEqual(r.body.save.data.coins, 20);
  assert.strictEqual(saveRow(id).version, 2);
});

test('sauvegarde obsolète (deux onglets / appareils) : 409 avec la version actuelle, rien n\'est écrasé', async () => {
  const { call, id } = await newPlayer('revtabs');
  await save(call, blob({ coins: 100, lastSaveTime: 1 }), null);          // révision 1
  const tabA = await save(call, blob({ coins: 500, lastSaveTime: 2 }), 1); // onglet A → 2
  assert.strictEqual(tabA.status, 200);

  const tabB = await save(call, blob({ coins: 150, lastSaveTime: 3 }), 1); // onglet B, encore sur 1
  assert.strictEqual(tabB.status, 409);
  assert.strictEqual(tabB.body.conflict, true);
  assert.strictEqual(tabB.body.save.revision, 2);
  assert.strictEqual(tabB.body.save.data.coins, 500);
  assert.strictEqual(JSON.parse(saveRow(id).data).coins, 500);
  assert.strictEqual(saveRow(id).version, 2);

  // baseRevision null alors qu'une sauvegarde existe : refus aussi
  const fresh = await save(call, blob({ coins: 0 }), null);
  assert.strictEqual(fresh.status, 409);
  assert.strictEqual(JSON.parse(saveRow(id).data).coins, 500);

  // Après avoir appliqué la version serveur, l'onglet B repart de la révision 2
  const retry = await save(call, blob({ coins: 510, lastSaveTime: 4 }), 2);
  assert.strictEqual(retry.status, 200);
  assert.strictEqual(retry.body.revision, 3);
});

test('une sauvegarde refusée ne met pas à jour le classement', async () => {
  const { call, id } = await newPlayer('revrank');
  const season = (await call('GET', '/api/seasons/current')).body.season;
  const stats = d => ({ seasonId: season.id, maxDepth: d, manualBlocks: d, autoBlocks: 0, manualClicks: d * 3 });
  await save(call, blob({ depth: 5, seasonStats: stats(5) }), null);
  const before = db.prepare('SELECT * FROM season_rankings WHERE user_id = ?').get(id);
  const r = await save(call, blob({ depth: 50, seasonStats: stats(50) }), 0);
  assert.strictEqual(r.status, 409);
  assert.deepStrictEqual(db.prepare('SELECT * FROM season_rankings WHERE user_id = ?').get(id), before);
});

test('ancien client sans baseRevision : écriture acceptée comme avant', async () => {
  const { call } = await newPlayer('revlegacy');
  await save(call, blob({ coins: 1 }), null);
  const r = await save(call, blob({ coins: 2 }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.revision, 2);
});

test('baseRevision ou data invalides : 400', async () => {
  const { call } = await newPlayer('revbad');
  assert.strictEqual((await save(call, blob(), 'abc')).status, 400);
  assert.strictEqual((await save(call, blob(), 1.5)).status, 400);
  assert.strictEqual((await call('POST', '/api/me/save', { data: [1, 2] })).status, 400);
  assert.strictEqual((await call('POST', '/api/me/save', {})).status, 400);
});

test('reset admin : la révision augmente et la synchro suivante du client ne l\'écrase pas', async () => {
  const { call, id } = await newPlayer('revadmin');
  let r = await save(call, blob({ coins: 9999, depth: 42, gems: 500, lastSaveTime: Date.now() - 1000 }), null);
  assert.strictEqual(r.body.revision, 1);

  r = await admin(call, 'POST', `/api/admin/players/${id}/season-reset`, { confirm: true });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.revision, 2);
  const reset = JSON.parse(saveRow(id).data);
  assert.strictEqual(reset.coins, 0);
  assert.strictEqual(reset.depth, 1);
  assert.ok(reset.lastSaveTime >= Date.now() - 60_000, 'lastSaveTime rafraîchi par le reset');

  // Le client, toujours sur la révision 1, envoie sa progression : refusée, le reset est renvoyé
  r = await save(call, blob({ coins: 10_050, depth: 43, lastSaveTime: Date.now() }), 1);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.save.data.coins, 0);
  assert.strictEqual(r.body.save.data.depth, 1);
  assert.strictEqual(JSON.parse(saveRow(id).data).coins, 0);

  r = await admin(call, 'GET', `/api/admin/players/${id}/save`);
  assert.strictEqual(r.body.save.revision, 2);
  assert.ok(r.body.save.updatedAt, 'date de sauvegarde exposée');
});

test('coffre : la réponse donne la nouvelle révision, utilisable pour la sauvegarde suivante', async () => {
  const { call, id } = await newPlayer('revchest');
  await save(call, blob({ coins: 5000 }), null);
  const r = await call('POST', '/api/me/shop/chest/open', { chestId: 'simple' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.revision, 2);
  assert.strictEqual(saveRow(id).version, 2);
  assert.strictEqual((await save(call, blob({ coins: 1 }), 1)).status, 409);
  assert.strictEqual((await save(call, blob({ coins: r.body.newCoins }), 2)).status, 200);
});
