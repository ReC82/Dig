/**
 * Secrets, sessions et durcissement HTTP (ticket #12).
 * Serveurs de test en NODE_ENV=production sur un port ≠ 3000, base temporaire hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const net      = require('net');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const security = require('../server/security');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_SECURITY || '3111';
const BASE = `http://127.0.0.1:${PORT}`;
const strong = () => crypto.randomBytes(32).toString('hex');

let dir;
test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-security-')); });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function start(env) {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT, DB_FILE: path.join(dir, `t-${Date.now()}.sqlite`), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', d => { child.log += d; });
  child.stderr.on('data', d => { child.log += d; });
  child.exited = new Promise(r => child.on('exit', code => r(code)));
  return child;
}

async function startUp(env) {
  const child = start(env);
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/health`); return child; } catch (_) {}
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`serveur non démarré :\n${child.log}`);
}

async function stop(child) { child.kill(); await child.exited; }

// ── Unitaires ─────────────────────────────────────────────────────────────────

test('resolveSessionSecret : refus en production si absent, publié ou trop court', () => {
  const prod = { NODE_ENV: 'production' };
  assert.throws(() => security.resolveSessionSecret(prod), /absent/);
  assert.throws(() => security.resolveSessionSecret({ ...prod, SESSION_SECRET: 'dig-dev-secret-change-in-prod' }), /publiée/);
  assert.throws(() => security.resolveSessionSecret({ ...prod, SESSION_SECRET: 'x'.repeat(31) }), /trop court/);
  const s = strong();
  assert.strictEqual(security.resolveSessionSecret({ ...prod, SESSION_SECRET: s }), s);
});

test('resolveSessionSecret : hors production, secret éphémère aléatoire (jamais la valeur publiée)', () => {
  const a = security.resolveSessionSecret({});
  const b = security.resolveSessionSecret({});
  assert.ok(a.length >= 64 && a !== b);
});

test('resolveAdminSecret / isValidBearer', () => {
  assert.strictEqual(security.resolveAdminSecret({}), null);
  assert.strictEqual(security.resolveAdminSecret({ ADMIN_SECRET: 'court' }), null);
  const s = strong();
  assert.strictEqual(security.resolveAdminSecret({ ADMIN_SECRET: s }), s);
  assert.ok(security.isValidBearer(`Bearer ${s}`, s));
  assert.ok(!security.isValidBearer(`Bearer ${s}x`, s));
  assert.ok(!security.isValidBearer(undefined, s));
  assert.ok(!security.isValidBearer(s, s));
});

test('parseTrustProxy / cookieSecure', () => {
  assert.strictEqual(security.parseTrustProxy(undefined), 'loopback');
  assert.strictEqual(security.parseTrustProxy('1'), 1);
  assert.strictEqual(security.parseTrustProxy('false'), false);
  assert.strictEqual(security.cookieSecure({ NODE_ENV: 'production' }), true);
  assert.strictEqual(security.cookieSecure({}), 'auto');
  assert.strictEqual(security.cookieSecure({ NODE_ENV: 'production', COOKIE_SECURE: 'false' }), false);
});

// ── Serveur ───────────────────────────────────────────────────────────────────

test('production sans SESSION_SECRET (ou avec la valeur publiée) : démarrage refusé', async () => {
  for (const env of [{}, { SESSION_SECRET: 'dig-dev-secret-change-in-prod' }]) {
    const child = start(env);
    const code = await child.exited;
    assert.strictEqual(code, 1, child.log);
    assert.match(child.log, /SESSION_SECRET .*démarrage refusé/);
  }
});

test('production : en-têtes, cookie Secure via nginx, HSTS, écoute sur 127.0.0.1 seulement', async () => {
  const child = await startUp({ SESSION_SECRET: strong() });
  try {
    const r = await fetch(`${BASE}/`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('x-powered-by'), null);
    assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self'/);
    assert.strictEqual(r.headers.get('strict-transport-security'), null, 'pas de HSTS en HTTP direct');

    const register = (username, headers = {}) => fetch(`${BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ username, email: `${username}@example.invalid`, password: 'secret123' }),
    });

    // Requête relayée par nginx en HTTPS : cookie Secure + HttpOnly, HSTS
    const viaNginx = await register('secu1', { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '203.0.113.7' });
    assert.strictEqual(viaNginx.status, 200);
    const cookie = viaNginx.headers.get('set-cookie');
    assert.ok(cookie, 'cookie de session attendu');
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(viaNginx.headers.get('strict-transport-security'), /max-age=\d+/);

    // La session ouverte fonctionne
    const me = await (await fetch(`${BASE}/api/me`, { headers: { Cookie: cookie.split(';')[0] } })).json();
    assert.strictEqual(me.user?.username, 'secu1');

    // HTTP en clair : aucun cookie de session émis
    const plain = await register('secu2');
    assert.strictEqual(plain.status, 200);
    assert.strictEqual(plain.headers.get('set-cookie'), null);

    // Même session re-signée avec l'ancien secret par défaut : refusée (sessions forgées impossibles)
    const sid = decodeURIComponent(cookie.split(';')[0].split('=')[1]).slice(2).split('.')[0];
    const sig = crypto.createHmac('sha256', 'dig-dev-secret-change-in-prod').update(sid).digest('base64').replace(/=+$/, '');
    const forged = await (await fetch(`${BASE}/api/me`, { headers: { Cookie: `connect.sid=${encodeURIComponent(`s:${sid}.${sig}`)}` } })).json();
    assert.strictEqual(forged.user, null);

    assert.match(child.log, /http:\/\/127\.0\.0\.1:/);
    const external = Object.values(os.networkInterfaces()).flat()
      .find(i => i && i.family === 'IPv4' && !i.internal);
    if (external) {
      const reachable = await new Promise(res => {
        const s = net.connect({ host: external.address, port: Number(PORT), timeout: 1000 });
        s.on('connect', () => { s.destroy(); res(true); });
        s.on('error', () => res(false));
        s.on('timeout', () => { s.destroy(); res(false); });
      });
      assert.strictEqual(reachable, false, `Node ne doit pas répondre sur ${external.address}`);
    }
  } finally {
    await stop(child);
  }
});

test('admin : désactivé si ADMIN_SECRET trop court, comparaison stricte sinon', async () => {
  let child = await startUp({ SESSION_SECRET: strong(), ADMIN_SECRET: 'trop-court' });
  try {
    const r = await fetch(`${BASE}/api/admin/seasons`, { headers: { Authorization: 'Bearer trop-court' } });
    assert.strictEqual(r.status, 503);
  } finally { await stop(child); }

  const admin = strong();
  child = await startUp({ SESSION_SECRET: strong(), ADMIN_SECRET: admin });
  try {
    assert.strictEqual((await fetch(`${BASE}/api/admin/seasons`, { headers: { Authorization: `Bearer ${admin}` } })).status, 200);
    assert.strictEqual((await fetch(`${BASE}/api/admin/seasons`, { headers: { Authorization: `Bearer ${admin.slice(0, -1)}` } })).status, 401);
    assert.strictEqual((await fetch(`${BASE}/api/admin/seasons`)).status, 401);
  } finally { await stop(child); }
});
