/**
 * DIG! — Limitation de débit des routes sensibles (ticket #14).
 *
 * Compteurs en mémoire (un seul processus Node) : remis à zéro à chaque redémarrage.
 * L'IP du client est celle vue par Express (`trust proxy` loopback : nginx local, #12).
 *
 * Variables d'environnement (facultatives) :
 *   RATE_LOGIN_MAX       échecs de connexion par IP et par minute       (défaut 10)
 *   RATE_REGISTER_MAX    tentatives d'inscription par IP / 15 minutes   (défaut 10)
 *   RATE_SAVE_MAX        sauvegardes cloud par compte (ou IP) / minute  (défaut 30)
 *   RATE_MAIL_MAX        envois d'e-mails de compte par IP / 15 minutes (défaut 5, #28)
 *   RATE_TOKEN_MAX       liens e-mail refusés par IP / 15 minutes       (défaut 20, #28)
 *   RATE_SOCIAL_MAX      départs/retours de connexion Google par IP / 15 min (défaut 30, #28)
 *   RATE_SHOP_MAX        échanges/annulations boutique par compte / minute (défaut 10, #34)
 *   RATE_PLAY_MAX        prises de contrôle + signaux de présence par compte / minute (défaut 30, #35)
 *   RATE_LIMIT           « off » désactive toutes les limites (diagnostic uniquement)
 */

'use strict';

const { rateLimit } = require('express-rate-limit');

const MINUTE = 60 * 1000;

function intFromEnv(env, name, fallback) {
  const n = parseInt(env[name], 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Réponse 429 JSON homogène, avec Retry-After (secondes). */
function tooManyRequests(req, res) {
  const reset = req.rateLimit?.resetTime;
  const wait  = reset ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) : 60;
  res.setHeader('Retry-After', String(wait));
  res.status(429).json({ error: `Trop de tentatives. Réessayez dans ${wait} s.`, retryAfter: wait });
}

/**
 * Construit les trois limiteurs. Avec RATE_LIMIT=off, chaque limiteur est un middleware neutre.
 * @returns {{ login: Function, register: Function, save: Function, mail: Function, token: Function, chest: Function, social: Function, shop: Function, play: Function }}
 */
function createRateLimiters(env = process.env) {
  if (String(env.RATE_LIMIT || '').toLowerCase() === 'off') {
    const pass = (_req, _res, next) => next();
    return { login: pass, register: pass, save: pass, mail: pass, token: pass, chest: pass, social: pass, shop: pass, play: pass };
  }

  const common = {
    standardHeaders: 'draft-7', // en-tête RateLimit / RateLimit-Policy
    legacyHeaders:   false,
    handler:         tooManyRequests,
  };

  return {
    // Connexion : seuls les échecs (réponses ≥ 400) comptent — un joueur qui se connecte
    // normalement n'est jamais bloqué, une attaque par force brute l'est vite.
    login: rateLimit({
      ...common,
      windowMs:               MINUTE,
      limit:                  intFromEnv(env, 'RATE_LOGIN_MAX', 10),
      skipSuccessfulRequests: true,
    }),

    // Inscription : toutes les tentatives comptent (création de comptes en masse).
    register: rateLimit({
      ...common,
      windowMs: 15 * MINUTE,
      limit:    intFromEnv(env, 'RATE_REGISTER_MAX', 10),
    }),

    // Sauvegarde cloud : le client envoie au plus 1 sauvegarde / 12 s (+ sortie d'onglet).
    // Compté par compte connecté (plusieurs joueurs derrière une même IP ne se gênent pas),
    // à défaut par IP.
    save: rateLimit({
      ...common,
      windowMs:     MINUTE,
      limit:        intFromEnv(env, 'RATE_SAVE_MAX', 30),
      keyGenerator: (req) => (req.session?.userId ? `u:${req.session.userId}` : `ip:${req.ip}`),
    }),

    // Coffres de la boutique (#25) : ≤ 30 ouvertures / min / compte (un joueur ouvre un coffre
    // à la fois, avec une animation) ; à défaut de session, par IP.
    chest: rateLimit({
      ...common,
      windowMs:     MINUTE,
      limit:        intFromEnv(env, 'RATE_CHEST_MAX', 30),
      keyGenerator: (req) => (req.session?.userId ? `u:${req.session.userId}` : `ip:${req.ip}`),
    }),

    // Boutique de cadeaux (#34) : échanges et annulations, ≤ 10 / min / compte (un échange se
    // confirme à la main) ; à défaut de session, par IP.
    shop: rateLimit({
      ...common,
      windowMs:     MINUTE,
      limit:        intFromEnv(env, 'RATE_SHOP_MAX', 10),
      keyGenerator: (req) => (req.session?.userId ? `u:${req.session.userId}` : `ip:${req.ip}`),
    }),

    // Session de jeu unique (#35) : une prise de contrôle au chargement + un signal de présence
    // toutes les 15 s (onglet visible) ; ≤ 30 / min / compte laisse une large marge.
    play: rateLimit({
      ...common,
      windowMs:     MINUTE,
      limit:        intFromEnv(env, 'RATE_PLAY_MAX', 30),
      keyGenerator: (req) => (req.session?.userId ? `u:${req.session.userId}` : `ip:${req.ip}`),
    }),

    // E-mails de compte (vérification, mot de passe oublié) : chaque demande compte, pour
    // qu'une IP ne puisse pas faire envoyer des messages en masse (#28).
    mail: rateLimit({
      ...common,
      windowMs: 15 * MINUTE,
      limit:    intFromEnv(env, 'RATE_MAIL_MAX', 5),
    }),

    // Liens reçus par e-mail (vérification, réinitialisation) : seuls les refus comptent,
    // ce qui rend inutile l'essai de jetons au hasard (#28).
    token: rateLimit({
      ...common,
      windowMs:               15 * MINUTE,
      limit:                  intFromEnv(env, 'RATE_TOKEN_MAX', 20),
      skipSuccessfulRequests: true,
    }),

    // Connexion Google (#28) : départs et retours d'Auth0, toutes les requêtes comptent.
    social: rateLimit({
      ...common,
      windowMs: 15 * MINUTE,
      limit:    intFromEnv(env, 'RATE_SOCIAL_MAX', 30),
    }),
  };
}

module.exports = { createRateLimiters, tooManyRequests };
