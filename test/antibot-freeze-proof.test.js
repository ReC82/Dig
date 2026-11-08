/**
 * #25 — Preuve du gel du classement pendant un défi (recette du propriétaire du 08/11/2026).
 *
 * Essai réel : OP Auto Clicker à 8 clics/s, seuil d'essai 3 min ; relevé 194 → 206 blocs (+12).
 * Les sauvegardes de production montrent +9 avant l'émission, 0 pendant le défi, +3 après la
 * résolution. Ces tests reproduisent l'essai et éprouvent le gel côté serveur :
 *   - relevés à l'émission et à la résolution, delta de blocs validés = 0 ;
 *   - sauvegardes en retard, client modifié qui continue de cliquer, second appareil, coffre ;
 *   - aucun crédit rétroactif des clics du défi après la résolution (fenêtre depuis la résolution) ;
 *   - garde-fou : un crédit pendant le défi est retiré et journalisé ;
 *   - classement des autres joueurs inchangé ; indice de reprise (bot supervisé) en lecture seule.
 * Base isolée, horloge simulée (une sauvegarde toutes les 12 s comme le jeu).
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-antibot-freeze-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const seasons   = require('../server/seasons');
const antibot   = require('../server/antibot');
const responses = require('../server/antibotResponses');

const SAVE_MS = 12_000;
const T0 = Date.UTC(2026, 10, 8, 10, 0, 0);
let seasonId;
let seq = 0;

const newUser = () => Number(db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`frz_${++seq}`, 'x').lastInsertRowid);
const cfg = () => db.getAdminConfig();

function ranked(userId) {
  const r = db.getDb().prepare('SELECT effective_manual_blocks AS e, manual_blocks AS m FROM season_rankings WHERE season_id = ? AND user_id = ?').get(seasonId, userId);
  return r ? Math.min(r.e, r.m) : 0;
}

/** Joueur : compteurs du client, PV des blocs (minage plausible pour #9/#77). */
function player(userId = newUser()) {
  return { userId, clicks: 0, blocks: 0, carry: 0, hp: Math.ceil(2 * antibot.minBlockHp(1)) };
}

function click(p, n) {
  p.clicks += n;
  let dmg = n * antibot.MAX_CLICK_DAMAGE + p.carry;
  while (dmg >= p.hp) { dmg -= p.hp; p.blocks++; p.hp = Math.ceil(2 * antibot.minBlockHp(1 + p.blocks)); }
  p.carry = dmg;
}

function save(p, nowMs, counters = p) {
  return seasons.syncPlayerRanking(p.userId, { seasonId, maxDepth: 1 + counters.blocks, manualBlocks: counters.blocks, autoBlocks: 0,
    manualClicks: counters.clicks, suspiciousScore: 0 }, { nowMs,
    telemetry: { n: 96, h: [0, 0, 0, 0, 96, 0, 0, 0], u: 96, x: 0, p: { m: 96, t: 0, k: 0, o: 0 } } });
}

/** Résout le défi en attente (énigme texte), en déclarant les compteurs du client. */
function solve(p, nowMs, declared = p) {
  const ch = responses.playerStatus(p.userId, { config: cfg(), nowMs }).challenge;
  const z = responses.newPuzzle(p.userId, ch.id, { kind: 'text', nowMs });
  const r = responses.answer(p.userId, ch.id, z.puzzleId, String(z.a + z.b),
    { manualClicks: declared.clicks, manualBlocks: declared.blocks, config: cfg(), nowMs: nowMs + 2000 });
  assert.strictEqual(r.solved, true);
  return { id: ch.id, at: nowMs + 2000 };
}

/** Essai du 08/11 : compte en essai Appliqué, seuil 3 min, 8 clics/s jusqu'au défi. */
function startRecipe(p, start) {
  responses.setForceMode(p.userId, true, start);
  responses.setTestThreshold(p.userId, 3, { seasonId, nowMs: start });
  let t = start;
  let st = null;
  for (let i = 0; i < 40 && !st?.challenge; i++) { t += SAVE_MS; click(p, 96); st = save(p, t); }
  assert.ok(st?.challenge, 'défi réel émis par le seuil d\'essai');
  return t;
}

