/**
 * tutorial.js — Tutoriel interactif facultatif de la première partie (#79).
 *
 * - Proposé une seule fois, à la toute première partie : aucun état enregistré (navigateur ou
 *   compte) ET partie neuve (aucun bloc cassé, profondeur 1, aucune sauvegarde du compte reprise).
 *   Jamais imposé à un joueur historique, sur un nouvel appareil, dans la PWA ou après une reprise.
 * - État versionné { v, state: started | done | skipped, step, at } : dans le navigateur
 *   (dig_tutorial) et, connecté, dans le compte (GET/PUT /api/me/tutorial, table à part). Un
 *   parcours révisé (VERSION + 1) ne se relance pas aux joueurs qui ont déjà un état.
 * - Six étapes d'une phrase, avec Passer, Retour, Suivant. La zone concernée est entourée d'un
 *   cadre lumineux qui ne la masque pas et ne capte aucun clic ; la carte n'a pas de voile : le
 *   jeu, le défilement et la navigation restent libres. Elle se cache derrière les fenêtres du jeu
 *   (coffre, gains hors ligne, aide…) et réapparaît ensuite.
 * - Aucun effet sur la partie : le tutoriel lit l'écran et l'état du jeu, n'appelle ni sauvegarde,
 *   ni achat, ni changement d'onglet, et n'accorde aucun gain. Reprise ou nouveau départ depuis
 *   l'Aide (#78).
 */
