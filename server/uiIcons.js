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
  upgrades: 'Améliorations',
  quests: 'Objectifs',
  system: 'Icônes système (aide, information)',
  dig: 'Minage',
  season: 'Saison',
  shop: 'Boutique',
  sections: 'Titres de sections',
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
  { id: 'quotidien', zone: 'nav', emoji: '📅', name: 'Récompense quotidienne', en: 'Daily', where: 'onglet « Quotidien » de la barre du bas et titre « 📅 Quotidien » de la vue', context: `"Daily" ${NAV}, opens the daily login reward and daily missions`,
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
  { id: 'pieces', zone: 'currency', emoji: '💰', name: 'Pièces', en: 'Coins', where: 'devant chaque montant en pièces : récompense du bloc miné, coûts des améliorations et des coffres, récompenses des missions, des objectifs et de la connexion quotidienne', context: 'small inline currency symbol shown before every coin amount (costs and rewards)',
    subject: 'A small stack of three gold coins', details: 'Three thick round coins slightly fanned, readable at 16 pixels inline with text.', palette: 'Palette: bright gold with warm orange shading.' },
  { id: 'gemmes', zone: 'currency', emoji: '💎', name: 'Gemmes', en: 'Gems', where: 'devant chaque montant en gemmes : coûts, récompenses, solde de la boutique', context: 'small inline premium currency symbol shown before every gem amount',
    subject: 'A single brilliant-cut blue gem', details: 'Classic faceted diamond shape seen from the side, crisp facets, readable at 16 pixels inline with text.', palette: 'Palette: light cyan to deep blue facets with white glints.' },
  { id: 'boost', zone: 'currency', emoji: '⚡', name: 'Boost', en: 'Boost', where: 'récompense « boost » du 6e jour de connexion, titre « ⚡ Boosts » et carte boost de la Boutique, explications de la saison', context: 'small symbol of a temporary earnings boost in the daily login rewards',
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
  { id: 'blocs_mines', zone: 'ranking', emoji: '👆', name: 'Blocs minés à la main', en: 'Blocks mined by hand', where: 'ancien pictogramme de l\'en-tête « Blocs manuels » du classement (retiré, recette #67-B)', context: 'small symbol before the number of blocks a player broke by tapping, in each leaderboard row',
    deployable: false, notDeployable: 'Retiré du jeu à la demande du propriétaire (recette #67-B du 10/11) : l\'en-tête « Blocs manuels » garde son texte seul, comme les colonnes voisines. Les images restent stockées ici.',
    subject: 'A pointing finger tapping a small stone block', details: 'Index finger pressing the top of a tiny cube of rock, small impact sparks.', palette: 'Palette: warm skin tone, gray stone, yellow sparks.' },

  // ── Missions du jour : PAS ici. Leurs emblèmes sont les cibles `mission:<id>` du catalogue #68 (même
  //    identifiants que les six missions du jeu) ; uiIconMap() les sert au jeu (`mission_<id>`) dès que
  //    le catalogue #68 est actif en jeu (missionCatalog.isLive()), jamais avant. Pas de doublon ici.

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
  // ── Icônes système (#67-B) : un seul pictogramme par RÔLE, partagé par tous les emplacements du même
  //    rôle (pas de doublon par écran). Seule l'apparence change : bouton, zone cliquable de 28 px, texte
  //    accessible (aria-label du bouton), focus clavier et comportement restent ceux du jeu.
  { id: 'aide', zone: 'system', emoji: '?', name: 'Aide générale (bouton ? de l\'en-tête)', en: 'Help', where: 'bouton « ? » rond tout en haut à gauche (ouvre l\'aide « Comment jouer ? », #78)', context: 'round "Help" button at the top left of the game header, opens the how-to-play guide',
    subject: 'A round question mark badge', details: 'A bold question mark inside a simple circle, readable at 24 pixels; no letters other than the question mark.', palette: 'Palette: soft white question mark on a slate-blue disc with a thin gold rim.' },
  { id: 'aide_contextuelle', zone: 'system', emoji: '?', name: 'Aide contextuelle (petits ? à côté des titres)', en: 'Contextual help', where: 'tous les petits « ? » placés à côté d\'un titre (Saison, Classement, Ligues, Améliorations, Coffres, Collection, Reliques, Badges, Gemmes…) : une seule image pour tous', context: 'tiny round question mark button next to section titles, opens a short help bubble',
    subject: 'A tiny round question mark badge', details: 'Minimal question mark inside a thin circle, must stay readable at 18 pixels; no other symbol.', palette: 'Palette: light gray question mark and rim, transparent centre.' },
  { id: 'info', zone: 'system', emoji: 'ℹ️', name: 'Information (ℹ️ des explications repliables)', en: 'Information', where: '« ℹ️ Comment fonctionne la saison ? » (Saison), « ℹ️ Récompenses et chances » et « ℹ️ Comment fonctionnent les récompenses ? » (coffres) : une seule image pour tous', context: 'small information symbol in front of collapsible explanations',
    subject: 'A round information badge with a lowercase i', details: 'Simple circle containing a lowercase letter i (dot and stem), readable at 16 pixels inline with text.', palette: 'Palette: white i on a calm blue disc.' },

  // ── Minage (vue Dig) ──
  { id: 'doubler', zone: 'dig', emoji: '📺', name: 'Bouton « Doubler la récompense »', en: 'Double the reward', where: 'pictogramme du bouton « Doubler la récompense » sous le bloc (vue Dig)', context: 'icon of the "double your rewards" button under the mining block',
    subject: 'A small retro TV screen showing a bold x2', details: 'Compact television with a play triangle and a tiny x2 sparkle, readable at 20 pixels.', palette: 'Palette: dark gray TV, bright gold x2 and play triangle.' },

  // ── Saison ──
  { id: 'saison_theme', zone: 'season', emoji: '🏮', name: 'Thème de la semaine (emblème de la carte)', en: 'Theme of the week', where: 'grand pictogramme de la carte « Thème de la semaine » en haut de Saison. Le jeu y montre sinon l\'icône propre au thème en cours (🏮 pour « La Saison des Lanternes ») : une image appliquée ici remplace l\'icône de CHAQUE thème hebdomadaire', context: 'large emblem of the "Theme of the week" card at the top of the season screen',
    subject: 'A weekly theme emblem: a small hanging pennant banner with a star', details: 'Generic emblem that suits any weekly theme (never a specific object such as a lantern), readable at 32 pixels.', palette: 'Palette: warm red pennant, gold star, wooden pole.' },
  { id: 'saison_resultat', zone: 'season', emoji: '🏁', name: 'Résultat — Saison précédente', en: 'Previous season result', where: 'titre repliable « 🏁 Résultat — Saison … » (classement figé de la saison précédente)', context: 'symbol in front of the "Result — previous season" title',
    subject: 'A chequered finish flag', details: 'Single black and white chequered flag on a short pole, waving.', palette: 'Palette: black and white squares, dark wood pole.' },
  { id: 'points_recompense', zone: 'season', emoji: '🏅', name: 'Points de récompense', en: 'Reward points', where: 'titre « 🏅 Points de récompense » (Saison) et monnaie « 🏅 Points de saison » du guide des boutiques', context: 'symbol of the seasonal reward points (title and currency label)',
    subject: 'A round merit token with a star', details: 'Thick coin-like token with an embossed star and a small ribbon, distinct from gold coins.', palette: 'Palette: warm bronze-gold token, teal ribbon.' },
  { id: 'cadeaux_boutique', zone: 'season', emoji: '🎁', name: 'Boutique de cadeaux', en: 'Gift shop', where: 'titre « 🎁 Boutique de cadeaux » (Saison) et entrée « 🎁 Cadeaux » du guide des boutiques', context: 'symbol of the gift shop where reward points are exchanged',
    subject: 'A small stack of two wrapped gift boxes', details: 'Two boxes stacked, ribbons and a bow, distinct from the single daily-reward gift.', palette: 'Palette: teal and red boxes, gold ribbons.' },

  // ── Boutique (vue Boutique, guide « Où dépenser quoi ? ») ──
  { id: 'coffres', zone: 'shop', emoji: '📦', name: 'Coffres (titre et guide)', en: 'Chests', where: 'titre « 📦 Coffres de saison » (Améliorations) et entrée « 📦 Coffres » du guide des boutiques', context: 'symbol of the seasonal chests shop section',
    subject: 'A closed wooden treasure chest', details: 'Small chest with iron bands and a lock, three-quarter view, closed.', palette: 'Palette: warm wood, dark iron bands, gold lock.' },
  { id: 'argent_reel', zone: 'shop', emoji: '💶', name: 'Argent réel', en: 'Real money', where: 'monnaie « 💶 Argent réel » du guide des boutiques (gemmes et cosmétiques)', context: 'symbol meaning "paid with real money" in the shops guide',
    subject: 'A single folded banknote', details: 'One plain banknote, slightly folded, no digits, letters or currency signs.', palette: 'Palette: soft green-blue paper, darker border.' },
  { id: 'pack_gems_5', zone: 'shop', emoji: '💎', name: 'Pack de 5 gemmes', en: 'Small gem pack', where: 'carte « 5 gemmes » de la section Gemmes (Boutique)', context: 'icon of the smallest gem pack card in the shop',
    subject: 'A small pile of three blue gems', details: 'Three faceted gems loosely grouped, smallest of the three gem packs.', palette: 'Palette: cyan to deep blue facets.' },
  { id: 'pack_gems_20', zone: 'shop', emoji: '💎', name: 'Pack de 20 gemmes', en: 'Medium gem pack', where: 'carte « 20 gemmes » de la section Gemmes (Boutique)', context: 'icon of the medium gem pack card in the shop',
    subject: 'A small leather pouch overflowing with blue gems', details: 'Open drawstring pouch with several gems spilling out; bigger than the small pack.', palette: 'Palette: brown leather, cyan to deep blue gems.' },
  { id: 'pack_gems_60', zone: 'shop', emoji: '💎', name: 'Pack de 60 gemmes', en: 'Large gem pack', where: 'carte « 60 gemmes » de la section Gemmes (Boutique)', context: 'icon of the largest gem pack card in the shop',
    subject: 'A small open chest filled with blue gems', details: 'Little chest heaped with gems, clearly the biggest of the three packs.', palette: 'Palette: dark wood, gold trim, cyan to deep blue gems.' },
  { id: 'pioche_entretien', zone: 'shop', emoji: '⛏', name: 'Pioche et entretien (titre)', en: 'Pickaxe care', where: 'titre de section « ⛏ Pioche et entretien » (Boutique, pioche à charges #71)', context: 'symbol of the "pickaxe and maintenance" shop section',
    subject: 'A pickaxe with a small whetstone', details: 'Pickaxe lying next to a sharpening stone with a tiny spark.', palette: 'Palette: steel head, brown handle, gray whetstone, yellow spark.' },
  { id: 'pioche_reserve', zone: 'shop', emoji: '🔋', name: 'Capacité de réserve', en: 'Charge capacity', where: 'carte « Capacité de réserve » (Pioche et entretien)', context: 'icon of the pickaxe charge capacity upgrade card',
    subject: 'A battery gauge with full bars', details: 'Upright battery with three bright bars, a tiny pickaxe emblem on its side.', palette: 'Palette: dark casing, bright green bars.' },
  { id: 'pioche_vitesse', zone: 'shop', emoji: '⏱', name: 'Vitesse de recharge', en: 'Recharge speed', where: 'carte « Vitesse de recharge » (Pioche et entretien)', context: 'icon of the pickaxe recharge speed upgrade card',
    subject: 'A stopwatch with motion lines', details: 'Round stopwatch, hand moving fast, two short speed lines.', palette: 'Palette: steel case, white dial, orange hand.' },
  { id: 'pioche_recharge', zone: 'shop', emoji: '⚡', name: 'Recharge immédiate (+10/+25/+50 %)', en: 'Instant recharge', where: 'cartes « Recharge immédiate +10 % / +25 % / +50 % » (Pioche et entretien) : une seule image pour les trois', context: 'icon of the instant pickaxe recharge cards',
    subject: 'A pickaxe head with a lightning bolt', details: 'Pickaxe head crossed by a small lightning bolt, meaning instant refill; distinct from the earnings boost.', palette: 'Palette: steel head, electric yellow bolt.' },
  { id: 'fragments', zone: 'shop', emoji: '🔮', name: 'Fragments de relique (lot en euros)', en: 'Relic fragments', where: 'titre « 🔮 Fragments de relique » et carte du lot de 10 fragments (#85, visible seulement quand l\'offre est ouverte)', context: 'symbol of relic fragments in the shop',
    subject: 'Three small glowing crystal shards', details: 'Cluster of magic shards, readable at 16 pixels.', palette: 'Palette: violet and magenta glow.' },

  // ── Titres de sections (vues Améliorations et Collection) ──
  { id: 'objectifs', zone: 'sections', emoji: '🎯', name: 'Objectifs (titre)', en: 'Goals', where: 'titre de section « 🎯 Objectifs » (Améliorations)', context: 'symbol in front of the "Goals" section title',
    subject: 'A small archery target with an arrow in the centre', details: 'Round target, three rings, one arrow in the bullseye.', palette: 'Palette: red and white rings, wooden arrow.' },
  { id: 'missions_jour', zone: 'sections', emoji: '🎯', name: 'Missions du jour (titre)', en: 'Daily missions', where: 'titre de section « 🎯 Missions du jour » (vue Quotidien)', context: 'symbol in front of the "Daily missions" section title',
    subject: 'A small checklist clipboard with a sun', details: 'Clipboard with three short lines and one tick, a tiny sun in the corner meaning TODAY; distinct from the goals target.', palette: 'Palette: warm wood clipboard, white paper, gold sun, green tick.' },
  { id: 'reliques', zone: 'sections', emoji: '✨', name: 'Reliques (titre)', en: 'Relics', where: 'titre de section « ✨ Reliques » (Collection)', context: 'symbol in front of the "Relics" section title',
    subject: 'An ancient glowing amulet', details: 'Small round amulet with a softly glowing gem, a few sparkles.', palette: 'Palette: antique gold, violet glow.' },
  { id: 'badges', zone: 'sections', emoji: '🏅', name: 'Badges et succès (titre)', en: 'Badges', where: 'titre de section « 🏅 Badges et succès » (Collection)', context: 'symbol in front of the "Badges and achievements" section title',
    subject: 'A small shield badge with a star', details: 'Heraldic shield with an embossed star, distinct from the reward points token.', palette: 'Palette: silver shield, gold star, blue ribbon.' },
  { id: 'evenements', zone: 'sections', emoji: '🎉', name: 'Événements (titre)', en: 'Events', where: 'titre de section « 🎉 Événements » (Collection, pendant un événement)', context: 'symbol in front of the "Events" section title',
    subject: 'A party popper with confetti', details: 'Cone popper bursting colourful confetti.', palette: 'Palette: gold cone, multicolour confetti.' },
];

for (const u of UI_TARGETS) if (u.deployable === undefined) u.deployable = true;

module.exports = { UI_TARGETS, ZONES };
