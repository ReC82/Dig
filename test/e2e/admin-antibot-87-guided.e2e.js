/**
 * Essai navigateur #87 — parcours guidé simplifié (recette du propriétaire du 08/11) : 5 étapes, un
 * seul bouton principal (doré) par étape, délai 1/2/3 min dans le flux, états « Prêt / Essai en
 * cours / Défi en attente / Résolu / Terminé », résultat au premier niveau (blocs validés au moment
 * du défi, pendant le défi, écart), diagnostic avancé replié. Autoclicker réel (8 clics/s) sur un
 * compte en essai avec un délai de 1 min, à 1280×900 et 390×844 ; mise en page seule à 320×640.
 * Serveur de TEST uniquement (jamais le port 3000).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/captures node test/e2e/admin-antibot-87-guided.e2e.js
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

/** Mise en page de la carte : étape courante, boutons principaux dorés visibles, débordement, cibles tactiles. */
async function layout(page) {
  return page.evaluate(() => {
    const card = document.getElementById('sec-test-card');
    const mains = [...card.querySelectorAll('.sec-step-main')].filter(b => !b.classList.contains('btn-outline'));
    const cur = card.querySelector('.sec-step.is-current');
    const small = [...card.querySelectorAll('.sec-step.is-current button, .sec-step.is-current .sec-delay label')]
      .filter(b => b.offsetParent && b.getBoundingClientRect().height < 30 && !b.classList.contains('sec-link-btn')).map(b => b.textContent.trim());
    return { badge: document.getElementById('sec-test-badge').textContent, current: cur?.dataset.step ?? null,
      mains: mains.map(b => b.closest('.sec-step').dataset.step), advOpen: document.getElementById('sec-test-adv').open,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || card.scrollWidth > card.clientWidth + 1, small };
  });
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

async function startTrial(page) {
  await page.click('#btn-sec-test-start');
  await page.waitForSelector('#adm-confirm[open]');
  await page.click('#adm-confirm-yes');
  await page.waitForFunction(() => document.getElementById('sec-step-2').classList.contains('is-done'));
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [tag, viewport, isMobile, full] of [['pc 1280', { width: 1280, height: 900 }, false, true],
      ['mobile 390', { width: 390, height: 844 }, true, true], ['mobile 320', { width: 320, height: 640 }, true, false]]) {
      const short = tag.replace(/\D/g, '');
      const errors = [];
      const user = `gd_${short}_${Date.now() % 10000}`;
      const gctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const game = await openGame(gctx, user);
      game.on('pageerror', e => errors.push(`jeu: ${e.message}`));
      const before = await admin('GET', '/api/admin/security/responses');
      const { actx, page } = await openAdmin(browser, viewport, isMobile, errors);

      let l = await layout(page);
      check(tag, 'avant le choix : « Prêt », étape 1 seule en doré, diagnostic replié', l.badge === 'Prêt' && l.current === '1' && l.mains.join() === '1' && !l.advOpen, JSON.stringify(l));
      await pickAccount(page, user);
      l = await layout(page);
      check(tag, 'compte choisi : étape 2 courante, seul « Lancer l\'essai » en doré', l.current === '2' && l.mains.join() === '2', JSON.stringify(l));
      check(tag, 'premier niveau sans jargon (« Ce que le serveur a vu », « clics déclarés » repliés)', await page.evaluate(() => {
        const card = document.getElementById('sec-test-card');
        const vis = [...card.querySelectorAll('.sec-steps *')].filter(e => e.offsetParent).map(e => e.textContent).join(' ');
        return !/Ce que le serveur a vu|Clics déclarés|Minage continu sans pause|\/ 180 min/.test(vis);
      }));
      await startTrial(page);
      l = await layout(page);
      check(tag, 'essai lancé : « Essai en cours », étape 3 (délai) courante', l.badge === 'Essai en cours' && l.current === '3' && l.mains.join() === '3', JSON.stringify(l));
      await page.click('#sec-test-delay label:has(input[value="3"])');
      check(tag, 'choix 3 min : libellé du bouton mis à jour', /Activer le délai de 3 min/.test(await page.textContent('#btn-sec-test-ac-on')));
      await page.click('#sec-test-delay label:has(input[value="1"])');
      await page.click('#btn-sec-test-ac-on');
      await page.waitForFunction(() => /Délai actif : vérification après 1 min/.test(document.getElementById('sec-step-3-state').textContent));
      l = await layout(page);
      check(tag, 'délai actif : étape 4 courante, « Actualiser le résultat » seul en doré, progression affichée', l.current === '4' && l.mains.join() === '4'
        && await page.$('#sec-test-progress progress') !== null && /1 min \+ quelques secondes/.test(await page.textContent('#sec-step-4')), JSON.stringify(l));
      check(tag, 'aucun débordement, boutons ≥ 30 px', !l.overflow && l.small.length === 0, JSON.stringify(l.small));
      await page.locator('#sec-step-3').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `87g-${short}-1-delai.png`), fullPage: !full });

      if (full) {
        await game.reload();   // le jeu lit le mode recette (coffres récupérés seuls) au chargement
        await game.waitForSelector('#block');
        await sleep(1000);
        const run = await autoclick(game, 150);
        check(tag, 'vérification affichée après ≈ 1 min d\'autoclic', run.challengeAfter != null && run.challengeAfter >= 45 && run.challengeAfter <= 100, `${run.challengeAfter} s`);
        await sleep(14000);   // une sauvegarde retenue
        // Le résultat se met à jour seul (≤ 10 s) : « Défi en attente », tuiles, écart +0
        await page.waitForSelector('#sec-test-result .sec-result--open', { timeout: 15000 });
        l = await layout(page);
        const tiles = await page.$$eval('#sec-test-result .sec-result-tile', ts => ts.map(t => [t.querySelector('.sec-result-label').textContent, t.querySelector('.sec-result-value').textContent, t.querySelector('.sec-result-sub').textContent]));
        check(tag, 'défi en attente : badge, étape 4 courante', l.badge === 'Défi en attente' && l.current === '4', JSON.stringify(l));
        check(tag, 'résultat : au moment du défi (heure), pendant le défi, écart +0', tiles.length === 3 && tiles[0][0] === 'Au moment du défi' && /\d\d:\d\d:\d\d/.test(tiles[0][2])
          && tiles[1][0] === 'Pendant le défi' && tiles[1][1] === tiles[0][1] && tiles[2][0] === 'Écart' && tiles[2][1] === '+0', JSON.stringify(tiles));
        check(tag, 'progression masquée une fois le défi émis', await page.$('#sec-test-progress progress') === null);
        await page.locator('#sec-step-4').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(OUT, `87g-${short}-2-defi-en-attente.png`) });
        await solveInGame(game);
        await page.click('#btn-sec-test-check');
        await page.waitForSelector('#sec-test-result .sec-result--ok', { timeout: 8000 });
        l = await layout(page);
        const t2 = await page.$$eval('#sec-test-result .sec-result-tile', ts => ts.map(t => t.querySelector('.sec-result-label').textContent + '=' + t.querySelector('.sec-result-value').textContent));
        check(tag, 'résolu : badge « Résolu », « Gel vérifié », étape 5 seule en doré', l.badge === 'Résolu' && l.current === '5' && l.mains.join() === '5'
          && /Gel vérifié/.test(await page.textContent('#sec-test-result')) && t2[1].startsWith('À la résolution') && t2[2] === 'Écart=+0', JSON.stringify({ l, t2 }));
        await page.click('#sec-test-adv > summary');
        check(tag, 'diagnostic avancé : ce que le serveur a vu + relevés horodatés', await page.$('#sec-test-adv-body .sec-seen[data-verdict]') !== null
          && await page.getAttribute('#sec-test-adv-body .sec-freeze', 'data-verdict') === 'frozen');
        await page.click('#sec-test-adv > summary');
        await page.locator('#sec-step-4').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(OUT, `87g-${short}-3-resolu.png`) });
      }

      await page.click('#btn-sec-test-end');
      await page.waitForFunction(() => /Test terminé/.test(document.getElementById('sec-step-5-state').textContent), null, { timeout: 8000 });
      l = await layout(page);
      const f = await admin('GET', `/api/admin/security/player?q=${user}`);
      const after = await admin('GET', '/api/admin/security/responses');
      check(tag, 'terminé : badge « Terminé », aucune étape courante', l.badge === 'Terminé' && l.current === null && l.mains.length === 0, JSON.stringify(l));
      check(tag, 'délai et essai supprimés, état normal', f.lotC.testEnforce === false && f.lotC.testThreshold === null && f.lotC.state === 'normal' && f.lotC.violationLevel === 0);
      check(tag, 'mode global et paramètres inchangés', after.mode === before.mode && JSON.stringify(after.params) === JSON.stringify(before.params));
      await page.locator('#sec-test-card').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `87g-${short}-4-termine.png`), fullPage: !full });
      check(tag, 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
      await actx.close(); await gctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
