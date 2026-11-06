#!/usr/bin/env node
/**
 * tools/balance/fragment-pack-sim.js — risque pay-to-win du lot de 10 fragments en euros (#85).
 *
 * Même moteur que economy-sim.js / fragment-rarity-sim.js (vrai code du jeu, catalogue de blocs v3,
 * reliques d'origine, hasard à graine) : mêmes options → mêmes chiffres. Rien n'est appliqué au jeu,
 * aucun accès à une base. Barèmes de coffres : production (tables v1, relevé du 06/11) et
 * préréglages P et R de #49 (non publiés). Sans achat de coffres de la boutique (prudent : les
 * coffres de boutique illimités convertissent déjà des pièces en fragments, voir #49).
 *
 * Mesures, pour les profils débutant / régulier / assidu :
 *   1. temps de jeu et jour de saison pour obtenir 10 fragments gratuitement (saison 1) ;
 *   2. lots achetés UNE fois au début de la saison 1 : 0 / 1 / 2 / 5 / 10 ;
 *   3. payeur régulier : k lots achetés au début de CHAQUE saison (1 / 2 / 5 / 10) ;
 *   → niveaux de reliques, profondeur, blocs détruits au clic (critère du classement #73) en S1…S4,
 *     écart au non-payeur (mêmes graines : l'écart ne vient que des fragments achetés) et rang du
 *     payeur médian parmi les non-payeurs du même profil.
 *
 * Lancer : node tools/balance/fragment-pack-sim.js                (rapport Markdown, 2 000 joueurs)
 *          node tools/balance/fragment-pack-sim.js --runs 200     (aperçu rapide)
 *          options : --runs N  --variants actuel,P,R  --json
 */

'use strict';

const sim = require('./economy-sim');
const { variantRules } = require('./fragment-rarity-sim');

const SEASONS = 4;
const PACK = 10;
const PROFILE_IDS = ['debutant', 'regulier', 'assidu'];
const VARIANT_LABELS = { actuel: 'Production (tables v1)', P: 'P — prudente (#49)', R: 'R — nettement plus rare (#49)' };
const DAY_S = 86_400;

/** Scénarios d'achat : lots achetés au début de la saison k (0 = S1). */
const SCENARIOS = [
  { id: 'none',  label: 'Non-payeur',                 packsAt: () => 0 },
  { id: 'once1', label: '1 lot une fois (S1)',        packsAt: k => (k === 0 ? 1 : 0) },
  { id: 'once2', label: '2 lots une fois (S1)',       packsAt: k => (k === 0 ? 2 : 0) },
  { id: 'once5', label: '5 lots une fois (S1)',       packsAt: k => (k === 0 ? 5 : 0) },
  { id: 'once10', label: '10 lots une fois (S1)',     packsAt: k => (k === 0 ? 10 : 0) },
  { id: 'each1', label: '1 lot chaque saison',        packsAt: () => 1 },
  { id: 'each2', label: '2 lots chaque saison',       packsAt: () => 2 },
  { id: 'each5', label: '5 lots chaque saison',       packsAt: () => 5 },
  { id: 'each10', label: '10 lots chaque saison',     packsAt: () => 10 },
  // Protection étudiée (scénario A) : mission gratuite unique de 10 🔮 pour TOUS en S1 ; le payeur
  // ajoute 1 lot à vie. Comparé au non-payeur qui a fait la mission (base: 'mission').
  { id: 'mission', label: 'Non-payeur + mission gratuite 10 🔮 (S1)', packsAt: () => 0, freeAt: k => (k === 0 ? 1 : 0) },
  { id: 'missionOnce1', label: 'Mission gratuite + 1 lot à vie', packsAt: k => (k === 0 ? 1 : 0), freeAt: k => (k === 0 ? 1 : 0), base: 'mission' },
];

const relicSpent = relics => sim.G.Relics.DEFS.reduce((a, d) => a + d.costs.slice(0, relics[d.id] || 0).reduce((x, y) => x + y, 0), 0);

