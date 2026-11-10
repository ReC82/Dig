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
const cal      = require('./seasonCalendar');

const DATA_DIR = path.join(__dirname, 'data');
// DB_FILE : nom relatif à server/data/ (défaut) ou chemin absolu (tests).
const DB_PATH  = path.resolve(DATA_DIR, process.env.DB_FILE || 'dig.sqlite');

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

    -- ── Validation serveur de la profondeur (ticket #9) ──────────────────────
    -- Une ligne par joueur, réinitialisée au changement de saison.
    -- ref_clicks / ref_auto : compteurs client déjà « consommés » (le reste est en attente)
    -- hand_tokens / auto_tokens : seaux de jetons (clics / blocs auto autorisés par le temps)
    -- accepted_depth : profondeur max retenue pour le classement
    -- last_gap : écart déclaré − retenu à la dernière sauvegarde (limite les logs)
    CREATE TABLE IF NOT EXISTS player_depth_tracking (
      user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      season_id      INTEGER,
      ref_clicks     INTEGER NOT NULL DEFAULT 0,
      ref_auto       INTEGER NOT NULL DEFAULT 0,
      hand_tokens    REAL    NOT NULL DEFAULT 0,
      auto_tokens    REAL    NOT NULL DEFAULT 0,
      accepted_depth INTEGER NOT NULL DEFAULT 0,
      last_gap       INTEGER NOT NULL DEFAULT 0,
      updated_ms     INTEGER NOT NULL DEFAULT 0
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

    -- ── Journal d'événements des comptes ─────────────────────────────────────
    -- save_events est réservé à l'API anonyme (players) et limite event_type :
    -- les actions liées à un compte (achat de coffre, reset admin…) sont tracées ici.
    CREATE TABLE IF NOT EXISTS user_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT    NOT NULL,
      metadata   TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_events_user ON user_events (user_id, created_at DESC);
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

  // season_rankings : reported_max_depth (profondeur déclarée par le client, audit — ticket #9)
  // max_depth devient la profondeur validée côté serveur.
  if (!rankingCols.includes('reported_max_depth')) {
    _db.prepare('ALTER TABLE season_rankings ADD COLUMN reported_max_depth INTEGER NOT NULL DEFAULT 0').run();
    _db.prepare('UPDATE season_rankings SET reported_max_depth = max_depth').run();
    console.log('[db] Migration : season_rankings.reported_max_depth ajouté (initialisé depuis max_depth)');
  }

  // Index de l'ancien tri à la profondeur (#19), conservés (aucune suppression) ; le tri aux
  // blocs manuels validés (#73) a ses propres index, plus bas.
  // Ajout seul, idempotent.
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rankings_sort ON season_rankings
      (season_id, max_depth DESC, effective_manual_blocks DESC, user_id);
    CREATE INDEX IF NOT EXISTS idx_rankings_league_sort ON season_rankings
      (season_id, league_id, max_depth DESC, effective_manual_blocks DESC, user_id);
  `);

  // anticheat_logs : details (JSON libre — profondeur déclarée/retenue, correction admin…)
  {
    const acCols = _db.prepare('PRAGMA table_info(anticheat_logs)').all().map(r => r.name);
    if (!acCols.includes('details')) {
      _db.prepare('ALTER TABLE anticheat_logs ADD COLUMN details TEXT').run();
      console.log('[db] Migration : anticheat_logs.details ajouté');
    }
  }

  // users : e-mail vérifié et version d'authentification (#28). Ajouts seuls, idempotents :
  // les comptes existants gardent leurs identifiants, leur e-mail (non vérifié) et leurs sessions
  // (auth_version 0 = valeur implicite des sessions ouvertes avant #28).
  {
    const userCols = _db.prepare('PRAGMA table_info(users)').all().map(r => r.name);
    if (!userCols.includes('email_verified_at')) {
      _db.prepare('ALTER TABLE users ADD COLUMN email_verified_at TEXT').run();
      console.log('[db] Migration : users.email_verified_at ajouté');
    }
    if (!userCols.includes('auth_version')) {
      _db.prepare('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0').run();
      console.log('[db] Migration : users.auth_version ajouté');
    }
  }

  // Jetons à usage unique envoyés par e-mail (#28) : seul leur hachage SHA-256 est stocké.
  //   verify_email   : confirme `email` (adresse actuelle ou nouvelle adresse demandée)
  //   reset_password : autorise un nouveau mot de passe
  _db.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose    TEXT    NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
      token_hash TEXT    NOT NULL UNIQUE,
      email      TEXT    NOT NULL,
      expires_at TEXT    NOT NULL,
      used_at    TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id, purpose, created_at DESC);
  `);

  // Identités sociales liées à un compte (#28, connexion Google via Auth0). Ajout seul : la table
  // reste vide tant que SOCIAL_LOGIN=off. Une identité appartient à un seul compte, un compte a au
  // plus une identité par fournisseur ; `subject` = « sub » Auth0 (contient l'identifiant Google).
  _db.exec(`
    CREATE TABLE IF NOT EXISTS user_identities (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider       TEXT    NOT NULL,
      subject        TEXT    NOT NULL,
      email          TEXT,
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      last_login_at  TEXT,
      UNIQUE (provider, subject),
      UNIQUE (user_id, provider)
    );
  `);

  // ── Anti-bot (#25) : ajouts seuls, idempotents ──────────────────────────────
  // Budget de dégâts (lot B) sur la ligne de validation de profondeur existante (#9) :
  //   dmg_depth  : profondeur couverte par le budget (NULL = ligne antérieure à #25 → reprise
  //                à la profondeur retenue, sans crédit ni pénalité)
  //   dmg_credit : PV de dégâts possibles non encore dépensés
  //   dmg_ref_clicks : clics déjà crédités au budget (le reste est en attente)
  //   dmg_gap    : écart déclaré − budget à la dernière sauvegarde (limite les journaux)
  {
    const dtCols = _db.prepare('PRAGMA table_info(player_depth_tracking)').all().map(r => r.name);
    if (!dtCols.includes('dmg_depth')) {
      _db.prepare('ALTER TABLE player_depth_tracking ADD COLUMN dmg_depth INTEGER').run();
      console.log('[db] Migration : player_depth_tracking.dmg_depth ajouté');
    }
    if (!dtCols.includes('dmg_credit')) {
      _db.prepare('ALTER TABLE player_depth_tracking ADD COLUMN dmg_credit REAL').run();
      console.log('[db] Migration : player_depth_tracking.dmg_credit ajouté');
    }
    if (!dtCols.includes('dmg_ref_clicks')) {
      _db.prepare('ALTER TABLE player_depth_tracking ADD COLUMN dmg_ref_clicks INTEGER').run();
      console.log('[db] Migration : player_depth_tracking.dmg_ref_clicks ajouté');
    }
    if (!dtCols.includes('dmg_gap')) {
      _db.prepare('ALTER TABLE player_depth_tracking ADD COLUMN dmg_gap INTEGER NOT NULL DEFAULT 0').run();
      console.log('[db] Migration : player_depth_tracking.dmg_gap ajouté');
    }
    // PV réels (#77) : état JSON du budget recalculé bloc par bloc (graine épinglée, n° de bloc,
    // crédit…). NULL = ligne antérieure à #77 → reprise à la profondeur retenue, sans crédit.
    if (!dtCols.includes('xhp_state')) {
      _db.prepare('ALTER TABLE player_depth_tracking ADD COLUMN xhp_state TEXT').run();
      console.log('[db] Migration : player_depth_tracking.xhp_state ajouté');
    }
  }
  // Classement saisonnier figé (#29). Ajouts seuls, idempotents.
  // max_depth_reached_at : instant (UTC, ms) où la profondeur max retenue a été atteinte —
  // départage « premier arrivé ». Lignes existantes : NULL, classées après à égalité.
  const rankCols29 = _db.prepare("PRAGMA table_info(season_rankings)").all().map(r => r.name);
  if (!rankCols29.includes('max_depth_reached_at')) {
    _db.prepare('ALTER TABLE season_rankings ADD COLUMN max_depth_reached_at TEXT').run();
    console.log('[db] Migration : season_rankings.max_depth_reached_at ajouté (#29)');
  }
  // Classement aux blocs manuels validés (#73). Ajouts seuls, idempotents.
  // manual_blocks_reached_at : instant (UTC, ms) où le total de blocs manuels validés a été
  // atteint — départage « premier arrivé ». Lignes existantes : NULL = total atteint avant
  // l'activation de la règle, donc avant toute date enregistrée ensuite.
  if (!rankCols29.includes('manual_blocks_reached_at')) {
    _db.prepare('ALTER TABLE season_rankings ADD COLUMN manual_blocks_reached_at TEXT').run();
    console.log('[db] Migration : season_rankings.manual_blocks_reached_at ajouté (#73)');
  }
  _db.exec(`
    CREATE INDEX IF NOT EXISTS idx_rankings_blocks_sort ON season_rankings
      (season_id, effective_manual_blocks DESC, user_id);
    CREATE INDEX IF NOT EXISTS idx_rankings_league_blocks_sort ON season_rankings
      (season_id, league_id, effective_manual_blocks DESC, user_id);
  `);
  // Instantané immuable du classement à la clôture : une ligne par saison (empreintes chaînées)
  // et une ligne par participant. Aucune clé étrangère : l'instantané survit à un compte supprimé.
  // Les déclencheurs refusent toute modification ou suppression (preuve d'audit).
  _db.exec(`
    CREATE TABLE IF NOT EXISTS season_snapshots (
      seq           INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id     INTEGER NOT NULL UNIQUE,
      created_at    TEXT    NOT NULL,
      source        TEXT    NOT NULL,
      algorithm     TEXT    NOT NULL,
      season_start  TEXT    NOT NULL,
      season_end    TEXT    NOT NULL,
      participants  INTEGER NOT NULL,
      eligible      INTEGER NOT NULL,
      leader_user_id INTEGER,
      prize_mode    TEXT    NOT NULL DEFAULT 'simulation',
      rows_hash     TEXT    NOT NULL,
      prev_hash     TEXT,
      snapshot_hash TEXT    NOT NULL,
      details       TEXT
    );
    CREATE TABLE IF NOT EXISTS season_standings (
      season_id               INTEGER NOT NULL,
      position                INTEGER NOT NULL,
      rank                    INTEGER,
      rank_in_league          INTEGER,
      user_id                 INTEGER NOT NULL,
      league_id               INTEGER,
      max_depth               INTEGER NOT NULL,
      effective_manual_blocks INTEGER NOT NULL,
      manual_blocks           INTEGER NOT NULL,
      max_depth_reached_at    TEXT,
      eligible                INTEGER NOT NULL,
      exclusion_reason        TEXT,
      risk_level              INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (season_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_standings_user ON season_standings (user_id, season_id);
    CREATE TRIGGER IF NOT EXISTS trg_standings_no_update BEFORE UPDATE ON season_standings
      BEGIN SELECT RAISE(ABORT, 'season_standings est immuable (classement figé #29)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_standings_no_delete BEFORE DELETE ON season_standings
      BEGIN SELECT RAISE(ABORT, 'season_standings est immuable (classement figé #29)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_snapshots_no_update BEFORE UPDATE ON season_snapshots
      BEGIN SELECT RAISE(ABORT, 'season_snapshots est immuable (classement figé #29)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_snapshots_no_delete BEFORE DELETE ON season_snapshots
      BEGIN SELECT RAISE(ABORT, 'season_snapshots est immuable (classement figé #29)'); END;
  `);
  // Instantanés « merit-v2 » (#73) : départage figé. Ajout seul (les déclencheurs n'empêchent
  // que UPDATE/DELETE) ; NULL pour les instantanés « merit-v1 », dont l'empreinte ne l'inclut pas.
  if (!_db.prepare('PRAGMA table_info(season_standings)').all().some(c => c.name === 'manual_blocks_reached_at')) {
    _db.prepare('ALTER TABLE season_standings ADD COLUMN manual_blocks_reached_at TEXT').run();
    console.log('[db] Migration : season_standings.manual_blocks_reached_at ajouté (#73)');
  }

  // Concours au mérite (#30) : réglages (une seule ligne), exclusions motivées après la clôture
  // (sans toucher à l'instantané figé), lots attribués et leur suivi, journal d'audit.
  // Ajouts seuls ; aucune clé étrangère vers users : l'historique survit à un compte supprimé.
  // Les journaux sont en ajout seul (déclencheurs) et ne contiennent jamais d'e-mail ni de code.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS contest_settings (
      id                 INTEGER PRIMARY KEY CHECK (id = 1),
      enabled            INTEGER NOT NULL DEFAULT 0,
      title              TEXT    NOT NULL DEFAULT 'Concours hebdomadaire DIG!',
      description        TEXT    NOT NULL DEFAULT '',
      prize_label        TEXT    NOT NULL DEFAULT 'Carte cadeau Amazon',
      prize_provider     TEXT    NOT NULL DEFAULT 'Amazon',
      prize_value_cents  INTEGER NOT NULL DEFAULT 500,
      prize_currency     TEXT    NOT NULL DEFAULT 'EUR',
      prize_stock        INTEGER NOT NULL DEFAULT 0,
      lots_per_season    INTEGER NOT NULL DEFAULT 1,
      starts_at          TEXT,
      ends_at            TEXT,
      min_depth          INTEGER NOT NULL DEFAULT 1,
      max_risk_level     INTEGER,
      cooldown_seasons   INTEGER NOT NULL DEFAULT 0,
      claim_days         INTEGER NOT NULL DEFAULT 30,
      real_eligibility   TEXT    NOT NULL DEFAULT '{}',
      updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO contest_settings (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS contest_exclusions (
      season_id   INTEGER NOT NULL,
      user_id     INTEGER NOT NULL,
      reason      TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (season_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS contest_winners (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id      INTEGER NOT NULL,
      mode           TEXT    NOT NULL CHECK (mode IN ('simulation', 'real')),
      lot_no         INTEGER NOT NULL,
      user_id        INTEGER NOT NULL,
      username       TEXT,
      rank           INTEGER NOT NULL,
      max_depth      INTEGER NOT NULL,
      snapshot_hash  TEXT    NOT NULL,
      prize          TEXT    NOT NULL,
      status         TEXT    NOT NULL DEFAULT 'designated',
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      expires_at     TEXT    NOT NULL,
      UNIQUE (season_id, mode, lot_no),
      UNIQUE (season_id, mode, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_contest_winners_user ON contest_winners (user_id, season_id);
    CREATE TABLE IF NOT EXISTS contest_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      action      TEXT    NOT NULL,
      season_id   INTEGER,
      winner_id   INTEGER,
      from_status TEXT,
      to_status   TEXT,
      details     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_contest_audit_winner ON contest_audit (winner_id, id);
    CREATE TRIGGER IF NOT EXISTS trg_contest_audit_no_update BEFORE UPDATE ON contest_audit
      BEGIN SELECT RAISE(ABORT, 'contest_audit est en ajout seul (#30)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_contest_audit_no_delete BEFORE DELETE ON contest_audit
      BEGIN SELECT RAISE(ABORT, 'contest_audit est en ajout seul (#30)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_contest_winners_no_delete BEFORE DELETE ON contest_winners
      BEGIN SELECT RAISE(ABORT, 'contest_winners : aucune suppression, utiliser le statut expired (#30)'); END;
  `);

  // Points de récompense saisonniers (#33) : réglages (une ligne), barèmes versionnés, registre
  // des mouvements et portefeuilles, attributions par saison. Ajouts seuls ; aucune clé étrangère
  // vers users (l'historique survit à un compte supprimé). Registre, barèmes, attributions et
  // exécutions en ajout seul (déclencheurs) ; solde jamais négatif (CHECK).
  _db.exec(`
    CREATE TABLE IF NOT EXISTS reward_points_settings (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      mode          TEXT    NOT NULL DEFAULT 'simulation' CHECK (mode IN ('simulation', 'live')),
      live_since    TEXT,
      scale_version INTEGER,
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO reward_points_settings (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS reward_points_decisions (
      id          TEXT    PRIMARY KEY,
      applied_at  TEXT    NOT NULL,
      note        TEXT
    );
    CREATE TABLE IF NOT EXISTS reward_point_scales (
      version     INTEGER PRIMARY KEY AUTOINCREMENT,
      scale       TEXT    NOT NULL,
      note        TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reward_point_wallets (
      user_id      INTEGER PRIMARY KEY,
      balance      INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
      earned_total INTEGER NOT NULL DEFAULT 0,
      spent_total  INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reward_point_ledger (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      user_id       INTEGER NOT NULL,
      delta         INTEGER NOT NULL CHECK (delta <> 0),
      balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
      kind          TEXT    NOT NULL CHECK (kind IN ('season_award', 'spend', 'refund', 'admin_credit', 'admin_debit')),
      use           TEXT    CHECK (use IS NULL OR use IN ('virtual', 'real')),
      season_id     INTEGER,
      idem_key      TEXT    NOT NULL UNIQUE,
      reason        TEXT,
      meta          TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_point_ledger_user ON reward_point_ledger (user_id, id DESC);
    CREATE TABLE IF NOT EXISTS reward_point_awards (
      season_id      INTEGER NOT NULL,
      mode           TEXT    NOT NULL CHECK (mode IN ('simulation', 'live')),
      user_id        INTEGER NOT NULL,
      rank           INTEGER NOT NULL,
      eligible_count INTEGER NOT NULL,
      tier           TEXT,
      points         INTEGER NOT NULL,
      scale_version  INTEGER NOT NULL,
      ledger_id      INTEGER,
      PRIMARY KEY (season_id, mode, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_point_awards_user ON reward_point_awards (user_id, season_id);
    CREATE TABLE IF NOT EXISTS reward_point_runs (
      season_id     INTEGER NOT NULL,
      mode          TEXT    NOT NULL CHECK (mode IN ('simulation', 'live')),
      created_at    TEXT    NOT NULL,
      scale_version INTEGER NOT NULL,
      snapshot_hash TEXT    NOT NULL,
      eligible      INTEGER NOT NULL,
      recipients    INTEGER NOT NULL,
      total_points  INTEGER NOT NULL,
      PRIMARY KEY (season_id, mode)
    );
    CREATE TRIGGER IF NOT EXISTS trg_point_ledger_no_update BEFORE UPDATE ON reward_point_ledger
      BEGIN SELECT RAISE(ABORT, 'reward_point_ledger est en ajout seul (#33)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_point_ledger_no_delete BEFORE DELETE ON reward_point_ledger
      BEGIN SELECT RAISE(ABORT, 'reward_point_ledger est en ajout seul (#33)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_point_scales_no_update BEFORE UPDATE ON reward_point_scales
      BEGIN SELECT RAISE(ABORT, 'reward_point_scales est en ajout seul (#33)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_point_scales_no_delete BEFORE DELETE ON reward_point_scales
      BEGIN SELECT RAISE(ABORT, 'reward_point_scales est en ajout seul (#33)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_point_awards_no_update BEFORE UPDATE ON reward_point_awards
      BEGIN SELECT RAISE(ABORT, 'reward_point_awards est en ajout seul (#33)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_point_awards_no_delete BEFORE DELETE ON reward_point_awards
      BEGIN SELECT RAISE(ABORT, 'reward_point_awards est en ajout seul (#33)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_point_runs_no_update BEFORE UPDATE ON reward_point_runs
      BEGIN SELECT RAISE(ABORT, 'reward_point_runs est en ajout seul (#33)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_point_runs_no_delete BEFORE DELETE ON reward_point_runs
      BEGIN SELECT RAISE(ABORT, 'reward_point_runs est en ajout seul (#33)'); END;
  `);

  // Boutique de cadeaux (#34) : réglages (une ligne), catalogue administrable, commandes payées en
  // points (débit via reward_point_ledger, clé d'idempotence par commande) et journal en ajout
  // seul. Ajouts seuls ; aucune clé étrangère vers users ; articles et commandes jamais supprimés.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS shop_settings (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      exchanges_open  INTEGER NOT NULL DEFAULT 1 CHECK (exchanges_open IN (0, 1)),
      notice          TEXT,
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO shop_settings (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS shop_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      kind              TEXT    NOT NULL DEFAULT 'virtual' CHECK (kind IN ('virtual', 'real')),
      texts             TEXT    NOT NULL,
      icon              TEXT,
      image_url         TEXT,
      cost              INTEGER NOT NULL CHECK (cost >= 1),
      stock_remaining   INTEGER CHECK (stock_remaining IS NULL OR stock_remaining >= 0),
      max_per_user      INTEGER CHECK (max_per_user IS NULL OR max_per_user >= 1),
      face_value_cents  INTEGER CHECK (face_value_cents IS NULL OR face_value_cents >= 0),
      currency          TEXT,
      territories       TEXT,
      min_age           INTEGER,
      valid_from        TEXT,
      valid_until       TEXT,
      visible           INTEGER NOT NULL DEFAULT 0 CHECK (visible IN (0, 1)),
      unavailable       INTEGER NOT NULL DEFAULT 0 CHECK (unavailable IN (0, 1)),
      sort              INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS shop_orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      user_id          INTEGER NOT NULL,
      item_id          INTEGER NOT NULL,
      kind             TEXT    NOT NULL CHECK (kind IN ('virtual', 'real')),
      cost             INTEGER NOT NULL CHECK (cost >= 1),
      status           TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'processing', 'delivered', 'cancelled')),
      request_key      TEXT    NOT NULL UNIQUE,
      spend_ledger_id  INTEGER NOT NULL,
      refund_ledger_id INTEGER,
      item_snapshot    TEXT    NOT NULL,
      note             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_shop_orders_user ON shop_orders (user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON shop_orders (status, id);
    CREATE TABLE IF NOT EXISTS shop_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      actor       TEXT    NOT NULL CHECK (actor IN ('player', 'admin', 'system')),
      action      TEXT    NOT NULL,
      item_id     INTEGER,
      order_id    INTEGER,
      user_id     INTEGER,
      details     TEXT
    );
    CREATE TRIGGER IF NOT EXISTS trg_shop_audit_no_update BEFORE UPDATE ON shop_audit
      BEGIN SELECT RAISE(ABORT, 'shop_audit est en ajout seul (#34)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_shop_audit_no_delete BEFORE DELETE ON shop_audit
      BEGIN SELECT RAISE(ABORT, 'shop_audit est en ajout seul (#34)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_shop_orders_no_delete BEFORE DELETE ON shop_orders
      BEGIN SELECT RAISE(ABORT, 'shop_orders : suppression interdite (#34)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_shop_items_no_delete BEFORE DELETE ON shop_items
      BEGIN SELECT RAISE(ABORT, 'shop_items : suppression interdite, masquer l''article (#34)'); END;
  `);

  // Fin de saison configurable (#44) : journal en ajout seul des changements de date de fin
  // de la saison active (programmation, annulation), avec l'ancienne et la nouvelle valeur.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS season_end_changes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      season_id   INTEGER NOT NULL,
      action      TEXT    NOT NULL CHECK (action IN ('set','cancel')),
      old_end_at  TEXT    NOT NULL,
      new_end_at  TEXT    NOT NULL,
      weekly_end  TEXT    NOT NULL,
      reason      TEXT,
      created_at  TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_season_end_changes_season ON season_end_changes (season_id, id);
    CREATE TRIGGER IF NOT EXISTS trg_season_end_changes_no_update BEFORE UPDATE ON season_end_changes
      BEGIN SELECT RAISE(ABORT, 'season_end_changes est en ajout seul (#44)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_season_end_changes_no_delete BEFORE DELETE ON season_end_changes
      BEGIN SELECT RAISE(ABORT, 'season_end_changes est en ajout seul (#44)'); END;
  `);

  // Journal de sécurité (lot A) : aucune IP en clair (HMAC tronqué), purge à 90 jours.
  // Score de risque par compte et par saison (composantes par catégorie, décroissantes).
  _db.exec(`
    CREATE TABLE IF NOT EXISTS security_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      type         TEXT    NOT NULL,
      user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
      season_id    INTEGER,
      score_before REAL,
      score_after  REAL,
      details      TEXT,
      ip_hash      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_security_events_time ON security_events (created_at);
    CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events (user_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events (type, id DESC);
    CREATE TABLE IF NOT EXISTS risk_scores (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      season_id  INTEGER NOT NULL,
      components TEXT    NOT NULL DEFAULT '{}',
      score      REAL    NOT NULL DEFAULT 0,
      level      INTEGER NOT NULL DEFAULT 0,
      updated_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, season_id)
    );
    -- Fiche joueur anti-bot (#25, 04/11) : une ligne agrégée par sauvegarde contrôlée (compteurs
    -- déclarés, profondeur retenue, résumé de télémétrie), pour les diagnostics futurs. Aucune IP,
    -- aucune frappe horodatée ; bornée par joueur et purgée avec le journal (90 jours).
    CREATE TABLE IF NOT EXISTS antibot_save_samples (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      season_id       INTEGER NOT NULL,
      at_ms           INTEGER NOT NULL,
      reported_depth  INTEGER,
      accepted_depth  INTEGER,
      budget_depth    INTEGER,
      manual_clicks   INTEGER,
      manual_blocks   INTEGER,
      auto_blocks     INTEGER,
      blocks_destroyed INTEGER,
      autodig_level   INTEGER,
      ac_action       TEXT,
      tel             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_antibot_samples_user ON antibot_save_samples (user_id, season_id, id DESC);
  `);
  // PV réels (#77) : profondeur couverte par le budget recalculé bloc par bloc (ajout seul)
  if (!_db.prepare('PRAGMA table_info(antibot_save_samples)').all().some(r => r.name === 'exact_depth')) {
    _db.prepare('ALTER TABLE antibot_save_samples ADD COLUMN exact_depth INTEGER').run();
    console.log('[db] Migration : antibot_save_samples.exact_depth ajouté');
  }
  // Réponses anti-bot (#25 lot C, décision du 06/11) : mesures d'activité manuelle, défis et
  // suspensions du MINAGE MANUEL. Tables ajoutées seules ; aucune donnée existante modifiée.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS antibot_activity (
      user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      season_id         INTEGER,
      last_ms           INTEGER,
      last_clicks       INTEGER,
      last_blocks       INTEGER,
      streak_active_s   REAL    NOT NULL DEFAULT 0,
      pause_s           REAL    NOT NULL DEFAULT 0,
      buckets           TEXT    NOT NULL DEFAULT '[]',
      tel_h             TEXT,
      force_mode        TEXT,
      violation_level   INTEGER NOT NULL DEFAULT 0,
      last_violation_ms INTEGER,
      last_challenge_ms INTEGER,
      rebase_clicks     INTEGER,
      rebase_blocks     INTEGER,
      updated_ms        INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS antibot_challenges (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      season_id         INTEGER,
      status            TEXT    NOT NULL,
      mode              TEXT    NOT NULL,
      origin            TEXT    NOT NULL DEFAULT 'auto',
      reasons           TEXT,
      created_ms        INTEGER NOT NULL,
      seen_ms           INTEGER,
      seen_clicks       INTEGER,
      resolved_ms       INTEGER,
      puzzle_id         TEXT,
      puzzle_hash       TEXT,
      puzzle_kind       TEXT,
      puzzle_issued_ms  INTEGER,
      puzzle_expires_ms INTEGER,
      puzzle_window_ms  INTEGER,
      puzzle_count      INTEGER NOT NULL DEFAULT 0,
      fails             INTEGER NOT NULL DEFAULT 0,
      expirations       INTEGER NOT NULL DEFAULT 0,
      held_clicks       INTEGER NOT NULL DEFAULT 0,
      violations        INTEGER NOT NULL DEFAULT 0,
      admin_note        TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_antibot_challenges_user ON antibot_challenges (user_id, status, id DESC);
    CREATE TABLE IF NOT EXISTS antibot_suspensions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      season_id    INTEGER,
      challenge_id INTEGER,
      level        INTEGER NOT NULL,
      starts_ms    INTEGER NOT NULL,
      ends_ms      INTEGER NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'active',
      origin       TEXT    NOT NULL DEFAULT 'auto',
      reason       TEXT,
      held_clicks  INTEGER NOT NULL DEFAULT 0,
      lifted_ms    INTEGER,
      admin_note   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_antibot_suspensions_user ON antibot_suspensions (user_id, status, id DESC);
  `);
  // Recette autoclicker (#25, 07/11) : dernière fenêtre mesurée, seuil court d'essai limité au
  // compte en essai, relevé de progression au début de l'essai. Colonnes ajoutées seules.
  {
    const cols = new Set(_db.prepare('PRAGMA table_info(antibot_activity)').all().map(r => r.name));
    for (const [name, type] of [['last_window', 'TEXT'], ['test_streak_min', 'REAL'], ['test_started_ms', 'INTEGER'], ['test_snapshot', 'TEXT']]) {
      if (cols.has(name)) continue;
      _db.prepare(`ALTER TABLE antibot_activity ADD COLUMN ${name} ${type}`).run();
      console.log(`[db] Migration : antibot_activity.${name} ajouté`);
    }
  }
  // Preuve du gel (#25, recette du 08/11) : relevés à l'émission et à la résolution du défi,
  // sauvegardes retenues pendant le défi, crédit refusé ; heure de résolution pour la fenêtre
  // anti-autoclic de la reprise. Colonnes ajoutées seules.
  for (const [table, add] of [
    ['antibot_challenges', [['issued_snapshot', 'TEXT'], ['resolved_snapshot', 'TEXT'], ['pending_saves', 'INTEGER NOT NULL DEFAULT 0'],
      ['pending_last_ms', 'INTEGER'], ['clamped_blocks', 'INTEGER NOT NULL DEFAULT 0']]],
    ['antibot_activity', [['rebase_ms', 'INTEGER'],
      // Détection rapide des autoclickers (#91) : dernières fenêtres serveur et dernier verdict
      ['fast_state', 'TEXT']]],
  ]) {
    const cols = new Set(_db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
    for (const [name, type] of add) {
      if (cols.has(name)) continue;
      _db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run();
      console.log(`[db] Migration : ${table}.${name} ajouté`);
    }
  }

  // Session de jeu unique par compte (#35) : un seul contrôleur (onglet, appareil, PWA) peut
  // miner et écrire la sauvegarde. Table ajoutée, aucune donnée existante modifiée.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS play_controllers (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      controller_id TEXT    NOT NULL,
      epoch         INTEGER NOT NULL DEFAULT 1,
      claimed_ms    INTEGER NOT NULL,
      heartbeat_ms  INTEGER NOT NULL
    );
  `);

  // Publicité (#45) : réglages (une ligne, tout désactivé par défaut), emplacements réservés et
  // compteur journalier des affichages du cadre publicitaire (aucune donnée personnelle).
  // Tables ajoutées seules ; aucune donnée existante modifiée.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ad_settings (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      enabled         INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      provider        TEXT    NOT NULL DEFAULT '',
      allowed_hosts   TEXT    NOT NULL DEFAULT '["dig.lodygames.com"]',
      consent_version INTEGER NOT NULL DEFAULT 1,
      ads_txt         TEXT    NOT NULL DEFAULT '',
      legal_contact   TEXT    NOT NULL DEFAULT '',
      updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO ad_settings (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS ad_slots (
      slot        TEXT    PRIMARY KEY,
      enabled     INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      ad_key      TEXT    NOT NULL DEFAULT '',
      script_url  TEXT    NOT NULL DEFAULT '',
      hide_on_dig INTEGER NOT NULL DEFAULT 0 CHECK (hide_on_dig IN (0, 1)),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO ad_slots (slot, hide_on_dig) VALUES ('top_mobile', 1);
    INSERT OR IGNORE INTO ad_slots (slot, hide_on_dig) VALUES ('top_desktop', 0);
    CREATE TABLE IF NOT EXISTS ad_daily_stats (
      day    TEXT    NOT NULL,
      slot   TEXT    NOT NULL,
      frames INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, slot)
    );
  `);
  // Promotion interne DIG! (#45, demande du 04/11) : bannière maison vers la boutique de gemmes,
  // indépendante de la régie. Colonnes ajoutées seules, désactivée par défaut ; « masquer sur
  // l'écran de minage » reprend une seule fois le réglage existant de l'emplacement.
  try { _db.prepare('ALTER TABLE ad_settings ADD COLUMN promo_enabled INTEGER NOT NULL DEFAULT 0').run(); } catch (_) {}
  try {
    _db.prepare('ALTER TABLE ad_slots ADD COLUMN promo_hide_on_dig INTEGER NOT NULL DEFAULT 0').run();
    _db.prepare('UPDATE ad_slots SET promo_hide_on_dig = hide_on_dig').run();
  } catch (_) {}

  // Bêta fermée (#57) : réglages (une ligne ; inscription ouverte et bandeau masqué par défaut,
  // donc aucun changement visible au déploiement), codes d'invitation, comptes créés avec un code
  // et signalements de bugs. Tables ajoutées seules ; aucune donnée existante modifiée.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS beta_settings (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      banner_enabled    INTEGER NOT NULL DEFAULT 0 CHECK (banner_enabled IN (0, 1)),
      registration_mode TEXT    NOT NULL DEFAULT 'open' CHECK (registration_mode IN ('open', 'invite', 'closed')),
      discord_url       TEXT    NOT NULL DEFAULT '',
      reset_policy      TEXT    NOT NULL DEFAULT '',
      known_issues      TEXT    NOT NULL DEFAULT '',
      reports_enabled   INTEGER NOT NULL DEFAULT 1 CHECK (reports_enabled IN (0, 1)),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO beta_settings (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS beta_invites (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT    NOT NULL UNIQUE,
      label      TEXT    NOT NULL DEFAULT '',
      wave       INTEGER NOT NULL DEFAULT 1,
      max_uses   INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
      uses       INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
      expires_at TEXT,
      revoked_at TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS beta_invite_uses (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id  INTEGER NOT NULL REFERENCES beta_invites(id),
      user_id    INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      used_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bug_reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      step        TEXT    NOT NULL DEFAULT '',
      expected    TEXT    NOT NULL DEFAULT '',
      observed    TEXT    NOT NULL,
      device      TEXT    NOT NULL DEFAULT '',
      diagnostics TEXT,
      status      TEXT    NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'fixed', 'wontfix')),
      github_url  TEXT    NOT NULL DEFAULT '',
      admin_note  TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bug_reports_user ON bug_reports(user_id, id);
  `);

  // ── Gestion de la bêta (#80) : archivage et retrait réversibles, journal ──────
  // Colonnes AJOUTÉES seulement (NULL = état d'avant #80) : rien n'est supprimé ni réécrit.
  //   beta_invites.archived_at / created_by : lien masqué de la liste courante (jamais un lien actif) ;
  //   beta_invite_uses.removed_at : testeur retiré du programme (compte, connexion et progression intacts) ;
  //   bug_reports.archived_at : retour traité rangé dans les archives (texte et diagnostic conservés).
  for (const sql of [
    'ALTER TABLE beta_invites ADD COLUMN archived_at TEXT',
    'ALTER TABLE beta_invites ADD COLUMN created_by TEXT',
    'ALTER TABLE beta_invite_uses ADD COLUMN removed_at TEXT',
    'ALTER TABLE bug_reports ADD COLUMN archived_at TEXT',
  ]) {
    try { _db.prepare(sql).run(); } catch (err) { if (!/duplicate column/i.test(err.message)) throw err; }
  }
  _db.exec(`
    CREATE TABLE IF NOT EXISTS beta_audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      action      TEXT    NOT NULL,
      target_type TEXT    NOT NULL,
      target_id   INTEGER NOT NULL,
      target      TEXT    NOT NULL DEFAULT '',
      actor       TEXT    NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_beta_audit_target ON beta_audit (target_type, target_id, id);
    CREATE TRIGGER IF NOT EXISTS trg_beta_audit_no_update BEFORE UPDATE ON beta_audit
      BEGIN SELECT RAISE(ABORT, 'beta_audit est en ajout seul (#80)'); END;
    CREATE TRIGGER IF NOT EXISTS trg_beta_audit_no_delete BEFORE DELETE ON beta_audit
      BEGIN SELECT RAISE(ABORT, 'beta_audit est en ajout seul (#80)'); END;
  `);

  // ── Sessions du panel admin (#57, recette du 03/11) ───────────────────────
  // Seule l'empreinte du jeton est stockée (jamais le jeton ni ADMIN_SECRET). Table ajoutée seule.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT    PRIMARY KEY,
      secret_fp  TEXT    NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER
    );
  `);

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
  // Validation serveur de la profondeur (ticket #9)
  cfgStmt.run('depth_validation_enabled',     'true');
  cfgStmt.run('depth_max_cps',                '20');    // clics/s max retenus pour la progression
  // Cadence de frappe (#74) : au-delà, un coup ne fait aucun dégât (client) et n'est pas crédité (serveur)
  cfgStmt.run('manual_hit_rate',              '12');
  cfgStmt.run('manual_hit_burst',             '36');
  // Anti-bot (#25) : observation sans sanction (lot A), budget de dégâts appliqué (lot B)
  cfgStmt.run('antibot_mode',                 'shadow');
  cfgStmt.run('damage_budget_mode',           'enforce');
  // PV réels des blocs (#77) : observation d'abord, rejet strict seulement sur décision du propriétaire
  cfgStmt.run('exact_hp_mode',                'shadow');
  // Réponses anti-bot (#25 lot C) : Observation par défaut — Appliqué seulement sur décision du propriétaire
  cfgStmt.run('antibot_response_mode',        'observe');
  cfgStmt.run('ab_streak_min',                '60');    // défi : minage manuel continu sans pause (min)
  cfgStmt.run('ab_active6h_min',              '180');   // défi : minage manuel actif sur 6 h (min)
  cfgStmt.run('ab_active24h_min',             '360');   // défi : minage manuel actif sur 24 h (min)
  cfgStmt.run('ab_challenge_score',           '60');    // défi : score de risque multi-signal
  cfgStmt.run('ab_cooldown_min',              '30');
  cfgStmt.run('ab_violation_clicks',          '30');    // clics pendant un défi affiché = violation confirmée
  cfgStmt.run('ab_suspension_ladder',         '5,15,30,60,120,720,1440');
  cfgStmt.run('ab_decay_days',                '30');
  cfgStmt.run('ab_puzzle_seconds',            '30');    // chrono de l'énigme visuelle (s)
  cfgStmt.run('ab_puzzle_text_seconds',       '60');    // chrono de la version accessible (s)
  // Détection rapide des autoclickers (#91) : activée pour tous sur décision du propriétaire du 08/11
  // (25 clics au même pixel → vérification ; autoclicker corroboré revu après vérification → suspension)
  cfgStmt.run('ab_fast_mode',                 'on');
  cfgStmt.run('ab_same_pixel_mode',           'on');
  cfgStmt.run('ab_same_pixel_clicks',         '25');
  cfgStmt.run('ab_fast_suspend',              'on');
  cfgStmt.run('ab_fast_repeat_min',           '60');
  // Économie — multiplicateurs globaux (informations + appliqués par chestShop)
  cfgStmt.run('upgrade_cost_multiplier',  '1.0');   // ×coût des upgrades saisonniers
  cfgStmt.run('coin_gain_multiplier',     '1.0');   // ×gains de pièces (blocs)
  cfgStmt.run('fragment_drop_multiplier', '1.0');   // ×fragments dans les coffres shop
  // Coûts des coffres achetables (surchargent chestShop.js si présents)
  cfgStmt.run('chest_cost_simple',  '2000');
  cfgStmt.run('chest_cost_rare',    '15000');
  cfgStmt.run('chest_cost_antique', '80000');

  // ── Décisions de réglage du propriétaire, appliquées une seule fois ───────
  // Chaque décision change une clé uniquement si elle vaut encore la valeur attendue, puis est
  // journalisée : jamais rejouée (un retour arrière depuis le panel reste acquis), jamais
  // appliquée par-dessus un réglage modifié entre-temps dans le panel.
  _db.exec(`
    CREATE TABLE IF NOT EXISTS admin_config_decisions (
      id          TEXT PRIMARY KEY,
      config_key  TEXT NOT NULL,
      old_value   TEXT,
      new_value   TEXT NOT NULL,
      outcome     TEXT NOT NULL,              -- 'applied' | 'skipped'
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const decisions = [
    // #19, commentaire du propriétaire du 04/11/2026 : seuil bêta 10 → 3 joueurs actifs par ligue.
    { id: 'issue19-beta-min-active-3', key: 'min_active_players_per_league', expected: '10', value: '3' },
    // #25, commentaires du propriétaire du 08/11/2026 (issuecomment-6722088344 et -6722134355) :
    // défis et suspensions du minage manuel « Appliqué » pour tous. Arrêt d'urgence : panel Anti-bot.
    { id: 'issue25-global-enforce-2026-11-08', key: 'antibot_response_mode', expected: 'observe', value: 'enforce' },
    // #92, décision du propriétaire du 10/11/2026 (issuecomment-6767971370) : extension d'autoclic PROUVÉE
    // détectée → minage manuel bloqué pour tous les bêta-testeurs, sans sanction sur simple présence.
    // Seule OP Auto Clicker (Chrome, recettes #92-A/B) ; arrêt d'urgence : Anti-bot → Extensions.
    // `null` : clé absente (jamais réglée dans le panel) → ajoutée.
    { id: 'issue92-op-global-2026-11-10', key: 'ab_ext_sig_op_auto_clicker', expected: [null, 'off', 'self'], value: 'global' },
    { id: 'issue92-reaction-block-2026-11-10', key: 'ab_ext_reaction', expected: [null, 'log'], value: 'block' },
  ];
  for (const d of decisions) {
    _db.transaction(() => {
      if (_db.prepare('SELECT 1 FROM admin_config_decisions WHERE id = ?').get(d.id)) return;
      const old = _db.prepare('SELECT value FROM admin_config WHERE key = ?').get(d.key)?.value ?? null;
      const apply = [].concat(d.expected).includes(old);
      if (apply) {
        _db.prepare(`INSERT INTO admin_config (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(d.key, d.value);
      }
      _db.prepare('INSERT INTO admin_config_decisions (id, config_key, old_value, new_value, outcome) VALUES (?,?,?,?,?)')
        .run(d.id, d.key, old, d.value, apply ? 'applied' : 'skipped');
      console.log(`[db] Décision ${d.id} : ${d.key} ${apply ? `${old} → ${d.value}` : `inchangé (${old}, attendu ${[].concat(d.expected).join(' | ')})`}`);
    })();
  }

  // ── Seed : ligue Mimosa ───────────────────────────────────────────────────
  const leagueCount = _db.prepare('SELECT COUNT(*) AS n FROM leagues').get().n;
  if (leagueCount === 0) {
    _db.prepare(
      `INSERT INTO leagues (name, icon, level, rank_min, rank_max, sort_order) VALUES (?,?,?,?,?,?)`
    ).run('Mimosa', '🌼', 0, 1, 10, 0);
  }

  // ── Seed : saison active (semaine ISO courante, ticket #16) ───────────────
  const activeSeason = _db.prepare(`SELECT id FROM seasons WHERE status='active' LIMIT 1`).get();
  const anySeason    = _db.prepare(`SELECT id FROM seasons LIMIT 1`).get();
  if (!activeSeason && !anySeason) {
    // Base vierge uniquement : sinon la rotation (seasons.js) enchaîne depuis la dernière saison.
    const { start, end } = cal.weekBounds(new Date());
    _db.prepare(
      `INSERT INTO seasons (name, start_at, end_at, status) VALUES (?,?,?,'active')`
    ).run(cal.seasonName(start), cal.fmtUtc(start), cal.fmtUtc(end));
  }

  // ── Une seule saison active (index partiel, ticket #16) ───────────────────
  // Ajout pur, idempotent ; n'est créé que si les données le permettent déjà.
  const nActive = _db.prepare(`SELECT COUNT(*) AS n FROM seasons WHERE status='active'`).get().n;
  if (nActive <= 1) {
    _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_one_active ON seasons(status) WHERE status='active'`);
  } else {
    console.warn(`[db] ${nActive} saisons actives : index d'unicité non créé — clôturer les saisons en trop depuis l'admin.`);
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

/**
 * Enregistre un événement lié à un compte (table user_events).
 * @param {number}      userId
 * @param {string}      eventType  ex. 'chest_shop_open', 'admin_season_reset'
 * @param {object|null} [metadata]
 */
function logUserEvent(userId, eventType, metadata = null) {
  getDb()
    .prepare('INSERT INTO user_events (user_id, event_type, metadata) VALUES (?, ?, ?)')
    .run(userId, eventType, metadata ? JSON.stringify(metadata) : null);
}

/**
 * Exécute fn dans une transaction SQLite : tout est validé, ou tout est annulé
 * si fn lève une exception (l'exception est propagée).
 */
function runTransaction(fn) {
  return getDb().transaction(fn)();
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

// ── Helpers e-mail vérifié et récupération de compte (#28) ────────────────────

/**
 * Données d'authentification d'un compte (avec password_hash) — usage serveur uniquement.
 * @returns {{ id, username, email, email_verified_at, auth_version, password_hash } | undefined}
 */
function getUserAuth(id) {
  return getDb()
    .prepare('SELECT id, username, email, email_verified_at, auth_version, password_hash, created_at FROM users WHERE id = ?')
    .get(id);
}

/** Version d'authentification courante (undefined si le compte n'existe pas). */
function getUserAuthVersion(id) {
  return getDb().prepare('SELECT auth_version FROM users WHERE id = ?').get(id)?.auth_version;
}

/**
 * Enregistre un nouveau jeton (hachage) et annule les jetons non utilisés du même usage :
 * seul le dernier lien envoyé reste valable.
 */
function createAuthToken(userId, purpose, tokenHash, email, ttlMinutes) {
  const db = getDb();
  runTransaction(() => {
    db.prepare(
      `UPDATE auth_tokens SET used_at = datetime('now')
        WHERE user_id = ? AND purpose = ? AND used_at IS NULL`
    ).run(userId, purpose);
    db.prepare(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, email, expires_at)
       VALUES (?, ?, ?, ?, datetime('now', ?))`
    ).run(userId, purpose, tokenHash, email, `+${Math.round(ttlMinutes)} minutes`);
  });
}

/** Secondes écoulées depuis le dernier jeton émis pour cet usage (null si aucun). */
function secondsSinceLastAuthToken(userId, purpose) {
  const row = getDb().prepare(
    `SELECT CAST((julianday('now') - julianday(MAX(created_at))) * 86400 AS INTEGER) AS s
       FROM auth_tokens WHERE user_id = ? AND purpose = ?`
  ).get(userId, purpose);
  return row?.s ?? null;
}

/**
 * Consomme un jeton valide (non utilisé, non expiré) : le marque utilisé et le retourne.
 * Retourne null si le jeton est inconnu, expiré ou déjà utilisé.
 */
function consumeAuthToken(tokenHash, purpose) {
  const db = getDb();
  return runTransaction(() => {
    const row = db.prepare(
      `SELECT id, user_id, email FROM auth_tokens
        WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > datetime('now')`
    ).get(tokenHash, purpose);
    if (!row) return null;
    db.prepare(`UPDATE auth_tokens SET used_at = datetime('now') WHERE id = ?`).run(row.id);
    return row;
  });
}

/**
 * Remplace le mot de passe, incrémente auth_version (les autres sessions du compte sont
 * fermées à leur prochaine requête) et annule les liens de réinitialisation en attente.
 * @returns {number} nouvelle auth_version
 */
function setUserPassword(userId, passwordHash) {
  const db = getDb();
  return runTransaction(() => {
    db.prepare('UPDATE users SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ?')
      .run(passwordHash, userId);
    db.prepare(
      `UPDATE auth_tokens SET used_at = datetime('now')
        WHERE user_id = ? AND purpose = 'reset_password' AND used_at IS NULL`
    ).run(userId);
    return db.prepare('SELECT auth_version FROM users WHERE id = ?').get(userId).auth_version;
  });
}

/** Marque `email` comme adresse vérifiée du compte (remplace l'adresse si elle diffère). */
function setUserEmailVerified(userId, email) {
  getDb().prepare(`UPDATE users SET email = ?, email_verified_at = datetime('now') WHERE id = ?`)
    .run(email, userId);
}

// ── Helpers identités sociales (#28) ─────────────────────────────────────────

/** Identité sociale (provider, subject), ou undefined. */
function getIdentity(provider, subject) {
  return getDb().prepare('SELECT id, user_id, provider, subject, email FROM user_identities WHERE provider = ? AND subject = ?')
    .get(provider, subject);
}

/** Identités sociales liées à un compte. */
function getUserIdentities(userId) {
  return getDb().prepare('SELECT id, provider, subject, email, created_at, last_login_at FROM user_identities WHERE user_id = ? ORDER BY id')
    .all(userId);
}

/** Lie une identité sociale à un compte (contraintes UNIQUE : jamais deux comptes pour une identité). */
function addUserIdentity(userId, { provider, subject, email, emailVerified }) {
  getDb().prepare(
    `INSERT INTO user_identities (user_id, provider, subject, email, email_verified, last_login_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`
  ).run(userId, provider, subject, email ?? null, emailVerified ? 1 : 0);
}

function touchUserIdentity(identityId) {
  getDb().prepare(`UPDATE user_identities SET last_login_at = datetime('now') WHERE id = ?`).run(identityId);
}

/**
 * Retire une identité sociale et incrémente auth_version (les autres sessions du compte sont
 * fermées). @returns {number} nouvelle auth_version
 */
function removeUserIdentity(userId, identityId) {
  const db = getDb();
  return runTransaction(() => {
    db.prepare('DELETE FROM user_identities WHERE id = ? AND user_id = ?').run(identityId, userId);
    db.prepare('UPDATE users SET auth_version = auth_version + 1 WHERE id = ?').run(userId);
    return db.prepare('SELECT auth_version FROM users WHERE id = ?').get(userId).auth_version;
  });
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
 * La colonne `version` sert de révision serveur : elle augmente à chaque écriture
 * (sauvegarde client, coffre, reset admin), ce qui permet de détecter les
 * sauvegardes obsolètes (#18).
 * @param   {number} userId
 * @param   {string} dataJson  JSON stringify du GameState
 * @param   {object} [opts]
 * @param   {number|null} [opts.expectedVersion]  révision sur laquelle le client a travaillé :
 *          null = aucune sauvegarde ne doit exister ; undefined = pas de contrôle (ancien client).
 * @returns {{ version: number } | { conflict: true, current: object|null }}
 */
function upsertUserSave(userId, dataJson, opts = {}) {
  const db = getDb();
  return db.transaction(() => {
    const current = getUserSave(userId);
    if (opts.expectedVersion !== undefined) {
      const currentVersion = current ? current.version : null;
      if (opts.expectedVersion !== currentVersion) return { conflict: true, current };
    }
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
  })();
}

// ── Helpers saisons ───────────────────────────────────────────────────────────

function getActiveSeason() {
  return getDb().prepare(`SELECT * FROM seasons WHERE status='active' ORDER BY id DESC LIMIT 1`).get() ?? null;
}

function getSeasonById(id) {
  return getDb().prepare(`SELECT * FROM seasons WHERE id = ?`).get(id) ?? null;
}

function createSeason(name, startAt, endAt, status = 'active') {
  const db = getDb();
  const info = db.prepare(
    `INSERT INTO seasons (name, start_at, end_at, status) VALUES (?,?,?,?)`
  ).run(name, startAt, endAt, status);
  return db.prepare(`SELECT * FROM seasons WHERE id = ?`).get(info.lastInsertRowid);
}

/** Saison programmée (status 'scheduled') la plus proche, ou null. */
function getNextScheduledSeason() {
  return getDb().prepare(
    `SELECT * FROM seasons WHERE status='scheduled' ORDER BY start_at ASC, id ASC LIMIT 1`
  ).get() ?? null;
}

/** Dernière saison terminée (closed/archived), par date de fin. */
function getLastEndedSeason() {
  return getDb().prepare(
    `SELECT * FROM seasons WHERE status IN ('closed','archived') ORDER BY end_at DESC, id DESC LIMIT 1`
  ).get() ?? null;
}

function seasonNameExists(name) {
  return !!getDb().prepare(`SELECT 1 FROM seasons WHERE name = ? LIMIT 1`).get(name);
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

/** Horodatage UTC à la milliseconde (départage « premier arrivé », #29). */
const NOW_MS = "strftime('%Y-%m-%d %H:%M:%f', 'now')";

/**
 * Ordre unique de tous les classements (vivant, ligue, promotions, instantané figé, points,
 * concours) — décision du propriétaire du 04/11/2026 (#73) : blocs détruits MANUELLEMENT et
 * validés par le serveur ↓, puis premier à avoir atteint ce total ↑ (sans date : atteint avant
 * l'activation de la règle, donc en premier), puis identifiant ↑. La profondeur ne participe
 * ni au score ni au départage. Entièrement déterministe, aucun hasard.
 */
const RANK_ORDER = 'effective_manual_blocks DESC, (manual_blocks_reached_at IS NOT NULL) ASC, manual_blocks_reached_at ASC, user_id ASC';
const RANK_ORDER_R = RANK_ORDER.replace(/\b(effective_manual_blocks|manual_blocks_reached_at|user_id)\b/g, 'r.$1');
/**
 * Entrée au classement : joueur actif avec au moins un bloc manuel déclaré ET au moins un bloc
 * manuel validé par le serveur (#73 : Auto-Dig seul ou blocs refusés par l'anti-autoclic → pas
 * de rang). Les instantanés gardent les participants non validés, exclus avec leur motif.
 */
const RANKED_WHERE = 'is_active = 1 AND manual_blocks > 0 AND effective_manual_blocks > 0';
const RANKED_WHERE_R = 'r.is_active = 1 AND r.manual_blocks > 0 AND r.effective_manual_blocks > 0';

/**
 * Upsert les statistiques MANUELLES du joueur.
 * NE touche pas auto_blocks (géré séparément par updateAutoBlocksOnly).
 * Marque le joueur actif (is_active = 1) → il entre dans le classement.
 */
function upsertSeasonRanking(seasonId, userId, maxDepth, manualBlocks, _unused, manualClicks, suspiciousScore, leagueId, reportedMaxDepth) {
  getDb().prepare(`
    INSERT INTO season_rankings
      (season_id, user_id, league_id, max_depth, reported_max_depth, manual_blocks, manual_clicks, suspicious_score, is_active, updated_at,
       max_depth_reached_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), CASE WHEN ? > 0 THEN ${NOW_MS} END)
    ON CONFLICT(season_id, user_id) DO UPDATE SET
      league_id          = COALESCE(excluded.league_id, league_id),
      max_depth          = MAX(max_depth, excluded.max_depth),
      max_depth_reached_at = CASE WHEN excluded.max_depth > max_depth THEN ${NOW_MS}
                                  ELSE max_depth_reached_at END,
      reported_max_depth = MAX(reported_max_depth, excluded.reported_max_depth),
      manual_blocks      = MAX(manual_blocks, excluded.manual_blocks),
      manual_clicks      = MAX(manual_clicks, excluded.manual_clicks),
      suspicious_score   = MAX(suspicious_score, excluded.suspicious_score),
      is_active          = 1,
      updated_at         = excluded.updated_at
  `).run(seasonId, userId, leagueId ?? null, maxDepth, reportedMaxDepth ?? maxDepth, manualBlocks, manualClicks ?? 0, suspiciousScore ?? 0, maxDepth);
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
 * Tri : RANK_ORDER — blocs manuels validés, premier arrivé à ce total, puis user_id (#73).
 * auto_blocks jamais utilisé pour le tri.
 */
function getSeasonLeaderboard(seasonId, limit = 50, offset = 0, { includeUnranked = false } = {}) {
  // Vue admin : participants sans bloc manuel validé listés en fin (rang null), pour correction
  const where = includeUnranked ? 'r.is_active = 1 AND r.manual_blocks > 0' : RANKED_WHERE_R;
  return getDb().prepare(`
    SELECT u.id       AS user_id,
           u.username,
           r.league_id,
           r.max_depth,
           r.reported_max_depth,
           r.manual_blocks,
           r.manual_clicks,
           r.effective_manual_blocks,
           r.manual_blocks_reached_at,
           r.auto_blocks,
           ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER_R}) AS rank
    FROM season_rankings r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id   = ?
      AND ${where}
    ORDER BY ${RANK_ORDER_R}
    LIMIT ? OFFSET ?
  `).all(seasonId, limit, offset).map(r => (r.effective_manual_blocks > 0 ? r : { ...r, rank: null }));
}

/** Nombre total de joueurs classés dans une saison (pour la pagination). */
function countSeasonActivePlayers(seasonId, { includeUnranked = false } = {}) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM season_rankings
    WHERE season_id = ? AND ${includeUnranked ? 'is_active = 1 AND manual_blocks > 0' : RANKED_WHERE}
  `).get(seasonId);
  return row ? row.n : 0;
}

/** Rang global d'un joueur dans la saison (basé sur effective_manual_blocks). */
function getPlayerSeasonRank(seasonId, userId) {
  return getDb().prepare(`
    SELECT rank_global FROM (
      SELECT user_id,
             ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER}) AS rank_global
      FROM season_rankings
      WHERE season_id = ? AND ${RANKED_WHERE}
    ) WHERE user_id = ?
  `).get(seasonId, userId) ?? null;
}

/**
 * Classement intraligue d'une saison (paginé).
 * Tri : RANK_ORDER (voir plus haut) — auto_blocks ignoré.
 */
function getLeagueLeaderboard(seasonId, leagueId, limit = 50, offset = 0) {
  return getDb().prepare(`
    SELECT u.id       AS user_id,
           u.username,
           r.league_id,
           r.max_depth,
           r.manual_blocks,
           r.effective_manual_blocks,
           r.manual_blocks_reached_at,
           r.auto_blocks,
           ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER_R}) AS rank_in_league
    FROM season_rankings r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id   = ?
      AND r.league_id   = ?
      AND ${RANKED_WHERE_R}
    ORDER BY ${RANK_ORDER_R}
    LIMIT ? OFFSET ?
  `).all(seasonId, leagueId, limit, offset);
}

/** Nombre de joueurs actifs dans une ligue pour cette saison (pour la pagination). */
function countLeaguePlayers(seasonId, leagueId) {
  const row = getDb().prepare(`
    SELECT COUNT(*) AS n FROM season_rankings
    WHERE season_id = ? AND league_id = ? AND ${RANKED_WHERE}
  `).get(seasonId, leagueId);
  return row ? row.n : 0;
}

/**
 * Retourne TOUS les joueurs actifs d'une ligue (sans pagination).
 * Utilisé pour le calcul de promotion. Tri RANK_ORDER (blocs manuels validés, #73).
 */
function getAllActivePlayersInLeague(seasonId, leagueId) {
  return getDb().prepare(`
    SELECT u.id AS user_id, u.username, r.max_depth, r.manual_blocks, r.effective_manual_blocks, r.auto_blocks
    FROM season_rankings r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id   = ?
      AND r.league_id   = ?
      AND ${RANKED_WHERE_R}
    ORDER BY ${RANK_ORDER_R}
  `).all(seasonId, leagueId);
}

/**
 * Participants d'une saison dans l'ordre du classement (instantané figé #29) : mêmes critères
 * d'entrée que le classement affiché (actif, au moins un bloc manuel), aucune pagination.
 */
function getSeasonParticipantsRanked(seasonId) {
  return getDb().prepare(`
    SELECT r.user_id, r.league_id, r.max_depth, r.effective_manual_blocks, r.manual_blocks,
           r.max_depth_reached_at, r.manual_blocks_reached_at, (u.id IS NOT NULL) AS user_exists
    FROM season_rankings r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.season_id = ? AND r.is_active = 1 AND r.manual_blocks > 0
    ORDER BY ${RANK_ORDER_R}
  `).all(seasonId);
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
             ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER}) AS rank_in_league
      FROM season_rankings
      WHERE season_id   = ?
        AND league_id   = ?
        AND ${RANKED_WHERE}
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

/** Insère un événement dans le journal anti-autoclicker. `details` : objet sérialisé en JSON (optionnel). */
function insertAntiCheatLog(userId, username, seasonId, periodSecs, periodClicks, inferredCps, regularityScore, effectiveRatio, actionTaken, details = null) {
  getDb().prepare(`
    INSERT INTO anticheat_logs
      (user_id, username, season_id, period_seconds, period_clicks, inferred_cps, regularity_score, effective_ratio, action_taken, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, username ?? '', seasonId ?? null, periodSecs, periodClicks, inferredCps, regularityScore, effectiveRatio, actionTaken,
         details == null ? null : JSON.stringify(details));
}

// ── Helpers validation de profondeur (ticket #9) ──────────────────────────────

/** Retourne l'état de validation de profondeur d'un joueur, ou null. */
function getDepthTracking(userId) {
  return getDb().prepare('SELECT * FROM player_depth_tracking WHERE user_id = ?').get(userId) ?? null;
}

/** Crée ou remplace l'état de validation de profondeur d'un joueur. */
function upsertDepthTracking(userId, t) {
  getDb().prepare(`
    INSERT INTO player_depth_tracking
      (user_id, season_id, ref_clicks, ref_auto, hand_tokens, auto_tokens, accepted_depth, last_gap, updated_ms,
       dmg_depth, dmg_credit, dmg_ref_clicks, dmg_gap, xhp_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      season_id      = excluded.season_id,
      ref_clicks     = excluded.ref_clicks,
      ref_auto       = excluded.ref_auto,
      hand_tokens    = excluded.hand_tokens,
      auto_tokens    = excluded.auto_tokens,
      accepted_depth = excluded.accepted_depth,
      last_gap       = excluded.last_gap,
      updated_ms     = excluded.updated_ms,
      dmg_depth      = excluded.dmg_depth,
      dmg_credit     = excluded.dmg_credit,
      dmg_ref_clicks = excluded.dmg_ref_clicks,
      dmg_gap        = excluded.dmg_gap,
      xhp_state      = excluded.xhp_state
  `).run(userId, t.season_id ?? null, t.ref_clicks, t.ref_auto, t.hand_tokens, t.auto_tokens, t.accepted_depth, t.last_gap, t.updated_ms,
         t.dmg_depth ?? null, t.dmg_credit ?? null, t.dmg_ref_clicks ?? null, t.dmg_gap ?? 0,
         t.xhp_state == null ? null : typeof t.xhp_state === 'string' ? t.xhp_state : JSON.stringify(t.xhp_state));
}

/**
 * Correction admin d'une ligne de classement (valeurs imposées, pas de MAX).
 * Met aussi à jour les états de validation de la même saison pour que la sauvegarde
 * suivante du joueur ne rétablisse pas l'ancienne valeur.
 * @param {{ maxDepth?: number, effectiveManualBlocks?: number }} fields
 * @returns {{ before: object, after: object } | null}  null si la ligne n'existe pas
 */
function correctSeasonRanking(seasonId, userId, fields) {
  const db = getDb();
  return db.transaction(() => {
    const before = getPlayerSeasonEntry(seasonId, userId);
    if (!before) return null;
    if (fields.maxDepth != null) {
      db.prepare('UPDATE season_rankings SET max_depth = ?, updated_at = datetime(\'now\') WHERE season_id = ? AND user_id = ?')
        .run(fields.maxDepth, seasonId, userId);
      db.prepare('UPDATE player_depth_tracking SET accepted_depth = ?, last_gap = 0, dmg_depth = ?, dmg_gap = 0 WHERE user_id = ? AND season_id = ?')
        .run(fields.maxDepth, fields.maxDepth, userId, seasonId);
    }
    if (fields.effectiveManualBlocks != null) {
      db.prepare(`UPDATE season_rankings SET effective_manual_blocks = ?, updated_at = datetime('now'),
          manual_blocks_reached_at = CASE WHEN ? <> effective_manual_blocks THEN ${NOW_MS} ELSE manual_blocks_reached_at END
        WHERE season_id = ? AND user_id = ?`)
        .run(fields.effectiveManualBlocks, fields.effectiveManualBlocks, seasonId, userId);
      db.prepare('UPDATE player_click_tracking SET accepted_blocks = ? WHERE user_id = ? AND season_id = ?')
        .run(fields.effectiveManualBlocks, userId, seasonId);
    }
    return { before, after: getPlayerSeasonEntry(seasonId, userId) };
  })();
}

/**
 * Retourne les derniers événements anti-autoclicker (tri chrono inverse), filtrés en SQL par
 * action si demandé (avant #25 recette 03/11, le filtre ne portait que sur les 100 dernières lignes).
 */
function getAntiCheatLogs(limit = 100, offset = 0, action = null) {
  return action
    ? getDb().prepare(`SELECT * FROM anticheat_logs WHERE action_taken = ? ORDER BY logged_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(action, limit, offset)
    : getDb().prepare(`SELECT * FROM anticheat_logs ORDER BY logged_at DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset);
}

/** Compte des événements journalisés (pour une action donnée, ou tous). */
function countAntiCheatLogs(action = null) {
  return action
    ? getDb().prepare('SELECT COUNT(*) AS n FROM anticheat_logs WHERE action_taken = ?').get(action).n
    : getDb().prepare('SELECT COUNT(*) AS n FROM anticheat_logs').get().n;
}

/**
 * Couverture du contrôle anti-autoclic sur une saison : les sauvegardes normales ne sont pas
 * journalisées, mais chaque contrôle met à jour player_click_tracking.last_save_at.
 * @returns {{ players: number, checkedLast24h: number, lastCheckAt: string|null }}
 */
function getAntiCheatCoverage(seasonId) {
  if (seasonId == null) return { players: 0, checkedLast24h: 0, lastCheckAt: null };
  const r = getDb().prepare(`
    SELECT COUNT(*) AS players,
           SUM(last_save_at >= datetime('now', '-1 days')) AS recent,
           MAX(last_save_at) AS last
    FROM player_click_tracking WHERE season_id = ?
  `).get(seasonId);
  return { players: r.players, checkedLast24h: r.recent ?? 0, lastCheckAt: r.last ?? null };
}

/**
 * Met à jour le compteur de blocs effectifs (validés serveur) pour une entrée de classement,
 * jamais au-delà des blocs déclarés. Date le total quand il change (départage #73) : une
 * sauvegarde sans nouveau bloc validé ne déplace pas le joueur derrière ses ex æquo.
 */
function updateEffectiveBlocks(seasonId, userId, effectiveManualBlocks) {
  getDb().prepare(`
    UPDATE season_rankings SET
      manual_blocks_reached_at = CASE WHEN MIN(?, manual_blocks) <> effective_manual_blocks THEN ${NOW_MS}
                                      ELSE manual_blocks_reached_at END,
      effective_manual_blocks  = MIN(?, manual_blocks)
    WHERE season_id = ? AND user_id = ?
  `).run(effectiveManualBlocks, effectiveManualBlocks, seasonId, userId);
}

/**
 * Retourne toutes les ligues avec les compteurs de joueurs pour une saison donnée.
 * total_players  : tous les joueurs actuellement dans cette ligue
 * active_players : joueurs classés dans la saison (RANKED_WHERE : blocs manuels validés > 0)
 */
function getAllLeaguesWithStats(seasonId) {
  return getDb().prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM users WHERE league_id = l.id) AS total_players,
      COALESCE(
        (SELECT COUNT(*) FROM season_rankings
         WHERE season_id = ? AND league_id = l.id AND ${RANKED_WHERE}),
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

/**
 * Suggestions de pseudos pour l'autocomplétion admin (#37, recette du 03/11).
 * Ne renvoie que l'identifiant stable et le pseudo (jamais l'e-mail). Les jokers LIKE saisis
 * (% et _) sont pris au pied de la lettre. Les pseudos qui commencent par la saisie passent
 * en premier, puis ordre alphabétique.
 * @param {string} q
 * @param {number} [limit=10]
 * @returns {Array<{id:number, username:string}>}
 */
function suggestUsers(q, limit = 10) {
  const term = String(q ?? '').toLowerCase().trim().replace(/[\\%_]/g, c => '\\' + c);
  if (!term) return [];
  const n = Math.max(1, Math.min(20, parseInt(limit, 10) || 10));
  return getDb().prepare(
    `SELECT id, username FROM users
      WHERE LOWER(username) LIKE ? ESCAPE '\\'
      ORDER BY (LOWER(username) LIKE ? ESCAPE '\\') DESC, LOWER(username), id
      LIMIT ?`
  ).all(`%${term}%`, `${term}%`, n);
}

function setAdminConfig(key, value) {
  getDb().prepare(
    `INSERT INTO admin_config (key, value, updated_at) VALUES (?,?,datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`
  ).run(key, String(value));
}

module.exports = {
  getSeasonParticipantsRanked,
  getUserAuth,
  getUserAuthVersion,
  createAuthToken,
  secondsSinceLastAuthToken,
  consumeAuthToken,
  setUserPassword,
  setUserEmailVerified,
  getIdentity,
  getUserIdentities,
  addUserIdentity,
  touchUserIdentity,
  removeUserIdentity,
  initDb, getDb,
  upsertPlayer, getSave, upsertSave, deleteSave, logEvent, logUserEvent, runTransaction,
  createUser, getUserByUsername, getUserById, getUserByEmail,
  getUserSave, upsertUserSave,
  getActiveSeason, getSeasonById, createSeason, updateSeason, getAllSeasons,
  getNextScheduledSeason, getLastEndedSeason, seasonNameExists,
  getAllLeagues, createLeague, updateLeague, deleteLeague, getLeagueForRank,
  getLowestLeague, getLeagueById, getLeagueByLevel, getHighestLeague,
  getUserLeague, setUserLeague,
  getAllActivePlayersInLeague,
  upsertSeasonRanking,
  getSeasonLeaderboard, countSeasonActivePlayers, getPlayerSeasonRank,
  getLeagueLeaderboard, countLeaguePlayers, getPlayerLeagueRank,
  getPlayerSeasonEntry, getOrCreateSeasonEntry, updateAutoBlocksOnly,
  getAdminConfig, setAdminConfig, searchUsers, suggestUsers,
  getAllLeaguesWithStats,
  getClickTracking, upsertClickTracking,
  insertAntiCheatLog, getAntiCheatLogs, countAntiCheatLogs, getAntiCheatCoverage,
  updateEffectiveBlocks,
  getDepthTracking, upsertDepthTracking, correctSeasonRanking,
};
