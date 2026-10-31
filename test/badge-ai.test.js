/**
 * Badges (#38, demande du propriétaire du 31/10) — UX commune du panel et création assistée par IA
 * (transport factice : aucun appel réel, aucune dépense) :
 * - proposition en arrière-plan : textes FR/EN/NL/ES nettoyés, critère limité aux métriques suivies,
 *   demandes impossibles signalées, critère inconnu refusé (aucun suivi inventé) ;
 * - corrections sans coût ; enregistrement en badge DÉSACTIVÉ seulement (jamais activé), consigne
 *   d'illustration reprise par l'atelier ; identifiant déjà pris refusé ;
 * - atelier (#40) : badges comme cibles, image d'un badge actif seulement avec accord « live » ;
 * - routes protégées (401) et parcours HTTP ; onglet : données d'abord, « ＋ Ajouter » en fiche.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const crypto   = require('crypto');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawn } = require('child_process');

const ROOT  = path.join(__dirname, '..');
const PORT  = process.env.DIG_TEST_PORT_BADGE_AI || '3166';
const BASE  = `http://127.0.0.1:${PORT}`;
const ADMIN = crypto.randomBytes(16).toString('hex');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-badge-ai-test-'));
process.env.DB_FILE = path.join(dir, 'unit.sqlite');

const db      = require('../server/db');
const blocks  = require('../server/blockCatalog');
const blockAi = require('../server/blockAi');
const coll    = require('../server/collectionCatalog');
const badges  = require('../server/badges');
const studio  = require('../server/iconStudio');
const ai      = require('../server/badgeAi');

db.initDb();
blocks.init();
blockAi.init();
coll.init();
badges.init();
studio.init();
ai.init();
const conn = () => db.getDb();

const texts = (fr, en, nl, es) => ({ fr, en, nl, es });
let answer = null;
let lastMessages = null;
const reply = () => ({
  idSuggestion: 'Pierre éternelle!', category: 'minage', icon: '🪨<b>', visibility: 'visible',
  names: texts('Pierre <éternelle>', 'Eternal stone', 'Eeuwige steen', ''),
  descriptions: texts('Miner 500 blocs de pierre.', 'Mine 500 stone blocks.', 'Hak 500 stenen blokken.', ''),
  criterion: { condition: 'blocks_of_type', blockId: 'pierre', threshold: 500 },
  event: { startsAt: '', endsAt: '' },
  unsupported: ['Sept jours d\'affilée : seuls les jours distincts sont suivis.'],
  image: { subject: 'A round stone medal', details: 'Chiselled rim.', palette: 'Palette: grey, gold.' },
  rationale: 'Critère direct.',
});
blockAi.setFakeTransport({
  json: async ({ messages }) => { lastMessages = messages; return { data: answer ?? reply(), usage: { prompt_tokens: 900, completion_tokens: 300 } }; },
});

async function propose(concept) {
  const { proposal, job } = ai.startProposal({ concept });
  assert.strictEqual(proposal.status, 'pending');
  await job.catch(() => {});
  return ai.getProposal(proposal.id);
}

test('proposition : textes nettoyés, critère suivi, demandes impossibles signalées, consigne limitée aux métriques', async () => {
  const p = await propose('Un badge pour les fans de pierre, 7 jours d\'affilée');
  assert.strictEqual(p.status, 'open');
  const b = p.data.badge;
  assert.deepStrictEqual([b.id, b.icon, b.names.fr, b.condition, b.blockId, b.threshold], ['pierre_eternelle', '🏅', 'Pierre éternelle', 'blocks_of_type', 'pierre', 500]);
  assert.deepStrictEqual(p.errors, []);
  assert.ok(p.warnings.some(w => /Non pris en charge : Sept jours/.test(w)));
  assert.ok(p.warnings.some(w => /manquant en ES/.test(w)));
  const sys = lastMessages[0].content;
  for (const c of badges.CONDITIONS) assert.match(sys, new RegExp(`- ${c}:`));
  assert.match(sys, /NEVER invent tracking/);
  assert.match(sys, /pierre \(/, 'types de blocs publiés fournis');
  assert.strictEqual(badges.getBadgeRow('pierre_eternelle'), null, 'rien n\'est créé par la proposition');
});

test('critère impossible ou inventé : aucun suivi inventé, enregistrement refusé tant qu\'il n\'est pas corrigé', async () => {
  answer = { ...reply(), idSuggestion: 'riche', criterion: { condition: 'coins_earned', blockId: '', threshold: 1000 } };
  let p = await propose('Gagner 1000 pièces');
  answer = null;
  assert.strictEqual(p.data.badge.condition, null);
  assert.ok(p.errors.some(e => /Aucun critère pris en charge/.test(e)));
  assert.throws(() => ai.addToDraft(p.id), e => e.status === 400 && e.details.some(d => /Aucun critère/.test(d)));
  answer = { ...reply(), idSuggestion: 'bloc_fantome', criterion: { condition: 'blocks_of_type', blockId: 'licorne', threshold: 5 } };
  p = await propose('Miner des licornes');
  answer = null;
  assert.ok(p.errors.some(e => /Type de bloc/.test(e)), 'type de bloc inexistant signalé');
  p = ai.updateProposal(p.id, { badge: { blockId: 'pierre' } });
  assert.deepStrictEqual(p.errors, []);
});

test('corrections sans coût puis badge DÉSACTIVÉ seulement, consigne transmise à l\'atelier ; doublon refusé', async () => {
  const calls = conn().prepare('SELECT COUNT(*) n FROM block_ai_calls').get().n;
  let p = await propose('Fan de pierre');
  p = ai.updateProposal(p.id, { badge: { id: 'fan_pierre', status: 'active', names: { ...p.data.badge.names, es: 'Piedra eterna' }, threshold: 250 },
    image: { subject: 'A round granite medal' } });
  assert.strictEqual(conn().prepare('SELECT COUNT(*) n FROM block_ai_calls').get().n, calls + 1, 'corrections sans appel IA');
  const r = ai.addToDraft(p.id);
  assert.deepStrictEqual([r.badge.id, r.badge.status, r.badge.threshold, r.badge.names.es], ['fan_pierre', 'inactive', 250, 'Piedra eterna']);
  assert.strictEqual(ai.getProposal(p.id).status, 'in_draft');
  assert.throws(() => ai.addToDraft(p.id), e => e.status === 409);
  const t = studio.getTarget('badge:fan_pierre');
  assert.strictEqual(t.brief.subject, 'A round granite medal');
  assert.strictEqual(conn().prepare("SELECT COUNT(*) n FROM player_badges").get().n, 0);
  const q = await propose('Encore la pierre');
  ai.updateProposal(q.id, { badge: { id: 'fan_pierre' } });
  assert.ok(ai.getProposal(q.id).errors.some(e => /déjà utilisé/.test(e)));
  assert.throws(() => ai.addToDraft(q.id), e => e.status === 400);
  ai.discardProposal(q.id);
  assert.ok(!ai.listProposals().some(x => x.id === q.id));
});

test('échec IA et appel interrompu : état « error », aucun badge créé ; validations', async () => {
  assert.throws(() => ai.startProposal({ concept: 'a' }), /Décrivez/);
  const before = badges.listBadges().length;
  blockAi.setFakeTransport({ json: async () => { throw new Error('boom'); } });
  const p = await propose('Badge raté');
  blockAi.setFakeTransport({ json: async () => ({ data: answer ?? reply(), usage: {} }) });
  assert.strictEqual(p.status, 'error');
  assert.strictEqual(badges.listBadges().length, before);
  const id = conn().prepare("INSERT INTO badge_ai_proposals (concept) VALUES ('x')").run().lastInsertRowid;
  const q = ai.getProposal(id);
  assert.deepStrictEqual([q.status, /interrompue/.test(q.error)], ['error', true]);
});

test('atelier : badges listés (archivés exclus), image d\'un badge actif seulement avec accord « live »', async () => {
  const keys = studio.listTargets().filter(t => t.kind === 'badge').map(t => t.key);
  assert.ok(keys.includes('badge:profondeur_100') && keys.includes('badge:fan_pierre'));
  badges.setStatus('fidele_7', 'archived');
  assert.ok(!studio.listTargets().some(t => t.key === 'badge:fidele_7'));
  const sha = crypto.randomBytes(8).toString('hex');
  const url = studio.imageUrl(sha);
  conn().prepare("INSERT INTO icon_studio_assets (sha, target, source, mime, bytes, meta) VALUES (?, 'badge:profondeur_100', 'upload', 'image/webp', x'00', '{}')").run(sha);
  conn().prepare("INSERT INTO icon_studio_assets (sha, target, source, mime, bytes, meta) VALUES (?, 'badge:fan_pierre', 'upload', 'image/webp', x'00', '{}')").run(sha.replace(/^./, sha[0] === 'a' ? 'b' : 'a'));
  assert.throws(() => studio.apply('badge:profondeur_100', { sha }), e => e.status === 409 && /Badge actif/.test(e.message));
  assert.strictEqual(badges.getBadgeRow('profondeur_100').image, null);
  const r = studio.apply('badge:profondeur_100', { sha, live: true });
  assert.deepStrictEqual([r.catalog, r.draft, badges.getBadgeRow('profondeur_100').image, badges.getBadgeRow('profondeur_100').status], ['badges', false, url, 'active']);
  const sha2 = sha.replace(/^./, sha[0] === 'a' ? 'b' : 'a');
  const r2 = studio.apply('badge:fan_pierre', { sha: sha2 });
  assert.deepStrictEqual([r2.draft, badges.getBadgeRow('fan_pierre').image], [true, studio.imageUrl(sha2)]);
  assert.match(studio.buildPrompt('badge', { subject: 'A medal', details: '', palette: '' }), /A medal/);
});

test('routes : protégées, parcours complet, badge désactivé', async (t) => {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT, DIG_AI_FAKE: '1', NODE_ENV: 'test', SESSIONS_DIR: path.join(dir, 'sessions'), DB_FILE: path.join(dir, 'http.sqlite'),
      ADMIN_SECRET: ADMIN, SESSION_SECRET: crypto.randomBytes(16).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', d => { log += d; });
  server.stderr.on('data', d => { log += d; });
  t.after(() => server.kill());
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { await fetch(`${BASE}/api/version`); up = true; } catch (_) { await new Promise(r => setTimeout(r, 100)); }
  }
  assert.ok(up, `serveur de test non démarré :\n${log}`);
  const call = async (method, url, body, { auth = true } = {}) => {
    const res = await fetch(BASE + url, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ADMIN}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  for (const [m, u] of [['GET', '/api/admin/badges/ai'], ['POST', '/api/admin/badges/ai/proposals'], ['GET', '/api/admin/badges/ai/proposals/1'],
    ['PUT', '/api/admin/badges/ai/proposals/1'], ['POST', '/api/admin/badges/ai/proposals/1/draft'], ['DELETE', '/api/admin/badges/ai/proposals/1']]) {
    assert.strictEqual((await call(m, u, m === 'GET' ? undefined : {}, { auth: false })).status, 401, `${m} ${u}`);
  }
  const st = await call('GET', '/api/admin/badges/ai');
  assert.deepStrictEqual([st.status, st.body.status.configured, st.body.status.fake, st.body.proposals.length], [200, true, true, 0]);
  assert.deepStrictEqual(Object.keys(st.body.metrics).sort(), [...badges.CONDITIONS].sort());
  const started = await call('POST', '/api/admin/badges/ai/proposals', { concept: 'un badge du dimanche' });
  assert.strictEqual(started.status, 200, JSON.stringify(started.body));
  let ready = null;
  for (let i = 0; i < 50 && !ready; i++) {
    const g = await call('GET', `/api/admin/badges/ai/proposals/${started.body.proposal.id}`);
    if (g.body.proposal.status !== 'pending') ready = g.body.proposal; else await new Promise(r => setTimeout(r, 100));
  }
  assert.strictEqual(ready.status, 'open', JSON.stringify(ready));
  const d = await call('POST', `/api/admin/badges/ai/proposals/${ready.id}/draft`, {});
  assert.deepStrictEqual([d.status, d.body.badge.id, d.body.badge.status], [200, 'mineur_du_dimanche', 'inactive'], JSON.stringify(d.body));
  const list = await call('GET', '/api/admin/badges');
  assert.strictEqual(list.body.badges.find(b => b.id === 'mineur_du_dimanche').status, 'inactive');
  assert.strictEqual((await call('GET', '/api/admin/badges/ai/proposals/9999')).status, 404);
  const icons = await call('GET', '/api/admin/icons');
  assert.ok(icons.body.targets.some(x => x.key === 'badge:mineur_du_dimanche'));
});

// ── Onglet 🏅 Badges : données d'abord, « ＋ Ajouter un badge » en fiche ───────

const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const section = (() => { const a = HTML.indexOf('<section id="tab-badges"'); return HTML.slice(a, HTML.indexOf('</section>', a)); })();
const dialog = id => { const m = section.match(new RegExp(`<dialog id="${id}"[\\s\\S]*?</dialog>`)); assert.ok(m, id); return m[0]; };

test('onglet Badges : aucun champ de création hors fiche, un seul « ＋ Ajouter », lignes cliquables, journal replié', () => {
  const visible = section.replace(/<dialog[\s\S]*?<\/dialog>/g, '');
  for (const f of ['bg-id', 'bg-fr-name', 'bg-condition', 'bg-threshold', 'bg-ai-concept']) {
    assert.doesNotMatch(visible, new RegExp(`id="${f}"`), `${f} visible hors fiche`);
  }
  const btns = [...visible.matchAll(/<button class="btn btn-primary" id="([^"]+)"[^>]*>＋ Ajouter[^<]*<\/button>/g)].map(m => m[1]);
  assert.deepStrictEqual(btns, ['btn-bg-add']);
  assert.doesNotMatch(section, /Nouveau \(vider/);
  assert.match(JS, /admRowOpen\(tr, `badge:\$\{b\.id\}`/);
  assert.match(JS, /admRowOpen\(tr, `bg-prop:\$\{p\.id\}`/);
  assert.match(visible, /<details class="overview-card hidden" id="bg-ai-card">/);
  assert.match(visible, /<details class="overview-card">\s*<summary class="overview-card-title">Journal<\/summary>/);
  assert.match(visible, /id="bg-filter-text" type="search"/);
});

test('fiches Badges : fermeture sans effet, choix IA / manuel, nouveau badge toujours désactivé', () => {
  for (const id of ['bg-add-dialog', 'bg-ai-dialog', 'bg-dialog']) {
    const d = dialog(id);
    assert.match(d, new RegExp(`<dialog id="${id}" class="bk-dialog adm-dialog[^"]*" aria-labelledby="[^"]+">`));
    assert.ok((d.match(/data-close/g) || []).length >= 2, `${id} : ✕ et Annuler`);
    assert.match(JS, new RegExp(`admDialogSetup\\('${id}'\\)`));
  }
  assert.match(dialog('bg-add-dialog'), /id="btn-bg-add-ai"[\s\S]*Créer avec l'IA[\s\S]*id="btn-bg-add-manual"[\s\S]*Créer manuellement/);
  assert.doesNotMatch(dialog('bg-dialog'), /id="bg-status"/, 'plus de statut « actif » à la création');
  assert.match(JS, /api\('POST', '\/api\/admin\/badges', \{ \.\.\.body, status: 'inactive' \}\)/);
  assert.match(JS, /getElementById\('btn-bg-add-ai'\)\.disabled = !st\.configured/);
  assert.doesNotMatch(dialog('bg-ai-dialog'), /type="checkbox"/, 'pas d\'image dans la création IA');
});
