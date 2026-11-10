/**
 * Ticket #91 — détection rapide des autoclickers basiques (décisions du propriétaire du 08/11/2026).
 *
 * Profils simulés : autoclicker 125 ms fixe (horloge fine et minuterie Windows), extension
 * (clics non fiables), cadence bruitée ±10–35 % (lot 2 : non détectée comme « machine »), humains
 * rapides (souris, tactile), joueur PC à souris immobile, clavier / accessibilité, horloge grossière.
 * Pipeline réel (seasons.syncPlayerRanking) sur base isolée, horloge simulée : délai avant
 * vérification, suspension seulement sur récidive corroborée, Observation, interrupteurs.
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-autoclick-91-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db        = require('../server/db');
const seasons   = require('../server/seasons');
const responses = require('../server/antibotResponses');
const antibot   = require('../server/antibot');
const detector  = require('../server/autoclickDetector');

const T0 = Date.UTC(2026, 10, 9, 8, 0, 0);
const MIN = 60_000;
let seasonId;
let seq = 0;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
function gauss(r) {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

/** Même calcul que public/js/main.js (_fastStats) : médiane, MAD, part des 3 classes de 4 ms les plus remplies. */
function stats(iv) {
  const k = iv.length;
  const med = [...iv].sort((a, b) => a - b)[k >> 1];
  const mad = iv.map(g => Math.abs(g - med)).sort((a, b) => a - b)[k >> 1];
  const bins = new Map();
  for (const g of iv) { const b = Math.floor(g / detector.BIN_MS); bins.set(b, (bins.get(b) || 0) + 1); }
  const top = [...bins.values()].sort((a, b) => b - a);
  return { k, t3: Math.round((top[0] + (top[1] || 0) + (top[2] || 0)) / k * 1000) / 1000, med: Math.round(med * 10) / 10, mad: Math.round(mad * 10) / 10 };
}

/**
 * Télémétrie d'une fenêtre de `secs` secondes. gen(r) → intervalle (ms). samePixel : tous les coups
 * au même point ; still : souris jamais déplacée ; untrusted : clics générés par script.
 */
function windowTel({ gen, secs = 12, r, samePixel = false, still = false, untrusted = false, kind = 'm', coarse = false, runBefore = 0 }) {
  const iv = [];
  let t = 0;
  while (t < secs * 1000) { const g = Math.max(1, gen(r)); t += g; iv.push(g); }
  const n = iv.length;
  const s = stats(iv);
  const coords = kind !== 'k';
  const run = coords && samePixel ? runBefore + n : (coords ? 1 : 0);
  return {
    n, u: untrusted ? n : 0, x: 0, h: null, p: { m: kind === 'm' ? n : 0, t: kind === 't' ? n : 0, k: kind === 'k' ? n : 0, o: 0 },
    f: { ...s, coarse: coarse ? 1 : 0, sp: run, run, mc: coords ? n : 0, mm: kind === 'm' ? n : 0, still: kind === 'm' && still ? n : 0 },
  };
}

const PROFILES = {
  op125:      r => 125 + (r() - 0.5) * 0.6,                                  // OP Auto Clicker, horloge fine
  op125win:   r => { const x = r(); return x < 0.05 ? 109.4 : x < 0.1 ? 140.6 : 125 + (r() - 0.5) * 2; }, // minuterie Windows
  op125busy:  r => 125 + 5 * gauss(r),                                       // gigue du navigateur chargé (σ 5 ms)
  jitter10:   r => 125 * (1 + (r() * 2 - 1) * 0.10),
  jitter35:   r => 125 * (1 + (r() * 2 - 1) * 0.35),
  human8cv08: r => 125 * (1 + 0.08 * gauss(r)),
  human8cv12: r => 125 * (1 + 0.12 * gauss(r)),
  human6cv20: r => 166 * (1 + 0.20 * gauss(r)),
  human4logn: r => 250 * Math.exp(0.25 * gauss(r)),
  steadyHuman05: r => 125 * (1 + 0.05 * gauss(r)),
};

