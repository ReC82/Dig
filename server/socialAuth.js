/**
 * DIG! — Connexion Google via Auth0 Free (OIDC), en complément du mot de passe (ticket #28).
 *
 * Architecture A validée par le propriétaire : Auth0 n'est qu'un fournisseur d'identité.
 * La base DIG! reste la source de vérité ; une identité Google n'est rattachée à un compte DIG!
 * qu'avec la preuve des deux identités (mot de passe DIG! + connexion Google dans la même
 * démarche), jamais sur la seule égalité des adresses e-mail. Aucune progression n'est fusionnée :
 * une liaison ajoute une ligne `user_identities`, rien d'autre. Aucun jeton Auth0/Google n'est
 * conservé : après vérification du jeton d'identité, DIG! ouvre sa propre session.
 *
 * Variables d'environnement :
 *   SOCIAL_LOGIN          « off » (défaut) : aucune route, aucun bouton — retour arrière complet.
 *                         « link » : liaison de comptes existants et connexion par Google d'un
 *                         compte déjà lié. Pas de création de compte « Google seul ».
 *   SOCIAL_LOGIN_USERS    liste de noms d'utilisateur autorisés (virgules) ; vide = tous.
 *   AUTH0_DOMAIN          domaine du tenant, ex. « dig-eu.eu.auth0.com » (émetteur https://…/)
 *   AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET   application « Regular Web Application » (secrets)
 *   AUTH0_CONNECTION      connexion Auth0 utilisée (défaut « google-oauth2 »)
 *   SOCIAL_ORIGINS        origines publiques autorisées pour l'adresse de retour (virgules) ;
 *                         défaut en production : https://dig.lodygames.com et https://dig.lodylands.com
 *   OIDC_ISSUER           tests uniquement (refusé en production) : émetteur OIDC local, http admis
 *
 * Routes (toutes en 404 si SOCIAL_LOGIN=off ou configuration incomplète) :
 *   GET  /api/auth/social/start?intent=login|link   redirige vers Auth0 (PKCE, state, nonce)
 *   GET  /api/auth/social/callback                  retour d'Auth0 → /?social=<résultat>
 *   POST /api/auth/social/link/prepare  { password }    preuve DIG! avant « Lier Google »
 *   POST /api/auth/social/pending/link                  lie l'identité en attente après connexion
 *                                                       par mot de passe dans la même session
 *   POST /api/auth/social/pending/cancel                oublie l'identité en attente
 *   POST /api/auth/social/unlink        { password }    retire la liaison Google
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const db = require('./db');

const PROVIDER        = 'google';
const SUB_PREFIX      = 'google-oauth2|';
const FLOW_TTL_MS     = 10 * 60 * 1000;   // aller-retour vers Google
const PENDING_TTL_MS  = 10 * 60 * 1000;   // identité inconnue en attente de liaison
const PROOF_TTL_MS    = 5 * 60 * 1000;    // mot de passe confirmé avant « Lier Google »
const CLOCK_SKEW_S    = 120;
const HTTP_TIMEOUT_MS = 10_000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const random = () => b64url(crypto.randomBytes(32));
const sameString = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Lit la configuration ; `enabled` = false si le drapeau est « off » ou s'il manque un réglage. */
function resolveSocialConfig(env = process.env, { publicBaseUrl } = {}) {
  const raw  = String(env.SOCIAL_LOGIN || 'off').trim().toLowerCase();
  const off  = (reason) => {
    if (reason) console.warn(`[social] connexion Google désactivée : ${reason}`);
    return { enabled: false, mode: 'off' };
  };
  if (raw === 'off' || raw === '') return off(null);
  if (raw !== 'link') return off(`SOCIAL_LOGIN=${raw} inconnu (valeurs : off, link)`);

  const prod = env.NODE_ENV === 'production';
  let issuer;
  const testIssuer = (env.OIDC_ISSUER || '').trim();
  if (testIssuer) {
    if (prod) return off('OIDC_ISSUER est réservé aux tests');
    issuer = testIssuer.endsWith('/') ? testIssuer : `${testIssuer}/`;
  } else {
    const domain = (env.AUTH0_DOMAIN || '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '');
    if (!domain) return off('AUTH0_DOMAIN manquant');
    if (!/^[a-z0-9.-]+$/.test(domain)) return off('AUTH0_DOMAIN invalide');
    issuer = `https://${domain}/`;
  }
  const clientId     = (env.AUTH0_CLIENT_ID || '').trim();
  const clientSecret = (env.AUTH0_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return off('AUTH0_CLIENT_ID ou AUTH0_CLIENT_SECRET manquant');

  const originsRaw = (env.SOCIAL_ORIGINS || '').trim();
  const origins = new Set(
    (originsRaw ? originsRaw.split(',') : (prod ? ['https://dig.lodygames.com', 'https://dig.lodylands.com'] : []))
      .concat(publicBaseUrl ? [publicBaseUrl] : [])
      .map(o => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  const users = new Set((env.SOCIAL_LOGIN_USERS || '').split(',').map(u => u.trim().toLowerCase()).filter(Boolean));

  return {
    enabled: true,
    mode: 'link',
    issuer,
    clientId,
    clientSecret,
    connection: (env.AUTH0_CONNECTION || 'google-oauth2').trim(),
    origins,
    users,
  };
}

// ── Client OIDC minimal (code d'autorisation + PKCE, jeton d'identité RS256) ──

function createOidcClient(cfg, { fetchImpl = globalThis.fetch } = {}) {
  let discovery = null, discoveredAt = 0;
  let jwks = null, jwksAt = 0;

  async function getJson(url, opts = {}) {
    const res = await fetchImpl(url, { ...opts, redirect: 'error', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (!res.ok) throw new Error(`${new URL(url).pathname} → HTTP ${res.status}${body?.error ? ` (${body.error})` : ''}`);
    return body;
  }

  async function discover() {
    if (discovery && Date.now() - discoveredAt < 3600_000) return discovery;
    const d = await getJson(`${cfg.issuer}.well-known/openid-configuration`);
    if (d?.issuer !== cfg.issuer) throw new Error('émetteur annoncé différent de l\'émetteur configuré');
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
      if (typeof d[k] !== 'string') throw new Error(`découverte OIDC incomplète (${k})`);
    }
    discovery = d; discoveredAt = Date.now();
    return d;
  }

  async function signingKey(kid) {
    const find = () => jwks?.keys?.find(k => k.kid === kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'));
    let jwk = find();
    // Clé inconnue : rotation possible côté fournisseur, relecture au plus une fois par minute.
    if (!jwk && Date.now() - jwksAt > 60_000) {
      jwks = await getJson((await discover()).jwks_uri);
      jwksAt = Date.now();
      jwk = find();
    }
    if (!jwk) throw new Error('clé de signature inconnue');
    return crypto.createPublicKey({ key: jwk, format: 'jwk' });
  }

  async function authorizationUrl({ redirectUri, state, nonce, verifier, prompt }) {
    const d = await discover();
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type:         'code',
      client_id:             cfg.clientId,
      redirect_uri:          redirectUri,
      scope:                 'openid email profile',
      state,
      nonce,
      code_challenge:        b64url(crypto.createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      connection:            cfg.connection,
      ...(prompt ? { prompt } : {}),
    }).toString();
    return url.toString();
  }

  /** Vérifie un jeton d'identité : signature RS256, iss, aud/azp, exp, iat, nonce. */
  async function verifyIdToken(idToken, { nonce }) {
    if (typeof idToken !== 'string' || idToken.length > 16_384) throw new Error('jeton d\'identité absent');
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('jeton d\'identité mal formé');
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (_) { throw new Error('jeton d\'identité illisible'); }
    if (header?.alg !== 'RS256') throw new Error(`algorithme refusé (${header?.alg})`);
    const key = await signingKey(header.kid);
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new Error('signature invalide');

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== cfg.issuer) throw new Error('émetteur invalide');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(cfg.clientId)) throw new Error('audience invalide');
    if (aud.length > 1 && claims.azp !== cfg.clientId) throw new Error('azp invalide');
    if (!Number.isFinite(claims.exp) || claims.exp < now - CLOCK_SKEW_S) throw new Error('jeton expiré');
    if (Number.isFinite(claims.iat) && claims.iat > now + CLOCK_SKEW_S) throw new Error('jeton émis dans le futur');
    if (!sameString(claims.nonce, nonce)) throw new Error('nonce invalide');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) throw new Error('sub invalide');
    return claims;
  }

  async function exchangeCode({ code, redirectUri, verifier, nonce }) {
    const d = await discover();
    const tokens = await getJson(d.token_endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body:    new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        client_id:     cfg.clientId,
        client_secret: cfg.clientSecret,
        code_verifier: verifier,
      }).toString(),
    });
    return verifyIdToken(tokens?.id_token, { nonce });
  }

  return { authorizationUrl, exchangeCode, verifyIdToken };
}

