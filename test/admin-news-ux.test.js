/**
 * Fiche Actualités du panel (#50, recettes #50-A/B/C/E du 03/11) — contrôle statique du balisage et d'admin.js :
 * - plus aucune fenêtre JS native (confirm/alert/prompt) dans le centre d'actualités : confirmation <dialog> stylée
 *   réutilisable (admConfirm), focus initial sur Annuler, Échap/fond = refus ;
 * - une langue visible à la fois (FR/EN/NL/ES) avec pastilles, aperçu dans la langue choisie ;
 * - notes → IA en tête, réglages facultatifs repliés, publication séparée de l'enregistrement ;
 * - une seule zone défilante, pied fixe ; fermeture protégée si saisies non enregistrées ; fiche complète imprimable ;
 * - liste pleine largeur, cartes sur mobile.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.css'), 'utf8');

const NEWS_JS = JS.slice(JS.indexOf('// ── Centre d\'actualités (#50)'), JS.indexOf('// ── Événements mensuels (#56)'));
const DLG = HTML.match(/<dialog id="news-dialog"[\s\S]*?<\/dialog>/)[0];
const fn = name => { const i = JS.indexOf(`function ${name}(`); assert.ok(i >= 0, name); return JS.slice(i, JS.indexOf('\n}\n', i)); };

test('centre d\'actualités : aucune fenêtre JS native, confirmations via admConfirm', () => {
  assert.ok(NEWS_JS.length > 1000);
  assert.doesNotMatch(NEWS_JS, /\b(window\.)?(confirm|alert|prompt)\(/);
  for (const k of ['publish', 'schedule', 'unpublish', 'archive', 'restore']) assert.match(fn('nwConfirmText'), new RegExp(`\\b${k}: \\{ title:`), k);
  // Archiver / Dépublier / Restaurer / Publier depuis la liste passent par la confirmation
  for (const k of ['publish', 'unpublish', 'archive', 'restore']) assert.match(fn('renderNews'), new RegExp(`nwConfirmAction\\(it, '${k}'\\)`), k);
  assert.match(fn('nwConfirmAction'), /if \(!await admConfirm\(/);
  // Publier / Programmer depuis la fiche aussi
  assert.strictEqual((NEWS_JS.match(/if \(!await admConfirm\(nwConfirmText\(cur, '(publish|schedule)'/g) || []).length, 2);
  // Pas de double envoi
  assert.match(fn('nwAction'), /_nwBusy\.has\(key\)/);
  assert.match(fn('nwSave'), /if \(_nwSaving\) return null/);
});

test('admConfirm : <dialog> natif stylé, focus sur Annuler, refus par défaut, focus rendu, rendu texte sûr', () => {
  const c = fn('admConfirm');
  assert.match(c, /createElement\('dialog'\)/);
  assert.match(c, /showModal\(\)/);
  assert.match(c, /querySelector\('#adm-confirm-no'\)\.focus\(\)/);
  assert.match(c, /resolve\(dlg\.returnValue === 'yes'\)/, 'Échap / fond / Annuler = false');
  assert.match(c, /e\.target === dlg\) dlg\.close\('no'\)/);
  assert.match(c, /opener\.focus\(\)/);
  assert.match(c, /if \(dlg\.open\) return Promise\.resolve\(false\)/, 'pas de seconde confirmation empilée');
  assert.doesNotMatch(c, /innerHTML/);
  assert.match(CSS, /\.adm-confirm-impact/);
});

test('fiche : une langue visible à la fois, pastilles, aperçu dans la langue choisie', () => {
  assert.match(DLG, /<div class="co-lang-switch" id="nw-langs" role="group"/);
  for (const l of ['fr', 'en', 'nl', 'es']) {
    assert.match(DLG, new RegExp(`<button type="button" class="co-lang-btn" data-lang="${l}" aria-pressed="${l === 'fr'}">`));
    assert.match(DLG, new RegExp(`<div class="nw-lang-fields${l === 'fr' ? '' : ' hidden'}" data-lang="${l}">`));
    for (const f of ['title', 'summary', 'body', 'linklabel']) assert.match(DLG, new RegExp(`id="nw-${f}-${l}"`));
  }
  assert.doesNotMatch(DLG, /<details class="nw-lang"/, 'plus de blocs de langue empilés');
  assert.match(fn('nwLang'), /classList\.toggle\('hidden', d\.dataset\.lang !== l\)/);
  assert.match(fn('nwPreview'), /nwPreviewItem\(it, l\)/);
  assert.match(fn('nwPreview'), /co-lang--\$\{st\}/);
});

test('fiche : notes → IA en tête, réglages repliés, publication séparée, une seule zone défilante', () => {
  const order = ['id="nw-ai-box"', 'id="nw-langs"', 'id="nw-opts"', 'id="nw-publish-row"', 'class="nw-foot"'].map(x => DLG.indexOf(x));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), `ordre ${order}`);
  assert.match(DLG, /<details class="nw-sec" id="nw-opts">/, 'réglages facultatifs repliés');
  assert.match(DLG, /<details class="nw-help">/, 'aide repliée');
  assert.match(DLG, /<details id="nw-ai-more" class="nw-ai-more hidden">/, 'suggestions IA repliées');
  assert.match(fn('nwAiNotes'), /p\?\.suggestions/);
  assert.match(DLG, /<div class="nw-foot">[\s\S]*id="btn-nw-save"[\s\S]*data-close>Annuler/);
  assert.doesNotMatch(DLG.slice(DLG.indexOf('class="nw-foot"')), /btn-nw-publish|btn-nw-schedule/, 'publier hors du pied');
  assert.match(CSS, /\.nw-dialog\[open\] \{[^}]*max-height: calc\(100dvh - 24px\); overflow: hidden/);
  assert.match(CSS, /\.nw-scroll \{[^}]*overflow: auto/);
});

test('fiche : fermeture protégée (✕, Annuler, fond, Échap, page) et fiche complète imprimable', () => {
  assert.match(fn('nwRequestClose'), /nwDirty\(\) && !await admConfirm\(/);
  assert.match(NEWS_JS, /dlg\.addEventListener\('cancel', e => \{ e\.preventDefault\(\); nwRequestClose\(\); \}\)/);
  assert.match(NEWS_JS, /closest\('\[data-close\]'\)/);
  assert.match(NEWS_JS, /e\.stopImmediatePropagation\(\)/);
  assert.match(NEWS_JS, /beforeunload', e => \{ if \(nwDirty\(\)\)/);
  assert.match(fn('nwOpen'), /_nwSnap = nwSnapshot\(\)/);
  assert.match(fn('nwSave'), /_nwSnap = nwSnapshot\(\)/);
  assert.match(DLG, /id="btn-nw-print"/);
  assert.match(fn('nwPrint'), /for \(const l of NW_LANGS\)/);
  assert.match(fn('nwPrint'), /window\.print\(\)/);
  assert.match(HTML, /<div id="nw-print" class="nw-print" aria-hidden="true"><\/div>/);
  assert.match(CSS, /@media print \{\s*body\.nw-printing > :not\(#nw-print\)/);
});

test('liste : pleine largeur, colonnes dimensionnées, cartes sur mobile', () => {
  assert.match(HTML, /<table class="news-table">/);
  assert.match(CSS, /#tab-news\.tab-content \{[^}]*max-width: 1440px/);
  assert.match(CSS, /\.news-table td\[data-label\]::before \{ content: attr\(data-label\)/);
  assert.match(fn('renderNews'), /td\.dataset\.label = label/);
});
