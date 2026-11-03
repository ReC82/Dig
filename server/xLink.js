/**
 * DIG! — Compte X lié, statut social et récompense hebdomadaire (ticket #51).
 *
 * Liaison : OAuth 2.0 « Authorization Code + PKCE » de X, à l'initiative du joueur connecté.
 * Le jeton d'accès sert une seule fois à lire `GET /2/users/me` (identifiant + nom), puis il est
 * révoqué et oublié : aucun jeton X n'est conservé, ni en base ni en session. Une ligne
 * `user_x_links` = un compte X prouvé par X lui-même, jamais par une déclaration du joueur.
 *
 * Statut social : « 𝕏 @nom vérifié », affiché dans le compte, distinct des badges honorifiques
 * (#38) ; il n'existe que tant qu'une liaison vérifiée existe.
 *
 * Récompense hebdomadaire : mécanisme de vérification et d'enregistrement idempotent CONÇU mais
 * DÉSACTIVÉ dans le code (REWARD_ENABLED = false, aucune route, aucun crédit, aucune demande de
 * publication). Les règles X interdisent depuis janvier 2026 les applications qui récompensent la
 * publication par des points : décision du propriétaire requise (voir rapport #51).
 *
 * Variables d'environnement :
 *   X_LINK            « off » (défaut) : aucune route, statut « non disponible » — retour arrière.
 *                     « link » : liaison/déliaison d'un compte X par les joueurs connectés.
 *   X_LINK_USERS      noms d'utilisateur DIG! autorisés (virgules) ; vide = tous.
 *   X_CLIENT_ID       identifiant OAuth 2.0 de l'application X (portail développeur)
 *   X_CLIENT_SECRET   secret (client confidentiel) ; absent = client public (PKCE seul)
 *   X_ORIGINS         origines publiques autorisées pour l'adresse de retour (virgules) ;
 *                     défaut en production : https://dig.lodygames.com et https://dig.lodylands.com
 *   X_OAUTH_BASE, X_API_BASE   tests uniquement (refusés en production) : faux serveur X local
 *
 * Routes (404 si X_LINK=off ou configuration incomplète) :
 *   GET  /api/x/start      redirige vers X (state, PKCE) — joueur connecté et autorisé
 *   GET  /api/x/callback   retour de X → /?xlink=<résultat>
 *   POST /api/x/unlink     retire la liaison (statut social retiré)
 */

'use strict';

const crypto = require('crypto');

const db = require('./db');

const AUTHORIZE_URL   = 'https://x.com/i/oauth2/authorize';
const API_BASE        = 'https://api.x.com';
const SCOPES          = 'users.read tweet.read';   // minimum exigé par GET /2/users/me
const FLOW_TTL_MS     = 10 * 60 * 1000;
const HTTP_TIMEOUT_MS = 10_000;
const DAY_MS          = 86_400_000;

// Anti-comptes multiples : un compte X retiré ne peut pas être lié à un AUTRE compte DIG! avant
// RELINK_OTHER_DAYS ; un compte DIG! ne peut pas changer de compte X avant SWITCH_DAYS.
const RELINK_OTHER_DAYS = 30;
const SWITCH_DAYS       = 7;

const X_ID_RE   = /^[0-9]{1,20}$/;
const X_NAME_RE = /^[A-Za-z0-9_]{1,15}$/;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const random = () => b64url(crypto.randomBytes(32));
const sameString = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const conn = () => db.getDb();

// ── Schéma (ajout seul, idempotent) ──────────────────────────────────────────

function init() {
  conn().exec(`
    CREATE TABLE IF NOT EXISTS user_x_links (
      user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      x_user_id    TEXT    NOT NULL UNIQUE,
      x_username   TEXT    NOT NULL,
      x_created_at TEXT,
      linked_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      verified_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    -- Historique des liaisons (audit + règles anti-comptes multiples) : jamais purgé ici.
    CREATE TABLE IF NOT EXISTS x_link_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      x_user_id   TEXT    NOT NULL,
      x_username  TEXT    NOT NULL,
      linked_at   TEXT    NOT NULL,
      unlinked_at TEXT,
      reason      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_x_link_history_x    ON x_link_history (x_user_id, unlinked_at);
    CREATE INDEX IF NOT EXISTS idx_x_link_history_user ON x_link_history (user_id, unlinked_at);
    -- Récompense hebdomadaire (désactivée) : une demande par compte DIG!, par compte X et par
    -- semaine, une publication ne sert qu'une fois. points = 0 tant que les règles ne sont pas validées.
    CREATE TABLE IF NOT EXISTS x_reward_claims (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      x_user_id   TEXT    NOT NULL,
      week_key    TEXT    NOT NULL,
      post_id     TEXT    NOT NULL UNIQUE,
      status      TEXT    NOT NULL,
      points      INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      credited_at TEXT,
      UNIQUE (user_id, week_key),
      UNIQUE (x_user_id, week_key)
    );
  `);
}

