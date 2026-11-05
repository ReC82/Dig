/**
 * Essai navigateur de la gestion de la bêta (#80) : bouton « Gérer les invitations et testeurs », listes filtrées,
 * révoquer / archiver / réafficher un lien, retirer / réintégrer un testeur (compte intact), archiver un retour,
 * fermeture de la fiche sans faux avertissement (#72), PC 1280 px et mobile 390 / 320 px (pas de débordement,
 * boutons tactiles). Hors `npm test` (navigateur requis). Base de test neuve exigée.
 *
 * Lancer (serveur de test déjà démarré sur une base vide) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/dossier node test/e2e/beta-manage.e2e.js
 */
'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log('✓', ...a);
const errors = [];

const api = async (method, url, body, headers = H) => {
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

async function adminPage(b, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`admin ${w}: ${e.message}`));
  await p.goto(`${BASE}/admin/`);
  await p.fill('#secret-input', ADMIN);
  await p.click('#secret-btn');
  await p.waitForSelector('#admin-app:not(.hidden)');
  await admOpenTab(p, 'beta');
  await p.waitForSelector('#beta-stats li');
  return p;
}

const confirmYes = async p => { await p.waitForSelector('#adm-confirm[open]'); await p.click('#adm-confirm-yes'); };
const items = p => p.locator('#beta-manage-list > li.beta-item');

