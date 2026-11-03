#!/usr/bin/env node
/**
 * tools/i18n/cli.js — Langues extensibles de DIG! (#59)
 *
 *   node tools/i18n/cli.js status   [code…]            couverture, file, corrections humaines
 *   node tools/i18n/cli.js check    <code> [--json]     contrôles qualité (code 1 si erreur bloquante)
 *   node tools/i18n/cli.js scan                         clés utilisées dans le code mais absentes du français
 *   node tools/i18n/cli.js translate <code> [--apply] [--batch 40] [--max-batches 3] [--max-usd 0.5]
 *                                                       sans --apply : simulation, aucun appel payant
 *   node tools/i18n/cli.js build    <code>              génère public/js/locales/<code>.js
 *   node tools/i18n/cli.js export   <code> [fichier.csv]  feuille de relecture pour locuteur natif
 *   node tools/i18n/cli.js import   <code> <fichier.csv> --by "<prénom>"   corrections natives (protégées)
 *   node tools/i18n/cli.js correct  <code> <clé> "<texte>" --by "<prénom>"
 */
'use strict';

const fs = require('fs');
const lib = require('./lib');
const check = require('./check');
const translate = require('./translate');

const argv = process.argv.slice(2);
const flag = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
const has = name => argv.includes(`--${name}`);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['--apply', '--json'].includes(argv[i - 1])));

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ';' || c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const show = v => (typeof v === 'string' ? v : JSON.stringify(v));

/** Enregistre une correction humaine (prioritaire, jamais écrasée par l'IA). */
function correct(code, key, text, by) {
  const src = lib.source();
  if (!(key in src)) throw new Error(`clé inconnue : ${key}`);
  let value = text;
  if (/^\s*\{/.test(text)) { try { value = JSON.parse(text); } catch (_) { /* texte littéral */ } }
  const { errors } = check.checkEntry(code, key, src[key], value);
  if (errors.length) throw new Error(`${key} : ${errors.join(' ; ')}`);
  const store = lib.loadStore(code);
  store.entries[key] = { text: value, src: lib.hash(src[key]), origin: 'human', by: by || 'locuteur natif', at: new Date().toISOString() };
  lib.saveStore(code, store);
}

async function main() {
  const [cmd, code] = positional;
  if (cmd === 'status') {
    const codes = positional.slice(1).length ? positional.slice(1) : lib.LANGS.LANGUAGES.filter(l => !l.builtin).map(l => l.code);
    for (const c of codes) {
      const r = check.report(c);
      const m = lib.LANGS.get(c);
      console.log(`${c} (${m.nativeName}, ${m.status}) : ${r.coverage} % (${r.ok}/${r.total}) · manquantes ${r.missing} · à retraduire ${r.stale} · humaines ${r.human} (à revoir ${r.review}) · erreurs ${r.errors} · avertissements ${r.warnings}`);
    }
    return;
  }
  if (cmd === 'scan') {
    const r = check.scanCode();
    console.log(`${r.used} clés littérales utilisées · ${r.missing.length} absente(s) du français`);
    for (const m of r.missing) console.log(`  ${m.file} : ${m.key}`);
    process.exitCode = r.missing.length ? 1 : 0;
    return;
  }
  if (!code) throw new Error('code de langue manquant (ex. it)');
  lib.assertTranslatable(code);
  if (cmd === 'check') {
    const r = check.report(code);
    if (has('json')) console.log(JSON.stringify(r, null, 1));
    else {
      console.log(`${code} : couverture ${r.coverage} % · erreurs ${r.errors} · avertissements ${r.warnings} · doublons ${r.duplicates.length} · à revoir (humain) ${r.review}`);
      for (const i of r.issues) console.log(`  ${i.errors.length ? 'ERREUR' : 'avert.'} ${i.key} : ${[...i.errors, ...i.warnings].join(' ; ')}`);
      for (const d of r.duplicates) console.log(`  doublon « ${show(d.text)} » : ${d.keys.join(', ')}`);
    }
    process.exitCode = r.errors ? 1 : 0;
  } else if (cmd === 'translate') {
    const r = await translate.run(code, { apply: has('apply'), batchSize: Number(flag('batch', 40)), maxBatches: Number(flag('max-batches', 3)),
      maxUsd: Number(flag('max-usd', 0.5)), log: s => console.log(s) });
    console.log(JSON.stringify(r, null, 1));
    if (has('apply') && r.accepted) console.log(`→ ${JSON.stringify(lib.build(code, { check }))}`);
  } else if (cmd === 'build') {
    console.log(JSON.stringify(lib.build(code, { check })));
  } else if (cmd === 'export') {
    const r = check.report(code);
    const issues = new Map(r.issues.map(i => [i.key, [...i.errors, ...i.warnings].join(' ; ')]));
    const lines = [['key', 'fr', code, 'origin', 'state', 'notes', 'correction'].map(csvCell).join(';')];
    for (const row of lib.status(code)) {
      if (row.state === 'orphan') continue;
      lines.push([row.key, show(row.fr), row.entry ? show(row.entry.text) : '', row.entry?.origin || '', row.state, issues.get(row.key) || '', ''].map(csvCell).join(';'));
    }
    const out = lines.join('\n') + '\n';
    if (positional[2]) fs.writeFileSync(positional[2], '﻿' + out); else process.stdout.write(out);
  } else if (cmd === 'import') {
    const by = flag('by');
    if (!by) throw new Error('--by "<prénom>" obligatoire (traçabilité des corrections humaines)');
    const rows = parseCsv(fs.readFileSync(positional[2], 'utf8').replace(/^﻿/, ''));
    const head = rows.shift().map(h => h.trim());
    const ki = head.indexOf('key'); const ci = head.indexOf('correction');
    let n = 0; const errs = [];
    for (const row of rows) {
      const key = row[ki]; const text = (row[ci] || '').trim();
      if (!key || !text) continue;
      try { correct(code, key, text, by); n++; } catch (e) { errs.push(e.message); }
    }
    console.log(`${n} correction(s) importée(s)${errs.length ? `, ${errs.length} refusée(s) :\n  ${errs.join('\n  ')}` : ''}`);
    console.log(JSON.stringify(lib.build(code, { check })));
    if (errs.length) process.exitCode = 1;
  } else if (cmd === 'correct') {
    correct(code, positional[2], positional[3], flag('by'));
    console.log(JSON.stringify(lib.build(code, { check })));
  } else {
    throw new Error(`commande inconnue : ${cmd}`);
  }
}

if (require.main === module) main().catch(err => { console.error(`Erreur : ${err.message}`); process.exit(1); });
module.exports = { correct, parseCsv };
