/**
 * server/beta.js — Bêta fermée (#57) : accès par invitation, bandeau bêta, signalement de bugs.
 *
 * Principes (décisions du propriétaire du 02/11/2026, ticket #57) :
 *   - rien ne change au déploiement : inscription `open` (comme avant), bandeau masqué, aucun lien
 *     Discord. Le propriétaire active lui-même chaque élément depuis le panel (onglet « Bêta ») ;
 *   - inscription `invite` : un code valide est exigé pour créer un compte ; `closed` : aucune
 *     création. La connexion des comptes existants n'est JAMAIS touchée (ni par le mode, ni par la
 *     révocation d'un code) ;
 *   - codes à usage limité (nombre d'utilisations, date d'expiration, révocation), groupés par
 *     vague (10 → 30 → 100). Aucune invitation n'est envoyée par le jeu : le propriétaire transmet
 *     le lien lui-même (Discord) ;
 *   - lien Discord configurable, jamais inventé : sans lien enregistré, le jeu n'en affiche aucun ;
 *   - signalement de bug : texte du joueur + diagnostic technique (version, navigateur, taille
 *     d'écran, langue, écran du jeu) envoyé SEULEMENT si le joueur coche la case. Aucune capture,
 *     aucune adresse IP stockée. Le joueur connecté voit l'état de ses signalements.
 */

'use strict';

const crypto = require('crypto');
const db     = require('./db');

const MODES        = ['open', 'invite', 'closed'];
const STATUSES     = ['new', 'seen', 'fixed', 'wontfix'];
const TEXT_MAX     = 1000;
const POLICY_MAX   = 2000;
const DEVICE_MAX   = 200;
const MAX_USES_MAX = 500;
const DISCORD_RE   = /^https:\/\/(?:discord\.gg|(?:www\.)?discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]{2,64}\/?$/;
const GITHUB_RE    = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d{1,7}$/;
// Sans 0/O, 1/I/L : codes dictés ou recopiés depuis un téléphone sans ambiguïté.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE       = /^DIG-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

class BetaError extends Error {
  constructor(status, message, code = null) { super(message); this.status = status; this.code = code; }
}

const conn = () => db.getDb();

/** Horodatage SQLite (UTC, sans fraction) d'une date. */
const sqlTime = d => d.toISOString().slice(0, 19).replace('T', ' ');

function _text(v, max, field) {
  if (v == null) return '';
  if (typeof v !== 'string') throw new BetaError(400, `${field} : texte attendu.`);
  // Caractères de contrôle retirés (sauf retours à la ligne et tabulations).
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim();
  if (s.length > max) throw new BetaError(400, `${field} : ${max} caractères maximum.`);
  return s;
}

// ── Réglages ──────────────────────────────────────────────────────────────────

function getSettings() {
  const r = conn().prepare('SELECT * FROM beta_settings WHERE id = 1').get();
  return {
    bannerEnabled:    r.banner_enabled === 1,
    registrationMode: r.registration_mode,
    discordUrl:       r.discord_url,
    resetPolicy:      r.reset_policy,
    knownIssues:      r.known_issues,
    reportsEnabled:   r.reports_enabled === 1,
    updatedAt:        r.updated_at,
  };
}

