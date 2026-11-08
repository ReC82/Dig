/**
 * DIG! — Admin Joueurs (#90) : liste paginée et suppression contrôlée d'un compte de test.
 *
 * Liste : pagination serveur (10/20/50), total, tri (activité, inscription, pseudo, ID), filtre,
 * recherche partielle sur toute la base (insensible à la casse et aux accents). Jamais d'e-mail
 * ni de secret dans les lignes renvoyées.
 *
 * Suppression : pour refaire la VRAIE inscription (même pseudo, même adresse) avec un compte de
 * test. Trois verrous :
 *   1. le compte doit avoir été marqué « compte de test » par l'admin (action séparée, motivée) ;
 *   2. aucune valeur réelle attachée : points de récompense, commandes, gains de concours,
 *      paiements, classement figé d'une saison clôturée, récompense X ;
 *   3. confirmation forte : pseudo exact + mot « SUPPRIMER » + motif + identifiant de requête
 *      (anti-rejeu : le même identifiant renvoie le même résultat sans rien refaire).
 * Dans UNE transaction : copie des journaux de sécurité / anti-bot / événements du compte dans
 * `account_deletions` (trace d'audit minimale, sans e-mail ni mot de passe), effacement de toutes
 * les lignes du joueur (sauf journaux d'audit listés dans KEEP), puis de la ligne `users`.
 * L'identifiant n'est jamais réutilisé (AUTOINCREMENT) : un ancien onglet ou une ancienne session
 * ne peut rien rattacher au compte recréé (voir authVersionGuard : session fermée, client purgé).
 * Le lien d'invitation consommé reste consommé : une nouvelle invitation est nécessaire.
 */

'use strict';

const crypto = require('crypto');
const db = require('./db');

const conn = () => db.getDb();

const PER_PAGE = [10, 20, 50];
const SORTS = {
  activity: 'last_activity_ms DESC, u.id DESC',
  created_desc: 'u.created_at DESC, u.id DESC',
  created_asc: 'u.created_at ASC, u.id ASC',
  username: 'u.username ASC, u.id ASC',
  id: 'u.id ASC',
};
const FILTERS = ['all', 'active7', 'testers', 'test_accounts', 'suspended'];
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const REASON_MAX = 300;
const CONFIRM_WORD = 'SUPPRIMER';
const ARCHIVE_MAX = 5000;

/** Valeur réelle attachée au compte : la suppression est refusée tant qu'une de ces lignes existe. */
const BLOCKERS = [
  { table: 'reward_point_ledger',  label: 'points de récompense (mouvements)' },
  { table: 'reward_point_awards',  label: 'points de récompense attribués' },
  { table: 'reward_point_wallets', label: 'portefeuille de points non vide', where: '(balance > 0 OR earned_total > 0)' },
  { table: 'shop_orders',          label: 'commandes en boutique de cadeaux' },
  { table: 'contest_winners',      label: 'gains de concours' },
  { table: 'fragment_pack_orders', label: 'paiements (lot de fragments)' },
  { table: 'x_reward_claims',      label: 'récompenses X demandées' },
  { table: 'season_standings',     label: 'classement figé d\'une saison clôturée' },
  { table: 'season_snapshots',     label: 'meneur d\'une saison clôturée', col: 'leader_user_id' },
];
/** Journaux d'audit conservés tels quels (identifiant orphelin, jamais réutilisé). */
const KEEP = [
  { table: 'player_test_run_audit', label: 'journal d\'audit des essais de test (#75)' },
  { table: 'x_link_history',        label: 'historique des liaisons X (anti-abus)' },
  { table: 'shop_audit',            label: 'journal de la boutique de cadeaux' },
  { table: 'news_items',            label: 'actualités publiées (le pseudo n\'y apparaît plus)', col: 'subject_user_id' },
  { table: 'bug_reports',           label: 'retours bêta (rendus anonymes)' },
];
/** Journaux copiés dans la trace d'audit avant effacement. */
const ARCHIVED = ['security_events', 'anticheat_logs', 'antibot_save_samples', 'antibot_activity', 'antibot_challenges',
  'antibot_suspensions', 'risk_scores', 'user_events', 'gem_ledger', 'gem_anomalies', 'pickaxe_charge_anomalies', 'beta_invite_uses'];
