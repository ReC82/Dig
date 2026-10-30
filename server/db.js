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

  // Index alignés sur le tri réel des classements et des promotions (#19) :
  // max_depth DESC, effective_manual_blocks DESC, user_id ASC. Ajout seul, idempotent.
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
  }
  // Classement saisonnier figé (#29). Ajouts seuls, idempotents.
  // max_depth_reached_at : instant (UTC, ms) où la profondeur max retenue a été atteinte —
  // départage « premier arrivé ». Lignes existantes : NULL, classées après à égalité.
  const rankCols29 = _db.prepare("PRAGMA table_info(season_rankings)").all().map(r => r.name);
  if (!rankCols29.includes('max_depth_reached_at')) {
    _db.prepare('ALTER TABLE season_rankings ADD COLUMN max_depth_reached_at TEXT').run();
    console.log('[db] Migration : season_rankings.max_depth_reached_at ajouté (#29)');
  }
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
  // Anti-bot (#25) : observation sans sanction (lot A), budget de dégâts appliqué (lot B)
  cfgStmt.run('antibot_mode',                 'shadow');
  cfgStmt.run('damage_budget_mode',           'enforce');
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
    .prepare('SELECT id, username, email, email_verified_at, auth_version, password_hash FROM users WHERE id = ?')
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
 * Ordre unique de tous les classements (vivant, ligue, promotions, instantané figé #29) :
 * profondeur ↓, blocs manuels validés ↓, premier à avoir atteint la profondeur ↑ (sans date :
 * après), identifiant ↑. Entièrement déterministe, aucun hasard.
 */
const RANK_ORDER = 'max_depth DESC, effective_manual_blocks DESC, (max_depth_reached_at IS NULL) ASC, max_depth_reached_at ASC, user_id ASC';
const RANK_ORDER_R = RANK_ORDER.replace(/\b(max_depth|effective_manual_blocks|max_depth_reached_at|user_id)\b/g, 'r.$1');

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
 * Tri : RANK_ORDER — profondeur, blocs validés anti-cheat, premier arrivé (#29), puis user_id.
 * auto_blocks jamais utilisé pour le tri.
 */
function getSeasonLeaderboard(seasonId, limit = 50, offset = 0) {
  return getDb().prepare(`
    SELECT u.id       AS user_id,
           u.username,
           r.league_id,
           r.max_depth,
           r.reported_max_depth,
           r.manual_blocks,
           r.manual_clicks,
           r.effective_manual_blocks,
           r.auto_blocks,
           ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER_R}) AS rank
    FROM season_rankings r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id   = ?
      AND r.is_active    = 1
      AND r.manual_blocks > 0
    ORDER BY ${RANK_ORDER_R}
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
             ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER}) AS rank_global
      FROM season_rankings
      WHERE season_id = ? AND is_active = 1 AND manual_blocks > 0
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
           r.auto_blocks,
           ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER_R}) AS rank_in_league
    FROM season_rankings r
    JOIN users u ON u.id = r.user_id
    WHERE r.season_id   = ?
      AND r.league_id   = ?
      AND r.is_active   = 1
      AND r.manual_blocks > 0
    ORDER BY ${RANK_ORDER_R}
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
           r.max_depth_reached_at, (u.id IS NOT NULL) AS user_exists
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
       dmg_depth, dmg_credit, dmg_ref_clicks, dmg_gap)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      dmg_gap        = excluded.dmg_gap
  `).run(userId, t.season_id ?? null, t.ref_clicks, t.ref_auto, t.hand_tokens, t.auto_tokens, t.accepted_depth, t.last_gap, t.updated_ms,
         t.dmg_depth ?? null, t.dmg_credit ?? null, t.dmg_ref_clicks ?? null, t.dmg_gap ?? 0);
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
      db.prepare('UPDATE season_rankings SET effective_manual_blocks = ?, updated_at = datetime(\'now\') WHERE season_id = ? AND user_id = ?')
        .run(fields.effectiveManualBlocks, seasonId, userId);
      db.prepare('UPDATE player_click_tracking SET accepted_blocks = ? WHERE user_id = ? AND season_id = ?')
        .run(fields.effectiveManualBlocks, userId, seasonId);
    }
    return { before, after: getPlayerSeasonEntry(seasonId, userId) };
  })();
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
  getAdminConfig, setAdminConfig, searchUsers,
  getAllLeaguesWithStats,
  getClickTracking, upsertClickTracking,
  insertAntiCheatLog, getAntiCheatLogs, countAntiCheatLogs,
  updateEffectiveBlocks,
  getDepthTracking, upsertDepthTracking, correctSeasonRanking,
};
