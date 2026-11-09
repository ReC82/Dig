/**
 * Essai navigateur #25 — recette du propriétaire du 09/11 : « Terminer le test » grisé sans
 * explication. Mode « Appliqué » pour tous (décision du 08/11), à 1280×900 et 390×844 :
 *  A. parcours #84-E bis de bout en bout : vérification envoyée tout de suite → « Signaler une
 *     erreur » dans le jeu (un seul signalement) → « Reprendre la vérification » → énigme résolue →
 *     étape 5 cochée « Essai terminé — … aucune remise à zéro nécessaire », « Nouveau test » ;
 *     F5 de l'admin : même état ; « Nouveau test » → étape 3, rien d'effacé côté serveur ;
 *  B. délai court en mode Appliqué pour tous (essai de ce compte seul) → « Terminer le test » nomme
 *     ce qui reste, le retire, puis le parcours est terminé ; mode global inchangé.
 * Progression classée relue côté serveur avant/après (aucune perte). Serveur de TEST uniquement.
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/captures node test/e2e/admin-antibot-end-25.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
if (!BASE || /:3000\b/.test(BASE)) throw new Error('serveur de test obligatoire (jamais le port 3000)');
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (tag, label, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} [${tag}] ${label}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };

async function admin(method, p, body) {
  const res = await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return res.json().catch(() => ({}));
}
async function openGame(ctx, user) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/?lang=fr');
  const ok = await p.evaluate(async u => (await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: 'motdepasse25', email: `${u}@example.invalid` }) })).ok, user);
  assert.ok(ok, 'inscription');
  await p.reload();
  const pick = await p.$('.lang-pick-btn[data-lang="fr"]');
  if (pick && await pick.isVisible()) await pick.click();
  await p.waitForSelector('#block');
  await sleep(1500);
  const skip = await p.$('#tuto-card button[data-tuto="skip"]');
  if (skip && await skip.isVisible()) await skip.click();
  return p;
}
async function solveInGame(p) {
  await p.click('#antibot-alt');
  await p.waitForSelector('#antibot-answer');
  const q = await p.textContent('label[for="antibot-answer"]');
  const [a, b] = q.match(/\d+/g).map(Number);
  await sleep(1500);
  await p.fill('#antibot-answer', String(a + b));
  await p.click('.antibot-text-form button[type="submit"]');
  await p.waitForSelector('#antibot-modal', { state: 'hidden', timeout: 10000 });
}
async function openAdmin(browser, viewport, isMobile, errors) {
  const actx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
  const page = await actx.newPage();
  page.on('pageerror', e => errors.push(`admin: ${e.message}`));
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await page.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
  await admOpenTab(page, 'security');
  return { actx, page };
}
async function pickAccount(page, user) {
  await page.click('#btn-sec-start-test');
  await page.fill('#sec-test-q', user);
  await page.click('#sec-test-form button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('sec-step-1').classList.contains('is-done'));
}
/** Étape 5 telle que la voit l'administrateur. */
const step5 = page => page.evaluate(() => {
  const li = document.getElementById('sec-step-5'), end = document.getElementById('btn-sec-test-end'), nw = document.getElementById('btn-sec-test-new');
  const vis = b => !!b.offsetParent;
  return { done: li.classList.contains('is-done'), current: li.classList.contains('is-current'), text: document.getElementById('sec-step-5-state').textContent,
    badge: document.getElementById('sec-test-badge').textContent, endVisible: vis(end), endDisabled: end.disabled, newVisible: vis(nw),
    cur: document.querySelector('#sec-test-card .sec-step.is-current')?.dataset.step ?? null };
});

