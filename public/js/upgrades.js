/**
 * upgrades.js
 * Catalogue des améliorations et logique d'achat.
 * Dépend de : GameState
 */
const Upgrades = {

  DEFS: [
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
        return { coins: Math.floor(10 * Math.pow(2, level - 1)), gems: 0 };
      },
    },
    {
      id: 'luck',
      icon: '🍀',
      name: 'upgrade.luck.name',
      maxLevel: 8,
      describe(level) {
        if (level === 0) return t('upgrade.luck.desc_none');
        return t('upgrade.luck.desc', { pct: level * 20 });
      },
      getCost(level) {
        if (level >= 8) return null;
        return { coins: Math.floor(25 * Math.pow(1.9, level)), gems: 0 };
      },
    },
    {
      id: 'bag',
      icon: '🎒',
      name: 'upgrade.bag.name',
      maxLevel: 8,
      describe(level) {
        if (level === 0) return t('upgrade.bag.desc_normal');
        return t('upgrade.bag.desc', { mult: (1 + level * 0.3).toFixed(1) });
      },
      getCost(level) {
        if (level >= 8) return null;
        return { coins: Math.floor(40 * Math.pow(2, level)), gems: 0 };
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
        const table = [
          { coins: 80,  gems: 0  },
          { coins: 280, gems: 0  },
          { coins: 0,   gems: 2  },
          { coins: 0,   gems: 5  },
          { coins: 0,   gems: 12 },
          { coins: 0,   gems: 25 },
        ];
        return table[level] ?? null;
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