// ── Configuration ────────────────────────────────────────────────────────────

function resolveXConfig(env = process.env, { publicBaseUrl } = {}) {
  const raw = String(env.X_LINK || 'off').trim().toLowerCase();
  const off = (reason) => {
    if (reason) console.warn(`[x] liaison X désactivée : ${reason}`);
    return { enabled: false, mode: 'off' };
  };
  if (raw === 'off' || raw === '') return off(null);
  if (raw !== 'link') return off(`X_LINK=${raw} inconnu (valeurs : off, link)`);

  const prod = env.NODE_ENV === 'production';
  const testOauth = (env.X_OAUTH_BASE || '').trim().replace(/\/+$/, '');
  const testApi   = (env.X_API_BASE || '').trim().replace(/\/+$/, '');
  if ((testOauth || testApi) && prod) return off('X_OAUTH_BASE / X_API_BASE sont réservés aux tests');

  const clientId = (env.X_CLIENT_ID || '').trim();
  if (!clientId) return off('X_CLIENT_ID manquant');

  const originsRaw = (env.X_ORIGINS || '').trim();
  const origins = new Set(
    (originsRaw ? originsRaw.split(',') : (prod ? ['https://dig.lodygames.com', 'https://dig.lodylands.com'] : []))
      .concat(publicBaseUrl ? [publicBaseUrl] : [])
      .map(o => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  const users = new Set((env.X_LINK_USERS || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean));

  return {
    enabled: true,
    mode: 'link',
    clientId,
    clientSecret: (env.X_CLIENT_SECRET || '').trim(),
    authorizeUrl: testOauth ? `${testOauth}/i/oauth2/authorize` : AUTHORIZE_URL,
    apiBase:      testApi || API_BASE,
    origins,
    users,
  };
}

// ── Client OAuth 2.0 X minimal ───────────────────────────────────────────────

function createXClient(cfg, { fetchImpl = globalThis.fetch } = {}) {
  const basic = cfg.clientSecret
    ? { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}` }
    : {};

  async function call(pathname, opts = {}) {
    const res = await fetchImpl(`${cfg.apiBase}${pathname}`, { ...opts, redirect: 'error', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}${body?.error ? ` (${body.error})` : ''}`);
    return body;
  }
  const form = (fields) => ({
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...basic },
    body:    new URLSearchParams(cfg.clientSecret ? fields : { ...fields, client_id: cfg.clientId }).toString(),
  });

  function authorizationUrl({ redirectUri, state, verifier }) {
    const url = new URL(cfg.authorizeUrl);
    url.search = new URLSearchParams({
      response_type:         'code',
      client_id:             cfg.clientId,
      redirect_uri:          redirectUri,
      scope:                 SCOPES,
      state,
      code_challenge:        b64url(crypto.createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  /** Échange le code, lit le compte X, révoque le jeton (au mieux) : renvoie le profil, jamais le jeton. */
  async function fetchIdentity({ code, redirectUri, verifier }) {
    const tokens = await call('/2/oauth2/token', form({
      grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier,
    }));
    const token = tokens?.access_token;
    if (typeof token !== 'string' || !token || token.length > 4096) throw new Error('jeton d\'accès absent');
    try {
      const me = await call('/2/users/me?user.fields=created_at', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      return profileFromUser(me?.data);
    } finally {
      call('/2/oauth2/revoke', form({ token, token_type_hint: 'access_token' }))
        .catch(err => console.warn('[x] révocation du jeton :', err.message));
    }
  }

  return { authorizationUrl, fetchIdentity };
}

/** Profil X minimal (données minimisées) ou erreur si la réponse n'est pas plausible. */
function profileFromUser(u) {
  if (!u || !X_ID_RE.test(String(u.id || '')) || !X_NAME_RE.test(String(u.username || ''))) {
    throw new Error('profil X invalide');
  }
  const created = typeof u.created_at === 'string' && !Number.isNaN(Date.parse(u.created_at)) ? new Date(u.created_at).toISOString() : null;
  return { xUserId: String(u.id), username: String(u.username), createdAt: created };
}

// ── Données ──────────────────────────────────────────────────────────────────

function getLink(userId) {
  return conn().prepare('SELECT user_id, x_user_id, x_username, x_created_at, linked_at, verified_at FROM user_x_links WHERE user_id = ?').get(userId);
}

const sinceDays = (days) => new Date(Date.now() - days * DAY_MS).toISOString().replace('T', ' ').slice(0, 19);

/**
 * Lie un compte X prouvé à un compte DIG! (transaction). Résultat : 'linked' | 'taken' |
 * 'already' | 'cooldown' | 'switch'. Aucune donnée de progression n'est touchée.
 */
function linkAccount(userId, profile) {
  const c = conn();
  return db.runTransaction(() => {
    const owner = c.prepare('SELECT user_id FROM user_x_links WHERE x_user_id = ?').get(profile.xUserId);
    const mine  = getLink(userId);
    let result;
    if (owner) result = owner.user_id === userId ? 'linked' : 'taken';
    else if (mine) result = 'already';
    else if (c.prepare(`SELECT 1 FROM x_link_history WHERE x_user_id = ? AND user_id <> ? AND unlinked_at >= ? LIMIT 1`)
      .get(profile.xUserId, userId, sinceDays(RELINK_OTHER_DAYS))) result = 'cooldown';
    else if (c.prepare(`SELECT 1 FROM x_link_history WHERE user_id = ? AND x_user_id <> ? AND unlinked_at >= ? LIMIT 1`)
      .get(userId, profile.xUserId, sinceDays(SWITCH_DAYS))) result = 'switch';
    else result = 'new';

    if (result === 'linked') {   // même compte X : simple revérification
      c.prepare(`UPDATE user_x_links SET x_username = ?, verified_at = datetime('now') WHERE user_id = ?`).run(profile.username, userId);
      return 'linked';
    }
    if (result !== 'new') {
      db.logUserEvent(userId, 'x_link_refused', { reason: result });
      return result;
    }
    c.prepare('INSERT INTO user_x_links (user_id, x_user_id, x_username, x_created_at) VALUES (?, ?, ?, ?)')
      .run(userId, profile.xUserId, profile.username, profile.createdAt);
    c.prepare(`INSERT INTO x_link_history (user_id, x_user_id, x_username, linked_at) VALUES (?, ?, ?, datetime('now'))`)
      .run(userId, profile.xUserId, profile.username);
    db.logUserEvent(userId, 'x_linked', { username: profile.username });
    return 'linked';
  });
}

/** Retire la liaison (statut social retiré). @returns {boolean} une liaison existait */
function unlinkAccount(userId, reason = 'user') {
  const c = conn();
  return db.runTransaction(() => {
    const link = getLink(userId);
    if (!link) return false;
    c.prepare('DELETE FROM user_x_links WHERE user_id = ?').run(userId);
    c.prepare(`UPDATE x_link_history SET unlinked_at = datetime('now'), reason = ? WHERE user_id = ? AND x_user_id = ? AND unlinked_at IS NULL`)
      .run(reason, userId, link.x_user_id);
    db.logUserEvent(userId, 'x_unlinked', { username: link.x_username, reason });
    return true;
  });
}

// ── Récompense hebdomadaire : conçue, DÉSACTIVÉE ─────────────────────────────

/** Verrou de code : aucune variable d'environnement ne l'ouvre (décision du propriétaire requise). */
const REWARD_ENABLED = false;

/** Semaine ISO à Bruxelles, ex. « 2026-W45 » (lundi 00:00 → dimanche 23:59, heure locale). */
function weekKey(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map(x => [x.type, x.value]));
  const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);             // jeudi de la semaine ISO
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Vérifie une publication telle que renvoyée par `GET /2/tweets/:id?tweet.fields=author_id,
 * created_at,entities,referenced_tweets` (lue côté serveur, jamais fournie par le joueur) :
 * auteur = compte X lié, publiée cette semaine et après la liaison, publication originale (ni
 * repost, ni réponse), lien vers un domaine du jeu. @returns {{ ok: boolean, reason?: string }}
 */
function evaluatePost(post, { link, now = new Date(), hosts = ['dig.lodygames.com', 'dig.lodylands.com'] } = {}) {
  if (!post || !X_ID_RE.test(String(post.id || ''))) return { ok: false, reason: 'post_invalid' };
  if (!link || String(post.author_id) !== String(link.x_user_id)) return { ok: false, reason: 'author_mismatch' };
  const created = Date.parse(post.created_at);
  if (Number.isNaN(created) || created > now.getTime() + 120_000) return { ok: false, reason: 'date_invalid' };
  if (weekKey(new Date(created)) !== weekKey(now)) return { ok: false, reason: 'not_this_week' };
  const linkedAt = Date.parse(String(link.linked_at).replace(' ', 'T') + 'Z');
  if (!Number.isNaN(linkedAt) && created < linkedAt) return { ok: false, reason: 'before_link' };
  if ((post.referenced_tweets || []).some(r => r.type === 'retweeted' || r.type === 'replied_to')) {
    return { ok: false, reason: 'not_original' };
  }
  const urls = (post.entities?.urls || []).map(u => u.unwound_url || u.expanded_url).filter(Boolean);
  const mentions = urls.some(u => { try { return hosts.includes(new URL(u).hostname.toLowerCase()); } catch (_) { return false; } });
  if (!mentions) return { ok: false, reason: 'no_game_link' };
  return { ok: true };
}

/**
 * Enregistre une publication vérifiée (idempotent : la même publication ou une deuxième demande
 * de la semaine ne crée rien). Aucun crédit : points = 0, credited_at = NULL.
 * @returns {{ created: boolean, reason?: string }}
 */
function recordVerifiedPost(userId, link, postId, now = new Date()) {
  const week = weekKey(now);
  const info = conn().prepare(
    `INSERT INTO x_reward_claims (user_id, x_user_id, week_key, post_id, status) VALUES (?, ?, ?, ?, 'verified_no_credit')
     ON CONFLICT DO NOTHING`
  ).run(userId, String(link.x_user_id), week, String(postId));
  return info.changes ? { created: true } : { created: false, reason: 'weekly_quota_or_duplicate' };
}

// ── Routes ───────────────────────────────────────────────────────────────────

function registerXRoutes(app, { limit, config, client: injected }) {
  const cfg    = config;
  const client = cfg.enabled ? (injected || createXClient(cfg)) : null;
  const allowed  = (user) => !cfg.users.size || cfg.users.has(String(user?.username || '').toLowerCase());
  const notFound = (res) => res.status(404).json({ error: 'Route API introuvable.' });
  const done = (req, res, result) => req.session.save(() => res.redirect(302, `/?xlink=${result}`));

  /** Statut X pour /api/me : toujours présent (« non disponible » explicite si désactivé). */
  function describe(user) {
    if (!cfg.enabled || !user) return { available: false };
    const link = getLink(user.id);
    return {
      available: allowed(user),
      linked: link ? { username: link.x_username, linkedAt: link.linked_at } : null,
      reward: { enabled: REWARD_ENABLED },
    };
  }

  app.get('/api/x/start', limit.social, (req, res) => {
    if (!cfg.enabled) return notFound(res);
    const origin = `${req.protocol}://${req.get('host')}`;
    const user = req.session.userId && db.getUserAuth(req.session.userId);
    if (!cfg.origins.has(origin) || !user || !allowed(user)) return done(req, res, 'error');
    if (getLink(user.id)) return done(req, res, 'already');
    const flow = { state: random(), verifier: random(), userId: user.id, redirectUri: `${origin}/api/x/callback`, exp: Date.now() + FLOW_TTL_MS };
    req.session.xFlow = flow;
    req.session.save(() => res.redirect(302, client.authorizationUrl(flow)));
  });

  app.get('/api/x/callback', limit.social, async (req, res) => {
    if (!cfg.enabled) return notFound(res);
    const flow = req.session.xFlow;
    delete req.session.xFlow;             // usage unique, même en cas d'échec
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!flow || flow.exp < Date.now() || !sameString(state, flow.state)) return done(req, res, 'error');
    if (req.query.error) return done(req, res, req.query.error === 'access_denied' ? 'cancelled' : 'error');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || code.length > 2048) return done(req, res, 'error');
    // Toujours le même compte connecté qu'au départ.
    const user = req.session.userId === flow.userId && db.getUserAuth(flow.userId);
    if (!user || !allowed(user)) return done(req, res, 'error');

    let profile;
    try {
      profile = await client.fetchIdentity({ code, redirectUri: flow.redirectUri, verifier: flow.verifier });
    } catch (err) {
      console.warn('[x] retour refusé :', err.message);
      return done(req, res, 'error');
    }
    try {
      done(req, res, linkAccount(user.id, profile));
    } catch (err) {
      console.error('[x] liaison', err);
      done(req, res, 'error');
    }
  });

  app.post('/api/x/unlink', limit.social, (req, res) => {
    if (!cfg.enabled) return notFound(res);
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    try {
      if (!unlinkAccount(req.session.userId)) return res.status(404).json({ error: 'Aucun compte X lié.' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[POST /api/x/unlink]', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  return { describe };
}

module.exports = {
  init, resolveXConfig, createXClient, registerXRoutes, profileFromUser,
  getLink, linkAccount, unlinkAccount,
  REWARD_ENABLED, weekKey, evaluatePost, recordVerifiedPost,
  RELINK_OTHER_DAYS, SWITCH_DAYS,
};