const settings = detector.getSettings({});
const evalTel = (tel, windows = []) => detector.evaluate(antibot.normalizeTelemetry(tel), windows, settings);

// ── Unitaires : profils ─────────────────────────────────────────────────────────

test('réglages par défaut : détection ON, 25 clics au même pixel, suspension sur récidive ON, 60 min', () => {
  assert.deepStrictEqual(settings, { ab_fast_mode: 'on', ab_same_pixel_mode: 'on', ab_fast_suspend: 'on', ab_same_pixel_clicks: 25, ab_fast_repeat_min: 60 });
  assert.deepStrictEqual(detector.validateConfigValue('ab_same_pixel_clicks', '30'), { value: '30' });
  assert.ok(detector.validateConfigValue('ab_same_pixel_clicks', '5').error);
  assert.ok(detector.validateConfigValue('ab_fast_mode', 'maybe').error);
  assert.strictEqual(detector.validateConfigValue('autre', '1'), null);
});

test('client et serveur partagent la même largeur de classe (4 ms) et le même calcul', () => {
  const main = fs.readFileSync(path.join(__dirname, '../public/js/main.js'), 'utf8');
  assert.match(main, /const _FAST_BIN_MS = 4;/);
  assert.strictEqual(detector.BIN_MS, 4);
  assert.match(main, /t3 = \(top\[0\] \+ \(top\[1\] \|\| 0\) \+ \(top\[2\] \|\| 0\)\) \/ k;/);
  assert.match(main, /mad = iv\.map\(g => Math\.abs\(g - med\)\)\.sort\(\(a, b\) => a - b\)\[k >> 1\];/);
});

test('OP Auto Clicker 125 ms, souris immobile, même pixel : autoclicker corroboré dès la 1ʳᵉ fenêtre', () => {
  for (const p of ['op125', 'op125win', 'op125busy']) {
    const v = evalTel(windowTel({ gen: PROFILES[p], r: rng(1), samePixel: true, still: true }));
    assert.ok(v.regular, `${p} régulier (t3 ${v.evidence.top3Share})`);
    assert.ok(v.fixed && v.still && v.automation, p);
  }
  // Envoi immédiat au 25ᵉ coup (≈ 3 s à 8 clics/s) : même pixel (vérification), rythme pas encore jugé (< 40 intervalles)
  const early = evalTel(windowTel({ gen: PROFILES.op125, secs: 3.2, r: rng(2), samePixel: true, still: true }));
  assert.ok(early.samePixel && !early.regularKnown && !early.automation, JSON.stringify(early.evidence));
});

test('extension (clics générés par script, même point) : corroboré sans immobilité souris', () => {
  const v = evalTel(windowTel({ gen: PROFILES.op125, r: rng(3), samePixel: true, untrusted: true, kind: 'm', still: false }));
  assert.ok(v.automation && v.untrusted && !v.still);
});

test('autoclicker tactile (Android, même point, clics fiables) : corroboré par la cadence stable du serveur', () => {
  const tel = windowTel({ gen: PROFILES.op125, r: rng(4), samePixel: true, kind: 't' });
  assert.ok(!evalTel(tel).automation, 'sans 3ᵉ indice : même pixel seul');
  const windows = [0, 1, 2, 3, 4].map(i => [T0 + i * 12_000, 12, 96]);
  const v = evalTel(tel, windows);
  assert.ok(v.steady && v.automation);
});

test('cadence bruitée ±10 % et ±35 % : pas de « rythme machine » (lot 2), même pixel → vérification seulement', () => {
  for (const p of ['jitter10', 'jitter35']) {
    const v = evalTel(windowTel({ gen: PROFILES[p], r: rng(5), samePixel: true, still: true }));
    assert.ok(!v.regular && !v.automation && v.samePixel, p);
  }
});

