/**
 * server/aiSpendCap.js — Plafond de dépense IA du panel (#40), commun à l'atelier d'icônes et aux
 * appels de blockAi (blocs, collections, badges, actualités).
 *
 * Décision du propriétaire du 03/11/2026 (« Pour le moment pas de plafond tout court ») :
 *   - le plafond est DÉSACTIVÉ par défaut, y compris après un redémarrage ; DIG_IMAGE_BUDGET_USD
 *     (~/.config/dig/openai.env) ne bloque plus le panel, il ne vaut plus que pour les scripts
 *     hors ligne de #22 (tools/icons) ;
 *   - il est réactivable dans ⚙ Config → Budget IA, avec un montant choisi par l'admin et appliqué
 *     au cumul de TOUT Dig (journal partagé), sans redémarrage ; jamais relevé ni réactivé seul ;
 *   - ce qui reste toujours actif : une image par clic, un appel à la fois, quotas par 24 h,
 *     contrôle du sujet, journal du coût de chaque appel (totaux affichés, non bloquants).
 * Réglages dans icon_studio_settings (clé → valeur), en ajout/mise à jour seulement.
 */

'use strict';

const db = require('./db');

const conn = () => db.getDb();
const MAX_CAP_USD = 1000;

function init() {
  conn().exec(`CREATE TABLE IF NOT EXISTS icon_studio_settings (
    key         TEXT    PRIMARY KEY,
    value       TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);
}

function _get(key) {
  try { return conn().prepare('SELECT value, updated_at FROM icon_studio_settings WHERE key = ?').get(key) ?? null; } catch (_) { return null; }
}

/** { enabled, capUsd, updatedAt } — désactivé tant que l'admin ne l'a pas explicitement activé. */
function policy() {
  const on = _get('spend_cap_enabled'), cap = _get('spend_cap_usd');
  const capUsd = cap == null ? null : Number(cap.value);
  return { enabled: on?.value === '1' && Number.isFinite(capUsd), capUsd: Number.isFinite(capUsd) ? capUsd : null, updatedAt: on?.updated_at ?? null };
}

/** Active (avec un montant) ou désactive le plafond. Le montant est conservé quand on désactive. */
function setPolicy({ enabled, capUsd } = {}) {
  const upsert = conn().prepare(`INSERT INTO icon_studio_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  if (capUsd !== undefined && capUsd !== null && capUsd !== '') {
    const v = Number(capUsd);
    if (!Number.isFinite(v) || v <= 0 || v > MAX_CAP_USD) {
      const err = new Error(`Plafond attendu entre 0,01 et ${MAX_CAP_USD} USD.`); err.status = 400; throw err;
    }
    upsert.run('spend_cap_usd', String(Math.round(v * 100) / 100));
  }
  if (enabled !== undefined) {
    if (enabled && policy().capUsd == null) {
      const err = new Error('Indiquez le montant du plafond avant de l\'activer.'); err.status = 400; throw err;
    }
    upsert.run('spend_cap_enabled', enabled ? '1' : '0');
  }
  return policy();
}

/**
 * Refus éventuel d'un appel : null si autorisé, sinon le message. `spentUsd` = cumul de tout Dig,
 * `plannedUsd` = réservation de l'appel (estimation, le coût réel est journalisé après coup).
 */
function refusal(spentUsd, plannedUsd) {
  const p = policy();
  if (!p.enabled) return null;
  if (spentUsd + plannedUsd <= p.capUsd + 1e-9) return null;
  return `Plafond de dépense IA atteint (réglé dans ⚙ Config → Budget IA) : ${spentUsd.toFixed(4)} USD déjà dépensés `
    + `+ ${plannedUsd.toFixed(4)} USD réservés pour cet appel > plafond ${p.capUsd.toFixed(2)} USD. `
    + 'Relevez ou désactivez ce plafond dans ⚙ Config → Budget IA pour continuer.';
}

/**
 * Totaux non bloquants du journal (coûts calculés par Dig : jetons renvoyés par l'API × tarifs
 * configurés). `entries` : [{ at, cost_usd, source, kind, ok }]. Mois en UTC, comme la facturation OpenAI.
 */
function summarize(entries, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const out = { totalUsd: 0, calls: 0, since: null, monthUsd: 0, monthCalls: 0, month, imagesUsd: 0, textUsd: 0 };
  for (const e of entries) {
    const c = Number(e.cost_usd) || 0;
    out.totalUsd += c; out.calls += 1;
    if (e.at && (!out.since || e.at < out.since)) out.since = e.at;
    if (String(e.at || '').startsWith(month)) { out.monthUsd += c; out.monthCalls += 1; }
    if (/text|check/.test(String(e.kind || ''))) out.textUsd += c; else out.imagesUsd += c;
  }
  for (const k of ['totalUsd', 'monthUsd', 'imagesUsd', 'textUsd']) out[k] = +out[k].toFixed(4);
  return out;
}

module.exports = { init, policy, setPolicy, refusal, summarize, MAX_CAP_USD };
