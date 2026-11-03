/**
 * Journaux anti-bot et anti-autoclicker — recette propriétaire #25 du 03/11/2026.
 * Vérifie sur une base isolée (données synthétiques, aucune donnée de production) :
 *  - les anomalies sont toujours journalisées, les sauvegardes normales (« none ») jamais ;
 *  - chaque type émis par le serveur a un filtre dans l'admin, et chaque filtre un émetteur ;
 *  - filtres par famille, période et action appliqués en SQL (rien de masqué au-delà de 100 lignes) ;
 *  - la synthèse expose le dernier contrôle de chaque joueur sans rien journaliser.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-antibot-journals-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
delete process.env.ANTIBOT;

const db      = require('../server/db');
const seasons = require('../server/seasons');
const antibot = require('../server/antibot');

const CONFIG = { max_effective_cps: '8', anti_autoclick_enabled: 'true', antibot_mode: 'shadow' };
let season;
let userSeq = 0;

function newUser() {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(`jr_user_${++userSeq}`, 'x').lastInsertRowid;
}
const acLogs  = userId => db.getDb().prepare('SELECT * FROM anticheat_logs WHERE user_id = ?').all(userId);
const secLogs = userId => db.getDb().prepare('SELECT * FROM security_events WHERE user_id = ?').all(userId);
const read    = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** Options d'un <select id="…"> de l'admin. */
function selectOptions(html, id) {
  const m = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
  assert.ok(m, id);
  return [...m[1].matchAll(/<option value="([^"]*)"/g)].map(x => x[1]).filter(Boolean);
}

test.before(() => {
  db.initDb();
  season = db.getActiveSeason();
  assert.ok(season, 'saison active du seed');
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anti-autoclic : jeu normal → action « none » jamais journalisée ; anomalies toujours journalisées', () => {
  const t0 = Date.UTC(2026, 10, 3, 12, 0, 0);
  const run = (u, steps) => steps.map(s => seasons.processAntiCheat(u, season.id,
    { manualClicks: s.c, manualBlocks: s.b, regularityScore: 0.3 }, CONFIG, 'synthetic', t0 + s.t * 1000).action);

  const normal = newUser();
  const a = run(normal, [{ t: 0, c: 0, b: 0 }, { t: 30, c: 150, b: 40 }, { t: 60, c: 300, b: 80 }, { t: 600, c: 300, b: 80 }]);
  assert.deepStrictEqual(a, ['init', 'none', 'none', 'none']);
  assert.strictEqual(acLogs(normal).length, 0);

  const fast = newUser();
  assert.deepStrictEqual(run(fast, [{ t: 0, c: 0, b: 0 }, { t: 30, c: 1500, b: 600 }]), ['init', 'flagged']);
  assert.deepStrictEqual(acLogs(fast).map(l => l.action_taken), ['flagged']);

  const gt = newUser();
  assert.deepStrictEqual(run(gt, [{ t: 0, c: 0, b: 0 }, { t: 30, c: 10, b: 50 }]), ['init', 'rejected']);
  assert.deepStrictEqual(acLogs(gt).map(l => l.action_taken), ['rejected']);
});

test('sauvegarde complète : normale → aucun événement de sécurité, mais dernier contrôle visible ; compteurs forgés → journalisés', () => {
  const honest = newUser();
  seasons.syncPlayerRanking(honest, { seasonId: season.id, maxDepth: 1, manualBlocks: 0, manualClicks: 0, autoBlocks: 0 });
  // Une minute de jeu écoulée depuis ce premier contrôle
  db.getDb().prepare('UPDATE player_depth_tracking SET updated_ms = updated_ms - 60000 WHERE user_id = ?').run(honest);
  db.getDb().prepare("UPDATE player_click_tracking SET last_save_at = datetime(last_save_at, '-60 seconds') WHERE user_id = ?").run(honest);
  seasons.syncPlayerRanking(honest, { seasonId: season.id, maxDepth: 3, manualBlocks: 2, manualClicks: 6, autoBlocks: 0 });
  assert.strictEqual(secLogs(honest).length, 0);
  assert.strictEqual(acLogs(honest).length, 0);

  const sum = antibot.buildSummary(season.id, CONFIG);
  const check = sum.checks.find(c => c.userId === honest);
  assert.ok(check, 'le dernier contrôle du joueur honnête est présenté');
  assert.ok(Date.now() - Date.parse(check.lastCheck) < 60_000);
  assert.strictEqual(check.acceptedDepth, 3);
  assert.strictEqual(check.depthGap, 0);
  assert.strictEqual(check.score, 0);
  assert.ok(sum.trackedAccounts >= 1 && sum.checkedLast24h >= 1);
  assert.strictEqual(sum.sanctionsApplied, false);
  assert.strictEqual(sum.eventsByGroup.player.total, 0);

  const forger = newUser();
  seasons.syncPlayerRanking(forger, { seasonId: season.id, maxDepth: 1, manualBlocks: 0, manualClicks: -5, autoBlocks: 0 });
  // Preuve (40 points) : l'indice et le passage au niveau 1 (non appliqué) sont journalisés
  assert.deepStrictEqual(secLogs(forger).map(e => e.type).sort(), ['forged_counters', 'risk_level']);
  const sum2 = antibot.buildSummary(season.id, CONFIG);
  assert.strictEqual(sum2.eventsByGroup.player.d1, 2);
  assert.strictEqual(sum2.checks.find(c => c.userId === forger).score, 40);
  assert.strictEqual(antibot.listEvents({ group: 'player' }).total, 2);
});

