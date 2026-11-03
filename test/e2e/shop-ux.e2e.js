/**
 * Essai navigateur de la boutique de cadeaux (#34, recettes E à K du 03/11) :
 * - joueur : prix « 1 pt », fenêtre Dig d'échange (article, coût, solde avant/après, Échap = refus,
 *   un seul envoi), fenêtre Dig d'annulation (remboursement), aucun window.confirm natif ;
 * - admin : fiche article en sections, une langue à la fois, champs réels masqués si Virtuel (valeurs
 *   gardées), options repliées, aperçu joueur, sélecteur d'emoji, confirmation avant de perdre des saisies.
 * Prépare lui-même ses données (compte, article, +1 pt) : à lancer UNIQUEMENT sur un serveur de test.
 * Hors `npm test` (navigateur requis).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<ADMIN_SECRET du serveur de test> OUT=/tmp/dossier node test/e2e/shop-ux.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, OUT = process.env.OUT || '/tmp', ADMIN = process.env.ADMIN;
assert.ok(/^http:\/\/127\.0\.0\.1:31\d\d$/.test(BASE), 'serveur de test local uniquement (port 31xx)');
const errors = [], dialogs = [];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const setup = await b.newContext();
  const adm = (method, url, data) => setup.request.fetch(`${BASE}${url}`, { method, data, headers: { Authorization: `Bearer ${ADMIN}` } });
  const user = `ux${Date.now().toString(36)}`, pass = 'secret-34-ux';
  const reg = await setup.request.post(`${BASE}/api/register`, { data: { username: user, email: `${user}@example.test`, password: pass } });
  assert.ok(reg.ok(), `inscription ${reg.status()}`);
  const uid = (await reg.json()).user.id;
  assert.ok((await adm('PUT', '/api/admin/shop/settings', { exchangesOpen: true, notice: '' })).ok());
  const texts = { fr: { title: `Titre honorifique E2E ${user}`, description: 'Article fictif', conditions: '' } };
  const created = await adm('POST', '/api/admin/shop/items', { item: { kind: 'virtual', cost: 1, stock_remaining: 2, max_per_user: 2, icon: '🏆', visible: true, unavailable: false, sort: 0, texts } });
  assert.ok(created.ok(), `article ${created.status()} ${await created.text()}`);
  assert.ok((await adm('POST', '/api/admin/points/adjust', { userId: uid, amount: 2, reason: 'TEST e2e #34', idemKey: `e2e-${user}` })).ok());

  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}: ${e.message}`));
    page.on('dialog', d => { dialogs.push(`${w}: ${d.type()} ${d.message()}`); d.dismiss(); });
    assert.ok((await ctx.request.post(`${BASE}/api/login`, { data: { username: user, password: pass } })).ok());
    await page.goto(BASE);
    const pick = page.locator('.lang-pick-btn[data-lang="fr"]');
    if (await pick.isVisible().catch(() => false)) await pick.click();
    await page.click('.nav-btn[data-view="season"]');
    await page.waitForSelector('#season-shop .shop-card');
    await page.evaluate(() => { document.querySelector('#season-shop .shop-card').open = true; });
    const item = page.locator('#season-shop .shop-item', { hasText: `Titre honorifique E2E ${user}` });
    await item.waitFor();
    assert.strictEqual((await item.locator('.shop-item-cost').innerText()).trim(), '1 pt', 'prix « 1 pt »');

    // Échange : fenêtre Dig, Échap = refus (rien n'est envoyé)
    await item.locator('.shop-buy-btn').click();
    const modal = page.locator('#shop-confirm-modal');
    await modal.waitFor({ state: 'visible' });
    const txt = (await modal.innerText()).replace(/\s+/g, ' ');
    console.log(w, 'échange', txt);
    assert.match(txt, w === 1280 ? /Confirmer l'échange.*Titre honorifique E2E.*Coût 1 pt.*Solde actuel 2 pts.*Solde après l'échange 1 pt/
      : /Confirmer l'échange.*Titre honorifique E2E.*Coût 1 pt.*Solde actuel 1 pt.*Solde après l'échange 0 pt/);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'btn-shop-confirm-back', 'focus sur Annuler');
    const box = await page.locator('#shop-confirm-inner').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= w, 'fenêtre dans l\'écran');
    await page.screenshot({ path: `${OUT}/shop-ux-${w}-echange.png` });
    await page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });

    if (w === 1280) {
      // Confirmation : double clic → un seul échange
      await item.locator('.shop-buy-btn').click();
      await modal.waitFor({ state: 'visible' });
      await page.locator('#btn-shop-confirm-ok').dblclick();
      await page.waitForSelector('#season-shop .points-live-banner');
      const me = await (await ctx.request.get(`${BASE}/api/shop/me`)).json();
      console.log(w, 'après échange', me.balance, me.orders.length);
      assert.strictEqual(me.balance, 1);
      assert.strictEqual(me.orders.filter(o => o.status === 'pending').length, 1, 'une seule commande');
    }

    // Annulation : fenêtre Dig avec remboursement (refusée sur mobile, acceptée sur PC… dans l'ordre inverse)
    await page.evaluate(() => { const d = document.querySelector('#season-shop .shop-orders'); if (d) d.open = true; });
    const cancel = page.locator('#season-shop [data-shop-cancel]');
    await cancel.first().click();
    await modal.waitFor({ state: 'visible' });
    const ctxt = (await modal.innerText()).replace(/\s+/g, ' ');
    console.log(w, 'annulation', ctxt);
    assert.match(ctxt, /Annuler la commande #\d+ \?.*Remboursement \+1 pt.*Solde après remboursement 2 pts.*Garder la commande/);
    await page.screenshot({ path: `${OUT}/shop-ux-${w}-annulation.png` });
    if (w === 1280) {
      await page.locator('#btn-shop-confirm-back').click();   // garder
      await modal.waitFor({ state: 'hidden' });
      assert.strictEqual((await (await ctx.request.get(`${BASE}/api/shop/me`)).json()).balance, 1, 'garder = rien ne change');
    } else {
      await page.locator('#btn-shop-confirm-ok').click();
      await page.waitForFunction(() => !document.querySelector('#season-shop [data-shop-cancel]'));
      const me = await (await ctx.request.get(`${BASE}/api/shop/me`)).json();
      console.log(w, 'après annulation', me.balance, me.orders.map(o => o.status));
      assert.strictEqual(me.balance, 2, 'remboursé');
    }
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(ov <= 0, `pas de défilement horizontal (${ov})`);
    await ctx.close();
  }

  // Admin : fiche article
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`admin ${w}: ${e.message}`));
    page.on('dialog', d => { dialogs.push(`admin ${w}: ${d.type()} ${d.message()}`); d.dismiss(); });
    await page.goto(`${BASE}/admin/`);
    await page.fill('#secret-input', ADMIN);
    await page.click('#secret-btn');
    await page.click('.tab-btn[data-tab="shop"]');
    await page.click('#btn-sh-new');
    const dlg = page.locator('#sh-dialog');
    await dlg.waitFor({ state: 'visible' });
    const vis = id => page.locator(`#${id}`).isVisible();
    assert.ok(!(await vis('sh-face')), 'Virtuel : valeur faciale masquée');
    assert.ok(!(await vis('sh-from')), 'calendrier replié');
    assert.ok(await vis('sh-fr-title') && !(await vis('sh-en-title')), 'une langue à la fois');
    await page.fill('#sh-fr-title', 'Brouillon E2E');
    await page.fill('#sh-cost', '2');
    // Emoji : recherche « couronne » → 👑
    await page.click('#btn-sh-emoji');
    await page.fill('#sh-emoji-search', 'couronne');
    await page.locator('#sh-emoji-grid button', { hasText: '👑' }).click();
    assert.strictEqual(await page.inputValue('#sh-icon'), '👑');
    const prev = (await page.locator('#sh-preview').innerText()).replace(/\s+/g, ' ');
    console.log('admin', w, 'aperçu', prev);
    assert.match(prev, /👑.*Brouillon E2E.*2 pts.*Échanger/);
    // Réel : champs affichés ; retour Virtuel : masqués mais conservés
    await page.selectOption('#sh-kind', 'real');
    assert.ok(await vis('sh-face'));
    await page.fill('#sh-face', '500');
    await page.selectOption('#sh-kind', 'virtual');
    assert.ok(!(await vis('sh-face')) && await page.inputValue('#sh-face') === '500', 'valeur gardée');
    assert.ok(await vis('sh-real-kept'));
    await page.selectOption('#sh-kind', 'real');
    await page.selectOption('#sh-kind', 'virtual');
    // EN : onglet, rappel du français
    await page.click('#sh-langs [data-lang="en"]');
    assert.ok(await vis('sh-en-title') && !(await vis('sh-fr-title')) && await vis('sh-fr-ref'));
    await page.screenshot({ path: `${OUT}/shop-ux-admin-${w}.png`, fullPage: true });
    const ov = await page.evaluate(() => { const d = document.getElementById('sh-dialog'); return d.scrollWidth - d.clientWidth; });
    assert.ok(ov <= 0, `fiche sans défilement horizontal (${ov})`);
    // Échap : confirmation Dig, « Continuer à modifier » garde la fiche
    await page.keyboard.press('Escape');
    await page.locator('#adm-confirm').waitFor({ state: 'visible' });
    await page.screenshot({ path: `${OUT}/shop-ux-admin-${w}-perte.png` });
    await page.click('#adm-confirm-no');
    assert.ok(await dlg.isVisible() && await page.inputValue('#sh-fr-title') === 'Brouillon E2E', 'saisie gardée');
    // ✕ Fermer puis « Abandonner » : fermée, rien d'enregistré
    await page.click('#sh-dialog .bk-dialog-head [data-close]');
    await page.click('#adm-confirm-yes');
    await dlg.waitFor({ state: 'hidden' });
    const items = (await (await adm('GET', '/api/admin/shop')).json()).items;
    assert.ok(!items.some(i => i.texts.fr.title === 'Brouillon E2E'), 'rien enregistré');
    // Fiche existante non modifiée : fermeture directe sans question
    await page.locator('#sh-items-body tr', { hasText: `Titre honorifique E2E ${user}` }).click();
    await dlg.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'hidden' });
    assert.ok(!(await page.locator('#adm-confirm').isVisible().catch(() => false)));
    await ctx.close();
  }
  await b.close();
  console.log('erreurs JS :', errors.length, errors);
  console.log('popups natives :', dialogs.length, dialogs);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(dialogs, []);
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
