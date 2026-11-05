/**
 * tutorial.js — État du tutoriel de première partie par compte (#79).
 *
 * - Table `player_tutorial` en ajout seul (CREATE TABLE IF NOT EXISTS) : aucune colonne ajoutée à
 *   `users`, aucune écriture dans `user_saves` ; la sauvegarde de jeu n'est jamais lue ni modifiée.
 * - Une ligne par compte : version du parcours, état (started / done / skipped ; absence de ligne =
 *   jamais commencé), étape atteinte. Les invités gardent le même état dans leur navigateur
 *   (js/tutorial.js), poussé ici à la connexion.
 * - La version permet un parcours révisé plus tard sans le relancer aux joueurs qui ont déjà un état.
 * - Aucun gain, aucun lien avec l'économie, le classement ou l'anti-bot.
 */

'use strict';

const db = require('./db');

const STATES = ['started', 'done', 'skipped'];
const MAX_VERSION = 99;
const MAX_STEP = 20;

class TutorialError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let _initFor = null;
const conn = () => { const c = db.getDb(); if (_initFor !== c) { _initFor = c; init(c); } return c; };

function init(c = db.getDb()) {
  _initFor = c;
  c.exec(`
    CREATE TABLE IF NOT EXISTS player_tutorial (
      user_id    INTEGER PRIMARY KEY,
      version    INTEGER NOT NULL,
      state      TEXT    NOT NULL CHECK (state IN ('started', 'done', 'skipped')),
      step       INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

const iso = v => (v ? `${String(v).replace(' ', 'T')}Z` : null);

/** État du compte, ou null s'il n'a jamais commencé ni passé le tutoriel. */
function get(userId) {
  const r = conn().prepare('SELECT version, state, step, updated_at FROM player_tutorial WHERE user_id = ?').get(userId);
  return r ? { v: r.version, state: r.state, step: r.step, at: iso(r.updated_at) } : null;
}

/** Enregistre l'état envoyé par le jeu (validé, borné). */
function set(userId, input = {}) {
  const v = input.v, step = input.step ?? 0;
  if (!Number.isInteger(v) || v < 1 || v > MAX_VERSION) throw new TutorialError(400, 'Version de tutoriel invalide.');
  if (!STATES.includes(input.state)) throw new TutorialError(400, 'État de tutoriel invalide.');
  if (!Number.isInteger(step) || step < 0 || step > MAX_STEP) throw new TutorialError(400, 'Étape de tutoriel invalide.');
  conn().prepare(`INSERT INTO player_tutorial (user_id, version, state, step, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET version = excluded.version, state = excluded.state, step = excluded.step, updated_at = excluded.updated_at`)
    .run(userId, v, input.state, step);
  return get(userId);
}

module.exports = { init, get, set, TutorialError, STATES, MAX_STEP };
