/**
 * UX commune du panel admin (demande du propriétaire du 31/10, 20:19) : la page montre d'abord les
 * données ; aucun formulaire de création visible par défaut ; « ＋ Ajouter » ouvre une fiche <dialog>,
 * un clic sur une ligne ouvre la fiche de consultation/édition. Lot #37 : Blocs (choix IA / manuel),
 * Saisons, Ligues, Boutique. Contrôle statique du balisage et du câblage d'admin.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');

/** Contenu de la section d'onglet, hors <dialog> (ce qui est visible sans action). */
function visibleTab(tab) {
  const start = HTML.indexOf(`<section id="tab-${tab}"`);
  const end = HTML.indexOf('</section>', start);
  assert.ok(start > 0 && end > start, `onglet ${tab} introuvable`);
  return HTML.slice(start, end).replace(/<dialog[\s\S]*?<\/dialog>/g, '');
}
function dialog(id) {
  const m = HTML.match(new RegExp(`<dialog id="${id}"[\\s\\S]*?</dialog>`));
  assert.ok(m, `dialogue ${id} introuvable`);
  return m[0];
}

const LOT = {
  seasons: { add: 'btn-new-season', dlg: 'season-dialog', fields: ['ns-name', 'ns-start', 'ns-end'] },
  leagues: { add: 'btn-new-league', dlg: 'league-dialog', fields: ['nl-name', 'nl-icon', 'nl-level', 'nl-rmin', 'nl-rmax', 'nl-order'] },
  shop: { add: 'btn-sh-new', dlg: 'sh-dialog', fields: ['sh-cost', 'sh-kind', 'sh-fr-title', 'sh-visible'] },
  blocks: { add: 'btn-bk-add', dlg: 'bk-dialog', fields: ['bk-id', 'bk-name-fr', 'bk-hp', 'ai-concept'] },
};

test('aucun champ de création visible par défaut : tout est dans une fiche <dialog>', () => {
  for (const [tab, { fields }] of Object.entries(LOT)) {
    const vis = visibleTab(tab);
    for (const f of fields) assert.doesNotMatch(vis, new RegExp(`id="${f}"`), `${tab} : ${f} visible hors fiche`);
  }
});

test('un bouton « ＋ Ajouter … » principal par onglet, qui ouvre une fiche', () => {
  for (const [tab, { add }] of Object.entries(LOT)) {
    const vis = visibleTab(tab);
    const btns = [...vis.matchAll(/<button class="btn btn-primary" id="([^"]+)"[^>]*>＋ Ajouter[^<]*<\/button>/g)].map(m => m[1]);
    assert.deepStrictEqual(btns, [add], `${tab} : bouton Ajouter`);
    assert.match(JS, new RegExp(`getElementById\\('${add}'\\)\\.addEventListener\\('click'`));
  }
  for (const tab of Object.keys(LOT)) {
    const start = HTML.indexOf(`<section id="tab-${tab}"`);
    assert.doesNotMatch(HTML.slice(start, HTML.indexOf('</section>', start)), /Nouveau \(vider/, tab);
  }
});

test('chaque fiche se ferme sans effet (✕ et Annuler data-close, Échap natif) et rend le focus', () => {
  for (const id of ['season-dialog', 'league-dialog', 'sh-dialog', 'bk-add-dialog', 'ai-dialog']) {
    const d = dialog(id);
    assert.match(d, new RegExp(`<dialog id="${id}" class="bk-dialog adm-dialog[^"]*" aria-labelledby="[^"]+">`));
    assert.ok((d.match(/data-close/g) || []).length >= 2, `${id} : ✕ et Annuler`);
    assert.match(JS, new RegExp(`admDialogSetup\\('${id}'\\)`));
  }
  const setup = JS.slice(JS.indexOf('function admDialogSetup('), JS.indexOf('function admDialogOpen('));
  assert.match(setup, /\[data-close\]/);
  assert.match(setup, /e\.target === dlg/);
  assert.match(setup, /data-adm-key/);
});

test('lignes existantes cliquables au clavier : saisons, ligues, articles (plus de bouton Modifier/Supprimer/Clore dans la liste)', () => {
  const row = JS.slice(JS.indexOf('function admRowOpen('), JS.indexOf('function admShowError('));
  assert.match(row, /tr\.tabIndex = 0/);
  assert.match(row, /e\.key !== 'Enter' && e\.key !== ' '/);
  assert.match(JS, /admRowOpen\(tr, `season:\$\{s\.id\}`/);
  assert.match(JS, /admRowOpen\(tr, `league:\$\{l\.id\}`/);
  assert.match(JS, /admRowOpen\(tr, `shop:\$\{it\.id\}`/);
  assert.doesNotMatch(JS, /addButtonCell\(tr, 'Clore'/);
  assert.doesNotMatch(JS, /addButtonCell\(tr, 'Supprimer', \(\) => deleteLeague/);
  assert.doesNotMatch(JS, /addButtonCell\(tr, 'Modifier', \(\) => \{ shFillForm/);
});

test('Blocs : « Ajouter » propose IA ou manuel ; image IA seulement sur demande ; propositions = données', () => {
  const add = dialog('bk-add-dialog');
  assert.match(add, /id="btn-bk-add-ai"[\s\S]*Créer avec l'IA/);
  assert.match(add, /id="btn-bk-add-manual"[\s\S]*Créer manuellement/);
  const ai = dialog('ai-dialog');
  assert.match(ai, /<input type="checkbox" id="ai-with-image">/, 'image non cochée par défaut');
  assert.doesNotMatch(ai, /id="ai-with-image" checked/);
  assert.match(HTML, /<details class="overview-card hidden" id="ai-card">/);
  assert.match(JS, /card\.classList\.toggle\('hidden', !data\.proposals\.length && !data\.calls\.length\)/);
  assert.match(JS, /getElementById\('btn-bk-add-ai'\)\.disabled = !s\.configured/);
});

test('saison active : pas d\'édition de date dans la fiche (procédure #44 conservée), clôture confirmée', () => {
  const sheet = JS.slice(JS.indexOf('function openSeasonSheet('), JS.indexOf("document.getElementById('btn-new-season')"));
  assert.match(sheet, /btn-season-close'\)\.classList\.toggle\('hidden', isNew \|\| s\.status !== 'active'\)/);
  assert.doesNotMatch(sheet, /api\('PUT'/);
  assert.match(JS, /if \(!confirm\('Clore cette saison \?'\)\) return false;/);
  assert.match(JS, /if \(!confirm\(`Supprimer la ligue "\$\{name\}" \?`\)\) return false;/);
});
