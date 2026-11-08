/**
 * Pioche à charges (#71) : réglages validés et journalisés, drapeau OFF par défaut (jeu inchangé),
 * testeurs, moteur du navigateur (consommation, pioche émoussée à 1 dégât, seuil de reprise, recharge
 * hors ligne, recharges en pièces sans surfacturation, arbres en gemmes), mêmes formules côté serveur,
 * contrôles anti-fraude en observation (temps serveur), dépenses des arbres déduites par le registre de
 * gemmes, sauvegarde/reset/saison, boutique sans skins, et de bout en bout par HTTP.
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
const PORT = process.env.DIG_TEST_PORT_PICKAXE || '3184';
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-pickaxe-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db   = require('../server/db');
const blockCatalog = require('../server/blockCatalog');
const badges = require('../server/badges');
const pk   = require('../server/pickaxeCharges');
const gems = require('../server/gemLedger');

let userSeq = 0;
const newUser = (name = `pk_${++userSeq}`) => db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(name, 'x').lastInsertRowid;
const anomalies = (u, kind) => db.getDb().prepare('SELECT * FROM pickaxe_charge_anomalies WHERE user_id = ? AND kind = ?').all(u, kind);

/** Charge les scripts du jeu dans un contexte isolé (GameState, Save, PickaxeCharges). */
function loadClient() {
  const store = {};
  const ctx = vm.createContext({ Math, Object, Array, Number, String, JSON, Date, Set,
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } } });
  for (const f of ['gameState.js', 'save.js', 'pickaxeCharges.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/js', f), 'utf8'), ctx, { filename: f });
  }
  return vm.runInContext('({ GameState, Save, PickaxeCharges })', ctx);
}
const cfg = (over = {}) => ({ enabled: true, ...pk.DEFAULTS, ...over });
const plain = o => JSON.parse(JSON.stringify(o));   // objets du contexte vm → comparables

test.before(() => {
  db.initDb();
  blockCatalog.init();
  badges.init();
  gems.init();
  pk.init();
  pk.init();   // idempotent
  gems.init(); // colonne ref_pickaxe ajoutée une seule fois
});

const auditCount = () => db.getDb().prepare('SELECT COUNT(*) AS n FROM pickaxe_charge_audit').get().n;

