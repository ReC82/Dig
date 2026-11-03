#!/usr/bin/env node
/**
 * economy-sim.js — audit chiffré de l'économie (ticket #49) : pièces, gemmes, fragments, coffres.
 *
 * Simule des saisons complètes (7 jours) avec le VRAI code et les VRAIES valeurs du jeu :
 *   - public/js/balance.js, blocks.js, chests.js, relics.js, daily.js, dailyMissions.js, quests.js
 *     chargés dans un contexte vm (coûts, tables de coffres de la mine, reliques, récompenses
 *     quotidiennes, missions du jour générées pour la vraie date) ;
 *   - catalogue de blocs publié en production (v3 = 14 blocs d'origine + 8 minerais de l'étape B,
 *     server/blockCatalog.js) appliqué par Blocks.applyCatalog, probabilités Blocks.blockOdds ;
 *   - coffres de la boutique de saison : tables de server/chestShop.js, coûts et multiplicateurs
 *     de server/economy.js avec les réglages admin de production relevés le 03/11/2026
 *     (PROD_CONFIG ; --config fichier.json pour en essayer d'autres).
 * Aucun accès réseau ni base de données. Hasard à graine (mulberry32) : mêmes options → mêmes
 * chiffres.
 *
 * Modèle de temps (reproduit main.js) : clics réguliers à `cps` (dégâts = pioche + Œil du
 * mineur), Auto-Dig = un coup par seconde, 0,35 s d'animation par bloc détruit, popup bloquante
 * sur un coffre de la mine (1,5 s en jeu actif ; onglet ouvert sans joueur : l'Auto-Dig attend
 * le prochain passage du joueur). Gains hors ligne de main.js (computeOfflineGains, 4 h max).
 * Bouton « bonus » (pub simulée, ×2 pendant 2 min toutes les 5 min) si `ad: true`.
 * Le temps de rupture d'un bloc est calculé directement (dégâts/s), pas clic par clic.
 *
 * Lancer : node tools/balance/economy-sim.js               (rapport Markdown, 10 000 saisons/profil)
 *          node tools/balance/economy-sim.js --runs 500    (plus rapide)
 *          node tools/balance/economy-sim.js --json        (résultats bruts)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const { getEconomy } = require(path.join(ROOT, 'server', 'economy'));
const { SHOP_CHESTS } = require(path.join(ROOT, 'server', 'chestShop'));
const blockCatalog = require(path.join(ROOT, 'server', 'blockCatalog'));

/** Réglages économiques de admin_config en production, relevés le 03/11/2026 (lecture seule). */
const PROD_CONFIG = {
  chest_cost_simple: '800', chest_cost_rare: '15000', chest_cost_antique: '80000',
  upgrade_cost_multiplier: '1', coin_gain_multiplier: '1', fragment_drop_multiplier: '1',
  gems_cap: '100',
};

const BREAK_ANIM_S   = 0.35;       // #block.anim-break (style.css)
const CHEST_POPUP_S  = 1.5;        // clic « Récupérer » en jeu actif
const OFFLINE_MAX_S  = 4 * 3600;   // computeOfflineGains (main.js)
const AD_COOLDOWN_S  = 300;        // Monetization.AD_COOLDOWN_MS
const AD_BOOST       = { mult: 2, seconds: 120 };
const SEASON_DAYS    = 7;
const CHEST_RATE_PER_MIN = 30;     // server/rateLimits.js : RATE_CHEST_MAX (ouvertures / min / compte)
const DAY_S          = 86_400;

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Chargement du vrai code du jeu ───────────────────────────────────────────

