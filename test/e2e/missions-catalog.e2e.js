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
const { admOpenTab } = require('./_admin-nav');

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

  await admOpenTab(page, 'missions');
  await page.waitForSelector('#mq-body tr.bk-row');
  assert.strictEqual(await page.locator('#mq-body tr.bk-row').count(), 6);
  assert.ok(!await page.locator('#mq-dialog').evaluate(d => d.open), 'aucune fiche ouverte au chargement');
  assert.match(await page.textContent('#mq-live'), /pas encore/);
  await page.screenshot({ path: `${SHOTS}/${tag}-1-liste.png`, fullPage: false });
  log(`${tag} : liste des six missions, bandeau « le jeu n'utilise pas encore ce catalogue »`);

  await page.click('#btn-mq-add');
  await page.waitForSelector('#mq-dialog[open]');
  assert.strictEqual(await page.inputValue('#mq-id'), '');
  await page.waitForFunction(() => document.querySelectorAll('#mq-preview-body > details.mq-pv').length === 4);
  assert.ok(await page.locator('#mq-acc-adv').evaluate(d => d.open), 'nouvelle mission : paramètres avancés ouverts (identifiant à remplir)');
  await page.screenshot({ path: `${SHOTS}/${tag}-2-ajouter.png` });
  await page.click('#mq-dialog .bk-dialog-foot [data-close]');
  await page.waitForFunction(() => !document.querySelector('#mq-dialog').open);
  log(`${tag} : « ＋ Ajouter » → fiche vide avec aperçu, fermée sans rien créer`);

  await page.click('[data-adm-key="mq:open_chests"]');
  await page.waitForSelector('#mq-dialog[open]');
  assert.strictEqual(await page.inputValue('#mq-fr-name'), 'Chercheur de trésors');
  await page.waitForFunction(() => /coffre/.test(document.querySelector('#mq-preview-body').textContent));
  const prev = await page.textContent('#mq-preview-body');
  assert.match(prev, /Débutant : 20 m/);
  assert.match(prev, /Ouvrir 3 coffres/);
  // Recette #68-A : essentiel visible, détails repliés, aucune saisie perdue en repliant, pas de défilement horizontal
  const open = await page.$$eval('#mq-dialog details.bk-acc', ds => Object.fromEntries(ds.map(d => [d.id, d.open])));
  assert.deepStrictEqual(open, { 'mq-acc-preview': true, 'mq-acc-goals': false, 'mq-acc-reward': false, 'mq-acc-visual': false, 'mq-acc-langs': false, 'mq-acc-adv': false });
  assert.match(await page.textContent('#mq-ov-reward'), /💰 par unité/);
  assert.match(await page.textContent('#mq-acc-preview-sum'), /disponible pour \d profils? sur 4/);
  assert.ok(await page.isVisible('#btn-mq-save') && await page.isVisible('#btn-mq-duplicate'), 'Enregistrer / Dupliquer visibles sans défiler');
  await page.click('#mq-acc-langs > summary');
  await page.fill('#mq-en-name', 'Treasure test');
  await page.click('#mq-acc-langs > summary');
  assert.strictEqual(await page.inputValue('#mq-en-name'), 'Treasure test', 'saisie conservée après repli');
  assert.ok(await page.locator('#mq-dialog').evaluate(d => d._admDirty()), 'modification détectée (garde #61)');
  const wide = await page.$eval('#mq-dialog .nw-scroll', el => el.scrollWidth - el.clientWidth);
  assert.ok(wide <= 1, `pas de défilement horizontal dans la fiche (${wide} px)`);
  await page.locator('#mq-sec-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${tag}-3-fiche-apercu.png` });
  const enName = (await api('/api/admin/missions')).published.missions.find(m => m.id === 'open_chests').names.en ?? '';
  await page.$eval('#mq-en-name', (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, enName);
  assert.ok(!await page.locator('#mq-dialog').evaluate(d => d._admDirty()), 'saisie d\'essai annulée');
  log(`${tag} : fiche « Chercheur de trésors », aperçu à 20/100/250/500 m`);

  const calls0 = (await api('/api/admin/icons')).calls.length;
  await page.click('#mq-acc-visual > summary');
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
  assert.ok(await page.locator('#mq-acc-visual').evaluate(d => d.open), 'retour de l\'atelier : section Visuel ouverte');
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
  assert.match(out, /trop peu profond \(à partir de 35 m\)/);
  assert.match(out, /toutes les améliorations sont déjà achetées/);
  assert.doesNotMatch(out, /find_gems|buy_upgrades/, 'aucun identifiant technique affiché');
  assert.match(out, /2\/2journées différentes/);
  assert.match(out, /Simulation uniquement/);
  assert.ok(!await page.locator('.mq-sim-more').first().evaluate(d => d.open), 'détails techniques repliés');
  const simWide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(simWide <= 1, `pas de défilement horizontal de la page (${simWide} px)`);
  await page.locator('#mq-sim-out').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${tag}-5-simulateur.png`, fullPage: true });
  log(`${tag} : simulateur, débutant 20 m / avancé 250 m sur deux journées, missions impossibles écartées`);

  const after = await api('/api/admin/missions');
  assert.deepStrictEqual([after.draft, after.versions.length], [null, before.versions.length], 'aucune écriture');
  assert.deepStrictEqual(errors, []);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  try {
    for (const [tag, viewport] of [['pc', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }], ['mobile320', { width: 320, height: 640 }]]) {
      const page = await browser.newPage({ viewport });
      await steps(page, tag);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
