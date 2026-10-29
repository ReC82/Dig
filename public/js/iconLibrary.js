/**
 * iconLibrary.js
 * Choix de la bibliothèque d'icônes des blocs : `legacy` (emoji, rendu historique, PAR DÉFAUT)
 * ou `v1` (images générées, matériau par matériau).
 *
 * - `legacy` : exactement l'ancien rendu (`textContent = icône`), aucun attribut ajouté.
 * - `v1` : image seulement pour les matériaux présents dans assets/icons/library.json ;
 *   tout autre matériau, une image absente ou en erreur de chargement → rendu legacy.
 *
 * Bibliothèque active, par ordre de priorité :
 *   1. paramètre d'URL `?icons=v1|legacy` (mémorisé pour ce navigateur ; `?icons=default` l'efface) ;
 *   2. `defaultLibrary` de assets/icons/library.json (lu sans cache : changement sans redéploiement) ;
 *   3. `legacy`.
 * Rollback global immédiat : remettre `"defaultLibrary": "legacy"` dans library.json.
 */
const IconLibrary = {

  LIBRARIES: ['legacy', 'v1'],
  STORAGE_KEY: 'dig.iconLibrary',
  CONFIG_URL: 'assets/icons/library.json',

  /** Configuration chargée (library.json) ; null tant qu'elle n'est pas lue → legacy. */
  config: null,
  /** Images v1 en échec de chargement pendant cette session (repli legacy définitif). */
  failed: new Set(),

  /** Identifiant stable d'un type de bloc : « block.pierre » → « pierre ». */
  materialId(type) {
    return String(type.name || '').replace(/^block\./, '');
  },

  /** Lit et mémorise un éventuel ?icons=… ; rend la surcharge du navigateur ou null. */
  override(search = (typeof location !== 'undefined' ? location.search : ''), storage = IconLibrary._storage()) {
    const asked = new URLSearchParams(search).get('icons');
    try {
      if (asked === 'default') storage && storage.removeItem(IconLibrary.STORAGE_KEY);
      else if (IconLibrary.LIBRARIES.includes(asked)) storage && storage.setItem(IconLibrary.STORAGE_KEY, asked);
    } catch (_) { /* stockage indisponible : la surcharge vaut pour cette page seulement */ }
    if (IconLibrary.LIBRARIES.includes(asked)) return asked;
    try {
      const saved = storage && storage.getItem(IconLibrary.STORAGE_KEY);
      return IconLibrary.LIBRARIES.includes(saved) ? saved : null;
    } catch (_) {
      return null;
    }
  },

  _storage() {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
  },

  /** Bibliothèque active. */
  active() {
    const forced = IconLibrary.override();
    if (forced) return forced;
    const def = IconLibrary.config && IconLibrary.config.defaultLibrary;
    return IconLibrary.LIBRARIES.includes(def) ? def : 'legacy';
  },

  /** Asset v1 d'un matériau, ou null (→ legacy). */
  asset(type) {
    const lib = IconLibrary.config && IconLibrary.config.libraries && IconLibrary.config.libraries.v1;
    const id = IconLibrary.materialId(type);
    const entry = lib && lib.materials && lib.materials[id];
    if (!entry || IconLibrary.failed.has(id)) return null;
    return { id, base: lib.base, entry };
  },

  /** Rendu historique, inchangé. */
  renderLegacy(el, type) {
    if (el.removeAttribute) el.removeAttribute('data-icon-lib');
    el.textContent = type.icon;
  },

  /** Affiche l'icône d'un type de bloc dans l'élément #block-icon. */
  render(el, type) {
    const a = IconLibrary.active() === 'v1' ? IconLibrary.asset(type) : null;
    if (!a) return IconLibrary.renderLegacy(el, type);

    const img = document.createElement('img');
    img.className = 'block-icon-img';
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.width = 128;
    img.height = 128;
    img.src = a.base + a.entry.webp['128'];
    img.srcset = `${a.base}${a.entry.webp['128']} 1x, ${a.base}${a.entry.webp['256']} 2x`;
    img.onerror = () => {
      IconLibrary.failed.add(a.id);
      if (el.contains(img)) IconLibrary.renderLegacy(el, type);
    };
    el.textContent = '';
    el.setAttribute('data-icon-lib', 'v1');
    el.appendChild(img);
  },

  /** Charge library.json sans cache, puis rappelle `onReady` (re-rendu du bloc courant). */
  load(onReady) {
    if (typeof fetch === 'undefined') return Promise.resolve();
    return fetch(IconLibrary.CONFIG_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        IconLibrary.config = cfg;
        if (onReady) onReady();
      })
      .catch(() => { /* config absente ou invalide : legacy */ });
  },
};

if (typeof module !== 'undefined') module.exports = IconLibrary;
