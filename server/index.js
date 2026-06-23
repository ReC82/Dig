/**
 * server/index.js
 * Point d'entrée Express du jeu DIG!
 *
 * Démarrage : npm start
 *             npm run dev  (rechargement automatique via nodemon)
 *
 * Routes statiques :
 *   GET  /*                          → public/  (le jeu HTML/CSS/JS)
 *
 * Routes API — Sauvegardes anonymes (token UUID) :
 *   GET  /health                     → statut du serveur
 *   POST /api/players/register       → crée ou retrouve un joueur par token
 *   GET  /api/players/:token/save    → charge la sauvegarde
 *   POST /api/players/:token/save    → crée / met à jour la sauvegarde
 *   DELETE /api/players/:token/save  → supprime la sauvegarde (reset)
 *
 * Routes API — Comptes utilisateurs (session) :
 *   POST /api/register               → crée un compte (username + password)
 *   POST /api/login                  → ouvre une session
 *   GET  /api/me                     → retourne l'utilisateur connecté (ou null)
 *   POST /api/logout                 → détruit la session
 */

require('dotenv').config();

const express   = require('express');
const session   = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt    = require('bcryptjs');
const path      = require('path');

const {
  initDb,
  upsertPlayer,
  getSave,
  upsertSave,
  deleteSave,
  logEvent,
  createUser,
  getUserByUsername,
  getUserById,
  getUserByEmail,
  getUserSave,
  upsertUserSave,
  searchUsers,
  getAllSeasons,
  createSeason,
  updateSeason,
  getSeasonById,
  getAllLeagues,
  createLeague,
  updateLeague,
  deleteLeague,
  getAdminConfig,
  setAdminConfig,
  getSeasonLeaderboard,
  getActiveSeason,
  countSeasonActivePlayers,
  getAllLeaguesWithStats,
  getAntiCheatLogs,
  countAntiCheatLogs,
} = require('./db');

const {
  checkAndRotateSeason,
  closeActiveSeason,
  syncPlayerRanking,
  buildCurrentSeasonResponse,
  buildLeaderboard,
  buildGlobalLeaderboard,
  buildLeagueLeaderboard,
  buildActiveSeasonLeaderboard,
} = require('./seasons');

const { SHOP_CHESTS, rollChest } = require('./chestShop');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ───────────────────────────────────────────────────────────────

// Sessions persistées sur disque — survivent aux redémarrages du serveur
app.use(session({
  store: new FileStore({
    path:         path.join(__dirname, 'data', 'sessions'),
    ttl:          7 * 24 * 3600,   // 7 jours en secondes
    reapInterval: 3600,            // nettoie les sessions expirées chaque heure
    logFn:        () => {},        // silence les logs de session-file-store
  }),
  secret:            process.env.SESSION_SECRET || 'dig-dev-secret-change-in-prod',
  resave:            false,
  saveUninitialized: false,
  cookie:            { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' },
}));

// Parse les corps JSON (les saves font quelques Ko au maximum)
app.use(express.json({ limit: '512kb' }));

// Sert tout le dossier public/ (index.html, css/, js/)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Validation ────────────────────────────────────────────────────────────────

/** Vérifie qu'une chaîne ressemble à un UUID v4. */
function isValidToken(token) {
  return (
    typeof token === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)
  );
}

/** Normalise un nom d'utilisateur : minuscules + trim. */
function normalizeUsername(u) {
  return typeof u === 'string' ? u.toLowerCase().trim() : '';
}

/** Vérifie qu'un nom d'utilisateur normalisé est valide : 3-20 car. [a-z0-9_-]. */
function isValidUsername(u) {
  return /^[a-z0-9_-]{3,20}$/.test(u);
}

/** Vérifie qu'un mot de passe est suffisamment long. */
function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 6;
}

/** Vérifie le format d'une adresse e-mail (validation basique). */
function isValidEmail(e) {
  return typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}

// ── Routes API ────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Sanity-check : retourne ok + timestamp.
 */
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * POST /api/players/register
 * Body : { token: "<uuid-v4>" }
 *
 * Crée le joueur s'il n'existe pas encore, le retourne dans tous les cas.
 * À appeler au premier lancement et à chaque démarrage côté client.
 */
