/**
 * server/standings.js — Classement saisonnier figé (#29).
 *
 * À la clôture d'une saison, le serveur fige le classement dans `season_standings` (une ligne
 * par participant) et `season_snapshots` (une ligne par saison). Ces tables sont immuables
 * (déclencheurs SQLite) : les corrections admin ou toute écriture ultérieure dans
 * `season_rankings` ne changent plus le résultat d'une saison close.
 *
 * Attribution au mérite, sans aucun hasard (décision du propriétaire du 30/10/2026) :
 *   - participants : joueurs actifs de la saison avec au moins un bloc manuel (comme le
 *     classement affiché) ;
 *   - éligibles : participants avec une profondeur validée par le serveur > 0 et un compte
 *     existant ; les autres restent visibles dans l'instantané avec leur motif d'exclusion ;
 *   - ordre : profondeur ↓, blocs manuels validés ↓, premier à avoir atteint la profondeur ↑,
 *     identifiant ↑ (db.RANK_ORDER) ;
 *   - « leader » = 1er éligible. Mode `simulation` uniquement : aucun prix réel n'est attribué
 *     ici (points #33, boutique #34, interrupteur des cadeaux réels #30/#27).
 *
 * Preuve : empreinte SHA-256 des lignes (forme canonique), puis empreinte de l'instantané qui
 * inclut celle de l'instantané précédent (chaîne : modifier une saison passée casse la suite).
 * Le niveau de risque anti-bot (#25) est enregistré pour l'audit, sans exclusion automatique
 * tant que les sanctions (lot C) ne sont pas décidées.
 */

'use strict';

const crypto  = require('crypto');
const db      = require('./db');
const antibot = require('./antibot');
const cal     = require('./seasonCalendar');

const ALGORITHM  = 'merit-v1';
const PRIZE_MODE = 'simulation';
const PAGE_SIZE  = 50;

/** Colonnes d'une ligne figée, dans l'ordre de la forme canonique (ne jamais réordonner). */
const ROW_FIELDS = [
  'position', 'rank', 'rank_in_league', 'user_id', 'league_id', 'max_depth',
  'effective_manual_blocks', 'manual_blocks', 'max_depth_reached_at', 'eligible',
  'exclusion_reason', 'risk_level',
];

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function rowsHash(rows) {
  return sha256(JSON.stringify(rows.map(r => ROW_FIELDS.map(f => r[f] ?? null))));
}

function snapshotHash(s) {
  return sha256(JSON.stringify([
    s.season_id, s.created_at, s.source, s.algorithm, s.season_start, s.season_end,
    s.participants, s.eligible, s.leader_user_id ?? null, s.prize_mode, s.rows_hash, s.prev_hash ?? null,
  ]));
}

function getSnapshot(seasonId) {
  return db.getDb().prepare('SELECT * FROM season_snapshots WHERE season_id = ?').get(seasonId) ?? null;
}

function getSnapshotRows(seasonId) {
  return db.getDb().prepare('SELECT * FROM season_standings WHERE season_id = ? ORDER BY position').all(seasonId);
}

/**
 * Calcule les lignes figées (pur, sans écriture) à partir des participants triés.
 * @param {object[]} participants  db.getSeasonParticipantsRanked()
 * @param {(userId:number) => number} riskOf  niveau de risque anti-bot (audit)
 */
function computeStandings(participants, riskOf = () => 0) {
  let rank = 0;
  const perLeague = new Map();
  return participants.map((p, i) => {
    const reason = !p.user_exists ? 'account_deleted'
                 : !(p.max_depth > 0) ? 'depth_zero'
                 : null;
    const eligible = reason ? 0 : 1;
    let rankInLeague = null;
    if (eligible) {
      const key = p.league_id ?? 0;
      rankInLeague = (perLeague.get(key) ?? 0) + 1;
      perLeague.set(key, rankInLeague);
    }
    return {
      position:                i + 1,
      rank:                    eligible ? ++rank : null,
      rank_in_league:          rankInLeague,
      user_id:                 p.user_id,
      league_id:               p.league_id ?? null,
      max_depth:               p.max_depth,
      effective_manual_blocks: p.effective_manual_blocks ?? 0,
      manual_blocks:           p.manual_blocks ?? 0,
      max_depth_reached_at:    p.max_depth_reached_at ?? null,
      eligible,
      exclusion_reason:        reason,
      risk_level:              riskOf(p.user_id) ?? 0,
    };
  });
}

