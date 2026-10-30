/**
 * server/contest.js — Concours au mérite : réglages, aperçu, attribution des lots, suivi des
 * gagnants et journal d'audit (#30).
 *
 * Règles (décisions du propriétaire du 30/10/2026, #27 et #29) :
 *   - aucun tirage : les lots vont aux premiers éligibles du classement figé (#29), dans l'ordre
 *     au mérite de l'instantané ; les critères du concours (profondeur minimale, niveau de risque
 *     anti-bot maximal, délai avant un nouveau gain, exclusions motivées) s'appliquent en plus ;
 *   - deux modes : `simulation` (toujours possible, aucun lot réel, aucun stock consommé) et
 *     `real` (cadeaux réels), **verrouillé** tant que la variable d'environnement
 *     CONTEST_REAL_PRIZES ne vaut pas « on » (décision explicite d'activation, #27 § 4) ;
 *   - interdiction de double attribution : un seul gagnant par (saison, mode, lot) et un seul lot
 *     par joueur et par saison (contraintes UNIQUE), attribution transactionnelle et idempotente ;
 *   - suivi : désigné → contacté → identité vérifiée → lot envoyé → confirmé ; « expiré » possible
 *     avant l'envoi. Chaque changement est journalisé dans `contest_audit` (ajout seul) ;
 *   - confidentialité : aucun e-mail ni code cadeau n'est stocké dans les tables du concours, ni
 *     journalisé ; les notes qui ressemblent à un e-mail ou à un code sont refusées. L'e-mail du
 *     gagnant n'est lu qu'à la demande (route dédiée, consultation journalisée sans l'adresse).
 */

'use strict';

const db        = require('./db');
const cal       = require('./seasonCalendar');
const standings = require('./standings');

const MODES = ['simulation', 'real'];

/** Transitions autorisées du suivi d'un gagnant. */
const TRANSITIONS = {
  designated:        ['contacted', 'expired'],
  contacted:         ['identity_verified', 'expired'],
  identity_verified: ['sent', 'expired'],
  sent:              ['confirmed'],
  confirmed:         [],
  expired:           [],
};
const STATUSES = Object.keys(TRANSITIONS);
const OPEN_STATUSES = ['designated', 'contacted', 'identity_verified'];

class ContestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const conn = () => db.getDb();

function realPrizesUnlocked() {
  return process.env.CONTEST_REAL_PRIZES === 'on';
}

// ── Réglages ──────────────────────────────────────────────────────────────────

function _parseJson(s, def) {
  try { return JSON.parse(s); } catch (_) { return def; }
}

function getSettings() {
  const r = conn().prepare('SELECT * FROM contest_settings WHERE id = 1').get();
  return {
    enabled:         !!r.enabled,
    title:           r.title,
    description:     r.description,
    prize: {
      label:      r.prize_label,
      provider:   r.prize_provider,
      valueCents: r.prize_value_cents,
      currency:   r.prize_currency,
      stock:      r.prize_stock,
    },
    lotsPerSeason:   r.lots_per_season,
    startsAt:        r.starts_at,
    endsAt:          r.ends_at,
    minDepth:        r.min_depth,
    maxRiskLevel:    r.max_risk_level,
    cooldownSeasons: r.cooldown_seasons,
    claimDays:       r.claim_days,
    realEligibility: _parseJson(r.real_eligibility, {}),
    updatedAt:       r.updated_at,
    realPrizesUnlocked: realPrizesUnlocked(),
  };
}

const str = (v, max, field) => {
  if (typeof v !== 'string') throw new ContestError(400, `${field} : texte attendu.`);
  const t = v.trim();
  if (t.length > max) throw new ContestError(400, `${field} : ${max} caractères au maximum.`);
  return t;
};
const int = (v, min, max, field) => {
  if (!Number.isInteger(v) || v < min || v > max) throw new ContestError(400, `${field} : entier entre ${min} et ${max} attendu.`);
  return v;
};
const date = (v, field) => {
  if (v === null || v === '') return null;
  const d = cal.normalizeDate(v);
  if (!d) throw new ContestError(400, `${field} : date invalide.`);
  return d;
};

