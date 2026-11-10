/**
 * Essai navigateur de la recette #64-B (10/11) — « Actuelle en jeu » de l'atelier = icône réellement servie
 * aux joueurs (catalogue de reliques PUBLIÉ), aperçu à la taille de la carte du jeu, « aucune génération
 * nécessaire » sans image publiée, « Conserver » qui n'écrit que le brouillon, retour à la fiche de la relique.
 * Aucun appel IA. Hors `npm test`. Sur une copie de la base de production (proposition IA existante pour
 * « Œil du mineur », aucune image de relique publiée).
 *
 * Lancer (serveur de test démarré sur la copie) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> SHOTS=/tmp/dossier \
 *   node test/e2e/relic-studio-64b.e2e.js
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
const api = async (p, method = 'GET') => (await fetch(`${BASE}${p}`, { method, headers: H })).json();
const NAME = 'Œil du mineur';

async function openFromRelic(page) {
  await admOpenTab(page, 'relics');
  await page.click(`#rl-body tr:has-text("${NAME}")`);
  await page.waitForSelector('#rl-dialog[open]');
  await page.click('#btn-rl-studio');
  await page.waitForFunction(n => document.querySelector('#ic-sheet h3')?.textContent === n && document.querySelector('#ic-sheet').offsetParent, NAME);
}

async function steps(page, tag) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await api('/api/admin/relics/draft', 'DELETE');
  const calls0 = (await api('/api/admin/icons')).calls.length;

  // 1. Aucune image publiée : l'atelier montre l'emoji du jeu, pas la proposition, et ne pousse pas à générer
  await openFromRelic(page);
  const sheet = page.locator('#ic-sheet');
  const caps = await sheet.locator('.ic-compare figcaption').allTextContents();
  assert.match(caps[0], /^Actuelle en jeu : pictogramme d'origine 👁 \(emoji, aucune image publiée\)/);
  assert.strictEqual(await sheet.locator('.ic-compare .ic-fig').first().locator('img').count(), 0, 'actuelle = emoji, pas une image');
  assert.match(await sheet.textContent(), /Icône actuelle conservée — aucune génération nécessaire/);
  const cards = sheet.locator('.ic-game-relic');
  assert.strictEqual(await cards.first().locator('.ic-game-relic-icon').textContent(), '👁');
  const sz = await cards.first().locator('.ic-game-relic-icon').evaluate(e => getComputedStyle(e).fontSize);
  assert.strictEqual(sz, '35.2px', 'emoji à 2,2rem comme .relic-icon du jeu');
  assert.strictEqual(await cards.nth(1).locator('img').getAttribute('width'), '40');
  log(`${tag} : actuelle = 👁 (emoji), aperçu carte du jeu ${sz}, proposition à côté, « aucune génération nécessaire »`);
  await page.screenshot({ path: `${SHOTS}/${tag}-1-sans-image.png`, fullPage: true });

  // 2. « Conserver » : brouillon seulement — le jeu (catalogue public) reste sur l'emoji, l'atelier aussi
  await sheet.locator('button:has-text("Conserver cette image")').click();
  await page.waitForFunction(() => /Conservée dans le brouillon/.test(document.querySelector('#ic-sheet .ic-kept')?.textContent ?? ''));
  assert.strictEqual(await sheet.locator('button:has-text("Ouvrir l\'onglet 🔮 Reliques")').count(), 1, 'onglet Reliques, pas Collections');
  const pub = await (await fetch(`${BASE}/api/relics/catalog`)).json();
  const eye = (pub.relics ?? pub.catalog?.relics ?? []).find(r => r.id === 'eye_of_miner');
  assert.ok(eye && !eye.image, 'catalogue du jeu inchangé');
  const caps2 = await sheet.locator('.ic-compare figcaption').allTextContents();
  assert.match(caps2[0], /^Actuelle en jeu : pictogramme d'origine 👁/);
  assert.ok(caps2.some(c => /dans le brouillon/.test(c)), caps2.join(' | '));
  assert.doesNotMatch(await sheet.textContent(), /aucune génération nécessaire/);
  log(`${tag} : « Conserver » → brouillon seulement, actuelle en jeu toujours 👁`);
  await page.screenshot({ path: `${SHOTS}/${tag}-2-brouillon.png`, fullPage: true });

  // 3. Retour à la fiche de la relique : image du brouillon reprise, aucun appel IA, rien de publié
  await sheet.locator('button:has-text("Retour à la fiche de la relique")').click();
  await page.waitForSelector('#rl-dialog[open]');
  assert.match(await page.inputValue('#rl-image'), /^\/media\/icons\/[a-f0-9]{16}\.webp$/);
  assert.match(await page.textContent('#rl-form-title'), new RegExp(NAME));
  assert.strictEqual((await api('/api/admin/icons')).calls.length, calls0, 'aucun appel IA');
  const view = await api('/api/admin/relics');
  assert.strictEqual(view.published.version, 1, 'aucune publication');
  log(`${tag} : retour à la fiche, image du brouillon reprise, version publiée 1, 0 appel IA`);
  await page.screenshot({ path: `${SHOTS}/${tag}-3-retour.png`, fullPage: false });
  await page.keyboard.press('Escape');
  await api('/api/admin/relics/draft', 'DELETE');
  assert.deepStrictEqual(errors, []);
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [w, h, tag] of [[1280, 900, 'pc'], [390, 844, 'mobile']]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      try { await steps(page, tag); } catch (e) {
        await page.screenshot({ path: `${SHOTS}/${tag}-echec.png`, fullPage: true });
        throw e;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
