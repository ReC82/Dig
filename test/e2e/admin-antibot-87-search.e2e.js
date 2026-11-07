/**
 * Essai navigateur #87-B (recette du 07/11) : recherche du compte dans Admin → Anti-bot, étape 1 du parcours
 * « Tester la protection » et « Ouvrir la fiche d'un joueur ». À 1280×900, 390×844 et 320×640 :
 * pseudo partiel « teste » → testeur (suggestion cliquable, puis Entrée sans suggestion), casse ignorée,
 * pseudo exact, #ID, inconnu (« Aucun résultat »), plusieurs résultats (pluriel, choix au clavier),
 * réseau lent (« Recherche… ») et coupé, jamais d'e-mail affiché, aucun essai lancé, mode global inchangé.
 * Serveur de TEST uniquement (base neuve, port ≥ 3100). Hors `npm test` (navigateur requis).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/captures node test/e2e/admin-antibot-87-search.e2e.js
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
async function register(page, u) {
  return page.evaluate(async user => {
    const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: 'motdepasse87', email: `${user}@example.invalid` }) });
    return r.ok;
  }, u);
}
const chosen = page => page.textContent('#sec-step-1-state');
const msg = page => page.textContent('#sec-step-1-pick');
const options = (page, list = '#sec-test-suggest') => page.$$eval(`${list} li`, els => els.map(e => e.textContent));
async function typeIn(page, sel, text) {
  await page.fill(sel, '');
  await page.click(sel);
  await page.keyboard.type(text, { delay: 30 });
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    const reg = await browser.newContext();
    const rp = await reg.newPage();
    await rp.goto(BASE + '/');
    for (const u of ['testeur', 'bobtest1', 'bobtest2', 'autre']) assert.ok(await register(rp, u), u);
    await reg.close();
    const ids = {};
    for (const u of ['testeur', 'autre']) ids[u] = (await admin('GET', `/api/admin/security/player?q=${u}`)).player.userId;
    const globalBefore = (await admin('GET', '/api/admin/security/responses')).mode;

    for (const [tag, viewport, isMobile] of [['pc 1280', { width: 1280, height: 900 }, false], ['mobile 390', { width: 390, height: 844 }, true], ['mobile 320', { width: 320, height: 640 }, true]]) {
      const short = tag.replace(/\D/g, '');
      const errors = [];
      const actx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const page = await actx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`${BASE}/admin/`);
      await page.fill('#secret-input', ADMIN);
      await page.click('#secret-btn');
      await page.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
      await admOpenTab(page, 'security');
      await page.waitForFunction(() => document.getElementById('sec-top-mode-value').textContent !== '…');
      await page.click('#btn-sec-start-test');

      // 1. Partiel « teste » → suggestion « testeur · ID n », cliquable
      await typeIn(page, '#sec-test-q', 'teste');
      await page.waitForSelector('#sec-test-suggest li[role="option"]');
      const opts = await options(page);
      check(tag, 'partiel « teste » : suggestion testeur avec son ID', opts.length === 1 && opts[0] === `testeur · ID ${ids.testeur}`, JSON.stringify(opts));
      check(tag, 'aucune adresse e-mail dans les suggestions', !(await page.textContent('#sec-test-suggest')).includes('@'));
      const box = await page.$eval('#sec-test-suggest', el => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
      check(tag, 'liste entièrement visible à l\'écran', box.l >= 0 && box.r <= box.w + 1, JSON.stringify(box));
      await page.screenshot({ path: path.join(OUT, `87b-${short}-1-suggestion.png`) });
      await page.click('#sec-test-suggest li[role="option"]');
      await page.waitForFunction(() => /Compte choisi : testeur/.test(document.getElementById('sec-step-1-state').textContent));
      check(tag, 'un clic sur la suggestion choisit le compte (étape 1 validée)', /✓ Compte choisi : testeur \(#\d+\)/.test(await chosen(page)));
      check(tag, 'étape 2 disponible, rien lancé', !(await page.isDisabled('#btn-sec-test-start')));
      await page.screenshot({ path: path.join(OUT, `87b-${short}-2-choisi.png`) });

      // 2. Entrée sans suggestion surlignée, casse différente → seul résultat choisi
      await typeIn(page, '#sec-test-q', 'TESTE');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /testeur/.test(document.getElementById('sec-step-1-state').textContent) && document.getElementById('sec-test-q').value === 'testeur');
      check(tag, '« TESTE » + Entrée : testeur choisi (un seul résultat, casse ignorée)', true);

      // 3. Pseudo exact + bouton ; 4. #ID
      await page.fill('#sec-test-q', 'autre');
      await page.click('#sec-test-form button[type="submit"]');
      await page.waitForFunction(() => /Compte choisi : autre/.test(document.getElementById('sec-step-1-state').textContent));
      check(tag, 'pseudo exact « autre » + « Choisir ce compte »', true);
      await page.fill('#sec-test-q', `#${ids.testeur}`);
      await page.click('#sec-test-form button[type="submit"]');
      await page.waitForFunction(() => /Compte choisi : testeur/.test(document.getElementById('sec-step-1-state').textContent));
      check(tag, '#ID exact', true);

      // 5. Inconnu : « Aucun résultat » dans la liste puis message clair, compte précédent conservé
      await typeIn(page, '#sec-test-q', 'inconnu');
      await page.waitForFunction(() => /Aucun pseudo ne contient « inconnu »/.test(document.getElementById('sec-test-suggest').textContent));
      check(tag, 'inconnu : « Aucun pseudo ne contient » affiché à la saisie', true);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /Aucun compte ne correspond à « inconnu »/.test(document.getElementById('sec-step-1-pick').textContent));
      check(tag, 'inconnu + Entrée : message d\'erreur, compte précédent conservé', /testeur/.test(await chosen(page)) && await page.$eval('#sec-step-1-pick', e => e.classList.contains('error')));

      // 6. Plusieurs résultats : pluriel, liste rouverte, choix au clavier
      await page.fill('#sec-test-q', 'bobtest');
      await page.click('#sec-test-form button[type="submit"]');
      await page.waitForFunction(() => /2 comptes contiennent « bobtest »/.test(document.getElementById('sec-step-1-pick').textContent));
      const many = await options(page);
      const pickBox = await page.$eval('#sec-step-1-pick', e => { const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
      check(tag, 'message de recherche affiché sous le champ, visible à l\'écran', pickBox);
      check(tag, 'plusieurs résultats : « 2 comptes contiennent… », liste des deux comptes', many.length === 2 && many.every(t => /^bobtest\d · ID \d+$/.test(t)), JSON.stringify(many));
      await page.screenshot({ path: path.join(OUT, `87b-${short}-3-plusieurs.png`) });
      await page.focus('#sec-test-q');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /Compte choisi : bobtest2/.test(document.getElementById('sec-step-1-state').textContent));
      check(tag, 'clavier ↓ ↓ Entrée : bobtest2 choisi, message effacé', (await msg(page)) === '');

      // 7. Réseau lent : « Recherche… » puis résultat ; 8. réseau coupé : message
      await page.route('**/api/admin/players/suggest*', async r => { await sleep(1500); await r.continue(); });
      await typeIn(page, '#sec-test-q', 'teste');
      await page.waitForFunction(() => document.getElementById('sec-test-suggest').textContent === 'Recherche…');
      check(tag, 'réseau lent : « Recherche… » affiché', true);
      await page.waitForSelector('#sec-test-suggest li[role="option"]', { timeout: 5000 });
      check(tag, 'réseau lent : suggestion affichée ensuite', (await options(page))[0].startsWith('testeur'));
      await page.unroute('**/api/admin/players/suggest*');
      await page.route('**/api/admin/players/suggest*', r => r.abort());
      await typeIn(page, '#sec-test-q', 'bobt');
      await page.waitForFunction(() => /Recherche impossible/.test(document.getElementById('sec-test-suggest').textContent));
      check(tag, 'réseau coupé : « Recherche impossible — réessayez »', true);
      await page.unroute('**/api/admin/players/suggest*');
      await page.keyboard.press('Escape');

      // 9. Fiche joueur : même recherche partielle
      await typeIn(page, '#sec-player-q', 'teste');
      await page.waitForSelector('#sec-player-suggest li[role="option"]');
      await page.keyboard.press('Escape');
      await page.click('#sec-player-form button[type="submit"]');
      await page.waitForSelector('#sec-player-dialog[open]');
      check(tag, 'fiche : « teste » ouvre la fiche de testeur', /testeur/.test(await page.textContent('#sec-player-dialog')));
      await page.click('#sec-player-dialog [data-close]');

      const resp = await admin('GET', '/api/admin/security/responses');
      check(tag, 'aucun essai lancé, mode global inchangé', resp.mode === globalBefore && !(resp.testAccounts ?? []).length, `${resp.mode} / ${JSON.stringify(resp.testAccounts)}`);
      check(tag, 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
      await actx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
