/**
 * Essai navigateur de la demande UX du propriétaire du 10/11 (#56) : les cases « à découvrir » de
 * Collection (souvenirs d'événement et séries) sont nettement visibles — opacité pleine, « ? » dans
 * un cercle, contour pointillé, libellé traduit « À découvrir » — sans rareté, nom ni image avant la
 * trouvaille ; les cartes trouvées gardent leur aspect ; aucun débordement ; focus clavier visible ;
 * 0 erreur JS. `/api/events` est simulé (aucun compte ni donnée). Hors `npm test` (navigateur requis).
 *
 * Lancer (serveur de test démarré) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   OUT=/tmp/dossier node test/e2e/unknown-cards-56.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, OUT = process.env.OUT || '/tmp';
const errors = [];
const tx = s => ({ fr: s, en: s, nl: s, es: s });
const items = [{ id: 'trouve', found: true, foundAt: '2026-11-02T10:00:00Z', icon: '🏺', image: null, names: tx('Amphore'), descs: tx('Une amphore.'), rarity: 'rare' }];
for (let i = 1; i < 30; i++) items.push({ id: `secret_${i}`, found: false, rarity: i % 3 ? 'commun' : 'legendaire' });
const EVENTS = {
  active: [{ id: 'nov', icon: '🏛️', names: tx('Novembre déterre l\'Histoire'), taglines: tx(''), test: false,
    startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T22:59:59Z', items }],
  upcoming: [], souvenirs: [],
};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [w, h] of [[320, 568], [390, 844], [430, 932], [1280, 900]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}: ${e.message}`));
    await page.route('**/api/events', r => r.fulfill({ json: EVENTS }));
    await page.goto(BASE);
    const pick = page.locator('.lang-pick-btn[data-lang="fr"]');
    if (await pick.isVisible().catch(() => false)) await pick.click();
    await page.click('.nav-btn[data-view="collection"]');
    await page.waitForSelector('#events-panel .find-card[data-item="secret_1"]');
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const lum = rgb => { const c = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(v => v / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return +((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)).toFixed(2); };
      const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface2').trim();
      const toRgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')})`;
      const bg = toRgb(surface);
      const unknown = [...document.querySelectorAll('.find-card:not(.found)')];
      const ev = document.querySelector('#events-panel .find-card[data-item="secret_3"]');
      const cs = getComputedStyle(ev), icon = getComputedStyle(ev.querySelector('.find-icon')), name = getComputedStyle(ev.querySelector('.find-name'));
      const found = document.querySelector('#events-panel .find-card.found');
      const grids = [...document.querySelectorAll('.collection-series-grid')].map(g => g.scrollWidth - g.clientWidth);
      return {
        unknownCount: unknown.length, seriesUnknown: document.querySelectorAll('#collection-grid .find-card:not(.found)').length,
        opacity: Math.min(...unknown.map(c => +getComputedStyle(c).opacity)), filters: unknown.filter(c => getComputedStyle(c).filter !== 'none').length,
        label: ev.querySelector('.find-name').textContent, glyph: ev.querySelector('.find-icon').textContent, aria: ev.getAttribute('aria-label'),
        rarityLeak: unknown.filter(c => !c.classList.contains('find-rarity-unknown')).length, html: ev.outerHTML,
        border: cs.borderTopStyle, cName: ratio(name.color, bg), cGlyph: ratio(icon.color, bg), cBorder: ratio(cs.borderTopColor, bg), cRing: ratio(icon.borderTopColor, bg),
        foundOpacity: +getComputedStyle(found).opacity, foundBorder: getComputedStyle(found).borderTopStyle, foundName: found.querySelector('.find-name').textContent,
        nameOverflow: unknown.filter(c => c.querySelector('.find-name').scrollWidth > c.clientWidth + 1).length,
        gridOverflow: Math.max(...grids), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const { html, ...log } = m;
    console.log(w, JSON.stringify(log));
    assert.ok(m.unknownCount >= 29 && m.seriesUnknown > 0, 'événements et séries ont des cases inconnues');
    assert.strictEqual(m.opacity, 1, 'opacité pleine');
    assert.strictEqual(m.filters, 0, 'aucun filtre gris');
    assert.strictEqual(m.label, 'À découvrir');
    assert.strictEqual(m.glyph, '?');
    assert.strictEqual(m.aria, 'Objet non découvert');
    assert.strictEqual(m.rarityLeak, 0, 'aucune rareté avant la trouvaille');
    assert.ok(!/legendaire|commun|rare/.test(html), html);
    assert.strictEqual(m.border, 'dashed');
    assert.ok(m.cName >= 4.5 && m.cGlyph >= 4.5 && m.cBorder >= 3 && m.cRing >= 3, JSON.stringify(log));
    assert.strictEqual(m.foundOpacity, 1);
    assert.notStrictEqual(m.foundBorder, 'dashed', 'objet trouvé inchangé');
    assert.strictEqual(m.foundName, 'Amphore');
    assert.strictEqual(m.nameOverflow, 0, 'libellé sans débordement');
    assert.ok(m.gridOverflow <= 0 && m.overflow <= 0, 'pas de défilement horizontal');
    // Focus clavier visible, fiche générique sans divulgation
    const card = page.locator('#events-panel .find-card[data-item="secret_3"]');
    await page.locator('#events-panel .find-card[data-item="secret_2"]').focus();
    await page.keyboard.press('Tab');
    const outline = await card.evaluate(e => (e === document.activeElement ? getComputedStyle(e).outlineStyle : 'pas de focus'));
    assert.strictEqual(outline, 'solid', 'focus clavier visible');
    await card.evaluate(e => e.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${OUT}/inconnues-${w}.png` });
    await page.keyboard.press('Enter');
    await page.waitForSelector('#find-modal:not([hidden])');
    const sheet = await page.evaluate(() => ({ title: document.getElementById('find-modal-title').textContent,
      rarity: document.getElementById('find-modal-rarity').textContent }));
    console.log(w, outline, JSON.stringify(sheet));
    assert.strictEqual(sheet.title, 'Objet non découvert');
    assert.strictEqual(sheet.rarity.trim(), '', 'rareté non divulguée');
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JS');
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
