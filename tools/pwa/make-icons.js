#!/usr/bin/env node
/**
 * tools/pwa/make-icons.js — génère les icônes d'installation (PWA, iOS) de DIG! (#21)
 *
 * Dessin vectoriel simple (pioche dorée sur le fond du jeu), sans police ni
 * service externe. Usage : node tools/pwa/make-icons.js (sharp en devDependency).
 * Les PNG produits sont versionnés dans public/assets/pwa/.
 */
'use strict';

const path  = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', '..', 'public', 'assets', 'pwa');

/** Pioche dorée centrée ; `scale` < 1 laisse la marge exigée par les icônes « maskable ». */
function svg(scale, rounded) {
  const r = rounded ? 112 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%">
      <stop offset="0" stop-color="#22223a"/><stop offset="1" stop-color="#0f0f1a"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#d4a000"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${r}" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${scale}) rotate(-45) translate(-256 -256)">
    <rect x="236" y="150" width="40" height="300" rx="16" fill="#8b5a2b"/>
    <rect x="236" y="150" width="14" height="300" rx="7" fill="#a8703a"/>
    <path d="M86 196 Q256 66 426 196 L410 214 Q256 128 102 214 Z" fill="url(#gold)"
          stroke="#7a5a00" stroke-width="6" stroke-linejoin="round"/>
    <rect x="222" y="132" width="68" height="62" rx="12" fill="#6b7280" stroke="#374151" stroke-width="6"/>
  </g>
</svg>`;
}

async function render(file, size, scale, rounded) {
  await sharp(Buffer.from(svg(scale, rounded))).resize(size, size).png({ compressionLevel: 9 })
    .toFile(path.join(OUT, file));
  console.log(`${file} (${size}×${size})`);
}

(async () => {
  await render('icon-192.png',          192, 1.0,  true);
  await render('icon-512.png',          512, 1.0,  true);
  await render('icon-maskable-512.png', 512, 0.72, false);
  await render('apple-touch-icon.png',  180, 0.9,  false);
})().catch((err) => { console.error(err); process.exit(1); });
