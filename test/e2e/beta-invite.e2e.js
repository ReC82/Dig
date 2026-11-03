/**
 * Essai navigateur de la bêta fermée (#57, recette du propriétaire du 03/11) : tableau de bord sans
 * configuration, configuration guidée (aperçu + toast), « Inviter un testeur » en 2 clics, invité en
 * navigation privée (mobile) sans code à saisir, lien déjà utilisé, refus sans lien, mode fermé.
 * Hors `npm test` (navigateur requis). Base de test neuve exigée.
 *
 * Lancer (serveur de test déjà démarré sur une base vide) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/dossier node test/e2e/beta-invite.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log('✓', ...a);
const errors = [];

async function adminPage(b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`admin: ${e.message}`));
  await p.goto(`${BASE}/admin/`);
  await p.fill('#secret-input', ADMIN);
  await p.click('#secret-btn');
  await p.click('.tab-btn[data-tab="beta"]');
  await p.waitForSelector('#beta-stats li');
  return p;
}

async function player(b, url, w, h, tag) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });   // contexte neuf = navigation privée
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
  await p.goto(url);
  await p.click('.lang-pick-btn[data-lang="fr"]');   // premier lancement : choix de la langue
  return p;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });

  // 1. Vue admin sans configuration
  let a = await adminPage(b, 1280, 900);
  const state = await a.textContent('#beta-state');
  assert.match(state, /^Inscriptions ouvertes à tous/);
  assert.match(await a.textContent('#beta-warnings'), /Tout le monde peut encore créer un compte/);
  assert.strictEqual(await a.$eval('#beta-advanced', d => d.open), false, 'avancé replié');
  assert.strictEqual(await a.isVisible('#beta-inv-wave'), false, 'aucun champ technique visible au chargement');
  await a.screenshot({ path: `${OUT}/after-1-dashboard-desktop.png`, fullPage: true });
  log('tableau de bord sans configuration : état enregistré, avertissement, rien de technique visible');

  // 2. Configurer : brouillon ≠ enregistré, aperçu, toast
  await a.click('#btn-beta-config-open');
  await a.waitForSelector('#beta-config-dialog[open]');
  assert.match(await a.textContent('#beta-config-diff'), /Rien/);
  assert.strictEqual(await a.isDisabled('#btn-beta-settings'), true);
  await a.click('#btn-beta-recommended');
  const diff = await a.textContent('#beta-config-diff');
  assert.match(diff, /tout le monde → seulement les invités/);
  assert.match(diff, /bandeau/);
  assert.match(await a.textContent('#beta-state'), /^Inscriptions ouvertes/, 'le tableau de bord reste sur l\'état enregistré');
  await a.screenshot({ path: `${OUT}/after-2-config-desktop.png` });
  await a.click('#btn-beta-settings');
  await a.waitForSelector('#adm-toast.is-shown');
  assert.match(await a.textContent('#adm-toast'), /Enregistré : Sur invitation/);
  await a.waitForFunction(() => /^Sur invitation/.test(document.getElementById('beta-state').textContent));
  assert.strictEqual((await a.textContent('#beta-warnings')).trim(), '', 'plus d\'avertissement');
  log('configuration guidée : aperçu, enregistrement, toast, état enregistré mis à jour');

  // 3. Inviter un testeur : 2 clics
  await a.click('#btn-beta-invite-open');
  await a.fill('#beta-invite-name', 'Sophie');
  await a.click('#btn-beta-invite-create');
  await a.waitForSelector('#beta-invite-step2:not(.hidden)');
  const link = await a.inputValue('#beta-invite-link');
  assert.match(link, /\/\?invite=DIG-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const msg = await a.inputValue('#beta-invite-message');
  assert.ok(msg.includes(link) && msg.includes('Sophie') && !/discord/i.test(msg), 'message sans Discord non configuré');
  await a.click('#btn-beta-copy-link');
  assert.strictEqual(await a.evaluate(() => navigator.clipboard.readText()), link);
  await a.screenshot({ path: `${OUT}/after-3-invite-desktop.png` });
  await a.click('#beta-invite-dialog [data-close]');
  log('invitation créée en 2 clics, lien copié :', link.replace(/.*invite=/, ''));

  // 4. Invité en navigation privée (mobile)
  let p = await player(b, link.replace(/^https?:\/\/[^/]+/, BASE), 390, 844, 'invité');
  await p.waitForSelector('.beta-invite--ok');
  assert.strictEqual(await p.$('#acc-invite'), null, 'aucun champ « code » pour l\'invité');
  assert.ok(!p.url().includes('invite='), 'code retiré de l\'adresse');
  await p.screenshot({ path: `${OUT}/after-4-invite-mobile.png` });
  await p.fill('#acc-username', 'sophie_test');
  await p.fill('#acc-email', 'sophie@example.test');
  await p.fill('#acc-password', 'motdepasse1');
  await p.click('#btn-account-submit');
  await p.waitForFunction(() => !document.getElementById('form-account-login'), null, { timeout: 8000 });
  await p.screenshot({ path: `${OUT}/after-5-registered-mobile.png` });
  log('invité : mot d\'accueil, pas de code à saisir, compte créé');

  // 5. Lien déjà utilisé (autre appareil, privé)
  p = await player(b, link.replace(/^https?:\/\/[^/]+/, BASE), 390, 844, 'réutilisation');
  await p.waitForSelector('.beta-invite--bad');
  assert.match(await p.textContent('.beta-invite--bad'), /plus valable/);
  assert.strictEqual(await p.$('#acc-username'), null, 'pas de formulaire voué à l\'échec');
  await p.screenshot({ path: `${OUT}/after-6-used-mobile.png` });
  await p.click('.account-link-btn[data-tab="login"]');
  await p.waitForSelector('#acc-username');
  log('lien déjà utilisé : message clair, une seule action (demander un nouveau lien)');

  // 6. Sans lien en mode invitation : refus clair
  p = await player(b, BASE + '/', 1280, 900, 'sans lien');
  await p.click('#nav-settings, [data-view="settings"]').catch(() => {});
  await p.evaluate(() => { _accountTab = 'register'; switchView('settings'); });
  await p.waitForSelector('#acc-invite');
  await p.fill('#acc-username', 'intrus_1');
  await p.fill('#acc-email', 'intrus@example.test');
  await p.fill('#acc-password', 'motdepasse1');
  await p.click('#btn-account-submit');
  await p.waitForFunction(() => document.getElementById('acc-error')?.textContent.length > 0);
  assert.match(await p.textContent('#acc-error'), /sur invitation/);
  log('sans lien : refus clair « ouvre le lien que tu as reçu »');

  // 7. Tableau de bord : testeur compté, panneau mobile
  a = await adminPage(b, 390, 844);
  assert.match(await a.textContent('#beta-stats'), /1 testeur/);
  await a.screenshot({ path: `${OUT}/after-7-dashboard-mobile.png`, fullPage: true });
  // Inscriptions fermées : avertissement dans la fiche d'invitation
  await fetch(`${BASE}/api/admin/beta/settings`, { method: 'PUT', headers: H, body: JSON.stringify({ registrationMode: 'closed' }) });
  await a.click('#btn-refresh-beta');
  await a.waitForFunction(() => /^Inscriptions fermées/.test(document.getElementById('beta-state').textContent));
  await a.click('#btn-beta-invite-open');
  assert.ok(await a.isVisible('#beta-invite-warn'));
  log('mode fermé : avertissement bloquant dans le tableau de bord et la fiche');
  await fetch(`${BASE}/api/admin/beta/settings`, { method: 'PUT', headers: H, body: JSON.stringify({ registrationMode: 'invite' }) });

  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JS');
  log('aucune erreur JavaScript');
})().catch(e => { console.error('✗', e); process.exit(1); });
