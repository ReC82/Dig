/**
 * Tests unitaires du bloc courant persistant (ticket #35) : public/js/blocks.js, chests.js,
 * collection.js et save.js exécutés dans un contexte vm (un contexte = un onglet / appareil).
 * Vérifie la reprise exacte du bloc (type, PV, récompense), le tirage reproductible
 * (graine + numéro de bloc) et qu'aucune relance ne change le bloc ni les gains.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');

/** Nouvel « appareil » : scripts du jeu chargés dans un contexte vm avec son propre stockage. */
function device() {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const ctx = vm.createContext({ localStorage, Date, JSON, Math, Object, Array, Number, String, Boolean, Set, Map });
  for (const [f, name] of [['gameState.js', 'GameState'], ['blocks.js', 'Blocks'], ['chests.js', 'Chests'], ['collection.js', 'Collection'], ['save.js', 'Save']]) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
    vm.runInContext(`${src}\nthis.${name} = ${name};`, ctx);
  }
  return ctx;
}

const view = b => ({ name: b.type.name, hp: b.hp, maxHp: b.maxHp, reward: b.reward, depth: b.depth, seq: b.seq });
/** Sauvegarde transmise d'un appareil à l'autre (cloud) : copie JSON. */
const transfer = (from, to) => { to.Save.loadFromData(JSON.parse(JSON.stringify(from.Save.serialize(1)))); };

test('reprise exacte : type, PV restants, récompense et numéro du bloc identiques sur un autre appareil', () => {
  const pc = device();
  pc.GameState.depth = 140;
  pc.Blocks.spawn(140);
  pc.Blocks.hit(7);
  const before = view(pc.Blocks.current);

  const phone = device();
  transfer(pc, phone);
  assert.strictEqual(phone.Blocks.resume(phone.Save.loadedBlock, phone.GameState.depth), true);
  assert.deepStrictEqual(view(phone.Blocks.current), before);
  assert.strictEqual(phone.GameState.blockSeed, pc.GameState.blockSeed);

  // Rafraîchissement (save locale) : même bloc aussi
  pc.Save.save();
  const tab2 = device();
  tab2.localStorage.setItem(pc.Save.KEY, pc.localStorage.getItem(pc.Save.KEY));
  assert.ok(tab2.Save.load());
  tab2.Blocks.resume(tab2.Save.loadedBlock, tab2.GameState.depth);
  assert.deepStrictEqual(view(tab2.Blocks.current), before);
});

test('tirage reproductible : même graine → même suite de blocs sur deux appareils', () => {
  const a = device(), b = device();
  a.GameState.blockSeed = b.GameState.blockSeed = 123456789;
  for (let i = 1; i <= 300; i++) {
    const depth = 1 + (i % 150);
    assert.deepStrictEqual(view(a.Blocks.spawn(depth)), view(b.Blocks.spawn(depth)));
  }
  assert.strictEqual(a.GameState.blockSeq, 300);
});

test('aucune relance : rejouer une sauvegarde plus ancienne redonne le même bloc suivant et les mêmes gains', () => {
  const pc = device();
  pc.GameState.depth = 60;
  pc.GameState.upgrades.luck = 5;
  pc.Blocks.spawn(60);
  const saved = JSON.parse(JSON.stringify(pc.Save.serialize(1)));   // juste avant la destruction

  const outcomes = new Set();
  for (let attempt = 0; attempt < 25; attempt++) {
    const d = device();   // nouvel onglet / appareil / reconnexion
    d.Save.loadFromData(JSON.parse(JSON.stringify(saved)));
    d.Blocks.resume(d.Save.loadedBlock, d.GameState.depth);
    const destroyed = d.Blocks.current;
    d.Blocks.hit(destroyed.hp);
    const chest = d.Chests.open('epique', d.Blocks.rewardRng('chest'));
    const find  = d.Collection.tryDrop({ category: 'gemme' }, 200, d.Blocks.rewardRng('find'));
    d.GameState.nextDepth();
    const next = d.Blocks.spawn(d.GameState.depth);
    outcomes.add(JSON.stringify({ next: view(next), chest, find: find && find.id }));
  }
  assert.strictEqual(outcomes.size, 1, 'un seul résultat possible quel que soit le nombre de reprises');
});

