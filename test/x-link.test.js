/**
 * Compte X lié (ticket #51) : faux serveur OAuth/API X local (aucun appel extérieur), serveur
 * DIG! de test sur un port ≠ 3000, base temporaire. Récompense hebdomadaire : fonctions pures et
 * enregistrement idempotent, sans route ni crédit.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const http     = require('http');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');
const Database = require('better-sqlite3');

// Base de ce processus (enregistrement des demandes) : temporaire, fixée avant de charger db.js.
const CLAIMS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-x-claims-'));
process.env.DB_FILE = path.join(CLAIMS_DIR, 'claims.sqlite');
const db    = require('../server/db');
const xLink = require('../server/xLink');

const ROOT   = path.join(__dirname, '..');
const PORT   = process.env.DIG_TEST_PORT_X || '3181';
const XPORT  = process.env.DIG_TEST_PORT_XAPI || '3182';
const BASE   = `http://127.0.0.1:${PORT}`;
const XBASE  = `http://127.0.0.1:${XPORT}`;
const CLIENT = 'dig-x-client';
const SECRET = 'dig-x-secret';

const fetch = (url, opts = {}) => globalThis.fetch(url, { signal: AbortSignal.timeout(10000), ...opts });

// ── Faux X (autorisation, jeton, /2/users/me, révocation) ────────────────────

function fakeX() {
  const codes = new Map(), tokens = new Map();
  const f = { next: null, authorizeParams: null, revoked: [], tokenAuth: null, deny: false };
  f.server = http.createServer((req, res) => {
    const url  = new URL(req.url, XBASE);
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/i/oauth2/authorize') {
      const p = Object.fromEntries(url.searchParams);
      f.authorizeParams = p;
      if (f.deny) {
        res.writeHead(302, { Location: `${p.redirect_uri}?error=access_denied&state=${encodeURIComponent(p.state)}` });
        return res.end();
      }
      const code = crypto.randomBytes(12).toString('hex');
      codes.set(code, { ...p, user: f.next });
      res.writeHead(302, { Location: `${p.redirect_uri}?code=${code}&state=${encodeURIComponent(p.state)}` });
      return res.end();
    }
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const p = Object.fromEntries(new URLSearchParams(body));
      if (url.pathname === '/2/oauth2/token' && req.method === 'POST') {
        f.tokenAuth = req.headers.authorization;
        const c = codes.get(p.code);
        codes.delete(p.code);
        const basic = `Basic ${Buffer.from(`${CLIENT}:${SECRET}`).toString('base64')}`;
        if (!c || req.headers.authorization !== basic || p.redirect_uri !== c.redirect_uri) return json(400, { error: 'invalid_request' });
        const challenge = crypto.createHash('sha256').update(p.code_verifier || '').digest('base64url');
        if (challenge !== c.code_challenge) return json(400, { error: 'invalid_grant' });
        const token = crypto.randomBytes(16).toString('hex');
        tokens.set(token, c.user);
        return json(200, { access_token: token, token_type: 'bearer', expires_in: 7200, scope: c.scope });
      }
      if (url.pathname === '/2/users/me') {
        const user = tokens.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
        return user ? json(200, { data: user }) : json(401, { title: 'Unauthorized' });
      }
      if (url.pathname === '/2/oauth2/revoke' && req.method === 'POST') {
        tokens.delete(p.token);
        f.revoked.push(p.token);
        return json(200, { revoked: true });
      }
      json(404, { error: 'not_found' });
    });
  });
  return f;
}

let dir, xs;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-x-51-'));
  xs = fakeX();
  await new Promise(r => xs.server.listen(Number(XPORT), '127.0.0.1', r));
});
test.after(async () => {
  await new Promise(r => xs.server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(CLAIMS_DIR, { recursive: true, force: true });
});

const X_ENV = { X_LINK: 'link', X_CLIENT_ID: CLIENT, X_CLIENT_SECRET: SECRET, X_OAUTH_BASE: XBASE, X_API_BASE: XBASE, X_ORIGINS: BASE };

async function startUp({ env = {} } = {}) {
  const db = path.join(dir, `t-${Date.now()}.sqlite`);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, PORT, RATE_LIMIT: 'off', NODE_ENV: 'test',
      SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: db, PUBLIC_BASE_URL: BASE,
      SESSION_SECRET: 'test-51-x-secret-de-session-stable-et-long',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', d => { child.log += d; });
  child.stderr.on('data', d => { child.log += d; });
  child.exited = new Promise(r => child.on('exit', code => r(code)));
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

function client() {
  const c = { cookie: null };
  const keep = (r) => { const set = r.headers.get('set-cookie'); if (set) c.cookie = set.split(';')[0]; };
  c.req = async (method, url, body) => {
    const r = await fetch(`${BASE}${url}`, {
      method, headers: { 'Content-Type': 'application/json', ...(c.cookie ? { Cookie: c.cookie } : {}) },
      body: body && JSON.stringify(body),
    });
    keep(r);
    let data = null;
    try { data = await r.json(); } catch (_) {}
    return { status: r.status, data };
  };
  c.get = async (url) => {
    const ours = !url.startsWith('http') || url.startsWith(BASE);
    const r = await fetch(ours && !url.startsWith('http') ? `${BASE}${url}` : url, { redirect: 'manual', headers: ours && c.cookie ? { Cookie: c.cookie } : {} });
    if (ours) keep(r);
    return { status: r.status, location: r.headers.get('location') };
  };
  /** Parcours complet : départ → X (faux) → retour. Renvoie le résultat « xlink=… ». */
  c.linkX = async (user) => {
    xs.next = user;
    const start = await c.get('/api/x/start');
    assert.strictEqual(start.status, 302);
    if (!start.location.startsWith(XBASE)) return new URL(start.location, BASE).searchParams.get('xlink');
    const auth = await c.get(start.location);
    const back = await c.get(auth.location);
    assert.strictEqual(back.status, 302);
    c.lastCallback = auth.location;
    return new URL(back.location, BASE).searchParams.get('xlink');
  };
  return c;
}

