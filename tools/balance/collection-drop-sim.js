#!/usr/bin/env node
/**
 * collection-drop-sim.js — chances d'obtenir les objets d'une collection saisonnière en 7 jours
 * (ticket #39, demande du propriétaire du 03/11 : barème « progressif », collection complétable).
 *
 * Réutilise le simulateur économique #49 (tools/balance/economy-sim.js) : VRAI code du jeu
 * (blocs, probabilités par profondeur, PV, pioche, Auto-Dig, améliorations achetées, coffres,
 * reliques), profils de joueurs et rythme d'une saison de 7 jours. À chaque bloc détruit, le
 * tirage des objets reproduit Collection.tryDrop (public/js/collection.js) :
 *   - seuls les objets éligibles (profondeur du bloc ≥ minDepth, catégorie du bloc dans `from`,
 *     objet pas encore possédé) sont testés, DANS L'ORDRE du catalogue ;
 *   - le premier tirage réussi s'arrête là (au plus un objet par bloc) ;
 *   - la série permanente « origines » (8 objets, actifs) passe avant la série saisonnière ;
 *     ses objets restent acquis d'une saison à l'autre.
 * Les gains hors ligne (main.js) ne détruisent pas de blocs : aucun drop hors ligne.
 * Hasard à graine (mulberry32) séparé de celui du jeu : mêmes options → mêmes chiffres, et le
 * barème testé ne modifie pas la partie simulée. Aucun accès réseau ni base de données ; rien
 * n'est activé ni publié : les barèmes ci-dessous sont des PROPOSITIONS à valider.
 *
 * Lancer : node tools/balance/collection-drop-sim.js              (rapport Markdown, 2 000 joueurs/profil)
 *          node tools/balance/collection-drop-sim.js --runs 300   (plus rapide)
 */

'use strict';

const path = require('path');
const sim = require(path.join(__dirname, 'economy-sim.js'));

/** Série permanente « origines » publiée (catalogue v1, identique au brouillon de production du 03/11). */
const ORIGINES = [
  { id: 'fossil',        from: ['pierre'],            minDepth: 8,  chance: 0.04 },
  { id: 'crystal',       from: ['minerai'],           minDepth: 12, chance: 0.05 },
  { id: 'ancient_coin',  from: ['terre', 'pierre'],   minDepth: 18, chance: 0.03 },
  { id: 'relic',         from: ['coffre'],            minDepth: 10, chance: 0.15 },
  { id: 'broken_crown',  from: ['coffre'],            minDepth: 35, chance: 0.20 },
  { id: 'monster_tooth', from: ['gemme'],             minDepth: 35, chance: 0.10 },
  { id: 'map_fragment',  from: ['pierre', 'minerai'], minDepth: 55, chance: 0.035 },
  { id: 'mystic_orb',    from: ['gemme'],             minDepth: 70, chance: 0.08 },
];

/**
 * Barèmes de la série « Les Trésors de la Saint-Martin » (2026-W46), dans l'ordre du catalogue.
 * BASE = brouillon de production relevé le 03/11 (drops inactifs). Les autres = propositions.
 */
const SCALES = {
  BASE: {
    label: 'Brouillon actuel (capture du 03/11)',
    items: [
      { id: 'lanterne_betterave',   rarity: 'commun',     from: ['terre', 'pierre'],   minDepth: 5,   chance: 0.03 },
      { id: 'plume_oie_bavarde',    rarity: 'peu-commun', from: ['pierre', 'minerai'], minDepth: 20,  chance: 0.02 },
      { id: 'demi_manteau_martin',  rarity: 'legendaire', from: ['gemme'],             minDepth: 100, chance: 0.05 },
      { id: 'fer_cheval_martin',    rarity: 'rare',       from: ['minerai'],           minDepth: 40,  chance: 0.015 },
      { id: 'bonbon_porte_a_porte', rarity: 'commun',     from: ['terre', 'pierre'],   minDepth: 5,   chance: 0.03 },
      { id: 'lampion_chante_faux',  rarity: 'peu-commun', from: ['pierre', 'minerai'], minDepth: 20,  chance: 0.02 },
    ],
  },
};

