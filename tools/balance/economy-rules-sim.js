#!/usr/bin/env node
/**
 * tools/balance/economy-rules-sim.js — Simulation comparative de deux jeux de règles économiques
 * (#49, Admin → Économie). Lancé par server/economyRules.js dans un processus séparé.
 *
 * Entrée (stdin, JSON) : { before, after, runs, seasons } — règles au format de economyRules.js.
 * Sortie (stdout, JSON) : { profiles: [{ id, label, before, after }], runs, seasons, ms }.
 * Mêmes graines pour les deux règles : seuls les écarts de règles changent les résultats.
 * Les achats de coffres de la boutique suivent les hypothèses du 04/11 (economy-sim.js, shopBuy).
 */

'use strict';

const sim = require('./economy-sim');

/** Règles de economyRules.js → règles internes du simulateur (sur la base des règles actuelles). */
function toSimRules(r, id) {
  const base = sim.currentRules();
  const g = r.gems;
  const autodigCosts = base.autodigCosts.map((c, i) => (String(i + 1) in g.autodig ? { ...c, gems: g.autodig[String(i + 1)] } : c));
  const mineChestGems = {};
  for (const [k, v] of Object.entries(g.mineChest)) if (v.chance > 0 && v.gems > 0) mineChestGems[k] = { p: v.chance / 100, gems: v.gems };
  return {
    ...base, id,
    gemsPerBlock: { ...g.perBlock },
    mineChestGems,
    missionSetGems: g.missionSetBonus,
    dailyGems: [...g.dailyStreak],
    gemsCap: g.seasonCap,
    autodigCosts,
    coinCurve: r.coins.curve.length ? r.coins.curve.map(s => ({ until: s.until ?? Infinity, slope: s.slope })) : null,
    shopLimits: Object.fromEntries(Object.entries(r.shopChests).map(([k, v]) => [k, v.maxPerSeason])),
  };
}

const r1 = x => Math.round(x * 10) / 10;
function metrics(results, seasons) {
  const s = sim.summarize(results, seasons - 1);
  return {
    gemsEarned: r1(s.gemsEarned.mean), gemsPerH: r1(s.gemsPerH.mean), gemsEnd: r1(s.gemsEnd.mean), gemsLostCap: r1(s.gemsLostCap.mean),
    fragsEarned: r1(s.fragsEarned.mean), fragsPerH: r1(s.fragsPerH.mean), relicLevels: r1(s.relicLevels.mean),
    coinsEarned: Math.round(s.coinsEarned.mean), coinsEnd: Math.round(s.coinsEnd.mean),
    maxDepthP50: Math.round(s.maxDepth.p50), autodigEnd: r1(s.autodigEnd.mean),
    maxedShare: Math.round((s.maxedAt.share ?? 0) * 100), maxedAtH: s.maxedAt.n ? r1(s.maxedAt.p50) : null,
    shopChests: r1(s.shopChests.mean),
  };
}

function compare({ before, after, runs = 300, seasons = 1 }) {
  const t0 = Date.now();
  const rb = toSimRules(before, 'publiée'), ra = toSimRules(after, 'brouillon');
  const profiles = Object.entries(sim.PROFILES).map(([id, profile]) => {
    const options = { chests: 'none', shopBuy: true, shopOpenings: sim.SHOP_OPENINGS[id] };
    const run = rules => metrics(sim.simulatePlayers({ profile, rules, runs, seasons, seed: 49, options }), seasons);
    return { id, label: profile.label, before: run(rb), after: run(ra) };
  });
  return { profiles, runs, seasons, ms: Date.now() - t0 };
}

if (require.main === module) {
  let input = '';
  process.stdin.on('data', c => { input += c; });
  process.stdin.on('end', () => {
    try { process.stdout.write(JSON.stringify(compare(JSON.parse(input)))); }
    catch (err) { console.error(err.message); process.exit(1); }
  });
}

module.exports = { toSimRules, compare };
