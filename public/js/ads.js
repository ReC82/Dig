/**
 * ads.js — Bannière publicitaire haute, non intrusive (#45).
 *
 * - Rien ne se passe tant que le serveur ne déclare pas d'emplacement actif pour CE domaine
 *   (GET /api/ads/config) : par défaut la publicité est désactivée et la page n'est pas modifiée
 *   (aucun espace réservé, aucun décalage de mise en page).
 * - Aucun script publicitaire ne s'exécute dans la page du jeu : la bannière est une iframe
 *   `sandbox` sans `allow-same-origin` (origine opaque : ni cookies, ni stockage, ni DOM du jeu,
 *   pas de navigation de l'onglet) vers /ads/frame/<emplacement>.
 * - Chargée au plus une fois par page : pas de rafraîchissement, aucun lien avec les clics,
 *   l'Auto-Dig, les scores ou le classement.
 * - Consentement explicite demandé avant tout chargement ; refus ou retrait = aucune bannière ;
 *   le choix est modifiable dans Paramètres. Bloqueur de publicité ou absence d'annonce :
 *   l'emplacement se replie, sans message ni pénalité.
 * - Emplacement en haut, au-dessus de l'en-tête : jamais sur le bloc, les commandes ou la barre
 *   de navigation. Option admin « masquer sur l'écran de minage » (mobile par défaut).
 */
const DigAds = (() => {
  const CONSENT_KEY = 'dig_ads_consent';
  const DESKTOP_MIN_W = 760;   // 728 px + marges
  const MIN_H = 480;           // paysage très bas (téléphone couché) : pas de bannière

  let _config = null;
  let _slot   = null;
  let _frame  = null;

  function _readConsent() {
    try {
      const c = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      return c && _config && c.v === _config.consentVersion ? c.choice : null;
    } catch { return null; }
  }

  function _writeConsent(choice) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: _config.consentVersion, choice, at: new Date().toISOString() })); }
    catch { /* stockage indisponible : choix valable pour cette page seulement */ }
  }

  function _pickSlot() {
    const by = Object.fromEntries((_config?.slots || []).map(s => [s.slot, s]));
    if (window.innerHeight < MIN_H) return null;
    if (window.innerWidth >= DESKTOP_MIN_W && by.top_desktop) return by.top_desktop;
    if (window.innerWidth < DESKTOP_MIN_W && window.innerWidth >= 320 && by.top_mobile) return by.top_mobile;
    return null;
  }

  function _digVisible() {
    const v = document.getElementById('view-dig');
    return !!v && !v.classList.contains('hidden');
  }

  function _applyDigVisibility() {
    if (!_frame) return;
    document.body.classList.toggle('ad-top-collapsed', !!_slot.hideOnDig && _digVisible());
  }

  function _unmount() {
    document.getElementById('ad-top')?.remove();
    document.body.classList.remove('has-ad-top', 'ad-top-collapsed');
    document.body.style.removeProperty('--ad-h');
    _frame = null;
  }

  function _mount() {
    if (_frame || !_slot) return;
    const box = document.createElement('div');
    box.id = 'ad-top';
    box.setAttribute('role', 'complementary');
    box.setAttribute('aria-label', t('ads.label'));
    const frame = document.createElement('iframe');
    frame.title = t('ads.label');
    frame.width  = String(_slot.width);
    frame.height = String(_slot.height);
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('tabindex', '-1');
    frame.src = `/ads/frame/${encodeURIComponent(_slot.slot)}`;
    box.appendChild(frame);
    // Espace réservé à la taille exacte AVANT le chargement : pas de décalage quand l'annonce arrive.
    document.body.style.setProperty('--ad-h', `${_slot.height + 8}px`);
    document.body.prepend(box);
    document.body.classList.add('has-ad-top');
    _frame = frame;
    _applyDigVisibility();
  }

  // Le cadre signale un script bloqué (bloqueur, réseau) : on replie l'emplacement.
  window.addEventListener('message', (e) => {
    if (!_frame || e.source !== _frame.contentWindow) return;
    if (e.data && e.data.digAd === 'error') _unmount();
  });

  function _showConsent() {
    if (document.getElementById('ad-consent')) return;
    const box = document.createElement('div');
    box.id = 'ad-consent';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'ad-consent-title');
    box.innerHTML = `
      <div id="ad-consent-inner">
        <h2 id="ad-consent-title">${escapeHtml(t('ads.consent_title'))}</h2>
        <p>${escapeHtml(t('ads.consent_text'))}</p>
        <p><a href="/legal/confidentialite" target="_blank" rel="noopener">${escapeHtml(t('ads.more'))}</a></p>
        <div class="ad-consent-btns">
          <button type="button" id="ad-consent-refuse">${escapeHtml(t('ads.refuse'))}</button>
          <button type="button" id="ad-consent-accept">${escapeHtml(t('ads.accept'))}</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    const done = (choice) => { box.remove(); setConsent(choice); };
    box.querySelector('#ad-consent-accept').addEventListener('click', () => done('granted'));
    box.querySelector('#ad-consent-refuse').addEventListener('click', () => done('denied'));
  }

  /** Enregistre le choix du joueur ; un retrait démonte immédiatement la bannière. */
  function setConsent(choice) {
    if (!_config) return;
    _writeConsent(choice);
    if (choice === 'granted') _mount(); else _unmount();
  }

  async function init() {
    try {
      const res = await fetch('/api/ads/config', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) return;
      _config = await res.json();
    } catch { return; }
    if (!_config.enabled) return;
    _slot = _pickSlot();
    if (!_slot) return;
    const choice = _readConsent();
    if (choice === 'granted') _mount();
    else if (choice === null) _whenNoModal(_showConsent);
    const view = document.getElementById('view-dig');
    if (view) new MutationObserver(_applyDigVisibility).observe(view, { attributes: true, attributeFilter: ['class'] });
  }

  // Ne pas empiler la demande de consentement sur l'écran de choix de langue.
  function _whenNoModal(fn) {
    const lang = document.getElementById('lang-pick-screen');
    if (!lang || lang.hidden) return fn();
    new MutationObserver((_, obs) => { if (lang.hidden) { obs.disconnect(); fn(); } })
      .observe(lang, { attributes: true, attributeFilter: ['hidden'] });
  }

  /** Section « Publicité » de Paramètres : seulement si une bannière peut s'afficher ici. */
  function settingsSectionHtml() {
    if (!_config || !_config.enabled || !_slot) return '';
    const choice = _readConsent();
    const state = choice === 'granted' ? t('ads.settings_granted') : choice === 'denied' ? t('ads.settings_denied') : t('ads.settings_unset');
    const btn = choice === 'granted'
      ? `<button type="button" class="settings-ad-btn" data-ad-consent="denied">${escapeHtml(t('ads.withdraw'))}</button>`
      : `<button type="button" class="settings-ad-btn" data-ad-consent="granted">${escapeHtml(t('ads.grant'))}</button>`;
    return `<div class="settings-section" id="settings-ads">
      <div class="settings-section-label">${escapeHtml(t('ads.settings_title'))}</div>
      <p class="settings-ad-state">${escapeHtml(state)}</p>${btn}</div>`;
  }

  function bindSettings(container, rerender) {
    container.querySelectorAll('[data-ad-consent]').forEach(b => b.addEventListener('click', () => {
      setConsent(b.dataset.adConsent);
      rerender();
    }));
  }

  return { init, setConsent, settingsSectionHtml, bindSettings, CONSENT_KEY };
})();