/** Variante du brouillon : mêmes objets, sources et ordre ; seules les valeurs données changent. */
function variant(label, note, changes) {
  return { label, note, items: SCALES.BASE.items.map(i => ({ ...i, ...(changes[i.rarity] || {}) })) };
}
SCALES.PROGRESSIF = variant('Proposition recommandée — progressif',
  'Communs un peu plus faciles (4 %), peu communs et rare inchangés, légendaire 3 % par gemme dès 100 m (au lieu de 5 %).',
  { commun: { chance: 0.04 }, legendaire: { chance: 0.03 } });
SCALES.EXIGEANT = variant('Alternative — exigeant (légendaire réservé aux plus actifs)',
  'Communs 3 %, peu communs 2 %, rare 1 % dès 40 m, légendaire 2 % par gemme dès 150 m.',
  { rare: { chance: 0.01 }, legendaire: { chance: 0.02, minDepth: 150 } });

const DAYS_ALL = [0, 1, 2, 3, 4, 5, 6];
/** Profils (economy-sim.PROFILES) + nouvel entrant (arrive le vendredi, joue 3 jours sur 7). */
const PROFILES = {
  debutant: { ...sim.PROFILES.debutant, label: 'Lent / occasionnel (20 min/j, 4 j/7)' },
  entrant:  { ...sim.PROFILES.regulier, label: 'Nouvel entrant (1 h/j, arrive le vendredi : 3 j/7)', days: [4, 5, 6] },
  regulier: { ...sim.PROFILES.regulier, label: 'Régulier (1 h/j, 7 j/7)', days: DAYS_ALL },
  assidu:   { ...sim.PROFILES.assidu,   label: 'Assidu (3 h/j + 4 h onglet ouvert)' },
  auto:     { ...sim.PROFILES.auto,     label: 'Auto-Dig (15 min/j + 8 h onglet ouvert)' },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simule `runs` joueurs ; la série saisonnière est active pendant la saison `season` (index 0 =
 * premier compte : aucune relique ni objet permanent ; 3 = joueur installé depuis 3 semaines).
 * Tous les barèmes de `scaleKeys` sont appliqués au MÊME flux de blocs de chaque joueur (le
 * barème ne change pas la partie), chacun avec son propre hasard et ses propres objets possédés.
 * @returns {Object<string, object>} par barème : part des joueurs ayant chaque objet, la série
 *   complète, la série complète à la fin de chaque jour, et les blocs éligibles rencontrés.
 */
function run(scaleKeys, profile, { runs = 2000, season = 0, seed = 39 } = {}) {
  const rules = sim.currentRules();
  const acc = Object.fromEntries(scaleKeys.map(k => [k, {
    found: Object.fromEntries(SCALES[k].items.map(i => [i.id, 0])), all: 0, byDay: new Array(7).fill(0) }]));
  const gem100 = [], maxDepth = [];
  for (let r = 0; r < runs; r++) {
    const st = scaleKeys.map((k, n) => ({ k, items: SCALES[k].items, owned: new Set(), random: rng((seed * 7919 + r) * 31 + n), doneDay: null }));
    let seasonIdx = -1, last = Infinity, g100 = 0, maxD = 0;
    const onBlock = (type, depth, t) => {
      if (depth < last) seasonIdx++;                  // nouvelle saison : profondeur remise à 1
      last = depth;
      const inSeason = seasonIdx === season;
      if (inSeason) {
        if (type.category === 'gemme' && depth >= 100) g100++;
        if (depth > maxD) maxD = depth;
      }
      for (const x of st) {
        const list = inSeason ? [...ORIGINES, ...x.items] : ORIGINES;
        for (const f of list) {                       // Collection.tryDrop : au plus un objet par bloc
          if (x.owned.has(f.id) || depth < f.minDepth || !f.from.includes(type.category)) continue;
          if (x.random() < f.chance) { x.owned.add(f.id); break; }
        }
        if (inSeason && x.doneDay === null && x.items.every(i => x.owned.has(i.id))) x.doneDay = Math.min(6, Math.floor(t / 86_400));
      }
    };
    sim.simulatePlayers({ profile, rules, runs: 1, seasons: season + 1, seed: seed * 13 + r, options: { onBlock } });
    for (const x of st) {
      const a = acc[x.k];
      for (const i of x.items) if (x.owned.has(i.id)) a.found[i.id]++;
      if (x.doneDay !== null) { a.all++; for (let d = x.doneDay; d < 7; d++) a.byDay[d]++; }
    }
    gem100.push(g100); maxDepth.push(maxD);
  }
  const q = (arr, f) => { const v = [...arr].sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(v.length * f))]; };
  const eligible = { gemme100: { p10: q(gem100, 0.1), p50: q(gem100, 0.5), zero: gem100.filter(x => !x).length / runs },
    maxDepth: { p10: q(maxDepth, 0.1), p50: q(maxDepth, 0.5) } };
  return Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, {
    runs, all: a.all / runs, byDay: a.byDay.map(v => v / runs), eligible,
    found: Object.fromEntries(Object.entries(a.found).map(([id, v]) => [id, v / runs])) }]));
}

