/**
 * Essai navigateur #62 : tous les onglets admin utilisent le conteneur commun (≤ 1440 px, centré, sans défilement
 * horizontal de la page) à 1920, 1440, 1280 et 390 px ; ⚙ Config : aucun chevauchement libellé / clé / champ,
 * recherche, compteur de modifications, enregistrement des seuls réglages modifiés ; Budget IA lisible.
 * Hors `npm test` (navigateur requis). Captures dans OUT.
 *
 * Lancer (serveur de test démarré, base de test) :
 *   PW=/chemin/node_modules/playwright-core CHROME=/chemin/chrome-headless-shell BASE=http://127.0.0.1:3101 \
 *   ADMIN=<secret> OUT=/tmp/dossier [BEFORE_CSS=/tmp/ancien-admin.css] node test/e2e/admin-layout.e2e.js
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const { chromium } = require(process.env.PW);
const { admOpenTab } = require('./_admin-nav');
const BASE = process.env.BASE, ADMIN = process.env.ADMIN, OUT = process.env.OUT || '/tmp';
const VIEWPORTS = [[1920, 1080], [1440, 900], [1280, 800], [390, 844]];
const SHOTS = ['config', 'security', 'icons', 'collections', 'economy'];
const errors = [];

async function open(b, [w, h], css) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500 });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${w}: ${e.message}`));
  if (css) await page.route('**/admin/admin.css*', r => r.fulfill({ contentType: 'text/css', body: css }));
  await page.goto(`${BASE}/admin/`);
  await page.fill('#secret-input', ADMIN);
  await page.click('#secret-btn');
  await page.waitForSelector('#admin-app:not(.hidden)');
  return { ctx, page };
}

async function measureTab(page, tab) {
  await admOpenTab(page, tab);
  await page.waitForTimeout(tab === 'config' ? 600 : 300);
  return page.evaluate(t => {
    // Centrage mesuré dans la zone de contenu, à droite du menu latéral (#70)
    const sec = document.getElementById(`tab-${t}`).getBoundingClientRect();
    const main = document.getElementById('admin-main').getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    return { w: Math.round(sec.width), mainW: Math.round(main.width), left: Math.round(sec.left - main.left), right: Math.round(main.right - sec.right),
      overflow: document.documentElement.scrollWidth - vw };
  }, tab);
}

/** Rectangles des libellés, explications, clés et champs de chaque réglage : aucun ne doit en recouvrir un autre. */
async function configOverlaps(page) {
  return page.evaluate(() => {
    const out = [];
    const hit = (a, b) => a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    for (const row of document.querySelectorAll('#config-rows .config-row')) {
      if (!row.offsetParent) continue;
      const parts = [...row.querySelectorAll('.config-label, .config-hint, .config-key, .config-value')].map(e => [e.className, e.getBoundingClientRect()]);
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        if (hit(parts[i][1], parts[j][1])) out.push(`${row.querySelector('.config-key').textContent}: ${parts[i][0]} × ${parts[j][0]}`);
      }
      const r = row.getBoundingClientRect();
      for (const [c, e] of parts) if (e.right > r.right + 1) out.push(`${row.querySelector('.config-key').textContent}: ${c} déborde`);
    }
    return out;
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
  const before = process.env.BEFORE_CSS ? fs.readFileSync(process.env.BEFORE_CSS, 'utf8') : null;
  let tabs;
  for (const vp of VIEWPORTS) {
    if (before) {
      const { ctx, page } = await open(b, vp, before);
      for (const t of ['config', 'security', 'icons']) {
        console.log('avant', vp[0], t, JSON.stringify(await measureTab(page, t)));
        if (vp[0] === 1920 || vp[0] === 390) await page.screenshot({ path: `${OUT}/avant-${t}-${vp[0]}.png`, fullPage: t === 'config' });
      }
      await ctx.close();
    }
    const { ctx, page } = await open(b, vp, null);
    tabs ??= await page.$$eval('.tab-btn[data-tab]', bs => bs.map(x => x.dataset.tab));
    for (const t of tabs) {
      const m = await measureTab(page, t);
      console.log('après', vp[0], t, JSON.stringify(m));
      assert.ok(m.overflow <= 0, `${vp[0]} ${t} : défilement horizontal de la page (${m.overflow})`);
      if (vp[0] >= 1280) {
        assert.ok(m.w <= 1440 && m.w >= Math.min(1440, m.mainW) - 2, `${vp[0]} ${t} : largeur ${m.w}`);
        assert.ok(Math.abs(m.left - m.right) <= 2, `${vp[0]} ${t} : centré (${m.left} / ${m.right})`);
      }
      if (t === 'config') {
        const o = await configOverlaps(page);
        assert.deepStrictEqual(o, [], `${vp[0]} chevauchements Config`);
      }
      if (SHOTS.includes(t) && (vp[0] === 1920 || vp[0] === 390 || (vp[0] === 1440 && t === 'config'))) {
        await page.screenshot({ path: `${OUT}/apres-${t}-${vp[0]}.png`, fullPage: t === 'config' });
      }
    }
    await ctx.close();
  }

  // Parcours Config (PC) : recherche, compteur, enregistrement du seul réglage modifié
  const { ctx, page } = await open(b, [1440, 900], null);
  await measureTab(page, 'config');
  const n = await page.locator('#config-rows .config-row').count();
  assert.ok(n >= 21, `${n} réglages`);
  assert.ok(await page.locator('#cfg-g-advanced .config-value:disabled').count() === 2, 'obsolètes en lecture seule');
  await page.fill('#cfg-search', 'minimum pour');
  const visible = await page.$$eval('#config-rows .config-row', rs => rs.filter(r => r.offsetParent).map(r => r.querySelector('.config-key').textContent));
  assert.deepStrictEqual(visible, ['min_active_players_per_league'], 'recherche par description');
  await page.fill('#cfg-search', 'zzz');
  assert.ok(await page.isVisible('#cfg-empty'));
  await page.fill('#cfg-search', '');
  const puts = [];
  page.on('request', r => { if (r.method() === 'PUT' && r.url().includes('/api/admin/config')) puts.push(r.postDataJSON()); });
  await page.fill('#cfg-gems_cap', '120');
  assert.match(await page.textContent('#cfg-pending'), /^1 modification non enregistrée$/);
  assert.ok(await page.locator('.config-row.is-changed').count() === 1);
  await page.screenshot({ path: `${OUT}/apres-config-modif-1440.png` });
  await page.click('#btn-save-config');
  await page.waitForSelector('#config-msg:not(.hidden)');
  assert.deepStrictEqual(puts, [{ key: 'gems_cap', value: '120' }], 'seul le réglage modifié est envoyé');
  assert.strictEqual(await page.textContent('#cfg-pending'), '');
  // remise à la valeur d'origine (base de test)
  await page.fill('#cfg-gems_cap', '100');
  await page.click('#btn-save-config');
  await page.waitForTimeout(300);
  // Budget IA : état en tête
  await page.locator('#ai-budget-card').scrollIntoViewIfNeeded();
  const st = await page.textContent('#aib-cap-state');
  assert.match(st, /^(✅|⛔|⏳)/, st);
  await page.locator('#ai-budget-card').screenshot({ path: `${OUT}/apres-budget-ia-1440.png` });
  await ctx.close();

  await b.close();
  assert.deepStrictEqual(errors, [], 'erreurs JavaScript');
  console.log('OK admin-layout');
})().catch(e => { console.error(e); process.exit(1); });