function _realEligibility(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ContestError(400, 'realEligibility : objet attendu.');
  const countries = v.countries ?? [];
  if (!Array.isArray(countries) || countries.length > 60 || !countries.every(c => typeof c === 'string' && /^[A-Z]{2}$/.test(c))) {
    throw new ContestError(400, 'realEligibility.countries : codes pays ISO à 2 lettres majuscules.');
  }
  return {
    countries:       [...new Set(countries)],
    minAge:          v.minAge == null ? null : int(v.minAge, 0, 21, 'realEligibility.minAge'),
    parentalConsent: !!v.parentalConsent,
    provider:        str(v.provider ?? '', 40, 'realEligibility.provider'),
    notes:           str(v.notes ?? '', 300, 'realEligibility.notes'),
  };
}

/** Champs modifiables → [colonne, validation]. */
const SETTINGS_FIELDS = {
  enabled:         ['enabled',           v => (v === true || v === false ? (v ? 1 : 0) : (() => { throw new ContestError(400, 'enabled : booléen attendu.'); })())],
  title:           ['title',             v => str(v, 80, 'title')],
  description:     ['description',       v => str(v, 500, 'description')],
  prizeLabel:      ['prize_label',       v => str(v, 80, 'prizeLabel')],
  prizeProvider:   ['prize_provider',    v => str(v, 40, 'prizeProvider')],
  prizeValueCents: ['prize_value_cents', v => int(v, 0, 100000, 'prizeValueCents')],
  prizeCurrency:   ['prize_currency',    v => { if (typeof v !== 'string' || !/^[A-Z]{3}$/.test(v)) throw new ContestError(400, 'prizeCurrency : code ISO à 3 lettres (EUR, USD…).'); return v; }],
  prizeStock:      ['prize_stock',       v => int(v, 0, 1000, 'prizeStock')],
  lotsPerSeason:   ['lots_per_season',   v => int(v, 1, 10, 'lotsPerSeason')],
  startsAt:        ['starts_at',         v => date(v, 'startsAt')],
  endsAt:          ['ends_at',           v => date(v, 'endsAt')],
  minDepth:        ['min_depth',         v => int(v, 0, 1000000, 'minDepth')],
  maxRiskLevel:    ['max_risk_level',    v => (v === null || v === '' ? null : int(v, 0, 4, 'maxRiskLevel'))],
  cooldownSeasons: ['cooldown_seasons',  v => int(v, 0, 52, 'cooldownSeasons')],
  claimDays:       ['claim_days',        v => int(v, 1, 365, 'claimDays')],
  realEligibility: ['real_eligibility',  v => JSON.stringify(_realEligibility(v))],
};

/**
 * Met à jour les réglages (champs inconnus refusés). L'activation (`enabled`) ne déverrouille
 * jamais les cadeaux réels : elle indique seulement que le concours est ouvert.
 */
function updateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new ContestError(400, 'Corps JSON attendu.');
  const unknown = Object.keys(patch).filter(k => !SETTINGS_FIELDS[k]);
  if (unknown.length) throw new ContestError(400, `Champ(s) inconnu(s) : ${unknown.join(', ')}.`);
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(patch)) {
    const [col, check] = SETTINGS_FIELDS[k];
    sets.push(`${col} = ?`);
    vals.push(check(v));
  }
  if (!sets.length) throw new ContestError(400, 'Aucun champ à modifier.');
  return conn().transaction(() => {
    const before = getSettings();
    conn().prepare(`UPDATE contest_settings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = 1`).run(...vals);
    const after = getSettings();
    if (after.startsAt && after.endsAt && after.endsAt < after.startsAt) {
      throw new ContestError(400, 'Calendrier : la fin doit suivre le début.');
    }
    const changes = {};
    for (const k of Object.keys(patch)) {
      const b = _flatSetting(before, k);
      const a = _flatSetting(after, k);
      if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = { from: b, to: a };
    }
    audit('settings_updated', { details: changes });
    return after;
  })();
}