test('faux positifs « rythme machine » : ≤ 0,5 % des fenêtres de 12 s à CV 8 %, 0 au-delà', () => {
  const rates = {};
  for (const p of ['human8cv08', 'human8cv12', 'human6cv20', 'human4logn', 'steadyHuman05']) {
    const r = rng(42);
    let reg = 0;
    for (let i = 0; i < 2000; i++) if (evalTel(windowTel({ gen: PROFILES[p], r })).regular) reg++;
    rates[p] = reg / 2000;
  }
  for (const p of ['human8cv12', 'human6cv20', 'human4logn']) assert.strictEqual(rates[p], 0, `${p} : ${rates[p]}`);
  assert.ok(rates.human8cv08 <= 0.005, `CV 8 % : ${rates.human8cv08}`);
  // Humain exceptionnellement régulier (CV 5 %) : mesuré et rapporté — jamais seul suffisant, et la
  // suspension exige 2 fenêtres corroborées consécutives après une vérification
  console.log('[#91] humain CV 5 % jugé régulier :', rates.steadyHuman05);
  console.log('[#91] fenêtres jugées « rythme machine » :', JSON.stringify(rates));
});

test('joueur PC à souris immobile (même pixel, rythme humain) : vérification possible, jamais « autoclicker »', () => {
  const v = evalTel(windowTel({ gen: PROFILES.human8cv12, r: rng(6), samePixel: true, still: true }));
  assert.ok(v.samePixel && v.still && !v.regular && !v.automation);
});

test('clavier / accessibilité (aucune coordonnée) : ni même pixel ni immobilité', () => {
  const v = evalTel(windowTel({ gen: PROFILES.op125, r: rng(7), kind: 'k' }));
  assert.ok(!v.samePixel && !v.still && !v.automation);
});

test('horloge grossière (anti-empreinte) : régularité « inconnue », jamais retenue', () => {
  const v = evalTel(windowTel({ gen: PROFILES.op125, r: rng(8), samePixel: true, still: true, coarse: true }));
  assert.ok(!v.regularKnown && !v.regular && !v.automation && v.samePixel);
});

test('télémétrie forgée ou ancienne : bornée, ignorée sans « f »', () => {
  const t = antibot.normalizeTelemetry({ n: 50, u: 0, f: { k: -3, t3: 9, med: 'x', sp: 1e12, still: 99, mm: 10 } });
  assert.deepStrictEqual([t.f.k, t.f.t3, t.f.med, t.f.sp, t.f.still], [0, 1, null, 1e6, 10]);
  assert.strictEqual(antibot.normalizeTelemetry({ n: 5 }).f, undefined);
  assert.ok(!evalTel({ n: 96, u: 0 }).automation);
});

// ── Pipeline réel ────────────────────────────────────────────────────────────

function newUser() {
  return Number(db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(`ac91_${++seq}`, 'x').lastInsertRowid);
}
const challenges = userId => db.getDb().prepare('SELECT * FROM antibot_challenges WHERE user_id = ? ORDER BY id').all(userId);
const suspensions = userId => db.getDb().prepare('SELECT * FROM antibot_suspensions WHERE user_id = ? ORDER BY id').all(userId);
const reasonsOf = ch => JSON.parse(ch.reasons).reasons.map(r => r.code);
const cfg = (k, v) => db.setAdminConfig(k, v);

/**
 * Client simulé (jeu officiel : aucun coup pendant une vérification affichée). Sauvegarde toutes les
 * 12 s, ou dès 25 coups au même pixel. profile : générateur d'intervalles ; resolveAfter : secondes
 * avant qu'un humain résolve l'énigme (bot supervisé), null = jamais.
 */
