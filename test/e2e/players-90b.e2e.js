/**
 * Essai navigateur #90-B : diagnostic d'éligibilité dans Joueurs → fiche → Actions sensibles.
 * - compte de bêta avec données protégées (points, commande annulée, classement figé) : le diagnostic
 *   « ne pourra pas être supprimé » s'affiche AVANT le marquage, l'avertissement apparaît dans la
 *   fenêtre de marquage, puis « Compte de test reconnu, mais suppression bloquée » ; bouton de
 *   suppression désactivé, « Pourquoi ? » explique chaque verrou et l'alternative ;
 * - identité jetable neuve : « il manque la marque » puis « suppression possible ».
 * Pas de débordement horizontal à 1280, 390 et 320 px. Serveur de TEST uniquement : DB_FILE doit
 * être la base (temporaire) du serveur visé ; ce script y crée ses deux comptes.
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN_SECRET=… DB_FILE=/tmp/…/e2e.sqlite OUT=/tmp/captures node test/e2e/players-90b.e2e.js
 */
'use strict';

const assert = require('node:assert');
const path = require('path');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE;
const OUT = process.env.OUT || '/tmp';
assert.ok(/^http:\/\/127\.0\.0\.1:31\d\d$/.test(BASE ?? ''), 'serveur de test uniquement (port 31xx)');
assert.ok(path.isAbsolute(process.env.DB_FILE ?? '') && !process.env.DB_FILE.includes('/Dig/server/data/'), 'base temporaire uniquement');

const db = require('../../server/db');
db.initDb();
const c = db.getDb();
const tag = Date.now().toString(36).slice(-5);
const testeur = db.createUser(`testeur_${tag}`, `testeur_${tag}@example.test`, 'x');
const jetable = db.createUser(`essai_${tag}`, `essai_${tag}@example.test`, 'x');
const season = Number(c.prepare(`INSERT INTO seasons (name, start_at, end_at, status) VALUES ('Saison e2e ${tag}', '2026-01-01', '2026-01-08', 'closed')`).run().lastInsertRowid);
const led = c.prepare('INSERT INTO reward_point_ledger (user_id, delta, balance_after, kind, use, season_id, idem_key, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
led.run(testeur.id, 1, 1, 'admin_credit', null, null, `e2e_${tag}_1`, 'TEST');
const spend = Number(led.run(testeur.id, -1, 0, 'spend', 'virtual', null, `e2e_${tag}_2`, 'Boutique').lastInsertRowid);
led.run(testeur.id, 1, 1, 'refund', 'virtual', null, `e2e_${tag}_3`, 'annulée');
led.run(testeur.id, 5, 6, 'season_award', null, season, `e2e_${tag}_4`, null);
c.prepare("INSERT INTO reward_point_awards (season_id, mode, user_id, rank, eligible_count, tier, points, scale_version) VALUES (?, 'live', ?, 2, 2, 'active', 5, 1)").run(season, testeur.id);
c.prepare('INSERT INTO reward_point_wallets (user_id, balance, earned_total, spent_total) VALUES (?, 6, 7, 1)').run(testeur.id);
c.prepare("INSERT INTO shop_orders (user_id, item_id, kind, cost, status, request_key, spend_ledger_id, item_snapshot) VALUES (?, 1, 'virtual', 1, 'cancelled', ?, ?, '{}')").run(testeur.id, `rk_${tag}`, spend);
c.prepare('INSERT INTO season_standings (season_id, position, rank, user_id, max_depth, effective_manual_blocks, manual_blocks, eligible) VALUES (?, 2, 2, ?, 10, 5, 5, 1)').run(season, testeur.id);

async function noHorizontalScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 1, `${label} : débordement horizontal de ${over} px`);
}

