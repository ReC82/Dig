/**
 * DIG! — Secrets, sessions et durcissement HTTP (ticket #12).
 *
 * Variables d'environnement (à fournir via un EnvironmentFile systemd en mode 600,
 * voir docs/OPERATIONS.md) :
 *   SESSION_SECRET   obligatoire en production (NODE_ENV=production), ≥ 32 caractères
 *   ADMIN_SECRET     facultatif ; le panel admin reste désactivé (503) s'il est absent
 *                    ou trop court (< 32 caractères)
 *   HOST             adresse d'écoute (défaut 127.0.0.1 : seul nginx joint Node)
 *   TRUST_PROXY      réglage Express « trust proxy » (défaut loopback : nginx local)
 *   COOKIE_SECURE    true | false | auto (défaut : true en production, auto sinon)
 */

'use strict';

const crypto = require('crypto');

const MIN_SECRET_LENGTH = 32;
// Anciennes valeurs par défaut publiées dans le dépôt : jamais acceptées.
const KNOWN_WEAK_SECRETS = new Set(['dig-dev-secret-change-in-prod']);

const isProduction = (env = process.env) => env.NODE_ENV === 'production';

/**
 * Retourne le secret de session à utiliser, ou lève une erreur en production si
 * SESSION_SECRET est absent, trop court ou égal à une valeur publiée.
 * Hors production, un secret aléatoire éphémère remplace un secret absent
 * (les sessions ne survivent alors pas à un redémarrage).
 */
function resolveSessionSecret(env = process.env) {
  const secret = env.SESSION_SECRET || '';
  const problem = !secret ? 'absent'
    : KNOWN_WEAK_SECRETS.has(secret) ? 'égal à la valeur par défaut publiée'
    : secret.length < MIN_SECRET_LENGTH ? `trop court (< ${MIN_SECRET_LENGTH} caractères)`
    : null;
  if (!problem) return secret;
  if (isProduction(env)) {
    throw new Error(`SESSION_SECRET ${problem} : démarrage refusé en production.`);
  }
  console.warn(`[security] SESSION_SECRET ${problem} — secret aléatoire éphémère utilisé (hors production).`);
  return crypto.randomBytes(48).toString('hex');
}

/** Secret admin utilisable, ou null (panel désactivé). */
function resolveAdminSecret(env = process.env) {
  const secret = env.ADMIN_SECRET || '';
  if (!secret) return null;
  if (secret.length < MIN_SECRET_LENGTH || KNOWN_WEAK_SECRETS.has(secret)) {
    console.warn(`[security] ADMIN_SECRET trop faible (< ${MIN_SECRET_LENGTH} caractères) — panel admin désactivé.`);
    return null;
  }
  return secret;
}

/** Compare l'en-tête Authorization au jeton attendu en temps constant. */
function isValidBearer(header, secret) {
  const digest = s => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}

function parseTrustProxy(value) {
  if (value === undefined || value === '') return 'loopback';
  if (value === 'true')  return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // liste d'adresses / sous-réseaux, ex. « loopback, 10.0.0.0/8 »
}

function cookieSecure(env = process.env) {
  const v = env.COOKIE_SECURE;
  if (v === 'true')  return true;
  if (v === 'false') return false;
  if (v === 'auto')  return 'auto';
  return isProduction(env) ? true : 'auto';
}

/**
 * En-têtes de sécurité appliqués à toutes les réponses. La CSP se limite aux
 * directives qui n'affectent pas les scripts et styles en ligne du jeu.
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'");
  // HSTS uniquement sur une connexion HTTPS (vue à travers nginx grâce à trust proxy)
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
}

module.exports = {
  MIN_SECRET_LENGTH,
  isProduction,
  resolveSessionSecret,
  resolveAdminSecret,
  isValidBearer,
  parseTrustProxy,
  cookieSecure,
  securityHeaders,
};
