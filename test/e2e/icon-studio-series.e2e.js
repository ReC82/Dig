/**
 * Essai navigateur de l'atelier d'icônes (#40, décision du propriétaire du 02/11) — génération d'une
 * collection entière, une image par objet, enchaînées ; transport IA SIMULÉ, aucune dépense. Hors
 * `npm test` (navigateur requis). Sur une copie de la base de production : la collection « Trésors de
 * la vieille mine » a 2 objets avec image (lanterne, boussole) et 4 sans image.
 *
 * Lancer (serveur de test déjà démarré avec DIG_AI_FAKE=1 et DIG_AI_FAKE_DELAY_MS=1500) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> SHOTS=/tmp/dossier \
 *   node test/e2e/icon-studio-series.e2e.js
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

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  const plan0 = (await api('/api/admin/icons/series/tresors_vieille_mine')).plan;
  const images0 = Object.fromEntries(plan0.items.map(i => [i.id, i.image]));
  assert.deepStrictEqual(plan0.items.filter(i => i.state === 'todo').map(i => i.id), ['crayon_de_mineur', 'jeton_dore', 'tasse_ebrechee', 'cle_des_galeries'], JSON.stringify(plan0));
  const calls0 = (await api('/api/admin/icons')).calls.length;

  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await page.click('.tab-btn[data-tab="icons"]');
  await page.waitForSelector('#ic-series .ic-series-row');
  const row = page.locator('.ic-series-row', { hasText: 'Trésors de la vieille mine' });
  assert.match(await row.textContent(), /6 objets · 4 à générer · 2 avec image/);
  log('collection affichée : 6 objets, 4 à générer, 2 avec image');
  await page.screenshot({ path: `${SHOTS}/series-1280-avant.png`, fullPage: false });

  await row.locator('button', { hasText: 'Générer les 4 images manquantes' }).click();
  await page.waitForSelector('.ic-batch');
  assert.strictEqual(dialogs.length, 1);
  assert.match(dialogs[0], /UNE image pour chacun des 4 objets/);
  assert.match(dialogs[0], /Crayon de mineur, Jeton doré, Tasse ébréchée, Clé des galeries/);
  assert.match(dialogs[0], /Lanterne de poche \(Image déjà dans le brouillon\)/);
  assert.match(dialogs[0], /Budget restant/);
  log('confirmation : objets, ignorés, coût constaté et estimé, budget, durée');
  await page.waitForFunction(() => /Collection « Trésors de la vieille mine » : image \d\/4/.test(document.getElementById('ic-notice').textContent));
  assert.strictEqual(await page.isDisabled('.ic-series-row button.ic-main'), true, 'une seule génération à la fois');
  log('suivi : « image k/4 » dans le bandeau, bouton désactivé pendant la génération');

  // Une fiche ouverte pendant la génération de son objet affiche l'attente
  await page.fill('#ic-search', 'Jeton doré');
  await page.click('[aria-label="Ouvrir la fiche Jeton doré"]');
  await page.waitForSelector('#ic-sheet h3');
  await page.click('#ic-sheet >> text=← Toutes les icônes');
  await page.fill('#ic-search', '');

  await page.waitForFunction(() => /terminée/.test(document.querySelector('.ic-batch-title')?.textContent ?? ''), null, { timeout: 120000 });
  const states = await page.$$eval('.ic-batch-item', els => els.map(e => [e.querySelector('.ic-card-name').textContent, e.querySelector('.ic-batch-state').textContent]));
  assert.deepStrictEqual(states, [
    ['Lanterne de poche', 'Image déjà dans le brouillon'], ['Boussole tordue', 'Image déjà dans le brouillon'],
    ['Crayon de mineur', '✓ À examiner'], ['Jeton doré', '✓ À examiner'], ['Tasse ébréchée', '✓ À examiner'], ['Clé des galeries', '✓ À examiner']]);
  assert.match(await page.textContent('.ic-batch'), /4 images générées/);
  assert.match(await row.textContent(), /aucun à générer · 2 avec image · 4 à examiner/);
  log('collection terminée : 4 images, une par objet ; objets avec image intacts ; plus rien à générer');
  await page.screenshot({ path: `${SHOTS}/series-1280-fin.png`, fullPage: false });

  const calls1 = (await api('/api/admin/icons')).calls;
  assert.strictEqual(calls1.length - calls0, 8, '4 images + 4 contrôles du sujet');
  assert.deepStrictEqual(calls1.slice(0, 8).filter(c => !c.target.startsWith('check:')).map(c => c.target).reverse(),
    ['item:crayon_de_mineur', 'item:jeton_dore', 'item:tasse_ebrechee', 'item:cle_des_galeries']);

  await page.click('[aria-label^="Ouvrir la fiche Tasse ébréchée"]');
  await page.waitForFunction(() => document.querySelector('#ic-sheet h3')?.textContent === 'Tasse ébréchée');
  assert.match(await page.textContent('#ic-sheet'), /Contrôle automatique : l'image montre « test image »/);
  assert.match(await page.textContent('#ic-sheet'), /prompt v1\.3/);
  log('fiche d\'un objet de la collection : proposition prompt v1.3 et contrôle du sujet affichés');
  await page.click('#ic-sheet >> text=← Toutes les icônes');

  const plan1 = (await api('/api/admin/icons/series/tresors_vieille_mine')).plan;
  assert.deepStrictEqual(Object.fromEntries(plan1.items.map(i => [i.id, i.image])), images0, 'rien appliqué au brouillon');
  log('brouillon des collections inchangé (rien conservé ni publié automatiquement)');

  // Smartphone
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `aucun débordement horizontal (${overflow}px)`);
  await page.locator('#ic-series').screenshot({ path: `${SHOTS}/series-390-fin.png` });
  log('affichage 390×844 sans débordement');

  assert.deepStrictEqual(errors, [], 'aucune erreur JavaScript');
  log('aucune erreur JavaScript');
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
