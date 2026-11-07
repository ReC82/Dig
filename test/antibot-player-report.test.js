/**
 * Fiche joueur anti-bot — demande du propriétaire #25 du 04/11/2026 (premier test de résistance).
 * Vérifie sur une base isolée (données synthétiques, aucune donnée de production) :
 *  - chaque sauvegarde contrôlée laisse un échantillon agrégé (compteurs, profondeur, télémétrie) ;
 *  - un rythme d'autoclicker produit exactement le score 40 / N1 observé (rafales 15 + CPS 25),
 *    journalisé avec applied:false, sans rien retirer à la partie ;
 *  - la fiche distingue serveur / déclaré / télémétrie, calcule coups/s à l'horloge serveur et
 *    les blocs ni manuels ni Auto-Dig ; le tableau des réponses dit ce qui est réellement appliqué ;
 *  - échantillons bornés par joueur, rien d'enregistré en mode off ; recherche par pseudo / ID.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const ROOT = path.join(__dirname, '..');
const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-antibot-fiche-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');
delete process.env.ANTIBOT;

const db      = require('../server/db');
const seasons = require('../server/seasons');
const antibot = require('../server/antibot');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let season;
let userSeq = 0;
const realNow = Date.now;

function newUser(name) {
  return db.getDb().prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(name ?? `fiche_user_${++userSeq}`, 'x').lastInsertRowid;
}
function setConfig(key, value) {
  db.getDb().prepare(`INSERT INTO admin_config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

/** Rejoue des sauvegardes à intervalle fixe (horloge simulée). */
function play(userId, { saves, everySecs, clicksPerSave, manualPerSave, autoPerSave = 0, tele }) {
  const t0 = realNow();
  const st = { seasonId: season.id, maxDepth: 1, manualBlocks: 0, autoBlocks: 0, manualClicks: 0, suspiciousScore: 0 };
  let destroyed = 0;
  try {
    for (let i = 1; i <= saves; i++) {
      Date.now = () => t0 + i * everySecs * 1000;
      st.manualClicks += clicksPerSave;
      st.manualBlocks += manualPerSave;
      st.autoBlocks   += autoPerSave;
      destroyed       += manualPerSave + autoPerSave + 2;   // 2 blocs « suspects » : ni manuels ni auto
      st.maxDepth      = 1 + destroyed;
      seasons.syncPlayerRanking(userId, { ...st }, {
        telemetry: tele ? tele(clicksPerSave) : null,
        save: { stats: { blocksDestroyed: destroyed }, upgrades: { autodig: 3 } },
      });
    }
  } finally { Date.now = realNow; }
  return st;
}

test.before(() => {
  db.initDb();
  season = db.getActiveSeason();
  assert.ok(season, 'saison active du seed');
  setConfig('antibot_mode', 'shadow');
});

