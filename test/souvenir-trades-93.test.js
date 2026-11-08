/**
 * Tests #93 — souvenirs d'événements en double et échanges entre joueurs.
 *   - Drapeaux OFF par défaut : aucun double tiré, tirage identique à avant (#56), échanges refusés.
 *   - Doubles : seulement drapeau global ET règle ; borne par joueur/type, borne par sauvegarde,
 *     rien de rétroactif ; un type reçu n'est jamais « redécouvert ».
 *   - Échanges : réservation, acceptation atomique, double appel / rejeu, version périmée, auto-échange,
 *     dernier exemplaire jamais cédé, expiration, contre-proposition, désactivation qui libère,
 *     retour arrière admin, audit d'intégrité, conditions de déblocage, bonus « un par type ».
 *   - Simulation 10 000 profils reproductible ; reset de test #75 couvre les nouvelles tables.
 *   - HTTP : routes protégées, 403 `trades_disabled`, activation admin exigeant une confirmation.
 * Base temporaire hors server/data/. Lancer : npm test
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
const PORT = process.env.DIG_TEST_PORT_SOUVENIRS || '3193';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-souvenirs-93-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db           = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges       = require('../server/badges');
const news         = require('../server/news');
const ev           = require('../server/monthlyEvents');
const inv          = require('../server/souvenirInventory');
const souvenirBonus = require('../server/souvenirBonus');
const testRuns     = require('../server/testRuns');

const HOUR = 3_600_000;
const DAY = 86_400_000;
let season;
let seq = 0;

function newUser(name = `sv_user_${++seq}`, { ageDays = 30 } = {}) {
  const created = new Date(Date.now() - ageDays * DAY).toISOString().replace('T', ' ').slice(0, 19);
  return db.getDb().prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)').run(name, 'x', created).lastInsertRowid;
}
const nameOf = id => db.getDb().prepare('SELECT username FROM users WHERE id = ?').get(id).username;

function setAccepted(userId, depth) {
  db.upsertDepthTracking(userId, { season_id: season.id, ref_clicks: 0, ref_auto: 0, hand_tokens: 0, auto_tokens: 0,
    accepted_depth: depth, last_gap: 0, updated_ms: Date.now(), dmg_depth: null, dmg_credit: null, dmg_ref_clicks: null, dmg_gap: 0 });
}
const mined = new Map();
/** Mine `n` blocs de terre validés de plus (compteurs cumulés, crédités par badges.processSave #38). */
function mine(userId, n, depth = 30) {
  const total = (mined.get(userId) ?? 0) + n;
  mined.set(userId, total);
  setAccepted(userId, Math.max(depth, total));   // crédit borné par la profondeur retenue (#38)
  badges.processSave(userId, { stats: { minedByType: { pierre: total } } });
}

const tx = s => ({ fr: s, en: `${s} EN`, nl: `${s} NL`, es: `${s} ES` });
const item = (id, extra = {}) => ({ id, icon: '🎁', rarity: 'commun', chancePct: 50, minDepth: 0, dropFrom: [], names: tx(`Objet ${id}`), descs: tx(`Desc ${id}`), ...extra });
const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function scheduled(id, testers, items) {
  ev.createEvent({ id, icon: '🧪', audience: 'test', testers, names: tx(`Test ${id}`), taglines: tx('t'), startsAt: iso(Date.now() - HOUR), endsAt: iso(Date.now() + HOUR), items });
  return ev.scheduleEvent(id, { confirmElapsed: true });
}

const ALWAYS = () => 0;
/** Joue les tirages en comptant les appels à rand(). */
function counting(fn = ALWAYS) { const r = () => { r.calls += 1; return fn(); }; r.calls = 0; return r; }

/** Prépare `userId` avec la découverte + `extra` doubles de ev/item (doubles activés le temps de les tirer). */
function giveCopies(userId, eventId, itemId, extra) {
  db.getDb().prepare('INSERT OR IGNORE INTO monthly_event_finds (user_id, event_id, item_id, found_at) VALUES (?,?,?,?)').run(userId, eventId, itemId, iso(Date.now()));
  for (let i = 0; i < extra; i++) assert.ok(inv.mintDuplicate(userId, eventId, itemId, { maxCopies: 10 }));
}

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  news.init();
  ev.init();
  testRuns.init();
  season = db.getActiveSeason();
  assert.ok(season);
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Réglages ──────────────────────────────────────────────────────────────────

