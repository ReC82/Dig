/**
 * Fiches et fenêtres de l'admin simplifiées (#76) : fiche joueur « résumé d'abord », essais paginés, confirmation
 * « Recommencer un test à zéro » avec formulaire avant les détails repliés, sécurités inchangées, pagination et
 * pied fixe communs. Parcours Chromium : test/e2e/admin-sheets.e2e.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.css'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));

test('fiche joueur : résumé, Essais de test d\'abord, détails et réinitialisation partielle repliés', () => {
  const card = between(HTML, 'id="player-detail-card"', 'id="tr-dialog"');
  const pos = id => card.indexOf(`id="${id}"`);
  assert.ok(pos('pd-summary') > 0 && pos('pd-summary') < pos('pd-sec-tests'), 'résumé avant les sections');
  assert.ok(pos('pd-sec-tests') < pos('pd-sec-save') && pos('pd-sec-save') < pos('pd-sec-partial'));
  assert.match(card, /<details class="pd-sec" id="pd-sec-tests" open>/);
  assert.match(card, /<details class="pd-sec" id="pd-sec-save">/, 'progression détaillée repliée');
  assert.match(card, /<details class="pd-more" id="tr-more">/, 'explication longue repliée');
  // le bouton d'action est en tête de la section, avant l'explication et le tableau
  assert.ok(pos('btn-tr-reset') < pos('tr-more') && pos('tr-more') < pos('tr-table'));
  // aucune valeur de la fiche retirée
  for (const id of ['pd-coins', 'pd-depth', 'pd-pickaxe', 'pd-gems', 'pd-frags', 'pd-relics', 'pd-luck', 'pd-bag', 'pd-autodig',
    'pd-chest-simple', 'pd-chest-rare', 'pd-chest-antique', 'pd-updated', 'pd-revision', 'pd-version', 'tr-guard', 'tr-audit', 'tr-pager']) {
    assert.ok(pos(id) > 0, id);
  }
});

test('confirmation : résumé et formulaire avant les détails repliés, sécurités de #75 inchangées', () => {
  const dlg = between(HTML, '<dialog id="tr-dialog"', '</dialog>');
  const pos = id => dlg.indexOf(`id="${id}"`);
  assert.ok(pos('tr-dialog-changes') < pos('tr-reason') && pos('tr-reason') < pos('tr-confirm-input') && pos('tr-confirm-input') < pos('tr-dialog-details'));
  assert.ok(pos('tr-dialog-details') < pos('tr-diff') && pos('tr-diff') < pos('tr-impact'), 'avant / après et impact dans les détails');
  assert.match(dlg, /<details class="pd-more" id="tr-dialog-details">/);
  assert.match(dlg, /<div class="form-actions">\s*<button type="button" class="btn btn-outline" data-close>Annuler<\/button>\s*<button type="button" class="btn btn-danger" id="btn-tr-confirm" disabled>/);
  // motif obligatoire, pseudo exact, révision attendue et identifiant de requête toujours envoyés
  assert.match(JS, /document\.getElementById\('tr-confirm-input'\)\.value === _trCtx\.username/);
  assert.match(JS, /document\.getElementById\('tr-reason'\)\.value\.trim\(\)\.length >= 3/);
  assert.match(JS, /expectedRevision: ctx\.expectedRevision,\s*requestId: ctx\.requestId/);
});

test('pagination : toutes les lignes restent dans le tableau, seules celles de la page sont affichées', () => {
  const src = JS.slice(JS.indexOf('function admTablePage('), JS.indexOf('\n}\n', JS.indexOf('function admTablePage(')) + 2);
  const mkRows = n => Array.from({ length: n }, () => ({ hidden: false }));
  const made = [];
  const doc = { createElement: () => { const e = { addEventListener() {}, set textContent(v) { this._t = v; }, get textContent() { return this._t; } }; made.push(e); return e; } };
  const ctx = { document: doc, Math, Object };
  vm.runInNewContext(`${src}; this.page = admTablePage;`, ctx);
  const rows = mkRows(8);
  const table = { tBodies: [{ rows }] };
  const pager = { dataset: {}, set textContent(v) { this.items = []; }, append(...x) { this.items.push(...x); } };
  ctx.page(table, pager, 5, 0);
  assert.deepStrictEqual(rows.map(r => r.hidden), [false, false, false, false, false, true, true, true]);
  assert.strictEqual(pager.hidden, false);
  assert.match(pager.items[1].textContent, /1–5 sur 8 · page 1\/2/);
  ctx.page(table, pager, 5, 9);   // page hors limites → dernière page
  assert.deepStrictEqual(rows.map(r => r.hidden), [true, true, true, true, true, false, false, false]);
  const few = mkRows(3);
  ctx.page({ tBodies: [{ rows: few }] }, pager, 5, 0);
  assert.ok(few.every(r => !r.hidden) && pager.hidden, 'une seule page : pas de barre');
});

test('historique : essai en cours d\'abord, plus récent ensuite ; recherche à un résultat → fiche', () => {
  const load = JS.slice(JS.indexOf('async function loadTestRuns('), JS.indexOf('function trFillDialog('));
  assert.ok(load.indexOf('(en cours)') < load.indexOf('[...data.runs].reverse()'));
  assert.match(load, /admTablePage\(table, document\.getElementById\('tr-pager'\), TR_PAGE\)/);
  assert.match(JS, /if \(data\.users\.length === 1\) viewPlayerSave\(data\.users\[0\]\.id, data\.users\[0\]\.username\)/);
});

test('CSS : pied de confirmation fixe dans les fenêtres, tableaux en cartes sur smartphone', () => {
  assert.match(CSS, /\.bk-dialog:not\(\.nw-dialog\) > \.form-actions:not\(:has\(~ :not\(p\)\)\),[\s\S]*?position: sticky; bottom: -16px;/);
  assert.match(CSS, /\.adm-rtable td\[data-label\]::before \{ content: attr\(data-label\)/);
  assert.match(CSS, /\.adm-rtable tr\[hidden\] \{ display: none; \}/);
});
