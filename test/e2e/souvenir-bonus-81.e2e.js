/**
 * Essai navigateur #81 (demande du propriétaire du 08/11) — fiche « ✨ Bonus du souvenir » dans la
 * fiche d'un objet d'événement. Hors `npm test`. Sur une copie de la base de production.
 *   Événements → Novembre → 1er objet → état « Aucun bonus défini — inactif en jeu », deux variantes
 *   chiffrées selon la profondeur, cumul 30 + 31 (dont proposés) avec plafonds, règles doubles /
 *   échanges ; « Préparer un brouillon lié » ouvre la fiche Micro-bonus PAR-DESSUS, liée au souvenir,
 *   SANS rien enregistrer ; la section n'élargit pas la fiche (tableaux à défilement interne), PC 1280 et
 *   mobile 390 ; 0 erreur JS.
 *
 * Lancer (serveur de test démarré) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> SHOTS=/tmp/dossier EVENT=novembre_histoire_2026 node test/e2e/souvenir-bonus-81.e2e.js
 */

'use strict';

const assert = require('node:assert');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');

const { BASE, ADMIN } = process.env;
const EVENT = process.env.EVENT || 'novembre_histoire_2026';
const SHOTS = process.env.SHOTS || '/tmp';
const H = { Authorization: `Bearer ${ADMIN}` };
const log = (...a) => console.log('✓', ...a);
const draftCount = async () => (await (await fetch(`${BASE}/api/admin/micro-bonuses`, { headers: H })).json()).drafts.length;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${BASE}/admin/`);
    await page.fill('#secret-input', ADMIN);
    await page.click('#secret-btn');
    await page.waitForSelector('#secret-input', { state: 'hidden' });
    await page.waitForTimeout(500);
    await admOpenTab(page, 'events');
    await page.click(`[data-adm-key="ev:${EVENT}"]`);
    await page.waitForSelector('#ev-dialog[open]');
    await page.locator('#ev-items tr').first().click();
    await page.waitForSelector('#ev-item-dialog[open]');
    await page.waitForFunction(() => !/Chargement/.test(document.getElementById('evi-bonus-status').textContent));
    const st = await page.textContent('#evi-bonus-status');
    assert.match(st, /Aucun bonus défini — inactif en jeu|Brouillon — inactif en jeu/);
    const box = await page.textContent('#evi-bonus');
    assert.match(box, /Variante A — constante : \+0,01 dégât par coup sur tous les blocs/);
    assert.match(box, /Variante B — calendaire \(jeudi\) : \+0,03 dégât par coup sur tous les blocs — les jeudis/);
    assert.match(box, /0 % \(aucun\)/, 'vrai zéro visible (faible profondeur)');
    assert.match(box, /30 Novembre déterre l'Histoire \+ 31 Noël sous la mine dont 26 proposés = 61/);
    assert.match(box, /Un seul bonus par TYPE de souvenir/);
    log(w, `fiche : « ${st.trim()} », variantes A/B et cumul 30 + 31 = 61`);

    await page.evaluate(() => { for (const d of document.querySelectorAll('#evi-bonus details')) d.open = true; });
    await page.locator('#evi-bonus-fs').scrollIntoViewIfNeeded();
    const m = await page.evaluate(() => {
      const dlg = document.getElementById('ev-item-dialog');
      const fs = document.getElementById('evi-bonus-fs').getBoundingClientRect();
      const tables = [...document.querySelectorAll('#evi-bonus .evi-bonus-scroll')].map(s => s.getBoundingClientRect().right);
      const fsEl = document.getElementById('evi-bonus-fs');
      fsEl.style.display = 'none';
      const without = dlg.scrollWidth - dlg.clientWidth;   // débordement préexistant de la fiche objet (hors #81)
      fsEl.style.display = '';
      return { dlgOverflow: dlg.scrollWidth - dlg.clientWidth, without, pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        fsRight: fs.right, maxTableRight: Math.max(...tables), vw: innerWidth };
    });
    console.log(w, JSON.stringify(m));
    assert.ok(m.pageOverflow <= 0, 'aucun défilement horizontal de la page');
    assert.ok(m.dlgOverflow <= Math.max(0, m.without), 'la section Bonus n\'élargit pas la fiche');
    assert.ok(m.maxTableRight <= m.fsRight + 1, 'tableaux contenus (défilement interne si besoin)');
    await page.locator('#evi-bonus-fs').screenshot({ path: `${SHOTS}/souvenir-bonus-${w}.png` });

    const n0 = await draftCount();
    await page.click('#btn-evi-bonus-draft');
    await page.waitForSelector('#mb-dialog[open]');
    const mb = await page.evaluate(() => ({ src: document.getElementById('mb-source').value, label: document.getElementById('mb-label').value,
      value: document.getElementById('mb-value').value, itemOpen: document.getElementById('ev-item-dialog').open }));
    assert.match(mb.src, new RegExp(`^${EVENT}\\|`), 'souvenir lié prérempli');
    assert.match(mb.label, /^Bonus — /);
    assert.strictEqual(mb.value, '0.01');
    assert.ok(mb.itemOpen, 'fiche souvenir toujours ouverte dessous');
    await page.screenshot({ path: `${SHOTS}/souvenir-bonus-draft-${w}.png` });
    await page.click('#mb-dialog [data-close]');
    await page.waitForFunction(() => !document.getElementById('mb-dialog').open);
    assert.ok(await page.evaluate(() => document.getElementById('ev-item-dialog').open));
    assert.strictEqual(await draftCount(), n0, 'ouvrir puis fermer n\'enregistre rien');
    log(w, 'brouillon lié : fiche Micro-bonus préremplie par-dessus, fermée sans enregistrement');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  }
  await b.close();
  console.log('OK');
})().catch(e => { console.error(e); process.exit(1); });
