/**
 * E-mail vérifié et récupération de compte (ticket #28).
 * Serveur de test sur un port ≠ 3000, base et boîte d'envoi temporaires hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');
const bcrypt   = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_ACCOUNT || '3125';
const BASE = `http://127.0.0.1:${PORT}`;

const fetch = (url, opts = {}) => globalThis.fetch(url, { signal: AbortSignal.timeout(10000), ...opts });

let dir;
test.before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-account-')); });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Démarre un serveur ; `mail: true` = boîte d'envoi locale (MAIL_TRANSPORT=file). */
async function startUp({ mail = true, dbFile, env = {} } = {}) {
  const outbox = path.join(dir, `outbox-${Date.now()}`);
  const db     = dbFile || path.join(dir, `t-${Date.now()}.sqlite`);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, PORT, RATE_LIMIT: 'off',
      SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: db,
      PUBLIC_BASE_URL: 'https://dig.example.test',
      SESSION_SECRET: 'test-28-secret-de-session-stable-entre-redemarrages',
      ...(mail ? { MAIL_TRANSPORT: 'file', MAIL_OUTBOX_DIR: outbox } : {}),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', d => { child.log += d; });
  child.stderr.on('data', d => { child.log += d; });
  child.exited = new Promise(r => child.on('exit', code => r(code)));
  child.outbox = outbox;
  child.db = db;
  for (let i = 0; i < 100; i++) {
    try { await fetch(`${BASE}/health`); return child; } catch (_) {}
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(`serveur non démarré :\n${child.log}`);
}

async function stop(child) {
  child.kill();
  const t = setTimeout(() => child.kill('SIGKILL'), 5000);
  await child.exited;
  clearTimeout(t);
}

/** Client minimal avec cookie de session. */
function client() {
  const c = { cookie: null };
  c.req = async (method, url, body) => {
    const r = await fetch(`${BASE}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(c.cookie ? { Cookie: c.cookie } : {}) },
      body: body && JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) c.cookie = set.split(';')[0];
    let data = null;
    try { data = await r.json(); } catch (_) {}
    return { status: r.status, data };
  };
  c.post = (url, body = {}) => c.req('POST', url, body);
  c.get  = (url) => c.req('GET', url);
  return c;
}

async function registered(username, email = `${username}@example.com`, password = 'secret123') {
  const c = client();
  const r = await c.post('/api/register', { username, email, password });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  return c;
}

/** Messages de la boîte d'envoi, du plus ancien au plus récent. */
function outbox(srv) {
  if (!fs.existsSync(srv.outbox)) return [];
  return fs.readdirSync(srv.outbox).sort((a, b) => {
    const [ta, , na] = a.split(/[-.]/).map(Number);
    const [tb, , nb] = b.split(/[-.]/).map(Number);
    return ta - tb || na - nb;
  }).map(f => JSON.parse(fs.readFileSync(path.join(srv.outbox, f), 'utf8')));
}

async function waitMail(srv, n) {
  for (let i = 0; i < 50; i++) {
    const m = outbox(srv);
    if (m.length >= n) return m;
    await new Promise(r => setTimeout(r, 50));
  }
  return outbox(srv);
}

const tokenIn = (msg, param) => msg.text.match(new RegExp(`https://dig\\.example\\.test/\\?${param}=([A-Za-z0-9_-]+)`))?.[1];

test('sans configuration e-mail : fonctions e-mail indisponibles (503), le reste inchangé', async () => {
  const srv = await startUp({ mail: false });
  try {
    const c = await registered('nomail');
    const me = await c.get('/api/me');
    assert.strictEqual(me.data.mail, false);
    assert.deepStrictEqual(me.data.user, { id: me.data.user.id, username: 'nomail', email: 'nomail@example.com', emailVerified: false });
    assert.strictEqual((await c.post('/api/auth/email/send-verification')).status, 503);
    assert.strictEqual((await client().post('/api/auth/password/forgot', { identifier: 'nomail' })).status, 503);
    assert.strictEqual((await c.post('/api/me/email', { email: 'x@example.com', password: 'secret123' })).status, 503);
    // Changer de mot de passe ne demande pas d'e-mail
    assert.strictEqual((await c.post('/api/me/password', { currentPassword: 'secret123', newPassword: 'autre-mdp' })).status, 200);
    assert.strictEqual((await client().post('/api/login', { username: 'nomail', password: 'autre-mdp' })).status, 200);
  } finally { await stop(srv); }
});

test('vérification de l\'adresse : lien à usage unique, jeton haché en base, délai entre deux envois', async () => {
  const srv = await startUp();
  try {
    const c = await registered('alice');
    assert.strictEqual((await c.get('/api/me')).data.mail, true);
    assert.strictEqual((await client().post('/api/auth/email/send-verification')).status, 401);

    const r = await c.post('/api/auth/email/send-verification', { lang: 'en' });
    assert.strictEqual(r.status, 200);
    const [msg] = await waitMail(srv, 1);
    assert.strictEqual(msg.to, 'alice@example.com');
    assert.match(msg.subject, /Confirm your email/);
    const token = tokenIn(msg, 'verify');
    assert.ok(token, msg.text);

    // Seul le hachage est stocké
    const db = new Database(srv.db, { readonly: true });
    const rows = db.prepare('SELECT token_hash FROM auth_tokens').all();
    db.close();
    assert.strictEqual(rows.length, 1);
    assert.notStrictEqual(rows[0].token_hash, token);
    assert.ok(!rows[0].token_hash.includes(token));

    // Renvoi immédiat refusé
    assert.strictEqual((await c.post('/api/auth/email/send-verification')).status, 429);

    // Confirmation possible sans être connecté (lien ouvert sur un autre appareil)
    const v = await client().post('/api/auth/email/verify', { token });
    assert.strictEqual(v.status, 200);
    assert.strictEqual(v.data.email, 'alice@example.com');
    assert.strictEqual((await client().post('/api/auth/email/verify', { token })).status, 400);
    assert.strictEqual((await client().post('/api/auth/email/verify', { token: 'x'.repeat(43) })).status, 400);
    assert.strictEqual((await c.get('/api/me')).data.user.emailVerified, true);
    assert.deepStrictEqual((await c.post('/api/auth/email/send-verification')).data, { ok: true, alreadyVerified: true });
  } finally { await stop(srv); }
});

test('mot de passe oublié : réponse identique, lien unique, autres sessions fermées, lien expiré refusé', async () => {
  const srv = await startUp();
  try {
    const other = await registered('bob');            // session existante sur un autre appareil
    const before = await other.get('/api/me');
    assert.strictEqual(before.data.user.username, 'bob');

    const known   = await client().post('/api/auth/password/forgot', { identifier: 'BOB@example.com', lang: 'nl' });
    const unknown = await client().post('/api/auth/password/forgot', { identifier: 'personne@example.com' });
    const byName  = await client().post('/api/auth/password/forgot', { identifier: 'inconnu' });
    assert.deepStrictEqual([known.status, known.data], [200, { ok: true }]);
    assert.deepStrictEqual([unknown.status, unknown.data], [200, { ok: true }]);
    assert.deepStrictEqual([byName.status, byName.data], [200, { ok: true }]);
    const mails = await waitMail(srv, 1);
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(outbox(srv).length, 1, 'un seul e-mail (compte existant)');
    assert.strictEqual(mails[0].to, 'bob@example.com');
    assert.match(mails[0].subject, /Wachtwoord/);
    const token = tokenIn(mails[0], 'reset');

    // Nouveau mot de passe trop court : refusé sans consommer le lien
    assert.strictEqual((await client().post('/api/auth/password/reset', { token, password: '123' })).status, 400);

    const fresh = client();
    const r = await fresh.post('/api/auth/password/reset', { token, password: 'nouveau-mdp' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.data));
    assert.strictEqual(r.data.user.username, 'bob');
    assert.strictEqual((await fresh.get('/api/me')).data.user.username, 'bob', 'ce navigateur est connecté');
    assert.strictEqual((await fresh.get('/api/me')).data.user.emailVerified, true, 'le lien prouve l\'adresse');
    assert.strictEqual((await other.get('/api/me')).data.user, null, 'l\'autre appareil est déconnecté');
    assert.strictEqual((await other.get('/api/me/save')).status, 401);

    assert.strictEqual((await client().post('/api/auth/password/reset', { token, password: 'encore-un' })).status, 400, 'usage unique');
    assert.strictEqual((await client().post('/api/login', { username: 'bob', password: 'secret123' })).status, 401);
    assert.strictEqual((await client().post('/api/login', { username: 'bob', password: 'nouveau-mdp' })).status, 200);

    // Lien expiré
    await new Promise(r => setTimeout(r, 1100));
    await client().post('/api/auth/password/forgot', { identifier: 'bob' });
    // Délai entre deux envois : la 2e demande (dans la minute) ne part pas
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(outbox(srv).length, 1);
    const db = new Database(srv.db);
    db.prepare(`UPDATE auth_tokens SET created_at = datetime('now', '-5 minutes')`).run();
    db.close();
    await client().post('/api/auth/password/forgot', { identifier: 'bob' });
    const all = await waitMail(srv, 2);
    const token2 = tokenIn(all[1], 'reset');
    const db2 = new Database(srv.db);
    db2.prepare(`UPDATE auth_tokens SET expires_at = datetime('now', '-1 minute') WHERE used_at IS NULL`).run();
    db2.close();
    assert.strictEqual((await client().post('/api/auth/password/reset', { token: token2, password: 'expire-mdp' })).status, 400);
  } finally { await stop(srv); }
});

test('changement de mot de passe et d\'adresse : mot de passe exigé, adresse remplacée après confirmation', async () => {
  const srv = await startUp();
  try {
    const a  = await registered('carol');
    const a2 = client();
    assert.strictEqual((await a2.post('/api/login', { username: 'carol', password: 'secret123' })).status, 200);
    await registered('dave');

    // Mot de passe : actuel exigé ; ce navigateur reste connecté, l'autre non
    assert.strictEqual((await a.post('/api/me/password', { currentPassword: 'faux-mdp', newPassword: 'nouveau-1' })).status, 403);
    assert.strictEqual((await a.post('/api/me/password', { currentPassword: 'secret123', newPassword: 'x' })).status, 400);
    assert.strictEqual((await a.post('/api/me/password', { currentPassword: 'secret123', newPassword: 'nouveau-1' })).status, 200);
    assert.strictEqual((await a.get('/api/me')).data.user.username, 'carol');
    assert.strictEqual((await a2.get('/api/me')).data.user, null);

    // Adresse : mot de passe exigé, adresse d'un autre compte refusée
    assert.strictEqual((await a.post('/api/me/email', { email: 'carol2@example.com', password: 'secret123' })).status, 403);
    assert.strictEqual((await a.post('/api/me/email', { email: 'dave@example.com', password: 'nouveau-1' })).status, 409);
    assert.strictEqual((await a.post('/api/me/email', { email: 'pas-une-adresse', password: 'nouveau-1' })).status, 400);
    const r = await a.post('/api/me/email', { email: 'Carol2@Example.com', password: 'nouveau-1' });
    assert.deepStrictEqual(r.data, { ok: true, pending: 'carol2@example.com' });
    assert.strictEqual((await a.get('/api/me')).data.user.email, 'carol@example.com', 'inchangée avant confirmation');

    const [msg] = await waitMail(srv, 1);
    assert.strictEqual(msg.to, 'carol2@example.com');
    const v = await client().post('/api/auth/email/verify', { token: tokenIn(msg, 'verify') });
    assert.strictEqual(v.status, 200);
    const me = (await a.get('/api/me')).data.user;
    assert.strictEqual(me.email, 'carol2@example.com');
    assert.strictEqual(me.emailVerified, true);

    // L'ancienne adresse est prévenue
    const mails = await waitMail(srv, 2);
    assert.strictEqual(mails[1].to, 'carol@example.com');
    assert.match(mails[1].text, /carol2@example\.com/);

    // L'ancienne adresse ne sert plus à récupérer le compte, la nouvelle oui
    await client().post('/api/auth/password/forgot', { identifier: 'carol@example.com' });
    await client().post('/api/auth/password/forgot', { identifier: 'carol2@example.com' });
    const m3 = await waitMail(srv, 3);
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(outbox(srv).length, 3);
    assert.strictEqual(m3[2].to, 'carol2@example.com');
  } finally { await stop(srv); }
});

test('migration : base d\'avant #28 — comptes, sessions et identifiants conservés, migration idempotente', async () => {
  // Base au schéma d'avant #28 (users sans email_verified_at / auth_version)
  const dbFile = path.join(dir, 'pre28.sqlite');
  const old = new Database(dbFile);
  old.exec(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, email TEXT UNIQUE,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  old.prepare('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)')
    .run('ancien', 'ancien@example.com', bcrypt.hashSync('ancien-mdp', 4));
  old.close();

  let srv = await startUp({ dbFile });
  try {
    const c = client();
    assert.strictEqual((await c.post('/api/login', { username: 'ancien', password: 'ancien-mdp' })).status, 200);
    const me = (await c.get('/api/me')).data.user;
    assert.deepStrictEqual({ ...me, id: 0 }, { id: 0, username: 'ancien', email: 'ancien@example.com', emailVerified: false });

    // Session ouverte avant #28 (sans authVersion) : toujours valable
    const sessDir = path.join(dir, 'sessions');
    for (const f of fs.readdirSync(sessDir)) {
      const p = path.join(sessDir, f);
      const s = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (s.userId === me.id) { delete s.authVersion; fs.writeFileSync(p, JSON.stringify(s)); }
    }
    await stop(srv);
    srv = await startUp({ dbFile });           // 2e démarrage : migration rejouée sans effet
    assert.strictEqual((await c.get('/api/me')).data.user?.username, 'ancien');

    const db = new Database(dbFile, { readonly: true });
    const cols = db.prepare('PRAGMA table_info(users)').all().map(r => r.name);
    const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    db.close();
    assert.ok(cols.includes('email_verified_at') && cols.includes('auth_version'));
    assert.strictEqual(n, 1);
  } finally { await stop(srv); }
});

test('mailer : refus du mode « file » en production, liens jamais déduits de l\'en-tête Host', () => {
  const { createMailer, resolvePublicBaseUrl } = require('../server/mailer');
  assert.strictEqual(createMailer({ NODE_ENV: 'production', MAIL_TRANSPORT: 'file', MAIL_OUTBOX_DIR: dir }).enabled, false);
  assert.strictEqual(createMailer({}).enabled, false);
  assert.strictEqual(createMailer({ SMTP_HOST: 'smtp.example.test' }).enabled, false, 'MAIL_FROM obligatoire');
  const smtp = createMailer({ SMTP_HOST: 'smtp.example.test', MAIL_FROM: 'DIG! <dig@example.test>' });
  assert.strictEqual(smtp.enabled, true);
  assert.strictEqual(smtp.mode, 'smtp');
  assert.strictEqual(resolvePublicBaseUrl({ NODE_ENV: 'production' }), 'https://dig.lodygames.com');
  assert.strictEqual(resolvePublicBaseUrl({ PUBLIC_BASE_URL: 'https://dig.lodylands.com/' }), 'https://dig.lodylands.com');
});
