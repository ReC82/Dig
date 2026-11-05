/**
 * Essai navigateur #75 : fiche joueur → « Recommencer un test à zéro » (aperçu, motif, pseudo exact),
 * historique des essais, puis page de jeu déjà ouverte : message « Progression réinitialisée » et
 * reprise à 1 m après « Jouer ici ». Serveur de TEST uniquement (base temporaire, port ≥ 3100).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN_SECRET=… OUT=/tmp/captures node test/e2e/test-runs.e2e.js
 */
'use strict';

const assert = require('node:assert');
const path = require('path');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE;
const OUT = process.env.OUT || '/tmp';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [label, viewport, isMobile] of [['pc', { width: 1280, height: 900 }, false], ['mobile', { width: 390, height: 844 }, true]]) {
      const name = `essai75${label}`;
      // Joueur : inscription + page de jeu ouverte (elle prend la main)
      const player = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
      const game = await player.newPage();
      await game.goto(BASE);
      const reg = await game.request.post(`${BASE}/api/register`, { data: { username: name, email: `${name}@example.invalid`, password: 'secret123' } });
      assert.strictEqual(reg.status(), 200);
      await game.reload();
      await game.locator('.lang-pick-btn[data-lang="fr"]').click();
      await game.waitForFunction(() => document.getElementById('stat-depth'));
      for (let i = 0; i < 40; i++) { await game.locator('#block').click({ force: true }).catch(() => {}); await sleep(120); }
      await sleep(13_000);   // une sauvegarde cloud au moins

      // Admin : fiche du joueur
      const adminCtx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
      const page = await adminCtx.newPage();
      await page.goto(`${BASE}/admin/`);
      await page.fill('#secret-input', process.env.ADMIN_SECRET);
      await page.click('#secret-btn');
      await page.waitForSelector('.tab-btn[data-tab="economy"]', { state: 'attached' });
      await admOpenTab(page, 'economy');
      await page.fill('#player-search-input', name);
      await page.click('#btn-player-search');
      await page.locator('#player-results-table button', { hasText: 'Voir' }).first().click();
      await page.waitForSelector('#tr-table tbody tr');
      assert.strictEqual(await page.locator('#tr-table tbody tr').count(), 1, 'essai n° 1 en cours');

      await page.click('#btn-tr-reset');
      await page.waitForFunction(() => document.getElementById('tr-dialog').open);
      const confirm = page.locator('#btn-tr-confirm');
      assert.ok(await confirm.isDisabled());
      await page.fill('#tr-reason', 'Essai navigateur');
      await page.fill('#tr-confirm-input', name.toUpperCase());
      assert.ok(await confirm.isDisabled(), 'pseudo exact exigé');
      await page.fill('#tr-confirm-input', name);
      assert.ok(await confirm.isEnabled());
      await page.screenshot({ path: path.join(OUT, `t75-dialog-${label}.png`), fullPage: false });
      await confirm.click();
      await page.waitForFunction(() => !document.getElementById('tr-dialog').open);
      await page.waitForSelector('#tr-done:not(.hidden)');
      await page.waitForFunction(() => document.querySelectorAll('#tr-table tbody tr').length === 2);
      await page.locator('#tr-card').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `t75-history-${label}.png`), fullPage: false });
      assert.match(await page.textContent('#pd-depth'), /^1 m/);

      // Page de jeu restée ouverte : message clair au plus tard au signal suivant (15 s)
      await game.bringToFront();
      await game.waitForSelector('#tab-inactive-modal:not([hidden])', { timeout: 25_000 });
      assert.match(await game.textContent('#tab-inactive-title'), /réinitialisée/);
      await game.screenshot({ path: path.join(OUT, `t75-game-${label}.png`) });
      await game.click('#btn-tab-play-here');
      await game.locator('.lang-pick-btn[data-lang="fr"]').click({ timeout: 5000 }).catch(() => {});
      await game.waitForFunction(() => document.getElementById('tab-inactive-modal')?.hidden !== false);
      await sleep(1500);
      assert.match(await game.textContent('#stat-depth'), /^1\s*m/);
      console.log(`${label} : OK`);
      await player.close(); await adminCtx.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
