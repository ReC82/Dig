/**
 * Règles économiques versionnées et boutique en gemmes (#49, lots 1.2 et 2.6) :
 * - migration : v1 = valeurs en vigueur (code du jeu, ⚙ Config, tables #37), barème A en brouillon,
 *   init idempotente, versions et journal en ajout seul ;
 * - validation, préréglages, publication explicite (note obligatoire, version périmée refusée),
 *   retour arrière ; simulation comparative dans un processus séparé ;
 * - boutique en gemmes fermée par défaut, ouverture refusée sans registre « fait foi », achat
 *   atomique et idempotent, article permanent acheté une fois, solde insuffisant ;
 * - HTTP : routes admin protégées, boutique fermée pour le joueur, confirmations obligatoires.
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
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.DIG_TEST_PORT_ECONOMY_RULES || '3178';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-ecorules-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const rewardTables = require('../server/rewardTables');
const badges       = require('../server/badges');
const gems         = require('../server/gemLedger');
const rules        = require('../server/economyRules');
const gemShop      = require('../server/gemShop');

let season;
let userSeq = 0;
const newUser = () => db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`eco_${++userSeq}`, 'x').lastInsertRowid;
/** Ouvre un compte de référence au solde `g` (gemmes déclarées à la première observation). */
const openAccount = (u, g) => gems.observeSave(u, { gems: g, upgrades: { autodig: 0 }, stats: { minedByType: {} }, seasonStats: { seasonId: season.id } },
  { revision: 1, nowMs: Date.now(), force: true });

test.before(() => {
  db.initDb();
  blockCatalog.init();
  rewardTables.init();
  badges.init();
  gems.init();
  rules.init();
  rules.init();   // idempotent
  gemShop.init();
  gemShop.init();
  season = db.getActiveSeason();
});

test.after(() => {
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration : v1 = valeurs en vigueur, barème A en brouillon, ajout seul', () => {
  const v1 = rules.getPublished();
  assert.strictEqual(v1.version, 1);
  assert.strictEqual(rules.listVersions().length, 1, 'init idempotente');
  assert.deepStrictEqual(v1.rules, rules.currentValues());
  const g = v1.rules.gems;
  assert.deepStrictEqual(g.perBlock, gems.gemValues());
  assert.deepStrictEqual(g.dailyStreak, [0, 0, 1, 0, 2, 0, 4]);
  assert.deepStrictEqual(g.autodig, { 3: 4, 4: 8, 5: 18, 6: 35 });
  assert.strictEqual(g.missionSetBonus, 0);
  assert.strictEqual(g.seasonCap, 100);
  assert.deepStrictEqual(v1.rules.coins.curve, []);
  assert.deepStrictEqual(v1.rules.shopChests, { simple: { maxPerSeason: null }, rare: { maxPerSeason: null }, antique: { maxPerSeason: 5 } });
  assert.deepStrictEqual(Object.fromEntries(Object.entries(v1.rules.gemShop.items).map(([k, v]) => [k, v.price])),
    { skin_golden: 150, skin_diamond: 350, auto_collect: 30, coin_boost_30: 8 });
  const d = rules.getDraft();
  assert.strictEqual(d.basedOn, 1);
  assert.deepStrictEqual(d.rules.gems.perBlock, { ...g.perBlock, rubis: 1, saphir: 1, emeraude: 2, amethyste: 2, diamant: 3, cristal_ancien: 3 });
  assert.deepStrictEqual(d.rules.gems.mineChest.epique, { chance: 10, gems: 1 });
  assert.strictEqual(d.rules.gems.missionSetBonus, 1);
  assert.strictEqual(d.rules.gems.seasonCap, 150);
  assert.deepStrictEqual(d.rules.gems.autodig, g.autodig, 'Auto-Dig inchangé');
  assert.deepStrictEqual(d.rules.shopChests, v1.rules.shopChests, 'limites non incluses dans A');
  const view = rules.buildAdminView();
  assert.strictEqual(view.appliedToGame, false);
  assert.deepStrictEqual(view.gameVsPublished, []);
  assert.throws(() => db.getDb().prepare('UPDATE economy_rule_versions SET note = ?').run('x'), /ajout seul/);
  assert.throws(() => db.getDb().prepare('DELETE FROM economy_rule_audit').run(), /ajout seul/);
});