/** Libellés lisibles des données effacées (les autres tables apparaissent sous leur nom). */
const LABELS = {
  user_saves: 'sauvegarde cloud (pièces, profondeur, gemmes, fragments, reliques, inventaire)',
  season_rankings: 'classement de la saison en cours', player_click_tracking: 'suivi des clics', player_depth_tracking: 'suivi de profondeur',
  auth_tokens: 'liens e-mail (vérification, mot de passe)', user_identities: 'connexions Google', user_x_links: 'compte X lié',
  play_controllers: 'session de jeu (onglets ouverts)', player_badges: 'badges', badge_player_stats: 'statistiques de badges',
  badge_tracking: 'suivi des badges', badge_event_baselines: 'repères des badges', gem_accounts: 'solde de gemmes de référence',
  gem_ledger: 'registre de gemmes', gem_shop_purchases: 'achats en gemmes', collection_pity: 'collection (chance croissante)',
  collection_pity_cursor: 'collection (curseur)', monthly_event_finds: 'souvenirs d\'événements', monthly_event_cursors: 'événements (curseur)',
  daily_mission_days: 'missions du jour', daily_mission_claims: 'missions réclamées', pickaxe_charge_state: 'pioche à charges',
  player_tutorial: 'tutoriel', news_reads: 'actualités lues', news_prefs: 'préférences d\'actualités', player_test_runs: 'essais de test archivés (#75)',
  player_reset_guards: 'garde de reset (#75)', beta_invite_uses: 'rattachement à l\'invitation bêta', contest_exclusions: 'exclusions de concours',
  security_events: 'journal de sécurité', anticheat_logs: 'journal anti-triche', antibot_save_samples: 'échantillons anti-bot',
  antibot_activity: 'activité anti-bot', antibot_challenges: 'vérifications anti-bot', antibot_suspensions: 'suspensions anti-bot',
  risk_scores: 'score de risque', user_events: 'journal d\'événements du compte', gem_anomalies: 'anomalies de gemmes',
  pickaxe_charge_anomalies: 'anomalies de pioche', test_accounts: 'marque « compte de test »',
};

