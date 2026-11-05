/**
 * server/chestVisuals.js — visuels des six coffres dans l'atelier d'icônes (#66).
 *
 * Six cibles stables, nommées, jamais renommées :
 *   - coffres de la BOUTIQUE : cible `chest:<id>` de l'atelier (simple, rare, antique). Pas de catalogue :
 *     comme un pictogramme d'interface (#67), l'image appliquée (après confirmation explicite) est servie
 *     au jeu par GET /api/ui-icons sous l'identifiant `chest_<id>` ; sans image, le jeu garde son emoji ;
 *   - coffres trouvés EN MINANT : ce sont des blocs du catalogue (#37), cible `block:<id>` de l'atelier,
 *     appliquée au brouillon du catalogue de blocs puis publiée dans 🧱 Blocs (cycle inchangé).
 *
 * Aucun prix, aucune table ni probabilité ici : seul le visuel change (tables : rewardTables.js, #37).
 * Consigne par défaut en anglais (comme les autres cibles), modifiable dans l'atelier.
 */
'use strict';

const SHOP_CHEST_VISUALS = [
  { id: 'simple', emoji: '📦', names: { fr: 'Coffre simple', en: 'Simple chest' },
    where: 'carte « Coffre simple » de la boutique et fenêtre d\'ouverture',
    subject: 'A small plain closed wooden treasure chest',
    details: 'Simple light wooden planks with plain iron corner brackets and a small latch; modest, clearly the cheapest chest.',
    palette: 'Palette: light warm wood, dull gray iron.' },
  { id: 'rare', emoji: '💎', names: { fr: 'Coffre rare', en: 'Rare chest' },
    where: 'carte « Coffre rare » de la boutique et fenêtre d\'ouverture',
    subject: 'A closed treasure chest reinforced with polished steel bands and a blue gem set in its lock',
    details: 'Dark varnished wood, bright steel bands, a single glowing blue gem on the lock plate; clearly more precious than a plain wooden chest.',
    palette: 'Palette: dark wood, polished steel, vivid sapphire blue.' },
  { id: 'antique', emoji: '🏺', names: { fr: 'Coffre antique', en: 'Antique chest' },
    where: 'carte « Coffre antique » de la boutique et fenêtre d\'ouverture',
    subject: 'An ancient ornate closed treasure chest with gold filigree and engraved stone panels',
    details: 'Heavy old chest with a domed lid, carved gold ornaments and worn ancient engravings, faint warm glow at the seam; the most precious chest.',
    palette: 'Palette: aged bronze and gold, weathered dark stone, warm amber glow.' },
];

/** Coffres trouvés en minant : bloc du catalogue (id) et rareté de leur table de récompenses (#37). */
const MINED_CHEST_BLOCKS = [
  { id: 'vieille_caisse', rarity: 'commun', name: 'Vieille caisse' },
  { id: 'coffre_bois',    rarity: 'rare',   name: 'Coffre en bois' },
  { id: 'coffre_fer',     rarity: 'epique', name: 'Coffre en fer' },
];

/** Identifiant servi au jeu (GET /api/ui-icons, `UiIcons.html(id, emoji)`) pour un coffre de la boutique. */
const gameIconId = id => `chest_${id}`;

/** Les six cibles de l'atelier, dans l'ordre de l'onglet Coffres & drops. */
const CHEST_TARGETS = [
  ...SHOP_CHEST_VISUALS.map(c => ({ family: 'shop', id: c.id, key: `chest:${c.id}`, name: c.names.fr })),
  ...MINED_CHEST_BLOCKS.map(b => ({ family: 'mined', id: b.rarity, key: `block:${b.id}`, name: b.name })),
];

module.exports = { SHOP_CHEST_VISUALS, MINED_CHEST_BLOCKS, CHEST_TARGETS, gameIconId };
