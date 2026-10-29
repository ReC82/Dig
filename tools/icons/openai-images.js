/**
 * tools/icons/openai-images.js
 * Client OpenAI Images de DIG! — usage HORS LIGNE uniquement (génération d'assets), jamais
 * chargé par le serveur de jeu ni par le navigateur.
 *
 * Même API que Jury Central (sans en partager le code) :
 *   POST /v1/images/generations           (JSON)  — sans référence visuelle
 *   POST /v1/images/edits  image[]=<png>  (multipart) — avec référence visuelle validée
 * Réponse : data[0].b64_json (+ usage en jetons quand l'API le renvoie).
 *
 * Sécurité : la clé est lue sur place dans le fichier indiqué par la configuration
 * (~/.config/dig/openai.env → DIG_OPENAI_KEY_FILE), jamais copiée, journalisée, ni incluse
 * dans un message d'erreur. Budget : plafond local cumulé, vérifié AVANT chaque appel, et
 * journal JSONL de chaque appel (modèle, paramètres, usage, coût estimé).
 */

'use strict';

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const API = 'https://api.openai.com/v1';
const CONFIG_FILE = process.env.DIG_OPENAI_CONFIG || path.join(os.homedir(), '.config', 'dig', 'openai.env');
const LEDGER_FILE = process.env.DIG_ICONS_LEDGER || path.join(os.homedir(), '.local', 'state', 'dig-icons', 'ledger.jsonl');

function parseEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** Refuse un fichier lisible par d'autres que son propriétaire (clé ou configuration). */
function assertPrivate(file, { allowGroup = false } = {}) {
  const mode = fs.statSync(file).mode & 0o777;
  const forbidden = allowGroup ? 0o007 : 0o077;
  if (mode & forbidden) {
    throw new Error(`${file} est trop ouvert (mode ${mode.toString(8)}) : chmod 600 attendu`);
  }
}

function loadConfig(file = CONFIG_FILE) {
  assertPrivate(file);
  const c = parseEnvFile(file);
  const num = (k, d) => (c[k] === undefined || c[k] === '' ? d : Number(c[k]));
  return {
    keyFile:        c.DIG_OPENAI_KEY_FILE,
    keyVar:         c.DIG_OPENAI_KEY_VAR || 'OPENAI_API_KEY',
    allowSharedKeyFile: c.DIG_OPENAI_ALLOW_SHARED_KEY_FILE === '1',
    model:          c.DIG_IMAGE_MODEL || 'gpt-image-2.5-flare',
    editModel:      c.DIG_IMAGE_EDIT_MODEL || '',
    quality:        c.DIG_IMAGE_QUALITY || 'high',
    budgetUsd:      num('DIG_IMAGE_BUDGET_USD', 3),
    maxPerRun:      num('DIG_IMAGE_MAX_PER_RUN', 3),
    estCostUsd:     num('DIG_IMAGE_EST_COST_USD', 0.25),
    prices: {
      inputText:   num('DIG_IMAGE_PRICE_INPUT_TEXT_PER_M', 0),
      inputImage:  num('DIG_IMAGE_PRICE_INPUT_IMAGE_PER_M', 0),
      outputImage: num('DIG_IMAGE_PRICE_OUTPUT_IMAGE_PER_M', 0),
    },
  };
}

/**
 * Retire de tout message la clé et ses fragments : OpenAI renvoie par exemple sa propre forme
 * masquée (« sk-proj-****…ABCD ») dont les derniers caractères ne doivent pas être journalisés.
 */
function redact(text, key = '') {
  let out = String(text);
  if (key) out = out.split(key).join('[clé masquée]');
  return out.replace(/Incorrect API key provided:[^.]*\./g, 'Incorrect API key provided: [masqué].')
    .replace(/sk-[A-Za-z0-9*_-]{4,}/g, '[clé masquée]');
}

