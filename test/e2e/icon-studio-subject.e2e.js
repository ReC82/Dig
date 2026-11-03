/**
 * Essai navigateur de l'atelier d'icônes (#40, recette du 02/11, 2e retour) — transport IA SIMULÉ,
 * aucune dépense. Hors `npm test` (navigateur requis). Scénario : trois objets consécutifs (lanterne,
 * crayon, jeton) sur une copie de la base de production, saisies contradictoires, propositions
 * antérieures douteuses, retour, rechargement, génération en cours et panel obsolète.
 *
 * Lancer (serveur de test déjà démarré avec DIG_AI_FAKE=1 et DIG_AI_FAKE_DELAY_MS=4000) :
 *   PW=/chemin/node_modules/playwright-core BASE=http://127.0.0.1:3101 ADMIN=<secret> \
 *   RESTART_CMD='commande qui redémarre le serveur avec un autre COMMIT_HASH' node test/e2e/icon-studio-subject.e2e.js
 */

'use strict';

const assert = require('node:assert');
const { execSync } = require('child_process');
const { chromium } = require(process.env.PW);

const BASE = process.env.BASE;
const ADMIN = process.env.ADMIN;
const H = { Authorization: `Bearer ${ADMIN}` };
const log = (...a) => console.log('✓', ...a);
const api = async p => (await fetch(`${BASE}${p}`, { headers: H })).json();
const calls = async () => (await api('/api/admin/icons')).calls.length;
const target = async k => (await api(`/api/admin/icons/targets/${k}`)).target;

