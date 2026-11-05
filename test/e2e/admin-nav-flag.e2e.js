/**
 * Essai navigateur #70 (recette du 05/11) : le ⚠ du menu est réservé aux incidents, pas aux décisions d'exploitation.
 * - Deux améliorations suspendues volontairement (Fragments, Reroll bloc) : aucun ⚠ sur « Améliorations » ni sur
 *   « Jeu & progression » ; la page indique en texte neutre « 2 désactivée(s) ».
 * - Vraie anomalie (catalogue en erreur 500) : ⚠ sur la rubrique et le groupe, explication en infobulle.
 * - Coupure réseau : aucun faux signal. Retour à la normale : ⚠ retiré.
 * - L'autre signal (« aucune saison active », réponse 404) fonctionne toujours.
 * PC 1280×900 et smartphone 390×844. Hors `npm test` (navigateur requis). Captures dans OUT.
 *
 * Lancer (serveur de test démarré, base de test JETABLE : les suspensions y sont écrites) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome BASE=http://127.0.0.1:3101 ADMIN=<secret> OUT=/tmp/dossier \
 *   node test/e2e/admin-nav-flag.e2e.js
 */
'use strict';

const { chromium } = require(process.env.PW);
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const results = [];
const check = (tag, name, ok, extra = '') => results.push(`${ok ? 'OK  ' : 'FAIL'} [${tag}] ${name}${extra ? ` — ${extra}` : ''}`);

async function adminApi(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function login(page) {
  await page.goto(`${BASE}/admin/#upgrades`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await page.waitForSelector('#admin-app:not(.hidden)');
  await page.waitForTimeout(800);
}
const flags = page => page.evaluate(() => {
  const btn = document.querySelector('.tab-btn[data-tab="upgrades"]');
  const grp = btn.closest('.nav-group').querySelector('.nav-group-btn');
  const vis = el => !el.querySelector('.nav-flag').classList.contains('hidden');
  return { item: vis(btn), group: vis(grp), title: btn.title, groupTitle: grp.title,
    season: !document.querySelector('.tab-btn[data-tab="season-overview"] .nav-flag').classList.contains('hidden'),
    summary: document.getElementById('up-summary').textContent, count: document.getElementById('up-ctl-count').textContent };
});
async function refresh(page) {
  await page.click('#btn-refresh-upgrades');
  await page.waitForTimeout(700);
}

(async () => {
  // Suspensions volontaires (achats seuls : pas de confirmation), comme en production.
  for (const id of ['fragment_shop', 'block_reroll']) {
    const r = await adminApi('POST', `/api/admin/upgrades/${id}/controls`, { controls: { purchases: true }, reason: 'Essai #70 : suspension volontaire' });
    if (r.status !== 200 && r.status !== 409) throw new Error(`suspension ${id} : ${r.status} ${JSON.stringify(r.data)}`);
  }
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const errors = [];
  for (const [tag, viewport] of [['pc 1280', { width: 1280, height: 900 }], ['mobile 390', { width: 390, height: 844 }]]) {
    const ctx = await b.newContext({ viewport });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    await login(page);
    let f = await flags(page);
    check(tag, 'suspension volontaire : aucun ⚠ sur Améliorations ni sur le groupe', !f.item && !f.group, JSON.stringify(f));
    check(tag, 'état visible et neutre dans la page', /2 désactivée\(s\) volontairement/.test(f.summary) && f.count === '— 2 désactivée(s)',
      `${f.summary} | ${f.count}`);
    check(tag, 'infobulle sans alerte', !/⚠|urgence|suspendue/.test(f.title + f.groupTitle), `${f.title} | ${f.groupTitle}`);
    await page.screenshot({ path: `${OUT}/flag-${tag.replace(' ', '-')}-suspendues.png` });

    await page.route('**/api/admin/upgrades', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"panne simulée"}' }));
    await refresh(page);
    f = await flags(page);
    check(tag, 'erreur serveur : ⚠ sur la rubrique et le groupe, avec explication', f.item && f.group && /erreur serveur/.test(f.title) && /erreur serveur/.test(f.groupTitle), JSON.stringify(f));
    if (tag.startsWith('mobile')) {
      await page.click('#nav-menu-btn'); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/flag-${tag.replace(' ', '-')}-erreur-menu.png` });
      await page.click('#nav-menu-btn'); await page.waitForTimeout(300);
    } else await page.screenshot({ path: `${OUT}/flag-${tag.replace(' ', '-')}-erreur.png` });

    await page.unroute('**/api/admin/upgrades');
    await refresh(page);
    f = await flags(page);
    check(tag, 'retour à la normale : ⚠ retiré (suspensions toujours en place)', !f.item && !f.group && /2 désactivée/.test(f.summary), JSON.stringify(f));

    await page.route('**/api/admin/upgrades', r => r.abort());
    await refresh(page);
    f = await flags(page);
    check(tag, 'coupure réseau : aucun faux signal', !f.item && !f.group);
    await page.unroute('**/api/admin/upgrades');

    // L'autre signal du menu n'est pas affecté.
    await page.route('**/api/admin/seasons/active/summary', r => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Aucune saison active"}' }));
    await page.evaluate(() => loadSeasonOverview());
    await page.waitForTimeout(600);
    f = await flags(page);
    check(tag, '« aucune saison active » : ⚠ Saison en cours toujours fonctionnel', f.season);
    await page.unroute('**/api/admin/seasons/active/summary');
    await page.evaluate(() => loadSeasonOverview());
    await page.waitForTimeout(600);
    check(tag, 'saison retrouvée : ⚠ retiré', !(await flags(page)).season);
    await ctx.close();
  }
  await b.close();
  check('global', 'aucune erreur JavaScript', !errors.length, errors.join(' | '));
  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - fails}/${results.length} OK`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
