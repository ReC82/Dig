#!/usr/bin/env node
/**
 * pickaxe-night-sim.js — étude du 08/11/2026 (#71, décision du propriétaire) : la pioche à charges
 * comme FREIN à l'automatisation nocturne, avant son activation pour tous.
 *
 * Réutilise le simulateur de saisons de #49 (tools/balance/economy-sim.js, option `charges`) et ajoute :
 *   - un profil « bot nocturne » : 8 clics/s pendant 8 h chaque nuit, sans Auto-Dig ni joueur ;
 *   - les recharges en pièces (`refillPct` : achat de la formule dès la panne si elle est payable, au prix
 *     du jeu : 3 pièces/charge × (1 + 5 %/m), charges réellement ajoutées) — question « des pièces
 *     abondantes permettent-elles des recharges illimitées ? » ;
 *   - les arbres en gemmes au maximum (capacité ×15, recharge ×0,3) — pire cas « gros payeur en gemmes ».
 *   Réglages comparés : valeurs développées (1 500 coups / 3 s) et valeurs activées le 08/11 (5 000 / 2 s).
 *
 * Mesures (médianes sur `runs` saisons de 7 jours, nouveau joueur) : profondeur, blocs détruits au clic
 * (critère du classement, #73), part des coups à pleine puissance, pièces dépensées en recharges.
 *
 * Lancer : node tools/balance/pickaxe-night-sim.js [--runs 100]
 */

'use strict';

// Le simulateur charge server/db.js via economy-sim : base temporaire, jamais server/data/dig.sqlite
process.env.DB_FILE = process.env.DB_FILE || `/tmp/dig-pickaxe-night-sim-${process.pid}.sqlite`;

const path = require('path');
const sim = require(path.join(__dirname, 'economy-sim.js'));

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const PROFILES = {
  lent: { label: 'Occasionnel lent (20 min/j à 2 clics/s, 4 j/7)', activeMin: 20, cps: 2, idleMin: 0, idleCheckMin: 10, sessions: 1, days: [0, 2, 4, 5], ad: false, chests: 'none' },
  debutant: sim.PROFILES.debutant,
  regulier: sim.PROFILES.regulier,
  assidu: sim.PROFILES.assidu,
  auto: sim.PROFILES.auto,
  bot: { label: 'Bot nocturne (8 clics/s pendant 8 h, 7 nuits/7)', activeMin: 480, cps: 8, idleMin: 0, idleCheckMin: 10, sessions: 1, days: ALL_DAYS, ad: false, chests: 'none' },
};

const DEV = { capacity: 1500, regenS: 3, threshold: 0.1 };       // valeurs développées le 05/11
const LIVE = { capacity: 5000, regenS: 2, threshold: 0.1 };      // valeurs activées le 08/11
const MAXED = { capacity: 5000 * 15, regenS: 2 * 0.3, threshold: 0.1 };
const SETTINGS = {
  'jeu actuel (OFF)': null,
  '1 500/3 s': DEV,
  '1 500/3 s + recharges +50 %': { ...DEV, refillPct: 50 },
  '5 000/2 s (activé)': LIVE,
  '5 000/2 s + recharges +50 %': { ...LIVE, refillPct: 50 },
  '5 000/2 s, arbres au max (75 000/0,6 s)': MAXED,
  'arbres au max + recharges +50 %': { ...MAXED, refillPct: 50 },
};

function median(v) {
  const s = v.filter(x => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const i = (s.length - 1) / 2;
  return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2;
}

function run({ runs = 100, profiles = PROFILES, settings = SETTINGS } = {}) {
  const rules = sim.currentRules();
  const out = {};
  for (const [pid, profile] of Object.entries(profiles)) {
    out[pid] = { label: profile.label, rows: {} };
    for (const [sid, charges] of Object.entries(settings)) {
      const res = sim.simulatePlayers({ profile, rules, runs, options: charges ? { charges } : {} }).map(l => l[0]);
      const med = f => median(res.map(f));
      out[pid].rows[sid] = {
        maxDepth: med(m => m.maxDepth),
        manualBlocks: med(m => m.manualBlocks),
        coinsEarned: med(m => m.coinsEarned),
        fullShare: charges ? med(m => (m.hits ? (m.fullHits ?? 0) / m.hits : 1)) : null,
        refillCoins: charges ? med(m => m.refillCoins ?? 0) : null,
        refills: charges ? med(m => m.refills ?? 0) : null,
      };
    }
  }
  return out;
}

const f0 = v => (v === null || v === undefined || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('fr-FR'));
const pct = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)} %`);

function report(opts) {
  const res = run(opts);
  const lines = [];
  for (const p of Object.values(res)) {
    lines.push(`#### ${p.label}`, '');
    lines.push('| Réglage | Profondeur (m) | Perte | Blocs au clic (#73) | Perte | Coups à pleine puissance | Recharges achetées | Pièces en recharges |');
    lines.push('|---|---|---|---|---|---|---|---|');
    const ref = p.rows['jeu actuel (OFF)'];
    for (const [sid, r] of Object.entries(p.rows)) {
      const off = sid === 'jeu actuel (OFF)';
      lines.push(`| ${sid} | ${f0(r.maxDepth)} | ${off ? '—' : pct((ref.maxDepth - r.maxDepth) / ref.maxDepth)} | ${f0(r.manualBlocks)} | ${off ? '—' : pct((ref.manualBlocks - r.manualBlocks) / ref.manualBlocks)} | ${pct(r.fullShare)} | ${f0(r.refills)} | ${f0(r.refillCoins)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { PROFILES, SETTINGS, run, report };

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--runs');
  console.log(report({ runs: i >= 0 ? Number(args[i + 1]) : 100 }));
  try { require('fs').rmSync(process.env.DB_FILE, { force: true }); } catch { /* base temporaire */ }
}
