/**
 * Lot de 10 fragments en euros (#85) — désactivé et non achetable :
 * - migration idempotente, valeurs par défaut = hypothèses de simulation (0,99 €, 1 par compte et par saison) ;
 * - activation refusée sans prestataire de paiement ; drapeau forcé en base → toujours fermé, paiement refusé ;
 * - prix et plafonds bornés (jamais illimités), journalisés, journal et commandes en ajout seul ;
 * - plafonds par compte ET par saison (commandes insérées sur base de test seulement) ;
 * - aucun chemin de crédit de fragments ; HTTP : routes admin protégées, confirmation ACTIVER, joueur { open: false } ;
 * - client : carte affichée seulement si le serveur ouvre l'offre, bouton désactivé sans paiement, 5 langues.
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
const PORT = process.env.DIG_TEST_PORT_FRAGMENT_PACK || '3186';
const BASE = `http://127.0.0.1:${PORT}`;
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-fragpack-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db = require('../server/db');
const fp = require('../server/fragmentPack');

let userSeq = 0;
const newUser = () => db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`fp_${++userSeq}`, 'x').lastInsertRowid;
const auditCount = () => db.getDb().prepare('SELECT COUNT(*) AS n FROM fragment_pack_audit').get().n;
/** Commande payée simulée (base de test uniquement : aucun code de production n'écrit cette table). */
const fakeOrder = (userId, seasonId, ref, status = 'paid') => db.getDb().prepare(`INSERT INTO fragment_pack_orders
  (user_id, season_id, pack_id, fragments, amount_cents, currency, provider, provider_ref, status) VALUES (?, ?, 'fragments_10', 10, 99, 'EUR', 'test', ?, ?)`)
  .run(userId, seasonId, ref, status);

test.before(() => {
  db.initDb();
  fp.init();
  fp.init();   // idempotent
});

test.after(() => {
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration : désactivé par défaut, hypothèses de simulation, aucune commande, aucun prestataire', () => {
  assert.strictEqual(fp.PAYMENT_PROVIDER, null);
  assert.deepStrictEqual(fp.settings(), { enabled: false, priceCents: 99, limitPerAccount: 1, limitPerSeason: 1 });
  assert.deepStrictEqual({ ...fp.PACK }, { id: 'fragments_10', fragments: 10, currency: 'EUR' });
  assert.strictEqual(fp.isOpen(), false);
  const s = fp.adminSummary();
  assert.deepStrictEqual([s.flag, s.open, s.provider, s.orders, s.audit], [false, false, null, [], []]);
  assert.strictEqual(db.getDb().prepare("SELECT COUNT(*) AS n FROM fragment_pack_settings").get().n, 4, 'init idempotente');
});

test('activation refusée tant qu\'aucun prestataire de paiement n\'est branché', () => {
  assert.throws(() => fp.setEnabled(true, { note: 'essai' }), e => e.status === 409 && e.code === 'no_payment_provider');
  assert.strictEqual(fp.flagEnabled(), false);
  assert.strictEqual(auditCount(), 0, 'refus non journalisé comme changement');
  assert.deepStrictEqual(fp.setEnabled(false), { enabled: false, changed: false });
});

test('prix et plafonds : bornés, jamais illimités, journalisés ; journal en ajout seul', () => {
  for (const bad of [{ priceCents: 0 }, { priceCents: 1000 }, { priceCents: 0.99 }, { priceCents: '99' }, { limitPerAccount: 0 },
    { limitPerAccount: 11 }, { limitPerSeason: null }, { limitPerSeason: Infinity }, {}]) {
    assert.throws(() => fp.updateSettings(bad), e => e.status === 400, JSON.stringify(bad));
  }
  assert.throws(() => fp.updateSettings({ limitPerSeason: 2 }), e => e.code === 'bad_limits', 'saison > compte refusé');
  assert.strictEqual(auditCount(), 0);
  const r = fp.updateSettings({ priceCents: 149, limitPerAccount: 3, limitPerSeason: 1 }, { note: 'scénario B' });
  assert.strictEqual(r.changed, 2, 'seules les valeurs modifiées');
  assert.deepStrictEqual(r.settings, { enabled: false, priceCents: 149, limitPerAccount: 3, limitPerSeason: 1 });
  const audit = fp.adminSummary().audit.map(a => [a.action, a.old_value, a.new_value, a.note]);
  assert.deepStrictEqual(audit.sort(), [['limit_per_account', '1', '3', 'scénario B'], ['price_cents', '99', '149', 'scénario B']]);
  assert.strictEqual(fp.updateSettings({ priceCents: 149 }).changed, 0);
  assert.throws(() => db.getDb().prepare('UPDATE fragment_pack_audit SET note = ?').run('x'), /ajout seul/);
  assert.throws(() => db.getDb().prepare('DELETE FROM fragment_pack_audit').run(), /ajout seul/);
  assert.strictEqual(fp.isOpen(), false, 'réglages sans effet sur l\'ouverture');
  fp.updateSettings({ priceCents: 99, limitPerAccount: 1 }, { note: 'retour aux hypothèses' });
});

