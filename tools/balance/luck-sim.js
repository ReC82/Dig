#!/usr/bin/env node
/**
 * luck-sim.js — audit de l'amélioration Chance (ticket #32).
 *
 * Simule la descente avec le VRAI code du jeu (public/js/blocks.js, chests.js, balance.js chargés
 * dans un contexte vm, Math.random remplacé par un générateur à graine) et compare les niveaux
 * de Chance à puissance de pioche, CPS et temps identiques. Aucun accès réseau ni base de données.
 *
 * Modèle de temps (reproduit main.js) :
 *   - clics manuels réguliers à `cps` par seconde, dégâts = pioche ;
 *   - Auto-Dig : un coup de `autodig` dégâts par seconde (setInterval 1 s) ;
 *   - après chaque bloc détruit, 0,35 s d'animation pendant laquelle clics et Auto-Dig sont ignorés ;
 *   - coffre trouvé dans la mine : popup bloquante jusqu'au clic « Récupérer » (`chestDelay` s ;
 *     Infinity = joueur absent, l'Auto-Dig s'arrête au premier coffre).
 *
 * Lancer : node tools/balance/luck-sim.js            (tableaux Markdown du rapport #32)
 *          node tools/balance/luck-sim.js --quick    (moins de tirages, pour vérifier vite)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..', '..');

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

/** Charge les scripts du navigateur ; `random` remplace Math.random dans ce contexte. */
function loadGame() {
  const state = { random: Math.random };
  const FakeMath = Object.create(Math);
  FakeMath.random = () => state.random();
  const GameState = { upgrades: { luck: 0 }, relicBonuses: {} };
  const ctx = vm.createContext({ Math: FakeMath, Object, Array, Number, String, Set, JSON, GameState, t: k => k });
  for (const f of ['balance.js', 'blocks.js', 'chests.js', 'relics.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'), ctx, { filename: f });
  }
  const g = vm.runInContext('({ Balance, Blocks, Chests, Relics })', ctx);
  return { ...g, GameState, setRandom: fn => { state.random = fn; } };
}

const G = loadGame();

const LUCK_MAX = G.Balance.LUCK.length;              // 12
const BREAK_ANIM_S = 0.35;                           // #block.anim-break (style.css)

/** Applique Chance + reliques au GameState factice lu par Blocks.spawn(). */
function setLuck(luckLevel, { luckPct = 0, hpReduction = 0 } = {}) {
  G.GameState.upgrades.luck = luckLevel;
  G.GameState.relicBonuses = { luckPct, hpReduction };
}

// ── Espérances exactes par profondeur (sans hasard) ──────────────────────────

/**
 * Distribution exacte des blocs à une profondeur (Blocks.blockOdds) et moyennes associées.
 * @returns {{ rareShare, meanHp, meanReward, chestShare, gemShare }}
 */
function expectedAt(depth, luckLevel, relic = {}) {
  setLuck(luckLevel, relic);
  const odds = G.Blocks.blockOdds(depth);
  const scale = 1 + (depth - 1) * 0.12;
  let meanHp = 0, meanReward = 0, rareShare = 0, chestShare = 0, gemShare = 0;
  for (const { type, p } of odds) {
    meanHp += p * Math.ceil(type.hpBase * scale * (1 - (relic.hpReduction ?? 0)));
    if (!type.isChest) meanReward += p * Math.ceil(type.reward * (1 + (depth - 1) * 0.05));
    if (G.Blocks._BOOSTED_RARITIES.has(type.rarityKey)) rareShare += p;
    if (type.isChest) chestShare += p;
    if (type.isGem) gemShare += p;
  }
  return { rareShare, meanHp, meanReward, chestShare, gemShare };
}

