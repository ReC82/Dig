/**
 * Essai navigateur #25 — recette autoclicker du 07/11 : un « autoclicker » (clics souris réels du
 * navigateur, 8 clics/s à position fixe) mine sur un compte en essai Appliqué avec le seuil court
 * d'essai (1 min, ce compte seulement). Contrôles : « Ce que le serveur a vu » avant / pendant,
 * vérification « Petite vérification » affichée après le seuil, coups sans effet, blocs manuels
 * classés figés (relevé avant / maintenant), témoin au même rythme jamais concerné, réglage global
 * inchangé, « Terminer le test » efface seuil et essai. Coffre ouvert : fermé puis reprise (< 3 min).
 * Ordinateur 1280×900 et smartphone 390×844. Serveur de TEST uniquement (jamais le port 3000).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/captures node test/e2e/antibot-autoclicker-recipe.e2e.js
 */
'use strict';

const assert = require('node:assert');
const path = require('path');
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
  // Tutoriel facultatif éventuel : refusé
  await sleep(1500);
  const skip = await p.$('#tuto-card button[data-tuto="skip"]');
  if (skip && await skip.isVisible()) await skip.click();
  return p;
}

/**
 * Autoclicker à position fixe : clics souris au centre du bloc toutes les 125 ms pendant `secs`,
 * arrêt dès que la vérification s'affiche. Un coffre intercepte les clics : on le ferme et on reprend.
 */
async function autoclick(p, secs, { stopOnChallenge = true } = {}) {
  const box = await p.locator('#block').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const t0 = Date.now();
  let chests = 0;
  while (Date.now() - t0 < secs * 1000) {
    if (stopOnChallenge && await p.$('#antibot-modal:not([hidden])')) return { challengeAfter: (Date.now() - t0) / 1000, chests };
    const chest = await p.$('#chest-modal:not([hidden]) #btn-collect-chest');
    if (chest) { await chest.click().catch(() => {}); chests++; await sleep(300); continue; }
    await p.mouse.click(x, y);
    await sleep(125);
  }
  return { challengeAfter: null, chests };
}