test('drapeau forcé en base : toujours fermé, vue joueur vide, paiement refusé', () => {
  const u = newUser();
  db.getDb().prepare("UPDATE fragment_pack_settings SET value = '1' WHERE key = 'enabled'").run();
  try {
    assert.strictEqual(fp.flagEnabled(), true);
    assert.strictEqual(fp.isOpen(), false);
    assert.deepStrictEqual(fp.playerView(u, 1), { open: false });
    assert.throws(() => fp.checkout(), e => e.status === 403 && e.code === 'closed');
  } finally {
    db.getDb().prepare("UPDATE fragment_pack_settings SET value = '0' WHERE key = 'enabled'").run();
  }
});

test('plafonds par compte ET par saison ; seules les commandes payées comptent ; commandes en ajout seul', () => {
  const u = newUser();
  fp.updateSettings({ limitPerAccount: 3, limitPerSeason: 2 }, { note: 'test des plafonds' });
  assert.strictEqual(fp.remainingFor(u, 1), 2);
  fakeOrder(u, 1, 'ref-a');
  fakeOrder(u, 1, 'ref-refunded', 'refunded');
  assert.strictEqual(fp.remainingFor(u, 1), 1);
  fakeOrder(u, 1, 'ref-b');
  assert.strictEqual(fp.remainingFor(u, 1), 0, 'plafond de saison atteint');
  assert.strictEqual(fp.remainingFor(u, 2), 1, 'saison suivante : reste du compte');
  fakeOrder(u, 2, 'ref-c');
  assert.strictEqual(fp.remainingFor(u, 3), 0, 'plafond du compte atteint pour toujours');
  assert.deepStrictEqual(fp.purchasedCount(u, 1), { account: 3, season: 2 });
  assert.throws(() => fakeOrder(u, 3, 'ref-a'), /UNIQUE/, 'référence du prestataire unique (idempotence des webhooks)');
  assert.throws(() => db.getDb().prepare("UPDATE fragment_pack_orders SET status = 'paid'").run(), /ajout seul/);
  assert.throws(() => db.getDb().prepare('DELETE FROM fragment_pack_orders').run(), /ajout seul/);
  assert.strictEqual(fp.remainingFor(newUser(), 1), 2);
});

