/**
 * help.js — Aide du joueur (#78) : bouton ? en haut à gauche de l'en-tête, fiche « Comment jouer ? »
 * en rubriques repliables, et petits ? contextuels à côté des titres (Collection, Reliques…).
 *
 * - Source unique : chaque rubrique est une entrée de TOPICS ; ses textes sont les clés
 *   help.topics.<id>.* de i18n.js. La bulle d'un ? affiche le résumé (short) de la rubrique, la fiche
 *   affiche le même résumé suivi des précisions (more1, more2…) : aucun texte n'est écrit deux fois.
 * - Langues : celles du jeu (fr, en, nl, es, it…) ; texte absent → français, avec une mention
 *   explicite en tête de la fiche.
 * - Aucun effet sur la partie : ni sauvegarde, ni achat, ni changement d'onglet. La fiche et la bulle
 *   s'ouvrent par-dessus le jeu (qui continue de tourner) ; à la fermeture, le focus revient au bouton
 *   d'origine et l'écran est exactement celui de départ.
 * - ? contextuel : <button data-help="<id>"> (DigHelp.tipHtml) ; un clic délégué ouvre la bulle,
 *   utilisable au toucher sans survol, sans voile ni blocage du défilement ou des boutons du jeu.
 * - API pour le tutoriel (#79) : DigHelp.open(id) ouvre la fiche sur une rubrique.
 */
