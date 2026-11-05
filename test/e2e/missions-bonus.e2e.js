/**
 * Essai navigateur — bonus trois missions (#68, 05/11) dans Admin → 🎯 Missions : carte, fenêtre
 * d'édition (barème proposé), écart dans le brouillon, coût affiché par le simulateur, brouillon
 * abandonné à la fin. Base de TEST uniquement (jamais le port 3000) :
 *   PORT=3101 DB_FILE=test-68.sqlite NODE_ENV=test ADMIN_SECRET=<secret> node server/index.js
 *   PW=/chemin/node_modules/playwright-core CHROME=<chrome-headless-shell> BASE=http://127.0.0.1:3101 \
 *     ADMIN=<secret> SHOTS=/tmp/dossier node test/e2e/missions-bonus.e2e.js
 */

'use strict';

const assert = require('assert');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const { BASE, ADMIN } = process.env;
const SHOTS = process.env.SHOTS || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}` };
const log = (...a) => console.log('✓', ...a);
const api = async (p, method = 'GET') => (await fetch(`${BASE}${p}`, { method, headers: H })).json();

async function steps(page, tag) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  const before = await api('/api/admin/missions');
  assert.strictEqual(before.draft, null, 'base de test sans brouillon');

  await admOpenTab(page, 'missions');
  await page.waitForSelector('#mq-body tr.bk-row');
  assert.match(await page.textContent('#mq-bonus-state'), /Aucun bonus/);
  await page.click('#btn-mq-bonus');
  await page.waitForSelector('#mq-bonus-dialog[open]');
  assert.strictEqual(await page.locator('#mq-bonus-rows tr').count(), 0);
  await page.click('#btn-mq-bonus-proposal');
  assert.strictEqual(await page.locator('#mq-bonus-rows tr').count(), 4);
  assert.ok(!await page.isChecked('#mq-bonus-enabled'), 'reste désactivé');
  await page.screenshot({ path: `${SHOTS}/${tag}-bonus-1-fenetre.png` });
  await page.click('#btn-mq-bonus-save');
  await page.waitForFunction(() => /Désactivé \(préparation\)/.test(document.getElementById('mq-bonus-state').textContent));
  assert.strictEqual(await page.locator('#mq-bonus-view li').count(), 4);
  assert.match(await page.textContent('#mq-draft-body'), /Bonus trois missions/);
  log(`${tag} : barème proposé enregistré dans le brouillon, désactivé, écart visible`);

  await page.selectOption('#mq-sim-source', 'draft');
  await page.fill('#mq-sim-days', '3');
  await page.fill('#mq-sim-start', '2026-11-09');
  for (const c of await page.locator('#mq-sim-profiles input').all()) await c.setChecked(['debutant', 'tres_avance'].includes(await c.getAttribute('value')));
  await page.click('#btn-mq-simulate');
  await page.waitForFunction(() => /Bonus trois missions \(désactivé/.test(document.getElementById('mq-sim-out').textContent));
  const txt = await page.textContent('#mq-sim-out');
  assert.match(txt, /à partir de 1 m : 300 💰 \+ 1 💎/);
  assert.match(txt, /à partir de 300 m : 40\s000 💰 \+ 2 💎/);
  await page.locator('#mq-sim-out').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/${tag}-bonus-2-simulateur.png` });
  log(`${tag} : simulateur — coût du bonus par profil (débutant 1 m, très avancé 300 m)`);

  const pub = await api('/api/admin/missions');
  assert.strictEqual(pub.published.version, before.published.version, 'rien de publié');
  assert.deepStrictEqual(pub.published.setBonus, before.published.setBonus);
  await api('/api/admin/missions/draft', 'DELETE');
  assert.deepStrictEqual(errors, []);
  log(`${tag} : aucune publication, brouillon abandonné, aucune erreur JavaScript`);
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [tag, viewport] of [['pc', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport });
    await steps(await ctx.newPage(), tag);
    await ctx.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
