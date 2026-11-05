/**
 * DIG! — Essais de test d'un joueur : instantané, remise à zéro complète, restauration (#75).
 *
 * Pour rejouer un test de résistance avec un même compte, l'admin peut « recommencer un test à
 * zéro ». Dans UNE transaction (rien de partiel en cas d'erreur) :
 *   1. instantané complet de l'état courant (sauvegarde, classement de la saison active, suivis
 *      profondeur / clics, score de risque, registre de gemmes, badges, collection serveur,
 *      événements mensuels, ligue, session de jeu) archivé comme « essai n » avec testRunId,
 *      horodatage, auteur, motif et repères des journaux de preuves ;
 *   2. état d'un nouveau personnage : identité, accès, invitation, e-mail, liaisons, points de
 *      récompense, commandes, gagnants et préférences intacts ; saisons clôturées intactes ;
 *   3. aucun ancien onglet, appareil ou PWA ne peut réinjecter l'ancien état : la révision de la
 *      sauvegarde augmente, la session de jeu passe à un contrôleur « reset » (toutes les pages
 *      ouvertes perdent la main, avec un message clair) et une sauvegarde sans révision (client
 *      d'avant #18) est refusée pour ce compte.
 *
 * Les journaux (anticheat_logs, security_events, antibot_save_samples, user_events, gem_ledger,
 * gem_anomalies) ne sont JAMAIS effacés : chaque essai garde les identifiants maximum au moment de
 * sa clôture, ce qui rattache les lignes de chaque essai à son testRunId.
 *
 * La restauration d'un instantané archive d'abord l'essai en cours (rien n'est détruit), puis
 * réécrit l'état archivé ; les lignes saisonnières ne reviennent que si l'instantané date de la
 * saison encore active.
 *
 * Journal d'audit en ajout seul, chaîné par empreinte SHA-256 (toute modification se voit).
 */

'use strict';

const crypto = require('crypto');
const db = require('./db');
const gemLedger = require('./gemLedger');

const SNAPSHOT_FORMAT = 1;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REASON_MAX = 300;
const RESET_CONTROLLER_PREFIX = 'reset_';

/** Journaux de preuves rattachés aux essais par identifiant (jamais copiés, jamais effacés). */
const EVIDENCE_TABLES = ['anticheat_logs', 'security_events', 'antibot_save_samples', 'user_events', 'gem_ledger', 'gem_anomalies'];
/** Copie des preuves de l'essai dans l'instantané : security_events et antibot_save_samples sont purgés à 90 jours. */
const EVIDENCE_COPY_MAX = 5000;

/**
 * Tables d'état de jeu par joueur, archivées puis remises à l'état d'un nouveau joueur.
 * scope : 'user' (toutes les lignes du joueur) | 'season' (lignes de la saison active seulement :
 * les saisons clôturées ne sont jamais touchées).
 */
const STATE_TABLES = [
  { name: 'season_rankings',        scope: 'season' },
  { name: 'risk_scores',            scope: 'season' },
  { name: 'player_click_tracking',  scope: 'user' },
  { name: 'player_depth_tracking',  scope: 'user' },
  { name: 'player_badges',          scope: 'user' },
  { name: 'badge_player_stats',     scope: 'user' },
  { name: 'badge_tracking',         scope: 'user' },
  { name: 'badge_event_baselines',  scope: 'user' },
  { name: 'collection_pity',        scope: 'user' },
  { name: 'collection_pity_cursor', scope: 'user' },
  { name: 'monthly_event_finds',    scope: 'user' },
  { name: 'monthly_event_cursors',  scope: 'user' },
];
/** Suivis à une ligne par joueur liés à une saison : restaurés seulement pour la saison active. */
const SEASON_TRACKERS = new Set(['player_click_tracking', 'player_depth_tracking', 'badge_tracking']);

