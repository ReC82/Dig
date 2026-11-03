/**
 * Registre des langues côté serveur (#59) : le même fichier que le navigateur
 * (public/js/languages.js), pour qu'aucun module ne recode en dur « fr/en/nl/es ».
 *
 *   CONTENT_LANGS : langues actives, exigées dans les contenus saisis (collections, badges,
 *                   boutique, actualités, événements, blocs). Une langue « preview » n'y entre
 *                   qu'à son activation : elle ne bloque donc aucune publication.
 *   ENGLISH_NAMES : libellés des langues pour les prompts IA.
 */
'use strict';

const registry = require('../public/js/languages');

module.exports = {
  ...registry,
  CONTENT_LANGS: Object.freeze([...registry.ACTIVE]),
};
