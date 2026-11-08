/**
 * extProbe.js — Vérification ciblée de signatures d'extensions d'autoclic (#92).
 *
 * Le serveur fournit la liste des signatures ACTIVÉES pour ce compte (vide par défaut : rien n'est
 * vérifié). Pour chacune :
 *   - installation : un élément témoin portant l'identifiant visé est ajouté, ses styles calculés sont
 *     comparés à ceux que la feuille CSS de l'extension impose, puis il est retiré dans la même tâche
 *     (jamais laissé dans la page, invisible) ;
 *   - activité : présence de l'indicateur que l'extension ajoute pendant ses clics.
 * Aucune liste d'extensions n'est lue ni envoyée : seulement « trace oui/non » par signature activée.
 */
(function (global) {
  'use strict';

  /** Trace d'installation : toutes les propriétés attendues doivent correspondre. */
  function installed(probe) {
    const p = probe && probe.install;
    if (!p || !document.body) return false;
    const el = document.createElement(p.tag || 'div');
    el.id = p.id;
    el.style.visibility = 'hidden';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
    try {
      return (p.checks || []).length > 0 && p.checks.every(([pseudo, prop, value]) =>
        getComputedStyle(el, pseudo || null).getPropertyValue(prop).trim() === value);
    } catch { return false; } finally { el.remove(); }
  }

  /** Indicateur d'activité présent dans la page (sélecteur fourni par le serveur). */
  function active(probe) {
    const sel = probe && probe.active;
    if (!sel) return false;
    try { return !!document.querySelector(sel); } catch { return false; }
  }

  /** { [id]: { i: 0|1 } } pour une liste [{ id, probe }]. */
  function checkAll(list) {
    const out = {};
    for (const s of list || []) out[s.id] = { i: installed(s.probe) ? 1 : 0, a: active(s.probe) ? 1 : 0 };
    return out;
  }

  global.DigExtProbe = { installed, active, checkAll };
})(window);
