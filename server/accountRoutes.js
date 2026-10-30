/**
 * DIG! — E-mail vérifié et récupération de compte (ticket #28).
 *
 * Amélioration de l'authentification existante (nom + mot de passe bcrypt, session cookie) :
 * aucune migration d'identité, aucun service tiers. Sans configuration e-mail (mailer.enabled
 * = false), les routes qui envoient un message répondent 503 et l'interface ne les propose pas.
 *
 *   POST /api/auth/email/send-verification   (connecté)  envoie un lien de confirmation
 *   POST /api/auth/email/verify               { token }  confirme l'adresse du lien
 *   POST /api/auth/password/forgot            { identifier, lang }  réponse identique que le
 *                                             compte existe ou non (pas d'énumération)
 *   POST /api/auth/password/reset             { token, password }  nouveau mot de passe,
 *                                             ferme les autres sessions, connecte ce navigateur
 *   POST /api/me/password                     { currentPassword, newPassword }
 *   POST /api/me/email                        { password, email, lang }  la nouvelle adresse
 *                                             ne remplace l'ancienne qu'une fois confirmée
 *
 * Jetons : 32 octets aléatoires (base64url) envoyés par e-mail ; seul leur SHA-256 est stocké,
 * usage unique, expiration (48 h vérification, 1 h réinitialisation), un seul lien valable à la fois.
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const db = require('./db');
const { isValidEmail } = require('./validation');

const VERIFY_TTL_MIN  = 48 * 60;
const RESET_TTL_MIN   = 60;
const RESEND_COOLDOWN = 60;      // secondes minimum entre deux envois du même type à un compte
const PASSWORD_MIN    = 6;
const PASSWORD_MAX    = 200;     // borne le coût bcrypt d'une requête

const newToken  = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const isTokenShape = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);
const isValidNewPassword = (p) => typeof p === 'string' && p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX;

/** Champs de compte exposés au joueur connecté (/api/me). */
function publicAccount(user) {
  return {
    id:            user.id,
    username:      user.username,
    email:         user.email ?? null,
    emailVerified: !!user.email_verified_at,
  };
}

/**
 * Ferme les sessions d'un compte dont le mot de passe a changé ailleurs : la session porte
 * l'auth_version du moment de la connexion (absente = 0, sessions ouvertes avant #28).
 */
function authVersionGuard(req, _res, next) {
  const uid = req.session?.userId;
  if (!uid || !req.path.startsWith('/api/')) return next();
  try {
    const v = db.getUserAuthVersion(uid);
    if (v !== undefined && (req.session.authVersion ?? 0) !== v) {
      delete req.session.userId;
      delete req.session.authVersion;
    }
  } catch (err) {
    console.error('[auth] contrôle de version', err.message);
  }
  next();
}

