/**
 * #84 (décision du propriétaire du 08/11, compétition entre collègues) : la fenêtre anti-bot propose
 * « 🐞 Signaler une erreur » quand les signalements de la bêta sont actifs, avec le formulaire de la
 * bêta pré-rempli (défi ou suspension). Contrôles statiques ; l'essai navigateur est
 * test/e2e/antibot-report-84.e2e.js.
 * Lancer : npm test
 */
'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const path   = require('path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('fenêtre anti-bot : bouton de signalement masqué hors bêta, relié au formulaire de la bêta', () => {
  const gate = read('public/js/antibotGate.js');
  assert.match(gate, /id="antibot-report" class="antibot-btn-ghost" hidden/);
  assert.match(gate, /report\.hidden = !_reportsOn\(\)/);
  assert.match(gate, /DigBeta\.reportsEnabled\(\)/);
  assert.match(gate, /DigBeta\.openReport\(\{ step, /);
  assert.match(gate, /report_step_susp', \{ time: _fmtBrussels\(susp\.endsAt\) \}/);
});

test('formulaire de la bêta : pré-remplissage sans écraser un brouillon, ni demander confirmation', () => {
  const beta = read('public/js/beta.js');
  assert.match(beta, /function openReport\(prefill\)/);
  assert.match(beta, /const initialStep = !_draft && typeof prefill\?\.step === 'string'/);
  assert.match(beta, /id === 'beta-step' \? initialStep : ''/);
  assert.match(beta, /reportsEnabled: \(\) => !!_config\?\.reports/);
});

// Recette #84-E du propriétaire (08/11) : le CAPTCHA disparaissait à l'envoi du signalement et ne
// revenait qu'au coup suivant sur le bloc, parfois sur une énigme à 00:00.
test('#84-E : la vérification revient seule à la fermeture du formulaire, jamais sur une énigme expirée', () => {
  const gate = read('public/js/antibotGate.js');
  assert.match(gate, /returnLabel: T\(susp \? 'btn_back_susp' : 'btn_back_challenge'\), onClose: \(\) => \{ if \(_state\) show\(\); \}/);
  assert.match(gate, /const REOPEN_MIN_LEFT_MS = 10_000;/);
  assert.match(gate, /\(!_puzzle \|\| _almostExpired\(\)\)\) _loadPuzzle\(\)/);
  const beta = read('public/js/beta.js');
  // Une seule fermeture « officielle », appelée par Annuler / ✕ / fond / Échap et « Abandonner »
  assert.match(beta, /const close = \(\) => \{\n\s+modal\.remove\(\);\n\s+if \(closed\) return;\n\s+closed = true;\n\s+onClose\?\.\(\);/);
  assert.match(beta, /if \(!dirty\(\)\) \{ _draft = null; close\(\); return; \}/);
  assert.match(beta, /'btn-beta-discard'\)\.addEventListener\('click', \(\) => \{ _draft = null; close\(\); \}\)/);
  assert.match(beta, /back\.textContent = String\(prefill\.returnLabel\)/);
});

test('textes du bouton et du pré-remplissage dans les 4 langues publiques', () => {
  const locales = {};
  const src = read('public/js/i18n.js');
  for (const lang of ['fr', 'en', 'nl', 'es']) locales[lang] = true;
  // Chaque langue déclare un bloc antibot contenant les trois clés, avec {time} pour la suspension
  const blocks = src.split(/\n {6}antibot: \{/).slice(1).map(b => b.slice(0, b.indexOf('\n      },')));
  assert.strictEqual(blocks.length, Object.keys(locales).length, 'un bloc antibot par langue');
  for (const b of blocks) {
    assert.match(b, /btn_report: '🐞 /);
    assert.match(b, /report_step_challenge: '/);
    assert.match(b, /report_step_susp: '[^\n]*\{time\}/);
    assert.match(b, /btn_back_challenge: '🛡️ /);
    assert.match(b, /btn_back_susp: '⏸️ /);
  }
});