// ── Routes ───────────────────────────────────────────────────────────────────

/** Identité sociale lue dans le jeton (adresse en minuscules ; vérifiée seulement si le fournisseur l'affirme). */
function identityFromClaims(claims) {
  if (!claims.sub.startsWith(SUB_PREFIX)) return null;    // seul Google est ouvert
  const email = typeof claims.email === 'string' && claims.email.length <= 254 ? claims.email.trim().toLowerCase() : null;
  return { provider: PROVIDER, subject: claims.sub, email, emailVerified: !!email && claims.email_verified === true };
}

function registerSocialRoutes(app, { limit, mailer, config, oidc }) {
  const cfg    = config;
  const client = cfg.enabled ? (oidc || createOidcClient(cfg)) : null;

  const allowed = (user) => !cfg.users.size || cfg.users.has(String(user?.username || '').toLowerCase());
  const notFound = (res) => res.status(404).json({ error: 'Route API introuvable.' });
  const done = (req, res, result) => req.session.save(() => res.redirect(302, `/?social=${result}`));
  const pendingOf = (req) => {
    const p = req.session.socialPending;
    if (!p || p.exp < Date.now()) { delete req.session.socialPending; return null; }
    return p;
  };

  // Notification de sécurité à l'adresse du compte (si le SMTP est configuré).
  const notify = (user, kind, email, lang) => {
    if (!mailer.enabled || !user.email) return;
    mailer.send(mailer.compose(kind, { to: user.email, username: user.username, lang, arg: email || 'Google' }))
      .catch(err => console.error(`[mail] ${kind}`, err.message));
  };

  /** Lie l'identité au compte (transaction) ; renvoie un code de résultat pour /?social=… */
  function link(user, identity) {
    return db.runTransaction(() => {
      const owner = db.getIdentity(identity.provider, identity.subject);
      if (owner) return owner.user_id === user.id ? 'linked' : 'taken';
      if (db.getUserIdentities(user.id).some(i => i.provider === identity.provider)) return 'already';
      db.addUserIdentity(user.id, identity);
      // Adresse vérifiée : seulement si Google la dit vérifiée ET qu'elle est celle du compte.
      if (identity.emailVerified && !user.email_verified_at && identity.email === user.email) {
        db.setUserEmailVerified(user.id, user.email);
      }
      db.logUserEvent(user.id, 'social_linked', { provider: identity.provider });
      return 'linked';
    });
  }

  /** Infos sociales pour /api/me (null si désactivé). */
  function describe(req, user) {
    if (!cfg.enabled) return null;
    const out = { providers: [PROVIDER], canLink: !!user && allowed(user), loginButton: !cfg.users.size };
    if (user) {
      out.identities = db.getUserIdentities(user.id).map(i => ({ provider: i.provider, email: i.email, linkedAt: i.created_at }));
      const p = pendingOf(req);
      if (p && p.userId === user.id) out.pending = { provider: p.provider, email: p.email };
    } else if (pendingOf(req)) {
      out.pending = { provider: PROVIDER };
    }
    return out;
  }

  /** Après une connexion par mot de passe : l'identité en attente devient liable par ce compte. */
  function onPasswordLogin(req, user) {
    const p = cfg.enabled && pendingOf(req);
    if (!p) return null;
    p.userId = user.id;
    return { provider: p.provider, email: p.email };
  }

  app.get('/api/auth/social/start', limit.social, async (req, res) => {
    if (!cfg.enabled) return notFound(res);
    const intent = req.query.intent === 'link' ? 'link' : 'login';
    // Adresse de retour sur l'origine de la page (même cookie de session), parmi les origines déclarées.
    const origin = `${req.protocol}://${req.get('host')}`;
    if (!cfg.origins.has(origin)) return done(req, res, 'error');

    let userId = null;
    if (intent === 'link') {
      userId = req.session.userId;
      const proof = req.session.socialLinkProof;
      delete req.session.socialLinkProof;   // une preuve = un essai
      const user = userId && db.getUserAuth(userId);
      if (!user || !allowed(user) || !proof || proof.userId !== userId || Date.now() - proof.at > PROOF_TTL_MS) {
        return done(req, res, 'error');
      }
    }
    const flow = {
      state: random(), nonce: random(), verifier: random(),
      intent, userId, redirectUri: `${origin}/api/auth/social/callback`, exp: Date.now() + FLOW_TTL_MS,
    };
    try {
      const url = await client.authorizationUrl({ ...flow, prompt: intent === 'link' ? 'login' : undefined });
      req.session.socialFlow = flow;
      req.session.save(() => res.redirect(302, url));
    } catch (err) {
      console.error('[social] démarrage', err.message);
      done(req, res, 'unavailable');
    }
  });

  app.get('/api/auth/social/callback', limit.social, async (req, res) => {
    if (!cfg.enabled) return notFound(res);
    const flow = req.session.socialFlow;
    delete req.session.socialFlow;         // usage unique, même en cas d'échec
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!flow || flow.exp < Date.now() || !sameString(state, flow.state)) return done(req, res, 'error');
    if (req.query.error) return done(req, res, req.query.error === 'access_denied' ? 'cancelled' : 'error');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code || code.length > 2048) return done(req, res, 'error');

    let identity;
    try {
      const claims = await client.exchangeCode({ code, redirectUri: flow.redirectUri, verifier: flow.verifier, nonce: flow.nonce });
      identity = identityFromClaims(claims);
    } catch (err) {
      console.warn('[social] retour refusé :', err.message);
      return done(req, res, 'error');
    }
    if (!identity) return done(req, res, 'error');

    try {
      if (flow.intent === 'link') {
        // Toujours le même compte connecté qu'au départ, sinon rien n'est lié.
        const user = req.session.userId === flow.userId && db.getUserAuth(flow.userId);
        if (!user || !allowed(user)) return done(req, res, 'error');
        const result = link(user, identity);
        if (result === 'linked') notify(user, 'socialLinked', identity.email, req.query.lang);
        return done(req, res, result);
      }

      const owner = db.getIdentity(identity.provider, identity.subject);
      if (owner) {
        const user = db.getUserAuth(owner.user_id);
        if (!user || !allowed(user)) return done(req, res, 'notallowed');
        db.touchUserIdentity(owner.id);
        db.logUserEvent(user.id, 'social_login', { provider: identity.provider });
        // Nouvelle session (identifiant régénéré) : protection contre la fixation de session.
        return req.session.regenerate((err) => {
          if (err) return res.redirect(302, '/?social=error');
          req.session.userId      = user.id;
          req.session.authVersion = user.auth_version ?? 0;
          done(req, res, 'ok');
        });
      }

      // Identité inconnue : jamais de liaison automatique, même si l'adresse correspond à un compte.
      // Elle attend (10 min) une connexion par mot de passe puis une confirmation explicite.
      if (req.session.userId) return done(req, res, 'error');
      req.session.socialPending = { ...identity, userId: null, exp: Date.now() + PENDING_TTL_MS };
      return done(req, res, 'pending');
    } catch (err) {
      console.error('[social] retour', err);
      return done(req, res, 'error');
    }
  });

  app.post('/api/auth/social/link/prepare', limit.login, async (req, res) => {
    if (!cfg.enabled) return notFound(res);
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    try {
      const user = db.getUserAuth(req.session.userId);
      if (!user) return res.status(401).json({ error: 'Non connecté.' });
      if (!allowed(user)) return res.status(403).json({ error: 'Connexion Google pas encore ouverte pour ce compte.' });
      if (db.getUserIdentities(user.id).some(i => i.provider === PROVIDER)) {
        return res.status(409).json({ error: 'Un compte Google est déjà lié à ce compte.' });
      }
      const password = req.body?.password;
      if (typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(403).json({ error: 'Mot de passe incorrect.' });
      }
      req.session.socialLinkProof = { userId: user.id, at: Date.now() };
      res.json({ ok: true, url: '/api/auth/social/start?intent=link' });
    } catch (err) {
      console.error('[POST /api/auth/social/link/prepare]', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  app.post('/api/auth/social/pending/link', limit.login, (req, res) => {
    if (!cfg.enabled) return notFound(res);
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    const p = pendingOf(req);
    // La preuve du mot de passe doit avoir été faite dans cette session, après le retour Google.
    if (!p || p.userId !== req.session.userId) return res.status(400).json({ error: 'Aucun compte Google en attente de liaison.' });
    try {
      const user = db.getUserAuth(req.session.userId);
      if (!user || !allowed(user)) return res.status(403).json({ error: 'Connexion Google pas encore ouverte pour ce compte.' });
      delete req.session.socialPending;
      const result = link(user, p);
      if (result === 'taken')   return res.status(409).json({ error: 'Ce compte Google est déjà lié à un autre compte DIG!.' });
      if (result === 'already') return res.status(409).json({ error: 'Un autre compte Google est déjà lié à ce compte.' });
      notify(user, 'socialLinked', p.email, req.body?.lang);
      res.json({ ok: true, provider: p.provider, email: p.email });
    } catch (err) {
      console.error('[POST /api/auth/social/pending/link]', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  app.post('/api/auth/social/pending/cancel', (req, res) => {
    if (!cfg.enabled) return notFound(res);
    delete req.session.socialPending;
    res.json({ ok: true });
  });

  app.post('/api/auth/social/unlink', limit.login, async (req, res) => {
    if (!cfg.enabled) return notFound(res);
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    try {
      const user = db.getUserAuth(req.session.userId);
      if (!user) return res.status(401).json({ error: 'Non connecté.' });
      // En mode « link », tout compte lié a un mot de passe : le retrait laisse toujours un moyen
      // de connexion. Le mot de passe est exigé (même preuve que pour lier).
      const password = req.body?.password;
      if (typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(403).json({ error: 'Mot de passe incorrect.' });
      }
      const identity = db.getUserIdentities(user.id).find(i => i.provider === PROVIDER);
      if (!identity) return res.status(404).json({ error: 'Aucun compte Google lié.' });
      const version = db.removeUserIdentity(user.id, identity.id);   // ferme les autres sessions
      req.session.authVersion = version;
      db.logUserEvent(user.id, 'social_unlinked', { provider: PROVIDER });
      notify(user, 'socialUnlinked', identity.email, req.body?.lang);
      res.json({ ok: true });
    } catch (err) {
      console.error('[POST /api/auth/social/unlink]', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  return { describe, onPasswordLogin };
}

module.exports = { resolveSocialConfig, createOidcClient, registerSocialRoutes, identityFromClaims };