/** Lit la clé dans son fichier, sans jamais la renvoyer dans une erreur. */
function loadKey(cfg) {
  if (!cfg.keyFile) throw new Error('DIG_OPENAI_KEY_FILE non défini dans la configuration');
  // Fichier de clé lisible par d'autres comptes : refusé, sauf exception explicite et signalée
  // (cas transitoire de la clé partagée de Jury Central, en attente d'une clé dédiée Dig).
  try {
    assertPrivate(cfg.keyFile);
  } catch (err) {
    if (!cfg.allowSharedKeyFile) throw err;
    process.emitWarning(`${err.message} — utilisé quand même (DIG_OPENAI_ALLOW_SHARED_KEY_FILE=1) ; passer à une clé dédiée.`);
  }
  let key = parseEnvFile(cfg.keyFile)[cfg.keyVar];
  // Format accepté aussi : le fichier ne contient que la clé brute, sur une seule ligne.
  if (!key) {
    const raw = fs.readFileSync(cfg.keyFile, 'utf8').trim();
    if (raw && !/[\s=#]/.test(raw)) key = raw;
  }
  if (!key) throw new Error(`variable ${cfg.keyVar} absente de ${cfg.keyFile}`);
  return key;
}

function readLedger(file = LEDGER_FILE) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function spentUsd(entries) {
  return entries.reduce((sum, e) => sum + (Number(e.cost_usd) || 0), 0);
}

function appendLedger(entry, file = LEDGER_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
}

/** Contrôle budgétaire avant appel : lève une erreur si le plafond serait dépassé. */
function checkBudget(cfg, count, entries = readLedger()) {
  if (count > cfg.maxPerRun) throw new Error(`${count} images demandées : maximum ${cfg.maxPerRun} par commande`);
  const spent = spentUsd(entries);
  const planned = count * cfg.estCostUsd;
  if (spent + planned > cfg.budgetUsd + 1e-9) {
    throw new Error(`budget dépassé : ${spent.toFixed(2)} USD déjà dépensés + ${planned.toFixed(2)} estimés > plafond ${cfg.budgetUsd} USD`);
  }
  return { spent, planned, remaining: cfg.budgetUsd - spent };
}

/** Coût estimé depuis l'usage renvoyé par l'API ; à défaut, l'estimation forfaitaire. */
function costFromUsage(cfg, usage) {
  if (!usage || !usage.output_tokens) return { cost_usd: cfg.estCostUsd, basis: 'forfait (usage absent)' };
  const det = usage.input_tokens_details || {};
  const textIn = det.text_tokens ?? usage.input_tokens ?? 0;
  const imgIn = det.image_tokens ?? 0;
  const p = cfg.prices;
  const cost = (textIn * p.inputText + imgIn * p.inputImage + usage.output_tokens * p.outputImage) / 1e6;
  return { cost_usd: Number(cost.toFixed(4)), basis: 'usage API × tarifs configurés (estimation)' };
}

/**
 * Prépare la requête (sans l'envoyer) : édition avec référence si fournie, sinon génération.
 * Paramètres fixes pour la cohérence de la bibliothèque : carré 1024, PNG, fond transparent.
 */
function buildRequest(cfg, { prompt, reference = null, size = '1024x1024', inputFidelity = 'high' }) {
  const params = { model: cfg.model, prompt, size, quality: cfg.quality, n: 1, background: 'transparent', output_format: 'png' };
  if (!reference) {
    return { endpoint: `${API}/images/generations`, params, body: JSON.stringify(params), json: true };
  }
  const form = new FormData();
  const editParams = { ...params, model: cfg.editModel || cfg.model };
  if (cfg.editModel && inputFidelity) editParams.input_fidelity = inputFidelity;
  for (const [k, v] of Object.entries(editParams)) form.append(k, String(v));
  const buf = fs.readFileSync(reference);
  form.append('image[]', new Blob([buf], { type: 'image/png' }), path.basename(reference));
  return { endpoint: `${API}/images/edits`, params: { ...editParams, reference: path.basename(reference) }, body: form, json: false };
}

/** Appel réel. Rend { png: Buffer, usage, params, endpoint }. Erreur sans la clé. */
async function callImages(cfg, req, { fetchImpl = fetch, timeoutMs = 180000 } = {}) {
  const key = loadKey(cfg);
  const headers = { Authorization: `Bearer ${key}` };
  if (req.json) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(req.endpoint, { method: 'POST', headers, body: req.body, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new Error(`OpenAI ${res.status} ${err.type || ''} ${err.code || ''} : ${redact((err.message || text).slice(0, 300), key)}`);
  }
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('réponse OpenAI sans image (data[0].b64_json)');
  return { png: Buffer.from(b64, 'base64'), usage: data.usage || null, revised_prompt: data.data[0].revised_prompt || null };
}

module.exports = {
  CONFIG_FILE, LEDGER_FILE, redact, parseEnvFile, assertPrivate, loadConfig, loadKey, readLedger, spentUsd,
  appendLedger, checkBudget, costFromUsage, buildRequest, callImages,
};
