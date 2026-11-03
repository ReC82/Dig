/**
 * Tests de l'outil d'étude tools/balance/pickaxe-bonus-sim.js (ticket #54) : les chiffres sur
 * lesquels reposent les barèmes proposés (une pioche « émeraude » ne change presque rien à la
 * descente, une pioche « pierre » la change nettement) restent vrais avec le catalogue du jeu.
 * Aucun serveur ni base de données ; rien n'est modifié dans le jeu.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const path   = require('path');

const { analyse, meanHits } = require(path.join(__dirname, '..', 'tools', 'balance', 'pickaxe-bonus-sim.js'));

const row = (rows, depth, material) => rows.find(r => r.depth === depth && r.material === material);

test('pickaxe-bonus-sim : coups entiers, dégâts fractionnaires', () => {
  const law = [{ p: 0.5, hp: 10 }, { p: 0.5, hp: 11 }];
  assert.strictEqual(meanHits(law, 1), 10.5);
  assert.strictEqual(meanHits(law, 1.1), 0.5 * 10 + 0.5 * 10);   // 11 / 1,1 = 10 exactement
  assert.strictEqual(meanHits(law, 10), 1.5);
});

test('pickaxe-bonus-sim : émeraude ≈ invisible sur la descente, pierre nettement plus', () => {
  const rows = analyse();
  for (const depth of [100, 300, 1000, 2000]) {
    const em = row(rows, depth, 'emeraude');
    const st = row(rows, depth, 'pierre');
    assert.ok(em.share > 0 && em.share < 0.02, `émeraude ${depth} m : part ${em.share}`);
    assert.ok(em.variants.degats10.speed[25] < 0.005, `émeraude ${depth} m : gain de descente`);
    assert.ok(st.variants.degats10.speed[25] > 0.015, `pierre ${depth} m : gain de descente`);
    // Le rendement ne touche jamais la vitesse de descente
    assert.strictEqual(em.variants.rendement.speed[25], 0);
  }
  // Pas d'émeraude avant 70 m
  assert.strictEqual(row(rows, 30, 'emeraude').share, 0);
});
