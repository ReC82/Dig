/**
 * Essai navigateur de la fiche d'un bloc (#37, recette du propriétaire du 02/11) : sections, aide ⓘ,
 * provenance des traductions, traduction IA SIMULÉE (aucune dépense), probabilités effectives,
 * confirmation avant de perdre des valeurs non enregistrées, annulation d'un bloc et de tout le
 * brouillon. Hors `npm test` (navigateur requis). Rien n'est publié.
 *
 * Lancer (serveur de test déjà démarré avec DIG_AI_FAKE=1) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> SHOTS=/tmp/dossier \
 *   node test/e2e/block-sheet.e2e.js
 */

'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE;
const ADMIN = process.env.ADMIN;
const SHOTS = process.env.SHOTS || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}` };
const log = (...a) => console.log('✓', ...a);
const view = async () => (await fetch(`${BASE}/api/admin/blocks`, { headers: H })).json();

async function login(page) {
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await admOpenTab(page, 'blocks');
  await page.waitForSelector('#bk-body tr[data-id="charbon"]');
}

const openRow = async (page, id) => {
  await page.click(`#bk-body tr[data-id="${id}"] td:nth-child(3)`);
  await page.waitForSelector('#bk-dialog[open]');
};
const isOpen = (page, id) => page.$eval(`#${id}`, d => d.open);

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const confirms = [];
  page.on('dialog', d => { confirms.push(d.message()); d.accept(); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const v0 = await view();
  const pub0 = v0.published.version;
  const reward0 = v0.published.types.find(t => t.id === 'charbon').reward;
  assert.strictEqual(v0.draft, null, 'départ sans brouillon en attente');

  await login(page);
  await openRow(page, 'charbon');
  for (const l of ['Identité et traductions', 'Apparition et rareté', 'Récompenses et gemmes', 'Visuel']) {
    assert.ok(await page.isVisible(`#bk-dialog legend:has-text("${l}")`), l);
  }
  assert.strictEqual(await page.isVisible('#bk-icon'), false, 'emoji rangé dans les options avancées');
  assert.match(await page.textContent('#bk-name-src-en'), /intégrée au jeu : « .+ »/);
  assert.ok(await page.isDisabled('#btn-bk-translate'), 'charbon : aucune traduction manquante');
  assert.match(await page.textContent('#bk-eff'), /À \d+ m : .*%.*1 bloc sur/);
  assert.strictEqual(await page.isVisible('#bk-h-weight'), false);
  await page.click('[aria-controls="bk-h-weight"]');
  assert.match(await page.textContent('#bk-h-weight'), /somme des poids/);
  assert.strictEqual(await page.isVisible('#bk-sheet-draft'), false, 'aucun brouillon : pas d\'encadré');
  await page.screenshot({ path: `${SHOTS}/sheet-1280.png`, fullPage: false });
  log('fiche en sections, aide ⓘ, provenance des noms, probabilité effective');

  // Aucune modification : Échap ferme sans question
  await page.keyboard.press('Escape');
  assert.strictEqual(await isOpen(page, 'bk-dialog'), false);
  assert.strictEqual(await isOpen(page, 'bk-leave-dialog'), false);
  log('fermeture rapide sans modification');

  // Valeur modifiée non enregistrée : Échap, ✕, fond → confirmation
  await openRow(page, 'charbon');
  await page.fill('#bk-reward', String(reward0 + 1));
  assert.ok(await page.isVisible('#bk-dirty'));
  await page.keyboard.press('Escape');
  assert.ok(await isOpen(page, 'bk-leave-dialog'), 'Échap : confirmation');
  await page.click('#btn-bk-leave-stay');
  assert.ok(await isOpen(page, 'bk-dialog'));
  assert.strictEqual(await page.inputValue('#bk-reward'), String(reward0 + 1), 'valeur conservée');
  await page.click('#btn-bk-close');
  assert.ok(await isOpen(page, 'bk-leave-dialog'), '✕ : confirmation');
  await page.click('#btn-bk-leave-stay');
  await page.mouse.click(5, 5);
  assert.ok(await isOpen(page, 'bk-leave-dialog'), 'clic sur le fond : confirmation');
  await page.screenshot({ path: `${SHOTS}/leave-1280.png` });
  await page.click('#btn-bk-leave-go');
  assert.strictEqual(await isOpen(page, 'bk-dialog'), false);
  assert.strictEqual((await view()).draft, null, 'abandon : rien écrit');
  log('confirmation « Abandonner / Continuer » sur Échap, ✕ et fond ; abandon sans écriture');

  // Brouillon 22 → 23 puis annulation de CE bloc
  await openRow(page, 'charbon');
  await page.fill('#bk-reward', String(reward0 + 1));
  await page.click('#btn-bk-save');
  await page.waitForFunction(() => !document.getElementById('bk-sheet-draft').classList.contains('hidden'));
  const diffText = await page.textContent('#bk-sheet-diff-body');
  assert.ok(diffText.includes(String(reward0)) && diffText.includes(String(reward0 + 1)), diffText);
  assert.match(await page.textContent('#bk-diff-pub'), new RegExp(`v${pub0}`));
  assert.ok(!(await page.isDisabled('#btn-bk-revert')));
  assert.ok(!(await page.isVisible('#bk-dirty')), 'enregistré : plus de modification en attente dans la fiche');
  await page.screenshot({ path: `${SHOTS}/draft-diff-1280.png` });
  await page.click('#btn-bk-revert');
  await page.waitForFunction(() => /annulées/.test(document.getElementById('bk-form-msg').textContent));
  assert.match(confirms.at(-1), /Annuler les modifications de « charbon »/);
  const v1 = await view();
  assert.strictEqual(v1.draft, null, 'brouillon redevenu identique : plus présenté');
  assert.strictEqual(v1.published.version, pub0, 'rien publié');
  assert.strictEqual(await page.inputValue('#bk-reward'), String(reward0));
  assert.match(await page.textContent('#bk-banner'), /Aucun brouillon/);
  await page.keyboard.press('Escape');
  log('annulation des modifications de ce bloc : publié rétabli, rien publié, plus de brouillon');

  // Deux blocs modifiés, « Abandonner tout le brouillon » depuis une fiche
  for (const [id, field] of [['charbon', '#bk-reward'], ['pierre', '#bk-hp']]) {
    await openRow(page, id);
    const v = Number(await page.inputValue(field));
    await page.fill(field, String(v + 1));
    await page.click('#btn-bk-save');
    await page.waitForFunction(() => !document.getElementById('bk-form-msg').classList.contains('hidden')
      && document.getElementById('bk-dirty').classList.contains('hidden'));
    await page.keyboard.press('Escape');
  }
  assert.strictEqual((await view()).draft.changes.length, 2);
  await openRow(page, 'pierre');
  await page.click('#btn-bk-discard-all');
  await page.waitForFunction(() => /abandonné/.test(document.getElementById('bk-form-msg').textContent));
  assert.match(confirms.at(-1), /TOUT le brouillon[\s\S]*2 changement/);
  assert.strictEqual((await view()).draft, null);
  assert.strictEqual((await view()).published.version, pub0);
  await page.keyboard.press('Escape');
  log('abandon de tout le brouillon depuis la fiche, rien publié');

  // Nouveau bloc : traduction IA simulée des langues manquantes
  await page.click('#btn-bk-add');
  await page.click('#btn-bk-add-manual');
  await page.fill('#bk-id', 'basalte_essai');
  await page.fill('#bk-name-fr', 'Basalte lunaire');
  assert.match(await page.textContent('#bk-name-src-en'), /manquante : le jeu affiche le nom FR/);
  assert.ok(!(await page.isDisabled('#btn-bk-translate')));
  await page.click('#btn-bk-translate');
  await page.waitForFunction(() => /Proposition IA/.test(document.getElementById('bk-translate-msg').textContent));
  assert.strictEqual(await page.inputValue('#bk-name-en'), 'Lunar basalt');
  assert.ok(await page.$eval('#bk-name-nl', e => e.classList.contains('bk-ai-filled')));
  assert.match(await page.textContent('#bk-name-src-es'), /personnalisée/);
  await page.selectOption('#bk-category', 'gemme');
  await page.fill('#bk-min', '30');
  await page.fill('#bk-weight', '2');
  assert.match(await page.textContent('#bk-gem-note'), /1 gemme à chaque bloc cassé .*#49/);
  assert.match(await page.textContent('#bk-eff'), /À \d+ m/);
  await page.click('[aria-controls="bk-h-cat"]');
  assert.match(await page.textContent('#bk-h-cat'), /Gemme : rapporte/);
  await page.screenshot({ path: `${SHOTS}/new-translate-1280.png`, fullPage: false });
  assert.strictEqual((await view()).draft, null, 'traduction : rien enregistré');
  await page.keyboard.press('Escape');
  assert.ok(await isOpen(page, 'bk-leave-dialog'));
  await page.click('#btn-bk-leave-go');
  log('traduction IA (simulée) : champs vides remplis, surlignés, rien enregistré');

  // Smartphone
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  m.on('pageerror', e => errors.push(String(e)));
  await login(m);
  await m.tap('#bk-body tr[data-id="charbon"] td:nth-child(3)');
  await m.waitForSelector('#bk-dialog[open]');
  const box = await m.$eval('#bk-dialog', d => ({ w: d.getBoundingClientRect().width, over: d.scrollWidth - d.clientWidth }));
  assert.ok(box.w <= 390 && box.over <= 1, JSON.stringify(box));
  await m.tap('[aria-controls="bk-h-fade"]');
  assert.ok(await m.isVisible('#bk-h-fade'));
  await m.screenshot({ path: `${SHOTS}/sheet-390.png`, fullPage: false });
  await m.fill('#bk-reward', String(reward0 + 5));
  await m.tap('#btn-bk-close');
  assert.ok(await isOpen(m, 'bk-leave-dialog'));
  await m.screenshot({ path: `${SHOTS}/leave-390.png` });
  await m.tap('#btn-bk-leave-go');
  log('smartphone 390 px : fiche dans l\'écran, aide au toucher, confirmation');

  assert.deepStrictEqual(errors, []);
  assert.strictEqual((await view()).draft, null);
  await browser.close();
  log('0 erreur JS, aucun brouillon laissé, rien publié');
}

main().catch(e => { console.error(e); process.exit(1); });
