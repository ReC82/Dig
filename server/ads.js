/**
 * server/ads.js — Publicité non intrusive et pilotable (#45).
 *
 * Principes (décisions du propriétaire du 30/10/2026, ticket #45) :
 *   - tout est DÉSACTIVÉ par défaut : interrupteur général `ad_settings.enabled` = 0 et chaque
 *     emplacement `ad_slots.enabled` = 0. `ADS_DISABLED=1` (environnement) coupe tout, même si
 *     l'admin a activé quelque chose (arrêt d'urgence sans base) ;
 *   - deux emplacements réservés en HAUT de l'interface, jamais sur la zone de minage, les
 *     commandes ni la barre de navigation : `top_mobile` (320×50) et `top_desktop` (728×90) ;
 *   - publicité seulement sur les domaines autorisés (défaut : dig.lodygames.com, domaine
 *     officiel). dig.lodylands.com, adresse alternative du propriétaire, n'en reçoit jamais
 *     sans décision explicite ; aucune redirection entre les deux ;
 *   - le code de la régie n'est JAMAIS exécuté dans la page du jeu : il est servi par
 *     GET /ads/frame/:slot, chargé dans une iframe `sandbox` sans `allow-same-origin` (origine
 *     opaque : pas d'accès aux cookies, au stockage ni au DOM du jeu ; pas de navigation de
 *     l'onglet). La variable globale `atOptions` de chaque unité reste isolée dans son cadre ;
 *   - un seul chargement par page : aucun rafraîchissement, aucun lien avec les clics, l'Auto-Dig,
 *     les scores ou le classement ;
 *   - statistiques : uniquement le nombre de cadres servis par jour et par emplacement (mesure
 *     technique côté serveur, sans donnée personnelle). Ce ne sont PAS des impressions régie ;
 *     aucun revenu n'est estimé (revenus : tableau de bord de la régie) ;
 *   - option « sans publicité » future : `isAdFree()` est le point d'entrée unique ; aucun prix,
 *     durée ni achat n'est implémenté (arbitrage du propriétaire nécessaire).
 */

'use strict';

const crypto = require('crypto');
const db     = require('./db');

/** Emplacements réservés (formats validés par le propriétaire). */
const SLOTS = {
  top_mobile:  { width: 320, height: 50,  label: 'Bannière haute mobile 320×50' },
  top_desktop: { width: 728, height: 90,  label: 'Bannière haute ordinateur 728×90' },
};

/** Régies prises en charge : code « atOptions + script iframe » (Adsterra et compatibles). */
const PROVIDERS = {
  adsterra: { label: 'Adsterra (bannière atOptions / iframe)' },
};

const KEY_RE  = /^[a-f0-9]{32}$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const STATS_DAYS = 14;

class AdError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const conn = () => db.getDb();

function killSwitch(env = process.env) {
  return env.ADS_DISABLED === '1' || env.ADS_DISABLED === 'true';
}

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

function _parseHosts(json) {
  try {
    const list = JSON.parse(json);
    return Array.isArray(list) ? list.map(normalizeHost).filter(Boolean) : [];
  } catch { return []; }
}

function getSettings() {
  const row = conn().prepare('SELECT * FROM ad_settings WHERE id = 1').get();
  return {
    enabled:        row.enabled === 1,
    provider:       row.provider,
    allowedHosts:   _parseHosts(row.allowed_hosts),
    consentVersion: row.consent_version,
    adsTxt:         row.ads_txt,
    legalContact:   row.legal_contact,
    updatedAt:      row.updated_at,
  };
}

function getSlots() {
  const rows = conn().prepare('SELECT * FROM ad_slots').all();
  const bySlot = Object.fromEntries(rows.map(r => [r.slot, r]));
  return Object.entries(SLOTS).map(([slot, size]) => {
    const r = bySlot[slot] || {};
    return {
      slot, ...size,
      enabled:    r.enabled === 1,
      adKey:      r.ad_key || '',
      scriptUrl:  r.script_url || '',
      hideOnDig:  r.hide_on_dig === 1,
      configured: KEY_RE.test(r.ad_key || '') && !!r.script_url,
      updatedAt:  r.updated_at || null,
    };
  });
}

/**
 * Analyse le code « GET CODE » d'une unité (atOptions + <script src>) collé par l'admin.
 * Rien n'est exécuté : on extrait la clé, le format, les dimensions et l'URL du script, puis
 * on vérifie leur cohérence avec l'emplacement.
 */
