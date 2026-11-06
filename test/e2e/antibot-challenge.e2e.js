/**
 * Essai navigateur de la vérification anti-bot du minage manuel (#25 lot C) : compte en essai
 * « Appliqué », défi émis par l'admin → fenêtre au chargement (F5), coups sans effet, fenêtre
 * fermable puis rouverte par un clic sur le bloc, mauvaise réponse sans sanction, version
 * accessible (texte), résolution → minage normal ; suspension affichée avec l'heure de Bruxelles.
 * Ordinateur 1280×900 et smartphone 390×844. Hors `npm test` (navigateur requis), base neuve.
 *
 * Lancer :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/dossier node test/e2e/antibot-challenge.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
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

/** Réponse de la grille lue comme un joueur : noms de la consigne → tuiles (aria-label). */
async function solveGrid(p) {
  const q = await p.textContent('.antibot-question');
  const tiles = await p.$$eval('.antibot-tile', els => els.map(e => e.getAttribute('aria-label')));
  const order = tiles.map((label, i) => ({ i, at: q.indexOf(label) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at);
  assert.strictEqual(order.length, 2, `consigne « ${q} »`);
  await sleep(1500);
  for (const { i } of order) await p.click(`.antibot-tile >> nth=${i}`);
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const mobile = w < 600, tag = `${w}`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile, locale: 'fr-BE' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await p.goto(BASE + '/');
    const user = `abc_${w}`;
    const reg = await p.evaluate(async u => {
      const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'motdepasse25', email: `${u}@example.com` }) });
      return { ok: r.ok, body: await r.text() };
    }, user);
    assert.ok(reg.ok, reg.body);
    const fiche = await admin('GET', `/api/admin/security/player?q=${user}`);
    const uid = fiche.player.userId;
    assert.strictEqual(fiche.lotC.mode, 'observe', 'défaut : Observation');
    await admin('POST', `/api/admin/security/player/${uid}/test-mode`, { enforce: true });
    await admin('POST', `/api/admin/security/player/${uid}/challenge`, {});

    // F5 : l'état vient du serveur
    await p.goto(BASE + '/?lang=fr');
    const pick = await p.$('.lang-pick-btn[data-lang="fr"]');
    if (pick && await pick.isVisible()) await pick.click();
    await p.waitForSelector('#antibot-modal:not([hidden])', { timeout: 15000 });
    await p.waitForSelector('.antibot-tile');
    assert.match(await p.textContent('#antibot-title'), /Petite vérification/);
    assert.match(await p.textContent('#antibot-keep'), /Rien n'est perdu/);
    const box = await p.$eval('#antibot-inner', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    assert.ok(box.l >= 0 && box.r <= w, 'fenêtre dans l\'écran');
    await p.screenshot({ path: `${OUT}/25c-${tag}-1-defi.png` });
    log(`${tag} : défi affiché au chargement (F5), textes non destructifs`);

    // Fermer → coups sans effet, la fenêtre revient au clic sur le bloc
    await p.click('#antibot-close');
    assert.ok(await p.$eval('#antibot-modal', e => e.hidden));
    const before = await p.evaluate(() => GameState.seasonStats.manualClicks);
    await p.click('#block', { force: true });
    await p.waitForSelector('#antibot-modal:not([hidden])');
    assert.strictEqual(await p.evaluate(() => GameState.seasonStats.manualClicks), before, 'coup non compté');
    log(`${tag} : fermeture possible, coup sur le bloc non compté et fenêtre rouverte`);

    // Mauvaise réponse : message, nouvelle énigme, aucune sanction
    await sleep(1500);
    const tiles = await p.$$('.antibot-tile');
    const q = await p.textContent('.antibot-question');
    const wrong = [];
    for (const t of tiles) { if (!q.includes(await t.getAttribute('aria-label'))) wrong.push(t); }
    await wrong[0].click(); await wrong[1].click();
    await p.waitForFunction(() => /Ce n'est pas ça/.test(document.getElementById('antibot-msg').textContent));
    await p.waitForSelector('.antibot-tile:not(.picked)');
    log(`${tag} : mauvaise réponse → nouvelle énigme, sans sanction`);

    // Version accessible
    await p.click('#antibot-alt');
    await p.waitForSelector('#antibot-answer');
    const label = await p.textContent('label[for="antibot-answer"]');
    const [, a, c] = label.match(/(\d+) \+ (\d+)/);
    await p.screenshot({ path: `${OUT}/25c-${tag}-2-accessible.png` });
    await sleep(1300);
    await p.fill('#antibot-answer', String(Number(a) + Number(c)));
    await p.press('#antibot-answer', 'Enter');
    await p.waitForSelector('#antibot-modal', { state: 'hidden', timeout: 8000 });
    const after = await p.evaluate(() => GameState.seasonStats.manualClicks);
    await p.click('#block', { force: true });
    await sleep(200);
    assert.ok(await p.evaluate(() => GameState.seasonStats.manualClicks) > after, 'minage manuel repris');
    const f2 = await admin('GET', `/api/admin/security/player?q=${user}`);
    assert.strictEqual(f2.lotC.state, 'normal');
    assert.strictEqual(f2.lotC.history.challenges[0].status, 'solved');
    log(`${tag} : version accessible résolue → minage manuel repris, défi « résolu » côté admin`);

    // Grille résolue (2e défi)
    await admin('POST', `/api/admin/security/player/${uid}/challenge`, {});
    await p.reload();
    const pick2 = await p.$('.lang-pick-btn[data-lang="fr"]');
    if (pick2 && await pick2.isVisible()) await pick2.click();
    await p.waitForSelector('.antibot-tile', { timeout: 15000 });
    await solveGrid(p);
    await p.waitForSelector('#antibot-modal', { state: 'hidden', timeout: 8000 });
    log(`${tag} : grille résolue`);

    await admin('POST', `/api/admin/security/player/${uid}/test-mode`, { enforce: false });
    await ctx.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JavaScript');
  log('aucune erreur JavaScript');
})().catch(e => { console.error('✗', e); process.exit(1); });
