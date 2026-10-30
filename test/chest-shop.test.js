/**
 * Tests HTTP de l'achat des coffres de saison (POST /api/me/shop/chest/open), ticket #8.
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
const PORT  = process.env.DIG_TEST_PORT_CHEST || '3108';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');
const COSTS = { simple: 2000, rare: 15000, antique: 80000 };

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

function save(call, extra) {
  return call('POST', '/api/me/save', {
    data: { coins: 0, relicFragments: 0, collection: [], shopChestsBought: { simple: 0, rare: 0, antique: 0 }, ...extra },
  });
}

const saveRow = id => db.prepare('SELECT data, version FROM user_saves WHERE user_id = ?').get(id);
const events  = id => db.prepare('SELECT event_type, metadata FROM user_events WHERE user_id = ? ORDER BY id').all(id);

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-chest-test-'));
  dbPath = path.join(dir, 'chest-test.sqlite');
  await startServer();
  db = new Database(dbPath);
});

test.after(() => {
  if (db) db.close();
  if (server) server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('les 3 coffres s\'achètent avec un solde suffisant : débit, crédit et journal cohérents', async () => {
  const { call, id } = await newPlayer('chestok');
  assert.strictEqual((await save(call, { coins: 200_000 })).status, 200);

  let coins = 200_000;
  for (const chestId of ['simple', 'rare', 'antique']) {
    const before = saveRow(id);
    const r = await call('POST', '/api/me/shop/chest/open', { chestId });
    assert.strictEqual(r.status, 200, `${chestId} : ${JSON.stringify(r.body)}`);
    assert.strictEqual(r.body.ok, true);
    assert.strictEqual(r.body.boughtThisSeason, 1);
    const gain = r.body.reward.type === 'coins' ? r.body.reward.amount : 0;
    assert.strictEqual(r.body.newCoins, coins - COSTS[chestId] + gain);
    coins = r.body.newCoins;

    const after = saveRow(id);
    const data  = JSON.parse(after.data);
    assert.strictEqual(after.version, before.version + 1);
    assert.strictEqual(data.coins, coins);
    assert.strictEqual(data.shopChestsBought[chestId], 1);
    assert.strictEqual(data.relicFragments, r.body.newRelicFragments);
  }

  const ev = events(id);
  assert.deepStrictEqual(ev.map(e => e.event_type), ['chest_shop_open', 'chest_shop_open', 'chest_shop_open']);
  assert.deepStrictEqual(ev.map(e => JSON.parse(e.metadata).chestId), ['simple', 'rare', 'antique']);
});

test('solde insuffisant : 400 pour chaque coffre, sauvegarde et journal inchangés', async () => {
  const { call, id } = await newPlayer('chestpoor');
  await save(call, { coins: 1999 });
  const before = saveRow(id);

  for (const chestId of ['simple', 'rare', 'antique']) {
    const r = await call('POST', '/api/me/shop/chest/open', { chestId });
    assert.strictEqual(r.status, 400, chestId);
    assert.strictEqual(r.body.error, 'Coins insuffisants.');
  }
  assert.deepStrictEqual(saveRow(id), before);
  assert.strictEqual(events(id).length, 0);
});

test('double clic / requêtes simultanées : un seul débit quand le solde ne permet qu\'un coffre', async () => {
  const { call, id } = await newPlayer('chestdouble');
  // Le gros lot du coffre simple (jusqu'à 3 500) permettrait d'en racheter un second : le coût est
  // porté le temps du test à 4 000 (réglage admin), au-delà de tout gain possible.
  const cost = 4000;
  db.prepare(`INSERT OR REPLACE INTO admin_config (key, value) VALUES ('chest_cost_simple', ?)`).run(String(cost));
  await save(call, { coins: cost });
  const before = saveRow(id);

  let results;
  try {
    results = await Promise.all(
      Array.from({ length: 5 }, () => call('POST', '/api/me/shop/chest/open', { chestId: 'simple' })),
    );
  } finally {
    db.prepare(`DELETE FROM admin_config WHERE key = 'chest_cost_simple'`).run();
  }
  const ok = results.filter(r => r.status === 200);
  assert.strictEqual(ok.length, 1, JSON.stringify(results.map(r => r.status)));
  for (const r of results.filter(r => r.status !== 200)) {
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error, 'Coins insuffisants.');
  }

  const gain = ok[0].body.reward.type === 'coins' ? ok[0].body.reward.amount : 0;
  const data = JSON.parse(saveRow(id).data);
  assert.strictEqual(data.coins, gain, 'débité une seule fois');
  assert.strictEqual(data.shopChestsBought.simple, 1);
  assert.strictEqual(saveRow(id).version, before.version + 1);
  assert.strictEqual(events(id).length, 1);
});

test('GET /api/shop/chests : public, lecture seule, table identique à celle du tirage serveur', async () => {
  const { describeChests, SHOP_CHESTS } = require('../server/chestShop');
  const r = await client()('GET', '/api/shop/chests');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body, JSON.parse(JSON.stringify(describeChests({}))));
  for (const chest of r.body.chests) {
    assert.deepStrictEqual(chest.table.map(({ chance, ...row }) => row), SHOP_CHESTS[chest.id].table);
  }
  // Réglage admin (coût, multiplicateur de fragments) visible aussitôt dans la table publiée
  db.prepare(`INSERT OR REPLACE INTO admin_config (key, value) VALUES ('fragment_drop_multiplier', '2')`).run();
  try {
    const r2 = await client()('GET', '/api/shop/chests');
    assert.strictEqual(r2.body.fragments.multiplier, 2);
  } finally {
    db.prepare(`DELETE FROM admin_config WHERE key = 'fragment_drop_multiplier'`).run();
  }
  const post = await client()('POST', '/api/shop/chests', {});
  assert.strictEqual(post.status, 404, 'aucune écriture possible');
});

test('limite saisonnière du coffre antique : 400, rien n\'est débité', async () => {
  const { call, id } = await newPlayer('chestmax');
  await save(call, { coins: 1_000_000, shopChestsBought: { simple: 0, rare: 0, antique: 5 } });
  const before = saveRow(id);
  const r = await call('POST', '/api/me/shop/chest/open', { chestId: 'antique' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error, 'Limite saisonnière atteinte.');
  assert.deepStrictEqual(saveRow(id), before);
});

test('requêtes invalides : non connecté 401, coffre inconnu 400, sans sauvegarde 404', async () => {
  assert.strictEqual((await client()('POST', '/api/me/shop/chest/open', { chestId: 'simple' })).status, 401);
  const { call } = await newPlayer('chestnosave');
  assert.strictEqual((await call('POST', '/api/me/shop/chest/open', { chestId: 'gold' })).status, 400);
  assert.strictEqual((await call('POST', '/api/me/shop/chest/open', { chestId: 'simple' })).status, 404);
});

test('atomicité : si la journalisation échoue, la sauvegarde n\'est pas modifiée', async () => {
  const { call, id } = await newPlayer('chestatomic');
  await save(call, { coins: 50_000 });
  const before = saveRow(id);

  db.exec(`CREATE TRIGGER fail_user_events BEFORE INSERT ON user_events
           BEGIN SELECT RAISE(ABORT, 'échec simulé'); END`);
  try {
    const r = await call('POST', '/api/me/shop/chest/open', { chestId: 'simple' });
    assert.strictEqual(r.status, 500);
    assert.deepStrictEqual(saveRow(id), before);
  } finally {
    db.exec('DROP TRIGGER fail_user_events');
  }

  // Une fois la panne levée, l'achat fonctionne à nouveau.
  const r = await call('POST', '/api/me/shop/chest/open', { chestId: 'simple' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(saveRow(id).version, before.version + 1);
});

test('reset saisonnier admin : ne renvoie plus 500 et est journalisé', async () => {
  const { call, id } = await newPlayer('chestreset');
  await save(call, { coins: 12_345, shopChestsBought: { simple: 3, rare: 1, antique: 2 } });
  const r = await client()('POST', `/api/admin/players/${id}/season-reset`, { confirm: true }, { Authorization: `Bearer ${ADMIN}` });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const data = JSON.parse(saveRow(id).data);
  assert.strictEqual(data.coins, 0);
  assert.deepStrictEqual(data.shopChestsBought, { simple: 0, rare: 0, antique: 0 });
  assert.deepStrictEqual(events(id).map(e => e.event_type), ['admin_season_reset']);
});

// ── Compatibilité #8 × #10 : sauvegardes cloud regroupées et solde récent ─────────────────

/** Sauvegarde comme le client depuis #10 : révision de base + statistiques de saison. */
function cloudSave(call, baseRevision, coins, seasonStats, bought = { simple: 0, rare: 0, antique: 0 }) {
  return call('POST', '/api/me/save', {
    data: { lastSaveTime: Date.now(), coins, relicFragments: 0, collection: [], shopChestsBought: bought, seasonStats },
    baseRevision,
  });
}

