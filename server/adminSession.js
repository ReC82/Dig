/**
 * server/adminSession.js — Session du panel admin (#57, recette du 03/11/2026).
 *
 * Avant : la clé admin n'existait que dans la mémoire de l'onglet, d'où une nouvelle saisie à
 * chaque rechargement (F5). Désormais la clé est envoyée UNE fois (POST /api/admin/session, en
 * en-tête Authorization) ; le serveur répond par un cookie de session admin :
 *   - jeton aléatoire de 256 bits, sans rapport avec ADMIN_SECRET ; seule son empreinte SHA-256
 *     est stockée (table admin_sessions) — ni la clé ni le jeton ne sont écrits nulle part ;
 *   - cookie HttpOnly (illisible par le JavaScript), Secure en production, SameSite=Strict,
 *     limité au chemin /api/admin ;
 *   - durée limitée : 12 h au plus, et fermeture après 2 h sans activité ;
 *   - accepté seulement avec l'en-tête X-Dig-Admin (posé par le panel) : un autre site ne peut
 *     pas déclencher une action admin avec le cookie (CSRF) ;
 *   - révocation : « Déconnexion » (cette session), « Déconnecter partout » (toutes) ; changer
 *     ADMIN_SECRET invalide toutes les sessions existantes (empreinte de la clé mémorisée).
 * L'accès par en-tête Authorization: Bearer <ADMIN_SECRET> reste valable (scripts, tests).
 */

'use strict';

const crypto = require('crypto');
const db     = require('./db');

const COOKIE      = 'dig_admin';
const COOKIE_PATH = '/api/admin';
const HEADER      = 'x-dig-admin';
const MAX_AGE_MS  = 12 * 3600 * 1000;
const IDLE_MS     = 2 * 3600 * 1000;
const TOUCH_MS    = 60 * 1000;   // last_seen écrit au plus une fois par minute

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const conn = () => db.getDb();

/** Empreinte de la clé admin, liée au secret de session : changer l'une ou l'autre invalide tout. */
function secretFingerprint(adminSecret, sessionSecret) {
  return crypto.createHmac('sha256', String(sessionSecret)).update(`dig-admin:${adminSecret}`).digest('hex');
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function cookieOptions(secure) {
  return { httpOnly: true, secure, sameSite: 'strict', path: COOKIE_PATH };
}

/** Purge les sessions expirées ou révoquées depuis plus d'un jour (table minuscule). */
function _purge(now) {
  conn().prepare('DELETE FROM admin_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
    .run(now - 86400000, now - 86400000);
}

/** Crée une session et retourne { token, expiresAt } (le jeton ne part que dans le cookie). */
function create(fp, now = Date.now()) {
  _purge(now);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now + MAX_AGE_MS;
  conn().prepare('INSERT INTO admin_sessions (token_hash, secret_fp, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), fp, now, now, expiresAt);
  return { token, expiresAt };
}

/** Session valide pour ce jeton, ou null. Prolonge l'inactivité (jamais la durée maximale). */
function check(token, fp, now = Date.now()) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const row = conn().prepare('SELECT * FROM admin_sessions WHERE token_hash = ?').get(sha256(token));
  if (!row || row.revoked_at || row.secret_fp !== fp) return null;
  if (now >= row.expires_at || now - row.last_seen >= IDLE_MS) return null;
  if (now - row.last_seen >= TOUCH_MS) {
    conn().prepare('UPDATE admin_sessions SET last_seen = ? WHERE token_hash = ?').run(now, row.token_hash);
    row.last_seen = now;
  }
  return { expiresAt: Math.min(row.expires_at, row.last_seen + IDLE_MS), absoluteExpiresAt: row.expires_at };
}

function revoke(token, now = Date.now()) {
  if (!token) return 0;
  return conn().prepare('UPDATE admin_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(now, sha256(token)).changes;
}

function revokeAll(now = Date.now()) {
  return conn().prepare('UPDATE admin_sessions SET revoked_at = ? WHERE revoked_at IS NULL').run(now).changes;
}

module.exports = { COOKIE, COOKIE_PATH, HEADER, MAX_AGE_MS, IDLE_MS, secretFingerprint, readCookie, cookieOptions, create, check, revoke, revokeAll };
