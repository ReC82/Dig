'use strict';
/**
 * extensionSignatures.js — Détection ciblée de quelques extensions d'autoclick (#92, POC du 08/11/2026).
 *
 * Ce qu'un site peut et ne peut pas faire (preuves dans docs/claude-reports/2026-11-08_ticket-92-*.md) :
 *   - impossible d'obtenir la liste des extensions installées (chrome.management / browser.management
 *     sont réservées aux extensions) : on ne cherche QUE des signatures précises, extension par extension ;
 *   - une extension qui injecte une feuille CSS sur tous les sites laisse une trace mesurable : un
 *     élément témoin portant le même identifiant reçoit ses styles (z-index, animation…). L'élément est
 *     créé, mesuré puis retiré dans la même tâche (jamais laissé dans la page) ;
 *   - pendant les clics, certaines extensions ajoutent un indicateur visible dans la page (DOM partagé) ;
 *   - absence de trace ≠ absence d'extension (accès au site restreint, navigation privée, extension
 *     activée sans recharger la page, autre version, Firefox non vérifié) ; une trace est falsifiable.
 *
 * Règles du ticket : toutes les signatures sont OFF par défaut ; « Mon compte de test » avant tout
 * « Tous les joueurs » ; arrêt d'urgence dédié ; aucune sanction du seul fait d'une extension installée.
 * Réaction possible (réglage, « journal seulement » par défaut) : une vérification (énigme #25) quand
 * l'indicateur d'autoclic est présent pendant les coups de pioche. Les suspensions restent celles de
 * #91 (automatisation corroborée), indépendantes de la marque de l'outil.
 *
 * Règle du propriétaire du 10/11/2026 (#92, issuecomment-6767799684 puis -6767971370) : réaction
 * « Bloquer le minage » — tant qu'une signature PROUVÉE (`blockVerified`, essai réel du propriétaire)
 * est détectée, le jeu refuse les coups manuels sur le bloc, y compris si l'extension est installée
 * sans cliquer ; reprise dès qu'une nouvelle vérification ne la trouve plus. Aucune sanction, aucune
 * suspension sur simple présence (les suspensions restent #91). Le blocage est appliqué par le
 * navigateur : un client modifié peut l'ignorer, le vrai filet reste la protection serveur #91/#25.
 *
 * Données : seuls l'identifiant de la signature et deux mesures (trace d'installation oui/non, coups
 * avec indicateur actif) sont transmis, uniquement pour les signatures activées pour ce joueur. Aucun
 * inventaire d'extensions n'est demandé ni stocké. Journal : security_events (rétention 90 jours).
 */

const { getDb } = require('./db');
const antibot = require('./antibot');

/** Statuts affichés dans l'admin. Seul « detectable » peut être activé pour tous les joueurs. */
const STATUS = {
  detectable:   'Détectable',
  uncertain:    'Incertain',
  undetectable: 'Non détectable',
};

/**
 * Catalogue vérifié le 08/11/2026 (manifestes téléchargés depuis les boutiques officielles ; essais dans
 * Chrome for Testing 156 avec l'extension réellement chargée). `probe.install` : élément témoin et
 * propriétés calculées attendues (toutes doivent correspondre) ; `probe.active` : sélecteur présent
 * pendant les clics (vérifié seulement quand `activeVerified`).
 */
