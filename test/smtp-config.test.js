/**
 * SMTP du jeu (ticket #43) : contrôle de connexion, e-mail de test, journal sans secret et
 * script de configuration scripts/dig-smtp-config.sh dans un bac à sable (fichier d'environnement
 * temporaire, serveur de test sur un port ≠ 3000, faux serveur SMTP local sur 127.0.0.1:2525).
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const net    = require('net');
const path   = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT      = path.join(__dirname, '..');
const PORT      = process.env.DIG_TEST_PORT_SMTP || '3153';
const BASE      = `http://127.0.0.1:${PORT}`;
const SMTP_PORT = 2525;
const USER      = 'jeu@example.test';
const PASS      = 'Mot-de-passe-SMTP-tres-secret-43';

let dir;
let smtp;

/** Faux serveur SMTP minimal : AUTH PLAIN/LOGIN, refuse les destinataires « refuse@… ». */
function fakeSmtp(port) {
  const messages = [];
  const server = net.createServer((sock) => {
    let data = null, from = null, rcpt = [], authStep = null, authUser = null;
    const say = (l) => sock.write(`${l}\r\n`);
    say('220 faux-smtp ESMTP');
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data !== null) {
          if (line === '.') { messages.push({ from, rcpt, data: data.join('\n') }); data = null; say('250 2.0.0 OK accepté'); }
          else data.push(line);
          continue;
        }
        if (authStep === 'user') { authUser = Buffer.from(line, 'base64').toString(); authStep = 'pass'; say('334 UGFzc3dvcmQ6'); continue; }
        if (authStep === 'pass') {
          authStep = null;
          say(authUser === USER && Buffer.from(line, 'base64').toString() === PASS ? '235 2.7.0 OK' : '535 5.7.8 identifiants refusés');
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') { sock.write('250-faux-smtp\r\n250 AUTH PLAIN LOGIN\r\n'); }
        else if (cmd === 'HELO') say('250 faux-smtp');
        else if (cmd === 'AUTH') {
          const [, mech, arg] = line.split(' ');
          if (mech.toUpperCase() === 'LOGIN') { authStep = 'user'; say('334 VXNlcm5hbWU6'); continue; }
          const [, u, p] = Buffer.from(arg || '', 'base64').toString().split('\0');
          say(u === USER && p === PASS ? '235 2.7.0 OK' : '535 5.7.8 identifiants refusés');
        }
        else if (cmd === 'MAIL') { from = line; rcpt = []; say('250 OK'); }
        else if (cmd === 'RCPT') { if (/refuse@/i.test(line)) say('550 5.1.1 refusé'); else { rcpt.push(line); say('250 OK'); } }
        else if (cmd === 'DATA') { data = []; say('354 envoyer'); }
        else if (cmd === 'QUIT') { say('221 au revoir'); sock.end(); }
        else say('250 OK');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, messages })));
}

