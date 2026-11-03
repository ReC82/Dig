/**
 * Essai navigateur de l'atelier d'icônes (#40, recettes des 02 et 03/11) — consigne multiligne et
 * lecture du sujet en contexte ; transport IA SIMULÉ, aucune dépense. Hors `npm test`. Sur une copie
 * de la base de production : « Jeton doré » (sans image) et « La culotte du roi Dagobert » (image au brouillon).
 *
 * Lancer (serveur de test démarré avec DIG_AI_FAKE=1) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> SHOTS=/tmp/dossier \
 *   node test/e2e/icon-studio-subject.e2e.js
 */

'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);

const BASE = process.env.BASE;
const ADMIN = process.env.ADMIN;
const SHOTS = process.env.SHOTS || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}` };
const log = (...a) => console.log('✓', ...a);
const api = async p => (await fetch(`${BASE}${p}`, { headers: H })).json();

// Consigne du propriétaire (recette du 02/11), texte intégral sur plusieurs lignes
const STYLE = 'Jeton plat et rond vu de trois quarts, relief 3D stylisé, cohérent avec la boussole et la lanterne.\n'
  + 'Rebord net, face frappée d\'un petit pic de mineur, or chaud un peu usé.\nLisible en petit, fond transparent.';

async function openSheet(page, name) {
  await page.click('.tab-btn[data-tab="icons"]');
  await page.fill('#ic-search', name);
  await page.click(`[aria-label="Ouvrir la fiche ${name}"]`);
  await page.waitForFunction(n => document.querySelector('#ic-sheet h3')?.textContent === n && document.querySelector('#ic-sheet').offsetParent, name);
}

async function run(browser, width, height, tag) {
  const page = await browser.newPage({ viewport: { width, height } });
  try { await steps(page, tag); } catch (e) {
    await page.screenshot({ path: `${SHOTS}/${tag}-echec.png`, fullPage: true });
    console.error(await page.locator('#ic-sheet').textContent().catch(() => ''));
    throw e;
  }
  await page.close();
}

async function steps(page, tag) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');

  // 1. Jeton doré : la boussole et la lanterne citées comme référence de style sont acceptées
  await openSheet(page, 'Jeton doré');
  const ta = page.locator('#ic-instruction');
  assert.strictEqual(await ta.evaluate(e => e.tagName), 'TEXTAREA');
  const h0 = await ta.evaluate(e => e.offsetHeight);
  await ta.fill(STYLE);
  await page.waitForFunction(() => /Autorisé/.test(document.getElementById('ic-live-conflict')?.textContent ?? ''));
  const live = await page.textContent('#ic-live-conflict');
  assert.match(live, /« boussole » lu comme référence de style/);
  assert.doesNotMatch(live, /refusée/);
  const h1 = await ta.evaluate(e => e.offsetHeight);
  assert.ok(h1 > h0, `le champ s'agrandit (${h0} → ${h1})`);
  assert.match(await page.textContent('.ic-charcount'), new RegExp(`^${STYLE.length} / 1000 caractères`));
  log(`${tag} : textarea ${h0}→${h1} px, compteur, « boussole » = référence de style autorisée`);
  await page.screenshot({ path: `${SHOTS}/${tag}-jeton-style.png`, fullPage: false });

  // 2. Vrai changement de sujet : signalé avant l'envoi, puis refusé sans dépense
  await ta.fill('Dessine une boussole.');
  await page.waitForFunction(() => /refusée sans dépense/.test(document.getElementById('ic-live-conflict')?.textContent ?? ''));
  assert.match(await page.textContent('#ic-live-conflict'), /demande de dessiner un autre objet/);
  const calls0 = (await api('/api/admin/icons')).calls.length;
  await ta.press('Control+Enter');   // action principale de l'étape (« Générer » ou « Refaire »), jamais « Conserver »
  await page.waitForFunction(() => /Conflit de sujet/.test(document.querySelector('#ic-sheet [role=status].error')?.textContent ?? ''));
  assert.strictEqual((await api('/api/admin/icons')).calls.length, calls0, 'aucun appel');
  log(`${tag} : « Dessine une boussole » signalé puis refusé, aucun appel`);
  await page.screenshot({ path: `${SHOTS}/${tag}-jeton-refus.png`, fullPage: false });

  // 3. Saisie conservée par objet pendant la navigation, jamais reportée sur un autre objet
  await ta.fill(STYLE);
  await page.click('#ic-sheet >> text=← Toutes les icônes');
  await openSheet(page, 'La culotte du roi Dagobert');
  const redo = page.locator('.ic-redo #ic-instruction');
  assert.strictEqual(await redo.inputValue(), '', 'rien de la fiche du jeton');
  // « Refaire » : couronne brodée = motif autorisé
  await redo.fill('Garder la culotte, ajouter une couronne brodée en fil d\'or sur la ceinture,\nvelours plus profond.');
  await page.waitForFunction(() => /Autorisé/.test(document.getElementById('ic-live-conflict')?.textContent ?? ''));
  assert.match(await page.textContent('#ic-live-conflict'), /« couronne » lu comme motif ou décor/);
  log(`${tag} : « Refaire » multiligne, « couronne brodée » = motif autorisé`);
  await page.screenshot({ path: `${SHOTS}/${tag}-culotte-refaire.png`, fullPage: false });
  await page.click('#ic-sheet >> text=← Toutes les icônes');
  await openSheet(page, 'Jeton doré');
  assert.strictEqual(await page.locator('#ic-instruction').inputValue(), STYLE, 'texte intégral conservé');
  const nStrip = await page.locator('.ic-strip-item').count();
  const draft0 = (await api('/api/admin/icons/targets/item:jeton_dore')).target.image ?? null;
  log(`${tag} : texte intégral du jeton retrouvé après navigation`);

  // 4. Génération acceptée avec la consigne complète (IA simulée)
  await page.locator('#ic-instruction').press('Control+Enter');
  await page.waitForFunction(c0 => document.querySelectorAll('.ic-strip-item').length > c0, nStrip, { timeout: 60000 });
  const calls = (await api('/api/admin/icons')).calls;
  assert.strictEqual(calls.find(c => !c.target.startsWith('check:')).target, 'item:jeton_dore');
  assert.strictEqual((await api('/api/admin/icons/targets/item:jeton_dore')).target.image ?? null, draft0, 'rien conservé automatiquement');
  log(`${tag} : génération du jeton acceptée avec la consigne complète, rien conservé`);
  // Pas de débordement horizontal
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'pas de défilement horizontal');
  assert.deepStrictEqual(errors, []);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  try {
    await run(browser, 1280, 900, 'pc');
    await run(browser, 390, 844, 'mobile');
  } finally { await browser.close(); }
  log('terminé');
})().catch(e => { console.error(e); process.exit(1); });
