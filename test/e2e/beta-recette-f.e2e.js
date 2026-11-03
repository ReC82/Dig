/**
 * Essai navigateur des correctifs de la recette #57-F (03/11) : 1) signalement — rien n'est perdu
 * sur un clic hors de la fenêtre, ✕ ou Échap ; 2) panel admin — la session survit au F5, la
 * déconnexion la ferme, la clé n'est gardée nulle part ; 3) « Rafraîchir » — attente visible,
 * heure de mise à jour, erreur explicite, saisie en cours conservée.
 * Hors `npm test` (navigateur requis).
 *
 * Lancer (serveur de test démarré) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/dossier node test/e2e/beta-recette-f.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const log = (...a) => console.log('✓', ...a);
const errors = [];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });

  // ── 1. Signalement (joueur, smartphone) ────────────────────────────────────
  const pctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await pctx.newPage();
  p.on('pageerror', e => errors.push(`joueur: ${e.message}`));
  await p.goto(BASE);
  await p.click('.lang-pick-btn[data-lang="fr"]');
  // Configuration bêta chargée (signalements ouverts par défaut) : la fenêtre s'ouvre.
  await p.waitForFunction(() => { DigBeta.openReport(); return !!document.getElementById('beta-report-modal'); });
  await p.fill('#beta-step', 'Ouverture d’un coffre');
  await p.fill('#beta-observed', 'Le compteur ne bouge pas');

  await p.mouse.click(5, 5);   // clic involontaire sur le fond
  assert.ok(await p.isVisible('#beta-confirm'), 'confirmation affichée');
  assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'btn-beta-keep', 'focus sur « Continuer la rédaction »');
  assert.strictEqual(await p.inputValue('#beta-observed'), 'Le compteur ne bouge pas');
  await p.screenshot({ path: `${OUT}/f1-confirm-mobile.png` });
  await p.keyboard.press('Escape');
  assert.ok(await p.isHidden('#beta-confirm'), 'Échap sur la confirmation = continuer');
  assert.ok(await p.isVisible('#beta-report-modal'));
  await p.keyboard.press('Escape');
  assert.ok(await p.isVisible('#beta-confirm'), 'Échap demande confirmation');
  await p.click('#btn-beta-keep');
  await p.click('#btn-beta-x');
  assert.ok(await p.isVisible('#beta-confirm'), '✕ demande confirmation');
  await p.click('#btn-beta-keep');
  await p.click('#btn-beta-cancel');
  assert.ok(await p.isVisible('#beta-confirm'), 'Fermer demande confirmation');
  await p.click('#btn-beta-keep');

  // Sélection de texte qui déborde sur le fond : rien ne se passe.
  const box = await p.locator('#beta-observed').boundingBox();
  await p.mouse.move(box.x + 10, box.y + 10);
  await p.mouse.down();
  await p.mouse.move(3, 3, { steps: 5 });
  await p.mouse.up();
  assert.ok(await p.isHidden('#beta-confirm'), 'glisser depuis un champ vers le fond ne ferme rien');
  log('signalement : fond, ✕, Échap, Fermer → confirmation, focus sur continuer, aucun texte perdu');

  // Brouillon gardé si la fenêtre est reconstruite (réouverture), effacé par « Abandonner ».
  await p.evaluate(() => DigBeta.openReport());
  assert.strictEqual(await p.inputValue('#beta-step'), 'Ouverture d’un coffre', 'brouillon repris');
  assert.strictEqual(await p.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('compteur')), false, 'brouillon jamais écrit dans le stockage du navigateur');
  await p.mouse.click(5, 5);
  await p.click('#btn-beta-discard');
  assert.ok(await p.isHidden('#beta-report-modal'));
  await p.evaluate(() => DigBeta.openReport());
  assert.strictEqual(await p.inputValue('#beta-observed'), '', 'abandon : formulaire vide');
  await p.mouse.click(5, 5);
  assert.ok(await p.isHidden('#beta-report-modal'), 'formulaire vide : fermeture directe, sans question');

  // Envoi : la fenêtre se ferme ensuite sans question, brouillon effacé.
  await p.evaluate(() => DigBeta.openReport());
  await p.fill('#beta-observed', 'Signalement e2e recette F');
  await p.click('#btn-beta-send');
  await p.waitForSelector('#beta-report-msg.is-ok');
  await p.mouse.click(5, 5);
  assert.ok(await p.isHidden('#beta-report-modal'), 'après envoi : fermeture directe');
  await p.evaluate(() => DigBeta.openReport());
  assert.strictEqual(await p.inputValue('#beta-observed'), '', 'brouillon effacé après envoi');
  await p.keyboard.press('Escape');
  log('signalement : brouillon repris à la réouverture, effacé après « Abandonner » ou envoi, rien dans le stockage');

  // ── 2. Session admin (ordinateur) ──────────────────────────────────────────
  const actx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await actx.newPage();
  a.on('pageerror', e => errors.push(`admin: ${e.message}`));
  await a.goto(`${BASE}/admin/`);
  await a.waitForSelector('#auth-screen:not(.hidden)');
  await a.fill('#secret-input', 'mauvaise-cle-de-test');
  await a.click('#secret-btn');
  await a.waitForSelector('#auth-error:not(.hidden)');
  await a.fill('#secret-input', ADMIN);
  await a.click('#secret-btn');
  await a.waitForSelector('#admin-app:not(.hidden)');
  assert.strictEqual(await a.inputValue('#secret-input'), '', 'champ vidé');
  await a.reload();
  await a.waitForSelector('#admin-app:not(.hidden)');
  assert.ok(await a.isHidden('#auth-screen'), 'F5 : pas de nouvelle saisie');
  const leaks = await a.evaluate(k => [document.cookie, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), location.href].some(x => x.includes(k)), ADMIN);
  assert.strictEqual(leaks, false, 'clé absente des cookies lisibles, du stockage et de l’URL');
  assert.strictEqual(await a.evaluate(() => document.cookie.includes('dig_admin')), false, 'cookie de session illisible par le JavaScript');
  assert.match(await a.textContent('#admin-session-info'), /2 h sans activité/);
  await a.screenshot({ path: `${OUT}/f2-admin-after-f5.png` });
  log('session admin : F5 sans ressaisie, cookie HttpOnly, clé gardée nulle part');

  // ── 3. Rafraîchir (onglet Bêta) ────────────────────────────────────────────
  await a.click('.tab-btn[data-tab="beta"]');
  await a.waitForSelector('#beta-stats li');
  await a.waitForSelector('details.beta-report');
  const note = a.locator('details.beta-report input[placeholder="Note interne"]').first();
  await note.fill('note non enregistrée');
  await a.click('#beta-advanced > summary');
  await a.click('.beta-sub > summary:has-text("affichés aux joueurs")');
  await a.fill('#beta-known', 'bug connu en cours de saisie');
  let release;
  await a.route('**/api/admin/beta', async route => { await new Promise(r => { release = r; }); await route.continue(); });
  await a.click('#btn-refresh-beta');
  await a.waitForFunction(() => document.getElementById('btn-refresh-beta').getAttribute('aria-disabled') === 'true');   // #60 : indisponible sans perdre le focus
  assert.match(await a.textContent('#btn-refresh-beta'), /Actualisation/);
  await a.screenshot({ path: `${OUT}/f3-refresh-pending.png`, clip: { x: 0, y: 0, width: 1280, height: 300 } });
  release();
  await a.waitForFunction(() => /Données à jour à \d\d:\d\d:\d\d/.test(document.getElementById('beta-refresh-status').textContent));
  assert.strictEqual(await a.getAttribute('#btn-refresh-beta', 'aria-disabled'), null);
  assert.strictEqual(await note.inputValue(), 'note non enregistrée', 'note en cours conservée');
  assert.strictEqual(await a.inputValue('#beta-known'), 'bug connu en cours de saisie', 'bugs connus en cours conservés');
  assert.ok(await a.$eval('#beta-advanced', d => d.open), 'sections ouvertes conservées');
  await a.unroute('**/api/admin/beta');
  await a.route('**/api/admin/beta', route => route.abort());
  await a.click('#btn-refresh-beta');
  await a.waitForSelector('#beta-refresh-status.is-err');
  assert.match(await a.textContent('#beta-refresh-status'), /Échec de l’actualisation .* données affichées : \d\d:\d\d:\d\d/);
  assert.strictEqual(await note.inputValue(), 'note non enregistrée');
  await a.unroute('**/api/admin/beta');
  await a.screenshot({ path: `${OUT}/f3-refresh-error.png`, clip: { x: 0, y: 0, width: 1280, height: 300 } });
  log('Rafraîchir : bouton en attente, « Données à jour à HH:MM:SS », échec expliqué, saisies conservées');

  // Les compteurs viennent du serveur : un nouveau retour apparaît après Rafraîchir.
  const before = await a.textContent('#beta-stats');
  await p.evaluate(() => DigBeta.openReport());
  await p.fill('#beta-observed', 'Deuxième retour pour le compteur');
  await p.click('#btn-beta-send');
  await p.waitForSelector('#beta-report-msg.is-ok');
  await a.click('#btn-refresh-beta');
  await a.waitForFunction(b4 => document.getElementById('beta-stats').textContent !== b4, before);
  log(`compteurs relus côté serveur : « ${before.trim()} » → « ${(await a.textContent('#beta-stats')).trim()} »`);

  // Déconnexion : F5 → écran de connexion.
  await a.click('#logout-btn');
  await a.waitForSelector('#auth-screen:not(.hidden)');
  await a.reload();
  await a.waitForSelector('#auth-screen:not(.hidden)');
  assert.ok(await a.isHidden('#admin-app'));
  log('déconnexion : session fermée, F5 redemande la clé');

  assert.deepStrictEqual(errors, [], 'aucune erreur JavaScript');
  log('0 erreur JavaScript');
  await b.close();
})().catch(err => { console.error('✗', err); process.exit(1); });
