#!/usr/bin/env node
/**
 * tools/icons/promote.js
 * Intègre une proposition générée (art/icons/v1/candidates/<id>/) dans la bibliothèque v1
 * en statut « pilote » (aperçu ?icons=v1 seulement ; defaultLibrary n'est jamais modifié).
 *
 *   node tools/icons/promote.js <id-proposition> [<id-proposition> …]
 *
 * Pour chaque proposition (dont le contrôle process.js a réussi) :
 *   - copie les WebP 128 / 256 vers public/assets/icons/v1/<matériau>-<empreinte>-<taille>.webp
 *     (nom nouveau à chaque image : les assets sont mis en cache « immutable ») ;
 *   - conserve le maître normalisé 1024 en WebP sans perte : art/icons/v1/pilot/<matériau>.webp ;
 *   - écrit la provenance art/icons/v1/pilot/<matériau>.json (modèle, prompt, coût, empreintes) ;
 *   - ajoute ou remplace l'entrée du matériau dans public/assets/icons/library.json.
 * Un matériau déjà validé par le propriétaire (champ `validated`) est refusé.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const sharp  = require('sharp');

const ROOT = path.join(__dirname, '..', '..');
const ART = path.join(ROOT, 'art', 'icons', 'v1');
const LIBRARY = path.join(ROOT, 'public', 'assets', 'icons', 'library.json');
const PUBLIC_V1 = path.join(ROOT, 'public', 'assets', 'icons', 'v1');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

async function promote(id, lib) {
  const dir = path.join(ART, 'candidates', id);
  const gen = JSON.parse(fs.readFileSync(path.join(dir, 'generation.json'), 'utf8'));
  const name = gen.material;
  if (!gen.ok || gen.processing_error || !gen.processing) throw new Error(`${id} : contrôle process.js non réussi`);
  const current = lib.libraries.v1.materials[name];
  if (current && current.validated) throw new Error(`${name} : déjà validé par le propriétaire, non remplacé`);

  // Nom de fichier avec empreinte : les assets sont servis « immutable » (1 an) ; remplacer
  // une image sous le même nom laisserait l'ancienne dans le cache des navigateurs.
  const tag = sha256(path.join(dir, `${name}-256.webp`)).slice(0, 8);
  const files = {}, exports = {};
  for (const size of ['128', '256']) {
    files[size] = `${name}-${tag}-${size}.webp`;
    const dest = path.join(PUBLIC_V1, files[size]);
    fs.copyFileSync(path.join(dir, `${name}-${size}.webp`), dest);
    exports[size] = { file: rel(dest), sha256: sha256(dest) };
  }
  // Exports précédents de ce pilote (non validé) : retirés, la provenance reste dans git.
  if (current && current.status === 'pilote') {
    for (const f of Object.values(current.webp)) {
      if (!Object.values(files).includes(f)) fs.rmSync(path.join(PUBLIC_V1, f), { force: true });
    }
  }
  const master = path.join(ART, 'pilot', `${name}.webp`);
  await sharp(path.join(dir, `${name}.png`)).webp({ lossless: true }).toFile(master);

  const provFile = path.join(ART, 'pilot', `${name}.json`);
  const previous = fs.existsSync(provFile) ? JSON.parse(fs.readFileSync(provFile, 'utf8')) : null;
  const prov = {
    material: name,
    role: 'pilote v1 (aperçu ?icons=v1), NON validé par le propriétaire',
    status: 'pilote',
    choice: 'génération unique (consigne du propriétaire du 30/10/2026 : une image par bloc)',
    candidate: id,
    replaces: previous && previous.candidate !== id ? previous.candidate : undefined,
    model: gen.model,
    endpoint: gen.endpoint,
    params: gen.params,
    prompt: gen.prompt,
    prompt_source: gen.prompt_source,
    prompt_master_version: gen.prompt_master_version,
    reference: gen.reference,
    raw_sha256: gen.raw_sha256,
    cost_usd: gen.cost_usd,
    generatedAt: gen.at,
    legibility: gen.processing.legibility,
    master: { file: rel(master), format: 'WebP sans perte 1024×1024 RGBA (PNG normalisé)', sha256: sha256(master) },
    exports,
  };
  fs.writeFileSync(provFile, JSON.stringify(prov, null, 2) + '\n');

  lib.libraries.v1.materials[name] = {
    webp: { 128: files['128'], 256: files['256'] },
    provenance: rel(provFile),
    status: 'pilote',
  };
  return { name, id, cost: gen.cost_usd };
}

async function main(ids) {
  if (!ids.length) throw new Error('usage : node tools/icons/promote.js <id-proposition> …');
  const lib = JSON.parse(fs.readFileSync(LIBRARY, 'utf8'));
  const defaultBefore = lib.defaultLibrary;
  for (const id of ids) {
    const r = await promote(id, lib);
    console.log(`[icons] ${r.name} ← ${r.id} (${r.cost} USD)`);
  }
  lib.defaultLibrary = defaultBefore; // jamais modifié ici
  fs.writeFileSync(LIBRARY, JSON.stringify(lib, null, 2) + '\n');
}

module.exports = { promote };

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(`[icons] ÉCHEC : ${err.message}`); process.exitCode = 1; });
}
