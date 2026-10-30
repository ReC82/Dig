/**
 * collection.js
 * Catalogue des trouvailles et logique de drop.
 * Dépend de : GameState
 *
 * Collections saisonnières (#39) : le catalogue publié par le serveur (GET /api/collections/catalog)
 * remplace FINDS dès qu'il est reçu (puis est mémorisé localement). Sa version 1 reprend à
 * l'identique les 8 trouvailles ci-dessous (mêmes blocs, profondeurs, chances et ordre) dans la
 * série permanente « origines ». Une série rattachée à une saison ne donne ses objets que pendant
 * cette saison ; ensuite elle reste consultable dans les archives.
 * Date et quantité trouvées : GameState.collectionMeta { id: { at, n, season } } (absent pour les
 * objets trouvés avant #39 : la date n'est pas inventée).
 */
const Collection = {

  FINDS: [
    {
      id: 'fossil',
      name: 'find.fossil.name',
      icon: '🦴',
      desc: 'find.fossil.desc',
      dropFrom: ['pierre'],
      minDepth: 8,
      chance: 0.04,
    },
    {
      id: 'crystal',
      name: 'find.crystal.name',
      icon: '💠',
      desc: 'find.crystal.desc',
      dropFrom: ['minerai'],
      minDepth: 12,
      chance: 0.05,
    },
    {
      id: 'ancient_coin',
      name: 'find.coin.name',
      icon: '🪙',
      desc: 'find.coin.desc',
      dropFrom: ['terre', 'pierre'],
      minDepth: 18,
      chance: 0.03,
    },
    {
      id: 'relic',
      name: 'find.relic.name',
      icon: '⚱️',
      desc: 'find.relic.desc',
      dropFrom: ['coffre'],
      minDepth: 10,
      chance: 0.15,
    },
    {
      id: 'broken_crown',
      name: 'find.crown.name',
      icon: '👑',
      desc: 'find.crown.desc',
      dropFrom: ['coffre'],
      minDepth: 35,
      chance: 0.20,
    },
    {
      id: 'monster_tooth',
      name: 'find.tooth.name',
      icon: '🦷',
      desc: 'find.tooth.desc',
      dropFrom: ['gemme'],
      minDepth: 35,
      chance: 0.10,
    },
    {
      id: 'map_fragment',
      name: 'find.map.name',
      icon: '🗺',
      desc: 'find.map.desc',
      dropFrom: ['pierre', 'minerai'],
      minDepth: 55,
      chance: 0.035,
    },
    {
      id: 'mystic_orb',
      name: 'find.orb.name',
      icon: '🔮',
      desc: 'find.orb.desc',
      dropFrom: ['gemme'],
      minDepth: 70,
      chance: 0.08,
    },
  ],

  /**
   * Tente un drop lors de la destruction d'un bloc.
   * Chaque trouvaille non encore obtenue et éligible est testée.
   * @param {object} blockType — type du bloc (Blocks.TYPES[i])
   * @param {number} depth
   * @returns {object|null} la trouvaille obtenue, ou null
   */
  tryDrop(blockType, depth, random = Math.random) {
    const eligible = this.FINDS.filter(f =>
      this.canDrop(f) &&
      !GameState.collection.includes(f.id) &&
      depth >= f.minDepth &&
      f.dropFrom.includes(blockType.category)
    );

    for (const find of eligible) {
      if (random() < find.chance) {
        this.add(find.id);
        return find;
      }
    }
    return null;
  },

  getById(id) {
    return this.FINDS.find(f => f.id === id);
  },

  countFound() {
    return GameState.collection.length;
  },

  // ── Catalogue publié (#39) ────────────────────────────────────────────────

  /** Identifiants d'origine (ceux que les coffres de la boutique peuvent donner, cf. chestShop.js). */
  ORIGIN_IDS: ['fossil', 'crystal', 'ancient_coin', 'relic', 'broken_crown', 'monster_tooth', 'map_fragment', 'mystic_orb'],
  catalogVersion: 0,
  CATALOG_URL: '/api/collections/catalog',
  CATALOG_STORAGE_KEY: 'dig.collectionCatalog',
  SERIES: [{ id: 'origines', names: null, seasonId: null, icon: '📦', active: true }],
  SEASONS: {},

  /** Objet du catalogue → trouvaille du jeu. Null si invalide. */
  _fromCatalog(c) {
    if (!c || typeof c.id !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(c.id)) return null;
    const d = c.drop || {};
    if (!Array.isArray(d.from) || !Number.isFinite(d.minDepth) || !Number.isFinite(d.chance)) return null;
    const legacy = this.FINDS.find(f => f.id === c.id && f.name);
    return {
      id: c.id, name: legacy ? legacy.name : null, desc: legacy ? legacy.desc : null,
      names: c.names && typeof c.names === 'object' ? c.names : null,
      stories: c.stories && typeof c.stories === 'object' ? c.stories : null,
      icon: String(c.icon || '❔'), image: typeof c.image === 'string' ? c.image : null,
      rarity: String(c.rarity || 'commun'), seriesId: String(c.seriesId || 'origines'),
      dropFrom: d.from.map(String), minDepth: d.minDepth, chance: d.chance,
      dropEnabled: c.dropEnabled === true, active: c.active !== false,
    };
  },

  applyCatalog(catalog) {
    if (!catalog || !Number.isInteger(catalog.version) || !Array.isArray(catalog.items) || !Array.isArray(catalog.series)) return false;
    // Les noms intégrés (i18n) des 8 trouvailles d'origine servent de repli : ne lire FINDS qu'une fois
    if (!this._builtin) this._builtin = this.FINDS.map(f => ({ ...f }));
    const saved = this.FINDS;
    this.FINDS = this._builtin;
    const items = catalog.items.map(c => this._fromCatalog(c));
    this.FINDS = saved;
    if (items.some(x => !x)) return false;
    this.FINDS = items;
    this.SERIES = catalog.series.filter(s => s && typeof s.id === 'string');
    this.SEASONS = catalog.seasons && typeof catalog.seasons === 'object' ? catalog.seasons : {};
    this.catalogVersion = catalog.version;
    return true;
  },

  loadCached(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
      const raw = storage && storage.getItem(this.CATALOG_STORAGE_KEY);
      return raw ? this.applyCatalog(JSON.parse(raw)) : false;
    } catch (_) { return false; }
  },

  fetchCatalog(onChange) {
    if (typeof fetch === 'undefined') return Promise.resolve(false);
    return fetch(this.CATALOG_URL, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(catalog => {
        if (!catalog || !this.applyCatalog(catalog)) return false;
        try { localStorage.setItem(this.CATALOG_STORAGE_KEY, JSON.stringify(catalog)); } catch (_) { /* quota */ }
        if (onChange) onChange();
        return true;
      })
      .catch(() => false);
  },

  seriesOf(find) {
    return this.SERIES.find(s => s.id === find.seriesId) || null;
  },

  /** Saison du joueur (0 ou null : hors saison). */
  currentSeasonId() {
    return (GameState.seasonStats && GameState.seasonStats.seasonId) || null;
  },

  /** L'objet peut-il tomber maintenant ? Actif, drop activé, série active et de la saison en cours. */
  canDrop(find) {
    if (find.dropEnabled === false || find.active === false) return false;
    const s = this.seriesOf(find);
    if (!s) return find.dropEnabled === undefined; // FINDS intégrés (avant réception du catalogue)
    if (s.active === false) return false;
    return s.seasonId == null || s.seasonId === this.currentSeasonId();
  },

  /** Série archivée : rattachée à une saison qui n'est plus celle du joueur. */
  isArchived(series) {
    return !!series && series.seasonId != null && series.seasonId !== this.currentSeasonId();
  },

  /** Ajoute un objet à la collection et note date, quantité et saison (#39). */
  add(id, now = Date.now()) {
    if (!GameState.collection.includes(id)) GameState.collection.push(id);
    if (!GameState.collectionMeta || typeof GameState.collectionMeta !== 'object') GameState.collectionMeta = {};
    const prev = GameState.collectionMeta[id];
    GameState.collectionMeta[id] = prev
      ? { ...prev, n: (prev.n || 1) + 1 }
      : { at: now, n: 1, season: this.currentSeasonId() };
  },

  _lang() {
    return typeof I18n !== 'undefined' ? I18n.getCurrent() : 'fr';
  },

  displayName(find, lang = this._lang()) {
    const n = find.names || {};
    return n[lang] || (find.name && typeof t === 'function' ? t(find.name) : null) || n.fr || find.id;
  },

  story(find, lang = this._lang()) {
    const s = find.stories || {};
    return s[lang] || s.fr || (find.desc && typeof t === 'function' ? t(find.desc) : '');
  },

  seriesName(series, lang = this._lang()) {
    const n = (series && series.names) || {};
    return n[lang] || n.fr || (typeof t === 'function' ? t('collection.series_origins') : 'Collection');
  },
};