const CATALOG = [
  {
    id: 'op_auto_clicker',
    name: 'OP Auto Clicker',
    publisher: 'mousetool',
    stores: [{ browser: 'chrome', id: 'kpmbpdpbjjadabknommjfphilmecebab', version: '0.1.4',
      url: 'https://chromewebstore.google.com/detail/op-auto-clicker/kpmbpdpbjjadabknommjfphilmecebab' }],
    browsers: ['chrome', 'edge', 'brave', 'opera'],
    tested: 'Chrome for Testing 156 (Chromium), 08/11/2026',
    status: 'detectable',
    method: 'Feuille CSS injectée sur tous les sites (div#AutoClickerIndicator : z-index 9999, 15 px, animation « loading ») ; '
      + 'pendant les clics, indicateur div#AutoClickerIndicator ajouté à la page. Clics générés par script (isTrusted = false).',
    notes: 'Pas de ressource web accessible (aucun web_accessible_resources). Extension de la capture du propriétaire (Chrome, 0.1.4). '
      + 'Non détectée si : accès au site « au clic » ou sites choisis sans Dig, navigation privée, extension activée sans recharger la page. '
      + 'Désactivée sans recharger : la trace d\'installation reste jusqu\'au rechargement.',
    probe: {
      install: { tag: 'div', id: 'AutoClickerIndicator',
        checks: [[null, 'z-index', '9999'], [null, 'width', '15px'], ['::before', 'animation-name', 'loading'], ['::before', 'border-top-color', 'rgb(28, 28, 28)']] },
      active: 'body > div#AutoClickerIndicator',
    },
    activeVerified: true,
    // Recettes réelles du propriétaire dans Chrome PC : #92-A (09/11) et #92-B (10/11)
    blockVerified: true,
  },
  {
    id: 'autofill_auto_clicker',
    name: 'Auto Clicker - AutoFill',
    publisher: '',
    stores: [{ browser: 'chrome', id: 'iapifmceeokikomajpccajhjpacjmibe', version: '5.4.1',
      url: 'https://chromewebstore.google.com/detail/iapifmceeokikomajpccajhjpacjmibe' }],
    browsers: ['chrome', 'edge', 'brave', 'opera'],
    tested: 'Chrome for Testing 156 (Chromium), 08/11/2026 — installation seulement',
    status: 'detectable',
    method: 'Feuille CSS injectée sur tous les sites (#auto-clicker-auto-fill-status : position fixed, z-index 1000000000).',
    notes: 'Sert aussi à remplir des formulaires : sa présence ne dit rien du minage. Indicateur d\'activité non vérifié : aucune réaction automatique, journal seulement.',
    probe: {
      install: { tag: 'div', id: 'auto-clicker-auto-fill-status', checks: [[null, 'position', 'fixed'], [null, 'z-index', '1000000000']] },
      active: null,
    },
    activeVerified: false,
  },
  {
    id: 'io_auto_clicker_firefox',
    name: 'IO Auto Clicker (Firefox)',
    publisher: '',
    stores: [{ browser: 'firefox', id: '{67794639-d1c6-4b41-a189-4f99f80237d2}', version: '2.0',
      url: 'https://addons.mozilla.org/firefox/addon/autoclicker-automatic-tap/' }],
    browsers: ['firefox'],
    tested: 'Manifeste et code lus ; non essayé dans un vrai Firefox (indisponible sur le serveur)',
    status: 'uncertain',
    method: 'Même code que OP Auto Clicker : feuille CSS injectée (div#ext-icon : z-index 9999, 20 px, animation « loading ») ; indicateur div#ext-icon pendant les clics.',
    notes: 'Firefox donne un identifiant interne aléatoire à chaque installation : seule la trace CSS est utilisable. À confirmer par un essai réel (mode « Mon compte de test »).',
    probe: {
      install: { tag: 'div', id: 'ext-icon', checks: [[null, 'z-index', '9999'], [null, 'width', '20px'], ['::before', 'animation-name', 'loading']] },
      active: 'body > div#ext-icon',
    },
    activeVerified: false,
  },
  {
    id: 'auto_clicker_cpedeo',
    name: 'Auto Clicker',
    publisher: '',
    stores: [{ browser: 'chrome', id: 'cpedeojecpbkcomgcolphimkjdnikbck', version: '3.9.1',
      url: 'https://chromewebstore.google.com/detail/auto-clicker/cpedeojecpbkcomgcolphimkjdnikbck' }],
    browsers: ['chrome', 'edge', 'brave', 'opera'],
    tested: 'Chrome for Testing 156, 08/11/2026 : aucune trace à l\'installation',
    status: 'undetectable',
    method: 'Aucune feuille CSS ni ressource accessible ; son style n\'est ajouté qu\'en cours d\'utilisation (non vérifié).',
    notes: 'Détection par le comportement (#91 : rythme de machine, même pixel, clics générés par script).',
    probe: null,
  },
  {
    id: 'simple_auto_clicker',
    name: 'Simple Auto Clicker',
    publisher: '',
    stores: [{ browser: 'chrome', id: 'aljpppgbdpdjekfbgppppjoakabmkodo', version: '0.3.0',
      url: 'https://chromewebstore.google.com/detail/aljpppgbdpdjekfbgppppjoakabmkodo' }],
    browsers: ['chrome', 'edge', 'brave', 'opera'],
    tested: 'Manifeste lu le 08/11/2026',
    status: 'undetectable',
    method: 'Aucun script de contenu permanent ni ressource accessible (injection à la demande, activeTab).',
    notes: 'Détection par le comportement (#91).',
    probe: null,
  },
  {
    id: 'gg_auto_clicker',
    name: 'GG Auto Clicker',
    publisher: '',
    stores: [{ browser: 'chrome', id: 'fndokfnecpehdehdjpdldadienbcjllf', version: '1.2',
      url: 'https://chromewebstore.google.com/detail/gg-auto-clicker-11/fndokfnecpehdehdjpdldadienbcjllf' }],
    browsers: ['chrome', 'edge', 'brave', 'opera'],
    tested: 'Manifeste lu le 08/11/2026',
    status: 'undetectable',
    method: 'Ressource accessible réservée à orteil.dashnet.org (Cookie Clicker) ; rien d\'exposé à Dig.',
    notes: 'Détection par le comportement (#91).',
    probe: null,
  },
  {
    id: 'fast_auto_clicker_firefox',
    name: 'Auto Clicker / Fast Auto Clicker (Firefox)',
    publisher: '',
    stores: [{ browser: 'firefox', id: '{d4959848-de0d-4ac8-86d2-7784027fa952}', version: '2.0',
      url: 'https://addons.mozilla.org/firefox/addon/fast-auto-clicker/' }],
    browsers: ['firefox'],
    tested: 'Manifeste lu le 08/11/2026',
    status: 'undetectable',
    method: 'Aucun script de contenu permanent ni ressource accessible.',
    notes: 'Détection par le comportement (#91).',
    probe: null,
  },
  {
    id: 'op_auto_clicker_windows',
    name: 'OP Auto Clicker (application Windows, opautoclicker.com)',
    publisher: '',
    stores: [],
    browsers: ['chrome', 'edge', 'brave', 'opera', 'firefox'],
    tested: 'Par nature (programme hors du navigateur)',
    status: 'undetectable',
    method: 'Programme du système : vrais clics souris (isTrusted = true), aucune trace dans la page.',
    notes: 'Ne pas confondre avec l\'extension du même nom. Couvert par #91 (même pixel, rythme de machine, souris immobile).',
    probe: null,
  },
];

