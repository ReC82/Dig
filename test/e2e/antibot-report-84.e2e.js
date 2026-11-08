/**
 * Essai navigateur #84 (décision du propriétaire du 08/11 : compétition entre collègues avec petits
 * lots, « informer les collègues de la possibilité de signaler les erreurs ») : dans la fenêtre
 * anti-bot, bouton « 🐞 Signaler une erreur » quand les signalements de la bêta sont actifs.
 *  - défi émis par l'admin → bouton visible → formulaire de la bêta pré-rempli (défi), fermeture
 *    sans confirmation si rien n'a été écrit ;
 *  - suspension active → bouton visible → texte pré-rempli avec l'heure de fin ;
 *  - signalements désactivés dans l'admin → bouton masqué ;
 *  - recette #84-E (08/11) : formulaire fermé sans envoi → la vérification revient seule ; envoi
 *    après expiration de l'énigme → bouton « 🛡️ Reprendre la vérification » → nouvelle énigme au
 *    chrono complet (jamais 00:00) ; côté serveur, défi toujours en attente et 0 bloc / 0 clic
 *    manuel compté malgré des coups sur le bloc ; F5 → la vérification revient ; un seul signalement.
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
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
    await p.waitForSelector('#antibot-modal:not([hidden])', { timeout: 3000 });
    log(`${tag} : défi → « Signaler une erreur » → formulaire pré-rempli, fermé sans confirmation, vérification revenue seule`);

    // 1 bis. #84-E : envoi après expiration de l'énigme, retour explicite, aucun gain côté serveur
    const state = async () => (await admin('GET', `/api/admin/security/player?q=${user}`)).lotC.state;
    // Relevé serveur (base de TEST) : sauvegarde (pièces, profondeur, blocs, charges) et classement
    const snap = () => execFileSync('sqlite3', [SQLITE, `SELECT json_object('coins', json_extract(data, '$.coins'),
      'depth', json_extract(data, '$.depth'), 'blocks', json_extract(data, '$.stats.blocksDestroyed'),
      'charges', json_extract(data, '$.pickaxe.charges'),
      'ranking', (SELECT json_array(manual_blocks, effective_manual_blocks, manual_clicks, max_depth) FROM season_rankings WHERE user_id = ${uid}))
      FROM user_saves WHERE user_id = ${uid};`]).toString().trim();
    assert.strictEqual(await state(), 'challenge', 'défi en attente avant le signalement');
    const before = snap();
    const nReports = async () => (await admin('GET', '/api/admin/beta/reports')).reports.filter(r => r.username === user).length;
    const reportsBefore = await nReports();
    await p.click('#antibot-report');
    await p.fill('#beta-observed', 'Faux positif : je minais normalement (essai #84-E).');
    await sleep(31_000);   // l'énigme de 30 s expire pendant la rédaction
    await p.click('#btn-beta-send');
    await p.waitForFunction(() => /is-ok/.test(document.getElementById('beta-report-msg').className));
    assert.strictEqual((await p.textContent('#btn-beta-cancel')).trim(), '🛡️ Reprendre la vérification');
    await p.screenshot({ path: `${OUT}/84r-${tag}-5-envoye-reprendre.png` });
    await p.click('#btn-beta-cancel');
    await p.waitForSelector('#antibot-modal:not([hidden])', { timeout: 3000 });
    await p.waitForFunction(() => { const s = document.getElementById('antibot-timer-txt').textContent.match(/(\d\d):(\d\d)/); return s && +s[1] * 60 + +s[2] >= 25; }, null, { timeout: 5000 });
    assert.strictEqual((await p.textContent('#antibot-msg')).trim(), '', 'pas de « temps écoulé » au retour');
    assert.ok(await p.$$eval('.antibot-tile', b => b.length > 0 && b.every(x => !x.disabled)), 'énigme jouable');
    await p.screenshot({ path: `${OUT}/84r-${tag}-6-retour-verification.png` });
    // Coups sur le bloc pendant le défi (fenêtre fermée) : rien n'est compté par le serveur
    await p.click('#antibot-close');
    for (let i = 0; i < 12; i++) {
      if (await p.$eval('#antibot-modal', e => !e.hidden)) await p.click('#antibot-close');
      await p.click('#block', { force: true });
    }
    await sleep(12_000);
    await p.reload();
    await p.waitForSelector('#antibot-modal:not([hidden])', { timeout: 15000 });
    assert.strictEqual(await state(), 'challenge', 'défi toujours en attente après le signalement');
    const after = snap();
    assert.strictEqual(after, before, 'aucun bloc, clic, pièce, profondeur ni charge crédité pendant le défi');
    assert.strictEqual(await nReports(), reportsBefore + 1, 'signalement enregistré une seule fois');
    log(`${tag} : #84-E envoi → « Reprendre la vérification » → nouvelle énigme (chrono ≥ 25 s), serveur : défi en attente, relevé inchangé ${after}, F5 → vérification, 1 signalement`);

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
    await p.waitForFunction(() => !document.getElementById('antibot-modal').hidden && /Minage manuel en pause/.test(document.getElementById('antibot-title').textContent), null, { timeout: 3000 });
    log(`${tag} : suspension → formulaire pré-rempli « ${step} », fenêtre de suspension revenue à la fermeture`);

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