test('réglages : tout OFF par défaut ; activer exige une confirmation ; init idempotent', () => {
  ev.init(); inv.init();
  const s = inv.settings();
  assert.strictEqual(s.duplicates_enabled, 0);
  assert.strictEqual(s.trades_enabled, 0);
  assert.throws(() => inv.updateSettings({ trades_enabled: 1 }), e => e.code === 'confirm_required');
  assert.throws(() => inv.updateSettings({ duplicates_enabled: true }), e => e.code === 'confirm_required');
  assert.throws(() => inv.updateSettings({ nope: 1 }), /inconnu/);
  assert.throws(() => inv.updateSettings({ trade_ttl_hours: 0 }), /entre/);
  assert.strictEqual(inv.updateSettings({ trade_ttl_hours: 24 }).trade_ttl_hours, 24, 'réglage non sensible : sans confirmation');
  inv.updateSettings({ trade_ttl_hours: 48 });
  assert.strictEqual(inv.settings().trades_enabled, 0);
});

// ── Doubles ───────────────────────────────────────────────────────────────────

test('doubles OFF : aucun double, et exactement les mêmes tirages qu\'avant #93', () => {
  const u = newUser();
  scheduled('dup_off', [nameOf(u)], [item('do_a', { chancePct: 100 }), item('do_b', { chancePct: 100 })]);
  mine(u, 0); assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }), [], 'premier passage : curseur seul');
  mine(u, 10);
  const r1 = counting();
  assert.strictEqual(ev.processSave(u, { rand: r1 }).length, 2);
  assert.strictEqual(r1.calls, 2);
  // Règle autorisée mais drapeau OFF : aucun tirage de plus, aucun double
  inv.setRule('dup_off', '*', { allowed: true, factor: 1, maxCopies: 5 }, { confirm: true });
  mine(u, 10);
  const r2 = counting();
  assert.deepStrictEqual(ev.processSave(u, { rand: r2 }), []);
  assert.strictEqual(r2.calls, 0, 'objets possédés : aucun appel à rand() quand les doubles sont OFF');
  assert.strictEqual(inv.inventory(u).items['dup_off/do_a'].qty, 1);
});

test('règle des doubles : validation, confirmation, aucun effet sur l\'événement planifié', () => {
  scheduled('dup_rule', [nameOf(newUser())], [item('dr_a')]);
  const before = ev.getEvent('dup_rule');
  assert.throws(() => inv.setRule('nope_event', '*', {}), /introuvable/);
  assert.throws(() => inv.setRule('dup_rule', 'nope_item', {}), /introuvable/);
  assert.throws(() => inv.setRule('dup_rule', '*', { allowed: true, factor: 2, maxCopies: 3 }, { confirm: true }), /entre 0 et 1/);
  assert.throws(() => inv.setRule('dup_rule', '*', { allowed: true, factor: 0.1, maxCopies: 11 }, { confirm: true }), /entre 1 et 10/);
  assert.throws(() => inv.setRule('dup_rule', '*', { allowed: true, factor: 0.1, maxCopies: 3 }), e => e.code === 'confirm_required');
  assert.ok(inv.setRule('dup_rule', 'dr_a', { allowed: false, factor: 0, maxCopies: 1 }), 'règle restrictive : sans confirmation');
  const after = ev.getEvent('dup_rule');
  assert.strictEqual(after.revision, before.revision);
  assert.strictEqual(after.status, 'scheduled');
});