function client({ profile, samePixel = true, still = true, untrusted = false, kind = 'm', resolveAfter = 20, seed = 9 }) {
  const userId = newUser();
  const r = rng(seed);
  const c = { userId, now: T0, clicks: 0, blocks: 0, shown: null, shownAt: 0, run: 0, firstChallengeMs: null };
  c.save = (secs, tel) => seasons.syncPlayerRanking(userId, {
    seasonId, maxDepth: 1 + c.blocks, manualBlocks: c.blocks, autoBlocks: 0, manualClicks: c.clicks, suspiciousScore: 0,
  }, { nowMs: c.now, telemetry: tel });
  c.step = secs => {
    let tel = null;
    if (!c.shown) {
      tel = windowTel({ gen: PROFILES[profile], secs, r, samePixel, still, untrusted, kind, runBefore: c.run });
      c.run = tel.f.run;
      c.clicks += tel.n;
      c.blocks += Math.floor(tel.n / 10);
    }
    c.now += secs * 1000;
    const st = c.save(secs, tel);
    if (st?.challenge && !c.shown) {
      c.shown = st.challenge.id; c.shownAt = c.now; c.run = 0;
      if (c.firstChallengeMs == null) c.firstChallengeMs = c.now - T0;
      if (!st.suspension) responses.markSeen(userId, st.challenge.id, { manualClicks: c.clicks, nowMs: c.now });
    }
    if (c.shown && resolveAfter != null && !st?.suspension && c.now - c.shownAt >= resolveAfter * 1000) {
      const p = responses.newPuzzle(userId, c.shown, { kind: 'text', nowMs: c.now - 3000 });
      if (!p.error) {
        const a = responses.answer(userId, c.shown, p.puzzleId, String(p.a + p.b), { manualClicks: c.clicks, manualBlocks: c.blocks, nowMs: c.now });
        if (a.solved) c.shown = null;
      }
    }
    return st;
  };
  c.run_ = (totalSecs, first = 3.2) => {
    // 1ʳᵉ sauvegarde anticipée (25 coups au même pixel), puis toutes les 12 s
    const end = c.now + totalSecs * 1000;
    if (first && samePixel && kind !== 'k') c.step(first);
    while (c.now < end) c.step(12);
    return c;
  };
  return c;
}

test.before(() => {
  db.initDb();
  const s = db.getActiveSeason() ?? db.createSeason('Test #91', '2026-11-01 00:00:00', '2026-11-30 23:59:59', 'active');
  db.getDb().prepare(`UPDATE seasons SET start_at = '2026-11-01 00:00:00', end_at = '2026-11-30 23:59:59' WHERE id = ?`).run(s.id);
  seasonId = s.id;
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migration : colonne fast_state ajoutée, réglages #91 présents en base', () => {
  const cols = db.getDb().prepare('PRAGMA table_info(antibot_activity)').all().map(c => c.name);
  assert.ok(cols.includes('fast_state'));
  const c = db.getAdminConfig();
  assert.deepStrictEqual([c.ab_fast_mode, c.ab_same_pixel_mode, c.ab_same_pixel_clicks, c.ab_fast_suspend, c.ab_fast_repeat_min], ['on', 'on', '25', 'on', '60']);
});

test('Appliqué — OP Auto Clicker 125 ms : vérification en ≈ 3 s, puis 5 min puis 15 min de suspension s\'il reprend après chaque énigme', () => {
  cfg('antibot_response_mode', 'enforce');
  const c = client({ profile: 'op125busy', resolveAfter: 20 }).run_(55);
  const [first] = challenges(c.userId);
  assert.deepStrictEqual(reasonsOf(first), ['same_pixel']);
  assert.ok(c.firstChallengeMs <= 4000, `vérification après ${c.firstChallengeMs} ms`);
  console.log(`[#91] OP 125 ms : 1re vérification après ${c.firstChallengeMs / 1000} s`);
  assert.strictEqual(first.status, 'solved');
  // Reprise immédiate après la résolution → 2 fenêtres corroborées (≈ 24 s) → suspension niveau 1 (5 min) + nouvelle vérification
  const susp1 = suspensions(c.userId)[0];
  assert.ok(susp1 && (susp1.starts_ms - first.resolved_ms) <= 30_000, `suspension ${susp1 ? (susp1.starts_ms - first.resolved_ms) / 1000 : '—'} s après la reprise`);
  console.log(`[#91] OP 125 ms : suspension ${(susp1.starts_ms - first.resolved_ms) / 1000} s après la reprise`);
  let su = suspensions(c.userId);
  assert.strictEqual(su.length, 1);
  assert.strictEqual(su[0].level, 1);
  assert.strictEqual((su[0].ends_ms - su[0].starts_ms) / MIN, 5);
  assert.strictEqual(JSON.parse(su[0].reason).code, 'autoclick_repeat');
  const st = responses.playerStatus(c.userId, { config: db.getAdminConfig(), nowMs: c.now });
  assert.strictEqual(st.suspension.reason, 'autoclick_repeat');
  // Classement gelé : aucun bloc manuel validé de plus pendant la vérification/suspension
  const validated = () => db.getDb().prepare('SELECT MIN(effective_manual_blocks, manual_blocks) AS v FROM season_rankings WHERE user_id = ?').get(c.userId)?.v ?? 0;
  const before = validated();
  c.run_(4 * 60, 0);
  assert.strictEqual(validated(), before, 'aucun crédit pendant la suspension');
  // Fin de suspension, énigme résolue, reprise → palier 2 (15 min)
  c.run_(4 * 60, 0);
  su = suspensions(c.userId);
  assert.strictEqual(su.length, 2, JSON.stringify(su.map(s => s.level)));
  assert.strictEqual((su[1].ends_ms - su[1].starts_ms) / MIN, 15);
});