const DigHelp = (() => {
  /** Rubriques, dans l'ordre de la fiche. Les textes sont dans i18n.js (help.topics.<id>). */
  const GROUPS = [
    { id: 'basics',    topics: [['play', '⛏'], ['pickaxe', '🪓'], ['depth', '📏'], ['upgrades', '⚙'], ['autodig', '🤖']] },
    { id: 'resources', topics: [['coins', '💰'], ['gems', '💎'], ['fragments', '🔮'], ['boosts', '⚡']] },
    { id: 'finds',     topics: [['chests', '📦'], ['collection', '📿'], ['events', '🎉'], ['relics', '✨'], ['badges', '🏅']] },
    { id: 'season',    topics: [['season', '🗓'], ['ranking', '🏆'], ['leagues', '🎖'], ['points', '🎁']] },
    { id: 'daily',     topics: [['daily', '📅'], ['missions', '🎯']] },
  ];
  const FAQ = ['rank_depth', 'autodig_rank', 'season_end', 'save', 'other_device'];
  const TOPICS = Object.fromEntries(GROUPS.flatMap(g => g.topics.map(([id, icon]) => [id, { id, icon, group: g.id }])));
  const MORE_MAX = 4;

  const $ = id => document.getElementById(id);
  let _panelOpener = null;
  let _tipAnchor = null;
  let _tipOpener = null;

  const _esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s));
  /** Paramètres communs : libellés de boutons repris tels qu'affichés dans le jeu. */
  const _bare = s => String(s).replace(/^[^\p{L}\p{N}]+/u, '');   // « ℹ️ Récompenses… » → « Récompenses… »
  const _params = () => ({
    tab_upgrades: t('nav.upgrades'), tab_collection: t('nav.collection'), tab_daily: t('nav.daily'), tab_season: t('season.title'),
    btn_double: t('ui.btn_watch_ad'), btn_claim: t('ui.btn_mission_claim'), btn_odds: _bare(t('chest_odds.btn')),
    btn_here: t('ui.btn_play_here'),
  });
  const _txt = key => t(key, _params());
  /** true si la clé existe (langue courante ou repli français). */
  const _exists = key => (I18n.has(key) || I18n.has(key, 'fr'));
  const title = id => _txt(`help.topics.${id}.title`);
  const short = id => _txt(`help.topics.${id}.short`);
  function more(id) {
    const out = [];
    for (let i = 1; i <= MORE_MAX; i++) { const k = `help.topics.${id}.more${i}`; if (_exists(k)) out.push(_txt(k)); }
    return out;
  }

  /** Bouton ? à placer à côté d'un titre (chaîne HTML). */
  function tipHtml(id) {
    if (!TOPICS[id]) return '';
    const label = _esc(t('help.tip_aria', { topic: title(id) }));
    return `<button type="button" class="help-tip-btn" data-help="${id}" aria-label="${label}" title="${label}"`
      + ` aria-haspopup="dialog" aria-expanded="false" aria-controls="help-tip"><span aria-hidden="true">?</span></button>`;
  }

  /** Remet à jour les libellés des ? statiques (index.html) après un changement de langue. */
  function relabel() {
    document.querySelectorAll('.help-tip-btn[data-help]').forEach(b => {
      if (!TOPICS[b.dataset.help]) return;
      const label = t('help.tip_aria', { topic: title(b.dataset.help) });
      b.setAttribute('aria-label', label);
      b.title = label;
    });
  }

  // ── Bulle d'un ? contextuel ────────────────────────────────────────────────

  function _tipEl() {
    let el = $('help-tip');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'help-tip';
    el.className = 'help-tip';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-labelledby', 'help-tip-title');
    el.tabIndex = -1;
    document.body.appendChild(el);
    el.addEventListener('click', e => {
      if (e.target.closest('[data-help-close]')) closeTip(true);
      const go = e.target.closest('[data-help-more]');
      if (go) { const opener = _tipOpener; closeTip(false); open(go.dataset.helpMore, opener); }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeTip(true); } });
    return el;
  }

  function openTip(id, anchor) {
    if (!TOPICS[id]) return;
    const el = _tipEl();
    if (!el.hidden && _tipAnchor === anchor) { closeTip(true); return; }   // second appui : referme
    if (!el.hidden) closeTip(false);
    const t0 = TOPICS[id];
    el.innerHTML = `<div class="help-tip-head"><h2 id="help-tip-title"><span aria-hidden="true">${t0.icon}</span> ${_esc(title(id))}</h2>`
      + `<button type="button" class="help-tip-close" data-help-close aria-label="${_esc(t('help.close'))}">✕</button></div>`
      + `<p class="help-tip-text">${_esc(short(id))}</p>`
      + `<button type="button" class="help-tip-more" data-help-more="${id}">${_esc(t('help.more'))} ›</button>`;
    el.dataset.topic = id;
    el.hidden = false;
    _tipAnchor = anchor;
    _tipOpener = anchor;
    anchor?.setAttribute('aria-expanded', 'true');
    _placeTip();
    el.focus({ preventScroll: true });
    document.addEventListener('pointerdown', _onOutside, true);
    window.addEventListener('scroll', _placeTip, true);
    window.addEventListener('resize', _placeTip);
  }

  function closeTip(restoreFocus) {
    const el = $('help-tip');
    if (!el || el.hidden) return;
    el.hidden = true;
    document.removeEventListener('pointerdown', _onOutside, true);
    window.removeEventListener('scroll', _placeTip, true);
    window.removeEventListener('resize', _placeTip);
    const a = _tipAnchor;
    _tipAnchor = null;
    if (a) a.setAttribute('aria-expanded', 'false');
    if (restoreFocus && a && a.isConnected) a.focus({ preventScroll: true });
  }

  /** Clic ou toucher à côté : referme sans bloquer l'action (le coup sur le bloc part normalement). */
  function _onOutside(e) {
    const el = $('help-tip');
    if (!el || el.contains(e.target) || (_tipAnchor && _tipAnchor.contains(e.target))) return;
    closeTip(false);
  }

  /** Place la bulle sous le ? (au-dessus s'il n'y a pas la place), dans l'écran. */
  function _placeTip() {
    const el = $('help-tip');
    if (!el || el.hidden) return;
    let a = _tipAnchor;
    if (a && !a.isConnected) {   // vue re-rendue (Saison, Collection…) : même ? retrouvé, sinon fermeture
      a = [...document.querySelectorAll(`.help-tip-btn[data-help="${el.dataset.topic}"]`)].find(b => b.offsetParent);
      _tipAnchor = a || null;
      if (a) a.setAttribute('aria-expanded', 'true');
    }
    if (!a || !a.offsetParent) { closeTip(false); return; }
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight, m = 8;
    const w = Math.min(320, vw - 2 * m);
    el.style.width = `${w}px`;
    const h = el.offsetHeight;
    let left = Math.round(r.left + r.width / 2 - w / 2);
    left = Math.max(m, Math.min(left, vw - w - m));
    let top = Math.round(r.bottom + 6);
    if (top + h > vh - m && r.top - 6 - h >= m) top = Math.round(r.top - 6 - h);
    top = Math.max(m, Math.min(top, vh - h - m));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  // ── Fiche Aide ──────────────────────────────────────────────────────────────

  function _topicHtml(id) {
    const tp = TOPICS[id];
    const extra = more(id);
    return `<details class="help-topic" id="help-topic-${id}" data-topic="${id}">`
      + `<summary><span class="help-topic-icon" aria-hidden="true">${tp.icon}</span><span>${_esc(title(id))}</span></summary>`
      + `<div class="help-topic-body"><p>${_esc(short(id))}</p>`
      + (extra.length ? `<ul>${extra.map(x => `<li>${_esc(x)}</li>`).join('')}</ul>` : '')
      + `</div></details>`;
  }

  function _renderPanel() {
    const body = $('help-body');
    if (!body) return;
    const lang = I18n.getCurrent();
    const translated = lang === 'fr' || I18n.has('help.topics.play.short', lang);
    const steps = [1, 2, 3, 4].map(i => `<li>${_esc(_txt(`help.intro.step${i}`))}</li>`).join('');
    body.innerHTML = (translated ? '' : `<p class="help-fallback" role="note">${_esc(t('help.fallback'))}</p>`)
      + `<section class="help-intro" aria-labelledby="help-intro-title"><h3 id="help-intro-title">${_esc(t('help.intro.title'))}</h3>`
      + `<ol class="help-steps">${steps}</ol></section>`
      + GROUPS.map(g => `<section class="help-group" aria-labelledby="help-group-${g.id}">`
        + `<h3 class="help-group-title" id="help-group-${g.id}">${_esc(t(`help.groups.${g.id}`))}</h3>`
        + g.topics.map(([id]) => _topicHtml(id)).join('') + '</section>').join('')
      + `<section class="help-group" aria-labelledby="help-group-faq"><h3 class="help-group-title" id="help-group-faq">${_esc(t('help.groups.faq'))}</h3>`
      + FAQ.map(f => `<details class="help-topic help-faq" id="help-faq-${f}"><summary><span>${_esc(_txt(`help.faq.${f}.q`))}</span></summary>`
        + `<div class="help-topic-body"><p>${_esc(_txt(`help.faq.${f}.a`))}</p></div></details>`).join('')
      + '</section>'
      + `<p class="help-footer">${_esc(t('help.footer'))}</p>`;
  }

  /** Une seule rubrique ouverte à la fois : la fiche reste courte. Au clic (souris, toucher, Entrée,
   *  Espace) sur un titre fermé, les autres se replient avant l'ouverture — sans attendre l'événement
   *  « toggle », asynchrone. */
  function _onSummary(e) {
    const s = e.target.closest?.('summary');
    const d = s && s.parentElement;
    if (!d || !d.classList.contains('help-topic') || d.open) return;
    $('help-body')?.querySelectorAll('details.help-topic[open]').forEach(o => { if (o !== d) o.open = false; });
  }

  function open(topicId, opener) {
    const panel = $('help-panel');
    if (!panel) return;
    closeTip(false);
    _panelOpener = opener || document.activeElement;
    _renderPanel();
    panel.hidden = false;
    $('btn-help')?.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', _onKey);
    const d = topicId && (TOPICS[topicId] ? $(`help-topic-${topicId}`) : $(`help-faq-${topicId}`));
    if (d) {
      d.open = true;
      d.scrollIntoView({ block: 'start' });
      d.querySelector('summary')?.focus({ preventScroll: true });
    } else {
      $('help-panel-inner').scrollTop = 0;
      $('btn-help-close')?.focus({ preventScroll: true });
    }
  }

  function close() {
    const panel = $('help-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    $('btn-help')?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', _onKey);
    const o = _panelOpener;
    _panelOpener = null;
    if (o && o.isConnected && typeof o.focus === 'function') o.focus({ preventScroll: true });
  }

  const isOpen = () => !!$('help-panel') && !$('help-panel').hidden;

  /** Échap ferme ; Tab reste dans la fiche (fenêtre modale). */
  function _onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const inner = $('help-panel-inner');
    const f = [...inner.querySelectorAll('button, summary, a[href]')].filter(x => x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !inner.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function init() {
    $('btn-help')?.addEventListener('click', () => (isOpen() ? close() : open(null, $('btn-help'))));
    $('btn-help-close')?.addEventListener('click', close);
    $('help-panel')?.addEventListener('click', e => { if (e.target.id === 'help-panel') close(); });
    $('help-body')?.addEventListener('click', _onSummary);
    document.addEventListener('click', e => {
      const b = e.target.closest?.('.help-tip-btn[data-help]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();   // le ? peut être dans un résumé repliable : il ne doit pas le replier
      openTip(b.dataset.help, b);
    });
    relabel();
    I18n.onLangChange(() => {
      relabel();
      if (isOpen()) {
        const openId = $('help-body')?.querySelector('details[open]')?.dataset.topic;
        _renderPanel();
        if (openId) $(`help-topic-${openId}`).open = true;
      }
      const tip = $('help-tip');
      if (tip && !tip.hidden) { const a = _tipAnchor; closeTip(false); if (a) openTip(tip.dataset.topic, a); }
    });
  }

  return { init, open, close, isOpen, openTip, closeTip, tipHtml, relabel, TOPICS, GROUPS, FAQ, MORE_MAX };
})();
