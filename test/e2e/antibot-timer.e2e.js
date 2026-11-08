/**
 * Essai navigateur du chrono de la vérification (#25, demande du propriétaire du 08/11) : mode
 * global Appliqué (décision du 08/11), chrono réduit à 10 s pour l'essai, défi émis par l'admin →
 * « Vérification : encore 00:10 », temps écoulé → énigme désactivée + « Le temps est écoulé »,
 * aucune suspension ; « Autre énigme » → chrono complet ; fermer/rouvrir après expiration →
 * nouvelle énigme ; résolution → minage repris ; arrêt d'urgence visible dans l'admin.
 * Ordinateur 1280×900 et smartphone 390×844. Hors `npm test` (navigateur requis), base neuve.
 *
 * Lancer :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/dossier node test/e2e/antibot-timer.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log('✓', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

async function admin(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  assert.ok(res.ok, `${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function solveGrid(p) {
  const q = await p.textContent('.antibot-question');
  const tiles = await p.$$eval('.antibot-tile', els => els.map(e => e.getAttribute('aria-label')));
  const order = tiles.map((label, i) => ({ i, at: q.indexOf(label) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at);
  assert.strictEqual(order.length, 2, `consigne « ${q} »`);
  await sleep(1300);
  for (const { i } of order) await p.click(`.antibot-tile >> nth=${i}`);
}

(async () => {
  const resp = await admin('GET', '/api/admin/security/responses');
  assert.strictEqual(resp.mode, 'enforce', 'décision du 08/11 : Appliqué pour tous');
  await admin('PUT', '/api/admin/config', { key: 'ab_puzzle_seconds', value: '10' });
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const mobile = w < 600, tag = `${w}`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile, locale: 'fr-BE' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await p.goto(BASE + '/');
    const user = `abt_${w}_${Date.now() % 100000}`;
    const reg = await p.evaluate(async u => {
      const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'motdepasse25', email: `${u}@example.com` }) });
      return { ok: r.ok, body: await r.text() };
    }, user);
    assert.ok(reg.ok, reg.body);
    const fiche = await admin('GET', `/api/admin/security/player?q=${user}`);
    const uid = fiche.player.userId;
    assert.strictEqual(fiche.lotC.mode, 'enforce', 'compte ordinaire : Appliqué');
    await admin('POST', `/api/admin/security/player/${uid}/challenge`, {});

    await p.goto(BASE + '/?lang=fr');
    const pick = await p.$('.lang-pick-btn[data-lang="fr"]');
    if (pick && await pick.isVisible()) await pick.click();
    await p.waitForSelector('#antibot-modal:not([hidden])', { timeout: 15000 });
    await p.waitForSelector('.antibot-tile');
    const t0 = await p.textContent('#antibot-timer-txt');
    assert.match(t0, /Vérification : encore 00:(10|09)/, t0);
    const box = await p.$eval('#antibot-inner', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    assert.ok(box.l >= 0 && box.r <= w, 'fenêtre dans l\'écran');
    await p.screenshot({ path: `${OUT}/25t-${tag}-1-chrono.png` });
    log(`${tag} : chrono affiché « ${t0} »`);

    // Temps écoulé : énigme désactivée, message, aucune sanction
    await p.waitForFunction(() => /Le temps est écoulé/.test(document.getElementById('antibot-msg').textContent), null, { timeout: 15000 });
    assert.ok(await p.$eval('.antibot-tile', e => e.disabled), 'tuiles désactivées');
    assert.match(await p.textContent('#antibot-timer-txt'), /00:00/);
    await p.screenshot({ path: `${OUT}/25t-${tag}-2-expire.png` });
    let f = await admin('GET', `/api/admin/security/player?q=${user}`);
    assert.strictEqual(f.lotC.suspension, null, 'aucune suspension pour un temps écoulé');
    assert.strictEqual(f.lotC.violationLevel, 0);
    log(`${tag} : temps écoulé → énigme désactivée, « Le temps est écoulé », aucune suspension`);

    // Autre énigme : chrono complet, puis fermeture / attente / réouverture → nouvelle énigme
    await p.click('#antibot-new');
    await p.waitForFunction(() => /00:(10|09)/.test(document.getElementById('antibot-timer-txt').textContent));
    assert.ok(!(await p.$eval('.antibot-tile', e => e.disabled)));
    log(`${tag} : « Autre énigme » → chrono complet`);
    await p.click('#antibot-close');
    await sleep(11_000);
    await p.click('#block', { force: true });
    await p.waitForSelector('#antibot-modal:not([hidden])');
    await p.waitForFunction(() => /00:(10|09)/.test(document.getElementById('antibot-timer-txt').textContent), null, { timeout: 8000 });
    log(`${tag} : rouverte après expiration → nouvelle énigme, chrono complet`);

    await solveGrid(p);
    await p.waitForSelector('#antibot-modal', { state: 'hidden', timeout: 8000 });
    f = await admin('GET', `/api/admin/security/player?q=${user}`);
    assert.strictEqual(f.lotC.state, 'normal');
    // Le serveur ne compte « expirée » qu'après sa marge réseau (+5 s) : un renouvellement plus tôt n'en est pas une
    assert.strictEqual(f.lotC.history.challenges[0].status, 'solved');
    assert.strictEqual(f.lotC.suspension, null);
    log(`${tag} : résolue → état normal, aucune suspension`);
    await ctx.close();
  }

  // Admin : arrêt d'urgence visible en Appliqué, immédiat, retour Observation, puis remise en Appliqué
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'fr-BE' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`admin: ${e.message}`));
  await p.goto(BASE + '/admin/');
  await p.fill('#secret-input', ADMIN);
  await p.click('#secret-btn');
  await p.waitForSelector('.tab-btn[data-tab="security"]', { state: 'attached' });
  await admOpenTab(p, 'security');
  await p.waitForSelector('#btn-sec-emergency', { state: 'visible', timeout: 15000 });
  await p.screenshot({ path: `${OUT}/25t-admin-1-urgence.png` });
  await p.click('#btn-sec-emergency');
  await p.waitForSelector('#btn-sec-emergency', { state: 'hidden', timeout: 8000 });
  assert.strictEqual((await admin('GET', '/api/admin/security/responses')).mode, 'observe');
  log('admin : arrêt d\'urgence visible, un clic → Observation');
  await admin('PUT', '/api/admin/config', { key: 'antibot_response_mode', value: 'enforce' });
  await admin('PUT', '/api/admin/config', { key: 'ab_puzzle_seconds', value: '30' });
  await ctx.close();
  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JavaScript');
  console.log('TOUT OK');
})().catch(e => { console.error('ÉCHEC', e); process.exit(1); });
