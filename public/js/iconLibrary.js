/**
 * iconLibrary.js
 * Choix de la bibliothèque d'icônes des blocs : `v1` (images générées, PAR DÉFAUT depuis le
 * 30/10/2026, validées par le propriétaire) ou `legacy` (emoji, rendu historique).
 *
 * - `legacy` : exactement l'ancien rendu (`textContent = icône`), aucun attribut ajouté.
 * - `v1` : image seulement pour les matériaux présents dans assets/icons/library.json ;
 *   tout autre matériau, une image absente ou en erreur de chargement → rendu legacy.
 *
 * Bibliothèque active, par ordre de priorité :
 *   1. paramètre d'URL `?icons=v1|legacy` (mémorisé pour ce navigateur ; `?icons=default` l'efface) ;
 *   2. `defaultLibrary` de assets/icons/library.json (lu sans cache : changement sans redéploiement) ;
 *   3. `legacy` (configuration illisible ou absente, ex. hors ligne).
 * Rollback global immédiat : remettre `"defaultLibrary": "legacy"` dans library.json.
 * Tant que la configuration est en cours de lecture (au plus LOAD_TIMEOUT_MS), le bloc est
 * affiché sans icône plutôt qu'avec l'emoji, pour éviter un clignotement emoji → image.
 */
const IconLibrary = {

  LIBRARIES: ['legacy', 'v1'],
  // Clé renouvelée au passage de v1 par défaut : un ancien choix mémorisé (?icons=legacy pendant
  // la recette) ne doit pas garder les emoji. L'ancienne clé est effacée à la lecture.
  STORAGE_KEY: 'dig.iconLibrary.2',
  OLD_STORAGE_KEYS: ['dig.iconLibrary'],
  LOAD_TIMEOUT_MS: 3000,
  CONFIG_URL: 'assets/icons/library.json',

  /** Configuration chargée (library.json) ; null tant qu'elle n'est pas lue → legacy. */
  config: null,
  /** Images v1 en échec de chargement pendant cette session (repli legacy définitif). */
  failed: new Set(),
  /** Vrai dans le navigateur jusqu'à la fin de load() (succès, échec ou délai dépassé). */
  pending: typeof window !== 'undefined' && typeof fetch !== 'undefined',

  /** Identifiant stable d'un type de bloc : « block.pierre » → « pierre ». */
  materialId(type) {
    return type.id || String(type.name || '').replace(/^block\./, '');
  },

  /** Lit et mémorise un éventuel ?icons=… ; rend la surcharge du navigateur ou null. */
  override(search = (typeof location !== 'undefined' ? location.search : ''), storage = IconLibrary._storage()) {
    const asked = new URLSearchParams(search).get('icons');
    try {
      if (storage) IconLibrary.OLD_STORAGE_KEYS.forEach((k) => storage.removeItem(k));
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

  /** Image choisie dans le catalogue de blocs administrable (#37), prioritaire ; null sinon. */
  catalogImage(type) {
    const src = type && type.image;
    return typeof src === 'string' && /^(\/assets\/[A-Za-z0-9_\-\/.]+\.(webp|png|svg)|\/media\/(blocks|icons)\/[a-f0-9]{16}\.webp)$/.test(src) && !src.includes('..')
      && !IconLibrary.failed.has(`image:${src}`) ? src : null;
  },

  /** Affiche l'icône d'un type de bloc dans l'élément #block-icon. */
  render(el, type) {
    const own = IconLibrary.catalogImage(type);
    if (own) {
      const img = document.createElement('img');
      img.className = 'block-icon-img';
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      img.width = 128;
      img.height = 128;
      img.src = own;
      img.onerror = () => {
        IconLibrary.failed.add(`image:${own}`);
        if (el.contains(img)) IconLibrary.renderLegacy(el, type);
      };
      el.textContent = '';
      el.setAttribute('data-icon-lib', 'catalog');
      el.appendChild(img);
      return;
    }
    if (IconLibrary.pending) {
      el.removeAttribute('data-icon-lib');
      el.textContent = '';
      return;
    }
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
    const ready = () => { IconLibrary.pending = false; if (onReady) onReady(); };
    if (typeof fetch === 'undefined') { ready(); return Promise.resolve(); }
    // Réseau lent : au-delà du délai, legacy en attendant (la configuration reçue ensuite s'applique).
    const timer = setTimeout(() => { if (IconLibrary.pending) ready(); }, IconLibrary.LOAD_TIMEOUT_MS);
    return fetch(IconLibrary.CONFIG_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => { IconLibrary.config = cfg; })
      .catch(() => { /* config absente ou invalide : legacy */ })
      .then(() => { clearTimeout(timer); ready(); });
  },
};

if (typeof module !== 'undefined') module.exports = IconLibrary;