class TestRunError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const conn = () => db.getDb();

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS player_test_runs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      run_no           INTEGER NOT NULL,
      test_run_id      TEXT    NOT NULL UNIQUE,
      started_at       TEXT    NOT NULL,
      ended_at         TEXT    NOT NULL,
      end_kind         TEXT    NOT NULL,
      reason           TEXT    NOT NULL DEFAULT '',
      actor            TEXT    NOT NULL DEFAULT '',
      season_id        INTEGER,
      revision_before  INTEGER,
      revision_after   INTEGER,
      marks            TEXT    NOT NULL DEFAULT '{}',
      stats            TEXT    NOT NULL DEFAULT '{}',
      snapshot         TEXT    NOT NULL,
      snapshot_sha256  TEXT    NOT NULL,
      request_id       TEXT    UNIQUE,
      restored_from    INTEGER,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, run_no)
    );
    CREATE TABLE IF NOT EXISTS player_test_run_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      user_id     INTEGER NOT NULL,
      run_id      INTEGER,
      action      TEXT    NOT NULL,
      actor       TEXT    NOT NULL DEFAULT '',
      details     TEXT,
      prev_hash   TEXT    NOT NULL,
      hash        TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_test_run_audit_user ON player_test_run_audit (user_id, id);
    CREATE TRIGGER IF NOT EXISTS player_test_runs_no_delete BEFORE DELETE ON player_test_runs
      BEGIN SELECT RAISE(ABORT, 'player_test_runs : archives conservées (#75)'); END;
    CREATE TRIGGER IF NOT EXISTS player_test_runs_no_update BEFORE UPDATE ON player_test_runs
      BEGIN SELECT RAISE(ABORT, 'player_test_runs : archives non modifiables (#75)'); END;
    CREATE TRIGGER IF NOT EXISTS player_test_run_audit_no_update BEFORE UPDATE ON player_test_run_audit
      BEGIN SELECT RAISE(ABORT, 'player_test_run_audit est en ajout seul (#75)'); END;
    CREATE TRIGGER IF NOT EXISTS player_test_run_audit_no_delete BEFORE DELETE ON player_test_run_audit
      BEGIN SELECT RAISE(ABORT, 'player_test_run_audit est en ajout seul (#75)'); END;
    -- Garde de sauvegarde après un reset : contrôleur « reset » posé et révision minimale
    CREATE TABLE IF NOT EXISTS player_reset_guards (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      controller_id  TEXT    NOT NULL,
      revision       INTEGER NOT NULL,
      run_id         INTEGER,
      kind           TEXT    NOT NULL,
      at_ms          INTEGER NOT NULL
    );
  `);
}

// ── Outils ───────────────────────────────────────────────────────────────────

const _sha = s => crypto.createHash('sha256').update(s).digest('hex');
const _tableCache = new Map();
function _columns(name) {
  if (_tableCache.has(name)) return _tableCache.get(name);
  const cols = conn().prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);
  if (cols.length) _tableCache.set(name, cols);   // table absente : pas de cache (créée plus tard par son module)
  return cols;
}
const _exists = name => _columns(name).length > 0;
const _nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const _int = v => (Number.isFinite(v) ? v : 0);
const _json = (s, d = null) => { try { return JSON.parse(s); } catch (_) { return d; } };

function _audit(userId, runId, action, actor, details) {
  const prev = conn().prepare('SELECT hash FROM player_test_run_audit ORDER BY id DESC LIMIT 1').get()?.hash ?? 'genesis';
  const createdAt = _nowIso();
  const det = JSON.stringify(details ?? {});
  const hash = _sha([prev, createdAt, userId, runId ?? '', action, actor, det].join('|'));
  conn().prepare(`INSERT INTO player_test_run_audit (created_at, user_id, run_id, action, actor, details, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(createdAt, userId, runId ?? null, action, actor, det, prev, hash);
}

/** Vérifie la chaîne d'empreintes du journal d'audit : { ok, entries, brokenAt }. */
function verifyAudit() {
  let prev = 'genesis', n = 0;
  for (const r of conn().prepare('SELECT * FROM player_test_run_audit ORDER BY id').iterate()) {
    const h = _sha([prev, r.created_at, r.user_id, r.run_id ?? '', r.action, r.actor, r.details].join('|'));
    if (r.prev_hash !== prev || r.hash !== h) return { ok: false, entries: n, brokenAt: r.id };
    prev = r.hash; n++;
  }
  return { ok: true, entries: n, brokenAt: null };
}

function _user(userId) {
  const u = conn().prepare('SELECT id, username, created_at, league_id FROM users WHERE id = ?').get(userId);
  if (!u) throw new TestRunError(404, 'Joueur introuvable.', 'not_found');
  return u;
}

function _marks() {
  const out = {};
  for (const t of EVIDENCE_TABLES) out[t] = _exists(t) ? (conn().prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM ${t}`).get().m) : 0;
  return out;
}

/** Lignes de preuves du joueur dans la fenêtre (from, to] : les plus récentes si plus de EVIDENCE_COPY_MAX. */
function _copyEvidence(userId, fromMarks, toMarks) {
  const out = {};
  for (const t of EVIDENCE_TABLES) {
    if (!_exists(t)) continue;
    const args = [userId, fromMarks[t] ?? 0, toMarks[t] ?? 0];
    const count = conn().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ? AND id > ? AND id <= ?`).get(...args).n;
    const rows = conn().prepare(`SELECT * FROM ${t} WHERE user_id = ? AND id > ? AND id <= ? ORDER BY id DESC LIMIT ${EVIDENCE_COPY_MAX}`).all(...args).reverse()
      .map(({ ip_hash, ...r }) => r);   // empreinte d'IP jamais recopiée (export possible)
    out[t] = { count, truncated: count > rows.length, rows };
  }
  return out;
}

