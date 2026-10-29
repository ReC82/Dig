/**
 * tools/icons/process.js
 * Normalise et contrôle une icône générée, puis produit les exports du jeu.
 *
 *  1. Contrôle de la source : PNG, 4 canaux, vrai canal alpha (coins transparents, part de
 *     pixels transparents, bord anti-crénelé) — une « transparence » peinte (damier) échoue.
 *  2. Normalisation : recadrage sur la boîte englobante alpha, mise à l'échelle et recentrage
 *     sur une toile 1024×1024 transparente avec une marge de 12 % de chaque côté.
 *  3. Exports : PNG RGBA 1024 (maître), WebP 256 et 128 (alpha conservé).
 *  4. Lisibilité : contraste de luminance objet / fond sombre du bloc à 128 px.
 *
 * CLI : node tools/icons/process.js <source.png> <dossier-sortie> <nom> [--margin 0.12]
 */

'use strict';

const sharp = require('sharp');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const SIZE = 1024;
const ALPHA_ON = 16; // seuil « pixel visible » pour la boîte englobante

/** Fonds sombres du composant réel (dégradé du bloc « pierre » et fond de page). */
const DARK_BACKGROUNDS = { 'bloc pierre (#4b5563)': [0x4b, 0x55, 0x63], 'bloc pierre (#374151)': [0x37, 0x41, 0x51], 'page (#111827)': [0x11, 0x18, 0x27] };

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function rawRgba(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Statistiques alpha d'une image RGBA brute. */
function alphaStats({ data, width, height }) {
  let transparent = 0, partial = 0, minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a === 0) transparent++;
      else if (a < 255) partial++;
      if (a >= ALPHA_ON) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const total = width * height;
  const corner = (x, y) => data[(y * width + x) * 4 + 3];
  return {
    transparentRatio: transparent / total,
    partialRatio: partial / total,
    cornersTransparent: [corner(0, 0), corner(width - 1, 0), corner(0, height - 1), corner(width - 1, height - 1)].every((a) => a === 0),
    bbox: maxX < 0 ? null : { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX + 1, height: maxY - minY + 1 },
  };
}

/** Contrôle d'une source générée : lève une erreur explicite si l'alpha n'est pas réel. */
async function checkSource(input) {
  const meta = await sharp(input).metadata();
  const problems = [];
  if (meta.format !== 'png') problems.push(`format ${meta.format} (PNG attendu)`);
  if (meta.channels !== 4 || !meta.hasAlpha) problems.push(`${meta.channels} canaux sans alpha (RGBA attendu)`);
  const stats = alphaStats(await rawRgba(input));
  if (!stats.cornersTransparent) problems.push('coins non transparents');
  if (stats.transparentRatio < 0.2) problems.push(`seulement ${(stats.transparentRatio * 100).toFixed(1)} % de pixels transparents`);
  if (stats.partialRatio === 0) problems.push('aucun pixel semi-transparent (contour non anti-crénelé : détourage suspect)');
  if (!stats.bbox) problems.push('image entièrement transparente');
  return { width: meta.width, height: meta.height, channels: meta.channels, stats, ok: problems.length === 0, problems };
}

/** Recadre sur l'objet et le recentre avec une marge régulière ; rend un PNG RGBA 1024. */
async function normalize(input, margin = 0.12) {
  const src = alphaStats(await rawRgba(input));
  if (!src.bbox) throw new Error('image entièrement transparente');
  const box = Math.round(SIZE * (1 - 2 * margin));
  const object = await sharp(input).ensureAlpha()
    .extract({ left: src.bbox.left, top: src.bbox.top, width: src.bbox.width, height: src.bbox.height })
    .resize({ width: box, height: box, fit: 'inside', kernel: 'lanczos3' })
    .png().toBuffer({ resolveWithObject: true });
  const left = Math.round((SIZE - object.info.width) / 2);
  const top = Math.round((SIZE - object.info.height) / 2);
  return sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: object.data, left, top }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Marges réelles (en fraction de la toile) d'un PNG normalisé. */