test('Appliqué — joueur PC immobile au rythme humain : vérification « même pixel », au plus une par 30 min, jamais de suspension', () => {
  cfg('antibot_response_mode', 'enforce');
  const c = client({ profile: 'human8cv12', resolveAfter: 15, seed: 21 }).run_(2 * 3600);
  const chs = challenges(c.userId);
  assert.ok(chs.length >= 1 && chs.every(ch => reasonsOf(ch).includes('same_pixel') || reasonsOf(ch).includes('continuous_mining')), JSON.stringify(chs.map(reasonsOf)));
  for (let i = 1; i < chs.length; i++) assert.ok(chs[i].created_ms - chs[i - 1].resolved_ms >= 30 * MIN - 12_000, 'délai minimal respecté');
  assert.ok(chs.length <= 5, `${chs.length} vérifications en 2 h`);
  console.log(`[#91] joueur immobile, 2 h : ${chs.length} vérification(s), raisons ${JSON.stringify(chs.map(reasonsOf))}`);
  assert.strictEqual(suspensions(c.userId).length, 0);
});

test('Appliqué — humain rapide qui bouge la souris : aucune vérification #91', () => {
  const c = client({ profile: 'human8cv08', samePixel: false, still: false, seed: 33 }).run_(20 * 60);
  assert.strictEqual(challenges(c.userId).length, 0);
});

test('Appliqué — autoclicker bruité ±35 % au même pixel (lot 2) : vérifications, pas de suspension automatique', () => {
  const c = client({ profile: 'jitter35', resolveAfter: 15, seed: 34 }).run_(40 * 60);
  const chs = challenges(c.userId);
  assert.ok(chs.length >= 1 && chs.every(ch => !reasonsOf(ch).includes('autoclick_corroborated')));
  assert.strictEqual(suspensions(c.userId).length, 0);
});

test('Observation — autoclicker : vérifications simulées et « suspension simulée » journalisée, rien d\'appliqué', () => {
  cfg('antibot_response_mode', 'observe');
  const c = client({ profile: 'op125' }).run_(60);
  const chs = challenges(c.userId);
  assert.ok(chs.length >= 2 && chs.every(ch => ch.status === 'shadow'));
  assert.strictEqual(suspensions(c.userId).length, 0);
  const ev = db.getDb().prepare(`SELECT COUNT(*) AS n FROM security_events WHERE user_id = ? AND type = 'suspension_shadow'`).get(c.userId).n;
  assert.ok(ev >= 1);
  assert.strictEqual(responses.playerStatus(c.userId, { config: db.getAdminConfig(), nowMs: c.now }), null);
  cfg('antibot_response_mode', 'enforce');
});

