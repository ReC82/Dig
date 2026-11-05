/**
 * gemCallout.js — Création de la promotion interne DIG! (#45, demande du 04/11/2026).
 *
 * Bannière maison aux formats des emplacements hauts (320×50 mobile, 728×90 ordinateur) :
 * gemme en pixel art (SVG local), « Besoin de gemmes ? », bouton « Découvrir la boutique »
 * et la mention « Promotion DIG! ». Aucune image distante, aucun prix ni quantité, aucune
 * promesse de gemmes gratuites. Utilisée par le jeu (public/js/ads.js) et par l'aperçu de
 * l'admin. Noms neutres (gem-callout) : ignorés par les filtres cosmétiques des bloqueurs.
 */
const DigGemCallout = (() => {
  // Gemme 11×10 : o contour, l clair, m moyen, d sombre, w reflet
  const GEM = [
    '...ooooo...',
    '..olwlmlo..',
    '.olwlmmldo.',
    'ooooooooooo',
    '.olmmmmmdo.',
    '..olmmmdo..',
    '...olmdo...',
    '....omo....',
    '.....o.....',
  ];
  const COLORS = { o: '#0b3140', l: '#7dedfb', m: '#22c3e6', d: '#0b7fa0', w: '#ecfdff' };

  function gemSvg() {
    const rects = [];
    GEM.forEach((row, y) => [...row].forEach((c, x) => {
      if (COLORS[c]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${COLORS[c]}"/>`);
    }));
    return `<svg class="gem-callout-gem" viewBox="0 0 11 9" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${rects.join('')}</svg>`;
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /**
   * Bouton complet (toute la bannière est cliquable).
   * @param {'top_mobile'|'top_desktop'} slot
   * @param {{tag:string,title:string,text:string,cta:string,ctaShort:string}} labels
   * @param {() => void} [onClick]  absent : aperçu inerte (admin)
   */
  function create(slot, labels, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const wide = slot === 'top_desktop';
    btn.className = `gem-callout gem-callout--${wide ? 'wide' : 'compact'}`;
    btn.setAttribute('aria-label', `${labels.tag} — ${labels.title} ${labels.cta}`);
    btn.innerHTML = `${gemSvg()}
      <span class="gem-callout-copy">
        <span class="gem-callout-tag">${esc(labels.tag)}</span>
        <span class="gem-callout-title">${esc(labels.title)}</span>
        <span class="gem-callout-text">${esc(labels.text)}</span>
      </span>
      <span class="gem-callout-cta">${esc(wide ? labels.cta : labels.ctaShort)} <span aria-hidden="true">›</span></span>`;
    if (onClick) btn.addEventListener('click', onClick);
    else { btn.tabIndex = -1; btn.setAttribute('aria-disabled', 'true'); }
    return btn;
  }

  return { create, gemSvg };
})();
