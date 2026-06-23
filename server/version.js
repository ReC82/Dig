/**
 * server/version.js
 * Génère APP_VERSION une seule fois au démarrage du serveur.
 *
 * Ordre de résolution :
 *   1. Variable d'env COMMIT_HASH (CI/CD, AWS CodeDeploy, etc.)
 *   2. Variable d'env SOURCE_VERSION (Elastic Beanstalk)
 *   3. `git rev-parse --short HEAD` (dev local)
 *   4. Timestamp base-36 (fallback ultime)
 *
 * Pour l'intégration AWS, ajouter dans le pipeline de déploiement :
 *   export COMMIT_HASH=$(git rev-parse --short HEAD)
 */

const { execSync } = require('child_process');
const { version: pkgVersion } = require('../package.json');

const _hash =
  process.env.COMMIT_HASH    ||
  process.env.SOURCE_VERSION ||
  (() => {
    try {
      return execSync('git rev-parse --short HEAD', {
        cwd:      __dirname,
        encoding: 'utf8',
        stdio:    ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return Date.now().toString(36);
    }
  })();

const APP_VERSION = `${pkgVersion}+${_hash}`;

module.exports = { APP_VERSION };