/** Charge les scripts du navigateur et applique le catalogue de blocs publié en production. */
function loadGame() {
  const GameState = {
    upgrades: { luck: 0 }, relicBonuses: {}, stats: {}, depth: 1, gems: 0, quests: {},
    dailyMissions: { date: null, missions: [], baselineStats: null }, daily: {},
  };
  const ctx = vm.createContext({ Math, Object, Array, Number, String, Set, JSON, Date, GameState, t: k => k });
  for (const f of ['balance.js', 'blocks.js', 'chests.js', 'relics.js', 'daily.js', 'dailyMissions.js', 'quests.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  const g = vm.runInContext('({ Balance, Blocks, Chests, Relics, Daily, DailyMissions, Quests })', ctx);
  const types = [...blockCatalog.originTypes(), ...blockCatalog.STEP_B_TYPES];
  if (!g.Blocks.applyCatalog({ version: 3, types })) throw new Error('catalogue v3 refusé par Blocks.applyCatalog');
  return { ...g, GameState };
}

const G = loadGame();
const RELIC = Object.fromEntries(G.Relics.DEFS.map(d => [d.id, d]));

// ── Règles économiques (actuelles, ou variante proposée) ─────────────────────

/**
 * Règles actuelles, lues dans le code du jeu. Une variante (VARIANTS) n'en remplace que
 * certains champs ; rien n'est modifié dans le jeu.
 */
function currentRules(config = PROD_CONFIG) {
  return {
    id: 'actuel',
    economy: getEconomy(config),
    gemsCap: parseInt(config.gems_cap ?? '100', 10),
    /** Gemmes d'un bloc détruit (id → nombre) ; actuel : 1 par bloc `isGem` (gemReward ≠ false). */
    gemsPerBlock: Object.fromEntries(G.Blocks.TYPES.filter(t => t.isGem).map(t => [G.Blocks.idOf(t), 1])),
    /** Gemmes en plus dans un coffre de la mine : { rareté: { p, gems } } ; actuel : aucune. */
    mineChestGems: {},
    dailyGems: G.Daily.REWARDS.map(r => r.gems),
    /** Gemmes en plus quand les 3 missions du jour sont réussies (actuel : 0). */
    missionSetGems: 0,
    /** Gemmes d'une mission réussie : fonction réelle de dailyMissions.js (rewardFn). */
    missionGems: (def, target) => def.rewardFn(target).gems,
    questGems: G.Quests.DEFS.reduce((s, q) => s + (q.reward.gems || 0), 0),
    autodigCosts: G.Balance.AUTODIG.map(c => ({ ...c })),
  };
}

/**
 * Deux barèmes proposés (#49), présentés au propriétaire ; AUCUN n'est appliqué au jeu.
 * Prix de boutique associés : rapport docs/claude-reports/2026-11-03_ticket-49-audit-economie.md.
 */
const VARIANTS = {
  A: rules => ({
    ...rules, id: 'A',
    // Toutes les gemmes rapportent, selon leur rareté (saphir, améthyste, cristal : 0 → 1–3)
    gemsPerBlock: { rubis: 1, saphir: 1, emeraude: 2, amethyste: 2, diamant: 3, cristal_ancien: 3 },
    mineChestGems: { epique: { p: 0.10, gems: 1 } },
    missionSetGems: 1,
    gemsCap: 150,
  }),
  B: rules => ({
    ...rules, id: 'B',
    gemsPerBlock: { rubis: 2, saphir: 2, emeraude: 3, amethyste: 3, diamant: 5, cristal_ancien: 5 },
    mineChestGems: { commun: { p: 0.02, gems: 1 }, rare: { p: 0.06, gems: 1 }, epique: { p: 0.15, gems: 2 } },
    dailyGems: [1, 1, 2, 1, 3, 1, 6],
    missionSetGems: 2,
    gemsCap: 250,
    // Plus de gemmes en circulation → Auto-Dig en gemmes recalibré (même temps de jeu visé)
    autodigCosts: [{ coins: 800, gems: 0 }, { coins: 3_000, gems: 0 },
      { coins: 0, gems: 6 }, { coins: 0, gems: 14 }, { coins: 0, gems: 30 }, { coins: 0, gems: 60 }],
  }),
};

// ── Profils de joueurs ───────────────────────────────────────────────────────

/**
 * activeMin : minutes de jeu actif par jour joué ; cps : clics/s ; idleMin : minutes d'onglet
 * ouvert sans joueur (Auto-Dig seul), avec un passage toutes les `idleCheckMin` minutes ;
 * sessions : connexions par jour (gains hors ligne entre deux) ; days : jours joués sur 7.
 * chests : 'none' | 'convert' (fin de saison : pièces restantes → coffres de la boutique, au plus
 * `convertChests` ouvertures, par défaut 1 h au rythme maximal autorisé de 30 / min = 1 800).
 */
const PROFILES = {
  debutant:  { label: 'Débutant (20 min/j, 4 j/7)',          activeMin: 20,  cps: 4, idleMin: 0,   idleCheckMin: 10, sessions: 1, days: [0, 2, 4, 5], ad: false, chests: 'none' },
  regulier:  { label: 'Régulier (1 h/j, 7 j/7, bonus pub)',   activeMin: 60,  cps: 5, idleMin: 60,  idleCheckMin: 10, sessions: 2, days: [0, 1, 2, 3, 4, 5, 6], ad: true, chests: 'none' },
  assidu:    { label: 'Assidu (3 h/j + 4 h onglet ouvert)',  activeMin: 180, cps: 6, idleMin: 240, idleCheckMin: 15, sessions: 3, days: [0, 1, 2, 3, 4, 5, 6], ad: true, chests: 'convert' },
  auto:      { label: 'Automatique (15 min/j + 8 h onglet)', activeMin: 15,  cps: 4, idleMin: 480, idleCheckMin: 20, sessions: 3, days: [0, 1, 2, 3, 4, 5, 6], ad: false, chests: 'none' },
};

// ── Tirage rapide des blocs (probabilités exactes de Blocks.blockOdds, mises en cache) ──

const _oddsCache = new Map();   // `${luck}|${luckPct}` → tableau indexé par la profondeur

/** Table cumulée des types (avec Chance) et des PV (sans Chance) à cette profondeur. */
function oddsAt(depth, luck, luckPct) {
  const key = `${luck}|${luckPct}`;
  let byDepth = _oddsCache.get(key);
  if (!byDepth) { byDepth = []; _oddsCache.set(key, byDepth); }
  let o = byDepth[depth];
  if (o) return o;
  G.GameState.relicBonuses = { luckPct };
  const build = list => {
    const types = list.map(e => e.type);
    let s = 0;
    const cum = list.map(e => (s += e.p));
    return { types, cum };
  };
  const typeOdds = G.Blocks.blockOdds(depth, luck);
  const pool = G.Blocks._pool(depth, 1);
  const total = pool.reduce((a, e) => a + e.w, 0);
  o = { type: build(typeOdds), hp: build(pool.map(e => ({ type: e.type, p: e.w / total }))) };
  byDepth[depth] = o;
  return o;
}

function sample(table, r) {
  const x = r * table.cum[table.cum.length - 1];
  const { cum } = table;
  for (let i = 0; i < cum.length; i++) if (x <= cum[i]) return table.types[i];
  return table.types[table.types.length - 1];
}

function pickRow(table, random) {
  const total = table.reduce((s, r) => s + r.weight, 0);
  let x = random() * total;
  for (const row of table) { x -= row.weight; if (x <= 0) return row; }
  return table[table.length - 1];
}

const randInt = (min, max, random) => min + Math.floor(random() * (max - min + 1));

// ── Joueur ───────────────────────────────────────────────────────────────────

function relicValue(p, id) {
  const lvl = p.relics[id] || 0;
  return lvl ? RELIC[id].bonus.values[lvl - 1] : 0;
}

/** Nouveau joueur (ressources permanentes : gemmes plafonnées, fragments, reliques). */
function newPlayer() {
  return { gems: 0, frags: 0, relics: {}, quests: false, streak: 0, lastDay: -99, collected: {} };
}

function newSeason(p) {
  return {
    coins: 0, depth: 1, pick: 1, luck: 0, bag: 0, auto: 0, shop: 0,
    boost: { mult: 1, until: 0 }, adNext: 0,
    stats: { blocks: 0, coinsEarned: 0, chests: 0, gemsFound: 0, upgrades: 0 },
    m: {
      coinsEarned: 0, maxDepth: 1, activeS: 0, idleS: 0,
      gems: { blocks: 0, mineChests: 0, daily: 0, missions: 0, quest: 0 }, gemsSpent: 0, gemsLostCap: 0,
      frags: { mineChests: 0, fragmentShop: 0, shopChests: 0 }, fragsSpent: 0,
      coins: { blocks: 0, mineChests: 0, offline: 0, daily: 0, missions: 0, quest: 0, shopChests: 0 },
      autodigAt: [null, null, null, null, null, null],   // heures de jeu (actif + onglet) au déblocage
      maxedAt: null,                                     // heures de jeu : toutes les améliorations en pièces au maximum
      shopChestsBought: 0,
    },
    gemsStart: p.gems,
  };
}

/** Achète des reliques avec les fragments : le niveau le moins cher d'abord (permanentes). */
function spendFragments(p, s) {
  for (;;) {
    let best = null;
    for (const d of G.Relics.DEFS) {
      const lvl = p.relics[d.id] || 0;
      if (lvl >= d.maxLevel) continue;
      const c = d.costs[lvl];
      if (c <= p.frags && (!best || c < best.c)) best = { id: d.id, c };
    }
    if (!best) return;
    p.frags -= best.c;
    s.m.fragsSpent += best.c;
    p.relics[best.id] = (p.relics[best.id] || 0) + 1;
  }
}

/**
 * Réinvestissement : l'amélioration la moins chère parmi pioche, Sac, Chance, Auto-Dig et
 * boutique de fragments ; l'Auto-Dig en gemmes est acheté dès que les gemmes suffisent (seul
 * usage des gemmes en jeu). `o.noGemAutodig` : ne dépense jamais de gemmes.
 */
function buyUpgrades(p, s, rules, o, playedS) {
  const B = G.Balance;
  const mult = rules.economy.upgradeCostMultiplier;
  const scale = c => (c > 0 ? Math.ceil(c * mult) : c);
  for (;;) {
    // Sortie rapide (appelé après chaque bloc) : rien d'abordable en pièces ni en gemmes
    const a0 = rules.autodigCosts[s.auto];
    const cheapest = Math.min(
      s.pick < 15 ? scale(B.PICKAXE[s.pick - 1]) : Infinity,
      s.bag < 12 ? scale(B.BAG[s.bag]) : Infinity,
      s.luck < (o.luckTarget ?? 12) ? scale(B.LUCK[s.luck]) : Infinity,
      s.shop < 10 ? scale(B.FRAGMENT_SHOP[s.shop]) : Infinity,
      a0 && a0.gems === 0 ? scale(a0.coins) : Infinity);
    if (cheapest > s.coins && !(a0 && a0.gems > 0 && a0.gems <= p.gems && !o.noGemAutodig)) return;
    const offers = [];
    if (s.pick < 15) offers.push({ k: 'pick', c: scale(B.PICKAXE[s.pick - 1]), g: 0 });
    if (s.bag < 12)  offers.push({ k: 'bag',  c: scale(B.BAG[s.bag]), g: 0 });
    if (s.luck < (o.luckTarget ?? 12)) offers.push({ k: 'luck', c: scale(B.LUCK[s.luck]), g: 0 });
    if (s.auto < 6) {
      const a = rules.autodigCosts[s.auto];
      if (!(a.gems > 0 && o.noGemAutodig)) offers.push({ k: 'auto', c: scale(a.coins), g: a.gems });
    }
    if (s.shop < 10) offers.push({ k: 'shop', c: scale(B.FRAGMENT_SHOP[s.shop]), g: 0 });
    let best = null;
    for (const x of offers) {
      if (x.c > s.coins || x.g > p.gems) continue;
      if (!best || x.c < best.c) best = x;
    }
    if (!best) return;
    s.coins -= best.c;
    p.gems  -= best.g;
    s.m.gemsSpent += best.g;
    s.stats.upgrades++;
    if (best.k === 'pick') s.pick++;
    else if (best.k === 'bag') s.bag++;
    else if (best.k === 'luck') s.luck++;
    else if (best.k === 'auto') { s.m.autodigAt[s.auto] = playedS / 3600; s.auto++; }
    else { s.shop++; p.frags++; s.m.frags.fragmentShop++; spendFragments(p, s); }
    if (s.m.maxedAt === null && s.pick >= 15 && s.bag >= 12 && s.luck >= 12 && s.shop >= 10 && s.auto >= 2) s.m.maxedAt = playedS / 3600;
  }
}

function setBoost(s, mult, seconds, now) {
  const active = s.boost.until > now;
  s.boost.mult  = active ? Math.max(s.boost.mult, mult) : mult;
  s.boost.until = (active ? s.boost.until : now) + seconds;
}

/**
 * Mine pendant `seconds` (clic à `cps` ou Auto-Dig seul si cps = 0). `now` : horloge de la
 * saison (s) pour les boosts. Coffre de la mine : popup de `chestWait()` secondes.
 */
function mine(p, s, rules, o, random, { seconds, cps, now, chestWait, ad, playedS0 }) {
  const end = now + seconds;
  let t = now;
  while (t < end) {
    if (ad && t >= s.adNext) { setBoost(s, AD_BOOST.mult, AD_BOOST.seconds, t); s.adNext = t + AD_COOLDOWN_S; }
    const luckPct = relicValue(p, 'cracked_lens');
    const odds = oddsAt(s.depth, s.luck, luckPct);
    const type = sample(odds.type, random());
    const hpType = sample(odds.hp, random());
    const hpRed = Math.min(0.9, relicValue(p, 'obsidian_claw'));
    const hp = Math.ceil(hpType.hpBase * (1 + (s.depth - 1) * 0.12) * (1 - hpRed));
    const damage = s.pick + relicValue(p, 'eye_of_miner');
    const autodig = s.auto + relicValue(p, 'ancient_engine');
    let dt;
    if (cps > 0) {
      const rate = damage * cps + autodig;
      dt = Math.max(1, Math.ceil(hp / rate * cps)) / cps;
    } else {
      if (autodig <= 0) return t - now;
      dt = Math.ceil(hp / autodig);
    }
    t += dt + BREAK_ANIM_S;
    if (t > end) break;                              // bloc non terminé à la fin de la séance
    s.depth++; s.stats.blocks++;
    if (s.depth > s.m.maxDepth) s.m.maxDepth = s.depth;
    const id = G.Blocks.idOf(type);
    if (type.isChest) {
      s.stats.chests++;
      const row = pickRow(G.Chests.TABLES[type.rarityKey] ?? G.Chests.TABLES.commun, random);
      if (row.type === 'coins') {
        const c = randInt(row.min, row.max, random);
        s.coins += c; s.stats.coinsEarned += c; s.m.coins.mineChests += c;
      } else if (row.type === 'relics') {
        const f = row.amount + relicValue(p, 'shard_magnet');
        p.frags += f; s.m.frags.mineChests += f; spendFragments(p, s);
      } else if (row.type === 'boost') setBoost(s, row.mult, row.minutes * 60, t);
      const extra = rules.mineChestGems[type.rarityKey];
      if (extra && random() < extra.p) { p.gems += extra.gems; s.m.gems.mineChests += extra.gems; }
      t += chestWait(t);
    } else {
      const reward = Math.ceil(type.reward * (1 + (s.depth - 2) * 0.05));
      const boost = s.boost.until > t ? s.boost.mult : 1;
      const mult = (1 + s.bag * 0.3) * (1 + relicValue(p, 'golden_heart')) * rules.economy.coinGainMultiplier;
      const c = Math.ceil(reward * mult * boost);
      s.coins += c; s.stats.coinsEarned += c; s.m.coins.blocks += c;
      if (type.isGem) s.stats.gemsFound++;
      const g = rules.gemsPerBlock[id] || 0;
      if (g) { p.gems += g; s.m.gems.blocks += g; }
    }
    if (!p.quests && s.stats.gemsFound >= 1) {     // objectif unique « Première gemme »
      p.quests = true;
      p.gems += rules.questGems; s.m.gems.quest += rules.questGems;
      s.coins += 200; s.m.coins.quest += 200;
    }
    if (!o.frozen) buyUpgrades(p, s, rules, o, playedS0 + (t - now));
  }
  return seconds;
}

/** Gains hors ligne de main.js (Auto-Dig requis), pour une absence de `seconds`. */
function offlineCoins(p, s, rules, seconds) {
  const dps = s.auto + relicValue(p, 'ancient_engine');
  if (dps === 0 || seconds < 60) return 0;
  const mult = (1 + s.bag * 0.3) * (1 + relicValue(p, 'golden_heart')) * rules.economy.coinGainMultiplier;
  const perMin = Math.max(1, Math.floor(dps * mult * 30));
  return Math.floor(perMin * (Math.min(seconds, OFFLINE_MAX_S) / 60));
}

/**
 * Coffres de la boutique (server/chestShop.rollChest, tirage à graine) jusqu'à épuisement des
 * pièces. Au-delà de BULK_CHESTS coffres achetables d'un coup, le lot est crédité à son espérance
 * exacte (même table, même formule de fragments) : des millions de pièces → des milliers de coffres.
 */
const BULK_CHESTS = 200;
function convertCoins(p, s, rules, random, maxChests) {
  const order = ['antique', 'simple'];
  let left = maxChests;
  for (const id of order) {
    const def = SHOP_CHESTS[id];
    const cost = rules.economy.chestCosts[id];
    let bought = 0;
    while (def.maxPerSeason === null && Math.min(left, Math.floor(s.coins / cost)) > BULK_CHESTS) {
      const k = Math.min(left, Math.floor(s.coins / cost));
      left -= k;
      const e = chestExpectation(def.table, relicValue(p, 'shard_magnet'), rules.economy.fragmentDropMultiplier, true);
      const f = Math.round(k * (e.frags + e.collection * 5));
      s.coins += Math.round(k * e.coins) - k * cost;
      s.m.coins.shopChests += Math.round(k * e.coins);
      bought += k; s.m.shopChestsBought += k;
      p.frags += f; s.m.frags.shopChests += f; spendFragments(p, s);
    }
    while (left > 0 && s.coins >= cost && (def.maxPerSeason === null || bought < def.maxPerSeason)) {
      s.coins -= cost; bought++; left--; s.m.shopChestsBought++;
      const row = pickRow(def.table, random);
      if (row.type === 'coins') { const c = randInt(row.min, row.max, random); s.coins += c; s.m.coins.shopChests += c; }
      else if (row.type === 'relics' || row.type === 'collection') {
        // Objet de collection : toutes les trouvailles d'origine sont supposées déjà possédées
        // (cas d'un joueur qui convertit en masse) → fragments de consolation (5, sans bonus)
        const f = row.type === 'relics'
          ? Math.max(1, Math.round((row.amount + relicValue(p, 'shard_magnet')) * rules.economy.fragmentDropMultiplier))
          : 5;
        p.frags += f; s.m.frags.shopChests += f; spendFragments(p, s);
      }
      // boost : sans effet, la saison se termine
    }
  }
}

/** Une saison de 7 jours. `seasonIndex` sert à la date des missions du jour. */
function playSeason(p, rules, o, random, seasonIndex) {
  const s = newSeason(p);
  let playedS = 0;
  let lastEnd = null;                               // fin de la dernière séance (horloge saison)
  const base0 = Date.UTC(2026, 10, 9) + seasonIndex * SEASON_DAYS * DAY_S * 1000;   // un lundi
  for (let day = 0; day < SEASON_DAYS; day++) {
    if (!o.days.includes(day)) continue;
    const absDay = seasonIndex * SEASON_DAYS + day;
    const dayStart = day * DAY_S + 8 * 3600;
    // Récompense quotidienne (daily.js) : série +1 si joué la veille, sinon retour au jour 1
    p.streak = p.lastDay === absDay - 1 ? (p.streak % 7) + 1 : 1;
    p.lastDay = absDay;
    const dr = G.Daily.REWARDS[p.streak - 1];
    const dGems = rules.dailyGems[p.streak - 1] || 0;
    p.gems += dGems; s.m.gems.daily += dGems;
    s.coins += dr.coins; s.m.coins.daily += dr.coins;
    // Missions du jour (vraie génération, même date pour tous les joueurs)
    const date = new Date(base0 + day * DAY_S * 1000).toISOString().slice(0, 10);
    const missions = G.DailyMissions._generate(date);
    const baseline = { ...s.stats, depth: s.depth };
    // Séances du jour : actif puis onglet ouvert, réparties en `sessions` connexions
    const activeS = o.activeMin * 60 / o.sessions;
    const idleS = o.idleMin * 60 / o.sessions;
    const gap = (DAY_S - (o.activeMin + o.idleMin) * 60) / o.sessions;
    let t = dayStart;
    for (let k = 0; k < o.sessions; k++) {
      if (lastEnd !== null) {
        const off = offlineCoins(p, s, rules, t - lastEnd);
        s.coins += off; s.m.coins.offline += off;
      }
      if (day === 5 && p.streak === 6 && k === 0) setBoost(s, 2, 300, t);   // jour 6 : ×2, 5 min
      if (o.dailyBoost && k === 0) setBoost(s, 2, 1800, t);                 // scénario : boost ×2 30 min acheté
      buyUpgrades(p, s, rules, o, playedS);
      mine(p, s, rules, o, random, { seconds: activeS, cps: o.cps, now: t, chestWait: () => CHEST_POPUP_S, ad: o.ad, playedS0: playedS });
      t += activeS; playedS += activeS; s.m.activeS += activeS;
      if (idleS > 0) {
        const check = o.idleCheckMin * 60;
        const wait = o.autoCollect ? () => CHEST_POPUP_S : () => random() * check;
        mine(p, s, rules, o, random, { seconds: idleS, cps: 0, now: t, chestWait: wait, ad: false, playedS0: playedS });
        t += idleS; playedS += idleS; s.m.idleS += idleS;
      }
      lastEnd = t;
      t += gap;
    }
    // Réclamation des missions réussies
    let done = 0;
    for (const m of missions) {
      const def = G.DailyMissions.getDef(m.id);
      const cur = def.statKey === 'depth' ? s.depth : s.stats[{ blocksDestroyed: 'blocks', totalCoinsEarned: 'coinsEarned',
        chestsFound: 'chests', totalUpgradesBought: 'upgrades', gemsFound: 'gemsFound' }[def.statKey]];
      const prev = def.statKey === 'depth' ? baseline.depth : baseline[{ blocksDestroyed: 'blocks', totalCoinsEarned: 'coinsEarned',
        chestsFound: 'chests', totalUpgradesBought: 'upgrades', gemsFound: 'gemsFound' }[def.statKey]];
      if (cur - prev < m.target) continue;
      done++;
      const g = rules.missionGems(def, m.target);
      p.gems += g; s.m.gems.missions += g;
      s.coins += m.reward.coins; s.m.coins.missions += m.reward.coins;
    }
    if (done === missions.length && rules.missionSetGems) { p.gems += rules.missionSetGems; s.m.gems.missions += rules.missionSetGems; }
    buyUpgrades(p, s, rules, o, playedS);
  }
  if (o.chests === 'convert') convertCoins(p, s, rules, random, o.convertChests ?? CHEST_RATE_PER_MIN * 60);
  // Fin de saison (server/index.js) : pièces et améliorations remises à zéro, gemmes plafonnées
  s.m.coinsEnd = s.coins;
  s.m.coinsEarned = Object.values(s.m.coins).reduce((a, b) => a + b, 0);
  s.m.gemsEarned = Object.values(s.m.gems).reduce((a, b) => a + b, 0);
  s.m.fragsEarned = Object.values(s.m.frags).reduce((a, b) => a + b, 0);
  s.m.gemsBeforeCap = p.gems;
  s.m.gemsLostCap = Math.max(0, p.gems - rules.gemsCap);
  p.gems = Math.min(p.gems, rules.gemsCap);
  s.m.levels = { pick: s.pick, luck: s.luck, bag: s.bag, auto: s.auto };
  s.m.relicLevels = Object.values(p.relics).reduce((a, b) => a + b, 0);
  s.m.playedH = playedS / 3600;
  return s.m;
}

// ── Statistiques ─────────────────────────────────────────────────────────────

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function describe(values) {
  const v = values.filter(x => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return { n: 0, share: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { n: v.length, share: v.length / values.length, mean, sd, p10: quantile(v, 0.1), p50: quantile(v, 0.5), p90: quantile(v, 0.9) };
}

/**
 * Simule `runs` joueurs sur `seasons` saisons consécutives (reliques et fragments conservés).
 * @returns {object[][]} métriques [joueur][saison]
 */
function simulatePlayers({ profile, rules, runs, seasons = 1, seed = 49, options = {} }) {
  const o = { ...profile, ...options };
  const out = [];
  for (let r = 0; r < runs; r++) {
    const random = rng(seed * 100_003 + r);
    const p = newPlayer();
    const list = [];
    for (let k = 0; k < seasons; k++) list.push(playSeason(p, rules, o, random, k));
    out.push(list);
  }
  return out;
}

/** Résumé d'une saison donnée sur tous les joueurs. */
function summarize(results, seasonIdx = 0) {
  const ms = results.map(l => l[seasonIdx]);
  const pick = f => describe(ms.map(f));
  const perH = (x, m) => (m.activeS + m.idleS > 0 ? x / ((m.activeS + m.idleS) / 3600) : 0);
  return {
    runs: ms.length,
    playedH: pick(m => m.playedH),
    maxDepth: pick(m => m.maxDepth),
    gemsEarned: pick(m => m.gemsEarned),
    gemsPerH: pick(m => perH(m.gemsEarned, m)),
    gemsBlocks: pick(m => m.gems.blocks), gemsDaily: pick(m => m.gems.daily),
    gemsMissions: pick(m => m.gems.missions), gemsQuest: pick(m => m.gems.quest), gemsChests: pick(m => m.gems.mineChests),
    gemsSpent: pick(m => m.gemsSpent),
    gemsEnd: pick(m => m.gemsBeforeCap), gemsLostCap: pick(m => m.gemsLostCap),
    fragsEarned: pick(m => m.fragsEarned), fragsPerH: pick(m => perH(m.fragsEarned, m)),
    fragsMine: pick(m => m.frags.mineChests), fragsShop: pick(m => m.frags.fragmentShop), fragsShopChests: pick(m => m.frags.shopChests),
    coinsEarned: pick(m => m.coinsEarned), coinsPerH: pick(m => perH(m.coinsEarned, m)),
    coinsOffline: pick(m => m.coins.offline), coinsEnd: pick(m => m.coinsEnd),
    shopChests: pick(m => m.shopChestsBought),
    autodigEnd: pick(m => m.levels.auto), pickEnd: pick(m => m.levels.pick), luckEnd: pick(m => m.levels.luck),
    relicLevels: pick(m => m.relicLevels),
    autodigAt: [2, 3, 4, 5].map(i => pick(m => m.autodigAt[i])),
    maxedAt: pick(m => m.maxedAt),
  };
}

/**
 * Une heure de jeu à équipement figé (aucun achat), `runs` échantillons : gains par heure à une
 * profondeur donnée. `e` : { depth, pick, luck, bag, auto, relics, cps, idle, rules }.
 */
function hourAt(e, runs, seed = 7) {
  const rules = e.rules ?? currentRules();
  const out = { meters: [], gems: [], frags: [], coins: [], chests: [] };
  for (let r = 0; r < runs; r++) {
    const random = rng(seed * 100_003 + r);
    const p = { ...newPlayer(), relics: { ...(e.relics ?? {}) }, quests: true };
    const s = newSeason(p);
    Object.assign(s, { depth: e.depth, pick: e.pick, luck: e.luck, bag: e.bag, auto: e.auto });
    s.m.maxDepth = e.depth;
    const o = { frozen: true };
    const fragsBefore = () => s.m.frags.mineChests;
    p.frags = -1e12;                                   // aucune relique achetée pendant l'heure
    mine(p, s, rules, o, random, {
      seconds: 3600, cps: e.idle ? 0 : e.cps, now: 0, ad: false, playedS0: 0,
      chestWait: e.idle ? () => random() * (e.idleCheckMin ?? 10) * 60 : () => CHEST_POPUP_S,
    });
    out.meters.push(s.depth - e.depth);
    out.gems.push(s.m.gems.blocks + s.m.gems.mineChests);
    out.frags.push(fragsBefore());
    out.coins.push(s.m.coins.blocks + s.m.coins.mineChests);
    out.chests.push(s.stats.chests);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, describe(v)]));
}

/** Équipements de référence (dont celui de la capture du propriétaire à ~122 m). */
const FIXED = [
  { label: 'Début — 30 m, pioche 3, 4 clics/s', depth: 30, pick: 3, luck: 1, bag: 2, auto: 1, cps: 4 },
  { label: 'Capture 02/11 — 122 m, pioche 8 (+4 Œil), Chance 5, Sac 6, Auto-Dig 4, 4 clics/s', depth: 122, pick: 8, luck: 5, bag: 6, auto: 4, relics: { eye_of_miner: 2, golden_heart: 1 }, cps: 4 },
  { label: 'Milieu — 300 m, pioche 12, Chance 8, Sac 9, Auto-Dig 6, 5 clics/s', depth: 300, pick: 12, luck: 8, bag: 9, auto: 6, relics: { eye_of_miner: 2, golden_heart: 2, shard_magnet: 1 }, cps: 5 },
  { label: 'Avancé — 800 m, tout au max, reliques 3, 6 clics/s', depth: 800, pick: 15, luck: 12, bag: 12, auto: 6, relics: { eye_of_miner: 3, golden_heart: 3, shard_magnet: 3, cracked_lens: 3, obsidian_claw: 3, ancient_engine: 3 }, cps: 6 },
  { label: 'Onglet ouvert seul — 300 m, Auto-Dig 6, passage /10 min', depth: 300, pick: 12, luck: 8, bag: 9, auto: 6, relics: {}, idle: true },
];

// ── Tables exactes (sans hasard) ─────────────────────────────────────────────

/** Probabilité par bloc d'une gemme qui rapporte, d'un coffre et de chaque coffre, par profondeur. */
function exactOdds(depth, luck, rules = currentRules()) {
  G.GameState.relicBonuses = { luckPct: 0 };
  let gem = 0, gemsPerBlock = 0, chest = 0, gemNoReward = 0;
  for (const { type, p } of G.Blocks.blockOdds(depth, luck)) {
    const g = rules.gemsPerBlock[G.Blocks.idOf(type)] || 0;
    if (type.isGem) gem += p;
    if (type.category === 'gemme' && !type.isGem) gemNoReward += p;
    gemsPerBlock += p * g;
    if (type.isChest) chest += p;
  }
  return { depth, luck, gem, gemNoReward, gemsPerBlock, chest };
}

/** Espérance d'un coffre de la mine ou de la boutique (pièces, fragments, % boost). */
function chestExpectation(table, magnet = 0, fragMult = 1, shop = false) {
  const total = table.reduce((s, r) => s + r.weight, 0);
  let coins = 0, frags = 0, boost = 0, collection = 0;
  for (const r of table) {
    const p = r.weight / total;
    if (r.type === 'coins') coins += p * (r.min + r.max) / 2;
    if (r.type === 'relics') frags += p * (shop ? Math.max(1, Math.round((r.amount + magnet) * fragMult)) : r.amount + magnet);
    if (r.type === 'boost') boost += p;
    if (r.type === 'collection') collection += p;
  }
  return { coins, frags, boost, collection };
}

// ── Rapport Markdown ─────────────────────────────────────────────────────────

const f0 = x => (x === undefined || x === null || !Number.isFinite(x) ? '—' : Math.round(x).toLocaleString('fr-FR'));
const f1 = x => (x === undefined || x === null || !Number.isFinite(x) ? '—' : x.toLocaleString('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
const f2 = x => (x === undefined || x === null || !Number.isFinite(x) ? '—' : x.toLocaleString('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
const dist = (d, f = f1) => (d.n ? `${f(d.p50)} (${f(d.p10)}–${f(d.p90)}) · moy. ${f(d.mean)} ± ${f(d.sd)}` : '—');

function report({ runs, longRuns, seasons }) {
  const lines = [];
  const say = s => lines.push(s);
  const rules0 = currentRules();
  say(`<!-- généré par node tools/balance/economy-sim.js --runs ${runs} --long-runs ${longRuns} --seasons ${seasons} -->`);
  say('### Probabilités exactes par bloc (catalogue v3 publié, Chance 0 et 5)');
  say('');
  say('| Profondeur | Chance | Gemme qui rapporte 💎 | Gemme sans 💎 (saphir, améthyste, cristal) | Coffre de la mine | 💎 / 1 000 blocs (A · B) |');
  say('|---|---|---|---|---|---|');
  for (const d of [20, 35, 50, 70, 100, 122, 150, 250, 400, 600, 900]) {
    for (const l of [0, 5]) {
      const e = exactOdds(d, l);
      const a = exactOdds(d, l, VARIANTS.A(rules0)), b = exactOdds(d, l, VARIANTS.B(rules0));
      say(`| ${d} m | ${l} | ${f2(e.gem * 100)} % | ${f2(e.gemNoReward * 100)} % | ${f2(e.chest * 100)} % | ${f1(e.gemsPerBlock * 1000)} (${f1(a.gemsPerBlock * 1000)} · ${f1(b.gemsPerBlock * 1000)}) |`);
    }
  }
  say('');
  say('### Espérance des coffres (pièces, fragments)');
  say('');
  say('| Coffre | Coût | Pièces rendues | Fragments (Aimant 0 → 5) | Boost | Objet | Pièces nettes / fragment |');
  say('|---|---|---|---|---|---|---|');
  for (const [k, label] of [['commun', 'Mine — vieille caisse'], ['rare', 'Mine — coffre en bois'], ['epique', 'Mine — coffre en fer']]) {
    const e0 = chestExpectation(G.Chests.TABLES[k]), e5 = chestExpectation(G.Chests.TABLES[k], 5);
    say(`| ${label} | gratuit | ${f0(e0.coins)} | ${f2(e0.frags)} → ${f2(e5.frags)} | ${f0(e0.boost * 100)} % | — | — |`);
  }
  for (const id of ['simple', 'rare', 'antique']) {
    const cost = rules0.economy.chestCosts[id];
    const e0 = chestExpectation(SHOP_CHESTS[id].table, 0, 1, true), e5 = chestExpectation(SHOP_CHESTS[id].table, 5, 1, true);
    say(`| Boutique — ${id} (${SHOP_CHESTS[id].maxPerSeason ?? '∞'}/saison) | ${f0(cost)} | ${f0(e0.coins)} | ${f2(e0.frags)} → ${f2(e5.frags)} | ${f0(e0.boost * 100)} % | ${f0(e0.collection * 100)} % | ${f0((cost - e0.coins) / e0.frags)} → ${f0((cost - e5.coins) / e5.frags)} |`);
  }
  say('');

  say(`### Une heure à équipement figé — ${runs.toLocaleString('fr-FR')} heures simulées par ligne (barème actuel · A · B)`);
  say('');
  say('Médiane (p10–p90) ; 💎 et 🔮 : moyenne ± écart-type en plus.');
  say('');
  say('| Équipement | Mètres / h | 💎 / h actuel | 💎 / h A | 💎 / h B | 🔮 / h (mine) | 💰 / h |');
  say('|---|---|---|---|---|---|---|');
  for (const e of FIXED) {
    const h0 = hourAt(e, runs), hA = hourAt({ ...e, rules: VARIANTS.A(rules0) }, runs), hB = hourAt({ ...e, rules: VARIANTS.B(rules0) }, runs);
    const g = d => `${f0(d.p50)} (${f0(d.p10)}–${f0(d.p90)}) · ${f1(d.mean)} ± ${f1(d.sd)}`;
    say(`| ${e.label} | ${f0(h0.meters.p50)} (${f0(h0.meters.p10)}–${f0(h0.meters.p90)}) | ${g(h0.gems)} | ${g(hA.gems)} | ${g(hB.gems)} | ${g(h0.frags)} | ${f0(h0.coins.p50)} |`);
  }
  say('');

  const ruleSets = { actuel: rules0, A: VARIANTS.A(rules0), B: VARIANTS.B(rules0) };
  const all = {};
  for (const [pid, profile] of Object.entries(PROFILES)) {
    all[pid] = {};
    for (const [rid, rules] of Object.entries(ruleSets)) {
      all[pid][rid] = summarize(simulatePlayers({ profile, rules, runs }));
    }
  }
  say(`### Saison 1 (nouveau joueur, 7 jours) — ${runs.toLocaleString('fr-FR')} saisons par profil et par barème`);
  say('');
  say('Médiane (p10–p90) · moyenne ± écart-type.');
  say('');
  for (const [pid, profile] of Object.entries(PROFILES)) {
    const s = all[pid].actuel;
    say(`#### ${profile.label} — ${f1(s.playedH.p50)} h de jeu (actif + onglet ouvert)`);
    say('');
    say('| Mesure | Actuel | Variante A | Variante B |');
    say('|---|---|---|---|');
    const row = (label, key, f) => say(`| ${label} | ${['actuel', 'A', 'B'].map(r => dist(all[pid][r][key], f)).join(' | ')} |`);
    row('Profondeur max (m)', 'maxDepth', f0);
    row('💎 gagnées / saison', 'gemsEarned', f1);
    row('💎 / heure de jeu', 'gemsPerH', f2);
    row('— dont blocs gemmes', 'gemsBlocks', f1);
    row('— dont série quotidienne', 'gemsDaily', f1);
    row('— dont missions du jour', 'gemsMissions', f1);
    row('— dont coffres de la mine', 'gemsChests', f1);
    row('💎 dépensées (Auto-Dig)', 'gemsSpent', f1);
    row('💎 en fin de saison (avant plafond)', 'gemsEnd', f1);
    row('🔮 fragments / saison', 'fragsEarned', f1);
    row('🔮 / heure de jeu', 'fragsPerH', f2);
    row('— dont coffres de la mine', 'fragsMine', f1);
    row('— dont boutique de fragments', 'fragsShop', f1);
    row('— dont coffres de la boutique', 'fragsShopChests', f1);
    row('💰 pièces gagnées / saison', 'coinsEarned', f0);
    row('💰 / heure de jeu', 'coinsPerH', f0);
    row('Auto-Dig atteint (niveau)', 'autodigEnd', f1);
    say(`| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | ${s.autodigAt.map(d => `${f0(d.share * 100)} %`).join(' · ')} | ${all[pid].A.autodigAt.map(d => `${f0(d.share * 100)} %`).join(' · ')} | ${all[pid].B.autodigAt.map(d => `${f0(d.share * 100)} %`).join(' · ')} |`);
    row('Toutes améliorations en pièces au max (h de jeu ; part)', 'maxedAt', f1);
    say(`| — part des joueurs qui ont tout au max | ${['actuel', 'A', 'B'].map(r => `${f0(all[pid][r].maxedAt.share * 100)} %`).join(' | ')} |`);
    row('💰 non dépensées en fin de saison', 'coinsEnd', f0);
    say(`| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | ${s.autodigAt.map(d => f1(d.p50)).join(' · ')} | ${all[pid].A.autodigAt.map(d => f1(d.p50)).join(' · ')} | ${all[pid].B.autodigAt.map(d => f1(d.p50)).join(' · ')} |`);
    say('');
  }

  // Accumulation sur plusieurs saisons (reliques et fragments permanents, gemmes plafonnées)
  say(`### Accumulation sur ${seasons} saisons — ${longRuns.toLocaleString('fr-FR')} joueurs par profil (barème actuel)`);
  say('');
  say('| Profil | Saison | Profondeur max | 💎 gagnées | 💎 en fin (avant plafond) | 💎 perdues au plafond | 🔮 gagnées | Niveaux de reliques | Coffres boutique |');
  say('|---|---|---|---|---|---|---|---|---|');
  const long = {};
  for (const [pid, profile] of Object.entries(PROFILES)) {
    long[pid] = simulatePlayers({ profile, rules: rules0, runs: longRuns, seasons, seed: 4949 });
    for (const k of [0, Math.floor((seasons - 1) / 2), seasons - 1]) {
      const s = summarize(long[pid], k);
      say(`| ${profile.label} | ${k + 1} | ${f0(s.maxDepth.p50)} | ${f1(s.gemsEarned.p50)} | ${f1(s.gemsEnd.p50)} | ${f1(s.gemsLostCap.mean)} (moy.) | ${f0(s.fragsEarned.p50)} | ${f0(s.relicLevels.p50)} / 30 | ${f0(s.shopChests.p50)} |`);
    }
  }
  say('');

  // Effet des avantages sur la profondeur (classement) — saison 1, même graine
  say(`### Effet des avantages sur la profondeur (saison 1, ${runs.toLocaleString('fr-FR')} saisons, barème actuel)`);
  say('');
  say('| Profil | Référence | Sans Auto-Dig en gemmes | Ramassage auto des coffres (onglet ouvert) | Boost ×2 pièces 30 min / jour | Écart Auto-Dig gemmes | Écart ramassage | Écart boost |');
  say('|---|---|---|---|---|---|---|---|');
  for (const [pid, profile] of Object.entries(PROFILES)) {
    const ref = all[pid].actuel.maxDepth.p50;
    const noGem = summarize(simulatePlayers({ profile, rules: rules0, runs, options: { noGemAutodig: true } })).maxDepth.p50;
    const auto = profile.idleMin > 0 ? summarize(simulatePlayers({ profile, rules: rules0, runs, options: { autoCollect: true } })).maxDepth.p50 : null;
    const boost = summarize(simulatePlayers({ profile, rules: rules0, runs, options: { dailyBoost: true } })).maxDepth.p50;
    const pct = x => (x === null ? '—' : `${x >= ref ? '+' : ''}${f1((x / ref - 1) * 100)} %`);
    say(`| ${profile.label} | ${f0(ref)} m | ${f0(noGem)} m | ${auto === null ? '—' : `${f0(auto)} m`} | ${f0(boost)} m | ${pct(noGem)} | ${pct(auto)} | ${pct(boost)} |`);
  }
  say('');

  // Sensibilité : conversion des pièces en coffres de la boutique (profil Assidu, 4 saisons)
  say(`### Conversion des pièces en coffres de la boutique — ${longRuns.toLocaleString('fr-FR')} joueurs × 4 saisons`);
  say('');
  say('| Scénario | 🔮 saison 1 | Reliques S1 (/30) | Profondeur S1 | Profondeur S2 | Écart S2 | Profondeur S4 | Écart S4 |');
  say('|---|---|---|---|---|---|---|---|');
  const scen = [
    ['Assidu — sans coffres de la boutique', 'assidu', { chests: 'none' }, PROD_CONFIG],
    ['Assidu — simple à 800 (production), 1 h d\'ouvertures (1 800)', 'assidu', {}, PROD_CONFIG],
    ['Assidu — simple à 2 000 (défaut du code), 1 800 ouvertures', 'assidu', {}, { ...PROD_CONFIG, chest_cost_simple: '2000' }],
    ['Assidu — simple à 800, 300 ouvertures / saison', 'assidu', { convertChests: 300 }, PROD_CONFIG],
    ['Assidu — script au plafond du limiteur (30/min, 24 h)', 'assidu', { convertChests: CHEST_RATE_PER_MIN * 60 * 24 }, PROD_CONFIG],
    ['Régulier — sans coffres de la boutique', 'regulier', { chests: 'none' }, PROD_CONFIG],
    ['Régulier — simple à 800, 300 ouvertures / saison', 'regulier', { chests: 'convert', convertChests: 300 }, PROD_CONFIG],
  ];
  const refs = {};
  const gap = (x, r) => `${x >= r ? '+' : ''}${f1((x / r - 1) * 100)} %`;
  for (const [label, pid, options, config] of scen) {
    const res = simulatePlayers({ profile: PROFILES[pid], rules: currentRules(config), runs: longRuns, seasons: 4, seed: 777, options });
    const s1 = summarize(res, 0), s2 = summarize(res, 1), s4 = summarize(res, 3);
    if (!refs[pid]) refs[pid] = { s2: s2.maxDepth.p50, s4: s4.maxDepth.p50 };
    const ref = refs[pid];
    say(`| ${label} | ${f0(s1.fragsEarned.p50)} | ${f0(s1.relicLevels.p50)} | ${f0(s1.maxDepth.p50)} m | ${f0(s2.maxDepth.p50)} m | ${gap(s2.maxDepth.p50, ref.s2)} | ${f0(s4.maxDepth.p50)} m | ${gap(s4.maxDepth.p50, ref.s4)} |`);
  }
  say('');
  return { markdown: lines.join('\n'), all };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def; };
  const runs = opt('--runs', 10_000);
  const longRuns = opt('--long-runs', 2_000);
  const seasons = opt('--seasons', 8);
  const t0 = Date.now();
  const { markdown, all } = report({ runs, longRuns, seasons });
  if (args.includes('--json')) console.log(JSON.stringify(all, null, 1));
  else console.log(markdown);
  console.error(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

module.exports = {
  PROD_CONFIG, PROFILES, VARIANTS, FIXED, currentRules, hourAt, loadGame, simulatePlayers, summarize, exactOdds,
  chestExpectation, oddsAt, offlineCoins, rng, report, G,
};
