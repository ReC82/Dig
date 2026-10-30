#!/usr/bin/env node
/**
 * tools/icons/board.js
 * Planche de prévisualisation exhaustive de la bibliothèque v1 : les 14 blocs du jeu
 * (Blocks.TYPES), y compris les plus rares, chacun sur le fond réel de son bloc, avec son
 * nom, sa rareté, sa profondeur d'apparition, son statut (validé / à valider) et l'emoji
 * legacy qu'il remplace. Rendu par Chromium headless (playwright-core, non requis par le jeu).
 *
 *   node tools/icons/board.js --out <fichier.png> [--webp <fichier.webp>] [--chromium <headless_shell>]
 *
 * Seuls les fichiers du dépôt sont lus (blocks.js, i18n.js, library.json, exports WebP 256).
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const vm    = require('vm');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

function loadGlobal(file, name) {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8') + `\nthis.__v = ${name};`, ctx);
  return ctx.__v;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Données de la planche, dans l'ordre du jeu. */
function boardEntries() {
  const types = loadGlobal('public/js/blocks.js', 'Blocks').TYPES;
  const I18n = loadGlobal('public/js/i18n.js', 'I18n'); // langue par défaut : fr
  const lib = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets/icons/library.json'), 'utf8'));
  return Array.from(types, (t) => {
    const id = String(t.name).replace(/^block\./, '');
    const entry = lib.libraries.v1.materials[id] || null;
    const file = entry && path.join(ROOT, 'public', lib.libraries.v1.base, entry.webp['256']);
    return {
      id, name: I18n.t('block.' + id), rarity: I18n.t('rarity.' + String(t.rarityKey).replace('-', '_')),
      depth: `dès ${t.minDepth} m`, // aucune profondeur maximale (#22)
      color: t.color, legacy: t.icon,
      status: !entry ? 'absent (emoji)' : entry.validated ? `validé ${entry.validated}` : 'à valider',
      validated: Boolean(entry && entry.validated),
      image: file && fs.existsSync(file) ? 'data:image/webp;base64,' + fs.readFileSync(file).toString('base64') : null,
    };
  });
}

function html(entries) {
  const date = new Date().toISOString().slice(0, 10);
  const tiles = entries.map((e) => `
    <div class="tile">
      <div class="block" style="background:${esc(e.color)}">${e.image ? `<img src="${e.image}" alt="">` : `<span class="emoji">${esc(e.legacy)}</span>`}</div>
      <div class="name">${esc(e.name)}</div>
      <div class="meta">${esc(e.rarity)} · ${esc(e.depth)}</div>
      <div class="meta"><span class="status ${e.validated ? 'ok' : 'todo'}">${esc(e.status)}</span> · avant : <span class="legacy">${esc(e.legacy)}</span></div>
      <div class="id">${esc(e.id)}</div>
    </div>`).join('');
  const covered = entries.filter((e) => e.image).length;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;background:#111827;color:#e5e7eb;font-family:"DejaVu Sans",Arial,sans-serif}
    .wrap{width:1080px;padding:28px 30px 34px;box-sizing:border-box}
    h1{margin:0 0 4px;font-size:26px;color:#fbbf24} p{margin:0 0 22px;color:#9ca3af;font-size:15px}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:22px 18px}
    .tile{display:flex;flex-direction:column;align-items:center;text-align:center}
    .block{width:170px;height:170px;border-radius:20px;border:2px solid rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center}
    .block img{width:112px;height:112px} .emoji{font-size:72px}
    .name{margin-top:9px;font-size:18px;font-weight:700} .meta{font-size:13px;color:#9ca3af;margin-top:3px}
    .status.ok{color:#4ade80;font-weight:700} .status.todo{color:#fbbf24;font-weight:700}
    .legacy{font-size:15px} .id{font-size:11px;color:#6b7280;margin-top:2px;font-family:monospace}
  </style></head><body><div class="wrap">
    <h1>DIG! — icônes v1 : planche complète</h1>
    <p>${covered}/${entries.length} blocs du catalogue d'origine, dans l'ordre du jeu, sur le fond réel de leur bloc · ${date} · affichées par défaut dans le jeu (retour aux emoji : <span style="white-space:nowrap">?icons=legacy</span>)</p>
    <div class="grid">${tiles}</div></div></body></html>`;
}

async function main() {
  const out = opt('--out', null);
  if (!out) throw new Error('usage : node tools/icons/board.js --out <fichier.png> [--webp <fichier.webp>]');
  const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
  const browser = await chromium.launch({ executablePath: opt('--chromium', undefined) });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(html(boardEntries()), { waitUntil: 'load' });
    await page.locator('.wrap').screenshot({ path: out });
  } finally {
    await browser.close();
  }
  const webp = opt('--webp', null);
  if (webp) await sharp(out).webp({ quality: 88 }).toFile(webp);
  console.log(`[icons] planche : ${out}${webp ? ' + ' + webp : ''}`);
}

module.exports = { boardEntries };

if (require.main === module) {
  main().catch((err) => { console.error(`[icons] ÉCHEC : ${err.message}`); process.exitCode = 1; });
}
