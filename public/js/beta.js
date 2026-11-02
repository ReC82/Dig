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
 *   session et prérempli dans le formulaire d'inscription.
 */
const DigBeta = (() => {
  const INVITE_KEY = 'dig_invite';
  const HIDE_KEY   = 'dig_beta_banner_hidden';
  let _config = null;
  let _mine   = null;   // signalements du joueur connecté (null = non chargés)
  let _lastReport = null;

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

  /** Faut-il afficher le champ « code d'invitation » à l'inscription ? */
  function showInviteField() { return _config?.registration === 'invite' || !!pendingInvite(); }

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

  function openReport() {
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
      <h2 id="beta-report-title">${escapeHtml(t('beta.modal_title'))}</h2>
      <p class="beta-text">${escapeHtml(t('beta.modal_intro'))}</p>
      ${field('beta-step', 'beta.field_step', 2)}
      ${field('beta-expected', 'beta.field_expected', 2)}
      ${field('beta-observed', 'beta.field_observed', 3)}
      <label class="beta-field" for="beta-device">${escapeHtml(t('beta.field_device'))}
        <input id="beta-device" type="text" maxlength="200" value="${escapeHtml(_deviceGuess())}"></label>
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
    </form>`;
    document.body.appendChild(modal);
    const $ = id => modal.querySelector(`#${id}`);
    const close = () => modal.remove();
    $('btn-beta-cancel').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
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
    _renderBanner();
    I18n.onLangChange(() => _renderBanner());
    return _config;
  }

  return { init, pendingInvite, showInviteField, registrationMode, settingsSectionHtml, bindSettings, openReport };
})();
