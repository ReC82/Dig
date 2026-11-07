#!/usr/bin/env node
/**
 * tools/balance/fragment-rarity-sim.js — rareté des fragments (#49, demande du propriétaire du 06/11).
 *
 * Compare la situation de production (tables v1 publiées #37, boutique de fragments en pièces
 * suspendue depuis le 05/11, coffres de boutique simple et rare illimités) aux préréglages de
 * server/rewardTables.js (PRESETS) : variante prudente (P), nettement plus rare (R), et R avec un
 * Aimant à éclats réduit (R+A, demanderait aussi une version du catalogue de reliques #64), et S
 * (#88 : aucun fragment dans les coffres de la boutique, coffres minés comme P).
 * Même moteur que economy-sim.js (vrai code du jeu, catalogue de blocs v3, hasard à graine) :
 * mêmes options → mêmes chiffres. Rien n'est appliqué au jeu ; aucun accès à une base.
 *
 * Lancer : node tools/balance/fragment-rarity-sim.js                 (rapport Markdown)
 *          node tools/balance/fragment-rarity-sim.js --runs 500      (aperçu rapide)
 *          options : --runs N (saisons 1–4, défaut 10 000) --hour-runs N (heures figées, défaut 10 000)
 *                    --pack-runs N (#85 et anciens/nouveaux, défaut 2 000)
 */

'use strict';

const path = require('path');
const sim = require('./economy-sim');
const { PRESETS } = require(path.join(__dirname, '..', '..', 'server', 'rewardTables'));

const SEASONS = 4;
const RELIC_LEVELS = sim.G.Relics.DEFS.reduce((a, d) => a + d.maxLevel, 0);           // 30
const RELIC_COST = sim.G.Relics.DEFS.reduce((a, d) => a + d.costs.reduce((x, y) => x + y, 0), 0);   // 1 617

/** Règles d'une variante : tables publiées (ou préréglage), limites de la boutique, Aimant. */
function variantRules(id) {
  const base = sim.currentRules();
  // Production au 06/11 : boutique de fragments en pièces suspendue et masquée (#69, 05/11)
  const prod = { ...base, id: 'actuel', fragmentShop: false };
  if (id === 'actuel') return prod;
  const presetId = { P: 'fragments_prudente', R: 'fragments_rare', 'R+A': 'fragments_rare', S: 'boutique_sans_fragments' }[id];
  const t = PRESETS[presetId].tables;
  return {
    ...prod, id,
    mineTables: structuredClone(t.mined),
    shopTables: Object.fromEntries(Object.entries(t.shop).map(([k, v]) => [k, structuredClone(v.table)])),
    shopLimits: Object.fromEntries(Object.entries(t.shop).map(([k, v]) => [k, v.maxPerSeason])),
    magnet: id === 'R+A' ? [1, 1, 2, 2, 3] : null,
  };
}

const VARIANT_IDS = ['actuel', 'P', 'R', 'R+A', 'S'];
const VARIANT_LABELS = {
  actuel: 'Actuel (production)',
  P: 'P — prudente',
  R: 'R — nettement plus rare',
  'R+A': 'R + Aimant réduit (1/1/2/2/3)',
  S: 'S — boutique sans fragments (#88)',
};

/** Options de profil : sans achats de coffres de la boutique, ou avec (hypothèses du 04/11). */
function profileOptions(pid, withShop) {
  return withShop ? { chests: 'none', shopBuy: true, shopOpenings: sim.SHOP_OPENINGS[pid] } : { chests: 'none' };
}

/** Saisons 1–4 consécutives (reliques et fragments conservés), métriques par saison. */
function seasonsFor(pid, vid, withShop, runs) {
  const results = sim.simulatePlayers({ profile: sim.PROFILES[pid], rules: variantRules(vid), runs, seasons: SEASONS, seed: 49,
    options: profileOptions(pid, withShop) });
  return Array.from({ length: SEASONS }, (_, k) => {
    const s = sim.summarize(results, k);
    const ms = results.map(l => l[k]);
    const prev = k ? results.map(l => l[k - 1].relicLevels) : results.map(() => 0);
    return {
      depth: s.maxDepth, frags: s.fragsEarned, fragsPerH: s.fragsPerH, fragsMine: s.fragsMine, fragsShop: s.fragsShopChests,
      relicLevels: s.relicLevels, playedH: s.playedH,
      // Frustration : part des joueurs qui ne gagnent AUCUN niveau de relique pendant cette semaine
      noRelicWeek: ms.filter((m, i) => m.relicLevels - prev[i] <= 0).length / ms.length,
      allMax: ms.filter(m => m.relicLevels >= RELIC_LEVELS).length / ms.length,
    };
  });
}

/** Une heure à équipement figé (coffres minés seulement) : fragments/h selon la profondeur. */
function hourFor(fixed, vid, runs) {
  return sim.hourAt({ ...fixed, rules: variantRules(vid) }, runs);
}

/**
 * Anciens / nouveaux joueurs : un « ancien » a joué 4 saisons au régime actuel (avec achats de
 * coffres), puis passe au nouveau régime ; un « nouveau » commence directement au nouveau régime.
 */
