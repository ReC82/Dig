/**
 * Ticket #92 — signatures ciblées d'extensions d'autoclic : OFF par défaut, « Mon compte de test »,
 * activation par signature, arrêt d'urgence, journal court, réaction « vérification » optionnelle,
 * aucune sanction pour une extension installée, rien de lu pour les signatures non activées.
 * Pipeline réel (seasons.syncPlayerRanking) sur base isolée.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-ext-92-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const seasons = require('../server/seasons');
const ext     = require('../server/extensionSignatures');

const ROOT = path.join(__dirname, '..');
const T0 = Date.UTC(2026, 10, 9, 8, 0, 0);
let seasonId;
let seq = 0;

const cfg = (k, v) => db.setAdminConfig(k, v);
const config = () => db.getAdminConfig();
function newUser() {
  return Number(db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`ext92_${++seq}`, 'x').lastInsertRowid);
}
const events = userId => db.getDb().prepare(`SELECT details FROM security_events WHERE user_id = ? AND type = 'extension_signature' ORDER BY id`).all(userId).map(r => JSON.parse(r.details));
const challenges = userId => db.getDb().prepare('SELECT * FROM antibot_challenges WHERE user_id = ? ORDER BY id').all(userId);
const suspensions = userId => db.getDb().prepare('SELECT * FROM antibot_suspensions WHERE user_id = ?').all(userId);

function resetExt() {
  db.getDb().prepare("DELETE FROM admin_config WHERE key LIKE 'ab_ext_%'").run();
}

/** Sauvegarde humaine (rythme irrégulier, souris qui bouge) avec un résultat de signature. */
function save(userId, nowMs, clicks, e) {
  const tel = { v: 2, n: clicks, h: [0, 0, 0, 0, 0, clicks - 1, 0, 0], u: e ? clicks : 0, x: 0, p: { m: clicks, t: 0, k: 0, o: 0 },
    f: { k: clicks - 1, t3: 0.3, med: 200, mad: 60, coarse: 0, sp: 1, run: 1, mc: clicks, mm: clicks, still: 0 }, ...(e ? { e } : {}) };
  return seasons.syncPlayerRanking(userId, { seasonId, maxDepth: 2, manualBlocks: 1, autoBlocks: 0, manualClicks: clicks, suspiciousScore: 0 },
    { nowMs, telemetry: tel });
}

