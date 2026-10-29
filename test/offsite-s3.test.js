/**
 * Tests de scripts/offsite-s3.sh (copie hors machine vers S3) avec un faux AWS CLI : aucun appel réseau.
 * Lancer : npm test
 */

'use strict';

const test     = require('node:test');
const assert   = require('node:assert');
const Database = require('better-sqlite3');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const { spawnSync } = require('child_process');
const { config, backup } = require('../scripts/backup-db');

const HOOK = path.join(__dirname, '..', 'scripts', 'offsite-s3.sh');
const FAKE_AWS = path.join(__dirname, 'fixtures', 'fake-aws.js');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dig-offsite-test-'));
  const s3 = path.join(dir, 's3');
  fs.mkdirSync(s3);
  const dbPath = path.join(dir, 'game.sqlite');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users(name) VALUES (\'a\'), (\'b\');');
  db.close();
  const env = { ...process.env, AWS_CLI: FAKE_AWS, FAKE_S3_DIR: s3, DIG_S3_BUCKET: 'dig-test', AWS_REGION: 'us-east-1' };
  return { dir, s3, dbPath, env, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function withEnv(env, fn) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  return fn().finally(() => { process.env = saved; });
}

test('sauvegarde réelle envoyée vers S3 (SSE-S3, sha256) et vérifiée via head-object', async () => {
  const s = sandbox();
  try {
    const cfg = { ...config({}), dbPath: s.dbPath, backupDir: path.join(s.dir, 'backups'), offsiteCmd: `bash ${HOOK}` };
    const m = await withEnv(s.env, () => backup(cfg, 'daily'));
    assert.strictEqual(m.offsite, 'ok');
    const name = path.basename(m.path);
    const stored = path.join(s.s3, 'dig-test', 'backups', name);
    assert.deepStrictEqual(fs.readFileSync(stored), fs.readFileSync(m.path));
    assert.ok(fs.existsSync(path.join(s.s3, 'dig-test', 'backups', name.replace(/\.sqlite$/, '.json'))));
    const calls = fs.readFileSync(path.join(s.s3, 'calls.log'), 'utf8');
    assert.match(calls, /put-object .*--server-side-encryption AES256 --checksum-algorithm SHA256/);
    assert.match(calls, /head-object/);
    assert.ok(fs.existsSync(m.path), 'la sauvegarde locale est conservée');
  } finally { s.cleanup(); }
});

test('objet altéré côté S3 : échec signalé, sauvegarde locale conservée, code de sortie 1', async () => {
  const s = sandbox();
  try {
    const cfg = { ...config({}), dbPath: s.dbPath, backupDir: path.join(s.dir, 'backups'), offsiteCmd: `bash ${HOOK}` };
    const m = await withEnv({ ...s.env, FAKE_S3_CORRUPT: '1' }, () => backup(cfg, 'daily'));
    assert.match(m.offsite, /^échec/);
    assert.ok(fs.existsSync(m.path));
  } finally { s.cleanup(); }
});

test('configuration incomplète refusée sans appel AWS', () => {
  const s = sandbox();
  try {
    const f = path.join(s.dir, 'x.sqlite');
    fs.writeFileSync(f, 'x');
    const noBucket = spawnSync('bash', [HOOK, f, f], { env: { ...s.env, DIG_S3_BUCKET: '' }, encoding: 'utf8' });
    assert.strictEqual(noBucket.status, 1);
    assert.match(noBucket.stderr, /DIG_S3_BUCKET/);
    const missing = spawnSync('bash', [HOOK, path.join(s.dir, 'absent'), f], { env: s.env, encoding: 'utf8' });
    assert.strictEqual(missing.status, 1);
    assert.ok(!fs.existsSync(path.join(s.s3, 'calls.log')));
  } finally { s.cleanup(); }
});
