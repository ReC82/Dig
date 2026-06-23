/**
 * server/db.js
 * Couche d'accès SQLite via better-sqlite3 (API synchrone).
 *
 * Utilisation :
 *   const { initDb, upsertPlayer, getSave, upsertSave, deleteSave, logEvent,
 *           createUser, getUserByUsername, getUserById } = require('./db');
 *   initDb();   // à appeler une seule fois au démarrage
 *
 * Tables :
 *   players      — identité d'un joueur anonyme (token UUID)
 *   player_saves — dernière sauvegarde par joueur (JSON du GameState)
 *   save_events  — journal léger des opérations (save / load / reset)
 *   users        — comptes joueurs avec mot de passe hashé (bcrypt)
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, process.env.DB_FILE || 'dig.sqlite');

/** Instance unique — initialisée par initDb(). */
let _db = null;

// ── Initialisation ───────────────────────────────────────────────────────────

/**
 * Crée server/data/ si absent, ouvre (ou crée) la base SQLite,
 * configure les pragmas et crée les tables si elles n'existent pas encore.
 * Doit être appelée une seule fois avant toute autre fonction de ce module.
 */
function initDb() {
  // Crée server/data/ si nécessaire
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[db] Dossier créé : ${DATA_DIR}`);
  }

  _db = new Database(DB_PATH);

  // Clés étrangères activées + WAL (lectures concurrentes, écritures atomiques)
  _db.pragma('foreign_keys = ON');
  _db.pragma('journal_mode  = WAL');

  _db.exec(`
    -- ── Joueurs ──────────────────────────────────────────────────────────────
    -- Un joueur est identifié par un token UUID v4 généré côté client.
    CREATE TABLE IF NOT EXISTS players (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      token      TEXT    NOT NULL UNIQUE,           -- UUID v4 fourni par le client
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      last_seen  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Sauvegardes ──────────────────────────────────────────────────────────
    -- Une seule ligne par joueur (UNIQUE sur player_id).
    -- data = JSON stringify du save (même format que localStorage).
    CREATE TABLE IF NOT EXISTS player_saves (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  INTEGER NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
      data       TEXT    NOT NULL,                  -- JSON complet du GameState
      version    INTEGER NOT NULL DEFAULT 1,        -- incrémenté à chaque écriture
      saved_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Journal d'événements ─────────────────────────────────────────────────
    -- Trace légère des opérations pour débogage et sécurité.
    CREATE TABLE IF NOT EXISTS save_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      event_type TEXT    NOT NULL CHECK(event_type IN ('save', 'load', 'reset')),
      metadata   TEXT,                              -- JSON optionnel (version, IP…)
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Index : requêtes fréquentes par joueur + ordre chronologique
    CREATE INDEX IF NOT EXISTS idx_save_events_player
      ON save_events (player_id, created_at DESC);

    -- ── Comptes joueurs ──────────────────────────────────────────────────────
    -- username stocké en minuscules pour une comparaison insensible à la casse.
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,   -- toujours en minuscules
      email         TEXT    UNIQUE,            -- nullable pour migration
      password_hash TEXT    NOT NULL,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Sauvegardes liées au compte ──────────────────────────────────────────
    -- Sauvegarde cloud associée à un compte utilisateur (1 par compte).
    CREATE TABLE IF NOT EXISTS user_saves (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      data      TEXT    NOT NULL,
      version   INTEGER NOT NULL DEFAULT 1,
      saved_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Saisons compétitives ─────────────────────────────────────────────────
    -- status : active | closed | archived | scheduled
    -- closed_at : horodatage de clôture effective
    CREATE TABLE IF NOT EXISTS seasons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      start_at   TEXT    NOT NULL,
      end_at     TEXT    NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'active'
                   CHECK(status IN ('scheduled','active','closed','archived')),
      config     TEXT,
      closed_at  TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Ligues ───────────────────────────────────────────────────────────────
    -- level      : indice numérique (0 = Mimosa = ligue la plus basse)
    -- rank_min/max : fourchette de rangs du classement global associés à cette ligue
    -- sort_order : ordre d'affichage
    CREATE TABLE IF NOT EXISTS leagues (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      icon       TEXT    NOT NULL DEFAULT '🏅',
      level      INTEGER NOT NULL DEFAULT 0,
      rank_min   INTEGER NOT NULL,
      rank_max   INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Classement saisonnier ────────────────────────────────────────────────
    -- Un enregistrement par joueur par saison.
    -- manual_blocks_broken : blocs détruits par clic humain (hors autodig)
    -- auto_blocks_broken   : blocs détruits par l'autodig
    -- manual_clicks        : total de clics sur le bloc (y compris sans destruction)
    -- suspicious_score     : cumul de clics détectés comme suspects (anti-autoclicker)
    -- league_id            : ligue du joueur au moment de la compétition
    CREATE TABLE IF NOT EXISTS season_rankings (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id            INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      user_id              INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
      league_id            INTEGER REFERENCES leagues(id),
      max_depth            INTEGER NOT NULL DEFAULT 0,
      manual_blocks        INTEGER NOT NULL DEFAULT 0,
      auto_blocks          INTEGER NOT NULL DEFAULT 0,
      manual_clicks        INTEGER NOT NULL DEFAULT 0,
      suspicious_score     INTEGER NOT NULL DEFAULT 0,
      is_active            INTEGER NOT NULL DEFAULT 0,
      created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(season_id, user_id)
    );
    -- Classement global (trié par depth, manual_blocks)
    CREATE INDEX IF NOT EXISTS idx_rankings ON season_rankings
      (season_id, max_depth DESC, manual_blocks DESC);
    -- Filtre par ligue pour le classement intraligue
    CREATE INDEX IF NOT EXISTS idx_rankings_league ON season_rankings
      (season_id, league_id, is_active);
    -- Filtre is_active pour le classement global filtré
    CREATE INDEX IF NOT EXISTS idx_rankings_active ON season_rankings
      (season_id, is_active);

    -- ── Config admin (clé-valeur) ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS admin_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Suivi de clics par joueur (anti-autoclicker) ─────────────────────────
    -- Une ligne par joueur ; réinitialisée automatiquement au changement de saison.
    CREATE TABLE IF NOT EXISTS player_click_tracking (
      user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      season_id           INTEGER,
      last_manual_clicks  INTEGER NOT NULL DEFAULT 0,
      last_blocks         INTEGER NOT NULL DEFAULT 0,
      last_save_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      accepted_blocks     INTEGER NOT NULL DEFAULT 0
    );

    -- ── Journal des événements anti-autoclicker ──────────────────────────────
    CREATE TABLE IF NOT EXISTS anticheat_logs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username         TEXT    NOT NULL DEFAULT '',
      season_id        INTEGER,
      logged_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      period_seconds   REAL    NOT NULL DEFAULT 0,
      period_clicks    INTEGER NOT NULL DEFAULT 0,
      inferred_cps     REAL    NOT NULL DEFAULT 0,
      regularity_score REAL    NOT NULL DEFAULT 0,
      effective_ratio  REAL    NOT NULL DEFAULT 1,
      action_taken     TEXT    NOT NULL DEFAULT 'none'
    );
    CREATE INDEX IF NOT EXISTS idx_anticheat_user ON anticheat_logs (user_id, logged_at DESC);
    CREATE INDEX IF NOT EXISTS idx_anticheat_action ON anticheat_logs (action_taken, logged_at DESC);
  `);

  // ── Migrations sur tables existantes ─────────────────────────────────────

  // users : email (migration ancienne)
  try { _db.prepare('ALTER TABLE users ADD COLUMN email TEXT').run(); } catch (_) {}

  // users : league_id (ligue actuelle du joueur)
  try { _db.prepare('ALTER TABLE users ADD COLUMN league_id INTEGER REFERENCES leagues(id)').run();
        console.log('[db] Migration : users.league_id ajouté'); } catch (_) {}

  // ── Migration seasons : recréation pour changer le CHECK constraint ────────
  // (SQLite ne permet pas ALTER TABLE pour modifier un CHECK)
  {
    const cols = _db.prepare("PRAGMA table_info(seasons)").all().map(r => r.name);
    if (!cols.includes('closed_at')) {
      // Désactiver les FK le temps de la migration pour éviter les cascades
      _db.pragma('foreign_keys = OFF');
      _db.exec(`
        CREATE TABLE seasons_v2 (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          name       TEXT    NOT NULL,
          start_at   TEXT    NOT NULL,
          end_at     TEXT    NOT NULL,
          status     TEXT    NOT NULL DEFAULT 'active'
                       CHECK(status IN ('scheduled','active','closed','archived')),
          config     TEXT,
          closed_at  TEXT,
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO seasons_v2 (id, name, start_at, end_at, status, config, created_at)
          SELECT id, name, start_at, end_at,
                 CASE status WHEN 'ended' THEN 'closed' ELSE status END,
                 config, created_at
          FROM seasons;
        DROP TABLE seasons;
        ALTER TABLE seasons_v2 RENAME TO seasons;
      `);
      _db.pragma('foreign_keys = ON');
      console.log('[db] Migration : table seasons recréée (+ closed_at, statuts mis à jour)');
    }
  }

  // leagues : level (indice numérique de ligue, 0 = plus basse)
  try { _db.prepare('ALTER TABLE leagues ADD COLUMN level INTEGER NOT NULL DEFAULT 0').run();
        console.log('[db] Migration : leagues.level ajouté'); } catch (_) {}

  // season_rankings : nouvelles colonnes de stats détaillées
  const rankingCols = _db.prepare("PRAGMA table_info(season_rankings)").all().map(r => r.name);
  if (!rankingCols.includes('league_id')) {
    try { _db.prepare('ALTER TABLE season_rankings ADD COLUMN league_id INTEGER REFERENCES leagues(id)').run(); } catch (_) {}
    try { _db.prepare('ALTER TABLE season_rankings ADD COLUMN auto_blocks INTEGER NOT NULL DEFAULT 0').run(); } catch (_) {}
    try { _db.prepare('ALTER TABLE season_rankings ADD COLUMN manual_clicks INTEGER NOT NULL DEFAULT 0').run(); } catch (_) {}
    try { _db.prepare('ALTER TABLE season_rankings ADD COLUMN suspicious_score INTEGER NOT NULL DEFAULT 0').run(); } catch (_) {}
    try { _db.prepare("ALTER TABLE season_rankings ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))").run(); } catch (_) {}
    console.log('[db] Migration : season_rankings — colonnes stats ajoutées');
  }

  // season_rankings : effective_manual_blocks (blocs validés côté serveur par l'anti-autoclicker)
  if (!rankingCols.includes('effective_manual_blocks')) {
    _db.prepare('ALTER TABLE season_rankings ADD COLUMN effective_manual_blocks INTEGER NOT NULL DEFAULT 0').run();
    // Initialise à manual_blocks pour les données existantes (rétrocompat)
    _db.prepare('UPDATE season_rankings SET effective_manual_blocks = manual_blocks WHERE manual_blocks > 0').run();
    console.log('[db] Migration : season_rankings.effective_manual_blocks ajouté (initialisé depuis manual_blocks)');
  }

  // ── Seeds config ──────────────────────────────────────────────────────────
  const cfgStmt = _db.prepare(
    `INSERT INTO admin_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`
  );
  // Config existante (inchangée si déjà présente)
  cfgStmt.run('gems_cap',        '100');
  cfgStmt.run('cps_limit',       '8');      // alias de max_effective_cps (rétrocompat)
  cfgStmt.run('season_duration', '7');
  // Nouveaux paramètres saisonniers
  cfgStmt.run('max_effective_cps',            '8');
  cfgStmt.run('promotion_rate',               '0.50');
  cfgStmt.run('difficulty_coefficient',       '0.45');
  cfgStmt.run('min_active_players_per_league','10');
  cfgStmt.run('anti_autoclick_enabled',       'true');
  // Économie — multiplicateurs globaux (informations + appliqués par chestShop)
  cfgStmt.run('upgrade_cost_multiplier',  '1.0');   // ×coût des upgrades saisonniers
  cfgStmt.run('coin_gain_multiplier',     '1.0');   // ×gains de pièces (blocs)
  cfgStmt.run('fragment_drop_multiplier', '1.0');   // ×fragments dans les coffres shop
  // Coûts des coffres achetables (surchargent chestShop.js si présents)
  cfgStmt.run('chest_cost_simple',  '2000');
  cfgStmt.run('chest_cost_rare',    '15000');
  cfgStmt.run('chest_cost_antique', '80000');

  // ── Seed : ligue Mimosa ───────────────────────────────────────────────────
  const leagueCount = _db.prepare('SELECT COUNT(*) AS n FROM leagues').get().n;
  if (leagueCount === 0) {
    _db.prepare(
      `INSERT INTO leagues (name, icon, level, rank_min, rank_max, sort_order) VALUES (?,?,?,?,?,?)`
    ).run('Mimosa', '🌼', 0, 1, 10, 0);
  }

  // ── Seed : saison active ──────────────────────────────────────────────────
  const activeSeason = _db.prepare(`SELECT id FROM seasons WHERE status='active' LIMIT 1`).get();
  if (!activeSeason) {
    const now   = new Date();
    const day   = now.getUTCDay();
    const diffToMonday = (day === 0 ? -6 : 1 - day);
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMonday));
    const sunday = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000);
    const fmt = d => d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    const weekNum = Math.ceil((monday.getUTCDate() + new Date(Date.UTC(monday.getUTCFullYear(), 0, 1)).getUTCDay()) / 7);
    _db.prepare(
      `INSERT INTO seasons (name, start_at, end_at, status) VALUES (?,?,?,'active')`
    ).run(`Saison ${weekNum}-${monday.getUTCFullYear()}`, fmt(monday), fmt(sunday));
  }

  // ── Migration : assigner la ligue Mimosa aux joueurs sans ligue ───────────
  const mimosa = _db.prepare(`SELECT id FROM leagues ORDER BY level ASC, sort_order ASC LIMIT 1`).get();
  if (mimosa) {
    const updated = _db.prepare(`UPDATE users SET league_id = ? WHERE league_id IS NULL`).run(mimosa.id);
    if (updated.changes > 0) console.log(`[db] Migration : ${updated.changes} joueur(s) assignés à la ligue par défaut`);
  }

  console.log(`[db] Base prête : ${DB_PATH}`);
}

// ── Accesseur ────────────────────────────────────────────────────────────────

/** Retourne l'instance active. Lance une erreur si initDb() n'a pas été appelé. */
function getDb() {
  if (!_db) throw new Error('[db] Base non initialisée — appeler initDb() en premier.');
  return _db;
}

// ── Helpers joueurs ──────────────────────────────────────────────────────────

/**
 * Crée le joueur s'il n'existe pas, ou met à jour last_seen s'il existe déjà.
 * @param   {string} token  UUID v4
 * @returns {{ id, token, created_at, last_seen }}
 */
function upsertPlayer(token) {
  const db = getDb();

  db.prepare(`
    INSERT INTO players (token)
    VALUES (?)
    ON CONFLICT(token) DO UPDATE SET last_seen = datetime('now')
  `).run(token);

  return db.prepare('SELECT * FROM players WHERE token = ?').get(token);
}

// ── Helpers sauvegardes ──────────────────────────────────────────────────────

/**
 * Retourne la sauvegarde d'un joueur, ou null si elle n'existe pas.
 * @param   {number} playerId
 * @returns {{ id, player_id, data, version, saved_at } | null}
 */
function getSave(playerId) {
  return getDb()
    .prepare('SELECT * FROM player_saves WHERE player_id = ?')
    .get(playerId) ?? null;
}

/**
 * Crée ou écrase la sauvegarde d'un joueur.
 * Incrémente automatiquement le numéro de version.
 * @param   {number} playerId
 * @param   {string} dataJson  JSON stringify du GameState
 * @returns {{ version: number }}
 */
function upsertSave(playerId, dataJson) {
  const db      = getDb();
  const current = getSave(playerId);
  const version = current ? current.version + 1 : 1;

  db.prepare(`
    INSERT INTO player_saves (player_id, data, version, saved_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(player_id) DO UPDATE SET
      data     = excluded.data,
      version  = excluded.version,
      saved_at = excluded.saved_at
  `).run(playerId, dataJson, version);

  return { version };
}

/**
 * Supprime la sauvegarde d'un joueur (reset côté serveur).
 * @param {number} playerId
 */
function deleteSave(playerId) {
  getDb()
    .prepare('DELETE FROM player_saves WHERE player_id = ?')
    .run(playerId);
}

// ── Helpers événements ────────────────────────────────────────────────────────

/**
 * Enregistre un événement dans le journal.
 * @param {number}            playerId
 * @param {'save'|'load'|'reset'} eventType
 * @param {object|null}       [metadata]  Données sérialisées en JSON (facultatif)
 */
function logEvent(playerId, eventType, metadata = null) {
  getDb()
    .prepare('INSERT INTO save_events (player_id, event_type, metadata) VALUES (?, ?, ?)')
    .run(playerId, eventType, metadata ? JSON.stringify(metadata) : null);
}

// ── Helpers comptes utilisateurs ─────────────────────────────────────────────

/**
 * Crée un compte utilisateur, assigné automatiquement à la ligue la plus basse.
 * @param   {string} username     Doit être en minuscules
 * @param   {string} email        Adresse e-mail unique
 * @param   {string} passwordHash Hash bcrypt du mot de passe
 * @returns {{ id, username, email, league_id, created_at }}
 */
function createUser(username, email, passwordHash) {
  const db = getDb();
  const lowestLeague = db.prepare(
    `SELECT id FROM leagues ORDER BY level ASC, sort_order ASC LIMIT 1`
  ).get();
  const leagueId = lowestLeague ? lowestLeague.id : null;
  const info = db.prepare(
    'INSERT INTO users (username, email, password_hash, league_id) VALUES (?, ?, ?, ?)'
  ).run(username, email, passwordHash, leagueId);
  return db.prepare('SELECT id, username, email, league_id, created_at FROM users WHERE id = ?')
    .get(info.lastInsertRowid);
}

/**
 * Retourne un utilisateur par nom (avec password_hash pour vérification).
 * @param   {string} username
 * @returns {{ id, username, password_hash, created_at } | undefined}
 */
function getUserByUsername(username) {
  return getDb()
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(username);
}

/**
 * Retourne un utilisateur par id (sans password_hash).
 * @param   {number} id
 * @returns {{ id, username, email, league_id, created_at } | undefined}
 */
function getUserById(id) {
  return getDb()
    .prepare('SELECT id, username, email, league_id, created_at FROM users WHERE id = ?')
    .get(id);
}

/**
 * Retourne un utilisateur par adresse e-mail.
 * @param   {string} email
 * @returns {{ id, username, email, created_at } | undefined}
 */
function getUserByEmail(email) {
  return getDb()
    .prepare('SELECT id, username, email, created_at FROM users WHERE email = ?')
    .get(email);
}

// ── Helpers sauvegardes cloud (liées au compte) ───────────────────────────────

/**
 * Retourne la sauvegarde cloud d'un utilisateur, ou null si absente.
 * @param   {number} userId
 * @returns {{ id, user_id, data, version, saved_at } | null}
 */
function getUserSave(userId) {
  return getDb()
    .prepare('SELECT * FROM user_saves WHERE user_id = ?')
    .get(userId) ?? null;
}

/**
 * Crée ou écrase la sauvegarde cloud d'un utilisateur.
 * @param   {number} userId
 * @param   {string} dataJson  JSON stringify du GameState
 * @returns {{ version: number }}
 */
function upsertUserSave(userId, dataJson) {
  const db      = getDb();
  const current = getUserSave(userId);
  const version = current ? current.version + 1 : 1;

  db.prepare(`
    INSERT INTO user_saves (user_id, data, version, saved_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      data     = excluded.data,
      version  = excluded.version,
      saved_at = excluded.saved_at
  `).run(userId, dataJson, version);

  return { version };
}

// ── Helpers saisons ───────────────────────────────────────────────────────────

function getActiveSeason() {
  return getDb().prepare(`SELECT * FROM seasons WHERE status='active' ORDER BY id DESC LIMIT 1`).get() ?? null;
}

function getSeasonById(id) {
  return getDb().prepare(`SELECT * FROM seasons WHERE id = ?`).get(id) ?? null;
}

function createSeason(name, startAt, endAt) {
  const db = getDb();
  const info = db.prepare(
    `INSERT INTO seasons (name, start_at, end_at, status) VALUES (?,?,?,'active')`
  ).run(name, startAt, endAt);
  return db.prepare(`SELECT * FROM seasons WHERE id = ?`).get(info.lastInsertRowid);
}

function updateSeason(id, fields) {
  const db     = getDb();
  const keys   = Object.keys(fields);
  const setStr = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE seasons SET ${setStr} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
  return db.prepare(`SELECT * FROM seasons WHERE id = ?`).get(id);
}

function getAllSeasons() {
  return getDb().prepare(`SELECT * FROM seasons ORDER BY id DESC`).all();
}

// ── Helpers ligues ────────────────────────────────────────────────────────────

function getAllLeagues() {
  return getDb().prepare(`SELECT * FROM leagues ORDER BY sort_order, rank_min`).all();
}

function createLeague(name, icon, level, rankMin, rankMax, sortOrder) {
  const db   = getDb();
  const info = db.prepare(
    `INSERT INTO leagues (name, icon, level, rank_min, rank_max, sort_order) VALUES (?,?,?,?,?,?)`
  ).run(name, icon, level ?? 0, rankMin, rankMax ?? null, sortOrder ?? 0);
  return db.prepare(`SELECT * FROM leagues WHERE id = ?`).get(info.lastInsertRowid);
}

function updateLeague(id, fields) {
  const db     = getDb();
  const keys   = Object.keys(fields);
  const setStr = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE leagues SET ${setStr} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
  return db.prepare(`SELECT * FROM leagues WHERE id = ?`).get(id);
}

function deleteLeague(id) {
  return getDb().prepare(`DELETE FROM leagues WHERE id = ?`).run(id);
}

function getLeagueForRank(rank) {
  return getDb().prepare(
    `SELECT * FROM leagues WHERE rank_min <= ? AND (rank_max IS NULL OR rank_max >= ?)
     ORDER BY sort_order, rank_min LIMIT 1`
  ).get(rank, rank) ?? null;
}

// ── Helpers classement saisonnier ─────────────────────────────────────────────

/**
 * Upsert les statistiques MANUELLES du joueur.
 * NE touche pas auto_blocks (géré séparément par updateAutoBlocksOnly).
 * Marque le joueur actif (is_active = 1) → il entre dans le classement.
 */
function upsertSeasonRanking(seasonId, userId, maxDepth, manualBlocks, _unused, manualClicks, suspiciousScore, leagueId) {
  getDb().prepare(`
    INSERT INTO season_rankings
      (season_id, user_id, league_id, max_depth, manual_blocks, manual_clicks, suspicious_score, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      league_id        = COALESCE(excluded.league_id, league_id),
      max_depth        = MAX(max_depth, excluded.max_depth),
      manual_blocks    = MAX(manual_blocks, excluded.manual_blocks),
      manual_clicks    = MAX(manual_clicks, excluded.manual_clicks),
      suspicious_score = MAX(suspicious_score, excluded.suspicious_score),
      is_active        = 1,
      updated_at       = excluded.updated_at
  `).run(seasonId, userId, leagueId ?? null, maxDepth, manualBlocks, manualClicks ?? 0, suspiciousScore ?? 0);
}

function getLowestLeague() {
  return getDb().prepare(
    `SELECT * FROM leagues ORDER BY level ASC, sort_order ASC LIMIT 1`
  ).get() ?? null;
}

function getLeagueById(id) {
  return getDb().prepare(`SELECT * FROM leagues WHERE id = ?`).get(id) ?? null;
}

function getUserLeague(userId) {
  return getDb().prepare(`
    SELECT l.* FROM users u
    LEFT JOIN leagues l ON l.id = u.league_id
    WHERE u.id = ?
  `).get(userId) ?? null;
}

function setUserLeague(userId, leagueId) {
  getDb().prepare(`UPDATE users SET league_id = ? WHERE id = ?`).run(leagueId, userId);
}

/**
 * Classement global d'une saison (paginé).
 * Tri : max_depth DESC, effective_manual_blocks DESC (blocs validés anti-cheat).
 * auto_blocks jamais utilisé pour le tri.
 */
function getSeasonLeaderboard(seasonId, limit = 50, offset = 0) {
  return getDb().prepare(`
    SELECT u.id       AS user_id,
           u.username,
           r.league_id,
           r.max_depth,
           r.manual_blocks,
           r.effective_manual_blocks,
           r.auto_blocks,
           ROW_NUMBER() OVER (ORDER BY r.max_depth DESC, r.effective_manual_blocks DESC) AS rank
    FROM season_rankings r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id   = ?
      AND r.is_active    = 1
      AND r.manual_blocks > 0
    ORDER BY r.max_depth DESC, r.effective_manual_blocks DESC
    LIMIT ? OFFSET ?
  `).all(seasonId, limit, offset);
}

/** Nombre total de joueurs actifs dans une saison (pour la pagination). */
function countSeasonActivePlayers(seasonId) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM season_rankings
    WHERE season_id = ? AND is_active = 1 AND manual_blocks > 0
  `).get(seasonId);
  return row ? row.n : 0;
}

/** Rang global d'un joueur dans la saison (basé sur effective_manual_blocks). */
function getPlayerSeasonRank(seasonId, userId) {
  return getDb().prepare(`
    SELECT rank_global FROM (
      SELECT user_id,
             ROW_NUMBER() OVER (ORDER BY max_depth DESC, effective_manual_blocks DESC) AS rank_global
      FROM season_rankings
      WHERE season_id = ? AND is_active = 1 AND manual_blocks > 0
    ) WHERE user_id = ?
  `).get(seasonId, userId) ?? null;
}

/**
 * Classement intraligue d'une saison (paginé).
 * Tri : max_depth DESC, effective_manual_blocks DESC — auto_blocks ignoré.
 */
function getLeagueLeaderboard(seasonId, leagueId, limit = 50, offset = 0) {
  return getDb().prepare(`
    SELECT u.id       AS user_id,
           u.username,
           r.league_id,
           r.max_depth,
           r.manual_blocks,
           r.effective_manual_blocks,
           r.auto_blocks,
           ROW_NUMBER() OVER (ORDER BY r.max_depth DESC, r.effective_manual_blocks DESC) AS rank_in_league
    FROM season_rankings r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id   = ?
      AND r.league_id   = ?
      AND r.is_active   = 1
      AND r.manual_blocks > 0
    ORDER BY r.max_depth DESC, r.effective_manual_blocks DESC
    LIMIT ? OFFSET ?
  `).all(seasonId, leagueId, limit, offset);
}

/** Nombre de joueurs actifs dans une ligue pour cette saison (pour la pagination). */
function countLeaguePlayers(seasonId, leagueId) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM season_rankings
    WHERE season_id = ? AND league_id = ? AND is_active = 1 AND manual_blocks > 0
  `).get(seasonId, leagueId);
  return row ? row.n : 0;
}

/**
 * Retourne TOUS les joueurs actifs d'une ligue (sans pagination).
 * Utilisé pour le calcul de promotion. Tri par effective_manual_blocks (blocs validés).
 */
function getAllActivePlayersInLeague(seasonId, leagueId) {
  return getDb().prepare(`
    SELECT u.id AS user_id, u.username, r.max_depth, r.manual_blocks, r.effective_manual_blocks, r.auto_blocks
    FROM season_rankings r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id   = ?
      AND r.league_id   = ?
      AND r.is_active   = 1
      AND r.manual_blocks > 0
    ORDER BY r.max_depth DESC, r.effective_manual_blocks DESC
  `).all(seasonId, leagueId);
}

/** Retourne la ligue du niveau donné (pour l'auto-création). */
function getLeagueByLevel(level) {
  return getDb().prepare(`SELECT * FROM leagues WHERE level = ? ORDER BY id ASC LIMIT 1`).get(level) ?? null;
}

/** Retourne la ligue la plus haute (pour créer la suivante au-dessus). */
function getHighestLeague() {
  return getDb().prepare(`SELECT * FROM leagues ORDER BY level DESC LIMIT 1`).get() ?? null;
}

/** Rang d'un joueur dans sa ligue pour cette saison (basé sur effective_manual_blocks). */
function getPlayerLeagueRank(seasonId, userId, leagueId) {
  const row = getDb().prepare(`
    SELECT rank_in_league FROM (
      SELECT user_id,
             ROW_NUMBER() OVER (ORDER BY max_depth DESC, effective_manual_blocks DESC) AS rank_in_league
      FROM season_rankings
      WHERE season_id   = ?
        AND league_id   = ?
        AND is_active   = 1
        AND manual_blocks > 0
    ) WHERE user_id = ?
  `).get(seasonId, leagueId, userId);
  return row ? row.rank_in_league : null;
}

function getPlayerSeasonEntry(seasonId, userId) {
  return getDb().prepare(
    `SELECT * FROM season_rankings WHERE season_id = ? AND user_id = ?`
  ).get(seasonId, userId) ?? null;
}

/**
 * Retourne l'entrée de classement du joueur pour cette saison, en la créant
 * (inactive) si elle n'existe pas encore.
 */
function getOrCreateSeasonEntry(seasonId, userId, leagueId) {
  const existing = getPlayerSeasonEntry(seasonId, userId);
  if (existing) return existing;
  getDb().prepare(`
    INSERT OR IGNORE INTO season_rankings
      (season_id, user_id, league_id, max_depth, manual_blocks, auto_blocks, manual_clicks, suspicious_score, is_active)
    VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
  `).run(seasonId, userId, leagueId ?? null);
  return getPlayerSeasonEntry(seasonId, userId);
}

/**
 * Met à jour UNIQUEMENT auto_blocks — ne touche pas is_active ni les stats manuelles.
 * Utilisé par l'autodig pour éviter toute contamination du classement.
 */
function updateAutoBlocksOnly(seasonId, userId, autoBlocks) {
  getDb().prepare(`
    INSERT INTO season_rankings (season_id, user_id, auto_blocks, is_active, updated_at)
    VALUES (?, ?, ?, 0, datetime('now'))
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      auto_blocks = MAX(auto_blocks, excluded.auto_blocks),
      updated_at  = excluded.updated_at
  `).run(seasonId, userId, autoBlocks);
}

// ── Helpers anti-autoclicker ──────────────────────────────────────────────────

/** Retourne l'entrée de tracking de clics d'un joueur, ou null si absente. */
function getClickTracking(userId) {
  return getDb().prepare('SELECT * FROM player_click_tracking WHERE user_id = ?').get(userId) ?? null;
}

/** Crée ou met à jour le tracking de clics d'un joueur. */
function upsertClickTracking(userId, seasonId, lastClicks, lastBlocks, saveAt, acceptedBlocks) {
  getDb().prepare(`
    INSERT INTO player_click_tracking
      (user_id, season_id, last_manual_clicks, last_blocks, last_save_at, accepted_blocks)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      season_id           = excluded.season_id,
      last_manual_clicks  = excluded.last_manual_clicks,
      last_blocks         = excluded.last_blocks,
      last_save_at        = excluded.last_save_at,
      accepted_blocks     = excluded.accepted_blocks
  `).run(userId, seasonId ?? null, lastClicks, lastBlocks, saveAt, acceptedBlocks);
}

/** Insère un événement dans le journal anti-autoclicker. */
function insertAntiCheatLog(userId, username, seasonId, periodSecs, periodClicks, inferredCps, regularityScore, effectiveRatio, actionTaken) {
  getDb().prepare(`
    INSERT INTO anticheat_logs
      (user_id, username, season_id, period_seconds, period_clicks, inferred_cps, regularity_score, effective_ratio, action_taken)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, username ?? '', seasonId ?? null, periodSecs, periodClicks, inferredCps, regularityScore, effectiveRatio, actionTaken);
}

/** Retourne les derniers événements anti-autoclicker (tri chrono inverse). */
function getAntiCheatLogs(limit = 100, offset = 0) {
  return getDb().prepare(
    `SELECT * FROM anticheat_logs ORDER BY logged_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
}

/** Compte total des événements journalisés. */
function countAntiCheatLogs() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM anticheat_logs').get().n;
}

/** Met à jour le compteur de blocs effectifs (validés serveur) pour une entrée de classement. */
function updateEffectiveBlocks(seasonId, userId, effectiveManualBlocks) {
  getDb().prepare(`
    UPDATE season_rankings SET effective_manual_blocks = ?
    WHERE season_id = ? AND user_id = ?
  `).run(effectiveManualBlocks, seasonId, userId);
}

/**
 * Retourne toutes les ligues avec les compteurs de joueurs pour une saison donnée.
 * total_players  : tous les joueurs actuellement dans cette ligue
 * active_players : joueurs actifs dans le classement de la saison (manual_blocks > 0)
 */
function getAllLeaguesWithStats(seasonId) {
  return getDb().prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM users WHERE league_id = l.id) AS total_players,
      COALESCE(
        (SELECT COUNT(*) FROM season_rankings
         WHERE season_id = ? AND league_id = l.id AND is_active = 1 AND manual_blocks > 0),
        0
      ) AS active_players
    FROM leagues l
    ORDER BY l.sort_order, l.rank_min
  `).all(seasonId);
}

// ── Helpers config admin ──────────────────────────────────────────────────────

function getAdminConfig() {
  const rows = getDb().prepare(`SELECT key, value FROM admin_config`).all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

/**
 * Recherche des utilisateurs par nom (LIKE insensible à la casse).
 * @param {string} q  Chaîne à rechercher (jokers % ajoutés automatiquement)
 * @returns {Array<{id, username, email, league_id, created_at}>}
 */
function searchUsers(q) {
  const pattern = `%${q.toLowerCase().trim()}%`;
  return getDb()
    .prepare('SELECT id, username, email, league_id, created_at FROM users WHERE LOWER(username) LIKE ? LIMIT 20')
    .all(pattern);
}

function setAdminConfig(key, value) {
  getDb().prepare(
    `INSERT INTO admin_config (key, value, updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run(key, String(value));
}

module.exports = {
  initDb, getDb,
  upsertPlayer, getSave, upsertSave, deleteSave, logEvent,
  createUser, getUserByUsername, getUserById, getUserByEmail,
  getUserSave, upsertUserSave,
  getActiveSeason, getSeasonById, createSeason, updateSeason, getAllSeasons,
  getAllLeagues, createLeague, updateLeague, deleteLeague, getLeagueForRank,
  getLowestLeague, getLeagueById, getLeagueByLevel, getHighestLeague,
  getUserLeague, setUserLeague,
  getAllActivePlayersInLeague,
  upsertSeasonRanking,
  getSeasonLeaderboard, countSeasonActivePlayers, getPlayerSeasonRank,
  getLeagueLeaderboard, countLeaguePlayers, getPlayerLeagueRank,
  getPlayerSeasonEntry, getOrCreateSeasonEntry, updateAutoBlocksOnly,
  getAdminConfig, setAdminConfig, searchUsers,
  getAllLeaguesWithStats,
  getClickTracking, upsertClickTracking,
  insertAntiCheatLog, getAntiCheatLogs, countAntiCheatLogs,
  updateEffectiveBlocks,
};