function _lastRun(userId) {
  return conn().prepare('SELECT * FROM player_test_runs WHERE user_id = ? ORDER BY run_no DESC LIMIT 1').get(userId) ?? null;
}

// ── Instantané ───────────────────────────────────────────────────────────────

/** État complet du joueur (lecture seule). */
function collectState(userId) {
  const user = _user(userId);
  const season = db.getActiveSeason();
  const saveRow = db.getUserSave(userId);
  const tables = {};
  for (const t of STATE_TABLES) {
    if (!_exists(t.name)) continue;
    tables[t.name] = conn().prepare(`SELECT * FROM ${t.name} WHERE user_id = ?`).all(userId);
  }
  const gemAccount = _exists('gem_accounts') ? conn().prepare('SELECT * FROM gem_accounts WHERE user_id = ?').get(userId) ?? null : null;
  const controller = conn().prepare('SELECT * FROM play_controllers WHERE user_id = ?').get(userId) ?? null;
  return {
    format: SNAPSHOT_FORMAT,
    takenAt: _nowIso(),
    userId,
    activeSeasonId: season?.id ?? null,
    leagueId: user.league_id ?? null,
    save: saveRow ? { revision: saveRow.version, savedAt: saveRow.saved_at, data: _json(saveRow.data, null) } : null,
    tables,
    gemAccount,
    playController: controller,
  };
}

/** Statistiques comparables d'un essai, calculées sur l'état et la fenêtre de journaux (fromMarks, toMarks]. */
function computeStats(state, { startedAt, endedAt, fromMarks = {}, toMarks = null } = {}) {
  const d = state.save?.data ?? {};
  const ss = d.seasonStats ?? {};
  const st = d.stats ?? {};
  const sid = state.activeSeasonId;
  const rank = (state.tables.season_rankings ?? []).find(r => r.season_id === sid) ?? null;
  const risk = (state.tables.risk_scores ?? []).find(r => r.season_id === sid) ?? null;
  const depthT = (state.tables.player_depth_tracking ?? [])[0] ?? null;
  const userId = state.userId;
  const win = (t) => {
    const from = fromMarks[t] ?? 0;
    const to = toMarks ? toMarks[t] : Number.MAX_SAFE_INTEGER;
    return [userId, from, to];
  };
  const c = conn();
  const decisions = {};
  if (_exists('security_events')) {
    for (const r of c.prepare('SELECT type, COUNT(*) AS n FROM security_events WHERE user_id = ? AND id > ? AND id <= ? GROUP BY type').all(...win('security_events'))) decisions[r.type] = r.n;
  }
  const anticheat = {};
  if (_exists('anticheat_logs')) {
    for (const r of c.prepare('SELECT action_taken AS a, COUNT(*) AS n FROM anticheat_logs WHERE user_id = ? AND id > ? AND id <= ? GROUP BY action_taken').all(...win('anticheat_logs'))) anticheat[r.a] = r.n;
  }
  let autodigMaxSeen = null, samples = 0;
  if (_exists('antibot_save_samples')) {
    const r = c.prepare('SELECT MAX(autodig_level) AS m, COUNT(*) AS n FROM antibot_save_samples WHERE user_id = ? AND id > ? AND id <= ?').get(...win('antibot_save_samples'));
    autodigMaxSeen = r.m ?? null; samples = r.n;
  }
  const durationSec = startedAt && endedAt
    ? Math.max(0, Math.round((Date.parse(`${endedAt.replace(' ', 'T')}Z`) - Date.parse(`${startedAt.replace(' ', 'T')}Z`)) / 1000)) : null;
  return {
    startedAt: startedAt ?? null,
    endedAt: endedAt ?? null,
    durationSec,
    depth: _int(d.depth ?? 1),
    seasonMaxDepthDeclared: _int(ss.maxDepth),
    rankedMaxDepth: rank ? _int(rank.max_depth) : 0,
    acceptedDepth: depthT && depthT.season_id === sid ? _int(depthT.accepted_depth) : 0,
    manualClicks: _int(ss.manualClicks),
    suspiciousClicks: _int(ss.suspiciousScore),
    manualBlocksDeclared: _int(ss.manualBlocks),
    manualBlocksValidated: rank ? Math.min(_int(rank.effective_manual_blocks ?? rank.manual_blocks), _int(rank.manual_blocks)) : 0,
    autoBlocks: _int(ss.autoBlocks),
    blocksDestroyed: _int(st.blocksDestroyed),
    pickaxeLevel: _int(d.pickaxeLevel ?? 1),
    autodigLevelEnd: _int(d.upgrades?.autodig),
    autodigLevelMaxSeen: autodigMaxSeen === null ? null : Math.max(autodigMaxSeen, _int(d.upgrades?.autodig)),
    coins: _int(d.coins),
    coinsEarned: _int(st.totalCoinsEarned),
    gems: _int(d.gems),
    gemsFound: _int(st.gemsFound),
    relics: Object.keys(d.relics ?? {}).length,
    riskScore: risk ? Math.round(risk.score * 10) / 10 : 0,
    riskLevel: risk ? risk.level : 0,
    serverDecisions: decisions,
    anticheatActions: anticheat,
    saveSamples: samples,
    saveRevision: state.save?.revision ?? null,
  };
}

