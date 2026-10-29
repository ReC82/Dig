/**
 * escapeHtml.js — Échappement HTML des données utilisateur (ticket #15).
 * À utiliser pour toute valeur non maîtrisée insérée dans un gabarit innerHTML.
 * Chargé par le jeu et par le panel admin ; exporté aussi pour les tests Node.
 */

(function (root) {
  const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"'`]/g, c => MAP[c]);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { escapeHtml };
  else root.escapeHtml = escapeHtml;
})(typeof window !== 'undefined' ? window : this);
