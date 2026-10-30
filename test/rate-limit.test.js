/**
 * Limitation de débit et suppression de l'API legacy (ticket #14).
 * Serveur de test sur un port ≠ 3000, base temporaire hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_RATE || '3112';
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = '3f2b8c1e-6d4a-4b7e-9a1c-2e5f7d8b9c0a';

let dir;
test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-rate-')); });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

async function startUp(env = {}) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, `t-${Date.now()}.sqlite`), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', d => { child.log += d; });
  child.stderr.on('data', d => { child.log += d; });
  child.exited = new Promise(r => child.on('exit', code => r(code)));
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/health`); return child; } catch (_) {}
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`serveur non démarré :\n${child.log}`);
}

async function stop(child) { child.kill(); await child.exited; }

const post = (url, body, headers = {}) => fetch(`${BASE}${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

async function register(username, email = `${username}@example.com`) {
  const r = await post('/api/register', { username, email, password: 'secret123' });
  return { r, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

test('API legacy /api/players/:token/* : 404 JSON pour toutes les méthodes, aucune écriture', async () => {
  const srv = await startUp();
  try {
    const calls = [
      ['POST',   '/api/players/register',        { token: TOKEN }],
      ['GET',    `/api/players/${TOKEN}/save`],
      ['POST',   `/api/players/${TOKEN}/save`,   { data: { coins: 1 } }],
      ['DELETE', `/api/players/${TOKEN}/save`],
      ['GET',    '/api/route-inexistante'],
    ];
    for (const [method, url, body] of calls) {
      const r = await fetch(`${BASE}${url}`, {
        method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
      });
      assert.strictEqual(r.status, 404, `${method} ${url}`);
      assert.match(r.headers.get('content-type'), /application\/json/);
    }
    // Les routes encore utilisées répondent toujours
    assert.strictEqual((await fetch(`${BASE}/api/version`)).status, 200);
    assert.strictEqual((await fetch(`${BASE}/api/me`)).status, 200);
  } finally { await stop(srv); }

  // La table players est restée vide (aucune requête n'a atteint la base)
  const Database = require('better-sqlite3');
  const file = fs.readdirSync(dir).find(f => f.endsWith('.sqlite'));
  const db = new Database(path.join(dir, file), { readonly: true });
  try { assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM players').get().n, 0); }
  finally { db.close(); }
});

test('connexion : 429 après RATE_LOGIN_MAX échecs par minute et par IP ; les succès ne comptent pas', async () => {
  const srv = await startUp({ RATE_LOGIN_MAX: '3' });
  try {
    assert.strictEqual((await register('alice')).r.status, 200);

    // Connexions réussies répétées : jamais limitées. Le décompte d'un succès n'est retiré
    // qu'à l'événement « finish » côté serveur, qui peut suivre la réception de la réponse :
    // on lit le corps puis on laisse ce retrait se faire, sinon le test échoue au hasard (#17).
    for (let i = 0; i < 5; i++) {
      const ok = await post('/api/login', { username: 'alice', password: 'secret123' });
      assert.strictEqual(ok.status, 200);
      await ok.text();
      await new Promise(r => setTimeout(r, 100));
    }
    // Le décompte d'un succès est retiré à la fin de l'envoi de la réponse (événement
    // « finish ») : on laisse ce retrait se faire avant d'enchaîner les échecs.
    await new Promise(r => setTimeout(r, 100));
    // 3 échecs autorisés, le 4e est refusé
    for (let i = 0; i < 3; i++) {
      assert.strictEqual((await post('/api/login', { username: 'alice', password: 'mauvais' })).status, 401);
    }
    const r = await post('/api/login', { username: 'alice', password: 'mauvais' });
    assert.strictEqual(r.status, 429);
    const retry = Number(r.headers.get('retry-after'));
    assert.ok(retry >= 1 && retry <= 60, `Retry-After=${retry}`);
    const body = await r.json();
    assert.match(body.error, /Trop de tentatives/);
    assert.ok(r.headers.get('ratelimit'), 'en-tête RateLimit présent');

    // Bloqué aussi avec le bon mot de passe (l'attaquant ne peut pas « tester » pendant le blocage)
    assert.strictEqual((await post('/api/login', { username: 'alice', password: 'secret123' })).status, 429);

    // Une autre IP (relayée par nginx local, trust proxy loopback) n'est pas affectée
    const other = await post('/api/login', { username: 'alice', password: 'secret123' }, { 'X-Forwarded-For': '203.0.113.7' });
    assert.strictEqual(other.status, 200);
  } finally { await stop(srv); }
});

test('inscription : 429 après RATE_REGISTER_MAX tentatives ; message neutre pour nom ou e-mail déjà pris', async () => {
  const srv = await startUp({ RATE_REGISTER_MAX: '4' });
  try {
    assert.strictEqual((await register('bob', 'bob@example.com')).r.status, 200);
    const dupName  = await register('bob', 'autre@example.com');
    const dupEmail = await register('bobby', 'bob@example.com');
    assert.strictEqual(dupName.r.status, 409);
    assert.strictEqual(dupEmail.r.status, 409);
    assert.deepStrictEqual(await dupName.r.json(), await dupEmail.r.json(), 'même réponse : l\'e-mail n\'est pas révélé');

    assert.strictEqual((await register('carol')).r.status, 200);   // 4e tentative
    assert.strictEqual((await register('dave')).r.status, 429);    // 5e : bloquée
  } finally { await stop(srv); }
});

test('sauvegarde cloud : 429 au-delà de RATE_SAVE_MAX par compte, sans gêner un autre compte de la même IP', async () => {
  const srv = await startUp({ RATE_SAVE_MAX: '3' });
  try {
    const a = await register('erin');
    const b = await register('frank');
    const save = (cookie) => post('/api/me/save', { data: { coins: 1 } }, { Cookie: cookie });

    for (let i = 0; i < 3; i++) assert.strictEqual((await save(a.cookie)).status, 200);
    const limited = await save(a.cookie);
    assert.strictEqual(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);

    // Même IP, autre compte : compteur séparé
    assert.strictEqual((await save(b.cookie)).status, 200);
    // Lecture de la sauvegarde non limitée
    const g = await fetch(`${BASE}/api/me/save`, { headers: { Cookie: a.cookie } });
    assert.strictEqual(g.status, 200);
  } finally { await stop(srv); }
});

test('valeurs par défaut : 10 échecs de connexion par minute, puis 429', async () => {
  const srv = await startUp();
  try {
    for (let i = 0; i < 10; i++) {
      assert.strictEqual((await post('/api/login', { username: 'nobody', password: 'mauvais' })).status, 401);
    }
    assert.strictEqual((await post('/api/login', { username: 'nobody', password: 'mauvais' })).status, 429);
  } finally { await stop(srv); }
});