test('doubles ON + règle : chance × facteur, borne par joueur/type, borne par sauvegarde, rien de rétroactif', () => {
  const u = newUser();
  const items = ['d1', 'd2', 'd3', 'd4', 'd5'].map(id => item(`dup_on_${id}`, { chancePct: 10 }));
  scheduled('dup_on', [nameOf(u)], items);
  mine(u, 0); ev.processSave(u, { rand: ALWAYS });
  mine(u, 5);
  assert.strictEqual(ev.processSave(u, { rand: ALWAYS }).length, 5, 'premières découvertes');
  inv.updateSettings({ duplicates_enabled: 1 }, { confirm: true });
  try {
    // Sans règle pour cet événement : aucun double
    mine(u, 5);
    assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }), []);
    inv.setRule('dup_on', '*', { allowed: true, factor: 0.5, maxCopies: 3 }, { confirm: true });
    inv.setRule('dup_on', 'dup_on_d5', { allowed: false, factor: 0, maxCopies: 1 });
    // Probabilité : 1 − (1 − 10 % × 0,5)^n — un tirage à 0,04 réussit (p = 5 % pour 1 bloc), 0,06 échoue
    mine(u, 1);
    assert.deepStrictEqual(ev.processSave(u, { rand: () => 0.06 }), []);
    mine(u, 1);
    const got = ev.processSave(u, { rand: () => 0.04 });
    assert.strictEqual(got.length, inv.MAX_DUPS_PER_SAVE, 'au plus 3 doubles par sauvegarde');
    assert.ok(got.every(g => g.duplicate && g.qty === 2));
    mine(u, 1);
    const got2 = ev.processSave(u, { rand: ALWAYS });
    assert.strictEqual(got2.length, 3);
    assert.ok(got2.every(g => g.duplicate && g.qty <= 3));
    for (let i = 0; i < 5; i++) { mine(u, 1); ev.processSave(u, { rand: ALWAYS }); }
    const it = inv.inventory(u).items;
    for (const id of ['d1', 'd2', 'd3', 'd4']) assert.strictEqual(it[`dup_on/dup_on_${id}`].qty, 3, `${id} : plafond maxCopies = 3`);
    assert.strictEqual(it['dup_on/dup_on_d5'].qty, 1, 'règle par objet : pas de double');
    // Rejouer une sauvegarde sans nouveau bloc ne crée rien
    assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }), []);
    assert.deepStrictEqual(inv.audit(), { orphanReservations: [], pendingWithoutReservation: [], overMinted: [] });
    // Vue joueur : quantité visible seulement au-delà de 1
    const pv = ev.publicView(u).active.find(e => e.id === 'dup_on');
    assert.strictEqual(pv.items.find(i => i.id === 'dup_on_d1').qty, 3);
    assert.strictEqual(pv.items.find(i => i.id === 'dup_on_d5').qty, undefined);
  } finally {
    inv.updateSettings({ duplicates_enabled: 0 });
  }
});

test('un type reçu (exemplaire supplémentaire) n\'est jamais « redécouvert »', () => {
  const u = newUser();
  scheduled('recv', [nameOf(u)], [item('recv_a', { chancePct: 100 })]);
  const giver = newUser();
  giveCopies(giver, 'recv', 'recv_a', 1);
  db.getDb().prepare('UPDATE souvenir_copies SET user_id = ? WHERE user_id = ? AND event_id = ?').run(u, giver, 'recv');
  mine(u, 0); ev.processSave(u, { rand: ALWAYS });
  mine(u, 10);
  assert.deepStrictEqual(ev.processSave(u, { rand: ALWAYS }), []);
  const i = inv.inventory(u).items['recv/recv_a'];
  assert.deepStrictEqual([i.qty, i.discovered, i.tradeable], [1, false, 0]);
  assert.strictEqual(ev.publicView(u).active.find(e => e.id === 'recv').items[0].found, true, 'visible comme possédé');
});

// ── Échanges ──────────────────────────────────────────────────────────────────

function tradeSetup() {
  const a = newUser(), b = newUser();
  for (const u of [a, b]) mine(u, 1000);
  scheduled(`tr_${seq}`, [nameOf(a)], [item(`tra_${seq}`), item(`trb_${seq}`), item(`trc_${seq}`)]);
  const e = `tr_${seq}`, X = `tra_${seq}`, Y = `trb_${seq}`, Z = `trc_${seq}`;
  giveCopies(a, e, X, 1);         // A : X ×2
  giveCopies(b, e, Y, 1);         // B : Y ×2
  return { a, b, e, X, Y, Z, offer: { eventId: e, itemId: X }, want: { eventId: e, itemId: Y } };
}

