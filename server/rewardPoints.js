/**
 * server/rewardPoints.js — Points de récompense saisonniers (#33).
 *
 * Monnaie de fidélité distincte des pièces et des gemmes du gameplay : attribuée en fin de
 * saison selon le rang au classement figé (#29), conservée d'une saison à l'autre, dépensable
 * plus tard dans la boutique (#34). Aucune conversion en pièces, gemmes, argent ni transfert
 * entre joueurs.
 *
 * Règles :
 *   - barème versionné (`reward_point_scales`, ajout seul) : catégories exclusives, évaluées
 *     dans l'ordre, la première qui correspond s'applique (premier, meilleurs pourcentages,
 *     autres participants éligibles). Chaque catégorie peut exiger un nombre minimal
 *     d'éligibles ; les ex æquo parfaits (même profondeur et mêmes blocs validés) reçoivent
 *     la meilleure catégorie du groupe ; bonus optionnel par niveau de ligue (#19) ;
 *   - deux modes : `simulation` (par défaut : les points sont calculés et affichés, jamais
 *     crédités) et `live` (crédit au portefeuille). Le passage en `live` est une décision du
 *     propriétaire (barème non validé = pas de crédit) ; il ne crédite jamais rétroactivement
 *     les saisons terminées avant l'activation ;
 *   - attribution idempotente : une seule exécution par (saison, mode), un seul crédit par
 *     (saison, joueur) grâce à une clé d'idempotence UNIQUE dans le registre ;
 *   - registre en ajout seul (déclencheurs), solde jamais négatif (CHECK), dépense refusée
 *     si le solde est insuffisant : pas de double dépense. Les dépenses contre un cadeau réel
 *     restent verrouillées tant que les cadeaux réels ne sont pas activés (#27, #30).
 */

'use strict';

const db        = require('./db');
const cal       = require('./seasonCalendar');
const standings = require('./standings');

const MODES = ['simulation', 'live'];
const KINDS = ['season_award', 'spend', 'refund', 'admin_credit', 'admin_debit'];
const USES  = ['virtual', 'real'];
const MAX_TIERS  = 12;
const MAX_POINTS = 100000;
const HISTORY_LIMIT = 50;

/**
 * Barème PROPOSÉ (non validé par le propriétaire) : installé comme version 1 en mode
 * simulation uniquement, pour que chacun voie ce qu'il gagnerait. Voir docs/POINTS.md.
 */
const PROPOSED_SCALE = {
  label: 'Proposition v1 (non validée)',
  tiers: [
    { id: 'first',  label: '1er',        rankMax: 1,     minEligible: 3,  points: 100 },
    { id: 'top1',   label: 'Top 1 %',    percentMax: 1,  minEligible: 10, points: 60 },
    { id: 'top5',   label: 'Top 5 %',    percentMax: 5,  minEligible: 10, points: 40 },
    { id: 'top10',  label: 'Top 10 %',   percentMax: 10, minEligible: 10, points: 30 },
    { id: 'top25',  label: 'Top 25 %',   percentMax: 25, minEligible: 4,  points: 20 },
    { id: 'top50',  label: 'Top 50 %',   percentMax: 50, minEligible: 2,  points: 12 },
    { id: 'active', label: 'Participant',                                  points: 5 },
  ],
  tiesShareTier: true,
  leagueBonusPctPerLevel: 0,
  maxRiskLevel: null,
};

class PointsError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const conn = () => db.getDb();

// ── Barème ────────────────────────────────────────────────────────────────────

const _int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/**
 * Valide et normalise un barème. Lance PointsError(400) si invalide.
 * @returns {object} barème normalisé (champs connus uniquement)
 */
