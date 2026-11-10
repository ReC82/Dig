/**
 * Admin Joueurs (#90) :
 * - liste paginée côté serveur dès l'ouverture : total, 10/20/50, tri, filtre, recherche partielle
 *   insensible à la casse et aux accents sur toute la base, jamais d'e-mail ;
 * - suppression contrôlée d'un compte de TEST pour refaire la vraie inscription : marque préalable,
 *   verrous (points de récompense…), pseudo exact + SUPPRIMER + motif, anti-rejeu, transaction ;
 *   session fermée, client prévenu, même pseudo / e-mail réinscriptibles avec une NOUVELLE
 *   invitation, compte neuf sans ancienne donnée, témoins intacts, journaux conservés.
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
const PORT  = process.env.DIG_TEST_PORT_PLAYERS_90 || '3190';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-players-90-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db = require('../server/db');
db.initDb();
const playerAdmin = require('../server/playerAdmin');
playerAdmin.init();

test('liste : pagination serveur, total, tri, recherche sans accents sur toute la base, sans e-mail', () => {
  for (let i = 1; i <= 55; i++) db.createUser(`joueur${String(i).padStart(2, '0')}`, `j${i}@example.test`, 'x');
  db.createUser('elodie', 'elodie@example.test', 'x');
  const all = playerAdmin.listPlayers({});
  assert.strictEqual(all.total, 56);
  assert.strictEqual(all.per, 20);
  assert.strictEqual(all.pages, 3);
  assert.strictEqual(all.players.length, 20);
  for (const p of all.players) assert.ok(!('email' in p) && !JSON.stringify(p).includes('@'), 'aucun e-mail');

  const p3 = playerAdmin.listPlayers({ per: 50, page: 2, sort: 'username' });
  assert.deepStrictEqual([p3.page, p3.pages, p3.players.length], [2, 2, 6]);
  assert.strictEqual(p3.players[0].username, 'joueur50', 'elodie en tête de la page 1');
  assert.strictEqual(playerAdmin.listPlayers({ per: 999 }).per, 20, 'taille de page bornée');
  assert.strictEqual(playerAdmin.listPlayers({ page: 99, per: 10 }).page, 6, 'page bornée');
  assert.strictEqual(playerAdmin.listPlayers({ sort: 'id', per: 10 }).players[0].username, 'joueur01');
  assert.strictEqual(playerAdmin.listPlayers({ sort: 'created_asc', per: 10 }).players[0].username, 'joueur01');

  // Recherche partielle sur TOUTES les pages, casse et accents ignorés
  assert.deepStrictEqual(playerAdmin.listPlayers({ q: 'ÉLO' }).players.map(p => p.username), ['elodie']);
  assert.strictEqual(playerAdmin.listPlayers({ q: 'oueur5', per: 10 }).total, 6);
  assert.strictEqual(playerAdmin.listPlayers({ q: '%' }).total, 0, 'jokers pris au pied de la lettre');
  const id = all.players.find(p => p.username === 'elodie')?.id ?? playerAdmin.listPlayers({ q: 'elodie' }).players[0].id;
  assert.strictEqual(playerAdmin.listPlayers({ q: `#${id}` }).players[0].username, 'elodie', 'recherche par #ID');
  assert.strictEqual(playerAdmin.listPlayers({ q: 'zzz' }).total, 0);

  // Activité réelle : dernière sauvegarde → tri « activité » en tête, filtre 7 jours
  const j07 = playerAdmin.listPlayers({ q: 'joueur07' }).players[0].id;
  db.upsertUserSave(j07, JSON.stringify({ depth: 42 }));
  const act = playerAdmin.listPlayers({ sort: 'activity', per: 10 });
  assert.strictEqual(act.players[0].username, 'joueur07');
  assert.strictEqual(act.players[0].depth, 42);
  assert.ok(act.players[0].lastActivityAt);
  assert.strictEqual(playerAdmin.listPlayers({ filter: 'active7' }).total, 1);
  assert.strictEqual(playerAdmin.listPlayers({ filter: 'test_accounts' }).total, 0);
  assert.strictEqual(playerAdmin.normalizeQuery('  Œuf Ça '), 'oeuf ca');
});

test('diagnostic d\'éligibilité (#90-B) : verrous visibles avant le marquage, la marque ne les lève pas', () => {
  const c = db.getDb();
  // Compte neuf : il ne manque que la marque, puis supprimable
  const neuf = db.createUser('essai_elig', 'essai_elig@example.test', 'x');
  let pv = playerAdmin.previewDelete(neuf.id);
  assert.deepStrictEqual([pv.eligibility.state, pv.eligibility.marked, pv.eligibility.protectedCount], ['needs_mark', false, 0]);
  playerAdmin.markTestAccount(neuf.id, { confirmUsername: 'essai_elig', reason: 'identité jetable' });
  pv = playerAdmin.previewDelete(neuf.id);
  assert.deepStrictEqual([pv.eligibility.state, pv.allowed], ['deletable', true]);

  // Compte de bêta type « testeur » : essai boutique + points de saison + classement figé
  const t = db.createUser('testeur_elig', 'testeur_elig@example.test', 'x');
  const season = Number(c.prepare("INSERT INTO seasons (name, start_at, end_at, status) VALUES ('Saison test 90', '2026-01-01', '2026-01-08', 'closed')").run().lastInsertRowid);
  const led = c.prepare('INSERT INTO reward_point_ledger (user_id, delta, balance_after, kind, use, season_id, idem_key, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  led.run(t.id, 1, 1, 'admin_credit', null, null, 'k90_1', 'TEST');
  const spend = Number(led.run(t.id, -1, 0, 'spend', 'virtual', null, 'k90_2', 'Boutique').lastInsertRowid);
  led.run(t.id, 1, 1, 'refund', 'virtual', null, 'k90_3', 'annulée');
  led.run(t.id, 5, 6, 'season_award', null, season, 'k90_4', null);
  c.prepare("INSERT INTO reward_point_awards (season_id, mode, user_id, rank, eligible_count, tier, points, scale_version) VALUES (?, 'live', ?, 2, 2, 'active', 5, 1)").run(season, t.id);
  c.prepare("INSERT INTO reward_point_wallets (user_id, balance, earned_total, spent_total) VALUES (?, 6, 7, 1)").run(t.id);
  c.prepare("INSERT INTO shop_orders (user_id, item_id, kind, cost, status, request_key, spend_ledger_id, item_snapshot) VALUES (?, 1, 'virtual', 1, 'cancelled', 'rk90', ?, '{}')").run(t.id, spend);
  c.prepare('INSERT INTO season_standings (season_id, position, rank, user_id, max_depth, effective_manual_blocks, manual_blocks, eligible) VALUES (?, 2, 2, ?, 10, 5, 5, 1)').run(season, t.id);

  // AVANT le marquage : le diagnostic annonce déjà que la marque ne suffira pas
  pv = playerAdmin.previewDelete(t.id);
  assert.strictEqual(pv.eligibility.state, 'protected');
  assert.strictEqual(pv.eligibility.marked, false);
  assert.strictEqual(pv.eligibility.protectedCount, 5);
  assert.match(pv.eligibility.summary, /^Même marqué « compte de test », ce compte ne pourra pas être supprimé : 5 catégories/);
  const prot = pv.blockers.filter(b => b.protected);
  assert.deepStrictEqual(prot.map(b => b.code), ['reward_point_ledger', 'reward_point_awards', 'reward_point_wallets', 'shop_orders', 'season_standings']);
  for (const b of prot) assert.ok(b.why && b.title && b.rows > 0 && b.details.length > 0, `${b.code} : motif lisible et détail`);
  const byCode = Object.fromEntries(prot.map(b => [b.code, b.details]));
  assert.deepStrictEqual(byCode.reward_point_ledger, ['crédit manuel admin × 1 (+1 pt)', 'remboursement × 1 (+1 pt)', 'attribution de saison × 1 (+5 pt)', 'dépense en boutique × 1 (-1 pt)']);
  assert.deepStrictEqual(byCode.reward_point_awards, ['Saison test 90 : rang 2 sur 2, 5 pt (attribution réelle)']);
  assert.match(byCode.shop_orders[0], /article virtuel, 1 pt, annulée$/);
  assert.deepStrictEqual(byCode.season_standings, ['Saison test 90 : 2ᵉ place']);
  assert.ok(!JSON.stringify(pv.blockers).includes('@'), 'aucun e-mail dans le diagnostic');

  // APRÈS le marquage : « compte de test reconnu, mais bloqué » ; la suppression reste refusée, rien n'est effacé
  playerAdmin.markTestAccount(t.id, { confirmUsername: 'testeur_elig', reason: 'compte testeur' });
  pv = playerAdmin.previewDelete(t.id);
  assert.deepStrictEqual([pv.eligibility.state, pv.eligibility.marked, pv.allowed], ['protected', true, false]);
  assert.strictEqual(pv.eligibility.summary, 'Compte de test reconnu, mais suppression bloquée par 5 catégories de données protégées.');
  assert.ok(!pv.blockers.some(b => b.code === 'not_test_account'));
  assert.throws(() => playerAdmin.deleteTestAccount(t.id, { confirmUsername: 'testeur_elig', confirmWord: 'SUPPRIMER', reason: 'essai', requestId: 'req_elig_0001' }),
    e => e.code === 'blocked');
  assert.ok(db.getUserById(t.id));
  assert.strictEqual(c.prepare('SELECT COUNT(*) AS n FROM reward_point_ledger WHERE user_id = ?').get(t.id).n, 4);
  assert.strictEqual(c.prepare('SELECT COUNT(*) AS n FROM season_standings WHERE user_id = ?').get(t.id).n, 1);

  // L'identité jetable neuve, elle, se supprime normalement
  playerAdmin.deleteTestAccount(neuf.id, { confirmUsername: 'essai_elig', confirmWord: 'SUPPRIMER', reason: 'fin du test', requestId: 'req_elig_0002' });
  assert.strictEqual(db.getUserById(neuf.id), undefined);
  playerAdmin.unmarkTestAccount(t.id);
});

test('suppression : marque obligatoire, confirmation forte, transaction, anti-rejeu (unitaire)', () => {
  const u = db.createUser('cobaye_unit', 'cobaye_unit@example.test', 'x');
  db.upsertUserSave(u.id, JSON.stringify({ coins: 9 }));
  let pv = playerAdmin.previewDelete(u.id);
  assert.strictEqual(pv.allowed, false);
  assert.deepStrictEqual(pv.blockers.map(b => b.code), ['not_test_account']);
  assert.throws(() => playerAdmin.deleteTestAccount(u.id, { confirmUsername: 'cobaye_unit', confirmWord: 'SUPPRIMER', reason: 'essai', requestId: 'req_unit_0001' }),
    e => e.code === 'blocked');
  assert.throws(() => playerAdmin.markTestAccount(u.id, { confirmUsername: 'Cobaye_unit', reason: 'test' }), e => e.code === 'confirm_username');
  assert.throws(() => playerAdmin.markTestAccount(u.id, { confirmUsername: 'cobaye_unit', reason: '' }), e => e.code === 'reason');
  assert.strictEqual(playerAdmin.markTestAccount(u.id, { confirmUsername: 'cobaye_unit', reason: 'compte de test' }).changed, true);
  assert.strictEqual(playerAdmin.markTestAccount(u.id, { confirmUsername: 'cobaye_unit', reason: 'compte de test' }).changed, false, 'idempotent');
  pv = playerAdmin.previewDelete(u.id);
  assert.strictEqual(pv.allowed, true);
  assert.ok(pv.erased.some(e => e.table === 'user_saves'));
  const ok = { confirmUsername: 'cobaye_unit', confirmWord: 'SUPPRIMER', reason: 'refaire inscription', requestId: 'req_unit_0002' };
  assert.throws(() => playerAdmin.deleteTestAccount(u.id, { ...ok, confirmWord: 'supprimer' }), e => e.code === 'confirm_word');
  assert.throws(() => playerAdmin.deleteTestAccount(u.id, { ...ok, requestId: 'x' }), e => e.code === 'request_id');
  const r = playerAdmin.deleteTestAccount(u.id, ok);
  assert.strictEqual(r.replayed, false);
  assert.strictEqual(db.getUserById(u.id), undefined);
  assert.strictEqual(db.getUserSave(u.id), null);
  assert.strictEqual(playerAdmin.deleteTestAccount(u.id, ok).replayed, true, 'rejeu : même résultat, rien refait');
  assert.throws(() => playerAdmin.deleteTestAccount(u.id, { ...ok, requestId: 'req_unit_0003' }), e => e.status === 404);
  // Même pseudo et même e-mail de nouveau libres ; identifiant jamais réutilisé
  const again = db.createUser('cobaye_unit', 'cobaye_unit@example.test', 'x');
  assert.ok(again.id > u.id);
  assert.strictEqual(playerAdmin.listDeletions()[0].username, 'cobaye_unit');
});

test('parcours HTTP : invitation → jeu → suppression → session fermée → réinscription avec nouvelle invitation', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'unit.sqlite'),
      ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
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

  const admin = async (method, url, body) => {
    const res = await fetch(BASE + url, { method, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const player = async (method, url, body, cookie) => {
    const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    return { status: res.status, body: await res.json().catch(() => null), cookie: set ? set.split(';')[0] : cookie, deleted: res.headers.get('x-dig-account-deleted') };
  };

  // Permission admin
  assert.strictEqual((await player('GET', '/api/admin/players')).status, 401);
  assert.strictEqual((await player('POST', '/api/admin/players/1/delete', {})).status, 401);
  const list = await admin('GET', '/api/admin/players?per=10&sort=username');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body.players.length, 10);
  assert.ok(list.body.total >= 56);
  assert.ok(!JSON.stringify(list.body).includes('@'), 'aucun e-mail dans la liste');

  // Inscription sur invitation
  assert.strictEqual((await admin('PUT', '/api/admin/beta/settings', { registrationMode: 'invite' })).status, 200);
  const inv1 = (await admin('POST', '/api/admin/beta/invites', { label: 'test 90', maxUses: 1 })).body.invites[0].code;
  const reg = await player('POST', '/api/register', { username: 'cobaye90', email: 'cobaye90@example.test', password: 'secret90', inviteCode: inv1 });
  assert.strictEqual(reg.status, 200, JSON.stringify(reg.body));
  const oldId = reg.body.user.id;
  const cookie = reg.cookie;
  assert.strictEqual((await player('GET', '/api/me', null, cookie)).body.user.username, 'cobaye90');

  // Partie jouée (sauvegarde) + deux témoins, dont un avec des points de récompense réels
  db.upsertUserSave(oldId, JSON.stringify({ coins: 1234, gems: 7, relicFragments: 3, depth: 18 }));
  const w1 = db.createUser('temoin1', 'temoin1@example.test', 'x');
  const w2 = db.createUser('temoin2', 'temoin2@example.test', 'x');
  db.upsertUserSave(w1.id, JSON.stringify({ coins: 11, depth: 3 }));
  db.upsertUserSave(w2.id, JSON.stringify({ coins: 22, depth: 4 }));
  db.getDb().prepare("INSERT INTO reward_point_wallets (user_id, balance, earned_total, spent_total, updated_at) VALUES (?, 5, 5, 0, datetime('now'))").run(w2.id);
  const before = [w1.id, w2.id].map(id => db.getUserSave(id).data);
  db.getDb().prepare("INSERT INTO security_events (type, user_id, details) VALUES ('test_evidence_90', ?, '{}')").run(oldId);

  // Compte avec points réels : refusé même marqué comme compte de test
  assert.strictEqual((await admin('POST', `/api/admin/players/${w2.id}/test-account`, { confirmUsername: 'temoin2', reason: 'test' })).status, 200);
  const pw2 = await admin('GET', `/api/admin/players/${w2.id}/delete-preview`);
  assert.strictEqual(pw2.body.allowed, false);
  assert.ok(pw2.body.blockers.some(b => b.code === 'reward_point_wallets'));
  const refused = await admin('POST', `/api/admin/players/${w2.id}/delete`, { confirmUsername: 'temoin2', confirmWord: 'SUPPRIMER', reason: 'essai', requestId: 'req_http_w2_01' });
  assert.strictEqual(refused.status, 409);
  assert.strictEqual((await admin('DELETE', `/api/admin/players/${w2.id}/test-account`)).body.changed, true);

  // Compte non marqué : refusé
  const nm = await admin('POST', `/api/admin/players/${oldId}/delete`, { confirmUsername: 'cobaye90', confirmWord: 'SUPPRIMER', reason: 'essai', requestId: 'req_http_c_00' });
  assert.strictEqual(nm.status, 409);
  assert.strictEqual(nm.body.code, 'blocked');

  // Marque, aperçu, suppression
  assert.strictEqual((await admin('POST', `/api/admin/players/${oldId}/test-account`, { confirmUsername: 'cobaye90', reason: 'refaire l\'inscription' })).status, 200);
  assert.strictEqual((await admin('GET', '/api/admin/players?filter=test_accounts')).body.total, 1);
  const pv = await admin('GET', `/api/admin/players/${oldId}/delete-preview`);
  assert.strictEqual(pv.body.allowed, true, JSON.stringify(pv.body.blockers));
  assert.ok(pv.body.erased.some(e => e.table === 'user_saves'));
  assert.ok(pv.body.erased.some(e => e.table === 'beta_invite_uses'));
  assert.ok(pv.body.always.some(s => /invitation/.test(s)));
  const body = { confirmUsername: 'cobaye90', confirmWord: 'SUPPRIMER', reason: 'refaire l\'inscription', requestId: 'req_http_c_01' };
  const del = await admin('POST', `/api/admin/players/${oldId}/delete`, body);
  assert.strictEqual(del.status, 200, JSON.stringify(del.body));
  assert.strictEqual(del.body.replayed, false);
  assert.strictEqual((await admin('POST', `/api/admin/players/${oldId}/delete`, body)).body.replayed, true, 'anti-rejeu');

  // Ancienne session : fermée, client prévenu une fois (purge de la save locale), puis plus rien
  const save = await player('POST', '/api/me/save', { data: { coins: 999999 }, baseRevision: 1 }, cookie);
  assert.strictEqual(save.status, 401, 'une ancienne page ne peut plus rien enregistrer');
  assert.strictEqual(save.deleted, '1');
  const me1 = await player('GET', '/api/me', null, cookie);
  assert.strictEqual(me1.body.user, null);
  assert.strictEqual(me1.body.accountDeleted, true);
  const me2 = await player('GET', '/api/me', null, cookie);
  assert.strictEqual(me2.deleted, null);
  assert.strictEqual(me2.body.accountDeleted, undefined);
  assert.strictEqual(db.getUserById(oldId), undefined);

  // Lien consommé : toujours refusé ; nouvelle invitation : même pseudo et même e-mail acceptés
  const again1 = await player('POST', '/api/register', { username: 'cobaye90', email: 'cobaye90@example.test', password: 'secret90', inviteCode: inv1 });
  assert.strictEqual(again1.status, 403);
  const inv2 = (await admin('POST', '/api/admin/beta/invites', { label: 'test 90 bis', maxUses: 1 })).body.invites[0].code;
  const again2 = await player('POST', '/api/register', { username: 'cobaye90', email: 'cobaye90@example.test', password: 'secret90', inviteCode: inv2 }, cookie);
  assert.strictEqual(again2.status, 200, JSON.stringify(again2.body));
  const newId = again2.body.user.id;
  assert.ok(newId > oldId, 'nouvel identifiant');
  assert.strictEqual(db.getUserSave(newId), null, 'compte neuf : aucune ancienne sauvegarde');
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM season_rankings WHERE user_id = ?').get(newId).n, 0);
  const me3 = await player('GET', '/api/me', null, again2.cookie);
  assert.strictEqual(me3.body.user.username, 'cobaye90');
  assert.strictEqual(me3.deleted, null, 'plus de signal après la réinscription');

  // Témoins intacts ; journaux conservés (copie d'audit + événement global)
  assert.deepStrictEqual([w1.id, w2.id].map(id => db.getUserSave(id).data), before);
  const trace = db.getDb().prepare('SELECT * FROM account_deletions WHERE user_id = ?').get(oldId);
  assert.ok(JSON.parse(trace.archive).security_events.some(e => e.type === 'test_evidence_90'));
  assert.ok(!trace.archive.includes('cobaye90@example.test'), 'aucune adresse e-mail dans la trace');
  assert.ok(db.getDb().prepare("SELECT 1 FROM security_events WHERE type = 'admin_account_deleted'").get());
  const dl = await admin('GET', '/api/admin/players-deletions');
  assert.strictEqual(dl.body.deletions[0].user_id, oldId);
});

test('client : signal de compte supprimé géré, save locale d\'un autre compte jamais transférée', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.match(js, /X-Dig-Account-Deleted/);
  assert.match(js, /function _onAccountDeleted\(\)[\s\S]{0,400}Save\.purge\(\)/);
  assert.match(js, /meta && meta\.userId !== _account\.id\) \{ Save\.purge\(\)/);
  const i18n = fs.readFileSync(path.join(ROOT, 'public/js/i18n.js'), 'utf8');
  assert.strictEqual((i18n.match(/account_deleted:/g) || []).length, 4);
});