const pct = x => (x >= 0.995 && x < 1 ? '> 99 %' : x > 0 && x < 0.005 ? '< 1 %' : `${Math.round(x * 100)} %`);

const PERIODS = [['entrant', [0]], ['debutant', [0, 3]], ['auto', [0, 3]], ['regulier', [0, 3]], ['assidu', [0, 3]]];

function report({ runs, scales = Object.keys(SCALES) }) {
  const out = [];
  const say = s => out.push(s);
  const results = {};
  for (const [pid, seasons] of PERIODS) {
    for (const season of seasons) results[`${pid}|${season}`] = run(scales, PROFILES[pid], { runs, season });
  }
  say(`# Collection saisonnière — chances de découverte en 7 jours (#39)\n`);
  say(`${runs} joueurs simulés par profil ; saison 1 = premier compte (aucune relique, aucun objet permanent), saison 4 = joueur installé. Même flux de blocs pour tous les barèmes.\n`);
  say(`| Profil | Saison | Prof. max (méd. · 10 % les plus lents) | Gemmes ≥ 100 m rencontrées (méd. · 10 % les plus lents) |`);
  say(`|---|---|---|---|`);
  for (const [pid, seasons] of PERIODS) for (const season of seasons) {
    const e = results[`${pid}|${season}`][scales[0]].eligible;
    say(`| ${PROFILES[pid].label} | ${season + 1} | ${e.maxDepth.p50} m · ${e.maxDepth.p10} m | ${e.gemme100.p50} · ${e.gemme100.p10} |`);
  }
  say('');
  for (const key of scales) {
    const scale = SCALES[key];
    say(`## ${key} — ${scale.label}\n`);
    if (scale.note) say(`${scale.note}\n`);
    say(`| Objet | Rareté | Source | Dès | Chance par bloc éligible |`);
    say(`|---|---|---|---|---|`);
    for (const i of scale.items) say(`| ${i.id} | ${i.rarity} | ${i.from.join(', ')} | ${i.minDepth} m | ${+(i.chance * 100).toFixed(2)} % |`);
    say('');
    say(`| Profil | Saison | ${scale.items.map(i => i.id.split('_')[0]).join(' | ')} | **Série complète (7 j)** | Série complète fin J3 · J5 |`);
    say(`|---|---|${scale.items.map(() => '---').join('|')}|---|---|`);
    for (const [pid, seasons] of PERIODS) for (const season of seasons) {
      const r = results[`${pid}|${season}`][key];
      say(`| ${PROFILES[pid].label} | ${season + 1} | ${scale.items.map(i => pct(r.found[i.id])).join(' | ')} | **${pct(r.all)}** | ${pct(r.byDay[2])} · ${pct(r.byDay[4])} |`);
    }
    say('');
  }
  return out.join('\n');
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const runs = Number(argv[argv.indexOf('--runs') + 1]) || 2000;
  const only = argv.includes('--scale') ? [argv[argv.indexOf('--scale') + 1]] : undefined;
  console.log(report({ runs, scales: only }));
}

module.exports = { ORIGINES, SCALES, PROFILES, run, report };