test('échanges OFF : refusés, aucun exemplaire réservé', () => {
  const { a, b, offer, want } = tradeSetup();
  assert.throws(() => inv.propose(a, { to: nameOf(b), offer, want }), e => e.code === 'trades_disabled');
  assert.throws(() => inv.accept(b, 1), e => e.code === 'trades_disabled');
  assert.strictEqual(inv.inventory(a).items[`${offer.eventId}/${offer.itemId}`].reserved, 0);
});

test('échange 1 contre 1 : réservation, acceptation atomique, double appel, rejeu, bonus un par type', () => {
  inv.updateSettings({ trades_enabled: 1 }, { confirm: true });
  try {
    const { a, b, e, X, Y, offer, want } = tradeSetup();
    const vA = inv.inventoryVersion(a);
    const t = inv.propose(a, { to: nameOf(b).toUpperCase(), offer, want, requestId: 'r1' });
    assert.strictEqual(t.status, 'pending');
    assert.strictEqual(inv.inventoryVersion(a), vA + 1);
    const ia = inv.inventory(a).items[`${e}/${X}`];
    assert.deepStrictEqual([ia.qty, ia.reserved, ia.tradeable], [2, 1, 0]);
    // Même requestId (double clic, deux onglets) : même proposition, rien de plus réservé
    assert.strictEqual(inv.propose(a, { to: nameOf(b), offer, want, requestId: 'r1' }).id, t.id);
    assert.throws(() => inv.propose(a, { to: nameOf(b), offer, want, requestId: 'r2' }), e2 => e2.code === 'no_free_copy', 'le dernier exemplaire ne part jamais');
    assert.throws(() => inv.accept(a, t.id), e2 => e2.code === 'not_recipient');
    assert.throws(() => inv.accept(b, t.id, { version: t.version + 1 }), e2 => e2.code === 'stale');
    const done = inv.accept(b, t.id, { version: t.version });
    assert.strictEqual(done.status, 'completed');
    assert.throws(() => inv.accept(b, t.id), e2 => e2.code === 'not_pending', 'rejeu : rien transféré deux fois');
    const A = inv.inventory(a).items, B = inv.inventory(b).items;
    assert.deepStrictEqual([A[`${e}/${X}`].qty, A[`${e}/${Y}`].qty, B[`${e}/${X}`].qty, B[`${e}/${Y}`].qty], [1, 1, 1, 1]);
    assert.strictEqual(A[`${e}/${Y}`].discovered, false, 'reçu, pas découvert');
    assert.deepStrictEqual(inv.audit(), { orphanReservations: [], pendingWithoutReservation: [], overMinted: [] });
    // #81 : un bonus par TYPE, jamais multiplié par la quantité
    const bonuses = [{ source: { eventId: e, itemId: X }, kind: 'damage_flat', value: 0.01, target: { type: 'all' }, schedule: {} }];
    assert.strictEqual(souvenirBonus.resolve(inv.quantities(a), bonuses).types[0].qty, 1);
    // Retour arrière admin
    inv.adminRollback(t.id, { reason: 'test' });
    assert.strictEqual(inv.inventory(a).items[`${e}/${X}`].qty, 2);
    assert.strictEqual(inv.inventory(b).items[`${e}/${Y}`].qty, 2);
    assert.throws(() => inv.adminRollback(t.id), /conclu/);
  } finally { inv.updateSettings({ trades_enabled: 0 }); }
});

