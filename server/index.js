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
 * Routes API :
 *   GET  /health                     → statut du serveur
 *   (L'ancienne API anonyme /api/players/:token/* est supprimée — 404, ticket #14.)
 *
 * Routes API — Comptes utilisateurs (session) :
 *   POST /api/register               → crée un compte (username + password)
 *   POST /api/login                  → ouvre une session
 *   GET  /api/me                     → retourne l'utilisateur connecté (ou null)
 *   POST /api/logout                 → détruit la session
 *   E-mail vérifié, mot de passe oublié / changé, changement d'adresse : server/accountRoutes.js (#28)
 */

require('dotenv').config();

const express   = require('express');
const session   = require('express-session');
const FileStore = require('session-file-store')(session);
const bcrypt    = require('bcryptjs');
const path      = require('path');
const fs        = require('fs');

const { APP_VERSION } = require('./version');

const {
  initDb,
  logUserEvent,
  runTransaction,
  createUser,
  getUserByUsername,
  getUserById,
  getUserByEmail,
  getUserAuth,
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
  correctSeasonRanking,
  insertAntiCheatLog,
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
  startSeasonScheduler,
} = require('./seasons');
const { normalizeDate, parseUtc, endBefore } = require('./seasonCalendar');

const { SHOP_CHESTS, rollChest } = require('./chestShop');
const { validateEconomyValue } = require('./economy');
const security = require('./security');
const { createRateLimiters } = require('./rateLimits');
const antibot = require('./antibot');
const { isValidEmail, intParam } = require('./validation');
const { createMailer } = require('./mailer');
const { registerAccountRoutes, authVersionGuard, publicAccount } = require('./accountRoutes');

// Secrets : refus de démarrer en production sans SESSION_SECRET solide (#12)
let SESSION_SECRET, ADMIN_SECRET;
try {
  SESSION_SECRET = security.resolveSessionSecret();
  ADMIN_SECRET   = security.resolveAdminSecret();
} catch (err) {
  console.error(`[security] ${err.message}`);
  process.exit(1);
}

const app  = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Limitation de débit : connexion, inscription, sauvegarde cloud (#14), coffres (#25)
const limit = createRateLimiters();

// Journal de sécurité (#25) : IP hachées avec une clé dérivée du secret de session
antibot.configure({ ipSecret: SESSION_SECRET });

// E-mails de compte (#28) : désactivés tant que le SMTP n'est pas configuré
const mailer = createMailer();

// ── Middlewares ───────────────────────────────────────────────────────────────

// Derrière nginx (même machine) : req.secure / req.ip reflètent le client réel
app.set('trust proxy', security.parseTrustProxy(process.env.TRUST_PROXY));
app.disable('x-powered-by');
app.use(security.securityHeaders);

// Sessions persistées sur disque — survivent aux redémarrages du serveur
app.use(session({
  store: new FileStore({
    // SESSIONS_DIR : chemin absolu ou relatif à server/data/ (tests : dossier temporaire).
    path:         path.resolve(__dirname, 'data', process.env.SESSIONS_DIR || 'sessions'),
    ttl:          7 * 24 * 3600,   // 7 jours en secondes
    reapInterval: 3600,            // nettoie les sessions expirées chaque heure
    logFn:        () => {},        // silence les logs de session-file-store
  }),
  secret:            SESSION_SECRET,
  resave:            false,
  saveUninitialized: false,
  cookie:            {
    maxAge:   7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure:   security.cookieSecure(), // true en production : cookie envoyé en HTTPS uniquement
  },
}));

// Mot de passe changé ailleurs : les autres sessions du compte sont fermées (#28)
app.use(authVersionGuard);

// Parse les corps JSON (les saves font quelques Ko au maximum)
app.use(express.json({ limit: '512kb' }));

// ── Cache busting ─────────────────────────────────────────────────────────────

const _publicDir = path.join(__dirname, '..', 'public');
const _htmlCache = new Map(); // Fichiers HTML pré-traités, mis en cache pour la durée du process

/**
 * Injecte ?v=APP_VERSION sur tous les assets locaux d'un fichier HTML
 * et expose window.APP_VERSION avant </head>.
 */
function _versionHtml(raw) {
  return raw
    // Ajoute ?v= sur les assets locaux (href/src). Écrase un ?v= existant.
    .replace(
      /((?:href|src)=")(?!https?:\/\/|\/\/)([^"]+\.(?:css|js|png|jpg|jpeg|svg|ico|webp|gif))(?:\?[^"]*)?"/g,
      (_m, prefix, assetPath) => `${prefix}${assetPath}?v=${APP_VERSION}"`,
    )
    // Injecte window.APP_VERSION juste avant </head>
    .replace('</head>', `  <script>window.APP_VERSION='${APP_VERSION}';</script>\n</head>`);
}

function _getVersionedHtml(filePath) {
  if (!_htmlCache.has(filePath)) {
    try {
      _htmlCache.set(filePath, _versionHtml(fs.readFileSync(filePath, 'utf8')));
    } catch {
      return null;
    }
  }
  return _htmlCache.get(filePath);
}

/**
 * Middleware : intercepte les requêtes vers des fichiers .html (et les index de dossiers)
 * AVANT express.static pour contrôler les headers et injecter la version.
 */
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  let reqPath = req.path;
  if (reqPath.endsWith('/'))    reqPath += 'index.html';
  if (!reqPath.endsWith('.html')) return next();

  const filePath = path.join(_publicDir, reqPath);
  const html     = _getVersionedHtml(filePath);
  if (!html) return next();

  res.setHeader('Content-Type',  'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('X-App-Version', APP_VERSION);
  res.send(html);
});

/**
 * PWA (#21) : service worker servi avec la version injectée et sans cache HTTP,
 * pour que chaque déploiement installe un nouveau worker et purge l'ancien cache.
 */
let _swSource = null;
app.get('/sw.js', (_req, res, next) => {
  if (_swSource === null) {
    try {
      _swSource = fs.readFileSync(path.join(_publicDir, 'sw.js'), 'utf8')
        .replace(/__APP_VERSION__/g, APP_VERSION);
    } catch {
      return next();
    }
  }
  res.setHeader('Content-Type',  'text/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(_swSource);
});

// Fichiers non versionnés (pas de ?v=) : toujours revalidés.
const _NO_CACHE_FILES = new Set(['manifest.webmanifest', 'library.json']);

// Sert tout le dossier public/ avec headers de cache longs pour les assets versionnés
app.use(express.static(_publicDir, {
  etag:         true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html') || _NO_CACHE_FILES.has(path.basename(filePath))) {
      // Sécurité : ne devrait pas passer ici (intercepté avant), mais au cas où
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      // Assets avec ?v= → mise en cache permanente (URL change à chaque déploiement)
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// ── Validation ────────────────────────────────────────────────────────────────

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


// ── Routes API ────────────────────────────────────────────────────────────────

/**
 * GET /health
 * Sanity-check : retourne ok + timestamp.
 */
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * GET /api/version
 * Retourne la version courante du serveur. Utilisé par le client pour détecter
 * une mise à jour pendant qu'une session est ouverte.
 */
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ version: APP_VERSION });
});

// ── Routes comptes utilisateurs ───────────────────────────────────────────────

/**
 * POST /api/register
 * Body : { username, email, password }
 * Crée un compte, ouvre une session et retourne l'utilisateur.
 */
app.post('/api/register', limit.register, async (req, res) => {
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

  // Message identique pour le nom et l'e-mail : l'inscription ne révèle pas
  // si une adresse e-mail possède déjà un compte (#14).
  if (getUserByUsername(username) || getUserByEmail(email)) {
    return res.status(409).json({ error: 'Ce nom d\'utilisateur ou cette adresse e-mail est déjà utilisé.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const user = createUser(username, email, hash);
    req.session.userId      = user.id;
    req.session.authVersion = 0;
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
app.post('/api/login', limit.login, async (req, res) => {
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
    req.session.userId      = row.id;
    req.session.authVersion = row.auth_version ?? 0;
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
    const mail = mailer.enabled;
    if (!req.session.userId) return res.json({ user: null, mail });
    const user = getUserAuth(req.session.userId);
    if (!user) { req.session.destroy(() => {}); return res.json({ user: null, mail }); }
    res.json({ user: publicAccount(user), mail });
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

// E-mail vérifié et récupération de compte (#28)
registerAccountRoutes(app, { limit, mailer });

// ── Routes sauvegardes cloud (liées au compte) ────────────────────────────────

/**
 * GET /api/me/save
 * Retourne la sauvegarde cloud de l'utilisateur connecté.
 */
app.get('/api/me/save', (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    const row = getUserSave(req.session.userId);
    res.json({ save: savePayload(row) });
  } catch (err) {
    console.error('[GET /api/me/save]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/** Sauvegarde renvoyée au client : `revision` = révision serveur (alias historique `version`). */
function savePayload(row) {
  if (!row) return null;
  return { data: JSON.parse(row.data), revision: row.version, version: row.version, saved_at: row.saved_at };
}

/**
 * POST /api/me/save
 * Body : { data: { ...GameState }, baseRevision?: number|null }
 * Crée ou écrase la sauvegarde cloud de l'utilisateur connecté.
 * `baseRevision` = révision serveur sur laquelle le client a travaillé (null : aucune
 * sauvegarde connue). Si la sauvegarde a changé depuis (autre onglet ou appareil,
 * coffre, reset admin), la sauvegarde est refusée en 409 avec la version actuelle,
 * que le client applique au lieu de l'écraser (#18). Sans `baseRevision` (ancien client
 * encore ouvert), l'écriture reste acceptée comme avant.
 */
app.post('/api/me/save', limit.save, (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    const { data, baseRevision, telemetry } = req.body ?? {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'Champ "data" manquant ou invalide.' });
    if (baseRevision !== undefined && baseRevision !== null && !Number.isSafeInteger(baseRevision)) {
      return res.status(400).json({ error: 'Champ "baseRevision" invalide.' });
    }
    const result = upsertUserSave(req.session.userId, JSON.stringify(data), { expectedVersion: baseRevision });
    if (result.conflict) {
      return res.status(409).json({ error: 'Sauvegarde obsolète.', conflict: true, save: savePayload(result.current) });
    }
    const { version } = result;
    // Sync saisonnier piggybacked
    if (data.seasonStats) {
      try { checkAndRotateSeason(); syncPlayerRanking(req.session.userId, data.seasonStats, { telemetry, ip: req.ip }); }
      catch (err) { console.error('[POST /api/me/save] sync saisonnier', err.message); }
    }
    res.json({ ok: true, revision: version, version });
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
    const page     = intParam(req.query.page, { def: 1, min: 1 });
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
    const page     = intParam(req.query.page, { def: 1, min: 1 });
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
    const page     = intParam(req.query.page, { def: 1, min: 1 });
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
  if (!ADMIN_SECRET) return res.status(503).json({ error: 'Panel admin non configuré (ADMIN_SECRET manquant ou trop court).' });
  if (!security.isValidBearer(req.headers['authorization'], ADMIN_SECRET)) return res.status(401).json({ error: 'Accès refusé.' });
  next();
}

// Journal d'audit admin (#25, lot A) : toute action admin qui modifie quelque chose
// (POST/PUT/DELETE authentifié) est tracée dans security_events — route, statut, champs
// envoyés (noms seulement ; les valeurs de config sont tracées par PUT /api/admin/config).
app.use('/api/admin', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (!ADMIN_SECRET || !security.isValidBearer(req.headers['authorization'], ADMIN_SECRET)) return;
    try {
      const fields = req.body && typeof req.body === 'object' ? Object.keys(req.body).slice(0, 20) : [];
      antibot.logSecurityEvent('admin_action', {
        details: { method: req.method, path: req.originalUrl.slice(0, 200), status: res.statusCode, fields },
        ip: req.ip,
      });
    } catch (err) { console.error('[antibot] audit admin', err.message); }
  });
  next();
});

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

const SEASON_STATUSES = ['scheduled', 'active', 'closed', 'archived'];

/** Erreur SQLite de l'index « une seule saison active » (#16). */
const isOneActiveViolation = err => err?.code === 'SQLITE_CONSTRAINT_UNIQUE' && /seasons\.status/.test(err.message);

/**
 * POST /api/admin/seasons — dates normalisées en UTC "YYYY-MM-DD HH:MM:SS" (#16).
 * Début futur → saison 'scheduled', activée par la rotation à sa date ; sinon 'active',
 * refusé (409) si une saison est déjà active.
 */
app.post('/api/admin/seasons', requireAdmin, (req, res) => {
  try {
    const { name, start_at, end_at } = req.body ?? {};
    if (!name || !start_at || !end_at) return res.status(400).json({ error: 'Champs name, start_at, end_at requis.' });
    const start = normalizeDate(start_at), end = normalizeDate(end_at);
    if (!start || !end) return res.status(400).json({ error: 'Dates invalides (format attendu : YYYY-MM-DD HH:MM:SS, UTC).' });
    if (end <= start)   return res.status(400).json({ error: 'end_at doit être postérieur à start_at.' });
    const status = parseUtc(start) > new Date() ? 'scheduled' : 'active';
    if (status === 'active' && getActiveSeason()) {
      return res.status(409).json({ error: 'Une saison est déjà active : clôturez-la ou programmez une date de début future.' });
    }
    const season = createSeason(String(name), start, end, status);
    res.json({ season });
  } catch (err) {
    if (isOneActiveViolation(err)) return res.status(409).json({ error: 'Une saison est déjà active.' });
    console.error('[POST /api/admin/seasons]', err); res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.put('/api/admin/seasons/:id', requireAdmin, (req, res) => {
  try {
    const id     = parseInt(req.params.id, 10);
    const before = Number.isInteger(id) ? getSeasonById(id) : null;
    if (!before) return res.status(404).json({ error: 'Saison introuvable.' });
    const fields = {};
    const { name, start_at, end_at, status } = req.body ?? {};
    if (name)     fields.name     = String(name);
    if (start_at) fields.start_at = normalizeDate(start_at);
    if (end_at)   fields.end_at   = normalizeDate(end_at);
    if (status)   fields.status   = status;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Aucun champ à modifier.' });
    if (fields.start_at === null || fields.end_at === null) {
      return res.status(400).json({ error: 'Dates invalides (format attendu : YYYY-MM-DD HH:MM:SS, UTC).' });
    }
    if (status && !SEASON_STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    if ((fields.end_at ?? normalizeDate(before.end_at)) <= (fields.start_at ?? normalizeDate(before.start_at))) {
      return res.status(400).json({ error: 'end_at doit être postérieur à start_at.' });
    }
    if (status === 'closed' && before.status === 'active') {
      // Clôture manuelle sans promotion : la saison s'arrête maintenant, la rotation ouvre la
      // suivante à la seconde suivante (pas de trou jusqu'à l'ancienne date de fin) — #16
      const now = new Date(), plannedEnd = parseUtc(fields.end_at ?? before.end_at);
      if (!fields.end_at || !plannedEnd || plannedEnd > now) {
        fields.end_at = normalizeDate(!plannedEnd || plannedEnd > now ? endBefore(now) : plannedEnd);
      }
      fields.closed_at = normalizeDate(now);
    }
    const active = getActiveSeason();
    if (status === 'active' && active && active.id !== id) return res.status(409).json({ error: 'Une autre saison est déjà active.' });
    const season = updateSeason(id, fields);
    res.json({ season });
  } catch (err) {
    if (isOneActiveViolation(err)) return res.status(409).json({ error: 'Une autre saison est déjà active.' });
    console.error('[PUT /api/admin/seasons/:id]', err); res.status(500).json({ error: 'Erreur serveur.' });
  }
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
    const page     = intParam(req.query.page, { def: 1, min: 1 });
    if (isNaN(seasonId)) return res.status(400).json({ error: 'ID saison invalide.' });
    const result   = buildGlobalLeaderboard(seasonId, page, { admin: true });
    res.json({ leaderboard: result.leaderboard, page: result.page, total: result.total, totalPages: result.totalPages });
  } catch (err) { console.error('[GET /api/admin/seasons/:id/leaderboard]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

/**
 * PUT /api/admin/seasons/:seasonId/rankings/:userId
 * Body : { maxDepth?, effectiveManualBlocks?, reason? }
 * Corrige une ligne du classement (valeurs imposées). Journalisé dans anticheat_logs
 * (action « admin_fix ») avec les valeurs avant/après.
 */
app.put('/api/admin/seasons/:seasonId/rankings/:userId', requireAdmin, (req, res) => {
  try {
    const seasonId = parseInt(req.params.seasonId, 10);
    const userId   = parseInt(req.params.userId, 10);
    if (!Number.isInteger(seasonId) || !Number.isInteger(userId)) return res.status(400).json({ error: 'IDs invalides.' });

    const { maxDepth, effectiveManualBlocks, reason } = req.body ?? {};
    const isCount = v => Number.isSafeInteger(v) && v >= 0;
    const fields  = {};
    if (maxDepth != null) {
      if (!isCount(maxDepth)) return res.status(400).json({ error: 'maxDepth doit être un entier ≥ 0.' });
      fields.maxDepth = maxDepth;
    }
    if (effectiveManualBlocks != null) {
      if (!isCount(effectiveManualBlocks)) return res.status(400).json({ error: 'effectiveManualBlocks doit être un entier ≥ 0.' });
      fields.effectiveManualBlocks = effectiveManualBlocks;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'Aucun champ à corriger.' });

    const result = correctSeasonRanking(seasonId, userId, fields);
    if (!result) return res.status(404).json({ error: 'Ligne de classement introuvable.' });

    const { before, after } = result;
    const user = getUserById(userId);
    insertAntiCheatLog(
      userId, user?.username ?? `user_${userId}`, seasonId, 0, 0, 0, 0,
      before.max_depth > 0 ? parseFloat((after.max_depth / before.max_depth).toFixed(3)) : 1,
      'admin_fix',
      {
        before: { maxDepth: before.max_depth, effectiveManualBlocks: before.effective_manual_blocks },
        after:  { maxDepth: after.max_depth,  effectiveManualBlocks: after.effective_manual_blocks },
        reason: typeof reason === 'string' ? reason.slice(0, 200) : '',
      },
    );
    console.log(`[admin] Classement corrigé : saison ${seasonId}, joueur ${userId} — prof. ${before.max_depth}→${after.max_depth}, blocs ${before.effective_manual_blocks}→${after.effective_manual_blocks}`);
    res.json({ ok: true, ranking: {
      userId, maxDepth: after.max_depth, reportedMaxDepth: after.reported_max_depth,
      effectiveManualBlocks: after.effective_manual_blocks,
    } });
  } catch (err) {
    console.error('[PUT /api/admin/seasons/:seasonId/rankings/:userId]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Classement intraligue admin
app.get('/api/admin/seasons/:seasonId/leagues/:leagueId/leaderboard', requireAdmin, (req, res) => {
  try {
    const seasonId = parseInt(req.params.seasonId, 10);
    const leagueId = parseInt(req.params.leagueId, 10);
    const page     = intParam(req.query.page, { def: 1, min: 1 });
    if (isNaN(seasonId) || isNaN(leagueId)) return res.status(400).json({ error: 'IDs invalides.' });
    res.json(buildLeagueLeaderboard(seasonId, leagueId, page));
  } catch (err) { console.error('[GET /api/admin/seasons/:seasonId/leagues/:leagueId/leaderboard]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.get('/api/admin/leagues', requireAdmin, (req, res) => {
  try { res.json({ leagues: getAllLeagues() }); }
  catch (err) { console.error('[GET /api/admin/leagues]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.post('/api/admin/leagues', requireAdmin, (req, res) => {
  try {
    const { name, icon = '🏅', level = 0, rank_min, rank_max, sort_order = 0 } = req.body ?? {};
    if (!name || rank_min == null) return res.status(400).json({ error: 'Champs name et rank_min requis.' });
    const league = createLeague(name, icon, level, rank_min, rank_max ?? null, sort_order);
    res.json({ league });
  } catch (err) { console.error('[POST /api/admin/leagues]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
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
  } catch (err) { console.error('[PUT /api/admin/leagues/:id]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.delete('/api/admin/leagues/:id', requireAdmin, (req, res) => {
  try {
    deleteLeague(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (err) { console.error('[DELETE /api/admin/leagues/:id]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

app.get('/api/admin/config', requireAdmin, (req, res) => {
  try { res.json({ config: getAdminConfig() }); }
  catch (err) { console.error('[GET /api/admin/config]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

/**
 * GET /api/admin/anticheat/logs?limit=100&offset=0&action=all
 * Journal des événements anti-autoclicker.
 * Filtre optionnel : ?action=flagged|reduced|none
 */
app.get('/api/admin/anticheat/logs', requireAdmin, (req, res) => {
  try {
    const limit  = intParam(req.query.limit,  { def: 100, min: 1, max: 500 });
    const offset = intParam(req.query.offset, { def: 0, min: 0 });
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
    // Paramètres économiques bornés (#20) et interrupteurs anti-bot (#25) : appliqués sans redéploiement.
    const checked = antibot.validateConfigValue(key, value) ?? validateEconomyValue(key, value);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const previous = getAdminConfig()[key];
    setAdminConfig(key, checked.value);
    // Audit (#25) : ancienne et nouvelle valeur, seulement si la valeur change
    if (previous !== checked.value) {
      antibot.logSecurityEvent('admin_config', {
        details: { key: String(key).slice(0, 60), old: previous ?? null, new: checked.value.slice(0, 200) }, ip: req.ip,
      });
    }
    res.json({ ok: true });
  } catch (err) { console.error('[PUT /api/admin/config]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ── Admin — Anti-bot (#25, lot A) ────────────────────────────────────────────

/**
 * GET /api/admin/security/summary
 * Modes, comptes de la saison active par niveau de risque (non appliqués en shadow),
 * comptes au score le plus élevé, événements des 7 derniers jours, temps de calcul.
 */
app.get('/api/admin/security/summary', requireAdmin, (req, res) => {
  try {
    const season = getActiveSeason();
    res.json(antibot.buildSummary(season?.id ?? null, getAdminConfig()));
  } catch (err) { console.error('[GET /api/admin/security/summary]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

/**
 * GET /api/admin/security/events?limit=100&offset=0&type=&userId=
 * Journal de sécurité (signaux, changements de niveau, audit admin), du plus récent au plus ancien.
 */
app.get('/api/admin/security/events', requireAdmin, (req, res) => {
  try {
    const limit  = intParam(req.query.limit,  { def: 100, min: 1, max: 500 });
    const offset = intParam(req.query.offset, { def: 0, min: 0 });
    const type   = typeof req.query.type === 'string' && /^[a-z_]{1,40}$/.test(req.query.type) ? req.query.type : null;
    const userId = /^\d{1,10}$/.test(String(req.query.userId ?? '')) ? parseInt(req.query.userId, 10) : null;
    res.json(antibot.listEvents({ limit, offset, type, userId }));
  } catch (err) { console.error('[GET /api/admin/security/events]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ── Coffres achetables ────────────────────────────────────────────────────────

/**
 * POST /api/me/shop/chest/open
 * Body : { chestId: 'simple' | 'rare' | 'antique' }
 *
 * Valide le coût côté serveur, tire la récompense et met à jour la sauvegarde.
 * Le client ne peut pas influencer le tirage ni falsifier le coût.
 * Retourne : { ok, reward, boughtThisSeason, cost, newCoins, newRelicFragments }
 */
app.post('/api/me/shop/chest/open', limit.chest, (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });

    const { chestId } = req.body ?? {};
    if (!SHOP_CHESTS[chestId]) return res.status(400).json({ error: 'Coffre inconnu.' });

    const userId = req.session.userId;
    const config = getAdminConfig();

    // Lecture, débit/crédit et journalisation dans une seule transaction :
    // si une étape échoue, la sauvegarde n'est pas modifiée.
    const outcome = runTransaction(() => {
      const row = getUserSave(userId);
      if (!row) return { status: 404, error: 'Sauvegarde introuvable. Jouez d\'abord quelques blocs !' };

      let data;
      try { data = JSON.parse(row.data); }
      catch { return { status: 500, error: 'Sauvegarde corrompue.' }; }

      let result;
      try { result = rollChest(chestId, data, config); }
      catch (err) { return { status: 400, error: err.message }; }

      const { version } = upsertUserSave(userId, JSON.stringify(data));
      logUserEvent(userId, 'chest_shop_open', { chestId, rewardType: result.reward.type });
      return { data, result, revision: version };
    });

    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });

    const { data, result, revision } = outcome;
    res.json({
      ok:                true,
      revision,
      reward:            result.reward,
      boughtThisSeason:  result.boughtThisSeason,
      cost:              result.cost,
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
      updatedAt:       saveRow.saved_at      ?? null,
      revision:        saveRow.version,
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
    // Horodatage récent : un ancien client qui compare encore les dates garde aussi le reset (#18)
    data.lastSaveTime = Date.now();
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

    // La révision augmente : la prochaine sauvegarde du client (basée sur l'ancienne
    // révision) est refusée et le client applique le reset au lieu de l'écraser (#18).
    const revision = runTransaction(() => {
      const { version } = upsertUserSave(userId, JSON.stringify(data));
      logUserEvent(userId, 'admin_season_reset', { adminAction: true });
      return version;
    });

    res.json({ ok: true, revision, message: `Reset saisonnier appliqué pour ${userRow.username}.` });
  } catch (err) {
    console.error('[POST /api/admin/players/:userId/season-reset]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Toute autre route /api/* (dont l'ancienne API /api/players/:token/*) : 404 JSON (#14)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Route inconnue.' });
});

// Gestionnaire d'erreurs Express : un corps illisible (JSON invalide, encodage « br »
// non pris en charge, corps trop gros…) donne une réponse 4xx JSON et UNE ligne de
// journal, au lieu d'une pile complète dans journald (audit B11).
app.use((err, req, res, next) => {
  const code   = err.status ?? err.statusCode;
  const status = Number.isInteger(code) && code >= 400 && code < 600 ? code : 500;
  if (status < 500) {
    console.warn(`[http] ${status} ${req.method} ${req.path} — ${err.type ?? err.name}: ${err.message}`);
  } else {
    console.error(`[http] ${status} ${req.method} ${req.path}`, err);
  }
  if (res.headersSent) return next(err);
  const error = status === 413 ? 'Requête trop volumineuse.'
              : status < 500   ? 'Requête invalide.'
              : 'Erreur serveur.';
  res.status(status).json({ error });
});

// ── Démarrage ─────────────────────────────────────────────────────────────────

// Exception non gérée : l'état du processus n'est plus fiable. On journalise et on
// quitte ; systemd (Restart=always) relance un processus sain (audit, risques P3).
// Une promesse rejetée non gérée est seulement journalisée.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] arrêt du processus', err);
  process.exit(1);
});
process.on('unhandledRejection', (r) => console.error('[unhandledRejection]', r));

// Initialise la base (crée server/data/ + tables si absents)
initDb();

// Rotation planifiée des saisons : une passe au démarrage puis chaque minute (#16)
startSeasonScheduler();

// Purge du journal de sécurité de plus de 90 jours (#25) : au démarrage puis toutes les 12 h
antibot.startPurgeScheduler();

app.listen(PORT, HOST, () => {
  console.log(`\n⛏  DIG! server — http://${HOST}:${PORT}\n`);
});