/** Secondes de jeu (actif + onglet ouvert) écoulées à l'instant `t` de la saison, selon l'emploi du temps du profil. */
function playedAt(o, t) {
  const sessLen = (o.activeMin + o.idleMin) * 60 / o.sessions;
  const gap = (DAY_S - (o.activeMin + o.idleMin) * 60) / o.sessions;
  const day = Math.floor(t / DAY_S);
  let played = o.days.filter(d => d < day).length * sessLen * o.sessions;
  if (o.days.includes(day)) {
    for (let k = 0; k < o.sessions; k++) {
      const start = day * DAY_S + 8 * 3600 + k * (sessLen + gap);
      played += Math.min(sessLen, Math.max(0, t - start));
    }
  }
  return played;
}

/**
 * Un joueur sur 4 saisons. `packsAt(k)` lots crédités au début de la saison k (avant tout minage).
 * Renvoie les métriques par saison et, en S1, l'instant où 10 fragments GRATUITS sont atteints.
 */
function playOne(pid, rules, packsAt, seed, freeAt = () => 0) {
  const o = { ...sim.PROFILES[pid], chests: 'none' };
  const random = sim.rng(85 * 100_003 + seed);
  const p = sim.newPlayer(o);
  let bought = 0, free10 = null;
  o.onBlock = (_type, _depth, t) => {
    if (free10 || season > 0) return;
    if (p.frags + relicSpent(p.relics) - bought >= PACK) free10 = { day: Math.floor(t / DAY_S) + 1, hours: playedAt(o, t) / 3600 };
  };
  let season = 0;
  const out = [];
  for (; season < SEASONS; season++) {
    const add = packsAt(season) * PACK;
    p.frags += add + freeAt(season) * PACK; bought += add;
    const m = sim.playSeason(p, rules, o, random, season);
    out.push({ depth: m.maxDepth, manual: m.manualBlocks, relics: m.relicLevels, fragsFree: m.fragsEarned, playedH: m.playedH });
  }
  return { seasons: out, free10 };
}

const median = a => sim.describe(a).p50;
/** Part des valeurs de `ref` strictement inférieures à x : rang centile du joueur x parmi `ref`. */
const rankAmong = (x, ref) => ref.filter(v => v < x).length / ref.length;

function runCell(pid, vid, runs) {
  const rules = variantRules(vid);
  const res = {};
  for (const sc of SCENARIOS) res[sc.id] = Array.from({ length: runs }, (_, r) => playOne(pid, rules, sc.packsAt, r, sc.freeAt));
  return res;
}

function summarizeCell(res) {
  const base = res.none;
  const out = { free10: null, scenarios: {} };
  const reached = base.filter(x => x.free10);
  out.free10 = {
    share: reached.length / base.length,
    hours: reached.length ? sim.describe(reached.map(x => x.free10.hours)) : null,
    day: reached.length ? sim.describe(reached.map(x => x.free10.day)) : null,
  };
  for (const sc of SCENARIOS) {
    const list = res[sc.id];
    const ref = res[sc.base ?? 'none'];
    out.scenarios[sc.id] = Array.from({ length: SEASONS }, (_, k) => {
      const depth = list.map(x => x.seasons[k].depth), manual = list.map(x => x.seasons[k].manual), relics = list.map(x => x.seasons[k].relics);
      const refManual = ref.map(x => x.seasons[k].manual);
      const medManual = median(manual);
      // Gain individuel (mêmes graines) : blocs au clic du payeur vs le même joueur sans achat
      const gains = list.map((x, i) => x.seasons[k].manual / Math.max(1, ref[i].seasons[k].manual) - 1);
      return {
        depth: median(depth), manual: medManual, relics: median(relics),
        gainMedian: median(gains), gainP90: sim.describe(gains).p90,
        rank: rankAmong(medManual, refManual),                  // rang centile du payeur médian parmi les non-payeurs
        beatsMedian: manual.filter(v => v > median(refManual)).length / manual.length,
        cumulPacks: Array.from({ length: k + 1 }, (_, j) => sc.packsAt(j)).reduce((a, b) => a + b, 0),
      };
    });
  }
  return out;
}