const DigTutorial = (() => {
  const VERSION = 1;
  const KEY = 'dig_tutorial';
  const TICK_MS = 300;

  /**
   * Étapes. targets : zones entourées (la première visible sert à placer la carte) ;
   * done(ctx) : action observée qui fait passer à l'étape suivante (facultatif, Suivant suffit).
   */
  const STEPS = [
    { id: 'tap',     targets: ['#block'],
      start: ctx => { ctx.block = Blocks.current; ctx.hp = Blocks.current?.hp; },
      done:  ctx => !!Blocks.current && (Blocks.current !== ctx.block || Blocks.current.hp < ctx.hp) },
    { id: 'hp',      targets: ['#hp-bar-wrap', '#stat-damage'] },
    { id: 'coins',   targets: ['.nav-btn[data-view="upgrades"]', '#stat-coins'],
      done:  () => _viewActive('upgrades') },
    { id: 'autodig', targets: ['#upgrades-list .help-tip-btn[data-help="autodig"]@.upgrade-card', '.nav-btn[data-view="upgrades"]'] },
    { id: 'ranking', targets: ['.nav-btn[data-view="season"]'] },
    { id: 'more',    targets: ['.nav-btn[data-view="collection"]', '#btn-help'] },
  ];

  const $ = id => document.getElementById(id);
  const _esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s));
  const _params = () => ({ tab_upgrades: t('nav.upgrades'), tab_collection: t('nav.collection'), tab_season: t('season.title'), n: STEPS.length });
  const _txt = (key, extra) => t(key, { ..._params(), ...(extra || {}) });
  const _viewActive = v => (typeof isViewActive === 'function' ? isViewActive(v) : false);

  let _rec = null;          // état enregistré (null = jamais commencé)
  let _account = null;      // compte connecté (id) ou null
  let _step = -1;           // -1 : rien d'affiché ; 0 : proposition ; 1…n : étape
  let _ctx = {};
  let _timer = null;
  let _pendingOffer = false;
  let _pushTimer = null;
  let _rings = [];

  // ── État enregistré ─────────────────────────────────────────────────────────

  function _readLocal() {
    try {
      const r = JSON.parse(localStorage.getItem(KEY) || 'null');
      return _valid(r) ? r : null;
    } catch (_) { return null; }
  }
  const _valid = r => !!r && Number.isInteger(r.v) && ['started', 'done', 'skipped'].includes(r.state) && Number.isInteger(r.step);
  function _writeLocal(r) { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch (_) { /* navigation privée */ } }

  function _record(state, step) {
    _rec = { v: VERSION, state, step: Math.max(0, Math.min(step, STEPS.length)), at: new Date().toISOString() };
    _writeLocal(_rec);
    _schedulePush();
  }

  /** Envoi au compte, regroupé (un appui rapide sur Suivant n'envoie qu'une requête). */
  function _schedulePush(delay = 800) {
    if (!_account) return;
    clearTimeout(_pushTimer);
    _pushTimer = setTimeout(_push, delay);
  }
  async function _push() {
    _pushTimer = null;
    if (!_account || !_rec) return;
    try {
      await fetch('/api/me/tutorial', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ v: _rec.v, state: _rec.state, step: _rec.step }) });
    } catch (_) { /* hors ligne : l'état local suffit, renvoyé à la prochaine connexion */ }
  }

  /** Connexion : l'état du compte prime (autre appareil) ; sinon l'état local est envoyé au compte. */
  async function _syncAccount() {
    try {
      const res = await fetch('/api/me/tutorial', { cache: 'no-store' });
      if (!res.ok) return;
      const server = (await res.json()).tutorial;
      if (_valid(server)) {
        const finished = s => s.state !== 'started';
        // Un parcours terminé ou passé sur un appareil n'est pas relancé par un autre resté « en cours »
        if (!_rec || finished(server) || !finished(_rec)) { _rec = { ...server }; _writeLocal(_rec); }
        else _schedulePush(0);
      } else if (_rec) _schedulePush(0);
    } catch (_) { /* hors ligne */ }
  }

  // ── Démarrage ───────────────────────────────────────────────────────────────

  /**
   * Appelé par main.js une fois la session connue (et la sauvegarde du compte éventuellement reprise).
   * @param {{ account: object|null, fresh: boolean }} o — fresh : partie neuve à l'ouverture.
   */
  async function boot({ account = null, fresh = false } = {}) {
    _account = account?.id ?? null;
    _rec = _readLocal();
    if (_account) await _syncAccount();
    if (_step >= 0) return;                        // déjà lancé depuis l'Aide entre-temps
    if (_rec?.state === 'started') { _show(Math.max(1, _rec.step)); return; }   // reprise après rechargement
    if (!_rec && fresh) { _pendingOffer = true; _ensureTimer(); }
  }

  /**
   * Connexion en cours de partie : l'état suit le compte, sans rien relancer. Un compte déjà joué
   * (fresh = false) retire la simple proposition ; un parcours terminé ou passé sur le compte ferme
   * la carte.
   */
  async function onAccount(account, { fresh = true } = {}) {
    const id = account?.id ?? null;
    if (id === _account) return;
    _account = id;
    if (_account) await _syncAccount();
    if (_step === 0 && !fresh) { _hide(); return; }
    if (_pendingOffer && !fresh) _pendingOffer = false;
    if (_rec && _rec.state !== 'started' && _step >= 0) _hide();
  }

  /** Déconnexion : la partie du navigateur est purgée ; l'état du tutoriel reste dans le compte. */
  function onLogout() {
    clearTimeout(_pushTimer);
    _pushTimer = null;
    _account = null;
    _rec = null;
    try { localStorage.removeItem(KEY); } catch (_) { /* rien */ }
    if (_step >= 0) _hide();
  }

  /** Vrai si rien ne doit passer devant : page verrouillée, fenêtre du jeu ouverte, autre vue. */
  function _blocked() {
    if (typeof Save !== 'undefined' && Save.disabled) return true;
    return [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(d => !d.hidden && d.getClientRects().length > 0);
  }

  // ── Affichage ───────────────────────────────────────────────────────────────

  function _card() {
    let el = $('tuto-card');
    if (el) return el;
    el = document.createElement('section');
    el.id = 'tuto-card';
    el.className = 'tuto-card';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'tuto-title');
    el.setAttribute('aria-describedby', 'tuto-text');
    el.tabIndex = -1;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('button[data-tuto]');
      if (!b || el.classList.contains('is-leaving')) return;
      const a = b.dataset.tuto;
      if (a === 'start') _show(1, 'next');
      else if (a === 'skip') skip();
      else if (a === 'back') _show(_step - 1, 'back');
      else if (a === 'next') (_step >= STEPS.length ? finish() : _show(_step + 1, 'next'));
    });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); skip(); } });
    return el;
  }

  function _render() {
    const el = _card();
    const n = STEPS.length;
    const btn = (a, label, cls = '') => `<button type="button" class="tuto-btn ${cls}" data-tuto="${a}">${_esc(label)}</button>`;
    if (_step === 0) {
      el.innerHTML = `<div class="tuto-head"><span class="tuto-icon" aria-hidden="true">⛏</span><h2 id="tuto-title">${_esc(_txt('tutorial.offer_title'))}</h2></div>`
        + `<p id="tuto-text" class="tuto-text">${_esc(_txt('tutorial.offer_text'))}</p>`
        + `<div class="tuto-actions">${btn('skip', t('tutorial.skip'), 'tuto-btn-ghost')}${btn('start', t('tutorial.start'), 'tuto-btn-main')}</div>`;
      return;
    }
    const s = STEPS[_step - 1];
    const dots = STEPS.map((_, i) => `<span class="tuto-dot${i < _step ? ' is-on' : ''}"></span>`).join('');
    el.innerHTML = `<div class="tuto-head"><span class="tuto-progress" aria-label="${_esc(t('tutorial.progress', { i: _step, n }))}">`
      + `<span aria-hidden="true">${_step}/${n}</span><span class="tuto-dots" aria-hidden="true">${dots}</span></span>`
      + `<h2 id="tuto-title" class="sr-only">${_esc(t('tutorial.title'))}</h2></div>`
      + `<p id="tuto-text" class="tuto-text" aria-live="polite">${_esc(_txt(`tutorial.steps.${s.id}`))}</p>`
      + `<div class="tuto-actions">${btn('skip', t('tutorial.skip'), 'tuto-btn-ghost')}`
      + (_step > 1 ? btn('back', t('tutorial.back'), 'tuto-btn-ghost') : '')
      + btn('next', _step >= n ? t('tutorial.finish') : t('tutorial.next'), 'tuto-btn-main') + '</div>';
  }

  /** Affiche l'étape i (0 = proposition). focusFrom : bouton à garder sous le doigt / le clavier. */
  function _show(i, focusFrom) {
    _pendingOffer = false;
    _step = Math.max(0, Math.min(i, STEPS.length));
    _ctx = {};
    if (_step > 0) { STEPS[_step - 1].start?.(_ctx); _record('started', _step); }
    _render();
    const el = _card();
    el.classList.remove('is-leaving');
    el.hidden = false;
    _ensureTimer();
    _tick();
    const keep = focusFrom && el.querySelector(`button[data-tuto="${focusFrom}"]`);
    if (keep) keep.focus({ preventScroll: true });
    else if (focusFrom !== false) (el.querySelector('.tuto-btn-main') || el).focus({ preventScroll: true });
  }

  /** Fermeture : la carte absorbe encore les appuis le temps du fondu (aucun clic involontaire dessous). */
  function _hide() {
    const el = $('tuto-card');
    _step = -1;
    _pendingOffer = false;
    _clearRings();
    _stopTimer();
    if (!el || el.hidden) return;
    el.classList.add('is-leaving');
    const had = el.contains(document.activeElement);
    setTimeout(() => { if (_step < 0) { el.hidden = true; el.classList.remove('is-leaving'); } }, 350);
    if (had) (document.getElementById('block') || document.body).focus?.({ preventScroll: true });
  }

  function start(i = 1) { _show(i); }
  function skip()   { _record('skipped', Math.max(0, _step)); _hide(); }
  function finish() { _record('done', STEPS.length); _hide(); }
  /** Depuis l'Aide : reprend à l'étape atteinte, ou recommence. */
  function resume()  { _show(_rec && _rec.state !== 'done' ? Math.max(1, Math.min(_rec.step, STEPS.length)) : 1); }
  function restart() { _show(1); }

  // ── Cadres et placement ─────────────────────────────────────────────────────

  /** « sélecteur » ou « sélecteur@ancêtre » (le cadre entoure l'ancêtre le plus proche). */
  function _resolve(sel) {
    const [q, up] = sel.split('@');
    let el = document.querySelector(q);
    if (el && up) el = el.closest(up);
    return el && el.getClientRects().length ? el : null;
  }

  function _clearRings() { _rings.forEach(r => r.remove()); _rings = []; }

  function _placeRings(targets) {
    while (_rings.length < targets.length) {
      const r = document.createElement('div');
      r.className = 'tuto-ring';
      r.setAttribute('aria-hidden', 'true');
      document.body.appendChild(r);
      _rings.push(r);
    }
    _rings.forEach((r, i) => {
      const el = targets[i];
      if (!el) { r.hidden = true; return; }
      const b = el.getBoundingClientRect(), pad = 4;
      r.hidden = false;
      r.style.left = `${Math.round(b.left - pad)}px`;
      r.style.top = `${Math.round(b.top - pad)}px`;
      r.style.width = `${Math.round(b.width + 2 * pad)}px`;
      r.style.height = `${Math.round(b.height + 2 * pad)}px`;
    });
  }

  /** Zone visée cachée sous l'en-tête ou la barre du bas : amenée au centre, une fois par étape. */
  function _reveal(el) {
    const r = el.getBoundingClientRect();
    const top = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    const nav = document.getElementById('bottom-nav')?.getBoundingClientRect();
    const bottom = nav && nav.top > window.innerHeight / 2 ? nav.top : window.innerHeight;
    if (r.top >= top && r.bottom <= bottom) return;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }

  /** Carte sous la zone visée s'il y a la place, sinon au-dessus, sinon en haut de l'écran. */
  function _placeCard(anchor) {
    const el = $('tuto-card');
    const vw = window.innerWidth, vh = window.innerHeight, m = 8;
    const nav = document.getElementById('bottom-nav')?.getBoundingClientRect();
    const bottomLimit = (nav && nav.top > vh / 2 ? nav.top : vh) - m;
    const w = Math.min(360, vw - 2 * m);
    el.style.width = `${w}px`;
    el.style.left = `${Math.round((vw - w) / 2)}px`;
    const h = el.offsetHeight;
    const header = document.querySelector('header')?.getBoundingClientRect();
    const topLimit = Math.max(m, header ? header.bottom + m : m);
    let top;
    if (!anchor) top = bottomLimit - h;
    else {
      const r = anchor.getBoundingClientRect();
      if (r.bottom + 10 + h <= bottomLimit) top = r.bottom + 10;
      else if (r.top - 10 - h >= topLimit) top = r.top - 10 - h;
      else top = r.top + r.height / 2 > vh / 2 ? topLimit : bottomLimit - h;
    }
    el.style.top = `${Math.round(Math.max(m, Math.min(top, vh - h - m)))}px`;
  }

  function _tick() {
    if (_pendingOffer) {
      if (_blocked() || !_viewActive('dig')) return;
      _show(0);
      return;
    }
    const el = $('tuto-card');
    if (_step < 0 || !el) return;
    const hide = _blocked();
    el.classList.toggle('is-behind', hide);
    if (hide) { _rings.forEach(r => { r.hidden = true; }); return; }
    if (_step === 0) { _clearRings(); _placeCard(null); return; }
    const s = STEPS[_step - 1];
    if (s.done && s.done(_ctx)) { _show(_step + 1, document.activeElement && el.contains(document.activeElement) ? 'next' : false); return; }
    const targets = s.targets.map(_resolve);
    const visible = targets.filter(Boolean);
    if (visible[0] && !_ctx.scrolled) { _ctx.scrolled = true; _reveal(visible[0]); }
    _placeRings(visible);
    _placeCard(visible[0] || null);
  }

  function _ensureTimer() {
    if (_timer) return;
    _timer = setInterval(_tick, TICK_MS);
    window.addEventListener('resize', _tick);
    window.addEventListener('scroll', _tick, true);
  }
  function _stopTimer() {
    clearInterval(_timer);
    _timer = null;
    window.removeEventListener('resize', _tick);
    window.removeEventListener('scroll', _tick, true);
  }

  // ── Entrée dans l'Aide (#78) ────────────────────────────────────────────────

  /** Bloc HTML de la fiche Aide : lancer, reprendre ou recommencer. */
  function helpEntryHtml() {
    const r = _rec || _readLocal();
    const canResume = r && r.state !== 'done' && r.step > 1 && r.step <= STEPS.length;
    const b = (a, label, cls) => `<button type="button" class="tuto-help-btn ${cls}" data-tuto-help="${a}">${_esc(label)}</button>`;
    return `<div class="tuto-help" role="group" aria-labelledby="tuto-help-title">`
      + `<p id="tuto-help-title" class="tuto-help-title"><span aria-hidden="true">🎓</span> ${_esc(_txt('tutorial.help_title'))}</p>`
      + `<div class="tuto-help-actions">`
      + (canResume ? b('resume', t('tutorial.help_resume', { i: r.step, n: STEPS.length }), 'is-main') + b('restart', t('tutorial.help_restart'), '')
        : b('restart', r ? t('tutorial.help_restart') : t('tutorial.help_start'), 'is-main'))
      + `</div></div>`;
  }

  /** Clic dans la fiche Aide : la fiche se ferme, le tutoriel démarre sur l'écran du joueur. */
  function onHelpClick(e, closeHelp) {
    const b = e.target.closest?.('[data-tuto-help]');
    if (!b) return false;
    closeHelp?.();
    if (b.dataset.tutoHelp === 'resume') resume(); else restart();
    return true;
  }

  const state = () => (_rec ? { ..._rec } : null);
  const isActive = () => _step >= 0;

  return { boot, onAccount, onLogout, start, skip, finish, resume, restart, helpEntryHtml, onHelpClick, state, isActive, STEPS, VERSION, KEY };
})();