test('échanges : refus, annulation, expiration, contre-proposition, auto-échange, même type, désactivation', () => {
  inv.updateSettings({ trades_enabled: 1 }, { confirm: true });
  try {
    const { a, b, e, X, Y, Z, offer, want } = tradeSetup();
    assert.throws(() => inv.propose(a, { to: nameOf(a), offer, want }), x => x.code === 'self_trade');
    assert.throws(() => inv.propose(a, { to: nameOf(b), offer, want: offer }), x => x.code === 'same_type');
    assert.throws(() => inv.propose(a, { to: 'personne_xyz', offer, want }), x => x.code === 'no_user');
    // Refus → libéré
    let t = inv.propose(a, { to: nameOf(b), offer, want });
    assert.throws(() => inv.decline(a, t.id), x => x.code === 'not_recipient');
    inv.decline(b, t.id);
    assert.strictEqual(inv.inventory(a).items[`${e}/${X}`].reserved, 0);
    // Annulation par l'auteur
    t = inv.propose(a, { to: nameOf(b), offer, want });
    inv.cancel(a, t.id);
    assert.strictEqual(inv.inventory(a).items[`${e}/${X}`].tradeable, 1);
    // Expiration (TTL 48 h)
    t = inv.propose(a, { to: nameOf(b), offer, want });
    assert.throws(() => inv.accept(b, t.id, { nowMs: Date.now() + 49 * HOUR }), x => x.code === 'not_pending');
    assert.strictEqual(inv.listTrades(a).find(x => x.id === t.id).status, 'expired');
    assert.strictEqual(inv.inventory(a).items[`${e}/${X}`].reserved, 0);
    // Contre-proposition : B offre Y contre Z (A n'a pas de double de Z → acceptation impossible)
    t = inv.propose(a, { to: nameOf(b), offer, want });
    const c = inv.counter(b, t.id, { want: { eventId: e, itemId: Z } });
    assert.strictEqual(c.parentId, t.id);
    assert.strictEqual(inv.listTrades(a).find(x => x.id === t.id).status, 'countered');
    assert.throws(() => inv.accept(a, c.id), x => x.code === 'no_free_copy');
    assert.strictEqual(inv.inventory(b).items[`${e}/${Y}`].reserved, 1);
    // Désactivation : toutes les propositions closes, exemplaires libérés, rien supprimé
    inv.updateSettings({ trades_enabled: 0 });
    assert.strictEqual(inv.inventory(b).items[`${e}/${Y}`].reserved, 0);
    assert.strictEqual(inv.inventory(b).items[`${e}/${Y}`].qty, 2);
    assert.deepStrictEqual(inv.audit(), { orphanReservations: [], pendingWithoutReservation: [], overMinted: [] });
  } finally { inv.updateSettings({ trades_enabled: 0 }); }
});

test('échanges : exemplaire offert disparu entre-temps → échange clos sans perte ; conditions de déblocage', () => {
  inv.updateSettings({ trades_enabled: 1 }, { confirm: true });
  try {
    const { a, b, e, X, offer, want } = tradeSetup();
    const t = inv.propose(a, { to: nameOf(b), offer, want });
    // Incohérence simulée (ex. reset de test #75 de A) : l'exemplaire réservé n'est plus à A
    db.getDb().prepare('UPDATE souvenir_copies SET trade_id = NULL WHERE trade_id = ?').run(t.id);
    assert.throws(() => inv.accept(b, t.id), x => x.code === 'offer_gone');
    assert.strictEqual(inv.listTrades(b).find(x => x.id === t.id).status, 'failed', 'clôture validée malgré l\'erreur');
    assert.strictEqual(inv.inventory(b).items[`${e}/${want.itemId}`].qty, 2, 'B n\'a rien perdu');
    assert.strictEqual(inv.inventory(a).items[`${e}/${X}`].qty, 2);
    // Compte trop récent / pas assez de minage
    const fresh = newUser(undefined, { ageDays: 1 });
    assert.deepStrictEqual(inv.eligibility(fresh).reasons, ['account_too_new', 'not_enough_blocks']);
    assert.throws(() => inv.propose(a, { to: nameOf(fresh), offer, want }), x => x.code === 'not_eligible');
    assert.ok(inv.eligibility(a).ok);
    // Réservation orpheline (exemplaire restauré par #75 avec un ancien trade_id) : libérée au prochain passage
    const cid = db.getDb().prepare('SELECT id FROM souvenir_copies WHERE user_id = ? AND event_id = ?').get(a, e).id;
    db.getDb().prepare('UPDATE souvenir_copies SET trade_id = ? WHERE id = ?').run(t.id, cid);
    assert.deepStrictEqual(inv.audit().orphanReservations, [cid]);
    inv.expireTrades();
    assert.deepStrictEqual(inv.audit().orphanReservations, []);
  } finally { inv.updateSettings({ trades_enabled: 0 }); }
});

