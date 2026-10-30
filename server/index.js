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
const seasonEnd = require('./seasonEnd');
const standings = require('./standings');
const contest   = require('./contest');
const shop      = require('./shop');
const blockCatalog = require('./blockCatalog');
const blockAi      = require('./blockAi');
const iconStudio   = require('./iconStudio');
const collectionCatalog = require('./collectionCatalog');
const badges = require('./badges');
const rewardPoints = require('./rewardPoints');

const { SHOP_CHESTS, rollChest, describeChests } = require('./chestShop');
const { validateEconomyValue } = require('./economy');
const security = require('./security');
const { createRateLimiters, describeMailLimits } = require('./rateLimits');
const antibot = require('./antibot');
const playSession = require('./playSession');
const ads = require('./ads');
const legal = require('./legal');
const { isValidEmail, intParam } = require('./validation');
const { createMailer } = require('./mailer');
const { registerAccountRoutes, authVersionGuard, publicAccount } = require('./accountRoutes');
const { resolveSocialConfig, registerSocialRoutes } = require('./socialAuth');

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
if (mailer.enabled) {
  // Journal sans secret, contrôlé par scripts/dig-smtp-config.sh (#43).
  console.log(`[mail] e-mails de compte actifs : ${mailer.summary}, liens vers ${mailer.baseUrl}, limites ${describeMailLimits()}`);
  if (mailer.mode === 'smtp') {
    mailer.verify().then(r => {
      if (r.ok) console.log('[mail] connexion SMTP vérifiée');
      else console.error(`[mail] connexion SMTP refusée : ${r.error}`);
    });
  }
}

// Connexion Google via Auth0 (#28) : désactivée tant que SOCIAL_LOGIN n'est pas « link »
const socialConfig = resolveSocialConfig(process.env, { publicBaseUrl: mailer.baseUrl });
let social;   // routes enregistrées plus bas, après les routes de compte
if (socialConfig.enabled) console.log(`[social] connexion Google : mode ${socialConfig.mode}${socialConfig.users.size ? ` (${socialConfig.users.size} compte(s) autorisé(s))` : ''}`);

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

// Parse les corps JSON (les saves font quelques Ko au maximum). Exception : le téléversement
// d'icônes du panel (#40, image ≤ 4 Mo en base64) est lu par sa route, APRÈS la clé admin.
const ICON_UPLOAD_PATH = /^\/api\/admin\/icons\/targets\/[^/]+\/upload$/;
const jsonBody = express.json({ limit: '512kb' });
app.use((req, res, next) => (ICON_UPLOAD_PATH.test(req.path) ? next() : jsonBody(req, res, next)));

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
    // Compte Google en attente (#28) : proposé à la liaison, jamais lié sans confirmation.
    const socialPending = social.onPasswordLogin(req, row);
    res.json({ user: { id: row.id, username: row.username }, ...(socialPending ? { socialPending } : {}) });
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
    if (!req.session.userId) return res.json({ user: null, mail, social: social.describe(req, null) });
    const user = getUserAuth(req.session.userId);
    if (!user) { req.session.destroy(() => {}); return res.json({ user: null, mail }); }
    res.json({ user: publicAccount(user), mail, social: social.describe(req, user) });
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
  const { controllerId } = req.body ?? {};
  if (req.session.userId && playSession.isValidControllerId(controllerId)) {
    try { playSession.release(req.session.userId, controllerId); } catch (err) { console.error('[POST /api/logout] session de jeu', err.message); }
  }
  req.session.destroy(() => res.json({ ok: true }));
});

// E-mail vérifié et récupération de compte (#28)
registerAccountRoutes(app, { limit, mailer });