test('validation : bornes, courbe, champs manquants', () => {
  const base = rules.currentValues();
  assert.deepStrictEqual(rules.validateRules(base).errors, []);
  const bad = structuredClone(base);
  bad.gems.perBlock.rubis = -1;
  bad.gems.mineChest.rare.chance = 120;
  bad.gems.dailyStreak = [1, 2];
  bad.coins.curve = [{ until: null, slope: 0.05 }, { until: null, slope: 0.02 }];
  bad.shopChests.simple.maxPerSeason = 0;
  bad.gemShop.items.skin_golden.price = 0;
  const errs = rules.validateRules(bad).errors.join('\n');
  for (const re of [/rubis/, /mine rare/, /Série quotidienne/, /seul le dernier/, /simple/, /skin_golden/]) assert.match(errs, re);
  assert.ok(rules.validateRules({}).errors.length);
  assert.throws(() => rules.saveDraft(bad), e => e.status === 400);
  const ok = structuredClone(base);
  ok.coins.curve = [{ until: 200, slope: 0.05 }, { until: null, slope: 0.02 }];
  assert.deepStrictEqual(rules.validateRules(ok).errors, []);
});

test('préréglages, publication explicite, retour arrière, journal', () => {
  rules.applyPreset('limites_20_10');
  rules.applyPreset('courbe_b');
  const d = rules.getDraft();
  assert.deepStrictEqual([d.rules.shopChests.simple.maxPerSeason, d.rules.shopChests.rare.maxPerSeason], [20, 10]);
  assert.strictEqual(d.rules.gems.seasonCap, 150, 'les préréglages se cumulent');
  assert.throws(() => rules.applyPreset('inconnu'), e => e.status === 400);
  assert.throws(() => rules.publishDraft({}), /note/);
  assert.throws(() => rules.publishDraft({ note: 'x', expectedBasedOn: 7 }), e => e.status === 409);
  const p = rules.publishDraft({ note: 'test A + limites + courbe b' });
  assert.strictEqual(p.version, 2);
  assert.ok(p.changes.some(c => c.path === 'gems.seasonCap' && c.before === 100 && c.after === 150));
  assert.strictEqual(rules.getDraft(), null);
  assert.ok(rules.buildAdminView().gameVsPublished.length > 0, 'la vue signale que le jeu applique d\'autres valeurs');
  // Le jeu n'est pas touché : tables #37 et ⚙ Config inchangées
  assert.strictEqual(rewardTables.getPublished().tables.shop.simple.maxPerSeason, null);
  assert.strictEqual(db.getAdminConfig().gems_cap, '100');
  const r = rules.rollbackTo(1, {});
  assert.deepStrictEqual(r, { version: 3, restored: 1 });
  assert.deepStrictEqual(rules.getPublished().rules, rules.getVersion(1).rules);
  assert.throws(() => rules.rollbackTo(3), e => e.status === 409);
  // Brouillon identique à la version en vigueur : supprimé
  assert.strictEqual(rules.saveDraft(rules.getPublished().rules).draft, null);
  const actions = rules.listAudit().map(a => a.action);
  for (const a of ['migrate', 'draft_preset', 'publish', 'rollback']) assert.ok(actions.includes(a), a);
});

test('simulation comparative : processus séparé, mêmes graines, A > actuel en gemmes', async () => {
  const before = rules.currentValues();
  const after = structuredClone(before);
  rules.PRESETS.bareme_a.apply(after);
  const out = await rules.simulateCompare(before, before, { runs: 50 });
  for (const p of out.profiles) assert.deepStrictEqual(p.before, p.after, `${p.id} : mêmes règles → mêmes résultats`);
  const cmp = await rules.simulateCompare(before, after, { runs: 50 });
  assert.deepStrictEqual(cmp.profiles.map(p => p.id), ['debutant', 'regulier', 'assidu', 'auto']);
  for (const p of cmp.profiles) assert.ok(p.after.gemsEarned >= p.before.gemsEarned, p.id);
  assert.ok(cmp.profiles.find(p => p.id === 'regulier').after.gemsEarned > cmp.profiles.find(p => p.id === 'regulier').before.gemsEarned);
});

test('boutique en gemmes : fermée par défaut, ouverture exige le registre « fait foi »', () => {
  assert.strictEqual(gemShop.flagEnabled(), false);
  assert.strictEqual(gemShop.isOpen(), false);
  const u = newUser();
  assert.deepStrictEqual(gemShop.playerView(u), { open: false });
  assert.throws(() => gemShop.buy(u, 'skin_golden', 'req-closed-01'), e => e.status === 403);
  assert.strictEqual(gems.getMode(), 'off');
  assert.throws(() => gemShop.setEnabled(true), e => e.code === 'ledger_not_enforced');
  gems.setMode('observe');
  assert.throws(() => gemShop.setEnabled(true), e => e.code === 'ledger_not_enforced');
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM gem_shop_purchases').get().n, 0);
});

