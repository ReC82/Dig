/**
 * Connexion Google via Auth0 (ticket #28) : faux émetteur OIDC local (clé RSA générée au
 * lancement, aucun appel extérieur), serveur DIG! de test sur un port ≠ 3000, base temporaire.
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

const { resolveSocialConfig, createOidcClient } = require('../server/socialAuth');

const ROOT     = path.join(__dirname, '..');
const PORT     = process.env.DIG_TEST_PORT_SOCIAL || '3132';
const OIDC     = process.env.DIG_TEST_PORT_OIDC || '3133';
const BASE     = `http://127.0.0.1:${PORT}`;
const ISSUER   = `http://127.0.0.1:${OIDC}/`;
const CLIENT   = 'dig-test-client';
const SECRET   = 'dig-test-client-secret';

const fetch = (url, opts = {}) => globalThis.fetch(url, { signal: AbortSignal.timeout(10000), ...opts });

// ── Faux émetteur OIDC ───────────────────────────────────────────────────────

function fakeIssuer() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const jwk   = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const codes = new Map();
  const f = {
    next: null,            // identité renvoyée au prochain /authorize : { sub, email, email_verified }
    tamper: null,          // (claims, header) => modifie le jeton ; 'badsig' = signé par une autre clé
    authorizeParams: null,
  };
  const sign = (claims, key = privateKey, header = { alg: 'RS256', typ: 'JWT', kid: 'k1' }) => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${enc(header)}.${enc(claims)}`;
    return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), key).toString('base64url')}`;
  };
  f.server = http.createServer((req, res) => {
    const url = new URL(req.url, ISSUER);
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer: ISSUER, authorization_endpoint: `${ISSUER}authorize`,
        token_endpoint: `${ISSUER}oauth/token`, jwks_uri: `${ISSUER}.well-known/jwks.json`,
      });
    }
    if (url.pathname === '/.well-known/jwks.json') return json(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const p = Object.fromEntries(url.searchParams);
      f.authorizeParams = p;
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { ...p, identity: f.next, tamper: f.tamper });
      res.writeHead(302, { Location: `${p.redirect_uri}?code=${code}&state=${encodeURIComponent(p.state)}` });
      return res.end();
    }
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        const p = Object.fromEntries(new URLSearchParams(body));
        const c = codes.get(p.code);
        codes.delete(p.code);
        if (!c || p.client_id !== CLIENT || p.client_secret !== SECRET || p.redirect_uri !== c.redirect_uri) return json(400, { error: 'invalid_grant' });
        const challenge = crypto.createHash('sha256').update(p.code_verifier || '').digest('base64url');
        if (challenge !== c.code_challenge) return json(400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000);
        let claims = { iss: ISSUER, aud: CLIENT, iat: now, exp: now + 3600, nonce: c.nonce, ...c.identity };
        let header, key;
        if (typeof c.tamper === 'function') ({ claims = claims, header, key } = c.tamper(claims) || {});
        if (c.tamper === 'badsig') key = other;
        json(200, { id_token: sign(claims, key, header), access_token: 'x', token_type: 'Bearer' });
      });
      return;
    }
    json(404, { error: 'not_found' });
  });
  return f;
}

// ── Serveur DIG! et client ───────────────────────────────────────────────────

let dir, issuer;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-social-'));
  issuer = fakeIssuer();
  await new Promise(r => issuer.server.listen(Number(OIDC), '127.0.0.1', r));
});
test.after(async () => {
  await new Promise(r => issuer.server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const SOCIAL_ENV = {
  SOCIAL_LOGIN: 'link', OIDC_ISSUER: ISSUER, AUTH0_CLIENT_ID: CLIENT, AUTH0_CLIENT_SECRET: SECRET,
  SOCIAL_ORIGINS: BASE,
};

async function startUp({ env = {}, dbFile } = {}) {
  const db = dbFile || path.join(dir, `t-${Date.now()}.sqlite`);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, PORT, RATE_LIMIT: 'off',
      SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: db,
      PUBLIC_BASE_URL: BASE,
      SESSION_SECRET: 'test-28-social-secret-de-session-stable',
      MAIL_TRANSPORT: 'file', MAIL_OUTBOX_DIR: path.join(dir, 'outbox'),
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
      method,
      headers: { 'Content-Type': 'application/json', ...(c.cookie ? { Cookie: c.cookie } : {}) },
      body: body && JSON.stringify(body),
    });
    keep(r);
    let data = null;
    try { data = await r.json(); } catch (_) {}
    return { status: r.status, data };
  };
  /** GET sans suivre la redirection : { status, location }. */
  c.get = async (url) => {
    const r = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, {
      redirect: 'manual', headers: c.cookie && url.startsWith(BASE) || !url.startsWith('http') ? { Cookie: c.cookie || '' } : {},
    });
    if (url.startsWith(BASE) || !url.startsWith('http')) keep(r);
    return { status: r.status, location: r.headers.get('location') };
  };
  /** Parcours complet : départ → Auth0 (faux) → retour. Renvoie le résultat « social=… ». */
  c.google = async (intent = 'login', { identity, tamper = null, replay = false } = {}) => {
    issuer.next = identity;
    issuer.tamper = tamper;
    const start = await c.get(`/api/auth/social/start?intent=${intent}`);
    assert.strictEqual(start.status, 302);
    if (!start.location.startsWith(ISSUER)) return new URL(start.location, BASE).searchParams.get('social');
    const auth = await c.get(start.location);
    assert.strictEqual(auth.status, 302);
    const back = await c.get(auth.location);
    assert.strictEqual(back.status, 302);
    const result = new URL(back.location, BASE).searchParams.get('social');
    if (replay) return { result, again: new URL((await c.get(auth.location)).location, BASE).searchParams.get('social') };
    return result;
  };
  return c;
}

