#!/usr/bin/env node
/**
 * pickaxe-bonus-sim.js — étude du ticket #54 : que vaut une pioche « +0,1 sur un matériau » ?
 *
 * Calcul exact (pas de hasard) avec le VRAI code du jeu : public/js/blocks.js et le catalogue de
 * blocs publié en production (v3 = 14 blocs d'origine + 8 minerais de l'étape B), comme
 * tools/balance/economy-sim.js. Rien n'est modifié dans le jeu ; aucun accès réseau ni base.
 *
 * Rappel du moteur (blocks.js, spawn) : la NATURE d'un bloc (apparence, récompense) est tirée avec
 * la Chance ; ses PV sont tirés SANS Chance, indépendamment (#32). Un bonus « sur l'émeraude »
 * s'applique donc à un bloc dont les PV suivent la loi neutre de la profondeur.
 *
 * Trois définitions de « +0,1 » sont comparées, pour la pioche équipée au moment du coup :
 *   rendement : pièces du bloc × 1,1 si le bloc est du matériau (aucun effet sur les PV) ;
 *   degats10  : dégâts du coup × 1,1 sur ce matériau (dégâts fractionnaires, PV décimaux) ;
 *   plat01    : dégâts du coup + 0,1 sur ce matériau (bonus plat, dilué par la pioche).
 *
 * Pour chaque profondeur, matériau et niveau de dégâts : part des blocs, part des pièces, et gain
 * de vitesse de descente (coups économisés / coups totaux, clics seuls, Auto-Dig ignoré).
 *
 * Lancer : node tools/balance/pickaxe-bonus-sim.js            (tableaux Markdown)
 *          node tools/balance/pickaxe-bonus-sim.js --json     (résultats bruts)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const blockCatalog = require(path.join(ROOT, 'server', 'blockCatalog'));

function loadBlocks() {
  const GameState = { upgrades: { luck: 0 }, relicBonuses: {}, stats: {}, depth: 1 };
  const ctx = vm.createContext({ Math, Object, Array, Number, String, Set, JSON, Date, GameState, t: k => k });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'js', 'blocks.js'), 'utf8'), ctx, { filename: 'blocks.js' });
  const Blocks = vm.runInContext('Blocks', ctx);
  const types = [...blockCatalog.originTypes(), ...blockCatalog.STEP_B_TYPES];
  if (!Blocks.applyCatalog({ version: 3, types })) throw new Error('catalogue v3 refusé par Blocks.applyCatalog');
  return Blocks;
}

const Blocks = loadBlocks();

const DEPTHS    = [30, 100, 300, 1000, 2000];
const MATERIALS = ['pierre', 'emeraude', 'charbon', 'diamant'];
/** Dégâts par clic : début (pioche 3), milieu (pioche 8 + Œil 4), maximum (pioche 15 + Œil 10). */
const DAMAGES   = [3, 12, 25];
const LUCK      = 5;

/** PV possibles à la profondeur d (loi neutre, sans Chance ni relique Griffe). */
function hpLaw(depth) {
  const scale = 1 + (depth - 1) * 0.12;
  return Blocks.blockOdds(depth, 0).map(e => ({ p: e.p, hp: Math.ceil(e.type.hpBase * scale) }));
}

/** Coups moyens pour casser un bloc de PV tirés selon la loi, avec `dmg` par coup. */
function meanHits(law, dmg) {
  return law.reduce((s, e) => s + e.p * Math.ceil(e.hp / dmg - 1e-9), 0);
}

const VARIANTS = {
  rendement: { coins: 1.1, dmg: d => d },
  degats10:  { coins: 1,   dmg: d => d * 1.1 },
  plat01:    { coins: 1,   dmg: d => d + 0.1 },
};

function analyse() {
  const out = [];
  for (const depth of DEPTHS) {
    const odds = Blocks.blockOdds(depth, LUCK);
    const law  = hpLaw(depth);
    const rewardOf = t => Math.ceil(t.reward * (1 + (depth - 1) * 0.05));
    const coinsTotal = odds.reduce((s, e) => s + e.p * rewardOf(e.type), 0);
    for (const id of MATERIALS) {
      const e = odds.find(o => Blocks.idOf(o.type) === id);
      const share = e ? e.p : 0;
      const coinShare = e ? e.p * rewardOf(e.type) / coinsTotal : 0;
      const row = { depth, material: id, share, coinShare, variants: {} };
      for (const [k, v] of Object.entries(VARIANTS)) {
        const coinGain = coinShare * (v.coins - 1);
        const speed = {};
        for (const d of DAMAGES) {
          const base  = meanHits(law, d);
          const bonus = share * meanHits(law, v.dmg(d)) + (1 - share) * base;
          speed[d] = 1 - bonus / base;   // part des coups économisés
        }
        row.variants[k] = { coinGain, speed };
      }
      out.push(row);
    }
  }
  return out;
}

const pct = x => `${(x * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} %`;

function markdown(rows) {
  const lines = [];
  lines.push(`Chance ${LUCK}, catalogue v3 (22 blocs). « Blocs » = part des blocs de ce matériau ; ` +
    '« Pièces » = part des pièces des blocs qui en viennent.');
  lines.push('');
  lines.push('| Profondeur | Matériau | Blocs | Pièces | Rendement ×1,1 : pièces | Dégâts ×1,1 : coups économisés (3 / 12 / 25 dégâts) | +0,1 dégât plat : coups économisés (3 / 12 / 25) |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const s = k => DAMAGES.map(d => pct(r.variants[k].speed[d])).join(' / ');
    lines.push(`| ${r.depth} m | ${r.material} | ${pct(r.share)} | ${pct(r.coinShare)} | +${pct(r.variants.rendement.coinGain)} | ${s('degats10')} | ${s('plat01')} |`);
  }
  return lines.join('\n');
}

if (require.main === module) {
  const rows = analyse();
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
  else console.log(markdown(rows));
}

module.exports = { analyse, meanHits, hpLaw };
