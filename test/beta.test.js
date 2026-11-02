/**
 * Tests de la bêta fermée, ticket #57 :
 *   - par défaut rien ne change (inscription ouverte, bandeau masqué, aucun lien Discord) ;
 *   - inscription sur invitation : code exigé, usage limité, expiration, révocation, concurrence ;
 *   - inscriptions fermées : création refusée, connexion des comptes existants intacte ;
 *   - signalements : diagnostic seulement avec consentement, champs filtrés, suivi joueur, panel ;
 *   - mot de passe temporaire (admin) : confirmation exigée, sessions fermées ;
 *   - /health vérifie la base.
 * Serveur de test sur un port ≠ 3000, base temporaire hors server/data/.
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
const PORT  = process.env.DIG_TEST_PORT_BETA || '3168';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-beta-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db   = require('../server/db');
const beta = require('../server/beta');

db.initDb();

const status = fn => { try { fn(); return 200; } catch (err) { return err.status || 500; } };
let seq = 0;
const create = () => db.createUser(`beta_unit_${++seq}`, `beta${seq}@example.test`, 'x');

// ── Module (sans HTTP) ────────────────────────────────────────────────────────

test('par défaut : inscription ouverte, bandeau masqué, aucun lien Discord inventé', () => {
  assert.deepStrictEqual(beta.publicConfig(), {
    banner: false, registration: 'open', discordUrl: null, resetPolicy: '', knownIssues: '', reports: true,
  });
  assert.strictEqual(beta.checkRegistration(undefined), null, 'sans code : accepté en mode ouvert');
  assert.strictEqual(beta.checkRegistration('  '), null);
});

test('réglages : lien Discord validé, textes bornés, mode connu', () => {
  for (const bad of ['http://discord.gg/abc', 'https://evil.example/discord.gg/abc', 'https://discord.gg/', 'javascript:alert(1)']) {
    assert.strictEqual(status(() => beta.updateSettings({ discordUrl: bad })), 400, bad);
  }
  assert.strictEqual(beta.updateSettings({ discordUrl: 'https://discord.gg/DigBeta42' }).discordUrl, 'https://discord.gg/DigBeta42');
  assert.strictEqual(beta.updateSettings({ discordUrl: 'https://discord.com/invite/abc-DEF' }).discordUrl, 'https://discord.com/invite/abc-DEF');
  assert.strictEqual(status(() => beta.updateSettings({ registrationMode: 'public' })), 400);
  assert.strictEqual(status(() => beta.updateSettings({ knownIssues: 'x'.repeat(2001) })), 400);
  const s = beta.updateSettings({ bannerEnabled: true, knownIssues: '  Le son est coupé\r\nsur iOS \u0007 ' });
  assert.strictEqual(s.knownIssues, 'Le son est coupé\nsur iOS', 'retours normalisés, contrôles retirés');
  assert.strictEqual(s.discordUrl, 'https://discord.com/invite/abc-DEF', 'mise à jour partielle');
  assert.strictEqual(beta.updateSettings({ discordUrl: '' }).discordUrl, '', 'lien retiré');
  assert.strictEqual(beta.publicConfig().discordUrl, null);
  beta.updateSettings({ bannerEnabled: false, knownIssues: '' });
});

test('invitations : format, usage limité, expiration, révocation', () => {
  const now = new Date('2026-11-03T10:00:00Z');
  const [a] = beta.createInvites({ label: 'Sœur', maxUses: 1, expiresInDays: 7 }, now);
  assert.match(a.code, /^DIG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.strictEqual(a.expiresAt, '2026-11-10 10:00:00');
  assert.strictEqual(a.state, 'active');
  assert.strictEqual(beta.normalizeCode(a.code.toLowerCase().replace(/-/g, ' ')), a.code, 'saisie tolérante');
  assert.strictEqual(beta.createInvites({ count: 5, wave: 2 }, now).length, 5);
  for (const bad of [{ maxUses: 0 }, { maxUses: 501 }, { expiresInDays: 91 }, { count: 21 }, { wave: 0 }, { maxUses: 1.5 }]) {
    assert.strictEqual(status(() => beta.createInvites(bad, now)), 400, JSON.stringify(bad));
  }

  beta.updateSettings({ registrationMode: 'invite' });
  try {
    assert.strictEqual(status(() => beta.checkRegistration('', now)), 403, 'code exigé');
    assert.strictEqual(status(() => beta.checkRegistration('DIG-AAAA-AAAA', now)), 403, 'code inconnu');
    const u = beta.registerWithInvite(beta.checkRegistration(a.code, now), create, now);
    assert.ok(u.id);
    assert.strictEqual(status(() => beta.registerWithInvite(a.code, create, now)), 403, 'usage unique');
    const usersBefore = db.getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
    assert.strictEqual(status(() => beta.registerWithInvite(a.code, create, now)), 403);
    assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM users').get().n, usersBefore, 'refus : aucun compte créé (transaction annulée)');

    const [multi] = beta.createInvites({ maxUses: 2, expiresInDays: 1 }, now);
    beta.registerWithInvite(multi.code, create, now);
    assert.strictEqual(status(() => beta.registerWithInvite(multi.code, create, new Date('2026-11-04T10:00:01Z'))), 403, 'expiré');
    beta.registerWithInvite(multi.code, create, now);
    assert.strictEqual(beta.listInvites(now).find(i => i.id === multi.id).state, 'used');

    const [rev] = beta.createInvites({ maxUses: 3 }, now);
    beta.revokeInvite(rev.id);
    beta.revokeInvite(rev.id);
    assert.strictEqual(status(() => beta.revokeInvite(99999)), 404);
    assert.strictEqual(status(() => beta.registerWithInvite(rev.code, create, now)), 403, 'révoqué');

    const { testers, summary } = beta.listTesters(new Date('2026-11-12T10:00:00Z'));
    assert.strictEqual(summary.total, 3);
    assert.strictEqual(testers.find(x => x.userId === u.id).label, 'Sœur');
    assert.strictEqual(summary.activated, 0, 'aucune sauvegarde : pas encore activé');
  } finally {
    beta.updateSettings({ registrationMode: 'open' });
  }
});

test('inscriptions fermées : refus, même avec un code valide', () => {
  const [c] = beta.createInvites({});
  beta.updateSettings({ registrationMode: 'closed' });
  try {
    assert.strictEqual(status(() => beta.checkRegistration(c.code)), 403);
    assert.strictEqual(status(() => beta.registerWithInvite(c.code, create)), 403);
  } finally { beta.updateSettings({ registrationMode: 'open' }); }
  assert.strictEqual(beta.checkRegistration(c.code), c.code, 'mode ouvert : un code valide est accepté (testeur identifié)');
});

test('signalements : texte obligatoire, diagnostic seulement avec consentement, champs filtrés', () => {
  const u = create();
  assert.strictEqual(status(() => beta.createReport(u.id, { observed: 'oups' })), 400, 'trop court');
  assert.strictEqual(status(() => beta.createReport(u.id, { observed: 'x'.repeat(1001) })), 400);
  const diagnostics = {
    version: '1.0.0+abc1234', userAgent: 'Mozilla/5.0', viewport: '390x844', language: 'fr', view: 'dig',
    page: '/?reset=secret-token#x', email: 'fuite@example.test', save: { gems: 1 },
  };
  const noConsent = beta.createReport(u.id, { observed: 'Le coffre ne s\'ouvre pas', diagnostics });
  assert.strictEqual(noConsent.diagnostics, null, 'sans case cochée : aucun diagnostic');
  const withConsent = beta.createReport(u.id, { observed: 'Le coffre ne s\'ouvre pas', step: 'Boutique', expected: 'Un coffre', includeDiagnostics: true, diagnostics });
  assert.deepStrictEqual(withConsent.diagnostics, { version: '1.0.0+abc1234', userAgent: 'Mozilla/5.0', viewport: '390x844', language: 'fr', view: 'dig', page: '/' });
  const guest = beta.createReport(null, { observed: 'Je ne peux pas créer de compte' });

  const mine = beta.listMyReports(u.id);
  assert.strictEqual(mine.length, 2);
  assert.strictEqual(mine[0].diagnostics, undefined, 'vue joueur : pas de diagnostic ni note admin');

  assert.strictEqual(status(() => beta.updateReport(withConsent.id, { status: 'done' })), 400);
  assert.strictEqual(status(() => beta.updateReport(withConsent.id, { githubUrl: 'https://evil.example/issues/1' })), 400);
  const upd = beta.updateReport(withConsent.id, { status: 'fixed', githubUrl: 'https://github.com/ReC82/Dig/issues/57', adminNote: 'corrigé' });
  assert.strictEqual(upd.status, 'fixed');
  assert.strictEqual(beta.listMyReports(u.id).find(r => r.id === withConsent.id).githubUrl, 'https://github.com/ReC82/Dig/issues/57');
  const all = beta.listReports();
  assert.strictEqual(all.counts.fixed, 1);
  assert.strictEqual(all.reports.find(r => r.id === guest.id).userId, null);
  assert.strictEqual(beta.listReports({ status: 'fixed' }).reports.length, 1);

  beta.updateSettings({ reportsEnabled: false });
  assert.strictEqual(status(() => beta.createReport(u.id, { observed: 'Encore un souci' })), 403);
  beta.updateSettings({ reportsEnabled: true });
});

test('migration rejouable : initDb ne modifie ni réglages ni codes', () => {
  beta.updateSettings({ discordUrl: 'https://discord.gg/keepme' });
  const before = { s: beta.getSettings(), n: beta.listInvites().length };
  db.initDb();
  assert.deepStrictEqual({ s: beta.getSettings(), n: beta.listInvites().length }, before);
  beta.updateSettings({ discordUrl: '' });
});

// ── Routes HTTP ───────────────────────────────────────────────────────────────

test('routes : inscription sur invitation, fermeture sans couper les comptes, signalements, admin', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'), ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
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
  const call = async (method, url, body, { admin = false, cookie } = {}) => {
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${ADMIN}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const register = (username, extra = {}) => call('POST', '/api/register', { username, email: `${username}@example.test`, password: 'motdepasse-solide', ...extra });

  let r = await call('GET', '/health');
  assert.deepStrictEqual([r.status, r.body.ok, r.body.db], [200, true, true]);

  r = await call('GET', '/api/beta/config');
  assert.strictEqual(r.body.registration, 'open');
  assert.strictEqual(r.body.banner, false);

  // Compte existant avant la bêta
  r = await register('ancien');
  assert.strictEqual(r.status, 200);

  // Droits admin
  assert.strictEqual((await call('GET', '/api/admin/beta')).status, 401);
  assert.strictEqual((await call('PUT', '/api/admin/beta/settings', { registrationMode: 'closed' })).status, 401);

  r = await call('PUT', '/api/admin/beta/settings', { registrationMode: 'invite', bannerEnabled: true, discordUrl: 'https://discord.gg/DigBeta' }, { admin: true });
  assert.strictEqual(r.status, 200);
  r = await call('GET', '/api/beta/config');
  assert.deepStrictEqual([r.body.registration, r.body.banner, r.body.discordUrl], ['invite', true, 'https://discord.gg/DigBeta']);

  r = await register('sanscode');
  assert.deepStrictEqual([r.status, r.body.code], [403, 'invite_required']);
  r = await call('POST', '/api/admin/beta/invites', { label: 'Famille', maxUses: 1, expiresInDays: 7 }, { admin: true });
  const code = r.body.invites[0].code;
  r = await register('testeuse', { inviteCode: code.toLowerCase() });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const testerCookie = r.cookie;
  r = await register('second', { inviteCode: code });
  assert.deepStrictEqual([r.status, r.body.code], [403, 'invite_invalid']);

  // Fermeture : plus aucune création, mais la connexion des comptes existants fonctionne.
  await call('PUT', '/api/admin/beta/settings', { registrationMode: 'closed' }, { admin: true });
  r = await register('tardif');
  assert.deepStrictEqual([r.status, r.body.code], [403, 'registration_closed']);
  for (const username of ['ancien', 'testeuse']) {
    r = await call('POST', '/api/login', { username, password: 'motdepasse-solide' });
    assert.strictEqual(r.status, 200, `connexion de ${username} intacte`);
  }

  // Signalements
  r = await call('POST', '/api/beta/reports', { observed: 'Écran noir après le coffre', includeDiagnostics: true, diagnostics: { version: 'v', page: '/?verify=tok' } }, { cookie: testerCookie });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.report.diagnostics, { version: 'v', page: '/' });
  r = await call('POST', '/api/beta/reports', { observed: 'Invité : bouton absent' });
  assert.strictEqual(r.status, 200, 'invité accepté');
  assert.strictEqual((await call('GET', '/api/beta/reports/mine')).status, 401);
  r = await call('GET', '/api/beta/reports/mine', undefined, { cookie: testerCookie });
  assert.strictEqual(r.body.reports.length, 1);

  r = await call('GET', '/api/admin/beta', undefined, { admin: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.summary.total, 1);
  assert.strictEqual(r.body.testers[0].username, 'testeuse');
  assert.strictEqual(r.body.reports.reports.length, 2);
  const reportId = r.body.reports.reports.find(x => x.username === 'testeuse').id;
  r = await call('PUT', `/api/admin/beta/reports/${reportId}`, { status: 'fixed', githubUrl: 'https://github.com/ReC82/Dig/issues/57' }, { admin: true });
  assert.strictEqual(r.body.report.status, 'fixed');
  r = await call('GET', '/api/beta/reports/mine', undefined, { cookie: testerCookie });
  assert.strictEqual(r.body.reports[0].status, 'fixed', 'le joueur voit la correction');

  // Mot de passe temporaire : confirmation, ancien mot de passe invalide, sessions fermées
  const users = (await call('GET', '/api/admin/players/search?q=testeuse', undefined, { admin: true })).body.users;
  const uid = users[0].id;
  assert.strictEqual((await call('POST', `/api/admin/players/${uid}/temp-password`, { confirm: 'autre' }, { admin: true })).status, 400);
  assert.strictEqual((await call('POST', `/api/admin/players/${uid}/temp-password`, { confirm: 'testeuse' })).status, 401);
  r = await call('POST', `/api/admin/players/${uid}/temp-password`, { confirm: 'testeuse' }, { admin: true });
  assert.strictEqual(r.status, 200);
  assert.match(r.body.tempPassword, /^[A-Za-z2-9]{12}$/);
  assert.strictEqual((await call('GET', '/api/me', undefined, { cookie: testerCookie })).body.user, null, 'ancienne session fermée');
  assert.strictEqual((await call('POST', '/api/login', { username: 'testeuse', password: 'motdepasse-solide' })).status, 401);
  assert.strictEqual((await call('POST', '/api/login', { username: 'testeuse', password: r.body.tempPassword })).status, 200);

  await call('PUT', '/api/admin/beta/settings', { registrationMode: 'open' }, { admin: true });
  assert.strictEqual((await register('nouveau')).status, 200, 'réouverture');
});

test.after(() => {
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
});