/**
 * Fige le classement d'une saison terminée. Idempotent : un instantané existant est renvoyé
 * tel quel (`created: false`). Transactionnel (savepoint si appelé dans une transaction).
 * @param {number} seasonId
 * @param {{ source?: string, now?: Date }} [opts]  source : close | admin_close | backfill
 * @returns {{ snapshot: object, created: boolean }}
 */
function freezeSeasonStandings(seasonId, { source = 'close', now = new Date() } = {}) {
  const conn = db.getDb();
  return conn.transaction(() => {
    const existing = getSnapshot(seasonId);
    if (existing) return { snapshot: existing, created: false };

    const season = db.getSeasonById(seasonId);
    if (!season) throw new Error(`Saison ${seasonId} introuvable.`);
    if (season.status === 'active' || season.status === 'scheduled') {
      throw new Error(`La saison ${seasonId} est "${season.status}" : classement non figeable avant la clôture.`);
    }

    // Risque mesuré à la fin de la saison (décroissance arrêtée à end_at), pour l'audit.
    const endMs  = cal.parseUtc(season.end_at)?.getTime() ?? now.getTime();
    const riskAt = Math.min(endMs, now.getTime());
    const rows   = computeStandings(db.getSeasonParticipantsRanked(seasonId),
      userId => antibot.getRisk(userId, seasonId, riskAt).level);

    const insRow = conn.prepare(`
      INSERT INTO season_standings (season_id, ${ROW_FIELDS.join(', ')})
      VALUES (?, ${ROW_FIELDS.map(() => '?').join(', ')})`);
    for (const r of rows) insRow.run(seasonId, ...ROW_FIELDS.map(f => r[f]));

    const prev    = conn.prepare('SELECT snapshot_hash FROM season_snapshots ORDER BY seq DESC LIMIT 1').get();
    const leader  = rows.find(r => r.eligible) ?? null;
    const eligible = rows.filter(r => r.eligible).length;
    const snap = {
      season_id:      seasonId,
      created_at:     cal.fmtUtc(now),
      source,
      algorithm:      ALGORITHM,
      season_start:   season.start_at,
      season_end:     season.end_at,
      participants:   rows.length,
      eligible,
      leader_user_id: leader ? leader.user_id : null,
      prize_mode:     PRIZE_MODE,
      rows_hash:      rowsHash(rows),
      prev_hash:      prev ? prev.snapshot_hash : null,
    };
    snap.snapshot_hash = snapshotHash(snap);
    snap.details = JSON.stringify({
      status: eligible ? 'ok' : 'no_eligible_participant',
      excluded: rows.filter(r => !r.eligible).length,
      withoutReachTime: rows.filter(r => r.eligible && !r.max_depth_reached_at).length,
    });
    const cols = Object.keys(snap);
    conn.prepare(`INSERT INTO season_snapshots (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map(c => snap[c]));

    antibot.logSecurityEvent('standings_frozen', {
      seasonId,
      details: { source, participants: rows.length, eligible, leader: snap.leader_user_id, hash: snap.snapshot_hash.slice(0, 16) },
    });
    console.log(`[standings] Saison ${seasonId} figée (${source}) : ${eligible}/${rows.length} éligible(s), empreinte ${snap.snapshot_hash.slice(0, 12)}`);
    return { snapshot: getSnapshot(seasonId), created: true };
  })();
}

/**
 * Fige les saisons terminées qui n'ont pas encore d'instantané (saisons closes avant #29,
 * clôture admin manuelle, panne pendant une clôture). Les erreurs sont journalisées, jamais
 * propagées : la rotation des saisons ne doit pas en dépendre.
 */
function freezeMissingSnapshots(now = new Date()) {
  const missing = db.getDb().prepare(`
    SELECT s.id FROM seasons s
    LEFT JOIN season_snapshots p ON p.season_id = s.id
    WHERE s.status IN ('closed', 'archived') AND p.season_id IS NULL
    ORDER BY s.end_at, s.id
  `).all();
  let created = 0;
  for (const { id } of missing) {
    try { if (freezeSeasonStandings(id, { source: 'backfill', now }).created) created++; }
    catch (err) {
      console.error(`[standings] Saison ${id} non figée : ${err.message}`);
      try { antibot.logSecurityEvent('standings_freeze_failed', { seasonId: id, details: { error: err.message.slice(0, 200) } }); }
      catch (_) { /* journal indisponible : déjà tracé dans la console */ }
    }
  }
  return created;
}

/**
 * Recalcule les empreintes d'un instantané à partir des lignes stockées et vérifie le lien
 * avec l'instantané précédent de la chaîne.
 * @returns {{ ok: boolean, rowsHashOk: boolean, snapshotHashOk: boolean, chainOk: boolean } | null}
 */
function verifySnapshot(seasonId) {
  const snap = getSnapshot(seasonId);
  if (!snap) return null;
  const rows  = getSnapshotRows(seasonId);
  const prev  = db.getDb().prepare('SELECT snapshot_hash FROM season_snapshots WHERE seq < ? ORDER BY seq DESC LIMIT 1').get(snap.seq);
  const rowsHashOk     = rowsHash(rows) === snap.rows_hash && rows.length === snap.participants;
  const snapshotHashOk = snapshotHash(snap) === snap.snapshot_hash;
  const chainOk        = (prev ? prev.snapshot_hash : null) === (snap.prev_hash ?? null);
  return { ok: rowsHashOk && snapshotHashOk && chainOk, rowsHashOk, snapshotHashOk, chainOk };
}

function _publicSnapshot(snap) {
  return {
    createdAt:    snap.created_at,
    source:       snap.source,
    algorithm:    snap.algorithm,
    participants: snap.participants,
    eligible:     snap.eligible,
    prizeMode:    snap.prize_mode,
    hash:         snap.snapshot_hash,
  };
}

function _formatStanding(r, names, leagueMap, admin) {
  const league = r.league_id ? leagueMap[r.league_id] ?? null : null;
  const out = {
    rank:            r.rank,
    rankInLeague:    r.rank_in_league,
    position:        r.position,
    userId:          r.user_id,
    username:        names.get(r.user_id) ?? null,
    league:          league ? { id: league.id, name: league.name, icon: league.icon } : null,
    maxDepth:        r.max_depth,
    manualBlocks:    Math.min(r.effective_manual_blocks, r.manual_blocks),
    maxDepthReachedAt: r.max_depth_reached_at,
    eligible:        !!r.eligible,
    exclusionReason: r.exclusion_reason,
  };
  if (admin) Object.assign(out, { effectiveManualBlocks: r.effective_manual_blocks, manualBlocksBroken: r.manual_blocks, riskLevel: r.risk_level });
  return out;
}

function _names(rows) {
  const ids = [...new Set(rows.map(r => r.user_id))];
  if (!ids.length) return new Map();
  const found = db.getDb().prepare(`SELECT id, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  return new Map(found.map(u => [u.id, u.username]));
}

/** Dernière saison figée (la plus récente par date de fin). */
function lastSnapshotSeasonId() {
  const row = db.getDb().prepare(`
    SELECT p.season_id FROM season_snapshots p JOIN seasons s ON s.id = p.season_id
    ORDER BY s.end_at DESC, p.season_id DESC LIMIT 1`).get();
  return row ? row.season_id : null;
}

/**
 * Classement figé paginé (public) ou complet avec audit (admin).
 * @param {number|'last'} seasonRef
 * @returns {object|null}  null si la saison n'est pas (encore) figée
 */
function buildStandings(seasonRef, { page = 1, userId = null, admin = false } = {}) {
  const seasonId = seasonRef === 'last' ? lastSnapshotSeasonId() : seasonRef;
  if (!seasonId) return null;
  const snap = getSnapshot(seasonId);
  if (!snap) return null;
  const season    = db.getSeasonById(seasonId);
  const leagueMap = Object.fromEntries(db.getAllLeagues().map(l => [l.id, l]));
  const all       = getSnapshotRows(seasonId);
  const rows      = admin ? all : all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const mine      = userId ? all.find(r => r.user_id === userId) ?? null : null;
  const names     = _names(mine ? [...rows, mine] : rows);

  const out = {
    season: {
      id: seasonId, name: season?.name ?? null,
      startAt: snap.season_start, endAt: snap.season_end, status: season?.status ?? null,
    },
    snapshot: _publicSnapshot(snap),
    page:       admin ? 1 : page,
    pageSize:   admin ? all.length : PAGE_SIZE,
    total:      all.length,
    totalPages: admin ? 1 : Math.max(1, Math.ceil(all.length / PAGE_SIZE)),
    standings:  rows.map(r => _formatStanding(r, names, leagueMap, admin)),
    me:         mine ? _formatStanding(mine, names, leagueMap, false) : null,
  };
  if (admin) {
    Object.assign(out.snapshot, {
      seq: snap.seq, rowsHash: snap.rows_hash, prevHash: snap.prev_hash,
      leaderUserId: snap.leader_user_id, details: JSON.parse(snap.details || '{}'),
    });
    out.verification = verifySnapshot(seasonId);
  }
  return out;
}

module.exports = {
  ALGORITHM,
  PRIZE_MODE,
  computeStandings,
  freezeSeasonStandings,
  freezeMissingSnapshots,
  verifySnapshot,
  buildStandings,
  getSnapshot,
};