test('interrupteurs : détection OFF → rien ; même pixel OFF → seul l\'autoclicker corroboré ; suspension OFF → vérifications seules', () => {
  cfg('ab_fast_mode', 'off');
  let c = client({ profile: 'op125' }).run_(60);
  assert.strictEqual(challenges(c.userId).length, 0);
  cfg('ab_fast_mode', 'on');

  cfg('ab_same_pixel_mode', 'off');
  c = client({ profile: 'human8cv12', seed: 44 }).run_(10 * 60);
  assert.strictEqual(challenges(c.userId).length, 0);
  c = client({ profile: 'op125' }).run_(30);
  assert.deepStrictEqual(reasonsOf(challenges(c.userId)[0]), ['autoclick_corroborated']);
  assert.ok(challenges(c.userId)[0].created_ms - T0 <= 16_000, 'sans la règle du même pixel : vérification à la 1re fenêtre de 12 s');
  cfg('ab_same_pixel_mode', 'on');

  cfg('ab_fast_suspend', 'off');
  c = client({ profile: 'op125' }).run_(90);
  assert.ok(challenges(c.userId).length >= 2);
  assert.strictEqual(suspensions(c.userId).length, 0);
  cfg('ab_fast_suspend', 'on');
});

test('fiche admin : verdict lisible (preuves, réglages) et levée de suspension', () => {
  const c = client({ profile: 'op125' }).run_(60);
  const sec = responses.playerSection(c.userId, { config: db.getAdminConfig(), nowMs: c.now });
  assert.strictEqual(sec.fast.settings.ab_same_pixel_clicks, 25);
  assert.ok(sec.fast.detections >= 2 && sec.fast.lastAutomationAt);
  assert.ok(sec.state === 'suspended');
  const [su] = suspensions(c.userId);
  assert.ok(responses.liftSuspension(su.id, { note: 'test', nowMs: c.now }));
  assert.strictEqual(responses.playerSection(c.userId, { config: db.getAdminConfig(), nowMs: c.now }).state, 'challenge');
  const summary = responses.adminSummary({ config: db.getAdminConfig(), nowMs: c.now });
  assert.strictEqual(summary.fast.ab_fast_mode, 'on');
  assert.ok(summary.suspensions.some(s => s.reason === 'autoclick_repeat'));
});

// ── Décision du propriétaire du 10/11 : suspensions effectives pour tous (rejeu des journaux réels) ──

/**
 * Fenêtres réelles de l'extension OP Auto Clicker du propriétaire (production, 10/11, télémétrie
 * agrégée sans donnée personnelle) : sauvegarde anticipée au 25ᵉ coup, gigue 10–15 % (régularité
 * « machine » non établie sur 25 coups), 100 % de coups non fiables, souris immobile, même pixel.
 */
const REAL_EXT = [
  { secs: 3.2,  n: 25, u: 25, f: { k: 24, t3: 0.708, med: 130.8, mad: 13,  coarse: 0, sp: 25,  run: 25,  mc: 25, mm: 25, still: 24 } },
  { secs: 10,   n: 40, u: 40, f: { k: 39, t3: 0.744, med: 129.6, mad: 5.6, coarse: 0, sp: 39,  run: 25,  mc: 40, mm: 40, still: 38 } },
  { secs: 7,    n: 25, u: 25, f: { k: 24, t3: 0.875, med: 130.8, mad: 10.7, coarse: 0, sp: 25, run: 25,  mc: 25, mm: 25, still: 24 } },
  { secs: 7,    n: 37, u: 37, f: { k: 36, t3: 0.778, med: 129.5, mad: 8.3, coarse: 0, sp: 35,  run: 25,  mc: 37, mm: 37, still: 34 } },
];
/** Fenêtre humaine réelle juste après la suspension (même compte, souris qui bouge, coups fiables). */
const REAL_HUMAN = { n: 32, u: 0, f: { k: 31, t3: 0.419, med: 163.8, mad: 8.3, coarse: 0, sp: 20, run: 20, mc: 32, mm: 32, still: 24 } };
const telOf = w => ({ n: w.n, u: w.u, x: 0, h: null, p: { m: w.n, t: 0, k: 0, o: 0 }, f: { ...w.f } });

