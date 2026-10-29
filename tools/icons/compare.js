#!/usr/bin/env node
/**
 * tools/icons/compare.js
 * Comparaison visuelle avant / après dans le VRAI composant du jeu (#block, taille réelle),
 * pour chacun des 14 matériaux, avec Chromium headless (playwright-core, non requis par le jeu).
 *
 *   node tools/icons/compare.js --before http://127.0.0.1:3111 --after http://127.0.0.1:3112 --out <dossier>
 *       [--chromium <chemin headless_shell>] [--scale 2]
 *
 * Captures : avant (legacy), après legacy (défaut), après v1 (?icons=v1). Contrôles :
 *   - après legacy ≡ avant au pixel près pour les 14 matériaux ;
 *   - après v1 ≡ avant pour tout matériau absent du manifeste v1.
 * Sorties : <dossier>/<mode>/<matériau>.png, planche comparaison.png, resultats.json.
 * Code de sortie 1 si une différence inattendue est trouvée.
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const NO_MOTION = '*,*::before,*::after{animation:none!important;transition:none!important}';

async function capture(browser, base, query, outDir, scale) {
  const page = await browser.newPage({ viewport: { width: 420, height: 860 }, deviceScaleFactor: scale });
  await page.addInitScript(() => { try { localStorage.setItem('dig_lang', 'fr'); } catch (_) { /* rien */ } });
  await page.goto(base + '/' + query, { waitUntil: 'networkidle' });
  await page.addStyleTag({ content: NO_MOTION });
  await page.waitForFunction(() => typeof Blocks !== 'undefined' && Blocks.TYPES.length > 0);
  const ids = await page.evaluate(() => Blocks.TYPES.map((t) => t.name.replace(/^block\./, '')));
  fs.mkdirSync(outDir, { recursive: true });
  const shots = {};
  for (let i = 0; i < ids.length; i++) {
    await page.evaluate((idx) => {
      const type = Blocks.TYPES[idx];
      Blocks.current = { type, hp: 10, maxHp: 10, reward: 1 };
      document.getElementById('block').className = '';
      renderBlock();
    }, i);
    await page.evaluate(() => Promise.all([...document.querySelectorAll('#block img')].map((im) => (im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })))));
    const file = path.join(outDir, `${ids[i]}.png`);
    await page.locator('#block').screenshot({ path: file });
    shots[ids[i]] = { file, lib: await page.evaluate(() => document.getElementById('block-icon').getAttribute('data-icon-lib') || 'legacy') };
  }
  await page.close();
  return shots;
}

async function samePixels(a, b) {
  const [ra, rb] = await Promise.all([a, b].map((f) => sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) return { same: false, diff: 'dimensions' };
  let diff = 0;
  for (let i = 0; i < ra.data.length; i++) if (ra.data[i] !== rb.data[i]) diff++;
  return { same: diff === 0, diff };
}

async function sheet(rows, file) {
  const tiles = [];
  const W = 120;
  rows.forEach((r, y) => r.files.forEach((f, x) => tiles.push({ f, left: x * (W + 8) + 8, top: y * (W + 8) + 8 })));
  const width = Math.max(...rows.map((r) => r.files.length)) * (W + 8) + 8;
  const height = rows.length * (W + 8) + 8;
  const inputs = await Promise.all(tiles.map(async (t) => ({ input: await sharp(t.f).resize(W, W, { fit: 'contain', background: '#0b0f19' }).png().toBuffer(), left: t.left, top: t.top })));
  await sharp({ create: { width, height, channels: 4, background: '#0b0f19' } }).composite(inputs).png().toFile(file);
}

(async () => {
  const before = opt('--before'); const after = opt('--after'); const out = opt('--out');
  const scale = Number(opt('--scale', 2));
  const browser = await chromium.launch({ executablePath: opt('--chromium', undefined) });
  try {
    const b = await capture(browser, before, '', path.join(out, 'avant'), scale);
    const al = await capture(browser, after, '?icons=legacy', path.join(out, 'apres-legacy'), scale);
    const av = await capture(browser, after, '?icons=v1', path.join(out, 'apres-v1'), scale);
    const results = {};
    let unexpected = 0;
    for (const id of Object.keys(b)) {
      const legacy = await samePixels(b[id].file, al[id].file);
      const v1 = await samePixels(b[id].file, av[id].file);
      const expectSameV1 = av[id].lib !== 'v1';
      if (!legacy.same || (expectSameV1 && !v1.same)) unexpected++;
      results[id] = { legacyIdentiqueAvant: legacy.same, v1Bibliotheque: av[id].lib, v1IdentiqueAvant: v1.same, v1Attendu: expectSameV1 ? 'identique (pas d’asset v1)' : 'image v1' };
    }
    await sheet(Object.keys(b).map((id) => ({ files: [b[id].file, al[id].file, av[id].file] })), path.join(out, 'comparaison.png'));
    fs.writeFileSync(path.join(out, 'resultats.json'), JSON.stringify({ scale, results, differencesInattendues: unexpected }, null, 2) + '\n');
    console.log(JSON.stringify({ differencesInattendues: unexpected, results }, null, 2));
    if (unexpected) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((err) => { console.error(`[compare] ÉCHEC : ${err.message}`); process.exitCode = 1; });