const google = (n, extra = {}) => ({ sub: `google-oauth2|10000000000000000${n}`, email: `joueur${n}@gmail.com`, email_verified: true, ...extra });

async function register(c, username, email = `${username}@example.test`) {
  const r = await c.req('POST', '/api/register', { username, email, password: 'motdepasse1' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.data));
  return r.data.user;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('SOCIAL_LOGIN=off (défaut) : aucune route, aucun champ social, connexion classique intacte', async () => {
  const srv = await startUp();
  try {
    const c = client();
    assert.strictEqual((await c.req('GET', '/api/me')).data.social, null);
    assert.strictEqual((await c.get('/api/auth/social/start?intent=login')).status, 404);
    assert.strictEqual((await c.get('/api/auth/social/callback?code=x&state=y')).status, 404);
    for (const p of ['link/prepare', 'pending/link', 'pending/cancel', 'unlink']) {
      assert.strictEqual((await c.req('POST', `/api/auth/social/${p}`, {})).status, 404, p);
    }
    await register(c, 'classique');
    await c.req('POST', '/api/logout');
    const login = await c.req('POST', '/api/login', { username: 'classique', password: 'motdepasse1' });
    assert.strictEqual(login.status, 200);
    assert.strictEqual(login.data.socialPending, undefined);
    assert.ok(!srv.log.includes('[social] connexion Google : mode'));
  } finally { await stop(srv); }
});

test('configuration : incomplète = désactivée ; OIDC_ISSUER refusé en production ; origines par défaut', () => {
  assert.strictEqual(resolveSocialConfig({ SOCIAL_LOGIN: 'link' }).enabled, false);
  assert.strictEqual(resolveSocialConfig({ SOCIAL_LOGIN: 'on', AUTH0_DOMAIN: 'x.eu.auth0.com', AUTH0_CLIENT_ID: 'a', AUTH0_CLIENT_SECRET: 'b' }).enabled, false);
  assert.strictEqual(resolveSocialConfig({ ...SOCIAL_ENV, NODE_ENV: 'production' }).enabled, false);
  const prod = resolveSocialConfig({ SOCIAL_LOGIN: 'link', NODE_ENV: 'production', AUTH0_DOMAIN: 'https://dig.eu.auth0.com/', AUTH0_CLIENT_ID: 'a', AUTH0_CLIENT_SECRET: 'b' });
  assert.strictEqual(prod.enabled, true);
  assert.strictEqual(prod.issuer, 'https://dig.eu.auth0.com/');
  assert.deepStrictEqual([...prod.origins].sort(), ['https://dig.lodygames.com', 'https://dig.lodylands.com']);
  assert.strictEqual(prod.connection, 'google-oauth2');
});

test('liaison : identité inconnue en attente, jamais liée sur la seule adresse ; liée après mot de passe + confirmation ; progression identique', async () => {
  const srv = await startUp({ env: SOCIAL_ENV });
  try {
    const owner = client();
    const user = await register(owner, 'alice', 'joueur1@gmail.com');   // même adresse que le compte Google
    const save = { coins: 1234, depth: 56, note: 'progression de test' };
    assert.strictEqual((await owner.req('POST', '/api/me/save', { data: save })).status, 200);
    const db = new Database(srv.db, { readonly: true });
    const saveBefore = db.prepare('SELECT data, version FROM user_saves WHERE user_id = ?').get(user.id);
    await owner.req('POST', '/api/logout');

    // Paramètres d'autorisation : code + PKCE S256, state/nonce, connexion Google.
    const c = client();
    assert.strictEqual(await c.google('login', { identity: google(1) }), 'pending');
    const p = issuer.authorizeParams;
    assert.strictEqual(p.response_type, 'code');
    assert.strictEqual(p.code_challenge_method, 'S256');
    assert.strictEqual(p.connection, 'google-oauth2');
    assert.strictEqual(p.redirect_uri, `${BASE}/api/auth/social/callback`);
    assert.ok(p.state.length >= 43 && p.nonce.length >= 43 && p.state !== p.nonce);

    // Adresse identique : AUCUNE connexion ni liaison automatique.
    let me = (await c.req('GET', '/api/me')).data;
    assert.strictEqual(me.user, null);
    assert.deepStrictEqual(me.social.pending, { provider: 'google' });
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM user_identities').get().n, 0);
    // Sans connexion par mot de passe, la liaison est refusée.
    assert.strictEqual((await c.req('POST', '/api/auth/social/pending/link')).status, 401);

    // Preuve DIG! (mot de passe) dans la même session, puis confirmation explicite.
    const login = await c.req('POST', '/api/login', { username: 'alice', password: 'motdepasse1' });
    assert.deepStrictEqual(login.data.socialPending, { provider: 'google', email: 'joueur1@gmail.com' });
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM user_identities').get().n, 0);
    me = (await c.req('GET', '/api/me')).data;
    assert.deepStrictEqual(me.social.pending, { provider: 'google', email: 'joueur1@gmail.com' });
    const linked = await c.req('POST', '/api/auth/social/pending/link', {});
    assert.strictEqual(linked.status, 200, JSON.stringify(linked.data));
    me = (await c.req('GET', '/api/me')).data;
    assert.strictEqual(me.social.identities.length, 1);
    assert.strictEqual(me.social.identities[0].email, 'joueur1@gmail.com');
    assert.strictEqual(me.social.pending, undefined);
    // Google dit l'adresse vérifiée et c'est celle du compte : l'adresse DIG! devient vérifiée.
    assert.strictEqual(me.user.emailVerified, true);
    // Une seule utilisation de l'identité en attente.
    assert.strictEqual((await c.req('POST', '/api/auth/social/pending/link', {})).status, 400);

    // Connexion par Google sur un autre navigateur : même compte, progression intacte.
    await c.req('POST', '/api/logout');
    const d = client();
    assert.strictEqual(await d.google('login', { identity: google(1) }), 'ok');
    me = (await d.req('GET', '/api/me')).data;
    assert.strictEqual(me.user.id, user.id);
    const saveAfter = db.prepare('SELECT data, version FROM user_saves WHERE user_id = ?').get(user.id);
    assert.deepStrictEqual(saveAfter, saveBefore);
    // Connexion classique toujours possible.
    const e = client();
    assert.strictEqual((await e.req('POST', '/api/login', { username: 'alice', password: 'motdepasse1' })).status, 200);
    // Événements journalisés, aucun jeton conservé.
    const events = db.prepare(`SELECT event_type FROM user_events WHERE user_id = ? AND event_type LIKE 'social_%' ORDER BY id`).all(user.id).map(r => r.event_type);
    assert.deepStrictEqual(events, ['social_linked', 'social_login']);
    const cols = db.prepare('PRAGMA table_info(user_identities)').all().map(r => r.name);
    assert.ok(!cols.some(n => /token/.test(n)));
    db.close();
  } finally { await stop(srv); }
});

test('liaison depuis Paramètres : mot de passe exigé, prompt=login ; identité liée ailleurs refusée ; un seul Google par compte ; retrait', async () => {
  const srv = await startUp({ env: SOCIAL_ENV });
  try {
    const a = client();
    const alice = await register(a, 'alice2');
    // Sans preuve : refusé.
    assert.strictEqual(await a.google('link', { identity: google(2) }), 'error');
    assert.strictEqual((await a.req('POST', '/api/auth/social/link/prepare', { password: 'faux-mdp' })).status, 403);
    const prep = await a.req('POST', '/api/auth/social/link/prepare', { password: 'motdepasse1' });
    assert.strictEqual(prep.status, 200);
    assert.strictEqual(prep.data.url, '/api/auth/social/start?intent=link');
    assert.strictEqual(await a.google('link', { identity: google(2) }), 'linked');
    assert.strictEqual(issuer.authorizeParams.prompt, 'login');
    // La preuve ne sert qu'une fois.
    assert.strictEqual(await a.google('link', { identity: google(3) }), 'error');
    // Un second Google sur le même compte : refusé dès la préparation.
    assert.strictEqual((await a.req('POST', '/api/auth/social/link/prepare', { password: 'motdepasse1' })).status, 409);

    // Le même Google pour un autre compte : refusé, aucune fusion.
    const b = client();
    const bob = await register(b, 'bob2');
    await b.req('POST', '/api/auth/social/link/prepare', { password: 'motdepasse1' });
    assert.strictEqual(await b.google('link', { identity: google(2) }), 'taken');
    const db = new Database(srv.db, { readonly: true });
    assert.deepStrictEqual(db.prepare('SELECT user_id FROM user_identities').all().map(r => r.user_id), [alice.id]);
    // Bob reste connecté à son compte.
    assert.strictEqual((await b.req('GET', '/api/me')).data.user.id, bob.id);
    // Identité Google inconnue alors qu'on est connecté (intention « login ») : rien n'est lié.
    assert.strictEqual(await b.google('login', { identity: google(4) }), 'error');

    // Retrait : mot de passe exigé ; les autres sessions d'Alice sont fermées, celle-ci reste.
    const a2 = client();
    assert.strictEqual(await a2.google('login', { identity: google(2) }), 'ok');
    assert.strictEqual((await a.req('POST', '/api/auth/social/unlink', { password: 'non' })).status, 403);
    assert.strictEqual((await a.req('POST', '/api/auth/social/unlink', { password: 'motdepasse1' })).status, 200);
    assert.strictEqual((await a.req('GET', '/api/me')).data.user.id, alice.id);
    assert.strictEqual((await a2.req('GET', '/api/me')).data.user, null);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM user_identities').get().n, 0);
    // Après retrait, Google ne connecte plus : identité de nouveau inconnue.
    assert.strictEqual(await client().google('login', { identity: google(2) }), 'pending');
    // Notifications envoyées à l'adresse du compte (SMTP simulé).
    const mails = fs.readdirSync(path.join(dir, 'outbox')).map(f => JSON.parse(fs.readFileSync(path.join(dir, 'outbox', f), 'utf8')));
    assert.ok(mails.some(m => m.to === 'alice2@example.test' && /Compte Google lié/.test(m.subject)));
    assert.ok(mails.some(m => m.to === 'alice2@example.test' && /Compte Google retiré/.test(m.subject)));
    db.close();
  } finally { await stop(srv); }
});

test('sécurité du retour : state rejoué, signature, émetteur, audience, expiration, nonce, alg, fournisseur ; origine non déclarée', async () => {
  const srv = await startUp({ env: SOCIAL_ENV });
  try {
    const a = client();
    await register(a, 'carol');
    await a.req('POST', '/api/auth/social/link/prepare', { password: 'motdepasse1' });
    assert.strictEqual(await a.google('link', { identity: google(5) }), 'linked');
    await a.req('POST', '/api/logout');

    // Rejeu du même retour (state déjà consommé) : refusé.
    const r = await client().google('login', { identity: google(5), replay: true });
    assert.strictEqual(r.result, 'ok');
    assert.strictEqual(r.again, 'error');

    const bad = {
      badsig:  'badsig',
      iss:     (c) => ({ claims: { ...c, iss: 'https://autre.example/' } }),
      aud:     (c) => ({ claims: { ...c, aud: 'autre-client' } }),
      azp:     (c) => ({ claims: { ...c, aud: [CLIENT, 'autre'], azp: 'autre' } }),
      exp:     (c) => ({ claims: { ...c, exp: Math.floor(Date.now() / 1000) - 3600 } }),
      nonce:   (c) => ({ claims: { ...c, nonce: 'rejoue' } }),
      alg:     (c) => ({ claims: c, header: { alg: 'none', kid: 'k1' } }),
      kid:     (c) => ({ claims: c, header: { alg: 'RS256', kid: 'inconnue' } }),
    };
    for (const [name, tamper] of Object.entries(bad)) {
      const c = client();
      assert.strictEqual(await c.google('login', { identity: google(5), tamper }), 'error', name);
      assert.strictEqual((await c.req('GET', '/api/me')).data.user, null, name);
    }
    // Autre fournisseur qu'Google (même tenant) : refusé.
    assert.strictEqual(await client().google('login', { identity: { sub: 'auth0|abc', email: 'x@y.z', email_verified: true } }), 'error');
    // Retour sans départ : refusé.
    assert.strictEqual(new URL((await client().get('/api/auth/social/callback?code=a&state=b')).location, BASE).searchParams.get('social'), 'error');
    // Annulation chez Google.
    const c = client();
    issuer.next = google(5);
    const start = await c.get('/api/auth/social/start?intent=login');
    const state = new URL(start.location).searchParams.get('state');
    const back = await c.get(`/api/auth/social/callback?error=access_denied&state=${state}`);
    assert.strictEqual(new URL(back.location, BASE).searchParams.get('social'), 'cancelled');
    // Origine (Host) non déclarée : pas de départ vers Auth0.
    const res = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/api/auth/social/start?intent=login', headers: { Host: 'evil.example' } }, resolve).on('error', reject);
    });
    res.resume();
    assert.strictEqual(res.statusCode, 302);
    assert.strictEqual(res.headers.location, '/?social=error');
  } finally { await stop(srv); }
});

