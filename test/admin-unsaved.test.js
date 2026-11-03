/**
 * Saisies protégées dans tout le panel admin (#61) — contrôle statique d'admin.js / index.html :
 * - plus aucune fenêtre JS native (confirm / alert / prompt) dans le panel : admConfirm, admAsk, admAlert, admPrompt ;
 * - toute fiche <dialog> passe par admDialogSetup (sauf la fiche Blocs, à confirmation dédiée) : ✕ / Annuler / fond /
 *   Échap (dès la touche) → même demande de fermeture, confirmation « Modifications non enregistrées » si la fiche a changé ;
 * - clic commencé dans la fiche et relâché sur le fond (sélection de texte) ignoré ; marge intérieure ignorée ;
 * - suivi générique des champs (valeur relevée avant la première action, comparée ensuite) ; retour à l'état initial = propre ;
 * - échec réseau = échec ordinaire (fiche ouverte, saisie conservée) ; formulaires de page conservés au rechargement ;
 * - départ de la page protégé (beforeunload) pour toute fiche ou zone modifiée.
 * Parcours Chromium réels (PC 1280×900 et 390×844) : tools/e2e/admin-unsaved.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const fn = name => { const i = JS.search(new RegExp(`(async )?function ${name}\\(`)); assert.ok(i >= 0, name); return JS.slice(i, JS.indexOf('\n}\n', i)); };
const code = JS.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');

test('aucune fenêtre native (confirm / alert / prompt) dans le panel admin', () => {
  assert.doesNotMatch(code, /(^|[^.\w])(confirm|alert|prompt)\(/m);
  assert.doesNotMatch(code, /window\.(confirm|alert|prompt)\(/);
  assert.doesNotMatch(HTML, /\b(confirm|alert|prompt)\(/);
  // Remplaçants Dig
  assert.match(fn('admAsk'), /admConfirm\(\{ title, text: rest\.join/);
  assert.match(fn('admAlert'), /cancel: null/);
  assert.match(fn('admPrompt'), /field: \{ label, value, type, placeholder \}/);
  assert.match(fn('admPrompt'), /return null/);
  const c = fn('admConfirm');
  assert.match(c, /classList\.toggle\('hidden', cancel === null\)/);
  assert.match(c, /if \(field\) input\.select\(\)/);
  assert.match(c, /if \(down && admOnBackdrop\(dlg, e\)\) dlg\.close\('no'\)/);
  assert.doesNotMatch(c, /innerHTML/);
});

test('toute fiche <dialog> du panel est protégée', () => {
  const ids = [...HTML.matchAll(/<dialog id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 25, `${ids.length} fiches`);
  // bk-dialog : confirmation dédiée (bk-leave-dialog, validée #37) ; bk-leave-dialog : c'est elle.
  for (const id of ids.filter(i => !['bk-dialog', 'bk-leave-dialog'].includes(i))) {
    assert.match(JS, new RegExp(`admDialogSetup\\('${id}'(, \\{[^\\n]*\\})?\\)`), id);
  }
  // Plus aucune protection maison contournable (capture du clic + confirm natif)
  assert.doesNotMatch(JS, /const keep = \(\) =>/);
  assert.doesNotMatch(JS, /stopImmediatePropagation\(\);\s+if \(!inside\)/);
});

test('admDialogSetup : une seule demande de fermeture pour ✕, Annuler, fond, Échap', () => {
  const s = fn('admDialogSetup');
  assert.match(s, /dlg\.querySelectorAll\('\[data-close\]'\)\.forEach\(b => b\.addEventListener\('click', request\)\)/);
  assert.match(s, /downOnBackdrop = admOnBackdrop\(dlg, e\)/, 'appui sur le fond relevé');
  assert.match(s, /const ok = downOnBackdrop && admOnBackdrop\(dlg, e\)/, 'clic relâché sur le fond après un appui dans la fiche : ignoré');
  assert.match(s, /e\.key !== 'Escape'[\s\S]{0,80}e\.preventDefault\(\);\s+request\(\)/, 'Échap intercepté dès la touche');
  assert.match(s, /addEventListener\('cancel', e => \{ e\.preventDefault\(\); request\(\); \}\)/);
  assert.match(s, /admConfirmDiscard\(/);
  assert.match(s, /dirty \? dirty\(\) : track\.dirty\(\)/);
  assert.match(s, /track\.clean\(\)/, 'fermeture = état propre');
  assert.match(fn('admOnBackdrop'), /e\.clientX < r\.left \|\| e\.clientX > r\.right/, 'marge intérieure de la fiche ignorée');
  const d = fn('admConfirmDiscard');
  assert.match(d, /title: 'Modifications non enregistrées'/);
  assert.match(d, /ok: 'Abandonner les modifications', cancel: 'Continuer à modifier', danger: true/);
  assert.match(fn('admDialogOpen'), /dlg\._admTrack\?\.clean\(\)/, 'valeurs chargées = état de référence');
});

test('suivi générique : valeur relevée avant la 1re action, comparaison à la valeur actuelle', () => {
  const t = fn('admTrack');
  for (const ev of ['focusin', 'pointerdown', 'keydown', 'beforeinput']) assert.ok(t.includes(`'${ev}'`), ev);
  assert.match(t, /for \(const t of \['input', 'change'\]\)/);
  assert.match(t, /if \(f && !touched\.has\(f\)\) base\.set\(f, admFieldValue\(f\)\)/);
  assert.match(t, /f\.isConnected && admFieldValue\(f\) !== base\.get\(f\)/);
  assert.match(t, /f\.type !== 'search' && !f\.closest\('\[data-adm-noguard\]'\)/);
  const v = fn('admFieldValue');
  assert.match(v, /el\.type === 'checkbox' \|\| el\.type === 'radio'/);
  assert.match(v, /el\.type === 'file'/);
  assert.match(v, /el\.multiple/);
});

test('fiches à instantané branchées sur le mécanisme commun (Collections, Actualités, Boutique, Événements)', () => {
  assert.match(JS, /admDialogSetup\('co-series-dialog', \{ keep: 'Enregistrer la série dans le brouillon' \}\)/, 'cas du ticket (#39)');
  assert.match(JS, /admDialogSetup\('co-item-dialog', \{ dirty: \(\) => coItemDirty\(\)/);
  assert.match(JS, /admDialogSetup\('co-prop-dialog', \{ dirty: \(\) => !!_coPropWork\?\.dirty/);
  assert.match(JS, /admDialogSetup\('news-dialog', \{ canClose: nwCanClose, dirty: \(\) => nwDirty\(\) \}\)/);
  assert.match(JS, /admDialogSetup\('ev-dialog', \{ canClose: evCanClose, dirty: \(\) => evDirty\(\) \}\)/);
  assert.match(JS, /admDialogSetup\('ev-item-dialog', \{ canClose: eviCanClose, dirty: \(\) => eviDirty\(\) \}\)/);
  // Ouvrir l'atelier depuis une fiche = même protection
  assert.match(JS, /coItemDirty\(\) && !await admConfirmDiscard\(/);
  assert.match(JS, /if \(!await document\.getElementById\('bg-dialog'\)\._admRequestClose\(\)\) return;/);
  // Fiche Blocs : fond et Échap passent par sa confirmation
  assert.match(JS, /document\.getElementById\('bk-dialog'\)\._admDirty = bkDirty/);
});

test('départ de la page : un seul contrôle pour toutes les fiches et zones', () => {
  assert.strictEqual((JS.match(/addEventListener\('beforeunload'/g) || []).length, 1);
  assert.match(fn('admAnyDirty'), /dialog\[open\]'\)\]\.some\(d => d\._admDirty\?\.\(\)\) \|\| _admZones\.some\(z => z\.dirty\(\)\)/);
});

test('échec réseau : échec ordinaire, la fiche reste ouverte avec ses saisies', () => {
  const a = fn('api');
  assert.match(a, /try \{ res = await fetch\(path, opts\); \}/);
  assert.match(a, /catch \{ return \{ ok: false, status: 0, data: \{ error: 'Serveur injoignable/);
  // Les enregistrements ne ferment la fiche qu'en cas de succès
  const from = JS.indexOf("getElementById('btn-co-s-save').addEventListener");
  const save = JS.slice(from, JS.indexOf("getElementById('btn-co-s-remove').addEventListener", from));
  assert.ok(save.length > 100);
  assert.ok(save.indexOf("if (!ok) { ptMessage('co-s-msg'") < save.indexOf("getElementById('co-series-dialog').close()"));
});

test('formulaires de page : saisies conservées au rechargement, zone propre après enregistrement', () => {
  for (const [load, zone] of [['loadConfig', '_cfgZone'], ['loadEconomy', '_ecoZone'], ['loadAiBudget', '_aibZone'], ['loadShop', '_shSetZone'], ['renderAds', '_adSetZone']]) {
    assert.match(fn(load), new RegExp(`admZoneDirty\\(${zone}\\)`), load);
    assert.match(JS, new RegExp(`admZoneClean\\(${zone}\\)`), `${zone} nettoyée après enregistrement`);
  }
  assert.match(fn('renderNews'), /admZoneDirty\(document\.getElementById\('news-settings-card'\)\)/);
  assert.match(JS, /admZone\(document\.getElementById\('ct-form'\), \{ dirty: \(\) => _ctDirty \}\)/);
  assert.match(fn('renderAds'), /String\(slot\.slot\) !== String\(savedSlot\) && pasted\[slot\.slot\]/, 'code collé dans un autre emplacement conservé');
  assert.match(HTML, /id="ad-enabled" data-adm-noguard/);
});
