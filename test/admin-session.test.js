/**
 * Session du panel admin (#57, recette du 03/11/2026) : la clé ouvre une session à durée limitée
 * (cookie HttpOnly/Secure/SameSite=Strict), qui survit au rechargement, se révoque, et ne conserve
 * jamais la clé. Serveur de test en NODE_ENV=production, port ≠ 3000, base temporaire.
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

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_ADMIN_SESSION || '3191';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(32).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-admin-session-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db = require('../server/db');
const adminSession = require('../server/adminSession');

db.initDb();

// ── Module ────────────────────────────────────────────────────────────────────

test('module : jeton aléatoire, seule son empreinte est stockée', () => {
  const fp = adminSession.secretFingerprint(ADMIN, 'session-secret');
  const { token, expiresAt } = adminSession.create(fp, 1_000_000);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(expiresAt, 1_000_000 + adminSession.MAX_AGE_MS);
  const rows = db.getDb().prepare('SELECT * FROM admin_sessions').all();
  const dump = JSON.stringify(rows);
  assert.ok(!dump.includes(token) && !dump.includes(ADMIN), 'ni le jeton ni la clé en base');
  assert.ok(adminSession.check(token, fp, 1_000_000 + 1000));
  assert.strictEqual(adminSession.check(token + 'x', fp, 1_000_000), null);
  assert.strictEqual(adminSession.check(token, adminSession.secretFingerprint('autre-cle', 'session-secret'), 1_000_000), null, 'clé changée : session refusée');
});

test('module : inactivité, durée maximale, révocation', () => {
  const fp = adminSession.secretFingerprint(ADMIN, 's');
  const t0 = 50_000_000;
  const a = adminSession.create(fp, t0);
  assert.strictEqual(adminSession.check(a.token, fp, t0 + adminSession.IDLE_MS), null, '2 h sans activité');

  const b = adminSession.create(fp, t0);
  let now = t0;
  for (; now < t0 + adminSession.MAX_AGE_MS - 3600_000; now += 3600_000) assert.ok(adminSession.check(b.token, fp, now), 'activité régulière');
  assert.strictEqual(adminSession.check(b.token, fp, t0 + adminSession.MAX_AGE_MS), null, '12 h au plus, même actif');

  const c = adminSession.create(fp, t0);
  assert.strictEqual(adminSession.revoke(c.token, t0 + 1), 1);
  assert.strictEqual(adminSession.check(c.token, fp, t0 + 2), null);
  const d = adminSession.create(fp, t0);
  assert.ok(adminSession.revokeAll(t0 + 1) >= 1);
  assert.strictEqual(adminSession.check(d.token, fp, t0 + 2), null);
});

// ── HTTP ──────────────────────────────────────────────────────────────────────

let child;
test.before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, NODE_ENV: 'production', PORT, SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_SECRET: ADMIN, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', d => { child.log += d; });
  child.stderr.on('data', d => { child.log += d; });
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/health`); return; } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`serveur non démarré :\n${child.log}`);
});
test.after(async () => {
  if (child) { child.kill(); await new Promise(r => child.on('exit', r)); }
  fs.rmSync(dir, { recursive: true, force: true });
});

const login = key => fetch(`${BASE}/api/admin/session`, { method: 'POST', headers: { Authorization: `Bearer ${key}` } });
const cookieOf = res => (res.headers.get('set-cookie') || '').split(';')[0];
const withSession = (cookie, extra = {}) => ({ headers: { Cookie: cookie, 'X-Dig-Admin': '1', 'Content-Type': 'application/json', ...extra } });

test('HTTP : la clé ouvre une session ; cookie HttpOnly, Secure, SameSite=Strict, limité à /api/admin', async () => {
  assert.strictEqual((await login('mauvaise-cle')).status, 401);
  const res = await login(ADMIN);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  const raw = res.headers.get('set-cookie');
  assert.match(raw, /^dig_admin=[A-Za-z0-9_-]{43};/);
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /Secure/);
  assert.match(raw, /SameSite=Strict/);
  assert.match(raw, /Path=\/api\/admin/);
  assert.match(raw, /Max-Age=43200/);
  assert.ok(!raw.includes(ADMIN), 'la clé n’est pas dans le cookie');
  const body = await res.json();
  assert.ok(!JSON.stringify(body).includes(ADMIN));
  assert.strictEqual(body.idleMinutes, 120);
});

test('HTTP : rechargement (F5) — la session suffit, sans la clé ; en-tête X-Dig-Admin exigé', async () => {
  const cookie = cookieOf(await login(ADMIN));
  const s = await fetch(`${BASE}/api/admin/session`, withSession(cookie));
  assert.strictEqual(s.status, 200);
  assert.strictEqual((await s.json()).via, 'session');
  const beta = await fetch(`${BASE}/api/admin/beta`, withSession(cookie));
  assert.strictEqual(beta.status, 200);
  assert.strictEqual(beta.headers.get('cache-control'), 'no-store', 'données admin jamais mises en cache');
  // Sans l'en-tête du panel (requête d'un autre site) : refusé, même avec le cookie.
  assert.strictEqual((await fetch(`${BASE}/api/admin/beta`, { headers: { Cookie: cookie } })).status, 401);
  assert.strictEqual((await fetch(`${BASE}/api/admin/beta/invites`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  // Écriture avec la session : acceptée et tracée dans le journal d'audit.
  const w = await fetch(`${BASE}/api/admin/beta/invites`, { method: 'POST', ...withSession(cookie), body: JSON.stringify({ label: 'test' }) });
  assert.strictEqual(w.status, 200);
  // Un cookie inventé ou un Bearer faux : refusés.
  assert.strictEqual((await fetch(`${BASE}/api/admin/beta`, withSession('dig_admin=' + 'A'.repeat(43)))).status, 401);
  assert.strictEqual((await fetch(`${BASE}/api/admin/beta`, withSession(cookie, { Authorization: 'Bearer faux' }))).status, 401, 'un Bearer faux n’est pas rattrapé par le cookie');
  // La clé en en-tête reste valable (scripts, tests).
  assert.strictEqual((await fetch(`${BASE}/api/admin/beta`, { headers: { Authorization: `Bearer ${ADMIN}` } })).status, 200);
});

test('HTTP : déconnexion = session révoquée côté serveur (le cookie copié ne sert plus)', async () => {
  const cookie = cookieOf(await login(ADMIN));
  const out = await fetch(`${BASE}/api/admin/session`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.strictEqual(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /dig_admin=;.*Expires=Thu, 01 Jan 1970/);
  assert.strictEqual((await fetch(`${BASE}/api/admin/session`, withSession(cookie))).status, 401);
  assert.strictEqual((await fetch(`${BASE}/api/admin/beta`, withSession(cookie))).status, 401);
});

test('HTTP : « Déconnecter partout » ferme toutes les sessions admin', async () => {
  const a = cookieOf(await login(ADMIN));
  const b = cookieOf(await login(ADMIN));
  const r = await fetch(`${BASE}/api/admin/session/revoke-all`, { method: 'POST', ...withSession(a) });
  assert.strictEqual(r.status, 200);
  assert.ok((await r.json()).revoked >= 2);
  for (const c of [a, b]) assert.strictEqual((await fetch(`${BASE}/api/admin/beta`, withSession(c))).status, 401);
  // Journal : connexions et actions tracées, jamais la clé ni le jeton.
  const ev = await fetch(`${BASE}/api/admin/security/events?limit=100`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  assert.strictEqual(ev.status, 200);
  const txt = await ev.text();
  assert.ok(txt.includes('admin_login') && /via\\?":\\?"session/.test(txt), `connexion et action par session tracées : ${txt.slice(0, 400)}`);
  assert.ok(!txt.includes(ADMIN) && !txt.includes(a.slice('dig_admin='.length)), 'ni clé ni jeton dans le journal');
});

test('panel : la clé n’est jamais conservée côté navigateur', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/localStorage|sessionStorage/.test(js), 'aucun stockage navigateur dans le panel');
  assert.ok(!/_secret\b/.test(js), 'plus de variable gardant la clé');
  const apiFn = js.slice(js.indexOf('async function api('), js.indexOf('function adminShowApp'));
  assert.ok(!/Authorization/.test(apiFn), 'les requêtes du panel passent par la session, pas par la clé');
  assert.match(js, /input\.value = '';\s+\/\/ la clé n'est conservée nulle part/);
});
