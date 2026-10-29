/**
 * Test de bout en bout de scripts/deploy.sh dans un bac à sable : dépôt Git local (« origin » nu),
 * copie servie lancée sur un port de test avec une base de test, redémarrage simulé.
 * Ne touche ni au service dig, ni au port 3000, ni à la base de production.
 * Lancer : npm test
 */

'use strict';

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPLOY = path.join(ROOT, 'scripts', 'deploy.sh');
const PORT = process.env.DIG_TEST_PORT || '3105';

function sh(cwd, cmd) {
  return execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-deploy-test-'));
  const app = path.join(dir, 'app');
  const dev = path.join(dir, 'dev');
  const bare = path.join(dir, 'origin.git');
  const git = 'git -c user.name=test -c user.email=test@example.invalid';
  sh(dir, `git clone --quiet --no-local "${ROOT}" app && cd app && git checkout --quiet -B main`);
  sh(dir, `git clone --quiet --bare app origin.git && git -C app remote set-url origin "${bare}" && git -C app fetch --quiet origin && git -C app branch --quiet -u origin/main`);
  sh(dir, `git clone --quiet "${bare}" dev`);
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(app, 'node_modules'));
  // « Redémarrage » : arrête l'instance de test (pid connu) et relance la copie servie.
  const restart = path.join(dir, 'restart.sh');
  fs.writeFileSync(restart, `#!/bin/bash
[ -f "${dir}/pid" ] && kill "$(cat "${dir}/pid")" 2>/dev/null && sleep 0.5
(cd "${app}" && PORT=${PORT} DB_FILE=deploy-test.sqlite exec node server/index.js) </dev/null >"${dir}/server.log" 2>&1 &
echo $! >"${dir}/pid"
`, { mode: 0o755 });
  sh(dir, restart);
  // Attendre le serveur de test (création de sa base comprise) avant tout déploiement.
  sh(dir, `for i in $(seq 1 60); do curl -fsS -m 2 http://127.0.0.1:${PORT}/health >/dev/null 2>&1 && exit 0; sleep 0.5; done; cat "${dir}/server.log"; exit 1`);
  const env = {
    ...process.env, APP_DIR: app, PORT, HEALTH_TIMEOUT: '15', RESTART_CMD: restart,
    DIG_BACKUP_DIR: path.join(dir, 'backups'), DIG_DEPLOY_LOCK: path.join(dir, 'deploy.lock'),
    DB_FILE: 'deploy-test.sqlite',
  };
  const commit = (file, content, msg) => {
    fs.writeFileSync(path.join(dev, file), content);
    sh(dev, `${git} commit --quiet -am "${msg}" && git push --quiet origin HEAD:main`);
    return sh(dev, 'git rev-parse HEAD');
  };
  const deploy = (args = []) => spawnSync('bash', [DEPLOY, ...args], { env, encoding: 'utf8' });
  const head = () => sh(app, 'git rev-parse HEAD');
  const version = () => sh(dir, `curl -fsS -m 5 http://127.0.0.1:${PORT}/api/version`);
  const cleanup = () => {
    try { process.kill(Number(fs.readFileSync(path.join(dir, 'pid'), 'utf8'))); } catch { /* déjà arrêté */ }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { dir, app, dev, env, commit, deploy, head, version, cleanup };
}

test('deploy.sh : déploiement OK, puis déploiement cassé → retour arrière automatique', { timeout: 120000 }, () => {
  const s = setup();
  try {
    // 1. Rien à déployer.
    let r = s.deploy();
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /rien à déployer/);

    // 2. --dry-run : contrôles seulement.
    const good = s.commit('README.md', fs.readFileSync(path.join(s.dev, 'README.md'), 'utf8') + '\nv2\n', 'docs: v2');
    const before = s.head();
    r = s.deploy(['--dry-run']);
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(s.head(), before, '--dry-run ne modifie rien');

    // 3. Déploiement réussi : sauvegarde pré-déploiement, avance rapide, santé et version vérifiées.
    r = s.deploy();
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.strictEqual(s.head(), good);
    assert.match(s.version(), new RegExp(`\\+${good.slice(0, 7)}`));
    const backups = fs.readdirSync(path.join(s.dir, 'backups')).filter((f) => f.endsWith('.sqlite'));
    assert.ok(backups.some((f) => f.includes(`pre-deploy-${good.slice(0, 7)}`)), backups.join(','));

    // 4. Version cassée : le serveur ne démarre plus → retour arrière vers le SHA précédent.
    const index = fs.readFileSync(path.join(s.dev, 'server', 'index.js'), 'utf8');
    s.commit('server/index.js', "throw new Error('démarrage impossible (test)');\n" + index, 'test: version cassée');
    r = s.deploy();
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /retour arrière OK/);
    assert.match(r.stdout, /restore-db\.js .* --live/);
    assert.strictEqual(s.head(), good, 'code revenu au SHA précédent');
    assert.match(s.version(), new RegExp(`\\+${good.slice(0, 7)}`));

    // 5. Arbre modifié : refus sans rien toucher.
    fs.appendFileSync(path.join(s.app, 'README.md'), 'modif locale\n');
    r = s.deploy();
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /modifications locales/);
    assert.strictEqual(s.head(), good);
  } finally {
    s.cleanup();
  }
});