test('liste blanche SOCIAL_LOGIN_USERS : seuls les comptes listés lient ou se connectent par Google', async () => {
  const srv = await startUp({ env: { ...SOCIAL_ENV, SOCIAL_LOGIN_USERS: 'Dave' } });
  try {
    const d = client();
    await register(d, 'dave');
    const e = client();
    await register(e, 'erin');
    assert.strictEqual((await d.req('GET', '/api/me')).data.social.canLink, true);
    assert.strictEqual((await d.req('GET', '/api/me')).data.social.loginButton, false);
    assert.strictEqual((await e.req('GET', '/api/me')).data.social.canLink, false);
    assert.strictEqual((await e.req('POST', '/api/auth/social/link/prepare', { password: 'motdepasse1' })).status, 403);
    // Erin passe par « identité en attente » puis son mot de passe : refusé aussi.
    await e.req('POST', '/api/logout');
    assert.strictEqual(await e.google('login', { identity: google(6) }), 'pending');
    await e.req('POST', '/api/login', { username: 'erin', password: 'motdepasse1' });
    assert.strictEqual((await e.req('POST', '/api/auth/social/pending/link', {})).status, 403);
    // Dave : liaison et connexion possibles.
    await d.req('POST', '/api/auth/social/link/prepare', { password: 'motdepasse1' });
    assert.strictEqual(await d.google('link', { identity: google(7) }), 'linked');
    assert.strictEqual(await client().google('login', { identity: google(7) }), 'ok');
  } finally { await stop(srv); }
});