const xUser = (n) => ({ id: `14000000000000${n}`, username: `mineur_${n}`, name: `Mineur ${n}`, created_at: '2015-03-01T10:00:00.000Z' });

async function register(c, username) {
  const r = await c.req('POST', '/api/register', { username, email: `${username}@example.test`, password: 'motdepasse1' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  return r.data.user;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('X_LINK=off (défaut) : routes 404, statut « non disponible » explicite, tables créées vides', async () => {
  const srv = await startUp();
  try {
    const c = client();
    assert.deepStrictEqual((await c.req('GET', '/api/me')).data.x, { available: false });
    await register(c, 'sansx');
    assert.deepStrictEqual((await c.req('GET', '/api/me')).data.x, { available: false });
    assert.strictEqual((await c.get('/api/x/start')).status, 404);
    assert.strictEqual((await c.get('/api/x/callback?code=a&state=b')).status, 404);
    assert.strictEqual((await c.req('POST', '/api/x/unlink')).status, 404);
    const db = new Database(srv.db, { readonly: true });
    for (const t of ['user_x_links', 'x_link_history', 'x_reward_claims']) {
      assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, t);
    }
    db.close();
  } finally { await stop(srv); }
});

test('configuration : X_CLIENT_ID requis, faux serveur refusé en production, origines par défaut', () => {
  assert.strictEqual(xLink.resolveXConfig({ X_LINK: 'link' }).enabled, false);
  assert.strictEqual(xLink.resolveXConfig({ X_LINK: 'on', X_CLIENT_ID: 'a' }).enabled, false);
  assert.strictEqual(xLink.resolveXConfig({ ...X_ENV, NODE_ENV: 'production' }).enabled, false);
  const prod = xLink.resolveXConfig({ X_LINK: 'link', NODE_ENV: 'production', X_CLIENT_ID: 'a' });
  assert.strictEqual(prod.enabled, true);
  assert.strictEqual(prod.authorizeUrl, 'https://x.com/i/oauth2/authorize');
  assert.strictEqual(prod.apiBase, 'https://api.x.com');
  assert.deepStrictEqual([...prod.origins].sort(), ['https://dig.lodygames.com', 'https://dig.lodylands.com']);
  assert.strictEqual(xLink.REWARD_ENABLED, false);
});

test('liaison : PKCE + state, jeton révoqué et jamais stocké, statut vérifié, unicité, déliaison, anti-comptes multiples, progression intacte', async () => {
  const srv = await startUp({ env: X_ENV });
  try {
    // Non connecté : aucun départ vers X.
    const anon = client();
    assert.strictEqual(await anon.linkX(xUser(1)), 'error');

    const a = client();
    const alice = await register(a, 'alice');
    const save = { coins: 4321, depth: 78 };
    assert.strictEqual((await a.req('POST', '/api/me/save', { data: save })).status, 200);
    const db = new Database(srv.db, { readonly: true });
    const before = db.prepare('SELECT data, version FROM user_saves WHERE user_id = ?').get(alice.id);

    let me = (await a.req('GET', '/api/me')).data;
    assert.deepStrictEqual(me.x, { available: true, linked: null, reward: { enabled: false } });

    assert.strictEqual(await a.linkX(xUser(1)), 'linked');
    const p = xs.authorizeParams;
    assert.strictEqual(p.response_type, 'code');
    assert.strictEqual(p.code_challenge_method, 'S256');
    assert.strictEqual(p.scope, 'users.read tweet.read');
    assert.strictEqual(p.redirect_uri, `${BASE}/api/x/callback`);
    assert.ok(p.state.length >= 43);
    me = (await a.req('GET', '/api/me')).data;
    assert.strictEqual(me.x.linked.username, 'mineur_1');
    assert.ok(!JSON.stringify(me).includes('140000000000001'), 'identifiant X non exposé');

    // Jeton révoqué, absent de la base et des sessions.
    await new Promise(r => setTimeout(r, 200));
    assert.strictEqual(xs.revoked.length, 1);
    const token = xs.revoked[0];
    const row = db.prepare('SELECT * FROM user_x_links WHERE user_id = ?').get(alice.id);
    assert.strictEqual(row.x_user_id, '140000000000001');
    assert.ok(!JSON.stringify(row).includes(token));
    for (const f of fs.readdirSync(path.join(dir, 'sessions'))) {
      assert.ok(!fs.readFileSync(path.join(dir, 'sessions', f), 'utf8').includes(token), 'jeton absent des sessions');
    }
    // Rejouer le retour (state à usage unique) : refusé.
    assert.strictEqual(new URL((await a.get(a.lastCallback)).location, BASE).searchParams.get('xlink'), 'error');
    // Déjà lié : pas de nouveau départ.
    assert.strictEqual(await a.linkX(xUser(2)), 'already');

    // Même compte X sur un autre compte DIG! : refusé.
    const b = client();
    await register(b, 'bruno');
    assert.strictEqual(await b.linkX(xUser(1)), 'taken');
    // Refus de l'utilisateur chez X.
    xs.deny = true;
    assert.strictEqual(await b.linkX(xUser(3)), 'cancelled');
    xs.deny = false;

    // Déliaison, puis le compte X libéré ne peut pas passer à bruno avant 30 jours.
    assert.strictEqual((await a.req('POST', '/api/x/unlink')).status, 200);
    assert.strictEqual((await a.req('POST', '/api/x/unlink')).status, 404);
    me = (await a.req('GET', '/api/me')).data;
    assert.strictEqual(me.x.linked, null);
    assert.strictEqual(await b.linkX(xUser(1)), 'cooldown');
    // alice ne peut pas changer de compte X avant 7 jours, mais peut reprendre le même.
    assert.strictEqual(await a.linkX(xUser(2)), 'switch');
    assert.strictEqual(await a.linkX(xUser(1)), 'linked');

    // Audit et progression.
    const events = db.prepare(`SELECT event_type, metadata FROM user_events WHERE event_type LIKE 'x_%' ORDER BY id`).all().map(e => e.event_type);
    assert.deepStrictEqual(events, ['x_linked', 'x_link_refused', 'x_unlinked', 'x_link_refused', 'x_link_refused', 'x_linked']);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM x_link_history').get().n, 2);
    assert.deepStrictEqual(db.prepare('SELECT data, version FROM user_saves WHERE user_id = ?').get(alice.id), before);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM x_reward_claims').get().n, 0);
    db.close();
  } finally { await stop(srv); }
});

test('X_LINK_USERS : seuls les comptes listés voient la liaison', async () => {
  const srv = await startUp({ env: { ...X_ENV, X_LINK_USERS: 'pilote' } });
  try {
    const c = client();
    await register(c, 'autre');
    assert.strictEqual((await c.req('GET', '/api/me')).data.x.available, false);
    assert.strictEqual(await c.linkX(xUser(5)), 'error');
    const p = client();
    await register(p, 'pilote');
    assert.strictEqual((await p.req('GET', '/api/me')).data.x.available, true);
    assert.strictEqual(await p.linkX(xUser(5)), 'linked');
  } finally { await stop(srv); }
});

test('profil X : identifiant et nom validés', () => {
  assert.throws(() => xLink.profileFromUser({ id: 'abc', username: 'ok' }));
  assert.throws(() => xLink.profileFromUser({ id: '1', username: 'nom avec espace' }));
  assert.deepStrictEqual(xLink.profileFromUser({ id: '12', username: 'Dig_Fan', created_at: 'n/a' }), { xUserId: '12', username: 'Dig_Fan', createdAt: null });
});

test('récompense (désactivée) : semaine ISO de Bruxelles et vérification d\'une publication', () => {
  assert.strictEqual(xLink.weekKey(new Date('2026-11-02T00:30:00Z')), '2026-W45');   // lundi 01:30 à Bruxelles
  assert.strictEqual(xLink.weekKey(new Date('2026-11-01T22:59:00Z')), '2026-W44');   // dimanche 23:59
  assert.strictEqual(xLink.weekKey(new Date('2026-11-01T23:00:00Z')), '2026-W45');   // lundi 00:00
  assert.strictEqual(xLink.weekKey(new Date('2027-01-01T12:00:00Z')), '2026-W53');

  const now  = new Date('2026-11-04T12:00:00Z');
  const link = { x_user_id: '99', linked_at: '2026-11-01 10:00:00' };
  const post = { id: '5001', author_id: '99', created_at: '2026-11-03T09:00:00.000Z', entities: { urls: [{ expanded_url: 'https://dig.lodygames.com/?r=1' }] } };
  assert.deepStrictEqual(xLink.evaluatePost(post, { link, now }), { ok: true });
  assert.strictEqual(xLink.evaluatePost({ ...post, author_id: '98' }, { link, now }).reason, 'author_mismatch');
  assert.strictEqual(xLink.evaluatePost({ ...post, created_at: '2026-10-28T09:00:00Z' }, { link, now }).reason, 'not_this_week');
  assert.strictEqual(xLink.evaluatePost(post, { link: { ...link, linked_at: '2026-11-03 10:00:00' }, now }).reason, 'before_link');
  assert.strictEqual(xLink.evaluatePost({ ...post, referenced_tweets: [{ type: 'retweeted', id: '1' }] }, { link, now }).reason, 'not_original');
  assert.strictEqual(xLink.evaluatePost({ ...post, entities: { urls: [{ expanded_url: 'https://dig.lodygames.com.evil.test/' }] } }, { link, now }).reason, 'no_game_link');
  assert.strictEqual(xLink.evaluatePost({ ...post, entities: {} }, { link, now }).reason, 'no_game_link');
  assert.strictEqual(xLink.evaluatePost({ ...post, created_at: '2026-11-05T09:00:00Z' }, { link, now }).reason, 'date_invalid');
});

test('récompense (désactivée) : enregistrement idempotent, une par semaine et par compte X, aucun point', () => {
  {
    db.initDb();
    xLink.init();
    xLink.init();   // idempotent
    const now = new Date('2026-11-04T12:00:00Z');
    const linkA = { x_user_id: '99' }, linkB = { x_user_id: '98' };
    assert.deepStrictEqual(xLink.recordVerifiedPost(1, linkA, '5001', now), { created: true });
    assert.strictEqual(xLink.recordVerifiedPost(1, linkA, '5001', now).created, false);   // même publication
    assert.strictEqual(xLink.recordVerifiedPost(1, linkA, '5002', now).created, false);   // 2e de la semaine
    assert.strictEqual(xLink.recordVerifiedPost(2, linkA, '5003', now).created, false);   // même compte X, autre DIG!
    assert.strictEqual(xLink.recordVerifiedPost(2, linkB, '5001', now).created, false);   // publication déjà utilisée
    assert.strictEqual(xLink.recordVerifiedPost(1, linkA, '5004', new Date('2026-11-10T12:00:00Z')).created, true);
    const rows = db.getDb().prepare('SELECT points, credited_at, status FROM x_reward_claims').all();
    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every(r => r.points === 0 && r.credited_at === null && r.status === 'verified_no_credit'));
  }
});