function oldVsNew(pid, vid, runs) {
  const o = { ...sim.PROFILES[pid], ...profileOptions(pid, true) };
  const now = sim.currentRules();
  const actuel = variantRules('actuel'), next = variantRules(vid);
  const olds = [], news = [];
  for (let r = 0; r < runs; r++) {
    const random = sim.rng(85 * 100_003 + r);
    const p = sim.newPlayer(o);
    for (let k = 0; k < 4; k++) sim.playSeason(p, actuel, o, random, k);
    olds.push(sim.playSeason(p, next, o, random, 4));
    const q = sim.newPlayer(o);
    news.push(sim.playSeason(q, next, o, sim.rng(86 * 100_003 + r), 4));
  }
  void now;
  return { old: sim.describe(olds.map(m => m.maxDepth)), oldRelics: sim.describe(olds.map(m => m.relicLevels)),
    new: sim.describe(news.map(m => m.maxDepth)), newRelics: sim.describe(news.map(m => m.relicLevels)) };
}

/**
 * #85 : `packs` lots de 10 fragments achetés au début de la saison 1 (une seule fois), sans autre
 * changement. Mêmes graines que sans lot : l'écart ne vient que des fragments ajoutés.
 */
function packsFor(pid, vid, packs, runs) {
  const o = { ...sim.PROFILES[pid], ...profileOptions(pid, false) };
  const rules = variantRules(vid);
  const out = Array.from({ length: SEASONS }, () => ({ depth: [], relics: [] }));
  for (let r = 0; r < runs; r++) {
    const random = sim.rng(49 * 100_003 + r);
    const p = sim.newPlayer(o);
    p.frags += packs * 10;
    for (let k = 0; k < SEASONS; k++) {
      const m = sim.playSeason(p, rules, o, random, k);
      out[k].depth.push(m.maxDepth); out[k].relics.push(m.relicLevels);
    }
  }
  return out.map(x => ({ depth: sim.describe(x.depth), relics: sim.describe(x.relics) }));
}

// ── Rapport ──────────────────────────────────────────────────────────────────

const f0 = x => (x == null || !Number.isFinite(x) ? '—' : Math.round(x).toLocaleString('fr-BE'));
const f1 = x => (x == null || !Number.isFinite(x) ? '—' : (Math.round(x * 10) / 10).toLocaleString('fr-BE'));
const pct = x => `${Math.round(x * 100)} %`;
const rel = (a, b) => (b ? `${a >= b ? '+' : '−'}${Math.abs(Math.round((a / b - 1) * 1000) / 10).toLocaleString('fr-BE')} %` : '—');

