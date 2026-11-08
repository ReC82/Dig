/**
 * Essai navigateur #87 : Admin → Anti-bot simplifié, parcours guidé « Tester la protection » de bout en bout,
 * à 1280×900, 390×844 et 320×640. Le joueur est joué dans un 2e contexte (vrai jeu) pendant que l'admin suit
 * les étapes : choisir → lancer l'essai (confirmation) → afficher le défi → résoudre dans le jeu → terminer.
 * Contrôles : cartes et bouton primaire visibles sans défiler, réglages / diagnostic repliés, F5 en plein
 * parcours (compte et étape retrouvés), double clic sans double défi, autre compte jamais concerné,
 * mode global Observation inchangé, minage normal après la remise en état, fiche avec statut et action en tête.
 * Serveur de TEST uniquement (base neuve, port ≥ 3100). Hors `npm test` (navigateur requis).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/captures node test/e2e/admin-antibot-87.e2e.js
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
async function openGame(p) {
  await p.goto(BASE + '/?lang=fr');
  const pick = await p.$('.lang-pick-btn[data-lang="fr"]');
  if (pick && await pick.isVisible()) await pick.click();
}
async function solveGrid(p) {
  const q = await p.textContent('.antibot-question');
  const tiles = await p.$$eval('.antibot-tile', els => els.map(e => e.getAttribute('aria-label')));
  const order = tiles.map((label, i) => ({ i, at: q.indexOf(label) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at);
  await sleep(1500);
  for (const { i } of order) await p.click(`.antibot-tile >> nth=${i}`);
}
const stepState = (page, n) => page.evaluate(i => {
  const li = document.getElementById(`sec-step-${i}`);
  return { done: li.classList.contains('is-done'), current: li.classList.contains('is-current'), text: document.getElementById(`sec-step-${i}-state`).textContent };
}, n);

(async () => {
  // Base neuve : la décision du 08/11 met le mode global en Appliqué ; cet essai part d'Observation
  await admin('PUT', '/api/admin/config', { key: 'antibot_response_mode', value: 'observe' });
  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [tag, viewport, isMobile] of [['pc 1280', { width: 1280, height: 900 }, false], ['mobile 390', { width: 390, height: 844 }, true], ['mobile 320', { width: 320, height: 640 }, true]]) {
      const short = tag.replace(/\D/g, '');
      const errors = [];
      // Joueur de test + témoin (un autre compte, jamais concerné)
      const gctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const game = await gctx.newPage();
      game.on('pageerror', e => errors.push(`jeu: ${e.message}`));
      await game.goto(BASE + '/');
      const user = `t87_${short}_${Date.now() % 10000}`;
      assert.ok(await register(game, user));
      const wctx = await browser.newContext();
      const wpage = await wctx.newPage();
      await wpage.goto(BASE + '/');
      const witness = `w87_${short}_${Date.now() % 10000}`;
      assert.ok(await register(wpage, witness));
      await wctx.close();
      const globalBefore = (await admin('GET', '/api/admin/security/responses')).mode;

      const actx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, locale: 'fr-BE' });
      const page = await actx.newPage();
      page.on('pageerror', e => errors.push(`admin: ${e.message}`));
      await page.goto(`${BASE}/admin/`);
      await page.fill('#secret-input', ADMIN);
      await page.click('#secret-btn');
      await page.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
      await admOpenTab(page, 'security');
      await page.waitForFunction(() => document.getElementById('sec-top-mode-value').textContent !== '…');

      const top = await page.evaluate(() => {
        const r = id => document.getElementById(id).getBoundingClientRect();
        return { mode: document.getElementById('sec-top-mode-value').textContent, help: document.getElementById('sec-top-mode-help').textContent,
          btnBottom: r('btn-sec-start-test').bottom, vh: innerHeight, settingsOpen: document.getElementById('sec-settings').open,
          diagOpen: document.getElementById('sec-diag').open, overflow: document.documentElement.scrollWidth > innerWidth + 1,
          journalVisible: document.getElementById('sec-events-body').checkVisibility() };
      });
      check(tag, 'carte état : Observation = aucune vérification imposée', top.mode === 'Observation' && /Aucune vérification imposée/.test(top.help), top.mode);
      check(tag, 'bouton « Tester la protection » visible sans défiler (après ouverture de l\'onglet)', top.btnBottom <= top.vh + 400, `${Math.round(top.btnBottom)} / ${top.vh}`);
      check(tag, 'réglages et diagnostic repliés, journal masqué', !top.settingsOpen && !top.diagOpen && !top.journalVisible, JSON.stringify(top));
      check(tag, 'aucun débordement horizontal', !top.overflow);
      await page.screenshot({ path: path.join(OUT, `87-${short}-1-onglet.png`) });

      // Étape 1 : choisir le compte
      await page.click('#btn-sec-start-test');
      await page.fill('#sec-test-q', user);
      await page.click('#sec-test-form button[type="submit"]');
      await page.waitForFunction(() => document.getElementById('sec-step-1').classList.contains('is-done'));
      const s1 = await stepState(page, 1);
      check(tag, 'étape 1 : compte choisi, « Peut miner normalement »', /Compte choisi/.test(s1.text) && /Peut miner normalement/.test(s1.text), s1.text);
      check(tag, 'étape 2 courante, défi indisponible', (await stepState(page, 2)).current && await page.isDisabled('#btn-sec-test-challenge'));

      // Étape 2 : essai (confirmation : annuler d'abord = rien ne change)
      await page.click('#btn-sec-test-start');
      await page.waitForSelector('#adm-confirm[open]', { timeout: 5000 });
      await page.click('#adm-confirm-no');
      await sleep(400);
      let f = await admin('GET', `/api/admin/security/player?q=${user}`);
      check(tag, 'confirmation annulée : aucun essai lancé (clic accidentel)', f.lotC.testEnforce === false);
      await page.click('#btn-sec-test-start');
      await page.waitForSelector('#adm-confirm[open]');
      check(tag, 'confirmation : « Lancer l\'essai »', /Lancer l'essai/.test(await page.textContent('#adm-confirm-yes')));
      await page.click('#adm-confirm-yes');
      await page.waitForFunction(() => document.getElementById('sec-step-2').classList.contains('is-done'));
      check(tag, 'étape 2 : essai actif sur ce compte seulement', /Essai actif/.test((await stepState(page, 2)).text));

      // F5 au milieu du parcours : compte et étape retrouvés
      await page.reload();
      await page.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
      await admOpenTab(page, 'security');
      await page.waitForFunction(() => document.getElementById('sec-step-2').classList.contains('is-done'), null, { timeout: 10000 });
      check(tag, 'F5 : compte et étape retrouvés', await page.inputValue('#sec-test-q') === user && (await stepState(page, 3)).current);

      // Étape 3 : défi — double clic rapide = un seul défi
      await page.dblclick('#btn-sec-test-challenge');
      await page.waitForFunction(() => document.getElementById('sec-step-3').classList.contains('is-done'));
      await sleep(500);
      f = await admin('GET', `/api/admin/security/player?q=${user}`);
      check(tag, 'étape 3 : un seul défi malgré le double clic', f.lotC.history.challenges.filter(c => c.status === 'pending').length === 1 && f.lotC.history.challenges.length === 1, `${f.lotC.history.challenges.length}`);
      const s4a = await stepState(page, 4);
      check(tag, 'étape 4 : « pas encore affichée » tant que le joueur n\'a pas rouvert le jeu', s4a.current && /Vérification prête/.test(s4a.text), s4a.text);
      await page.screenshot({ path: path.join(OUT, `87-${short}-2-parcours.png`), fullPage: true });

      // Jeu : le joueur voit la vérification, la résout
      await openGame(game);
      await game.waitForSelector('#antibot-modal:not([hidden])', { timeout: 15000 });
      await game.waitForSelector('.antibot-tile');
      await sleep(800);
      await page.click('#btn-sec-test-check');
      await page.waitForFunction(() => /Vérification affichée depuis/.test(document.getElementById('sec-step-4-state').textContent), null, { timeout: 8000 });
      check(tag, 'étape 4 : « affichée dans le jeu » après ouverture par le joueur', true);
      await solveGrid(game);
      await game.waitForSelector('#antibot-modal', { state: 'hidden', timeout: 8000 });
      await page.click('#btn-sec-test-check');
      await page.waitForFunction(() => document.getElementById('sec-step-4').classList.contains('is-done'), null, { timeout: 8000 });
      check(tag, 'étape 4 : résolue, peut miner normalement', /Résolue/.test((await stepState(page, 4)).text));

      // Fiche joueur : statut et action principale en haut
      await page.fill('#sec-player-q', user);
      await page.click('#sec-player-form button[type="submit"]');
      await page.waitForSelector('#sec-player-dialog[open] #sec-fiche-head');
      const head = await page.evaluate(() => {
        const h = document.getElementById('sec-fiche-head');
        return { status: h.querySelector('.sec-fiche-status').textContent, btn: h.querySelector('[data-adm-key="sec-fiche-test"]')?.textContent ?? '',
          headTop: h.getBoundingClientRect().top, cardsBottom: document.querySelector('#sec-pane-essential .sec-cards').getBoundingClientRect().bottom, vh: innerHeight,
          lotcInEss: !!document.querySelector('#sec-pane-essential #sec-lotc'), lotcInAdv: !!document.querySelector('#sec-pane-advanced details[data-sec="lotc"] #sec-lotc'),
          overflow: document.getElementById('sec-player-dialog').scrollWidth > document.getElementById('sec-player-dialog').clientWidth + 1 };
      });
      check(tag, 'fiche : statut « Peut miner normalement » + action « Tester la protection sur ce compte »', head.status === 'Peut miner normalement' && /Tester la protection sur ce compte/.test(head.btn), head.status);
      check(tag, 'fiche : mesures techniques dans le diagnostic avancé', !head.lotcInEss && head.lotcInAdv);
      check(tag, 'fiche : pas de débordement horizontal', !head.overflow);
      await page.screenshot({ path: path.join(OUT, `87-${short}-3-fiche.png`) });
      await page.click('#sec-player-dialog [data-close]');

      // Étape 5 : terminer
      await page.click('#btn-sec-test-end');
      await page.waitForFunction(() => /Test terminé/.test(document.getElementById('sec-step-5-state').textContent), null, { timeout: 8000 });
      f = await admin('GET', `/api/admin/security/player?q=${user}`);
      const resp = await admin('GET', '/api/admin/security/responses');
      const w = await admin('GET', `/api/admin/security/player?q=${witness}`);
      check(tag, 'étape 5 : essai arrêté, état normal, palier 0', f.lotC.testEnforce === false && f.lotC.state === 'normal' && f.lotC.violationLevel === 0 && f.lotC.mode === globalBefore);
      check(tag, 'mode global inchangé (Observation) et affiché', resp.mode === globalBefore && globalBefore === 'observe' && /Protection des autres joueurs inchangée \(Observation\)/.test((await stepState(page, 5)).text));
      check(tag, 'autre compte jamais concerné', w.lotC.testEnforce === false && w.lotC.history.challenges.length === 0 && w.lotC.mode === 'observe');
      await page.screenshot({ path: path.join(OUT, `87-${short}-4-termine.png`), fullPage: true });

      // Minage normal après remise en état
      await game.reload();
      const pick = await game.$('.lang-pick-btn[data-lang="fr"]');
      if (pick && await pick.isVisible()) await pick.click();
      await game.waitForSelector('#block');
      await sleep(1000);
      const hidden = !(await game.$('#antibot-modal:not([hidden])'));
      const before = await game.evaluate(() => GameState.seasonStats.manualClicks);
      await game.click('#block', { force: true });
      await sleep(250);
      check(tag, 'jeu : aucune vérification, minage manuel normal', hidden && await game.evaluate(() => GameState.seasonStats.manualClicks) > before);

      // Diagnostic : ouverture, audit séparé et chargé à la demande, lignes limitées
      await page.click('#sec-diag > summary');
      await page.click('#sec-audit-card > summary');
      await page.waitForFunction(() => /entrée\(s\) d'audit/.test(document.getElementById('sec-audit-total').textContent));
      const diag = await page.evaluate(() => ({ sel: document.getElementById('sec-filter-type').value,
        evRows: document.querySelectorAll('#sec-events-body tr').length, audit: document.getElementById('sec-audit-total').textContent }));
      check(tag, 'diagnostic : journal = anomalies joueurs par défaut (≤ 25 lignes), audit admin à part', diag.sel === 'group:player' && diag.evRows <= 26, JSON.stringify(diag));
      check(tag, 'aucune erreur JavaScript', errors.length === 0, errors.join(' | '));
      await actx.close();
      await gctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