test('aucun chemin de crédit de fragments ni de paiement dans le code', () => {
  const src = read('server/fragmentPack.js');
  assert.doesNotMatch(src, /user_saves|frags|relicFragments|INSERT INTO fragment_pack_orders/, 'le module n\'écrit ni sauvegarde ni commande');
  assert.doesNotMatch(src, /stripe|paypal|mollie|apiKey|fetch\(/i, 'aucun prestataire ni appel externe');
  assert.match(src, /const PAYMENT_PROVIDER = null;/);
  const main = read('public/js/main.js');
  const fn = main.slice(main.indexOf('function _fragmentPackShopHtml'), main.indexOf('async function _buyFragmentPack'));
  assert.match(fn, /if \(!_fragPack\.open\) return '';/, 'rien affiché tant que le serveur ne l\'ouvre pas');
  assert.match(fn, /const canBuy = Monetization\.PAYMENTS_ENABLED && left > 0;/, 'bouton désactivé sans paiement');
  const buy = main.slice(main.indexOf('async function _buyFragmentPack'), main.indexOf('async function _buyFragmentPack') + 400);
  assert.doesNotMatch(buy, /GameState\.(relicFragments|frags)/, 'aucun crédit dans le navigateur');
});

test('traductions : 4 langues intégrées + italien', () => {
  const vm = require('vm');
  const ctx = { console, Intl, URLSearchParams, location: { search: '' }, localStorage: { getItem: () => null, setItem() {} },
    document: { documentElement: {}, querySelectorAll: () => [], head: { appendChild() {} }, createElement: () => ({}) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('public/js/languages.js'), ctx);
  vm.runInContext(`${read('public/js/i18n.js')}\n;this.I18n = I18n; this.t = t;`, ctx);
  vm.runInContext(read('public/js/locales/it.js'), ctx);
  const keys = ['section', 'name', 'desc', 'free', 'limit', 'left', 'transparency', 'btn_buy', 'btn_unavailable', 'btn_limit', 'error'];
  const seen = new Set();
  for (const lang of ['fr', 'en', 'nl', 'es', 'it']) {
    ctx.I18n.setLang(lang);
    for (const k of keys) {
      const v = ctx.t(`fragpack.${k}`, { n: 10, price: '0,99 €', account: 1, season: 1 });
      assert.ok(typeof v === 'string' && v && !v.includes('fragpack.') && !/\{\w+\}/.test(v), `${lang} ${k} : ${v}`);
      seen.add(`${k}|${v}`);
    }
  }
  ctx.I18n.setLang('fr');
  assert.strictEqual(ctx.t('fragpack.btn_buy', { price: '0,99 €' }), 'Acheter — 0,99 €');
  assert.ok(seen.size >= keys.length * 4, 'langues réellement traduites');
  const it = JSON.parse(read('i18n/it.json')).entries;
  for (const k of keys) assert.ok(it[`fragpack.${k}`]?.text, `it ${k}`);
});

test('HTTP : routes admin protégées, ACTIVER requis puis refus 409, joueur { open: false }, paiement 403', async () => {
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
    for (const [m, p] of [['GET', '/api/admin/economy/fragment-pack'], ['PUT', '/api/admin/economy/fragment-pack/settings'], ['POST', '/api/admin/economy/fragment-pack/flag']]) {
      assert.strictEqual((await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })).status, 401, p);
    }
    const s = await (await call('GET', '/api/admin/economy/fragment-pack')).json();
    assert.deepStrictEqual([s.flag, s.open, s.provider, s.offer.priceCents, s.offer.fragments], [false, false, null, 99, 10]);
    assert.strictEqual((await call('POST', '/api/admin/economy/fragment-pack/flag', { enabled: true })).status, 400, 'confirm requis');
    assert.strictEqual((await call('POST', '/api/admin/economy/fragment-pack/flag', { enabled: true, confirm: true })).status, 400, 'ACTIVER requis');
    const act = await call('POST', '/api/admin/economy/fragment-pack/flag', { enabled: true, confirm: true, confirmText: 'ACTIVER' });
    assert.strictEqual(act.status, 409);
    assert.strictEqual((await act.json()).code, 'no_payment_provider');
    assert.strictEqual((await call('PUT', '/api/admin/economy/fragment-pack/settings', { priceCents: 5000 })).status, 400);
    const put = await call('PUT', '/api/admin/economy/fragment-pack/settings', { priceCents: 129, note: 'essai' });
    assert.strictEqual(put.status, 200, log);
    assert.strictEqual((await put.json()).settings.enabled, false);
    assert.strictEqual((await fetch(`${BASE}/api/fragment-pack`)).status, 401);
    const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fphttp', email: 'fphttp@example.invalid', password: 'secret123' }) });
    assert.strictEqual(reg.status, 200);
    const player = { Cookie: reg.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    assert.deepStrictEqual(await (await call('GET', '/api/fragment-pack', null, player)).json(), { open: false });
    assert.strictEqual((await call('POST', '/api/fragment-pack/checkout', {}, player)).status, 403);
    // Le joueur n'a pas accès aux routes admin
    assert.strictEqual((await call('PUT', '/api/admin/economy/fragment-pack/settings', { priceCents: 49 }, player)).status, 401);
  } finally {
    server.kill();
    await new Promise(r => server.once('exit', r));
  }
});
