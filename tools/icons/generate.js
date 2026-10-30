#!/usr/bin/env node
/**
 * tools/icons/generate.js
 * Génère des propositions d'icône pour UN matériau via l'API OpenAI Images, hors ligne.
 *
 *   node tools/icons/generate.js <matériau> [--count 3] [--reference <png>] [--dry-run]
 *
 * - Prompt : prompt maître (tools/icons/prompt-master.md) + fiche du matériau
 *   (tools/icons/materials.json) ; `ownerPrompt` est envoyé mot pour mot s'il existe et
 *   qu'aucune référence n'est jointe.
 * - Référence : si une référence officielle validée existe (art/icons/v1/reference/*.png),
 *   elle est jointe SYSTÉMATIQUEMENT (édition) — `--no-reference` pour l'éviter explicitement.
 * - Budget : plafond local vérifié avant tout appel ; chaque appel est consigné (coût, usage).
 * - Sorties : art/icons/v1/candidates/<matériau>-<horodatage>-<lettre>/ (brut, PNG normalisé,
 *   WebP 256/128, aperçu sur fond sombre, generation.json). Rien n'est publié dans public/.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const oa     = require('./openai-images');
const { processIcon } = require('./process');

const ROOT = path.join(__dirname, '..', '..');
const ART = path.join(ROOT, 'art', 'icons', 'v1');
const REFERENCE_DIR = path.join(ART, 'reference');

function between(text, tag) {
  const m = text.match(new RegExp(`<!-- ${tag} -->\\n([\\s\\S]*?)\\n<!-- /${tag} -->`));
  if (!m) throw new Error(`bloc ${tag} introuvable dans prompt-master.md`);
  return m[1].trim();
}

function masterVersion(text) {
  return (text.match(/Version : `([^`]+)`/) || [])[1] || 'inconnue';
}

/** Prompt final d'un matériau (gabarit maître, ou prompt du propriétaire sans référence). */
function buildPrompt(material, { withReference }) {
  const master = fs.readFileSync(path.join(__dirname, 'prompt-master.md'), 'utf8');
  if (material.ownerPrompt && !withReference) {
    return { prompt: material.ownerPrompt, source: 'ownerPrompt (texte du propriétaire, mot pour mot)', masterVersion: masterVersion(master) };
  }
  const prompt = between(master, 'PROMPT')
    .replace('{{SUBJECT}}', material.subject)
    .replace('{{DETAILS}}', material.details)
    .replace('{{PALETTE}}', material.palette)
    .replace('{{REFERENCE}}', withReference ? ' ' + between(master, 'REFERENCE') : '');
  return { prompt, source: 'prompt-master.md', masterVersion: masterVersion(master) };
}

function officialReference() {
  if (!fs.existsSync(REFERENCE_DIR)) return null;
  const refs = fs.readdirSync(REFERENCE_DIR).filter((f) => f.endsWith('.png')).sort();
  return refs.length ? path.join(REFERENCE_DIR, refs[0]) : null;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
}

async function main(argv) {
  const name = argv[0];
  const opt = (k, d) => { const i = argv.indexOf(k); return i > 0 ? argv[i + 1] : d; };
  const count = Number(opt('--count', 1));
  const dryRun = argv.includes('--dry-run');
  const materials = JSON.parse(fs.readFileSync(path.join(__dirname, 'materials.json'), 'utf8')).materials;
  const material = materials[name];
  if (!material) throw new Error(`matériau inconnu : ${name} (voir tools/icons/materials.json)`);

  let reference = opt('--reference', null);
  if (!reference && !argv.includes('--no-reference')) reference = officialReference();
  if (reference && !fs.existsSync(reference)) throw new Error(`référence introuvable : ${reference}`);

  const cfg = oa.loadConfig();
  const budget = oa.checkBudget(cfg, count);
  const { prompt, source, masterVersion: mv } = buildPrompt(material, { withReference: Boolean(reference) });
  const req = oa.buildRequest(cfg, { prompt, reference });
  console.log(`[icons] ${name} : ${count} proposition(s), ${req.endpoint.split('/v1/')[1]}, modèle ${req.params.model}, ` +
    `référence ${reference ? path.basename(reference) : 'aucune'}, budget ${budget.spent.toFixed(2)}/${cfg.budgetUsd} USD`);
  if (dryRun) { console.log(JSON.stringify({ params: req.params, prompt }, null, 2)); return []; }

  const run = stamp();
  const results = [];
  for (let i = 0; i < count; i++) {
    const letter = String.fromCharCode(97 + i);
    const id = `${name}-${run}-${letter}`;
    const dir = path.join(ART, 'candidates', id);
    const started = Date.now();
    const r = i === 0 ? req : oa.buildRequest(cfg, { prompt, reference }); // corps multipart non réutilisable
    let out;
    try {
      out = await oa.callImages(cfg, r);
    } catch (err) {
      oa.appendLedger({ at: new Date().toISOString(), material: name, candidate: id, model: r.params.model, endpoint: r.endpoint, ok: false, error: err.message.slice(0, 300), cost_usd: 0 });
      console.error(`[icons] ${id} : ÉCHEC ${err.message}`);
      results.push({ id, ok: false, error: err.message });
      if (/^OpenAI 4\d\d /.test(err.message)) { console.error('[icons] erreur de requête : propositions suivantes annulées'); break; }
      continue;
    }
    const cost = oa.costFromUsage(cfg, out.usage);
    fs.mkdirSync(dir, { recursive: true });
    const rawFile = path.join(dir, `${name}-brut.png`);
    fs.writeFileSync(rawFile, out.png);
    const entry = {
      at: new Date().toISOString(), material: name, candidate: id, ok: true, model: r.params.model, endpoint: r.endpoint,
      params: r.params, prompt_sha256: crypto.createHash('sha256').update(prompt).digest('hex'), usage: out.usage,
      cost_usd: cost.cost_usd, cost_basis: cost.basis, duration_ms: Date.now() - started,
      raw_sha256: crypto.createHash('sha256').update(out.png).digest('hex'),
    };
    oa.appendLedger(entry);
    let processed = null, processError = null;
    try {
      processed = await processIcon(rawFile, dir, name);
    } catch (err) {
      processError = err.message;
    }
    const meta = {
      ...entry, prompt, prompt_source: source, prompt_master_version: mv, revised_prompt: out.revised_prompt,
      reference: reference ? path.relative(ROOT, reference) : null, processing: processed && { ...processed, files: undefined },
      processing_error: processError, tool: 'tools/icons/generate.js', library: 'v1',
    };
    fs.writeFileSync(path.join(dir, 'generation.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log(`[icons] ${id} : OK, coût ${cost.cost_usd} USD (${cost.basis})` + (processError ? ` — CONTRÔLE ÉCHOUÉ : ${processError}` : ''));
    results.push({ id, ok: !processError, dir, cost: cost.cost_usd, processError });
  }
  const spent = oa.spentUsd(oa.readLedger());
  console.log(`[icons] terminé — dépense cumulée estimée : ${spent.toFixed(4)} USD / plafond ${cfg.budgetUsd} USD`);
  return results;
}

module.exports = { buildPrompt, officialReference };

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => { console.error(`[icons] ÉCHEC : ${err.message}`); process.exitCode = 1; });
}