function validateScale(input) {
  if (!input || typeof input !== 'object') throw new PointsError(400, 'Barème manquant.');
  const tiers = input.tiers;
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > MAX_TIERS) {
    throw new PointsError(400, `Le barème doit contenir entre 1 et ${MAX_TIERS} catégories.`);
  }
  const ids = new Set();
  const out = tiers.map((t, i) => {
    if (!t || typeof t !== 'object') throw new PointsError(400, `Catégorie ${i + 1} invalide.`);
    const id = String(t.id ?? '').trim();
    if (!/^[a-z0-9_-]{1,20}$/.test(id) || ids.has(id)) throw new PointsError(400, `Identifiant de catégorie ${i + 1} invalide ou en double.`);
    ids.add(id);
    const label = String(t.label ?? id).trim().slice(0, 40) || id;
    if (!_int(t.points, 0, MAX_POINTS)) throw new PointsError(400, `Points de « ${id} » : entier entre 0 et ${MAX_POINTS}.`);
    const tier = { id, label, points: t.points };
    if (t.rankMax != null && t.percentMax != null) throw new PointsError(400, `« ${id} » : rankMax ou percentMax, pas les deux.`);
    if (t.rankMax != null) {
      if (!_int(t.rankMax, 1, 1_000_000)) throw new PointsError(400, `« ${id} » : rankMax entier ≥ 1.`);
      tier.rankMax = t.rankMax;
    }
    if (t.percentMax != null) {
      if (typeof t.percentMax !== 'number' || !(t.percentMax > 0 && t.percentMax <= 100)) {
        throw new PointsError(400, `« ${id} » : percentMax entre 0 (exclu) et 100.`);
      }
      tier.percentMax = t.percentMax;
    }
    if (t.minEligible != null) {
      if (!_int(t.minEligible, 1, 1_000_000)) throw new PointsError(400, `« ${id} » : minEligible entier ≥ 1.`);
      tier.minEligible = t.minEligible;
    }
    return tier;
  });
  const bonus = input.leagueBonusPctPerLevel ?? 0;
  if (!_int(bonus, 0, 100)) throw new PointsError(400, 'leagueBonusPctPerLevel : entier entre 0 et 100.');
  const risk = input.maxRiskLevel ?? null;
  if (risk !== null && !_int(risk, 0, 10)) throw new PointsError(400, 'maxRiskLevel : entier entre 0 et 10, ou null.');
  return {
    label: String(input.label ?? '').trim().slice(0, 80),
    tiers: out,
    tiesShareTier: input.tiesShareTier !== false,
    leagueBonusPctPerLevel: bonus,
    maxRiskLevel: risk,
  };
}

/** Plus grand rang inclus dans « top p % » parmi n éligibles (au moins le 1er). */
function percentCutoff(percent, n) {
  return Math.max(1, Math.ceil((n * percent) / 100 - 1e-9));
}

/** Catégorie (exclusive) d'un rang parmi n éligibles, ou null. */
function tierForRank(scale, rank, n) {
  if (!(rank >= 1) || !(n >= 1)) return null;
  for (const t of scale.tiers) {
    if (t.minEligible && n < t.minEligible) continue;
    if (t.rankMax != null && rank > t.rankMax) continue;
    if (t.percentMax != null && rank > percentCutoff(t.percentMax, n)) continue;
    return t;
  }
  return null;
}

/**
 * Calcule les attributions (pur, sans écriture) à partir des lignes figées d'une saison.
 * @param {object} scale       barème normalisé
 * @param {object[]} rows      lignes de season_standings (ordre de position)
 * @param {Map<number,number>} leagueLevels  league_id → niveau (bonus de ligue)
 * @returns {{ eligible: number, awards: object[] }}
 */
function computeAwards(scale, rows, leagueLevels = new Map()) {
  const elig = rows.filter(r => r.eligible && (scale.maxRiskLevel == null || (r.risk_level ?? 0) <= scale.maxRiskLevel))
    .sort((a, b) => a.position - b.position);
  const n = elig.length;
  const awards = elig.map((r, i) => ({
    user_id: r.user_id, rank: i + 1, league_id: r.league_id ?? null,
    max_depth: r.max_depth, blocks: r.effective_manual_blocks,
    tier: tierForRank(scale, i + 1, n),
  }));
  if (scale.tiesShareTier) {
    // Ex æquo parfaits (même profondeur, mêmes blocs validés : clés du tri RANK_ORDER) : la meilleure catégorie du groupe.
    // Les lignes sont triées au mérite : les ex æquo sont contigus et le premier a la meilleure.
    for (let i = 1; i < awards.length; i++) {
      const a = awards[i - 1], b = awards[i];
      if (a.max_depth === b.max_depth && a.blocks === b.blocks && a.tier) b.tier = a.tier;
    }
  }
  for (const a of awards) {
    const base  = a.tier ? a.tier.points : 0;
    const level = a.league_id != null ? (leagueLevels.get(a.league_id) ?? 0) : 0;
    a.points = Math.floor(base * (100 + scale.leagueBonusPctPerLevel * level) / 100);
  }
  return { eligible: n, awards };
}