/** Mise à jour partielle : seuls les champs présents sont modifiés. */
function updateSettings(body = {}) {
  const cur = getSettings();
  const next = { ...cur };
  if (body.bannerEnabled !== undefined)  next.bannerEnabled  = body.bannerEnabled === true;
  if (body.reportsEnabled !== undefined) next.reportsEnabled = body.reportsEnabled === true;
  if (body.registrationMode !== undefined) {
    if (!MODES.includes(body.registrationMode)) throw new BetaError(400, 'Mode d\'inscription inconnu (open, invite ou closed).');
    next.registrationMode = body.registrationMode;
  }
  if (body.discordUrl !== undefined) {
    const url = _text(body.discordUrl, 200, 'Lien Discord');
    if (url && !DISCORD_RE.test(url)) {
      throw new BetaError(400, 'Lien Discord invalide : attendu https://discord.gg/… ou https://discord.com/invite/…');
    }
    next.discordUrl = url;
  }
  if (body.resetPolicy !== undefined) next.resetPolicy = _text(body.resetPolicy, POLICY_MAX, 'Politique de progression');
  if (body.knownIssues !== undefined) next.knownIssues = _text(body.knownIssues, POLICY_MAX, 'Bugs connus');
  conn().prepare(`
    UPDATE beta_settings SET banner_enabled = ?, registration_mode = ?, discord_url = ?, reset_policy = ?,
           known_issues = ?, reports_enabled = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(next.bannerEnabled ? 1 : 0, next.registrationMode, next.discordUrl, next.resetPolicy,
      next.knownIssues, next.reportsEnabled ? 1 : 0);
  return getSettings();
}

/** Configuration lue par le jeu (aucune donnée d'administration). */
function publicConfig() {
  const s = getSettings();
  return {
    banner:       s.bannerEnabled,
    registration: s.registrationMode,
    discordUrl:   s.discordUrl || null,
    resetPolicy:  s.resetPolicy,
    knownIssues:  s.knownIssues,
    reports:      s.reportsEnabled,
  };
}

// ── Invitations ───────────────────────────────────────────────────────────────

function normalizeCode(v) {
  if (typeof v !== 'string') return '';
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length === 11 && s.startsWith('DIG')) return `DIG-${s.slice(3, 7)}-${s.slice(7)}`;
  return '';
}

function _newCode() {
  const pick = n => Array.from(crypto.randomBytes(n), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return `DIG-${pick(4)}-${pick(4)}`;
}

function _inviteState(r, now = new Date()) {
  if (r.revoked_at) return 'revoked';
  if (r.expires_at && r.expires_at <= sqlTime(now)) return 'expired';
  if (r.uses >= r.max_uses) return 'used';
  return 'active';
}

function _formatInvite(r, now) {
  return {
    id: r.id, code: r.code, label: r.label, wave: r.wave, maxUses: r.max_uses, uses: r.uses,
    expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at, state: _inviteState(r, now),
    createdBy: r.created_by || null, archivedAt: r.archived_at || null,
  };
}

// ── Journal de gestion (#80) ──────────────────────────────────────────────────
// Qui a fait quoi et quand, en ajout seul (déclencheurs en base). Seules les actions qui ont
// réellement changé quelque chose y entrent : répéter une action ne crée pas de doublon.

const AUDIT_ACTIONS = {
  invite_revoke: 'Lien révoqué', invite_archive: 'Lien archivé', invite_unarchive: 'Lien réaffiché',
  tester_remove: 'Testeur retiré du programme', tester_restore: 'Testeur réintégré',
  report_archive: 'Retour archivé', report_unarchive: 'Retour réaffiché',
};

function _audit(action, type, id, target, actor) {
  conn().prepare('INSERT INTO beta_audit (action, target_type, target_id, target, actor) VALUES (?, ?, ?, ?, ?)')
    .run(action, type, id, String(target || '').slice(0, 80), String(actor || 'admin').slice(0, 60));
}

function listAudit(limit = 50) {
  return conn().prepare('SELECT * FROM beta_audit ORDER BY id DESC LIMIT ?').all(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .map(r => ({ id: r.id, action: r.action, label: AUDIT_ACTIONS[r.action] || r.action, targetType: r.target_type,
      targetId: r.target_id, target: r.target, actor: r.actor, createdAt: r.created_at }));
}

/** Code partiellement masqué pour le journal (le code complet reste visible dans la liste). */
const _codeHint = code => `${code.slice(0, 4)}…${code.slice(-4)}`;
const _id = v => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new BetaError(400, 'Identifiant invalide.'); return n; };

/** Vague courante : la plus haute déjà utilisée (1 si aucun code). */
function currentWave() {
  return conn().prepare('SELECT MAX(wave) AS w FROM beta_invites').get().w || 1;
}

/**
 * Crée `count` codes (1 à 20). `expiresInDays` : 1 à 90 (défaut 14) ; 0 = sans expiration.
 * Sans vague précisée : vague courante (« Inviter un testeur » en un clic, recette du 03/11).
 */
function createInvites({ label = '', wave = null, maxUses = 1, expiresInDays = 14, count = 1 } = {}, now = new Date(), actor = null) {
  const lbl = _text(label, 60, 'Libellé');
  const w = (wave === null || wave === undefined || wave === '') ? currentWave() : Number(wave), m = Number(maxUses), d = Number(expiresInDays), n = Number(count);
  if (!Number.isInteger(w) || w < 1 || w > 20) throw new BetaError(400, 'Vague : entier de 1 à 20.');
  if (!Number.isInteger(m) || m < 1 || m > MAX_USES_MAX) throw new BetaError(400, `Utilisations : entier de 1 à ${MAX_USES_MAX}.`);
  if (!Number.isInteger(d) || d < 0 || d > 90) throw new BetaError(400, 'Expiration : 0 (aucune) à 90 jours.');
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new BetaError(400, 'Nombre de codes : 1 à 20.');
  const expires = d ? sqlTime(new Date(now.getTime() + d * 86_400_000)) : null;
  const ins = conn().prepare('INSERT INTO beta_invites (code, label, wave, max_uses, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  const ids = [];
  db.runTransaction(() => {
    for (let i = 0; i < n; i++) {
      let id = null;
      for (let attempt = 0; attempt < 5 && id === null; attempt++) {
        try { id = ins.run(_newCode(), lbl, w, m, expires, actor ? String(actor).slice(0, 60) : null).lastInsertRowid; }
        catch (err) { if (!/UNIQUE/.test(err.message)) throw err; }
      }
      if (id === null) throw new BetaError(500, 'Génération de code impossible, réessayer.');
      ids.push(id);
    }
  });
  const get = conn().prepare('SELECT * FROM beta_invites WHERE id = ?');
  return ids.map(id => _formatInvite(get.get(id), now));
}

function _inviteRow(id) {
  const row = conn().prepare('SELECT * FROM beta_invites WHERE id = ?').get(_id(id));
  if (!row) throw new BetaError(404, 'Code introuvable.');
  return row;
}

/**
 * Révocation : invalidation immédiate côté serveur (inscription refusée dès la requête suivante).
 * Idempotente ; les comptes déjà créés avec ce lien ne sont jamais touchés. Rend { changed, invite }.
 */
function revokeInvite(id, actor = null) {
  const row = _inviteRow(id);
  return db.runTransaction(() => {
    const info = conn().prepare("UPDATE beta_invites SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(row.id);
    if (info.changes) _audit('invite_revoke', 'invite', row.id, _codeHint(row.code), actor);
    return { changed: info.changes > 0, invite: _formatInvite(_inviteRow(row.id)) };
  });
}

/**
 * Archiver (#80) : masque un lien qui ne peut plus servir (utilisé, révoqué, expiré) de la liste
 * courante. Rien n'est supprimé ; « Réafficher » le remet. Un lien ACTIF doit d'abord être révoqué
 * (sinon il resterait utilisable tout en étant caché).
 */
function archiveInvite(id, actor = null, now = new Date()) {
  const row = _inviteRow(id);
  if (_inviteState(row, now) === 'active') {
    throw new BetaError(409, 'Ce lien est encore actif : révoque-le d\'abord (sinon il resterait utilisable).', 'invite_active');
  }
  return db.runTransaction(() => {
    const info = conn().prepare("UPDATE beta_invites SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL").run(row.id);
    if (info.changes) _audit('invite_archive', 'invite', row.id, _codeHint(row.code), actor);
    return { changed: info.changes > 0, invite: _formatInvite(_inviteRow(row.id), now) };
  });
}

function unarchiveInvite(id, actor = null, now = new Date()) {
  const row = _inviteRow(id);
  return db.runTransaction(() => {
    const info = conn().prepare('UPDATE beta_invites SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL').run(row.id);
    if (info.changes) _audit('invite_unarchive', 'invite', row.id, _codeHint(row.code), actor);
    return { changed: info.changes > 0, invite: _formatInvite(_inviteRow(row.id), now) };
  });
}

/** Tous les liens (archivés compris, signalés par archivedAt) : le panel filtre. */
function listInvites(now = new Date()) {
  return conn().prepare('SELECT * FROM beta_invites ORDER BY id DESC LIMIT 300').all().map(r => _formatInvite(r, now));
}

/**
 * État d'un lien d'invitation, pour que le jeu accueille l'invité (ou explique clairement pourquoi
 * le lien ne marche plus) AVANT qu'il remplisse le formulaire. Ne révèle rien d'autre que l'état
 * du code fourni ; route limitée en débit (≈ 8·10¹¹ codes possibles : pas d'énumération).
 */
function inviteStatus(rawCode, now = new Date()) {
  const registration = getSettings().registrationMode;
  const code = normalizeCode(rawCode);
  const row = code && CODE_RE.test(code) && conn().prepare('SELECT * FROM beta_invites WHERE code = ?').get(code);
  const state = row ? _inviteState(row, now) : 'invalid';
  return { state: registration === 'closed' ? 'closed' : state, valid: registration !== 'closed' && state === 'active', registration };
}

/**
 * Vérifie l'inscription AVANT le hachage du mot de passe (refus rapide) : mode et code.
 * Renvoie le code normalisé (ou null). Lève BetaError sinon.
 */
function checkRegistration(rawCode, now = new Date()) {
  const mode = getSettings().registrationMode;
  if (mode === 'closed') throw new BetaError(403, 'Les inscriptions sont fermées pour le moment.', 'registration_closed');
  const given = typeof rawCode === 'string' && rawCode.trim() !== '';
  if (!given) {
    if (mode === 'invite') throw new BetaError(403, 'Inscription sur invitation : saisis ton code d\'invitation.', 'invite_required');
    return null;
  }
  const code = normalizeCode(rawCode);
  const row = code && CODE_RE.test(code) && conn().prepare('SELECT * FROM beta_invites WHERE code = ?').get(code);
  if (!row || _inviteState(row, now) !== 'active') {
    throw new BetaError(403, 'Code d\'invitation invalide, expiré ou déjà utilisé.', 'invite_invalid');
  }
  return code;
}

/**
 * Crée le compte et consomme le code dans UNE transaction (deux inscriptions simultanées ne
 * peuvent pas dépasser le nombre d'utilisations). `create()` crée l'utilisateur et le renvoie.
 */
function registerWithInvite(code, create, now = new Date()) {
  return db.runTransaction(() => {
    // Mode relu dans la transaction : une fermeture entre-temps est respectée.
    checkRegistration(code ?? '', now);
    const user = create();
    if (code) {
      const info = conn().prepare(`
        UPDATE beta_invites SET uses = uses + 1
         WHERE code = ? AND revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)`)
        .run(code, sqlTime(now));
      if (!info.changes) throw new BetaError(403, 'Code d\'invitation invalide, expiré ou déjà utilisé.', 'invite_invalid');
      const inv = conn().prepare('SELECT id FROM beta_invites WHERE code = ?').get(code);
      conn().prepare('INSERT INTO beta_invite_uses (invite_id, user_id) VALUES (?, ?)').run(inv.id, user.id);
    }
    return user;
  });
}

/**
 * Testeurs (comptes créés avec un code) : ancienneté et dernière sauvegarde cloud, pour suivre
 * activation et retour (J+1, J+7). Approximation assumée : la dernière sauvegarde est la seule
 * trace d'activité conservée (aucune mesure d'audience).
 */
function listTesters(now = new Date()) {
  const rows = conn().prepare(`
    SELECT u.id, u.username, u.created_at, i.code, i.label, i.wave, s.saved_at, x.removed_at,
           (SELECT COUNT(*) FROM bug_reports b WHERE b.user_id = u.id) AS reports
      FROM beta_invite_uses x
      JOIN users u ON u.id = x.user_id
      JOIN beta_invites i ON i.id = x.invite_id
      LEFT JOIN user_saves s ON s.user_id = u.id
     ORDER BY x.id DESC LIMIT 500`).all();
  const day = 86_400_000;
  const t = v => (v ? new Date(v.replace(' ', 'T') + 'Z').getTime() : null);
  const testers = rows.map(r => {
    const created = t(r.created_at), last = t(r.saved_at);
    return {
      userId: r.id, username: r.username, createdAt: r.created_at, lastSaveAt: r.saved_at,
      code: r.code, label: r.label, wave: r.wave, reports: r.reports, removedAt: r.removed_at || null,
      activated: last !== null,
      returnedD1: last !== null && last - created >= day,
      returnedD7: last !== null && last - created >= 7 * day,
      ageDays: Math.floor((now.getTime() - created) / day),
    };
  });
  // Compteurs et suivi J+1/J+7 : testeurs du programme seulement (les retirés restent listés à part).
  const inProgram = testers.filter(x => !x.removedAt);
  const old = n => inProgram.filter(x => x.ageDays >= n);
  return {
    testers,
    summary: {
      total: inProgram.length,
      removed: testers.length - inProgram.length,
      activated: inProgram.filter(x => x.activated).length,
      d1: { eligible: old(1).length, returned: old(1).filter(x => x.returnedD1).length },
      d7: { eligible: old(7).length, returned: old(7).filter(x => x.returnedD7).length },
    },
  };
}

/**
 * Retirer un testeur du programme bêta (#80) — retrait ADMINISTRATIF et réversible : il sort de la
 * liste des testeurs et des compteurs. Ce n'est PAS une coupure d'accès : la bêta ne contrôle que la
 * création de compte (la connexion n'a jamais dépendu du code d'invitation), donc le compte, la
 * connexion, la sauvegarde, le classement et l'historique anti-bot restent exactement tels quels.
 * Aucune donnée n'est supprimée : seule la date de retrait est notée. `confirm: true` exigé.
 */
function _testerRow(userId) {
  const row = conn().prepare(`
    SELECT x.*, u.username FROM beta_invite_uses x JOIN users u ON u.id = x.user_id WHERE x.user_id = ?`).get(_id(userId));
  if (!row) throw new BetaError(404, 'Ce joueur n\'est pas un testeur inscrit avec une invitation.');
  return row;
}

function removeTester(userId, { confirm } = {}, actor = null) {
  if (confirm !== true) throw new BetaError(400, 'Confirmation explicite requise.', 'confirm_required');
  const row = _testerRow(userId);
  return db.runTransaction(() => {
    const info = conn().prepare("UPDATE beta_invite_uses SET removed_at = datetime('now') WHERE id = ? AND removed_at IS NULL").run(row.id);
    if (info.changes) _audit('tester_remove', 'tester', row.user_id, row.username, actor);
    return { changed: info.changes > 0, removedAt: _testerRow(row.user_id).removed_at };
  });
}

function restoreTester(userId, actor = null) {
  const row = _testerRow(userId);
  return db.runTransaction(() => {
    const info = conn().prepare('UPDATE beta_invite_uses SET removed_at = NULL WHERE id = ? AND removed_at IS NOT NULL').run(row.id);
    if (info.changes) _audit('tester_restore', 'tester', row.user_id, row.username, actor);
    return { changed: info.changes > 0, removedAt: null };
  });
}

// ── Signalements ──────────────────────────────────────────────────────────────

const DIAG_KEYS = {
  version: 40, userAgent: 300, viewport: 20, screen: 20, language: 20, view: 30, online: 5, standalone: 5, page: 100,
};

/** Garde uniquement les champs de diagnostic attendus, en texte court. */
function _diagnostics(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const out = {};
  for (const [k, max] of Object.entries(DIAG_KEYS)) {
    if (d[k] === undefined || d[k] === null) continue;
    const v = String(d[k]).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
    if (k === 'page') out[k] = v.split(/[?#]/)[0];   // jamais de paramètres (jetons des liens e-mail)
    else out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

function createReport(userId, body = {}) {
  if (!getSettings().reportsEnabled) throw new BetaError(403, 'Le signalement est désactivé pour le moment.');
  const observed = _text(body.observed, TEXT_MAX, 'Constaté');
  if (observed.length < 5) throw new BetaError(400, 'Décris ce qui s\'est passé (5 caractères minimum).');
  const step     = _text(body.step, TEXT_MAX, 'Étape');
  const expected = _text(body.expected, TEXT_MAX, 'Attendu');
  const device   = _text(body.device, DEVICE_MAX, 'Appareil');
  const diag     = body.includeDiagnostics === true ? _diagnostics(body.diagnostics) : null;
  const id = conn().prepare(`
    INSERT INTO bug_reports (user_id, step, expected, observed, device, diagnostics) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId || null, step, expected, observed, device, diag ? JSON.stringify(diag) : null).lastInsertRowid;
  return { id, diagnostics: diag };
}