const BY_ID = new Map(CATALOG.map(s => [s.id, s]));
const BROWSERS = { chrome: 'Chrome', edge: 'Edge', brave: 'Brave', opera: 'Opera', firefox: 'Firefox' };

/** Coups avec indicateur actif dans une fenêtre de sauvegarde pour réagir (au-delà : bruit exclu). */
const ACTIVE_MIN_HITS = 5;
/** Une même trace (joueur, signature, état) n'est journalisée qu'une fois par période. */
const LOG_DEDUP_MS = 10 * 60_000;
const MAX_TEST_USERS = 5;

const sigKey = id => `ab_ext_sig_${id}`;
const canSelf = s => !!s?.probe && s.status !== 'undetectable';
const canGlobal = s => canSelf(s) && s.status === 'detectable';
/** « Bloquer le minage » : seulement pour une signature prouvée en conditions réelles. */
const canBlock = s => canGlobal(s) && !!s.blockVerified;
const REACTIONS = ['log', 'challenge', 'block'];
/** Origines admises d'un envoi : chargement, sauvegarde, nouvelle vérification demandée par le joueur. */
const SOURCES = ['load', 'save', 'recheck'];

function getSettings(config = {}) {
  const sigs = {};
  for (const s of CATALOG) {
    const v = String(config[sigKey(s.id)] ?? 'off').toLowerCase();
    sigs[s.id] = v === 'global' && canGlobal(s) ? 'global' : v === 'self' && canSelf(s) ? 'self' : 'off';
  }
  const testUsers = String(config.ab_ext_test_users ?? '').split(',').map(x => Number(x.trim()))
    .filter(n => Number.isSafeInteger(n) && n > 0).slice(0, MAX_TEST_USERS);
  const reaction = String(config.ab_ext_reaction ?? 'log').toLowerCase();
  return {
    stop: String(config.ab_ext_stop ?? 'off').toLowerCase() === 'on' ? 'on' : 'off',
    reaction: REACTIONS.includes(reaction) ? reaction : 'log',
    testUsers,
    sigs,
  };
}