test('reset de test #75 : les nouvelles tables font partie de l\'état du joueur', () => {
  const names = testRuns.STATE_TABLES.map(t => t.name);
  assert.ok(names.includes('souvenir_copies'));
  assert.ok(names.includes('souvenir_inventory_versions'));
});

// ── Simulation ────────────────────────────────────────────────────────────────

test('simulation des doubles : 10 000 joueurs, reproductible, bornée par maxCopies', () => {
  const NOV = require('../server/content/events/novembre-histoire-2026.json');
  const evNov = NOV;
  const none = inv.simulateDuplicates(evNov, { factor: 0, maxCopies: 1 });
  assert.strictEqual(none.profiles.reduce((s, p) => s + p.players, 0), 10_000);
  assert.ok(none.profiles.every(p => p.avgDuplicates === 0 && p.maxCopiesSeen <= 1));
  const a = inv.simulateDuplicates(evNov, { factor: 0.1, maxCopies: 3 });
  const b = inv.simulateDuplicates(evNov, { factor: 0.1, maxCopies: 3 });
  assert.deepStrictEqual(a, b, 'graine fixe : résultats identiques');
  assert.ok(a.profiles.every(p => p.maxCopiesSeen <= 3));
  const heavy = a.profiles.find(p => p.profile === 'acharne');
  const casual = a.profiles.find(p => p.profile === 'occasionnel');
  assert.ok(heavy.avgDuplicates > casual.avgDuplicates);
});

// ── HTTP ──────────────────────────────────────────────────────────────────────

test('HTTP : inventaire joueur, échanges 403 tant que OFF, admin protégé et confirmation exigée', async () => {
  const adminSecret = crypto.randomBytes(16).toString('hex');
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'), ADMIN_SECRET: adminSecret, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  const admin = { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' };
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(up, log);
    assert.strictEqual((await fetch(`${BASE}/api/souvenirs/inventory`)).status, 401);
    assert.strictEqual((await fetch(`${BASE}/api/admin/souvenirs`)).status, 401);
    const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'svhttp', email: 'svhttp@example.invalid', password: 'secret123' }) });
    assert.strictEqual(reg.status, 200);
    const cookie = reg.headers.get('set-cookie').split(';')[0];
    const me = await (await fetch(`${BASE}/api/souvenirs/inventory`, { headers: { Cookie: cookie } })).json();
    assert.deepStrictEqual(me, { version: 0, items: {}, duplicates: false, trades: false });
    const tr = await fetch(`${BASE}/api/souvenirs/trades`, { headers: { Cookie: cookie } });
    assert.strictEqual(tr.status, 403);
    assert.strictEqual((await tr.json()).code, 'trades_disabled');
    const post = await fetch(`${BASE}/api/souvenirs/trades`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'x', offer: { eventId: 'abc', itemId: 'abc' }, want: { eventId: 'abc', itemId: 'abd' } }) });
    assert.strictEqual(post.status, 403);
    const view = await (await fetch(`${BASE}/api/admin/souvenirs`, { headers: admin })).json();
    assert.strictEqual(view.settings.trades_enabled, 0);
    assert.deepStrictEqual(view.audit, { orphanReservations: [], pendingWithoutReservation: [], overMinted: [] });
    const on = await fetch(`${BASE}/api/admin/souvenirs/settings`, { method: 'PUT', headers: admin, body: JSON.stringify({ settings: { trades_enabled: 1 } }) });
    assert.strictEqual(on.status, 409);
    assert.strictEqual((await on.json()).code, 'confirm_required');
    assert.strictEqual((await (await fetch(`${BASE}/api/admin/souvenirs`, { headers: admin })).json()).settings.trades_enabled, 0);
  } finally {
    server.kill();
  }
});
