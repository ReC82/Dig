#!/usr/bin/env node
/**
 * pickaxe-charges-sim.js — étude du ticket #71 : pioche à charges (réserve de coups).
 *
 * Réutilise le simulateur de saisons de #49 (tools/balance/economy-sim.js : vrai code du jeu,
 * catalogue de blocs publié, achats d'améliorations, gains hors ligne, profils de joueurs) avec
 * l'option `charges` : chaque coup MANUEL consomme 1 charge ; à 0, la pioche est émoussée (1 dégât,
 * sans bonus) jusqu'au seuil de reprise ; recharge continue y compris hors ligne ; Auto-Dig exclu.
 *
 * Mesures par profil et par réglage (médianes sur `runs` saisons de 7 jours, nouveau joueur) :
 * profondeur atteinte et perte par rapport au jeu actuel, coups par jour joué, part des coups à
 * pleine puissance, temps de jeu actif avant la première panne, pannes par jour.
 *
 * Lancer : node tools/balance/pickaxe-charges-sim.js            (rapport Markdown, 200 saisons)
 *          node tools/balance/pickaxe-charges-sim.js --runs 50  (plus rapide)
 *          node tools/balance/pickaxe-charges-sim.js --json
 */

'use strict';

const path = require('path');
const sim = require(path.join(__dirname, 'economy-sim.js'));

/** Profils de #49, plus un profil « 100 m par jour » (forte session selon le propriétaire). */
const PROFILES = {
  ...sim.PROFILES,
  lent: { label: 'Occasionnel lent (20 min/j à 2 clics/s, 4 j/7)', activeMin: 20, cps: 2, idleMin: 0, idleCheckMin: 10, sessions: 1, days: [0, 2, 4, 5], ad: false, chests: 'none' },
};

/** Réglages comparés : capacité (coups), recharge (s/coup), seuil de reprise (part de la capacité). */
const SETTINGS = {
  'jeu actuel':           null,
  'exploratoire 100/10 s': { capacity: 100,  regenS: 10, threshold: 0.1 },
  '300/10 s':             { capacity: 300,  regenS: 10, threshold: 0.1 },
  '1 000/5 s':            { capacity: 1000, regenS: 5,  threshold: 0.1 },
  '1 000/3 s':            { capacity: 1000, regenS: 3,  threshold: 0.1 },
  '1 500/3 s':            { capacity: 1500, regenS: 3,  threshold: 0.1 },
  '2 000/3 s':            { capacity: 2000, regenS: 3,  threshold: 0.1 },
  '3 000/2 s':            { capacity: 3000, regenS: 2,  threshold: 0.1 },
  '5 000/1 s':            { capacity: 5000, regenS: 1,  threshold: 0.1 },
};

function run({ runs = 200, profiles = PROFILES, settings = SETTINGS } = {}) {
  const rules = sim.currentRules();
  const out = {};
  for (const [pid, profile] of Object.entries(profiles)) {
    out[pid] = { label: profile.label, days: profile.days.length, rows: {} };
    for (const [sid, charges] of Object.entries(settings)) {
      const res = sim.simulatePlayers({ profile, rules, runs, options: charges ? { charges } : {} }).map(l => l[0]);
      const med = f => median(res.map(f));
      out[pid].rows[sid] = {
        maxDepth: med(m => m.maxDepth),
        coinsEarned: med(m => m.coinsEarned),
        hitsPerDay: charges ? med(m => (m.hits ?? 0) / profile.days.length) : null,
        fullShare: charges ? med(m => (m.hits ? (m.fullHits ?? 0) / m.hits : 1)) : null,
        firstEmptyMin: charges ? minutes(median(res.map(m => m.firstEmptyS ?? null))) : null,
        emptyShare: charges ? res.filter(m => m.firstEmptyS != null).length / res.length : null,
        depletionsPerDay: charges ? med(m => (m.depletions ?? 0) / profile.days.length) : null,
      };
    }
    // Coups manuels d'une journée au jeu actuel = référence de cadence
    const base = sim.simulatePlayers({ profile, rules, runs: Math.min(runs, 50), options: { charges: { capacity: 1e12, regenS: 1, threshold: 0 } } }).map(l => l[0]);
    out[pid].hitsPerDayBase = median(base.map(m => (m.hits ?? 0) / profile.days.length));
  }
  return out;
}

const minutes = s => (s === null ? null : s / 60);

function median(v) {
  const s = v.filter(x => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) / 2;
  return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2;
}

const f0 = v => (v === null || v === undefined || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('fr-FR'));
const pct = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);

function report(opts) {
  const res = run(opts);
  const lines = [];
  for (const [, p] of Object.entries(res)) {
    lines.push(`#### ${p.label} — ${f0(p.hitsPerDayBase)} coups manuels par jour joué au jeu actuel`, '');
    lines.push('| Réglage | Profondeur max (m) | Perte vs actuel | Pièces gagnées | Coups/jour | Coups à pleine puissance | 1re panne après (min de jeu actif) | Saisons avec panne | Pannes/jour |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    const ref = p.rows['jeu actuel'].maxDepth;
    for (const [sid, r] of Object.entries(p.rows)) {
      const loss = sid === 'jeu actuel' ? '—' : pct((ref - r.maxDepth) / ref);
      lines.push(`| ${sid} | ${f0(r.maxDepth)} | ${loss} | ${f0(r.coinsEarned)} | ${f0(r.hitsPerDay)} | ${pct(r.fullShare)} | ${r.firstEmptyMin === null ? '—' : r.firstEmptyMin.toFixed(1)} | ${pct(r.emptyShare)} | ${r.depletionsPerDay === null ? '—' : r.depletionsPerDay.toFixed(1)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { PROFILES, SETTINGS, run, report };

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--runs');
  const runs = i >= 0 ? Number(args[i + 1]) : 200;
  if (args.includes('--json')) console.log(JSON.stringify(run({ runs }), null, 2));
  else console.log(report({ runs }));
}
