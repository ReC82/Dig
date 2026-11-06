/**
 * Essai navigateur de la première minute d'un collègue invité (#84) : lien d'invitation en navigation
 * privée → langue → inscription validée par Entrée (erreur claire puis succès) → retour direct au
 * bloc, message « Compte créé ! Touche le bloc pour creuser. » et carte « Première partie ? » ;
 * vocabulaire français unique (Pièces, PV) ; « Doubler la récompense » annonce une pub simulée
 * (plus de fausse « DIG! — Edition Pro »). Ordinateur 1280×900, smartphones 390×844 et 320×640.
 * Hors `npm test` (navigateur requis). Serveur de test en mode invitation, base neuve.
 *
 * Lancer :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/dossier node test/e2e/beta-first-minute.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log('✓', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  assert.ok(res.ok, `${method} ${path} → ${res.status}`);
  return res.json();
}

(async () => {
  await api('PUT', '/api/admin/beta/settings', { registrationMode: 'invite', bannerEnabled: true, reportsEnabled: true });
  const { invites } = await api('POST', '/api/admin/beta/invites', { label: 'e2e-84', count: 3 });
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const sizes = [[1280, 900], [390, 844], [320, 640]];

  for (const [i, [w, h]] of sizes.entries()) {
    const mobile = w < 600, tag = `${w}`;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: mobile, isMobile: mobile });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await p.goto(`${BASE}/?invite=${invites[i].code}`);
    await p.click('.lang-pick-btn[data-lang="fr"]');
    await p.waitForSelector('#acc-username');
    assert.match(await p.textContent('#view-settings'), /Tu es invité·e à la bêta/);

    // Erreur claire, saisie conservée, puis succès — chaque fois avec Entrée
    const user = `coll84_${w}`;
    await p.fill('#acc-username', user);
    await p.fill('#acc-email', `${user}@example.com`);
    await p.fill('#acc-password', '123');
    await p.press('#acc-password', 'Enter');
    await p.waitForFunction(() => /6 caractères/.test(document.getElementById('acc-error')?.textContent || ''));
    assert.strictEqual(await p.inputValue('#acc-username'), user, 'pseudo conservé après erreur');
    await p.fill('#acc-password', 'motdepasse84');
    await p.press('#acc-password', 'Enter');

    // Retour direct au bloc, message court, tutoriel proposé
    await p.waitForFunction(() => !document.getElementById('view-dig').classList.contains('hidden'), null, { timeout: 8000 });
    await p.waitForSelector('.float-text.achievement');
    assert.match(await p.textContent('.float-text.achievement'), /Compte créé ! Touche le bloc pour creuser\./);
    const toast = await p.$eval('.float-text.achievement', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    assert.ok(toast.l >= 0 && toast.r <= w, `message dans l'écran (${toast.l}–${toast.r} / ${w})`);
    await p.waitForSelector('#tuto-card', { timeout: 8000 });
    assert.match(await p.textContent('#tuto-card'), /Première partie \?/);
    await p.screenshot({ path: `${OUT}/84-${tag}-1-after-register.png` });
    log(`${tag} : inscription par lien (Entrée), erreur claire, retour au bloc + message + tutoriel proposé`);

    // Vocabulaire : Pièces / PV, comme dans l'aide
    assert.strictEqual((await p.textContent('[data-i18n="stats.coins"]')).trim(), 'Pièces');
    assert.match(await p.textContent('#hp-text'), /\d+\s*\/\s*\d+\s*PV$/);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.strictEqual(overflow, false, 'aucun débordement horizontal');
    log(`${tag} : « Pièces » et « PV » affichés, aucun débordement`);

    // Pub simulée honnête
    await p.click('#tuto-card button:has-text("Passer")');
    await p.click('#btn-bonus-boost');
    await p.waitForSelector('#bonus-modal:not([hidden])');
    const ad = await p.textContent('#bonus-modal');
    assert.doesNotMatch(ad, /Edition Pro/);
    assert.match(ad, /Bonus ×2 pendant 2 min/);
    assert.match(ad, /pub simulée, aucune vraie publicité/);
    await p.screenshot({ path: `${OUT}/84-${tag}-2-simulated-ad.png` });
    await p.click('#btn-skip-bonus');
    await sleep(300);
    log(`${tag} : « Doubler la récompense » annonce une pub simulée, sans faux produit`);
    await ctx.close();
  }

  // La connexion d'un compte existant ne change pas de vue (Paramètres reste ouvert)
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { if (!localStorage.getItem('dig_lang')) localStorage.setItem('dig_lang', 'fr'); });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`login: ${e.message}`));
  await p.goto(`${BASE}/`);
  await p.click('#btn-settings');
  await p.fill('#acc-username', 'coll84_1280');
  await p.fill('#acc-password', 'motdepasse84');
  await p.press('#acc-password', 'Enter');
  await p.waitForFunction(() => /coll84_1280/.test(document.getElementById('view-settings').textContent));
  assert.strictEqual(await p.isVisible('#view-settings'), true);
  log('connexion d\'un compte existant : reste sur Paramètres (inchangé)');

  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JavaScript');
  log('aucune erreur JavaScript');
})().catch(e => { console.error('✗', e); process.exit(1); });
