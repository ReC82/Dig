/**
 * Essai navigateur de l'atelier d'icônes (#40, recette et décision du 03/11) — plafond de dépense
 * désactivé par défaut, résumé de consigne en quatre champs, texte exact replié et copiable, aucun lot.
 * Transport IA SIMULÉ, aucune dépense. Hors `npm test`. Sur une copie de la base de production :
 * « La plume de l'oie bavarde » (sans image, consigne préparée).
 *
 * Lancer (serveur de test démarré avec DIG_AI_FAKE=1) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> SHOTS=/tmp/dossier \
 *   node test/e2e/icon-studio-nocap.e2e.js
 */

'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE;
const ADMIN = process.env.ADMIN;
const SHOTS = process.env.SHOTS || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log('✓', ...a);
const api = async (p, method = 'GET', body) => (await fetch(`${BASE}${p}`, { method, headers: H, body: body && JSON.stringify(body) })).json();
const NAME = 'La plume de l\'oie bavarde';

async function openSheet(page, name) {
  await admOpenTab(page, 'icons');
  await page.fill('#ic-search', name);
  await page.click(`[aria-label="Ouvrir la fiche ${name}"]`);
  await page.waitForFunction(n => document.querySelector('#ic-sheet h3')?.textContent === n && document.querySelector('#ic-sheet').offsetParent, name);
}

async function run(browser, width, height, tag, generate) {
  const page = await browser.newPage({ viewport: { width, height } });
  try { await steps(page, tag, generate); } catch (e) {
    await page.screenshot({ path: `${SHOTS}/${tag}-echec.png`, fullPage: true });
    throw e;
  }
  await page.close();
}

async function steps(page, tag, generate) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');

  // 1. Aucun plafond par défaut : bouton Générer actif, aucun « Plafond atteint », aucun bouton de lot
  await openSheet(page, NAME);
  const gen = page.locator('#ic-sheet button', { hasText: '✨ Générer une image' });
  assert.strictEqual(await gen.isDisabled(), false, 'Générer utilisable');
  assert.doesNotMatch(await page.textContent('#ic-sheet'), /Plafond atteint|plafond de dépense atteint/i);
  // 2. Résumé en quatre champs, champs de saisie repliés, texte exact replié et copiable
  const dts = await page.locator('#ic-sheet .ic-summary dt').allTextContents();
  assert.deepStrictEqual(dts, ['Sujet', 'Forme et matière', 'Couleurs', 'Style et contraintes']);
  const dds = await page.locator('#ic-sheet .ic-summary dd').allTextContents();
  assert.ok(dds.every(v => v.trim() && v.trim() !== '—'), `quatre champs remplis : ${JSON.stringify(dds)}`);
  assert.match(dds[0], /^La plume de l'oie bavarde — /);
  assert.doesNotMatch(dds[2], /^Palette/i);
  assert.strictEqual(await page.locator('#ic-sheet .ic-brief-edit').isVisible(), false, 'champs repliés par défaut');
  const exact = page.locator('#ic-sheet details.ic-exact');
  assert.strictEqual(await exact.evaluate(d => d.open), false, 'texte exact replié');
  await exact.locator('summary').click();
  assert.match(await exact.locator('pre').textContent(), /Object to depict/);
  assert.strictEqual(await exact.locator('button', { hasText: 'Copier' }).count(), 1);
  await page.screenshot({ path: `${SHOTS}/${tag}-plume-resume.png`, fullPage: false });
  await page.locator('#ic-sheet button', { hasText: '✎ Modifier la consigne' }).click();
  assert.strictEqual(await page.locator('#ic-sheet .ic-brief-edit').isVisible(), true, 'champs ouverts sur demande');
  log(`${tag} : résumé en quatre champs, texte exact replié et copiable, champs sur demande`);
  // Miniatures : jamais le carré ⬜ de remplacement
  assert.strictEqual(await page.locator('.ic-thumb', { hasText: '⬜' }).count(), 0);

  // 3. Une image par clic (IA simulée), rien conservé automatiquement — une seule fois (ordinateur)
  if (generate) {
  const n0 = (await api('/api/admin/icons')).calls.length;
  await gen.click();
  await page.waitForFunction(() => document.querySelectorAll('.ic-strip-item').length > 0, null, { timeout: 60000 });
  const calls = (await api('/api/admin/icons')).calls;
  assert.strictEqual(calls.filter(c => !c.target.startsWith('check:')).length - 0 >= 1, true);
  assert.strictEqual(calls.length - n0 <= 2, true, 'une image (+ contrôle du sujet) pour un clic');
  assert.strictEqual((await api('/api/admin/icons/targets/item:plume_oie_bavarde')).target.image ?? null, null, 'rien conservé');
  log(`${tag} : une image générée pour un clic, sans plafond, rien conservé`);
  }
  // Aucun bouton de lot dans la liste
  await page.click('#ic-sheet >> text=← Toutes les icônes');
  await page.selectOption('#ic-kind', 'item').catch(() => {});
  assert.strictEqual(await page.locator('#ic-series button', { hasText: 'Générer les' }).count(), 0, 'aucun lot sans plafond');

  // 4. ⚙ Config → Budget IA : état, totaux, plafond activé puis désactivé sans redémarrage
  await admOpenTab(page, 'config');
  await page.waitForFunction(() => /Aucun plafond bloquant/.test(document.getElementById('aib-cap-state')?.textContent ?? ''));
  const totals = await page.locator('#aib-totals dt').allTextContents();
  assert.ok(totals.some(t => /^Ce mois-ci/.test(t)) && totals.includes('Cumul de tout Dig'), JSON.stringify(totals));
  await page.screenshot({ path: `${SHOTS}/${tag}-config-budget.png`, fullPage: false });
  await page.check('#aib-cap-on');
  await page.fill('#ic-budget', '0.01');
  await page.click('#btn-ic-budget');
  await page.waitForFunction(() => /Plafond bloquant actif/.test(document.getElementById('aib-cap-state')?.textContent ?? ''));
  await openSheet(page, NAME);
  // État rechargé à l'ouverture de l'onglet : attendre la fiche re-rendue avec le nouveau statut
  await page.waitForFunction(() => /Plafond de dépense atteint \(réglé dans ⚙ Config → Budget IA\)/.test(document.getElementById('ic-sheet')?.textContent ?? ''));
  assert.strictEqual(await page.locator('#ic-sheet button:visible', { hasText: /✨ Générer une image|↻ Refaire/ }).first().isDisabled(), true, 'plafond réactivé : bloqué');
  await admOpenTab(page, 'config');
  await page.uncheck('#aib-cap-on');
  await page.click('#btn-ic-budget');
  await page.waitForFunction(() => /Aucun plafond bloquant/.test(document.getElementById('aib-cap-state')?.textContent ?? ''));
  assert.strictEqual((await api('/api/admin/icons/job')).status.capEnabled, false);
  log(`${tag} : ⚙ Config → Budget IA : totaux affichés, plafond activé (bloque) puis désactivé`);

  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'pas de défilement horizontal');
  assert.deepStrictEqual(errors, []);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  try {
    await run(browser, 390, 844, 'mobile', false);   // avant la génération : la fiche montre encore la consigne
    await run(browser, 1280, 900, 'pc', true);
  } finally { await browser.close(); }
  log('terminé');
})().catch(e => { console.error(e); process.exit(1); });