function _flatSetting(s, k) {
  const map = {
    prizeLabel: s.prize.label, prizeProvider: s.prize.provider, prizeValueCents: s.prize.valueCents,
    prizeCurrency: s.prize.currency, prizeStock: s.prize.stock,
  };
  return k in map ? map[k] : s[k];
}

// ── Journal ───────────────────────────────────────────────────────────────────

function audit(action, { seasonId = null, winnerId = null, from = null, to = null, details = null } = {}) {
  conn().prepare(`
    INSERT INTO contest_audit (action, season_id, winner_id, from_status, to_status, details)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(action, seasonId, winnerId, from, to, details == null ? null : JSON.stringify(details).slice(0, 4000));
}

function listAudit({ limit = 100, offset = 0, winnerId = null } = {}) {
  const where = winnerId ? 'WHERE winner_id = ?' : '';
  const args  = winnerId ? [winnerId] : [];
  const rows = conn().prepare(`SELECT * FROM contest_audit ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  const total = conn().prepare(`SELECT COUNT(*) AS n FROM contest_audit ${where}`).get(...args).n;
  return {
    total,
    events: rows.map(r => ({
      id: r.id, createdAt: r.created_at, action: r.action, seasonId: r.season_id, winnerId: r.winner_id,
      from: r.from_status, to: r.to_status, details: _parseJson(r.details, null),
    })),
  };
}

/**
 * Note libre d'un changement de statut : courte, et jamais d'e-mail ni de code cadeau
 * (le journal doit pouvoir être montré sans risque).
 */
function checkNote(note) {
  if (note == null || note === '') return null;
  const t = str(note, 300, 'note');
  const tokens = t.split(/\s+/).map(w => w.replace(/^[^\w@]+|[^\w]+$/g, ''));
  if (tokens.some(w => w.includes('@'))) {
    throw new ContestError(400, 'La note ne doit pas contenir d\'adresse e-mail.');
  }
  if (tokens.some(w => /^[A-Z0-9-]{10,}$/i.test(w) && /\d/.test(w) && /[A-Z]/i.test(w))) {
    throw new ContestError(400, 'La note ressemble à un code cadeau : ne jamais écrire de code dans le journal.');
  }
  return t;
}

// ── Exclusions motivées ───────────────────────────────────────────────────────

function _exclusions(seasonId) {
  return new Map(conn().prepare('SELECT user_id, reason, created_at FROM contest_exclusions WHERE season_id = ?')
    .all(seasonId).map(r => [r.user_id, r]));
}

function setExclusion(seasonId, userId, reason) {
  if (!db.getSeasonById(seasonId)) throw new ContestError(404, 'Saison introuvable.');
  const why = str(reason ?? '', 200, 'reason');
  if (why.length < 3) throw new ContestError(400, 'Motif obligatoire (3 caractères au moins).');
  checkNote(why);
  return conn().transaction(() => {
    const r = conn().prepare('INSERT OR IGNORE INTO contest_exclusions (season_id, user_id, reason) VALUES (?, ?, ?)').run(seasonId, userId, why);
    if (!r.changes) throw new ContestError(409, 'Joueur déjà exclu pour cette saison.');
    audit('exclusion_added', { seasonId, details: { userId, reason: why } });
  })();
}

function removeExclusion(seasonId, userId) {
  return conn().transaction(() => {
    const r = conn().prepare('DELETE FROM contest_exclusions WHERE season_id = ? AND user_id = ?').run(seasonId, userId);
    if (!r.changes) throw new ContestError(404, 'Aucune exclusion pour ce joueur.');
    audit('exclusion_removed', { seasonId, details: { userId } });
  })();
}

// ── Aperçu (simulation) ───────────────────────────────────────────────────────

/** Joueurs ayant gagné (lot non expiré) dans les `n` saisons précédant `season`, pour ce mode. */
function _recentWinners(season, n, mode) {
  if (!n) return new Set();
  return new Set(conn().prepare(`
    SELECT w.user_id FROM contest_winners w
    WHERE w.mode = ? AND w.status != 'expired' AND w.season_id IN (
      SELECT id FROM seasons WHERE end_at < ? ORDER BY end_at DESC LIMIT ?
    )`).all(mode, season.end_at, n).map(r => r.user_id));
}

function _inCalendar(season, s) {
  if (s.startsAt && season.end_at < s.startsAt) return false;
  if (s.endsAt && season.end_at > s.endsAt) return false;
  return true;
}

/**
 * Applique les critères du concours au classement d'une saison, sans rien écrire.
 * Saison figée : instantané #29 (attribuable). Saison active : classement vivant (indicatif).
 */
function preview(seasonId, { mode = 'simulation' } = {}) {
  if (!MODES.includes(mode)) throw new ContestError(400, 'Mode inconnu.');
  const season = db.getSeasonById(seasonId);
  if (!season) throw new ContestError(404, 'Saison introuvable.');
  const s = getSettings();
  const snap = standings.getSnapshot(seasonId);
  let rows;
  let source;
  if (snap) {
    rows = conn().prepare('SELECT * FROM season_standings WHERE season_id = ? ORDER BY position').all(seasonId);
    source = 'snapshot';
  } else {
    rows = standings.computeStandings(db.getSeasonParticipantsRanked(seasonId));
    source = 'live';
  }
  const ids = [...new Set(rows.map(r => r.user_id))];
  const users = ids.length
    ? new Map(conn().prepare(`SELECT id, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids).map(u => [u.id, u]))
    : new Map();
  const excluded = _exclusions(seasonId);
  const recent   = _recentWinners(season, s.cooldownSeasons, mode);
  const existing = listWinners({ seasonId, mode });
  const lots     = s.lotsPerSeason;

  let selected = 0;
  const participants = rows.map(r => {
    const reason = !r.eligible ? (r.exclusion_reason || 'not_eligible')
                 : !users.has(r.user_id) ? 'account_deleted'
                 : r.max_depth < s.minDepth ? 'below_min_depth'
                 : (s.maxRiskLevel !== null && r.risk_level > s.maxRiskLevel) ? 'risk_level'
                 : excluded.has(r.user_id) ? 'admin_excluded'
                 : recent.has(r.user_id) ? 'cooldown'
                 : null;
    const wouldWin = !reason && selected < lots ? ++selected : null;
    return {
      position: r.position, rank: r.rank, userId: r.user_id,
      username: users.get(r.user_id)?.username ?? null,
      maxDepth: r.max_depth, manualBlocks: Math.min(r.effective_manual_blocks, r.manual_blocks),
      maxDepthReachedAt: r.max_depth_reached_at, riskLevel: r.risk_level,
      contestEligible: !reason, reason,
      exclusion: excluded.get(r.user_id)?.reason ?? null,
      lotNo: wouldWin,
    };
  });

  const blockers = [];
  if (source !== 'snapshot') blockers.push('season_not_frozen');
  if (snap) {
    const v = standings.verifySnapshot(seasonId);
    if (!v.ok) blockers.push('snapshot_verification_failed');
  }
  if (!_inCalendar(season, s)) blockers.push('outside_calendar');
  if (existing.length) blockers.push('already_attributed');
  if (mode === 'real') {
    if (!realPrizesUnlocked()) blockers.push('real_prizes_locked');
    if (!s.enabled) blockers.push('contest_disabled');
    if (s.prize.stock < Math.min(lots, selected)) blockers.push('insufficient_stock');
  }

  return {
    season: { id: season.id, name: season.name, startAt: season.start_at, endAt: season.end_at, status: season.status },
    mode, source,
    snapshot: snap ? { hash: snap.snapshot_hash, createdAt: snap.created_at, source: snap.source } : null,
    criteria: { lotsPerSeason: lots, minDepth: s.minDepth, maxRiskLevel: s.maxRiskLevel, cooldownSeasons: s.cooldownSeasons },
    counts: {
      participants: participants.length,
      eligible: participants.filter(p => p.contestEligible).length,
      lots: Math.min(lots, selected),
    },
    attributable: blockers.length === 0 && selected > 0,
    blockers,
    participants,
    winners: existing,
  };
}

// ── Attribution ───────────────────────────────────────────────────────────────

/**
 * Attribue les lots d'une saison figée aux premiers éligibles (aucun hasard). Transactionnel ;
 * refuse une seconde attribution pour la même saison et le même mode (409).
 */
function attribute(seasonId, { mode = 'simulation', now = new Date() } = {}) {
  return conn().transaction(() => {
    const p = preview(seasonId, { mode });
    if (p.blockers.includes('already_attributed')) throw new ContestError(409, 'Lots déjà attribués pour cette saison (double attribution interdite).');
    if (p.blockers.length) throw new ContestError(409, `Attribution impossible : ${p.blockers.join(', ')}.`);
    const picks = p.participants.filter(x => x.lotNo);
    if (!picks.length) throw new ContestError(409, 'Aucun participant éligible : aucun lot attribué.');
    const s = getSettings();
    const prize = JSON.stringify({ label: s.prize.label, provider: s.prize.provider, valueCents: s.prize.valueCents, currency: s.prize.currency });
    const expires = cal.fmtUtc(new Date(now.getTime() + s.claimDays * 86400_000));
    const created = cal.fmtUtc(now);
    const ins = conn().prepare(`
      INSERT INTO contest_winners (season_id, mode, lot_no, user_id, username, rank, max_depth, snapshot_hash,
                                   prize, status, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'designated', ?, ?, ?)`);
    for (const w of picks) {
      const id = ins.run(seasonId, mode, w.lotNo, w.userId, w.username, w.rank, w.maxDepth, p.snapshot.hash,
        prize, created, created, expires).lastInsertRowid;
      audit('winner_designated', { seasonId, winnerId: id, to: 'designated',
        details: { mode, lotNo: w.lotNo, userId: w.userId, rank: w.rank, maxDepth: w.maxDepth, snapshot: p.snapshot.hash.slice(0, 16) } });
    }
    if (mode === 'real') {
      conn().prepare('UPDATE contest_settings SET prize_stock = prize_stock - ? WHERE id = 1').run(picks.length);
    }
    return listWinners({ seasonId, mode });
  })();
}

// ── Gagnants ──────────────────────────────────────────────────────────────────

function _formatWinner(w, now = new Date()) {
  return {
    id: w.id, seasonId: w.season_id, seasonName: w.season_name ?? null, mode: w.mode, lotNo: w.lot_no,
    userId: w.user_id, username: w.username, rank: w.rank, maxDepth: w.max_depth,
    snapshotHash: w.snapshot_hash, prize: _parseJson(w.prize, {}), status: w.status,
    createdAt: w.created_at, updatedAt: w.updated_at, expiresAt: w.expires_at,
    overdue: OPEN_STATUSES.includes(w.status) && w.expires_at < cal.fmtUtc(now),
    next: TRANSITIONS[w.status] ?? [],
  };
}

function listWinners({ seasonId = null, mode = null, status = null } = {}) {
  const where = [];
  const args = [];
  if (seasonId) { where.push('w.season_id = ?'); args.push(seasonId); }
  if (mode)     { where.push('w.mode = ?');      args.push(mode); }
  if (status)   { where.push('w.status = ?');    args.push(status); }
  return conn().prepare(`
    SELECT w.*, s.name AS season_name FROM contest_winners w LEFT JOIN seasons s ON s.id = w.season_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY s.end_at DESC, w.season_id DESC, w.mode, w.lot_no`).all(...args).map(w => _formatWinner(w));
}

function getWinner(id) {
  const w = conn().prepare('SELECT w.*, s.name AS season_name FROM contest_winners w LEFT JOIN seasons s ON s.id = w.season_id WHERE w.id = ?').get(id);
  if (!w) throw new ContestError(404, 'Gagnant introuvable.');
  return w;
}

/** Fait avancer le suivi d'un gagnant ; transitions contrôlées, note sans e-mail ni code. */
function transition(id, to, note, { now = new Date() } = {}) {
  if (!STATUSES.includes(to)) throw new ContestError(400, 'Statut inconnu.');
  const clean = checkNote(note);
  return conn().transaction(() => {
    const w = getWinner(id);
    if (!TRANSITIONS[w.status].includes(to)) {
      throw new ContestError(409, `Transition interdite : ${w.status} → ${to}.`);
    }
    if (w.mode === 'real' && to === 'sent' && !realPrizesUnlocked()) {
      throw new ContestError(423, 'Cadeaux réels verrouillés : envoi impossible.');
    }
    const r = conn().prepare(`UPDATE contest_winners SET status = ?, updated_at = ? WHERE id = ? AND status = ?`)
      .run(to, cal.fmtUtc(now), id, w.status);
    if (!r.changes) throw new ContestError(409, 'Statut modifié entre-temps, recharger.');
    // Un lot réel expiré n'a pas été remis : il retourne au stock.
    if (w.mode === 'real' && to === 'expired') {
      conn().prepare('UPDATE contest_settings SET prize_stock = prize_stock + 1 WHERE id = 1').run();
    }
    audit('winner_status', { seasonId: w.season_id, winnerId: id, from: w.status, to, details: clean ? { note: clean } : null });
    return _formatWinner(getWinner(id), now);
  })();
}

/** Coordonnées du gagnant pour le contacter (lecture seule, consultation journalisée sans l'adresse). */
function contact(id) {
  const w = getWinner(id);
  const u = conn().prepare('SELECT username, email, email_verified_at FROM users WHERE id = ?').get(w.user_id);
  audit('contact_viewed', { seasonId: w.season_id, winnerId: id, details: { found: !!u } });
  if (!u) return { accountExists: false, username: w.username, email: null, emailVerified: false };
  return { accountExists: true, username: u.username, email: u.email ?? null, emailVerified: !!u.email_verified_at };
}

/** Saisons proposées dans le panel : figées ou active, les plus récentes d'abord. */
function listSeasons() {
  return conn().prepare(`
    SELECT s.id, s.name, s.start_at, s.end_at, s.status,
           (p.season_id IS NOT NULL) AS frozen,
           (SELECT COUNT(*) FROM contest_winners w WHERE w.season_id = s.id AND w.mode = 'simulation') AS sim_winners,
           (SELECT COUNT(*) FROM contest_winners w WHERE w.season_id = s.id AND w.mode = 'real') AS real_winners
    FROM seasons s LEFT JOIN season_snapshots p ON p.season_id = s.id
    WHERE s.status != 'scheduled'
    ORDER BY s.end_at DESC, s.id DESC LIMIT 60`).all()
    .map(r => ({ id: r.id, name: r.name, startAt: r.start_at, endAt: r.end_at, status: r.status,
      frozen: !!r.frozen, simulationWinners: r.sim_winners, realWinners: r.real_winners }));
}

module.exports = {
  MODES,
  STATUSES,
  TRANSITIONS,
  ContestError,
  realPrizesUnlocked,
  getSettings,
  updateSettings,
  preview,
  attribute,
  listWinners,
  transition,
  contact,
  setExclusion,
  removeExclusion,
  listAudit,
  listSeasons,
  checkNote,
};