const row = id => db.getDb().prepare('SELECT * FROM antibot_challenges WHERE id = ?').get(id);
const proofOf = (p, id) => responses.playerSection(p.userId, { config: cfg() }).history.challenges.find(c => c.id === id).freeze;

test.before(() => {
  db.initDb();
  db.setAdminConfig('antibot_response_mode', 'observe');
  const s = db.getActiveSeason() ?? db.createSeason('Test gel', '2026-11-01 00:00:00', '2026-11-30 23:59:59', 'active');
  db.getDb().prepare(`UPDATE seasons SET start_at = '2026-11-01 00:00:00', end_at = '2026-11-30 23:59:59' WHERE id = ?`).run(s.id);
  seasonId = s.id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration : colonnes de preuve ajoutées seules, idempotente', () => {
  const ch = db.getDb().prepare('PRAGMA table_info(antibot_challenges)').all().map(r => r.name);
  for (const c of ['issued_snapshot', 'resolved_snapshot', 'pending_saves', 'pending_last_ms', 'clamped_blocks']) assert.ok(ch.includes(c), c);
  assert.ok(db.getDb().prepare('PRAGMA table_info(antibot_activity)').all().some(r => r.name === 'rebase_ms'));
  db.initDb();
  assert.strictEqual(db.getDb().prepare('PRAGMA table_info(antibot_challenges)').all().length, ch.length);
});

test('essai du 08/11 reproduit : +N avant l\'émission, 0 pendant le défi, progression après la résolution', () => {
  const p = player();
  const start = T0;
  responses.setForceMode(p.userId, true, start);
  responses.setTestThreshold(p.userId, 3, { seasonId, nowMs: start });
  const before = ranked(p.userId);
  let t = start;
  let st = null;
  while (!st?.challenge) { t += SAVE_MS; click(p, 96); st = save(p, t); }
  const atIssue = ranked(p.userId);
  assert.ok(atIssue > before, `blocs crédités AVANT l'émission (${before} → ${atIssue})`);
  const ch = row(st.challenge.id);
  const issued = JSON.parse(ch.issued_snapshot);
  assert.strictEqual(issued.manualBlocks, atIssue, 'relevé à l\'émission = blocs validés à cet instant');
  assert.strictEqual(issued.atMs, t);
  // Le client officiel affiche le défi : il relève le compteur puis ne compte plus aucun coup
  responses.markSeen(p.userId, ch.id, { manualClicks: p.clicks, nowMs: t + 100 });
  click(p, 1);   // le clic en vol (held_clicks = 1 en production)
  for (let i = 0; i < 8; i++) { t += SAVE_MS; save(p, t); }
  assert.strictEqual(ranked(p.userId), atIssue, 'gel pendant le défi');
  const { at } = solve(p, t + 3000);
  const proof = proofOf(p, ch.id);
  assert.strictEqual(proof.verdict, 'frozen');
  assert.strictEqual(proof.deltaBlocks, 0);
  assert.strictEqual(proof.pendingSaves, 8);
  assert.strictEqual(proof.clampedBlocks, 0);
  assert.ok(proof.issued.at && proof.end.at && proof.end.atMs === at);
  // L'autoclicker est relancé après la résolution : la progression reprend (clics postérieurs seulement)
  t = at;
  for (let i = 0; i < 5; i++) { t += SAVE_MS; click(p, 96); save(p, t); }
  assert.ok(ranked(p.userId) > atIssue, 'progression après la résolution');
  assert.strictEqual(proofOf(p, ch.id).deltaBlocks, 0, 'la preuve reste celle de la fenêtre du défi');
});