// ── Nouveau personnage ───────────────────────────────────────────────────────

/**
 * Sauvegarde d'un nouveau personnage (mêmes valeurs que GameState au premier lancement).
 * Conservés : achats cosmétiques et délai de publicité (monetization), récompense quotidienne déjà
 * réclamée aujourd'hui (daily) et missions du jour déjà réclamées (aucun double gain), graine des blocs.
 */
function freshSave(old, seasonId, nowMs = Date.now()) {
  const o = old && typeof old === 'object' ? old : {};
  const dm = o.dailyMissions && typeof o.dailyMissions === 'object' ? o.dailyMissions : { date: null, missions: [], baselineStats: null };
  let baseline = null;
  if (dm.baselineStats && typeof dm.baselineStats === 'object') {
    // Même règle que le reset de saison du client (DailyMissions.rebase, B11) : la progression du jour est gardée
    baseline = {};
    for (const [k, v] of Object.entries(dm.baselineStats)) {
      const current = k === 'depth' ? _int(o.depth ?? 1) : _int(o.stats?.[k]);
      const gained = Math.max(0, current - _int(v));
      baseline[k] = (k === 'depth' ? 1 : 0) - gained;
    }
  }
  return {
    saveVersion: Number.isSafeInteger(o.saveVersion) ? Math.max(16, o.saveVersion) : 16,
    lastSaveTime: nowMs,
    coins: 0,
    gems: 0,
    depth: 1,
    pickaxeLevel: 1,
    damage: 1,
    upgrades: { luck: 0, bag: 0, autodig: 0, fragment_shop: 0, block_reroll: 0 },
    collection: [],
    collectionMeta: {},
    quests: {},
    stats: { blocksDestroyed: 0, totalCoinsEarned: 0, gemsFound: 0, chestsFound: 0, totalUpgradesBought: 0, minedByType: {} },
    daily: o.daily && typeof o.daily === 'object' ? { ...o.daily } : { lastClaimDate: null, streakDay: 0 },
    coinBoost: { multiplier: 1, expiresAt: 0 },
    monetization: o.monetization && typeof o.monetization === 'object' ? { ...o.monetization } : { adLastWatched: 0, pickaxeSkin: null },
    relicFragments: 0,
    relics: {},
    shopChestsBought: { simple: 0, rare: 0, antique: 0 },
    dailyMissions: { date: dm.date ?? null, missions: Array.isArray(dm.missions) ? dm.missions : [], baselineStats: baseline },
    seasonStats: { seasonId: seasonId ?? 0, maxDepth: 0, manualBlocks: 0, autoBlocks: 0, manualClicks: 0, suspiciousScore: 0,
      suspiciousBlocks: 0, throttledHits: 0, regularityScore: 0, isActive: false },
    blockSeed: Number.isSafeInteger(o.blockSeed) ? o.blockSeed : 0,
    blockSeq: Number.isSafeInteger(o.blockSeq) ? o.blockSeq : 0,
    block: null,
  };
}

// ── Archivage d'un essai ─────────────────────────────────────────────────────

