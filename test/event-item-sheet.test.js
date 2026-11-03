/**
 * Collection → Souvenirs d'événements (#39, recette du propriétaire du 03/11) :
 * - plus de description affichée sous la petite carte : un clic ouvre la fiche dédiée
 *   (même fenêtre que les objets de collection : image ou emoji, nom, rareté, événement,
 *   date de découverte, histoire), focus rendu à la carte à la fermeture ;
 * - le titre « Souvenirs d'événements » (marge négative prévue pour la grille flex) ne
 *   chevauche plus le titre de l'événement : le panneau a son propre espacement flex.
 * L'essai navigateur correspondant est test/e2e/event-item-sheet.e2e.js.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'public/js/main.js'), 'utf8');
const css  = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');

function fnBody(name) {
  const i = main.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} présent`);
  return main.slice(i, main.indexOf('\n}\n', i));
}

test('événements : clic → fiche dédiée, aucune description inline', () => {
  const render = fnBody('renderEvents');
  assert.ok(!/event-item-desc/.test(main), 'plus de paragraphe de description sous les cartes');
  assert.match(render, /showEventItemSheet\(/);
  const sheet = fnBody('showEventItemSheet');
  for (const k of ['image', 'icon', 'title', 'rarity', 'context', 'foundText', 'story']) assert.match(sheet, new RegExp(`\\b${k}:`), k);
  assert.match(sheet, /events\.ended/);
  assert.match(sheet, /events\.until/);
  assert.match(sheet, /_openItemSheet\(/);
});

test('fiche commune : collection et événements partagent la fenêtre, focus rendu', () => {
  assert.match(fnBody('showFindSheet'), /_openItemSheet\(/);
  const open = fnBody('_openItemSheet');
  assert.match(open, /opener\.focus\(\)/);
  assert.match(open, /'Escape'/);
  assert.match(open, /textContent = o\.story/, 'texte inséré sans HTML');
});

test('panneau événements : espacement propre (pas de chevauchement du titre Souvenirs)', () => {
  assert.match(css, /#events-panel\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*16px/);
});

test('libellé « terminé le » traduit dans les quatre langues', () => {
  const i18n = fs.readFileSync(path.join(root, 'public/js/i18n.js'), 'utf8');
  const m = i18n.match(/^\s+ended:\s+'[^']*\{date\}[^']*',$/gm) || [];
  assert.strictEqual(m.length, 4);
});
