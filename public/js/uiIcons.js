/**
 * uiIcons.js — pictogrammes d'interface appliqués depuis l'atelier d'icônes (#67).
 *
 * Le serveur (GET /api/ui-icons, sans cache) donne { icons: { <id>: '/media/icons/<sha>.webp' }, rev }.
 * Les identifiants sont ceux du registre server/uiIcons.js (ex. « collection », « pieces »).
 *  - Éléments statiques : `data-ui-icon="<id>"` ; leur contenu d'origine (emoji ou SVG) est conservé
 *    et rétabli si l'image est retirée ou ne se charge pas.
 *  - Rendus dynamiques : `UiIcons.html(id, emoji)` rend l'image ou l'emoji d'origine (échappé).
 *  - Libellés traduits commençant par un pictogramme (« 🏁 Résultat — … », #67-B) : `UiIcons.lead(id, texte)`
 *    pour un rendu dynamique, `data-ui-lead="<id>"` sur un élément statique [data-i18n]. Sans image
 *    appliquée, le libellé reste strictement identique (aucun élément ajouté).
 * Repli permanent : sans réponse du serveur, hors ligne ou image en échec → emoji/SVG d'origine.
 * La dernière liste reçue est gardée (localStorage) pour éviter un clignotement au démarrage ; elle est
 * remplacée dès la réponse du serveur, donc un retour arrière s'applique au chargement suivant.
 * Aperçu sans rien appliquer : `?uiicon=<id>:<sha16>[,<id>:<sha16>…]` (non mémorisé, cette page seulement).
 */
'use strict';