// ── Réglages ──────────────────────────────────────────────────────────────────

function _settingsRow() {
  return conn().prepare('SELECT * FROM reward_points_settings WHERE id = 1').get();
}

function _scaleRow(version) {
  return version == null ? null
    : conn().prepare('SELECT * FROM reward_point_scales WHERE version = ?').get(version) ?? null;
}

/** Installe le barème proposé comme version 1 si aucun barème n'existe (idempotent). */
function ensureDefaults() {
  conn().transaction(() => {
    const s = _settingsRow();
    if (s.scale_version != null) return;
    const info = conn().prepare('INSERT INTO reward_point_scales (scale, note) VALUES (?, ?)')
      .run(JSON.stringify(validateScale(PROPOSED_SCALE)), 'Proposition initiale (#33), non validée');
    conn().prepare("UPDATE reward_points_settings SET scale_version = ?, updated_at = datetime('now') WHERE id = 1")
      .run(info.lastInsertRowid);
  })();
}

function getSettings() {
  if (_settingsRow().scale_version == null) ensureDefaults();
  const s = _settingsRow();
  const scaleRow = _scaleRow(s.scale_version);
  return {
    mode:         s.mode,
    liveSince:    s.live_since,
    scaleVersion: s.scale_version,
    scale:        scaleRow ? JSON.parse(scaleRow.scale) : null,
    scaleNote:    scaleRow ? scaleRow.note : null,
    updatedAt:    s.updated_at,
  };
}

/** Enregistre une nouvelle version du barème (les anciennes restent, pour l'audit). */
function setScale(input, note = '') {
  const scale = validateScale(input);
  return conn().transaction(() => {
    const info = conn().prepare('INSERT INTO reward_point_scales (scale, note) VALUES (?, ?)')
      .run(JSON.stringify(scale), String(note ?? '').slice(0, 200));
    conn().prepare("UPDATE reward_points_settings SET scale_version = ?, updated_at = datetime('now') WHERE id = 1")
      .run(info.lastInsertRowid);
    return getSettings();
  })();
}

/**
 * Change le mode. Passage en `live` : les saisons terminées à partir de maintenant seront
 * créditées ; aucune saison terminée avant n'est créditée rétroactivement.
 */
function setMode(mode, now = new Date()) {
  if (!MODES.includes(mode)) throw new PointsError(400, `Mode invalide (${MODES.join(' | ')}).`);
  conn().transaction(() => {
    const s = _settingsRow();
    if (s.mode === mode) return;
    if (mode === 'live') {
      conn().prepare("UPDATE reward_points_settings SET mode = 'live', live_since = ?, updated_at = datetime('now') WHERE id = 1")
        .run(cal.fmtUtc(now));
    } else {
      conn().prepare("UPDATE reward_points_settings SET mode = 'simulation', updated_at = datetime('now') WHERE id = 1").run();
    }
  })();
  return getSettings();
}

function listScales(limit = 20) {
  return conn().prepare('SELECT version, scale, note, created_at FROM reward_point_scales ORDER BY version DESC LIMIT ?')
    .all(limit).map(r => ({ version: r.version, scale: JSON.parse(r.scale), note: r.note, createdAt: r.created_at }));
}

// ── Registre (portefeuille) ───────────────────────────────────────────────────

function getWallet(userId) {
  const w = conn().prepare('SELECT * FROM reward_point_wallets WHERE user_id = ?').get(userId);
  return {
    balance:     w ? w.balance : 0,
    earnedTotal: w ? w.earned_total : 0,
    spentTotal:  w ? w.spent_total : 0,
    updatedAt:   w ? w.updated_at : null,
  };
}