class PlayerAdminError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS test_accounts (
      user_id   INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      marked_at TEXT NOT NULL DEFAULT (datetime('now')),
      marked_by TEXT,
      reason    TEXT
    );
    -- Trace minimale d'une suppression de compte de test (#90) : jamais d'e-mail ni de mot de passe.
    CREATE TABLE IF NOT EXISTS account_deletions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id  TEXT NOT NULL UNIQUE,
      user_id     INTEGER NOT NULL,
      username    TEXT NOT NULL,
      created_at  TEXT,
      deleted_at  TEXT NOT NULL DEFAULT (datetime('now')),
      actor       TEXT,
      reason      TEXT NOT NULL,
      counts      TEXT NOT NULL,
      archive     TEXT NOT NULL,
      archive_sha TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_account_deletions_user ON account_deletions(user_id);
  `);
}

const _exists = name => !!conn().prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const _columns = name => conn().prepare(`PRAGMA table_info(${name})`).all().map(c => c.name);

/** Tables qui portent des lignes d'un joueur : { table, col }. */
function _userTables() {
  const out = [];
  for (const { name } of conn().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    if (name === 'users' || name === 'account_deletions') continue;
    const cols = _columns(name);
    if (cols.includes('user_id')) out.push({ table: name, col: 'user_id' });
  }
  for (const s of [...BLOCKERS, ...KEEP]) if (s.col && _exists(s.table)) out.push({ table: s.table, col: s.col });
  return out;
}

/** Recherche : minuscules, sans accents ni ligatures (les pseudos sont en [a-z0-9_-]). */
function normalizeQuery(q) {
  return String(q ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/æ/gi, 'ae').replace(/œ/gi, 'oe').replace(/ß/g, 'ss').toLowerCase().trim().slice(0, 40);
}

function _activeSeasonId() {
  return conn().prepare("SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1").get()?.id ?? null;
}

/**
 * Liste paginée. opts : { q, page, per, sort, filter, now }.
 * @returns {{ players, total, page, per, pages, sort, filter, q }}
 */
function listPlayers(opts = {}, now = Date.now()) {
  const per = PER_PAGE.includes(Number(opts.per)) ? Number(opts.per) : 20;
  const sort = Object.hasOwn(SORTS, opts.sort) ? opts.sort : 'activity';
  const filter = FILTERS.includes(opts.filter) ? opts.filter : 'all';
  const q = normalizeQuery(opts.q);
  const where = [], args = [];
  if (q) {
    // Recherche par pseudo (partielle) ou par identifiant exact (« 12 » ou « #12 »)
    const idq = /^#?\d{1,9}$/.test(q) ? parseInt(q.replace('#', ''), 10) : null;
    where.push(`(u.username LIKE ? ESCAPE '\\'${idq !== null ? ' OR u.id = ?' : ''})`);
    args.push(`%${q.replace(/[\\%_]/g, c => '\\' + c)}%`);
    if (idq !== null) args.push(idq);
  }
  const hasBeta = _exists('beta_invite_uses'), hasSusp = _exists('antibot_suspensions'), hasPc = _exists('play_controllers');
  if (filter === 'testers') where.push(hasBeta ? 'EXISTS (SELECT 1 FROM beta_invite_uses x WHERE x.user_id = u.id AND x.removed_at IS NULL)' : '0');
  if (filter === 'test_accounts') where.push('t.user_id IS NOT NULL');
  if (filter === 'suspended') {
    where.push(hasSusp ? "EXISTS (SELECT 1 FROM antibot_suspensions a WHERE a.user_id = u.id AND a.status = 'active' AND a.ends_ms > ?)" : '0');
    if (hasSusp) args.push(now);
  }
  if (filter === 'active7') { where.push('last_activity_ms >= ?'); args.push(now - 7 * 86_400_000); }

  const savedMs = "COALESCE(CAST((julianday(s.saved_at) - 2440587.5) * 86400000 AS INTEGER), 0)";
  const base = `
    FROM (SELECT u.*, MAX(${savedMs}, ${hasPc ? 'COALESCE(pc.heartbeat_ms, 0)' : '0'}) AS last_activity_ms,
                 s.saved_at, ${hasPc ? 'pc.heartbeat_ms' : 'NULL'} AS heartbeat_ms, s.data AS save_data
            FROM users u
            LEFT JOIN user_saves s ON s.user_id = u.id
            ${hasPc ? 'LEFT JOIN play_controllers pc ON pc.user_id = u.id' : ''}) u
    LEFT JOIN test_accounts t ON t.user_id = u.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const total = conn().prepare(`SELECT COUNT(*) AS n ${base}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / per));
  const page = Math.min(pages, Math.max(1, parseInt(opts.page, 10) || 1));
  const seasonId = _activeSeasonId();
  const rows = conn().prepare(`
    SELECT u.id, u.username, u.created_at, u.saved_at, u.heartbeat_ms, u.last_activity_ms,
           json_extract(u.save_data, '$.depth') AS depth,
           ${seasonId !== null ? '(SELECT r.manual_blocks FROM season_rankings r WHERE r.user_id = u.id AND r.season_id = ' + Number(seasonId) + ')' : 'NULL'} AS season_blocks,
           t.marked_at AS test_marked_at,
           ${hasBeta ? `(SELECT CASE WHEN x.removed_at IS NULL THEN 'tester' ELSE 'removed' END FROM beta_invite_uses x WHERE x.user_id = u.id ORDER BY x.id DESC LIMIT 1)` : 'NULL'} AS beta,
           ${hasSusp ? `EXISTS (SELECT 1 FROM antibot_suspensions a WHERE a.user_id = u.id AND a.status = 'active' AND a.ends_ms > ${Number(now)})` : '0'} AS suspended
      ${base}
     ORDER BY ${SORTS[sort]}
     LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per);
  const players = rows.map(r => ({
    id: r.id, username: r.username, createdAt: r.created_at,
    lastActivityAt: r.last_activity_ms > 0 ? new Date(r.last_activity_ms).toISOString() : null,
    lastSaveAt: r.saved_at ?? null,
    depth: Number.isFinite(r.depth) ? r.depth : null,
    seasonBlocks: r.season_blocks ?? null,
    testAccount: !!r.test_marked_at,
    beta: r.beta ?? null,
    suspended: !!r.suspended,
  }));
  return { players, total, page, per, pages, sort, filter, q };
}

// ── Marque « compte de test » ────────────────────────────────────────────────

function _user(userId) {
  const u = conn().prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(userId);
  if (!u) throw new PlayerAdminError(404, 'Joueur introuvable.', 'not_found');
  return u;
}

