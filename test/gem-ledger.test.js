/**
 * Registre de gemmes de référence (#49, lot 1) : désactivé par défaut (aucune écriture), ouverture
 * sans retrait, crédits des seuls blocs validés, allocation journalière des sources déclarées,
 * dépenses Auto-Dig, plafond de saison, rejeu et désordre sans effet, dépenses atomiques et
 * idempotentes (y compris depuis plusieurs processus), redémarrage, mode « fait foi », et de bout en
 * bout : routes admin protégées, sauvegarde jamais modifiée en observation.
 * Base temporaire hors server/data/.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const vm       = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_GEMS || '3176';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-gems-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const gems         = require('../server/gemLedger');

let season;
let userSeq = 0;
let rev = 0;
const DAY1 = Date.parse('2026-11-04T10:00:00Z');
const DAY2 = Date.parse('2026-11-05T10:00:00Z');

function newUser() {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`gems_${++userSeq}`, 'x').lastInsertRowid;
}
function setAccepted(userId, depth) {
  db.upsertDepthTracking(userId, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: depth, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
}
/** Sauvegarde type : gemmes déclarées, blocs déclarés, Auto-Dig, saison. */
const save = (g, mined = {}, autodig = 0, seasonId = season.id) => ({ gems: g, upgrades: { autodig }, stats: { minedByType: mined }, seasonStats: { seasonId } });
/** Blocs validés par le serveur (#38) puis observation, comme POST /api/me/save. */
function play(userId, depth, data, opts = {}) {
  if (depth !== null) { setAccepted(userId, depth); badges.processSave(userId, data); }
  return gems.observeSave(userId, data, { revision: opts.revision ?? ++rev, nowMs: opts.nowMs ?? DAY1, force: true, ...opts });
}
const account = u => db.getDb().prepare('SELECT * FROM gem_accounts WHERE user_id = ?').get(u);
const anomalies = (u, kind) => db.getDb().prepare('SELECT * FROM gem_anomalies WHERE user_id = ? AND kind = ?').all(u, kind);

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  gems.init();
  gems.init();   // idempotent
  season = db.getActiveSeason();
  assert.ok(season, 'saison active du seed');
});

