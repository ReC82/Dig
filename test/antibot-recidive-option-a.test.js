/**
 * Ticket #25 — récidive, option A (décision du propriétaire du 08/11/2026, issuecomment-6720990840).
 *
 * Après une vérification réussie, seule la série de minage continu repart de zéro ; les cumuls de
 * temps actif sur 6 h et 24 h glissantes sont conservés. Seuils inchangés (60 / 180 / 360 min) ;
 * option B (seuil divisé par deux) NON appliquée. Horloge simulée, base isolée.
 *
 * Couvre : bot supervisé à cadence fixe et variable (défi résolu puis reprise) avec déclenchement
 * subséquent à 180 min / 6 h et 360 min / 24 h ; humain avec pauses et défi résolu sans sanction ;
 * frontières glissantes ; reconnexion, nouvel appareil, changement de saison, F5 ; client modifié
 * (clics pendant le défi non comptés) ; pas de double comptage à la résolution ; onglets
 * concurrents ; annulation admin ; compatibilité de la preuve du gel ; mode global Observation.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-antibot-optA-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const seasons   = require('../server/seasons');
const responses = require('../server/antibotResponses');

const T0 = Date.UTC(2026, 10, 9, 6, 0, 0);
const SAVE_SECS = 12;
const H = 3600_000;
let seasonId;
let seq = 0;

function newUser() {
  return Number(db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`optA_${++seq}`, 'x').lastInsertRowid);
}
const setMode = mode => db.setAdminConfig('antibot_response_mode', mode);

function m(userId, nowMs) {
  const row = db.getDb().prepare('SELECT * FROM antibot_activity WHERE user_id = ?').get(userId);
  return responses.metrics({ ...row, buckets: JSON.parse(row?.buckets ?? '[]') }, nowMs);
}
const challenges = userId => db.getDb().prepare('SELECT * FROM antibot_challenges WHERE user_id = ? ORDER BY id').all(userId);
const suspensions = userId => db.getDb().prepare('SELECT * FROM antibot_suspensions WHERE user_id = ?').all(userId);

function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/**
 * Client simulé : sauvegarde toutes les 12 s par le vrai pipeline. `official` : le jeu bloque les
 * coups pendant un défi affiché ; sinon (client modifié) les clics continuent d'être déclarés.
 * `solveAfter` : un humain résout le défi après n secondes (bot supervisé).
 */
function client({ userId = newUser(), startMs = T0, official = true, solveAfter = 60 } = {}) {
  const c = { userId, now: startMs, clicks: 0, frac: 0, shown: null, shownAt: 0 };
  c.save = () => seasons.syncPlayerRanking(userId, {
    seasonId, maxDepth: 1, manualBlocks: 0, autoBlocks: 0, manualClicks: c.clicks, suspiciousScore: 0,
  }, { nowMs: c.now });
  c.run = (secs, cpsAt) => {
    const end = c.now + secs * 1000;
    while (c.now < end) {
      c.now += SAVE_SECS * 1000;
      const cps = official && c.shown ? 0 : cpsAt(c.now);
      const n = Math.floor(cps * SAVE_SECS + c.frac);
      c.frac = cps * SAVE_SECS + c.frac - n;
      c.clicks += n;
      const st = c.save();
      if (st?.challenge) {
        if (!c.shown) c.shownAt = c.now;
        c.shown = st.challenge.id;
        if (!st.challenge.seen && !st.suspension) responses.markSeen(userId, st.challenge.id, { manualClicks: c.clicks, nowMs: c.now });
      } else c.shown = null;
      if (c.shown && solveAfter != null && c.now - c.shownAt >= solveAfter * 1000 && !st?.suspension) c.solve();
    }
    return c;
  };
  c.solve = () => {
    const p = responses.newPuzzle(userId, c.shown, { kind: 'text', nowMs: c.now - 2000 });
    const r = responses.answer(userId, c.shown, p.puzzleId, String(p.a + p.b), { manualClicks: c.clicks, manualBlocks: 0, nowMs: c.now });
    assert.ok(r.solved, 'défi résolu');
    c.shown = null;
  };
  return c;
}

const reasonsOf = ch => JSON.parse(ch.reasons).reasons.map(r => r.code);
const hoursOf = ch => (ch.created_ms - T0) / H;