test('client modifié qui continue de cliquer + sauvegardes en retard : aucun crédit pendant ni après', () => {
  const p = player();
  let t = startRecipe(p, T0 + 3600_000);
  const atIssue = ranked(p.userId);
  const id = responses.playerStatus(p.userId, { config: cfg(), nowMs: t }).challenge.id;
  // Sauvegarde en retard : compteurs capturés AVANT l'émission, reçue après → retenue (rien de plus)
  save(p, t + 500, { clicks: p.clicks, blocks: p.blocks });
  // Client modifié : ignore le défi, 8 clics/s pendant 90 s, sans jamais l'afficher (pas de relevé « vu »)
  for (let i = 0; i < 8; i++) { t += SAVE_MS; click(p, 96); save(p, t); }
  assert.strictEqual(ranked(p.userId), atIssue, 'aucun bloc crédité pendant le défi');
  assert.ok(row(id).held_clicks >= 8 * 96, 'clics retenus comptés');
  // Résolution : le client ment et déclare les compteurs d'avant le défi
  const { at } = solve(p, t + 1000, { clicks: 0, blocks: 0 });
  // Première sauvegarde 12 s après la résolution, sans nouveau clic : rien des clics du défi n'est crédité
  save(p, at + SAVE_MS);
  assert.strictEqual(ranked(p.userId), atIssue, 'aucun crédit rétroactif des clics du défi');
  assert.strictEqual(proofOf(p, id).verdict, 'frozen');
});