// Connexion Google via Auth0 Free, liaison explicite des comptes (#28)
social = registerSocialRoutes(app, { limit, mailer, config: socialConfig });


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
    const { data, baseRevision, telemetry, controllerId } = req.body ?? {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'Champ "data" manquant ou invalide.' });
    if (baseRevision !== undefined && baseRevision !== null && !Number.isSafeInteger(baseRevision)) {
      return res.status(400).json({ error: 'Champ "baseRevision" invalide.' });
    }
    if (controllerId !== undefined && !playSession.isValidControllerId(controllerId)) {
      return res.status(400).json({ error: 'Champ "controllerId" invalide.' });
    }
    // Contrôle de la session de jeu (#35) et écriture dans la même transaction : une prise de
    // contrôle par un autre appareil ne peut pas s'intercaler entre les deux.
    const result = runTransaction(() => {
      if (!playSession.mayWrite(req.session.userId, controllerId)) return { notController: true };
      return upsertUserSave(req.session.userId, JSON.stringify(data), { expectedVersion: baseRevision });
    });
    if (result.notController) return res.status(409).json(NOT_CONTROLLER);
    if (result.conflict) {
      return res.status(409).json({ error: 'Sauvegarde obsolète.', conflict: true, save: savePayload(result.current) });
    }
    const { version } = result;
    // Sync saisonnier piggybacked
    if (data.seasonStats) {
      try { checkAndRotateSeason(); syncPlayerRanking(req.session.userId, data.seasonStats, { telemetry, ip: req.ip }); }
      catch (err) { console.error('[POST /api/me/save] sync saisonnier', err.message); }
    }
    // Badges honorifiques (#38) : statistiques bornées par la profondeur retenue, attribution unique
    let badgesEarned = [];
    try { badgesEarned = badges.processSave(req.session.userId, data); }
    catch (err) { console.error('[POST /api/me/save] badges', err.message); }
    res.json({ ok: true, revision: version, version, ...(badgesEarned.length ? { badgesEarned } : {}) });
  } catch (err) {
    console.error('[POST /api/me/save]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Session de jeu unique (#35) ───────────────────────────────────────────────

const NOT_CONTROLLER = { error: 'Partie ouverte sur un autre appareil.', notController: true };

/** Valide la session et le controllerId ; renvoie l'id ou null (réponse déjà envoyée). */
function playRequest(req, res) {
  if (!req.session.userId) { res.status(401).json({ error: 'Non connecté.' }); return null; }
  const { controllerId } = req.body ?? {};
  if (!playSession.isValidControllerId(controllerId)) { res.status(400).json({ error: 'Champ "controllerId" invalide.' }); return null; }
  return controllerId;
}

/**
 * POST /api/me/play/claim
 * Body : { controllerId, onlyIfFree?: boolean }
 * Cette page devient le seul contrôleur du compte (les autres onglets et appareils ne peuvent
 * plus miner ni sauvegarder). `onlyIfFree` : uniquement si personne ne joue (bail expiré).
 * Retourne { ok, epoch, previousActive, save } — `save` = sauvegarde serveur à reprendre.
 */
app.post('/api/me/play/claim', limit.play, (req, res) => {
  try {
    const controllerId = playRequest(req, res);
    if (!controllerId) return;
    const result = playSession.claim(req.session.userId, controllerId, { onlyIfFree: req.body.onlyIfFree === true });
    if (!result.ok) return res.status(409).json({ ...NOT_CONTROLLER, epoch: result.epoch });
    res.json({ ...result, save: savePayload(getUserSave(req.session.userId)) });
  } catch (err) {
    console.error('[POST /api/me/play/claim]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

/**
 * POST /api/me/play/heartbeat
 * Body : { controllerId } → { active, canResume?, epoch }
 * Signal de présence du contrôleur actif ; une autre page apprend ainsi qu'elle a perdu la main.
 */
app.post('/api/me/play/heartbeat', limit.play, (req, res) => {
  try {
    const controllerId = playRequest(req, res);
    if (!controllerId) return;
    res.json(playSession.heartbeat(req.session.userId, controllerId));
  } catch (err) {
    console.error('[POST /api/me/play/heartbeat]', err);
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

/**
 * GET /api/seasons/:id/standings?page=1   (:id = identifiant de saison ou « last »)
 * Classement figé à la clôture (#29) : rang au mérite, éligibilité, empreinte de l'instantané.
 * `me` : la ligne du joueur connecté s'il a participé. 404 tant que la saison n'est pas figée.
 */
app.get('/api/seasons/:id/standings', (req, res) => {
  try {
    const ref  = req.params.id === 'last' ? 'last' : intParam(req.params.id, { def: NaN, min: 1 });
    if (ref !== 'last' && !Number.isInteger(ref)) return res.status(400).json({ error: 'ID saison invalide.' });
    const page = intParam(req.query.page, { def: 1, min: 1 });
    const result = standings.buildStandings(ref, { page, userId: req.session.userId ?? null });
    if (!result) return res.status(404).json({ error: 'Classement figé indisponible pour cette saison.' });
    res.json(result);
  } catch (err) {
    console.error('[GET /api/seasons/:id/standings]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Points de récompense saisonniers (#33) ───────────────────────────────────

function pointsRoute(label, fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) {
      if (err instanceof rewardPoints.PointsError || err instanceof contest.ContestError) return res.status(err.status).json({ error: err.message });
      console.error(`[${label}]`, err); res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

// Barème public et mode (simulation : points calculés, jamais crédités).
app.get('/api/points/scale', pointsRoute('GET /api/points/scale', () => rewardPoints.publicScale()));

// Portefeuille du joueur connecté : solde, historique, attributions, récompense potentielle.
app.get('/api/points/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
  pointsRoute('GET /api/points/me', r => rewardPoints.buildPlayerSummary(r.session.userId))(req, res);
});

// ── Publicité (#45) : désactivée par défaut, domaine officiel seulement ─────────

// Domaine public officiel (canonical, robots, ads.txt) ; l'adresse alternative reste
// accessible telle quelle, sans redirection (décision du propriétaire, #45).
const CANONICAL_HOST = ads.normalizeHost(process.env.CANONICAL_HOST || 'dig.lodygames.com');

function adsRoute(label, fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) {
      if (err instanceof ads.AdError) return res.status(err.status).json({ error: err.message });
      console.error(`[${label}]`, err); res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

// Configuration lue par le jeu : emplacements actifs pour CE domaine (jamais de clé de régie).
app.get('/api/ads/config', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  adsRoute('GET /api/ads/config', r => ads.publicConfig(r.hostname, { userId: r.session.userId }))(req, res);
});

// Document d'un emplacement, chargé UNIQUEMENT dans une iframe sandbox (origine opaque).
app.get('/ads/frame/:slot', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  let doc = null;
  try { doc = ads.frameDocument(req.params.slot, req.hostname); }
  catch (err) { console.error('[GET /ads/frame]', err); }
  if (!doc) return res.status(404).type('text/plain').send('');
  res.setHeader('Content-Security-Policy', doc.csp);
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=()');
  res.type('html').send(doc.html);
});

app.get('/ads.txt', (req, res) => {
  let txt = null;
  try { txt = ads.adsTxt(req.hostname); } catch (err) { console.error('[GET /ads.txt]', err); }
  if (!txt) return res.status(404).type('text/plain').send('');
  res.setHeader('Cache-Control', 'no-cache');
  res.type('text/plain').send(txt);
});

app.get('/robots.txt', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('text/plain').send(ads.robotsTxt(req.hostname, CANONICAL_HOST));
});

app.get('/legal/confidentialite', (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(legal.privacyPage(req.hostname, CANONICAL_HOST));
  } catch (err) { console.error('[GET /legal/confidentialite]', err); res.status(500).type('text/plain').send('Erreur serveur.'); }
});

// ── Boutique de cadeaux (#34) ────────────────────────────────────────────────

function shopRoute(label, fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) {
      if (err instanceof shop.ShopError || err instanceof rewardPoints.PointsError || err instanceof contest.ContestError) return res.status(err.status).json({ error: err.message });
      console.error(`[${label}]`, err); res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
  next();
}

// Catalogue public : articles visibles, coût, stock, disponibilité (« bientôt » pour le réel).
app.get('/api/shop', shopRoute('GET /api/shop', () => shop.publicCatalog()));

// Solde et commandes du joueur connecté.
app.get('/api/shop/me', requireUser, shopRoute('GET /api/shop/me', req => shop.buildPlayerView(req.session.userId)));

// Échange : { itemId, requestId } — requestId généré par le client, réutilisé en cas de renvoi.
app.post('/api/shop/orders', limit.shop, requireUser, shopRoute('POST /api/shop/orders', req =>
  shop.placeOrder(req.session.userId, Number(req.body?.itemId), req.body?.requestId)));

// Annulation par le joueur d'une commande encore en attente (points remboursés).
app.post('/api/shop/orders/:id/cancel', limit.shop, requireUser, shopRoute('POST /api/shop/orders/:id/cancel', req =>
  shop.cancelByPlayer(req.session.userId, Number(req.params.id))));

// Catalogue de blocs publié (#37) : lu par le jeu au démarrage (types désactivés compris).
app.get('/api/blocks/catalog', (req, res) => {
  try { res.set('Cache-Control', 'no-cache'); res.json(blockCatalog.publicCatalog({ format: req.query.format === '2' ? 2 : 1 })); }
  catch (err) { console.error('[GET /api/blocks/catalog]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

function catalogRoute(label, fn) {
  return async (req, res) => {
    try { res.json(await fn(req)); }
    catch (err) {
      if (err instanceof blockCatalog.CatalogError || err instanceof blockAi.AiError) {
        return res.status(err.status).json({ error: err.message, details: err.details });
      }
      console.error(`[${label}]`, err); res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

// Images de blocs créées dans le panel (#37) : stockées dans la base, URL persistante et immuable.
app.get('/media/blocks/:file', (req, res) => {
  const m = /^([a-f0-9]{16})\.webp$/.exec(String(req.params.file));
  const img = m && blockAi.getImage(m[1]);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(img.bytes);
});

// Collections saisonnières publiées (#39) : séries, objets, fiches, saisons référencées.
app.get('/api/collections/catalog', (_req, res) => {
  try { res.set('Cache-Control', 'no-cache'); res.json(collectionCatalog.publicCatalog()); }
  catch (err) { console.error('[GET /api/collections/catalog]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// Images téléversées depuis le panel (#39) : contenu adressé par empreinte, donc immuable.
app.get('/api/collections/images/:file', (req, res) => {
  const m = /^([0-9a-f]{64})\.(png|jpg|webp)$/.exec(String(req.params.file));
  const img = m && collectionCatalog.getImage(m[1], m[2]);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(img.data);
});

function collectionRoute(label, fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) {
      if (err instanceof collectionCatalog.CatalogError) return res.status(err.status).json({ error: err.message, details: err.details });
      console.error(`[${label}]`, err); res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

// Badges et succès du joueur connecté (#38) : obtenus, à obtenir, progression.
app.get('/api/me/badges', (req, res) => {
  try {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    res.set('Cache-Control', 'no-store');
    res.json(badges.playerView(req.session.userId));
  } catch (err) { console.error('[GET /api/me/badges]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

function badgeRoute(label, fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) {
      if (err instanceof badges.BadgeError) return res.status(err.status).json({ error: err.message, details: err.details });
      console.error(`[${label}]`, err); res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

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

// ── Date de fin configurable de la saison active (#44) ────────────────────────
// Aperçu → confirmation (nom exact de la saison + fin actuelle attendue) → programmation ;
// annulation tant que l'échéance n'est pas atteinte. La clôture reste celle du planificateur.
function seasonEndRoute(label, handler) {
  return (req, res) => {
    try { res.json(handler(req)); }
    catch (err) {
      if (err instanceof seasonEnd.SeasonEndError) return res.status(err.status).json({ error: err.message });
      console.error(`[${label}]`, err); res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}
const optSeasonId = v => (v == null || v === '' ? null : intParam(v, { def: NaN, min: 1 }));
app.get('/api/admin/seasons/active/end', requireAdmin, seasonEndRoute('GET /api/admin/seasons/active/end',
  () => seasonEnd.state()));
app.post('/api/admin/seasons/active/end/preview', requireAdmin, seasonEndRoute('POST /api/admin/seasons/active/end/preview',
  req => seasonEnd.preview(optSeasonId(req.body?.seasonId), seasonEnd.parseRequestedEnd(req.body))));
app.put('/api/admin/seasons/active/end', requireAdmin, seasonEndRoute('PUT /api/admin/seasons/active/end',
  req => seasonEnd.setEnd(optSeasonId(req.body?.seasonId), seasonEnd.parseRequestedEnd(req.body), {
    confirm: req.body?.confirm, expectedEndAt: req.body?.expectedEndAt, reason: req.body?.reason,
  })));
app.delete('/api/admin/seasons/active/end', requireAdmin, seasonEndRoute('DELETE /api/admin/seasons/active/end',
  req => seasonEnd.cancel(optSeasonId(req.body?.seasonId), { expectedEndAt: req.body?.expectedEndAt, reason: req.body?.reason })));

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
    // Fin de la saison active : uniquement via la route dédiée (aperçu, confirmation, audit — #44)
    if (before.status === 'active' && fields.end_at && status !== 'closed') {
      return res.status(409).json({ error: 'Fin de la saison active : utilisez « Date de fin » (PUT /api/admin/seasons/active/end).' });
    }
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
    // Clôture manuelle : le classement est figé tout de suite (#29) ; en cas d'échec, le
    // planificateur retente chaque minute.
    if (status === 'closed' && before.status === 'active') {
      try { standings.freezeSeasonStandings(id, { source: 'admin_close' }); }
      catch (err) { console.error('[PUT /api/admin/seasons/:id] classement figé', err.message); }
    }
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

// Classement figé complet d'une saison (#29) : audit (niveau de risque, blocs bruts) et
// vérification des empreintes (lignes, instantané, chaîne).
app.get('/api/admin/seasons/:id/standings', requireAdmin, (req, res) => {
  try {
    const seasonId = intParam(req.params.id, { def: NaN, min: 1 });
    if (!Number.isInteger(seasonId)) return res.status(400).json({ error: 'ID saison invalide.' });
    const result = standings.buildStandings(seasonId, { admin: true });
    if (!result) return res.status(404).json({ error: 'Classement figé indisponible pour cette saison.' });
    res.json(result);
  } catch (err) { console.error('[GET /api/admin/seasons/:id/standings]', err); res.status(500).json({ error: 'Erreur serveur.' }); }
});

// ── Concours au mérite (#30) ──────────────────────────────────────────────────
// Réglages, aperçu, attribution (aucun tirage), suivi des gagnants et journal. Cadeaux réels
// verrouillés tant que CONTEST_REAL_PRIZES ≠ « on ». Aucun e-mail ni code dans les journaux.

/** Exécute un handler du concours : ContestError → statut et message, autre erreur → 500. */
function contestRoute(label, fn) {
  return (req, res) => {
    try { res.json(fn(req)); }
    catch (err) {
      if (err instanceof contest.ContestError) return res.status(err.status).json({ error: err.message });
      console.error(`[${label}]`, err.message);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

function idParam(value, what) {
  const id = intParam(value, { def: NaN, min: 1 });
  if (!Number.isInteger(id)) throw new contest.ContestError(400, `ID ${what} invalide.`);
  return id;
}

app.get('/api/admin/contest', requireAdmin, contestRoute('GET /api/admin/contest', () => ({
  settings: contest.getSettings(), seasons: contest.listSeasons(),
  statuses: contest.STATUSES, transitions: contest.TRANSITIONS,
})));

app.put('/api/admin/contest/settings', requireAdmin, contestRoute('PUT /api/admin/contest/settings',
  req => ({ settings: contest.updateSettings(req.body) })));

app.get('/api/admin/contest/seasons/:id/preview', requireAdmin, contestRoute('GET /api/admin/contest/seasons/:id/preview',
  req => contest.preview(idParam(req.params.id, 'saison'), { mode: req.query.mode === 'real' ? 'real' : 'simulation' })));

app.post('/api/admin/contest/seasons/:id/attribute', requireAdmin, contestRoute('POST /api/admin/contest/seasons/:id/attribute',
  req => ({ winners: contest.attribute(idParam(req.params.id, 'saison'), { mode: req.body?.mode === 'real' ? 'real' : 'simulation' }) })));

app.post('/api/admin/contest/seasons/:id/exclusions', requireAdmin, contestRoute('POST /api/admin/contest/seasons/:id/exclusions',
  req => { contest.setExclusion(idParam(req.params.id, 'saison'), idParam(req.body?.userId, 'joueur'), req.body?.reason); return { ok: true }; }));

app.delete('/api/admin/contest/seasons/:id/exclusions/:userId', requireAdmin, contestRoute('DELETE /api/admin/contest/seasons/:id/exclusions/:userId',
  req => { contest.removeExclusion(idParam(req.params.id, 'saison'), idParam(req.params.userId, 'joueur')); return { ok: true }; }));

app.get('/api/admin/contest/winners', requireAdmin, contestRoute('GET /api/admin/contest/winners', req => ({
  winners: contest.listWinners({
    mode:   contest.MODES.includes(req.query.mode) ? req.query.mode : null,
    status: contest.STATUSES.includes(req.query.status) ? req.query.status : null,
  }),
})));

app.post('/api/admin/contest/winners/:id/status', requireAdmin, contestRoute('POST /api/admin/contest/winners/:id/status',
  req => ({ winner: contest.transition(idParam(req.params.id, 'gagnant'), req.body?.status, req.body?.note) })));

// Coordonnées du gagnant : POST (jamais en cache ni dans un historique d'URL), consultation journalisée.
app.post('/api/admin/contest/winners/:id/contact', requireAdmin, contestRoute('POST /api/admin/contest/winners/:id/contact',
  req => contest.contact(idParam(req.params.id, 'gagnant'))));

app.get('/api/admin/contest/audit', requireAdmin, contestRoute('GET /api/admin/contest/audit', req => contest.listAudit({
  limit:    intParam(req.query.limit,  { def: 100, min: 1, max: 500 }),
  offset:   intParam(req.query.offset, { def: 0,   min: 0 }),
  winnerId: req.query.winnerId ? intParam(req.query.winnerId, { def: 0, min: 0 }) || null : null,
})));

// Points de récompense (#33) : réglages, barème versionné, mode, attributions, ajustements.
// ── Badges honorifiques (#38) : création, modification, statut, aperçu, journal ──
app.get('/api/admin/badges', requireAdmin, badgeRoute('GET /api/admin/badges', () => badges.adminSummary()));
app.post('/api/admin/badges', requireAdmin, badgeRoute('POST /api/admin/badges', req => ({ badge: badges.createBadge(req.body) })));
app.post('/api/admin/badges/preview', requireAdmin, badgeRoute('POST /api/admin/badges/preview', req => badges.previewBadge(req.body)));
app.get('/api/admin/badges/audit', requireAdmin, badgeRoute('GET /api/admin/badges/audit', req => ({ entries: badges.listAudit({ limit: req.query.limit }) })));
app.put('/api/admin/badges/:id', requireAdmin, badgeRoute('PUT /api/admin/badges/:id', req => ({ badge: badges.updateBadge(String(req.params.id), req.body) })));
app.post('/api/admin/badges/:id/status', requireAdmin, badgeRoute('POST /api/admin/badges/:id/status', req => ({ badge: badges.setStatus(String(req.params.id), req.body?.status) })));

app.get('/api/admin/points', requireAdmin, pointsRoute('GET /api/admin/points', () => rewardPoints.buildAdminSummary()));

app.put('/api/admin/points/scale', requireAdmin, pointsRoute('PUT /api/admin/points/scale',
  req => rewardPoints.setScale(req.body?.scale, req.body?.note)));

app.post('/api/admin/points/scale/preview', requireAdmin, pointsRoute('POST /api/admin/points/scale/preview',
  req => rewardPoints.previewScale(req.body?.scale, idParam(req.body?.seasonId, 'saison'))));

app.put('/api/admin/points/mode', requireAdmin, pointsRoute('PUT /api/admin/points/mode',
  req => rewardPoints.setMode(req.body?.mode)));

app.get('/api/admin/points/seasons/:id', requireAdmin, pointsRoute('GET /api/admin/points/seasons/:id',
  req => ({ awards: rewardPoints.seasonAwards(idParam(req.params.id, 'saison')) })));

app.post('/api/admin/points/adjust', requireAdmin, pointsRoute('POST /api/admin/points/adjust', req => {
  const amount = req.body?.amount;
  if (!Number.isInteger(amount) || amount === 0) throw new rewardPoints.PointsError(400, 'Montant entier non nul requis.');
  const r = rewardPoints.adminAdjust(idParam(req.body?.userId, 'joueur'), amount,
    { reason: req.body?.reason, idemKey: req.body?.idemKey });
  return { entry: r.entry, duplicate: r.duplicate, wallet: rewardPoints.getWallet(r.entry.user_id) };
}));

// Boutique (#34) : réglages, catalogue (jamais supprimé : masquer), commandes et journal.
app.get('/api/admin/shop', requireAdmin, shopRoute('GET /api/admin/shop', req =>
  shop.buildAdminSummary({ status: shop.STATUSES.includes(req.query.status) ? req.query.status : null })));

app.put('/api/admin/shop/settings', requireAdmin, shopRoute('PUT /api/admin/shop/settings',
  req => ({ settings: shop.updateSettings(req.body ?? {}) })));

app.post('/api/admin/shop/items', requireAdmin, shopRoute('POST /api/admin/shop/items',
  req => ({ item: shop.createItem(req.body?.item) })));

app.put('/api/admin/shop/items/:id', requireAdmin, shopRoute('PUT /api/admin/shop/items/:id',
  req => ({ item: shop.updateItem(idParam(req.params.id, 'article'), req.body?.item) })));

app.post('/api/admin/shop/orders/:id/status', requireAdmin, shopRoute('POST /api/admin/shop/orders/:id/status',
  req => ({ order: shop.transition(idParam(req.params.id, 'commande'), req.body?.status, req.body?.note) })));

app.get('/api/admin/shop/audit', requireAdmin, shopRoute('GET /api/admin/shop/audit',
  req => ({ audit: shop.listAudit({ limit: intParam(req.query.limit, { def: 100, min: 1, max: 500 }) }) })));

// Catalogue de blocs (#37) : brouillon validé et simulé, publication atomique, retour arrière.
app.get('/api/admin/blocks', requireAdmin, catalogRoute('GET /api/admin/blocks', () => blockCatalog.buildAdminView()));

app.put('/api/admin/blocks/draft/types/:id', requireAdmin, catalogRoute('PUT /api/admin/blocks/draft/types/:id', req => {
  const type = req.body?.type;
  if (!type || type.id !== req.params.id) throw new blockCatalog.CatalogError(400, 'Identifiant incohérent.');
  return { type: blockCatalog.upsertDraftType(type) };
}));

app.delete('/api/admin/blocks/draft/types/:id', requireAdmin, catalogRoute('DELETE /api/admin/blocks/draft/types/:id',
  req => { blockCatalog.removeDraftType(String(req.params.id)); return { ok: true }; }));

app.delete('/api/admin/blocks/draft', requireAdmin, catalogRoute('DELETE /api/admin/blocks/draft',
  () => ({ discarded: blockCatalog.discardDraft() })));

app.post('/api/admin/blocks/simulate', requireAdmin, catalogRoute('POST /api/admin/blocks/simulate', req => {
  const source = req.body?.source === 'draft' ? blockCatalog.getDraft() : blockCatalog.getPublished();
  if (!source) throw new blockCatalog.CatalogError(404, 'Aucun brouillon.');
  const v = blockCatalog.validateCatalog(source.types);
  if (v.errors.length) throw new blockCatalog.CatalogError(400, 'Catalogue invalide.', v.errors);
  return { results: blockCatalog.simulate(v.types, {
    depths: req.body?.depths, n: Number(req.body?.n ?? 10000), luckLevel: Number(req.body?.luckLevel ?? 0) }) };
}));

app.post('/api/admin/blocks/publish', requireAdmin, catalogRoute('POST /api/admin/blocks/publish',
  req => blockCatalog.publishDraft({ note: req.body?.note, expectedBasedOn: req.body?.basedOn ?? null })));

app.post('/api/admin/blocks/rollback', requireAdmin, catalogRoute('POST /api/admin/blocks/rollback',
  req => blockCatalog.rollbackTo(Number(req.body?.version), { note: req.body?.note })));

// Création assistée par IA (#37) : propositions → corrections → brouillon ; jamais publiée ici.
app.get('/api/admin/blocks/ai', requireAdmin, catalogRoute('GET /api/admin/blocks/ai',
  () => ({ status: blockAi.status(), proposals: blockAi.listProposals(), calls: blockAi.listCalls() })));

app.post('/api/admin/blocks/ai/proposals', requireAdmin, catalogRoute('POST /api/admin/blocks/ai/proposals',
  async req => ({ proposal: await blockAi.createProposal({ concept: req.body?.concept, withImage: req.body?.withImage !== false }) })));

app.put('/api/admin/blocks/ai/proposals/:id', requireAdmin, catalogRoute('PUT /api/admin/blocks/ai/proposals/:id',
  req => ({ proposal: blockAi.updateProposal(Number(req.params.id), req.body ?? {}) })));

app.post('/api/admin/blocks/ai/proposals/:id/regenerate', requireAdmin, catalogRoute('POST /api/admin/blocks/ai/proposals/:id/regenerate',
  async req => ({ proposal: await blockAi.regenerate(Number(req.params.id), String(req.body?.what ?? '')) })));

app.get('/api/admin/blocks/ai/proposals/:id/impact', requireAdmin, catalogRoute('GET /api/admin/blocks/ai/proposals/:id/impact',
  req => ({ impact: blockAi.impact(Number(req.params.id)) })));

app.post('/api/admin/blocks/ai/proposals/:id/draft', requireAdmin, catalogRoute('POST /api/admin/blocks/ai/proposals/:id/draft',
  req => blockAi.addToDraft(Number(req.params.id), { blockId: req.body?.blockId })));

app.delete('/api/admin/blocks/ai/proposals/:id', requireAdmin, catalogRoute('DELETE /api/admin/blocks/ai/proposals/:id',
  req => { blockAi.discardProposal(Number(req.params.id)); return { ok: true }; }));

// ── Atelier d'icônes IA (#40) ─────────────────────────────────────────────────

function iconRoute(label, fn) {
  return async (req, res) => {
    try { res.json(await fn(req)); }
    catch (err) {
      if (err instanceof iconStudio.StudioError || err instanceof blockCatalog.CatalogError || err instanceof collectionCatalog.CatalogError) {
        return res.status(err.status).json({ error: err.message, details: err.details });
      }
      console.error(`[${label}]`, err); res.status(500).json({ error: 'Erreur serveur.' });
    }
  };
}

// Images de l'atelier : stockées dans la base, adressées par empreinte (immuables).
app.get('/media/icons/:file', (req, res) => {
  const m = /^([a-f0-9]{16})\.webp$/.exec(String(req.params.file));
  const img = m && iconStudio.getImage(m[1]);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
  res.send(img.bytes);
});

app.get('/api/admin/icons', requireAdmin, iconRoute('GET /api/admin/icons', () => iconStudio.overview()));

app.get('/api/admin/icons/job', requireAdmin, iconRoute('GET /api/admin/icons/job', () => ({ job: iconStudio.jobView(), status: iconStudio.status() })));

app.put('/api/admin/icons/budget', requireAdmin, limit.icons, iconRoute('PUT /api/admin/icons/budget',
  req => ({ status: iconStudio.setStudioBudget(req.body?.studioBudgetUsd ?? null) })));

app.post('/api/admin/icons/jobs', requireAdmin, limit.icons, iconRoute('POST /api/admin/icons/jobs',
  req => ({ job: iconStudio.startJob({ targets: req.body?.targets, variants: req.body?.variants }) })));

app.get('/api/admin/icons/targets/:key', requireAdmin, iconRoute('GET /api/admin/icons/targets/:key',
  req => ({ target: iconStudio.getTarget(String(req.params.key)) })));

app.put('/api/admin/icons/targets/:key/brief', requireAdmin, limit.icons, iconRoute('PUT /api/admin/icons/targets/:key/brief',
  req => ({ brief: iconStudio.setBrief(String(req.params.key), req.body ?? {}) })));

app.post('/api/admin/icons/targets/:key/upload', requireAdmin, limit.icons, express.json({ limit: '6mb' }), iconRoute('POST /api/admin/icons/targets/:key/upload',
  req => iconStudio.upload(String(req.params.key), req.body?.data)));

app.post('/api/admin/icons/targets/:key/mark', requireAdmin, limit.icons, iconRoute('POST /api/admin/icons/targets/:key/mark',
  req => ({ target: iconStudio.mark(String(req.params.key), String(req.body?.sha ?? ''), String(req.body?.status ?? '')) })));

app.post('/api/admin/icons/targets/:key/apply', requireAdmin, limit.icons, iconRoute('POST /api/admin/icons/targets/:key/apply',
  req => iconStudio.apply(String(req.params.key), { sha: req.body?.sha ? String(req.body.sha) : null, override: req.body?.override === true })));

app.get('/api/admin/blocks/audit', requireAdmin, catalogRoute('GET /api/admin/blocks/audit',
  req => ({ audit: blockCatalog.listAudit(intParam(req.query.limit, { def: 100, min: 1, max: 500 })) })));

// Classement global admin d'une saison
// ── Collections saisonnières (#39) ────────────────────────────────────────────
app.get('/api/admin/collections', requireAdmin, collectionRoute('GET /api/admin/collections', () => collectionCatalog.buildAdminView()));
app.put('/api/admin/collections/draft/series/:id', requireAdmin, collectionRoute('PUT /api/admin/collections/draft/series/:id', req => {
  const series = req.body?.series;
  if (!series || series.id !== req.params.id) throw new collectionCatalog.CatalogError(400, 'Identifiant incohérent.');
  return { series: collectionCatalog.upsertDraftSeries(series) };
}));
app.put('/api/admin/collections/draft/items/:id', requireAdmin, collectionRoute('PUT /api/admin/collections/draft/items/:id', req => {
  const item = req.body?.item;
  if (!item || item.id !== req.params.id) throw new collectionCatalog.CatalogError(400, 'Identifiant incohérent.');
  return { item: collectionCatalog.upsertDraftItem(item) };
}));
app.delete('/api/admin/collections/draft/:kind/:id', requireAdmin, collectionRoute('DELETE /api/admin/collections/draft/:kind/:id',
  req => { collectionCatalog.removeDraftEntry(String(req.params.kind), String(req.params.id)); return { ok: true }; }));
app.delete('/api/admin/collections/draft', requireAdmin, collectionRoute('DELETE /api/admin/collections/draft',
  () => ({ discarded: collectionCatalog.discardDraft() })));
app.post('/api/admin/collections/publish', requireAdmin, collectionRoute('POST /api/admin/collections/publish',
  req => collectionCatalog.publishDraft({ note: req.body?.note, expectedBasedOn: req.body?.expectedBasedOn, confirmDrops: req.body?.confirmDrops === true })));
app.post('/api/admin/collections/rollback', requireAdmin, collectionRoute('POST /api/admin/collections/rollback',
  req => collectionCatalog.rollbackTo(Number(req.body?.version), { note: req.body?.note })));
app.post('/api/admin/collections/images', requireAdmin, collectionRoute('POST /api/admin/collections/images',
  req => collectionCatalog.storeImage(req.body?.data, req.body?.label)));
app.get('/api/admin/collections/audit', requireAdmin, collectionRoute('GET /api/admin/collections/audit',
  req => ({ audit: collectionCatalog.listAudit(intParam(req.query.limit, { def: 100, min: 1, max: 500 })) })));

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

// Publicité (#45) : réglages, emplacements, état effectif par domaine, cadres servis.
app.get('/api/admin/ads', requireAdmin, adsRoute('GET /api/admin/ads', req => ads.adminView(req.hostname)));
app.put('/api/admin/ads/settings', requireAdmin, adsRoute('PUT /api/admin/ads/settings', req => {
  ads.updateSettings(req.body || {});
  return ads.adminView(req.hostname);
}));
app.put('/api/admin/ads/slots/:slot', requireAdmin, adsRoute('PUT /api/admin/ads/slots/:slot', req => {
  ads.updateSlot(req.params.slot, req.body || {});
  return ads.adminView(req.hostname);
}));

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
 * GET /api/shop/chests
 * Public, lecture seule : coûts effectifs, limites, probabilités exactes et règles de quantité des
 * coffres — la table même utilisée par rollChest (fenêtre « Récompenses et chances », #20).
 */
app.get('/api/shop/chests', (req, res) => {
  try {
    res.json(describeChests(getAdminConfig()));
  } catch (err) {
    console.error('[GET /api/shop/chests]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

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

    const { chestId, controllerId } = req.body ?? {};
    if (!SHOP_CHESTS[chestId]) return res.status(400).json({ error: 'Coffre inconnu.' });
    if (controllerId !== undefined && !playSession.isValidControllerId(controllerId)) {
      return res.status(400).json({ error: 'Champ "controllerId" invalide.' });
    }

    const userId = req.session.userId;
    const config = getAdminConfig();

    // Lecture, débit/crédit et journalisation dans une seule transaction :
    // si une étape échoue, la sauvegarde n'est pas modifiée.
    const outcome = runTransaction(() => {
      if (!playSession.mayWrite(userId, controllerId)) return { status: 409, error: NOT_CONTROLLER.error, notController: true };
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

    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error, ...(outcome.notController ? { notController: true } : {}) });

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
blockCatalog.init();             // catalogue de blocs v1 = 14 blocs d'origine, budget anti-bot (#37)
blockAi.init();                  // création de blocs assistée par IA : propositions, images, journal d'appels (#37)
iconStudio.init();               // atelier d'icônes : images, historique, appels, briefs, plafond (#40)
collectionCatalog.init();        // collections v1 = 8 trouvailles d'origine, drops identiques (#39)
badges.init();                   // badges honorifiques : tables en ajout seul, première série (#38)
rewardPoints.ensureDefaults();   // barème proposé v1 en simulation si aucun barème (#33)
rewardPoints.applyOwnerDecision();   // décision du 30/10/2026 : barème v1 validé, crédit réel (une seule fois)

// Rotation planifiée des saisons : une passe au démarrage puis chaque minute (#16)
startSeasonScheduler();

// Purge du journal de sécurité de plus de 90 jours (#25) : au démarrage puis toutes les 12 h
antibot.startPurgeScheduler();

app.listen(PORT, HOST, () => {
  console.log(`\n⛏  DIG! server — http://${HOST}:${PORT}\n`);
});