test('migration additive et idempotente : base sans user_identities, 2 démarrages, comptes inchangés', async () => {
  const dbFile = path.join(dir, 'migration.sqlite');
  let srv = await startUp({ dbFile });
  const c = client();
  await register(c, 'frank');
  await stop(srv);
  // Base « d'avant » : table absente.
  let db = new Database(dbFile);
  db.exec('DROP TABLE user_identities');
  const usersBefore = db.prepare('SELECT * FROM users ORDER BY id').all();
  db.close();
  for (let i = 0; i < 2; i++) {
    srv = await startUp({ dbFile, env: SOCIAL_ENV });
    await stop(srv);
  }
  db = new Database(dbFile, { readonly: true });
  assert.deepStrictEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), usersBefore);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM user_identities').get().n, 0);
  db.close();
});

test('client OIDC : découverte avec émetteur différent refusée ; paramètres d’autorisation', async () => {
  const cfg = resolveSocialConfig(SOCIAL_ENV);
  const bad = createOidcClient(cfg, {
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ issuer: 'https://autre/', authorization_endpoint: 'a', token_endpoint: 'b', jwks_uri: 'c' }) }),
  });
  await assert.rejects(bad.authorizationUrl({ redirectUri: 'x', state: 's', nonce: 'n', verifier: 'v' }), /émetteur/);
  const ok = createOidcClient(cfg);
  const url = new URL(await ok.authorizationUrl({ redirectUri: `${BASE}/cb`, state: 's', nonce: 'n', verifier: 'v' }));
  assert.strictEqual(url.searchParams.get('client_id'), CLIENT);
  assert.strictEqual(url.searchParams.get('scope'), 'openid email profile');
  assert.strictEqual(url.searchParams.get('prompt'), null);
});