test.after(() => {
  db.getDb().close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('joueur normal : échantillons enregistrés, aucune alerte, score 0', () => {
  const u = newUser();
  play(u, { saves: 4, everySecs: 15, clicksPerSave: 60, manualPerSave: 3,
    tele: n => ({ n, h: [0, 0, 0, 5, 20, 30, n - 56, 1], u: 0, p: { m: n, t: 0, k: 0, o: 0 }, cv: 0.3 }) });
  const r = antibot.playerReport(u, { config: db.getAdminConfig() });
  assert.strictEqual(r.samples.rows.length, 4);
  assert.strictEqual(r.events.byType.length, 0);
  assert.strictEqual(r.risk.score, 0);
  const last = r.samples.rows.at(-1);
  assert.strictEqual(last.dtSecs, 15);
  assert.strictEqual(last.dClicks, 60);
  assert.strictEqual(last.serverCps, 4);
  assert.strictEqual(r.samples.telemetry.clicks, 240);
  assert.strictEqual(r.samples.telemetry.p.m, 240);
});

test('autoclicker (≈ 30 coups/s, intervalles < 40 ms) : score exactement 40 → N1, applied:false, partie intacte', () => {
  const u = newUser();
  play(u, { saves: 8, everySecs: 12, clicksPerSave: 360, manualPerSave: 4, autoPerSave: 1,
    tele: n => ({ n, h: [n - 2, 1, 1, 0, 0, 0, 0, 0], u: 0, p: { m: n, t: 0, k: 0, o: 0 } }) });
  const r = antibot.playerReport(u, { config: db.getAdminConfig() });
  const types = Object.fromEntries(r.events.byType.map(e => [e.type, e.n]));
  assert.ok(types.burst_clicks >= 4, 'rafales journalisées');
  assert.ok(types.cps_flagged >= 5, 'CPS très élevé journalisé');
  // burst plafonné à 15 + cps plafonné à 25 = 40 (décroissance négligeable sur 96 s)
  assert.ok(r.risk.score >= 39.9 && r.risk.score <= 40, `score ${r.risk.score}`);
  assert.strictEqual(r.risk.level, 1);
  const lvl = r.events.recent.find(e => e.type === 'risk_level');
  assert.deepStrictEqual(JSON.parse(lvl.details), { from: 0, to: 1, applied: false });
  // Détails désormais présents sur cps_flagged (avant : aucun)
  const flagged = JSON.parse(r.events.recent.find(e => e.type === 'cps_flagged').details);
  assert.strictEqual(flagged.clicks, 360);
  assert.ok(flagged.cps >= 25 && flagged.cps <= 31, `cps ${flagged.cps}`);   // horodatage anti-autoclic à la seconde
  assert.strictEqual(flagged.maxCps, 8);
  // Coups/s à l'horloge serveur et blocs ni manuels ni auto
  assert.strictEqual(r.samples.rows.at(-1).serverCps, 30);
  assert.strictEqual(r.samples.rows.at(-1).dBlocksDestroyed, 7);
  assert.ok(r.ranking.validatedManualBlocks < r.ranking.manualBlocks, 'anti-autoclic : blocs classés réduits');
  // Aucune sanction : le tableau dit ce qui est réellement appliqué
  const score = r.responses.find(x => x.control.startsWith('Score de risque'));
  assert.match(score.applied, /Aucune/);
  const eco = r.responses.find(x => x.control.startsWith('Économie'));
  assert.match(eco.applied, /Aucune/);
  assert.strictEqual(r.modes.sanctionsApplied, false);
  // Télémétrie cumulée : 8 lots de 360 coups, 358 intervalles < 40 ms chacun
  assert.strictEqual(r.samples.telemetry.h[0], 8 * 358);
});

test('fiche : blocs ni manuels ni Auto-Dig déduits de la sauvegarde déclarée', () => {
  const u = newUser();
  play(u, { saves: 1, everySecs: 10, clicksPerSave: 20, manualPerSave: 2 });
  db.getDb().prepare('INSERT INTO user_saves (user_id, data, version) VALUES (?, ?, 3)').run(u, JSON.stringify({
    depth: 120, coins: 5000, gems: 2, pickaxeLevel: 4, damage: 5, upgrades: { autodig: 6, luck: 2 }, relics: { eye_of_miner: { level: 1 } },
    stats: { blocksDestroyed: 119, totalUpgradesBought: 12 },
    seasonStats: { seasonId: season.id, maxDepth: 120, manualBlocks: 15, autoBlocks: 4, manualClicks: 5000, suspiciousScore: 4800 },
  }));
  const r = antibot.playerReport(u, { config: db.getAdminConfig() });
  assert.strictEqual(r.uncountedBlocks, 100);
  assert.strictEqual(r.save.upgrades.autodig, 6);
  assert.strictEqual(r.save.relics.eye_of_miner, 1);
  assert.strictEqual(r.save.seasonStats.manualClicks, 5000);
  assert.ok(!('email' in r.player) && !('password_hash' in r.player), 'aucune donnée personnelle');
});

test('fiche (#76) : origine des blocs détruits — saison (manuels / Auto-Dig / suspects) et hors saison', () => {
  const u = newUser();
  play(u, { saves: 1, everySecs: 10, clicksPerSave: 20, manualPerSave: 2 });
  // Cas de la recette du 05/11 : 510 au total, 131 manuels, 37 Auto-Dig, 169 m cette saison
  db.getDb().prepare('INSERT INTO user_saves (user_id, data, version) VALUES (?, ?, 2)').run(u, JSON.stringify({
    depth: 169, stats: { blocksDestroyed: 510 },
    seasonStats: { seasonId: season.id, maxDepth: 169, manualBlocks: 131, autoBlocks: 37, manualClicks: 3775, suspiciousScore: 0, suspiciousBlocks: 0 },
  }));
  const r = antibot.playerReport(u, { config: db.getAdminConfig() });
  assert.strictEqual(r.uncountedBlocks, 342, 'valeur historique inchangée');
  assert.deepStrictEqual(r.blockOrigin, { total: 510, manual: 131, auto: 37, suspicious: 0, season: 168, outsideSeason: 342, seasonDepthBlocks: 168 });
  assert.strictEqual(r.save.seasonStats.suspiciousBlocks, 0);
  assert.ok(['off', 'shadow', 'enforce'].includes(r.modes.exactHpMode));

  // Sauvegarde antérieure à #74 : compteur de suspects absent → null, pas 0
  const v = newUser();
  play(v, { saves: 1, everySecs: 10, clicksPerSave: 20, manualPerSave: 2 });
  db.getDb().prepare('INSERT INTO user_saves (user_id, data, version) VALUES (?, ?, 2)').run(v, JSON.stringify({
    stats: { blocksDestroyed: 50 }, seasonStats: { seasonId: season.id, maxDepth: 41, manualBlocks: 10, autoBlocks: 5 },
  }));
  const o = antibot.playerReport(v, { config: db.getAdminConfig() }).blockOrigin;
  assert.strictEqual(o.suspicious, null);
  assert.strictEqual(o.season, 15);
  assert.strictEqual(o.outsideSeason, 35);
  assert.strictEqual(o.seasonDepthBlocks, 40);
});

test('échantillons bornés par joueur ; rien en mode off', () => {
  const u = newUser();
  for (let i = 0; i < antibot.SAMPLES_PER_USER + 10; i++) {
    antibot.recordSaveSample(u, season.id, { reportedDepth: i, acceptedDepth: i, seasonStats: {} });
  }
  const n = () => db.getDb().prepare('SELECT COUNT(*) AS n FROM antibot_save_samples WHERE user_id = ?').get(u).n;
  assert.strictEqual(n(), antibot.SAMPLES_PER_USER);
  const v = newUser();
  setConfig('antibot_mode', 'off');
  try { play(v, { saves: 2, everySecs: 10, clicksPerSave: 10, manualPerSave: 1 }); }
  finally { setConfig('antibot_mode', 'shadow'); }
  assert.strictEqual(db.getDb().prepare('SELECT COUNT(*) AS n FROM antibot_save_samples WHERE user_id = ?').get(v).n, 0);
});

test('recherche : identifiant, #identifiant, pseudo insensible à la casse ; inconnu → null', () => {
  const u = newUser('fiche_testeur');
  assert.strictEqual(antibot.findPlayer(String(u)).id, u);
  assert.strictEqual(antibot.findPlayer(`#${u}`).id, u);
  assert.strictEqual(antibot.findPlayer('Fiche_Testeur').id, u);
  assert.strictEqual(antibot.findPlayer('inconnu_xyz'), null);
  assert.strictEqual(antibot.findPlayer(''), null);
  assert.strictEqual(antibot.playerReport(999999), null);
});

test('admin : route protégée, fiche en lecture seule ouverte depuis la recherche et les tableaux', () => {
  const index = read('server/index.js');
  assert.match(index, /app\.get\('\/api\/admin\/security\/player', requireAdmin,/);
  const html = read('public/admin/index.html');
  assert.match(html, /<dialog id="sec-player-dialog"/);
  assert.match(html, /<form id="sec-player-form"/);
  const js = read('public/admin/admin.js');
  assert.match(js, /admDialogSetup\('sec-player-dialog', \{ dirty: \(\) => false \}\)/);
  assert.ok((js.match(/secPlayerCell\(tr,/g) ?? []).length >= 3, 'bouton Fiche dans les trois tableaux');
  assert.match(js, /pas des coups de pioche/);
  assert.doesNotMatch(js.slice(js.indexOf('function secRenderPlayer')), /innerHTML = [^'']/, 'rendu par textContent');
});

test('admin : fiche lisible — résumé par défaut, sections techniques repliables (recette UX du 05/11)', () => {
  const js = read('public/admin/admin.js');
  const fn = js.slice(js.indexOf('function secRenderPlayer'), js.indexOf("admDialogSetup('sec-player-dialog'"));
  assert.match(fn, /ess\.appendChild\(cards\)/, 'résumé toujours visible (vue essentielle, #76)');
  const keys = [...fn.matchAll(/section\('([a-z]+)'/g)].map(x => x[1]);
  assert.deepStrictEqual(keys, ['modes', 'account', 'progress', 'save', 'risk', 'responses', 'lotc', 'alerts', 'telemetry', 'samples', 'anticheat', 'timeline'],
    'toutes les sections conservées, chacune repliable');
  assert.match(fn, /det\.open = _secOpenSections\.has\(key\)/, 'repliées par défaut, état conservé au rafraîchissement');
  assert.match(fn, /Tout déplier/);
  assert.doesNotMatch(fn, /root\.appendChild\(sec(Kv|Table)/, 'aucun tableau technique hors section repliable');
});

test('admin (#76) : fiche anti-bot en deux onglets — vue essentielle et diagnostic avancé', () => {
  const js = read('public/admin/admin.js');
  const fn = js.slice(js.indexOf('function secRenderPlayer'), js.indexOf("admDialogSetup('sec-player-dialog'"));
  assert.match(fn, /\['essential', 'Vue essentielle'\], \['advanced', 'Diagnostic avancé/);
  assert.match(js, /let _secTab = 'essential';/, 'vue essentielle par défaut, onglet conservé au rafraîchissement');
  assert.match(fn, /setAttribute\('role', 'tablist'\)/);
  for (const t of ['Progression de la saison', 'PV réels des blocs (#77)', 'Classement (👆 blocs manuels)', 'Risque, alertes, sanctions'])
    assert.ok(fn.includes(`card('${t}'`), t);
  assert.match(fn, /d\.depth\?\.exactDepth/);
  assert.match(fn, /d\.depth\.exactGap/);
  assert.match(fn, /Blocs détruits : d’où viennent-ils/);
  assert.match(fn, /jamais remis à zéro/);
  assert.match(fn, /adv\.appendChild\(det\)/, 'sections techniques dans le diagnostic avancé');
  assert.doesNotMatch(fn, /\(clic jugé suspect\)'/, 'libellé trompeur retiré');
});