// ── Variantes d'équilibrage étudiées (hypothèses du rapport #32, absentes du jeu) ──
//   actuel         : Blocks.spawn tel quel ;
//   deux-temps     : la résistance (PV) est tirée SANS Chance, la nature et la récompense du bloc
//                    AVEC Chance → PV moyens identiques à Chance 0 quel que soit le niveau ;
//   rares-fragiles : tirage actuel, mais PV des blocs rares/épiques/légendaires ÷ multiplicateur
//                    de Chance (1 + 0,2 × niveau + relique).
function spawnVariant(depth, variant) {
  if (variant === 'deux-temps') {
    const luck = G.GameState.upgrades.luck;
    G.GameState.upgrades.luck = 0;
    const lucky = G.GameState.relicBonuses.luckPct;
    G.GameState.relicBonuses.luckPct = 0;
    const { hp } = G.Blocks.spawn(depth);
    G.GameState.upgrades.luck = luck;
    G.GameState.relicBonuses.luckPct = lucky;
    const b = G.Blocks.spawn(depth);
    b.hp = b.maxHp = hp;
    return b;
  }
  const b = G.Blocks.spawn(depth);
  if (variant === 'rares-fragiles' && G.Blocks._BOOSTED_RARITIES.has(b.type.rarityKey)) {
    b.hp = b.maxHp = Math.max(1, Math.ceil(b.hp / G.Blocks.luckMultiplier()));
  }
  return b;
}

// ── Simulation d'une séance à équipement fixe ───────────────────────────────

/**
 * @param {object} o
 * @param {number} o.depth0      profondeur de départ
 * @param {number} o.seconds     durée de jeu
 * @param {number} o.damage      dégâts par clic (niveau de pioche + relique)
 * @param {number} o.cps         clics par seconde (0 = joueur absent)
 * @param {number} o.autodig     dégâts Auto-Dig par seconde
 * @param {number} o.luck        niveau de Chance
 * @param {number} [o.bag]       niveau du Sac
 * @param {number} [o.boost]     bonus temporaire de pièces (×2, ×3…)
 * @param {number} [o.chestDelay] secondes avant « Récupérer » sur un coffre de la mine
 * @param {object} [o.relic]     { luckPct, hpReduction }
 * @param {string} [o.variant]   'actuel' (défaut) | 'deux-temps' | 'rares-fragiles'
 * @param {number} o.seed
 */
function simulate(o) {
  const random = rng(o.seed);
  G.setRandom(random);
  setLuck(o.luck, o.relic);
  const bagMult = 1 + (o.bag ?? 0) * 0.3;
  const chestDelay = o.chestDelay ?? 1.5;
  const r = { meters: 0, blocks: 0, coins: 0, fragments: 0, gems: 0, chests: 0, rare: 0 };

  let depth = o.depth0;
  let block = spawnVariant(depth, o.variant);
  let hp = block.hp;
  let blockedUntil = 0;
  let chestBoost = { mult: 1, until: 0 };
  let nextClick = o.cps > 0 ? random() / o.cps : Infinity;
  let nextTick  = random();                         // phase de l'intervalle Auto-Dig

  while (true) {
    const isClick = nextClick <= nextTick;
    const now = isClick ? nextClick : nextTick;
    if (now >= o.seconds) break;
    let dmg;
    if (isClick) { nextClick += 1 / o.cps; dmg = o.damage; }
    else         { nextTick += 1;          dmg = o.autodig; }
    if (now < blockedUntil || dmg <= 0) continue;

    hp -= dmg;
    if (hp > 0) continue;

    // Bloc détruit (handleBlockDestroyed) : un mètre de plus.
    const type = block.type;
    r.blocks++; r.meters++; depth++;
    if (G.Blocks._BOOSTED_RARITIES.has(type.rarityKey)) r.rare++;
    blockedUntil = now + BREAK_ANIM_S;
    if (type.isChest) {
      r.chests++;
      blockedUntil += chestDelay;
      const entry = G.Chests._pick(G.Chests.TABLES[type.rarityKey] ?? G.Chests.TABLES.commun);
      if (entry.type === 'coins')  r.coins += G.Chests._rand(entry.min, entry.max);
      if (entry.type === 'relics') r.fragments += entry.amount;
      if (entry.type === 'boost')  chestBoost = { mult: entry.mult, until: now + entry.minutes * 60 };
    } else {
      const boost = chestBoost.until > now ? chestBoost.mult : (o.boost ?? 1);
      r.coins += Math.ceil(block.reward * bagMult * boost);
      if (type.isGem) r.gems++;
    }
    if (!Number.isFinite(blockedUntil)) break;      // joueur absent devant un coffre
    block = spawnVariant(depth, o.variant);
    hp = block.hp;
  }
  return r;
}

