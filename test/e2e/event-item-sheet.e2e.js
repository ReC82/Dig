/**
 * Essai navigateur de la recette #39 (03/11) : Collection → Souvenirs d'événements. Les titres et
 * les cartes ne se chevauchent pas ; un clic sur un objet ouvre la fiche dédiée (grande image ou
 * emoji, nom, rareté, histoire, date de découverte, événement), sans description sous la carte ;
 * Échap ferme et rend le focus à la carte ; aucun défilement horizontal ; 0 erreur JS.
 * `/api/events` est simulé (aucun compte ni donnée nécessaire). Hors `npm test` (navigateur requis).
 *
 * Lancer (serveur de test démarré) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   OUT=/tmp/dossier node test/e2e/event-item-sheet.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, OUT = process.env.OUT || '/tmp';
const errors = [];
const tx = s => ({ fr: s, en: s, nl: s, es: s });
const EVENTS = {
  active: [{ id: 'nov', icon: '🍂', names: tx('Fête des feuilles'), taglines: tx('Un mois de feuilles mortes.'), test: false,
    startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T22:59:59Z',
    items: [{ id: 'feuille', found: true, foundAt: '2026-11-02T10:00:00Z', icon: '🍁', image: null, names: tx('Feuille dorée'), descs: tx('Une feuille.'), rarity: 'rare' },
      { id: 'gland', found: false, rarity: 'commun' }] }],
  upcoming: [],
  souvenirs: [{ id: 'test_2611031200', icon: '🧪', names: tx('Événement test'), endsAt: '2026-11-03T12:00:00Z',
    items: [{ id: 'test_caillou', found: true, foundAt: '2026-11-03T10:15:00Z', icon: '🪨', image: null, names: tx('Caillou de test'),
      descs: tx('Il ne sert à rien, et c\'est justement ce qu\'on teste.'), rarity: 'commun' }] }],
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}: ${e.message}`));
    await page.route('**/api/events', r => r.fulfill({ json: EVENTS }));
    await page.goto(BASE);
    const pick = page.locator('.lang-pick-btn[data-lang="fr"]');
    if (await pick.isVisible().catch(() => false)) await pick.click();
    await page.click('.nav-btn[data-view="collection"]');
    await page.waitForSelector('#events-panel .find-card[data-item="test_caillou"]');
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const p = document.getElementById('events-panel');
      const boxes = [...p.querySelectorAll('.section-divider, h3, .badges-note, .collection-series-grid')]
        .map(e => ({ cls: e.className, r: e.getBoundingClientRect() }));
      const overlaps = [];
      for (let i = 1; i < boxes.length; i++) {
        if (boxes[i].r.top < boxes[i - 1].r.bottom - 0.5) overlaps.push(`${boxes[i - 1].cls} / ${boxes[i].cls}`);
      }
      return { overlaps, inline: p.querySelectorAll('.event-item-desc').length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    console.log(w, JSON.stringify(m));
    assert.deepStrictEqual(m.overlaps, [], 'aucun chevauchement titre/cartes');
    assert.strictEqual(m.inline, 0, 'aucune description sous la carte');
    assert.ok(m.overflow <= 0, 'pas de défilement horizontal');
    await page.evaluate(() => document.querySelector('#events-panel .collection-archives-title').scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${OUT}/souvenirs-${w}.png` });
    const card = page.locator('#events-panel .find-card[data-item="test_caillou"]');
    await card.click();
    await page.waitForSelector('#find-modal:not([hidden])');
    const sheet = await page.evaluate(() => {
      const q = id => document.getElementById(id);
      const r = q('find-modal-inner').getBoundingClientRect();
      return { art: q('find-modal-art').textContent, title: q('find-modal-title').textContent,
        rarity: q('find-modal-rarity').textContent, ctx: q('find-modal-series').textContent,
        found: q('find-modal-found').textContent, story: q('find-modal-story').textContent,
        focus: document.activeElement.id, fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight };
    });
    console.log(w, JSON.stringify(sheet));
    assert.strictEqual(sheet.art, '🪨');
    assert.strictEqual(sheet.title, 'Caillou de test');
    assert.strictEqual(sheet.rarity, 'Commun');
    assert.match(sheet.ctx, /Événement test/);
    assert.match(sheet.ctx, /Terminé le 3 novembre 2026/);
    assert.match(sheet.found, /Trouvé le 3 novembre 2026/);
    assert.match(sheet.story, /ne sert à rien/);
    assert.strictEqual(sheet.focus, 'btn-find-modal-close');
    assert.ok(sheet.fits, 'fiche entièrement visible');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/fiche-${w}.png` });
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#find-modal').isHidden(), 'Échap ferme');
    assert.ok(await card.evaluate(e => e === document.activeElement), 'focus rendu à la carte');
    // Objet non trouvé d'un événement en cours : fiche « mystère », sans rareté ni date
    await page.click('#events-panel .find-card[data-item="gland"]');
    const unk = await page.evaluate(() => ({ title: document.getElementById('find-modal-title').textContent,
      rarity: document.getElementById('find-modal-rarity').textContent, found: document.getElementById('find-modal-found').textContent,
      ctx: document.getElementById('find-modal-series').textContent }));
    assert.deepStrictEqual([unk.rarity, unk.found], ['', '']);
    assert.match(unk.ctx, /Jusqu’au 30 novembre 2026/);
    await page.click('#btn-find-modal-close');
    await ctx.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JS');
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
