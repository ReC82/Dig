/**
 * languages.js — Registre central des langues de DIG! (#59)
 *
 * Partagé tel quel par le navigateur (window.DigLanguages) et le serveur (require).
 * Ajouter une langue = une ligne ici + un fichier de traductions (tools/i18n), sans toucher au code.
 *
 *   code        étiquette BCP 47 (langue principale, minuscules) : 'it', 'ru', 'pt-BR'…
 *   nativeName  nom affiché au joueur, dans sa propre langue (jamais un drapeau seul)
 *   englishName nom donné aux modèles IA et aux outils
 *   intl        locale Intl (dates, nombres, pluriels)
 *   script      écriture ISO 15924 (Latn, Cyrl…) : contrôle « langue improbable »
 *   dir         sens d'écriture
 *   status      'active'  : proposée à tous, contenus serveur (collections, badges…) exigés dans cette langue
 *               'preview' : masquée au public ; accessible aux testeurs par ?lang=<code>, repli FR
 *               'planned' : déclarée seulement (aucune traduction lancée, inaccessible)
 *   builtin     true : dictionnaire intégré à i18n.js ; sinon fichier généré js/locales/<code>.js
 *   flag        drapeau décoratif facultatif (une langue n'est pas un pays) : clé de I18n FLAGS
 *
 * Langue de référence et de repli : le français (FALLBACK), pour tout texte absent.
 */
(function (root) {
  'use strict';

  const FALLBACK = 'fr';

  const LANGUAGES = [
    { code: 'fr', nativeName: 'Français',   englishName: 'French',  intl: 'fr-BE', script: 'Latn', dir: 'ltr', status: 'active',  builtin: true, flag: 'fr' },
    { code: 'en', nativeName: 'English',    englishName: 'English', intl: 'en-GB', script: 'Latn', dir: 'ltr', status: 'active',  builtin: true, flag: 'en' },
    { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch',   intl: 'nl-BE', script: 'Latn', dir: 'ltr', status: 'active',  builtin: true, flag: 'nl' },
    { code: 'es', nativeName: 'Español',    englishName: 'Spanish', intl: 'es-ES', script: 'Latn', dir: 'ltr', status: 'active',  builtin: true, flag: 'es' },
    // Pilote #59 : masqué au public jusqu'à la recette par un locuteur natif
    { code: 'it', nativeName: 'Italiano',   englishName: 'Italian', intl: 'it-IT', script: 'Latn', dir: 'ltr', status: 'preview', builtin: false, flag: 'it' },
    // Plus tard (test du cyrillique) : aucune traduction lancée automatiquement
    { code: 'ru', nativeName: 'Русский',    englishName: 'Russian', intl: 'ru-RU', script: 'Cyrl', dir: 'ltr', status: 'planned', builtin: false, flag: null },
  ];

  const byCode = Object.fromEntries(LANGUAGES.map(l => [l.code, l]));

  /** Normalise une étiquette (« it-IT », « IT », « pt_br ») vers un code du registre, ou null. */
  function normalize(tag) {
    const s = String(tag ?? '').trim().replace(/_/g, '-').toLowerCase();
    if (!s) return null;
    if (byCode[s]) return s;
    const base = s.split('-')[0];
    return byCode[base] ? base : null;
  }

  const get = code => byCode[normalize(code)] || null;
  const codes = status => LANGUAGES.filter(l => !status || l.status === status).map(l => l.code);

  /** Langues proposées à tous les joueurs (et exigées pour publier un contenu serveur). */
  const ACTIVE = codes('active');
  /** Langues sélectionnables : actives, et preview si le testeur l'a demandée explicitement. */
  const selectable = (withPreview = false) => LANGUAGES.filter(l => l.status === 'active' || (withPreview && l.status === 'preview'));
  /** Nom anglais (prompts IA) : { fr: 'French', … } pour toutes les langues déclarées. */
  const ENGLISH_NAMES = Object.fromEntries(LANGUAGES.map(l => [l.code, l.englishName]));

  const api = Object.freeze({ FALLBACK, LANGUAGES, ACTIVE, ENGLISH_NAMES, normalize, get, codes, selectable });

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DigLanguages = api;
})(typeof self !== 'undefined' ? self : this);
