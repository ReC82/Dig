/**
 * news.js — Centre d'actualités (#50) : cloche à gauche du logo, panneau « À venir » /
 * « Dernières actualités ».
 *
 * - Annonces publiques servies par GET /api/news (mêmes pour tous) ; distinct de l'historique
 *   personnel des notifications (#26, Paramètres).
 * - Pastille = annonces publiées depuis la dernière ouverture du panneau : par compte (serveur)
 *   pour un joueur connecté, dans le navigateur pour un invité.
 * - Le panneau s'ouvre par-dessus le jeu sans l'interrompre (le minage automatique continue) ;
 *   fermeture : ✕, Échap ou clic à côté.
 * - Textes affichés dans la langue du joueur (français à défaut), dates dans son fuseau horaire.
 *   Tout passe par textContent : aucun HTML venant du serveur n'est interprété.
 * - Lien Discord seulement s'il est configuré dans le panel (jamais d'adresse inventée), en tête du
 *   panneau, ouvert dans un nouvel onglet : le jeu (et le minage) reste dans le sien. Jamais obligatoire.
 * - Mentions publiques : case visible seulement si l'admin a activé les faits joueurs ; décochée
 *   par défaut (accord explicite), retirable à tout moment.
 */
const DigNews = (() => {
  const SEEN_KEY = 'dig_news_seen';
  const POLL_MS  = 10 * 60_000;
  let _data = null;
  let _loading = null;
  let _lastFocus = null;
  let _seenBefore;          // date « lu jusqu'à » au moment de l'ouverture (repère « Nouveau »)

  const $ = id => document.getElementById(id);
  const _ls = {
    get() { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(SEEN_KEY, v); } catch { /* stockage indisponible */ } },
  };

  // Même règle que le serveur (server/beta.js) : une adresse non conforme n'est jamais affichée.
  const DISCORD_RE = /^https:\/\/(?:discord\.gg|(?:www\.)?discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]{2,64}$/;
  /** Invitation Discord configurée dans le panel (Actualités, sinon configuration bêta), ou null. */
  function discordUrl(v) {
    if (v === undefined) v = _data?.discordUrl ?? (typeof DigBeta !== 'undefined' ? DigBeta.discordUrl() : null);
    return typeof v === 'string' && DISCORD_RE.test(v) ? v : null;
  }

  const _txt = obj => (obj && (obj[I18n.getCurrent()] || obj.fr)) || '';
  const _logged = () => !!_data && typeof _data.unread === 'number';
  const _seenAt = () => (_logged() ? _data.seenAt : _ls.get());

  function _unread() {
    if (!_data) return 0;
    if (_logged()) return _data.unread;
    const seen = _ls.get();
    return [..._data.upcoming, ..._data.latest].filter(i => !seen || i.publishAt > seen).length;
  }

  function _renderBadge() {
    const b = $('news-badge');
    const btn = $('btn-news');
    if (!b || !btn) return;
    const n = _unread();
    b.hidden = n === 0;
    b.textContent = n > 9 ? '9+' : String(n);
    const label = n ? `${t('news.title')} — ${t('news.unread', { n })}` : t('news.title');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  async function refresh() {
    if (_loading) return _loading;
    _loading = (async () => {
      try {
        const r = await fetch('/api/news', { cache: 'no-store', credentials: 'same-origin' });
        if (r.ok) _data = await r.json();
      } catch { /* hors ligne : on garde la dernière liste */ }
      _renderBadge();
      if (!$('news-panel')?.hidden) _renderPanel();
    })();
    try { await _loading; } finally { _loading = null; }
  }

  function _fmtDate(isoStr) {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return '';
    const locale = I18n.intl ? I18n.intl() : undefined; // registre des langues (#59)
    try { return d.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return d.toLocaleString(); }
  }

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function _item(it, upcoming) {
    const li = _el('li', 'news-item');
    const isNew = !upcoming && _seenBefore !== undefined && (!_seenBefore || it.publishAt > _seenBefore);
    if (isNew) li.classList.add('is-new');
    li.appendChild(_el('span', 'news-item-icon', it.icon || '📰')).setAttribute('aria-hidden', 'true');
    const title = _el('div', 'news-item-title', _txt(it.titles));
    if (isNew) title.appendChild(_el('span', 'news-item-new', t('news.new')));
    li.appendChild(title);
    const meta = upcoming && it.eventAt ? `📅 ${_fmtDate(it.eventAt)}` : _fmtDate(it.publishAt);
    li.appendChild(_el('div', 'news-item-meta', meta));
    const sum = _txt(it.summaries);
    if (sum) li.appendChild(_el('p', 'news-item-sum', sum));
    const body = _txt(it.bodies);
    if (body) {
      const det = _el('details');
      det.appendChild(_el('summary', null, t('news.read_more')));
      const wrap = _el('div', 'news-item-body');
      for (const para of body.split(/\n{2,}/)) if (para.trim()) wrap.appendChild(_el('p', null, para.trim()));
      det.appendChild(wrap);
      li.appendChild(det);
    }
    if (it.link?.url && /^https:\/\//.test(it.link.url)) {
      const a = _el('a', 'news-item-link', `${_txt(it.link.labels) || t('news.open_link')} ↗`);
      a.href = it.link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
    }
    return li;
  }

  function _section(titleKey, items, upcoming) {
    const frag = document.createDocumentFragment();
    frag.appendChild(_el('h3', 'news-section-title', t(titleKey)));
    if (!items.length) {
      frag.appendChild(_el('p', 'news-empty', t(upcoming ? 'news.empty_upcoming' : 'news.empty_latest')));
      return frag;
    }
    const ul = _el('ul', 'news-list');
    for (const it of items) ul.appendChild(_item(it, upcoming));
    frag.appendChild(ul);
    return frag;
  }

  function _renderPanel() {
    const body = $('news-body');
    if (!body) return;
    body.textContent = '';
    if (!_data) {
      body.appendChild(_el('p', 'news-empty', t('news.offline')));
      return;
    }
    // Discord en tête (#50, 07/11) : trouvable sans faire défiler, facultatif, nouvel onglet.
    const discord = discordUrl(_data.discordUrl);
    if (discord) {
      const box = _el('div', 'news-community');
      const a = _el('a', 'news-discord', t('news.discord'));
      a.href = discord;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', `${t('news.discord')} — ${t('news.discord_aria')}`);
      box.append(a, _el('p', 'news-discord-hint', t('news.discord_hint')));
      body.appendChild(box);
    }
    body.appendChild(_section('news.upcoming', _data.upcoming, true));
    body.appendChild(_section('news.latest', _data.latest, false));
    const foot = _el('div', 'news-foot');
    if (_data.mentions && _logged() && _data.prefs) {
      const label = _el('label', 'news-mentions');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!_data.prefs.publicMentions;
      box.addEventListener('change', async () => {
        box.disabled = true;
        try {
          const r = await fetch('/api/news/prefs', { method: 'PUT', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicMentions: box.checked }) });
          if (r.ok) _data.prefs = (await r.json()).prefs;
          else box.checked = !box.checked;
        } catch { box.checked = !box.checked; }
        box.disabled = false;
      });
      label.append(box, _el('span', null, t('news.mentions')));
      foot.appendChild(label);
    }
    if (foot.childNodes.length) body.appendChild(foot);
  }

  function _markSeen() {
    if (!_data) return;
    const now = _data.serverTime || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    _ls.set(now);
    if (_logged()) {
      _data.unread = 0;
      _data.seenAt = now;
      fetch('/api/news/seen', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    }
    _renderBadge();
  }

  function _onKey(e) { if (e.key === 'Escape') close(); }

  async function open() {
    const panel = $('news-panel');
    if (!panel) return;
    _lastFocus = document.activeElement;
    _seenBefore = _seenAt();
    panel.hidden = false;
    $('btn-news')?.setAttribute('aria-expanded', 'true');
    _renderPanel();
    $('btn-news-close')?.focus();
    document.addEventListener('keydown', _onKey);
    await refresh();
    _markSeen();
  }

  function close() {
    const panel = $('news-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    $('btn-news')?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', _onKey);
    _seenBefore = undefined;
    if (_lastFocus && typeof _lastFocus.focus === 'function') _lastFocus.focus();
  }

  function init() {
    $('btn-news')?.addEventListener('click', open);
    $('btn-news-close')?.addEventListener('click', close);
    $('news-panel')?.addEventListener('click', e => { if (e.target.id === 'news-panel') close(); });
    I18n.onLangChange(() => { _renderBadge(); if (!$('news-panel')?.hidden) _renderPanel(); });
    refresh();
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
  }

  return { init, refresh, open, close, discordUrl };
})();
