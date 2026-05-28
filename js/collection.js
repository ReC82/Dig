/**
 * collection.js
 * Catalogue des trouvailles et logique de drop.
 * Dépend de : GameState
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
  tryDrop(blockType, depth) {
    const eligible = this.FINDS.filter(f =>
      !GameState.collection.includes(f.id) &&
      depth >= f.minDepth &&
      f.dropFrom.includes(blockType.category)
    );

    for (const find of eligible) {
      if (Math.random() < find.chance) {
        GameState.collection.push(find.id);
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
};