(async () => {
  // Données de test : 3 liens, 2 inscrits, 1 retour.
  await api('PUT', '/api/admin/beta/settings', { registrationMode: 'invite', reportsEnabled: true });
  const inv = (await api('POST', '/api/admin/beta/invites', { label: 'Testeurs essai', count: 3 })).body.invites;
  const reg = (u, code) => api('POST', '/api/register', { username: u, email: `${u}@example.test`, password: 'motdepasse-solide', inviteCode: code }, { 'Content-Type': 'application/json' });
  const alice = await reg('e2e_alice', inv[0].code);
  await reg('e2e_bob', inv[1].code);
  await api('POST', '/api/beta/reports', { observed: 'Bouton coffre inactif (test e2e)' }, { 'Content-Type': 'application/json', Cookie: alice.cookie });

  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  let a = await adminPage(b, 1280, 900);
  assert.match(await a.textContent('#beta-stats'), /2 testeur\(s\) inscrit\(s\)\s*1 lien\(s\) d'invitation actif\(s\)/);
  await a.screenshot({ path: `${OUT}/80-1-dashboard-desktop.png`, fullPage: true });

  // 1. Fiche : liens, codes masqués.
  await a.click('#btn-beta-manage');
  await a.waitForSelector('#beta-manage-dialog[open]');
  assert.strictEqual(await items(a).count(), 3);
  const listText = await a.textContent('#beta-manage-list');
  for (const i of inv) assert.ok(!listText.includes(i.code), 'code complet jamais affiché');
  assert.match(listText, new RegExp(`DIG-••••-${inv[2].code.slice(-4)}`));
  await a.screenshot({ path: `${OUT}/80-2-links-desktop.png` });
  log('fiche : 3 liens, codes masqués');

  // 2. Révoquer le lien inutilisé.
  const row = items(a).filter({ hasText: inv[2].code.slice(-4) });
  await row.getByRole('button', { name: 'Révoquer' }).click();
  await a.waitForSelector('#adm-confirm[open]');
  assert.match(await a.textContent('#adm-confirm-impact'), /ne permet plus de créer de compte, immédiatement/);
  await a.screenshot({ path: `${OUT}/80-3-revoke-confirm.png` });
  await a.click('#adm-confirm-yes');
  await a.waitForFunction(() => /révoqué/.test(document.getElementById('beta-manage-status').textContent));
  assert.strictEqual((await api('GET', `/api/beta/invite/${inv[2].code}`, undefined, {})).body.state, 'revoked', 'invalidé côté serveur');
  await a.waitForFunction(() => /0 lien\(s\) d'invitation actif/.test(document.getElementById('beta-stats').textContent));
  log('révocation : confirmation, invalidation serveur, compteur à jour');

  // 3. Archiver le lien révoqué, le retrouver dans « Archives », le réafficher.
  await items(a).filter({ hasText: inv[2].code.slice(-4) }).getByRole('button', { name: /Archiver/ }).click();
  await a.waitForFunction(() => document.querySelectorAll('#beta-manage-list > li.beta-item').length === 2);
  await a.selectOption('#beta-manage-filter', 'archived');
  assert.strictEqual(await items(a).count(), 1);
  await items(a).getByRole('button', { name: /Réafficher/ }).click();
  await a.waitForFunction(() => document.querySelectorAll('#beta-manage-list > li.beta-item').length === 0);
  await a.selectOption('#beta-manage-filter', 'current');
  assert.strictEqual(await items(a).count(), 3);
  log('archiver / archives / réafficher');

  // 4. Testeurs : recherche, retrait (compte intact), réintégration.
  await a.click('#beta-tab-testers');
  assert.strictEqual(await items(a).count(), 2);
  await a.fill('#beta-manage-q', 'alice');
  assert.strictEqual(await items(a).count(), 1);
  await items(a).getByRole('button', { name: 'Retirer du programme' }).click();
  await a.waitForSelector('#adm-confirm[open]');
  assert.match(await a.textContent('#adm-confirm-impact'), /ne changent PAS/);
  await a.screenshot({ path: `${OUT}/80-4-remove-confirm.png` });
  await a.click('#adm-confirm-yes');
  await a.waitForFunction(() => /1 testeur\(s\) inscrit/.test(document.getElementById('beta-stats').textContent));
  const login = await api('POST', '/api/login', { username: 'e2e_alice', password: 'motdepasse-solide' }, { 'Content-Type': 'application/json' });
  assert.strictEqual(login.status, 200, 'connexion intacte');
  await a.selectOption('#beta-manage-filter', 'removed');
  assert.strictEqual(await items(a).count(), 1);
  await items(a).getByRole('button', { name: /Réintégrer/ }).click();
  await a.waitForFunction(() => /2 testeur\(s\) inscrit/.test(document.getElementById('beta-stats').textContent));
  log('testeurs : retrait réversible, connexion intacte');

  // 5. Historique.
  await a.click('#beta-tab-audit');
  assert.ok(await items(a).count() >= 5);
  assert.match(await a.textContent('#beta-manage-list'), /Testeur retiré du programme/);
  await a.screenshot({ path: `${OUT}/80-5-audit.png` });

  // 6. Fermeture : jamais d'avertissement « modifications non enregistrées » (#72), même après recherche.
  await a.click('#beta-tab-testers');
  await a.fill('#beta-manage-q', 'bob');
  await a.click('#beta-manage-dialog [data-close]');
  await a.waitForSelector('#beta-manage-dialog:not([open])', { state: 'attached' });
  assert.strictEqual(await a.locator('#adm-confirm[open]').count(), 0);
  log('fermeture directe, sans faux avertissement');

  // 7. Retours : archiver, filtre Archives, réafficher.
  const card = a.locator('details.beta-report').first();
  await card.getByRole('button', { name: /Archiver/ }).click();
  await a.waitForFunction(() => /archivés : 1/.test(document.getElementById('beta-reports-counts').textContent));
  assert.strictEqual(await a.locator('details.beta-report').count(), 0);
  await a.selectOption('#beta-reports-view', 'archived');
  assert.strictEqual(await a.locator('details.beta-report').count(), 1);
  await a.screenshot({ path: `${OUT}/80-6-reports-archived.png` });
  await a.locator('details.beta-report > summary').first().click();
  await a.locator('details.beta-report').first().getByRole('button', { name: /Réafficher/ }).click();
  await a.waitForFunction(() => /archivés : 0/.test(document.getElementById('beta-reports-counts').textContent));
  log('retours : archiver / archives / réafficher');

  // 8. Recherche d'actions du menu.
  await a.close();

  // 9. Mobile 390 et 320 px.
  for (const w of [390, 320]) {
    a = await adminPage(b, w, 844);
    await a.click('#btn-beta-manage');
    await a.waitForSelector('#beta-manage-dialog[open]');
    const m = await a.evaluate(() => {
      const d = document.getElementById('beta-manage-dialog');
      const btns = [...d.querySelectorAll('.beta-item-actions .btn, .beta-tab')];
      return { over: d.scrollWidth > d.clientWidth + 1, page: document.documentElement.scrollWidth > innerWidth + 1,
        minH: Math.min(...btns.map(x => x.getBoundingClientRect().height)), n: btns.length };
    });
    assert.ok(!m.over && !m.page, `pas de débordement horizontal à ${w}px`);
    assert.ok(m.n > 0 && m.minH >= 40, `boutons tactiles ≥ 40 px à ${w}px (${m.minH})`);
    await a.screenshot({ path: `${OUT}/80-7-links-${w}.png` });
    await a.click('#beta-tab-testers');
    await a.screenshot({ path: `${OUT}/80-8-testers-${w}.png` });
    await a.close();
    log(`mobile ${w}px : lisible, sans débordement`);
  }

  await b.close();
  assert.deepStrictEqual(errors, [], 'aucune erreur JavaScript');
  log('essai navigateur #80 terminé');
})().catch(err => { console.error(err); process.exit(1); });