function _archive(userId, { kind, reason, actor, requestId = null, revisionAfter = null, restoredFrom = null }) {
  const user = _user(userId);
  const last = _lastRun(userId);
  const state = collectState(userId);
  const marks = _marks();
  const startedAt = last ? last.ended_at : user.created_at;
  const endedAt = _nowIso();
  const fromMarks = last ? _json(last.marks, {}) : {};
  const stats = computeStats(state, { startedAt, endedAt, fromMarks, toMarks: marks });
  state.evidence = _copyEvidence(userId, fromMarks, marks);
  const snapshot = JSON.stringify(state);
  const runNo = (last?.run_no ?? 0) + 1;
  const testRunId = `tr_${crypto.randomUUID()}`;
  const info = conn().prepare(`INSERT INTO player_test_runs (user_id, run_no, test_run_id, started_at, ended_at, end_kind, reason, actor,
      season_id, revision_before, revision_after, marks, stats, snapshot, snapshot_sha256, request_id, restored_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, runNo, testRunId, startedAt, endedAt, kind, reason, actor, state.activeSeasonId, state.save?.revision ?? null,
      revisionAfter, JSON.stringify(marks), JSON.stringify(stats), snapshot, _sha(snapshot), requestId, restoredFrom);
  _audit(userId, info.lastInsertRowid, `archive:${kind}`, actor, { runNo, testRunId, sha256: _sha(snapshot), reason });
  return { id: Number(info.lastInsertRowid), runNo, testRunId, state, stats, marks };
}

/**
 * Instantané seul (sans modification de l'état), dans la transaction de l'appelant : utilisé par la
 * réinitialisation saisonnière partielle pour ne plus jamais perdre l'état d'avant.
 */
function archiveBefore(userId, { kind, reason = '', actor = 'admin' }) {
  return _archive(userId, { kind, reason, actor });
}

// ── Écritures ────────────────────────────────────────────────────────────────

function _validateCommon(userId, body) {
  const user = _user(userId);
  const b = body ?? {};
  if (typeof b.confirmUsername !== 'string' || b.confirmUsername !== user.username) {
    throw new TestRunError(400, 'Le pseudo saisi ne correspond pas exactement au joueur.', 'confirm_username');
  }
  if (!Number.isSafeInteger(b.expectedRevision) && b.expectedRevision !== null) {
    throw new TestRunError(400, 'Révision attendue manquante : relancez l\'aperçu.', 'expected_revision');
  }
  if (typeof b.requestId !== 'string' || !REQUEST_ID_RE.test(b.requestId)) {
    throw new TestRunError(400, 'Identifiant de requête invalide.', 'request_id');
  }
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, REASON_MAX) : '';
  if (reason.length < 3) throw new TestRunError(400, 'Motif obligatoire (3 caractères minimum).', 'reason');
  return { user, reason, requestId: b.requestId, expectedRevision: b.expectedRevision };
}

/** Rejeu d'une requête déjà traitée : même résultat, rien n'est réécrit. */
function _replayed(userId, requestId) {
  const r = conn().prepare('SELECT * FROM player_test_runs WHERE request_id = ?').get(requestId);
  if (!r) return null;
  if (r.user_id !== userId) throw new TestRunError(409, 'Identifiant de requête déjà utilisé.', 'request_id_reused');
  return { ok: true, replayed: true, runId: r.id, runNo: r.run_no, testRunId: r.test_run_id, revision: r.revision_after };
}

function _checkRevision(userId, expected) {
  const cur = db.getUserSave(userId)?.version ?? null;
  if (cur !== expected) {
    throw new TestRunError(409, `La sauvegarde a changé depuis l'aperçu (révision ${cur ?? 'aucune'} au lieu de ${expected ?? 'aucune'}) : relancez l'aperçu.`, 'stale_preview');
  }
}

function _deleteState(userId, seasonId) {
  for (const t of STATE_TABLES) {
    if (!_exists(t.name)) continue;
    if (t.scope === 'season') {
      if (seasonId !== null) conn().prepare(`DELETE FROM ${t.name} WHERE user_id = ? AND season_id = ?`).run(userId, seasonId);
    } else {
      conn().prepare(`DELETE FROM ${t.name} WHERE user_id = ?`).run(userId);
    }
  }
}

function _insertRows(name, rows) {
  const cols = new Set(_columns(name));
  for (const row of rows) {
    const keys = Object.keys(row).filter(k => cols.has(k) && !(k === 'id' && name === 'season_rankings'));
    if (!keys.length) continue;
    conn().prepare(`INSERT INTO ${name} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(k => row[k]));
  }
}

/** Toutes les pages ouvertes perdent la main ; la prochaine page chargée relit l'état du serveur. */
function _guard(userId, revision, runId, kind) {
  const controllerId = `${RESET_CONTROLLER_PREFIX}${crypto.randomBytes(18).toString('base64url')}`;
  const now = Date.now();
  const row = conn().prepare('SELECT epoch FROM play_controllers WHERE user_id = ?').get(userId);
  conn().prepare(`INSERT INTO play_controllers (user_id, controller_id, epoch, claimed_ms, heartbeat_ms) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET controller_id = excluded.controller_id, epoch = excluded.epoch,
        claimed_ms = excluded.claimed_ms, heartbeat_ms = excluded.heartbeat_ms`)
    .run(userId, controllerId, (row?.epoch ?? 0) + 1, now, now);
  conn().prepare(`INSERT INTO player_reset_guards (user_id, controller_id, revision, run_id, kind, at_ms) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET controller_id = excluded.controller_id, revision = excluded.revision,
        run_id = excluded.run_id, kind = excluded.kind, at_ms = excluded.at_ms`)
    .run(userId, controllerId, revision, runId, kind, now);
}

