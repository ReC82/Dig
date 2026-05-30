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
  `);

  // Migration : ajout de la colonne email si elle n'existait pas encore
  try { _db.prepare('ALTER TABLE users ADD COLUMN email TEXT').run(); } catch (_) {}

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
 * Crée un compte utilisateur.
 * @param   {string} username     Doit être en minuscules
 * @param   {string} email        Adresse e-mail unique
 * @param   {string} passwordHash Hash bcrypt du mot de passe
 * @returns {{ id, username, email, created_at }}
 */
function createUser(username, email, passwordHash) {
  const db   = getDb();
  const info = db.prepare(
    'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
  ).run(username, email, passwordHash);
  return db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?')
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
 * @returns {{ id, username, email, created_at } | undefined}
 */
function getUserById(id) {
  return getDb()
    .prepare('SELECT id, username, email, created_at FROM users WHERE id = ?')
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

module.exports = {
  initDb, getDb,
  upsertPlayer, getSave, upsertSave, deleteSave, logEvent,
  createUser, getUserByUsername, getUserById, getUserByEmail,
  getUserSave, upsertUserSave,
};
