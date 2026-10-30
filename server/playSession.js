/**
 * DIG! — Session de jeu unique par compte (ticket #35).
 *
 * Un seul « contrôleur » (onglet, navigateur, appareil ou PWA) peut miner pour un compte.
 * Chaque page de jeu tire un identifiant aléatoire (`controllerId`) et prend la main au
 * chargement (POST /api/me/play/claim) : la dernière page ouverte gagne, les autres reçoivent
 * « Partie ouverte sur un autre appareil — Jouer ici ». Le serveur refuse toute sauvegarde ou
 * ouverture de coffre d'un ancien contrôleur (requête tardive comprise) : rien n'est écrasé,
 * aucun gain n'est dupliqué. La déconnexion n'est jamais forcée : seul le droit de jouer change.
 *
 * Bail : le contrôleur actif signale sa présence (heartbeat) ; sans signal pendant LEASE_TTL_MS
 * (onglet fermé, appareil éteint, plantage), une autre page déjà ouverte peut reprendre la main
 * sans action du joueur. Toutes les écritures sont synchrones (better-sqlite3) dans une
 * transaction : deux prises de contrôle simultanées ne peuvent pas réussir toutes les deux.
 */

'use strict';

const db = require('./db');

const LEASE_TTL_MS = 45_000;
const CONTROLLER_RE = /^[A-Za-z0-9_-]{8,64}$/;

function isValidControllerId(id) {
  return typeof id === 'string' && CONTROLLER_RE.test(id);
}

function getController(userId) {
  return db.getDb().prepare('SELECT * FROM play_controllers WHERE user_id = ?').get(userId) ?? null;
}

function describe(row, now) {
  return { controllerId: row.controller_id, epoch: row.epoch, expired: now - row.heartbeat_ms > LEASE_TTL_MS };
}

/**
 * Prend la main pour `controllerId` (idempotent pour le contrôleur déjà actif).
 * @param {object} [opts]
 * @param {boolean} [opts.onlyIfFree]  ne prend la main que si personne ne l'a ou si le bail a expiré
 * @returns {{ ok: boolean, epoch: number, previousActive: boolean }}
 */
function claim(userId, controllerId, { onlyIfFree = false, now = Date.now() } = {}) {
  const d = db.getDb();
  return d.transaction(() => {
    const row = getController(userId);
    if (row && row.controller_id === controllerId) {
      d.prepare('UPDATE play_controllers SET heartbeat_ms = ? WHERE user_id = ?').run(now, userId);
      return { ok: true, epoch: row.epoch, previousActive: false };
    }
    const previousActive = !!row && now - row.heartbeat_ms <= LEASE_TTL_MS;
    if (onlyIfFree && previousActive) return { ok: false, epoch: row.epoch, previousActive };
    const epoch = row ? row.epoch + 1 : 1;
    d.prepare(`
      INSERT INTO play_controllers (user_id, controller_id, epoch, claimed_ms, heartbeat_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        controller_id = excluded.controller_id, epoch = excluded.epoch,
        claimed_ms = excluded.claimed_ms, heartbeat_ms = excluded.heartbeat_ms
    `).run(userId, controllerId, epoch, now, now);
    return { ok: true, epoch, previousActive };
  })();
}

/** Signal de présence : { active } (le bail n'est prolongé que pour le contrôleur actif). */
function heartbeat(userId, controllerId, now = Date.now()) {
  const row = getController(userId);
  if (row && row.controller_id === controllerId) {
    db.getDb().prepare('UPDATE play_controllers SET heartbeat_ms = ? WHERE user_id = ?').run(now, userId);
    return { active: true, epoch: row.epoch };
  }
  // Personne ne joue (aucun bail ou bail expiré) : la page peut reprendre la main d'elle-même
  return { active: false, canResume: !row || describe(row, now).expired, epoch: row ? row.epoch : 0 };
}

/**
 * Droit d'écriture d'une requête de jeu (sauvegarde, coffre) — à appeler DANS la transaction
 * d'écriture pour qu'aucune prise de contrôle ne puisse s'intercaler.
 *   - `controllerId` fourni : accepté s'il est le contrôleur actif, ou si personne n'a la main
 *     (il la prend alors) ; refusé si un autre contrôleur l'a, même avec un bail expiré
 *     (l'ancien appareil doit d'abord reprendre la main explicitement et relire la sauvegarde).
 *   - absent (onglet ouvert avant la mise à jour) : accepté sauf si un contrôleur actif existe.
 * @returns {boolean}
 */
function mayWrite(userId, controllerId, now = Date.now()) {
  const row = getController(userId);
  if (controllerId === undefined || controllerId === null) {
    return !row || describe(row, now).expired;
  }
  if (!row) { claim(userId, controllerId, { now }); return true; }
  if (row.controller_id !== controllerId) return false;
  db.getDb().prepare('UPDATE play_controllers SET heartbeat_ms = ? WHERE user_id = ?').run(now, userId);
  return true;
}

/** Fin de partie volontaire (déconnexion) : libère la main si cette page l'avait. */
function release(userId, controllerId) {
  db.getDb().prepare('DELETE FROM play_controllers WHERE user_id = ? AND controller_id = ?').run(userId, controllerId);
}

module.exports = { LEASE_TTL_MS, isValidControllerId, getController, claim, heartbeat, mayWrite, release };
