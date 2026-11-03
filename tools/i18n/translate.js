/**
 * tools/i18n/translate.js — Traduction IA automatique et reprenable (#59)
 *
 * - File idempotente : seulement les clés manquantes ou dont le français a changé (lib.queue) ;
 *   une correction humaine n'est jamais retraduite.
 * - Lots de N clés, mémoire écrite après CHAQUE lot (une interruption ne perd que le lot en cours).
 * - Garde-fous : nombre de lots par lancement, plafond de la commande (--max-usd) ET plafond local
 *   partagé de ~/.config/dig/openai.env (même journal que les icônes et assistants IA).
 * - Chaque réponse passe les contrôles qualité (check.js) : une traduction qui casse une variable est
 *   rejetée et reste en file.
 * - Journal de coût versionné sans secret : i18n/journal.jsonl.
 * Le jeu n'appelle JAMAIS l'IA à la lecture : seul ce script (lancé par un humain ou une tâche) le fait.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const lib   = require('./lib');
const check = require('./check');

const GLOSSARY_FILE = path.join(lib.ROOT, 'i18n', 'glossary.json');
const journalFile = () => path.join(lib.storeDir(), 'journal.jsonl');

function glossary(code) {
  if (!fs.existsSync(GLOSSARY_FILE)) return { terms: [], style: '' };
  const g = JSON.parse(fs.readFileSync(GLOSSARY_FILE, 'utf8'));
  return {
    terms: (g.terms || []).filter(t => t[code]).map(t => ({ fr: t.fr, target: t[code], note: t.note || '' })),
    style: [g.style?.all, g.style?.[code]].filter(Boolean).join('\n'),
  };
}

function messages(code, batch) {
  const m = lib.LANGS.get(code);
  const g = glossary(code);
  const system = [
    `You translate the user interface of DIG!, a casual idle clicker mining game (web + mobile), from French into ${m.englishName} (${m.intl}).`,
    'Rules:',
    '- Keep every {placeholder} exactly as written (same names). {s}, {s1}, {s2} are French plural markers: drop them and phrase the sentence so it reads well for any number.',
    '- Keep emojis, HTML tags, symbols (→, ×, %, ·) and non-breaking spaces where they are.',
    '- Short labels (buttons, tabs, stats) must stay short: a phone screen is 390 px wide.',
    '- Adapt jokes, idioms and cultural references naturally instead of translating word for word.',
    '- Use the glossary terms consistently. Do not translate the game name DIG! or "Auto-Dig".',
    g.style && `Style:\n${g.style}`,
    g.terms.length && `Glossary (French → ${m.englishName}):\n${g.terms.map(t => `- ${t.fr} → ${t.target}${t.note ? ` (${t.note})` : ''}`).join('\n')}`,
    'Return JSON {"translations":[{"key":…,"text":…}]} with exactly one item per input key.',
  ].filter(Boolean).join('\n');
  const user = batch.map(r => ({ key: r.key, fr: typeof r.fr === 'string' ? r.fr : r.fr.other }));
  return [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(user) }];
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['translations'],
  properties: { translations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'text'],
    properties: { key: { type: 'string' }, text: { type: 'string' } } } } },
};

/** Estimation grossière avant appel (≈ 4 caractères par jeton, réponse ≈ 1,3 × la source). */
function estimate(batch, prices) {
  const chars = batch.reduce((n, r) => n + JSON.stringify(r.fr).length + r.key.length + 20, 0) + 2500;
  const inTok = chars / 4;
  const outTok = (chars - 2500) / 4 * 1.3;
  return Number(((inTok * prices.input + outTok * prices.output) / 1e6).toFixed(5));
}

/** Transport OpenAI (Chat Completions, sortie JSON stricte) — configuration partagée #22, clé jamais affichée. */
function openAiProvider() {
  const oa = require('../icons/openai-images');
  const cfg = oa.loadConfig();
  const raw = oa.parseEnvFile(oa.CONFIG_FILE);
  const num = (k, d) => (raw[k] === undefined || raw[k] === '' ? d : Number(raw[k]));
  const model = raw.DIG_TEXT_MODEL || 'gpt-5-mini';
  const prices = { input: num('DIG_TEXT_PRICE_INPUT_PER_M', 0.25), output: num('DIG_TEXT_PRICE_OUTPUT_PER_M', 2) };
  return {
    name: model, prices,
    spent: () => oa.spentUsd(oa.readLedger()),
    budgetUsd: cfg.budgetUsd,
    ledger: e => oa.appendLedger(e),
    async call(msgs) {
      const key = oa.loadKey(cfg);
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: msgs, response_format: { type: 'json_schema', json_schema: { name: 'dig_i18n', strict: true, schema: SCHEMA } } }),
        signal: AbortSignal.timeout(120000),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* non JSON */ }
      if (!res.ok) throw new Error(`OpenAI ${res.status} : ${oa.redact(String(json?.error?.message || text).slice(0, 300), key)}`);
      const u = json.usage || {};
      const cost = u.prompt_tokens != null ? Number(((u.prompt_tokens * prices.input + (u.completion_tokens ?? 0) * prices.output) / 1e6).toFixed(5)) : null;
      return { data: JSON.parse(json.choices[0].message.content), cost, model: json.model || model };
    },
  };
}

