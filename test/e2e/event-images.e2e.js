/**
 * Essai navigateur #65 — images des objets souvenirs d'événement. Transport IA SIMULÉ (aucune dépense).
 * Hors `npm test`. Sur une copie de la base de production : événement TEST avec « Caillou de test »
 * déjà trouvé, Noël en brouillon.
 *   Événements → fiche → objet → « Créer une image avec l'IA » → fiche Icônes préremplie (thème,
 *   description, consigne) → Générer (factice) → Conserver → « Conservée dans le brouillon » →
 *   « Publier les images » → « Publiée » ; statut de l'événement inchangé ; Noël reste en brouillon.
 *
 * Lancer (serveur de test démarré avec DIG_AI_FAKE=1) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> SHOTS=/tmp/dossier \
 *   EVENT=<id événement TEST> ITEM=<id objet> NAME="Caillou de test" node test/e2e/event-images.e2e.js
 */

'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const { BASE, ADMIN, EVENT, ITEM, NAME } = process.env;
const SHOTS = process.env.SHOTS || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}` };
const log = (...a) => console.log('✓', ...a);
const api = async p => (await fetch(`${BASE}${p}`, { headers: H })).json();
// Appels d'image seulement (le contrôle du sujet « check:… » est un appel texte séparé, comme pour les objets)
const imageCalls = async () => (await api('/api/admin/icons')).calls.filter(c => !c.target.startsWith('check:')).length;
const evOf = async id => (await api('/api/admin/events')).events.find(e => e.id === id);

async function openItem(page) {
  await admOpenTab(page, 'events');
  await page.click(`[data-adm-key="ev:${EVENT}"]`);
  await page.waitForSelector('#ev-dialog[open]');
  await page.click(`#ev-items tr:has-text("${NAME}")`);
  await page.waitForSelector('#ev-item-dialog[open]');
}

async function steps(page, tag, { generate }) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');

  await openItem(page);
  const st0 = await page.textContent('#evi-img-state');
  assert.match(st0, generate ? /Sans image|Proposition/ : /Publiée|Sans image|Conservée/);
  const btn = page.locator('#btn-evi-studio');
  assert.ok(await btn.isVisible(), 'bouton visible même en consultation');
  assert.strictEqual((await btn.textContent()).trim(), '🎨 Créer une image avec l\'IA');
  await page.screenshot({ path: `${SHOTS}/${tag}-1-fiche-objet.png` });
  log(`${tag} : fiche objet, état « ${st0.trim()} », bouton « Créer une image avec l'IA »`);

  const calls0 = await imageCalls();
  await btn.click();
  await page.waitForFunction(n => document.querySelector('#ic-sheet h3')?.textContent === n && document.querySelector('#ic-sheet').offsetParent, NAME);
  const sheet = await page.textContent('#ic-sheet');
  assert.match(sheet, /Objet d'événement/);
  assert.match(sheet, /Retour à la fiche de l'objet d'événement/);
  assert.match(sheet, generate ? /Consigne d'illustration de cet objet/ : /Description de l'icône/);   // image déjà choisie : consigne sous « Plus d'options »
  assert.match(sheet, /souvenir of the/, 'thème de l\'événement dans la consigne');
  assert.strictEqual(await imageCalls(), calls0, 'ouvrir la fiche ne génère rien');
  await page.screenshot({ path: `${SHOTS}/${tag}-2-atelier.png`, fullPage: true });
  log(`${tag} : fiche Icônes préremplie (thème, consigne), aucun appel`);

  if (generate) {
    await page.click('#ic-sheet button:has-text("Générer une image")');
    await page.waitForSelector('#ic-sheet button:has-text("Conserver cette image")', { timeout: 30000 });
    assert.strictEqual(await imageCalls(), calls0 + 1, 'une image par clic');
    await page.click('#ic-sheet button:has-text("Conserver cette image")');
    await page.waitForFunction(() => /Publier les images/.test(document.querySelector('#ic-sheet')?.textContent ?? ''));
    let it = (await evOf(EVENT)).items.find(i => i.id === ITEM);
    assert.strictEqual(it.imageState, 'draft');
    assert.strictEqual(it.publishedImage, null, 'joueur : toujours l\'emoji');
    await page.screenshot({ path: `${SHOTS}/${tag}-3-conservee.png`, fullPage: true });
    log(`${tag} : générée (factice), conservée dans le brouillon, pas encore publiée`);

    await page.click('#ic-sheet button:has-text("Retour à la fiche de l\'objet d\'événement")');
    await page.waitForSelector('#ev-item-dialog[open]');
    assert.match(await page.textContent('#evi-img-state'), /Conservée dans le brouillon/);
    await page.click('#ev-item-dialog [data-close]');
    const status0 = (await evOf(EVENT)).status;
    const pb = page.locator('#btn-ev-publish-images');
    assert.match(await pb.textContent(), /Publier les images \(1\)/);
    await pb.click();
    await page.click('#adm-confirm-yes');
    await page.waitForFunction(() => document.getElementById('btn-ev-publish-images').classList.contains('hidden'));
    it = (await evOf(EVENT)).items.find(i => i.id === ITEM);
    assert.deepStrictEqual([it.imageState, it.publishedImage === it.image], ['published', true]);
    assert.strictEqual((await evOf(EVENT)).status, status0, 'statut inchangé');
    await page.screenshot({ path: `${SHOTS}/${tag}-4-publiee.png` });
    log(`${tag} : « Publier les images » → publiée, statut « ${status0} » inchangé`);
  }
  assert.strictEqual((await evOf('noel_2026'))?.status ?? 'draft', 'draft', 'Noël reste en brouillon');
  assert.deepStrictEqual(errors, []);
}

(async () => {
  const browser = await chromium.launch();
  for (const [w, h, tag, generate] of [[1280, 900, 'pc', true], [390, 844, 'mobile', false]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    try { await steps(page, tag, { generate }); } catch (e) {
      await page.screenshot({ path: `${SHOTS}/${tag}-echec.png`, fullPage: true });
      await browser.close();
      throw e;
    }
    await page.close();
  }
  await browser.close();
  console.log('Essai navigateur #65 : OK');
})().catch(e => { console.error(e); process.exit(1); });