function validateConfigValue(key, raw) {
  const v = String(raw).trim().toLowerCase();
  if (key === 'ab_ext_stop') return v === 'on' || v === 'off' ? { value: v } : { error: 'ab_ext_stop : on ou off attendu.' };
  if (key === 'ab_ext_reaction') return REACTIONS.includes(v) ? { value: v } : { error: 'ab_ext_reaction : log, challenge ou block attendu.' };
  if (key === 'ab_ext_test_users') {
    const ids = v === '' ? [] : v.split(',').map(x => x.trim());
    if (ids.length > MAX_TEST_USERS || ids.some(x => !/^\d{1,10}$/.test(x))) return { error: `ab_ext_test_users : jusqu'à ${MAX_TEST_USERS} identifiants séparés par des virgules.` };
    return { value: ids.join(',') };
  }
  if (String(key).startsWith('ab_ext_sig_')) {
    const s = BY_ID.get(String(key).slice('ab_ext_sig_'.length));
    if (!s) return { error: 'Signature inconnue.' };
    if (!['off', 'self', 'global'].includes(v)) return { error: `${key} : off, self ou global attendu.` };
    if (v === 'self' && !canSelf(s)) return { error: `${s.name} : non détectable, aucun essai possible.` };
    if (v === 'global' && !canGlobal(s)) return { error: `${s.name} : signature non vérifiée — « Mon compte de test » seulement.` };
    return { value: v };
  }
  return null;
}

/** Mode effectif d'une signature pour un joueur : 'global', 'self' (compte de test) ou null. */
function _modeFor(settings, sigId, userId) {
  if (settings.stop === 'on') return null;
  const m = settings.sigs[sigId];
  if (m === 'global') return 'global';
  if (m === 'self' && userId != null && settings.testUsers.includes(Number(userId))) return 'self';
  return null;
}

/** Vrai si la réaction « Bloquer le minage » s'applique à cette signature pour ce joueur. */
function _blocks(st, s, userId) {
  return st.reaction === 'block' && canBlock(s) && !!_modeFor(st, s.id, userId);
}

/**
 * Signatures à vérifier dans le navigateur de ce joueur (liste vide : le jeu ne vérifie rien).
 * `block` : le minage manuel est refusé tant que la trace est présente (nom affiché au joueur).
 */
function forUser(userId, config = {}) {
  const st = getSettings(config);
  return CATALOG.filter(s => s.probe && _modeFor(st, s.id, userId))
    .map(s => ({ id: s.id, ...(_blocks(st, s, userId) ? { block: true, name: s.name } : {}),
      probe: { install: s.probe.install, active: s.activeVerified || _modeFor(st, s.id, userId) === 'self' ? s.probe.active : null } }));
}

/**
 * Résultats du navigateur, filtrés : uniquement les signatures activées pour ce joueur (le reste est
 * ignoré sans être lu). `{ [id]: { i: 0|1, a: coups avec indicateur } }`.
 */
function normalizeResults(raw, userId, config = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const st = getSettings(config);
  const out = [];
  for (const s of CATALOG) {
    if (!s.probe || !Object.hasOwn(raw, s.id)) continue;
    const mode = _modeFor(st, s.id, userId);
    if (!mode) continue;
    const r = raw[s.id];
    if (!r || typeof r !== 'object') continue;
    const a = Number.isSafeInteger(r.a) && r.a > 0 ? Math.min(r.a, 1e6) : 0;
    out.push({ id: s.id, mode, installed: r.i === 1 || r.i === true, activeHits: a });
  }
  return out;
}

function _recentlyLogged(userId, sigId, state, nowMs) {
  const rows = getDb().prepare(`SELECT details FROM security_events WHERE user_id = ? AND type = 'extension_signature' ORDER BY id DESC LIMIT 20`).all(userId);
  return rows.some(r => {
    try { const d = JSON.parse(r.details); return d.signature === sigId && d.state === state && nowMs - (d.atMs ?? 0) < LOG_DEDUP_MS; } catch { return false; }
  });
}

/**
 * Enregistre les résultats d'un joueur (chargement du jeu ou sauvegarde) et dit s'il faut une
 * vérification. Journal : traces positives (tous modes) et résultats négatifs des comptes de test
 * (pour que l'essai « non détectée » soit visible), une fois par 10 min et par état.
 * @returns {{ results, challenge: object|null, feedback: object[]|null }}
 */
