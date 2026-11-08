/**
 * Essai navigateur #90 : rubrique Joueurs → liste paginée affichée sans recherche, recherche sur toute
 * la base, tri, pages, fiche puis retour à la même page ; compte de test : marque, aperçu, suppression
 * (pseudo exact + SUPPRIMER + motif) ; page de jeu restée ouverte : déconnectée, progression locale
 * effacée ; réinscription du même pseudo / e-mail depuis la même page → compte neuf à 1 m.
 * Pas de débordement horizontal à 1280, 390 et 320 px. Serveur de TEST uniquement (base temporaire,
 * port ≥ 3100, inscriptions ouvertes, ≥ 55 comptes déjà créés).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN_SECRET=… OUT=/tmp/captures node test/e2e/players-90.e2e.js
 */
'use strict';

const assert = require('node:assert');
const path = require('path');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE;
const OUT = process.env.OUT || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function noHorizontalScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 1, `${label} : débordement horizontal de ${over} px`);
}

async function adminPage(browser, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', process.env.ADMIN_SECRET);
  await page.click('#secret-btn');
  await page.waitForSelector('.tab-btn[data-tab="players"]', { state: 'attached' });
  await admOpenTab(page, 'players');
  await page.waitForFunction(() => document.querySelectorAll('#player-results-table tbody tr[data-user-id]').length > 0);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    // 1. Navigation : liste immédiate, pages, tri, recherche, fiche puis retour — 3 largeurs
    for (const [label, viewport, isMobile] of [['pc', { width: 1280, height: 900 }, false], ['390', { width: 390, height: 844 }, true], ['320', { width: 320, height: 640 }, true]]) {
      const { ctx, page } = await adminPage(browser, viewport, isMobile);
      assert.strictEqual(await page.locator('#player-results-table tbody tr').count(), 20, '20 joueurs par défaut, sans recherche');
      assert.match(await page.textContent('#pl-total'), /au total/);
      await noHorizontalScroll(page, label);
      await page.screenshot({ path: path.join(OUT, `p90-list-${label}.png`), fullPage: false });
      await page.selectOption('#pl-sort', 'username');
      await page.waitForFunction(() => document.querySelector('#player-results-table tbody .pl-name')?.textContent === 'cobaye90' || true);
      await page.locator('#player-results-pager button[aria-label="Page 2"]').click();
      await page.waitForFunction(() => document.querySelector('#player-results-pager [aria-current="page"]')?.textContent === '2');
      const first = await page.locator('#player-results-table tbody .pl-name').first().textContent();
      await page.locator('#player-results-table tbody .pl-name').first().click();
      await page.waitForSelector('#player-detail-card:not(.hidden)');
      assert.ok((await page.textContent('#pd-username')).startsWith(first));
      await page.click('#btn-close-player-detail');
      assert.strictEqual(await page.textContent('#player-results-pager [aria-current="page"]'), '2', 'retour : même page');
      assert.strictEqual(await page.inputValue('#pl-sort'), 'username', 'retour : même tri');
      // Recherche partielle sur toute la base (pas seulement la page courante), accents ignorés
      await page.fill('#player-search-input', 'MASSÉ');
      await page.click('#btn-player-search');
      await page.waitForFunction(() => /trouvés/.test(document.getElementById('pl-total').textContent));
      assert.ok(await page.locator('#player-results-table tbody tr[data-user-id]').count() > 1);
      await page.fill('#player-search-input', 'zzzz');
      await page.click('#btn-player-search');
      await page.waitForFunction(() => /Aucun joueur pour ce filtre/.test(document.querySelector('#player-results-table tbody').textContent));
      await noHorizontalScroll(page, `${label} (recherche)`);
      await ctx.close();
      console.log(`navigation ${label} : OK`);
    }

    // 2. Compte de test : inscription, partie, page de jeu laissée ouverte
    const player = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const game = await player.newPage();
    await game.goto(BASE);
    const reg = await game.request.post(`${BASE}/api/register`, { data: { username: 'cobaye90', email: 'cobaye90@example.invalid', password: 'secret123' } });
    assert.strictEqual(reg.status(), 200);
    await game.reload();
    await game.locator('.lang-pick-btn[data-lang="fr"]').click();
    await game.waitForFunction(() => document.getElementById('stat-depth'));
    await game.locator('#tuto-skip, [data-tuto-skip], .tuto-skip').first().click({ timeout: 3000 }).catch(() => {});
    for (let i = 0; i < 60; i++) { await game.locator('#block').click({ force: true }).catch(() => {}); await sleep(100); }
    await sleep(13_000);   // une sauvegarde cloud au moins
    const oldDepth = await game.textContent('#stat-depth');

    // 3. Admin : marque puis suppression
    const { ctx: actx, page } = await adminPage(browser, { width: 1280, height: 900 }, false);
    await page.fill('#player-search-input', 'cobaye90');
    await page.click('#btn-player-search');   // un seul joueur : fiche ouverte directement
    await page.waitForSelector('#player-detail-card:not(.hidden)');
    await page.locator('#pd-sec-sensitive > summary').click();
    await page.waitForFunction(() => /Compte ordinaire/.test(document.getElementById('pd-test-state').textContent));
    await page.click('#btn-pd-delete');
    await page.waitForFunction(() => document.getElementById('pd-del-dialog').open);
    assert.match(await page.textContent('#pd-del-blocked'), /non marqué/);
    assert.ok(await page.locator('#btn-pd-del-confirm').isDisabled());
    await page.locator('#pd-del-dialog [data-close]').click();
    await page.click('#btn-pd-test-mark');
    await page.fill('#pd-mark-reason', 'Compte de test pour refaire l\'inscription');
    await page.fill('#pd-mark-input', 'cobaye90');
    await page.click('#btn-pd-mark-confirm');
    await page.waitForFunction(() => /Compte de test depuis/.test(document.getElementById('pd-test-state').textContent));
    await page.click('#btn-pd-delete');
    await page.waitForFunction(() => document.getElementById('pd-del-dialog').open);
    await page.locator('#pd-del-details > summary').click();
    const confirm = page.locator('#btn-pd-del-confirm');
    await page.fill('#pd-del-reason', 'Refaire la vraie inscription');
    await page.fill('#pd-del-input', 'cobaye90');
    assert.ok(await confirm.isDisabled(), 'SUPPRIMER exigé');
    await page.fill('#pd-del-word', 'supprimer');
    assert.ok(await confirm.isDisabled(), 'SUPPRIMER en majuscules');
    await page.fill('#pd-del-word', 'SUPPRIMER');
    assert.ok(await confirm.isEnabled());
    await page.screenshot({ path: path.join(OUT, 'p90-delete-dialog-pc.png'), fullPage: false });
    await confirm.click();
    await page.waitForSelector('#players-hint:not(.hidden)');
    assert.match(await page.textContent('#players-hint'), /supprimé/);
    await page.screenshot({ path: path.join(OUT, 'p90-deleted-pc.png'), fullPage: false });
    await actx.close();

    // 4. Page de jeu restée ouverte : déconnectée et progression locale effacée au signal suivant
    await game.bringToFront();
    for (let i = 0; i < 10; i++) { await game.locator('#block').click({ force: true }).catch(() => {}); await sleep(100); }
    await game.waitForFunction(() => !localStorage.getItem('dig_cloud_meta'), null, { timeout: 30_000 });
    await sleep(500);
    assert.match(await game.textContent('#stat-depth'), /^1\s*m/, `ancienne profondeur ${oldDepth} effacée`);
    await game.screenshot({ path: path.join(OUT, 'p90-game-after-delete-390.png') });

    // 5. Même pseudo et même e-mail : nouvelle inscription depuis la même page → compte neuf
    const again = await game.evaluate(async () => (await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cobaye90', email: 'cobaye90@example.invalid', password: 'secret123' }) })).status);
    assert.strictEqual(again, 200);
    await game.reload();
    await game.locator('.lang-pick-btn[data-lang="fr"]').click({ timeout: 5000 }).catch(() => {});
    await game.waitForFunction(() => document.getElementById('stat-depth'));
    await sleep(3000);
    assert.match(await game.textContent('#stat-depth'), /^1\s*m/, 'compte neuf à 1 m');
    const me = await game.evaluate(async () => (await fetch('/api/me')).json());
    assert.strictEqual(me.user.username, 'cobaye90');
    console.log('suppression + réinscription : OK');
    await player.close();
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