test('#8 × #10 : solde gagné depuis le dernier envoi groupé, puis achat — débit unique, sauvegarde tardive refusée', async () => {
  const { call, id } = await newPlayer('chestrecent');
  const season = (await call('GET', '/api/seasons/current')).body.season;
  assert.ok(season?.id, 'saison active attendue');
  const stats = (clicks, blocks) => ({ seasonId: season.id, maxDepth: blocks + 1, manualBlocks: blocks, autoBlocks: 0, manualClicks: clicks });

  // Dernier envoi groupé (toutes les 12 s) : le serveur ne connaît encore que 500 pièces.
  const r1 = await cloudSave(call, null, 500, stats(30, 10));
  assert.strictEqual(r1.status, 200);

  // Les pièces gagnées depuis ne sont que locales : sans synchro préalable, l'achat est refusé
  // sans rien modifier (d'où la synchro forcée par openShopChest avant l'achat).
  const before = saveRow(id);
  const refused = await call('POST', '/api/me/shop/chest/open', { chestId: 'simple' });
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.body.error, 'Coins insuffisants.');
  assert.deepStrictEqual(saveRow(id), before);

  // openShopChest : Save.save() + _syncToCloud() envoient le solde récent, puis l'achat.
  const r2 = await cloudSave(call, r1.body.revision, COSTS.simple + 300, stats(60, 20));
  assert.strictEqual(r2.status, 200);
  const buy = await call('POST', '/api/me/shop/chest/open', { chestId: 'simple' });
  assert.strictEqual(buy.status, 200, JSON.stringify(buy.body));
  assert.strictEqual(buy.body.revision, r2.body.revision + 1);
  const gain = buy.body.reward.type === 'coins' ? buy.body.reward.amount : 0;
  assert.strictEqual(buy.body.newCoins, 300 + gain);

  // Un envoi tardif portant l'état d'avant l'achat (sendBeacon d'un autre onglet, réponse
  // perdue) ne peut pas annuler le débit : conflit 409, sauvegarde serveur inchangée.
  const afterBuy = saveRow(id);
  const stale = await cloudSave(call, r2.body.revision, COSTS.simple + 300, stats(60, 20));
  assert.strictEqual(stale.status, 409);
  assert.strictEqual(stale.body.conflict, true);
  assert.strictEqual(stale.body.save.revision, buy.body.revision);
  assert.deepStrictEqual(saveRow(id), afterBuy);

  // Le client continue depuis la révision renvoyée par l'achat : sauvegarde acceptée.
  const r3 = await cloudSave(call, buy.body.revision, 300 + gain + 40, stats(90, 30), { simple: 1, rare: 0, antique: 0 });
  assert.strictEqual(r3.status, 200);
  const data = JSON.parse(saveRow(id).data);
  assert.strictEqual(data.coins, 300 + gain + 40);
  assert.strictEqual(data.shopChestsBought.simple, 1);
  assert.deepStrictEqual(events(id).map(e => e.event_type), ['chest_shop_open']);

  // L'achat ne perturbe pas le classement : statistiques de saison suivies, aucun log
  // anti-autoclic (envois < 3 s cumulés ; cadences testées à horloge fixe dans anticheat.test.js).
  const rank = db.prepare('SELECT manual_blocks, manual_clicks FROM season_rankings WHERE user_id = ? AND season_id = ?').get(id, season.id);
  assert.deepStrictEqual({ ...rank }, { manual_blocks: 30, manual_clicks: 90 });
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM anticheat_logs WHERE user_id = ?').get(id).n, 0);
});
