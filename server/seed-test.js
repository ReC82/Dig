#!/usr/bin/env node
/**
 * server/seed-test.js
 * Peuple la base avec des joueurs fictifs pour tester le classement saisonnier.
 *
 * Usage :
 *   node server/seed-test.js          — insère les données de test
 *   node server/seed-test.js --clean  — supprime uniquement les données de test
 *   node server/seed-test.js --check  — affiche le classement sans modifier la DB
 */

'use strict';
require('dotenv').config();

const bcrypt  = require('bcryptjs');
const db      = require('./db');
const seasons = require('./seasons');

db.initDb();
const g = db.getDb();

const SEED_PREFIX = 'testplayer_'; // préfixe des comptes de test (pour cleanup propre)

// ── CLI args ──────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const CLEAN  = args.includes('--clean');
const CHECK  = args.includes('--check');
const CLOSE  = args.includes('--close-season'); // test de clôture

// ── Cleanup ───────────────────────────────────────────────────────────────────
function cleanTestData() {
  const ids = g.prepare(`SELECT id FROM users WHERE username LIKE ?`).all(`${SEED_PREFIX}%`).map(r => r.id);
  if (!ids.length) { console.log('[seed] Aucun joueur de test à supprimer.'); return; }
  // Les FK ON DELETE CASCADE nettoient season_rankings automatiquement
  const del = g.prepare(`DELETE FROM users WHERE username LIKE ?`).run(`${SEED_PREFIX}%`);
  console.log(`[seed] ${del.changes} joueur(s) de test supprimé(s).`);
}

if (CLEAN) { cleanTestData(); process.exit(0); }

// ── Close season test ─────────────────────────────────────────────────────────
if (CLOSE) {
  const season = db.getActiveSeason();
  if (!season) { console.log('[seed] Aucune saison active.'); process.exit(1); }
  console.log(`[seed] Clôture test de la saison : ${season.name} (id=${season.id})`);
  try {
    const result = seasons.closeActiveSeason(season.id);
    console.log(`\n[seed] Saison clôturée : ${result.closedSeason.name}`);
    console.log(`[seed] Nouvelle saison  : ${result.newSeason.name} (id=${result.newSeason.id})`);
    console.log('\n── Rapport de promotion ──');
    result.report.forEach(r => {
      if (r.skipped) {
        console.log(`  ${r.leagueName} : IGNORÉE (${r.reason}, ${r.activePlayers} joueurs)`);
      } else {
        console.log(`  ${r.leagueName} (level=${r.leagueLevel}) : ${r.promoted}/${r.activePlayers} promus → ${r.nextLeagueName}`);
        r.promotedUsers?.forEach(u => console.log(`    ↑ ${u.username} (depth=${u.maxDepth}m)`));
      }
    });
  } catch (err) {
    console.error('[seed] Erreur :', err.message);
  }
  process.exit(0);
}

// ── Check only ────────────────────────────────────────────────────────────────
if (CHECK) {
  const season = db.getActiveSeason();
  if (!season) { console.log('[seed] Aucune saison active.'); process.exit(0); }

  console.log(`\n=== Saison active : ${season.name} (id=${season.id}) ===\n`);

  // Classement global
  const global = seasons.buildGlobalLeaderboard(season.id, 1);
  console.log(`── Classement global (${global.total} joueurs actifs) ──`);
  global.leaderboard.forEach(r =>
    console.log(`  #${r.rank} ${r.username.padEnd(20)} depth=${r.maxDepth}m  blocks=${r.manualBlocksBroken}  auto=${r.autoBlocksBroken}  ligue=${r.league?.name ?? '—'}`)
  );

  // Classement par ligue
  const leagues = db.getAllLeagues();
  for (const league of leagues) {
    const lb = seasons.buildLeagueLeaderboard(season.id, league.id, 1);
    if (!lb.total) continue;
    console.log(`\n── ${league.icon} ${league.name} (${lb.total} joueurs) ──`);
    lb.leaderboard.forEach(r =>
      console.log(`  #${r.rank} ${r.username.padEnd(20)} depth=${r.maxDepth}m  blocks=${r.manualBlocksBroken}  auto=${r.autoBlocksBroken}`)
    );
  }
  process.exit(0);
}

// ── Seed ──────────────────────────────────────────────────────────────────────
const season = db.getActiveSeason();
if (!season) { console.error('[seed] Aucune saison active — lance le serveur une fois pour en créer une.'); process.exit(1); }

const leagues = db.getAllLeagues();
if (!leagues.length) { console.error('[seed] Aucune ligue en base — le serveur doit d\'abord être lancé.'); process.exit(1); }

console.log(`[seed] Saison active : ${season.name} (id=${season.id})`);
console.log(`[seed] Ligues : ${leagues.map(l => `${l.icon}${l.name}(id=${l.id})`).join(' | ')}`);

// Données fictives : { username, depth, manualBlocks, autoBlocks, leagueIdx }
const PLAYERS = [
  { username: 'testplayer_alpha',   depth: 220, manual: 150, auto: 80,  leagueIdx: 0 },
  { username: 'testplayer_beta',    depth: 210, manual: 130, auto: 200, leagueIdx: 0 },
  { username: 'testplayer_gamma',   depth: 210, manual: 145, auto: 60,  leagueIdx: 0 }, // même depth qu'alpha, moins de blocs
  { username: 'testplayer_delta',   depth: 180, manual: 90,  auto: 300, leagueIdx: 0 },
  { username: 'testplayer_epsilon', depth: 155, manual: 70,  auto: 20,  leagueIdx: 0 },
  { username: 'testplayer_zeta',    depth: 300, manual: 200, auto: 10,  leagueIdx: Math.min(1, leagues.length - 1) },
  { username: 'testplayer_eta',     depth: 280, manual: 175, auto: 5,   leagueIdx: Math.min(1, leagues.length - 1) },
  { username: 'testplayer_theta',   depth: 50,  manual: 10,  auto: 999, leagueIdx: 0 }, // beaucoup d'auto → ne doit PAS changer le rang
];

const hashSync = pwd => bcrypt.hashSync(pwd, 8);
const seedPwd  = hashSync('seed-password-test-2025');

cleanTestData(); // repart de zéro si on relance

const insertStmt = g.prepare(`
  INSERT OR IGNORE INTO users (username, email, password_hash, league_id)
  VALUES (?, ?, ?, ?)
`);

for (const p of PLAYERS) {
  const league  = leagues[p.leagueIdx] ?? leagues[0];
  const email   = `${p.username}@test.internal`;

  insertStmt.run(p.username, email, seedPwd, league.id);
  const user = db.getUserByUsername(p.username);
  if (!user) { console.warn(`[seed] Impossible de créer ${p.username}`); continue; }

  // Enregistre les blocs manuels (marque le joueur actif → entre dans le classement)
  seasons.recordManualBreaks(user.id, season, {
    maxDepth:       p.depth,
    manualBlocks:   p.manual,
    manualClicks:   p.manual * 2,
    suspiciousScore: 0,
    leagueId:       league.id,
  });

  // Enregistre les blocs auto (NE doit PAS modifier is_active ni le rang)
  if (p.auto > 0) seasons.recordAutoBreaks(user.id, season.id, p.auto);

  console.log(`[seed] ✓ ${p.username.padEnd(26)} ligue=${league.name}  depth=${p.depth}m  manual=${p.manual}  auto=${p.auto}`);
}

console.log('\n[seed] Seed terminé.');
console.log('  --check          → voir le classement');
console.log('  --close-season   → tester la clôture + promotions');
console.log('  --clean          → supprimer les données de test');