test.before(() => {
  db.initDb();
  const s = db.getActiveSeason() ?? db.createSeason('Test option A', '2026-11-01 00:00:00', '2026-11-30 23:59:59', 'active');
  db.getDb().prepare(`UPDATE seasons SET start_at = '2026-11-01 00:00:00', end_at = '2026-11-30 23:59:59' WHERE id = ?`).run(s.id);
  seasonId = s.id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('défauts : mode global Appliqué (décision du 08/11), seuils 60 / 180 / 360 min et délai 30 min inchangés', () => {
  const cfg = db.getAdminConfig();
  assert.strictEqual(responses.getGlobalMode(cfg), 'enforce');
  const p = responses.getParams({});
  assert.deepStrictEqual([p.ab_streak_min, p.ab_active6h_min, p.ab_active24h_min, p.ab_cooldown_min], [60, 180, 360, 30]);
});

test('bot supervisé 8 clics/s fixes (Appliqué) : la résolution remet la série à zéro, pas les cumuls 6 h / 24 h', () => {
  setMode('enforce');
  const c = client().run(3700, () => 8);           // 1 h 01 : premier défi (série 60 min) puis résolution
  const [first] = challenges(c.userId);
  assert.deepStrictEqual(reasonsOf(first), ['continuous_mining']);
  assert.strictEqual(first.status, 'solved');
  const after = m(c.userId, c.now);
  assert.ok(after.streakMin < 2, `série repartie de zéro : ${after.streakMin}`);
  assert.ok(after.active6hMin >= 59 && after.active24hMin >= 59, `cumuls conservés : ${after.active6hMin} / ${after.active24hMin}`);
  setMode('observe');
});

test('bot supervisé à cadence fixe : défis à 1 h et 2 h (série), puis cumul 180 min / 6 h à ≈ 3 h, 360 min / 24 h à ≈ 6 h', () => {
  setMode('enforce');
  const c = client().run(7 * 3600, () => 8);
  const list = challenges(c.userId);
  assert.ok(list.every(x => x.status === 'solved' || x.status === 'pending'));
  assert.strictEqual(suspensions(c.userId).length, 0, 'client officiel + défi résolu : aucune sanction');
  const firstSix = list.find(x => reasonsOf(x).includes('active_6h'));
  const firstDay = list.find(x => reasonsOf(x).includes('active_24h'));
  assert.ok(firstSix && hoursOf(firstSix) > 2.9 && hoursOf(firstSix) < 3.2, `180 min / 6 h à ${firstSix && hoursOf(firstSix).toFixed(2)} h`);
  assert.ok(firstDay && hoursOf(firstDay) > 5.9 && hoursOf(firstDay) < 6.4, `360 min / 24 h à ${firstDay && hoursOf(firstDay).toFixed(2)} h`);
  // Avant 3 h : uniquement la série (≈ 1 défi par heure)
  assert.deepStrictEqual(list.filter(x => hoursOf(x) < 2.9).map(reasonsOf), [['continuous_mining'], ['continuous_mining']]);
  // Au-dessus du seuil : au plus un défi par délai minimal (30 min), jamais à chaque sauvegarde
  for (let i = 1; i < list.length; i++) {
    const gapMin = (list[i].created_ms - (list[i - 1].resolved_ms ?? list[i - 1].created_ms)) / 60_000;
    if (hoursOf(list[i]) > 3.2) assert.ok(gapMin >= 29.9, `écart ${gapMin.toFixed(1)} min`);
  }
  assert.ok(list.length >= 9 && list.length <= 11, `défis sur 7 h : ${list.length}`);
  // Le temps bloqué pendant les défis n'est pas compté : cumul 24 h < durée écoulée
  assert.ok(m(c.userId, c.now).active24hMin < 7 * 60 - list.length * 0.9, `cumul 24 h : ${m(c.userId, c.now).active24hMin}`);
  setMode('observe');
});

test('bot supervisé à cadence variable (4–12 clics/s, micro-pauses < 3 min) : même déclenchement à 180 min / 6 h', () => {
  setMode('enforce');
  const rng = seeded(7);
  const c = client({ solveAfter: 45 }).run(4 * 3600, t => ((t / 1000) % 900 < 840 ? 4 + 8 * rng() : 0));
  const list = challenges(c.userId);
  const six = list.find(x => reasonsOf(x).includes('active_6h'));
  assert.ok(six, 'défi « 180 min sur 6 h » atteint malgré les résolutions');
  assert.ok(hoursOf(six) < 3.6, `à ${hoursOf(six).toFixed(2)} h`);
  assert.strictEqual(suspensions(c.userId).length, 0);
  setMode('observe');
});

test('humain avec pauses (6 clics/s, 20 min / 10 min) et défi admin résolu : aucune sanction, aucun défi de cumul', () => {
  setMode('enforce');
  const c = client();
  const play = t => (((t - T0) / 1000) % 1800 < 1200 ? 6 : 0);
  c.run(1800, play);
  // Défi légitime (essai admin) résolu par l'humain
  const id = responses.adminIssueChallenge(c.userId, seasonId, { config: db.getAdminConfig(), nowMs: c.now }).id;
  c.shown = id; c.shownAt = c.now; c.now += 20_000; c.solve();
  c.run(4 * 3600, play);
  const list = challenges(c.userId);
  assert.deepStrictEqual(list.map(x => x.origin), ['admin'], 'aucun défi automatique');
  assert.strictEqual(suspensions(c.userId).length, 0);
  const mm = m(c.userId, c.now);
  assert.ok(mm.active6hMin > 140 && mm.active6hMin < 180, `cumul 6 h conservé sous le seuil : ${mm.active6hMin}`);
  setMode('observe');
});

test('fenêtres glissantes : le cumul 6 h redescend après 6 h, le cumul 24 h après 24 h', () => {
  setMode('observe');
  const c = client().run(50 * 60, () => 8);     // 50 min actives, sous les seuils
  const at = c.now;
  assert.ok(m(c.userId, at).active6hMin >= 49);
  assert.ok(m(c.userId, at + 5 * H).active6hMin >= 49, 'toujours dans la fenêtre à +5 h');
  assert.strictEqual(m(c.userId, at + 6 * H + 11 * 60_000).active6hMin, 0, 'sorti de la fenêtre 6 h');
  assert.ok(m(c.userId, at + 6 * H + 11 * 60_000).active24hMin >= 49, 'toujours dans les 24 h');
  assert.strictEqual(m(c.userId, at + 24 * H + 11 * 60_000).active24hMin, 0, 'sorti de la fenêtre 24 h');
});

test('reconnexion, F5, nouvel appareil, changement de saison : cumuls jamais remis à zéro ; seule une vraie absence coupe la série', () => {
  setMode('observe');
  const cfg = db.getAdminConfig();
  const c = client().run(40 * 60, () => 8);
  const base = m(c.userId, c.now);
  // F5 / redémarrage du serveur : l'état est en base, même compteur → rien ne change
  c.now += 5_000; c.save();
  assert.ok(Math.abs(m(c.userId, c.now).active6hMin - base.active6hMin) < 0.2);
  assert.ok(m(c.userId, c.now).streakMin >= base.streakMin - 0.1, 'F5 : série conservée');
  // Nouvel appareil avec un compteur inférieur, sans pause : fenêtre non mesurée, série et cumuls conservés
  const r1 = responses.beforeSave(c.userId, seasonId, { claimedClicks: 10, claimedBlocks: 0, config: cfg, nowMs: c.now + 12_000 });
  assert.ok(r1.metrics.active6hMin >= base.active6hMin - 0.1 && r1.metrics.streakMin >= base.streakMin - 0.1);
  // Changement de saison après 1 h d'absence : cumuls conservés, série coupée (vraie pause)
  const r2 = responses.beforeSave(c.userId, seasonId + 1000, { claimedClicks: 0, claimedBlocks: 0, config: cfg, nowMs: c.now + H });
  assert.ok(r2.metrics.active6hMin >= base.active6hMin - 0.1, `cumul 6 h conservé : ${r2.metrics.active6hMin}`);
  assert.ok(r2.metrics.active24hMin >= base.active24hMin - 0.1);
  assert.strictEqual(r2.metrics.streakMin, 0, 'absence d\'1 h : série coupée');
  // Retour sur la saison active, sans pause : série et cumuls non remis à zéro
  const r3 = responses.beforeSave(c.userId, seasonId, { claimedClicks: 0, claimedBlocks: 0, config: cfg, nowMs: c.now + H + 12_000 });
  assert.ok(r3.metrics.active6hMin >= base.active6hMin - 0.1);
});

test('client modifié : les clics déclarés pendant le défi ne sont pas comptés comme minage, ni après la résolution', () => {
  setMode('enforce');
  const c = client({ official: false, solveAfter: null }).run(3610, () => 10);
  const [ch] = challenges(c.userId);
  assert.ok(ch && ch.status === 'pending');
  const atIssue = m(c.userId, c.now);
  // 2 min de clics « déclarés » sous le défi (avant le seuil de violation : 30 clics → ici suspension possible)
  c.run(120, () => 10);
  const during = m(c.userId, c.now);
  assert.ok(Math.abs(during.active6hMin - atIssue.active6hMin) < 0.05, `cumul figé : ${atIssue.active6hMin} → ${during.active6hMin}`);
  assert.strictEqual(during.streakMin, 0);
  const row = db.getDb().prepare('SELECT last_window FROM antibot_activity WHERE user_id = ?').get(c.userId);
  assert.strictEqual(JSON.parse(row.last_window).frozen, true);
  setMode('observe');
});

test('pas de double comptage : les clics et le temps entre la dernière sauvegarde retenue et la résolution ne comptent pas', () => {
  setMode('enforce');
  const c = client({ solveAfter: null }).run(3610, () => 8);
  assert.strictEqual(challenges(c.userId)[0].status, 'pending');
  const before = m(c.userId, c.now).active24hMin;
  // 10 min bloquées, puis réponse avec un compteur déclaré plus haut (clics hors sauvegarde)
  c.now += 10 * 60_000; c.clicks += 400; c.solve();
  // Reprise : 1 min à 8 clics/s
  c.run(60, () => 8);
  const after = m(c.userId, c.now).active24hMin;
  assert.ok(after - before <= 1.05 && after - before >= 0.9, `seule la minute de reprise compte : +${(after - before).toFixed(2)} min`);
  setMode('observe');
});

test('onglets concurrents (compteurs croisés) : le temps actif ne dépasse jamais le temps écoulé', () => {
  setMode('observe');
  const cfg = db.getAdminConfig();
  const u = newUser();
  let now = T0, a = 0, b = 0;
  for (let i = 0; i < 300; i++) {            // 1 h : deux onglets qui sauvegardent en alternance
    now += 12_000; a += 30; b += 25;
    responses.beforeSave(u, seasonId, { claimedClicks: i % 2 ? b : a, claimedBlocks: 0, config: cfg, nowMs: now });
  }
  const mm = m(u, now);
  assert.ok(mm.active24hMin <= 60.1, `actif ${mm.active24hMin} min pour 60 min écoulées`);
});

test('annulation admin : série remise à zéro, cumuls conservés, nouveau défi de cumul au plus tôt 30 min après', () => {
  setMode('enforce');
  db.setAdminConfig('ab_active6h_min', '30');     // base isolée : seuil bas pour l'essai
  const c = client({ solveAfter: null }).run(32 * 60, () => 8);
  const [ch] = challenges(c.userId);
  assert.ok(reasonsOf(ch).includes('active_6h'));
  assert.ok(responses.cancelChallenge(ch.id, { nowMs: c.now }));
  const kept = m(c.userId, c.now);
  assert.ok(kept.active6hMin >= 30, 'cumul conservé après annulation');
  c.run(25 * 60, () => 8);
  assert.strictEqual(challenges(c.userId).length, 1, 'pas de nouveau défi avant 30 min');
  c.run(6 * 60, () => 8);
  assert.strictEqual(challenges(c.userId).length, 2, 'nouveau défi après le délai minimal');
  db.setAdminConfig('ab_active6h_min', '180');
  setMode('observe');
});

test('preuve du gel (#25-G) inchangée : défi résolu → +0 bloc validé pendant le défi', () => {
  setMode('enforce');
  const c = client({ solveAfter: 90 }).run(3700, () => 8);
  const sec = responses.playerSection(c.userId, { config: db.getAdminConfig(), nowMs: c.now });
  const ch = sec.history.challenges.find(x => x.status === 'solved');
  assert.ok(ch?.freeze, 'preuve du gel présente');
  assert.strictEqual(ch.freeze.verdict, 'frozen');
  assert.strictEqual(ch.freeze.deltaBlocks, 0);
  setMode('observe');
});