function registerAccountRoutes(app, { limit, mailer }) {
  const mailOff = (res) => res.status(503).json({ error: 'Envoi d\'e-mails indisponible pour le moment.', mail: false });
  const link = (param, token) => `${mailer.baseUrl}/?${param}=${encodeURIComponent(token)}`;

  async function sendVerification(user, email, lang) {
    const token = newToken();
    db.createAuthToken(user.id, 'verify_email', hashToken(token), email, VERIFY_TTL_MIN);
    await mailer.send(mailer.compose('verify', { to: email, username: user.username, lang, arg: link('verify', token) }));
  }

  // ── Vérification de l'adresse ──────────────────────────────────────────────

  app.post('/api/auth/email/send-verification', limit.mail, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    if (!mailer.enabled) return mailOff(res);
    const user = db.getUserAuth(req.session.userId);
    if (!user) return res.status(401).json({ error: 'Non connecté.' });
    if (!user.email) return res.status(400).json({ error: 'Aucune adresse e-mail sur ce compte.' });
    if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
    const since = db.secondsSinceLastAuthToken(user.id, 'verify_email');
    if (since !== null && since < RESEND_COOLDOWN) {
      return res.status(429).json({ error: `Un e-mail vient d'être envoyé. Réessayez dans ${RESEND_COOLDOWN - since} s.`, retryAfter: RESEND_COOLDOWN - since });
    }
    try {
      await sendVerification(user, user.email, req.body?.lang);
      db.logUserEvent(user.id, 'email_verification_sent');
      res.json({ ok: true });
    } catch (err) {
      console.error('[mail] vérification', err.message);
      res.status(502).json({ error: 'L\'e-mail n\'a pas pu être envoyé. Réessayez plus tard.' });
    }
  });

  app.post('/api/auth/email/verify', limit.token, (req, res) => {
    const token = req.body?.token;
    if (!isTokenShape(token)) return res.status(400).json({ error: 'Lien invalide.' });
    try {
      const result = db.runTransaction(() => {
        const row = db.consumeAuthToken(hashToken(token), 'verify_email');
        if (!row) return { status: 400, error: 'Lien invalide ou expiré.' };
        const owner = db.getUserByEmail(row.email);
        if (owner && owner.id !== row.user_id) return { status: 409, error: 'Cette adresse e-mail est déjà utilisée par un autre compte.' };
        const before = db.getUserAuth(row.user_id);
        if (!before) return { status: 400, error: 'Lien invalide ou expiré.' };
        db.setUserEmailVerified(row.user_id, row.email);
        db.logUserEvent(row.user_id, 'email_verified', { changed: before.email !== row.email });
        return { before, email: row.email };
      });
      if (result.error) return res.status(result.status).json({ error: result.error });
      const { before, email } = result;
      // Changement d'adresse : l'ancienne adresse est prévenue (protection contre la prise de compte).
      if (before.email && before.email !== email && mailer.enabled) {
        mailer.send(mailer.compose('emailChanged', { to: before.email, username: before.username, lang: req.body?.lang, arg: email }))
          .catch(err => console.error('[mail] avis de changement', err.message));
      }
      res.json({ ok: true, username: before.username, email });
    } catch (err) {
      console.error('[POST /api/auth/email/verify]', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  // ── Mot de passe oublié ────────────────────────────────────────────────────

  app.post('/api/auth/password/forgot', limit.mail, (req, res) => {
    if (!mailer.enabled) return mailOff(res);
    const raw = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    if (!raw || raw.length > 254) return res.status(400).json({ error: 'Indiquez votre nom d\'utilisateur ou votre adresse e-mail.' });

    // Réponse identique dans tous les cas, envoyée avant l'e-mail (même délai) : la route ne
    // révèle pas si un compte existe.
    res.json({ ok: true });

    try {
      const found = raw.includes('@') ? db.getUserByEmail(raw) : db.getUserByUsername(raw);
      if (!found?.email) return;
      const since = db.secondsSinceLastAuthToken(found.id, 'reset_password');
      if (since !== null && since < RESEND_COOLDOWN) return;
      const token = newToken();
      db.createAuthToken(found.id, 'reset_password', hashToken(token), found.email, RESET_TTL_MIN);
      db.logUserEvent(found.id, 'password_reset_requested');
      mailer.send(mailer.compose('reset', { to: found.email, username: found.username, lang: req.body?.lang, arg: link('reset', token) }))
        .catch(err => console.error('[mail] réinitialisation', err.message));
    } catch (err) {
      console.error('[POST /api/auth/password/forgot]', err);
    }
  });

  app.post('/api/auth/password/reset', limit.token, async (req, res) => {
    const token    = req.body?.token;
    const password = req.body?.password;
    if (!isTokenShape(token)) return res.status(400).json({ error: 'Lien invalide.' });
    if (!isValidNewPassword(password)) return res.status(400).json({ error: `Mot de passe : ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.` });
    try {
      const hash = await bcrypt.hash(password, 10);
      const result = db.runTransaction(() => {
        const row = db.consumeAuthToken(hashToken(token), 'reset_password');
        if (!row) return null;
        const user = db.getUserAuth(row.user_id);
        // Le lien ne vaut que pour l'adresse à laquelle il a été envoyé.
        if (!user || user.email !== row.email) return null;
        const version = db.setUserPassword(user.id, hash);
        // Recevoir le lien prouve la possession de l'adresse.
        if (!user.email_verified_at) db.setUserEmailVerified(user.id, user.email);
        db.logUserEvent(user.id, 'password_reset');
        return { user, version };
      });
      if (!result) return res.status(400).json({ error: 'Lien invalide ou expiré.' });
      // Nouvelle session (identifiant régénéré) pour ce navigateur ; les autres sont fermées.
      req.session.regenerate((err) => {
        if (err) return res.status(500).json({ error: 'Erreur serveur.' });
        req.session.userId      = result.user.id;
        req.session.authVersion = result.version;
        res.json({ ok: true, user: { id: result.user.id, username: result.user.username } });
      });
    } catch (err) {
      console.error('[POST /api/auth/password/reset]', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  // ── Compte connecté : mot de passe et adresse ──────────────────────────────

  app.post('/api/me/password', limit.login, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    const { currentPassword, newPassword } = req.body ?? {};
    if (!isValidNewPassword(newPassword)) return res.status(400).json({ error: `Nouveau mot de passe : ${PASSWORD_MIN} à ${PASSWORD_MAX} caractères.` });
    try {
      const user = db.getUserAuth(req.session.userId);
      if (!user) return res.status(401).json({ error: 'Non connecté.' });
      if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, user.password_hash))) {
        return res.status(403).json({ error: 'Mot de passe actuel incorrect.' });
      }
      const version = db.setUserPassword(user.id, await bcrypt.hash(newPassword, 10));
      req.session.authVersion = version;   // ce navigateur reste connecté, les autres non
      db.logUserEvent(user.id, 'password_changed');
      res.json({ ok: true });
    } catch (err) {
      console.error('[POST /api/me/password]', err);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  app.post('/api/me/email', limit.login, async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Non connecté.' });
    if (!mailer.enabled) return mailOff(res);
    const email    = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    try {
      const user = db.getUserAuth(req.session.userId);
      if (!user) return res.status(401).json({ error: 'Non connecté.' });
      if (typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(403).json({ error: 'Mot de passe incorrect.' });
      }
      if (email === user.email) {
        if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
      } else if (db.getUserByEmail(email)) {
        return res.status(409).json({ error: 'Cette adresse e-mail est déjà utilisée.' });
      }
      const since = db.secondsSinceLastAuthToken(user.id, 'verify_email');
      if (since !== null && since < RESEND_COOLDOWN) {
        return res.status(429).json({ error: `Un e-mail vient d'être envoyé. Réessayez dans ${RESEND_COOLDOWN - since} s.`, retryAfter: RESEND_COOLDOWN - since });
      }
      await sendVerification(user, email, req.body?.lang);
      db.logUserEvent(user.id, 'email_change_requested');
      res.json({ ok: true, pending: email });
    } catch (err) {
      console.error('[POST /api/me/email]', err.message);
      res.status(502).json({ error: 'L\'e-mail n\'a pas pu être envoyé. Réessayez plus tard.' });
    }
  });
}

module.exports = { registerAccountRoutes, authVersionGuard, publicAccount, hashToken };
