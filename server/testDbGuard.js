/**
 * server/testDbGuard.js
 * Garde-fou des scripts de test (seed-test.js) : ils ne doivent jamais écrire dans la base
 * de production (audit B10, ticket #17).
 *
 * Règles :
 *   - DB_FILE doit être fourni par l'environnement de la commande (pas par .env, que ces
 *     scripts chargent ensuite) : `DB_FILE=/tmp/seed.sqlite node server/seed-test.js` ;
 *   - le fichier visé ne peut pas s'appeler dig.sqlite ni être la base par défaut.
 */

'use strict';

const path = require('path');

const DATA_DIR      = path.join(__dirname, 'data');
const PROD_BASENAME = 'dig.sqlite';

/** Retourne le chemin absolu de la base de test, ou lève une erreur explicite. */
function resolveTestDbPath(env = process.env, dataDir = DATA_DIR) {
  const file = (env.DB_FILE || '').trim();
  if (!file) {
    throw new Error('DB_FILE absent : précisez une base de test, ex. DB_FILE=/tmp/dig-seed.sqlite');
  }
  const target = path.resolve(dataDir, file);
  if (path.basename(target).toLowerCase() === PROD_BASENAME || target === path.resolve(dataDir, PROD_BASENAME)) {
    throw new Error(`DB_FILE=${file} désigne la base de production (${PROD_BASENAME}) : refusé`);
  }
  return target;
}

module.exports = { resolveTestDbPath, PROD_BASENAME };