function _reason(body) {
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, REASON_MAX) : '';
  if (reason.length < 3) throw new PlayerAdminError(400, 'Motif obligatoire (3 caractères minimum).', 'reason');
  return reason;
}

function _confirmName(user, body) {
  if (typeof body?.confirmUsername !== 'string' || body.confirmUsername.trim() !== user.username) {
    throw new PlayerAdminError(400, 'Le pseudo saisi ne correspond pas exactement au joueur.', 'confirm_username');
  }
}

function getTestMark(userId) {
  return conn().prepare('SELECT marked_at, marked_by, reason FROM test_accounts WHERE user_id = ?').get(userId) ?? null;
}

/** Marque un compte comme compte de test (prérequis de la suppression). Idempotent. */
function markTestAccount(userId, body, { actor = 'admin' } = {}) {
  const user = _user(userId);
  _confirmName(user, body);
  const reason = _reason(body);
  return db.runTransaction(() => {
    const info = conn().prepare('INSERT OR IGNORE INTO test_accounts (user_id, marked_by, reason) VALUES (?, ?, ?)').run(userId, actor, reason);
    if (info.changes) db.logUserEvent?.(userId, 'admin_test_account_marked', { actor, reason });
    return { changed: info.changes > 0, testAccount: getTestMark(userId) };
  });
}

/** Retire la marque « compte de test ». Idempotent. */
function unmarkTestAccount(userId, { actor = 'admin' } = {}) {
  _user(userId);
  return db.runTransaction(() => {
    const info = conn().prepare('DELETE FROM test_accounts WHERE user_id = ?').run(userId);
    if (info.changes) db.logUserEvent?.(userId, 'admin_test_account_unmarked', { actor });
    return { changed: info.changes > 0, testAccount: null };
  });
}

// ── Suppression d'un compte de test ──────────────────────────────────────────

