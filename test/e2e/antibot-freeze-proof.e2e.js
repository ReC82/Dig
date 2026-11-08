/**
 * Essai navigateur #25 — preuve du gel (recette du propriétaire du 08/11) : un « autoclicker »
 * (clics souris réels, 8 clics/s à position fixe) mine sur un compte en essai Appliqué avec le
 * seuil court d'essai (1 min). Contrôles : coffres récupérés seuls pendant l'essai (l'autoclicker
 * n'est plus bloqué, récompense inchangée), vérification affichée, résolue dans le jeu (énigme
 * texte), autoclicker relancé (bot supervisé). La fiche admin montre « Preuve du gel » : relevés
 * horodatés émission / pendant / résolution / maintenant, écart +0, reprise après la résolution.
 * Ordinateur 1280×900 et smartphone 390×844. Serveur de TEST uniquement (jamais le port 3000).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/captures node test/e2e/antibot-freeze-proof.e2e.js
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
 * arrêt dès que la vérification s'affiche. Il ne ferme JAMAIS un coffre (comme OP Auto Clicker) :
 * on compte les coffres apparus et refermés seuls.
 */
async function autoclick(p, secs, { stopOnChallenge = true } = {}) {
  const box = await p.locator('#block').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const t0 = Date.now();
  let chests = 0, chestOpen = false, chestStuckMs = 0, chestSince = 0;
  while (Date.now() - t0 < secs * 1000) {
    if (stopOnChallenge && await p.$('#antibot-modal:not([hidden])')) return { challengeAfter: (Date.now() - t0) / 1000, chests, chestStuckMs };
    const open = !!(await p.$('#chest-modal:not([hidden])'));
    if (open && !chestOpen) { chests++; chestSince = Date.now(); }
    if (open) chestStuckMs = Math.max(chestStuckMs, Date.now() - chestSince);
    chestOpen = open;
    await p.mouse.click(x, y);
    await sleep(125);
  }
  return { challengeAfter: null, chests, chestStuckMs };
}

/** Résout la vérification dans le jeu : variante texte (addition), réponse saisie au clavier. */
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

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [tag, viewport, isMobile] of [['pc 1280', { width: 1280, height: 900 }, false], ['mobile 390', { width: 390, height: 844 }, true]]) {
      const short = tag.replace(/\D/g, '');
      const errors = [];
      const user = `fz_${short}_${Date.now() % 10000}`;
      const gctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const game = await openGame(gctx, user);
      game.on('pageerror', e => errors.push(`jeu: ${e.message}`));
      const before = await admin('GET', '/api/admin/security/responses');

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
      await page.click('#btn-sec-test-start');
      await page.waitForSelector('#adm-confirm[open]');
      await page.click('#adm-confirm-yes');
      await page.waitForFunction(() => document.getElementById('sec-step-2').classList.contains('is-done'));
      await page.click('#sec-test-delay label:has(input[value="1"])');
      await page.click('#btn-sec-test-ac-on');
      await page.waitForFunction(() => /Délai actif/.test(document.getElementById('sec-step-3-state').textContent));

      // 1. Autoclicker jusqu'à la vérification ; les coffres ne le bloquent plus
      const run = await autoclick(game, 150);
      check(tag, 'vérification affichée après ≈ 1 min d\'autoclic', run.challengeAfter != null && run.challengeAfter >= 45 && run.challengeAfter <= 100, `${run.challengeAfter} s`);
      check(tag, 'coffres récupérés seuls pendant l\'essai (≤ 3 s chacun)', run.chestStuckMs <= 3000, `${run.chests} coffre(s), au plus ${run.chestStuckMs} ms ouverts`);
      // 2. Pendant la vérification : deux sauvegardes, puis résolution dans le jeu
      await sleep(26000);
      await game.screenshot({ path: path.join(OUT, `25fz-${short}-1-jeu-verification.png`) });
      await solveInGame(game);
      // 3. L'opérateur relance l'autoclicker (bot supervisé) pendant 30 s
      await autoclick(game, 30, { stopOnChallenge: false });
      await sleep(14000);   // une sauvegarde
      const f = await admin('GET', `/api/admin/security/player?q=${user}`);
      const ch = f.lotC.history.challenges.find(c => c.freeze);
      const fr = ch?.freeze;
      check(tag, 'défi automatique résolu, preuve du gel : +0 bloc entre émission et résolution', ch?.status === 'solved' && ch.origin === 'auto'
        && fr.verdict === 'frozen' && fr.deltaBlocks === 0, JSON.stringify(fr && { v: fr.verdict, d: fr.deltaBlocks, s: fr.pendingSaves }));
      check(tag, 'sauvegarde(s) retenue(s) pendant le défi (≥ 1 : le jeu n\'envoie que les changements), aucun bloc refusé par le garde-fou', fr?.pendingSaves >= 1 && fr.clampedBlocks === 0, `${fr?.pendingSaves}`);
      check(tag, 'progression après la résolution (autoclicker relancé)', f.lotC.progressNow.manualBlocks >= fr.end.manualBlocks, `${fr?.end?.manualBlocks} → ${f.lotC.progressNow.manualBlocks}`);
      const r = f.lotC.recidivism;
      check(tag, 'reprise après résolution mesurée (indice, sans action)', r.solved24h === 1 && r.last.resumedAfterSecs != null && r.last.resumeCps >= 4 && f.lotC.state === 'normal',
        JSON.stringify(r.last));
      // Option A (08/11) : la résolution remet la seule série à zéro ; les cumuls 6 h / 24 h sont conservés
      const mt = f.lotC.metrics;
      check(tag, 'après résolution : série repartie de zéro, cumuls 6 h / 24 h conservés (option A)',
        mt.active6hMin >= 0.9 && mt.active24hMin >= 0.9 && mt.streakMin < mt.active6hMin - 0.5 && f.lotC.globalMode === 'observe', JSON.stringify(mt));
      // 4. Fiche admin : tableau horodaté
      await page.evaluate(() => secTestRefresh());
      await page.click('#sec-test-adv > summary');
      await page.waitForSelector('#sec-test-adv-body .sec-freeze');
      const verdict = await page.getAttribute('#sec-test-adv-body .sec-freeze', 'data-verdict');
      const rows = await page.$$eval('#sec-test-adv-body .sec-freeze tbody th', ths => ths.map(t => t.textContent));
      check(tag, 'admin : « Preuve du gel » vérifiée, phases horodatées', verdict === 'frozen'
        && ['Émission du défi', 'Pendant le défi', 'Résolution'].every(x => rows.includes(x)) && rows.some(x => x.startsWith('Maintenant')), rows.join(' | '));
      await page.locator('#sec-test-adv-body .sec-freeze').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `25fz-${short}-2-admin-preuve.png`), fullPage: true });

      await page.click('#btn-sec-test-end');
      await page.waitForFunction(() => /Test terminé/.test(document.getElementById('sec-step-5-state').textContent), null, { timeout: 8000 });
      const after = await admin('GET', '/api/admin/security/responses');
      check(tag, 'mode global et paramètres inchangés', after.mode === before.mode && JSON.stringify(after.params) === JSON.stringify(before.params));
      check(tag, 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
      await actx.close(); await gctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
