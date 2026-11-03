/**
 * Audit des ligues et promotions (ticket #19, demande du propriétaire du 02/11/2026).
 * Règles ACTUELLES uniquement (aucun barème modifié) :
 *   promus = max(1, floor(actifs × promotion_rate / (1 + niveau × difficulty_coefficient))),
 *   au plus les actifs, seulement si la ligue compte ≥ min_active_players_per_league actifs ;
 *   pas de relégation. « Actif » = au moins un bloc manuel validé dans la saison (l'auto-dig ne
 *   compte pas). Tri : profondeur ↓, blocs manuels validés ↓, premier arrivé ↑, compte ↑.
 * Couvre : N ligues évolutives sur plusieurs clôtures, ligue très difficile, petits effectifs,
 * paramètres illisibles, égalités, auto-dig, panne au moment de la clôture et redémarrage,
 * absence de relégation, Mimosa = ligue (et non saison).
 * Base temporaire hors server/data/, aucun serveur HTTP.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-leagues-audit-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const seasons = require('../server/seasons');

db.initDb();
const sql = () => db.getDb();

function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

let userSeq = 0;
function newUser(leagueId) {
  return sql().prepare('INSERT INTO users (username, password_hash, league_id) VALUES (?, ?, ?)')
    .run(`audit_user_${++userSeq}`, 'x', leagueId).lastInsertRowid;
}

/** Score de saison comme après une sauvegarde validée (la ligue est celle du compte). */
function play(seasonId, userId, depth, blocks, { reachedAt = null, autoBlocks = 0 } = {}) {
  const leagueId = sql().prepare('SELECT league_id FROM users WHERE id = ?').get(userId).league_id;
  sql().prepare(`
    INSERT INTO season_rankings
      (season_id, user_id, league_id, max_depth, reported_max_depth, manual_blocks,
       effective_manual_blocks, manual_clicks, auto_blocks, is_active, max_depth_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(seasonId, userId, leagueId, depth, depth, blocks, blocks, blocks * 2, autoBlocks, reachedAt);
}

const levelOf = uid => sql().prepare(
  'SELECT l.level FROM users u JOIN leagues l ON l.id = u.league_id WHERE u.id = ?').get(uid).level;
const leagueAt = level => db.getLeagueByLevel(level);

function setConfig(key, value) {
  sql().prepare('INSERT OR REPLACE INTO admin_config (key, value) VALUES (?, ?)').run(key, String(value));
}
function resetConfig() {
  setConfig('promotion_rate', '0.50');
  setConfig('difficulty_coefficient', '0.45');
  setConfig('min_active_players_per_league', '10');
}

/** Clôture la saison active ; renvoie le rapport indexé par niveau de ligue. */
function close() {
  const season = db.getActiveSeason();
  const { report } = quiet(() => seasons.closeActiveSeason(season.id, new Date()));
  return Object.fromEntries(report.map(r => [r.leagueLevel, r]));
}

/** Nombre attendu de promus selon la formule actuelle (paramètres par défaut). */
const expected = (n, level) => (n < 10 ? 0 : Math.min(n, Math.max(1, Math.floor(n * 0.5 / (1 + level * 0.45)))));

// ── Mimosa ────────────────────────────────────────────────────────────────────

test('Mimosa est la ligue de départ (niveau 0), pas un nom de saison', () => {
  const mimosa = leagueAt(0);
  assert.strictEqual(mimosa.name, 'Mimosa');
  const season = db.getActiveSeason();
  assert.notStrictEqual(season.name, 'Mimosa');
  assert.match(season.name, /^Saison /);
  // Un nouveau compte entre dans la ligue la plus basse.
  const u = db.createUser('audit_newcomer', null, 'x');
  assert.strictEqual(u.league_id, mimosa.id);
});

// ── N ligues évolutives ─────────────────────────────────────────────────────────

test('N ligues évolutives : 5 clôtures successives, 40 joueurs, ligues créées à la demande', () => {
  resetConfig();
  const cohort = Array.from({ length: 40 }, () => newUser(leagueAt(0).id));
  const history = [cohort.map(levelOf)];

  for (let week = 0; week < 5; week++) {
    const season = db.getActiveSeason();
    // Le classement de chaque semaine reprend l'ordre de la cohorte (le 1er est le meilleur).
    cohort.forEach((uid, i) => play(season.id, uid, 2000 - i * 10, 300 - i));
    const before = cohort.map(levelOf);
    const counts = {};
    before.forEach(l => { counts[l] = (counts[l] ?? 0) + 1; });

    const report = close();
    const after  = cohort.map(levelOf);

    for (const [lvl, n] of Object.entries(counts)) {
      const r = report[lvl];
      assert.ok(r, `semaine ${week + 1} : ligue ${lvl} présente au rapport`);
      assert.strictEqual(r.activePlayers, n);
      assert.strictEqual(r.promoted, expected(n, Number(lvl)),
        `semaine ${week + 1}, niveau ${lvl} : ${n} actifs → ${expected(n, Number(lvl))} promus`);
      if (n >= 10) assert.ok(r.promoted >= 1, 'ligue éligible : au moins un promu');
      // Les promus sont les meilleurs de leur ligue, dans l'ordre du classement.
      const members = cohort.filter((_, i) => before[i] === Number(lvl));
      assert.deepStrictEqual((r.promotedUsers ?? []).map(p => p.userId), members.slice(0, r.promoted));
    }
    // Au plus un niveau gagné par clôture, jamais de descente (pas de relégation).
    after.forEach((l, i) => assert.ok(l === before[i] || l === before[i] + 1, `joueur ${i + 1} : ${before[i]} → ${l}`));
    history.push(after);
  }

  // Répartition par niveau après chaque clôture (calculée à la main avec la formule actuelle).
  const spread = levels => levels.reduce((acc, l) => { acc[l] = (acc[l] ?? 0) + 1; return acc; }, {});
  assert.deepStrictEqual(history.slice(1).map(spread), [
    { 0: 20, 1: 20 },
    { 0: 10, 1: 24, 2: 6 },
    { 0: 5, 1: 21, 2: 14 },
    { 0: 5, 1: 14, 2: 18, 3: 3 },
    { 0: 5, 1: 10, 2: 18, 3: 7 },
  ]);
  // Le seuil de 10 actifs freine le sommet : la ligue Or (3 puis 7 actifs) ne promeut pas encore.
  assert.strictEqual(history.at(-1)[0], 3);
  assert.deepStrictEqual([1, 2, 3].map(l => leagueAt(l).name), ['Bronze', 'Argent', 'Or']);
  assert.strictEqual(leagueAt(4), null, 'aucune ligue créée sans promu');
});

// ── Ligue très difficile et petits effectifs ───────────────────────────────────

test('ligue très difficile (niveau 12) : la formule donne 0 mais un promu est garanti', () => {
  resetConfig();
  let top = leagueAt(0);
  while (top.level < 12) top = db.getLeagueByLevel(top.level + 1) ?? db.createLeague(`Ligue ${top.level + 1}`, '🏆', top.level + 1, 1, null, top.level + 1);
  const season = db.getActiveSeason();
  const ids = Array.from({ length: 10 }, (_, i) => { const u = newUser(top.id); play(season.id, u, 500 - i, 50); return u; });
  // 10 × 0,5 / (1 + 12 × 0,45) = 0,78 → floor 0 → minimum 1
  const r = close()[12];
  assert.strictEqual(r.promoted, 1);
  assert.strictEqual(levelOf(ids[0]), 13);
  assert.strictEqual(leagueAt(13).name, 'Ligue 13', 'au-delà des noms prévus, nom générique');
  ids.slice(1).forEach(u => assert.strictEqual(levelOf(u), 12));
});

test('petits effectifs : sous le seuil (10 par défaut) aucune promotion ; seuil admin à 1 → un promu', () => {
  resetConfig();
  const lvl = leagueAt(0);
  let season = db.getActiveSeason();
  const solo = newUser(lvl.id);
  play(season.id, solo, 50, 5);
  let r = close()[0];
  assert.strictEqual(r.skipped, true);
  assert.strictEqual(r.reason, 'not_enough_players');
  assert.strictEqual(r.promoted, 0);
  assert.strictEqual(levelOf(solo), 0, 'situation actuelle de la production : un seul joueur, reste en Mimosa');

  // Le seuil est un réglage admin (aucun redéploiement) : à 1, le seul joueur actif est promu.
  setConfig('min_active_players_per_league', '1');
  season = db.getActiveSeason();
  play(season.id, solo, 60, 6);
  r = close()[0];
  assert.strictEqual(r.promoted, 1);
  assert.strictEqual(levelOf(solo), 1);
  resetConfig();
});

test('paramètres illisibles ou hors bornes : valeurs par défaut, minimum d\'un promu préservé', () => {
  assert.deepStrictEqual(seasons.leagueSettings({ promotion_rate: 'abc', difficulty_coefficient: '', min_active_players_per_league: '0' }),
    { promotionRate: 0.5, difficulty: 0.45, minPlayers: 10 });
  assert.deepStrictEqual(seasons.leagueSettings({ promotion_rate: '2', difficulty_coefficient: '-1', min_active_players_per_league: '2.5' }),
    { promotionRate: 0.5, difficulty: 0.45, minPlayers: 10 });
  assert.deepStrictEqual(seasons.leagueSettings({ promotion_rate: '0', difficulty_coefficient: '0', min_active_players_per_league: '3' }),
    { promotionRate: 0, difficulty: 0, minPlayers: 3 });

  // Avant correctif, « abc » donnait NaN puis 0 promu en silence.
  setConfig('promotion_rate', 'abc');
  const season = db.getActiveSeason();
  const ids = Array.from({ length: 10 }, (_, i) => { const u = newUser(leagueAt(0).id); play(season.id, u, 900 - i, 9); return u; });
  const r = close()[0];
  assert.strictEqual(r.promoted, 5);
  assert.strictEqual(levelOf(ids[0]), 1);

  // Taux à 0 (borne admise) : le minimum d'un promu s'applique quand même.
  setConfig('promotion_rate', '0');
  const s2 = db.getActiveSeason();
  const ids2 = Array.from({ length: 10 }, (_, i) => { const u = newUser(leagueAt(0).id); play(s2.id, u, 800 - i, 8); return u; });
  assert.strictEqual(close()[0].promoted, 1);
  assert.strictEqual(levelOf(ids2[0]), 1);
  resetConfig();

  // Validation du panel admin : les valeurs invalides sont refusées avant enregistrement.
  assert.ok(seasons.validateLeagueConfigValue('promotion_rate', 'abc').error);
  assert.ok(seasons.validateLeagueConfigValue('promotion_rate', '1.5').error);
  assert.ok(seasons.validateLeagueConfigValue('min_active_players_per_league', '0').error);
  assert.ok(seasons.validateLeagueConfigValue('difficulty_coefficient', '-0.1').error);
  assert.deepStrictEqual(seasons.validateLeagueConfigValue('min_active_players_per_league', ' 5 '), { value: '5' });
  assert.strictEqual(seasons.validateLeagueConfigValue('gems_cap', '1'), null);
});

// ── Égalités et auto-dig ──────────────────────────────────────────────────────

test('égalités : profondeur, puis blocs manuels validés, puis premier arrivé, puis compte ; auto-dig ignoré', () => {
  resetConfig();
  const lvl = leagueAt(0);
  const season = db.getActiveSeason();
  const ids = Array.from({ length: 10 }, () => newUser(lvl.id));
  // Promus attendus : 5. Les 3 premiers ont la même profondeur (1000).
  play(season.id, ids[0], 1000, 40, { reachedAt: '2026-11-03 10:00:00.000', autoBlocks: 0 });
  play(season.id, ids[1], 1000, 40, { reachedAt: '2026-11-03 09:00:00.000', autoBlocks: 0 });   // même score, arrivé avant
  play(season.id, ids[2], 1000, 39, { reachedAt: '2026-11-03 08:00:00.000', autoBlocks: 99999 }); // moins de blocs manuels, énorme auto-dig
  play(season.id, ids[3], 900, 10);
  play(season.id, ids[4], 900, 10);   // ex æquo parfait avec ids[3] (sans date) : compte le plus ancien d'abord
  play(season.id, ids[5], 900, 10);
  for (let i = 6; i < 10; i++) play(season.id, ids[i], 100 - i, 1);
  // Joueur 100 % auto-dig (aucun bloc manuel) très profond : jamais classé ni promu.
  const bot = newUser(lvl.id);
  db.updateAutoBlocksOnly(season.id, bot, 50000);
  sql().prepare('UPDATE season_rankings SET max_depth = 99999 WHERE season_id = ? AND user_id = ?').run(season.id, bot);

  const r = close()[0];
  assert.strictEqual(r.activePlayers, 10, 'joueur auto-dig exclu de l\'effectif');
  assert.deepStrictEqual(r.promotedUsers.map(p => p.userId), [ids[1], ids[0], ids[2], ids[3], ids[4]]);
  assert.strictEqual(levelOf(ids[5]), 0, '6e (ex æquo du 5e, compte plus récent) non promu');
  assert.strictEqual(levelOf(bot), 0);
});

// ── Panne et redémarrage ────────────────────────────────────────────────────────

test('panne au moment de la clôture : rien n\'est appliqué ; reprise → promotion une seule fois', () => {
  resetConfig();
  const lvl = leagueAt(0);
  const season = db.getActiveSeason();
  const ids = Array.from({ length: 10 }, (_, i) => { const u = newUser(lvl.id); play(season.id, u, 700 - i, 7); return u; });
  const leaguesBefore = sql().prepare('SELECT COUNT(*) n FROM leagues').get().n;

  // Panne simulée pendant l'ouverture de la saison suivante (dernière étape de la transaction).
  sql().exec("CREATE TEMP TRIGGER audit_crash BEFORE INSERT ON seasons BEGIN SELECT RAISE(ABORT, 'panne simulée'); END;");
  assert.throws(() => quiet(() => seasons.closeActiveSeason(season.id, new Date())), /panne simulée/);
  sql().exec('DROP TRIGGER audit_crash');
  assert.strictEqual(db.getSeasonById(season.id).status, 'active', 'saison toujours active');
  ids.forEach(u => assert.strictEqual(levelOf(u), 0, 'aucune promotion partielle'));
  assert.strictEqual(sql().prepare('SELECT COUNT(*) n FROM leagues').get().n, leaguesBefore);

  // Redémarrage : migrations rejouées, puis clôture normale.
  db.initDb();
  ids.forEach(u => assert.strictEqual(levelOf(u), 0));
  const r = close()[0];
  assert.strictEqual(r.promoted, 5);
  const levels = ids.map(levelOf);
  assert.deepStrictEqual(levels, [1, 1, 1, 1, 1, 0, 0, 0, 0, 0]);

  // Nouveau redémarrage et passages du planificateur : aucune seconde promotion.
  db.initDb();
  quiet(() => { seasons.checkAndRotateSeason(new Date()); seasons.checkAndRotateSeason(new Date()); });
  assert.throws(() => seasons.closeActiveSeason(season.id, new Date()), /déjà/);
  assert.deepStrictEqual(ids.map(levelOf), levels);
});
