#!/usr/bin/env node
/**
 * november-event-sim.js — « Novembre déterre l'Histoire » (#86) : chances d'obtenir les 30 souvenirs
 * en un mois, et poids cumulé des bonus de souvenirs envisagés (aucun n'est actif).
 *
 * Drops : réutilise le simulateur économique #49 (tools/balance/economy-sim.js : VRAI code du jeu,
 * blocs et PV par profondeur, pioche, Auto-Dig, reliques, rotation hebdomadaire des saisons qui
 * remet la profondeur à 1). Le tirage reproduit server/monthlyEvents.processSave : chaque objet
 * activé, pas encore possédé, est tiré indépendamment sur chaque bloc validé éligible (profondeur
 * retenue ≥ minDepth, catégorie dans dropFrom, vide = tous) avec `chancePct` % ; un objet s'obtient
 * une seule fois. Plusieurs objets peuvent tomber sur le même bloc (comme côté serveur).
 *
 * Le barème lu est celui du fichier préparé server/content/events/novembre-histoire-2026.json
 * (proposition, événement en brouillon) ; `--scale` permet d'essayer un multiplicateur.
 *
 * Lancer : node tools/balance/november-event-sim.js [--runs 10000] [--scale 1]
 *          node tools/balance/november-event-sim.js --bonus    (poids des variantes de bonus)
 * Aucun accès réseau ni base de données ; rien n'est activé ni publié.
 */

'use strict';

const fs = require('fs');
const path = require('path');
// Base temporaire AVANT tout chargement du code serveur (server/db.js fixe son chemin au chargement) :
// jamais server/data/, jamais la base de production
if (!process.env.DB_FILE) process.env.DB_FILE = path.join(require('os').tmpdir(), `dig-nov86-sim-${process.pid}.sqlite`);
const sim = require(path.join(__dirname, 'economy-sim.js'));
const EVENT = require(path.join(__dirname, '..', '..', 'server', 'content', 'events', 'novembre-histoire-2026.json'));

const DAYS = 30;
const CHECK_DAYS = [1, 5, 15, 22, 30];

/** Profils #49 + nouvel entrant (compte créé le 09/11 : 22 jours de novembre). */
const PROFILES = {
  debutant: { ...sim.PROFILES.debutant, label: 'Occasionnel (20 min/j, 4 j/7)', hoursPerDay: 20 / 60 * 4 / 7 },
  entrant:  { ...sim.PROFILES.regulier, label: 'Invité du 09/11 (1 h/j, 22 jours)', hoursPerDay: 1, days: [0, 1, 2, 3, 4, 5, 6], startDay: 8 },
  regulier: { ...sim.PROFILES.regulier, label: 'Régulier (1 h/j)', hoursPerDay: 1 },
  assidu:   { ...sim.PROFILES.assidu, label: 'Assidu (3 h/j + 4 h onglet)', hoursPerDay: 3 },
  auto:     { ...sim.PROFILES.auto, label: 'Auto-Dig (15 min/j + 8 h onglet)', hoursPerDay: 0.25 },
};

