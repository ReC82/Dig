/**
 * collection.js
 * Catalogue des trouvailles et logique de drop.
 * Dépend de : GameState
 */
const Collection = {

  FINDS: [
    {
      id: 'fossil',
      name: 'Fossile',
      icon: '🦴',
      desc: 'Un os pétrifié vieux de millénaires.',
      dropFrom: ['pierre'],
      minDepth: 8,
      chance: 0.04,
    },
    {
      id: 'crystal',
      name: 'Cristal bleu',
      icon: '💠',
      desc: 'Un cristal aux reflets azurés formé sous la pression.',
      dropFrom: ['minerai'],
      minDepth: 12,
      chance: 0.05,
    },
    {
      id: 'ancient_coin',
      name: 'Pièce ancienne',
      icon: '🪙',
      desc: 'Une monnaie d\'une civilisation depuis longtemps oubliée.',
      dropFrom: ['terre', 'pierre'],
      minDepth: 18,
      chance: 0.03,
    },
    {
      id: 'relic',
      name: 'Relique',
      icon: '⚱️',
      desc: 'Un vase brisé d\'une époque révolue.',
      dropFrom: ['coffre'],
      minDepth: 10,
      chance: 0.15,
    },
    {
      id: 'broken_crown',
      name: 'Couronne brisée',
      icon: '👑',
      desc: 'La couronne d\'un roi depuis longtemps oublié.',
      dropFrom: ['coffre'],
      minDepth: 35,
      chance: 0.20,
    },
    {
      id: 'monster_tooth',
      name: 'Dent de monstre',
      icon: '🦷',
      desc: 'Une dent acérée d\'une créature souterraine.',
      dropFrom: ['gemme'],
      minDepth: 35,
      chance: 0.10,
    },
    {
      id: 'map_fragment',
      name: 'Fragment de carte',
      icon: '🗺',
      desc: 'Un morceau de carte menant vers l\'inconnu.',
      dropFrom: ['pierre', 'minerai'],
      minDepth: 55,
      chance: 0.035,
    },
    {
      id: 'mystic_orb',
      name: 'Orbe mystérieux',
      icon: '🔮',
      desc: 'Une sphère qui semble contenir une galaxie entière.',
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
