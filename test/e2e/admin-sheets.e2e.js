/**
 * Essai navigateur #76 : fiche joueur et fenêtres de l'admin simplifiées (résumé d'abord, actions visibles sans
 * défiler, détails repliés, tableaux paginés et en cartes sur smartphone, boutons en pied fixe).
 * Serveur de TEST uniquement (base temporaire, port ≥ 3100). Aucun reset n'est confirmé : seuls les aperçus
 * (GET) sont ouverts ; les essais archivés nécessaires sont créés avant, par l'API, sur la base de test.
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN_SECRET=… OUT=/tmp/captures node test/e2e/admin-sheets.e2e.js
 */
'use strict';

const path = require('path');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE, SECRET = process.env.ADMIN_SECRET, OUT = process.env.OUT || '/tmp';
let failed = 0;
const check = (tag, label, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} [${tag}] ${label}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

(async () => {
  // Joueur de test avec 7 essais archivés (8 lignes : pagination à 5)
  const name = `fiche76x${Date.now() % 100000}`;
  const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, email: `${name}@example.invalid`, password: 'secret123' }) });
  if (reg.status !== 200) throw new Error(`inscription ${reg.status}`);
  const { data: found } = await api('GET', `/api/admin/players/search?q=${name}`);
  const id = found.users[0].id;
  for (let k = 1; k <= 7; k++) {
    const { data: pv } = await api('GET', `/api/admin/players/${id}/test-runs/reset-preview`);
    const r = await api('POST', `/api/admin/players/${id}/test-runs/reset`, { confirmUsername: name, expectedRevision: pv.expectedRevision, requestId: `e2e76-${id}-${k}`, reason: `préparation essai ${k}` });
    if (r.status !== 200) throw new Error(`préparation ${r.status} ${JSON.stringify(r.data)}`);
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [tag, viewport, isMobile] of [['pc 1280', { width: 1280, height: 900 }, false], ['mobile 390', { width: 390, height: 844 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
      const page = await ctx.newPage();
      const errors = [], posts = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() !== 'GET' && /\/api\/admin\/players\//.test(r.url())) posts.push(r.url()); });
      await page.goto(`${BASE}/admin/`);
      await page.fill('#secret-input', SECRET);
      await page.click('#secret-btn');
      await page.waitForSelector('.tab-btn[data-tab="players"]', { state: 'attached' });
      await admOpenTab(page, 'players');

      // Recherche : un seul joueur trouvé → fiche ouverte directement
      await page.fill('#player-search-input', name);
      await page.click('#btn-player-search');
      await page.waitForSelector('#tr-table tbody tr');
      await page.waitForFunction(() => !/…/.test(document.querySelector('#pd-sum-run strong')?.textContent ?? '…'));
      check(tag, '« Rechercher » avec un seul résultat ouvre la fiche', await page.isVisible('#player-detail-card'));
      const sum = await page.textContent('#pd-summary');
      check(tag, 'résumé compact : essai en cours, profondeur, pièces, révision', /n° 8 en cours/.test(sum) && /7 archivé/.test(sum) && /Profondeur/.test(sum) && /Révision/.test(sum), sum.replace(/\s+/g, ' '));
      const st = await page.evaluate(() => ({ save: document.getElementById('pd-sec-save').open, tests: document.getElementById('pd-sec-tests').open,
        partial: document.getElementById('pd-sec-partial').open, more: document.getElementById('tr-more').open,
        order: [...document.querySelectorAll('#player-detail-card > details')].map(d => d.id) }));
      check(tag, 'Essais ouverts en premier ; progression détaillée, réinitialisation partielle et explications repliées',
        st.tests && !st.save && !st.partial && !st.more && st.order.join() === 'pd-sec-tests,pd-sec-save,pd-sec-partial', JSON.stringify(st));
      await page.locator('#player-detail-card').evaluate(el => el.scrollIntoView({ block: 'start' }));
      const btn = await page.evaluate(() => { const r = document.getElementById('btn-tr-reset').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight }; });
      check(tag, '« Recommencer un test à zéro » visible sans défiler depuis le haut de la fiche', btn.top >= 0 && btn.bottom <= btn.vh, JSON.stringify(btn));

      // Historique : l'essai en cours d'abord, 5 lignes par page, toutes les lignes conservées
      const pg = async () => page.evaluate(() => ({ rows: document.querySelectorAll('#tr-table tbody tr').length,
        shown: [...document.querySelectorAll('#tr-table tbody tr')].filter(r => !r.hidden).map(r => r.cells[0].textContent),
        pager: document.getElementById('tr-pager').textContent, wide: document.querySelector('#tr-card .table-wrapper').scrollWidth - document.querySelector('#tr-card .table-wrapper').clientWidth }));
      let p1 = await pg();
      check(tag, 'historique paginé : 8 essais, 5 affichés, en cours en tête', p1.rows === 8 && p1.shown.length === 5 && /en cours/.test(p1.shown[0]) && /1–5 sur 8/.test(p1.pager), JSON.stringify(p1));
      check(tag, 'historique sans défilement horizontal', p1.wide <= 1, `${p1.wide}px`);
      await page.locator('#tr-pager button', { hasText: 'Suivants' }).click();
      p1 = await pg();
      check(tag, 'page 2 : les 3 essais les plus anciens', p1.shown.join() === 'n° 3,n° 2,n° 1' && /6–8 sur 8/.test(p1.pager), JSON.stringify(p1.shown));
      if (isMobile) {
        const card = await page.evaluate(() => { const td = [...document.querySelectorAll('#tr-table tbody tr')].find(r => !r.hidden).cells[1]; return { label: td.dataset.label, display: getComputedStyle(td).display, head: getComputedStyle(document.querySelector('#tr-table thead')).display }; });
        check(tag, 'smartphone : essais en cartes « intitulé : valeur »', card.label === 'Période (Bruxelles)' && card.display === 'block' && card.head === 'none', JSON.stringify(card));
      }
      await page.screenshot({ path: path.join(OUT, `t76-fiche-${tag.split(' ')[0]}.png`) });

      // Fenêtre « Recommencer un test à zéro » : résumé, formulaire, détails repliés, pied fixe
      await page.locator('#tr-pager button', { hasText: 'Précédents' }).click();
      await page.click('#btn-tr-reset');
      await page.waitForFunction(() => document.getElementById('tr-dialog').open);
      const dlg = await page.evaluate(() => {
        const d = document.getElementById('tr-dialog'), dr = d.getBoundingClientRect();
        const f = d.querySelector(':scope > .form-actions').getBoundingClientRect();
        const pos = id => document.getElementById(id).getBoundingClientRect().top;
        return { details: document.getElementById('tr-dialog-details').open, formFirst: pos('tr-reason') < pos('tr-dialog-details'),
          reasonVisible: pos('tr-reason') < dr.bottom, foot: f.bottom <= Math.min(dr.bottom, innerHeight) + 1 && f.top >= dr.top,
          disabled: document.getElementById('btn-tr-confirm').disabled, diffRows: document.querySelectorAll('#tr-diff tbody tr').length,
          impact: document.querySelectorAll('#tr-impact li').length, changes: document.getElementById('tr-dialog-changes').textContent };
      });
      check(tag, 'confirmation : formulaire avant les détails, détails (avant / après, conservé) repliés mais présents',
        !dlg.details && dlg.formFirst && dlg.reasonVisible && dlg.diffRows === 9 && dlg.impact >= 5, JSON.stringify(dlg));
      check(tag, 'confirmation : boutons en pied visibles, Confirmer inactif sans motif ni pseudo', dlg.foot && dlg.disabled);
      await page.fill('#tr-reason', 'Essai navigateur');
      await page.fill('#tr-confirm-input', name.toUpperCase());
      check(tag, 'pseudo exact toujours exigé (casse)', await page.locator('#btn-tr-confirm').isDisabled());
      await page.fill('#tr-confirm-input', name);
      check(tag, 'motif + pseudo exact → Confirmer actif', await page.locator('#btn-tr-confirm').isEnabled());
      await page.click('#tr-dialog-details-sum');
      await page.evaluate(() => { const d = document.getElementById('tr-dialog'); d.scrollTop = d.scrollHeight; });
      const foot2 = await page.evaluate(() => { const d = document.getElementById('tr-dialog'), f = d.querySelector(':scope > .form-actions').getBoundingClientRect(); return f.bottom <= Math.min(d.getBoundingClientRect().bottom, innerHeight) + 1; });
      check(tag, 'détails dépliés : pied toujours visible', foot2);
      await page.screenshot({ path: path.join(OUT, `t76-confirmation-${tag.split(' ')[0]}.png`) });
      // Annuler avec des saisies : la protection #61 demande confirmation avant de les abandonner
      await page.locator('#tr-dialog [data-close]').click();
      const discard = page.getByRole('button', { name: 'Abandonner les modifications' });
      await discard.waitFor({ timeout: 4000 });
      check(tag, 'Annuler avec motif saisi : confirmation « Abandonner les modifications » (#61 conservé)', true);
      await discard.click();
      await page.waitForFunction(() => !document.getElementById('tr-dialog').open);

      // Restauration : aperçu seulement
      await page.locator('#tr-table tbody tr:not([hidden]) button', { hasText: 'Restaurer' }).first().click();
      await page.waitForFunction(() => document.getElementById('tr-dialog').open);
      const rs = await page.evaluate(() => ({ title: document.getElementById('tr-dialog-title').textContent, changes: document.getElementById('tr-dialog-changes').textContent, details: document.getElementById('tr-dialog-details').open }));
      check(tag, 'restauration : même fenêtre compacte (résumé des changements, détails repliés)', /Restaurer l'essai n° 7/.test(rs.title) && rs.changes.length > 0 && !rs.details, JSON.stringify(rs));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('tr-dialog').open);

      check(tag, 'aucune écriture envoyée (aucun reset ni restauration)', posts.length === 0, posts.join());
      check(tag, 'aucune erreur JS', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
