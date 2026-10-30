/**
 * blocks.js
 * Catalogue des blocs et logique de spawn / frappe.
 * Dépend de : GameState (pour lire le niveau luck au moment du spawn)
 *
 * Catalogue administrable (#37) : TYPES ci-dessous est le catalogue d'origine (version 1 côté
 * serveur, server/blockCatalog.js le relit tel quel). Le catalogue publié depuis le panel admin
 * (GET /api/blocks/catalog) le remplace dès qu'il est reçu, puis est mémorisé localement pour le
 * démarrage suivant. Aucune profondeur maximale (#22, règle du propriétaire du 30/10/2026) : un bloc
 * apparaît « dès minDepth m » puis à toute profondeur, avec une probabilité > 0 ; un `maxDepth`
 * reçu d'un ancien catalogue est ignoré. Un type n'est jamais retiré du catalogue (désactivé :
 * `active: false`, sauvegardes compatibles).
 * Étape B : un type peut être atténué au-delà de `fadeFrom` m (poids `fadeWeight` > 0) et une
 * gemme peut ne pas rapporter de gemme (`gemReward: false`) — catalogue au format 2.
 */
const Blocks = {

  TYPES: [
    // ── Terre ────────────────────────────────────────────────────────────────
    {
      category: 'terre', name: 'block.terre_meuble', icon: '🟤',
      rarityKey: 'commun',
      color:  'linear-gradient(145deg,#78350f,#431407)',
      accent: '#92400e',
      hpBase: 3,  reward: 1,
      minDepth: 1, weight: 70, fadeFrom: 12, fadeWeight: 2.1,
    },
    {
      category: 'terre', name: 'block.argile', icon: '🟫',
      rarityKey: 'commun',
      color:  'linear-gradient(145deg,#92400e,#6b2d08)',
      accent: '#b45309',
      hpBase: 6,  reward: 2,
      minDepth: 4, weight: 45, fadeFrom: 22, fadeWeight: 1.35,
    },

    // ── Pierre ───────────────────────────────────────────────────────────────
    {
      category: 'pierre', name: 'block.pierre', icon: '🪨',
      rarityKey: 'commun',
      color:  'linear-gradient(145deg,#4b5563,#374151)',
      accent: '#6b7280',
      hpBase: 12, reward: 5,
      minDepth: 5, weight: 60,
    },
    {
      category: 'pierre', name: 'block.gres', icon: '🏔',
      rarityKey: 'commun',
      color:  'linear-gradient(145deg,#78716c,#57534e)',
      accent: '#a8a29e',
      hpBase: 20, reward: 8,
      minDepth: 12, weight: 40,
    },
    {
      category: 'pierre', name: 'block.granite', icon: '⬛',
      rarityKey: 'peu-commun',
      color:  'linear-gradient(145deg,#3f3f46,#27272a)',
      accent: '#71717a',
      hpBase: 38, reward: 16,
      minDepth: 25, weight: 28,
    },

    // ── Minerai ──────────────────────────────────────────────────────────────
    {
      category: 'minerai', name: 'block.charbon', icon: '🖤',
      rarityKey: 'peu-commun',
      color:  'linear-gradient(145deg,#292524,#1c1917)',
      accent: '#78716c',
      hpBase: 28, reward: 22,
      minDepth: 8, weight: 22,
    },
    {
      category: 'minerai', name: 'block.minerai_fer', icon: '⚙',
      rarityKey: 'peu-commun',
      color:  'linear-gradient(145deg,#52637a,#334155)',
      accent: '#94a3b8',
      hpBase: 55, reward: 50,
      minDepth: 20, weight: 15,
    },
    {
      category: 'minerai', name: 'block.minerai_or', icon: '🟡',
      rarityKey: 'rare',
      color:  'linear-gradient(145deg,#d97706,#92400e)',
      accent: '#fbbf24',
      hpBase: 90, reward: 110,
      minDepth: 40, weight: 8,
    },

    // ── Coffre ───────────────────────────────────────────────────────────────
    {
      category: 'coffre', name: 'block.vieille_caisse', icon: '🧰',
      rarityKey: 'commun',
      color:  'linear-gradient(145deg,#713f12,#3b1a06)',
      accent: '#b45309',
      hpBase: 8,  reward: 0,
      minDepth: 1, weight: 5,
      isChest: true,
    },
    {
      category: 'coffre', name: 'block.coffre_bois', icon: '📦',
      rarityKey: 'rare',
      color:  'linear-gradient(145deg,#92400e,#78350f)',
      accent: '#d97706',
      hpBase: 18, reward: 160,
      minDepth: 5, weight: 6,
      isChest: true,
    },
    {
      category: 'coffre', name: 'block.coffre_fer', icon: '🗃',
      rarityKey: 'epique',
      color:  'linear-gradient(145deg,#475569,#1e293b)',
      accent: '#94a3b8',
      hpBase: 40, reward: 420,
      minDepth: 30, weight: 3,
      isChest: true,
    },

    // ── Gemme ────────────────────────────────────────────────────────────────
    {
      category: 'gemme', name: 'block.rubis', icon: '🔴',
      rarityKey: 'epique',
      color:  'linear-gradient(145deg,#dc2626,#7f1d1d)',
      accent: '#f87171',
      hpBase: 110, reward: 650,
      minDepth: 35, weight: 4,
      isGem: true,
    },
    {
      category: 'gemme', name: 'block.emeraude', icon: '💚',
      rarityKey: 'legendaire',
      color:  'linear-gradient(145deg,#16a34a,#14532d)',
      accent: '#4ade80',
      hpBase: 200, reward: 1400,
      minDepth: 70, weight: 2,
      isGem: true,
    },
    {
      category: 'gemme', name: 'block.diamant', icon: '💎',
      rarityKey: 'legendaire',
      color:  'linear-gradient(145deg,#0ea5e9,#1e3a5f)',
      accent: '#7dd3fc',
      hpBase: 350, reward: 3200,
      minDepth: 120, weight: 1,
      isGem: true,
    },
  ],

  current: null,

  /** Version du catalogue publié en usage (0 : catalogue d'origine intégré). */
  catalogVersion: 0,
  CATALOG_URL: '/api/blocks/catalog?format=2',
  CATALOG_STORAGE_KEY: 'dig.blockCatalog.v2',

  /** Identifiant stable d'un type : « block.pierre » → « pierre ». */
  idOf(type) {
    return type.id || String(type.name || '').replace(/^block\./, '');
  },

  byId(id) {
    return this.TYPES.find(t => this.idOf(t) === id) || null;
  },

  /**
   * Nom affiché, par ordre de repli (#42) : nom du catalogue dans la langue du joueur, puis
   * traduction intégrée au jeu dans cette langue (blocs d'origine, minerais de l'étape B), puis nom
   * FR du catalogue, puis traduction intégrée (FR à défaut).
   */
  displayName(type, lang = typeof I18n !== 'undefined' ? I18n.getCurrent() : 'fr') {
    const names = type.names || {};
    if (names[lang]) return names[lang];
    const builtIn = typeof I18n !== 'undefined' && typeof I18n.has === 'function'
      && lang === I18n.getCurrent() && I18n.has(type.name, lang);
    return builtIn ? t(type.name) : names.fr || t(type.name);
  },

  /** Type du catalogue publié → type du jeu (mêmes champs que TYPES). Null si invalide. */
  _fromCatalog(c) {
    if (!c || typeof c.id !== 'string' || !/^[a-z][a-z0-9_]{1,39}$/.test(c.id)) return null;
    const num = (v, min) => (Number.isFinite(v) && v >= min ? v : null);
    const hpBase = num(c.hpBase, 1), reward = num(c.reward, 0), minDepth = num(c.minDepth, 1), weight = num(c.weight, 0);
    if (hpBase === null || reward === null || minDepth === null || weight === null) return null;
    const fadeFrom = num(c.fadeFrom, minDepth), fadeWeight = num(c.fadeWeight, 0);
    return {
      id: c.id, name: `block.${c.id}`, names: c.names && typeof c.names === 'object' ? c.names : null,
      category: String(c.category || 'pierre'), icon: String(c.icon || '⬜'), image: c.image || null,
      rarityKey: String(c.rarity || 'commun'),
      color: String(c.color || '#4b5563'), accent: String(c.accent || '#6b7280'),
      hpBase, reward, minDepth, weight,
      fadeFrom: fadeFrom !== null && fadeWeight > 0 ? fadeFrom : null, fadeWeight,
      active: c.active !== false, isChest: c.category === 'coffre', isGem: c.category === 'gemme' && c.gemReward !== false,
    };
  },

  /**
   * Remplace le catalogue par celui publié par le serveur. Le bloc courant garde ses PV et sa
   * récompense ; seul son type est relié à la nouvelle définition (même identifiant).
   * @returns {boolean} true si le catalogue a été appliqué
   */
  applyCatalog(catalog) {
    if (!catalog || !Number.isInteger(catalog.version) || !Array.isArray(catalog.types)) return false;
    const types = catalog.types.map(c => this._fromCatalog(c));
    if (!types.length || types.some(x => !x) || !types.some(x => x.active)) return false;
    this.TYPES = types;
    this.catalogVersion = catalog.version;
    if (this.current) {
      const same = this.byId(this.idOf(this.current.type));
      if (same) this.current.type = same;
    }
    return true;
  },

  /** Catalogue mémorisé lors d'une visite précédente (appelé avant la reprise du bloc). */
  loadCached(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
      const raw = storage && storage.getItem(this.CATALOG_STORAGE_KEY);
      return raw ? this.applyCatalog(JSON.parse(raw)) : false;
    } catch (_) { return false; }
  },

  /** Lit le catalogue publié ; `onChange` est rappelé s'il diffère de celui en usage. */
  fetchCatalog(onChange) {
    if (typeof fetch === 'undefined') return Promise.resolve(false);
    return fetch(this.CATALOG_URL, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(catalog => {
        if (!catalog || catalog.version === this.catalogVersion) return false;
        if (!this.applyCatalog(catalog)) return false;
        try { localStorage.setItem(this.CATALOG_STORAGE_KEY, JSON.stringify(catalog)); } catch (_) { /* quota */ }
        if (onChange) onChange();
        return true;
      })
      .catch(() => false);
  },

  // Raretés boostées par l'upgrade Chance
  _BOOSTED_RARITIES: new Set(['rare', 'epique', 'legendaire']),

  /** Bonus de poids des raretés boostées par niveau de Chance (#32 : 0,20 → 0,10). */
  LUCK_PER_LEVEL: 0.10,

  /** Multiplicateur de poids des raretés boostées : Chance + relique Lentille fêlée. */
  luckMultiplier(luckLevel = GameState.upgrades ? (GameState.upgrades.luck || 0) : 0) {
    return 1 + luckLevel * this.LUCK_PER_LEVEL + (GameState.relicBonuses?.luckPct ?? 0);
  },

  /** Type tirable à cette profondeur : actif et `dès minDepth` (jamais de profondeur maximale). */
  available(t, depth) {
    return t.active !== false && depth >= t.minDepth;
  },

  /** Poids à cette profondeur : atténué au-delà de `fadeFrom` (toujours > 0). */
  weightAt(t, depth) {
    return t.fadeFrom != null && depth > t.fadeFrom ? t.fadeWeight : t.weight;
  },

  /** Pool pondéré des blocs possibles à cette profondeur (source unique du tirage et de l'affichage). */
  _pool(depth, luckMult) {
    return this.TYPES
      .filter(t => this.available(t, depth))
      .map(t => ({
        type: t,
        w: this.weightAt(t, depth) * (this._BOOSTED_RARITIES.has(t.rarityKey) ? luckMult : 1),
      }));
  },

  /**
   * Probabilité exacte de chaque bloc à cette profondeur (#32).
   * @returns {{ type: object, p: number }[]}
   */
  blockOdds(depth, luckLevel) {
    const pool  = this._pool(depth, this.luckMultiplier(luckLevel));
    const total = pool.reduce((s, e) => s + e.w, 0);
    return pool.map(e => ({ type: e.type, p: e.w / total }));
  },

  /** Part des blocs rares, épiques et légendaires à cette profondeur (carte Chance, #32). */
  rareShare(depth, luckLevel) {
    return this.blockOdds(depth, luckLevel)
      .filter(e => this._BOOSTED_RARITIES.has(e.type.rarityKey))
      .reduce((s, e) => s + e.p, 0);
  },

  /** Tirage pondéré ; par défaut avec la Chance du joueur, `luckMult = 1` pour un tirage neutre. */
  _pickType(depth, luckMult = this.luckMultiplier(), random = Math.random) {
    const pool = this._pool(depth, luckMult);

    if (pool.length === 0) return this.byId('pierre') || this.TYPES[0]; // fallback : Pierre

    const total = pool.reduce((s, e) => s + e.w, 0);
    let rand = random() * total;
    for (const e of pool) {
      rand -= e.w;
      if (rand <= 0) return e.type;
    }
    return pool[pool.length - 1].type;
  },

  // ── Tirage reproductible (#35) ───────────────────────────────────────────
  // Chaque bloc porte un numéro (GameState.blockSeq) ; sa nature, ses PV et les gains tirés à
  // sa destruction (coffre, trouvaille) dépendent uniquement de la graine de la sauvegarde
  // (GameState.blockSeed) et de ce numéro. Recharger, changer d'onglet ou d'appareil ou reprendre
  // une sauvegarde plus ancienne redonne donc exactement le même bloc et les mêmes gains :
  // impossible de « relancer » le tirage pour obtenir un matériau rare.

  /** Graine de la sauvegarde (créée au premier bloc d'une sauvegarde qui n'en a pas). */
  _seed() {
    let seed = GameState.blockSeed;
    if (!Number.isSafeInteger(seed) || seed <= 0) {
      seed = 1 + Math.floor(Math.random() * 0xfffffffe);
      GameState.blockSeed = seed;
    }
    return seed;
  },

  /** Générateur pseudo-aléatoire (mulberry32) propre au bloc `seq` et à l'usage `salt`. */
  rng(seq, salt) {
    let h = 2166136261 ^ this._seed();
    for (const ch of `${seq}:${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    let a = h >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  /** Générateur des gains tirés à la destruction du bloc courant (coffre, trouvaille). */
  rewardRng(salt) {
    return this.rng(this.current?.seq ?? GameState.blockSeq, `reward:${salt}`);
  },

  /**
   * Crée le bloc suivant adapté à la profondeur, en deux tirages (#32, option A) :
   *   - la nature du bloc (apparence, récompense, coffre, gemme) est tirée AVEC la Chance ;
   *   - sa résistance (PV) est tirée SANS Chance, sur le même pool : la Chance ne ralentit
   *     jamais la descente (PV moyens identiques à Chance 0).
   * Les deux tirages sont reproductibles (graine + numéro du bloc, #35).
   */
  spawn(depth) {
    const seq        = (Number.isSafeInteger(GameState.blockSeq) && GameState.blockSeq >= 0 ? GameState.blockSeq : 0) + 1;
    GameState.blockSeq = seq;
    const type       = this._pickType(depth, this.luckMultiplier(), this.rng(seq, 'type'));
    const hpType     = this._pickType(depth, 1, this.rng(seq, 'hp'));
    const scale      = 1 + (depth - 1) * 0.12;
    const hpReduct   = GameState.relicBonuses?.hpReduction ?? 0;
    const hp         = Math.ceil(hpType.hpBase * scale * (1 - hpReduct));
    const reward = Math.ceil(type.reward  * (1 + (depth - 1) * 0.05));
    this.current = { type, hp, maxHp: hp, reward, depth, seq };
    return this.current;
  },

  /** État du bloc courant pour la sauvegarde (null : aucun bloc). */
  snapshot() {
    const c = this.current;
    if (!c) return null;
    return { name: c.type.name, hp: c.hp, maxHp: c.maxHp, reward: c.reward, depth: c.depth, seq: c.seq };
  },

  /**
   * Reprend le bloc sauvegardé s'il est valide pour cette profondeur (même type, mêmes PV
   * restants, même récompense) ; sinon (ancienne sauvegarde sans bloc, bloc détruit, saison
   * ou profondeur changée) tire le bloc suivant. Ne relance jamais un bloc encore intact.
   * @returns {boolean} true si le bloc sauvegardé a été repris
   */
  resume(saved, depth) {
    const type = saved && this.TYPES.find(t => t.name === saved.name);
    const ok = type
      && saved.depth === depth
      && Number.isSafeInteger(saved.seq) && saved.seq > 0 && saved.seq <= GameState.blockSeq
      && Number.isFinite(saved.maxHp) && saved.maxHp > 0
      && Number.isFinite(saved.hp) && saved.hp > 0 && saved.hp <= saved.maxHp
      && Number.isFinite(saved.reward) && saved.reward >= 0;
    if (!ok) { this.spawn(depth); return false; }
    this.current = { type, hp: saved.hp, maxHp: saved.maxHp, reward: saved.reward, depth, seq: saved.seq };
    return true;
  },

  /** Applique des dégâts. Retourne true si le bloc est détruit. */
  hit(damage) {
    if (!this.current) return false;
    this.current.hp = Math.max(0, this.current.hp - damage);
    return this.current.hp === 0;
  },

  hpRatio() {
    if (!this.current) return 0;
    return this.current.hp / this.current.maxHp;
  },
};
