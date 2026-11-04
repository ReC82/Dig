/**
 * server/uiIcons.js — registre des pictogrammes d'interface du jeu (#67).
 *
 * Chaque entrée est une cible `ui:<id>` de l'atelier d'icônes (#40). Les identifiants sont STABLES :
 * le jeu les lit (attribut `data-ui-icon`, `UiIcons.html(id, emoji)`) et les images déjà générées
 * leur sont rattachées. Ne jamais renommer un identifiant existant.
 *
 *   zone     : regroupement affiché dans le panel (filtre « Zone »)
 *   name     : libellé français du panel ; en : nom transmis à l'IA
 *   where    : emplacement exact dans le jeu (français, panel) ; context : le même, en anglais, pour l'IA
 *   emoji    : pictogramme d'origine (repli permanent si l'image manque ou ne charge pas)
 *   deployable : false = image seulement stockée ici, jamais appliquée par l'atelier (raison dans `notDeployable`)
 *   subject / details / palette : consigne d'illustration par défaut (anglais)
 */
'use strict';

const ZONES = {
  nav: 'Navigation du bas',
  header: 'En-tête',
  currency: 'Monnaies et récompenses',
  ranking: 'Classement',
  missions: 'Missions du jour',
  upgrades: 'Améliorations',
  quests: 'Objectifs',
};

const NAV = 'tab button of the bottom navigation bar of the DIG! mobile mining game';