test('types émis par le serveur = familles du journal = options du filtre admin', () => {
  // Types littéraux passés à logSecurityEvent dans le serveur + signaux du score + risk_level
  const emitted = new Set([...Object.keys(antibot.SIGNALS), 'risk_level']);
  for (const f of fs.readdirSync(path.join(ROOT, 'server')).filter(f => f.endsWith('.js'))) {
    for (const m of read(`server/${f}`).matchAll(/logSecurityEvent\('([a-z_]+)'/g)) emitted.add(m[1]);
  }
  const grouped = Object.values(antibot.EVENT_GROUPS).flat();
  assert.deepStrictEqual([...emitted].sort(), [...grouped].sort(), 'chaque type émis appartient à une famille');

  const opts = selectOptions(read('public/admin/index.html'), 'sec-filter-type');
  const types = opts.filter(o => !o.startsWith('group:'));
  assert.deepStrictEqual([...types].sort(), [...grouped].sort(), 'un filtre par type émis, aucun filtre orphelin');
  assert.deepStrictEqual(opts.filter(o => o.startsWith('group:')).map(o => o.slice(6)).sort(), Object.keys(antibot.EVENT_GROUPS).sort());
});

test('actions anti-autoclicker émises = filtre admin = actions acceptées par l\'API', () => {
  const emitted = new Set();
  for (const f of ['server/seasons.js', 'server/index.js']) {
    const src = read(f);
    for (const m of src.matchAll(/insertAntiCheatLog\(([\s\S]*?)\);/g)) {
      // Action littérale : argument seul sur sa ligne (`'admin_fix',`)
      for (const lit of m[1].matchAll(/^\s*'([a-z_]+)',?\s*$/gm)) emitted.add(lit[1]);
    }
    // processAntiCheat : action calculée (flagged | reduced | rejected)
    for (const m of src.matchAll(/\? \(cpsRatio < 0\.40 \? '([a-z]+)' : '([a-z]+)'\)\s*:\s*'([a-z]+)'/g)) m.slice(1).forEach(a => emitted.add(a));
    // validateDepth : logAction = '…'
    for (const m of src.matchAll(/logAction = '([a-z_]+)'/g)) emitted.add(m[1]);
  }
  const api = read('server/index.js').match(/const ANTICHEAT_ACTIONS = \[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  const opts = selectOptions(read('public/admin/index.html'), 'ac-filter-action');
  assert.deepStrictEqual([...emitted].sort(), [...api].sort());
  assert.deepStrictEqual([...opts].sort(), [...api].sort());
});

test('filtres en SQL : action au-delà des 100 dernières lignes, famille et période', () => {
  const u = newUser();
  // Anomalie ancienne puis 150 plus récentes d'un autre type : l'ancienne reste trouvable
  db.insertAntiCheatLog(u, 'old', season.id, 30, 10, 0.3, 0.1, 0.5, 'reduced');
  db.getDb().prepare("UPDATE anticheat_logs SET logged_at = datetime('now', '-3 days') WHERE user_id = ?").run(u);
  for (let i = 0; i < 150; i++) db.insertAntiCheatLog(u, 'new', season.id, 30, 600, 20, 0.1, 0.4, 'flagged');
  const reduced = db.getAntiCheatLogs(100, 0, 'reduced');
  assert.ok(reduced.some(l => l.user_id === u), 'l\'anomalie ancienne n\'est plus masquée par les 100 dernières lignes');
  assert.strictEqual(db.countAntiCheatLogs('reduced'), reduced.length);
  assert.ok(db.getAntiCheatLogs(100, 0, 'flagged').every(l => l.action_taken === 'flagged'));
  const cov = db.getAntiCheatCoverage(season.id);
  assert.ok(cov.players >= 1 && cov.lastCheckAt);

  // Journal de sécurité : un événement admin d'il y a 10 jours, un événement système récent
  antibot.logSecurityEvent('admin_config', { details: { key: 'x', old: '1', new: '2' } });
  db.getDb().prepare("UPDATE security_events SET created_at = datetime('now', '-10 days') WHERE type = 'admin_config'").run();
  antibot.logSecurityEvent('standings_frozen', { seasonId: season.id });
  assert.strictEqual(antibot.listEvents({ group: 'admin' }).total, 1);
  assert.strictEqual(antibot.listEvents({ group: 'admin', sinceDays: 7 }).total, 0);
  assert.strictEqual(antibot.listEvents({ group: 'admin', sinceDays: 30 }).total, 1);
  assert.strictEqual(antibot.listEvents({ group: 'system', sinceDays: 1 }).total, 1);
  assert.ok(antibot.listEvents({ group: 'player' }).events.every(e => antibot.EVENT_GROUPS.player.includes(e.type)));
  const g = antibot.buildSummary(season.id, CONFIG).eventsByGroup;
  assert.deepStrictEqual(g.admin, { d1: 0, d7: 0, d30: 1, total: 1 });
  assert.strictEqual(g.system.d1, 1);
});

test('admin : journal renommé, explication des sauvegardes normales, états vides explicites', () => {
  const html = read('public/admin/index.html');
  const js   = read('public/admin/admin.js');
  assert.match(html, /Journal des anomalies anti-autoclicker/);
  assert.match(html, /Les clics et sauvegardes normaux ne sont pas affichés/);
  assert.match(html, /Une sauvegarde normale ne crée aucune entrée de journal/);
  assert.match(html, /id="sec-checks-body"/);
  assert.match(html, /id="sec-filter-days"/);
  assert.match(js, /Aucune anomalie détectée dans cette catégorie sur cette période/);
  assert.doesNotMatch(js, /filter\(l => l\.action_taken === action\)/, 'plus de filtrage côté client sur 100 lignes');
});
