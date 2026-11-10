'use strict';
// Recette #81-B bis (10/11) : fiche Micro-bonus en trois niveaux — brouillon affiché d'abord,
// calendrier et détails repliés par défaut, identifiants conservés pour l'audit.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'index.html'), 'utf8');
const dlg = html.slice(html.indexOf('<dialog id="mb-dialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="mb-dialog"')));

test('#81-B bis : « 🔒 Brouillon — aucun effet en jeu » avant les champs', () => {
  const lock = dlg.indexOf('🔒 Brouillon — aucun effet en jeu');
  assert.ok(lock > 0 && lock < dlg.indexOf('id="mb-label"'));
  assert.doesNotMatch(dlg, /est actif en jeu/);
});

test('#81-B bis : trois niveaux dans l\'ordre, calendrier et détails repliés par défaut', () => {
  const order = ['1. Configurer le bonus', 'Quand s\'applique-t-il ?', '2. Résultat en bref', 'id="mb-brief-sentence"', '🔍 Comprendre les détails', 'id="mb-prev-sim"', 'id="mb-prev-pool"'];
  const pos = order.map(t => dlg.indexOf(t));
  assert.ok(pos.every(p => p > 0), JSON.stringify(pos));
  assert.deepStrictEqual([...pos].sort((a, b) => a - b), pos);
  for (const id of ['mb-when', 'mb-details', 'mb-sim-help']) assert.match(dlg, new RegExp(`<details[^>]*id="${id}"(?![^>]*\\bopen\\b)[^>]*>`), id);
});

test('#81-B bis : tous les champs et tableaux d\'audit conservés', () => {
  for (const id of ['mb-label', 'mb-value', 'mb-target', 'mb-source', 'mb-from', 'mb-to', 'mb-monthdays', 'mb-months', 'mb-weekdays', 'mb-note',
    'mb-depth', 'mb-luck', 'mb-base', 'mb-prev-fr', 'mb-prev-en', 'mb-prev-state', 'mb-prev-warn', 'mb-prev-samples', 'mb-prev-sim', 'mb-prev-explain',
    'mb-prev-hyp', 'mb-prev-pool', 'btn-mb-save', 'btn-mb-archive', 'btn-mb-preview']) assert.ok(dlg.includes(`id="${id}"`), id);
  assert.ok(dlg.indexOf('class="bk-sheet-actions"') > dlg.indexOf('id="mb-prev-pool"'), 'boutons en pied de fiche');
});