app.post('/api/players/register', (req, res) => {
  const { token } = req.body ?? {};

  if (!isValidToken(token)) {
    return res.status(400).json({ error: 'Token invalide — UUID v4 attendu.' });
  }

  const player = upsertPlayer(token);
  res.json({ player });
});

/**
 * GET /api/players/:token/save
 *
 * Retourne la sauvegarde du joueur.
 * Réponse : { save: { data, version, saved_at } } ou { save: null } si absente.
 */
app.get('/api/players/:token/save', (req, res) => {
  const { token } = req.params;

  if (!isValidToken(token)) {
    return res.status(400).json({ error: 'Token invalide.' });
  }

  const player = upsertPlayer(token);
  const row    = getSave(player.id);

  logEvent(player.id, 'load');

  if (!row) return res.json({ save: null });

  res.json({
    save: {
      data:     JSON.parse(row.data),
      version:  row.version,
      saved_at: row.saved_at,
    },
  });
});

/**
 * POST /api/players/:token/save
 * Body : { data: { ...GameState } }
 *
 * Crée ou écrase la sauvegarde. Retourne la version enregistrée.
 */
app.post('/api/players/:token/save', (req, res) => {
  const { token } = req.params;

  if (!isValidToken(token)) {
    return res.status(400).json({ error: 'Token invalide.' });
  }

  const { data } = req.body ?? {};
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'Champ "data" manquant ou invalide.' });
  }

  const player        = upsertPlayer(token);
  const { version }   = upsertSave(player.id, JSON.stringify(data));

  logEvent(player.id, 'save', { version });

  res.json({ ok: true, version });
});

/**
 * DELETE /api/players/:token/save
 *
 * Supprime la sauvegarde du joueur côté serveur (équivalent reset).
 */
app.delete('/api/players/:token/save', (req, res) => {
  const { token } = req.params;

  if (!isValidToken(token)) {
    return res.status(400).json({ error: 'Token invalide.' });
  }

  const player = upsertPlayer(token);
  deleteSave(player.id);
  logEvent(player.id, 'reset');

  res.json({ ok: true });
});

// ── Routes comptes utilisateurs ───────────────────────────────────────────────

/**
 * POST /api/register
 * Body : { username, email, password }
 * Crée un compte, ouvre une session et retourne l'utilisateur.
 */
