/**
 * Tests de la session de jeu unique multi-appareils (ticket #35) : prise de contrôle, refus des
 * écritures d'un ancien contrôleur (sauvegarde, coffre, requêtes tardives et rafales), bail
 * expiré, déconnexion, ancien client, bloc courant conservé par le serveur (redémarrage compris).
 * Lance le serveur sur un port de test avec une base temporaire (hors server/data/).
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

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_PLAY || '3147';
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = crypto.randomBytes(16).toString('hex');

let dir, dbPath, server, db;

async function startServer() {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: dbPath, SESSION_SECRET: SECRET, RATE_SAVE_MAX: '1000', RATE_PLAY_MAX: '1000' },
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

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const done = new Promise(r => server.once('exit', r));
  server.kill();
  await done;
}

/** Client HTTP minimal qui conserve le cookie de session (un navigateur / appareil). */
function client(cookie = '') {
  const call = async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  call.cookie = () => cookie;
  return call;
}

/** Joueur connecté sur deux appareils : PC (inscription) et téléphone (connexion séparée). */
async function newPlayer(name) {
  const pc = client();
  const r = await pc('POST', '/api/register', { username: name, email: `${name}@example.invalid`, password: 'secret123' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const phone = client();
  const l = await phone('POST', '/api/login', { username: name, password: 'secret123' });
  assert.strictEqual(l.status, 200, JSON.stringify(l.body));
  return { pc, phone, id: r.body.user.id };
}

const ctrl  = () => crypto.randomBytes(9).toString('base64url');
const block = extra => ({ name: 'block.diamant', hp: 123, maxHp: 400, reward: 3500, depth: 130, seq: 42, ...extra });
const blob  = extra => ({ coins: 0, depth: 130, relicFragments: 0, collection: [], shopChestsBought: { simple: 0, rare: 0, antique: 0 },
  blockSeed: 987654321, blockSeq: 42, block: block(), ...extra });
const saveRow = id => db.prepare('SELECT data, version FROM user_saves WHERE user_id = ?').get(id);
const lease   = id => db.prepare('SELECT * FROM play_controllers WHERE user_id = ?').get(id);

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-play-test-'));
  dbPath = path.join(dir, 'play-test.sqlite');
  await startServer();
  db = new Database(dbPath);
});

test.after(async () => {
  if (db) db.close();
  await stopServer();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PC puis téléphone : le téléphone prend la main, le PC ne peut plus sauvegarder', async () => {
  const { pc, phone, id } = await newPlayer('playswitch');
  const pcId = ctrl(), phoneId = ctrl();

  let r = await pc('POST', '/api/me/play/claim', { controllerId: pcId });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.epoch, 1);
  assert.strictEqual(r.body.save, null);
  r = await pc('POST', '/api/me/save', { data: blob(), baseRevision: null, controllerId: pcId });
  assert.strictEqual(r.status, 200);

  // Le téléphone prend la main et reçoit la sauvegarde avec le bloc courant à l'identique
  r = await phone('POST', '/api/me/play/claim', { controllerId: phoneId });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.epoch, 2);
  assert.strictEqual(r.body.previousActive, true);
  assert.deepStrictEqual(r.body.save.data.block, block());
  assert.strictEqual(r.body.save.data.blockSeq, 42);

  // Requête tardive du PC : refusée, rien n'est écrit, la session du PC reste ouverte
  r = await pc('POST', '/api/me/save', { data: blob({ coins: 999999 }), baseRevision: 1, controllerId: pcId });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.notController, true);
  assert.strictEqual(r.body.conflict, undefined);
  assert.strictEqual(JSON.parse(saveRow(id).data).coins, 0);
  assert.strictEqual(saveRow(id).version, 1);
  assert.strictEqual((await pc('GET', '/api/me')).body.user.id, id, 'le PC n\'est pas déconnecté');

  // Le PC apprend qu'il a perdu la main (et ne peut pas la reprendre en silence)
  r = await pc('POST', '/api/me/play/heartbeat', { controllerId: pcId });
  assert.deepStrictEqual(r.body, { active: false, canResume: false, epoch: 2 });
  r = await pc('POST', '/api/me/play/claim', { controllerId: pcId, onlyIfFree: true });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.notController, true);

  // Le téléphone joue normalement
  r = await phone('POST', '/api/me/save', { data: blob({ coins: 50, block: block({ hp: 100 }) }), baseRevision: 1, controllerId: phoneId });
  assert.strictEqual(r.status, 200);
  r = await phone('POST', '/api/me/play/heartbeat', { controllerId: phoneId });
  assert.deepStrictEqual(r.body, { active: true, epoch: 2 });

  // « Jouer ici » sur le PC : prise de contrôle explicite, il reprend l'état du téléphone
  const pcId2 = ctrl();
  r = await pc('POST', '/api/me/play/claim', { controllerId: pcId2 });
  assert.strictEqual(r.body.epoch, 3);
  assert.strictEqual(r.body.save.data.coins, 50);
  assert.strictEqual(r.body.save.data.block.hp, 100);
  r = await phone('POST', '/api/me/save', { data: blob({ coins: 60 }), baseRevision: 2, controllerId: phoneId });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.notController, true);
});