test('10/11 — fenêtres réelles de l\'extension : corroborées par les coups générés par script, même sans rythme de machine', () => {
  for (const w of REAL_EXT) {
    const v = evalTel(telOf(w));
    assert.ok(!v.regular, `régularité non établie (t3 ${w.f.t3})`);
    assert.ok(v.scripted && v.fixed && v.still && v.automation, JSON.stringify(v.evidence));
  }
  // Humain réel : rien (coups fiables, pas de série de 25)
  const h = evalTel(telOf(REAL_HUMAN));
  assert.ok(!h.scripted && !h.fixed && !h.automation);
});

test('10/11 — garde-fous du faisceau « script » : jamais sans même pixel, ni lent (accessibilité), ni sans 3ᵉ indice', () => {
  const base = REAL_EXT[1];
  // Coups non fiables mais position qui varie (pas de série) → rien
  assert.ok(!evalTel(telOf({ ...base, f: { ...base.f, sp: 3, run: 3 } })).automation);
  // Clic d'accessibilité lent (1 coup / 800 ms) non fiable, même pixel, immobile → pas « script rapide »
  assert.ok(!evalTel(telOf({ ...base, f: { ...base.f, med: 800, mad: 40 } })).automation);
  // Script mais souris qui bouge et cadence serveur irrégulière → pas de 3ᵉ indice
  assert.ok(!evalTel(telOf({ ...base, f: { ...base.f, still: 0 } })).automation);
  // Moins de 90 % de coups non fiables → faisceau b absent (le faisceau a exige la régularité)
  assert.ok(!evalTel(telOf({ ...base, u: 30 })).automation);
  // Moins de 20 coups → pas assez de preuves
  assert.ok(!evalTel(telOf({ ...REAL_EXT[0], n: 19, u: 19 })).automation);
});

test('client : la vérification ou la suspension remet à zéro toutes les mesures, y compris la plus longue série (sp)', () => {
  const main = fs.readFileSync(path.join(__dirname, '../public/js/main.js'), 'utf8');
  const body = main.slice(main.indexOf('function _fastReset()'), main.indexOf('function _fastStats()'));
  for (const re of [/_fast\.run = 0;/, /_fast\.sp = 0;/, /_fast\.iv\.length = 0;/, /_fast\.still = 0;/, /_fast\.mm = 0;/]) assert.match(body, re);
});

/** Rejoue les fenêtres réelles ; entre deux passages, le joueur résout l'énigme (bot supervisé). */
function replayExtension(userId, start, clicks0 = 0) {
  const st = { now: start, clicks: clicks0, blocks: Math.floor(clicks0 / 10) };
  st.save = (secs, tel) => {
    st.now += secs * 1000;
    if (tel) { st.clicks += tel.n; st.blocks += Math.floor(tel.n / 10); }
    return seasons.syncPlayerRanking(userId, { seasonId, maxDepth: 1 + st.blocks, manualBlocks: st.blocks, autoBlocks: 0,
      manualClicks: st.clicks, suspiciousScore: 0 }, { nowMs: st.now, telemetry: tel });
  };
  st.solve = () => {
    const ch = challenges(userId).filter(c => c.status === 'pending').pop();
    responses.markSeen(userId, ch.id, { manualClicks: st.clicks, nowMs: st.now });
    st.now += 8000;
    const p = responses.newPuzzle(userId, ch.id, { kind: 'text', nowMs: st.now - 3000 });
    return responses.answer(userId, ch.id, p.puzzleId, String(p.a + p.b), { manualClicks: st.clicks, manualBlocks: st.blocks, nowMs: st.now });
  };
  return st;
}