/** Garde de sauvegarde active pour ce joueur (null sinon). */
function getGuard(userId) {
  return conn().prepare('SELECT * FROM player_reset_guards WHERE user_id = ?').get(userId) ?? null;
}

/** La page qui a la main actuellement est le contrôleur posé par un reset admin. */
function isResetController(userId) {
  const g = getGuard(userId);
  if (!g) return false;
  const c = conn().prepare('SELECT controller_id FROM play_controllers WHERE user_id = ?').get(userId);
  return !!c && c.controller_id === g.controller_id;
}

function _securityEvent(type, userId, seasonId, details, scoreBefore = null) {
  if (!_exists('security_events')) return;
  conn().prepare(`INSERT INTO security_events (type, user_id, season_id, score_before, score_after, details) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(type, userId, seasonId, scoreBefore, 0, JSON.stringify(details));
}

/** Aperçu : ce qui sera archivé et remis à zéro, révision à confirmer. */
function previewReset(userId) {
  const user = _user(userId);
  const state = collectState(userId);
  const last = _lastRun(userId);
  const stats = computeStats(state, { startedAt: last ? last.ended_at : user.created_at, endedAt: _nowIso(), fromMarks: last ? _json(last.marks, {}) : {} });
  const lowest = db.getLowestLeague?.() ?? null;
  return {
    username: user.username,
    expectedRevision: state.save?.revision ?? null,
    currentRunNo: (last?.run_no ?? 0) + 1,
    activeSeasonId: state.activeSeasonId,
    current: stats,
    after: { depth: 1, coins: 0, gems: 0, pickaxeLevel: 1, autodigLevel: 0, relics: 0, manualBlocksValidated: 0, rankedMaxDepth: 0, riskScore: 0,
      leagueId: lowest?.id ?? null, ranked: false },
    rowsToArchive: Object.fromEntries(Object.entries(state.tables).map(([k, v]) => [k, v.length])),
    kept: ['compte, mot de passe, e-mail, connexions Google/X', 'invitation bêta', 'points de récompense, commandes, gagnants',
      'classements et instantanés des saisons clôturées', 'journaux anti-bot, de sécurité et d\'événements (rattachés à l\'essai archivé)',
      'achats cosmétiques, récompense quotidienne et missions déjà réclamées aujourd\'hui (aucun double gain)'],
  };
}

/**
 * Recommencer un test à zéro. body : { confirmUsername, expectedRevision, requestId, reason }.
 * Une transaction IMMEDIATE : tout ou rien.
 */
function resetPlayer(userId, body, { actor = 'admin' } = {}) {
  const run = () => {
    const { reason, requestId, expectedRevision } = _validateCommon(userId, body);
    const replay = _replayed(userId, requestId);
    if (replay) return replay;
    _checkRevision(userId, expectedRevision);
    const season = db.getActiveSeason();
    const seasonId = season?.id ?? null;
    const before = collectState(userId);
    const oldRisk = (before.tables.risk_scores ?? []).find(r => r.season_id === seasonId)?.score ?? null;

    const nextRevision = (before.save?.revision ?? 0) + 1;
    const archived = _archive(userId, { kind: 'test_reset', reason, actor, requestId, revisionAfter: nextRevision });
    const data = freshSave(before.save?.data, seasonId);
    const { version } = db.upsertUserSave(userId, JSON.stringify(data));
    if (version !== nextRevision) throw new TestRunError(409, 'Révision inattendue : opération annulée.', 'revision_race');
    _deleteState(userId, seasonId);
    const lowest = db.getLowestLeague?.() ?? null;
    conn().prepare('UPDATE users SET league_id = ? WHERE id = ?').run(lowest?.id ?? null, userId);
    gemLedger.onTestReset(userId, { revision: version, runId: archived.testRunId, balance: 0 });
    _guard(userId, version, archived.id, 'test_reset');
    db.logUserEvent(userId, 'admin_test_reset', { adminAction: true, testRunId: archived.testRunId, runNo: archived.runNo, revision: version });
    _securityEvent('admin_test_reset', userId, seasonId, { testRunId: archived.testRunId, runNo: archived.runNo, newRunNo: archived.runNo + 1, revision: version }, oldRisk);
    _audit(userId, archived.id, 'reset', actor, { testRunId: archived.testRunId, revision: version, reason });
    return { ok: true, replayed: false, runId: archived.id, runNo: archived.runNo, testRunId: archived.testRunId, revision: version, newRunNo: archived.runNo + 1 };
  };
  return conn().transaction(run).immediate();
}

function getRun(userId, runId) {
  const r = conn().prepare('SELECT * FROM player_test_runs WHERE id = ? AND user_id = ?').get(runId, userId);
  if (!r) throw new TestRunError(404, 'Essai introuvable.', 'run_not_found');
  return r;
}

function _diffRows(current, snap) {
  const keys = ['depth', 'rankedMaxDepth', 'manualBlocksValidated', 'manualClicks', 'blocksDestroyed', 'pickaxeLevel', 'autodigLevelEnd',
    'coins', 'gems', 'relics', 'riskScore', 'riskLevel'];
  return keys.map(k => ({ key: k, current: current[k] ?? null, restored: snap[k] ?? null }));
}

/** Aperçu de restauration : différences entre l'état courant et l'instantané de l'essai. */
function previewRestore(userId, runId) {
  const user = _user(userId);
  const r = getRun(userId, runId);
  const snap = _json(r.snapshot, null);
  if (!snap || !snap.save) throw new TestRunError(409, 'Instantané sans sauvegarde : restauration impossible.', 'no_save');
  if (_sha(r.snapshot) !== r.snapshot_sha256) throw new TestRunError(409, 'Empreinte de l\'instantané invalide : restauration refusée.', 'snapshot_tampered');
  const season = db.getActiveSeason();
  const state = collectState(userId);
  const last = _lastRun(userId);
  const current = computeStats(state, { startedAt: last ? last.ended_at : user.created_at, endedAt: _nowIso(), fromMarks: last ? _json(last.marks, {}) : {} });
  const sameSeason = snap.activeSeasonId !== null && snap.activeSeasonId === (season?.id ?? null);
  return {
    username: user.username,
    runNo: r.run_no,
    testRunId: r.test_run_id,
    expectedRevision: state.save?.revision ?? null,
    sameSeason,
    seasonNote: sameSeason ? 'Même saison : classement, suivis et score de risque de l\'essai restaurés.'
      : 'Saison différente : seule la progression est restaurée ; le classement de la saison active repart de zéro (saisons clôturées intactes).',
    diff: _diffRows(current, _json(r.stats, {})),
  };
}

/** Restaure l'instantané d'un essai archivé (l'essai en cours est archivé d'abord). */
function restoreRun(userId, runId, body, { actor = 'admin' } = {}) {
  const run = () => {
    const { reason, requestId, expectedRevision } = _validateCommon(userId, body);
    const replay = _replayed(userId, requestId);
    if (replay) return replay;
    const r = getRun(userId, runId);
    if (_sha(r.snapshot) !== r.snapshot_sha256) throw new TestRunError(409, 'Empreinte de l\'instantané invalide : restauration refusée.', 'snapshot_tampered');
    const snap = _json(r.snapshot, null);
    if (!snap || !snap.save || !snap.save.data) throw new TestRunError(409, 'Instantané sans sauvegarde : restauration impossible.', 'no_save');
    _checkRevision(userId, expectedRevision);
    const season = db.getActiveSeason();
    const seasonId = season?.id ?? null;
    const sameSeason = snap.activeSeasonId !== null && snap.activeSeasonId === seasonId;

    const nextRevision = (db.getUserSave(userId)?.version ?? 0) + 1;
    const archived = _archive(userId, { kind: 'restore', reason, actor, requestId, revisionAfter: nextRevision, restoredFrom: r.id });
    const data = { ...snap.save.data, lastSaveTime: Date.now() };
    if (!sameSeason) {
      // La saison a changé : la progression revient, les compteurs saisonniers repartent pour la saison active
      data.seasonStats = freshSave(null, seasonId).seasonStats;
    }
    const { version } = db.upsertUserSave(userId, JSON.stringify(data));
    if (version !== nextRevision) throw new TestRunError(409, 'Révision inattendue : opération annulée.', 'revision_race');
    _deleteState(userId, seasonId);
    for (const t of STATE_TABLES) {
      const rows = snap.tables?.[t.name];
      if (!Array.isArray(rows) || !_exists(t.name)) continue;
      let keep;
      if (t.scope === 'season') keep = sameSeason ? rows.filter(x => x.season_id === seasonId) : [];
      else if (SEASON_TRACKERS.has(t.name)) keep = sameSeason ? rows.filter(x => x.season_id === seasonId) : [];
      else keep = rows;
      _insertRows(t.name, keep);
    }
    if (snap.leagueId !== undefined) conn().prepare('UPDATE users SET league_id = ? WHERE id = ?').run(snap.leagueId, userId);
    gemLedger.onTestReset(userId, { revision: version, runId: archived.testRunId, balance: Math.max(0, _int(snap.gemAccount?.balance ?? data.gems)),
      account: snap.gemAccount, reason: 'test_restore' });
    _guard(userId, version, archived.id, 'restore');
    db.logUserEvent(userId, 'admin_test_restore', { adminAction: true, testRunId: archived.testRunId, restoredRunNo: r.run_no, revision: version });
    _securityEvent('admin_test_restore', userId, seasonId, { archivedRunNo: archived.runNo, restoredRunNo: r.run_no, sameSeason, revision: version });
    _audit(userId, archived.id, 'restore', actor, { from: r.test_run_id, archived: archived.testRunId, revision: version, sameSeason, reason });
    return { ok: true, replayed: false, runId: archived.id, runNo: archived.runNo, testRunId: archived.testRunId, restoredRunNo: r.run_no, revision: version, sameSeason };
  };
  return conn().transaction(run).immediate();
}

// ── Historique ───────────────────────────────────────────────────────────────

const _publicRun = r => ({
  id: r.id, runNo: r.run_no, testRunId: r.test_run_id, startedAt: r.started_at, endedAt: r.ended_at, endKind: r.end_kind,
  reason: r.reason, actor: r.actor, seasonId: r.season_id, revisionBefore: r.revision_before, restoredFrom: r.restored_from,
  snapshotSha256: r.snapshot_sha256, stats: _json(r.stats, {}), marks: _json(r.marks, {}),
});

/** Essais archivés + essai en cours (statistiques en direct). */
function listRuns(userId) {
  const user = _user(userId);
  const rows = conn().prepare('SELECT * FROM player_test_runs WHERE user_id = ? ORDER BY run_no').all(userId);
  const last = rows[rows.length - 1] ?? null;
  const state = collectState(userId);
  const current = computeStats(state, { startedAt: last ? last.ended_at : user.created_at, endedAt: _nowIso(), fromMarks: last ? _json(last.marks, {}) : {} });
  const audit = conn().prepare('SELECT id, created_at AS createdAt, run_id AS runId, action, actor, details FROM player_test_run_audit WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(userId)
    .map(a => ({ ...a, details: _json(a.details, {}) }));
  return {
    userId, username: user.username,
    runs: rows.map(_publicRun),
    current: { runNo: (last?.run_no ?? 0) + 1, startedAt: current.startedAt, stats: current },
    guard: getGuard(userId) ? { kind: getGuard(userId).kind, revision: getGuard(userId).revision } : null,
    audit, auditChain: verifyAudit(),
  };
}

const CSV_COLS = ['runNo', 'testRunId', 'status', 'startedAt', 'endedAt', 'durationSec', 'endKind', 'depth', 'rankedMaxDepth', 'seasonMaxDepthDeclared',
  'manualBlocksValidated', 'manualBlocksDeclared', 'autoBlocks', 'blocksDestroyed', 'manualClicks', 'suspiciousClicks', 'pickaxeLevel',
  'autodigLevelEnd', 'autodigLevelMaxSeen', 'coins', 'coinsEarned', 'gems', 'gemsFound', 'relics', 'riskScore', 'riskLevel', 'serverDecisions', 'anticheatActions'];

function _csvCell(v) {
  const s = v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return /[",;\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
}

/** Export : { filename, type, body }. format 'json' (avec instantanés si full) ou 'csv'. */
function exportRuns(userId, { format = 'json', full = false } = {}) {
  const view = listRuns(userId);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    const lines = [CSV_COLS.join(';')];
    const rowOf = (runNo, testRunId, status, endKind, s) => CSV_COLS.map(c => _csvCell(
      c === 'runNo' ? runNo : c === 'testRunId' ? testRunId : c === 'status' ? status : c === 'endKind' ? endKind : s[c])).join(';');
    for (const r of view.runs) lines.push(rowOf(r.runNo, r.testRunId, 'archivé', r.endKind, r.stats));
    lines.push(rowOf(view.current.runNo, '', 'en cours', '', view.current.stats));
    return { filename: `dig-essais-joueur-${userId}-${stamp}.csv`, type: 'text/csv; charset=utf-8', body: `﻿${lines.join('\n')}\n` };
  }
  const out = { exportedAt: _nowIso(), userId, runs: view.runs, current: view.current, auditChain: view.auditChain };
  if (full) {
    const snaps = conn().prepare('SELECT id, snapshot FROM player_test_runs WHERE user_id = ?').all(userId);
    const byId = new Map(snaps.map(s => [s.id, _json(s.snapshot, null)]));
    out.runs = out.runs.map(r => ({ ...r, snapshot: byId.get(r.id) }));
  }
  return { filename: `dig-essais-joueur-${userId}-${stamp}.json`, type: 'application/json; charset=utf-8', body: JSON.stringify(out, null, 2) };
}

module.exports = {
  init, TestRunError, collectState, computeStats, freshSave, archiveBefore, previewReset, resetPlayer,
  previewRestore, restoreRun, listRuns, exportRuns, getGuard, isResetController, verifyAudit,
  STATE_TABLES, EVIDENCE_TABLES, RESET_CONTROLLER_PREFIX,
};