test('prise de contrôle idempotente pour la page déjà active', async () => {
  const { pc, id } = await newPlayer('playidem');
  const pcId = ctrl();
  await pc('POST', '/api/me/play/claim', { controllerId: pcId });
  const r = await pc('POST', '/api/me/play/claim', { controllerId: pcId });
  assert.strictEqual(r.body.epoch, 1);
  assert.strictEqual(r.body.previousActive, false);
  assert.strictEqual(lease(id).controller_id, pcId);
});

test('rafales concurrentes de sauvegardes et de prises de contrôle : un seul contrôleur écrit', async () => {
  const { pc, phone, id } = await newPlayer('playburst');
  const pcId = ctrl(), phoneId = ctrl();
  await pc('POST', '/api/me/play/claim', { controllerId: pcId });
  await pc('POST', '/api/me/save', { data: blob({ coins: 1 }), baseRevision: null, controllerId: pcId });
  await phone('POST', '/api/me/play/claim', { controllerId: phoneId });

  // 15 sauvegardes du PC (ancien contrôleur) en parallèle de 15 du téléphone
  const results = await Promise.all([
    ...Array.from({ length: 15 }, (_, i) => pc('POST', '/api/me/save', { data: blob({ coins: 1000 + i }), controllerId: pcId }).then(r => ({ who: 'pc', r }))),
    ...Array.from({ length: 15 }, (_, i) => phone('POST', '/api/me/save', { data: blob({ coins: 10 + i }), controllerId: phoneId }).then(r => ({ who: 'phone', r }))),
  ]);
  assert.ok(results.filter(x => x.who === 'pc').every(x => x.r.status === 409 && x.r.body.notController));
  assert.ok(results.filter(x => x.who === 'phone').every(x => x.r.status === 200));
  const coins = JSON.parse(saveRow(id).data).coins;
  assert.ok(coins >= 10 && coins < 25, `écrit par le téléphone seulement (${coins})`);
  assert.strictEqual(saveRow(id).version, 16);

  // Prises de contrôle simultanées : exactement un gagnant final, époque cohérente
  const ids = Array.from({ length: 8 }, ctrl);
  const claims = await Promise.all(ids.map((c, i) => (i % 2 ? pc : phone)('POST', '/api/me/play/claim', { controllerId: c })));
  assert.ok(claims.every(c => c.status === 200));
  const epochs = claims.map(c => c.body.epoch).sort((a, b) => a - b);
  assert.deepStrictEqual(epochs, [3, 4, 5, 6, 7, 8, 9, 10], 'chaque prise de contrôle a sa propre époque');
  const winner = lease(id).controller_id;
  assert.strictEqual(claims[ids.indexOf(winner)].body.epoch, 10);
  for (const c of ids.filter(c => c !== winner)) {
    const r = await pc('POST', '/api/me/save', { data: blob({ coins: 5 }), controllerId: c });
    assert.strictEqual(r.status, 409);
  }
});

test('coffre acheté par l\'ancien contrôleur : refusé, pièces et coffres inchangés', async () => {
  const { pc, phone, id } = await newPlayer('playchest');
  const pcId = ctrl(), phoneId = ctrl();
  await pc('POST', '/api/me/play/claim', { controllerId: pcId });
  await pc('POST', '/api/me/save', { data: blob({ coins: 50000 }), baseRevision: null, controllerId: pcId });
  await phone('POST', '/api/me/play/claim', { controllerId: phoneId });

  let r = await pc('POST', '/api/me/shop/chest/open', { chestId: 'simple', controllerId: pcId });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.notController, true);
  assert.strictEqual(JSON.parse(saveRow(id).data).coins, 50000);
  assert.strictEqual(saveRow(id).version, 1);

  r = await phone('POST', '/api/me/shop/chest/open', { chestId: 'simple', controllerId: phoneId });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(JSON.parse(saveRow(id).data).block, block(), 'le coffre ne touche pas au bloc courant');
});

