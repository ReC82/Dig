/**
 * beta.js — Bêta fermée (#57) : bandeau, section « Bêta » des paramètres, signalement de bug,
 * code d'invitation.
 *
 * - Rien ne s'affiche tant que l'admin n'a rien activé (GET /api/beta/config) : par défaut la page
 *   n'est pas modifiée.
 * - Le lien Discord n'apparaît que s'il est configuré dans le panel (jamais d'adresse inventée).
 * - Signalement : texte du joueur ; les informations techniques ne partent que si la case est
 *   cochée, et leur contenu exact est visible avant l'envoi. Aucune capture n'est prise.
 * - Lien d'invitation `/?invite=DIG-XXXX-XXXX` : le code est retiré de l'adresse, gardé pour la
 *   session et envoyé tout seul avec l'inscription. L'invité ne voit jamais le mot « code » : un
 *   lien valable affiche un mot d'accueil, un lien périmé un message clair (recette du 03/11).
 */
const DigBeta = (() => {
  const INVITE_KEY = 'dig_invite';
  const HIDE_KEY   = 'dig_beta_banner_hidden';
  let _config = null;
  let _mine   = null;   // signalements du joueur connecté (null = non chargés)
  let _lastReport = null;
  let _inviteState = null;   // état du lien reçu : active, used, expired, revoked, invalid, closed

  const _ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  };

  function _captureInvite() {
    const params = new URLSearchParams(location.search);
    const code = params.get('invite');
    if (!code) return;
    _ss.set(INVITE_KEY, code.slice(0, 20));
    params.delete('invite');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash);
  }

  /** Code d'invitation reçu par lien (ou null). */
  function pendingInvite() { return _ss.get(INVITE_KEY); }

  /** Lien d'invitation reçu et encore valable : le code part seul, sans champ à remplir. */
  function inviteAccepted() { return !!pendingInvite() && _inviteState === 'active'; }

  /** Oublie le lien (compte créé, ou lien refusé par le serveur). */
  function clearInvite() {
    try { sessionStorage.removeItem(INVITE_KEY); } catch { /* stockage indisponible */ }
    _inviteState = null;
  }

  /** Faut-il afficher le champ « code d'invitation » à l'inscription (mode invitation, sans lien valable) ? */
  function showInviteField() { return _config?.registration === 'invite' && !inviteAccepted(); }

  /**
   * Message au-dessus du formulaire d'inscription : accueil de l'invité, ou explication d'un lien
   * qui ne marche plus (une seule action : demander un nouveau lien). Chaîne vide sinon.
   */
  function inviteNoticeHtml() {
    if (!_inviteState) return '';
    if (_inviteState === 'active') return `<p class="beta-invite beta-invite--ok" role="status">${t('beta.invite_welcome')}</p>`;
    const key = _inviteState === 'closed' ? 'beta.err_closed' : 'beta.invite_dead';
    return `<p class="beta-invite beta-invite--bad" role="alert">${t(key)}</p>`;
  }

  /**
   * Lien reçu inutilisable alors qu'aucune inscription libre n'est possible : le formulaire ne
   * servirait à rien, seul le message (et « J'ai déjà un compte ») est affiché.
   */
  function inviteBlocked() {
    return !!_inviteState && _inviteState !== 'active' && registrationMode() !== 'open';
  }

  /** Message clair pour un refus d'inscription lié à la bêta (code renvoyé par le serveur), sinon null. */
  function registerError(code) {
    if (code === 'invite_invalid') {
      if (pendingInvite()) _inviteState = 'used';
      return t(pendingInvite() ? 'beta.invite_dead' : 'beta.err_invite_invalid');
    }
    if (code === 'invite_required') return t('beta.err_invite_required');
    if (code === 'registration_closed') return t('beta.err_closed');
    return null;
  }

  async function _checkInvite() {
    const code = pendingInvite();
    if (!code) return;
    try {
      const r = await fetch(`/api/beta/invite/${encodeURIComponent(code)}`, { cache: 'no-store' });
      if (r.ok) _inviteState = (await r.json()).state;
    } catch { /* hors ligne : le serveur tranchera à l'inscription */ }
    // Inscription ouverte à tous : un lien périmé n'empêche rien, inutile d'inquiéter l'invité.
    if (_inviteState !== 'active' && _inviteState !== 'closed' && _config?.registration === 'open') clearInvite();
  }

  function registrationMode() { return _config?.registration || 'open'; }

  function _diagnostics() {
    const view = document.querySelector('.view:not(.hidden)')?.id?.replace(/^view-/, '') || '';
    return {
      version:    window.APP_VERSION || '',
      userAgent:  navigator.userAgent,
      viewport:   `${window.innerWidth}x${window.innerHeight}`,
      screen:     `${screen.width}x${screen.height}`,
      language:   I18n.getCurrent(),
      view,
      online:     String(navigator.onLine),
      standalone: String(window.matchMedia?.('(display-mode: standalone)').matches || false),
      page:       location.pathname,
    };
  }

  function _deviceGuess() {
    const ua = navigator.userAgent;
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
      : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
    const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
      : /Safari\//.test(ua) ? 'Safari' : '';
    return [os, br].filter(Boolean).join(' · ');
  }

  // ── Bandeau ────────────────────────────────────────────────────────────────

  function _renderBanner() {
    document.getElementById('beta-banner')?.remove();
    if (!_config?.banner || _ss.get(HIDE_KEY) === '1') return;
    const bar = document.createElement('div');
    bar.id = 'beta-banner';
    bar.setAttribute('role', 'note');
    const label = document.createElement('span');
    label.className = 'beta-banner-label';
    label.textContent = t('beta.banner');
    bar.appendChild(label);
    if (_config.reports) {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'beta-banner-btn'; btn.textContent = t('beta.banner_report');
      btn.addEventListener('click', openReport);
      bar.appendChild(btn);
    }
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'beta-banner-close'; close.textContent = '×';
    close.setAttribute('aria-label', t('beta.banner_close')); close.title = t('beta.banner_close');
    close.addEventListener('click', () => { _ss.set(HIDE_KEY, '1'); bar.remove(); });
    bar.appendChild(close);
    document.querySelector('header')?.after(bar);
  }

  // ── Paramètres ─────────────────────────────────────────────────────────────

  function _active() { return !!(_config && (_config.banner || _config.discordUrl)); }

  function settingsSectionHtml() {
    if (!_active()) return '';
    const policy = _config.resetPolicy || t('beta.policy_default');
    const known = _config.knownIssues
      ? `<div class="beta-known"><div class="beta-known-title">${escapeHtml(t('beta.known_title'))}</div>
           <p class="beta-text">${escapeHtml(_config.knownIssues)}</p></div>` : '';
    const discord = _config.discordUrl
      ? `<a class="beta-discord-btn" href="${escapeHtml(_config.discordUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('beta.discord'))}</a>` : '';
    const report = _config.reports
      ? `<button type="button" class="beta-report-btn" id="btn-beta-report">${escapeHtml(t('beta.report'))}</button>` : '';
    return `<div class="settings-section settings-section-beta">
      <div class="settings-section-label">${escapeHtml(t('beta.section'))}</div>
      <p class="beta-text">${escapeHtml(policy)}</p>
      ${known}
      <p class="beta-version">${escapeHtml(t('beta.version', { v: window.APP_VERSION || '—' }))}</p>
      <div class="beta-actions">${report}${discord}</div>
      <div id="beta-mine"></div>
    </div>`;
  }

  function _mineHtml() {
    if (!_mine) return '';
    const rows = _mine.length
      ? _mine.map(r => {
          const link = r.githubUrl ? ` · <a href="${escapeHtml(r.githubUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('beta.issue_link'))}</a>` : '';
          return `<li><span class="beta-mine-status beta-mine-status--${escapeHtml(r.status)}">${escapeHtml(t(`beta.status_${r.status}`))}</span>
            n°${escapeHtml(r.id)} — ${escapeHtml(r.observed.slice(0, 80))}${link}</li>`;
        }).join('')
      : `<li class="beta-mine-empty">${escapeHtml(t('beta.mine_empty'))}</li>`;
    return `<div class="beta-known-title">${escapeHtml(t('beta.mine_title'))}</div><ul class="beta-mine">${rows}</ul>`;
  }

  async function _loadMine(loggedIn) {
    const box = document.getElementById('beta-mine');
    if (!box || !loggedIn) return;
    try {
      const r = await fetch('/api/beta/reports/mine', { cache: 'no-store' });
      if (!r.ok) return;
      _mine = (await r.json()).reports;
      const el = document.getElementById('beta-mine');
      if (el) el.innerHTML = _mineHtml();
    } catch { /* hors ligne : liste masquée */ }
  }

  function bindSettings(container, loggedIn) {
    container.querySelector('#btn-beta-report')?.addEventListener('click', openReport);
    _loadMine(loggedIn);
  }

  // ── Fenêtre de signalement ─────────────────────────────────────────────────

  function _discordText(f, id) {
    return [
      `🐞 Bug${id ? ` n°${id}` : ''} — DIG! ${window.APP_VERSION || ''}`,
      `Appareil : ${f.device || '—'}`,
      `Étape : ${f.step || '—'}`,
      `Attendu : ${f.expected || '—'}`,
      `Constaté : ${f.observed}`,
      'Capture : (à joindre ici)',
    ].join('\n');
  }

  // Brouillon du signalement en cours : en mémoire de la page seulement (rien dans le stockage du
  // navigateur ni sur le serveur), effacé à l'envoi réussi ou sur « Abandonner » (recette du 03/11).
  let _draft = null;
  const DRAFT_FIELDS = ['beta-step', 'beta-expected', 'beta-observed', 'beta-device'];

  /** `prefill.step` (#84) : texte de départ du champ « ce que tu faisais », sauf brouillon en cours. */
  function openReport(prefill) {
    if (!_config?.reports) return;
    document.getElementById('beta-report-modal')?.remove();
    const diag = _diagnostics();
    const modal = document.createElement('div');
    modal.id = 'beta-report-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'beta-report-title');
    const field = (id, key, rows) => `<label class="beta-field" for="${id}">${escapeHtml(t(key))}
        <textarea id="${id}" rows="${rows}" maxlength="1000"></textarea></label>`;
    modal.innerHTML = `<form id="beta-report-inner" novalidate>
      <div class="beta-report-head">
        <h2 id="beta-report-title">${escapeHtml(t('beta.modal_title'))}</h2>
        <button type="button" class="beta-report-x" id="btn-beta-x" aria-label="${escapeHtml(t('beta.cancel'))}" title="${escapeHtml(t('beta.cancel'))}">✕</button>
      </div>
      <p class="beta-text">${escapeHtml(t('beta.modal_intro'))}</p>
      ${field('beta-step', 'beta.field_step', 2)}
      ${field('beta-expected', 'beta.field_expected', 2)}
      ${field('beta-observed', 'beta.field_observed', 3)}
      <label class="beta-field" for="beta-device">${escapeHtml(t('beta.field_device'))}
        <input id="beta-device" type="text" maxlength="200"></label>
      <label class="beta-check"><input type="checkbox" id="beta-diag"> ${escapeHtml(t('beta.diag_label'))}</label>
      <details class="beta-diag-preview"><summary>${escapeHtml(t('beta.diag_preview'))}</summary>
        <pre>${escapeHtml(JSON.stringify(diag, null, 2))}</pre></details>
      <p class="beta-msg" id="beta-report-msg" role="status"></p>
      <div class="beta-actions">
        <button type="submit" class="beta-report-btn" id="btn-beta-send">${escapeHtml(t('beta.send'))}</button>
        <button type="button" class="beta-ghost-btn" id="btn-beta-copy" hidden>${escapeHtml(t('beta.copy'))}</button>
        ${_config.discordUrl ? `<a class="beta-discord-btn" href="${escapeHtml(_config.discordUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t('beta.discord'))}</a>` : ''}
        <button type="button" class="beta-ghost-btn" id="btn-beta-cancel">${escapeHtml(t('beta.cancel'))}</button>
      </div>
      <div class="beta-confirm" id="beta-confirm" role="alertdialog" aria-labelledby="beta-confirm-text" hidden>
        <p id="beta-confirm-text">${escapeHtml(t('beta.confirm_close'))}</p>
        <div class="beta-actions">
          <button type="button" class="beta-report-btn" id="btn-beta-keep">${escapeHtml(t('beta.keep_writing'))}</button>
          <button type="button" class="beta-ghost-btn" id="btn-beta-discard">${escapeHtml(t('beta.discard'))}</button>
        </div>
      </div>
    </form>`;
    document.body.appendChild(modal);
    const $ = id => modal.querySelector(`#${id}`);

    // Reprise du brouillon (même onglet) ; sinon formulaire vide avec l'appareil deviné.
    const initialDevice = _deviceGuess();
    for (const id of DRAFT_FIELDS) $(id).value = _draft?.[id] ?? (id === 'beta-device' ? initialDevice : '');
    const initialStep = !_draft && typeof prefill?.step === 'string' ? prefill.step.slice(0, 1000) : '';
    if (initialStep) $('beta-step').value = initialStep;
    $('beta-diag').checked = !!_draft?.diag;
    let sent = false;
    const dirty = () => !sent && DRAFT_FIELDS.some(id => $(id).value.trim() !== (id === 'beta-device' ? initialDevice : id === 'beta-step' ? initialStep : ''));
    const saveDraft = () => {
      if (sent) return;
      _draft = dirty() ? Object.fromEntries([...DRAFT_FIELDS.map(id => [id, $(id).value]), ['diag', $('beta-diag').checked]]) : null;
    };
    modal.addEventListener('input', saveDraft);
    modal.addEventListener('change', saveDraft);

    const confirmBox = $('beta-confirm');
    const askClose = () => {
      if (!dirty()) { _draft = null; modal.remove(); return; }
      if (!confirmBox.hidden) return;
      confirmBox.hidden = false;
      $('btn-beta-keep').focus();
    };
    const keepWriting = () => { confirmBox.hidden = true; ($('beta-observed').value ? $('beta-observed') : $('beta-step')).focus(); };
    $('btn-beta-keep').addEventListener('click', keepWriting);
    $('btn-beta-discard').addEventListener('click', () => { _draft = null; modal.remove(); });
    $('btn-beta-cancel').addEventListener('click', askClose);
    $('btn-beta-x').addEventListener('click', askClose);
    // Fond : seul un clic commencé ET terminé sur le fond compte (une sélection de texte qui
    // déborde de la fenêtre ne ferme rien).
    let downOnBackdrop = false;
    modal.addEventListener('pointerdown', e => { downOnBackdrop = e.target === modal; });
    modal.addEventListener('click', e => { if (e.target === modal && downOnBackdrop) askClose(); downOnBackdrop = false; });
    modal.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (!confirmBox.hidden) keepWriting(); else askClose();
    });
    $('beta-step').focus();

    const msg = (text, ok) => { const m = $('beta-report-msg'); m.textContent = text; m.className = `beta-msg ${ok ? 'is-ok' : 'is-err'}`; };
    $('btn-beta-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(_lastReport); msg(t('beta.copied'), true); }
      catch { msg(_lastReport, true); }   // presse-papiers refusé : texte affiché à recopier
    });
    $('beta-report-inner').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = {
        step: $('beta-step').value.trim(), expected: $('beta-expected').value.trim(),
        observed: $('beta-observed').value.trim(), device: $('beta-device').value.trim(),
      };
      if (f.observed.length < 5) return msg(t('beta.err_short'), false);
      const send = $('btn-beta-send');
      send.disabled = true;
      try {
        const res = await fetch('/api/beta/reports', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...f, includeDiagnostics: $('beta-diag').checked, diagnostics: diag }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { send.disabled = false; return msg(data.error || t('beta.err_send'), false); }
        sent = true;
        _draft = null;
        _lastReport = _discordText(f, data.report.id);
        msg(t('beta.sent', { id: data.report.id }), true);
        send.hidden = true;
        $('btn-beta-copy').hidden = false;
        _mine = null;
      } catch {
        send.disabled = false;
        msg(t('beta.err_send'), false);
      }
    });
  }

  async function init() {
    _captureInvite();
    try {
      const r = await fetch('/api/beta/config', { cache: 'no-store' });
      if (r.ok) _config = await r.json();
    } catch { /* hors ligne : rien d'affiché */ }
    await _checkInvite();
    _renderBanner();
    I18n.onLangChange(() => _renderBanner());
    return _config;
  }

  return {
    init, pendingInvite, inviteAccepted, inviteBlocked, clearInvite, showInviteField, inviteNoticeHtml, registerError,
    registrationMode, settingsSectionHtml, bindSettings, openReport,
    reportsEnabled: () => !!_config?.reports,
    clearDraft: () => { _draft = null; document.getElementById('beta-report-modal')?.remove(); },
    discordUrl: () => _config?.discordUrl || null,
  };
})();