function quantile(sorted, q) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Répète `simulate` sur `runs` graines ; renvoie moyenne, p10, p50, p90 par mesure. */
function distribution(o, runs) {
  const all = [];
  for (let s = 0; s < runs; s++) all.push(simulate({ ...o, seed: 1000 + s }));
  const out = {};
  for (const k of Object.keys(all[0])) {
    const v = all.map(x => x[k]).sort((a, b) => a - b);
    out[k] = {
      mean: v.reduce((a, b) => a + b, 0) / v.length,
      p10: quantile(v, 0.1), p50: quantile(v, 0.5), p90: quantile(v, 0.9),
    };
  }
  return out;
}

// ── Progression d'une saison complète (réinvestissement des pièces) ─────────

/**
 * Joueur qui part de zéro et réinvestit : à chaque bloc, il achète l'amélioration la moins chère
 * parmi pioche, Sac, Auto-Dig (pièces puis gemmes), boutique de fragments et Chance tant que
 * Chance < `luckTarget`. Ses fragments (coffres de la mine + boutique) vont aux deux reliques qui
 * font descendre plus vite : Œil du mineur (+dégâts) et Griffe d'obsidienne (−PV), la moins chère
 * d'abord. Reliques à zéro au départ (première saison). Sans coffres de la boutique de saison.
 * Renvoie la profondeur atteinte aux instants `checkpoints` (secondes).
 */
function season(o) {
  const random = rng(o.seed);
  G.setRandom(random);
  const B = G.Balance;
  const st = { pick: 1, luck: 0, bag: 0, auto: 0, shop: 0, coins: 0, gems: 0, frags: 0, eye: 0, claw: 0 };
  const R = Object.fromEntries(G.Relics.DEFS.map(d => [d.id, d]));
  const eyeBonus = () => (st.eye ? R.eye_of_miner.bonus.values[st.eye - 1] : 0);
  const hpRed = () => (st.claw ? R.obsidian_claw.bonus.values[st.claw - 1] : 0);
  const applyLuck = () => setLuck(st.luck, { hpReduction: hpRed() });
  applyLuck();
  const checkpoints = [...o.checkpoints];
  const depthAt = [];
  const levelsAt = [];
  let depth = 1;
  let block = G.Blocks.spawn(depth);
  let hp = block.hp;
  let blockedUntil = 0;
  let nextClick = random() / o.cps;
  let nextTick = random();
  const end = checkpoints[checkpoints.length - 1];

  const buy = () => {
    for (;;) {
      const offers = [];
      if (st.pick < 15)                 offers.push({ k: 'pick', c: B.PICKAXE[st.pick - 1], g: 0 });
      if (st.bag < 12)                  offers.push({ k: 'bag',  c: B.BAG[st.bag], g: 0 });
      if (st.luck < o.luckTarget)       offers.push({ k: 'luck', c: B.LUCK[st.luck], g: 0 });
      if (st.auto < 6) { const a = B.AUTODIG[st.auto]; offers.push({ k: 'auto', c: a.coins, g: a.gems }); }
      if (st.shop < 10)                 offers.push({ k: 'shop', c: B.FRAGMENT_SHOP[st.shop], g: 0 });
      const ok = offers.filter(x => x.c <= st.coins && x.g <= st.gems)
        .sort((a, b) => (a.c + a.g * 1000) - (b.c + b.g * 1000));
      if (!ok.length) return;
      const x = ok[0];
      st.coins -= x.c; st.gems -= x.g; st[x.k]++;
      if (x.k === 'shop') st.frags++;
      if (x.k === 'luck') applyLuck();
    }
  };
  const buyRelics = () => {
    for (;;) {
      const offers = [['eye', 'eye_of_miner'], ['claw', 'obsidian_claw']]
        .filter(([k]) => st[k] < 5)
        .map(([k, id]) => ({ k, c: R[id].costs[st[k]] }))
        .filter(x => x.c <= st.frags)
        .sort((a, b) => a.c - b.c);
      if (!offers.length) return;
      st.frags -= offers[0].c; st[offers[0].k]++;
      applyLuck();
    }
  };

  for (;;) {
    const isClick = nextClick <= nextTick;
    const now = isClick ? nextClick : nextTick;
    while (checkpoints.length && now >= checkpoints[0]) {
      checkpoints.shift(); depthAt.push(depth);
      levelsAt.push(`P${st.pick} C${st.luck} S${st.bag} A${st.auto} · Œil ${st.eye} Griffe ${st.claw}`);
    }
    if (now >= end) break;
    let dmg;
    if (isClick) { nextClick += 1 / o.cps; dmg = st.pick + eyeBonus(); }
    else         { nextTick += 1;          dmg = st.auto; }
    if (now < blockedUntil || dmg <= 0) continue;
    hp -= dmg;
    if (hp > 0) continue;
    const type = block.type;
    depth++;
    blockedUntil = now + BREAK_ANIM_S;
    if (type.isChest) {
      blockedUntil += 1.5;
      const entry = G.Chests._pick(G.Chests.TABLES[type.rarityKey] ?? G.Chests.TABLES.commun);
      if (entry.type === 'coins')  st.coins += G.Chests._rand(entry.min, entry.max);
      if (entry.type === 'relics') st.frags += entry.amount;
    } else {
      st.coins += Math.ceil(block.reward * (1 + st.bag * 0.3));
      if (type.isGem) st.gems++;
    }
    buy();
    buyRelics();
    block = G.Blocks.spawn(depth);
    hp = block.hp;
  }
  return { depthAt, levelsAt };
}

