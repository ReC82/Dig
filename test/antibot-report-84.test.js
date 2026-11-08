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
  assert.match(gate, /DigBeta\.openReport\(\{ step \}\)/);
  assert.match(gate, /report_step_susp', \{ time: _fmtBrussels\(susp\.endsAt\) \}/);
});

test('formulaire de la bêta : pré-remplissage sans écraser un brouillon, ni demander confirmation', () => {
  const beta = read('public/js/beta.js');
  assert.match(beta, /function openReport\(prefill\)/);
  assert.match(beta, /const initialStep = !_draft && typeof prefill\?\.step === 'string'/);
  assert.match(beta, /id === 'beta-step' \? initialStep : ''/);
  assert.match(beta, /reportsEnabled: \(\) => !!_config\?\.reports/);
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
  }
});
