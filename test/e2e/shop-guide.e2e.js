/**
 * Essai navigateur du guide des trois boutiques (#34, recette UX du 03/11) : le bandeau « Où dépenser
 * quoi ? » est en tête des coffres (Amélios), de la Boutique et des cadeaux (Saison) ; la boutique
 * courante est marquée, les deux autres sont des liens qui ouvrent le bon onglet (et déplient la carte
 * cadeaux) ; aucun défilement horizontal ; 0 erreur JS. Captures dans OUT.
 * Hors `npm test` (navigateur requis).
 *
 * Lancer (serveur de test démarré, compte de test existant) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   USER=<pseudo> PASS=<mot de passe> OUT=/tmp/dossier node test/e2e/shop-guide.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, OUT = process.env.OUT || '/tmp';
const errors = [];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [w, h] of [[1280, 900], [390, 844], [360, 740]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}: ${e.message}`));
    const r = await ctx.request.post(`${BASE}/api/login`, { data: { username: process.env.USER, password: process.env.PASS } });
    assert.ok(r.ok(), `connexion ${r.status()}`);
    await page.goto(BASE);
    const pick = page.locator('.lang-pick-btn[data-lang="fr"]');
    if (await pick.isVisible().catch(() => false)) await pick.click();
    const state = view => page.evaluate(v => {
      const g = document.querySelector(`#view-${v} .shop-guide`);
      return {
        current: g?.querySelector('[aria-current="page"]')?.innerText.replace(/\s+/g, ' '),
        links: [...(g?.querySelectorAll('[data-shop-guide]') || [])].map(x => x.dataset.shopGuide),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        active: document.querySelector('.nav-btn.active')?.dataset.view,
        // nombre max. de lignes d'un libellé (téléphone : une ligne par boutique, aucun libellé coupé)
        lines: Math.max(0, ...[...(g?.querySelectorAll('.shop-guide-name, .shop-guide-cur, .shop-guide-where') || [])]
          .map(x => { const r = document.createRange(); r.selectNodeContents(x);
            return new Set([...r.getClientRects()].map(c => Math.round(c.bottom))).size; })),
      };
    }, view);

    // 1. Amélios → coffres
    await page.click('.nav-btn[data-view="upgrades"]');
    await page.waitForSelector('#shop-guide-chests .shop-guide');
    let s = await state('upgrades');
    console.log(w, 'coffres', JSON.stringify(s));
    assert.match(s.current, /Coffres.*Pièces.*Tu es ici/);
    assert.deepStrictEqual(s.links, ['gems', 'gifts']);
    assert.ok(s.overflow <= 0, 'pas de défilement horizontal');
    if (w < 500) assert.strictEqual(s.lines, 1, 'téléphone : chaque libellé tient sur une ligne');
    await page.evaluate(() => document.getElementById('shop-chests-anchor').scrollIntoView());
    await page.screenshot({ path: `${OUT}/guide-${w}-coffres.png` });

    // 2. lien Gemmes → onglet Boutique
    await page.click('#view-upgrades [data-shop-guide="gems"]');
    s = await state('shop');
    console.log(w, 'gemmes', JSON.stringify(s));
    assert.strictEqual(s.active, 'shop');
    assert.match(s.current, /Gemmes.*Argent réel · bientôt.*Tu es ici/);
    assert.deepStrictEqual(s.links, ['chests', 'gifts']);
    if (w < 500) assert.strictEqual(s.lines, 1, 'téléphone : « Gemmes et cosmétiques » sur une ligne');
    await page.screenshot({ path: `${OUT}/guide-${w}-boutique.png` });

    // 3. lien Cadeaux → Saison, carte cadeaux dépliée
    await page.click('#view-shop [data-shop-guide="gifts"]');
    await page.waitForSelector('#season-shop .shop-card[open] .shop-guide');
    await page.waitForTimeout(700);
    s = await state('season');
    console.log(w, 'cadeaux', JSON.stringify(s));
    assert.strictEqual(s.active, 'season');
    assert.match(s.current, /Cadeaux.*Points de saison.*Tu es ici/);
    const top = await page.evaluate(() => Math.round(document.querySelector('#season-shop .shop-card').getBoundingClientRect().top));
    assert.ok(top >= 0 && top < h / 2, `carte cadeaux visible en haut (${top})`);
    await page.screenshot({ path: `${OUT}/guide-${w}-cadeaux.png` });

    // 4. retour aux coffres depuis les cadeaux
    await page.click('#view-season [data-shop-guide="chests"]');
    await page.waitForTimeout(700);
    s = await state('upgrades');
    assert.strictEqual(s.active, 'upgrades');
    const anchor = await page.evaluate(() => Math.round(document.getElementById('shop-chests-anchor').getBoundingClientRect().top));
    assert.ok(anchor >= 0 && anchor < h / 2, `coffres visibles (${anchor})`);
    await ctx.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JS');
  console.log('OK guide des trois boutiques');
})().catch(e => { console.error(e); process.exit(1); });