/**
 * Écrit un mouvement (crédit > 0, débit < 0) de façon atomique et idempotente.
 * Une clé déjà utilisée renvoie le mouvement existant (`duplicate: true`) si elle porte sur
 * le même joueur et le même montant, sinon 409. Solde insuffisant : 409, rien n'est écrit.
 */
function _post(userId, delta, { kind, idemKey, seasonId = null, use = null, reason = null, meta = null }) {
  if (!Number.isInteger(userId) || userId < 1) throw new PointsError(400, 'Joueur invalide.');
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_POINTS * 100) throw new PointsError(400, 'Montant invalide.');
  if (!KINDS.includes(kind)) throw new PointsError(400, 'Type de mouvement invalide.');
  if (use != null && !USES.includes(use)) throw new PointsError(400, 'Usage invalide.');
  const key = String(idemKey ?? '').trim();
  if (!key || key.length > 120) throw new PointsError(400, "Clé d'idempotence requise (120 caractères max).");

  return conn().transaction(() => {
    const prev = conn().prepare('SELECT * FROM reward_point_ledger WHERE idem_key = ?').get(key);
    if (prev) {
      if (prev.user_id !== userId || prev.delta !== delta) throw new PointsError(409, "Clé d'idempotence déjà utilisée pour un autre mouvement.");
      return { entry: prev, duplicate: true };
    }
    const w = getWallet(userId);
    const balance = w.balance + delta;
    if (balance < 0) throw new PointsError(409, 'Solde de points insuffisant.');
    conn().prepare(`
      INSERT INTO reward_point_wallets (user_id, balance, earned_total, spent_total, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance, earned_total = excluded.earned_total,
        spent_total = excluded.spent_total, updated_at = excluded.updated_at`)
      .run(userId, balance, w.earnedTotal + Math.max(0, delta), w.spentTotal + Math.max(0, -delta));
    const info = conn().prepare(`
      INSERT INTO reward_point_ledger (user_id, delta, balance_after, kind, use, season_id, idem_key, reason, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, delta, balance, kind, use, seasonId, key, reason ? String(reason).slice(0, 200) : null,
        meta ? JSON.stringify(meta) : null);
    return { entry: conn().prepare('SELECT * FROM reward_point_ledger WHERE id = ?').get(info.lastInsertRowid), duplicate: false };
  })();
}

/**
 * Dépense de points (boutique #34). `use: 'real'` (cadeau réel) refusé tant que les cadeaux
 * réels ne sont pas activés (CONTEST_REAL_PRIZES=on, décision #27).
 */
function spend(userId, amount, { idemKey, use = 'virtual', reason = null, meta = null } = {}) {
  if (!USES.includes(use)) throw new PointsError(400, 'Usage invalide.');
  if (use === 'real' && process.env.CONTEST_REAL_PRIZES !== 'on') {
    throw new PointsError(403, 'Échange contre un cadeau réel désactivé (conformité #27).');
  }
  if (!Number.isInteger(amount) || amount < 1) throw new PointsError(400, 'Montant invalide.');
  return _post(userId, -amount, { kind: 'spend', idemKey, use, reason, meta });
}

/** Remboursement d'une dépense annulée (référence obligatoire au mouvement d'origine). */
function refund(userId, amount, { idemKey, spendId, reason = null } = {}) {
  const orig = conn().prepare("SELECT * FROM reward_point_ledger WHERE id = ? AND kind = 'spend'").get(spendId);
  if (!orig || orig.user_id !== userId) throw new PointsError(404, 'Dépense introuvable.');
  if (!Number.isInteger(amount) || amount < 1 || amount > -orig.delta) throw new PointsError(400, 'Montant invalide.');
  return _post(userId, amount, { kind: 'refund', idemKey, use: orig.use, reason, meta: { spendId } });
}

/** Ajustement admin motivé (crédit ou débit), toujours tracé dans le registre. */
function adminAdjust(userId, amount, { reason, idemKey } = {}) {
  const why = String(reason ?? '').trim();
  if (why.length < 3) throw new PointsError(400, 'Motif obligatoire (3 caractères minimum).');
  if (!db.getUserById(userId)) throw new PointsError(404, 'Joueur introuvable.');
  return _post(userId, amount, {
    kind: amount > 0 ? 'admin_credit' : 'admin_debit',
    idemKey: idemKey || `admin:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    reason: why,
  });
}

