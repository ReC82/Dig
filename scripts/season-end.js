#!/usr/bin/env node
/**
 * scripts/season-end.js — Date de fin de la saison active en ligne de commande (#44).
 * Même logique et mêmes protections que le panel admin (server/seasonEnd.js), pour un serveur
 * sans ADMIN_SECRET. Ne clôt rien : à l'échéance, le planificateur de dig.service s'en charge.
 *
 *   node scripts/season-end.js                                   état (lecture)
 *   node scripts/season-end.js --at 2026-10-30T17:00             aperçu (heure de Bruxelles, aucune écriture)
 *   node scripts/season-end.js --at 2026-10-30T17:00 --apply --confirm "Saison 44-2026" [--reason "…"]
 *   node scripts/season-end.js --cancel --apply                  retour à la fin hebdomadaire
 *
 * Base : server/data/$DB_FILE (défaut dig.sqlite). Faire une sauvegarde avant --apply.
 */

'use strict';

const args = process.argv.slice(2);
const opt  = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const has  = name => args.includes(name);

// Journaux du serveur sur stderr : stdout ne contient que le résultat JSON
console.log = (...a) => console.error(...a);
const db        = require('../server/db');
db.initDb();
const seasonEnd = require('../server/seasonEnd');

function out(v) { process.stdout.write(JSON.stringify(v, null, 2) + '\n'); }

try {
  const state = seasonEnd.state();
  if (!state.season) throw new seasonEnd.SeasonEndError(404, 'Aucune saison active.');
  if (has('--cancel')) {
    if (!has('--apply')) { out({ state, note: 'Ajouter --apply pour annuler la fin exceptionnelle.' }); process.exit(0); }
    out(seasonEnd.cancel(state.season.id, { expectedEndAt: state.expectedEndAt, reason: opt('--reason') ?? 'CLI' }));
  } else if (opt('--at')) {
    const end = seasonEnd.parseRequestedEnd({ end_local: opt('--at') });
    const preview = seasonEnd.preview(state.season.id, end);
    if (!has('--apply')) { out({ preview, note: 'Aperçu seul. Pour programmer : --apply --confirm "<nom exact de la saison>".' }); process.exit(0); }
    out(seasonEnd.setEnd(state.season.id, end, {
      confirm: opt('--confirm'), expectedEndAt: preview.expectedEndAt, reason: opt('--reason') ?? 'CLI',
    }));
  } else {
    out(state);
  }
} catch (err) {
  console.error(`Erreur${err.status ? ` (${err.status})` : ''} : ${err.message}`);
  process.exit(1);
} finally {
  try { db.getDb().close(); } catch (_) {}
}