function parseSnippet(snippet, slot) {
  const size = SLOTS[slot];
  if (!size) throw new AdError(404, 'Emplacement inconnu.');
  const text = String(snippet || '');
  if (text.length > 4000) throw new AdError(400, 'Code trop long.');
  const field = (name) => {
    const m = text.match(new RegExp(`['"]?${name}['"]?\\s*:\\s*(?:'([^']*)'|"([^"]*)"|(\\d+))`));
    return m ? (m[1] ?? m[2] ?? m[3]) : null;
  };
  const key    = field('key');
  const format = field('format');
  const width  = Number(field('width'));
  const height = Number(field('height'));
  const srcs   = [...text.matchAll(/<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  if (!key || !KEY_RE.test(key)) throw new AdError(400, 'Clé « key » introuvable ou invalide (32 caractères hexadécimaux attendus).');
  if (format !== 'iframe') throw new AdError(400, 'Seul le format « iframe » (bannière) est accepté.');
  if (width !== size.width || height !== size.height) {
    throw new AdError(400, `Dimensions ${width}×${height} incompatibles avec l'emplacement ${size.width}×${size.height}.`);
  }
  if (srcs.length !== 1) throw new AdError(400, 'Le code doit contenir exactement un script externe.');
  let url;
  try { url = new URL(srcs[0].startsWith('//') ? `https:${srcs[0]}` : srcs[0]); }
  catch { throw new AdError(400, 'URL du script invalide.'); }
  if (url.protocol !== 'https:' || !HOST_RE.test(url.hostname) || url.username || url.password) {
    throw new AdError(400, 'Le script doit être servi en HTTPS depuis un nom de domaine.');
  }
  if (!url.pathname.includes(key)) throw new AdError(400, 'L\'URL du script ne correspond pas à la clé de l\'unité.');
  return { key, scriptUrl: url.href, scriptHost: url.hostname };
}

const ADS_TXT_LINE = /^(#.*|[a-z0-9.-]+\s*,\s*[A-Za-z0-9._-]+\s*,\s*(DIRECT|RESELLER)\s*(,\s*[A-Za-z0-9]+)?\s*(#.*)?|(contact|subdomain|ownerdomain|managerdomain|inventorypartnerdomain)\s*=\s*\S+)$/i;

function validateAdsTxt(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (s.length > 5000) throw new AdError(400, 'ads.txt trop long (5000 caractères max).');
  s.split('\n').forEach((line, i) => {
    const l = line.trim();
    if (l && !ADS_TXT_LINE.test(l)) throw new AdError(400, `ads.txt, ligne ${i + 1} invalide : « ${l.slice(0, 80)} ».`);
  });
  return s;
}

function updateSettings(body = {}) {
  const cur = getSettings();
  const next = { ...cur };
  if (body.provider !== undefined) {
    const p = String(body.provider || '');
    if (p && !PROVIDERS[p]) throw new AdError(400, 'Régie inconnue.');
    next.provider = p;
  }
  if (body.allowedHosts !== undefined) {
    const list = (Array.isArray(body.allowedHosts) ? body.allowedHosts : String(body.allowedHosts).split(/[\s,]+/))
      .map(normalizeHost).filter(Boolean);
    if (list.length > 5 || list.some(h => !HOST_RE.test(h))) throw new AdError(400, 'Liste de domaines invalide (5 au plus).');
    next.allowedHosts = [...new Set(list)];
  }
  if (body.adsTxt !== undefined) next.adsTxt = validateAdsTxt(body.adsTxt);
  if (body.legalContact !== undefined) {
    const c = String(body.legalContact ?? '').replace(/\r\n?/g, '\n').trim();
    if (c.length > 500) throw new AdError(400, 'Coordonnées trop longues (500 caractères max).');
    next.legalContact = c;
  }
  if (body.bumpConsent === true) next.consentVersion = cur.consentVersion + 1;
  if (body.enabled !== undefined) {
    next.enabled = body.enabled === true;
    if (next.enabled && !cur.enabled) {
      if (body.confirm !== 'ACTIVER') throw new AdError(400, 'Activation : saisir ACTIVER pour confirmer.');
      if (!next.provider) throw new AdError(400, 'Choisir une régie avant d\'activer.');
      if (!next.allowedHosts.length) throw new AdError(400, 'Aucun domaine autorisé.');
    }
  }
  conn().prepare(`UPDATE ad_settings SET enabled = ?, provider = ?, allowed_hosts = ?, consent_version = ?,
      ads_txt = ?, legal_contact = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(next.enabled ? 1 : 0, next.provider, JSON.stringify(next.allowedHosts), next.consentVersion,
      next.adsTxt, next.legalContact);
  return getSettings();
}

function updateSlot(slot, body = {}) {
  if (!SLOTS[slot]) throw new AdError(404, 'Emplacement inconnu.');
  const cur = getSlots().find(s => s.slot === slot);
  let { adKey, scriptUrl } = cur;
  if (body.clearCode === true) { adKey = ''; scriptUrl = ''; }
  if (body.snippet !== undefined && String(body.snippet).trim()) {
    ({ key: adKey, scriptUrl } = parseSnippet(body.snippet, slot));
  }
  const hideOnDig = body.hideOnDig === undefined ? cur.hideOnDig : body.hideOnDig === true;
  const enabled   = body.enabled === undefined ? cur.enabled : body.enabled === true;
  if (enabled && !(KEY_RE.test(adKey) && scriptUrl)) throw new AdError(400, 'Coller le code de l\'unité avant d\'activer l\'emplacement.');
  conn().prepare(`UPDATE ad_slots SET enabled = ?, ad_key = ?, script_url = ?, hide_on_dig = ?,
      updated_at = datetime('now') WHERE slot = ?`)
    .run(enabled ? 1 : 0, adKey, scriptUrl, hideOnDig ? 1 : 0, slot);
  return getSlots().find(s => s.slot === slot);
}

/**
 * Option « sans publicité » (future) : point d'entrée unique. Aucune offre n'existe ; quand le
 * propriétaire aura arbitré (prix, durée, achat en gemmes…), seule cette fonction changera.
 */
function isAdFree(_userId) {
  return false;
}

/** Raison pour laquelle aucune publicité n'est servie sur ce domaine, ou null. */
function blockedReason(host, settings = getSettings()) {
  if (killSwitch()) return 'kill_switch';
  if (!settings.enabled) return 'disabled';
  if (!settings.provider) return 'no_provider';
  if (!settings.allowedHosts.includes(normalizeHost(host))) return 'host_not_allowed';
  return null;
}

/** Configuration publique lue par le jeu : jamais de clé ni d'URL de régie. */
function publicConfig(host, { userId } = {}) {
  const settings = getSettings();
  let reason = blockedReason(host, settings);
  if (!reason && userId && isAdFree(userId)) reason = 'ad_free';
  const slots = reason ? [] : getSlots()
    .filter(s => s.enabled && s.configured)
    .map(s => ({ slot: s.slot, width: s.width, height: s.height, hideOnDig: s.hideOnDig }));
  if (!reason && !slots.length) reason = 'no_slot';
  return { enabled: !reason, reason, consentVersion: settings.consentVersion, slots };
}

const _esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Document HTML d'un emplacement, servi dans l'iframe sandbox. Retourne null si l'emplacement
 * ne doit pas être servi (désactivé, domaine non autorisé, code absent).
 */
function frameDocument(slot, host) {
  if (blockedReason(host)) return null;
  const s = getSlots().find(x => x.slot === slot);
  if (!s || !s.enabled || !s.configured) return null;
  const nonce = crypto.randomBytes(16).toString('base64');
  const opts = JSON.stringify({ key: s.adKey, format: 'iframe', height: s.height, width: s.width, params: {} });
  const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>
</head><body>
<script nonce="${nonce}">window.addEventListener('error', function (e) {
  if (e.target && e.target.tagName === 'SCRIPT') parent.postMessage({ digAd: 'error' }, '*');
}, true);</script>
<script nonce="${nonce}">var atOptions = ${opts.replace(/</g, '\\u003c')};</script>
<script nonce="${nonce}" src="${_esc(s.scriptUrl)}"></script>
</body></html>`;
  // Le cadre n'a qu'une origine opaque (sandbox) : les scripts de la régie peuvent charger leurs
  // propres ressources HTTPS, sans jamais atteindre la page du jeu.
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' https:`,
    "style-src 'unsafe-inline' https:",
    'img-src https: data:',
    'frame-src https:',
    'connect-src https:',
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
  _countFrame(slot);
  return { html, csp };
}

function _countFrame(slot) {
  try {
    conn().prepare(`INSERT INTO ad_daily_stats (day, slot, frames) VALUES (date('now'), ?, 1)
      ON CONFLICT(day, slot) DO UPDATE SET frames = frames + 1`).run(slot);
  } catch (err) { console.error('[ads] compteur', err.message); }
}

/** Contenu d'ads.txt pour ce domaine, ou null (404) : seulement sur un domaine autorisé. */
function adsTxt(host) {
  const s = getSettings();
  if (!s.adsTxt || !s.allowedHosts.includes(normalizeHost(host))) return null;
  return `${s.adsTxt}\n`;
}

/** robots.txt : domaine officiel indexable (hors API/admin/cadres), adresse alternative non. */
function robotsTxt(host, canonicalHost) {
  if (normalizeHost(host) !== canonicalHost) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nDisallow: /api/\nDisallow: /admin/\nDisallow: /ads/\nAllow: /\n`;
}

function adminView(host) {
  const settings = getSettings();
  const stats = conn().prepare(`SELECT day, slot, frames FROM ad_daily_stats
      WHERE day >= date('now', ?) ORDER BY day DESC, slot`).all(`-${STATS_DAYS - 1} days`);
  return {
    settings,
    killSwitch: killSwitch(),
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label })),
    slots: getSlots().map(s => ({ ...s, scriptHost: s.scriptUrl ? new URL(s.scriptUrl).hostname : '' })),
    // État effectif sur chaque domaine autorisé et sur celui de la requête admin
    effective: [...new Set([...settings.allowedHosts, normalizeHost(host)])]
      .map(h => ({ host: h, ...publicConfig(h) })),
    stats,
  };
}

module.exports = {
  SLOTS, PROVIDERS, AdError,
  normalizeHost, killSwitch, getSettings, getSlots, parseSnippet, validateAdsTxt,
  updateSettings, updateSlot, isAdFree, blockedReason, publicConfig, frameDocument,
  adsTxt, robotsTxt, adminView,
};