test.before(() => {
  db.initDb();
  const s = db.getActiveSeason() ?? db.createSeason('Test #92', '2026-11-01 00:00:00', '2026-11-30 23:59:59', 'active');
  db.getDb().prepare(`UPDATE seasons SET start_at = '2026-11-01 00:00:00', end_at = '2026-11-30 23:59:59' WHERE id = ?`).run(s.id);
  seasonId = s.id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('catalogue : statut, méthode, ID exacts ; aucune signature sans preuve n\'est activable pour tous', () => {
  const op = ext.CATALOG.find(s => s.id === 'op_auto_clicker');
  assert.strictEqual(op.stores[0].id, 'kpmbpdpbjjadabknommjfphilmecebab');
  assert.strictEqual(op.stores[0].version, '0.1.4');
  assert.strictEqual(op.status, 'detectable');
  assert.ok(op.activeVerified && op.probe.active);
  for (const s of ext.CATALOG) {
    assert.ok(ext.STATUS[s.status], s.id);
    assert.ok(s.method && s.tested, s.id);
    if (s.status === 'undetectable') assert.strictEqual(s.probe, null, `${s.id} : pas de sonde pour une extension non détectable`);
  }
  assert.ok(ext.CATALOG.some(s => s.browsers.includes('firefox')));
});

test('OFF par défaut : aucune signature envoyée au jeu, rien lu ni journalisé', () => {
  resetExt();
  const u = newUser();
  const st = ext.getSettings(config());
  assert.ok(Object.values(st.sigs).every(m => m === 'off'));
  assert.strictEqual(st.stop, 'off');
  assert.strictEqual(st.reaction, 'log');
  assert.deepStrictEqual(ext.forUser(u, config()), []);
  assert.deepStrictEqual(seasons.buildCurrentSeasonResponse(u).config.extSignatures, []);
  save(u, T0, 30, { op_auto_clicker: { i: 1, a: 30 } });
  assert.deepStrictEqual(events(u), []);
  assert.deepStrictEqual(challenges(u), []);
});

test('validation des interrupteurs : global refusé pour une signature incertaine, rien pour une non détectable', () => {
  assert.deepStrictEqual(ext.validateConfigValue('ab_ext_sig_op_auto_clicker', 'global'), { value: 'global' });
  assert.ok(ext.validateConfigValue('ab_ext_sig_io_auto_clicker_firefox', 'global').error);
  assert.deepStrictEqual(ext.validateConfigValue('ab_ext_sig_io_auto_clicker_firefox', 'self'), { value: 'self' });
  assert.ok(ext.validateConfigValue('ab_ext_sig_auto_clicker_cpedeo', 'self').error);
  assert.ok(ext.validateConfigValue('ab_ext_sig_inconnue', 'off').error);
  assert.ok(ext.validateConfigValue('ab_ext_reaction', 'ban').error);
  assert.ok(ext.validateConfigValue('ab_ext_test_users', '1,2,3,4,5,6').error);
  assert.deepStrictEqual(ext.validateConfigValue('ab_ext_test_users', ' 3 , 4 '), { value: '3,4' });
  assert.strictEqual(ext.validateConfigValue('autre_cle', 'x'), null);
  // Valeur forgée en base : jamais « global » pour une signature non vérifiée
  cfg('ab_ext_sig_io_auto_clicker_firefox', 'global');
  assert.strictEqual(ext.getSettings(config()).sigs.io_auto_clicker_firefox, 'off');
  resetExt();
});

test('« Mon compte de test » : seul le compte choisi vérifie la signature et voit le résultat', () => {
  resetExt();
  const me = newUser();
  const other = newUser();
  cfg('ab_ext_test_users', String(me));
  cfg('ab_ext_sig_op_auto_clicker', 'self');
  const mine = ext.forUser(me, config());
  assert.deepStrictEqual(mine.map(s => s.id), ['op_auto_clicker']);
  assert.ok(mine[0].probe.install.id === 'AutoClickerIndicator' && mine[0].probe.active);
  assert.deepStrictEqual(ext.forUser(other, config()), []);
  // Chargement du jeu : « détectée » puis, sans extension, « non détectée » (visible pour l'essai)
  const r1 = ext.record(me, { op_auto_clicker: { i: 1, a: 0 } }, { config: config(), source: 'load', nowMs: T0 });
  assert.deepStrictEqual(r1.feedback.map(f => [f.id, f.installed]), [['op_auto_clicker', true]]);
  const r2 = ext.record(me, { op_auto_clicker: { i: 0, a: 0 } }, { config: config(), source: 'load', nowMs: T0 + 1000 });
  assert.strictEqual(r2.feedback[0].installed, false);
  assert.deepStrictEqual(events(me).map(e => [e.state, e.mode, e.source]), [['installed', 'self', 'load'], ['none', 'self', 'load']]);
  // Un autre joueur : résultat ignoré, ni journal ni message
  const r3 = ext.record(other, { op_auto_clicker: { i: 1, a: 50 } }, { config: config(), nowMs: T0 });
  assert.deepStrictEqual(r3, { results: [], challenge: null, feedback: null });
  assert.deepStrictEqual(events(other), []);
});

test('pas d\'inventaire : signatures non activées ou inconnues ignorées ; journal dédoublonné 10 min', () => {
  resetExt();
  const u = newUser();
  cfg('ab_ext_sig_op_auto_clicker', 'global');
  const r = ext.normalizeResults({ op_auto_clicker: { i: 1, a: 3 }, autofill_auto_clicker: { i: 1 }, uBlock: { i: 1 }, __proto__: { i: 1 } }, u, config());
  assert.deepStrictEqual(r.map(x => x.id), ['op_auto_clicker']);
  ext.record(u, { op_auto_clicker: { i: 1 } }, { config: config(), nowMs: T0 });
  ext.record(u, { op_auto_clicker: { i: 1 } }, { config: config(), nowMs: T0 + 5 * 60_000 });
  ext.record(u, { op_auto_clicker: { i: 0 } }, { config: config(), nowMs: T0 + 6 * 60_000 });   // global : « non détectée » non journalisée
  ext.record(u, { op_auto_clicker: { i: 1 } }, { config: config(), nowMs: T0 + 11 * 60_000 });
  assert.deepStrictEqual(events(u).map(e => e.state), ['installed', 'installed']);
  // Joueur ordinaire en mode global : aucun message
  assert.strictEqual(ext.record(u, { op_auto_clicker: { i: 1 } }, { config: config(), nowMs: T0 }).feedback, null);
});

test('extension installée (même active) en réaction « journal » : aucune vérification, aucune suspension', () => {
  resetExt();
  cfg('antibot_response_mode', 'enforce');
  cfg('ab_ext_sig_op_auto_clicker', 'global');
  const u = newUser();
  save(u, T0, 40, { op_auto_clicker: { i: 1, a: 40 } });
  assert.deepStrictEqual(challenges(u), []);
  assert.deepStrictEqual(suspensions(u), []);
  assert.deepStrictEqual(events(u).map(e => [e.state, e.reaction, e.source]), [['active', 'log', 'save']]);
});

test('réaction « vérification » : énigme seulement si l\'indicateur est actif pendant ≥ 5 coups, jamais une suspension', () => {
  resetExt();
  cfg('antibot_response_mode', 'enforce');
  cfg('ab_ext_sig_op_auto_clicker', 'global');
  cfg('ab_ext_sig_autofill_auto_clicker', 'global');
  cfg('ab_ext_reaction', 'challenge');
  const idle = newUser();
  save(idle, T0, 40, { op_auto_clicker: { i: 1, a: 0 }, autofill_auto_clicker: { i: 1, a: 40 } });   // installée, indicateur non vérifié
  assert.deepStrictEqual(challenges(idle), [], 'installée seulement : aucune vérification');
  const few = newUser();
  save(few, T0, 40, { op_auto_clicker: { i: 1, a: ext.ACTIVE_MIN_HITS - 1 } });
  assert.deepStrictEqual(challenges(few), []);
  const u = newUser();
  const st = save(u, T0, 40, { op_auto_clicker: { i: 1, a: 40 } });
  const ch = challenges(u);
  assert.strictEqual(ch.length, 1);
  assert.strictEqual(ch[0].status, 'pending');
  const reason = JSON.parse(ch[0].reasons).reasons.find(r => r.code === 'extension_active');
  assert.deepStrictEqual([reason.signature, reason.value], ['op_auto_clicker', 40]);
  assert.ok(st?.challenge, 'le jeu reçoit la vérification');
  assert.deepStrictEqual(suspensions(u), []);
  // Observation : simulée seulement
  cfg('antibot_response_mode', 'observe');
  const o = newUser();
  save(o, T0, 40, { op_auto_clicker: { i: 1, a: 40 } });
  assert.deepStrictEqual(challenges(o).map(c => c.status), ['shadow']);
  cfg('antibot_response_mode', 'enforce');
});

test('arrêt d\'urgence dédié : plus rien n\'est envoyé, lu ni déclenché ; #91 reste actif', () => {
  resetExt();
  cfg('ab_ext_sig_op_auto_clicker', 'global');
  cfg('ab_ext_reaction', 'challenge');
  cfg('ab_ext_stop', 'on');
  const u = newUser();
  assert.deepStrictEqual(ext.forUser(u, config()), []);
  save(u, T0, 40, { op_auto_clicker: { i: 1, a: 40 } });
  assert.deepStrictEqual(events(u), []);
  assert.deepStrictEqual(challenges(u), []);
  assert.strictEqual(config().ab_fast_mode, 'on');
  resetExt();
});

test('vue admin : catalogue, interrupteurs, comptes de test, journal, compteur 7 jours', () => {
  resetExt();
  const u = newUser();
  cfg('ab_ext_test_users', String(u));
  cfg('ab_ext_sig_op_auto_clicker', 'self');
  ext.record(u, { op_auto_clicker: { i: 1 } }, { config: config(), source: 'load', nowMs: Date.now() });
  const v = ext.adminView(config());
  const op = v.signatures.find(s => s.id === 'op_auto_clicker');
  assert.strictEqual(op.mode, 'self');
  assert.ok(op.canGlobal && op.canSelf);
  assert.strictEqual(op.players7d >= 1, true);
  assert.ok(!v.signatures.find(s => s.id === 'gg_auto_clicker').canSelf);
  assert.deepStrictEqual(v.testUsers, [{ id: u, username: `ext92_${seq}` }]);
  assert.strictEqual(v.journal[0].signature, 'op_auto_clicker');
  assert.strictEqual(v.journal[0].username, `ext92_${seq}`);
  assert.ok(v.browsers.firefox && v.statusLabels.uncertain);
});

test('jeu et admin : module de vérification chargé, élément témoin retiré, envoi seulement si activé', () => {
  const probe = fs.readFileSync(path.join(ROOT, 'public/js/extProbe.js'), 'utf8');
  assert.match(probe, /finally \{ el\.remove\(\); \}/);
  assert.doesNotMatch(probe, /chrome-extension:|moz-extension:|fetch\(/, 'aucune sonde par URL d\'extension');
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('js/extProbe.js') > 0 && html.indexOf('js/extProbe.js') < html.indexOf('js/main.js'));
  const main = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
  assert.match(main, /if \(!_extSigs\.length \|\| !window\.DigExtProbe\) return undefined;/);
  const admin = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
  for (const id of ['sec-ext', 'btn-sec-ext-check', 'sec-ext-browser', 'sec-ext-q', 'sec-ext-users-form', 'sec-ext-body', 'sec-ext-journal']) assert.ok(admin.includes(`id="${id}"`), id);
  assert.ok(admin.includes('/js/extProbe.js'));
});