const UiIcons = (() => {
  const STORAGE_KEY = 'dig.uiIcons.1';
  const URL_RE = /^\/media\/icons\/[a-f0-9]{16}\.webp$/;
  const ID_RE = /^[a-z][a-z0-9_]{1,39}$/;
  let icons = {};
  let preview = {};
  const failed = new Set();
  const originals = new WeakMap();

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Ne garde que des paires id → /media/icons/<sha>.webp valides. */
  function _clean(map) {
    const out = {};
    for (const [id, url] of Object.entries(map && typeof map === 'object' ? map : {})) {
      if (ID_RE.test(id) && URL_RE.test(String(url))) out[id] = String(url);
    }
    return out;
  }

  function _parsePreview(search) {
    const out = {};
    let v = null;
    try { v = new URLSearchParams(search).get('uiicon'); } catch (_) { return out; }
    for (const part of String(v ?? '').split(',')) {
      const m = /^([a-z][a-z0-9_]{1,39}):([a-f0-9]{16})$/.exec(part.trim());
      if (m) out[m[1]] = `/media/icons/${m[2]}.webp`;
    }
    return out;
  }

  /** URL de l'image du pictogramme `id`, ou null (→ emoji/SVG d'origine). */
  function url(id) {
    const u = preview[id] || icons[id] || null;
    return u && !failed.has(u) ? u : null;
  }

  /** HTML d'un pictogramme pour un rendu dynamique : image appliquée, sinon l'emoji d'origine. */
  function html(id, emoji) {
    const u = url(id);
    if (!u) return esc(emoji);
    return `<img class="ui-ico" src="${esc(u)}" alt="" aria-hidden="true" draggable="false" data-ui-fallback="${esc(emoji)}">`;
  }

  // Pictogramme en tête d'un libellé : un emoji (avec sélecteur de variante, modificateur ou séquence ZWJ)
  // suivi d'espaces. « ? » n'en est pas un : les boutons d'aide passent par `data-ui-icon` / html().
  const LEAD_RE = /^(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*)\s*/u;

  /** [pictogramme de tête, reste du libellé] ; pictogramme vide si le libellé n'en a pas. */
  function splitLead(text) {
    const s = String(text ?? '');
    const m = LEAD_RE.exec(s);
    return m ? [m[1], s.slice(m[0].length)] : ['', s];
  }

  /**
   * Libellé traduit (HTML de confiance, déjà échappé par l'appelant s'il le faut) dont le pictogramme de tête
   * est remplacé par l'image appliquée `id`. Sans image, ou libellé sans pictogramme : libellé inchangé.
   */
  function lead(id, text) {
    const s = String(text ?? '');
    if (!url(id)) return s;
    const [emoji, rest] = splitLead(s);
    return emoji ? `${html(id, emoji)} ${rest}` : s;
  }

  /** Éléments statiques `[data-ui-lead]` : pictogramme de tête isolé dans un `[data-ui-icon]` seulement si une image est appliquée. */
  function _decorateLeads(root) {
    for (const el of root.querySelectorAll('[data-ui-lead]')) {
      const slot = el.querySelector(':scope > .ui-lead');
      if (url(el.dataset.uiLead)) {
        if (slot) continue;
        const text = el.textContent;
        const [emoji, rest] = splitLead(text);
        if (!emoji) continue;
        el.dataset.uiLeadText = text;
        const span = document.createElement('span');
        span.className = 'ui-lead';
        span.dataset.uiIcon = el.dataset.uiLead;
        span.textContent = emoji;
        el.replaceChildren(span, ` ${rest}`);
      } else if (slot && el.dataset.uiLeadText != null) {
        el.textContent = el.dataset.uiLeadText;   // image retirée : libellé d'origine, sans élément ajouté
      }
    }
  }

  /** Applique la liste aux éléments `[data-ui-icon]` (contenu d'origine conservé et rétabli au besoin). */
  function decorate(root) {
    if (typeof document === 'undefined') return;
    _decorateLeads(root || document);
    for (const el of (root || document).querySelectorAll('[data-ui-icon]')) {
      if (!originals.has(el)) originals.set(el, el.innerHTML);
      const u = url(el.dataset.uiIcon);
      const img = el.querySelector(':scope > img.ui-ico');
      if (u && img && img.getAttribute('src') === u) continue;
      if (u) {
        el.innerHTML = `<img class="ui-ico" src="${esc(u)}" alt="" aria-hidden="true" draggable="false">`;
        el.classList.add('has-ui-ico');
      } else if (el.classList.contains('has-ui-ico')) {
        el.innerHTML = originals.get(el);
        el.classList.remove('has-ui-ico');
      }
    }
  }

  /** Image en échec : repli définitif pour cette session (emoji ou contenu d'origine). */
  function _onError(e) {
    const img = e.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('ui-ico')) return;
    failed.add(img.getAttribute('src'));
    const holder = img.parentElement && img.parentElement.closest('[data-ui-icon]');
    if (holder && holder.firstElementChild === img && originals.has(holder)) {
      holder.innerHTML = originals.get(holder);
      holder.classList.remove('has-ui-ico');
    } else {
      img.replaceWith(document.createTextNode(img.dataset.uiFallback || ''));
    }
  }

  function _storage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
  }

  /**
   * Lit la liste du serveur, applique les éléments statiques, puis appelle `onChange()` si elle a changé
   * (re-rendu des vues dynamiques). La liste mémorisée est appliquée tout de suite.
   */
  function load(onChange) {
    preview = typeof location !== 'undefined' ? _parsePreview(location.search) : {};
    const st = _storage();
    try { icons = _clean(JSON.parse((st && st.getItem(STORAGE_KEY)) || '{}').icons); } catch (_) { icons = {}; }
    decorate();
    if (typeof fetch === 'undefined') return Promise.resolve();
    const before = JSON.stringify(icons);
    return fetch('/api/ui-icons', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        icons = _clean(data.icons);
        try { st && st.setItem(STORAGE_KEY, JSON.stringify({ icons, rev: data.rev })); } catch (_) { /* stockage plein : sans effet */ }
      })
      .catch(() => { /* hors ligne : liste mémorisée, sinon pictogrammes d'origine */ })
      .then(() => {
        decorate();
        if (JSON.stringify(icons) !== before || Object.keys(preview).length) { try { onChange && onChange(); } catch (err) { console.warn('[uiIcons]', err); } }
      });
  }

  if (typeof document !== 'undefined') document.addEventListener('error', _onError, true);

  return { load, html, lead, splitLead, url, decorate, _parsePreview, _clean, get icons() { return { ...icons }; } };
})();

if (typeof module !== 'undefined') module.exports = UiIcons;
