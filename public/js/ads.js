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
 * - Promotion interne DIG! (demande du 04/11/2026) : quand aucune annonce de régie n'est servie
 *   ici, le même emplacement peut afficher une bannière maison (public/js/gemCallout.js) qui
 *   ouvre la boutique de gemmes. Aucun script tiers, aucun cadre, aucun consentement requis ;
 *   pilotée séparément dans l'admin. Noms neutres (#top-strip) : les filtres cosmétiques des
 *   bloqueurs ne la masquent pas en laissant un vide.
 * - Pas de décalage au chargement : la hauteur du dernier emplacement affiché est mémorisée
 *   et réservée dès le chargement du script, puis confirmée ou libérée par la configuration.
 * - Emplacement en haut, au-dessus de l'en-tête : jamais sur le bloc, les commandes ou la barre
 *   de navigation. Option admin « masquer sur l'écran de minage » (mobile par défaut).
 */
const DigAds = (() => {
  const CONSENT_KEY = 'dig_ads_consent';
  const HINT_KEY    = 'dig_top_strip';  // dernier emplacement affiché : réservation sans décalage
  const DESKTOP_MIN_W = 760;   // 728 px + marges
  const MIN_H = 480;           // paysage très bas (téléphone couché) : pas de bannière

  let _config = null;
  let _ext    = null;   // emplacement de la régie utilisable ici (ou null)
  let _promo  = null;   // emplacement de la promotion interne (ou null)
  let _mode   = null;   // 'ad' | 'promo' | null : contenu monté
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

  function _fits() {
    if (window.innerHeight < MIN_H) return null;
    if (window.innerWidth >= DESKTOP_MIN_W) return 'top_desktop';
    if (window.innerWidth >= 320) return 'top_mobile';
    return null;
  }

  function _pickSlot(slots) {
    const want = _fits();
    return (slots || []).find(s => s.slot === want) || null;
  }

  function _current() { return _mode === 'ad' ? _ext : _mode === 'promo' ? _promo : null; }

  function _digVisible() {
    const v = document.getElementById('view-dig');
    return !!v && !v.classList.contains('hidden');
  }

  function _applyDigVisibility() {
    const s = _current();
    if (!s) return;
    document.body.classList.toggle('top-strip-collapsed', !!s.hideOnDig && _digVisible());
  }

  function _unmount() {
    document.getElementById('top-strip')?.remove();
    document.body.classList.remove('has-top-strip', 'top-strip-collapsed');
    document.body.style.removeProperty('--top-strip-h');
    _frame = null;
    _mode  = null;
  }

  // Espace réservé à la taille exacte AVANT le contenu : pas de décalage quand il arrive.
  function _box(slot) {
    const box = document.createElement('div');
    box.id = 'top-strip';
    document.body.style.setProperty('--top-strip-h', `${slot.height + 8}px`);
    document.body.prepend(box);
    document.body.classList.add('has-top-strip');
    return box;
  }

  function _mountAd() {
    const box = _box(_ext);
    box.setAttribute('role', 'complementary');
    box.setAttribute('aria-label', t('ads.label'));
    const frame = document.createElement('iframe');
    frame.title = t('ads.label');
    frame.width  = String(_ext.width);
    frame.height = String(_ext.height);
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.setAttribute('scrolling', 'no');
    frame.setAttribute('tabindex', '-1');
    frame.src = `/ads/frame/${encodeURIComponent(_ext.slot)}`;
    box.appendChild(frame);
    _frame = frame;
    _mode = 'ad';
  }

  // Boutique de gemmes joignable ? Sinon, pas de promotion (aucun lien mort).
  function _shopAvailable() {
    return typeof switchView === 'function' && !!document.getElementById('view-shop')
      && !!document.querySelector('.nav-btn[data-view="shop"]');
  }

  function _openGemShop() {
    if (!_shopAvailable()) { _promo = null; _render(); return; }
    switchView('shop');
    document.getElementById('shop-gems-anchor')?.scrollIntoView({ block: 'start' });
  }

  function _mountPromo() {
    const box = _box(_promo);
    box.setAttribute('role', 'complementary');
    box.setAttribute('aria-label', t('promo.tag'));
    box.appendChild(DigGemCallout.create(_promo.slot, {
      tag: t('promo.tag'), title: t('promo.title'), text: t('promo.text'), cta: t('promo.cta'), ctaShort: t('promo.cta_short'),
    }, _openGemShop));
    _mode = 'promo';
  }

  function _render() {
    const want = _ext && _readConsent() === 'granted' ? 'ad' : _promo && _shopAvailable() ? 'promo' : null;
    if (want !== _mode || !want) {   // !want : libère aussi une place réservée par l'indice
      _unmount();
      if (want === 'ad') _mountAd();
      else if (want === 'promo') _mountPromo();
    }
    _applyDigVisibility();
    const s = _current();
    try {
      if (s) localStorage.setItem(HINT_KEY, JSON.stringify({ slot: s.slot, height: s.height, hideOnDig: !!s.hideOnDig }));
      else localStorage.removeItem(HINT_KEY);
    } catch { /* stockage indisponible : réservation au prochain chargement impossible, sans gravité */ }
  }

  // Réserve dès le chargement la place de la bannière affichée la dernière fois (même format),
  // pour que l'arrivée de la configuration ne décale pas l'interface.
  function _reserveFromHint() {
    try {
      const h = JSON.parse(localStorage.getItem(HINT_KEY) || 'null');
      if (!h || h.slot !== _fits() || !(h.height > 0 && h.height <= 90)) return;
      _box(h);
      document.body.classList.toggle('top-strip-collapsed', !!h.hideOnDig && _digVisible());
    } catch { /* indice illisible : rien à réserver */ }
  }

  // Le cadre signale un script bloqué (bloqueur, réseau) : on replie l'emplacement.
  window.addEventListener('message', (e) => {
    if (!_frame || e.source !== _frame.contentWindow) return;
    if (e.data && e.data.digAd === 'error') { _ext = null; _render(); }
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

  /** Enregistre le choix du joueur ; un retrait démonte immédiatement la bannière de la régie. */
  function setConsent(choice) {
    if (!_config) return;
    _writeConsent(choice);
    _render();
  }

  async function init() {
    try {
      const res = await fetch('/api/ads/config', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      _config = await res.json();
    } catch { _unmount(); return; }
    _ext   = _config.enabled ? _pickSlot(_config.slots) : null;
    _promo = _config.promo ? _pickSlot(_config.promo.slots) : null;
    _render();
    if (_ext && _readConsent() === null) _whenNoModal(_showConsent);
    const view = document.getElementById('view-dig');
    if (view && (_ext || _promo)) new MutationObserver(_applyDigVisibility).observe(view, { attributes: true, attributeFilter: ['class'] });
  }

  // Ne pas empiler la demande de consentement sur l'écran de choix de langue.
  function _whenNoModal(fn) {
    const lang = document.getElementById('lang-pick-screen');
    if (!lang || lang.hidden) return fn();
    new MutationObserver((_, obs) => { if (lang.hidden) { obs.disconnect(); fn(); } })
      .observe(lang, { attributes: true, attributeFilter: ['hidden'] });
  }

  /** Section « Publicité » de Paramètres : seulement si une bannière de régie peut s'afficher ici. */
  function settingsSectionHtml() {
    if (!_config || !_config.enabled || !_ext) return '';
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

  _reserveFromHint();

  return { init, setConsent, settingsSectionHtml, bindSettings, CONSENT_KEY };
})();
