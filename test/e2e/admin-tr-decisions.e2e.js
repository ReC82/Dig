/**
 * Essai navigateur #76 (recette 76-A du 05/11) : colonne « Décisions serveur » du tableau des essais, dépliable par
 * essai sans perte d'information. La réponse GET des essais est enrichie dans le navigateur (page.route) d'une longue
 * liste de décisions : aucune écriture, aucune donnée modifiée. Serveur de TEST uniquement (port ≥ 3100).
 *
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN_SECRET=… OUT=/tmp/captures node test/e2e/admin-tr-decisions.e2e.js
 */
'use strict';

const path = require('path');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const BASE = process.env.BASE, SECRET = process.env.ADMIN_SECRET, OUT = process.env.OUT || '/tmp';
let failed = 0;
const check = (tag, label, ok, extra = '') => { console.log(`${ok ? 'OK  ' : 'ÉCHEC'} [${tag}] ${label}${extra ? ` — ${extra}` : ''}`); if (!ok) failed++; };

const DECISIONS = { depth_capped: 412, manual_blocks_capped: 97, save_rate_limited: 31, revision_conflict: 12, depth_jump_rejected: 5, admin_reset: 3 };
const ANTICHEAT = { warn: 2 };
const EXPECTED = ['depth_capped ×412', 'manual_blocks_capped ×97', 'save_rate_limited ×31', 'revision_conflict ×12', 'depth_jump_rejected ×5', 'autoclic warn ×2'];

(async () => {
  const name = `dec76x${Date.now() % 100000}`;
  const reg = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: name, email: `${name}@example.invalid`, password: 'secret123' }) });
  if (reg.status !== 200) throw new Error(`inscription ${reg.status}`);

  const browser = await chromium.launch({ executablePath: process.env.CHROME });
  try {
    for (const [tag, viewport, isMobile] of [['pc 1280', { width: 1280, height: 900 }, false], ['mobile 390', { width: 390, height: 844 }, true]]) {
      const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile });
      const page = await ctx.newPage();
      const errors = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => { if (r.method() !== 'GET' && /\/api\/admin\/players\//.test(r.url())) writes.push(r.url()); });
      // Essai en cours : longue liste ; un essai archivé fictif : une seule décision ; un second : aucune.
      await page.route(/\/api\/admin\/players\/\d+\/test-runs$/, async route => {
        const res = await route.fetch();
        const data = await res.json();
        data.current.stats.serverDecisions = DECISIONS;
        data.current.stats.anticheatActions = ANTICHEAT;
        const base = { ...data.current.stats, endedAt: data.current.stats.startedAt };
        data.runs = [
          { id: 1, runNo: 1, endKind: 'test_reset', reason: 'e2e', stats: { ...base, serverDecisions: {}, anticheatActions: {} } },
          { id: 2, runNo: 2, endKind: 'test_reset', reason: 'e2e', stats: { ...base, serverDecisions: { depth_capped: 7 }, anticheatActions: {} } },
        ];
        data.current.runNo = 3;
        await route.fulfill({ response: res, json: data });
      });
      await page.goto(`${BASE}/admin/`);
      await page.fill('#secret-input', SECRET);
      await page.click('#secret-btn');
      await page.waitForSelector('.tab-btn[data-tab="players"]', { state: 'attached' });
      await admOpenTab(page, 'players');
      await page.fill('#player-search-input', name);
      await page.click('#btn-player-search');
      await page.waitForFunction(() => document.querySelectorAll('#tr-table tbody tr').length === 3);

      const read = () => page.evaluate(() => [...document.querySelectorAll('#tr-table tbody tr')].map(r => {
        const td = r.cells[10], det = td.querySelector('details.tr-dec');
        return { label: td.dataset.label, text: td.textContent, open: det ? det.open : null, summary: det?.querySelector('summary').textContent ?? null,
          items: det ? [...det.querySelectorAll('li')].map(li => li.textContent) : null, title: td.title, h: Math.round(r.getBoundingClientRect().height),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
      }));
      let rows = await read();
      const cur = rows[0];
      check(tag, 'essai en cours : détail replié par défaut', cur.open === false);
      check(tag, 'résumé : décision la plus fréquente + nombre d\'autres', cur.summary === 'depth_capped ×412 +5', cur.summary);
      check(tag, 'aucune information perdue : liste complète, triée, admin_* exclu comme avant', JSON.stringify(cur.items) === JSON.stringify(EXPECTED), JSON.stringify(cur.items));
      check(tag, 'liste complète aussi en infobulle', cur.title === EXPECTED.join(', '));
      check(tag, 'intitulé de colonne conservé (cartes smartphone)', cur.label === 'Décisions serveur');
      check(tag, 'une seule décision : texte simple, sans dépliage', rows[1].text === 'depth_capped ×7' && rows[1].summary === null, rows[1].text);
      check(tag, 'aucune décision : « aucune »', rows[2].text === 'aucune', rows[2].text);
      const hClosed = cur.h;
      await page.locator('#tr-table tbody tr').first().locator('details.tr-dec > summary').click();
      rows = await read();
      check(tag, 'clic : la liste se déplie, une décision par ligne', rows[0].open === true && rows[0].h > hClosed, `${hClosed} → ${rows[0].h} px`);
      check(tag, 'pas de débordement horizontal de la page', isMobile ? !rows[0].overflow : true);
      await page.locator('#tr-table').screenshot({ path: path.join(OUT, `tr-decisions-${isMobile ? 'mobile' : 'pc'}.png`) });
      check(tag, 'aucune écriture', writes.length === 0, writes.join(' '));
      check(tag, 'aucune erreur JS', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failed ? `${failed} ÉCHEC(S)` : 'TOUT OK');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
