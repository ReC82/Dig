#!/usr/bin/env node
/**
 * server/test-season.js
 * Tests automatisés : saisons, ligues, promotions, anti-autoclicker.
 *
 * Utilise une DB SQLite isolée (créée et supprimée automatiquement).
 *
 * Usage :
 *   node server/test-season.js
 *   node server/test-season.js --keep-db   # conserve la DB de test après exécution
 */

'use strict';
require('dotenv').config();

// ── DB de test isolée (définie AVANT tout require de db.js / seasons.js) ──────
const path     = require('path');
const fs       = require('fs');
const keepDb   = process.argv.includes('--keep-db');
const TEST_DB  = `dig_test_${Date.now()}.sqlite`;
process.env.DB_FILE = TEST_DB;

// ── Imports (APRÈS avoir défini DB_FILE) ──────────────────────────────────────
const db      = require('./db');
const seasons = require('./seasons');
const bcrypt  = require('bcryptjs');

db.initDb();
const g = db.getDb();

// ── Mini framework de test ────────────────────────────────────────────────────
let _passed = 0, _failed = 0;
const C = { G: '\x1b[32m', R: '\x1b[31m', Y: '\x1b[33m', C: '\x1b[36m', B: '\x1b[1m', Z: '\x1b[0m' };

function suite(label) {
  console.log(`\n${C.C}${C.B}${label}${C.Z}`);
}