app.post('/api/register', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const email    = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password ?? '';

  if (!isValidUsername(username)) {
    return res.status(400).json({ error: 'Nom d\'utilisateur invalide (3-20 car., lettres/chiffres/_ ou -).' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: 'Mot de passe trop court (6 caractères minimum).' });
  }

  if (getUserByUsername(username)) {
    return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris.' });
  }

  // Vérifier l'unicité de l'e-mail
  if (getUserByEmail(email)) {
    return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const user = createUser(username, email, hash);
    req.session.userId = user.id;
    res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * POST /api/login
 * Body : { username, password }  (username : insensible à la casse)
 * Vérifie les identifiants, ouvre une session et retourne l'utilisateur.
 */
app.post('/api/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = req.body?.password ?? '';

  if (!isValidUsername(username) || !isValidPassword(password)) {
    return res.status(400).json({ error: 'Identifiants invalides.' });
  }

  const row = getUserByUsername(username);
  if (!row) {
    return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect.' });
  }

  try {
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Nom d\'utilisateur ou mot de passe incorrect.' });
    }
    req.session.userId = row.id;
    res.json({ user: { id: row.id, username: row.username } });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/me
 * Retourne l'utilisateur actuellement connecté, ou { user: null }.
 */
app.get('/api/me', (req, res) => {
  try {
    if (!req.session.userId) return res.json({ user: null });
    const user = getUserById(req.session.userId);
    if (!user) { req.session.destroy(() => {}); return res.json({ user: null }); }
    res.json({ user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[GET /api/me]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * POST /api/logout
 * Détruit la session courante.
 */
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Routes sauvegardes cloud (liées au compte) ────────────────────────────────

/**
 * GET /api/me/save
 * Retourne la sauvegarde cloud de l'utilisateur connecté.
 */
app.get('/api/me/save', (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    const row = getUserSave(req.session.userId);
    if (!row) return res.json({ save: null });
    res.json({ save: { data: JSON.parse(row.data), version: row.version, saved_at: row.saved_at } });
  } catch (err) {
    console.error('[GET /api/me/save]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * POST /api/me/save
 * Body : { data: { ...GameState } }
 * Crée ou écrase la sauvegarde cloud de l'utilisateur connecté.
 */
app.post('/api/me/save', (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    const { data } = req.body ?? {};
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Champ "data" manquant ou invalide.' });
    const { version } = upsertUserSave(req.session.userId, JSON.stringify(data));
    // Sync saisonnier piggybacked
    if (data.seasonStats) {
      try { checkAndRotateSeason(); syncPlayerRanking(req.session.userId, data.seasonStats); } catch (_) {}
    }
    res.json({ ok: true, version });
  } catch (err) {
    console.error('[POST /api/me/save]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Routes saisons (publiques) ────────────────────────────────────────────────

/**
 * GET /api/seasons/current
 * Saison active + config + rang global + rang intraligue du joueur connecté.
 */
app.get('/api/seasons/current', (req, res) => {
  try {
    const userId = req.session.userId ?? null;
    res.json(buildCurrentSeasonResponse(userId));
  } catch (err) {
    console.error('[GET /api/seasons/current]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/seasons/active/leaderboard?page=1[&league=<leagueId>]
 * Classement de la saison active (global si pas de ?league, intraligue sinon).
 * DOIT être défini avant /api/seasons/:id/leaderboard pour ne pas matcher "active" comme ID.
 */
app.get('/api/seasons/active/leaderboard', (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page    ?? '1', 10));
    const leagueId = req.query.league ? parseInt(req.query.league, 10) : null;
    if (req.query.league && isNaN(leagueId)) {
      return res.status(400).json({ error: 'Paramètre league invalide.' });
    }
    const result = buildActiveSeasonLeaderboard(leagueId, page);
    if (!result) return res.status(404).json({ error: 'Aucune saison active.' });
    res.json(result);
  } catch (err) {
    console.error('[GET /api/seasons/active/leaderboard]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/seasons/:seasonId/leagues/:leagueId/leaderboard?page=1
 * Classement intraligue paginé.
 * Règles : manual_blocks > 0, tri depth DESC puis manual_blocks DESC.
 * auto_blocks jamais utilisé pour le tri.
 */
app.get('/api/seasons/:seasonId/leagues/:leagueId/leaderboard', (req, res) => {
  try {
    const seasonId = parseInt(req.params.seasonId, 10);
    const leagueId = parseInt(req.params.leagueId, 10);
    const page     = Math.max(1, parseInt(req.query.page ?? '1', 10));
    if (isNaN(seasonId) || isNaN(leagueId)) {
      return res.status(400).json({ error: 'IDs invalides.' });
    }
    res.json(buildLeagueLeaderboard(seasonId, leagueId, page));
  } catch (err) {
    console.error('[GET /api/seasons/:seasonId/leagues/:leagueId/leaderboard]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/seasons/:id/leaderboard?page=1
 * Classement global paginé d'une saison (rétrocompat + nouvelles métadonnées).
 */
app.get('/api/seasons/:id/leaderboard', (req, res) => {
  try {
    const seasonId = parseInt(req.params.id, 10);
    const page     = Math.max(1, parseInt(req.query.page ?? '1', 10));
    if (isNaN(seasonId)) return res.status(400).json({ error: 'ID saison invalide.' });
    // rétrocompat : enveloppe { leaderboard: [...] } conservée
    const result = buildGlobalLeaderboard(seasonId, page);
    res.json({ leaderboard: result.leaderboard, page: result.page, total: result.total, totalPages: result.totalPages });
  } catch (err) {
    console.error('[GET /api/seasons/:id/leaderboard]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Middleware admin ──────────────────────────────────────────────────────────

function requireAdmin(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(503).json({ error: 'Panel admin non configuré (ADMIN_SECRET manquant).' });
  const auth = req.headers['authorization'] ?? '';
  if (auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Accès refusé.' });
  next();
}

// ── Routes admin ──────────────────────────────────────────────────────────────

app.get('/api/admin/seasons', requireAdmin, (req, res) => {
  try { res.json({ seasons: getAllSeasons() }); }
  catch (err) { console.error('[GET /api/admin/seasons]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

/**
 * GET /api/admin/seasons/active/summary
 * Résumé complet de la saison active : données saison + joueurs actifs + ligues avec stats.
 * DOIT être avant /api/admin/seasons/:id pour éviter le conflit de route.
 */
app.get('/api/admin/seasons/active/summary', requireAdmin, (req, res) => {
  try {
    const season = getActiveSeason();
    if (!season) return res.status(404).json({ error: 'Aucune saison active.' });
    const activePlayers = countSeasonActivePlayers(season.id);
    const leagues       = getAllLeaguesWithStats(season.id);
    res.json({ season, activePlayers, leagues });
  } catch (err) {
    console.error('[GET /api/admin/seasons/active/summary]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/admin/seasons', requireAdmin, (req, res) => {
  try {
    const { name, start_at, end_at } = req.body ?? {};
    if (!name || !start_at || !end_at) return res.status(400).json({ error: 'Champs name, start_at, end_at requis.' });
    const season = createSeason(name, start_at, end_at);
    res.json({ season });
  } catch (err) { console.error('[POST /api/admin/seasons]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.put('/api/admin/seasons/:id', requireAdmin, (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const fields = {};
    const { name, start_at, end_at, status } = req.body ?? {};
    if (name)     fields.name     = name;
    if (start_at) fields.start_at = start_at;
    if (end_at)   fields.end_at   = end_at;
    if (status)   fields.status   = status;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Aucun champ à modifier.' });
    const season = updateSeason(id, fields);
    res.json({ season });
  } catch (err) { console.error('[PUT /api/admin/seasons/:id]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

/**
 * POST /api/admin/seasons/:id/close
 * Clôture manuellement une saison active : applique les promotions, crée la saison suivante.
 * Protection intégrée : échoue si la saison n'est pas active (évite la double clôture).
 *
 * Body optionnel : {} (aucun champ requis — toute la logique vient de la config DB)
 *
 * Réponse :
 *   { closedSeason, newSeason, report: [{ leagueId, leagueName, activePlayers, promoted, promotedUsers }] }
 */
app.post('/api/admin/seasons/:id/close', requireAdmin, (req, res) => {
  try {
    const seasonId = parseInt(req.params.id, 10);
    if (isNaN(seasonId)) return res.status(400).json({ error: 'ID saison invalide.' });
    const result = closeActiveSeason(seasonId);
    res.json(result);
  } catch (err) {
    // Erreurs métier (double-clôture, saison introuvable) → 409 ; autres → 500
    const status = err.message.includes('introuvable') ? 404
                 : err.message.includes('déjà')        ? 409
                 : 500;
    console.error('[POST /api/admin/seasons/:id/close]', err.message);
    res.status(status).json({ error: err.message });
  }
});

// Classement global admin d'une saison
app.get('/api/admin/seasons/:id/leaderboard', requireAdmin, (req, res) => {
  try {
    const seasonId = parseInt(req.params.id, 10);
    const page     = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const result   = buildGlobalLeaderboard(seasonId, page);
    res.json({ leaderboard: result.leaderboard, page: result.page, total: result.total, totalPages: result.totalPages });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// Classement intraligue admin
app.get('/api/admin/seasons/:seasonId/leagues/:leagueId/leaderboard', requireAdmin, (req, res) => {
  try {
    const seasonId = parseInt(req.params.seasonId, 10);
    const leagueId = parseInt(req.params.leagueId, 10);
    const page     = Math.max(1, parseInt(req.query.page ?? '1', 10));
    if (isNaN(seasonId) || isNaN(leagueId)) return res.status(400).json({ error: 'IDs invalides.' });
    res.json(buildLeagueLeaderboard(seasonId, leagueId, page));
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.get('/api/admin/leagues', requireAdmin, (req, res) => {
  try { res.json({ leagues: getAllLeagues() }); }
  catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.post('/api/admin/leagues', requireAdmin, (req, res) => {
  try {
    const { name, icon = '🏅', level = 0, rank_min, rank_max, sort_order = 0 } = req.body ?? {};
    if (!name || rank_min == null) return res.status(400).json({ error: 'Champs name et rank_min requis.' });
    const league = createLeague(name, icon, level, rank_min, rank_max ?? null, sort_order);
    res.json({ league });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.put('/api/admin/leagues/:id', requireAdmin, (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const fields = {};
    const { name, icon, level, rank_min, rank_max, sort_order } = req.body ?? {};
    if (name       != null) fields.name       = name;
    if (icon       != null) fields.icon       = icon;
    if (level      != null) fields.level      = level;
    if (rank_min   != null) fields.rank_min   = rank_min;
    if (rank_max   !== undefined) fields.rank_max = rank_max;
    if (sort_order != null) fields.sort_order = sort_order;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Aucun champ à modifier.' });
    const league = updateLeague(id, fields);
    res.json({ league });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.delete('/api/admin/leagues/:id', requireAdmin, (req, res) => {
  try {
    deleteLeague(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.get('/api/admin/config', requireAdmin, (req, res) => {
  try { res.json({ config: getAdminConfig() }); }
  catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

/**
 * GET /api/admin/anticheat/logs?limit=100&offset=0&action=all
 * Journal des événements anti-autoclicker.
 * Filtre optionnel : ?action=flagged|reduced|none
 */
app.get('/api/admin/anticheat/logs', requireAdmin, (req, res) => {
  try {
    const limit  = Math.min(500, Math.max(1, parseInt(req.query.limit  ?? '100', 10)));
    const offset = Math.max(0, parseInt(req.query.offset ?? '0', 10));
    const logs   = getAntiCheatLogs(limit, offset);
    const total  = countAntiCheatLogs();
    res.json({ logs, total, limit, offset });
  } catch (err) {
    console.error('[GET /api/admin/anticheat/logs]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.put('/api/admin/config', requireAdmin, (req, res) => {
  try {
    const { key, value } = req.body ?? {};
    if (!key || value == null) return res.status(400).json({ error: 'Champs key et value requis.' });
    setAdminConfig(key, value);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ── Coffres achetables ────────────────────────────────────────────────────────

/**
 * POST /api/me/shop/chest/open
 * Body : { chestId: 'simple' | 'rare' | 'antique' }
 *
 * Valide le coût côté serveur, tire la récompense et met à jour la sauvegarde.
 * Le client ne peut pas influencer le tirage ni falsifier le coût.
 * Retourne : { ok, reward, boughtThisSeason, newCoins, newRelicFragments }
 */
app.post('/api/me/shop/chest/open', (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });

    const { chestId } = req.body ?? {};
    if (!SHOP_CHESTS[chestId]) return res.status(400).json({ error: 'Coffre inconnu.' });

    const row = getUserSave(req.session.userId);
    if (!row) return res.status(404).json({ error: 'Sauvegarde introuvable. Jouez d\'abord quelques blocs !' });

    let data;
    try { data = JSON.parse(row.data); }
    catch { return res.status(500).json({ error: 'Sauvegarde corrompue.' }); }

    const config = getAdminConfig();
    let result;
    try { result = rollChest(chestId, data, config); }
    catch (err) { return res.status(400).json({ error: err.message }); }

    upsertUserSave(req.session.userId, JSON.stringify(data));
    logEvent(req.session.userId, 'chest_shop_open', { chestId, rewardType: result.reward.type });

    res.json({
      ok:                true,
      reward:            result.reward,
      boughtThisSeason:  result.boughtThisSeason,
      newCoins:          data.coins,
      newRelicFragments: data.relicFragments ?? 0,
    });
  } catch (err) {
    console.error('[POST /api/me/shop/chest/open]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Admin — Joueurs ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/players/search?q=<username>
 * Recherche des joueurs par nom d'utilisateur (max 20 résultats).
 */
app.get('/api/admin/players/search', requireAdmin, (req, res) => {
  try {
    const q = (req.query.q ?? '').trim();
    if (!q) return res.status(400).json({ error: 'Paramètre q requis.' });
    const users = searchUsers(q);
    res.json({ users });
  } catch (err) {
    console.error('[GET /api/admin/players/search]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * GET /api/admin/players/:userId/save
 * Retourne les infos clés de la sauvegarde d'un joueur (sans le blob brut complet).
 */
app.get('/api/admin/players/:userId/save', requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'userId invalide.' });

    const userRow = getUserById(userId);
    if (!userRow) return res.status(404).json({ error: 'Joueur introuvable.' });

    const saveRow = getUserSave(userId);
    if (!saveRow) return res.json({ user: userRow, save: null });

    let data;
    try { data = JSON.parse(saveRow.data); }
    catch { return res.status(500).json({ error: 'Sauvegarde corrompue.' }); }

    const summary = {
      coins:           data.coins           ?? 0,
      depth:           data.depth           ?? 1,
      pickaxeLevel:    data.pickaxeLevel     ?? 1,
      damage:          data.damage           ?? 1,
      gems:            data.gems             ?? 0,
      relicFragments:  data.relicFragments   ?? 0,
      relicsUnlocked:  Object.values(data.relics ?? {}).filter(l => l >= 1).length,
      relicsObj:       data.relics           ?? {},
      upgrades:        data.upgrades         ?? { luck: 0, bag: 0, autodig: 0 },
      shopChestsBought: data.shopChestsBought ?? { simple: 0, rare: 0, antique: 0 },
      seasonStats:     data.seasonStats      ?? {},
      saveVersion:     data.saveVersion      ?? null,
      updatedAt:       saveRow.updated_at    ?? null,
    };

    res.json({ user: userRow, save: summary });
  } catch (err) {
    console.error('[GET /api/admin/players/:userId/save]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * POST /api/admin/players/:userId/season-reset
 * Réinitialise uniquement les données saisonnières d'un joueur.
 * Conserve gems (plafonnés), reliques, fragments, collection, stats lifetime.
 * Requiert { confirm: true } dans le body.
 */
app.post('/api/admin/players/:userId/season-reset', requireAdmin, (req, res) => {
  try {
    const userId = parseInt(req.params.userId, 10);
    if (isNaN(userId)) return res.status(400).json({ error: 'userId invalide.' });
    if (req.body?.confirm !== true) return res.status(400).json({ error: 'Confirmation requise (confirm: true).' });

    const userRow = getUserById(userId);
    if (!userRow) return res.status(404).json({ error: 'Joueur introuvable.' });

    const saveRow = getUserSave(userId);
    if (!saveRow) return res.status(404).json({ error: 'Sauvegarde introuvable.' });

    let data;
    try { data = JSON.parse(saveRow.data); }
    catch { return res.status(500).json({ error: 'Sauvegarde corrompue.' }); }

    const config   = getAdminConfig();
    const gemsCap  = parseInt(config.gems_cap ?? '100', 10);
    const activeSeason = getActiveSeason();

    // Reset saisonnier — conserve tout le reste
    data.coins        = 0;
    data.depth        = 1;
    data.pickaxeLevel = 1;
    data.damage       = 1;
    data.coinBoost    = { multiplier: 1, expiresAt: 0 };
    data.upgrades     = { luck: 0, bag: 0, autodig: 0 };
    data.gems         = Math.min(data.gems ?? 0, gemsCap);
    data.shopChestsBought = { simple: 0, rare: 0, antique: 0 };
    data.seasonStats  = {
      seasonId:     activeSeason?.id ?? null,
      maxDepth:     0,
      manualBlocks: 0,
      autoBlocks:   0,
      manualClicks: 0,
      chestsOpened: 0,
      relicsUnlocked: 0,
      coinsSpent:   0,
    };

    upsertUserSave(userId, JSON.stringify(data));
    logEvent(userId, 'admin_season_reset', { adminAction: true });

    res.json({ ok: true, message: `Reset saisonnier appliqué pour ${userRow.username}.` });
  } catch (err) {
    console.error('[POST /api/admin/players/:userId/season-reset]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Démarrage ─────────────────────────────────────────────────────────────────

// Empêche le processus de mourir sur une exception non gérée
process.on('uncaughtException',   (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection',  (r)   => console.error('[unhandledRejection]', r));

// Initialise la base (crée server/data/ + tables si absents)
initDb();

app.listen(PORT, () => {
  console.log(`\n⛏  DIG! server — http://localhost:${PORT}\n`);
});