test('compteurs du défi non envoyés puis déclarés après la résolution : fenêtre de cadence comptée depuis la résolution', () => {
  const p = player();
  let t = startRecipe(p, T0 + 2 * 3600_000);
  const atIssue = ranked(p.userId);
  t += SAVE_MS; save(p, t);                       // dernière sauvegarde retenue
  const quiet = { clicks: p.clicks, blocks: p.blocks };
  click(p, 1200);                                  // clics pendant le défi, jamais sauvegardés
  const { at } = solve(p, t + 90_000, quiet);      // le client déclare les compteurs d'avant
  click(p, 30);
  save(p, at + SAVE_MS);
  const log = db.getDb().prepare('SELECT period_seconds AS delta_secs, period_clicks, action_taken AS action FROM anticheat_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(p.userId);
  assert.ok(log, 'rafale détectée par l\'anti-autoclic');
  assert.ok(log.delta_secs <= 12.5, `fenêtre depuis la résolution (${log.delta_secs} s), pas depuis la dernière sauvegarde retenue`);
  assert.ok(['flagged', 'reduced'].includes(log.action));
  assert.ok(ranked(p.userId) - atIssue <= Math.floor(8 * 12), 'crédit borné par la cadence maximale depuis la résolution');
});

test('second appareil (compteurs plus bas) et coffre (aucun clic) pendant le défi : gel maintenu', () => {
  const p = player();
  let t = startRecipe(p, T0 + 3 * 3600_000);
  const atIssue = ranked(p.userId);
  const id = responses.playerStatus(p.userId, { config: cfg(), nowMs: t }).challenge.id;
  // Second appareil : sauvegarde plus ancienne (compteurs plus bas) → nouvelle référence, rien crédité
  save(p, t + 4000, { clicks: p.clicks - 500, blocks: Math.max(0, p.blocks - 5) });
  // Retour du premier appareil, qui a continué (client modifié)
  click(p, 300); save(p, t + 8000);
  // Fenêtre de coffre ouverte : aucun clic, sauvegardes inchangées
  for (let i = 1; i <= 3; i++) save(p, t + 8000 + i * SAVE_MS);
  assert.strictEqual(ranked(p.userId), atIssue);
  // Onglet changé / F5 : l'état est relu côté serveur, le défi est toujours là
  assert.strictEqual(responses.playerStatus(p.userId, { config: cfg(), nowMs: t + 60_000 }).challenge.id, id);
  assert.strictEqual(proofOf(p, id).verdict, 'frozen', 'défi en cours : comparé à maintenant');
  assert.strictEqual(proofOf(p, id).open, true);
});

test('garde-fou : un crédit de blocs pendant un défi est retiré et journalisé', () => {
  const p = player();
  const t = startRecipe(p, T0 + 4 * 3600_000);
  const id = responses.playerStatus(p.userId, { config: cfg(), nowMs: t }).challenge.id;
  const keep = responses.recordHoldSave(p.userId, seasonId, { challengeId: id, suspensionId: null }, { before: 10, after: 13, nowMs: t + 1 });
  assert.strictEqual(keep, 10);
  assert.strictEqual(row(id).clamped_blocks, 3);
  const ev = db.getDb().prepare(`SELECT details FROM security_events WHERE user_id = ? AND type = 'freeze_clamped'`).get(p.userId);
  assert.strictEqual(JSON.parse(ev.details).clamped, 3);
  assert.strictEqual(responses.recordHoldSave(p.userId, seasonId, { challengeId: id }, { before: 10, after: 10, nowMs: t + 2 }), 10);
  assert.strictEqual(responses.recordHoldSave(p.userId, seasonId, null, { before: 1, after: 5 }), 5, 'hors défi : aucun effet');
});

test('annulation par l\'admin : relevé de fin enregistré ; autres joueurs non concernés', () => {
  const witness = player();
  let w = T0 + 5 * 3600_000;
  for (let i = 0; i < 5; i++) { w += SAVE_MS; click(witness, 40); save(witness, w); }
  const witnessBlocks = ranked(witness.userId);
  const p = player();
  const t = startRecipe(p, T0 + 5 * 3600_000);
  const id = responses.playerStatus(p.userId, { config: cfg(), nowMs: t }).challenge.id;
  assert.ok(responses.cancelChallenge(id, { note: 'essai', nowMs: t + 5000 }));
  const proof = proofOf(p, id);
  assert.strictEqual(proof.verdict, 'frozen');
  assert.strictEqual(proof.end.atMs, t + 5000);
  assert.strictEqual(ranked(witness.userId), witnessBlocks, 'témoin inchangé');
  assert.strictEqual(responses.playerStatus(witness.userId, { config: cfg() }), null, 'témoin en Observation : rien d\'affiché');
});

test('reprise après résolution (bot supervisé) : délai, cadence et clics non fiables, sans effet', () => {
  const p = player();
  let t = startRecipe(p, T0 + 6 * 3600_000);
  t += SAVE_MS; save(p, t);
  const { at } = solve(p, t + 10_000);
  t = at;
  t += SAVE_MS; save(p, t);                    // l'opérateur relance l'outil 24 s après
  t += SAVE_MS; click(p, 96); save(p, t);
  const r = responses.playerSection(p.userId, { config: cfg(), nowMs: t }).recidivism;
  assert.strictEqual(r.solved24h, 1);
  assert.ok(r.last.resumedAfterSecs >= 20 && r.last.resumedAfterSecs <= 26, `reprise ${r.last.resumedAfterSecs} s`);
  assert.strictEqual(r.last.resumeCps, 8);
  assert.strictEqual(responses.playerStatus(p.userId, { config: cfg(), nowMs: t }), null, 'aucun nouveau défi ni suspension du seul fait de la reprise');
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM antibot_suspensions WHERE user_id = ?').get(p.userId).n, 0);
});

test('défi antérieur sans relevé : verdict « inconnu », jamais « gel prouvé »', () => {
  const p = player();
  const t = startRecipe(p, T0 + 7 * 3600_000);
  const id = responses.playerStatus(p.userId, { config: cfg(), nowMs: t }).challenge.id;
  db.getDb().prepare('UPDATE antibot_challenges SET issued_snapshot = NULL WHERE id = ?').run(id);
  assert.strictEqual(proofOf(p, id).verdict, 'unknown');
});