test('décision du propriétaire (08/11) : activée pour tous à 5 000 / 2 s, une seule fois, arrêt d\'urgence respecté', () => {
  const s = pk.getSettings();
  assert.deepStrictEqual([s.mode, s.capacity, s.regenSeconds, s.resumeThreshold], ['on', 5000, 2, 0.1]);
  assert.strictEqual(pk.publicConfig(null).enabled, true, 'tous les joueurs, invités compris');
  // Le reste des réglages développés est inchangé (arbres, prix, recharges)
  for (const k of ['capacityMult', 'capacityPrices', 'speedMult', 'speedPrices', 'refillPacks', 'refillCoinsPerCharge', 'refillEnabled']) {
    assert.deepStrictEqual(s[k], pk.DEFAULTS[k], k);
  }
  const dec = db.getDb().prepare("SELECT * FROM admin_config_decisions WHERE id = 'issue71-global-on-2026-11-08'").get();
  assert.strictEqual(dec.outcome, 'applied');
  assert.deepStrictEqual(JSON.parse(dec.old_value), { mode: 'off', capacity: 1500, regenSeconds: 3 });
  const audit = db.getDb().prepare('SELECT * FROM pickaxe_charge_audit').all();
  assert.strictEqual(audit.length, 1, 'journalisée une fois malgré deux init()');
  assert.match(audit[0].note, /Décision du propriétaire #71/);
  // Arrêt d'urgence depuis le panel : jamais réactivé par un redémarrage
  pk.saveSettings({ mode: 'off' });
  pk.init();
  assert.strictEqual(pk.getSettings().mode, 'off');
  // Réglage changé dans le panel avant la décision : décision ignorée (jamais appliquée par-dessus)
  db.getDb().prepare("DELETE FROM admin_config_decisions WHERE id = 'issue71-global-on-2026-11-08'").run();
  pk.saveSettings({ capacity: 2000 });
  pk.init();
  assert.deepStrictEqual([pk.getSettings().mode, pk.getSettings().capacity], ['off', 2000]);
  assert.strictEqual(db.getDb().prepare("SELECT outcome FROM admin_config_decisions WHERE id = 'issue71-global-on-2026-11-08'").get().outcome, 'skipped');
  // Retour aux valeurs par défaut développées pour la suite des tests
  pk.saveSettings({ mode: 'off', capacity: 1500, regenSeconds: 3 });
});

test.after(() => {
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('réglages : OFF par défaut, valeurs prudentes, validation lisible et journal', () => {
  const s = pk.getSettings();
  assert.strictEqual(s.mode, 'off');
  assert.deepStrictEqual([s.capacity, s.regenSeconds, s.resumeThreshold], [1500, 3, 0.1]);
  assert.deepStrictEqual(pk.publicConfig(null), { enabled: false });
  for (const [patch, re] of [
    [{ mode: 'tous' }, /Mode inconnu/],
    [{ capacity: 5 }, /Capacité de base/],
    [{ capacityMult: '1 ; 2 ; 1,5' }, /augmenter/],
    [{ speedMult: '1 ; 1,2' }, /Arbre vitesse/],
    [{ capacityPrices: '1 ; 2' }, /7 prix attendus/],
    [{ capacityMult: '2 ; 3' }, /niveau 0 vaut 1/],
    [{ testers: 'inconnu_xyz' }, /Testeur inconnu/],
  ]) assert.throws(() => pk.saveSettings(patch), re, JSON.stringify(patch));
  const audit0 = auditCount();
  for (const patch of [{ mode: 'tous' }, { capacity: 5 }]) assert.throws(() => pk.saveSettings(patch));
  assert.strictEqual(auditCount(), audit0, 'refus : rien écrit');
  // Virgule décimale et « ; » acceptés
  const r = pk.saveSettings({ speedMult: '1 ; 0,8 ; 0,5', speedPrices: '4 ; 9', note: 'essai' });
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(pk.getSettings().speedMult, [1, 0.8, 0.5]);
  assert.strictEqual(pk.saveSettings({ speedMult: [1, 0.8, 0.5] }).changed, false, 'même valeur : aucun journal');
  const audit = db.getDb().prepare('SELECT * FROM pickaxe_charge_audit ORDER BY id').all();
  assert.strictEqual(audit.length, audit0 + 1);
  assert.strictEqual(JSON.parse(audit.at(-1).old_value).speedMult.length, 8, 'ancienne valeur conservée');
  assert.throws(() => db.getDb().prepare('DELETE FROM pickaxe_charge_audit').run(), /ajout seul/);
  pk.saveSettings({ speedMult: pk.DEFAULTS.speedMult, speedPrices: pk.DEFAULTS.speedPrices });
});

test('drapeau : testeurs par pseudo (casse ignorée), tous, OFF = arrêt d\'urgence', () => {
  const a = newUser('Testeur_A'), b = newUser();
  pk.saveSettings({ mode: 'testers', testers: 'testeur_a' });
  assert.deepStrictEqual(pk.getSettings().testers, [a]);
  assert.strictEqual(pk.publicConfig(a).enabled, true);
  assert.deepStrictEqual(pk.publicConfig(b), { enabled: false });
  assert.deepStrictEqual(pk.publicConfig(null), { enabled: false }, 'invité : jamais en mode testeurs');
  pk.saveSettings({ mode: 'on' });
  assert.strictEqual(pk.publicConfig(null).enabled, true);
  pk.saveSettings({ refillEnabled: false });
  assert.deepStrictEqual(pk.publicConfig(b).refillPacks, [], 'recharges masquées');
  pk.saveSettings({ mode: 'off', refillEnabled: true, testers: '' });
  assert.deepStrictEqual(pk.publicConfig(a), { enabled: false });
});

test('moteur : 1 charge par coup plein, émoussée à 1 dégât sans consommer, reprise au seuil, recharge hors ligne', () => {
  const { GameState, PickaxeCharges: P } = loadClient();
  const t0 = 1_000_000;
  assert.deepStrictEqual(plain(P.hit(12, t0)), { damage: 12, full: true, emptied: false }, 'inactif : jeu inchangé');
  assert.strictEqual(GameState.pickaxe.charges, null, 'inactif : réserve non touchée');
  P.applyConfig(cfg({ capacity: 20, regenSeconds: 10, resumeThreshold: 0.25 }), t0);
  assert.strictEqual(GameState.pickaxe.charges, 20, 'première activation : réserve pleine');
  let full = 0;
  for (let i = 0; i < 20; i++) { const h = P.hit(12, t0); if (h.full) full++; if (i === 19) assert.strictEqual(h.emptied, true); }
  assert.strictEqual(full, 20);
  assert.strictEqual(GameState.pickaxe.fullHits, 20);
  assert.deepStrictEqual(plain(P.hit(12, t0)), { damage: 1, full: false, emptied: false }, 'émoussée : 1 dégât');
  assert.strictEqual(GameState.pickaxe.charges, 0, 'émoussée : aucun coup ne consomme');
  assert.strictEqual(P.resumeAt(), 5);
  assert.strictEqual(P.msUntilResume(t0), 50_000);
  // 1 charge plus tard : toujours émoussée (anti yo-yo)
  assert.strictEqual(P.hit(12, t0 + 10_000).damage, 1);
  // Seuil atteint : bonus de retour
  assert.strictEqual(P.hit(12, t0 + 50_000).damage, 12);
  // Hors ligne : recharge plafonnée à la capacité ; horloge reculée sans effet négatif
  P.sync(t0 + 10 * 3600_000);
  assert.strictEqual(GameState.pickaxe.charges, 20);
  P.sync(t0);
  assert.strictEqual(GameState.pickaxe.charges, 20);
});

test('recharges en pièces : charges réellement ajoutées, coût proportionnel, jamais au-delà de la capacité', () => {
  const { GameState, PickaxeCharges: P } = loadClient();
  const t0 = 5_000;
  P.applyConfig(cfg({ capacity: 1000, refillCoinsPerCharge: 3 }), t0);
  GameState.depth = 101;
  GameState.coins = 1_000_000;
  GameState.pickaxe.charges = 950;
  const near = P.refillOffer(50, t0);
  assert.deepStrictEqual([near.add, near.cost], [50, Math.ceil(50 * 3 * 6)], 'près du maximum : seulement la place libre');
  assert.strictEqual(near.cost, pk.refillCost(pk.getSettings(), 50, 101), 'même prix que le serveur');
  GameState.pickaxe.charges = 0;
  GameState.pickaxe.depleted = true;
  const o = P.buyRefill(25, t0);
  assert.deepStrictEqual([o.add, o.cost, GameState.pickaxe.charges, GameState.pickaxe.refilled], [250, 4500, 250, 250]);
  assert.strictEqual(GameState.coins, 1_000_000 - 4500);
  assert.strictEqual(GameState.pickaxe.depleted, false, 'recharge au-delà du seuil : bonus de retour');
  assert.strictEqual(P.buyRefill(33, t0), null, 'formule inconnue refusée');
  GameState.coins = 10;
  assert.strictEqual(P.buyRefill(10, t0), null, 'pas assez de pièces : rien ne change');
  assert.strictEqual(GameState.pickaxe.charges, 250);
  GameState.pickaxe.charges = 1000;
  assert.strictEqual(P.refillOffer(10, t0).add, 0, 'réserve pleine : rien à vendre');
});

test('arbres en gemmes : prix et valeurs du barème, niveau max, mêmes calculs que le serveur', () => {
  const { GameState, PickaxeCharges: P } = loadClient();
  const s = pk.getSettings();
  P.applyConfig(cfg(), 0);
  GameState.gems = 16;
  const o = P.treeNext('cap');
  assert.deepStrictEqual([o.level, o.price, o.now, o.next], [0, 5, 1500, 2250]);
  assert.ok(P.buyTree('cap', 0));
  assert.ok(P.buyTree('cap', 0));
  assert.strictEqual(GameState.gems, 1);
  assert.strictEqual(P.buyTree('cap', 0), null, 'pas assez de gemmes');
  assert.strictEqual(P.capacity(), pk.capacityAt(s, 2));
  GameState.gems = 10_000;
  for (let i = 0; i < 20; i++) P.buyTree('speed', 0);
  assert.strictEqual(GameState.pickaxe.speedLevel, 7);
  assert.strictEqual(P.treeNext('speed'), null, 'niveau maximum');
  assert.strictEqual(P.regenSeconds(), pk.regenSecondsAt(s, 7));
  assert.strictEqual(10_000 - GameState.gems, pk.treeCost(s.speedPrices, 0, 7));
});

test('sauvegarde : réserve et niveaux sauvegardés, conservés par le reset joueur, remis à neuf par la déconnexion', () => {
  const { GameState, Save } = loadClient();
  GameState.pickaxe = { ...GameState.pickaxe, charges: 42.5, at: 123, capLevel: 2, speedLevel: 1, fullHits: 9 };
  const data = JSON.parse(JSON.stringify(Save.serialize()));
  assert.strictEqual(data.pickaxe.capLevel, 2);
  GameState.reset();
  assert.strictEqual(GameState.pickaxe.capLevel, 2, 'reset joueur : niveaux achetés conservés');
  assert.ok(Save.loadFromData({ ...data, pickaxe: { capLevel: -3, charges: 'x', speedLevel: 1.5 } }));
  assert.deepStrictEqual([GameState.pickaxe.capLevel, GameState.pickaxe.charges, GameState.pickaxe.speedLevel], [0, null, 0], 'valeurs invalides → défaut');
  assert.ok(Save.loadFromData({ ...data, pickaxe: undefined }));
  assert.strictEqual(GameState.pickaxe.charges, null, 'ancienne sauvegarde : réserve pleine à l\'activation');
  assert.ok(Save.loadFromData(data));
  assert.strictEqual(GameState.pickaxe.charges, 42.5);
  Save.purge();
  assert.strictEqual(GameState.pickaxe.capLevel, 0);
  // Changement de saison (main.js) et reset admin partiel (index.js) : champ `pickaxe` jamais touché
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const season = main.slice(main.indexOf('function _applySeasonReset'), main.indexOf('function _applyServerEconomy'));
  assert.doesNotMatch(season, /pickaxe\b(?!Level)/);
});

test('anti-fraude : écarts journalisés sur le temps serveur, sauvegarde jamais modifiée, tolérance', () => {
  const u = newUser();
  pk.saveSettings({ mode: 'on', capacity: 100, regenSeconds: 10 });
  const t0 = Date.parse('2026-11-05T10:00:00Z');
  const data = (charges, fullHits = 0, refilled = 0, capLevel = 0) => ({ pickaxe: { charges, fullHits, refilled, capLevel, speedLevel: 0 } });
  assert.deepStrictEqual(pk.observeSave(u, data(100), { nowMs: t0 }).anomalies, []);
  // 60 s plus tard : 50 coups pleins, réserve 56 (= 100 − 50 + 6) → normal
  assert.deepStrictEqual(pk.observeSave(u, data(56, 50), { nowMs: t0 + 60_000 }).anomalies, []);
  // 10 s plus tard : réserve remontée à 100 sans achat → recharge trop rapide
  const d = data(100, 50);
  const before = JSON.stringify(d);
  assert.deepStrictEqual(pk.observeSave(u, d, { nowMs: t0 + 70_000 }).anomalies, ['fast_regen']);
  assert.strictEqual(JSON.stringify(d), before, 'sauvegarde jamais modifiée');
  // 300 coups pleins en 10 s avec 100 de capacité → coups sans charge
  assert.ok(pk.observeSave(u, data(0, 350), { nowMs: t0 + 80_000 }).anomalies.includes('full_hits'));
  // Au-dessus de la capacité ; niveau hors barème
  assert.ok(pk.observeSave(u, data(500, 350), { nowMs: t0 + 9_000_000 }).anomalies.includes('over_capacity'));
  assert.ok(pk.observeSave(u, data(10, 350, 0, 99), { nowMs: t0 + 9_100_000 }).anomalies.includes('tree_level'));
  // Recharge achetée : pas d'écart
  assert.deepStrictEqual(pk.observeSave(u, data(80, 350, 70), { nowMs: t0 + 9_110_000 }).anomalies, []);
  for (const k of ['fast_regen', 'full_hits', 'over_capacity', 'tree_level']) assert.strictEqual(anomalies(u, k).length, 1, k);
  // OFF : aucune observation
  pk.saveSettings({ mode: 'off' });
  assert.strictEqual(pk.observeSave(u, data(9999), { nowMs: t0 + 9_200_000 }), null);
  pk.saveSettings({ capacity: pk.DEFAULTS.capacity, regenSeconds: pk.DEFAULTS.regenSeconds });
});

test('registre de gemmes : niveaux d\'arbres achetés déduits (jamais deux fois), sans fausse « perte client »', () => {
  const u = newUser();
  const s = pk.getSettings();
  let rev = 0;
  const save = (g, cap, speed) => ({ gems: g, upgrades: { autodig: 0 }, stats: { minedByType: {} }, seasonStats: { seasonId: 1 }, pickaxe: { capLevel: cap, speedLevel: speed } });
  const obs = d => gems.observeSave(u, d, { revision: ++rev, force: true });
  assert.strictEqual(obs(save(50, 1, 0)).opened, true, 'ouverture : niveaux déjà possédés non débités');
  const cost = pk.treeCost(s.capacityPrices, 1, 3) + pk.treeCost(s.speedPrices, 0, 1);
  const r = obs(save(50 - cost, 3, 1));
  assert.deepStrictEqual([r.debited, r.loss, r.balance], [cost, 0, 50 - cost]);
  assert.strictEqual(obs(save(50 - cost, 3, 1)).debited, 0, 'mêmes niveaux : aucun débit');
  // Reset de test : niveaux à 0 → nouvelle référence ; rachat débité normalement
  obs(save(50 - cost, 0, 0));
  assert.strictEqual(obs(save(50 - cost - 5, 1, 0)).debited, 5);
  const led = db.getDb().prepare("SELECT * FROM gem_ledger WHERE user_id = ? AND reason = 'pickaxe_tree'").all(u);
  assert.strictEqual(led.length, 2);
});

test('boutique : skins de pioche remplacés par « Pioche et entretien », droits existants conservés', () => {
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  const shop = main.slice(main.indexOf('function renderShop()'), main.indexOf('function _fillShopGrid'));
  assert.doesNotMatch(shop, /section_skins|shop-grid-skins|type === 'skin'/);
  assert.match(shop, /_pickaxeShopHtml\(\)/);
  // Un éventuel skin possédé reste affiché sur le bloc (aucun droit retiré)
  assert.match(main, /elBlock\.classList\.add\(`skin-\$\{skin\}`\)/);
  // Coup de pioche : dégâts fournis par la réserve, Auto-Dig inchangé
  assert.match(main, /const strike = PickaxeCharges\.hit\(full\);\s+const destroyed = Blocks\.hit\(strike\.damage\);/);
  const auto = main.slice(main.indexOf('function autoDigTick'), main.indexOf('function coordsFrom'));
  assert.doesNotMatch(auto, /PickaxeCharges/);
  // Achat en gemmes : confirmation avec coût et gain affichés avant achat
  assert.match(main, /_shopConfirm\(\{\s+title: t\('pickaxe\.confirm_title'\)/);
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('js/pickaxeCharges.js') < html.indexOf('js/main.js'));
});

test('simulation : les chiffres exploratoires videraient la réserve en moins d\'une minute de jeu actif', () => {
  const sim = require('../tools/balance/pickaxe-charges-sim.js');
  const res = sim.run({ runs: 3, profiles: { lent: sim.PROFILES.lent },
    settings: { 'jeu actuel': null, exploratoire: { capacity: 100, regenS: 10, threshold: 0.1 }, defaut: { capacity: 1500, regenS: 3, threshold: 0.1 } } });
  const r = res.lent.rows;
  assert.ok(r.exploratoire.firstEmptyMin < 1.5, `1re panne ${r.exploratoire.firstEmptyMin}`);
  assert.ok(r.exploratoire.maxDepth < r['jeu actuel'].maxDepth * 0.7);
  assert.ok(r.defaut.maxDepth > r.exploratoire.maxDepth);
});

test('simulation du 08/11 : 5 000 / 2 s freine le bot nocturne sans toucher le débutant ; les recharges en pièces lèvent le frein', () => {
  const sim = require('../tools/balance/pickaxe-night-sim.js');
  const S = sim.SETTINGS;
  const res = sim.run({ runs: 3, profiles: { debutant: sim.PROFILES.debutant, bot: sim.PROFILES.bot },
    settings: { 'jeu actuel (OFF)': null, live: S['5 000/2 s (activé)'], dev: S['1 500/3 s'], refill: S['5 000/2 s + recharges +50 %'] } });
  const d = res.debutant.rows, b = res.bot.rows;
  assert.ok(d.live.manualBlocks >= d['jeu actuel (OFF)'].manualBlocks * 0.97, 'débutant 20 min/j : pas de perte');
  assert.ok(d.dev.manualBlocks < d['jeu actuel (OFF)'].manualBlocks * 0.85, '1 500 / 3 s pénaliserait le débutant');
  assert.ok(b.live.manualBlocks < b['jeu actuel (OFF)'].manualBlocks * 0.5, 'bot nocturne : frein fort');
  assert.ok(b.refill.manualBlocks > b['jeu actuel (OFF)'].manualBlocks * 0.85, 'constat : recharges payées en pièces = frein levé');
});

test('HTTP : config par joueur, routes admin protégées, observation à la sauvegarde', async () => {
  const httpDb = path.join(dir, 'http.sqlite');
  const adminSecret = crypto.randomBytes(16).toString('hex');
  const env = { ...process.env, PORT, NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: httpDb, ADMIN_SECRET: adminSecret, SESSION_SECRET: crypto.randomBytes(16).toString('hex') };
  let log = '';
  const server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', x => { log += x; });
  server.stderr.on('data', x => { log += x; });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, log);
  const admin = { Authorization: `Bearer ${adminSecret}`, 'Content-Type': 'application/json' };
  const call = (method, p, body, headers = admin) => fetch(`${BASE}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  try {
    // Base neuve : décision du propriétaire appliquée au démarrage (tous, 5 000 / 2 s)
    const initial = await (await fetch(`${BASE}/api/pickaxe/config`)).json();
    assert.deepStrictEqual([initial.enabled, initial.capacity, initial.regenSeconds, initial.refillPacks], [true, 5000, 2, [10, 25, 50]]);
    assert.match(log, /Décision issue71-global-on-2026-11-08/);
    for (const [m, p] of [['GET', '/api/admin/pickaxe'], ['PUT', '/api/admin/pickaxe/settings']]) {
      assert.strictEqual((await fetch(`${BASE}${p}`, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'PUT' ? '{"mode":"on"}' : undefined })).status, 401, p);
    }
    const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'pickhttp', email: 'pickhttp@example.invalid', password: 'secret123' }) });
    assert.strictEqual(reg.status, 200);
    const player = { Cookie: reg.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
    assert.strictEqual((await call('PUT', '/api/admin/pickaxe/settings', { mode: 'testers', testers: 'inconnu' })).status, 400);
    const put = await call('PUT', '/api/admin/pickaxe/settings', { mode: 'testers', testers: 'PICKHTTP', capacity: 1500, regenSeconds: 3, note: 'recette' });
    assert.strictEqual(put.status, 200);
    const sum = await put.json();
    assert.deepStrictEqual(sum.testers.map(x => x.username), ['pickhttp']);
    assert.strictEqual(sum.preview.capacity[1].value, 2250);
    assert.deepStrictEqual(await (await fetch(`${BASE}/api/pickaxe/config`)).json(), { enabled: false }, 'invité : désactivé');
    const conf = await (await call('GET', '/api/pickaxe/config', null, player)).json();
    assert.deepStrictEqual([conf.enabled, conf.capacity, conf.regenSeconds], [true, 1500, 3]);
    const seasonId = (await (await fetch(`${BASE}/api/seasons/current`)).json()).season.id;
    let baseRevision = null;
    const send = async pickaxe => {
      const r = await call('POST', '/api/me/save', { data: { coins: 5, gems: 0, lastSaveTime: Date.now(), upgrades: { autodig: 0 }, seasonStats: { seasonId }, pickaxe }, baseRevision }, player);
      const body = await r.json();
      if (r.ok) baseRevision = body.revision;
      return r.status;
    };
    assert.strictEqual(await send({ charges: 1500, fullHits: 0, refilled: 0, capLevel: 0, speedLevel: 0 }), 200);
    assert.strictEqual(await send({ charges: 1500, fullHits: 900, refilled: 0, capLevel: 0, speedLevel: 0 }), 200);
    const adm = await (await call('GET', '/api/admin/pickaxe')).json();
    assert.strictEqual(adm.players[0].username, 'pickhttp');
    assert.ok(adm.anomalies.some(a => a.kind === 'fast_regen'));
    const stored = await (await call('GET', '/api/me/save', null, player)).json();
    assert.strictEqual(stored.save.data.pickaxe.charges, 1500, 'sauvegarde jamais modifiée');
  } finally {
    await new Promise(r => { server.once('exit', r); server.kill('SIGTERM'); });
  }
});