function record(userId, raw, { config = {}, source = 'save', seasonId = null, nowMs = Date.now(), ip = null } = {}) {
  const results = normalizeResults(raw, userId, config);
  if (!results.length) return { results, challenge: null, feedback: null, blocked: [] };
  const st = getSettings(config);
  const src = SOURCES.includes(source) ? source : 'save';
  let challenge = null;
  const blocked = [];
  for (const r of results) {
    const s = BY_ID.get(r.id);
    const active = r.activeHits >= ACTIVE_MIN_HITS && (s.activeVerified || r.mode === 'self');
    const state = active ? 'active' : r.installed ? 'installed' : 'none';
    const block = _blocks(st, s, userId);
    // Blocage : présence OU activité. Sinon, vérification seulement si l'indicateur d'autoclic est actif.
    const reaction = block && state !== 'none' ? 'block' : active && st.reaction === 'challenge' ? 'challenge' : 'log';
    // Une nouvelle vérification sans trace (extension retirée) est journalisée : reprise visible dans l'admin
    if ((state !== 'none' || r.mode === 'self' || (block && src === 'recheck')) && !_recentlyLogged(userId, r.id, state, nowMs)) {
      antibot.logSecurityEvent('extension_signature', { userId, seasonId, ip,
        details: { signature: r.id, state, installed: r.installed, activeHits: r.activeHits, mode: r.mode, source: src, atMs: nowMs, reaction } });
    }
    if (reaction === 'block') blocked.push(r.id);
    if (reaction === 'challenge' && !challenge) challenge = { signature: r.id, name: s.name, activeHits: r.activeHits };
  }
  const tester = results.filter(r => r.mode === 'self');
  const feedback = tester.length ? tester.map(r => ({ id: r.id, name: BY_ID.get(r.id).name, installed: r.installed, activeHits: r.activeHits })) : null;
  return { results, challenge, feedback, blocked };
}

/** Vue admin : catalogue, interrupteurs, comptes de test, journal court et compteurs (7 jours). */
function adminView(config = {}, { limit = 40 } = {}) {
  const st = getSettings(config);
  const db = getDb();
  const counts = new Map(db.prepare(`
    SELECT json_extract(details, '$.signature') AS sig, COUNT(DISTINCT user_id) AS n FROM security_events
    WHERE type = 'extension_signature' AND json_extract(details, '$.state') != 'none' AND created_at >= datetime('now', '-7 days') GROUP BY sig
  `).all().map(r => [r.sig, r.n]));
  const journal = db.prepare(`
    SELECT e.id, e.created_at, e.user_id, u.username, e.details FROM security_events e LEFT JOIN users u ON u.id = e.user_id
    WHERE e.type IN ('extension_signature') ORDER BY e.id DESC LIMIT ?
  `).all(limit).map(r => {
    let d = {}; try { d = JSON.parse(r.details) ?? {}; } catch { /* ignoré */ }
    return { id: r.id, at: r.created_at, userId: r.user_id, username: r.username, signature: d.signature, name: BY_ID.get(d.signature)?.name ?? d.signature,
      state: d.state, activeHits: d.activeHits ?? 0, mode: d.mode, source: d.source, reaction: d.reaction };
  });
  const testUsers = st.testUsers.map(id => ({ id, username: db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username ?? null }));
  return {
    stop: st.stop, reaction: st.reaction, testUsers, browsers: BROWSERS, statusLabels: STATUS, activeMinHits: ACTIVE_MIN_HITS,
    signatures: CATALOG.map(s => ({
      id: s.id, name: s.name, publisher: s.publisher, stores: s.stores, browsers: s.browsers, tested: s.tested, status: s.status,
      method: s.method, notes: s.notes, probe: s.probe, activeVerified: !!s.activeVerified,
      mode: st.sigs[s.id], canSelf: canSelf(s), canGlobal: canGlobal(s), canBlock: canBlock(s), players7d: counts.get(s.id) ?? 0,
    })),
    journal,
  };
}

module.exports = {
  CATALOG, STATUS, BROWSERS, REACTIONS, ACTIVE_MIN_HITS, LOG_DEDUP_MS, MAX_TEST_USERS,
  getSettings, validateConfigValue, forUser, normalizeResults, record, adminView,
};
