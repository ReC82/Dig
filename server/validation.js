/**
 * validation.js — Validation des entrées utilisateur côté serveur (ticket #15).
 */

'use strict';

// Partie locale : caractères « atom » de la RFC 5322, sans guillemets ni chevrons.
// Domaine : libellés alphanumériques (tirets internes), au moins un point.
const EMAIL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/**
 * Vérifie le format d'une adresse e-mail : 254 caractères max, partie locale
 * de 64 max, aucun espace, guillemet, chevron, barre oblique inverse ni caractère de contrôle.
 */
function isValidEmail(e) {
  if (typeof e !== 'string') return false;
  const v = e.trim();
  if (v.length > 254) return false;
  const at = v.lastIndexOf('@');
  if (at < 1 || at > 64) return false;
  return EMAIL_RE.test(v);
}

/**
 * Entier de requête borné (?page=, ?limit=, ?offset=) : une valeur absente, non numérique
 * (`?page=abc`) ou hors bornes donne la valeur par défaut ou la borne, jamais NaN (B11).
 */
function intParam(value, { def, min, max = 1e9 }) {
  const n = /^\s*-?\d+\s*$/.test(String(value ?? '')) ? parseInt(value, 10) : def;
  return Math.min(max, Math.max(min, n));
}

module.exports = { isValidEmail, intParam };
