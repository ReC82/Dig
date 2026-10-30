/**
 * notifLog.js — Historique local des notifications (ticket #26).
 *
 * Les toasts disparaissent en quelques secondes : chaque notification utile est aussi
 * enregistrée ici, consultable dans Paramètres → Historique des notifications.
 *  - stockage local (localStorage), borné à MAX entrées, conservé au rechargement ;
 *  - une répétition du même message (même type, même texte) dans DEDUP_MS remonte
 *    l'entrée existante et incrémente son compteur au lieu d'en créer une nouvelle ;
 *  - aucune donnée de compte : seulement l'heure, le type, l'icône et le texte affiché.
 * Toute erreur de stockage est ignorée : l'historique ne bloque jamais le jeu.
 * Chargé par le jeu ; exporté aussi pour les tests Node.
 */

(function (root) {
  const KEY      = 'dig_notif_log';
  const MAX      = 100;
  const MAX_TEXT = 500;
  const DEDUP_MS = 10 * 60 * 1000;
  const TYPES    = ['info', 'success', 'warning', 'error'];

  function _storage() {
    try { return root.localStorage || null; } catch (_) { return null; }
  }

  function _read() {
    const ls = _storage();
    if (!ls) return [];
    try {
      const list = JSON.parse(ls.getItem(KEY));
      return Array.isArray(list) ? list.filter(e => e && typeof e.text === 'string') : [];
    } catch (_) { return []; }
  }

  function _write(list) {
    const ls = _storage();
    if (!ls) return;
    try { ls.setItem(KEY, JSON.stringify(list)); } catch (_) {}
  }

  /** Type déduit de l'icône quand l'appelant n'en précise pas. */
  function typeForIcon(icon) {
    if (icon === '❌') return 'error';
    if (icon === '⚠️' || icon === '📱' || icon === '🗂️') return 'warning';
    if (icon === '☁️' || icon === '👤') return 'info';
    return 'success';
  }

  /**
   * Ajoute une entrée (la plus récente en tête).
   * @param {{ type?: string, icon?: string, text: string, at?: number }} entry
   */
  function add(entry) {
    const text = String(entry?.text ?? '').trim().slice(0, MAX_TEXT);
    if (!text) return;
    const icon = String(entry.icon ?? '').slice(0, 8);
    const type = TYPES.includes(entry.type) ? entry.type : typeForIcon(icon);
    const at   = Number.isFinite(entry.at) ? entry.at : Date.now();
    const list = _read();
    const i = list.findIndex(e => e.type === type && e.text === text && at - e.at < DEDUP_MS);
    if (i >= 0) {
      const [prev] = list.splice(i, 1);
      list.unshift({ ...prev, icon, at, count: (prev.count || 1) + 1 });
    } else {
      list.unshift({ at, type, icon, text, count: 1 });
    }
    _write(list.slice(0, MAX));
  }

  function list() { return _read(); }

  function clear() {
    const ls = _storage();
    if (!ls) return;
    try { ls.removeItem(KEY); } catch (_) {}
  }

  const NotifLog = { KEY, MAX, DEDUP_MS, TYPES, add, list, clear, typeForIcon };

  if (typeof module !== 'undefined' && module.exports) module.exports = NotifLog;
  else root.NotifLog = NotifLog;
})(typeof window !== 'undefined' ? window : this);
