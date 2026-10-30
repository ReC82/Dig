/**
 * Tests de la boutique de cadeaux, ticket #34 :
 * - catalogue : validation (titre FR, coût, image, dates, territoires), mise à jour tracée,
 *   suppression interdite ;
 * - échange : débit atomique et idempotent (même requête = même commande, un seul débit),
 *   solde insuffisant sans écriture, stock, limite par joueur, période de validité, article
 *   masqué/indisponible, échanges fermés, cadeaux réels verrouillés ;
 * - commandes : transitions admin, annulation joueur/admin = remboursement + remise en stock une
 *   seule fois, notes sans e-mail ni code, journal en ajout seul, registre cohérent ;
 * - routes HTTP joueur et admin (serveur de test, port ≠ 3000, base temporaire).
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
const PORT  = process.env.DIG_TEST_PORT_SHOP || '3146';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-shop-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
delete process.env.CONTEST_REAL_PRIZES;

const db     = require('../server/db');
const points = require('../server/rewardPoints');
const shop   = require('../server/shop');

db.initDb();
const conn = () => db.getDb();

let userSeq = 0;
function newUser(balance = 0) {
  const id = conn().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(`shop_user_${++userSeq}`, 'x').lastInsertRowid;
  if (balance) points.adminAdjust(id, balance, { reason: 'test boutique' });
  return id;
}

const ITEM = { texts: { fr: { title: 'Titre honorifique', description: 'Affiché sur ton profil' }, en: { title: 'Honorary title' } }, cost: 30, visible: true };
let rid = 0;
const req = () => `req-${Date.now()}-${++rid}`;
const code = fn => { try { fn(); } catch (e) { return e.status ?? e.message; } return 'ok'; };

test('catalogue : validation, mise à jour tracée, jamais supprimé', () => {
  assert.strictEqual(code(() => shop.createItem({ ...ITEM, texts: { en: { title: 'x' } } })), 400, 'titre FR obligatoire');
  for (const bad of [{ cost: 0 }, { cost: 1.5 }, { kind: 'mystery' }, { image_url: 'javascript:alert(1)' }, { image_url: '//evil.test/x.png' },
    { image_url: 'http://x.test/a.png' }, { currency: 'EURO' }, { territories: 'BEL' }, { valid_from: '2026-12-01 00:00:00', valid_until: '2026-11-01 00:00:00' },
    { stock_remaining: -1 }, { max_per_user: 0 }, { icon: '🎁🎁🎁🎁🎁' }]) {
    assert.strictEqual(code(() => shop.createItem({ ...ITEM, ...bad })), 400, JSON.stringify(bad));
  }
  const it = shop.createItem({ ...ITEM, image_url: '/icons/gift.png', territories: 'be, fr,BE', currency: 'eur', icon: '🎖️' });
  assert.deepStrictEqual([it.kind, it.cost, it.territories, it.currency, it.visible, it.stock_remaining], ['virtual', 30, 'BE,FR', 'EUR', true, null]);
  const up = shop.updateItem(it.id, { cost: 25, stock_remaining: 3 });
  assert.deepStrictEqual([up.cost, up.stock_remaining, up.texts.fr.title], [25, 3, 'Titre honorifique'], 'fusion avec l\'existant');
  const audit = shop.listAudit().filter(a => a.item_id === it.id);
  assert.deepStrictEqual(audit.map(a => a.action).sort(), ['item_create', 'item_update']);
  assert.deepStrictEqual(audit.find(a => a.action === 'item_update').details.cost, { before: 30, after: 25 });
  assert.throws(() => conn().prepare('DELETE FROM shop_items WHERE id = ?').run(it.id), /suppression interdite/);
  assert.strictEqual(code(() => shop.updateItem(9999, { cost: 3 })), 404);
});

test('échange : débit atomique et idempotent, solde insuffisant sans écriture', () => {
  const it = shop.createItem({ ...ITEM, cost: 40, stock_remaining: 5 });
  const poor = newUser(39);
  assert.strictEqual(code(() => shop.placeOrder(poor, it.id, req())), 409);
  assert.strictEqual(points.getWallet(poor).balance, 39);
  assert.strictEqual(shop.getItem(it.id).stock_remaining, 5, 'stock intact');
  assert.strictEqual(conn().prepare('SELECT COUNT(*) AS n FROM shop_orders WHERE user_id = ?').get(poor).n, 0);

  const u = newUser(100);
  const r1 = req();
  const a = shop.placeOrder(u, it.id, r1);
  const b = shop.placeOrder(u, it.id, r1);
  assert.deepStrictEqual([a.duplicate, b.duplicate, a.order.id === b.order.id], [false, true, true]);
  assert.deepStrictEqual([a.order.status, a.order.cost, a.wallet.balance, b.wallet.balance], ['pending', 40, 60, 60]);
  assert.strictEqual(shop.getItem(it.id).stock_remaining, 4, 'un seul décrément');
  assert.strictEqual(conn().prepare("SELECT COUNT(*) AS n FROM reward_point_ledger WHERE user_id = ? AND kind = 'spend'").get(u).n, 1);
  assert.strictEqual(code(() => shop.placeOrder(u, 9999, r1)), 409, 'même requête, autre article');
  assert.strictEqual(code(() => shop.placeOrder(u, it.id, 'x')), 400, 'requestId trop court');
  const spend = conn().prepare("SELECT * FROM reward_point_ledger WHERE user_id = ? AND kind = 'spend'").get(u);
  assert.deepStrictEqual([spend.use, spend.delta], ['virtual', -40]);
  assert.strictEqual(points.verifyLedger().ok, true);
});

test('échange : stock, limite par joueur, validité, masqué, indisponible, fermé, réel verrouillé', () => {
  const u = newUser(1000);
  const last = shop.createItem({ ...ITEM, cost: 1, stock_remaining: 1 });
  shop.placeOrder(u, last.id, req());
  assert.strictEqual(code(() => shop.placeOrder(newUser(10), last.id, req())), 409, 'rupture');
  assert.strictEqual(shop.getItem(last.id).stock_remaining, 0);

  const lim = shop.createItem({ ...ITEM, cost: 1, max_per_user: 2 });
  shop.placeOrder(u, lim.id, req()); const o2 = shop.placeOrder(u, lim.id, req());
  assert.strictEqual(code(() => shop.placeOrder(u, lim.id, req())), 409, 'limite par joueur');
  shop.cancelByPlayer(u, o2.order.id);
  assert.strictEqual(code(() => shop.placeOrder(u, lim.id, req())), 'ok', 'une commande annulée ne compte plus');

  const future = shop.createItem({ ...ITEM, cost: 1, valid_from: '2099-01-01 00:00:00' });
  assert.strictEqual(code(() => shop.placeOrder(u, future.id, req())), 409);
  const past = shop.createItem({ ...ITEM, cost: 1, valid_until: '2020-01-01 00:00:00' });
  assert.strictEqual(code(() => shop.placeOrder(u, past.id, req())), 409);
  assert.ok(!shop.publicCatalog().items.some(i => i.id === past.id), 'article expiré retiré du catalogue');
  const hidden = shop.createItem({ ...ITEM, cost: 1, visible: false });
  assert.strictEqual(code(() => shop.placeOrder(u, hidden.id, req())), 404);
  assert.ok(!shop.publicCatalog().items.some(i => i.id === hidden.id), 'article masqué absent du catalogue');
  const off = shop.createItem({ ...ITEM, cost: 1, unavailable: true });
  assert.strictEqual(code(() => shop.placeOrder(u, off.id, req())), 409);
  assert.strictEqual(shop.publicCatalog().items.find(i => i.id === off.id).blocked, 'unavailable');

  const ok = shop.createItem({ ...ITEM, cost: 1 });
  shop.updateSettings({ exchangesOpen: false, notice: 'Maintenance' });
  assert.strictEqual(code(() => shop.placeOrder(u, ok.id, req())), 409, 'échanges fermés');
  assert.deepStrictEqual([shop.publicCatalog().exchangesOpen, shop.publicCatalog().notice], [false, 'Maintenance']);
  shop.updateSettings({ exchangesOpen: true, notice: '' });

  const real = shop.createItem({ ...ITEM, kind: 'real', cost: 1, face_value_cents: 500, currency: 'EUR', territories: 'BE' });
  const before = points.getWallet(u).balance;
  assert.strictEqual(code(() => shop.placeOrder(u, real.id, req())), 403, 'cadeaux réels verrouillés (#27)');
  assert.strictEqual(points.getWallet(u).balance, before);
  assert.strictEqual(shop.publicCatalog().items.find(i => i.id === real.id).blocked, 'real_locked');
  // Déverrouillé (simulation de la décision future) : e-mail vérifié exigé
  process.env.CONTEST_REAL_PRIZES = 'on';
  try {
    assert.strictEqual(code(() => shop.placeOrder(u, real.id, req())), 403, 'e-mail non vérifié');
    conn().prepare("UPDATE users SET email = 'x@example.test', email_verified_at = datetime('now') WHERE id = ?").run(u);
    const o = shop.placeOrder(u, real.id, req());
    assert.strictEqual(conn().prepare('SELECT use FROM reward_point_ledger WHERE id = (SELECT spend_ledger_id FROM shop_orders WHERE id = ?)').get(o.order.id).use, 'real');
  } finally { delete process.env.CONTEST_REAL_PRIZES; }
  assert.strictEqual(points.verifyLedger().ok, true);
});

test('commandes : transitions, annulation remboursée une seule fois, notes sûres, journal', () => {
  const it = shop.createItem({ ...ITEM, cost: 10, stock_remaining: 2 });
  const u = newUser(50);
  const o = shop.placeOrder(u, it.id, req()).order;
  assert.strictEqual(code(() => shop.transition(o.id, 'shipped')), 400);
  assert.strictEqual(code(() => shop.transition(o.id, 'processing', 'envoyer à joueur@example.test')), 400, 'pas d\'e-mail');
  assert.strictEqual(code(() => shop.transition(o.id, 'processing', 'code ABCD-1234-EFGH')), 400, 'pas de code cadeau');
  assert.strictEqual(shop.transition(o.id, 'processing', 'préparation').status, 'processing');
  assert.strictEqual(code(() => shop.cancelByPlayer(u, o.id)), 409, 'le joueur n\'annule plus une commande en préparation');
  assert.strictEqual(code(() => shop.cancelByPlayer(newUser(), o.id)), 404, 'commande d\'un autre joueur');
  const c = shop.transition(o.id, 'cancelled', 'erreur de catalogue');
  assert.deepStrictEqual([c.status, c.note, points.getWallet(u).balance, shop.getItem(it.id).stock_remaining], ['cancelled', 'erreur de catalogue', 50, 2]);
  assert.strictEqual(code(() => shop.transition(o.id, 'cancelled')), 409, 'pas de second remboursement');

  const o2 = shop.placeOrder(u, it.id, req()).order;
  shop.cancelByPlayer(u, o2.id);
  shop.cancelByPlayer(u, o2.id);   // idempotent
  assert.strictEqual(points.getWallet(u).balance, 50);
  assert.strictEqual(conn().prepare("SELECT COUNT(*) AS n FROM reward_point_ledger WHERE user_id = ? AND kind = 'refund'").get(u).n, 2);

  const o3 = shop.placeOrder(u, it.id, req()).order;
  assert.strictEqual(shop.transition(o3.id, 'delivered').status, 'delivered');
  assert.strictEqual(code(() => shop.transition(o3.id, 'cancelled')), 409, 'remise définitive');
  assert.deepStrictEqual(shop.buildPlayerView(u).orders.map(x => x.status), ['delivered', 'cancelled', 'cancelled']);

  assert.throws(() => conn().prepare('DELETE FROM shop_orders').run(), /suppression interdite/);
  assert.throws(() => conn().prepare("UPDATE shop_audit SET action = 'x'").run(), /ajout seul/);
  assert.throws(() => conn().prepare('DELETE FROM shop_audit').run(), /ajout seul/);
  const actions = shop.listAudit().filter(a => a.user_id === u).map(a => `${a.actor}:${a.action}`);
  for (const x of ['player:order_create', 'admin:order_status', 'admin:order_cancel', 'player:order_cancel']) assert.ok(actions.includes(x), x);
  assert.ok(!JSON.stringify(shop.listAudit()).includes('@'), 'aucune adresse dans le journal');
  assert.strictEqual(points.verifyLedger().ok, true);
});

// ── Routes HTTP ───────────────────────────────────────────────────────────────

test('routes : catalogue, échange, annulation, administration', async (t) => {
  const httpDb = path.join(dir, 'http.sqlite');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
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
  const call = async (method, url, body, { auth = true, cookie } = {}) => {
    const res = await fetch(BASE + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  let r = await call('GET', '/api/shop', undefined, { auth: false });
  assert.deepStrictEqual([r.status, r.body.items, r.body.exchangesOpen, r.body.realEnabled], [200, [], true, false], 'catalogue vide par défaut');
  r = await call('GET', '/api/shop/me', undefined, { auth: false });
  assert.strictEqual(r.status, 401);
  r = await call('POST', '/api/shop/orders', { itemId: 1, requestId: 'abcdefgh12' }, { auth: false });
  assert.strictEqual(r.status, 401);

  r = await call('GET', '/api/admin/shop', undefined, { auth: false });
  assert.strictEqual(r.status, 401);
  r = await call('POST', '/api/admin/shop/items', { item: { texts: { fr: { title: '' } }, cost: 5 } });
  assert.strictEqual(r.status, 400);
  r = await call('POST', '/api/admin/shop/items', { item: { ...ITEM, cost: 4, stock_remaining: 1 } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const itemId = r.body.item.id;
  r = await call('POST', '/api/admin/shop/items', { item: { ...ITEM, kind: 'real', cost: 1, texts: { fr: { title: 'Carte cadeau 5 €' } } } });
  const realId = r.body.item.id;
  r = await call('PUT', '/api/admin/shop/items/abc', { item: { cost: 3 } });
  assert.strictEqual(r.status, 400);

  const reg = await fetch(`${BASE}/api/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'acheteur', email: 'acheteur@example.test', password: 'motdepasse-solide-34' }),
  });
  assert.strictEqual(reg.status, 200, 'inscription');
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  const sdb = new (require('better-sqlite3'))(httpDb);
  const uid = sdb.prepare("SELECT id FROM users WHERE username = 'acheteur'").get().id;
  sdb.close();
  r = await call('POST', '/api/admin/points/adjust', { userId: uid, amount: 10, reason: 'test boutique' });
  assert.strictEqual(r.status, 200);

  r = await call('GET', '/api/shop', undefined, { auth: false });
  assert.deepStrictEqual(r.body.items.map(i => [i.id, i.blocked]), [[itemId, null], [realId, 'real_locked']]);
  r = await call('POST', '/api/shop/orders', { itemId: realId, requestId: 'reel-000001' }, { auth: false, cookie });
  assert.strictEqual(r.status, 403);
  r = await call('POST', '/api/shop/orders', { itemId, requestId: 'achat-000001' }, { auth: false, cookie });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual([r.body.order.status, r.body.wallet.balance, r.body.duplicate], ['pending', 6, false]);
  const orderId = r.body.order.id;
  r = await call('POST', '/api/shop/orders', { itemId, requestId: 'achat-000001' }, { auth: false, cookie });
  assert.deepStrictEqual([r.status, r.body.duplicate, r.body.wallet.balance], [200, true, 6], 'renvoi = même commande');
  r = await call('POST', '/api/shop/orders', { itemId, requestId: 'achat-000002' }, { auth: false, cookie });
  assert.strictEqual(r.status, 409, 'rupture de stock');
  r = await call('GET', '/api/shop/me', undefined, { auth: false, cookie });
  assert.deepStrictEqual([r.body.balance, r.body.orders.length, r.body.orders[0].texts.fr.title], [6, 1, 'Titre honorifique']);

  r = await call('POST', `/api/shop/orders/${orderId}/cancel`, {}, { auth: false, cookie });
  assert.deepStrictEqual([r.status, r.body.order.status, r.body.wallet.balance], [200, 'cancelled', 10]);
  r = await call('POST', '/api/shop/orders', { itemId, requestId: 'achat-000003' }, { auth: false, cookie });
  assert.strictEqual(r.status, 200, 'stock rendu après annulation');
  const o2 = r.body.order.id;

  r = await call('GET', '/api/admin/shop');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.items.length, r.body.orders[0].username, r.body.orders[0].transitions, r.body.ledger.ok],
    [2, 'acheteur', ['processing', 'delivered', 'cancelled'], true]);
  r = await call('POST', `/api/admin/shop/orders/${o2}/status`, { status: 'delivered', note: 'remis en jeu' });
  assert.deepStrictEqual([r.status, r.body.order.status], [200, 'delivered']);
  r = await call('POST', `/api/admin/shop/orders/${o2}/status`, { status: 'cancelled' });
  assert.strictEqual(r.status, 409);
  r = await call('PUT', '/api/admin/shop/settings', { exchangesOpen: false });
  assert.deepStrictEqual([r.status, r.body.settings.exchangesOpen], [200, false]);
  r = await call('GET', '/api/admin/shop/audit');
  assert.ok(r.body.audit.length >= 6);
  assert.ok(!log.includes('acheteur@example.test'), 'aucune adresse dans la console');
});

test.after(() => {
  try { db.getDb().close(); } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true });
});
