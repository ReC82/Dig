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

module.exports = { isValidEmail };
