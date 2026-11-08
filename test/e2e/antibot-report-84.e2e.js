/**
 * Essai navigateur #84 (décision du propriétaire du 08/11 : compétition entre collègues avec petits
 * lots, « informer les collègues de la possibilité de signaler les erreurs ») : dans la fenêtre
 * anti-bot, bouton « 🐞 Signaler une erreur » quand les signalements de la bêta sont actifs.
 *  - défi émis par l'admin → bouton visible → formulaire de la bêta pré-rempli (défi), fermeture
 *    sans confirmation si rien n'a été écrit ;
 *  - suspension active → bouton visible → texte pré-rempli avec l'heure de fin ;
 *  - signalements désactivés dans l'admin → bouton masqué.
 * Ordinateur 1280×900 et smartphone 390×844. Hors `npm test` (navigateur requis), base de test neuve.
 * La suspension est écrite directement dans la base de TEST (SQLITE=<chemin>), jamais en production.
 *
 * Lancer :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret de test> SQLITE=<worktree>/server/data/test-84.sqlite OUT=/tmp/dossier \
 *   node test/e2e/antibot-report-84.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp', SQLITE = process.env.SQLITE;
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log('✓', ...a);
const errors = [];

assert.ok(SQLITE && !SQLITE.startsWith('/home/ubuntu/Dig/'), 'SQLITE doit viser une base de test');

async function admin(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  assert.ok(res.ok, `${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function openGame(p) {
  await p.goto(BASE + '/?lang=fr');
  const pick = await p.$('.lang-pick-btn[data-lang="fr"]');
  if (pick && await pick.isVisible()) await pick.click();
  await p.waitForSelector('#antibot-modal:not([hidden])', { timeout: 15000 });
}

(async () => {
  await admin('PUT', '/api/admin/beta/settings', { bannerEnabled: true, reportsEnabled: true });
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const mobile = w < 600, tag = `${w}`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile, locale: 'fr-BE' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await p.goto(BASE + '/');
    const user = `ab84_${w}_${Date.now() % 100000}`;
    const reg = await p.evaluate(async u => {
      const r = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: 'motdepasse84', email: `${u}@example.com` }) });
      return { ok: r.ok, body: await r.text() };
    }, user);
    assert.ok(reg.ok, reg.body);
    const uid = (await admin('GET', `/api/admin/security/player?q=${user}`)).player.userId;

    // 1. Défi : bouton visible, formulaire pré-rempli, fermeture directe
    await admin('POST', `/api/admin/security/player/${uid}/challenge`, {});
    await openGame(p);
    await p.waitForSelector('#antibot-report:not([hidden])');
    assert.strictEqual((await p.textContent('#antibot-report')).trim(), '🐞 Signaler une erreur');
    const btn = await p.$eval('#antibot-report', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, h: r.height }; });
    assert.ok(btn.l >= 0 && btn.r <= w && btn.h >= 44, `bouton dans l'écran et ≥ 44 px (${JSON.stringify(btn)})`);
    await p.screenshot({ path: `${OUT}/84r-${tag}-1-defi.png` });
    await p.click('#antibot-report');
    await p.waitForSelector('#beta-report-modal');
    assert.ok(await p.$eval('#antibot-modal', e => e.hidden), 'fenêtre anti-bot fermée');
    assert.match(await p.inputValue('#beta-step'), /Vérification anti-bot affichée/);
    await p.screenshot({ path: `${OUT}/84r-${tag}-2-formulaire-defi.png` });
    await p.click('#btn-beta-cancel');
    assert.strictEqual(await p.$('#beta-report-modal'), null, 'fermeture sans confirmation');
    log(`${tag} : défi → « Signaler une erreur » → formulaire pré-rempli, fermé sans confirmation`);

    // 2. Suspension active (écrite dans la base de test)
    const now = Date.now();
    execFileSync('sqlite3', [SQLITE, `UPDATE antibot_challenges SET status='cancelled' WHERE user_id=${uid} AND status = 'pending';
      INSERT INTO antibot_suspensions (user_id, level, starts_ms, ends_ms, status, origin, reason)
      VALUES (${uid}, 1, ${now}, ${now + 30 * 60_000}, 'active', 'auto', 'essai #84');`]);
    await openGame(p);
    await p.waitForFunction(() => /Minage manuel en pause/.test(document.getElementById('antibot-title').textContent), null, { timeout: 15000 });
    await p.waitForSelector('#antibot-report:not([hidden])');
    await p.screenshot({ path: `${OUT}/84r-${tag}-3-suspension.png` });
    await p.click('#antibot-report');
    await p.waitForSelector('#beta-report-modal');
    const step = await p.inputValue('#beta-step');
    assert.match(step, /Minage manuel suspendu par l'anti-bot jusqu'au .+, alors que je jouais normalement/);
    assert.doesNotMatch(step, /\{time\}/);
    await p.screenshot({ path: `${OUT}/84r-${tag}-4-formulaire-suspension.png` });
    await p.click('#btn-beta-cancel');
    log(`${tag} : suspension → formulaire pré-rempli « ${step} »`);

    // 3. Signalements coupés dans l'admin : bouton masqué
    await admin('PUT', '/api/admin/beta/settings', { reportsEnabled: false });
    await openGame(p);
    assert.ok(await p.$eval('#antibot-report', e => e.hidden), 'bouton masqué sans signalements');
    await admin('PUT', '/api/admin/beta/settings', { reportsEnabled: true });
    log(`${tag} : signalements désactivés → bouton masqué`);
    await ctx.close();
  }
  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JS');
  console.log('TOUT OK');
})().catch(err => { console.error('ÉCHEC', err); process.exit(1); });
