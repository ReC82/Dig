/**
 * antibotGate.js — Vérification anti-bot du minage manuel (#25 lot C).
 *
 * Le serveur décide seul d'un défi ou d'une suspension (mode « Appliqué ») et renvoie l'état avec
 * chaque sauvegarde, ou via GET /api/me/antibot (F5, autre appareil). Tant que l'état dure :
 *   - les coups manuels sur le bloc ne font rien (ni dégât, ni gain, ni compteur) ;
 *   - l'Auto-Dig, la boutique, l'inventaire, les boosts et le compte restent utilisables ;
 *   - la fenêtre peut être fermée et rouverte (bouton dans le jeu ou clic sur le bloc).
 * Un échec, une énigme expirée ou une erreur réseau ne sanctionnent jamais : nouvelle énigme.
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
    return _el;
  }

  function _msg(text, kind = '') {
    const m = _el?.querySelector('#antibot-msg');
    if (!m) return;
    m.textContent = text || '';
    m.className = kind;
  }

  function _renderPuzzle() {
    const box = _el.querySelector('#antibot-puzzle');
    box.textContent = '';
    if (!_puzzle) return;
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
      b.textContent = tile.icon;
      b.setAttribute('aria-label', T(`sym_${tile.sym}`));
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
      if (ok) { _puzzle = data.puzzle; _renderPuzzle(); }
      else if (status === 404) { update(null); }
      else if (status === 429) { _puzzle = null; _renderPuzzle(); _msg(T('err_too_many', { time: _fmtBrussels(data.retryAt) }), 'warn'); }
      else _msg(T('err_network'), 'warn');
    } catch (_) {
      _msg(T('err_network'), 'warn');
    } finally { _busy = false; }
  }

  async function _submit(answer) {
    if (!_puzzle || _busy) return;
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
    if (ch && !_state.suspension && !_puzzle) _loadPuzzle();
    _el.querySelector('#antibot-close').focus();
  }

  function hide() { if (_el) _el.hidden = true; }

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

  return { init, update, refresh, show, hide, blocksManual, _fmtBrussels };
})();