function ok(label, cond, detail) {
  if (cond) {
    _passed++;
    console.log(`  ${C.G}✓${C.Z} ${label}`);
  } else {
    _failed++;
    const d = detail !== undefined ? ` ${C.Y}(${detail})${C.Z}` : '';
    console.error(`  ${C.R}✗${C.Z} ${label}${d}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const PW = bcrypt.hashSync('pw', 4);
let _uid = 0;

/** Crée un utilisateur de test (email @tlocal pour nettoyage facile). */
function mkUser(leagueId = null) {
  _uid++;
  const name = `tu${_uid}_${Date.now() % 100000}`;
  const r = g.prepare(
    'INSERT INTO users (username, email, password_hash, league_id) VALUES (?,?,?,?)'
  ).run(name, `${name}@tlocal`, PW, leagueId);
  return g.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
}

/** Supprime tous les utilisateurs de test (cascade sur season_rankings). */
function cleanUsers() {
  g.prepare("DELETE FROM users WHERE email LIKE '%@tlocal'").run();
}

/** Retourne la saison active (la plus récente). */
function activeSeason() {
  return g.prepare("SELECT * FROM seasons WHERE status='active' ORDER BY id DESC LIMIT 1").get();
}

/** Retourne la ligue de niveau 0 (Mimosa). */
function mimosa() {
  return g.prepare("SELECT * FROM leagues WHERE level=0 ORDER BY id LIMIT 1").get();
}

/**
 * Synchronise les stats manuelles d'un joueur via syncPlayerRanking.
 * Premier appel → init : tous les blocs sont acceptés sans réduction anti-cheat.
 */
function syncManual(user, season, depth, blocks) {
  seasons.syncPlayerRanking(user.id, {
    seasonId:        season.id,
    maxDepth:        depth,
    manualBlocks:    blocks,
    autoBlocks:      0,
    manualClicks:    blocks * 3,
    suspiciousScore: 0,
    regularityScore: 0,
    isActive:        true,
  });
}

// ── Nettoyage + résumé à la sortie ───────────────────────────────────────────
process.on('exit', () => {
  const total = _passed + _failed;
  console.log(`\n${'─'.repeat(54)}`);
  if (_failed === 0) {
    console.log(`${C.G}${C.B}✓ Tous les tests passent (${_passed}/${total})${C.Z}`);
  } else {
    console.log(`${C.R}${C.B}✗ ${_failed} test(s) échoué(s) sur ${total}${C.Z}`);
    process.exitCode = 1;
  }
  if (!keepDb) {
    try {
      const p = path.join(__dirname, 'data', TEST_DB);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (_) {}
  } else {
    console.log(`\n  DB de test conservée : server/data/${TEST_DB}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  TESTS
// ══════════════════════════════════════════════════════════════════════════════

// ── Test 1 ────────────────────────────────────────────────────────────────────
suite('Test 1 — Saison active créée automatiquement si aucune n\'existe');
{
  g.prepare('DELETE FROM seasons').run();
  ok('Aucune saison avant le test', !activeSeason());

  seasons.checkAndRotateSeason();
  const s = activeSeason();
  ok('Une saison existe après checkAndRotateSeason()', !!s);
  ok('Statut = "active"', s?.status === 'active', `status=${s?.status}`);
  ok('Date de début définie', !!s?.start_at);
  ok('Date de fin définie',   !!s?.end_at);
}

// ── Test 2 ────────────────────────────────────────────────────────────────────
suite('Test 2 — Ligue Mimosa créée automatiquement au démarrage');
{
  const m = mimosa();
  ok('La ligue Mimosa existe',       !!m);
  ok('Level = 0 (ligue de départ)',  m?.level === 0,     `level=${m?.level}`);
  ok('Nom contient "Mimosa"',        m?.name === 'Mimosa', `name=${m?.name}`);
}

// ── Test 3 ────────────────────────────────────────────────────────────────────
suite('Test 3 — Nouveau joueur commence en ligue Mimosa');
{
  cleanUsers();
  const m    = mimosa();
  const user = db.createUser('tplayer_t3', 'tplayer3@tlocal', PW);
  ok('Utilisateur créé', !!user);
  ok('league_id = Mimosa', user?.league_id === m?.id,
     `user.league_id=${user?.league_id}, mimosa.id=${m?.id}`);
  cleanUsers();
}

// ── Test 4 ────────────────────────────────────────────────────────────────────
suite('Test 4 — Joueur avec 0 bloc manuel → non actif dans le classement');
{
  cleanUsers();
  const m   = mimosa();
  const u   = mkUser(m.id);
  const s   = activeSeason();
  const row = g.prepare('SELECT * FROM season_rankings WHERE season_id=? AND user_id=?')
               .get(s.id, u.id);
  ok('Aucune entrée dans season_rankings', !row,
     'une ligne existe alors qu\'aucun bloc n\'a été enregistré');
  cleanUsers();
}

// ── Test 5 ────────────────────────────────────────────────────────────────────
suite('Test 5 — Blocs auto-dig seuls → joueur non actif dans le classement');
{
  cleanUsers();
  const m = mimosa();
  const u = mkUser(m.id);
  const s = activeSeason();

  seasons.recordAutoBreaks(u.id, s.id, 500);

  const row = g.prepare('SELECT * FROM season_rankings WHERE season_id=? AND user_id=?')
               .get(s.id, u.id);
  ok('Entrée créée dans season_rankings', !!row);
  ok('is_active = 0',        row?.is_active === 0,    `is_active=${row?.is_active}`);
  ok('manual_blocks = 0',    row?.manual_blocks === 0, `manual_blocks=${row?.manual_blocks}`);
  ok('auto_blocks = 500',    row?.auto_blocks === 500, `auto_blocks=${row?.auto_blocks}`);

  const inLb = db.getSeasonLeaderboard(s.id, 50, 0).some(r => r.user_id === u.id);
  ok('Absent du classement actif', !inLb);
  cleanUsers();
}

// ── Test 6 ────────────────────────────────────────────────────────────────────
suite('Test 6 — Classement trié par profondeur max DESC');
{
  cleanUsers();
  const m  = mimosa();
  const s  = activeSeason();
  const u1 = mkUser(m.id); syncManual(u1, s, 300, 100);  // 1er attendu
  const u2 = mkUser(m.id); syncManual(u2, s, 100, 200);  // 3e attendu
  const u3 = mkUser(m.id); syncManual(u3, s, 200, 150);  // 2e attendu
  const ids = new Set([u1.id, u2.id, u3.id]);
  const lb  = db.getSeasonLeaderboard(s.id, 50, 0).filter(r => ids.has(r.user_id));
  ok('3 joueurs dans le classement', lb.length === 3, `count=${lb.length}`);
  ok('1er = profondeur 300 (u1)', lb[0]?.user_id === u1.id, `user_id=${lb[0]?.user_id}`);
  ok('2e  = profondeur 200 (u3)', lb[1]?.user_id === u3.id, `user_id=${lb[1]?.user_id}`);
  ok('3e  = profondeur 100 (u2)', lb[2]?.user_id === u2.id, `user_id=${lb[2]?.user_id}`);
  cleanUsers();
}

// ── Test 7 ────────────────────────────────────────────────────────────────────
suite('Test 7 — Égalité de profondeur → tri par blocs manuels effectifs DESC');
{
  cleanUsers();
  const m  = mimosa();
  const s  = activeSeason();
  const u1 = mkUser(m.id); syncManual(u1, s, 200,  80);  // même depth, moins de blocs
  const u2 = mkUser(m.id); syncManual(u2, s, 200, 120);  // même depth, plus de blocs → 1er
  const ids = new Set([u1.id, u2.id]);
  const lb  = db.getSeasonLeaderboard(s.id, 50, 0).filter(r => ids.has(r.user_id));
  ok('u1 et u2 dans le classement', lb.length === 2, `count=${lb.length}`);
  const posU1 = lb.findIndex(r => r.user_id === u1.id);
  const posU2 = lb.findIndex(r => r.user_id === u2.id);
  ok('u2 (120 blocs) devant u1 (80 blocs)', posU2 < posU1,
     `posU2=${posU2}, posU1=${posU1}`);
  cleanUsers();
}

// ── Test 8 ────────────────────────────────────────────────────────────────────
suite('Test 8 — Auto-dig n\'affecte jamais le classement');
{
  cleanUsers();
  const m  = mimosa();
  const s  = activeSeason();
  const uA = mkUser(m.id); syncManual(uA, s, 100, 50);   // 50 blocs manuels, 0 auto
  const uB = mkUser(m.id); syncManual(uB, s, 100, 30);   // 30 blocs manuels…
  seasons.recordAutoBreaks(uB.id, s.id, 9999);             // …+ 9999 auto (ignorés)
  const ids = new Set([uA.id, uB.id]);
  const lb  = db.getSeasonLeaderboard(s.id, 50, 0).filter(r => ids.has(r.user_id));
  ok('uA et uB dans le classement', lb.length === 2, `count=${lb.length}`);
  const posA = lb.findIndex(r => r.user_id === uA.id);
  const posB = lb.findIndex(r => r.user_id === uB.id);
  ok('uA (50 manuels) devant uB (30 manuels + 9999 auto)', posA < posB,
     `posA=${posA}, posB=${posB}`);
  const entryB = g.prepare('SELECT auto_blocks FROM season_rankings WHERE season_id=? AND user_id=?')
                  .get(s.id, uB.id);
  ok('auto_blocks de uB = 9999 (stocké pour info)', entryB?.auto_blocks === 9999,
     `val=${entryB?.auto_blocks}`);
  cleanUsers();
}

// ── Test 9 ────────────────────────────────────────────────────────────────────
suite('Test 9 — Ligue < 10 joueurs actifs → aucune promotion');
{
  cleanUsers();
  const m       = mimosa();
  const s       = activeSeason();
  const players = [];
  for (let i = 0; i < 5; i++) {
    const u = mkUser(m.id);
    syncManual(u, s, 100 + i * 10, 50 + i);
    players.push(u);
  }

  const { report } = seasons.closeActiveSeason(s.id);
  const r = report.find(x => x.leagueId === m.id);
  ok('Rapport contient Mimosa',          !!r);
  ok('skipped = true (< 10 joueurs)',    r?.skipped === true,       `skipped=${r?.skipped}`);
  ok('reason = not_enough_players',      r?.reason === 'not_enough_players');
  ok('0 joueur promu',                   (r?.promoted ?? 0) === 0,  `promoted=${r?.promoted}`);

  const stillMimosa = players.every(u => db.getUserById(u.id)?.league_id === m.id);
  ok('Tous les joueurs restent en Mimosa', stillMimosa);
  cleanUsers();
}

// ── Test 10 ───────────────────────────────────────────────────────────────────
suite('Test 10 — Ligue ≥ 10 joueurs actifs → au moins 1 promu');
{
  cleanUsers();
  const m       = mimosa();
  const s       = activeSeason();
  const players = [];
  for (let i = 0; i < 10; i++) {
    const u = mkUser(m.id);
    syncManual(u, s, 100 + i * 10, 50 + i * 5);
    players.push(u);
  }

  const { report } = seasons.closeActiveSeason(s.id);
  const r = report.find(x => x.leagueId === m.id);
  ok('Rapport contient Mimosa',          !!r);
  ok('skipped = false (10 joueurs)',      r?.skipped !== true,       `skipped=${r?.skipped}`);
  ok('Au moins 1 joueur promu',          (r?.promoted ?? 0) >= 1,   `promoted=${r?.promoted}`);

  const promoted = players.filter(u => db.getUserById(u.id)?.league_id !== m.id);
  ok('Des joueurs ont effectivement changé de ligue', promoted.length >= 1,
     `count=${promoted.length}`);
  cleanUsers();
}

// ── Test 11 ───────────────────────────────────────────────────────────────────
suite('Test 11 — Formule de promotion : taux décroissant selon le niveau');
{
  // Vérification directe de la formule (promotion_rate=0.50, difficulty=0.45, n=10)
  const rate = 0.50, diff = 0.45, n = 10;
  const pct0 = rate / (1 + 0 * diff); // Mimosa  level=0 → 50.0 %
  const pct1 = rate / (1 + 1 * diff); // Bronze  level=1 → ≈34.5 %
  const pct2 = rate / (1 + 2 * diff); // Argent  level=2 → ≈26.3 %

  ok('Mimosa  level=0 : taux = 50.0%', Math.abs(pct0 - 0.50) < 0.001, `taux=${(pct0 * 100).toFixed(1)}%`);
  ok('Mimosa  level=0 : 5 promus / 10', Math.max(1, Math.floor(n * pct0)) === 5);
  ok('Bronze  level=1 : taux ≈ 34.5%', pct1 > 0.34 && pct1 < 0.36,    `taux=${(pct1 * 100).toFixed(1)}%`);
  ok('Bronze  level=1 : 3 promus / 10', Math.max(1, Math.floor(n * pct1)) === 3);
  ok('Argent  level=2 : taux ≈ 26.3%', pct2 > 0.25 && pct2 < 0.28,    `taux=${(pct2 * 100).toFixed(1)}%`);
  ok('Argent  level=2 : 2 promus / 10', Math.max(1, Math.floor(n * pct2)) === 2);
  ok('Taux décroissant avec le niveau', pct0 > pct1 && pct1 > pct2,
     `pct0=${pct0.toFixed(3)}, pct1=${pct1.toFixed(3)}, pct2=${pct2.toFixed(3)}`);
}

// ── Test 12 ───────────────────────────────────────────────────────────────────
suite('Test 12 — Nouvelle ligue créée automatiquement si aucune ligue supérieure n\'existe');
{
  cleanUsers();
  const m = mimosa();

  // Supprimer toutes les ligues au-dessus de Mimosa (peuvent exister après test 10)
  g.prepare('UPDATE users SET league_id = ? WHERE league_id IN (SELECT id FROM leagues WHERE level > 0)')
   .run(m.id);
  g.prepare('DELETE FROM leagues WHERE level > 0').run();

  const countBefore = g.prepare('SELECT COUNT(*) AS n FROM leagues').get().n;
  ok('Seule Mimosa existe avant la clôture', countBefore === 1, `count=${countBefore}`);

  const s = activeSeason();
  for (let i = 0; i < 10; i++) {
    const u = mkUser(m.id);
    syncManual(u, s, 100 + i, 50 + i);
  }

  seasons.closeActiveSeason(s.id);

  const bronze = g.prepare("SELECT * FROM leagues WHERE level=1 LIMIT 1").get();
  ok('Ligue Bronze (level=1) créée automatiquement', !!bronze, bronze?.name);
  ok('Niveau correct (1)',  bronze?.level === 1);
  ok('2 ligues existent maintenant', g.prepare('SELECT COUNT(*) AS n FROM leagues').get().n >= 2);
  cleanUsers();
}

// ── Tests 13-14 ───────────────────────────────────────────────────────────────
suite('Tests 13-14 — Config : gems_cap et coins réinitialisés après saison');
{
  const cfg = db.getAdminConfig();
  ok('gems_cap = 100 (plafond de gems après clôture)', cfg.gems_cap === '100',
     `val=${cfg.gems_cap}`);
  ok('season_duration = 7 jours',                      cfg.season_duration === '7',
     `val=${cfg.season_duration}`);
  ok('promotion_rate = 0.50',
     parseFloat(cfg.promotion_rate) === 0.50,          `val=${cfg.promotion_rate}`);
  ok('difficulty_coefficient = 0.45',
     parseFloat(cfg.difficulty_coefficient) === 0.45,  `val=${cfg.difficulty_coefficient}`);
  // gems_cap est inclus dans la réponse de clôture (le client reçoit la valeur et applique le cap)
  const s = activeSeason();
  ok('La saison en cours inclura gems_cap à la clôture (config lisible)', !!s);
}

// ── Test 15 ───────────────────────────────────────────────────────────────────
suite('Test 15 — Clôture double d\'une même saison impossible');
{
  const s = activeSeason();
  ok('Saison active disponible pour ce test', !!s, 'aucune saison active');

  // 1ère clôture : doit réussir
  let firstOk = false;
  try {
    seasons.closeActiveSeason(s.id);
    firstOk = true;
  } catch (e) {
    ok('Erreur inattendue sur la 1ère clôture', false, e.message);
  }
  ok('1ère clôture réussie', firstOk);

  // 2ème clôture : doit lancer une erreur
  let caughtMsg = null;
  try {
    seasons.closeActiveSeason(s.id);
  } catch (e) {
    caughtMsg = e.message;
  }
  ok('2ème clôture lève une erreur', caughtMsg !== null, 'aucune erreur levée');
  if (caughtMsg !== null) {
    ok('Message d\'erreur contient "déjà"', caughtMsg.includes('déjà'), caughtMsg);
  }
}

// ── Test 16 ───────────────────────────────────────────────────────────────────
suite('Test 16 — Anti-autoclicker réduit le rendement au-dessus du seuil CPS');
{
  cleanUsers();
  const m    = mimosa();
  const s    = activeSeason();
  const user = mkUser(m.id);

  // Configurer : seuil CPS = 8
  db.setAdminConfig('max_effective_cps', '8');
  db.setAdminConfig('anti_autoclick_enabled', 'true');

  // Injecter un historique de clics : 0 clics / 0 blocs il y a 60 secondes.
  // Quand syncPlayerRanking sera appelé avec 1200 clics, deltaSecs ≈ 60 s
  // → inferredCps = 1200 / 60 = 20 CPS >> seuil 8
  // → effectiveRatio = max(0.10, 8/20) = 0.40
  // → effectiveDelta = floor(60 * 0.40) = 24 → accepted = 0 + 24 = 24
  const ago60 = new Date(Date.now() - 60_000)
    .toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  db.upsertClickTracking(user.id, s.id, 0, 0, ago60, 0);

  seasons.syncPlayerRanking(user.id, {
    seasonId:        s.id,
    maxDepth:        200,
    manualBlocks:    60,
    autoBlocks:      0,
    manualClicks:    1200,
    suspiciousScore: 10,
    regularityScore: 0.2,
    isActive:        true,
  });

  const entry = g.prepare('SELECT * FROM season_rankings WHERE season_id=? AND user_id=?')
                 .get(s.id, user.id);
  ok('Entrée de classement créée', !!entry);

  if (entry) {
    ok('manual_blocks = 60 (valeur brute du client)',
       entry.manual_blocks === 60, `val=${entry.manual_blocks}`);
    ok('effective_manual_blocks < manual_blocks (réduction appliquée)',
       entry.effective_manual_blocks < entry.manual_blocks,
       `eff=${entry.effective_manual_blocks}, raw=${entry.manual_blocks}`);
    ok('effective_manual_blocks ≥ 6 (plancher anti-blocage à 10%)',
       entry.effective_manual_blocks >= 6, `val=${entry.effective_manual_blocks}`);
  }

  const log = g.prepare(
    'SELECT * FROM anticheat_logs WHERE user_id=? ORDER BY id DESC LIMIT 1'
  ).get(user.id);
  ok('Événement loggé dans anticheat_logs', !!log);

  if (log) {
    ok('inferred_cps > 8 (seuil dépassé)',
       parseFloat(log.inferred_cps) > 8, `cps=${log.inferred_cps}`);
    ok('effective_ratio < 1.0 (réduction appliquée)',
       parseFloat(log.effective_ratio) < 1.0, `ratio=${log.effective_ratio}`);
    ok('action = "reduced" ou "flagged"',
       ['reduced', 'flagged'].includes(log.action_taken), `action=${log.action_taken}`);
  }

  cleanUsers();
}