(async () => {
  await admin('PUT', '/api/admin/beta/settings', { bannerEnabled: true, reportsEnabled: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [tag, viewport, isMobile] of [['pc 1280', { width: 1280, height: 900 }, false], ['mobile 390', { width: 390, height: 844 }, true]]) {
      const short = tag.replace(/\D/g, '');
      const errors = [];
      const user = `end_${short}_${Date.now() % 10000}`;
      const mode0 = (await admin('GET', '/api/admin/security/responses')).mode;
      check(tag, 'mode global « Appliqué » (comme en production)', mode0 === 'enforce', mode0);
      const gctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const game = await openGame(gctx, user);
      game.on('pageerror', e => errors.push(`jeu: ${e.message}`));
      // Un peu de minage avant l'essai : la progression classée doit être conservée
      // (positions et rythme variés : moins de 25 coups au même pixel, sinon #91 envoie une vraie vérification)
      const bb = await game.locator('#block').boundingBox();
      for (let i = 0; i < 12; i++) { await game.mouse.click(bb.x + bb.width * (0.3 + (i % 5) * 0.1), bb.y + bb.height * (0.35 + (i % 3) * 0.1)); await sleep(150 + (i * 37) % 120); }
      await sleep(13_000);
      const lot = async () => (await admin('GET', `/api/admin/security/player?q=${user}`)).lotC;
      const blocks0 = (await lot()).progressNow?.manualBlocks ?? 0;
      let { actx, page } = await openAdmin(browser, viewport, isMobile, errors);
      await pickAccount(page, user);

      let s = await step5(page);
      check(tag, 'avant tout : étape 5 grisée MAIS raison écrite', s.endDisabled && /Rien à remettre en état/.test(s.text) && !s.done, JSON.stringify(s));
      const acOn = await page.$eval('#btn-sec-test-ac-on', b => ({ disabled: b.disabled, text: b.textContent }));
      check(tag, 'mode Appliqué pour tous : délai court activable (plus de bouton grisé sans raison)', !acOn.disabled
        && /Activer un délai court place ce compte seul en essai/.test(await page.textContent('#sec-step-3-state')), JSON.stringify(acOn));

      // ── A. #84-E bis : vérification tout de suite → signalement → reprise → résolution ──
      await page.click('#btn-sec-test-challenge');
      await page.waitForFunction(() => /vérification en attente/.test(document.getElementById('sec-step-5-state').textContent));
      s = await step5(page);
      check(tag, 'défi en attente : « Terminer le test » actif, ce qui reste est nommé', !s.endDisabled && /À remettre en état : vérification en attente/.test(s.text), s.text);
      await game.reload();
      await game.waitForSelector('#antibot-modal:not([hidden])', { timeout: 15000 });
      const nReports = async () => (await admin('GET', '/api/admin/beta/reports')).reports.filter(r => r.username === user).length;
      await game.click('#antibot-report');
      await game.fill('#beta-observed', 'essai #84-E bis');
      await game.click('#btn-beta-send');
      await game.waitForFunction(() => /is-ok/.test(document.getElementById('beta-report-msg').className));
      check(tag, '#84-E bis : « Reprendre la vérification » après l\'envoi', (await game.textContent('#btn-beta-cancel')).trim() === '🛡️ Reprendre la vérification');
      await game.click('#btn-beta-cancel');
      await game.waitForSelector('#antibot-modal:not([hidden])', { timeout: 3000 });
      check(tag, '#84-E bis : défi toujours en attente côté serveur, un seul signalement', (await lot()).state === 'challenge' && await nReports() === 1);
      await solveInGame(game);
      await page.click('#btn-sec-test-check');
      await page.waitForFunction(() => document.getElementById('sec-step-5').classList.contains('is-done'), null, { timeout: 8000 });
      s = await step5(page);
      check(tag, 'résolu (cas de la capture) : étape 5 cochée, « Essai terminé — … aucune remise à zéro nécessaire », badge Terminé',
        s.done && !s.current && s.badge === 'Terminé' && /Essai terminé — end_\d+_\d+ mine normalement ; aucune remise à zéro nécessaire/.test(s.text)
        && /inchangée \(Appliqué\)/.test(s.text), JSON.stringify(s));
      check(tag, 'plus de bouton grisé : « Terminer le test » masqué, « Nouveau test » proposé', !s.endVisible && s.newVisible, JSON.stringify(s));
      await page.screenshot({ path: `${OUT}/end25-${short}-1-essai-termine.png`, fullPage: false });
      await page.locator('#sec-step-5').screenshot({ path: `${OUT}/end25-${short}-1b-etape5.png` });
      // F5 de l'admin : rien en mémoire navigateur, le compte est relu côté serveur
      await page.reload();
      await page.fill('#secret-input', ADMIN).catch(() => {});
      await page.click('#secret-btn').catch(() => {});
      await page.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
      await admOpenTab(page, 'security');
      await pickAccount(page, user);
      s = await step5(page);
      check(tag, 'après F5 : même état terminé', s.done && /aucune remise à zéro nécessaire/.test(s.text) && s.newVisible, JSON.stringify(s));
      const L1 = await lot();
      check(tag, 'serveur : compte normal (ni essai, ni défi, ni suspension, palier 0)', L1.state === 'normal' && !L1.testEnforce && !L1.testThreshold && L1.violationLevel === 0);
      await page.click('#btn-sec-test-new');
      s = await step5(page);
      check(tag, '« Nouveau test » : retour à l\'étape 3, étape 5 non cochée, rien d\'effacé', s.cur === '3' && !s.done && s.endVisible
        && (await lot()).history.challenges.length === L1.history.challenges.length, JSON.stringify(s));

      // ── B. délai court en mode Appliqué pour tous, puis « Terminer le test » ──
      await page.check('input[name="sec-test-delay"][value="1"]');
      await page.click('#btn-sec-test-ac-on');
      await page.waitForFunction(() => /Délai actif : vérification après 1 min/.test(document.getElementById('sec-step-3-state').textContent));
      s = await step5(page);
      check(tag, 'délai court actif : « Terminer le test » actif, nomme « délai court, essai sur ce compte »', !s.endDisabled && /délai court, essai sur ce compte/.test(s.text), s.text);
      await page.click('#btn-sec-test-end');
      await page.waitForFunction(() => /Test terminé/.test(document.getElementById('sec-step-5-state').textContent), null, { timeout: 8000 });
      s = await step5(page);
      const L2 = await lot();
      check(tag, 'après « Terminer le test » : étape 5 cochée, « Nouveau test » proposé, essai et délai retirés côté serveur',
        s.done && s.newVisible && !s.endVisible && !L2.testEnforce && !L2.testThreshold, JSON.stringify(s));
      const mode1 = (await admin('GET', '/api/admin/security/responses')).mode;
      check(tag, 'mode global inchangé (Appliqué)', mode1 === 'enforce', mode1);
      await page.locator('#sec-step-5').screenshot({ path: `${OUT}/end25-${short}-2-termine-apres-clic.png` });
      const blocks1 = L2.progressNow?.manualBlocks ?? 0;
      check(tag, 'progression classée conservée (aucune perte)', blocks1 >= blocks0, `${blocks0} → ${blocks1}`);
      check(tag, 'aucune erreur JS', errors.length === 0, errors.join(' | '));
      await actx.close(); await gctx.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
