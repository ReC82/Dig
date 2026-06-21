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
} = require('./db');

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
    res.json({ ok: true, version });
  } catch (err) {
    console.error('[POST /api/me/save]', err);
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