function _formatReport(r, admin) {
  const out = {
    id: r.id, step: r.step, expected: r.expected, observed: r.observed, status: r.status,
    githubUrl: r.github_url || null, createdAt: r.created_at, updatedAt: r.updated_at,
  };
  if (admin) out.archivedAt = r.archived_at || null;
  if (admin) {
    Object.assign(out, {
      userId: r.user_id, username: r.username ?? null, device: r.device, adminNote: r.admin_note,
      diagnostics: r.diagnostics ? JSON.parse(r.diagnostics) : null,
    });
  }
  return out;
}

function listMyReports(userId) {
  return conn().prepare('SELECT * FROM bug_reports WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(userId)
    .map(r => _formatReport(r, false));
}

/**
 * `archived` : false (défaut) = retours actifs, true = archives, 'all' = tous. Les compteurs par
 * statut portent sur les retours actifs ; `counts.archived` donne le nombre d'archives.
 */
function listReports({ status = null, archived = false } = {}) {
  const cond = [], args = [];
  if (STATUSES.includes(status)) { cond.push('b.status = ?'); args.push(status); }
  if (archived === true) cond.push('b.archived_at IS NOT NULL');
  else if (archived !== 'all') cond.push('b.archived_at IS NULL');
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const rows = conn().prepare(`
    SELECT b.*, u.username FROM bug_reports b LEFT JOIN users u ON u.id = b.user_id ${where}
     ORDER BY b.id DESC LIMIT 200`).all(...args);
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const c of conn().prepare('SELECT status, COUNT(*) AS n FROM bug_reports WHERE archived_at IS NULL GROUP BY status').all()) counts[c.status] = c.n;
  counts.archived = conn().prepare('SELECT COUNT(*) AS n FROM bug_reports WHERE archived_at IS NOT NULL').get().n;
  return { reports: rows.map(r => _formatReport(r, true)), counts };
}

