/**
 * Simulation des améliorations compréhensible (#69-D, recette du 06/11/2026) : résumé « ce qui change » avant le
 * détail replié, libellés en clair, aides ⓘ pour les cas simulés, les colonnes, le coût total, les gemmes et le temps.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));

test('section simulation : résumé d\'abord, cas simulés expliqués, détail chiffré replié', () => {
  const sec = between(HTML, 'id="up-sec-sim"', '<div class="form-actions');
  assert.ok(sec.indexOf('id="up-sim-summary"') < sec.indexOf('id="up-sim-details"'), 'résumé avant le détail');
  assert.ok(sec.indexOf('<details id="up-sim-details"') < sec.indexOf('id="up-sim-body"'), 'tableau dans l\'accordéon');
  assert.ok(sec.indexOf('id="up-sim-details"') < sec.indexOf('id="up-compare"'), 'comparaison champ par champ repliée');
  assert.doesNotMatch(sec, /Profil (faible|fort)|>En vigueur</);
  assert.match(sec, /Joueur qui gagne peu de pièces/);
  assert.match(sec, /Joueur qui gagne beaucoup de pièces/);
  for (const id of ['up-h-weak', 'up-h-strong', 'up-h-cols', 'up-h-total', 'up-h-gems', 'up-h-time']) {
    assert.match(sec, new RegExp(`id="${id}" class="bk-hint" hidden`), id);
    assert.ok(sec.includes(`aria-controls="${id}"`) || JS.includes(`'${id}'`), `bouton ⓘ pour ${id}`);
  }
  assert.match(between(sec, 'id="up-h-weak"', '</small>'), /hypothétique et modifiable/);
  assert.match(between(sec, 'id="up-h-cols"', '</small>'), /même si elles ne sont ni enregistrées ni publiées/);
  assert.match(between(sec, 'id="up-h-time"', '</small>'), /pas une durée garantie/);
  // Les cas simulés ne sont ni enregistrés ni comptés comme modification de la fiche
  assert.match(sec, /id="up-sim-weak"[^>]*data-adm-noguard/);
  assert.match(sec, /id="up-sim-strong"[^>]*data-adm-noguard/);
});

test('simulation : « Aucun changement proposé » au lieu d\'une colonne de « = », aides ⓘ actives', () => {
  const fn = between(JS, 'function upRefresh()', '\nfunction upOpen(');
  assert.match(fn, /Aucun changement proposé : la fiche correspond aux paramètres utilisés en jeu\./);
  assert.match(fn, /\.up-sim-gap'\)\) el\.classList\.toggle\('hidden', noChange\)/);
  assert.doesNotMatch(fn, /'='/);
  assert.match(JS, /getElementById\('up-dialog'\)\.addEventListener\('click', e => \{\n  const b = e\.target\.closest\('\.bk-info'\)/);
});