const POLLUTED = 'L\'image précédente représente une lanterne, c\'est une erreur. Remplace entièrement la lanterne par un CRAYON DE MINEUR : long crayon de charpentier en bois jaune.';

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('dialog', d => d.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  const login = async () => {
    await page.goto(`${BASE}/admin/`);
    await page.fill('#secret-input', ADMIN);
    await page.click('#secret-btn');
    await page.click('.tab-btn[data-tab="icons"]');
    await page.waitForSelector('#ic-grid .ic-card');
  };
  const open = async name => {
    if (await page.isVisible('#ic-sheet')) await page.click('#ic-sheet >> text=← Toutes les icônes');
    await page.fill('#ic-search', name);
    await page.click(`[aria-label="Ouvrir la fiche ${name}"]`);
    await page.waitForFunction(n => document.querySelector('#ic-sheet h3')?.textContent === n, name);
  };
  const field = () => page.inputValue('#ic-instruction');
  const sheet = () => page.textContent('#ic-sheet');

  const before = { lanterne: await target('item:lanterne_de_poche'), boussole: await target('item:boussole_tordue'),
    crayon: await target('item:crayon_de_mineur'), jeton: await target('item:jeton_dore') };
  const calls0 = await calls();

  await login();
  // 1. Lanterne : saisie non envoyée
  await open('Lanterne de poche');
  await page.fill('#ic-instruction', 'lanterne plus usée');
  // 2. Crayon : la saisie de la lanterne n'est pas reprise ; l'ancienne proposition « lanterne » est signalée
  await open('Crayon de mineur');
  assert.strictEqual(await field(), '', 'saisie de la lanterne non reprise sur le crayon');
  assert.match(await sheet(), /Proposition douteuse : sa consigne d'illustration demandait « lantern » \(objet « Lanterne de poche »\)/);
  assert.match(await sheet(), /ancienne version, le nom de l'objet n'était pas transmis/);
  await page.fill('#ic-instruction', POLLUTED);
  assert.ok(await page.isVisible('#ic-live-conflict'), 'aperçu du conflit « lanterne » sur la fiche du crayon');
  log('lanterne → crayon : aucune reprise de saisie, ancienne proposition signalée');

  // 3. Jeton : champ vide ; la précision du crayon collée ici est refusée sans dépense, sans contournement
  await open('Jeton doré');
  assert.strictEqual(await field(), '', 'saisie du crayon non reprise sur le jeton');
  assert.match(await sheet(), /Proposition douteuse : sa précision demandait « crayon de mineur » \(objet « Crayon de mineur »\)/);
  assert.match(await sheet(), /Proposition du 02\/11\/2026 21:36 \(heure de Bruxelles\)/, 'heure de Bruxelles affichée');
  await page.fill('#ic-instruction', POLLUTED);
  assert.match(await page.textContent('#ic-live-conflict'), /crayon de mineur/);
  await page.click('#ic-sheet >> text=↻ Refaire');
  await page.waitForSelector('#ic-sheet .error');
  assert.match(await page.textContent('#ic-sheet .error'), /Conflit de sujet : cette fiche est « Jeton doré ».*Aucune image n'a été générée et rien n'a été dépensé/);
  assert.strictEqual(await page.isVisible('text=Ce n\'est pas un autre objet'), false, 'nom complet d\'un autre objet : pas de contournement');
  assert.strictEqual(await calls(), calls0, 'aucun appel IA');
  assert.strictEqual((await api('/api/admin/icons/job')).job, null, 'aucune génération lancée');
  assert.strictEqual(await field(), POLLUTED, 'saisie refusée gardée sur SA fiche pour être corrigée');
  await page.fill('#ic-instruction', '');   // l'admin retire la précision fautive
  await page.click('#ic-sheet >> text=✓ Conserver cette image');   // proposition douteuse : confirmation (acceptée ici)… puis on revient
  log('jeton : précision du crayon refusée (409, 0 appel), heure de Bruxelles, proposition douteuse signalée');
  await page.screenshot({ path: '/tmp/e2e-40-jeton.png', fullPage: false });

  // 4. Retour au crayon : sa propre saisie est retrouvée (même clé) ; « lanterne » = conflit probable → confirmation
  await open('Crayon de mineur');
  assert.strictEqual(await field(), POLLUTED, 'retour : la saisie du crayon retrouvée sur le crayon seulement');
  await page.click('#ic-sheet >> text=↻ Refaire');
  await page.waitForSelector('text=Ce n\'est pas un autre objet');
  assert.strictEqual(await calls(), calls0);
  await page.click('text=Ce n\'est pas un autre objet');
  await page.waitForFunction(() => /Génération en cours/.test(document.querySelector('#ic-sheet').textContent));
  // Génération en cours : navigation vers le jeton pendant l'appel
  await open('Jeton doré');
  assert.strictEqual(await field(), '', 'pendant l\'appel du crayon, le jeton n\'hérite de rien');
  assert.match(await sheet(), /Une autre icône est en cours de génération \(« Crayon de mineur »\)/);
  for (let i = 0; i < 100 && (await api('/api/admin/icons/job')).job.status === 'running'; i++) await page.waitForTimeout(200);
  await page.waitForTimeout(4000);  // le client a constaté la fin (suivi toutes les 3 s)
  assert.strictEqual(await page.textContent('#ic-sheet h3'), 'Jeton doré', 'la fin de l\'appel ne change pas de fiche');
  const crayon = await target('item:crayon_de_mineur');
  const fresh = crayon.assets[0];
  assert.strictEqual(crayon.assets.length, before.crayon.assets.length + 1);
  assert.deepStrictEqual([fresh.identity.name, fresh.identity.fr, fresh.promptVersion, fresh.warning], ['Miner\'s Pencil', 'Crayon de mineur', 'v1.3', null]);
  assert.match(fresh.prompt, /^Object to depict: "Miner's Pencil" \(French name: "Crayon de mineur"\)/);
  assert.strictEqual((await target('item:jeton_dore')).assets.length, before.jeton.assets.length, 'aucune image ajoutée au jeton');
  assert.strictEqual(await calls(), calls0 + 1);
  log('crayon : conflit « lanterne » confirmé explicitement, une image v1.3 « Miner\'s Pencil » ; navigation pendant l\'appel sans effet');

  // 5. Rechargement : aucune saisie ne survit
  await login();
  await open('Crayon de mineur');
  assert.strictEqual(await field(), '');
  await open('Jeton doré');
  assert.strictEqual(await field(), '');
  log('rechargement : champs vides');

  // 6. Lanterne : génération normale (son propre nom n'est pas un conflit)
  await open('Lanterne de poche');
  await page.fill('#ic-instruction', 'lanterne plus usée');
  assert.strictEqual(await page.isVisible('#ic-live-conflict'), false);
  await page.click('#ic-sheet >> text=↻ Refaire');
  for (let i = 0; i < 20 && !(await api('/api/admin/icons/job')).job; i++) await page.waitForTimeout(200);
  for (let i = 0; i < 100 && (await api('/api/admin/icons/job')).job?.status === 'running'; i++) await page.waitForTimeout(200);
  const lan = await target('item:lanterne_de_poche');
  assert.match(lan.assets[0].prompt, /^Object to depict: "Pocket Lantern".*lanterne plus usée$/);
  log('lanterne : génération acceptée, identité « Pocket Lantern »');

  // 7. Images valides et propositions incorrectes : rien d'appliqué ni de publié par l'essai… sauf le jeton (étape 3)
  assert.strictEqual(lan.image, before.lanterne.image, 'image de la lanterne inchangée');
  assert.strictEqual((await target('item:boussole_tordue')).image, before.boussole.image, 'image de la boussole inchangée');
  const jeton = await target('item:jeton_dore');
  assert.ok(jeton.history.some(h => h.action === 'applied' && h.details?.doubtful), 'conservation d\'une douteuse tracée comme telle');

  // 8. Panel obsolète : le serveur redémarre avec une autre version, l'onglet ouvert ne peut plus générer
  await open('Boussole tordue');
  await page.waitForSelector('#ic-sheet .ic-redo .btn:not([disabled])', { timeout: 15000 });
  execSync(process.env.RESTART_CMD, { stdio: 'inherit' });
  const c8 = await calls();
  await page.click('#ic-sheet >> text=↻ Refaire');
  await page.waitForSelector('#adm-stale');
  assert.match(await page.textContent('#ic-sheet .error'), /Le panel affiché date d'une version précédente.*Rechargez la page/);
  assert.strictEqual(await calls(), c8, 'onglet obsolète : aucun appel');
  await page.screenshot({ path: '/tmp/e2e-40-stale.png' });
  log('panel obsolète : génération refusée, bandeau « Recharger »');

  // Smartphone : la fiche reste lisible
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await login();
  await open('Jeton doré');
  await page.screenshot({ path: '/tmp/e2e-40-mobile.png', fullPage: true });
  assert.deepStrictEqual(errors, [], 'aucune erreur JavaScript');
  await browser.close();
  console.log('E2E OK');
}

main().catch(e => { console.error(e); process.exit(1); });
