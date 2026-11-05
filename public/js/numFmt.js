/**
 * numFmt.js — Affichage des dégâts et des PV (#81).
 * Dépend de : I18n (langue courante, facultatif).
 *
 * Les calculs du moteur se font au centième près (GameState.toCents, Blocks.hit) ; cet affichage
 * n'arrondit QUE le texte montré :
 *   - par défaut, entier : dégâts arrondis au plus proche (1,25 → « 1 »), PV arrondis à l'entier
 *     supérieur (0,25 PV restant → « 1 », jamais « 0 » tant que le bloc tient) ;
 *   - option « Afficher les valeurs précises » (Paramètres, mémorisée sur l'appareil, OFF par
 *     défaut) : jusqu'à 2 décimales, sans zéros inutiles, séparateur de la langue (FR 1,25 ; EN 1.25).
 * Une valeur positive inférieure à 1 n'est jamais affichée « 0 » : elle garde ses décimales.
 */
const NumFmt = {

  PREF_KEY: 'dig.precise',

  /** Option « Afficher les valeurs précises » (false si le stockage est indisponible). */
  isPrecise() {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(this.PREF_KEY) === '1'; }
    catch (_) { return false; }
  },

  setPrecise(on) {
    try {
      if (on) localStorage.setItem(this.PREF_KEY, '1');
      else localStorage.removeItem(this.PREF_KEY);
    } catch (_) { /* stockage indisponible : option non mémorisée */ }
  },

  _lang() { return typeof I18n !== 'undefined' ? I18n.getCurrent() : 'fr'; },

  /** Valeur exacte au centième, séparateur de la langue, sans zéros inutiles ni séparateur de milliers. */
  exact(v, lang = this._lang()) {
    const n = Math.round(Number(v) * 100) / 100;
    if (!Number.isFinite(n)) return '0';
    try { return n.toLocaleString(lang, { maximumFractionDigits: 2, useGrouping: false }); }
    catch (_) { return String(n); }
  },

  /** Dégâts : entier le plus proche par défaut, exacts avec l'option (ou s'ils sont inférieurs à 1). */
  damage(v, precise = this.isPrecise()) {
    const n = Number(v) || 0;
    if (precise || (n > 0 && n < 1)) return this.exact(n);
    return String(Math.round(n));
  },

  /** PV : entier supérieur par défaut (jamais 0 pour un bloc encore debout), exacts avec l'option. */
  hp(v, precise = this.isPrecise()) {
    const n = Number(v) || 0;
    if (precise) return this.exact(n);
    return String(Math.ceil(Math.round(n * 100) / 100));
  },
};
