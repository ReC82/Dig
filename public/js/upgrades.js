/**
 * upgrades.js
 * Catalogue des améliorations et logique d'achat.
 * Dépend de : GameState, Balance
 */
const Upgrades = {

  DEFS: [
    // ── Améliorations saisonnières ──────────────────────────────────────────
    {
      id: 'pickaxe',
      icon: '⛏',
      name: 'upgrade.pickaxe.name',
      maxLevel: 15,
      describe(level) {
        return t('upgrade.pickaxe.desc', { damage: level, s: level > 1 ? 's' : '' });
      },
      getCost(level) {
        if (level >= 15) return null;
        const c = Balance.PICKAXE[level - 1];
        return (c !== undefined) ? { coins: c, gems: 0 } : null;
      },
    },
    {
      id: 'luck',
      icon: '🍀',
      name: 'upgrade.luck.name',
      maxLevel: 12,
      describe(level) {
        if (level === 0) return t('upgrade.luck.desc_none');
        return t('upgrade.luck.desc', { pct: level * 20 });
      },
      getCost(level) {
        if (level >= 12) return null;
        const c = Balance.LUCK[level];
        return (c !== undefined) ? { coins: c, gems: 0 } : null;
      },
    },
    {
      id: 'bag',
      icon: '🎒',
      name: 'upgrade.bag.name',
      maxLevel: 12,
      describe(level) {
        if (level === 0) return t('upgrade.bag.desc_normal');
        return t('upgrade.bag.desc', { mult: (1 + level * 0.3).toFixed(1) });
      },
      getCost(level) {
        if (level >= 12) return null;
        const c = Balance.BAG[level];
        return (c !== undefined) ? { coins: c, gems: 0 } : null;
      },
    },
    {
      id: 'autodig',
      icon: '⚙',
      name: 'upgrade.autodig.name',
      maxLevel: 6,
      describe(level) {
        if (level === 0) return t('upgrade.autodig.desc_off');
        return t('upgrade.autodig.desc', { dmg: level, s: level > 1 ? 's' : '' });
      },
      getCost(level) {
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
        if (level >= 10) return null;
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

  getCost(id) {
    const def = this.DEFS.find(d => d.id === id);
    return def ? def.getCost(this.getLevel(id)) : null;
  },

  canAfford(id) {
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
      GameState.damage = GameState.pickaxeLevel + (GameState.relicBonuses?.damageFlat ?? 0);
    } else if (id === 'fragment_shop') {
      GameState.upgrades.fragment_shop = (GameState.upgrades.fragment_shop ?? 0) + 1;
      GameState.relicFragments         = (GameState.relicFragments ?? 0) + 1;
    } else if (id === 'block_reroll') {
      GameState.upgrades.block_reroll = (GameState.upgrades.block_reroll ?? 0) + 1;
      // Effet (spawn du nouveau bloc) géré par main.js après buy()
    } else {
      GameState.upgrades[id] += 1;
    }

    GameState.stats.totalUpgradesBought += 1;
    return true;
  },

  getRewardMultiplier() {
    return (1 + GameState.upgrades.bag * 0.3) * (1 + (GameState.relicBonuses?.coinsPct ?? 0));
  },

  getAutoDigDamage() {
    return GameState.upgrades.autodig + (GameState.relicBonuses?.autodigBonus ?? 0);
  },
};