function getHistory(userId, limit = HISTORY_LIMIT) {
  return conn().prepare(`
    SELECT l.id, l.created_at, l.delta, l.balance_after, l.kind, l.use, l.season_id, l.reason, s.name AS season_name
    FROM reward_point_ledger l LEFT JOIN seasons s ON s.id = l.season_id
    WHERE l.user_id = ? ORDER BY l.id DESC LIMIT ?`).all(userId, limit)
    .map(r => ({
      id: r.id, createdAt: r.created_at, delta: r.delta, balanceAfter: r.balance_after, kind: r.kind,
      use: r.use, seasonId: r.season_id, seasonName: r.season_name, reason: r.kind.startsWith('admin') ? r.reason : null,
    }));
}

/** Contrôle : solde de chaque portefeuille = somme de son registre, jamais négatif. */
function verifyLedger() {
  const bad = conn().prepare(`
    SELECT w.user_id, w.balance, COALESCE(SUM(l.delta), 0) AS ledger
    FROM reward_point_wallets w LEFT JOIN reward_point_ledger l ON l.user_id = w.user_id
    GROUP BY w.user_id HAVING w.balance <> ledger OR w.balance < 0`).all();
  const orphan = conn().prepare(`
    SELECT COUNT(DISTINCT l.user_id) AS n FROM reward_point_ledger l
    LEFT JOIN reward_point_wallets w ON w.user_id = l.user_id WHERE w.user_id IS NULL`).get().n;
  return { ok: bad.length === 0 && orphan === 0, mismatches: bad, orphanUsers: orphan };
}

// ── Attribution de fin de saison ──────────────────────────────────────────────

function _leagueLevels() {
  return new Map(db.getAllLeagues().map(l => [l.id, l.level ?? 0]));
}

function _run(seasonId, mode) {
  return conn().prepare('SELECT * FROM reward_point_runs WHERE season_id = ? AND mode = ?').get(seasonId, mode) ?? null;
}

/**
 * Attribue les points d'une saison figée. Idempotent par (saison, mode).
 *   - simulation : toujours calculée (aperçu, aucun crédit) ;
 *   - live : seulement si le mode est `live` et que la saison s'est terminée après
 *     l'activation ; crédit au portefeuille avec la clé `season:<id>:user:<id>`.
 * @returns {{ simulation: object|null, live: object|null }}  exécutions créées (null sinon)
 */
function awardSeason(seasonId, { now = new Date() } = {}) {
  const snap = standings.getSnapshot(seasonId);
  if (!snap) throw new PointsError(409, `Saison ${seasonId} non figée : attribution impossible.`);
  const settings = getSettings();
  if (!settings.scale) throw new PointsError(409, 'Aucun barème défini.');
  const liveAllowed = settings.mode === 'live' && settings.liveSince && snap.season_end >= settings.liveSince;
  const result = { simulation: null, live: null };

  conn().transaction(() => {
    const rows = conn().prepare('SELECT * FROM season_standings WHERE season_id = ? ORDER BY position').all(seasonId);
    const { eligible, awards } = computeAwards(settings.scale, rows, _leagueLevels());
    const insAward = conn().prepare(`
      INSERT INTO reward_point_awards (season_id, mode, user_id, rank, eligible_count, tier, points, scale_version, ledger_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insRun = conn().prepare(`
      INSERT INTO reward_point_runs (season_id, mode, created_at, scale_version, snapshot_hash, eligible, recipients, total_points)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const mode of liveAllowed ? ['simulation', 'live'] : ['simulation']) {
      if (_run(seasonId, mode)) continue;
      let recipients = 0, total = 0;
      for (const a of awards) {
        let ledgerId = null;
        if (mode === 'live' && a.points > 0) {
          ledgerId = _post(a.user_id, a.points, {
            kind: 'season_award', idemKey: `season:${seasonId}:user:${a.user_id}`, seasonId,
            meta: { rank: a.rank, tier: a.tier?.id ?? null, scaleVersion: settings.scaleVersion },
          }).entry.id;
        }
        insAward.run(seasonId, mode, a.user_id, a.rank, eligible, a.tier?.id ?? null, a.points, settings.scaleVersion, ledgerId);
        if (a.points > 0) { recipients++; total += a.points; }
      }
      insRun.run(seasonId, mode, cal.fmtUtc(now), settings.scaleVersion, snap.snapshot_hash, eligible, recipients, total);
      result[mode] = { eligible, recipients, total };
      console.log(`[points] Saison ${seasonId} (${mode}) : ${recipients} joueur(s), ${total} point(s), barème v${settings.scaleVersion}`);
    }
  })();
  return result;
}