test('Appliqué pour tous — extension réelle : vérification à la 1ʳᵉ fenêtre, suspension 5 min ≤ 15 s après la reprise, puis 15 min', () => {
  cfg('antibot_response_mode', 'enforce');
  const userId = newUser();
  const st = replayExtension(userId, T0 + 3 * 3600_000);
  const t0 = st.now;
  let s = st.save(REAL_EXT[0].secs, telOf(REAL_EXT[0]));
  assert.ok(s?.challenge && !s.suspension, 'vérification dès la 1re fenêtre');
  assert.ok(st.now - t0 <= 4000);
  assert.deepStrictEqual(reasonsOf(challenges(userId)[0]), ['autoclick_corroborated']);
  assert.ok(JSON.parse(challenges(userId)[0].reasons).reasons[0].signals.includes('scripted'));
  assert.ok(st.solve().solved);
  const resumed = st.now;
  // Reprise de l'autoclicker : 1re fenêtre corroborée attend sa confirmation, la 2e suspend
  s = st.save(REAL_EXT[2].secs, telOf(REAL_EXT[2]));
  assert.ok(!s, 'pas de suspension sur une seule fenêtre');
  s = st.save(REAL_EXT[3].secs, telOf(REAL_EXT[3]));
  assert.ok(s?.suspension, 'suspension');
  assert.strictEqual(s.suspension.minutes, 5);
  assert.strictEqual(s.suspension.reason, 'autoclick_repeat');
  assert.ok(st.now - resumed <= 15_000, `suspension ${(st.now - resumed) / 1000} s après la reprise`);
  console.log(`[#91] extension réelle : suspension ${(st.now - resumed) / 1000} s après la reprise`);
  // Après la suspension (5 min) et l'énigme, récidive → 15 min
  st.now += 5 * MIN;
  assert.ok(st.solve().solved);
  st.save(REAL_EXT[2].secs, telOf(REAL_EXT[2]));
  s = st.save(REAL_EXT[3].secs, telOf(REAL_EXT[3]));
  assert.strictEqual(s?.suspension?.minutes, 15);
  // Remise à zéro sûre du palier par l'admin + levée : la prochaine récidive repart à 5 min
  assert.ok(responses.liftSuspension(s.suspension.id, { note: 'test', nowMs: st.now }));
  assert.strictEqual(responses.setViolationLevel(userId, 0, st.now), 0);
  assert.ok(st.solve().solved);
  st.save(REAL_EXT[2].secs, telOf(REAL_EXT[2]));
  s = st.save(REAL_EXT[3].secs, telOf(REAL_EXT[3]));
  assert.strictEqual(s?.suspension?.minutes, 5);
});

test('Appliqué — suspendu : requêtes forgées (autre appareil, sans télémétrie, F5) ne créditent ni blocs classés ni profondeur', () => {
  cfg('antibot_response_mode', 'enforce');
  const userId = newUser();
  const st = replayExtension(userId, T0 + 5 * 3600_000);
  st.save(REAL_EXT[0].secs, telOf(REAL_EXT[0]));
  st.solve();
  st.save(REAL_EXT[2].secs, telOf(REAL_EXT[2]));
  const s = st.save(REAL_EXT[3].secs, telOf(REAL_EXT[3]));
  assert.ok(s?.suspension);
  const row = () => db.getDb().prepare('SELECT max_depth, MIN(effective_manual_blocks, manual_blocks) AS v FROM season_rankings WHERE user_id = ?').get(userId);
  const before = row();
  // Autre appareil / requête forgée : +2000 clics, +200 blocs, profondeur +200, aucune télémétrie
  for (let i = 0; i < 6; i++) {
    st.now += 12_000;
    st.clicks += 400; st.blocks += 40;
    const r = seasons.syncPlayerRanking(userId, { seasonId, maxDepth: 1 + st.blocks, manualBlocks: st.blocks, autoBlocks: 0,
      manualClicks: st.clicks, suspiciousScore: 0 }, { nowMs: st.now, telemetry: null });
    assert.ok(r?.suspension, 'le serveur renvoie la suspension à chaque envoi (F5 / autre appareil)');
  }
  const after = row();
  assert.strictEqual(after.v, before.v, 'aucun bloc manuel classé de plus');
  assert.strictEqual(after.max_depth, before.max_depth, 'aucune profondeur de plus');
  const susp = suspensions(userId)[0];
  assert.ok(susp.held_clicks >= 2000, `clics retenus ${susp.held_clicks}`);
  // Fin de suspension + énigme : seuls les clics postérieurs comptent (rien de rétroactif)
  st.now = susp.ends_ms + 1000;
  assert.ok(st.solve().solved);
  assert.strictEqual(row().v, before.v);
});
