/**
 * Essai navigateur #68 — catalogue de missions quotidiennes (étape A). Hors `npm test`, aucune écriture :
 *   Missions → liste des six missions (sans formulaire ouvert) → « ＋ Ajouter » ouvre une fiche vide puis
 *   se ferme sans rien créer → fiche « Chercheur de trésors » : aperçu 20/100/250/500 m → « Icônes » :
 *   fiche de l'atelier « Mission quotidienne » avec retour vers la mission (aucune génération) →
 *   simulateur : proposition adaptative, débutant 20 m et avancé 250 m, deux journées.
 * Ordinateur 1280×900 et smartphone 390×844.
 *
 * Lancer (serveur de test démarré) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> SHOTS=/tmp/dossier \
 *   node test/e2e/missions-catalog.e2e.js
 */

'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);

const { BASE, ADMIN } = process.env;
const SHOTS = process.env.SHOTS || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}` };
const log = (...a) => console.log('✓', ...a);
const api = async p => (await fetch(`${BASE}${p}`, { headers: H })).json();

async function steps(page, tag) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  const before = await api('/api/admin/missions');

  await page.click('.tab-btn[data-tab="missions"]');
  await page.waitForSelector('#mq-body tr.bk-row');
  assert.strictEqual(await page.locator('#mq-body tr.bk-row').count(), 6);
  assert.ok(!await page.locator('#mq-dialog').evaluate(d => d.open), 'aucune fiche ouverte au chargement');
  assert.match(await page.textContent('#mq-live'), /pas encore/);
  await page.screenshot({ path: `${SHOTS}/${tag}-1-liste.png`, fullPage: false });
  log(`${tag} : liste des six missions, bandeau « le jeu n'utilise pas encore ce catalogue »`);

  await page.click('#btn-mq-add');
  await page.waitForSelector('#mq-dialog[open]');
  assert.strictEqual(await page.inputValue('#mq-id'), '');
  await page.waitForFunction(() => document.querySelectorAll('#mq-preview-body tr').length === 4);
  await page.screenshot({ path: `${SHOTS}/${tag}-2-ajouter.png` });
  await page.click('#mq-dialog .bk-dialog-foot [data-close]');
  await page.waitForFunction(() => !document.querySelector('#mq-dialog').open);
  log(`${tag} : « ＋ Ajouter » → fiche vide avec aperçu, fermée sans rien créer`);

  await page.click('[data-adm-key="mq:open_chests"]');
  await page.waitForSelector('#mq-dialog[open]');
  assert.strictEqual(await page.inputValue('#mq-fr-name'), 'Chercheur de trésors');
  await page.waitForFunction(() => /coffre/.test(document.querySelector('#mq-preview-body').textContent));
  const prev = await page.textContent('#mq-preview-body');
  assert.match(prev, /Débutant — 20 m/);
  assert.match(prev, /Ouvrir 3 coffres/);
  await page.locator('#mq-sec-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${tag}-3-fiche-apercu.png` });
  log(`${tag} : fiche « Chercheur de trésors », aperçu à 20/100/250/500 m`);

  const calls0 = (await api('/api/admin/icons')).calls.length;
  await page.click('#btn-mq-studio');
  await page.waitForFunction(() => document.querySelector('#ic-sheet h3')?.textContent === 'Chercheur de trésors' && document.querySelector('#ic-sheet').offsetParent);
  const sheet = await page.textContent('#ic-sheet');
  assert.match(sheet, /Mission quotidienne/);
  assert.match(sheet, /Retour à la fiche de la mission/);
  assert.strictEqual((await api('/api/admin/icons')).calls.length, calls0, 'ouvrir l\'atelier ne génère rien');
  await page.screenshot({ path: `${SHOTS}/${tag}-4-atelier.png` });
  await page.click('text=← Retour à la fiche de la mission');
  await page.waitForSelector('#mq-dialog[open]');
  assert.strictEqual(await page.inputValue('#mq-id'), 'open_chests');
  await page.click('#mq-dialog .bk-dialog-foot [data-close]');
  log(`${tag} : atelier d'icônes (famille « Mission quotidienne »), aucune génération, retour à la fiche`);

  await page.selectOption('#mq-sim-source', 'proposal');
  await page.fill('#mq-sim-days', '2');
  await page.fill('#mq-sim-start', '2026-11-05');
  await page.click('#btn-mq-simulate');
  await page.waitForSelector('.mq-sim-profile');
  const out = await page.textContent('#mq-sim-out');
  assert.match(out, /Débutant — 20 m/);
  assert.match(out, /Avancé — 250 m/);
  assert.match(out, /find_gems : profondeur < 35 m/);
  assert.match(out, /buy_upgrades : toutes les améliorations sont au maximum/);
  await page.locator('#mq-sim-out').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${tag}-5-simulateur.png`, fullPage: true });
  log(`${tag} : simulateur, débutant 20 m / avancé 250 m sur deux journées, missions impossibles écartées`);

  const after = await api('/api/admin/missions');
  assert.deepStrictEqual([after.draft, after.versions.length], [null, before.versions.length], 'aucune écriture');
  assert.deepStrictEqual(errors, []);
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [tag, viewport] of [['pc', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport });
      await steps(page, tag);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