// ── Rapport ──────────────────────────────────────────────────────────────────

const f0 = x => (x == null || !Number.isFinite(x) ? '—' : Math.round(x).toLocaleString('fr-BE'));
const f1 = x => (x == null || !Number.isFinite(x) ? '—' : (Math.round(x * 10) / 10).toLocaleString('fr-BE'));
const pct = x => (x == null || !Number.isFinite(x) ? '—' : `${Math.round(x * 100)} %`);
const sgn = x => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 1000) / 10).toLocaleString('fr-BE')} %`);

function report({ runs, variants }) {
  const lines = [];
  const say = s => lines.push(s);
  const all = {};
  for (const vid of variants) for (const pid of PROFILE_IDS) all[`${pid}|${vid}`] = summarizeCell(runCell(pid, vid, runs));

  say(`#### 1. Obtenir 10 fragments gratuitement (saison 1, sans achat) — ${runs.toLocaleString('fr-BE')} joueurs par ligne`);
  say('');
  say('| Profil | Barème | Atteint en S1 | Heures de jeu (médiane · p90) | Jour de saison (médiane · p90) |');
  say('|---|---|---|---|---|');
  for (const pid of PROFILE_IDS) {
    variants.forEach((vid, i) => {
      const x = all[`${pid}|${vid}`].free10;
      say(`| ${i === 0 ? sim.PROFILES[pid].label : ''} | ${VARIANT_LABELS[vid]} | ${pct(x.share)} | ${x.hours ? `${f1(x.hours.p50)} h · ${f1(x.hours.p90)} h` : '—'} | ${x.day ? `J${f0(x.day.p50)} · J${f0(x.day.p90)}` : '—'} |`);
    });
  }
  say('');
  say('Heures de jeu = actif + onglet ouvert, comme dans les rapports #49. « Jour » = jour de la saison de 7 jours (J8 = pas atteint dans la saison).');
  say('');

  for (const vid of variants) {
    say(`#### 2. Payeurs vs non-payeur — ${VARIANT_LABELS[vid]} — ${runs.toLocaleString('fr-BE')} joueurs par ligne, mêmes graines`);
    say('');
    say('Colonnes S1 · S2 · S4. « Blocs au clic » = critère du classement saisonnier (#73). « Gain » = écart médian de blocs au clic du même joueur avec et sans achat. « Rang » = centile du payeur médian parmi les non-payeurs du même profil (50 % = au milieu).');
    say('');
    for (const pid of PROFILE_IDS) {
      const c = all[`${pid}|${vid}`].scenarios;
      say(`##### ${sim.PROFILES[pid].label}`);
      say('');
      say('| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |');
      say('|---|---|---|---|---|---|---|---|');
      for (const sc of SCENARIOS) {
        const s = c[sc.id];
        const ref = sc.id === 'none' || sc.id === 'mission';
        say(`| ${sc.label}${sc.base ? ` (vs « ${SCENARIOS.find(b => b.id === sc.base).label} »)` : ''} | ${s[3].cumulPacks} | ${[0, 1, 3].map(k => f0(s[k].relics)).join(' · ')} | ${f0(s[0].depth)} · ${f0(s[3].depth)} m | ${f0(s[0].manual)} · ${f0(s[3].manual)} | ${ref ? '—' : [0, 1, 3].map(k => sgn(s[k].gainMedian)).join(' · ')} | ${ref ? '—' : sgn(s[3].gainP90)} | ${ref ? '—' : `${pct(s[0].rank)} · ${pct(s[3].rank)}`} |`);
      }
      say('');
    }
  }
  return { markdown: lines.join('\n'), all };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
  const t0 = Date.now();
  const { markdown, all } = report({ runs: Number(opt('--runs', 2_000)), variants: String(opt('--variants', 'actuel,P,R')).split(',') });
  console.log(args.includes('--json') ? JSON.stringify(all) : markdown);
  console.error(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

module.exports = { SCENARIOS, PROFILE_IDS, playOne, playedAt, runCell, summarizeCell, report };