async function margins(input) {
  const raw = await rawRgba(input);
  const { bbox } = alphaStats(raw);
  return {
    left: bbox.left / raw.width, top: bbox.top / raw.height,
    right: (raw.width - 1 - bbox.right) / raw.width, bottom: (raw.height - 1 - bbox.bottom) / raw.height,
    coverage: Math.max(bbox.width, bbox.height) / raw.width,
  };
}

const lum = ([r, g, b]) => {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Contraste WCAG entre la luminance moyenne de l'objet (128 px) et chaque fond sombre. */
async function legibility(png) {
  const { data } = await rawRgba(await sharp(png).resize(128, 128).png().toBuffer());
  let n = 0; const sum = [0, 0, 0]; let light = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    n++; for (let k = 0; k < 3; k++) sum[k] += data[i + k];
    if (lum([data[i], data[i + 1], data[i + 2]]) > 0.25) light++;
  }
  const mean = sum.map((s) => s / n);
  const L = lum(mean);
  const out = { objectMeanRgb: mean.map((v) => Math.round(v)), highlightRatio: Number((light / n).toFixed(3)), contrast: {} };
  for (const [name, rgb] of Object.entries(DARK_BACKGROUNDS)) {
    const Lb = lum(rgb);
    out.contrast[name] = Number(((Math.max(L, Lb) + 0.05) / (Math.min(L, Lb) + 0.05)).toFixed(2));
  }
  return out;
}

/** Aperçu de contrôle : l'icône (128 px) sur chacun des fonds sombres, côte à côte. */
async function darkPreview(png) {
  const icon = await sharp(png).resize(128, 128).png().toBuffer();
  const tiles = Object.values(DARK_BACKGROUNDS);
  const W = 160 * tiles.length;
  return sharp({ create: { width: W, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(tiles.flatMap((rgb, i) => [
      { input: { create: { width: 160, height: 160, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }, left: i * 160, top: 0 },
      { input: icon, left: i * 160 + 16, top: 16 },
    ]))
    .png().toBuffer();
}

/** Chaîne complète : contrôle, normalisation, exports, mesures. */
async function processIcon(source, outDir, name, { margin = 0.12 } = {}) {
  const check = await checkSource(source);
  if (!check.ok) throw new Error(`source refusée : ${check.problems.join(' ; ')}`);
  fs.mkdirSync(outDir, { recursive: true });
  const master = await normalize(source, margin);
  const files = {
    png: path.join(outDir, `${name}.png`),
    webp256: path.join(outDir, `${name}-256.webp`),
    webp128: path.join(outDir, `${name}-128.webp`),
    darkPreview: path.join(outDir, `${name}-sur-fond-sombre.png`),
  };
  fs.writeFileSync(files.png, master);
  await sharp(master).resize(256, 256, { kernel: 'lanczos3' }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(files.webp256);
  await sharp(master).resize(128, 128, { kernel: 'lanczos3' }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(files.webp128);
  fs.writeFileSync(files.darkPreview, await darkPreview(master));

  const verify = {};
  for (const [k, f] of Object.entries(files)) {
    if (k === 'darkPreview') continue;
    const m = await sharp(f).metadata();
    verify[k] = { width: m.width, height: m.height, channels: m.channels, hasAlpha: m.hasAlpha, bytes: fs.statSync(f).size, sha256: sha256(fs.readFileSync(f)) };
  }
  return { source: { file: path.basename(source), ...check }, margins: await margins(master), legibility: await legibility(master), files, verify };
}

module.exports = { SIZE, checkSource, normalize, margins, legibility, processIcon, alphaStats, rawRgba };

if (require.main === module) {
  const [source, outDir, name] = process.argv.slice(2);
  const mi = process.argv.indexOf('--margin');
  processIcon(source, outDir, name, { margin: mi > 0 ? Number(process.argv[mi + 1]) : 0.12 })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((err) => { console.error(`[process] ÉCHEC : ${err.message}`); process.exitCode = 1; });
}
