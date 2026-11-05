/**
 * Gestion de la bêta fermée, ticket #80 :
 *   - liens : révocation (invalidation serveur immédiate, idempotente), archivage seulement d'un lien
 *     qui ne peut plus servir (utilisé, révoqué, expiré), réaffichage, compteurs cohérents ;
 *   - testeurs : retrait du programme réversible, confirmation exigée, compte / connexion /
 *     sauvegarde / classement intacts (la bêta ne contrôle que la création de compte) ;
 *   - retours : archivage et réaffichage sans rien effacer, filtres actifs / archives ;
 *   - journal beta_audit en ajout seul ; migration rejouable sur une base d'avant #80 ;
 *   - routes : autorisation admin, aucun effet sur les autres comptes.
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
const PORT  = process.env.DIG_TEST_PORT_BETA_MANAGE || '3169';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-beta-manage-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db   = require('../server/db');
const beta = require('../server/beta');

db.initDb();
const conn = db.getDb();

const status = fn => { try { fn(); return 200; } catch (err) { return err.status || 500; } };
let seq = 0;
const newUser = () => db.createUser(`bm_unit_${++seq}`, `bm${seq}@example.test`, 'x');

test('liens : révoquer (immédiat, idempotent), archiver seulement un lien inutilisable, réafficher', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const [active, used, expiring] = beta.createInvites({ count: 3, expiresInDays: 1 }, now, 'admin (session)');
  assert.strictEqual(active.createdBy, 'admin (session)', 'créateur noté');
  assert.strictEqual(active.archivedAt, null);

  // Un lien actif ne s'archive pas (il resterait utilisable en étant caché).
  assert.strictEqual(status(() => beta.archiveInvite(active.id, 'a', now)), 409);

  // Révocation : invalidation immédiate côté serveur.
  beta.updateSettings({ registrationMode: 'invite' });
  assert.strictEqual(beta.checkRegistration(active.code, now), active.code);
  const r1 = beta.revokeInvite(active.id, 'admin (session)');
  assert.deepStrictEqual([r1.changed, r1.invite.state], [true, 'revoked']);
  assert.strictEqual(status(() => beta.checkRegistration(active.code, now)), 403, 'lien révoqué refusé immédiatement');
  assert.strictEqual(beta.revokeInvite(active.id, 'admin (session)').changed, false, 'idempotent');
  assert.strictEqual(status(() => beta.revokeInvite(999999)), 404);
  assert.strictEqual(status(() => beta.revokeInvite('abc')), 400);

  // Lien utilisé : le compte créé n'est jamais touché par l'archivage.
  const u = beta.registerWithInvite(used.code, newUser, now);
  const a1 = beta.archiveInvite(used.id, 'admin (session)', now);
  assert.deepStrictEqual([a1.changed, a1.invite.state, !!a1.invite.archivedAt], [true, 'used', true]);
  assert.strictEqual(beta.archiveInvite(used.id, 'admin (session)', now).changed, false, 'idempotent');
  assert.ok(conn.prepare('SELECT 1 FROM users WHERE id = ?').get(u.id), 'compte intact');
  assert.ok(beta.listTesters(now).testers.some(x => x.userId === u.id && !x.removedAt), 'testeur toujours inscrit');

  // Lien expiré : archivable ; révoqué : archivable.
  const later = new Date('2026-11-07T10:00:00Z');
  assert.strictEqual(beta.archiveInvite(expiring.id, 'a', later).invite.state, 'expired');
  assert.strictEqual(beta.archiveInvite(active.id, 'a', now).changed, true);

  // Réafficher : retour dans la liste courante, rien d'autre ne change.
  const back = beta.unarchiveInvite(used.id, 'admin (session)', now);
  assert.deepStrictEqual([back.changed, back.invite.archivedAt, back.invite.uses, back.invite.state], [true, null, 1, 'used']);
  assert.strictEqual(beta.unarchiveInvite(used.id, 'a', now).changed, false);

  // Compteur « liens actifs » cohérent : seuls les liens réellement utilisables.
  const s = beta.adminSummary(later);
  const ids = [active.id, used.id, expiring.id];
  assert.strictEqual(s.invites.filter(i => ids.includes(i.id) && i.state === 'active').length, 0);
  assert.strictEqual(s.invites.filter(i => ids.includes(i.id) && i.archivedAt).length, 2);
  beta.updateSettings({ registrationMode: 'open' });
});

test('testeurs : retrait réversible, confirmation exigée, compte et progression intacts', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const [inv] = beta.createInvites({ maxUses: 2, expiresInDays: 0 }, now);
  const a = beta.registerWithInvite(inv.code, newUser, now);
  const b = beta.registerWithInvite(inv.code, newUser, now);
  conn.prepare("INSERT INTO user_saves (user_id, data, version, saved_at) VALUES (?, ?, 1, datetime('now'))").run(a.id, '{"coins":42}');
  const snap = id => JSON.stringify([
    conn.prepare('SELECT * FROM users WHERE id = ?').get(id),
    conn.prepare('SELECT * FROM user_saves WHERE user_id = ?').get(id),
    conn.prepare('SELECT * FROM season_rankings WHERE user_id = ?').all(id),
  ]);
  const beforeA = snap(a.id), beforeB = snap(b.id);
  const total0 = beta.listTesters(now).summary.total;

  assert.strictEqual(status(() => beta.removeTester(a.id, {})), 400, 'confirmation exigée');
  assert.strictEqual(status(() => beta.removeTester(a.id, { confirm: 'true' })), 400, 'confirmation booléenne');
  assert.strictEqual(status(() => beta.removeTester(newUser().id, { confirm: true })), 404, 'compte sans invitation : pas un testeur');

  const r = beta.removeTester(a.id, { confirm: true }, 'admin (session)');
  assert.ok(r.changed && r.removedAt);
  assert.strictEqual(beta.removeTester(a.id, { confirm: true }).changed, false, 'idempotent');
  const t = beta.listTesters(now);
  assert.strictEqual(t.summary.total, total0 - 1, 'compteur : hors programme exclu');
  assert.strictEqual(t.summary.removed, 1);
  assert.ok(t.testers.find(x => x.userId === a.id).removedAt, 'toujours listé (filtre « Hors programme »)');
  assert.strictEqual(t.testers.find(x => x.userId === b.id).removedAt, null, 'autre testeur non touché');
  assert.strictEqual(snap(a.id), beforeA, 'compte, sauvegarde, classement intacts');
  assert.strictEqual(snap(b.id), beforeB);
  assert.strictEqual(beta.listInvites(now).find(i => i.id === inv.id).uses, 2, 'invitation consommée inchangée');

  assert.strictEqual(beta.restoreTester(a.id, 'admin (session)').changed, true);
  assert.strictEqual(beta.restoreTester(a.id).changed, false);
  assert.strictEqual(beta.listTesters(now).summary.total, total0);
});

test('retours : archiver / réafficher sans rien effacer, compteurs actifs et archives', () => {
  const u = newUser();
  const { id } = beta.createReport(u.id, { observed: 'Le coffre ne s’ouvre pas', includeDiagnostics: true, diagnostics: { version: '1.0.0' } });
  beta.updateReport(id, { status: 'fixed', adminNote: 'corrigé en 1.0.1' });
  const before = conn.prepare('SELECT id, user_id, step, expected, observed, device, diagnostics, status, github_url, admin_note, created_at FROM bug_reports WHERE id = ?').get(id);
  const fixed0 = beta.listReports().counts.fixed;

  assert.strictEqual(beta.archiveReport(id, 'admin (session)').changed, true);
  assert.strictEqual(beta.archiveReport(id).changed, false, 'idempotent');
  assert.strictEqual(beta.listReports().reports.some(r => r.id === id), false, 'hors liste active');
  assert.ok(beta.listReports({ archived: true }).reports.find(r => r.id === id).archivedAt);
  assert.ok(beta.listReports({ archived: 'all' }).reports.some(r => r.id === id));
  const c = beta.listReports().counts;
  assert.deepStrictEqual([c.fixed, c.archived], [fixed0 - 1, 1]);
  assert.deepStrictEqual(conn.prepare('SELECT id, user_id, step, expected, observed, device, diagnostics, status, github_url, admin_note, created_at FROM bug_reports WHERE id = ?').get(id), before, 'preuve conservée');
  assert.strictEqual(beta.listMyReports(u.id)[0].id, id, 'le joueur voit toujours son signalement');
  assert.strictEqual(beta.listMyReports(u.id)[0].archivedAt, undefined, 'aucune donnée admin côté joueur');

  assert.strictEqual(beta.unarchiveReport(id).changed, true);
  assert.ok(beta.listReports().reports.some(r => r.id === id));
  assert.strictEqual(status(() => beta.archiveReport(999999)), 404);
});

test('journal : une ligne par changement réel, en ajout seul', () => {
  const audit = beta.listAudit(200);
  const kinds = new Set(audit.map(e => e.action));
  for (const k of ['invite_revoke', 'invite_archive', 'invite_unarchive', 'tester_remove', 'tester_restore', 'report_archive', 'report_unarchive']) assert.ok(kinds.has(k), k);
  assert.strictEqual(audit.filter(e => e.action === 'invite_revoke').length, 1, 'révocation répétée : une seule ligne');
  assert.ok(audit.every(e => e.createdAt && e.actor && e.label));
  assert.ok(audit.filter(e => e.targetType === 'invite').every(e => /^DIG-…[A-Z0-9]{4}$/.test(e.target)), 'code masqué dans le journal');
  assert.throws(() => conn.prepare('DELETE FROM beta_audit').run(), /ajout seul/);
  assert.throws(() => conn.prepare("UPDATE beta_audit SET actor = 'x'").run(), /ajout seul/);
});

test('migration : base d’avant #80 complétée sans perte, rejouable', () => {
  const file = path.join(dir, 'old.sqlite');
  const Database = require('better-sqlite3');
  const old = new Database(file);
  old.exec(`
    CREATE TABLE beta_invites (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '', wave INTEGER NOT NULL DEFAULT 1,
      max_uses INTEGER NOT NULL DEFAULT 1, uses INTEGER NOT NULL DEFAULT 0, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO beta_invites (code, label) VALUES ('DIG-AAAA-BBBB', 'ancien');`);
  old.close();
  const script = `
    process.env.DB_FILE = ${JSON.stringify(file)};
    const db = require('./server/db'); db.initDb(); db.initDb();
    const c = db.getDb();
    const cols = t => c.prepare('PRAGMA table_info(' + t + ')').all().map(x => x.name);
    console.log(JSON.stringify({ inv: c.prepare('SELECT code, label, archived_at, created_by FROM beta_invites').all(),
      uses: cols('beta_invite_uses').includes('removed_at'), reports: cols('bug_reports').includes('archived_at'),
      audit: c.prepare('SELECT COUNT(*) AS n FROM beta_audit').get().n }));`;
  const out = require('child_process').execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.deepStrictEqual(r.inv, [{ code: 'DIG-AAAA-BBBB', label: 'ancien', archived_at: null, created_by: null }]);
  assert.deepStrictEqual([r.uses, r.reports, r.audit], [true, true, 0]);
});

test('routes : autorisation admin, actions, aucun effet sur les autres comptes', async (t) => {
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

  await call('PUT', '/api/admin/beta/settings', { registrationMode: 'invite' }, { admin: true });
  let r = await call('POST', '/api/admin/beta/invites', { label: 'Alice', count: 3 }, { admin: true });
  const [i1, i2, i3] = r.body.invites;
  assert.strictEqual(i1.createdBy, 'admin (key)');
  const a = await register('bm_alice', { inviteCode: i1.code });
  const b = await register('bm_bob', { inviteCode: i2.code });
  assert.deepStrictEqual([a.status, b.status], [200, 200]);
  r = await call('GET', '/api/admin/beta', undefined, { admin: true });
  const aliceId = r.body.testers.find(x => x.username === 'bm_alice').userId;
  const reportId = (await call('POST', '/api/beta/reports', { observed: 'Bug de test HTTP' }, { cookie: a.cookie })).body.report.id;

  // Sans autorisation : rien ne passe (et rien ne change).
  for (const [m, u, body] of [
    ['POST', `/api/admin/beta/invites/${i3.id}/revoke`], ['POST', `/api/admin/beta/invites/${i1.id}/archive`],
    ['POST', `/api/admin/beta/testers/${aliceId}/remove`, { confirm: true }], ['POST', `/api/admin/beta/reports/${reportId}/archive`],
  ]) {
    assert.strictEqual((await call(m, u, body)).status, 401, u);
    assert.strictEqual((await call(m, u, body, { cookie: a.cookie })).status, 401, `${u} (session joueur)`);
  }
  r = await call('GET', '/api/admin/beta', undefined, { admin: true });
  assert.strictEqual(r.body.invites.find(i => i.id === i3.id).state, 'active');

  // Révoquer un lien inutilisé : l'inscription est refusée immédiatement.
  r = await call('POST', `/api/admin/beta/invites/${i3.id}/revoke`, undefined, { admin: true });
  assert.deepStrictEqual([r.status, r.body.changed, r.body.invite.state], [200, true, 'revoked']);
  r = await register('bm_carol', { inviteCode: i3.code });
  assert.deepStrictEqual([r.status, r.body.code], [403, 'invite_invalid']);
  assert.strictEqual((await call('POST', `/api/admin/beta/invites/${i3.id}/revoke`, undefined, { admin: true })).body.changed, false);

  // Archiver : refusé pour un lien actif, accepté pour un lien utilisé ou révoqué.
  r = await call('POST', `/api/admin/beta/invites/${i1.id}/archive`, undefined, { admin: true });
  assert.strictEqual(r.status, 200, 'lien utilisé archivable');
  const [i4] = (await call('POST', '/api/admin/beta/invites', {}, { admin: true })).body.invites;
  r = await call('POST', `/api/admin/beta/invites/${i4.id}/archive`, undefined, { admin: true });
  assert.deepStrictEqual([r.status, r.body.code], [409, 'invite_active']);
  assert.strictEqual((await call('POST', `/api/admin/beta/invites/${i1.id}/unarchive`, undefined, { admin: true })).body.changed, true);

  // Retirer un testeur : confirmation exigée ; la connexion du compte continue de fonctionner.
  assert.strictEqual((await call('POST', `/api/admin/beta/testers/${aliceId}/remove`, {}, { admin: true })).status, 400);
  r = await call('POST', `/api/admin/beta/testers/${aliceId}/remove`, { confirm: true }, { admin: true });
  assert.deepStrictEqual([r.status, r.body.changed], [200, true]);
  r = await call('POST', '/api/login', { username: 'bm_alice', password: 'motdepasse-solide' });
  assert.strictEqual(r.status, 200, 'connexion intacte après retrait du programme');
  r = await call('GET', '/api/admin/beta', undefined, { admin: true });
  assert.deepStrictEqual([r.body.summary.total, r.body.summary.removed], [1, 1]);
  assert.strictEqual(r.body.testers.find(x => x.username === 'bm_bob').removedAt, null, 'autre testeur non touché');
  assert.strictEqual((await call('POST', `/api/admin/beta/testers/${aliceId}/restore`, undefined, { admin: true })).body.changed, true);

  // Retours : archiver / réafficher, filtre de la liste.
  assert.strictEqual((await call('POST', `/api/admin/beta/reports/${reportId}/archive`, undefined, { admin: true })).status, 200);
  r = await call('GET', '/api/admin/beta/reports', undefined, { admin: true });
  assert.strictEqual(r.body.reports.some(x => x.id === reportId), false);
  assert.strictEqual(r.body.counts.archived, 1);
  r = await call('GET', '/api/admin/beta/reports?archived=1', undefined, { admin: true });
  assert.deepStrictEqual(r.body.reports.map(x => x.id), [reportId]);
  assert.strictEqual((await call('POST', `/api/admin/beta/reports/${reportId}/unarchive`, undefined, { admin: true })).body.changed, true);
  r = await call('GET', '/api/beta/reports/mine', undefined, { cookie: a.cookie });
  assert.strictEqual(r.body.reports[0].id, reportId);

  // Journal visible dans la vue d'ensemble ; chaque action admin aussi tracée dans security_events (#25).
  r = await call('GET', '/api/admin/beta', undefined, { admin: true });
  assert.ok(r.body.audit.length >= 7);
  assert.ok(r.body.audit.every(e => e.actor === 'admin (key)'));
  assert.strictEqual(r.body.reports.counts.archived, 0);
});

test('panel : bouton visible, fiche sans faux avertissement (#72), actions réservées au clic', () => {
  const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  const JS   = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
  const sec = HTML.slice(HTML.indexOf('<section id="tab-beta"'), HTML.indexOf('</section>', HTML.indexOf('<section id="tab-beta"')));
  assert.match(sec, /id="btn-beta-manage"[^>]*>🗂️ Gérer les invitations et testeurs</);
  assert.match(sec, /<dialog id="beta-manage-dialog"/);
  assert.match(sec, /<select id="beta-reports-view">/);
  assert.match(JS, /admDialogSetup\('beta-manage-dialog', \{ dirty: \(\) => false \}\)/, 'recherche et filtre ne sont pas des saisies à protéger');
  const block = JS.slice(JS.indexOf('function betaManageRender('), JS.indexOf("document.getElementById('btn-beta-manage')"));
  assert.doesNotMatch(block, /api\(|innerHTML/, 'afficher / filtrer : aucun appel serveur, aucun HTML injecté');
  assert.match(JS, /\/api\/admin\/beta\/testers\/\$\{x\.userId\}\/remove`, \{ confirm: true \}/);
  // Codes jamais affichés en entier dans la fiche (fin du code seulement).
  assert.match(JS, /const betaCodeHint = code => `\$\{code\.slice\(0, 3\)\}-••••-\$\{code\.slice\(-4\)\}`/);
});
