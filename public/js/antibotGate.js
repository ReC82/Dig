/**
 * antibotGate.js — Vérification anti-bot du minage manuel (#25 lot C).
 *
 * Le serveur décide seul d'un défi ou d'une suspension (mode « Appliqué ») et renvoie l'état avec
 * chaque sauvegarde, ou via GET /api/me/antibot (F5, autre appareil). Tant que l'état dure :
 *   - les coups manuels sur le bloc ne font rien (ni dégât, ni gain, ni compteur) ;
 *   - l'Auto-Dig, la boutique, l'inventaire, les boosts et le compte restent utilisables ;
 *   - la fenêtre peut être fermée et rouverte (bouton dans le jeu ou clic sur le bloc).
 * Un échec, une énigme expirée ou une erreur réseau ne sanctionnent jamais : nouvelle énigme.
 * Chrono (#25, 08/11) : durée envoyée par le serveur (`seconds`), décomptée avec l'horloge monotone
 * du navigateur depuis la réception ; le serveur garde sa propre expiration (marge réseau en plus).
 * Aucune réponse n'est vérifiée ici : l'énigme et sa solution restent sur le serveur.
 */
const AntibotGate = (() => {
  let _state  = null;     // { challenge, suspension } renvoyé par le serveur, ou null
  let _puzzle = null;
  let _kind   = 'grid';
  let _picks  = [];
  let _deps   = null;     // { api, t, counters }
  let _el     = null;
  let _timer  = null;
  let _seenId = null;
  let _busy   = false;
  let _deadline = 0;      // performance.now() de fin de l'énigme affichée (0 : pas de chrono)
  let _tickId = null;

  const T = (k, v) => (_deps ? _deps.t(`antibot.${k}`, v) : k);

  /** Heure de fin lisible, toujours à l'heure de Bruxelles (consigne du propriétaire). */
  function _fmtBrussels(iso) {
    try {
      return new Date(iso).toLocaleString(typeof I18n !== 'undefined' && I18n.intl ? I18n.intl() : undefined,
        { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return new Date(iso).toISOString(); }
  }

  function _build() {
    if (_el) return _el;
    _el = document.createElement('div');
    _el.id = 'antibot-modal';
    _el.hidden = true;
    _el.setAttribute('role', 'dialog');
    _el.setAttribute('aria-modal', 'true');
    _el.setAttribute('aria-labelledby', 'antibot-title');
    _el.innerHTML = `
      <div id="antibot-inner">
        <div id="antibot-icon" aria-hidden="true">🛡️</div>
        <h2 id="antibot-title"></h2>
        <p id="antibot-text"></p>
        <p id="antibot-keep" class="antibot-muted"></p>
        <div id="antibot-timer" hidden>
          <span id="antibot-timer-txt" role="timer" aria-live="off"></span>
          <span class="antibot-timer-bar" aria-hidden="true"><i id="antibot-timer-fill"></i></span>
        </div>
        <div id="antibot-puzzle"></div>
        <p id="antibot-msg" role="status" aria-live="polite"></p>
        <div id="antibot-actions">
          <button type="button" id="antibot-new" class="antibot-btn-ghost"></button>
          <button type="button" id="antibot-alt" class="antibot-btn-ghost"></button>
          <button type="button" id="antibot-close" class="antibot-btn-ghost"></button>
        </div>
        <p id="antibot-help" class="antibot-muted"></p>
      </div>`;
    document.body.appendChild(_el);
    _el.querySelector('#antibot-new').addEventListener('click', () => _loadPuzzle());
    _el.querySelector('#antibot-alt').addEventListener('click', e => {
      _kind = _kind === 'grid' ? 'text' : 'grid';
      e.currentTarget.textContent = T(_kind === 'grid' ? 'btn_alt_text' : 'btn_alt_grid');
      _loadPuzzle();
    });
    _el.querySelector('#antibot-close').addEventListener('click', hide);
    _el.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
    // Onglet remis au premier plan : les minuteries ont pu être ralenties, le chrono est recalculé
    document.addEventListener('visibilitychange', () => { if (!document.hidden) _tick(); });
    return _el;
  }

  function _msg(text, kind = '') {
    const m = _el?.querySelector('#antibot-msg');
    if (!m) return;
    m.textContent = text || '';
    m.className = kind;
  }

  /**
   * Pictogrammes de l'énigme : SVG locaux dessinés à la main (recette du 07/11 : l'emoji 🪙 « pièce »
   * s'affichait en carré vide sur certains systèmes). Aucun emoji, aucune police, aucun réseau :
   * le rendu est identique sur Windows, Android, iOS et en PWA. Symbole inconnu → son nom en clair.
   */
  const _SVG = {
    pickaxe: '<path d="M14 40 34 14" stroke="#8b5a2b" stroke-width="5" stroke-linecap="round"/><path d="M6 20C14 8 30 3 43 8l-4 6C30 10 18 13 11 23z" fill="#9ca3af" stroke="#4b5563" stroke-width="2" stroke-linejoin="round"/>',
    gem: '<path d="M14 8h20l9 11-19 23L5 19z" fill="#38bdf8" stroke="#0369a1" stroke-width="2" stroke-linejoin="round"/><path d="M5 19h38M14 8l5 11 5-11 5 11 5-11M19 19l5 23 5-23" fill="none" stroke="#0369a1" stroke-width="1.6" stroke-linejoin="round"/>',
    key: '<circle cx="15" cy="24" r="9" fill="none" stroke="#d97706" stroke-width="5"/><path d="M24 24h19M36 24v8M42 24v6" stroke="#d97706" stroke-width="5" stroke-linecap="round"/>',
    star: '<path d="m24 4 5.9 12.6 13.6 1.6-10 9.4 2.6 13.5L24 34.4 11.9 41.1l2.6-13.5-10-9.4 13.6-1.6z" fill="#facc15" stroke="#a16207" stroke-width="2" stroke-linejoin="round"/>',
    heart: '<path d="M24 42S5 30 5 17c0-6 4.5-10 9.5-10 4 0 7.5 2.5 9.5 6 2-3.5 5.5-6 9.5-6 5 0 9.5 4 9.5 10 0 13-19 25-19 25z" fill="#ef4444" stroke="#991b1b" stroke-width="2" stroke-linejoin="round"/>',
    fire: '<path d="M24 44c-9 0-15-6-15-14 0-8 6-12 8-20 4 3 5 7 5 10 2-4 5-9 4-16 8 5 14 14 14 24 0 9-7 16-16 16z" fill="#f97316" stroke="#9a3412" stroke-width="2" stroke-linejoin="round"/><path d="M24 44c-4 0-7-3-7-7 0-4 4-7 5-11 4 3 9 7 9 12 0 3-3 6-7 6z" fill="#fde047"/>',
    drop: '<path d="M24 4C24 4 10 21 10 30a14 14 0 0 0 28 0C38 21 24 4 24 4z" fill="#3b82f6" stroke="#1e3a8a" stroke-width="2" stroke-linejoin="round"/><path d="M17 30a7 7 0 0 0 5 7" fill="none" stroke="#bfdbfe" stroke-width="3" stroke-linecap="round"/>',
    moon: '<path d="M30 5A19 19 0 1 0 43 34 15 15 0 0 1 30 5z" fill="#fde68a" stroke="#a16207" stroke-width="2" stroke-linejoin="round"/>',
    clover: '<g fill="#16a34a" stroke="#14532d" stroke-width="1.6"><circle cx="17" cy="15" r="7"/><circle cx="31" cy="15" r="7"/><circle cx="17" cy="29" r="7"/><circle cx="31" cy="29" r="7"/></g><circle cx="24" cy="22" r="4" fill="#15803d"/><path d="M26 30c2 6 6 10 10 13" fill="none" stroke="#14532d" stroke-width="3" stroke-linecap="round"/>',
    coin: '<circle cx="24" cy="24" r="19" fill="#fbbf24" stroke="#92400e" stroke-width="2.5"/><circle cx="24" cy="24" r="14" fill="none" stroke="#b45309" stroke-width="2"/><path d="M29 18.5c-1.2-1.6-3-2.5-5-2.5-3 0-5 1.6-5 4s2.2 3.3 5 4 5 1.7 5 4.2-2.2 4-5 4c-2.2 0-4.1-1-5.2-2.6M24 13v22" fill="none" stroke="#92400e" stroke-width="2.6" stroke-linecap="round"/>',
    bell: '<path d="M24 6c-8 0-12 6-12 14v9l-5 6h34l-5-6v-9c0-8-4-14-12-14z" fill="#eab308" stroke="#854d0e" stroke-width="2" stroke-linejoin="round"/><circle cx="24" cy="39" r="4" fill="#854d0e"/><circle cx="24" cy="5" r="2.5" fill="#854d0e"/>',
    leaf: '<path d="M8 40C8 20 20 8 42 6c0 22-12 34-32 34z" fill="#84cc16" stroke="#3f6212" stroke-width="2" stroke-linejoin="round"/><path d="M8 40 34 14M18 30h8M24 24v-8" fill="none" stroke="#3f6212" stroke-width="2" stroke-linecap="round"/>',
  };

  function _tileIcon(sym) {
    const body = Object.hasOwn(_SVG, sym) ? _SVG[sym] : null;
    if (!body) {
      const span = document.createElement('span');
      span.className = 'antibot-tile-name';
      span.textContent = T(`sym_${sym}`);
      return span;
    }
    const tpl = document.createElement('template');
    tpl.innerHTML = `<svg class="antibot-svg" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" focusable="false">${body}</svg>`;
    return tpl.content.firstChild;
  }

  const _expired = () => !!_puzzle && _deadline > 0 && performance.now() >= _deadline;

  function _stopTimer() { clearInterval(_tickId); _tickId = null; }

  /** Met à jour le chrono ; à zéro : énigme désactivée, le joueur en demande une autre (sans sanction). */
  function _tick() {
    const box = _el?.querySelector('#antibot-timer');
    if (!box) return;
    if (!_puzzle || !_deadline || _state?.suspension) { box.hidden = true; _stopTimer(); return; }
    const total = (_puzzle.seconds || 1) * 1000;
    const left = Math.max(0, _deadline - performance.now());
    const sec = Math.ceil(left / 1000);
    box.hidden = false;
    box.classList.toggle('low', sec <= 10);
    _el.querySelector('#antibot-timer-txt').textContent =
      T('timer', { time: `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}` });
    _el.querySelector('#antibot-timer-fill').style.width = `${(100 * left / total).toFixed(1)}%`;
    if (left > 0) return;
    _stopTimer();
    if (_puzzle.done) return;
    _puzzle.done = true;
    _el.querySelectorAll('#antibot-puzzle button, #antibot-puzzle input').forEach(b => { b.disabled = true; });
    _msg(T('time_up'), 'warn');
    if (!_el.hidden) _el.querySelector('#antibot-new').focus();
  }

  function _startTimer() {
    _stopTimer();
    _deadline = _puzzle && _puzzle.seconds > 0 ? performance.now() + _puzzle.seconds * 1000 : 0;
    _tick();
    if (_deadline) _tickId = setInterval(_tick, 250);
  }

  function _renderPuzzle() {
    const box = _el.querySelector('#antibot-puzzle');
    box.textContent = '';
    if (!_puzzle) { _deadline = 0; _tick(); return; }
    if (_puzzle.kind === 'text') {
      const form = document.createElement('form');
      form.className = 'antibot-text-form';
      const label = document.createElement('label');
      label.htmlFor = 'antibot-answer';
      label.textContent = T('text_question', { a: _puzzle.a, b: _puzzle.b });
      const input = document.createElement('input');
      input.id = 'antibot-answer';
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'off';
      input.maxLength = 3;
      const ok = document.createElement('button');
      ok.type = 'submit';
      ok.className = 'antibot-btn';
      ok.textContent = T('btn_check');
      form.append(label, input, ok);
      form.addEventListener('submit', e => { e.preventDefault(); _submit(input.value); });
      box.appendChild(form);
      input.focus();
      return;
    }
    const names = _puzzle.targets.map(s => T(`sym_${s}`));
    const q = document.createElement('p');
    q.className = 'antibot-question';
    q.textContent = T('grid_question', { a: names[0], b: names[1] });
    const grid = document.createElement('div');
    grid.className = 'antibot-grid';
    _puzzle.tiles.forEach((tile, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'antibot-tile';
      b.appendChild(_tileIcon(tile.sym));
      b.setAttribute('aria-label', T(`sym_${tile.sym}`));
      b.title = T(`sym_${tile.sym}`);
      b.addEventListener('click', () => {
        if (_busy || _picks.includes(i)) return;
        _picks.push(i);
        b.classList.add('picked');
        b.setAttribute('aria-pressed', 'true');
        if (_picks.length === _puzzle.targets.length) _submit(_picks.join(','));
      });
      grid.appendChild(b);
    });
    box.append(q, grid);
  }

  async function _loadPuzzle(keepMsg = false) {
    if (!_state?.challenge || _state.suspension || _busy) return;
    _busy = true;
    _picks = [];
    if (!keepMsg) _msg('');
    try {
      const { ok, status, data } = await _deps.api('POST', '/api/me/antibot/puzzle', { challengeId: _state.challenge.id, kind: _kind });
      if (ok) { _puzzle = data.puzzle; _renderPuzzle(); _startTimer(); }
      else if (status === 404) { update(null); }
      else if (status === 429) { _puzzle = null; _renderPuzzle(); _msg(T('err_too_many', { time: _fmtBrussels(data.retryAt) }), 'warn'); }
      else _msg(T('err_network'), 'warn');
    } catch (_) {
      _msg(T('err_network'), 'warn');
    } finally { _busy = false; }
  }

  async function _submit(answer) {
    if (!_puzzle || _busy || _puzzle.done) return;
    _busy = true;
    const c = _deps.counters();
    try {
      const { ok, status, data } = await _deps.api('POST', '/api/me/antibot/answer', {
        challengeId: _state.challenge.id, puzzleId: _puzzle.puzzleId, answer: String(answer),
        manualClicks: c.manualClicks, manualBlocks: c.manualBlocks });
      _busy = false;
      if (ok && data.solved) { update(data.antibot ?? null); _deps.onSolved?.(); return; }
      if (status === 404) { update(null); return; }
      _msg(T(data?.reason === 'too_fast' ? 'err_too_fast' : data?.reason === 'expired' ? 'err_expired' : 'err_wrong'), 'warn');
      _loadPuzzle(true);
    } catch (_) {
      _busy = false;
      _msg(T('err_network'), 'warn');   // aucune sanction : l'énigme peut être relancée
    }
  }

  function _render() {
    const el = _build();
    const s = _state;
    const susp = s?.suspension;
    el.querySelector('#antibot-icon').textContent = susp ? '⏸️' : '🛡️';
    el.querySelector('#antibot-title').textContent = T(susp ? 'susp_title' : 'title');
    el.querySelector('#antibot-text').textContent = susp
      ? T('susp_text', { time: _fmtBrussels(susp.endsAt) })
      : T('text');
    el.querySelector('#antibot-keep').textContent = T('keep');
    el.querySelector('#antibot-help').textContent = T(susp ? 'susp_help' : 'help');
    el.querySelector('#antibot-new').textContent = T('btn_new');
    el.querySelector('#antibot-alt').textContent = T(_kind === 'grid' ? 'btn_alt_text' : 'btn_alt_grid');
    el.querySelector('#antibot-close').textContent = T('btn_close');
    el.querySelector('#antibot-new').hidden = !!susp;
    el.querySelector('#antibot-alt').hidden = !!susp;
    if (susp) { _puzzle = null; _renderPuzzle(); }
  }

  /** Affiche la fenêtre (et signale le défi vu au serveur, avec le compteur de clics courant). */
  function show() {
    if (!_state || !_deps) return;
    _render();
    _el.hidden = false;
    const ch = _state.challenge;
    if (ch && !_state.suspension && !ch.seen && _seenId !== ch.id) {
      _seenId = ch.id;
      _deps.api('POST', '/api/me/antibot/seen', { challengeId: ch.id, manualClicks: _deps.counters().manualClicks }).catch(() => { _seenId = null; });
    }
    // Énigme expirée pendant que la fenêtre était fermée : une nouvelle, avec un chrono complet
    if (ch && !_state.suspension && (!_puzzle || _expired())) _loadPuzzle();
    else if (_puzzle && _deadline && !_tickId) { _tick(); if (!_expired()) _tickId = setInterval(_tick, 250); }
    _el.querySelector('#antibot-close').focus();
  }

  function hide() { if (_el) _el.hidden = true; _stopTimer(); }

  /**
   * Nouvel état du serveur (null : plus rien à vérifier). Un nouvel état ouvre la fenêtre ; un état
   * inchangé ne la rouvre pas si le joueur l'a fermée.
   */
  function update(state) {
    const prevKey = _key(_state);
    _state = state && (state.challenge || state.suspension) ? state : null;
    clearTimeout(_timer);
    if (!_state) { _puzzle = null; hide(); _deps?.onChange?.(false); return; }
    // Le serveur a oublié le relevé (après une suspension) : nouveau signalement à l'affichage
    if (_state.challenge && !_state.challenge.seen && !_state.suspension && _seenId === _state.challenge.id && prevKey !== _key(_state)) _seenId = null;
    if (_state.suspension) {
      const ms = Date.parse(_state.suspension.endsAt) - Date.now();
      _timer = setTimeout(refresh, Math.max(5_000, Math.min(ms + 2_000, 3_600_000)));
    }
    _deps?.onChange?.(true);
    if (prevKey !== _key(_state)) { _puzzle = null; show(); }
    else if (_el && !_el.hidden) _render();
  }

  const _key = s => (s ? `${s.challenge?.id ?? ''}/${s.suspension?.id ?? ''}` : '');

  async function refresh() {
    if (!_deps) return;
    try {
      const { ok, data } = await _deps.api('GET', '/api/me/antibot');
      if (ok) update(data.antibot ?? null);
    } catch (_) { /* hors ligne : état conservé, aucune sanction */ }
  }

  /** Vrai si le minage manuel est en attente de vérification ou suspendu. */
  function blocksManual() { return !!_state; }

  function init(deps) { _deps = deps; }

  return { init, update, refresh, show, hide, blocksManual, _fmtBrussels, _SVG };
})();