function _count(table, col, userId, extra) {
  return conn().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?${extra ? ` AND ${extra}` : ''}`).get(userId).n;
}

/** Raisons de refus (vide = suppression possible). */
function _blockers(userId) {
  const out = [];
  if (!getTestMark(userId)) out.push({ code: 'not_test_account', label: 'compte non marqué « compte de test » (marquez-le d\'abord, motif obligatoire)' });
  for (const b of BLOCKERS) {
    if (!_exists(b.table)) continue;
    const n = _count(b.table, b.col ?? 'user_id', userId, b.where);
    if (n > 0) out.push({ code: b.table, label: `${b.label} (${n})` });
  }
  return out;
}

/** Ce qui sera effacé (par table) et ce qui est conservé. */
function _impact(userId) {
  const blocked = new Set(BLOCKERS.map(b => b.table)), kept = new Set(KEEP.map(k => k.table));
  const erased = [], keptOut = [];
  for (const { table, col } of _userTables()) {
    if (blocked.has(table)) continue;
    const n = _count(table, col, userId);
    if (kept.has(table)) { if (n) keptOut.push({ table, label: KEEP.find(k => k.table === table).label, rows: n }); continue; }
    if (n) erased.push({ table, label: LABELS[table] ?? table, rows: n, archived: ARCHIVED.includes(table) });
  }
  return { erased, kept: keptOut };
}

/** Aperçu : verrous, données effacées / conservées, rappels. Ne modifie rien. */
function previewDelete(userId) {
  const user = _user(userId);
  const blockers = _blockers(userId);
  const { erased, kept } = _impact(userId);
  const sessions = _exists('play_controllers') ? _count('play_controllers', 'user_id', userId) : 0;
  return {
    userId: user.id, username: user.username, createdAt: user.created_at,
    testAccount: getTestMark(userId),
    allowed: blockers.length === 0, blockers, erased, kept,
    confirmWord: CONFIRM_WORD,
    always: [
      'compte de connexion supprimé : pseudo et adresse e-mail redeviennent libres pour une nouvelle inscription',
      `sessions fermées partout (${sessions ? 'session de jeu active' : 'aucune session de jeu active'}) ; un ancien onglet est déconnecté et sa sauvegarde locale effacée`,
      'identifiant jamais réutilisé : le nouveau compte part de zéro (aucun rang, ressource, fragment ni jeton)',
      'journaux de sécurité, anti-bot et d\'événements du compte copiés dans une trace d\'audit (sans e-mail ni mot de passe)',
      'le lien d\'invitation déjà utilisé reste consommé : créez une nouvelle invitation si les inscriptions sont sur invitation',
      'irréversible : aucune restauration de ce compte (ce n\'est pas une demande RGPD du joueur)',
    ],
  };
}

function _replay(requestId) {
  const r = conn().prepare('SELECT id, user_id, username, deleted_at FROM account_deletions WHERE request_id = ?').get(requestId);
  return r ? { ok: true, replayed: true, deletionId: r.id, userId: r.user_id, username: r.username, deletedAt: r.deleted_at } : null;
}

/**
 * Supprime un compte de test. body : { confirmUsername, confirmWord: 'SUPPRIMER', reason, requestId }.
 * Tout ou rien (transaction) ; même requestId → même résultat, rien n'est refait.
 */
function deleteTestAccount(userId, body, { actor = 'admin', ip = null } = {}) {
  const b = body ?? {};
  if (typeof b.requestId !== 'string' || !REQUEST_ID_RE.test(b.requestId)) {
    throw new PlayerAdminError(400, 'Identifiant de requête invalide.', 'request_id');
  }
  return conn().transaction(() => {
    const replay = _replay(b.requestId);
    if (replay) {
      if (replay.userId !== userId) throw new PlayerAdminError(409, 'Identifiant de requête déjà utilisé.', 'request_id_reused');
      return replay;
    }
    const user = _user(userId);
    _confirmName(user, b);
    if (b.confirmWord !== CONFIRM_WORD) throw new PlayerAdminError(400, `Saisissez le mot ${CONFIRM_WORD} en majuscules pour confirmer.`, 'confirm_word');
    const reason = _reason(b);
    const blockers = _blockers(userId);
    if (blockers.length) {
      throw new PlayerAdminError(409, `Suppression refusée : ${blockers.map(x => x.label).join(' ; ')}.`, 'blocked');
    }

    const counts = {}, archive = {};
    const kept = new Set(KEEP.map(k => k.table));
    for (const { table, col } of _userTables()) {
      if (kept.has(table)) continue;
      if (ARCHIVED.includes(table)) {
        const rows = conn().prepare(`SELECT * FROM ${table} WHERE ${col} = ? ORDER BY rowid DESC LIMIT ${ARCHIVE_MAX}`).all(userId);
        if (rows.length) archive[table] = rows;
      }
      const n = conn().prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(userId).changes;
      if (n) counts[table] = n;
    }
    if (_exists('bug_reports')) conn().prepare('UPDATE bug_reports SET user_id = NULL WHERE user_id = ?').run(userId);
    conn().prepare('DELETE FROM users WHERE id = ?').run(userId);

    const archiveJson = JSON.stringify(archive);
    const sha = crypto.createHash('sha256').update(archiveJson).digest('hex');
    const info = conn().prepare(`INSERT INTO account_deletions (request_id, user_id, username, created_at, actor, reason, counts, archive, archive_sha)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(b.requestId, userId, user.username, user.created_at, actor, reason, JSON.stringify(counts), archiveJson, sha);
    // Journal de sécurité global (user_id NULL : la ligne survit au compte)
    if (_exists('security_events')) {
      require('./antibot').logSecurityEvent('admin_account_deleted', {
        details: { deletedUserId: userId, deletionId: Number(info.lastInsertRowid), actor, tables: Object.keys(counts).length }, ip,
      });
    }
    return { ok: true, replayed: false, deletionId: Number(info.lastInsertRowid), userId, username: user.username, counts };
  }).immediate();
}

/** Dernières suppressions (trace d'audit, sans les journaux copiés). */
function listDeletions(limit = 20) {
  return conn().prepare(`SELECT id, user_id, username, created_at, deleted_at, actor, reason, counts, archive_sha
      FROM account_deletions ORDER BY id DESC LIMIT ?`).all(Math.max(1, Math.min(100, limit)))
    .map(r => ({ ...r, counts: JSON.parse(r.counts) }));
}

module.exports = {
  init, listPlayers, normalizeQuery, getTestMark, markTestAccount, unmarkTestAccount,
  previewDelete, deleteTestAccount, listDeletions, PlayerAdminError, CONFIRM_WORD, PER_PAGE,
};
