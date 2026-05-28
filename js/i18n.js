/**
 * i18n.js — Internationalisation minimaliste
 * Langues : fr (défaut), en, nl
 *
 * API publique :
 *   t('ui.btn_upgrade')                     → "Améliorer"
 *   t('stats.depth_val', { n: 42 })         → "42m"
 *   I18n.setLang('en')                      → change la langue + re-applique
 *   I18n.getCurrent()                       → 'fr' | 'en' | 'nl'
 *   I18n.onLangChange(fn)                   → callback sur changement
 *   applyTranslations()                     → remplit les [data-i18n]
 *
 * HTML :
 *   <span data-i18n="nav.dig"></span>
 *   <button data-i18n-aria="nav.dig_aria">
 */

const I18n = (() => {

  const STORAGE_KEY = 'dig_lang';
  const SUPPORTED   = ['fr', 'en', 'nl'];
  const _callbacks  = [];
  let   _current    = 'fr';

  // ── Traductions ────────────────────────────────────────────────────────────

  const T = {

    /* ══════════════════════════════════════════════════════════════════════ */
    fr: {
      nav: {
        dig: 'Dig', upgrades: 'Amélios', collection: 'Collection',
        daily: 'Quotidien', shop: 'Boutique',
        dig_aria: 'Creuser', upgrades_aria: 'Améliorations',
        collection_aria: 'Collection', daily_aria: 'Récompense quotidienne',
        shop_aria: 'Boutique',
      },
      stats: {
        coins: 'Coins', gems: 'Gemmes', depth: 'Prof.',
        pickaxe: 'Pioche', damage: 'Dégâts', relics: 'Reliques',
        depth_val: '{n}m', pickaxe_val: 'Nv.{n}',
      },
      rarity: {
        commun: 'Commun', peu_commun: 'Peu commun', rare: 'Rare',
        epique: 'Épique', legendaire: 'Légendaire',
      },
      block: {
        terre_meuble: 'Terre meuble', argile: 'Argile',
        pierre: 'Pierre', gres: 'Grès', granite: 'Granite',
        charbon: 'Charbon', minerai_fer: 'Minerai de fer', minerai_or: "Minerai d'or",
        vieille_caisse: 'Vieille caisse', coffre_bois: 'Coffre en bois', coffre_fer: 'Coffre en fer',
        rubis: 'Rubis', emeraude: 'Émeraude', diamant: 'Diamant',
      },
      upgrade: {
        pickaxe:  { name: 'Pioche',    desc: '{damage} dégât{s} par clic', },
        luck:     { name: 'Chance',    desc_none: 'Aucun bonus de rareté', desc: '+{pct}% chance de blocs rares', },
        bag:      { name: 'Sac',       desc_normal: 'Récompenses normales', desc: 'Récompenses ×{mult}', },
        autodig:  { name: 'Auto-Dig',  desc_off: 'Inactif', desc: '{dmg} dégât{s} automatique/sec', },
      },
      quest: {
        break10:  { name: 'Premier coup',   desc: 'Casser 10 blocs' },
        depth25:  { name: 'Explorateur',    desc: 'Atteindre la profondeur 25m' },
        coins100: { name: 'Premier trésor', desc: 'Gagner 100 coins au total' },
        find_gem: { name: 'Gemme !',        desc: 'Trouver un bloc gemme' },
        upgrade5: { name: 'Artisan',        desc: 'Acheter 5 améliorations' },
      },
      mission: {
        break_blocks:  { name: 'Briseur',               desc: 'Casser {t} blocs' },
        earn_coins:    { name: 'Accumulateur',           desc: 'Gagner {t} pièces' },
        open_chests:   { name: 'Chercheur de trésors',  desc: 'Ouvrir {t} coffre{s}' },
        buy_upgrades:  { name: 'Bricoleur',              desc: 'Acheter {t} amélioration{s}' },
        find_gems:     { name: 'Gemmologue',             desc: 'Trouver {t} gemme{s}' },
        depth_gain:    { name: 'Explorateur du jour',   desc: 'Creuser {t} m de plus' },
      },
      relic: {
        eye_of_miner:   { name: "Œil du mineur",        desc: "La vision d'un mineur légendaire. Chaque coup frappe plus fort.",             bonus: '+2 dégâts par clic' },
        golden_heart:   { name: "Cœur d'or",            desc: 'Un cœur façonné en or pur. Les pièces affluent davantage.',                   bonus: '+25% pièces' },
        shard_magnet:   { name: 'Aimant à éclats',      desc: 'Attire les fragments depuis les profondeurs. Les coffres en donnent davantage.', bonus: '+1 fragment par coffre' },
        cracked_lens:   { name: 'Lentille fissurée',    desc: 'Même brisée, elle révèle les minerais les plus rares.',                       bonus: '+30% blocs rares' },
        obsidian_claw:  { name: "Griffe d'obsidienne",  desc: "Née dans les profondeurs. Les blocs s'effritent sous sa pression.",           bonus: '-15% HP des blocs' },
        ancient_engine: { name: 'Moteur antique',       desc: "Une machine hors d'âge qui creuse sans relâche.",                            bonus: '+3 dégâts auto/sec' },
      },
      find: {
        fossil:  { name: 'Fossile',           desc: 'Un os pétrifié vieux de millénaires.' },
        crystal: { name: 'Cristal bleu',      desc: 'Un cristal aux reflets azurés formé sous la pression.' },
        coin:    { name: 'Pièce ancienne',    desc: "Une monnaie d'une civilisation depuis longtemps oubliée." },
        relic:   { name: 'Relique',           desc: "Un vase brisé d'une époque révolue." },
        crown:   { name: 'Couronne brisée',   desc: "La couronne d'un roi depuis longtemps oublié." },
        tooth:   { name: 'Dent de monstre',   desc: 'Une dent acérée d\'une créature souterraine.' },
        map:     { name: 'Fragment de carte', desc: 'Un morceau de carte menant vers l\'inconnu.' },
        orb:     { name: 'Orbe mystérieux',   desc: 'Une sphère qui semble contenir une galaxie entière.' },
      },
      shop: {
        gems_5:        { name: '5 Gemmes',       label: 'Petite bourse' },
        gems_20:       { name: '20 Gemmes',      label: 'Sac de gemmes' },
        gems_60:       { name: '60 Gemmes',      label: 'Coffre de gemmes' },
        skin_golden:   { name: 'Pioche Dorée',   label: 'Aura dorée sur le bloc' },
        skin_diamond:  { name: 'Pioche Diamant', label: 'Aura bleue sur le bloc' },
        boost_x3:      { name: 'Boost ×3 Coins', label: 'Coins ×3 pendant 30 min' },
        badge_popular:    'Populaire',
        badge_best_value: 'Meilleure valeur',
        section_gems:     '💎 Gemmes',
        section_skins:    '⛏ Skins de pioche',
        section_boosts:   '⚡ Boosts',
        balance_label:    'Solde actuel',
        disclaimer:       'Mode démo · Aucun achat réel ne sera effectué',
        btn_owned:        '✓ Possédé',
      },
      ui: {
        btn_upgrade:          'Améliorer',
        btn_max:              'MAX',
        btn_claim:            'Réclamer la récompense',
        btn_mission_claim:    'Réclamer',
        btn_collect:          'Récupérer !',
        btn_unlock:           'Débloquer',
        btn_watch_ad:         'Doubler la récompense',
        btn_skip_ad:          'Passer ✕',
        btn_close_ad:         'Récupérer le bonus →',
        btn_reset:            'Réinitialiser la partie',
        confirm_reset:        'Réinitialiser la partie ?\nTous les coins, gemmes, upgrades, reliques, objectifs, trouvailles et la série quotidienne seront perdus.',
        block_reward:         'Récompense\u202f: 💰\u202f{amount}',
        hp_text:              '{hp}\u202f/\u202f{maxHp} HP',
        ad_cooldown:          'Disponible dans {min}:{sec}',
        quest_claimed:        '✓ Réclamé',
        relic_unlocked_badge: '✓ Débloquée',
        relic_shortfall:      '(manque\u202f{n})',
        relic_cost:           '🔮\u202f{n} fragment{s}',
        collection_header:    '{found}\u202f/\u202f{total} trouvée{s}',
        relic_header:         '{count}\u202f/\u202f{total} débloquée{s}\u2002—\u2002🔮\u202f{frags} fragment{s}',
        mission_reward:       'Récompense\u202f:',
        mission_claimed:      '✓ Réclamé',
        mission_progress:     '{done}\u202f/\u202f{target}',
        saved:                'Sauvegardé ✓',
        daily_title:          'Connexion quotidienne',
        daily_streak_day:     'Jour {n} sur 7',
        daily_btn_claim:      'Réclamer la récompense',
        daily_claimed_msg:    '✓ Récompense réclamée !',
        daily_next_msg:       'Reviens demain pour continuer ta série.',
        boost_active:         '⚡ Bonus ×{mult} pièces actif',
        boost_remaining:      '— {min}:{sec} restant',
        chest_title:          '{name} ouvert !',
        chest_content_label:  'Contenu',
        chest_reward_coins:   '💰 {amount} pièces',
        chest_reward_relics:  '🔮 {amount} fragment{s} de relique',
        chest_reward_boost:   '⚡ Boost ×{mult} coins — {minutes} min',
        offline_title:        'Pendant ton absence…',
        offline_duration:     'Absent\u202f{dur}',
        offline_duration_cap: 'Absent\u202f{full} (limité à {capped})',
        offline_reward:       '💰 +{coins} pièces',
        section_objectives:   '🎯 Objectifs',
        section_missions:     '🎯 Missions du jour',
        section_relics:       '🔮 Reliques',
        view_upgrades:        '⚙ Améliorations',
        view_collection:      '📦 Collection',
        view_daily:           '📅 Quotidien',
        view_shop:            '🛒 Boutique',
      },
      notif: {
        ad_bonus:        '+{amount} 💰 bonus pub !',
        daily_reward:    'Jour {day}\u202f: {parts} !',
        mission_done:    'Mission\u202f: {parts} !',
        quest_done:      '{name} terminé !',
        find_drop:       '{name} trouvé !',
        relic_unlocked:  '{name} débloquée !',
        skin_activated:  'Skin activé !',
        boost_activated: 'Boost ×{mult} actif !',
        gems_added:      '💎 +{amount}',
        chest_float:     '📦 COFFRE !',
        gem_float:       '✨ GEMME !',
        coin_float:      '+{amount} 💰',
        damage_float:    '-{amount}',
        shop_gems:       '💎 +{amount}',
        shop_skin:       '✨ Skin activé !',
        shop_boost:      '⚡ Boost ×{mult} actif !',
      },
    },

    /* ══════════════════════════════════════════════════════════════════════ */
    en: {
      nav: {
        dig: 'Dig', upgrades: 'Upgrades', collection: 'Collection',
        daily: 'Daily', shop: 'Shop',
        dig_aria: 'Dig', upgrades_aria: 'Upgrades',
        collection_aria: 'Collection', daily_aria: 'Daily reward',
        shop_aria: 'Shop',
      },
      stats: {
        coins: 'Coins', gems: 'Gems', depth: 'Depth',
        pickaxe: 'Pickaxe', damage: 'Damage', relics: 'Relics',
        depth_val: '{n}m', pickaxe_val: 'Lv.{n}',
      },
      rarity: {
        commun: 'Common', peu_commun: 'Uncommon', rare: 'Rare',
        epique: 'Epic', legendaire: 'Legendary',
      },
      block: {
        terre_meuble: 'Loose Earth', argile: 'Clay',
        pierre: 'Stone', gres: 'Sandstone', granite: 'Granite',
        charbon: 'Coal', minerai_fer: 'Iron Ore', minerai_or: 'Gold Ore',
        vieille_caisse: 'Old Crate', coffre_bois: 'Wooden Chest', coffre_fer: 'Iron Chest',
        rubis: 'Ruby', emeraude: 'Emerald', diamant: 'Diamond',
      },
      upgrade: {
        pickaxe:  { name: 'Pickaxe',   desc: '{damage} damage per click', },
        luck:     { name: 'Luck',      desc_none: 'No rarity bonus', desc: '+{pct}% chance of rare blocks', },
        bag:      { name: 'Bag',       desc_normal: 'Normal rewards', desc: 'Rewards ×{mult}', },
        autodig:  { name: 'Auto-Dig',  desc_off: 'Inactive', desc: '{dmg} automatic damage/sec', },
      },
      quest: {
        break10:  { name: 'First Strike',   desc: 'Break 10 blocks' },
        depth25:  { name: 'Explorer',       desc: 'Reach depth 25m' },
        coins100: { name: 'First Treasure', desc: 'Earn 100 coins total' },
        find_gem: { name: 'Gem!',           desc: 'Find a gem block' },
        upgrade5: { name: 'Craftsman',      desc: 'Buy 5 upgrades' },
      },
      mission: {
        break_blocks:  { name: 'Breaker',         desc: 'Break {t} blocks' },
        earn_coins:    { name: 'Accumulator',      desc: 'Earn {t} coins' },
        open_chests:   { name: 'Treasure Hunter',  desc: 'Open {t} chest{s}' },
        buy_upgrades:  { name: 'Handyman',         desc: 'Buy {t} upgrade{s}' },
        find_gems:     { name: 'Gemologist',       desc: 'Find {t} gem{s}' },
        depth_gain:    { name: 'Day Explorer',     desc: 'Dig {t} m deeper' },
      },
      relic: {
        eye_of_miner:   { name: 'Eye of the Miner',  desc: 'The vision of a legendary miner. Each strike hits harder.',       bonus: '+2 damage per click' },
        golden_heart:   { name: 'Golden Heart',       desc: 'A heart forged in pure gold. Coins flow more abundantly.',        bonus: '+25% coins' },
        shard_magnet:   { name: 'Shard Magnet',       desc: 'Draws fragments from the depths. Chests yield more.',             bonus: '+1 fragment per chest' },
        cracked_lens:   { name: 'Cracked Lens',       desc: 'Even broken, it reveals the rarest ores.',                       bonus: '+30% rare blocks' },
        obsidian_claw:  { name: 'Obsidian Claw',      desc: 'Born in the depths. Blocks crumble under its pressure.',         bonus: '-15% block HP' },
        ancient_engine: { name: 'Ancient Engine',     desc: 'An ancient machine that digs tirelessly.',                       bonus: '+3 auto damage/sec' },
      },
      find: {
        fossil:  { name: 'Fossil',          desc: 'A bone petrified for millennia.' },
        crystal: { name: 'Blue Crystal',    desc: 'A crystal with azure reflections formed under pressure.' },
        coin:    { name: 'Ancient Coin',    desc: 'A coin from a long-forgotten civilization.' },
        relic:   { name: 'Relic',           desc: 'A broken vase from a bygone era.' },
        crown:   { name: 'Broken Crown',    desc: 'The crown of a long-forgotten king.' },
        tooth:   { name: 'Monster Tooth',   desc: 'A sharp tooth from an underground creature.' },
        map:     { name: 'Map Fragment',    desc: 'A piece of a map leading into the unknown.' },
        orb:     { name: 'Mysterious Orb',  desc: 'A sphere that seems to contain an entire galaxy.' },
      },
      shop: {
        gems_5:        { name: '5 Gems',           label: 'Small pouch' },
        gems_20:       { name: '20 Gems',          label: 'Gem bag' },
        gems_60:       { name: '60 Gems',          label: 'Gem chest' },
        skin_golden:   { name: 'Golden Pickaxe',   label: 'Golden aura on the block' },
        skin_diamond:  { name: 'Diamond Pickaxe',  label: 'Blue aura on the block' },
        boost_x3:      { name: '×3 Coins Boost',   label: '×3 coins for 30 min' },
        badge_popular:    'Popular',
        badge_best_value: 'Best value',
        section_gems:     '💎 Gems',
        section_skins:    '⛏ Pickaxe Skins',
        section_boosts:   '⚡ Boosts',
        balance_label:    'Current balance',
        disclaimer:       'Demo mode · No real purchases will be made',
        btn_owned:        '✓ Owned',
      },
      ui: {
        btn_upgrade:          'Upgrade',
        btn_max:              'MAX',
        btn_claim:            'Claim reward',
        btn_mission_claim:    'Claim',
        btn_collect:          'Collect!',
        btn_unlock:           'Unlock',
        btn_watch_ad:         'Double the reward',
        btn_skip_ad:          'Skip ✕',
        btn_close_ad:         'Collect bonus →',
        btn_reset:            'Reset game',
        confirm_reset:        'Reset the game?\nAll coins, gems, upgrades, relics, quests, finds and the daily streak will be lost.',
        block_reward:         'Reward: 💰\u202f{amount}',
        hp_text:              '{hp}\u202f/\u202f{maxHp} HP',
        ad_cooldown:          'Available in {min}:{sec}',
        quest_claimed:        '✓ Claimed',
        relic_unlocked_badge: '✓ Unlocked',
        relic_shortfall:      '(missing\u202f{n})',
        relic_cost:           '🔮\u202f{n} fragment{s}',
        collection_header:    '{found}\u202f/\u202f{total} found',
        relic_header:         '{count}\u202f/\u202f{total} unlocked\u2002—\u2002🔮\u202f{frags} fragment{s}',
        mission_reward:       'Reward:',
        mission_claimed:      '✓ Claimed',
        mission_progress:     '{done}\u202f/\u202f{target}',
        saved:                'Saved ✓',
        daily_title:          'Daily login',
        daily_streak_day:     'Day {n} of 7',
        daily_btn_claim:      'Claim reward',
        daily_claimed_msg:    '✓ Reward claimed!',
        daily_next_msg:       'Come back tomorrow to continue your streak.',
        boost_active:         '⚡ ×{mult} coins bonus active',
        boost_remaining:      '— {min}:{sec} left',
        chest_title:          '{name} opened!',
        chest_content_label:  'Contents',
        chest_reward_coins:   '💰 {amount} coins',
        chest_reward_relics:  '🔮 {amount} relic fragment{s}',
        chest_reward_boost:   '⚡ Boost ×{mult} coins — {minutes} min',
        offline_title:        'While you were away…',
        offline_duration:     'Away for\u202f{dur}',
        offline_duration_cap: 'Away for\u202f{full} (capped at {capped})',
        offline_reward:       '💰 +{coins} coins',
        section_objectives:   '🎯 Quests',
        section_missions:     '🎯 Daily missions',
        section_relics:       '🔮 Relics',
        view_upgrades:        '⚙ Upgrades',
        view_collection:      '📦 Collection',
        view_daily:           '📅 Daily',
        view_shop:            '🛒 Shop',
      },
      notif: {
        ad_bonus:        '+{amount} 💰 ad bonus!',
        daily_reward:    'Day {day}: {parts}!',
        mission_done:    'Mission: {parts}!',
        quest_done:      '{name} completed!',
        find_drop:       '{name} found!',
        relic_unlocked:  '{name} unlocked!',
        skin_activated:  'Skin activated!',
        boost_activated: 'Boost ×{mult} active!',
        gems_added:      '💎 +{amount}',
        chest_float:     '📦 CHEST!',
        gem_float:       '✨ GEM!',
        coin_float:      '+{amount} 💰',
        damage_float:    '-{amount}',
        shop_gems:       '💎 +{amount}',
        shop_skin:       '✨ Skin activated!',
        shop_boost:      '⚡ Boost ×{mult} active!',
      },
    },

    /* ══════════════════════════════════════════════════════════════════════ */
    nl: {
      nav: {
        dig: 'Graven', upgrades: 'Verbeter.', collection: 'Collectie',
        daily: 'Dagelijks', shop: 'Winkel',
        dig_aria: 'Graven', upgrades_aria: 'Verbeteringen',
        collection_aria: 'Collectie', daily_aria: 'Dagelijkse beloning',
        shop_aria: 'Winkel',
      },
      stats: {
        coins: 'Munten', gems: 'Edelst.', depth: 'Diepte',
        pickaxe: 'Houweel', damage: 'Schade', relics: 'Reliek.',
        depth_val: '{n}m', pickaxe_val: 'Nv.{n}',
      },
      rarity: {
        commun: 'Gewoon', peu_commun: 'Ongewoon', rare: 'Zeldzaam',
        epique: 'Episch', legendaire: 'Legendarisch',
      },
      block: {
        terre_meuble: 'Losse aarde', argile: 'Klei',
        pierre: 'Steen', gres: 'Zandsteen', granite: 'Graniet',
        charbon: 'Steenkool', minerai_fer: 'IJzererts', minerai_or: 'Gouderts',
        vieille_caisse: 'Oude kist', coffre_bois: 'Houten kist', coffre_fer: 'IJzeren kist',
        rubis: 'Robijn', emeraude: 'Smaragd', diamant: 'Diamant',
      },
      upgrade: {
        pickaxe:  { name: 'Houweel',      desc: '{damage} schade per klik', },
        luck:     { name: 'Geluk',        desc_none: 'Geen zeldzaamheidsbonus', desc: '+{pct}% kans op zeldzame blokken', },
        bag:      { name: 'Tas',          desc_normal: 'Normale beloningen', desc: 'Beloningen ×{mult}', },
        autodig:  { name: 'Auto-graven',  desc_off: 'Inactief', desc: '{dmg} automatische schade/sec', },
      },
      quest: {
        break10:  { name: 'Eerste slag',   desc: '10 blokken breken' },
        depth25:  { name: 'Verkenner',     desc: 'Diepte 25m bereiken' },
        coins100: { name: 'Eerste schat',  desc: '100 munten verdienen' },
        find_gem: { name: 'Edelsteen!',    desc: 'Een edelsteenblok vinden' },
        upgrade5: { name: 'Vakman',        desc: '5 verbeteringen kopen' },
      },
      mission: {
        break_blocks:  { name: 'Breker',       desc: '{t} blokken breken' },
        earn_coins:    { name: 'Spaarder',      desc: '{t} munten verdienen' },
        open_chests:   { name: 'Schatzoeker',  desc: '{t} kist{s} openen' },
        buy_upgrades:  { name: 'Knutselaar',   desc: '{t} verbetering{s} kopen' },
        find_gems:     { name: 'Gemmoloog',    desc: '{t} edelsteen{s} vinden' },
        depth_gain:    { name: 'Dagverkenner', desc: '{t} m dieper graven' },
      },
      relic: {
        eye_of_miner:   { name: 'Oog van de mijnwerker', desc: 'De visie van een legendarische mijnwerker. Elke slag treft harder.',    bonus: '+2 schade per klik' },
        golden_heart:   { name: 'Gouden hart',            desc: 'Een hart gesmeed uit puur goud. Munten vloeien overvloediger.',         bonus: '+25% munten' },
        shard_magnet:   { name: 'Schervenagneet',         desc: 'Trekt scherven aan vanuit de diepte. Kisten geven er meer.',            bonus: '+1 scherf per kist' },
        cracked_lens:   { name: 'Gebarsten lens',         desc: 'Zelfs gebroken onthult het de zeldzaamste ertsen.',                    bonus: '+30% zeldzame blokken' },
        obsidian_claw:  { name: 'Obsidianen klauw',       desc: 'Geboren in de diepte. Blokken verkruimelen onder zijn druk.',          bonus: '-15% HP van blokken' },
        ancient_engine: { name: 'Antieke motor',          desc: 'Een oeroud machine die onvermoeibaar graaft.',                          bonus: '+3 auto schade/sec' },
      },
      find: {
        fossil:  { name: 'Fossiel',          desc: 'Een bot versteend over millennia.' },
        crystal: { name: 'Blauw kristal',    desc: 'Een kristal met azuurblauwe reflecties gevormd onder druk.' },
        coin:    { name: 'Oude munt',         desc: 'Een munt van een allang vergeten beschaving.' },
        relic:   { name: 'Relikwie',          desc: "Een gebroken vaas uit een vervlogen tijdperk." },
        crown:   { name: 'Gebroken kroon',    desc: 'De kroon van een allang vergeten koning.' },
        tooth:   { name: 'Monstertand',       desc: 'Een scherpe tand van een ondergronds wezen.' },
        map:     { name: 'Kaartfragment',     desc: 'Een stuk kaart dat naar het onbekende leidt.' },
        orb:     { name: 'Mysterieuze bol',   desc: 'Een bol die een hele sterrenstelsel lijkt te bevatten.' },
      },
      shop: {
        gems_5:        { name: '5 Edelstenen',      label: 'Klein zakje' },
        gems_20:       { name: '20 Edelstenen',     label: 'Zak edelstenen' },
        gems_60:       { name: '60 Edelstenen',     label: 'Kist edelstenen' },
        skin_golden:   { name: 'Gouden houweel',    label: 'Gouden aura op het blok' },
        skin_diamond:  { name: 'Diamanten houweel', label: 'Blauwe aura op het blok' },
        boost_x3:      { name: '×3 Munten boost',   label: '×3 munten gedurende 30 min' },
        badge_popular:    'Populair',
        badge_best_value: 'Beste waarde',
        section_gems:     '💎 Edelstenen',
        section_skins:    '⛏ Houweel skins',
        section_boosts:   '⚡ Boosts',
        balance_label:    'Huidig saldo',
        disclaimer:       'Demomodus · Er worden geen echte aankopen gedaan',
        btn_owned:        '✓ In bezit',
      },
      ui: {
        btn_upgrade:          'Verbeteren',
        btn_max:              'MAX',
        btn_claim:            'Beloning claimen',
        btn_mission_claim:    'Claimen',
        btn_collect:          'Ophalen!',
        btn_unlock:           'Ontgrendelen',
        btn_watch_ad:         'Beloning verdubbelen',
        btn_skip_ad:          'Overslaan ✕',
        btn_close_ad:         'Bonus ophalen →',
        btn_reset:            'Spel resetten',
        confirm_reset:        'Spel resetten?\nAlle munten, edelstenen, verbeteringen, relikwieën, doelen, vondsten en de dagelijkse reeks gaan verloren.',
        block_reward:         'Beloning: 💰\u202f{amount}',
        hp_text:              '{hp}\u202f/\u202f{maxHp} HP',
        ad_cooldown:          'Beschikbaar over {min}:{sec}',
        quest_claimed:        '✓ Geclaimd',
        relic_unlocked_badge: '✓ Ontgrendeld',
        relic_shortfall:      '(tekort\u202f{n})',
        relic_cost:           '🔮\u202f{n} scherf{s}',
        collection_header:    '{found}\u202f/\u202f{total} gevonden',
        relic_header:         '{count}\u202f/\u202f{total} ontgrendeld\u2002—\u2002🔮\u202f{frags} scherf{s}',
        mission_reward:       'Beloning:',
        mission_claimed:      '✓ Geclaimd',
        mission_progress:     '{done}\u202f/\u202f{target}',
        saved:                'Opgeslagen ✓',
        daily_title:          'Dagelijkse aanmelding',
        daily_streak_day:     'Dag {n} van 7',
        daily_btn_claim:      'Beloning claimen',
        daily_claimed_msg:    '✓ Beloning geclaimd!',
        daily_next_msg:       'Kom morgen terug om je reeks voort te zetten.',
        boost_active:         '⚡ ×{mult} munten bonus actief',
        boost_remaining:      '— {min}:{sec} resterend',
        chest_title:          '{name} geopend!',
        chest_content_label:  'Inhoud',
        chest_reward_coins:   '💰 {amount} munten',
        chest_reward_relics:  '🔮 {amount} relikwiescherf{s}',
        chest_reward_boost:   '⚡ Boost ×{mult} munten — {minutes} min',
        offline_title:        'Terwijl je weg was…',
        offline_duration:     'Weg voor\u202f{dur}',
        offline_duration_cap: 'Weg voor\u202f{full} (beperkt tot {capped})',
        offline_reward:       '💰 +{coins} munten',
        section_objectives:   '🎯 Doelen',
        section_missions:     '🎯 Dagelijkse missies',
        section_relics:       '🔮 Relikwieën',
        view_upgrades:        '⚙ Verbeteringen',
        view_collection:      '📦 Collectie',
        view_daily:           '📅 Dagelijks',
        view_shop:            '🛒 Winkel',
      },
      notif: {
        ad_bonus:        '+{amount} 💰 advertentiebonus!',
        daily_reward:    'Dag {day}: {parts}!',
        mission_done:    'Missie: {parts}!',
        quest_done:      '{name} voltooid!',
        find_drop:       '{name} gevonden!',
        relic_unlocked:  '{name} ontgrendeld!',
        skin_activated:  'Skin geactiveerd!',
        boost_activated: 'Boost ×{mult} actief!',
        gems_added:      '💎 +{amount}',
        chest_float:     '📦 KIST!',
        gem_float:       '✨ EDELSTEEN!',
        coin_float:      '+{amount} 💰',
        damage_float:    '-{amount}',
        shop_gems:       '💎 +{amount}',
        shop_skin:       '✨ Skin geactiveerd!',
        shop_boost:      '⚡ Boost ×{mult} actief!',
      },
    },

  }; // fin T

  // ── Résolution de clé ──────────────────────────────────────────────────────

  function _resolve(key, lang) {
    return key.split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), T[lang]);
  }

  // ── API publique ───────────────────────────────────────────────────────────

  function init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && T[saved]) _current = saved;
    _applyAttr();

    // Liaison des boutons du sélecteur (DOM déjà prêt au moment de l'appel)
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => setLang(btn.dataset.lang));
    });
  }

  function setLang(lang) {
    if (!T[lang] || lang === _current) return;
    _current = lang;
    localStorage.setItem(STORAGE_KEY, lang);
    _applyAttr();
    applyTranslations();
    _callbacks.forEach(fn => fn(lang));
  }

  function getCurrent() { return _current; }

  /** Traduit une clé avec interpolation de variables.
   *  Ex : t('ui.hp_text', { hp: 10, maxHp: 30 }) → "10 / 30 HP"  */
  function t(key, params = {}) {
    const str = _resolve(key, _current) ?? _resolve(key, 'fr') ?? key;
    if (typeof str !== 'string') return key;
    return str.replace(/\{(\w+)\}/g, (_, k) => (k in params ? params[k] : `{${k}}`));
  }

  /** Remplit tous les éléments [data-i18n], [data-i18n-aria], [data-i18n-placeholder]. */
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      el.setAttribute('aria-label', t(el.dataset.i18nAria));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
  }

  function onLangChange(fn) { _callbacks.push(fn); }

  function _applyAttr() {
    document.documentElement.lang = _current;
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === _current);
    });
  }

  return { init, setLang, getCurrent, t, applyTranslations, onLangChange };

})();

/** Raccourci global — utilisable partout dans le projet. */
function t(key, params) { return I18n.t(key, params); }