// ── Sortie Markdown ──────────────────────────────────────────────────────────

const fmt = (n, d = 0) => n.toLocaleString('fr-BE', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = n => `${n >= 0 ? '+' : ''}${fmt(n * 100)} %`;

function main() {
  const quick = process.argv.includes('--quick');
  const RUNS = quick ? 20 : 200;
  const LEVELS = [0, 1, 4, 7, LUCK_MAX];
  const out = [];

  out.push('### A. Espérances exactes par bloc (Chance seule, sans relique)\n');
  out.push('| Profondeur | Chance | Blocs « rares » | PV moyens | Pièces moyennes / bloc (base) | Pièces / PV | Coffres | Gemmes |');
  out.push('|---|---|---|---|---|---|---|---|');
  for (const d of [20, 50, 100, 150, 250]) {
    for (const L of LEVELS) {
      const e = expectedAt(d, L);
      out.push(`| ${d} m | ${L} | ${fmt(e.rareShare * 100, 1)} % | ${fmt(e.meanHp, 1)} | ${fmt(e.meanReward, 1)} | ${fmt(e.meanReward / e.meanHp, 2)} | ${fmt(e.chestShare * 100, 1)} % | ${fmt(e.gemShare * 100, 1)} % |`);
    }
  }

  const PROFILES = [
    { name: 'Début de saison — pioche 3, 5 clics/s, sans Auto-Dig, 30 m', depth0: 30, damage: 3, cps: 5, autodig: 0, bag: 2 },
    { name: 'Milieu — pioche 9, 6 clics/s, Auto-Dig 4, Sac 8, 100 m (profil proche de la recette)', depth0: 100, damage: 9, cps: 6, autodig: 4, bag: 8 },
    { name: 'Fin de saison — pioche 15, 7 clics/s, Auto-Dig 6, Sac 12, 200 m', depth0: 200, damage: 15, cps: 7, autodig: 6, bag: 12 },
    { name: 'Inactif — Auto-Dig 6 seul, pioche 15, 200 m, popups de coffre fermées en 30 s', depth0: 200, damage: 15, cps: 0, autodig: 6, bag: 12, chestDelay: 30 },
  ];
  for (const p of PROFILES) {
    for (const boost of [1, 2]) {
      out.push(`\n### B. ${p.name} — 1 h${boost > 1 ? ', bonus temporaire ×2 pendant toute l’heure' : ''} (${RUNS} tirages)\n`);
      out.push('| Chance | Mètres/h (p10 · médiane · p90) | Écart vs Chance 0 | Pièces/h (p10 · médiane · p90) | Écart | Fragments/h | Gemmes/h | Coffres/h |');
      out.push('|---|---|---|---|---|---|---|---|');
      let ref;
      for (const L of LEVELS) {
        const r = distribution({ ...p, seconds: 3600, luck: L, boost }, RUNS);
        ref ??= r;
        out.push(`| ${L} | ${fmt(r.meters.p10)} · **${fmt(r.meters.p50)}** · ${fmt(r.meters.p90)} | ${pct(r.meters.mean / ref.meters.mean - 1)} | ${fmt(r.coins.p10)} · **${fmt(r.coins.p50)}** · ${fmt(r.coins.p90)} | ${pct(r.coins.mean / ref.coins.mean - 1)} | ${fmt(r.fragments.mean, 1)} | ${fmt(r.gems.mean, 1)} | ${fmt(r.chests.mean, 1)} |`);
      }
    }
  }

  out.push(`\n### E. Solutions étudiées — profil « milieu », 1 h, sans bonus (${RUNS} tirages)\n`);
  out.push('Écarts par rapport au jeu actuel à Chance 0 (référence commune).\n');
  out.push('| Chance | Actuel : mètres/h · pièces/h | A « deux temps » : mètres/h · pièces/h | B « rares fragiles » : mètres/h · pièces/h |');
  out.push('|---|---|---|---|');
  {
    const p = PROFILES[1];
    const ref = distribution({ ...p, seconds: 3600, luck: 0 }, RUNS);
    for (const L of LEVELS) {
      const cells = ['actuel', 'deux-temps', 'rares-fragiles'].map(variant => {
        const r = distribution({ ...p, seconds: 3600, luck: L, variant }, RUNS);
        return `${fmt(r.meters.p50)} (${pct(r.meters.mean / ref.meters.mean - 1)}) · ${fmt(r.coins.p50)} (${pct(r.coins.mean / ref.coins.mean - 1)})`;
      });
      out.push(`| ${L} | ${cells.join(' | ')} |`);
    }
  }

  out.push('\n### C. Avec la relique Lentille fêlée niveau 5 (+130 % Chance) — profil « milieu », 1 h\n');
  out.push('| Chance | Mètres/h médiane | Écart vs Chance 0 sans relique | Pièces/h médiane | Écart |');
  out.push('|---|---|---|---|---|');
  {
    const p = PROFILES[1];
    const ref = distribution({ ...p, seconds: 3600, luck: 0 }, RUNS);
    for (const L of LEVELS) {
      const r = distribution({ ...p, seconds: 3600, luck: L, relic: { luckPct: 1.3 } }, RUNS);
      out.push(`| ${L} + relique | ${fmt(r.meters.p50)} | ${pct(r.meters.mean / ref.meters.mean - 1)} | ${fmt(r.coins.p50)} | ${pct(r.coins.mean / ref.coins.mean - 1)} |`);
    }
  }

  const CHECK = [1, 3, 6, 10, 20].map(h => h * 3600);
  const SEEDS = quick ? 5 : 30;
  out.push(`\n### D. Saison complète depuis zéro, 6 clics/s, réinvestissement automatique (${SEEDS} tirages)\n`);
  out.push('Le joueur achète toujours l’amélioration la moins chère disponible (pioche, Sac, Auto-Dig, boutique de fragments, et Chance jusqu’au niveau visé) ; ses fragments vont à l’Œil du mineur et à la Griffe d’obsidienne. Valeurs : p10 · **médiane** · p90.\n');
  out.push('| Chance visée | Profondeur après 1 h | 3 h | 6 h | 10 h | 20 h de jeu | Niveaux à 10 h (médiane) |');
  out.push('|---|---|---|---|---|---|---|');
  for (const L of LEVELS) {
    const runs = [];
    for (let s = 0; s < SEEDS; s++) runs.push(season({ cps: 6, luckTarget: L, checkpoints: CHECK, seed: 5000 + s }));
    const cells = CHECK.map((_, i) => {
      const v = runs.map(r => r.depthAt[i]).sort((a, b) => a - b);
      return `${fmt(quantile(v, 0.1))} · **${fmt(quantile(v, 0.5))}** · ${fmt(quantile(v, 0.9))}`;
    });
    out.push(`| ${L} | ${cells.join(' | ')} | ${runs[Math.floor(SEEDS / 2)].levelsAt[3]} |`);
  }
  console.log(out.join('\n'));
}

if (require.main === module) main();

module.exports = { loadGame, expectedAt, simulate, distribution, season, LUCK_MAX };