const smtpEnv = (over = {}) => ({
  SMTP_HOST: '127.0.0.1', SMTP_PORT: String(SMTP_PORT), SMTP_USER: USER, SMTP_PASS: PASS,
  MAIL_FROM: 'DIG! <no-reply@example.test>', PUBLIC_BASE_URL: 'https://dig.example.test', ...over,
});

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-smtp-'));
  smtp = await fakeSmtp(SMTP_PORT);
});
test.after(() => {
  smtp.server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Lance une commande sans bloquer la boucle d'événements (le faux SMTP tourne dans ce processus). */
function run(cmd, args, { input = '', ...opts }) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    c.stdout.on('data', d => { stdout += d; });
    c.stderr.on('data', d => { stderr += d; });
    const t = setTimeout(() => c.kill('SIGKILL'), opts.timeout || 30000);
    c.on('close', (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
    c.stdin.end(input);
  });
}

function mailCheck(args, input) {
  return run(process.execPath, ['scripts/mail-check.js', ...args], { cwd: ROOT, input, env: { PATH: process.env.PATH } });
}
const envText = (o) => Object.entries(o).map(([k, v]) => `${k}='${v}'`).join('\n') + '\n';

test('mailer : verify() accepte les bons identifiants, refus réduit à son code, résumé sans secret', async () => {
  const { createMailer, senderDomain } = require('../server/mailer');
  const ok = createMailer(smtpEnv());
  assert.strictEqual(ok.enabled, true);
  assert.deepStrictEqual(await ok.verify(), { ok: true });
  assert.ok(!ok.summary.includes(PASS) && !ok.summary.includes(USER), ok.summary);
  assert.match(ok.summary, /@example\.test/);

  const bad = await createMailer(smtpEnv({ SMTP_PASS: 'faux' })).verify();
  assert.deepStrictEqual(bad, { ok: false, error: 'EAUTH 535' });

  assert.strictEqual(createMailer(smtpEnv({ MAIL_FROM: 'DIG!' })).enabled, false, 'MAIL_FROM sans adresse refusé');
  assert.strictEqual(senderDomain('DIG! <no-reply@Lodygames.com>'), 'lodygames.com');
  assert.strictEqual(senderDomain('no-reply@lodygames.com'), 'lodygames.com');
});

test('mail-check : configuration lue sur l\'entrée standard, vérification et e-mail de test, sans secret affiché', async () => {
  const v = await mailCheck(['--config', '-', '--verify'], envText(smtpEnv()));
  assert.strictEqual(v.status, 0, v.stdout + v.stderr);
  assert.match(v.stdout, /✓ connexion SMTP acceptée/);

  const bad = await mailCheck(['--config', '-', '--verify'], envText(smtpEnv({ SMTP_PASS: 'faux' })));
  assert.strictEqual(bad.status, 1);
  assert.match(bad.stdout, /refusée : EAUTH 535/);

  const before = smtp.messages.length;
  const s = await mailCheck(['--config', '-', '--send', 'proprio@example.test'], envText(smtpEnv()));
  assert.strictEqual(s.status, 0, s.stdout + s.stderr);
  assert.match(s.stdout, /✓ e-mail de test accepté/);
  const msg = smtp.messages[before];
  assert.ok(msg && /proprio@example\.test/.test(msg.rcpt.join()));
  assert.match(msg.data, /Subject: DIG! =\?UTF-8\?|Subject: .*test/i);

  const refused = await mailCheck(['--config', '-', '--send', 'refuse@example.test'], envText(smtpEnv()));
  assert.strictEqual(refused.status, 1);

  for (const r of [v, bad, s, refused]) assert.ok(!(r.stdout + r.stderr).includes(PASS), 'mot de passe affiché');
  assert.strictEqual((await mailCheck(['--verify'], '')).status, 2, 'configuration absente');
  assert.strictEqual((await mailCheck(['--nimporte'], '')).status, 2, 'usage');
});

// ── Script de configuration dans un bac à sable ──────────────────────────────

/** Lanceur du serveur de test qui lit le fichier d'environnement comme systemd (valeurs littérales). */
function writeLauncher(sb) {
  const launcher = path.join(sb, 'restart.js');
  fs.writeFileSync(launcher, `
    const fs = require('fs'), { spawn } = require('child_process');
    const pidFile = ${JSON.stringify(path.join(sb, 'pid'))};
    let old = 0; try { old = +fs.readFileSync(pidFile, 'utf8'); process.kill(old, 'SIGTERM'); } catch (_) { old = 0; }
    const t0 = Date.now();
    while (old && Date.now() - t0 < 10000) { try { process.kill(old, 0); } catch (_) { break; } }
    const env = { PATH: process.env.PATH, PORT: ${JSON.stringify(PORT)},
      DB_FILE: ${JSON.stringify(path.join(sb, 'jeu.sqlite'))}, SESSIONS_DIR: ${JSON.stringify(path.join(sb, 'sessions'))} };
    for (const l of fs.readFileSync(${JSON.stringify(path.join(sb, 'dig.env'))}, 'utf8').split('\\n')) {
      const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(l); if (!m) continue;
      let v = m[2]; if (/^'.*'$/.test(v)) v = v.slice(1, -1); env[m[1]] = v;
    }
    const log = fs.openSync(${JSON.stringify(path.join(sb, 'service.log'))}, 'w');
    const c = spawn(process.execPath, ['server/index.js'], { cwd: ${JSON.stringify(ROOT)}, env, detached: true, stdio: ['ignore', log, log] });
    fs.writeFileSync(pidFile, String(c.pid)); c.unref();
  `);
  return launcher;
}

function runConfig(sb, args, input) {
  return run('bash', [path.join(ROOT, 'scripts', 'dig-smtp-config.sh'), ...args], {
    cwd: sb, input, timeout: 110000,
    env: {
      PATH: process.env.PATH, HOME: sb,
      DIG_SMTP_SANDBOX: '1', DIG_ENV_FILE: path.join(sb, 'dig.env'), DIG_APP_DIR: ROOT, DIG_URL: BASE,
      DIG_SANDBOX_RESTART: `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(sb, 'restart.js'))}`,
      DIG_SANDBOX_LOG: path.join(sb, 'service.log'),
    },
  });
}

const answers = (o) => [o.host ?? '127.0.0.1', o.port ?? String(SMTP_PORT), o.user ?? USER, o.pass ?? PASS,
  'no-reply@example.test', '', '', 'https://dig.example.test', o.to ?? ''].join('\n') + '\n';

test('dig-smtp-config.sh : refus sans modification, configuration + e-mail de test, retour arrière, désactivation', { timeout: 300000 }, async () => {
  if (process.getuid && process.getuid() === 0) return;   // le bac à sable est inactif sous root
  const sb = fs.mkdtempSync(path.join(dir, 'sb-'));
  const envFile = path.join(sb, 'dig.env');
  const original = "SESSION_SECRET='secret-de-test-43-suffisamment-long-pour-le-serveur'\nSOCIAL_LOGIN=off\n";
  fs.writeFileSync(envFile, original, { mode: 0o600 });
  writeLauncher(sb);
  spawnSync(process.execPath, [path.join(sb, 'restart.js')]);
  const stopServer = () => { try { process.kill(+fs.readFileSync(path.join(sb, 'pid'), 'utf8'), 'SIGTERM'); } catch (_) {} };
  try {
    // 1. Mauvais mot de passe : rien n'est modifié, aucun redémarrage.
    let r = await runConfig(sb, [], answers({ pass: 'faux' }));
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /Rien n'a été modifié/);
    assert.strictEqual(fs.readFileSync(envFile, 'utf8'), original);
    assert.deepStrictEqual(fs.readdirSync(sb).filter(f => f.startsWith('dig.env.')), []);

    // 2. Destinataire de test refusé : la configuration est installée puis retirée (retour arrière).
    r = await runConfig(sb, [], answers({ to: 'refuse@example.test' }));
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /ÉCHEC : l'e-mail de test a été refusé/);
    assert.match(r.stdout, /Ancienne configuration rétablie/);
    assert.strictEqual(fs.readFileSync(envFile, 'utf8'), original);

    // 3. Configuration valide : clés écrites, autres lignes conservées, e-mail de test reçu.
    const before = smtp.messages.length;
    r = await runConfig(sb, [], answers({ to: 'proprio@example.test' }));
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /✓ Connexion SMTP du jeu vérifiée/);
    assert.match(r.stdout, /✓ e-mail de test accepté/);
    const written = fs.readFileSync(envFile, 'utf8');
    assert.ok(written.startsWith(original), 'configuration existante conservée');
    assert.match(written, new RegExp(`^SMTP_PASS='${PASS}'$`, 'm'));
    assert.match(written, /^MAIL_FROM='DIG! <no-reply@example\.test>'$/m);
    assert.strictEqual(fs.statSync(envFile).mode & 0o777, 0o600);
    assert.ok(smtp.messages.slice(before).some(m => /proprio@example\.test/.test(m.rcpt.join())));
    const me = await (await fetch(`${BASE}/api/me`)).json();
    assert.strictEqual(me.mail, true);
    const log = fs.readFileSync(path.join(sb, 'service.log'), 'utf8');
    assert.match(log, /\[mail\] e-mails de compte actifs : SMTP 127\.0\.0\.1:2525 .*limites 5 envois\/IP\/15 min, 20 liens refusés/);
    assert.match(log, /\[mail\] connexion SMTP vérifiée/);
    for (const out of [r.stdout, r.stderr, log]) assert.ok(!out.includes(PASS), 'mot de passe affiché ou journalisé');

    // 4. --off : clés SMTP retirées, le reste conservé, e-mails annoncés inactifs.
    r = await runConfig(sb, ['--off'], '');
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const off = fs.readFileSync(envFile, 'utf8');
    assert.ok(off.startsWith(original));
    assert.doesNotMatch(off, /SMTP_|MAIL_FROM/);
    assert.match(off, /^PUBLIC_BASE_URL=/m);
    assert.strictEqual((await (await fetch(`${BASE}/api/me`)).json()).mail, false);
  } finally {
    stopServer();
  }
});