test('bloc détruit, profondeur ou saison changée : le bloc suivant est tiré (jamais l\'ancien)', () => {
  const pc = device();
  pc.GameState.depth = 10;
  pc.Blocks.spawn(10);
  pc.Blocks.hit(1e9);                      // détruit, coffre en attente de « Récupérer »
  pc.GameState.nextDepth();
  const phone = device();
  transfer(pc, phone);
  assert.strictEqual(phone.Blocks.resume(phone.Save.loadedBlock, phone.GameState.depth), false);
  assert.strictEqual(phone.Blocks.current.seq, 2);
  assert.strictEqual(phone.Blocks.current.depth, 11);

  // Changement de saison : profondeur 1, le bloc sauvegardé à 11 n'est pas repris
  const s = device();
  transfer(phone, s);
  s.GameState.depth = 1;
  assert.strictEqual(s.Blocks.resume(s.Save.loadedBlock, 1), false);
  assert.strictEqual(s.Blocks.current.depth, 1);
  assert.strictEqual(s.Blocks.current.seq, 3);
});

test('bloc sauvegardé invalide ou falsifié : ignoré, bloc suivant tiré', () => {
  const d = device();
  d.GameState.blockSeq = 5;
  for (const bad of [
    { name: 'block.inconnu', hp: 1, maxHp: 2, reward: 1, depth: 3, seq: 5 },
    { name: 'block.pierre', hp: 0, maxHp: 2, reward: 1, depth: 3, seq: 5 },
    { name: 'block.pierre', hp: 9, maxHp: 2, reward: 1, depth: 3, seq: 5 },
    { name: 'block.pierre', hp: 1, maxHp: 2, reward: 1, depth: 3, seq: 99 },
    { name: 'block.pierre', hp: 1, maxHp: 2, reward: -1, depth: 3, seq: 5 },
    'texte', null,
  ]) {
    d.GameState.blockSeq = 5;
    assert.strictEqual(d.Blocks.resume(bad, 3), false, JSON.stringify(bad));
    assert.strictEqual(d.Blocks.current.seq, 6);
  }
});

test('ancienne sauvegarde (v15, sans bloc) : migration sans perte, graine créée au premier bloc', () => {
  const d = device();
  const v15 = { saveVersion: 15, lastSaveTime: 5, coins: 4321, gems: 2, depth: 33, pickaxeLevel: 4, damage: 4,
    upgrades: { luck: 2, bag: 1, autodig: 3, fragment_shop: 0, block_reroll: 0 }, relics: {}, relicFragments: 3,
    shopChestsBought: { simple: 1, rare: 0, antique: 0 }, seasonStats: { seasonId: 4, maxDepth: 33 } };
  assert.ok(d.Save.loadFromData(JSON.parse(JSON.stringify(v15))));
  assert.strictEqual(d.GameState.coins, 4321);
  assert.strictEqual(d.GameState.depth, 33);
  assert.strictEqual(d.Save.loadedBlock, null);
  assert.strictEqual(d.Blocks.resume(d.Save.loadedBlock, 33), false);
  assert.ok(d.GameState.blockSeed > 0);
  const out = d.Save.serialize(6);
  assert.strictEqual(out.saveVersion, 16);
  assert.strictEqual(out.coins, 4321);
  assert.strictEqual(out.blockSeq, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out.block)), JSON.parse(JSON.stringify(view(d.Blocks.current))));
});

test('les chances des matériaux rares ne changent pas (tirage reproductible fidèle aux probabilités)', () => {
  const d = device();
  const depth = 150, luck = 3, N = 30000;
  d.GameState.upgrades.luck = luck;
  d.GameState.blockSeed = 42;
  let rare = 0;
  for (let i = 0; i < N; i++) {
    const b = d.Blocks.spawn(depth);
    if (['rare', 'epique', 'legendaire'].includes(b.type.rarityKey)) rare++;
  }
  const expected = d.Blocks.rareShare(depth, luck);
  assert.ok(Math.abs(rare / N - expected) < 0.01, `part rare ${rare / N} ≠ ${expected}`);
});
