/**
 * logoPreview.js — aperçu des propositions de logo DIG! dans le véritable en-tête (#41).
 *
 * Rien ne change pour les joueurs : le titre texte « ⛏ DIG! » reste le logo par défaut
 * tant que le propriétaire n'a pas choisi. L'aperçu ne s'active que par l'URL et n'est
 * pas mémorisé :
 *   ?logo=a | b | c | d      → propositions SVG de public/assets/logo/
 *   ?logo=media:<sha16>      → proposition générée dans l'atelier d'icônes (#40, cible « logo »)
 */
'use strict';

const LogoPreview = (() => {
  const PROPOSALS = {
    a: 'assets/logo/a-lingot.svg',
    b: 'assets/logo/b-strates.svg',
    c: 'assets/logo/c-ecusson.svg',
    d: 'assets/logo/d-pioche.svg',
  };

  /** URL de l'image d'aperçu pour une valeur de ?logo=, ou null (valeur inconnue ou absente). */
  function resolve(value) {
    const v = String(value ?? '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PROPOSALS, v)) return PROPOSALS[v];
    const m = /^media:([a-f0-9]{16})$/.exec(v);
    return m ? `/media/icons/${m[1]}.webp` : null;
  }

  function apply() {
    let value = null;
    try { value = new URLSearchParams(location.search).get('logo'); } catch (_) { return; }
    const src = resolve(value);
    const h1 = document.getElementById('game-logo');
    if (!src || !h1) return;
    const media = src.startsWith('/media/');
    const img = document.createElement('img');
    img.src = src;
    img.alt = 'DIG!';
    // Emblème carré de l'atelier : accompagné du mot « DIG! » pour comparer à encombrement égal.
    h1.textContent = '';
    h1.classList.add('logo-preview');
    if (media) {
      h1.classList.add('logo-preview-emblem');
      img.alt = '';
      h1.appendChild(img);
      h1.appendChild(document.createTextNode('DIG!'));
    } else {
      h1.appendChild(img);
    }
    h1.title = `Aperçu logo : ${value}`;
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }

  return { resolve, PROPOSALS };
})();

if (typeof module !== 'undefined') module.exports = LogoPreview;