test('bail expiré (onglet fermé, appareil éteint) : une autre page reprend la main d\'elle-même', async () => {
  const { pc, phone, id } = await newPlayer('playexpire');
  const pcId = ctrl(), phoneId = ctrl();
  await phone('POST', '/api/me/play/claim', { controllerId: phoneId });
  await pc('POST', '/api/me/play/claim', { controllerId: pcId });   // le PC prend la main puis « plante »
  db.prepare('UPDATE play_controllers SET heartbeat_ms = heartbeat_ms - 60000 WHERE user_id = ?').run(id);

  let r = await phone('POST', '/api/me/play/heartbeat', { controllerId: phoneId });
  assert.strictEqual(r.body.active, false);
  assert.strictEqual(r.body.canResume, true);
  // Même expiré, l'ancien contrôleur ne peut pas écrire sans reprendre la main explicitement
  r = await phone('POST', '/api/me/save', { data: blob(), baseRevision: null, controllerId: phoneId });
  assert.strictEqual(r.status, 409);
  r = await phone('POST', '/api/me/play/claim', { controllerId: phoneId, onlyIfFree: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(lease(id).controller_id, phoneId);
  r = await phone('POST', '/api/me/save', { data: blob(), baseRevision: null, controllerId: phoneId });
  assert.strictEqual(r.status, 200);
});

test('ancien client (sans controllerId) : accepté sans contrôleur actif, refusé sinon', async () => {
  const { pc, phone, id } = await newPlayer('playlegacy');
  let r = await pc('POST', '/api/me/save', { data: blob({ coins: 7 }), baseRevision: null });
  assert.strictEqual(r.status, 200, 'aucune session de jeu : comportement inchangé');
  assert.strictEqual(lease(id), undefined);

  const phoneId = ctrl();
  await phone('POST', '/api/me/play/claim', { controllerId: phoneId });
  r = await pc('POST', '/api/me/save', { data: blob({ coins: 8 }), baseRevision: 1 });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.notController, true);
  assert.strictEqual(JSON.parse(saveRow(id).data).coins, 7);
});

test('sauvegarde avec controllerId sans session existante : la page prend la main', async () => {
  const { pc, id } = await newPlayer('playimplicit');
  const pcId = ctrl();
  const r = await pc('POST', '/api/me/save', { data: blob(), baseRevision: null, controllerId: pcId });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(lease(id).controller_id, pcId);
});

test('déconnexion : libère la main sans toucher à la sauvegarde', async () => {
  const { pc, phone, id } = await newPlayer('playlogout');
  const pcId = ctrl();
  await pc('POST', '/api/me/play/claim', { controllerId: pcId });
  await pc('POST', '/api/me/save', { data: blob({ coins: 77 }), baseRevision: null, controllerId: pcId });
  // Une autre page ne libère pas la main du PC
  await phone('POST', '/api/logout', { controllerId: ctrl() });
  assert.strictEqual(lease(id).controller_id, pcId);
  await pc('POST', '/api/logout', { controllerId: pcId });
  assert.strictEqual(lease(id), undefined);
  assert.strictEqual(JSON.parse(saveRow(id).data).coins, 77);
});

test('entrées invalides et non connecté', async () => {
  const anon = client();
  assert.strictEqual((await anon('POST', '/api/me/play/claim', { controllerId: ctrl() })).status, 401);
  assert.strictEqual((await anon('POST', '/api/me/play/heartbeat', { controllerId: ctrl() })).status, 401);
  const { pc } = await newPlayer('playinvalid');
  for (const controllerId of [undefined, '', 'court', 'x'.repeat(65), 'a b c d e f g h', 42, { a: 1 }]) {
    assert.strictEqual((await pc('POST', '/api/me/play/claim', { controllerId })).status, 400, String(controllerId));
    assert.strictEqual((await pc('POST', '/api/me/play/heartbeat', { controllerId })).status, 400);
  }
  for (const controllerId of ['', 'court', 42]) {
    assert.strictEqual((await pc('POST', '/api/me/save', { data: blob(), controllerId })).status, 400);
  }
});

test('redémarrage serveur : le bloc courant et la session de jeu sont conservés', async () => {
  const { pc, phone, id } = await newPlayer('playrestart');
  const pcId = ctrl();
  await pc('POST', '/api/me/play/claim', { controllerId: pcId });
  await pc('POST', '/api/me/save', { data: blob({ block: block({ name: 'block.emeraude', hp: 17 }) }), baseRevision: null, controllerId: pcId });
  await stopServer();
  await startServer();
  // Le PC continue avec sa page (même contrôleur) ; le téléphone reprend exactement le même bloc
  let r = await pc('POST', '/api/me/play/heartbeat', { controllerId: pcId });
  assert.strictEqual(r.body.active, true);
  r = await phone('POST', '/api/me/play/claim', { controllerId: ctrl() });
  assert.deepStrictEqual(r.body.save.data.block, block({ name: 'block.emeraude', hp: 17 }));
  assert.strictEqual(lease(id).epoch, 2);
});