async function openSheet(page, username) {
  await page.fill('#player-search-input', username);
  await page.click('#btn-player-search');   // un seul joueur : fiche ouverte directement
  await page.waitForSelector('#player-detail-card:not(.hidden)');
  await page.waitForFunction(n => document.getElementById('pd-username').textContent.startsWith(n), username);
  if (!(await page.locator('#pd-sec-sensitive').evaluate(d => d.open))) await page.locator('#pd-sec-sensitive > summary').click();
  await page.waitForSelector('#pd-elig:not(.hidden)');
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [label, viewport, isMobile] of [['pc', { width: 1280, height: 900 }, false], ['390', { width: 390, height: 844 }, true], ['320', { width: 320, height: 640 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/admin/`);
      await page.fill('#secret-input', process.env.ADMIN_SECRET);
      await page.click('#secret-btn');
      await page.waitForSelector('.tab-btn[data-tab="players"]', { state: 'attached' });
      await admOpenTab(page, 'players');
      await page.waitForFunction(() => document.querySelectorAll('#player-results-table tbody tr[data-user-id]').length > 0);

      // Compte avec données protégées : diagnostic AVANT marquage
      await openSheet(page, testeur.username);
      // (marqué pendant le passage « pc » : les largeurs suivantes voient l'état « reconnu, mais bloqué »)
      assert.match(await page.textContent('#pd-elig-summary'), label === 'pc'
        ? /Même marqué « compte de test », ce compte ne pourra pas être supprimé : 5 catégories/
        : /Compte de test reconnu, mais suppression bloquée par 5 catégories/);
      assert.strictEqual(await page.locator('#pd-elig-list > li').count(), 5);
      assert.match(await page.textContent('#pd-elig-list'), /2ᵉ place/);
      assert.ok(await page.isDisabled('#btn-pd-delete'), 'suppression désactivée');
      assert.ok(await page.isVisible('#pd-elig-why > summary'));
      await page.locator('#pd-elig-why > summary').click();
      assert.match(await page.textContent('#pd-elig-reasons'), /figé/);
      assert.match(await page.textContent('#pd-elig-why'), /identité jetable neuve/);
      await noHorizontalScroll(page, `${label} diagnostic`);
      await page.locator('#pd-elig').screenshot({ path: path.join(OUT, `p90b-elig-${label}.png`) });

      if (label === 'pc') {
        // Fenêtre de marquage : l'avertissement précède la saisie ; marquage puis « reconnu, mais bloqué »
        await page.click('#btn-pd-test-mark');
        await page.waitForSelector('#pd-mark-warn:not(.hidden)');
        assert.match(await page.textContent('#pd-mark-warn'), /restera non supprimable/);
        await page.screenshot({ path: path.join(OUT, `p90b-mark-${label}.png`) });
        await page.fill('#pd-mark-reason', 'compte testeur');
        await page.fill('#pd-mark-input', testeur.username);
        await page.click('#btn-pd-mark-confirm');
        await page.waitForFunction(() => /Compte de test reconnu, mais suppression bloquée par 5/.test(document.getElementById('pd-elig-summary').textContent));
        assert.ok(await page.isDisabled('#btn-pd-delete'));
        await page.locator('#pd-elig').screenshot({ path: path.join(OUT, `p90b-elig-marked-${label}.png`) });
        assert.ok(db.getUserById(testeur.id), 'compte intact');

        // Identité jetable neuve : il manque la marque, puis suppression possible ; formulaire visible seulement là
        await page.click('#btn-close-player-detail');
        await openSheet(page, jetable.username);
        assert.match(await page.textContent('#pd-elig-summary'), /Aucune donnée protégée/);
        assert.ok(!(await page.isVisible('#pd-elig-why')), '« Pourquoi ? » masqué sans verrou');
        await page.click('#btn-pd-delete');
        await page.waitForSelector('#pd-del-dialog[open]');
        assert.ok(!(await page.isVisible('#pd-del-form')), 'formulaire masqué tant que la suppression est impossible');
        await page.click('#pd-del-dialog [data-close]');
        await page.click('#btn-pd-test-mark');
        await page.fill('#pd-mark-reason', 'identité jetable');
        await page.fill('#pd-mark-input', jetable.username);
        assert.ok(!(await page.isVisible('#pd-mark-warn')));
        await page.click('#btn-pd-mark-confirm');
        await page.waitForFunction(() => /suppression possible/.test(document.getElementById('pd-elig-summary').textContent));
        assert.ok(!(await page.isDisabled('#btn-pd-delete')));
        await page.click('#btn-pd-delete');
        await page.waitForSelector('#pd-del-dialog[open]');
        assert.ok(await page.isVisible('#pd-del-form'));
        await page.click('#pd-del-dialog [data-close]');
        await page.click('#btn-close-player-detail');
      }
      await ctx.close();
    }
    console.log('players-90b e2e : OK');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
