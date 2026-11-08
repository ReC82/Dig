/**
 * #87 (07/11) — Admin → Anti-bot simplifié : trois cartes courtes, parcours guidé « Tester la protection »
 * en haut, « Joueurs à surveiller », « Réglages » et « Diagnostic et historique » repliés, audit admin séparé
 * des anomalies joueurs, lignes limitées par défaut ; fiche joueur avec statut compréhensible et action
 * principale en haut, détails techniques dans « Diagnostic avancé ».
 * Aucun seuil, algorithme, mode global ni donnée joueur n'est modifié : le parcours n'utilise que les routes
 * d'essai par compte du lot C (#25). Parcours Chromium : test/e2e/admin-antibot-87.e2e.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/admin/admin.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/admin/index.html'), 'utf8');
const TAB = HTML.slice(HTML.indexOf('<section id="tab-security"'), HTML.indexOf('</section>', HTML.indexOf('id="sec-diag"')));
const fn = name => { const i = JS.search(new RegExp(`(async )?function ${name}\\(`)); assert.ok(i >= 0, name); return JS.slice(i, JS.indexOf('\n}\n', i) + 2); };

test('ordre de l\'onglet : cartes, parcours de test, joueurs à surveiller, puis réglages et diagnostic repliés', () => {
  const pos = id => TAB.indexOf(`id="${id}"`);
  const order = ['sec-top', 'sec-test-card', 'sec-watch-card', 'sec-settings', 'sec-diag'];
  order.forEach(id => assert.ok(pos(id) > 0, id));
  for (let i = 1; i < order.length; i++) assert.ok(pos(order[i - 1]) < pos(order[i]), `${order[i - 1]} avant ${order[i]}`);
  assert.match(TAB, /<details class="overview-card sec-fold" id="sec-settings">/, 'réglages repliés par défaut');
  assert.match(TAB, /<details class="overview-card sec-fold" id="sec-diag">/, 'diagnostic replié par défaut');
  // Tous les tableaux techniques sont dans le diagnostic replié (aucun journal avant les actions)
  const beforeDiag = TAB.slice(0, pos('sec-diag'));
  for (const id of ['sec-events-body', 'sec-audit-body', 'sec-checks-body', 'sec-accounts-body', 'sec-resp-ch-body', 'sec-resp-su-body', 'sec-status', 'sec-protocol'])
    assert.ok(pos(id) > pos('sec-diag') && !beforeDiag.includes(`id="${id}"`), `${id} dans « Diagnostic et historique »`);
  // Trois cartes et le bouton primaire
  assert.strictEqual((TAB.match(/class="sec-top-card[^"]*"/g) ?? []).length, 3);
  assert.match(TAB, /id="btn-sec-start-test">▶ Tester la protection<\/button>/);
});

test('parcours guidé (recette du 08/11) : 5 étapes claires, délai 1/2/3 min dans le flux, un bouton principal', () => {
  const steps = [...TAB.matchAll(/<h4 class="sec-step-title">([^<]+)<\/h4>/g)].map(m => m[1]);
  assert.deepStrictEqual(steps, ['Choisir le compte de test', 'Lancer l\'essai sur ce compte', 'Choisir le délai avant la vérification',
    'Tester dans le jeu', 'Terminer et remettre à l\'état normal']);
  const card = TAB.slice(TAB.indexOf('id="sec-test-card"'), TAB.indexOf('id="sec-watch-card"'));
  assert.doesNotMatch(card, /Variante|Minage continu sans pause|Clics déclarés|clics déclarés/, 'plus de variante éloignée ni de jargon au premier niveau');
  assert.deepStrictEqual([...card.matchAll(/name="sec-test-delay" value="(\d+)"/g)].map(m => m[1]), ['1', '2', '3']);
  // Un seul bouton principal par étape (classe sec-step-main), basculé en contour hors de l'étape courante
  for (let i = 1; i <= 5; i++) {
    const li = card.slice(card.indexOf(`id="sec-step-${i}"`), i < 5 ? card.indexOf(`id="sec-step-${i + 1}"`) : card.indexOf('id="sec-test-msg"'));
    assert.strictEqual((li.match(/sec-step-main/g) ?? []).length, 1, `étape ${i}`);
  }
  assert.match(fn('secTestRender'), /classList\.toggle\('btn-outline', i !== current\)/);
  // Instructions minimales en jeu, lien vers le jeu, résultat lisible au premier niveau
  assert.match(card, /Lancez l'autoclicker sur le bloc\./);
  assert.match(card, /Une vérification apparaîtra/);
  assert.match(card, /Stoppez l'autoclicker/);
  assert.match(card, /id="sec-test-open-game" href="\/" target="_blank" rel="noopener"/);
  assert.match(card, /id="sec-test-result"/);
  // États compréhensibles
  assert.match(JS, /ready: 'Prêt', running: 'Essai en cours', pending: 'Défi en attente', solved: 'Résolu', done: 'Terminé'/);
  assert.match(card, /id="sec-test-badge"[^>]*role="status" aria-live="polite"/);
  // Diagnostic avancé replié, après les étapes : ce que le serveur a vu, relevés complets
  assert.match(card, /<details class="sec-test-adv" id="sec-test-adv">/);
  assert.ok(card.indexOf('id="sec-test-adv"') > card.indexOf('id="sec-step-5"'));
  assert.match(fn('secTestAdvRender'), /secObservedEl\(L\)[\s\S]*secFreezeEl\(L\)/);
  assert.doesNotMatch(fn('secTestRender'), /secObservedEl|secFreezeEl/, 'pas de diagnostic technique au premier niveau');
});

test('résultat du test : blocs validés au moment exact du défi, pendant le défi, écart (preuve du gel #25)', () => {
  const r = fn('secTestResultEl');
  assert.match(r, /'Au moment du défi', secFmt\(f\.issued\.manualBlocks\)/);
  assert.match(r, /secBxlS\(f\.issued\.at\)/, 'heure serveur de l\'émission');
  assert.match(r, /'Pendant le défi'/);
  assert.match(r, /'Écart'/);
  assert.match(r, /Gel vérifié/);
  // Défi réel émis pendant cet essai ; tuiles seulement si le relevé horodaté de l'émission existe
  assert.match(fn('secTestChallenge'), /c\.freeze && Date\.parse\(c\.createdAt\)/);
  assert.match(r, /if \(!f\?\.issued\) return null;/);
  assert.match(fn('secTestChallenge'), /T\?\.startedAt/);
});

test('parcours : seules les routes d\'essai par compte ; jamais le mode global ; une seule confirmation', () => {
  const block = JS.slice(JS.indexOf('// ── Parcours guidé « Tester la protection » (#87)'), JS.indexOf('// ── Réponses anti-bot (#25 lot C)'));
  assert.ok(block.length > 1000);
  assert.doesNotMatch(block, /\/api\/admin\/config/, 'le parcours ne touche aucun réglage global');
  assert.doesNotMatch(block, /antibot_response_mode/);
  const posts = [...block.matchAll(/api\('POST', `([^`]+)`/g)].map(m => m[1].replace(/\$\{[^}]+\}/g, ':id'));
  assert.deepStrictEqual([...new Set(posts)].sort(), [
    '/api/admin/security/challenge/:id/cancel', '/api/admin/security/player/:id/challenge',
    '/api/admin/security/player/:id/test-mode', '/api/admin/security/player/:id/test-threshold',
    '/api/admin/security/player/:id/violation-level',
    '/api/admin/security/suspension/:id/lift'].sort());
  // Confirmation uniquement pour l'action pouvant mener à une suspension réelle (lancer l'essai)
  assert.strictEqual((block.match(/admConfirm\(/g) ?? []).length, 1);
  assert.match(block, /btn-sec-test-start'\)\.addEventListener\('click', \(\) => secTestRun\(async \(\) => \{[\s\S]{0,200}admConfirm/);
  // Pas de double clic : boutons verrouillés pendant l'appel
  assert.match(fn('secTestRun'), /if \(_secTest\.busy \|\| !_secTest\.userId\) return;/);
  // Remise en état : annule, lève, palier 0, arrête l'essai, puis contrôle que le mode global n'a pas changé
  const end = block.slice(block.indexOf("btn-sec-test-end'"));
  assert.match(end, /challenge\/\$\{L\.challenge\.id\}\/cancel/);
  assert.match(end, /suspension\/\$\{L\.suspension\.id\}\/lift/);
  assert.match(end, /\{ level: 0 \}/);
  assert.match(end, /\{ enforce: false \}/);
  assert.match(end, /resp\.data\.mode !== before/);
  // Reprise après F5 : compte en essai retrouvé côté serveur, aucun stockage navigateur
  assert.match(fn('secTestRefresh'), /testAccounts\?\.\[0\]/);
  assert.doesNotMatch(block, /sessionStorage|localStorage/);
});

test('journal : anomalies joueurs par défaut, audit admin séparé, lignes limitées', () => {
  assert.match(TAB, /<option value="group:player" selected>/);
  assert.match(JS, /const SEC_EVENTS_STEP = 25;/);
  assert.match(fn('loadSecurity'), /limit: String\(_secEventsLimit\)/);
  assert.match(fn('secLoadAudit'), /group: 'admin'/);
  assert.match(JS, /getElementById\('sec-audit-card'\)\.addEventListener\('toggle'/, 'audit chargé à l\'ouverture');
  assert.match(JS, /const SEC_ROWS_DEFAULT = 10;/);
  for (const body of ['checks', 'body', 'chBody', 'suBody']) assert.match(JS, new RegExp(`secLimitRows\\(${body}\\)`), body);
});

test('lien du plan du panel vers le parcours ; cible repliée ouverte', () => {
  assert.match(JS, /id: 'sec-test', +tab: 'security', target: 'sec-test-card'/);
  assert.match(fn('admNavRun'), /closest\('details'\)/);
});

function loadFns(names) {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(['const SEC_RESP_MODES = { off: \'Désactivé\', observe: \'Observation\', enforce: \'Appliqué\' };',
    ...names.map(fn)].join('\n') + `\nthis.out = { ${names.join(', ')} };`, ctx);
  return ctx.out;
}

test('statut compréhensible : peut miner / vérification en attente / suspendu jusqu\'à (heure de Bruxelles)', () => {
  const { secPlayerStatus } = loadFns(['secBxl', 'secPlayerStatus']);
  const base = { state: 'normal', mode: 'observe', globalMode: 'observe', testEnforce: false, challenge: null, suspension: null };
  assert.strictEqual(secPlayerStatus(base).label, 'Peut miner normalement');
  assert.match(secPlayerStatus(base).help, /aucune vérification ne lui est imposée/);
  assert.match(secPlayerStatus({ ...base, mode: 'enforce', testEnforce: true }).help, /Essai en cours sur ce compte/);
  const ch = secPlayerStatus({ ...base, mode: 'enforce', state: 'challenge', challenge: { id: 1, seenAt: null } });
  assert.strictEqual(ch.label, 'Vérification en attente');
  // Défi resté ouvert hors Appliqué : sans effet, le joueur mine normalement
  assert.strictEqual(secPlayerStatus({ ...base, state: 'challenge', challenge: { id: 1 } }).label, 'Peut miner normalement');
  const su = secPlayerStatus({ ...base, mode: 'enforce', state: 'suspended', suspension: { endsAt: '2026-11-07T14:30:00.000Z', level: 1 } });
  assert.match(su.label, /^Minage suspendu jusqu'à 07\/11.*15:30$/, su.label);   // 14:30 UTC = 15:30 à Bruxelles (hiver)
});

test('joueurs à surveiller : suspension, vérification, essai en cours, indices — triés par urgence', () => {
  const { secWatchList } = loadFns(['secBxl', 'secWatchList']);
  const resp = { ok: true, data: {
    suspensions: [{ userId: 3, username: 'c', status: 'active', endsAt: '2026-11-07T15:00:00Z', startsAt: '2026-11-07T14:00:00Z' }, { userId: 9, username: 'z', status: 'ended' }],
    challenges: [{ userId: 2, username: 'b', status: 'pending', createdAt: '2026-11-07T13:00:00Z', seenAt: null }, { userId: 8, username: 'y', status: 'solved' }],
    testAccounts: [{ userId: 2, username: 'b' }],
  } };
  const sum = { ok: true, data: { accounts: [{ userId: 4, username: 'd', level: 1, score: 35 }, { userId: 5, username: 'e', level: 0, score: 10 }] } };
  const list = secWatchList(sum, resp);
  assert.strictEqual(JSON.stringify(list.map(e => e.userId)), '[3,2,4]');
  assert.match(list[0].items[0], /Minage suspendu jusqu'à/);
  assert.strictEqual(list[1].items.length, 2, 'vérification + essai regroupés sur une ligne');
  assert.match(list[2].items[0], /rien n'est appliqué/);
});

test('fiche : statut et action principale en tête, détails techniques (PV, mesures, modes) dans le diagnostic', () => {
  const r = fn('secRenderPlayer');
  assert.match(r, /root\.append\(secFicheHead\(d\), tabs, ess, adv\)/);
  assert.match(fn('secFicheHead'), /🧪 Tester la protection sur ce compte/);
  assert.match(fn('secFicheHead'), /secTestSelect\(uid, \{ point: true \}\)/, 'préremplit le parcours avec le joueur affiché');
  assert.match(r, /section\('lotc'/, 'mesures et actions d\'essai déplacées dans le diagnostic avancé');
  assert.doesNotMatch(r, /cards\.after\(secLotCSection/);
  const ess = r.slice(r.indexOf('// ── Vue essentielle ──'), r.indexOf('const tools = '));
  assert.doesNotMatch(ess, /applied:false|anti-bot \$\{m\.antibotMode\}/, 'plus de jargon dans la vue essentielle');
  assert.match(ess, /sec-origin-whybox/, 'explication longue repliée');
});

test('recette #87-B : recherche partielle du compte (pseudo partiel, casse, #ID, inconnu, plusieurs, réseau)', async () => {
  const users = [{ id: 1, username: 'testeur' }, { id: 2, username: 'bobtest1' }, { id: 3, username: 'bobtest2' }];
  const calls = [];
  const ctx = { console, URLSearchParams, encodeURIComponent, down: false,
    api: async (m, p) => {
      calls.push(p);
      if (ctx.down) return { ok: false, status: 0, data: {} };
      if (p.startsWith('/api/admin/security/player?')) {
        const q = new URLSearchParams(p.split('?')[1]).get('q').replace(/^#/, '');
        const u = users.find(x => String(x.id) === q);
        return u ? { ok: true, data: { player: { userId: u.id, username: u.username } } } : { ok: false, data: { error: 'introuvable' } };
      }
      const q = decodeURIComponent(p.split('q=')[1]).toLowerCase();
      return { ok: true, data: { users: users.filter(u => u.username.includes(q)) } };
    } };
  vm.createContext(ctx);
  vm.runInContext(fn('secResolveTyped') + '\nthis.r = secResolveTyped;', ctx);
  const r = q => ctx.r(q).then(x => JSON.parse(JSON.stringify(x)));
  assert.deepStrictEqual((await r('teste')).user, { id: 1, username: 'testeur' }, 'partiel → seul résultat');
  assert.deepStrictEqual((await r('TESTE')).user?.id, 1, 'insensible à la casse');
  assert.deepStrictEqual((await r('bobtest1')).user?.id, 2, 'pseudo exact parmi plusieurs');
  assert.strictEqual((await r('bobtest')).many.length, 2, 'plusieurs → liste à choisir');
  assert.strictEqual((await r('#3')).user?.id, 3, '#ID');
  assert.strictEqual((await r('#99')).none, true, '#ID inconnu');
  assert.strictEqual((await r('inconnu')).none, true);
  assert.ok(calls.every(p => /^\/api\/admin\//.test(p)), 'routes admin authentifiées uniquement');
  ctx.down = true;
  assert.match((await r('teste')).error, /Recherche impossible/);
  assert.match(fn('secTestPickTyped'), /comptes? contiennent|secAccounts/, 'pluriel');
  const { secAccounts } = (() => { const c = {}; vm.createContext(c); vm.runInContext(JS.match(/const secAccounts = .*/)[0] + '\nthis.secAccounts = secAccounts;', c); return c; })();
  assert.deepStrictEqual([2, 10].map(secAccounts), ['2 comptes', 'Au moins 10 comptes'], 'pluriel, plafond des suggestions');
  // Les deux champs de l'onglet ont l'autocomplétion partagée (#37), sans e-mail
  for (const id of ['sec-test', 'sec-player']) {
    assert.match(TAB, new RegExp(`id="${id}-q"[^>]*\\n?[^>]*role="combobox"`), `${id}-q combobox`);
    assert.match(TAB, new RegExp(`id="${id}-suggest" class="player-ac-list hidden" role="listbox"`));
  }
  assert.match(fn('attachPlayerAutocomplete'), /note\('Recherche…'\)/, 'réseau lent : état visible');
  assert.match(fn('attachPlayerAutocomplete'), /clearTimeout\(blurTimer\)/, 'liste rouverte après clic sur le bouton (blur annulé)');
});

test('autocomplétion partagée : fermer la liste annule la recherche en attente (liste rouverte après un choix, 08/11)', () => {
  const ac = fn('attachPlayerAutocomplete');
  const close = ac.slice(ac.indexOf('const close = () => {'), ac.indexOf('};', ac.indexOf('const close = () => {')));
  assert.match(close, /clearTimeout\(timer\); seqNo\+\+;/);
  // La réponse d'une recherche périmée est ignorée (numéro de séquence)
  assert.match(ac, /if \(mine !== seqNo \|\| input\.value\.trim\(\) !== q\) return;/);
});