/**
 * Archiver un retour (#80) : il quitte la liste active ; texte, diagnostic, statut, note et lien
 * GitHub sont conservés tels quels (preuve), et « Réafficher » le remet. Le joueur continue de voir
 * l'état de son signalement.
 */
function _setReportArchived(id, on, actor) {
  const row = conn().prepare('SELECT * FROM bug_reports WHERE id = ?').get(_id(id));
  if (!row) throw new BetaError(404, 'Signalement introuvable.');
  return db.runTransaction(() => {
    const info = on
      ? conn().prepare("UPDATE bug_reports SET archived_at = datetime('now') WHERE id = ? AND archived_at IS NULL").run(row.id)
      : conn().prepare('UPDATE bug_reports SET archived_at = NULL WHERE id = ? AND archived_at IS NOT NULL').run(row.id);
    if (info.changes) _audit(on ? 'report_archive' : 'report_unarchive', 'report', row.id, `n°${row.id}`, actor);
    return { changed: info.changes > 0 };
  });
}
const archiveReport   = (id, actor = null) => _setReportArchived(id, true, actor);
const unarchiveReport = (id, actor = null) => _setReportArchived(id, false, actor);

function updateReport(id, body = {}) {
  const row = conn().prepare('SELECT * FROM bug_reports WHERE id = ?').get(Number(id));
  if (!row) throw new BetaError(404, 'Signalement introuvable.');
  let { status, github_url: gh, admin_note: note } = row;
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw new BetaError(400, 'Statut inconnu.');
    status = body.status;
  }
  if (body.githubUrl !== undefined) {
    gh = _text(body.githubUrl, 200, 'Lien GitHub');
    if (gh && !GITHUB_RE.test(gh)) throw new BetaError(400, 'Lien GitHub invalide : attendu https://github.com/<compte>/<dépôt>/issues/<n>.');
  }
  if (body.adminNote !== undefined) note = _text(body.adminNote, TEXT_MAX, 'Note');
  conn().prepare(`UPDATE bug_reports SET status = ?, github_url = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, gh, note, row.id);
  return _formatReport({ ...conn().prepare('SELECT b.*, u.username FROM bug_reports b LEFT JOIN users u ON u.id = b.user_id WHERE b.id = ?').get(row.id) }, true);
}

/** Vue d'ensemble du panel. */
function adminSummary(now = new Date()) {
  return {
    settings: getSettings(), currentWave: currentWave(), invites: listInvites(now), ...listTesters(now),
    reports: listReports({ archived: 'all' }), audit: listAudit(30),
  };
}

module.exports = {
  BetaError,
  MODES,
  STATUSES,
  normalizeCode,
  getSettings,
  updateSettings,
  publicConfig,
  currentWave,
  createInvites,
  inviteStatus,
  revokeInvite,
  archiveInvite,
  unarchiveInvite,
  listInvites,
  removeTester,
  restoreTester,
  archiveReport,
  unarchiveReport,
  listAudit,
  checkRegistration,
  registerWithInvite,
  listTesters,
  createReport,
  listMyReports,
  listReports,
  updateReport,
  adminSummary,
};