function rng(seed) {   // mulberry32, indépendant du hasard du jeu
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * @returns {{ runs, items: {id, rarity, found}[], byDay: {day, mean, all}[], all, byRarity, blocks }}
 *   found = part des joueurs qui ont l'objet fin novembre ; byDay = nombre moyen d'objets et
 *   part de collections complètes à la fin du jour N de jeu.
 */
function run(profile, { runs = 10000, scale = 1, seed = 86, items = EVENT.items } = {}) {
  const list = items.filter(i => i.enabled !== false).map(i => ({ ...i, p: Math.min(1, i.chancePct * scale / 100) }));
  const days = DAYS - (profile.startDay || 0);
  const seasons = Math.ceil(days / 7);
  const rules = sim.currentRules();
  const found = Object.fromEntries(list.map(i => [i.id, 0]));
  const atDay = CHECK_DAYS.filter(d => d <= days);
  const sumAt = atDay.map(() => 0), allAt = atDay.map(() => 0);
  const blocks = [];
  for (let r = 0; r < runs; r++) {
    const random = rng(seed * 7919 + r);
    const owned = new Map();   // id → jour
    let seasonIdx = -1, last = Infinity, n = 0;
    const onBlock = (type, depth, t) => {
      if (depth < last) seasonIdx++;
      last = depth;
      const day = seasonIdx * 7 + Math.floor(t / 86_400);
      if (day >= days) return;
      n++;
      for (const it of list) {
        if (owned.has(it.id) || depth < (it.minDepth || 0)) continue;
        if (it.dropFrom?.length && !it.dropFrom.includes(type.category)) continue;
        if (random() < it.p) owned.set(it.id, day);
      }
    };
    sim.simulatePlayers({ profile, rules, runs: 1, seasons, seed: seed * 13 + r, options: { onBlock } });
    for (const id of owned.keys()) found[id]++;
    atDay.forEach((d, k) => {
      let c = 0;
      for (const day of owned.values()) if (day < d) c++;
      sumAt[k] += c;
      if (c === list.length) allAt[k]++;
    });
    blocks.push(n);
  }
  blocks.sort((a, b) => a - b);
  const byRarity = {};
  for (const it of list) (byRarity[it.rarity] ??= []).push(found[it.id] / runs);
  return {
    runs, days, count: list.length,
    items: list.map(i => ({ id: i.id, rarity: i.rarity, chancePct: i.chancePct * scale, found: found[i.id] / runs })),
    byDay: atDay.map((d, k) => ({ day: d, hours: Math.round(d * profile.hoursPerDay * 10) / 10, mean: sumAt[k] / runs, all: allAt[k] / runs })),
    all: allAt[allAt.length - 1] / runs,
    byRarity: Object.fromEntries(Object.entries(byRarity).map(([k, v]) => [k, v.reduce((s, x) => s + x, 0) / v.length])),
    blocks: { p10: blocks[Math.floor(runs * 0.1)], p50: blocks[Math.floor(runs * 0.5)], p90: blocks[Math.floor(runs * 0.9)] },
  };
}

// ── Bonus de souvenirs : poids cumulé (modèle #81, public/js/microBonus.js) ───────────────────────

/**
 * Deux variantes à arbitrer (AUCUNE n'est active). Valeurs en dégâts par coup manuel, cumul plafonné.
 *   constante  : chaque souvenir +0,01 permanent sur une nature de bloc (cap du cumul : +0,10) ;
 *   calendaire : chaque souvenir +0,03 sur une nature de bloc, actif les jeudis seulement (cap +0,30
 *                le jeudi, soit ≈ +0,043 en moyenne sur la semaine).
 * Effet mesuré par le simulateur #81 (server/microBonusDrafts.simulate) en coups économisés.
 */
const BONUS_VARIANTS = {
  constante: { label: 'Constante : +0,01 par souvenir, toujours actif, cumul plafonné à +0,10', perItem: 0.01, cap: 0.10, activeShare: 1 },
  calendaire: { label: 'Calendaire : +0,03 par souvenir, le jeudi seulement, cumul plafonné à +0,30', perItem: 0.03, cap: 0.30, activeShare: 1 / 7 },
};

/**
 * Poids des deux variantes pour un collectionneur au plafond (pire cas) : avantage en blocs détruits
 * à nombre de coups égal (le classement #73 compte les blocs détruits manuellement), par profondeur
 * et dégâts de base. Calcul exact du simulateur #81 sur le catalogue publié (base temporaire).
 */
function bonusReport({ depths = [10, 30, 60, 100], bases = [1, 2, 5, 10] } = {}) {
  const db = require('../../server/db');
  db.initDb();
  require('../../server/blockCatalog').init();
  const drafts = require('../../server/microBonusDrafts');
  const out = [];
  for (const [key, v] of Object.entries(BONUS_VARIANTS)) {
    out.push(`\n#### ${v.label}\n`);
    out.push(`| Profondeur | ${bases.map(b => `${b} dégât${b > 1 ? 's' : ''} de base`).join(' | ')} |`);
    out.push(`|---|${bases.map(() => '---').join('|')}|`);
    for (const depth of depths) {
      const sim = drafts.simulate({ kind: 'damage_flat', value: v.cap, target: { type: 'all' }, schedule: {} }, { depth, bases });
      out.push(`| ${depth} m | ${sim.rows.map(r => key === 'constante' ? `+${r.moreBlocksPct} %` : `+${r.moreBlocksPct} % le jeudi · +${(r.moreBlocksPct * v.activeShare).toFixed(2)} % / semaine`).join(' | ')} |`);
    }
  }
  try {
    db.getDb().close();
    if (process.env.DB_FILE.includes('dig-nov86-sim-')) for (const x of ['', '-wal', '-shm']) fs.rmSync(process.env.DB_FILE + x, { force: true });
  } catch (_) { /* base temporaire */ }
  return out.join('\n');
}

const pct = x => (x >= 0.995 && x < 1 ? '> 99 %' : x > 0 && x < 0.005 ? '< 1 %' : `${Math.round(x * 100)} %`);

function report({ runs = 10000, scale = 1 } = {}) {
  const out = [];
  const say = s => out.push(s);
  say(`### Drops — ${runs} parcours de novembre par profil (barème du fichier préparé${scale !== 1 ? ` × ${scale}` : ''})\n`);
  const rar = ['commun', 'peu-commun', 'rare', 'epique', 'legendaire'];
  say(`| Profil | Blocs validés en novembre (médiane) | ${CHECK_DAYS.map(d => `Jour ${d}`).join(' | ')} | Collection complète | ${rar.join(' | ')} |`);
  say(`|---|---|${CHECK_DAYS.map(() => '---').join('|')}|---|${rar.map(() => '---').join('|')}|`);
  const results = {};
  for (const [pid, p] of Object.entries(PROFILES)) {
    const r = run(p, { runs, scale });
    results[pid] = r;
    const cells = CHECK_DAYS.map(d => { const x = r.byDay.find(b => b.day === d); return x ? `${x.mean.toFixed(1)} obj. (${x.hours} h)` : '—'; });
    say(`| ${p.label} | ${r.blocks.p50} | ${cells.join(' | ')} | **${pct(r.all)}** | ${rar.map(k => pct(r.byRarity[k] ?? 0)).join(' | ')} |`);
  }
  say('\nCellule « Jour N » : nombre moyen de souvenirs (sur 30) à la fin du N-ième jour, et heures de jeu actif correspondantes. Colonnes de rareté : part moyenne des joueurs qui ont un objet de cette rareté fin novembre.');
  return { text: out.join('\n'), results };
}

module.exports = { PROFILES, BONUS_VARIANTS, run, report, bonusReport };

if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
  if (process.argv.includes('--bonus')) console.log(bonusReport());
  else console.log(report({ runs: arg('--runs', 10000), scale: arg('--scale', 1) }).text);
}