test('boutique en gemmes : achat atomique, idempotent, permanent une fois, solde insuffisant', () => {
  gems.setMode('enforce');
  assert.deepStrictEqual(gemShop.setEnabled(true, { note: 'test' }), { enabled: true, changed: true });
  const u = newUser();
  openAccount(u, 200);
  assert.strictEqual(gems.authoritativeBalance(u), 200);
  const view = gemShop.playerView(u);
  assert.strictEqual(view.open, true);
  assert.strictEqual(view.items.find(i => i.id === 'skin_golden').price, 150);
  const a = gemShop.buy(u, 'skin_golden', 'req-golden-01');
  assert.strictEqual(a.balance, 50);
  assert.strictEqual(a.replayed, false);
  const again = gemShop.buy(u, 'skin_golden', 'req-golden-01');
  assert.strictEqual(again.replayed, true);
  assert.strictEqual(again.purchase.id, a.purchase.id);
  assert.strictEqual(gems.authoritativeBalance(u), 50, 'rejeu : aucun second débit');
  assert.throws(() => gemShop.buy(u, 'coin_boost_30', 'req-golden-01'), e => e.code === 'request_reused');
  assert.throws(() => gemShop.buy(u, 'skin_golden', 'req-golden-02'), e => e.code === 'owned');
  assert.throws(() => gemShop.buy(u, 'skin_diamond', 'req-diamond-01'), e => e.code === 'insufficient');
  assert.throws(() => gemShop.buy(u, 'nope', 'req-nope-0001'), e => e.status === 404);
  assert.throws(() => gemShop.buy(u, 'coin_boost_30', 'x'), e => e.status === 400);
  for (let i = 0; i < 6; i++) gemShop.buy(u, 'coin_boost_30', `req-boost-${i}0`);
  assert.strictEqual(gems.authoritativeBalance(u), 2, 'boost consommable : 6 × 8');
  assert.throws(() => gemShop.buy(u, 'coin_boost_30', 'req-boost-99'), e => e.code === 'insufficient');
  // Un échec ne laisse ni achat ni mouvement
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM gem_shop_purchases WHERE user_id = ?').get(u).n, 7);
  assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) AS n FROM gem_ledger WHERE user_id = ? AND reason = 'gem_shop'").get(u).n, 7);
  assert.throws(() => db.getDb().prepare('DELETE FROM gem_shop_purchases').run(), /ajout seul/);
  assert.deepStrictEqual(gemShop.setEnabled(false), { enabled: false, changed: true });
  assert.throws(() => gemShop.buy(u, 'coin_boost_30', 'req-boost-77'), e => e.status === 403);
  gems.setMode('off');
});

test('HTTP : routes admin protégées, boutique fermée pour le joueur, confirmations', async () => {
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
    for (const [m, p] of [['GET', '/api/admin/economy/rules'], ['PUT', '/api/admin/economy/rules/draft'], ['POST', '/api/admin/economy/rules/publish'],
      ['POST', '/api/admin/economy/rules/simulate'], ['GET', '/api/admin/economy/gem-shop'], ['POST', '/api/admin/economy/gem-shop/flag']]) {
      assert.strictEqual((await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })).status, 401, p);
    }
    const view = await (await call('GET', '/api/admin/economy/rules')).json();
    assert.strictEqual(view.published.version, 1);
    assert.strictEqual(view.draft.rules.gems.seasonCap, 150);
    assert.deepStrictEqual(view.draft.errors, []);
    const sim = await call('POST', '/api/admin/economy/rules/simulate', { runs: 50 });
    assert.strictEqual(sim.status, 200, log);
    assert.strictEqual((await sim.json()).profiles.length, 4);
    assert.strictEqual((await call('POST', '/api/admin/economy/rules/publish', { note: 'x' })).status, 400, 'confirmation requise');
    const shop = await (await call('GET', '/api/admin/economy/gem-shop')).json();
    assert.deepStrictEqual([shop.flag, shop.open, shop.ledgerMode], [false, false, 'off']);
    assert.strictEqual((await call('POST', '/api/admin/economy/gem-shop/flag', { enabled: true, confirm: true })).status, 400, 'OUVRIR requis');
    assert.strictEqual((await call('POST', '/api/admin/economy/gem-shop/flag', { enabled: true, confirm: true, confirmText: 'OUVRIR' })).status, 409, 'registre pas en « fait foi »');
    assert.strictEqual((await fetch(`${BASE}/api/gem-shop`)).status, 401);
    const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ecohttp', email: 'ecohttp@example.invalid', password: 'secret123' }) });
    assert.strictEqual(reg.status, 200);
    const player = { Cookie: reg.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    assert.deepStrictEqual(await (await call('GET', '/api/gem-shop', null, player)).json(), { open: false });
    assert.strictEqual((await call('POST', '/api/gem-shop/buy', { itemId: 'skin_golden', requestId: 'req-http-0001' }, player)).status, 403);
  } finally {
    server.kill();
    await new Promise(r => server.once('exit', r));
  }
});