/** Transport de test (aucun réseau) : DIG_I18N_FAKE=1. */
function fakeProvider() {
  let spent = 0;
  return {
    name: 'fake', prices: { input: 0, output: 0 }, budgetUsd: 1, spent: () => spent, ledger: e => { spent += e.cost_usd; },
    async call(msgs) {
      const items = JSON.parse(msgs[1].content);
      return { data: { translations: items.map(i => ({ key: i.key, text: `⟦${i.fr.replace(/\{s\d?\}/g, '')}⟧` })) }, cost: 0.0001, model: 'fake' };
    },
  };
}

/**
 * Lance la file. Sans `apply` : simulation (taille de la file, lots, coût estimé), aucun appel.
 * @returns {{ queued, batches, estimateUsd, done, accepted, rejected: [{key, reason}], spentUsd, stoppedBy }}
 */
async function run(code, { apply = false, batchSize = 40, maxBatches = 3, maxUsd = 0.5, provider = null, log = () => {} } = {}) {
  const m = lib.assertTranslatable(code);
  if (m.status === 'planned') throw new Error(`${code} est « planned » : passer la langue en « preview » dans public/js/languages.js avant toute traduction`);
  const src = lib.source();
  const store = lib.loadStore(code);
  const q = lib.queue(code, src, store);
  const batches = [];
  for (let i = 0; i < q.length; i += batchSize) batches.push(q.slice(i, i + batchSize));
  const p = provider || (process.env.DIG_I18N_FAKE === '1' ? fakeProvider() : (apply ? openAiProvider() : null));
  const prices = p?.prices || { input: 0.25, output: 2 };
  const result = { queued: q.length, batches: batches.length, estimateUsd: Number(batches.reduce((s, b) => s + estimate(b, prices), 0).toFixed(4)),
    done: 0, accepted: 0, rejected: [], spentUsd: 0, stoppedBy: null };
  if (!apply || !q.length) return result;

  for (const batch of batches) {
    if (result.done >= maxBatches) { result.stoppedBy = `limite de ${maxBatches} lot(s) par lancement`; break; }
    const est = estimate(batch, prices);
    if (result.spentUsd + est > maxUsd + 1e-9) { result.stoppedBy = `plafond de la commande (${maxUsd} USD)`; break; }
    if (p.spent() + est > p.budgetUsd + 1e-9) { result.stoppedBy = `plafond local partagé (${p.budgetUsd} USD)`; break; }
    const started = Date.now();
    let out;
    try { out = await p.call(messages(code, batch)); } catch (err) {
      result.stoppedBy = `échec de l'appel : ${String(err.message).slice(0, 200)}`;
      p.ledger({ at: new Date().toISOString(), source: 'i18n', kind: 'text', lang: code, ok: false, cost_usd: 0, error: result.stoppedBy });
      break;
    }
    const cost = out.cost ?? est;
    const fresh = lib.loadStore(code); // relu : une correction humaine faite entre-temps reste prioritaire
    const byKey = new Map((out.data?.translations || []).map(t => [t.key, t.text]));
    let accepted = 0;
    for (const r of batch) {
      const text = byKey.get(r.key);
      if (fresh.entries[r.key]?.origin === 'human') { result.rejected.push({ key: r.key, reason: 'correction humaine protégée' }); continue; }
      const { errors } = check.checkEntry(code, r.key, r.fr, typeof text === 'string' ? text.trim() : text);
      if (errors.length) { result.rejected.push({ key: r.key, reason: errors.join(' ; ') }); continue; }
      fresh.entries[r.key] = { text: text.trim(), src: lib.hash(r.fr), origin: 'ai', by: out.model, at: new Date().toISOString() };
      accepted++;
    }
    lib.saveStore(code, fresh);
    const entry = { at: new Date().toISOString(), source: 'i18n', kind: 'text', lang: code, model: out.model, keys: batch.length, accepted,
      rejected: batch.length - accepted, cost_usd: cost, cost_basis: out.cost != null ? 'usage API × tarifs configurés' : 'estimation', duration_ms: Date.now() - started };
    p.ledger(entry);
    fs.mkdirSync(lib.storeDir(), { recursive: true });
    fs.appendFileSync(journalFile(), JSON.stringify(entry) + '\n');
    result.done++; result.accepted += accepted; result.spentUsd = Number((result.spentUsd + cost).toFixed(5));
    log(`lot ${result.done}/${batches.length} : ${accepted}/${batch.length} acceptées, ${cost} USD`);
  }
  return result;
}

module.exports = { run, messages, estimate, glossary, fakeProvider, SCHEMA };
