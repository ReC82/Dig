/**
 * upgrades.js
 * Catalogue des améliorations et logique d'achat.
 * Dépend de : GameState, Balance, Blocks (aperçu Chance)
 */
const Upgrades = {

  DEFS: [
    // ── Améliorations saisonnières ──────────────────────────────────────────
    {
      id: 'pickaxe',
      icon: '⛏',
      name: 'upgrade.pickaxe.name',
      maxLevel: 15,
      /** Dégâts réels par clic (pioche + relique Œil du mineur), comme GameState.damage. */
      effect(level) {
        return GameState.normAmount(level + (GameState.relicBonuses?.damageFlat ?? 0));
      },
      describe(level) {
        const damage = this.effect(level);
        // Détail de la pioche : valeur exacte au centième (#81), même si le minage l'arrondit
        return t('upgrade.pickaxe.desc', { damage: Upgrades.formatAmount(damage), s: damage >= 2 ? 's' : '' });
      },
      getCost(level) {
        if (level >= this.maxLevel) return null;
        const c = Balance.PICKAXE[level - 1];
        return (c !== undefined) ? { coins: c, gems: 0 } : null;
      },
    },
    {
      id: 'luck',
      icon: '🍀',
      name: 'upgrade.luck.name',
      maxLevel: 12,
      /** Le pourcentage réel est dans l'aperçu ci-dessous (#32 : plus de « +x % », qui était un poids). */
      describe() {
        return t('upgrade.luck.desc');
      },
      /** Effet concret à la profondeur actuelle : part de blocs rares maintenant → au niveau suivant (#32). */
      preview(level) {
        const p = Upgrades.getLuckPreview(GameState.depth, level);
        if (p.now === 0 && (p.next ?? 0) === 0) return t('upgrade.luck.preview_none');
        const fmt = x => (x * 100).toLocaleString(I18n.getCurrent(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
        if (p.next === null) return t('upgrade.luck.preview_max', { depth: p.depth, now: fmt(p.now) });
        return t('upgrade.luck.preview', { depth: p.depth, now: fmt(p.now), next: fmt(p.next) });
      },
      getCost(level) {
        if (level >= this.maxLevel) return null;
        const c = Balance.LUCK[level];
        return (c !== undefined) ? { coins: c, gems: 0 } : null;
      },
    },
    {
      id: 'bag',
      icon: '🎒',
      name: 'upgrade.bag.name',
      maxLevel: 12,
      /** Multiplicateur du Sac, facteur 🎒 de la récompense des blocs (getRewardBreakdown). */
      effect(level) {
        return 1 + level * Upgrades.BAG_PER_LEVEL;
      },
      describe(level) {
        if (level === 0) return t('upgrade.bag.desc_normal');
        return t('upgrade.bag.desc', { mult: Upgrades.formatMult(this.effect(level)) });
      },
      getCost(level) {
        if (level >= this.maxLevel) return null;
        const c = Balance.BAG[level];
        return (c !== undefined) ? { coins: c, gems: 0 } : null;
      },
    },
    {
      id: 'autodig',
      icon: '⚙',
      name: 'upgrade.autodig.name',
      maxLevel: 6,
      /** Dégâts automatiques réels par seconde (relique Moteur antique incluse), cf. getAutoDigDamage. */
      effect(level) {
        return GameState.normAmount(level + (GameState.relicBonuses?.autodigBonus ?? 0));
      },
      describe(level) {
        const dmg = this.effect(level);
        if (dmg === 0) return t('upgrade.autodig.desc_off');
        return t('upgrade.autodig.desc', { dmg: Upgrades.formatAmount(dmg), s: dmg >= 2 ? 's' : '' });
      },
      getCost(level) {
        if (level >= this.maxLevel) return null;
        return Balance.AUTODIG[level] ?? null;
      },
    },

    // ── Coin sinks (resets chaque saison) ───────────────────────────────────
    {
      id: 'fragment_shop',
      icon: '🔮',
      name: 'upgrade.fragment_shop.name',
      maxLevel: 10,
      describe(level) {
        if (level === 0) return t('upgrade.fragment_shop.desc_none');
        return t('upgrade.fragment_shop.desc', { n: level });
      },
      getCost(level) {
        if (level >= this.maxLevel) return null;
        const c = Balance.FRAGMENT_SHOP[level];
        return (c !== undefined) ? { coins: c, gems: 0 } : null;
      },
    },
    {
      id: 'block_reroll',
      icon: '🔄',
      name: 'upgrade.block_reroll.name',
      maxLevel: 99,
      describe(level) {
        if (level === 0) return t('upgrade.block_reroll.desc_none');
        return t('upgrade.block_reroll.desc', { n: level, s: level > 1 ? 's' : '' });
      },
      getCost(level) {
        return Balance.getRerollCost(level);
      },
    },
  ],

  getLevel(id) {
    if (id === 'pickaxe') return GameState.pickaxeLevel;
    return GameState.upgrades[id] ?? 0;
  },

  // ── Barème publié et suspension d'urgence (#69) ─────────────────────────
  // La version 1 du serveur reprend ce barème à l'identique. Une version publiée depuis le panel
  // remplace prix, nombre de niveaux, effet par niveau (Sac, Chance), paliers du reroll, noms et
  // emoji ; mémorisée pour la visite suivante. Les suspensions arrivent avec le barème (relu chaque
  // minute) : nouveaux achats bloqués, effets calculés comme au niveau de départ, ou carte masquée.
  // Les niveaux possédés (GameState) ne sont JAMAIS modifiés : la réactivation rend l'effet tel quel.

  /** Pièces par niveau de Sac (blocks.js porte l'équivalent de la Chance : LUCK_PER_LEVEL). */
  BAG_PER_LEVEL: 0.3,
  catalogVersion: 0,
  controlsRev: -1,
  controls: {},
  CATALOG_URL: '/api/upgrades/catalog',
  PURCHASE_CHECK_URL: '/api/upgrades/purchase-check',
  CATALOG_STORAGE_KEY: 'dig.upgradeCatalog.v1',
  _TABLES: { pickaxe: 'PICKAXE', luck: 'LUCK', bag: 'BAG', fragment_shop: 'FRAGMENT_SHOP' },

  /** Barème reçu valide (mêmes six améliorations, tableaux de la bonne longueur). */
  _validCatalog(c) {
    if (!c || !Number.isInteger(c.version) || !Array.isArray(c.upgrades)) return false;
    return this.DEFS.every(def => {
      const u = c.upgrades.find(x => x && x.id === def.id);
      if (!u || !Number.isInteger(u.maxLevel) || u.maxLevel < 1) return false;
      if (def.id === 'block_reroll') return Number.isInteger(u.reroll?.base) && u.reroll.base > 0 && Number.isInteger(u.reroll?.every) && u.reroll.every > 0;
      const first = def.id === 'pickaxe' ? 1 : 0;
      if (!Array.isArray(u.costs) || u.costs.length !== u.maxLevel - first || !u.costs.every(n => Number.isInteger(n) && n >= 0)) return false;
      if (def.id === 'autodig' && (!Array.isArray(u.gems) || u.gems.length !== u.costs.length)) return false;
      return u.perLevel === undefined || (Number.isFinite(u.perLevel) && u.perLevel > 0);
    });
  },

  /** Applique barème + suspensions. Réponse invalide → rien n'est modifié. */
  applyCatalog(catalog) {
    if (!this._validCatalog(catalog)) return false;
    for (const def of this.DEFS) {
      const u = catalog.upgrades.find(x => x.id === def.id);
      def.maxLevel = u.maxLevel;
      def.names = u.names && typeof u.names === 'object' ? u.names : null;
      if (u.icon) def.icon = String(u.icon);
      if (def.id === 'block_reroll') Balance.REROLL = { base: u.reroll.base, every: u.reroll.every };
      else if (def.id === 'autodig') Balance.AUTODIG = u.costs.map((coins, i) => ({ coins, gems: u.gems[i] }));
      else Balance[this._TABLES[def.id]] = [...u.costs];
      if (def.id === 'bag' && u.perLevel) this.BAG_PER_LEVEL = u.perLevel;
      if (def.id === 'luck' && u.perLevel && typeof Blocks !== 'undefined') Blocks.LUCK_PER_LEVEL = u.perLevel;
    }
    const controls = {};
    for (const [id, c] of Object.entries(catalog.controls && typeof catalog.controls === 'object' ? catalog.controls : {})) {
      controls[id] = { purchases: c?.purchases === true || c?.hidden === true, effects: c?.effects === true, hidden: c?.hidden === true };
    }
    this.controls = controls;
    this.catalogVersion = catalog.version;
    this.controlsRev = Number.isInteger(catalog.controlsRev) ? catalog.controlsRev : 0;
    return true;
  },

  loadCached(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
      const raw = storage && storage.getItem(this.CATALOG_STORAGE_KEY);
      return raw ? this.applyCatalog(JSON.parse(raw)) : false;
    } catch (_) { return false; }
  },

  /** Lit le barème publié et les suspensions ; `onChange` est rappelé s'ils ont changé. */
  fetchCatalog(onChange) {
    if (typeof fetch === 'undefined') return Promise.resolve(false);
    return fetch(this.CATALOG_URL, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(catalog => {
        if (!catalog || (catalog.version === this.catalogVersion && catalog.controlsRev === this.controlsRev)) return false;
        if (!this.applyCatalog(catalog)) return false;
        try { localStorage.setItem(this.CATALOG_STORAGE_KEY, JSON.stringify(catalog)); } catch (_) { /* quota */ }
        if (onChange) onChange();
        return true;
      })
      .catch(() => false);
  },

  /** Achat confirmé par le serveur avant débit : l'Auto-Dig, seule amélioration payable en gemmes. */
  needsServerCheck(id) { return id === 'autodig'; },

  /**
   * Demande au serveur si le prix du prochain niveau est celui de la version publiée (celle que
   * débite le registre de gemmes #49). Prix périmé ou achats suspendus → barème à jour appliqué,
   * achat refusé. Sans réseau : refus si le niveau coûte des gemmes, sinon achat en pièces comme avant.
   * @returns {Promise<{ ok: boolean, code?: string, gems?: number }>}
   */
  confirmPurchase(id) {
    const cost = this.getCost(id);
    if (!cost) return Promise.resolve({ ok: false, code: 'max' });
    if (typeof fetch === 'undefined') return Promise.resolve(cost.gems > 0 ? { ok: false, code: 'offline' } : { ok: true });
    const body = { id, level: this.getLevel(id) + 1, gems: cost.gems, version: this.catalogVersion };
    return fetch(this.PURCHASE_CHECK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().catch(() => null).then(data => ({ status: r.status, data })))
      .then(({ status, data }) => {
        if (status === 200 && data?.ok) return { ok: true };
        if (status === 409 && data?.catalog && this.applyCatalog(data.catalog)) {
          try { localStorage.setItem(this.CATALOG_STORAGE_KEY, JSON.stringify(data.catalog)); } catch (_) { /* quota */ }
          return { ok: false, code: data.code, gems: data.gems };
        }
        return cost.gems > 0 ? { ok: false, code: 'offline' } : { ok: true };
      })
      .catch(() => (cost.gems > 0 ? { ok: false, code: 'offline' } : { ok: true }));
  },

  isHidden(id)            { return this.controls[id]?.hidden === true; },
  isPurchaseSuspended(id) { return this.controls[id]?.purchases === true; },
  isEffectSuspended(id)   { return this.controls[id]?.effects === true; },

  /** Niveau qui produit l'effet : niveau possédé, ou niveau de départ si l'effet est suspendu. */
  effectiveLevel(id) {
    if (this.isEffectSuspended(id)) return id === 'pickaxe' ? 1 : 0;
    return this.getLevel(id);
  },

  /** Nom affiché : barème publié dans la langue du joueur, puis traduction intégrée. */
  displayName(def) {
    const lang = typeof I18n !== 'undefined' ? I18n.getCurrent() : 'fr';
    const own = def.names || {};
    if (own[lang]) return own[lang];
    const builtIn = typeof I18n !== 'undefined' && typeof I18n.has === 'function' && I18n.has(def.name, lang);
    return builtIn ? t(def.name) : own.fr || t(def.name);
  },

  /** Coût du prochain niveau, multiplicateur admin upgrade_cost_multiplier inclus (#20). */
  getCost(id) {
    const def = this.DEFS.find(d => d.id === id);
    const cost = def ? def.getCost(this.getLevel(id)) : null;
    return cost ? { ...cost, coins: Balance.scaleUpgradeCoins(cost.coins) } : null;
  },

  canAfford(id) {
    if (this.isPurchaseSuspended(id)) return false;
    const cost = this.getCost(id);
    if (!cost) return false;
    if (cost.coins > 0 && GameState.coins < cost.coins) return false;
    if (cost.gems  > 0 && GameState.gems  < cost.gems)  return false;
    return true;
  },

  buy(id) {
    if (!this.canAfford(id)) return false;

    const cost = this.getCost(id);
    if (cost.coins > 0) GameState.spendCoins(cost.coins);
    if (cost.gems  > 0) GameState.spendGems(cost.gems);

    if (id === 'pickaxe') {
      GameState.pickaxeLevel += 1;
      GameState.damage = GameState.normAmount(this.effectiveLevel('pickaxe') + (GameState.relicBonuses?.damageFlat ?? 0));
    } else if (id === 'fragment_shop') {
      GameState.upgrades.fragment_shop = (GameState.upgrades.fragment_shop ?? 0) + 1;
      GameState.relicFragments         = (GameState.relicFragments ?? 0) + 1;
    } else if (id === 'block_reroll') {
      GameState.upgrades.block_reroll = (GameState.upgrades.block_reroll ?? 0) + 1;
      // Effet (spawn du nouveau bloc) géré par main.js après buy()
    } else {
      GameState.upgrades[id] = (GameState.upgrades[id] ?? 0) + 1;
    }

    GameState.stats.totalUpgradesBought += 1;
    return true;
  },

  /** Multiplicateur des pièces des blocs : sac × relique × coin_gain_multiplier (admin, #20). */
  getRewardMultiplier() {
    return (1 + this.effectiveLevel('bag') * this.BAG_PER_LEVEL) * (1 + (GameState.relicBonuses?.coinsPct ?? 0))
      * Balance.economy.coinGainMultiplier;
  },

  /**
   * Décomposition affichable de la récompense d'un bloc (#20) : base du bloc, facteurs ≠ 1
   * dans l'ordre du moteur (sac, relique, réglage admin, bonus temporaire) et total réel,
   * calculé avec la même expression que la destruction du bloc (main.js).
   * @returns {{ base: number, factors: {key: string, mult: number}[], total: number }}
   */
  getRewardBreakdown(blockReward, boostMult = 1) {
    const factors = [
      { key: 'bag',   mult: 1 + this.effectiveLevel('bag') * this.BAG_PER_LEVEL },
      { key: 'relic', mult: 1 + (GameState.relicBonuses?.coinsPct ?? 0) },
      { key: 'event', mult: Balance.economy.coinGainMultiplier },
      { key: 'boost', mult: boostMult },
    ].filter(f => Math.abs(f.mult - 1) > 1e-9);
    const total = Math.ceil(blockReward * this.getRewardMultiplier() * boostMult);
    return { base: blockReward, factors, total };
  },

  /**
   * Part des blocs rares, épiques et légendaires à cette profondeur, au niveau de Chance donné et
   * au suivant (relique Lentille fêlée incluse) ; next = null au niveau maximal (#32).
   * @returns {{ depth: number, now: number, next: number|null }}
   */
  getLuckPreview(depth, level = this.getLevel('luck')) {
    const def = this.DEFS.find(d => d.id === 'luck');
    return {
      depth,
      now:  Blocks.rareShare(depth, level),
      next: level < def.maxLevel ? Blocks.rareShare(depth, level + 1) : null,
    };
  },

  /**
   * Aperçu avant/après de l'achat (#20) : niveau actuel → suivant et, pour les améliorations à
   * effet chiffré (pioche, sac, auto-dig), valeur effective actuelle → après achat.
   * @returns {{ cur: number, next: number|null, effect: {cur: number, next: number}|null }}
   */
  getLevelPreview(id) {
    const def   = this.DEFS.find(d => d.id === id);
    const cur   = this.getLevel(id);
    const next  = this.getCost(id) === null ? null : cur + 1;
    const effect = def?.effect && next !== null ? { cur: def.effect(cur), next: def.effect(next) } : null;
    return { cur, next, effect };
  },

  /** Multiplicateur lisible dans la langue du joueur (3,4 en français, 3.4 en anglais). */
  formatMult(m) {
    const lang = typeof I18n !== 'undefined' ? I18n.getCurrent() : 'fr';
    return Number(m).toLocaleString(lang, { maximumFractionDigits: 2 });
  },

  /** Dégâts exacts (au centième, séparateur de la langue) pour le détail des améliorations (#81). */
  formatAmount(v) {
    return typeof NumFmt !== 'undefined' ? NumFmt.exact(v) : String(v);
  },

  getAutoDigDamage() {
    return GameState.normAmount(this.effectiveLevel('autodig') + (GameState.relicBonuses?.autodigBonus ?? 0));
  },
};