/**
 * Attribue les saisons figées sans exécution (planificateur). Erreurs journalisées, jamais
 * propagées : la rotation des saisons n'en dépend pas.
 */
function awardMissingSeasons(now = new Date()) {
  const s = _settingsRow();
  const missing = conn().prepare(`
    SELECT p.season_id FROM season_snapshots p
    WHERE NOT EXISTS (SELECT 1 FROM reward_point_runs r WHERE r.season_id = p.season_id AND r.mode = 'simulation')
       OR (? = 'live' AND p.season_end >= ? AND NOT EXISTS (SELECT 1 FROM reward_point_runs r WHERE r.season_id = p.season_id AND r.mode = 'live'))
    ORDER BY p.seq`).all(s.mode, s.live_since ?? '9999');
  let done = 0;
  for (const { season_id } of missing) {
    try { awardSeason(season_id, { now }); done++; }
    catch (err) { console.error(`[points] Saison ${season_id} non attribuée : ${err.message}`); }
  }
  return done;
}

// ── Vues ──────────────────────────────────────────────────────────────────────

function publicScale(settings = getSettings()) {
  return {
    mode: settings.mode,
    liveSince: settings.liveSince,
    scaleVersion: settings.scaleVersion,
    tiers: (settings.scale?.tiers ?? []).map(t => ({
      id: t.id, label: t.label, points: t.points,
      rankMax: t.rankMax ?? null, percentMax: t.percentMax ?? null, minEligible: t.minEligible ?? null,
    })),
    tiesShareTier: settings.scale?.tiesShareTier ?? true,
    leagueBonusPctPerLevel: settings.scale?.leagueBonusPctPerLevel ?? 0,
  };
}

/**
 * Récompense potentielle si la saison active se terminait maintenant (rang vivant, même
 * ordre que le classement figé). Indicatif : le classement figé à la clôture fait foi.
 */
function potentialFor(userId, settings = getSettings()) {
  const season = db.getActiveSeason();
  if (!season || !settings.scale) return null;
  const n = conn().prepare(`
    SELECT COUNT(*) AS n FROM season_rankings r JOIN users u ON u.id = r.user_id
    WHERE r.season_id = ? AND r.is_active = 1 AND r.manual_blocks > 0 AND r.max_depth > 0`).get(season.id).n;
  const entry = db.getPlayerSeasonEntry(season.id, userId);
  if (!entry || !entry.is_active || !(entry.max_depth > 0) || !(entry.manual_blocks > 0)) {
    return { seasonId: season.id, seasonEnd: season.end_at, eligibleCount: n, rank: null, tier: null, points: 0 };
  }
  const rankRow = db.getPlayerSeasonRank(season.id, userId);
  const rank = rankRow ? rankRow.rank_global : null;
  // Ex æquo parfaits : même règle qu'à la clôture (catégorie du premier du groupe).
  const tieRank = settings.scale.tiesShareTier ? conn().prepare(`
    SELECT COUNT(*) + 1 AS r FROM season_rankings r JOIN users u ON u.id = r.user_id
    WHERE r.season_id = ? AND r.is_active = 1 AND r.manual_blocks > 0 AND r.max_depth > 0
      AND (r.max_depth > ? OR (r.max_depth = ? AND r.effective_manual_blocks > ?))`)
    .get(season.id, entry.max_depth, entry.max_depth, entry.effective_manual_blocks).r : rank;
  const tier = rank ? tierForRank(settings.scale, Math.min(rank, tieRank), n) : null;
  const level = entry.league_id ? (_leagueLevels().get(entry.league_id) ?? 0) : 0;
  const points = tier ? Math.floor(tier.points * (100 + settings.scale.leagueBonusPctPerLevel * level) / 100) : 0;
  return { seasonId: season.id, seasonEnd: season.end_at, eligibleCount: n, rank, tied: !!rank && tieRank < rank, tieRank: rank ? Math.min(rank, tieRank) : null,
           tier: tier ? tier.id : null, points };
}

