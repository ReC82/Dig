#!/usr/bin/env node
/**
 * scripts/restore-db.js
 * Restaure une sauvegarde produite par scripts/backup-db.js.
 *
 * Utilisation :
 *   node scripts/restore-db.js <sauvegarde.sqlite> --target <base.sqlite>
 *       Restauration sur une COPIE (cas normal pour vérifier une sauvegarde).
 *   node scripts/restore-db.js <sauvegarde.sqlite> --live
 *       Restauration sur la base du jeu (DIG_DB_PATH ou server/data/$DB_FILE).
 *       Refusée tant que le service (DIG_SERVICE, défaut « dig ») est actif :
 *       l'arrêter d'abord (sudo systemctl stop dig), puis le redémarrer après.
 *
 * Garde-fous :
 *   - la sauvegarde est vérifiée (sha256 du manifeste si présent, integrity_check) avant tout ;
 *   - la base cible existante est d'abord sauvegardée (label « pre-restore ») ;
 *   - l'écriture se fait dans un fichier temporaire vérifié, puis remplacement atomique
 *     (les fichiers -wal / -shm de l'ancienne base sont retirés).
 */

'use strict';

const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');
const { spawnSync } = require('child_process');
const { config, backup, verifyDb } = require('./backup-db');
const crypto = require('crypto');

function serviceActive(name) {
  const r = spawnSync('systemctl', ['is-active', '--quiet', name]);
  return r.status === 0;
}

async function restore(source, target, { live = false, env = process.env } = {}) {
  if (!source || !fs.existsSync(source)) throw new Error(`sauvegarde introuvable : ${source}`);
  const cfg = config(env);
  const liveTarget = path.resolve(cfg.dbPath);
  if (path.resolve(target) === liveTarget && !live) {
    throw new Error('la cible est la base du jeu : utiliser --live (service arrêté) ou une autre --target');
  }
  if (live && serviceActive(env.DIG_SERVICE || 'dig')) {
    throw new Error(`le service ${env.DIG_SERVICE || 'dig'} est actif : l'arrêter avant une restauration --live`);
  }

  const manifestPath = source.replace(/\.sqlite$/, '.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const sum = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    if (manifest.sha256 && manifest.sha256 !== sum) throw new Error('sha256 différent du manifeste : sauvegarde altérée');
  }
  const check = verifyDb(source);

  let safety = null;
  if (fs.existsSync(target)) {
    safety = await backup({ ...cfg, dbPath: target }, 'pre-restore');
  }

  const tmp = `${target}.restore-tmp`;
  fs.rmSync(tmp, { force: true });
  const src = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await src.backup(tmp);
  } finally {
    src.close();
  }
  verifyDb(tmp);
  for (const extra of [`${target}-wal`, `${target}-shm`]) fs.rmSync(extra, { force: true });
  fs.renameSync(tmp, target);
  return { target, counts: check.counts, safety: safety && safety.path };
}

module.exports = { restore };

if (require.main === module) {
  const args = process.argv.slice(2);
  const source = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--target');
  const ti = args.indexOf('--target');
  const live = args.includes('--live');
  const target = live ? config().dbPath : (ti >= 0 ? args[ti + 1] : '');
  if (!source || !target) {
    console.error('Usage : restore-db.js <sauvegarde.sqlite> (--target <base.sqlite> | --live)');
    process.exit(2);
  }
  restore(source, target, { live })
    .then((r) => {
      const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
      console.log(`[restore] OK ${r.target} — ${Object.keys(r.counts).length} tables / ${total} lignes` +
        (r.safety ? ` — ancienne base sauvegardée : ${r.safety}` : ''));
    })
    .catch((err) => {
      console.error(`[restore] ÉCHEC : ${err.message}`);
      process.exitCode = 1;
    });
}