const ranked = f => f.lotC.testThreshold?.now?.manualBlocks ?? null;

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [tag, viewport, isMobile] of [['pc 1280', { width: 1280, height: 900 }, false], ['mobile 390', { width: 390, height: 844 }, true]]) {
      const short = tag.replace(/\D/g, '');
      const errors = [];
      const user = `ac_${short}_${Date.now() % 10000}`;
      const witness = `acw_${short}_${Date.now() % 10000}`;
      const gctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const game = await openGame(gctx, user);
      game.on('pageerror', e => errors.push(`jeu: ${e.message}`));
      const wctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const wgame = await openGame(wctx, witness);
      const before = await admin('GET', '/api/admin/security/responses');

      // Admin : choisir le compte, lancer l'essai, activer le seuil court (1 min)
      const actx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const page = await actx.newPage();
      page.on('pageerror', e => errors.push(`admin: ${e.message}`));
      await page.goto(`${BASE}/admin/`);
      await page.fill('#secret-input', ADMIN);
      await page.click('#secret-btn');
      await page.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
      await admOpenTab(page, 'security');
      await page.click('#btn-sec-start-test');
      await page.fill('#sec-test-q', user);
      await page.click('#sec-test-form button[type="submit"]');
      await page.waitForFunction(() => document.getElementById('sec-step-1').classList.contains('is-done'));
      const seen0 = await page.getAttribute('#sec-test-seen .sec-seen', 'data-verdict');
      // Jeu ouvert sans miner : sauvegardes reçues sans clic → « sous les seuils » (ou « aucun contrôle » si aucune encore)
      check(tag, '« Ce que le serveur a vu » avant de jouer : aucune anomalie ni défi', ['below', 'none'].includes(seen0), seen0);
      await page.click('#sec-test-ac > summary');
      check(tag, 'seuil court indisponible avant l\'essai', await page.isDisabled('#btn-sec-test-ac-on'));
      await page.click('#btn-sec-test-start');
      await page.waitForSelector('#adm-confirm[open]');
      await page.click('#adm-confirm-yes');
      await page.waitForFunction(() => document.getElementById('sec-step-2').classList.contains('is-done'));
      await page.selectOption('#sec-test-ac-min', '1');
      await page.click('#btn-sec-test-ac-on');
      await page.waitForFunction(() => /Seuil court actif/.test(document.getElementById('sec-test-ac-state').textContent));
      check(tag, 'seuil court actif, relevé du début affiché', await page.$('#sec-test-ac-snap table') !== null);
      await page.screenshot({ path: path.join(OUT, `25ac-${short}-1-seuil.png`), fullPage: true });

      // Témoin au même rythme (sans essai) pendant que le compte de test mine
      const [run, wrun] = await Promise.all([autoclick(game, 150), autoclick(wgame, 90, { stopOnChallenge: false })]);
      check(tag, 'vérification affichée après ≈ 1 min d\'autoclic (seuil d\'essai + une sauvegarde)', run.challengeAfter != null && run.challengeAfter >= 45 && run.challengeAfter <= 100,
        `${run.challengeAfter} s, ${run.chests} coffre(s) fermé(s)`);
      await game.screenshot({ path: path.join(OUT, `25ac-${short}-2-jeu-verification.png`) });
      // L'autoclicker est arrêté (il cliquerait dans la fenêtre) : coups sur le bloc via le bouton du jeu, sans effet
      const clicks0 = await game.evaluate(() => GameState.seasonStats.manualClicks);
      await game.evaluate(() => { document.getElementById('antibot-modal').hidden = true; });
      const box = await game.locator('#block').boundingBox();
      for (let i = 0; i < 10; i++) { await game.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await sleep(125); }
      check(tag, 'coups sur le bloc sans effet pendant la vérification', await game.evaluate(() => GameState.seasonStats.manualClicks) === clicks0);
      await sleep(14000);   // une sauvegarde
      let f = await admin('GET', `/api/admin/security/player?q=${user}`);
      const frozen = ranked(f);
      check(tag, 'défi réel en attente, minage manuel non classé, raison « minage continu »', f.lotC.state === 'challenge' && f.lotC.manualRanked === false
        && f.lotC.challenge.reasons.includes('continuous_mining'), JSON.stringify(f.lotC.challenge?.reasons));
      check(tag, 'progression avant la vérification visible dans le relevé', frozen > f.lotC.testThreshold.before.manualBlocks, `${f.lotC.testThreshold.before.manualBlocks} → ${frozen}`);
      await sleep(14000);
      f = await admin('GET', `/api/admin/security/player?q=${user}`);
      check(tag, 'blocs manuels classés figés après la vérification', ranked(f) === frozen, `${frozen} → ${ranked(f)}`);
      await page.click('#btn-sec-test-check');
      await page.waitForFunction(() => /Vérification envoyée/.test(document.getElementById('sec-step-3-state').textContent));
      const seen1 = await page.getAttribute('#sec-test-seen .sec-seen', 'data-verdict');
      check(tag, '« Ce que le serveur a vu » : défi réel', seen1 === 'real', seen1);
      await page.screenshot({ path: path.join(OUT, `25ac-${short}-3-admin-gel.png`), fullPage: true });

      const w = await admin('GET', `/api/admin/security/player?q=${witness}`);
      check(tag, 'témoin au même rythme : aucun défi, seuil normal 60 min, « sous les seuils »', w.lotC.history.challenges.length === 0
        && w.lotC.observation.streak.thresholdMin === 60 && w.lotC.observation.streak.valueMin > 1, JSON.stringify(w.lotC.observation.streak));
      const wv = w.lotC.observation;
      check(tag, 'témoin : aucune anomalie ni défi simulé (clics souris réels, isTrusted)', wv.shadowChallenges24h === 0 && wv.realChallenges24h === 0, JSON.stringify({ an: wv.anomalies24h, last: wv.lastAnomaly }));

      // Fin : remise en état
      await page.click('#btn-sec-test-end');
      await page.waitForFunction(() => /Test terminé/.test(document.getElementById('sec-step-5-state').textContent), null, { timeout: 8000 });
      f = await admin('GET', `/api/admin/security/player?q=${user}`);
      const after = await admin('GET', '/api/admin/security/responses');
      check(tag, 'fin du test : essai et seuil court effacés, état normal', f.lotC.testEnforce === false && f.lotC.testThreshold === null && f.lotC.state === 'normal');
      check(tag, 'mode global et paramètres inchangés', after.mode === before.mode && JSON.stringify(after.params) === JSON.stringify(before.params));
      check(tag, 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
      await actx.close(); await gctx.close(); await wctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