test.after(() => {
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('coûts Auto-Dig en gemmes = public/js/balance.js ; valeurs par bloc = catalogue publié', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(path.join(ROOT, 'public/js/balance.js'), 'utf8')}\n;this.Balance = Balance;`, ctx);
  ctx.Balance.AUTODIG.forEach((c, i) => assert.strictEqual(gems.AUTODIG_GEM_COST[i + 1], c.gems, `niveau ${i + 1}`));
  const v = gems.gemValues();
  for (const t of blockCatalog.getPublished().types.filter(x => x.category === 'gemme')) assert.strictEqual(v[t.id], t.gemReward === false ? 0 : 1, t.id);
  assert.ok(Object.keys(v).length >= 3);
});

test('mode par défaut « off » : aucune lecture ni écriture, sauvegarde inchangée', () => {
  assert.strictEqual(gems.getMode(), 'off');
  const u = newUser();
  const data = save(40);
  const before = JSON.stringify(data);
  assert.strictEqual(gems.observeSave(u, data, { revision: 1 }), null);
  assert.strictEqual(account(u), undefined);
  assert.strictEqual(gems.mergeInto(u, data), null);
  assert.strictEqual(JSON.stringify(data), before);
});

test('ouverture : solde repris sans retrait ; rejeu et révision ancienne sans effet', () => {
  const u = newUser();
  const r = play(u, null, save(57, {}, 4), { revision: 10 });
  assert.deepStrictEqual([r.opened, r.balance], [true, 57]);
  assert.strictEqual(account(u).opening, 57);
  assert.ok(play(u, null, save(999), { revision: 10 }).replayed);
  assert.ok(play(u, null, save(999), { revision: 9 }).replayed);
  assert.strictEqual(account(u).balance, 57);
  assert.strictEqual(anomalies(u, 'excess_declared').length, 0);
});

test('blocs gemmes : seuls les blocs validés sont crédités ; blocs déclarés sans mètre validé → écart noté, jamais crédité', () => {
  const u = newUser();
  play(u, 40, save(0, { terre_meuble: 40 }), {});
  // 3 rubis minés, profondeur retenue 40 m (rubis ≥ 35 m) : 3 blocs validés
  const r = play(u, 43, save(3, { rubis: 3 }));
  assert.strictEqual(r.credited, 3);
  assert.strictEqual(account(u).balance, 3);
  // Client falsifié : 500 rubis déclarés, aucun mètre de plus validé
  const f = play(u, 43, save(503, { rubis: 503 }));
  assert.strictEqual(f.credited, 0);
  assert.strictEqual(account(u).balance, 3);
  assert.strictEqual(account(u).drift, 500);
  assert.strictEqual(anomalies(u, 'excess_declared').length, 0, 'gemmes de blocs déclarées : jamais créditées hors validation');
  // Plus tard, les blocs sont validés : crédit rattrapé une seule fois
  const g = play(u, 46, save(506, { rubis: 506 }));
  assert.strictEqual(g.credited, 3);
});

test('sources déclarées (série, missions) : allocation par jour, surplus noté et non crédité', () => {
  const u = newUser();
  play(u, null, save(10), { nowMs: DAY1 });
  assert.strictEqual(play(u, null, save(14), { nowMs: DAY1 }).credited, 4);     // série jour 7
  const r = play(u, null, save(30), { nowMs: DAY1 });                          // +16 déclarées
  assert.deepStrictEqual([r.credited, r.excess], [4, 12]);                      // allocation 8/jour
  assert.strictEqual(account(u).balance, 18);
  assert.strictEqual(anomalies(u, 'excess_declared')[0].amount, 12);
  assert.strictEqual(play(u, null, save(31), { nowMs: DAY2 }).credited, 1, 'nouveau jour : nouvelle allocation');
});

test('dépenses Auto-Dig, baisse côté client, plafond de nouvelle saison, reset admin', () => {
  const u = newUser();
  play(u, null, save(80, {}, 2));
  const r = play(u, null, save(68, {}, 4));            // Auto-Dig 3 + 4 = 12 gemmes
  assert.deepStrictEqual([r.debited, r.excess, r.loss], [12, 0, 0]);
  assert.strictEqual(account(u).balance, 68);
  const l = play(u, null, save(60, {}, 4));             // perte côté client inexpliquée
  assert.strictEqual(l.loss, 8);
  assert.strictEqual(account(u).balance, 68, 'le solde de référence ne baisse pas');
  // Nouvelle saison, plafond 50 : plafonné une fois, Auto-Dig repart de 0 sans remboursement
  const s2 = db.getDb().prepare("INSERT INTO seasons (name, start_at, end_at, status) VALUES ('S-test', datetime('now'), datetime('now', '+7 days'), 'scheduled')").run().lastInsertRowid;
  const c = play(u, null, save(50, {}, 0, s2), { gemsCap: 50 });
  assert.deepStrictEqual([c.balance, c.loss], [50, 0]);
  const capRows = db.getDb().prepare("SELECT * FROM gem_ledger WHERE user_id = ? AND reason = 'season_cap'").all(u);
  assert.deepStrictEqual(capRows.map(x => x.delta), [-18]);
  assert.strictEqual(play(u, null, save(46, {}, 3, s2), { gemsCap: 50 }).debited, 4);
  // Reset admin : niveau qui baisse = nouvelle référence, aucun remboursement
  gems.setMode('observe');
  gems.onAdminSeasonReset(u, 40, { revision: ++rev });
  assert.strictEqual(account(u).balance, 40);
  const z = play(u, null, save(40, {}, 0, s2));
  assert.deepStrictEqual([z.credited, z.debited, z.loss, z.excess], [0, 0, 0, 0]);
  gems.setMode('off');
});

test('dépense : atomique, idempotente, refus si solde insuffisant ; crédit idempotent', () => {
  const u = newUser();
  assert.throws(() => gems.spend(u, 5, 'achat-1'), e => e.status === 409 && e.code === 'no_account');
  play(u, null, save(30));
  const a = gems.spend(u, 20, 'achat-1', { details: { item: 'pioche_doree' } });
  assert.deepStrictEqual([a.balance, a.replayed], [10, false]);
  assert.deepStrictEqual(gems.spend(u, 20, 'achat-1'), { balance: 10, replayed: true, entryId: a.entryId });
  assert.throws(() => gems.spend(u, 20, 'achat-2'), e => e.status === 409 && e.code === 'insufficient');
  assert.strictEqual(account(u).balance, 10);
  for (const bad of [0, -1, 1.5, '3']) assert.throws(() => gems.spend(u, bad, 'x'), e => e.status === 400);
  assert.throws(() => gems.spend(u, 1, 'bad key with spaces'), e => e.status === 400);
  // Le client retire aussi les 20 gemmes : pas de « perte » signalée
  assert.strictEqual(play(u, null, save(10)).loss, 0);
  assert.strictEqual(gems.credit(u, 5, 'compensation-1').balance, 15);
  assert.strictEqual(gems.credit(u, 5, 'compensation-1').replayed, true);
  const ledger = gems.playerLedger(u);
  assert.strictEqual(ledger.account.balance, 15);
  assert.deepStrictEqual(ledger.entries.map(e => e.reason), ['admin_credit', 'purchase', 'opening']);
});

test('achats simultanés depuis 4 processus : jamais plus que le solde', () => {
  const u = newUser();
  play(u, null, save(25));
  const script = `
    process.env.DB_FILE = ${JSON.stringify(process.env.DB_FILE)};
    const db = require(${JSON.stringify(path.join(ROOT, 'server/db'))}); db.initDb();
    const g = require(${JSON.stringify(path.join(ROOT, 'server/gemLedger'))});
    const out = [];
    for (let i = 0; i < 5; i++) { try { g.spend(${u}, 4, 'p' + process.argv[1] + '-' + i); out.push('ok'); } catch (e) { out.push(e.code || e.message); } }
    console.log(JSON.stringify(out));`;
  const procs = [0, 1, 2, 3].map(i => spawn(process.execPath, ['-e', script, String(i)], { cwd: ROOT }));
  return Promise.all(procs.map(p => new Promise(r => { let o = ''; p.stdout.on('data', d => { o += d; }); p.stderr.on('data', d => { o += d; }); p.on('exit', () => r(o)); })))
    .then(outs => {
      const results = outs.flatMap(o => JSON.parse(o.trim().split('\n').pop()));
      assert.strictEqual(results.filter(x => x === 'ok').length, 6, outs.join('\n'));   // 25 / 4 = 6 achats
      assert.ok(results.filter(x => x !== 'ok').every(x => x === 'insufficient'));
      assert.strictEqual(account(u).balance, 1);
      const sum = db.getDb().prepare('SELECT SUM(delta) AS s FROM gem_ledger WHERE user_id = ?').get(u).s;
      assert.strictEqual(sum, 1, 'journal = solde');
    });
});

test('mode « fait foi » : solde de référence injecté ; changement de mode journalisé ; redémarrage', () => {
  const u = newUser();
  play(u, null, save(12));
  gems.setMode('enforce', { note: 'test' });
  const r = play(u, null, save(999));                // falsification : 987 de plus, 8 crédités au plus
  assert.strictEqual(r.balance, 20);
  const data = save(999);
  assert.strictEqual(gems.mergeInto(u, data), 20);
  assert.strictEqual(data.gems, 20);
  assert.strictEqual(account(u).last_client, 20, 'le client reprend le solde renvoyé');
  assert.throws(() => gems.setMode('tout'), e => e.status === 400);
  assert.deepStrictEqual(gems.adminSummary().audit.slice(0, 1).map(a => [a.old_value, a.new_value]), [['off', 'enforce']]);
  gems.setMode('off');
  // Redémarrage : nouveau processus sur la même base, init sans effet, rien perdu
  const script = `
    process.env.DB_FILE = ${JSON.stringify(process.env.DB_FILE)};
    const db = require(${JSON.stringify(path.join(ROOT, 'server/db'))}); db.initDb();
    const g = require(${JSON.stringify(path.join(ROOT, 'server/gemLedger'))}); g.init();
    console.log(JSON.stringify({ mode: g.getMode(), balance: g.playerLedger(${u}).account.balance }));`;
  const out = require('child_process').execFileSync(process.execPath, ['-e', script], { cwd: ROOT, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(out.trim().split('\n').pop()), { mode: 'off', balance: 20 });
});

// ── HTTP de bout en bout ──────────────────────────────────────────────────────

test('HTTP : routes admin protégées, désactivé par défaut, observation sans modifier la sauvegarde, mode « fait foi »', async () => {
  const httpDb = path.join(dir, 'http.sqlite');
  const adminSecret = crypto.randomBytes(16).toString('hex');
  const env = { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: adminSecret, SESSION_SECRET: crypto.randomBytes(16).toString('hex') };
  let log = '';
  const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, log);
  const admin = { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' };
  const call = (method, p, body, headers = admin) => fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  try {
    for (const [m, p] of [['GET', '/api/admin/economy/gems'], ['GET', '/api/admin/economy/gems/players/1'], ['POST', '/api/admin/economy/gems/mode']]) {
      assert.strictEqual((await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'POST' ? '{}' : undefined })).status, 401, p);
    }
    assert.strictEqual((await (await call('GET', '/api/admin/economy/gems')).json()).mode, 'off');
    const seasonId = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season.id;
    const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'gemshttp', email: 'gemshttp@example.invalid', password: 'secret123' }) });
    assert.strictEqual(reg.status, 200);
    const player = { Cookie: reg.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    let baseRevision = null;
    const send = async g => {
      const r = await call('POST', '/api/me/save', { data: { coins: 5, gems: g, lastSaveTime: Date.now(), upgrades: { autodig: 0 }, seasonStats: { seasonId } }, baseRevision }, player);
      const body = await r.json();
      if (r.ok) baseRevision = body.revision;
      return { status: r.status, body };
    };
    const r0 = await send(30);
    assert.strictEqual(r0.status, 200);
    assert.strictEqual(r0.body.gems, undefined, 'off : aucun champ gems');
    // Observation : confirmation obligatoire, ENFORCE exige une saisie
    assert.strictEqual((await call('POST', '/api/admin/economy/gems/mode', { mode: 'observe' })).status, 400);
    assert.strictEqual((await call('POST', '/api/admin/economy/gems/mode', { mode: 'enforce', confirm: true })).status, 400);
    assert.strictEqual((await call('POST', '/api/admin/economy/gems/mode', { mode: 'observe', confirm: true, note: 'test' })).status, 200);
    assert.strictEqual((await send(30)).body.gems, undefined, 'observe : rien de renvoyé');
    const r2 = await send(500);
    assert.strictEqual(r2.status, 200);
    const stored = await (await call('GET', '/api/me/save', null, player)).json();
    assert.strictEqual(stored.save.data.gems, 500, 'observe : sauvegarde jamais modifiée');
    const sum = await (await call('GET', '/api/admin/economy/gems')).json();
    assert.strictEqual(sum.totals.accounts, 1);
    assert.strictEqual(sum.totals.balance, 38);
    assert.deepStrictEqual(sum.anomalyTotals, [{ kind: 'excess_declared', n: 1, total: 462 }]);
    const uid = sum.anomalies[0].userId;
    const pl = await (await call('GET', `/api/admin/economy/gems/players/${uid}`)).json();
    assert.deepStrictEqual([pl.account.balance, pl.account.drift], [38, 462]);
    // Fait foi : la sauvegarde renvoyée porte le solde de référence ; la sauvegarde stockée n'est pas réécrite
    assert.strictEqual((await call('POST', '/api/admin/economy/gems/mode', { mode: 'enforce', confirm: true, confirmText: 'ENFORCE' })).status, 200);
    assert.strictEqual((await send(500)).body.gems, 38);
    assert.strictEqual((await (await call('GET', '/api/me/save', null, player)).json()).save.data.gems, 38);
    const Database = require('better-sqlite3');
    const raw = new Database(httpDb, { readonly: true });
    assert.strictEqual(JSON.parse(raw.prepare('SELECT data FROM user_saves WHERE user_id = ?').get(uid).data).gems, 500);
    raw.close();
  } finally {
    await new Promise(r => { server.once('exit', r); server.kill('SIGTERM'); });
  }
});

test('jeu : écart renvoyé par le serveur appliqué sans perdre les gemmes gagnées depuis l\'envoi', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.match(src, /GameState\.gems = Math\.max\(0, GameState\.gems \+ res\.data\.gems - \(data\.gems \?\? 0\)\)/);
});