function report({ runs, hourRuns, packRuns }) {
  const lines = [];
  const say = s => lines.push(s);
  const all = { seasons: {}, hours: {}, oldNew: {}, packs: {} };

  say(`#### Espérance par ouverture (sans Aimant) — fragments · pièces`);
  say('');
  say(`| Coffre | ${VARIANT_IDS.map(v => VARIANT_LABELS[v]).join(' | ')} |`);
  say(`|---|${VARIANT_IDS.map(() => '---').join('|')}|`);
  for (const [fam, ids] of [['mined', ['commun', 'rare', 'epique']], ['shop', ['simple', 'rare', 'antique']]]) {
    for (const id of ids) {
      const cells = VARIANT_IDS.map(v => {
        const r = variantRules(v);
        const table = fam === 'mined' ? r.mineTables[id] : r.shopTables[id];
        const e = sim.chestExpectation(table, 0, 1, fam === 'shop');
        const lim = fam === 'shop' ? ` · ${r.shopLimits[id] ?? '∞'}/saison` : '';
        return `${f1(e.frags * 100 / 100)} 🔮 · ${f0(e.coins)} 💰${lim}`;
      });
      say(`| ${fam === 'mined' ? 'Miné' : 'Boutique'} — ${id} | ${cells.join(' | ')} |`);
    }
  }
  say('');
  say(`Reliques : ${RELIC_LEVELS} niveaux, ${f0(RELIC_COST)} 🔮 au total. Plafond de conversion pièces → fragments par saison (espérance, boutique au maximum des limites, sans Aimant) : ` +
    VARIANT_IDS.map(v => {
      const r = variantRules(v);
      const tot = ['simple', 'rare', 'antique'].map(id => {
        const lim = r.shopLimits[id];
        const e = sim.chestExpectation(r.shopTables[id], 0, 1, true);
        return lim == null ? Infinity : lim * (e.frags + e.collection * 5);
      }).reduce((a, b) => a + b, 0);
      return `${VARIANT_LABELS[v]} = ${Number.isFinite(tot) ? `${f0(tot)} 🔮 (${f1(tot / RELIC_COST * 100)} % des reliques)` : 'illimité'}`;
    }).join(' ; ') + '.');
  say('');

  say(`#### Fragments par heure selon la profondeur — équipement figé, coffres minés seulement, ${hourRuns.toLocaleString('fr-BE')} heures par ligne (médiane · p90)`);
  say('');
  say(`| Équipement | ${VARIANT_IDS.map(v => VARIANT_LABELS[v]).join(' | ')} |`);
  say(`|---|${VARIANT_IDS.map(() => '---').join('|')}|`);
  for (const fx of sim.FIXED) {
    const cells = VARIANT_IDS.map(v => {
      const h = hourFor(fx, v, hourRuns);
      (all.hours[fx.label] ??= {})[v] = h.frags;
      return `${f1(h.frags.p50)} · ${f1(h.frags.p90)}`;
    });
    say(`| ${fx.label} | ${cells.join(' | ')} |`);
  }
  say('');

  for (const withShop of [false, true]) {
    say(`#### Saisons 1 → 4 ${withShop ? 'AVEC achats de coffres de la boutique (hypothèses du 04/11 : 50 / 300 / 1 800 / 300 ouvertures max. par saison)' : 'SANS achat de coffres de la boutique'} — ${runs.toLocaleString('fr-BE')} joueurs par profil et par variante`);
    say('');
    for (const pid of Object.keys(sim.PROFILES)) {
      say(`##### ${sim.PROFILES[pid].label}`);
      say('');
      say('| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l\'actuel |');
      say('|---|---|---|---|---|---|---|---|---|');
      const base = seasonsFor(pid, 'actuel', withShop, runs);
      for (const v of VARIANT_IDS) {
        const ss = v === 'actuel' ? base : seasonsFor(pid, v, withShop, runs);
        (all.seasons[`${pid}|${withShop ? 'shop' : 'noshop'}`] ??= {})[v] = ss;
        ss.forEach((s, k) => {
          say(`| ${k === 0 ? VARIANT_LABELS[v] : ''} | S${k + 1} | ${f0(s.frags.p50)} · ${f0(s.frags.p90)} | ${f1(s.fragsPerH.p50)} · ${f1(s.fragsPerH.p90)} | ${f0(s.relicLevels.p50)} | ${pct(s.noRelicWeek)} | ${pct(s.allMax)} | ${f0(s.depth.p50)} m | ${v === 'actuel' ? '—' : rel(s.depth.p50, base[k].depth.p50)} |`);
        });
      }
      say('');
    }
  }

  say(`#### Anciens et nouveaux joueurs — ${packRuns.toLocaleString('fr-BE')} joueurs (avec achats de coffres) : 4 saisons au régime actuel puis 1 au nouveau, contre un nouveau joueur`);
  say('');
  say('| Profil | Variante | Ancien : profondeur S5 · reliques | Nouveau : profondeur S1 · reliques | Écart de profondeur ancien / nouveau |');
  say('|---|---|---|---|---|');
  for (const pid of ['debutant', 'regulier', 'assidu']) {
    for (const v of VARIANT_IDS) {
      const x = oldVsNew(pid, v, packRuns);
      (all.oldNew[pid] ??= {})[v] = x;
      say(`| ${v === 'actuel' ? sim.PROFILES[pid].label : ''} | ${VARIANT_LABELS[v]} | ${f0(x.old.p50)} m · ${f0(x.oldRelics.p50)}/30 | ${f0(x.new.p50)} m · ${f0(x.newRelics.p50)}/30 | ${rel(x.old.p50, x.new.p50)} |`);
    }
  }
  say('');

  say(`#### #85 — lots de 10 fragments achetés une fois au début de la saison 1 (sans achat de coffres) — ${packRuns.toLocaleString('fr-BE')} joueurs`);
  say('');
  say('| Profil | Variante | Lots | Reliques S1 · S4 (médiane, /30) | Profondeur S1 · S4 (médiane) | Gain de profondeur S1 · S2 · S4 vs 0 lot |');
  say('|---|---|---|---|---|---|');
  for (const pid of ['debutant', 'regulier', 'assidu']) {
    for (const v of ['actuel', 'R']) {
      const zero = packsFor(pid, v, 0, packRuns);
      for (const k of [0, 1, 2, 5, 10]) {
        const x = k ? packsFor(pid, v, k, packRuns) : zero;
        (all.packs[`${pid}|${v}`] ??= {})[k] = x;
        say(`| ${k === 0 && v === 'actuel' ? sim.PROFILES[pid].label : ''} | ${k === 0 ? VARIANT_LABELS[v] : ''} | ${k} | ${f0(x[0].relics.p50)} · ${f0(x[3].relics.p50)} | ${f0(x[0].depth.p50)} · ${f0(x[3].depth.p50)} m | ${k ? [0, 1, 3].map(s => rel(x[s].depth.p50, zero[s].depth.p50)).join(' · ') : '—'} |`);
      }
    }
  }
  return { markdown: lines.join('\n'), all };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def; };
  const t0 = Date.now();
  const { markdown, all } = report({ runs: opt('--runs', 10_000), hourRuns: opt('--hour-runs', 10_000), packRuns: opt('--pack-runs', 2_000) });
  console.log(args.includes('--json') ? JSON.stringify(all) : markdown);
  console.error(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

module.exports = { variantRules, VARIANT_IDS, seasonsFor, hourFor, packsFor, oldVsNew, report, RELIC_LEVELS, RELIC_COST };