const UI_TARGETS = [
  // ── Navigation du bas (index.html, #bottom-nav) ──
  { id: 'creuser', zone: 'nav', emoji: '⛏', name: 'Creuser', en: 'Dig', where: 'onglet « Dig » de la barre du bas', context: `"Dig" ${NAV}, opens the mining screen`,
    subject: 'A single sturdy pickaxe', details: 'Classic miner\'s pickaxe, diagonal, chunky steel head and wooden handle.', palette: 'Palette: steel gray head, warm brown handle.' },
  { id: 'ameliorations', zone: 'nav', emoji: '⚙', name: 'Améliorations', en: 'Upgrades', where: 'onglet « Amélios » de la barre du bas', context: `"Upgrades" ${NAV}, opens the list of pickaxe and tool upgrades`,
    subject: 'A pickaxe with a glowing upward arrow', details: 'Short sturdy pickaxe crossed by a bold upward arrow meaning UPGRADE; must not look like a gear.', palette: 'Palette: wooden handle, steel head, bright golden arrow.' },
  { id: 'collection', zone: 'nav', emoji: '📦', name: 'Collection', en: 'Collection', where: 'onglet « Collection » de la barre du bas', context: `"Collection" ${NAV}, opens the player's collection of found objects, relics and badges`,
    subject: 'A small open treasure crate showing a few collectible relics', details: 'Wooden crate, lid open, a fossil bone and a blue crystal peeking out.', palette: 'Palette: warm wood, hints of blue and bone white.' },
  { id: 'quotidien', zone: 'nav', emoji: '📅', name: 'Récompense quotidienne', en: 'Daily', where: 'onglet « Quotidien » de la barre du bas', context: `"Daily" ${NAV}, opens the daily login reward and daily missions`,
    subject: 'A small calendar page with a gift ribbon', details: 'Single calendar sheet with a check mark and a red ribbon bow.', palette: 'Palette: off-white page, red ribbon, gold check.' },
  { id: 'boutique', zone: 'nav', emoji: '🛒', name: 'Boutique', en: 'Shop', where: 'onglet « Boutique » de la barre du bas', context: `"Shop" ${NAV}, opens the in-game shop (chests and items)`,
    subject: 'A small mine cart full of gold coins', details: 'Rail mine cart seen in three-quarter view, heaped with coins.', palette: 'Palette: dark iron cart, shiny gold coins.' },
  { id: 'saison', zone: 'nav', emoji: '🏆', name: 'Saison / classement', en: 'Season', where: 'onglet « Saison » de la barre du bas', context: `"Season" ${NAV}, opens the seasonal leaderboard`,
    subject: 'A golden trophy cup', details: 'Two-handled cup on a short base, faceted gold.', palette: 'Palette: rich gold with warm highlights.' },

  // ── En-tête (index.html, header) ──
  { id: 'profil', zone: 'header', emoji: '👤', name: 'Profil / compte', en: 'Profile', where: 'bouton « personne » en haut à droite (ouvre le Profil, #63)', context: 'round "Profile" button at the top right of the game header, opens the player profile',
    subject: 'A friendly miner\'s portrait bust silhouette wearing a mining helmet with a small lamp', details: 'Head and shoulders only, clearly a PERSON (profile/account), never a gear or tool.', palette: 'Palette: warm amber helmet, slate-blue clothing, soft skin tone.' },
  { id: 'parametres', zone: 'header', emoji: '⚙', name: 'Paramètres', en: 'Settings', where: 'bouton « engrenage » en haut à droite (ouvre les Paramètres, #63)', context: 'round "Settings" button at the top right of the game header, opens the account and game settings',
    subject: 'A single settings gear combined with two small slider knobs', details: 'One cog wheel with six chunky teeth and two short horizontal slider bars in front: clearly SETTINGS, distinct from the profile portrait and from the upgrades pickaxe.', palette: 'Palette: cool steel gray with a teal accent on the slider knobs.' },
  { id: 'actualites', zone: 'header', emoji: '🔔', name: 'Actualités (cloche)', en: 'News', where: 'cloche en haut à gauche, à côté du logo (ouvre les actualités, #50)', context: 'round "News" bell button at the top left of the game header, opens the news and announcements',
    subject: 'A single brass notification bell', details: 'Classic rounded bell with a small clapper, slightly tilted as if ringing; no letters.', palette: 'Palette: warm brass gold with a darker bronze rim.' },
  { id: 'logo', zone: 'header', emoji: '⛏', name: 'Logo DIG! — emblème compact', en: 'DIG! logo emblem', where: 'logo de l\'en-tête', context: 'compact emblem placed just before the word DIG! in the game header',
    deployable: false, notDeployable: 'Logo choisi par le propriétaire avec #41 (« Lingot ») : cette image reste stockée ici et ne remplace jamais le logo. Aperçu : « Voir dans le vrai en-tête ».',
    subject: 'A compact square emblem for the DIG! mining game: a chunky faceted stone block with a golden pickaxe planted in its top', details: 'Badge-like square emblem that stays readable at 32 to 40 pixels in a phone header, placed just before the word DIG!; no text, no letters, no ribbon, no wide shape.', palette: 'Palette: cool stone gray block like the reference stone, bright gold pickaxe head, warm wooden handle.' },

  // ── Monnaies et récompenses (coûts, récompenses de missions, d'objectifs et de connexion) ──
  { id: 'pieces', zone: 'currency', emoji: '💰', name: 'Pièces', en: 'Coins', where: 'devant chaque montant en pièces : coûts des améliorations, récompenses des missions, des objectifs et de la connexion quotidienne', context: 'small inline currency symbol shown before every coin amount (costs and rewards)',
    subject: 'A small stack of three gold coins', details: 'Three thick round coins slightly fanned, readable at 16 pixels inline with text.', palette: 'Palette: bright gold with warm orange shading.' },
  { id: 'gemmes', zone: 'currency', emoji: '💎', name: 'Gemmes', en: 'Gems', where: 'devant chaque montant en gemmes : coûts, récompenses, solde de la boutique', context: 'small inline premium currency symbol shown before every gem amount',
    subject: 'A single brilliant-cut blue gem', details: 'Classic faceted diamond shape seen from the side, crisp facets, readable at 16 pixels inline with text.', palette: 'Palette: light cyan to deep blue facets with white glints.' },
  { id: 'boost', zone: 'currency', emoji: '⚡', name: 'Boost', en: 'Boost', where: 'récompense « boost » du 6e jour de connexion', context: 'small symbol of a temporary earnings boost in the daily login rewards',
    subject: 'A single bold lightning bolt', details: 'Chunky zigzag bolt, slightly tilted, readable at 16 pixels.', palette: 'Palette: electric yellow with an orange edge.' },
  { id: 'cadeau', zone: 'currency', emoji: '🎁', name: 'Cadeau', en: 'Gift', where: 'grande récompense du 7e jour de connexion', context: 'small gift symbol for the big 7th-day daily login reward',
    subject: 'A small wrapped gift box with a ribbon bow', details: 'Cube box with a cross ribbon and a bow on top, three-quarter view.', palette: 'Palette: red box, gold ribbon.' },

  // ── Classement (onglet Saison) ──
  { id: 'medaille_or', zone: 'ranking', emoji: '🥇', name: 'Médaille d\'or (1er)', en: 'Gold medal', where: '1re place du classement de la saison et du podium de la saison précédente', context: 'first-place medal shown next to the leader of the seasonal leaderboard',
    subject: 'A round gold medal with a short ribbon', details: 'Disc medal with a raised number-free star in the centre, short V ribbon on top; no digits or letters.', palette: 'Palette: shiny gold medal, red and blue ribbon.' },
  { id: 'medaille_argent', zone: 'ranking', emoji: '🥈', name: 'Médaille d\'argent (2e)', en: 'Silver medal', where: '2e place du classement de la saison et du podium', context: 'second-place medal shown in the seasonal leaderboard',
    subject: 'A round silver medal with a short ribbon', details: 'Same shape as the gold medal: disc with a raised star, short V ribbon; no digits or letters.', palette: 'Palette: polished silver medal, red and blue ribbon.' },
  { id: 'medaille_bronze', zone: 'ranking', emoji: '🥉', name: 'Médaille de bronze (3e)', en: 'Bronze medal', where: '3e place du classement de la saison et du podium', context: 'third-place medal shown in the seasonal leaderboard',
    subject: 'A round bronze medal with a short ribbon', details: 'Same shape as the gold medal: disc with a raised star, short V ribbon; no digits or letters.', palette: 'Palette: warm bronze medal, red and blue ribbon.' },
  { id: 'blocs_mines', zone: 'ranking', emoji: '👆', name: 'Blocs minés à la main', en: 'Blocks mined by hand', where: 'nombre de blocs minés à la main, dans chaque ligne du classement', context: 'small symbol before the number of blocks a player broke by tapping, in each leaderboard row',
    subject: 'A pointing finger tapping a small stone block', details: 'Index finger pressing the top of a tiny cube of rock, small impact sparks.', palette: 'Palette: warm skin tone, gray stone, yellow sparks.' },

  // ── Missions du jour (onglet Quotidien, public/js/dailyMissions.js) ──
  { id: 'mission_break_blocks', zone: 'missions', emoji: '⛏', name: 'Mission : casser des blocs', en: 'Break blocks mission', where: 'carte de la mission du jour « casser des blocs »', context: 'icon of the daily mission "break N blocks"',
    subject: 'A pickaxe striking a cracked stone block', details: 'Pickaxe head hitting the corner of a small cube of rock with visible cracks.', palette: 'Palette: steel and wood pickaxe, gray stone.' },
  { id: 'mission_earn_coins', zone: 'missions', emoji: '💰', name: 'Mission : gagner des pièces', en: 'Earn coins mission', where: 'carte de la mission du jour « gagner des pièces »', context: 'icon of the daily mission "earn N coins"',
    subject: 'A small open money bag spilling gold coins', details: 'Cloth sack tied at the neck, a few coins tumbling out.', palette: 'Palette: tan cloth, bright gold coins.' },
  { id: 'mission_open_chests', zone: 'missions', emoji: '📦', name: 'Mission : ouvrir des coffres', en: 'Open chests mission', where: 'carte de la mission du jour « ouvrir des coffres »', context: 'icon of the daily mission "open N chests"',
    subject: 'A small wooden chest with its lid popping open', details: 'Iron-banded chest, lid half open with a golden glow inside.', palette: 'Palette: warm wood, dark iron bands, golden light.' },
  { id: 'mission_buy_upgrades', zone: 'missions', emoji: '⚙', name: 'Mission : acheter des améliorations', en: 'Buy upgrades mission', where: 'carte de la mission du jour « acheter des améliorations »', context: 'icon of the daily mission "buy N upgrades"',
    subject: 'A wrench and a pickaxe crossed with a small plus sign', details: 'Two tools crossed, a bold green plus in a corner meaning improvement.', palette: 'Palette: steel tools, wooden handle, green plus.' },
  { id: 'mission_find_gems', zone: 'missions', emoji: '💎', name: 'Mission : trouver des gemmes', en: 'Find gems mission', where: 'carte de la mission du jour « trouver des gemmes »', context: 'icon of the daily mission "find N gems"',
    subject: 'A raw gem crystal sticking out of a small rock', details: 'Rough gray rock with a bright faceted crystal emerging from it.', palette: 'Palette: gray rock, vivid green and cyan crystal.' },
  { id: 'mission_depth_gain', zone: 'missions', emoji: '🗺', name: 'Mission : descendre en profondeur', en: 'Dig deeper mission', where: 'carte de la mission du jour « descendre de N mètres »', context: 'icon of the daily mission "dig N meters deeper"',
    subject: 'A bold downward arrow plunging into layered ground', details: 'Cross-section of three soil layers with a thick arrow pointing down through them.', palette: 'Palette: brown and gray layers, bright orange arrow.' },

  // ── Améliorations (onglet Améliorations, public/js/upgrades.js) ──
  { id: 'upgrade_pickaxe', zone: 'upgrades', emoji: '⛏', name: 'Amélioration : pioche', en: 'Pickaxe upgrade', where: 'carte « Pioche » de l\'onglet Améliorations', context: 'icon of the "Pickaxe" upgrade card (more damage per tap)',
    subject: 'A reinforced steel pickaxe', details: 'Heavier pickaxe with a riveted steel head and a gleam on the tip.', palette: 'Palette: bright steel, dark wood handle.' },
  { id: 'upgrade_luck', zone: 'upgrades', emoji: '🍀', name: 'Amélioration : chance', en: 'Luck upgrade', where: 'carte « Chance » de l\'onglet Améliorations', context: 'icon of the "Luck" upgrade card (better finds)',
    subject: 'A four-leaf clover', details: 'Single clover with four rounded leaves and a short stem.', palette: 'Palette: fresh green with a light highlight.' },
  { id: 'upgrade_bag', zone: 'upgrades', emoji: '🎒', name: 'Amélioration : sac', en: 'Bag upgrade', where: 'carte « Sac » de l\'onglet Améliorations', context: 'icon of the "Bag" upgrade card (more coins per block)',
    subject: 'A miner\'s leather backpack', details: 'Small rucksack with a flap and a buckle, a coin peeking out.', palette: 'Palette: brown leather, brass buckle.' },
  { id: 'upgrade_autodig', zone: 'upgrades', emoji: '⚙', name: 'Amélioration : Auto-Dig', en: 'Auto-dig upgrade', where: 'carte « Auto-Dig » de l\'onglet Améliorations', context: 'icon of the "Auto-dig" upgrade card (digs by itself every second)',
    subject: 'A small mechanical drill with a gear', details: 'Compact drill bit mounted on a cog wheel, suggesting automatic digging.', palette: 'Palette: steel and brass, orange accent.' },
  { id: 'upgrade_fragment_shop', zone: 'upgrades', emoji: '🔮', name: 'Amélioration : Fragments', en: 'Fragment upgrade', where: 'carte « Fragments » (fragment de relique) de l\'onglet Améliorations', context: 'icon of the relic fragments upgrade card',
    subject: 'Three glowing crystal shards', details: 'Small cluster of broken magic crystal pieces, softly glowing.', palette: 'Palette: violet and magenta glow.' },
  { id: 'upgrade_block_reroll', zone: 'upgrades', emoji: '🔄', name: 'Amélioration : Reroll bloc', en: 'Block reroll upgrade', where: 'carte « Reroll bloc » de l\'onglet Améliorations', context: 'icon of the "reroll block" upgrade card',
    subject: 'A small stone cube circled by two curved arrows', details: 'Two arrows forming a loop around a tiny rock cube, meaning swap or reroll.', palette: 'Palette: gray stone, teal arrows.' },

  // ── Objectifs (onglet Améliorations, section « Objectifs », public/js/quests.js) ──
  { id: 'quete_break10', zone: 'quests', emoji: '⛏', name: 'Objectif : casser 10 blocs', en: 'Break blocks goal', where: 'carte de l\'objectif « casser 10 blocs »', context: 'icon of the one-time goal "break 10 blocks"',
    subject: 'A pickaxe over a small pile of rubble', details: 'Pickaxe resting on a few broken stone chunks.', palette: 'Palette: steel and wood, gray rubble.' },
  { id: 'quete_depth25', zone: 'quests', emoji: '🗺', name: 'Objectif : 25 m de profondeur', en: 'Depth goal', where: 'carte de l\'objectif « atteindre 25 m »', context: 'icon of the one-time goal "reach 25 meters deep"',
    subject: 'A rolled treasure map with a dotted path going down', details: 'Partly unrolled parchment with a dotted line ending on a red cross.', palette: 'Palette: parchment beige, red cross, brown ink.' },
  { id: 'quete_coins100', zone: 'quests', emoji: '💰', name: 'Objectif : 100 pièces', en: 'Coins goal', where: 'carte de l\'objectif « gagner 100 pièces »', context: 'icon of the one-time goal "earn 100 coins"',
    subject: 'A small pile of gold coins', details: 'Loose heap of round coins, a couple standing on edge.', palette: 'Palette: bright gold.' },
  { id: 'quete_find_gem', zone: 'quests', emoji: '💎', name: 'Objectif : trouver une gemme', en: 'Find a gem goal', where: 'carte de l\'objectif « trouver une gemme »', context: 'icon of the one-time goal "find a gem"',
    subject: 'A magnifying glass over a small gem', details: 'Round magnifier lens enlarging a faceted gemstone.', palette: 'Palette: brass rim, blue gem.' },
  { id: 'quete_upgrade5', zone: 'quests', emoji: '🔧', name: 'Objectif : Artisan (5 améliorations)', en: 'Upgrades goal', where: 'carte de l\'objectif « 5 améliorations »', context: 'icon of the one-time goal "buy 5 upgrades"',
    subject: 'A single sturdy wrench', details: 'Classic open-end wrench, diagonal.', palette: 'Palette: steel gray with a blue grip.' },
];

for (const u of UI_TARGETS) if (u.deployable === undefined) u.deployable = true;

module.exports = { UI_TARGETS, ZONES };
