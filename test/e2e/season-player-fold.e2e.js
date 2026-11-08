/**
 * Essai navigateur des recettes #48-D (03/11) et #84-D (08/11) : onglet Saison du joueur — thème,
 * fin, carte joueur puis classement tout de suite ; points de récompense repliés sur une ligne (boutique
 * de cadeaux rangée dedans), annonce de la saison suivante, résultat archivé, explications et
 * historique en dessous ; le résumé des points se déplie au clavier ; aucun défilement
 * horizontal ; 0 erreur JS. Captures dans OUT pour vérifier la mise en page réelle (espaces).
 * Hors `npm test` (navigateur requis).
 *
 * Lancer (serveur de test démarré, compte de test existant) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   USER=<pseudo> PASS=<mot de passe> OUT=/tmp/dossier node test/e2e/season-player-fold.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, OUT = process.env.OUT || '/tmp';
const errors = [];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}: ${e.message}`));
    const r = await ctx.request.post(`${BASE}/api/login`, { data: { username: process.env.USER, password: process.env.PASS } });
    assert.ok(r.ok(), `connexion ${r.status()}`);
    await page.goto(BASE);
    const pick = page.locator('.lang-pick-btn[data-lang="fr"]');
    if (await pick.isVisible().catch(() => false)) await pick.click();
    await page.click('.nav-btn[data-view="season"]');
    await page.waitForSelector('#view-season .season-player-card');
    await page.waitForSelector('#season-shop .shop-card', { state: 'attached' });   // rangée dans les points repliés (#84-D)
    await page.waitForSelector('#season-last .last-card');
    await page.waitForSelector('#season-lb-body .lb-row, #season-lb-body .season-empty');
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const top = s => Math.round(document.querySelector(s)?.getBoundingClientRect().top ?? -1);
      return {
        order: ['.season-theme-card', '.season-player-card', '#season-lb-body', '#season-points', '.season-next-card', '#season-last', '.season-info-card', '.season-history'].map(top),
        open: ['#season-last > details', '#season-points > details', '#season-shop > details', '.season-info-card', '.season-history'].map(s => document.querySelector(s)?.open ?? null),
        lbVisible: (document.querySelector('#season-lb-body .lb-row:not(.lb-head)')?.getBoundingClientRect().bottom ?? 1e9) <= innerHeight,
        pointsOneLine: Math.round(document.querySelector('#season-points > details > summary')?.getBoundingClientRect().height ?? 0) <= 40,
        shopInPoints: !!document.querySelector('#season-points > details #season-shop'),
        lastSummary: document.querySelector('#season-last summary')?.innerText,
        shopSummary: document.querySelector('#season-shop summary')?.innerText,
        depth: document.querySelector('.season-player-stats')?.innerText,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    console.log(w, JSON.stringify(m));
    const order = m.order.filter(x => x >= 0);
    assert.deepStrictEqual(order, [...order].sort((a, c) => a - c), 'synthèse puis sections repliées');
    assert.deepStrictEqual(m.open.slice(0, 3), [false, false, false], 'résultat, points et boutique repliés par défaut');
    assert.ok(m.pointsOneLine && m.shopInPoints, 'points sur une ligne, boutique rangée dedans (#84-D)');
    if (h >= 800) assert.ok(m.lbVisible, 'premier rang du classement visible à l\'ouverture');
    assert.ok(/\d m\b/.test(m.depth), 'profondeur « 22 m »');
    assert.ok(m.overflow <= 0, 'pas de défilement horizontal');
    await page.screenshot({ path: `${OUT}/saison-${w}-haut.png`, fullPage: true });
    await page.evaluate(() => document.querySelector('#season-lb-body').scrollIntoView());
    await page.screenshot({ path: `${OUT}/saison-${w}-replie.png` });
    // Résumé des points : se déplie au clavier (Entrée), avec crédit, barème, historique et boutique
    await page.focus('#season-points > details > summary');
    await page.keyboard.press('Enter');
    assert.ok(await page.evaluate(() => { const f = document.querySelector('#season-points > details');
      return f.open && !!f.querySelector('.points-scale') && !!f.querySelector('.points-history') && !!f.querySelector('.shop-card'); }), 'points dépliés au clavier');
    // Déplier le résultat : reste déplié après l'actualisation automatique (30 s)
    await page.click('#season-last summary');
    await page.evaluate(() => { _seasonRefreshAt = 0; return _refreshSeasonView(); });
    await page.waitForTimeout(800);
    assert.ok(await page.evaluate(() => document.querySelector('#season-last > details').open), 'résultat reste déplié');
    await page.evaluate(() => document.querySelector('#season-last').scrollIntoView());
    await page.screenshot({ path: `${OUT}/saison-${w}-deplie.png`, fullPage: true });
    await ctx.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JS');
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