/** Résumé joueur : portefeuille, historique, barème, potentiel et attributions récentes. */
function buildPlayerSummary(userId) {
  const settings = getSettings();
  const awards = conn().prepare(`
    SELECT a.season_id, a.mode, a.rank, a.eligible_count, a.tier, a.points, s.name AS season_name
    FROM reward_point_awards a LEFT JOIN seasons s ON s.id = a.season_id
    WHERE a.user_id = ? ORDER BY a.season_id DESC, a.mode LIMIT 20`).all(userId)
    .map(a => ({
      seasonId: a.season_id, seasonName: a.season_name, mode: a.mode, rank: a.rank,
      eligibleCount: a.eligible_count, tier: a.tier, points: a.points,
    }));
  return {
    ...getWallet(userId),
    mode: settings.mode,
    scale: publicScale(settings),
    potential: potentialFor(userId, settings),
    history: getHistory(userId),
    awards,
  };
}

/** Vue admin : réglages, versions du barème, exécutions par saison et contrôle du registre. */
function buildAdminSummary() {
  const runs = conn().prepare(`
    SELECT r.*, s.name AS season_name FROM reward_point_runs r LEFT JOIN seasons s ON s.id = r.season_id
    ORDER BY r.season_id DESC, r.mode LIMIT 60`).all();
  const totals = conn().prepare(`
    SELECT COUNT(*) AS wallets, COALESCE(SUM(balance), 0) AS balance, COALESCE(SUM(earned_total), 0) AS earned,
           COALESCE(SUM(spent_total), 0) AS spent FROM reward_point_wallets`).get();
  return {
    settings: getSettings(),
    scales: listScales(),
    runs: runs.map(r => ({
      seasonId: r.season_id, seasonName: r.season_name, mode: r.mode, createdAt: r.created_at,
      scaleVersion: r.scale_version, eligible: r.eligible, recipients: r.recipients, totalPoints: r.total_points,
    })),
    totals,
    verification: verifyLedger(),
  };
}

/** Attributions d'une saison (admin), avec le nom des joueurs. */
function seasonAwards(seasonId) {
  return conn().prepare(`
    SELECT a.mode, a.user_id, u.username, a.rank, a.eligible_count, a.tier, a.points, a.scale_version, a.ledger_id
    FROM reward_point_awards a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.season_id = ? ORDER BY a.mode, a.rank`).all(seasonId);
}

/** Aperçu admin : attributions qu'un barème (en cours d'édition) donnerait sur une saison figée. */
function previewScale(input, seasonId) {
  const scale = validateScale(input);
  if (!standings.getSnapshot(seasonId)) throw new PointsError(404, 'Saison non figée.');
  const rows = conn().prepare('SELECT * FROM season_standings WHERE season_id = ? ORDER BY position').all(seasonId);
  const { eligible, awards } = computeAwards(scale, rows, _leagueLevels());
  return {
    eligible,
    total: awards.reduce((s, a) => s + a.points, 0),
    awards: awards.slice(0, 200).map(a => ({ userId: a.user_id, rank: a.rank, tier: a.tier?.id ?? null, points: a.points })),
  };
}

module.exports = {
  MODES, USES, PROPOSED_SCALE, PointsError,
  validateScale, percentCutoff, tierForRank, computeAwards,
  ensureDefaults, getSettings, setScale, setMode, listScales,
  getWallet, spend, refund, adminAdjust, getHistory, verifyLedger,
  awardSeason, awardMissingSeasons,
  publicScale, potentialFor, buildPlayerSummary, buildAdminSummary, seasonAwards, previewScale,
};
