/**
 * Simulation de 12 cycles de saisons (ticket #57, audit GO/NO-GO de la bêta fermée).
 *
 * Environnement isolé : base temporaire hors server/data/, horloge simulée (mock timers), aucune
 * saison ni classement de production touché. Le scénario enchaîne, de mars à mai 2027 (passage à
 * l'heure d'été Europe/Brussels le 28/03/2027) :
 *   - rotations hebdomadaires ordinaires pilotées comme le planificateur (rotation, rattrapage des
 *     classements figés et des points, appelés deux fois pour vérifier l'idempotence) ;
 *   - une saison sans participant, des ex æquo parfaits, des joueurs absents puis revenus ;
 *   - deux fins exceptionnelles programmées en heure locale de Bruxelles, avant et après le
 *     changement d'heure ;
 *   - une panne de deux semaines puis un redémarrage (initDb rejoué) avec rattrapage ;
 *   - les points de récompense en mode réel (#33) et les promotions de ligue (#19).
 * Invariants vérifiés à la fin : saisons contiguës aux noms uniques, une seule active, un
 * classement figé vérifiable par saison close, points crédités exactement une fois, aucune
 * promotion double, données joueurs (comptes, sauvegardes) jamais réécrites.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-cycles-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
delete process.env.CONTEST_REAL_PRIZES;

const cal       = require('../server/seasonCalendar');
const db        = require('../server/db');
const seasons   = require('../server/seasons');
const standings = require('../server/standings');
const points    = require('../server/rewardPoints');
const seasonEnd = require('../server/seasonEnd');

const conn = () => db.getDb();
const at   = iso => new Date(iso);
const DAY  = 24 * 3600_000;

function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

let userSeq = 0;
function newUser(leagueId) {
  const id = conn().prepare('INSERT INTO users (username, password_hash, league_id) VALUES (?, ?, ?)')
    .run(`cycle_user_${++userSeq}`, 'x', leagueId).lastInsertRowid;
  conn().prepare('INSERT INTO user_saves (user_id, data) VALUES (?, ?)').run(id, JSON.stringify({ gems: 10 * id }));
  return id;
}

/** Score d'un joueur pour la saison (comme après une sauvegarde validée). */
function play(seasonId, userId, depth, blocks, reachedAt = null) {
  const leagueId = conn().prepare('SELECT league_id FROM users WHERE id = ?').get(userId).league_id;
  conn().prepare(`
    INSERT INTO season_rankings (season_id, user_id, league_id, max_depth, reported_max_depth, manual_blocks,
                                 effective_manual_blocks, manual_clicks, is_active, max_depth_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(seasonId, userId, leagueId, depth, depth, blocks, blocks, blocks * 3, reachedAt);
}

/** Un passage du planificateur (seasons.startSeasonScheduler), rejoué deux fois. */
function schedulerTick(now) {
  let active;
  for (let i = 0; i < 2; i++) {
    active = quiet(() => seasons.checkAndRotateSeason(now));
    standings.freezeMissingSnapshots(now);
    points.awardMissingSeasons(now);
  }
  return active;
}

const playerData = () => ({
  users: conn().prepare('SELECT id, username, password_hash, email, created_at FROM users ORDER BY id').all(),
  saves: conn().prepare('SELECT user_id, data, version, saved_at FROM user_saves ORDER BY user_id').all(),
});
const leagueLevel = uid => conn().prepare(
  'SELECT l.level FROM users u JOIN leagues l ON l.id = u.league_id WHERE u.id = ?').get(uid).level;

test('12 cycles de saisons : rotation, figement, points, ligues, panne, heure d\'été', (t) => {
  const T0 = at('2027-03-03T10:00:00Z');   // mercredi, semaine ISO 9
  t.mock.timers.enable({ apis: ['Date'], now: T0.getTime() });
  db.initDb();
  points.applyOwnerDecision(T0);         // crédit réel des points, comme en production
  conn().prepare("INSERT OR REPLACE INTO admin_config (key, value) VALUES ('min_active_players_per_league', '4')").run();

  const first  = schedulerTick(T0);
  const mimosa = db.getLeagueByLevel(0);
  const players = Array.from({ length: 8 }, () => newUser(mimosa.id));
  const before  = playerData();

  const seen = [];          // { id, name, participants: [uid], tie: [uid, uid] | null }
  const levels = [];        // niveaux de ligue après chaque clôture

  /** Joue la saison active (sauf saison vide) puis passe à l'instant `next` (après sa fin). */
  function cycle(now, { participants, tie = null }) {
    t.mock.timers.setTime(now.getTime());
    const s = schedulerTick(now);
    participants.forEach((uid, i) => {
      if (tie && tie.includes(uid)) play(s.id, uid, 500, 200, cal.fmtUtc(now) + '.000');
      else play(s.id, uid, 400 - i * 20 + seen.length, 100 + i);
    });
    seen.push({ id: s.id, name: s.name, participants, tie });
    return s;
  }
  const afterEnd = s => new Date(cal.parseUtc(db.getSeasonById(s.id).end_at).getTime() + 30_000);
  const close = s => { const n = afterEnd(s); t.mock.timers.setTime(n.getTime()); schedulerTick(n); levels.push(players.map(leagueLevel)); };

  // Cycles 1–3 : saisons ordinaires, puis une saison sans aucun participant.
  let s = cycle(T0, { participants: players.slice(0, 6) });
  assert.strictEqual(s.id, first.id);
  close(s);
  s = cycle(at('2027-03-10T12:00:00Z'), { participants: players.slice(2) }); close(s);
  s = cycle(at('2027-03-17T12:00:00Z'), { participants: [] });                close(s);

  // Cycle 4 : fin exceptionnelle vendredi 26/03 16:00 Bruxelles (heure d'hiver, UTC+1), ex æquo parfaits.
  s = cycle(at('2027-03-24T12:00:00Z'), { participants: players, tie: [players[1], players[4]] });
  let end = seasonEnd.parseRequestedEnd({ end_local: '2027-03-26T16:00' });
  assert.strictEqual(cal.fmtUtc(end), '2027-03-26 15:00:00', 'heure d\'hiver : UTC+1');
  let p = seasonEnd.preview(s.id, end, new Date());
  seasonEnd.setEnd(s.id, end, { confirm: s.name, expectedEndAt: p.expectedEndAt, now: new Date() });
  close(s);
  assert.strictEqual(db.getSeasonById(s.id).end_at, '2027-03-26 15:00:00');

  // Cycle 5 : saison courte jusqu'au dimanche 28/03 (nuit du changement d'heure).
  s = cycle(at('2027-03-27T09:00:00Z'), { participants: players.slice(0, 4) });
  assert.strictEqual(db.getSeasonById(s.id).end_at, '2027-03-28 23:59:59', 'saison courte jusqu\'au dimanche');
  close(s);

  // Cycle 6 : fin exceptionnelle vendredi 02/04 16:00 Bruxelles (heure d'été, UTC+2).
  s = cycle(at('2027-03-31T12:00:00Z'), { participants: players.slice(1, 7) });
  end = seasonEnd.parseRequestedEnd({ end_local: '2027-04-02T16:00' });
  assert.strictEqual(cal.fmtUtc(end), '2027-04-02 14:00:00', 'heure d\'été : UTC+2');
  p = seasonEnd.preview(s.id, end, new Date());
  seasonEnd.setEnd(s.id, end, { confirm: s.name, expectedEndAt: p.expectedEndAt, now: new Date() });
  close(s);

  // Cycle 7 : saison courte, puis PANNE : le serveur ne tourne plus du 05/04 au 19/04 inclus.
  s = cycle(at('2027-04-03T12:00:00Z'), { participants: players.slice(0, 5) });
  const outageEnd = at('2027-04-20T08:00:00Z');
  t.mock.timers.setTime(outageEnd.getTime());
  db.initDb();                               // redémarrage : migrations rejouées sans effet
  const resumed = schedulerTick(outageEnd);  // rattrapage semaine par semaine (cycles 8 et 9 vides)
  levels.push(players.map(leagueLevel));
  assert.ok(seasons.isWithinSeason(resumed, outageEnd.getTime()));
  const caughtUp = conn().prepare("SELECT id, name FROM seasons WHERE status = 'closed' AND id > ? ORDER BY id").all(s.id);
  assert.strictEqual(caughtUp.length, 2, 'deux semaines manquées → deux saisons rattrapées');
  for (const c of caughtUp) seen.push({ id: c.id, name: c.name, participants: [], tie: null });

  // Cycles 10–12 : retour des joueurs, dont un absent depuis le début.
  s = cycle(at('2027-04-21T12:00:00Z'), { participants: players });         close(s);
  s = cycle(at('2027-04-28T12:00:00Z'), { participants: players.slice(3) }); close(s);
  s = cycle(at('2027-05-05T12:00:00Z'), { participants: [players[7], players[0]], tie: [players[7], players[0]] }); close(s);

  // ── Invariants ─────────────────────────────────────────────────────────────
  const list = conn().prepare('SELECT * FROM seasons ORDER BY start_at, id').all();
  const closed = list.filter(x => x.status === 'closed');
  assert.ok(closed.length >= 12, `${closed.length} saisons closes`);
  assert.strictEqual(list.filter(x => x.status === 'active').length, 1, 'une seule saison active');
  assert.strictEqual(new Set(list.map(x => x.name)).size, list.length, 'noms uniques');
  for (let i = 1; i < list.length; i++) {
    const gap = cal.parseUtc(list[i].start_at) - cal.parseUtc(list[i - 1].end_at);
    assert.strictEqual(gap, 1000, `contiguïté ${list[i - 1].name} → ${list[i].name}`);
  }

  for (const c of closed) {
    assert.strictEqual(JSON.parse(c.config).promotionApplied, true, `${c.name} : promotions appliquées`);
    const snap = standings.getSnapshot(c.id);
    assert.ok(snap, `${c.name} : classement figé`);
    assert.strictEqual(standings.verifySnapshot(c.id).ok, true, `${c.name} : empreintes valides`);
    const live = conn().prepare("SELECT COUNT(*) AS n FROM reward_point_runs WHERE season_id = ? AND mode = 'live'").get(c.id).n;
    assert.strictEqual(live, 1, `${c.name} : une seule attribution réelle`);
  }

  // Points : une écriture au plus par joueur et par saison, soldes = somme des attributions.
  const dup = conn().prepare('SELECT season_id, user_id, COUNT(*) AS n FROM reward_point_ledger GROUP BY season_id, user_id HAVING n > 1').all();
  assert.deepStrictEqual(dup, [], 'aucun double crédit');
  const runsTotal = conn().prepare("SELECT COALESCE(SUM(total_points), 0) AS s FROM reward_point_runs WHERE mode = 'live'").get().s;
  const balances  = players.reduce((sum, u) => sum + points.getWallet(u).balance, 0);
  assert.strictEqual(balances, runsTotal, 'soldes = total crédité');
  assert.ok(runsTotal > 0);
  assert.strictEqual(points.verifyLedger().ok, true);

  // Saisons vides : figées, attribution vide enregistrée.
  for (const c of seen.filter(x => x.participants.length === 0)) {
    const run = conn().prepare("SELECT recipients, total_points FROM reward_point_runs WHERE season_id = ? AND mode = 'live'").get(c.id);
    assert.deepStrictEqual([run.recipients, run.total_points], [0, 0], `${c.name} : rien crédité`);
    assert.strictEqual(standings.getSnapshot(c.id).participants, 0);
  }

  // Ex æquo parfaits : même nombre de points, ordre déterministe (user_id croissant).
  for (const c of seen.filter(x => x.tie)) {
    const [a, b] = [...c.tie].sort((x, y) => x - y);
    const pts = uid => conn().prepare('SELECT COALESCE(SUM(delta), 0) AS d FROM reward_point_ledger WHERE season_id = ? AND user_id = ?').get(c.id, uid).d;
    assert.strictEqual(pts(a), pts(b), `${c.name} : ex æquo, mêmes points`);
    const rows = conn().prepare('SELECT user_id, position FROM season_standings WHERE season_id = ? ORDER BY position').all(c.id);
    const pos = uid => rows.find(r => r.user_id === uid).position;
    assert.ok(pos(a) < pos(b), `${c.name} : départage par identifiant`);
  }

  // Ligues : jamais plus d'un niveau gagné par clôture, jamais de descente.
  let prev = players.map(() => 0);
  for (const lv of levels) {
    lv.forEach((l, i) => assert.ok(l - prev[i] >= 0 && l - prev[i] <= 1, `joueur ${i} : ${prev[i]} → ${l}`));
    prev = lv;
  }
  assert.ok(prev.some(l => l > 0), 'au moins une promotion sur 12 cycles');

  // Données joueurs : comptes et sauvegardes jamais réécrits par les clôtures.
  assert.deepStrictEqual(playerData(), before);
});

test.after(() => {
  try { db.getDb().close(); } catch (_) { /* déjà fermée */ }
  fs.rmSync(dir, { recursive: true, force: true });
});
