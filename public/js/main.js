/**
 * main.js
 * Point d'entrée : DOM, événements, rendu.
 * Dépend de : GameState, Blocks, Upgrades, Collection, Quests, Daily, Monetization, Save
 */

// ── Références DOM fixes ────────────────────────────────────────────────────
const elCoins        = document.getElementById('stat-coins');
const elGems         = document.getElementById('stat-gems');
const elDepth        = document.getElementById('stat-depth');
const elPickaxe      = document.getElementById('stat-pickaxe');
const elDamage       = document.getElementById('stat-damage');
const elBlock        = document.getElementById('block');
const elBlockIcon    = document.getElementById('block-icon');
const elBlockName    = document.getElementById('block-name');
const elBlockRarity  = document.getElementById('block-rarity');
const elBlockReward  = document.getElementById('block-reward');
const elHpBar        = document.getElementById('hp-bar');
const elHpText       = document.getElementById('hp-text');
const elUpgradesList = document.getElementById('upgrades-list');
const elResetBtn     = document.getElementById('btn-reset');
const elSaveToast    = document.getElementById('save-toast');
const elBoostBanner  = document.getElementById('boost-banner');
const elBoostText    = document.getElementById('boost-text');
const elBoostTimer   = document.getElementById('boost-timer');
const elRelics       = document.getElementById('stat-relics');

// ── État interne ─────────────────────────────────────────────────────────────
let blockAnimating = false;
let toastTimer     = null;
let _previousView  = 'dig';   // vue à restaurer quand on ferme les paramètres
let _account              = null;    // { id, username, email, emailVerified } si connecté, null sinon
let _accountTab           = 'login'; // onglet actif : login | register | forgot | reset (#28)
let _mailEnabled          = false;   // e-mails de compte disponibles côté serveur (#28)
let _resetToken           = null;    // jeton du lien « mot de passe oublié » ouvert (#28)
let _social               = null;    // connexion Google (#28) : null = désactivée côté serveur
let _socialResult         = null;    // résultat du retour Google (?social=…), lu au chargement
const SOCIAL_SEEN_KEY     = 'dig.socialLinked'; // un compte Google a été lié sur cet appareil
let _hasShownGuestWarning = false;   // avertissement affiché une seule fois par session
let _seasonCpsLimit       = 8;       // seuil CPS récupéré depuis le serveur

// ── Version / cache busting ───────────────────────────────────────────────────
let _updateCheckLast = 0; // Timestamp du dernier check de version (ms)

async function _checkForUpdate() {
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = await r.json();
    if (version && version !== window.APP_VERSION) {
      const el = document.getElementById('update-banner');
      if (el) {
        const textEl = document.getElementById('update-banner-text');
        const btnEl  = document.getElementById('update-banner-btn');
        if (textEl) textEl.textContent = t('ui.update_available');
        if (btnEl)  btnEl.textContent  = t('ui.update_reload');
        el.removeAttribute('hidden');
      }
    }
  } catch (_) {}
}

/** Vérifie la version au plus toutes les 5 min (force = au chargement). */
function _maybeCheckForUpdate(force = false) {
  const now = Date.now();
  if (force || now - _updateCheckLast > 5 * 60 * 1000) {
    _updateCheckLast = now;
    _checkForUpdate();
  }
}

// Au retour sur la page (focus ordinateur, application ramenée au premier plan sur mobile)
window.addEventListener('focus', () => _maybeCheckForUpdate());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') _maybeCheckForUpdate();
});

// ── PWA : service worker (#21) ────────────────────────────────────────────────
// Met en cache les fichiers statiques versionnés (?v=) et la page d'accueil pour
// un lancement hors ligne ; l'API n'est jamais interceptée (voir public/sw.js).
function _registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

// ── Anti-autoclicker ──────────────────────────────────────────────────────────
const _clickLog        = [];           // Timestamps récents (fenêtre glissante 3 s) pour le CPS
const _clickTimestamps = [];           // Derniers N timestamps pour détecter la régularité
const _TS_BUF          = 25;           // Taille du buffer d'intervalles
let   _lastClickMs     = 0;            // Timestamp du dernier clic manuel

/** Enregistre le timestamp du clic courant pour le calcul de régularité. */
function _recordClickTs() {
  const now = Date.now();
  _clickTimestamps.push(now);
  if (_clickTimestamps.length > _TS_BUF) _clickTimestamps.shift();
  _lastClickMs = now;
}

/**
 * Calcule un score de régularité des intervalles entre clics (0 = humain, 1 = robotique).
 * Méthode : coefficient de variation (CV) des intervalles valides (<2 s).
 * CV faible → rythme très régulier → suspect.
 */
function _computeRegularityScore() {
  if (_clickTimestamps.length < 9) return 0;   // pas assez de données
  const intervals = [];
  for (let i = 1; i < _clickTimestamps.length; i++) {
    const gap = _clickTimestamps[i] - _clickTimestamps[i - 1];
    if (gap > 0 && gap < 2000) intervals.push(gap);   // ignorer les pauses longues
  }
  if (intervals.length < 5) return 0;
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean <= 0) return 0;
  const variance = intervals.reduce((s, v) => s + (v - mean) ** 2, 0) / intervals.length;
  const cv = Math.sqrt(variance) / mean;  // 0 = parfaitement régulier, >0.25 = variation humaine normale
  return Math.max(0, Math.min(1, 1 - cv / 0.25));
}

// ── Télémétrie anti-bot (#25) ─────────────────────────────────────────────────
// Résumé des clics depuis le dernier envoi cloud, joint à la sauvegarde : nombre de clics,
// histogramme des intervalles (8 classes), clics générés par script (isTrusted = false),
// type de pointeur, régularité (CV). Aucun horodatage brut ni donnée personnelle ; le serveur
// n'en tire que des indices journalisés, jamais une sanction.
const _TELE_BOUNDS = [40, 60, 80, 100, 150, 250, 500]; // ms : <40, <60, … , ≥500
const _tele = { n: 0, h: [0, 0, 0, 0, 0, 0, 0, 0], u: 0, p: { m: 0, t: 0, k: 0, o: 0 }, s1: 0, s2: 0, c: 0, last: 0 };

/** Enregistre un coup de pioche manuel (ev : événement d'origine, absent = appel par script). */
function _teleRecord(ev) {
  const now = performance.now();
  _tele.n++;
  if (!ev || ev.isTrusted === false) _tele.u++;
  const kind = !ev ? 'o'
    : (ev.type === 'touchstart' || ev.pointerType === 'touch') ? 't'
    : ev.type === 'keydown' ? 'k'
    : ev.type === 'click' ? 'm' : 'o';
  _tele.p[kind]++;
  if (_tele.last) {
    const gap = now - _tele.last;
    let i = 0;
    while (i < _TELE_BOUNDS.length && gap >= _TELE_BOUNDS[i]) i++;
    _tele.h[i]++;
    if (gap < 2000) { _tele.s1 += gap; _tele.s2 += gap * gap; _tele.c++; }
  }
  _tele.last = now;
}

/** Résumé à envoyer (null si aucun clic depuis le dernier envoi réussi). */
function _teleSnapshot() {
  if (_tele.n === 0) return null;
  const mean = _tele.c ? _tele.s1 / _tele.c : 0;
  const cv   = _tele.c >= 5 && mean > 0 ? Math.sqrt(Math.max(0, _tele.s2 / _tele.c - mean * mean)) / mean : null;
  return {
    v: 1, n: _tele.n, h: [..._tele.h], u: _tele.u, p: { ..._tele.p },
    ...(cv === null ? {} : { cv: Math.round(cv * 1000) / 1000 }),
    _s: { s1: _tele.s1, s2: _tele.s2, c: _tele.c },
  };
}

/** Retire du cumul ce qui a été reçu par le serveur. */
function _teleConsume(snap) {
  if (!snap) return;
  _tele.n = Math.max(0, _tele.n - snap.n);
  _tele.u = Math.max(0, _tele.u - snap.u);
  snap.h.forEach((v, i) => { _tele.h[i] = Math.max(0, _tele.h[i] - v); });
  for (const k of Object.keys(_tele.p)) _tele.p[k] = Math.max(0, _tele.p[k] - snap.p[k]);
  _tele.s1 = Math.max(0, _tele.s1 - snap._s.s1);
  _tele.s2 = Math.max(0, _tele.s2 - snap._s.s2);
  _tele.c  = Math.max(0, _tele.c  - snap._s.c);
}

/** Corps JSON de la télémétrie (sans les cumuls internes). */
function _telePayload(snap) {
  if (!snap) return undefined;
  const { _s, ...payload } = snap;
  return payload;
}

function _isSuspiciousCPS() {
  const now      = Date.now();
  const windowMs = 3000;
  _clickLog.push(now);
  while (_clickLog.length > 0 && _clickLog[0] < now - windowMs) _clickLog.shift();
  const recentCps = _clickLog.length / (windowMs / 1000);

  // Trop rapide → suspect
  if (recentCps > _seasonCpsLimit) return true;

  // Très régulier À vitesse modérée → possible autoclicker limité par sa config
  if (GameState.seasonStats.regularityScore > 0.92 && recentCps > _seasonCpsLimit * 0.5) return true;

  return false;
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showSaveToast() {
  elSaveToast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elSaveToast.classList.remove('visible'), 2000);
}

// ── Flash écran ───────────────────────────────────────────────────────────────

function screenFlash(color) {
  const el = document.createElement('div');
  el.className        = 'screen-flash';
  el.style.background = color;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// ── Navigation ────────────────────────────────────────────────────────────────

function switchView(viewId) {
  // La vue settings ne touche pas la nav — on la gère à part
  if (viewId !== 'settings') {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });
  }

  document.querySelectorAll('.view').forEach(v => {
    v.classList.toggle('hidden', v.id !== `view-${viewId}`);
  });

  // Remettre le scroll en haut à chaque changement d'onglet
  const activeView = document.getElementById(`view-${viewId}`);
  if (activeView) activeView.scrollTop = 0;

  if (viewId === 'dig') {
    renderBlock();
    renderStats();
  }
  if (viewId === 'upgrades') {
    renderUpgrades();
    renderShopChests();
    renderQuests();
    clearNavBadge('upgrades');
  }
  if (viewId === 'collection') {
    renderCollection();
    renderRelics();
    renderBadges();
    // Badge : effacer seulement si aucune relique n'est désormais abordable/améliorable
    if (!Relics.DEFS.some(r => Relics.canUnlock(r.id) || Relics.canUpgrade(r.id))) clearNavBadge('collection');
  }
  if (viewId === 'daily') {
    renderDaily();
    updateDailyBadge();
  }
  if (viewId === 'shop') {
    renderShop();
  }
  if (viewId === 'season') {
    _openSeasonView();
  }
  if (viewId === 'settings') {
    renderSettings();
  }
}

function setNavBadge(name) {
  const el = document.getElementById(`badge-${name}`);
  if (el) el.hidden = false;
}

function clearNavBadge(name) {
  const el = document.getElementById(`badge-${name}`);
  if (el) el.hidden = true;
}

function isViewActive(viewId) {
  const v = document.getElementById(`view-${viewId}`);
  return v ? !v.classList.contains('hidden') : false;
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ── Rendu stats ───────────────────────────────────────────────────────────────

function renderStats() {
  elCoins.textContent  = GameState.coins;
  elGems.textContent   = GameState.gems;
  elRelics.textContent = GameState.relicFragments;
  elDepth.textContent  = t('stats.depth_val', { n: GameState.depth });
  elDamage.textContent = GameState.damage;

  // Pioche : indicateur visuel du skin actif
  const skin = GameState.monetization.pickaxeSkin;
  const skinIcon = skin === 'golden' ? ' ✨' : skin === 'diamond' ? ' 💠' : '';
  elPickaxe.textContent = t('stats.pickaxe_val', { n: GameState.pickaxeLevel }) + skinIcon;

  updateUpgradeButtonStates();
}

// ── Rendu boost banner ────────────────────────────────────────────────────────

function renderBoostBanner() {
  const ms = Daily.getBoostRemainingMs();
  if (ms <= 0) {
    elBoostBanner.hidden = true;
    return;
  }
  elBoostBanner.hidden = false;
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  elBoostText.textContent  = t('ui.boost_active',    { mult: GameState.coinBoost.multiplier });
  elBoostTimer.textContent = t('ui.boost_remaining', { min, sec: String(sec).padStart(2, '0') });
}

// ── Rendu bouton pub ──────────────────────────────────────────────────────────

/**
 * Source de vérité unique pour l'état du bouton pub.
 * Gère : visibilité (jamais display:none), disabled, icône, texte, timer.
 *
 * Trois états :
 *   ready    — pub disponible → bouton actif, texte d'invitation
 *   used     — regardée il y a < 30 s → icône ✅, "Bonus déjà utilisé"
 *   cooldown — cooldown actif → icône ⏳, texte + countdown sous le bouton
 */
function updateAdButtonState() {
  const btn    = document.getElementById('btn-watch-ad');
  const textEl = btn ? btn.querySelector('.ad-btn-text') : null;
  const iconEl = btn ? btn.querySelector('.ad-btn-icon') : null;
  const timer  = document.getElementById('ad-timer');
  if (!btn) return;

  // Garantit la présence dans le flux — annule tout display:none hérité ou inline
  btn.style.display = '';

  const available = Monetization.canWatchAd();
  const remainMs  = Monetization.getCooldownRemainingMs();

  if (available) {
    // ── Pub disponible ────────────────────────────────────────────────────────
    btn.disabled        = false;
    btn.dataset.adState = 'ready';
    if (iconEl) iconEl.textContent = '📺';
    if (textEl) textEl.textContent = t('ui.btn_watch_ad');
    if (timer)  timer.textContent  = '';

  } else if (remainMs > Monetization.AD_COOLDOWN_MS - 30_000) {
    // ── Vient d'être regardée (< 30 s) ───────────────────────────────────────
    btn.disabled        = true;
    btn.dataset.adState = 'used';
    if (iconEl) iconEl.textContent = '✅';
    if (textEl) textEl.textContent = t('ui.ad_used');
    if (timer)  timer.textContent  = '';

  } else {
    // ── Cooldown actif ────────────────────────────────────────────────────────
    btn.disabled        = true;
    btn.dataset.adState = 'cooldown';
    const totalSec = Math.ceil(remainMs / 1000);
    const min      = Math.floor(totalSec / 60);
    const sec      = totalSec % 60;
    if (iconEl) iconEl.textContent = '⏳';
    if (textEl) textEl.textContent = t('ui.ad_soon');
    if (timer)  timer.textContent  = t('ui.ad_cooldown', { min, sec: String(sec).padStart(2, '0') });
  }
}

// ── Rendu bloc ────────────────────────────────────────────────────────────────

function renderBlock() {
  const b = Blocks.current;
  if (!b) return;

  elBlockName.textContent  = Blocks.displayName(b.type);   // nom du catalogue (#37) ou i18n
  IconLibrary.render(elBlockIcon, b.type);   // legacy (emoji) par défaut, v1 si activé
  elBlock.style.background = b.type.color;

  const rarityLabel = t('rarity.' + b.type.rarityKey.replace('-', '_'));
  elBlockRarity.innerHTML = `<span class="rarity-badge rarity-${b.type.rarityKey}">${rarityLabel}</span>`;

  // Rareté
  elBlock.classList.remove(
    'rarity-commun','rarity-peu-commun','rarity-rare','rarity-epique','rarity-legendaire'
  );
  elBlock.classList.add(`rarity-${b.type.rarityKey}`);

  // Skin (passe après rareté → priorité CSS via !important)
  elBlock.classList.remove('skin-golden', 'skin-diamond');
  const skin = GameState.monetization.pickaxeSkin;
  if (skin) elBlock.classList.add(`skin-${skin}`);

  // HP
  const ratio = Blocks.hpRatio();
  elHpBar.style.width  = `${(ratio * 100).toFixed(1)}%`;
  elHpText.textContent = `${b.hp} / ${b.maxHp} HP`;

  elHpBar.classList.remove('low', 'critical');
  if (ratio <= 0.25)      elHpBar.classList.add('critical');
  else if (ratio <= 0.55) elHpBar.classList.add('low');

  elBlock.classList.remove('crack-1', 'crack-2', 'crack-3');
  if (ratio < 0.25)      elBlock.classList.add('crack-3');
  else if (ratio < 0.55) elBlock.classList.add('crack-2');
  else if (ratio < 0.80) elBlock.classList.add('crack-1');

  // Pulsation critique
  elBlock.classList.toggle('hp-critical', ratio <= 0.25);

  // Récompense : les coffres ont leur propre table de loot — on n'affiche pas de coins
  let rewardHtml;
  if (b.type.isChest) {
    // Dérive les types de loot possibles depuis la table du coffre
    const table  = Chests.TABLES[b.type.rarityKey] ?? Chests.TABLES.commun;
    const ICONS  = { coins: '💰', relics: '🔮', boost: '⚡' };
    const icons  = [...new Set(table.map(e => ICONS[e.type]))].filter(Boolean).join(' ');
    rewardHtml   = `<span class="reward-chest">${icons} ${t('ui.chest_loot')}</span>`;
  } else {
    // Bloc normal : base × multiplicateurs actifs = total réel (#20)
    const { base, factors, total } = Upgrades.getRewardBreakdown(b.reward, GameState.getCoinBoostMultiplier());
    // Montants entiers en toutes lettres (séparateurs de milliers, jamais abrégés) ; en cas de
    // manque de place, retour à la ligne entre deux facteurs, « = total » toujours d'un seul tenant.
    const lang = I18n.getCurrent();
    if (factors.length > 0) {
      const ICONS = { bag: '🎒', relic: '💛', event: '✨', boost: '⚡' };
      const fmt   = m => Number(m).toLocaleString(lang, { maximumFractionDigits: 3 });
      rewardHtml = `<span class="reward-base">💰 ${base.toLocaleString(lang)}</span>`
                 + factors.map(f =>
                     ` <span class="reward-factor reward-factor-${f.key}" title="${t('ui.reward_factor.' + f.key)}">`
                   + `× ${ICONS[f.key]} ${fmt(f.mult)}</span>`).join('')
                 + ` <span class="reward-result"><span class="reward-eq">=</span> <span class="reward-final">💰 ${total.toLocaleString(lang)}</span></span>`;
    } else {
      rewardHtml = `<span class="reward-value">💰 ${total.toLocaleString(lang)}</span>`;
    }
  }
  elBlockReward.innerHTML = `${t('ui.reward_label')} : ${rewardHtml}`;
}

// ── Rendu upgrades ────────────────────────────────────────────────────────────

function renderUpgrades() {
  elUpgradesList.innerHTML = '';

  for (const def of Upgrades.DEFS) {
    const level  = Upgrades.getLevel(def.id);
    const cost   = Upgrades.getCost(def.id);
    const maxed  = cost === null;

    let costHtml = '';
    if (!maxed) {
      const parts = [];
      if (cost.coins > 0) parts.push(`💰&nbsp;${cost.coins}`);
      if (cost.gems  > 0) parts.push(`💎&nbsp;${cost.gems}`);
      costHtml = parts.join(' + ');
    }

    const canAfford = !maxed && Upgrades.canAfford(def.id);
    const card = document.createElement('div');
    card.className = 'upgrade-card';
    card.innerHTML = `
      <div class="upgrade-left">
        <div class="upgrade-icon">${def.icon}</div>
        <div class="upgrade-info">
          <div class="upgrade-name">
            ${t(def.name)}
            <span class="upgrade-level">${t('stats.pickaxe_val', { n: level })}${maxed ? ` <span class="maxed-tag">${t('ui.btn_max')}</span>` : ''}</span>
          </div>
          <div class="upgrade-desc">${def.describe(level)}</div>
          <div class="upgrade-next">${_upgradeNextHtml(def)}</div>
          ${def.preview ? `<div class="upgrade-preview" data-id="${def.id}">${def.preview(level)}</div>` : ''}
        </div>
      </div>
      <button class="upgrade-btn${maxed ? ' is-maxed' : ''}" data-id="${def.id}"
        ${maxed || !canAfford ? 'disabled' : ''} aria-label="${t('ui.btn_upgrade')} ${t(def.name)}">
        ${maxed ? t('ui.btn_max') : `${t('ui.btn_upgrade')}<span class="btn-cost">${costHtml}</span>`}
      </button>`;

    if (!maxed) {
      card.querySelector('.upgrade-btn').addEventListener('click', () => {
        if (Upgrades.buy(def.id)) {
          if (def.id === 'block_reroll') {
            Blocks.spawn(GameState.depth);
            renderBlock();
          }
          if (def.id === 'fragment_shop') renderRelics();
          renderUpgrades();
          renderStats();
          const completed = Quests.checkAll();
          handleQuestsCompleted(completed);
          updateDailyBadge();
          Save.save();
        }
      });
    }

    elUpgradesList.appendChild(card);
  }
}

/** Aperçu avant/après de l'achat (#20) : « Niveau 8 → 9 · Récompenses ×3,4 → ×3,7 ». */
function _upgradeNextHtml(def) {
  const p = Upgrades.getLevelPreview(def.id);
  if (p.next === null) return t('upgrade.max_level');
  const level = `<span class="upgrade-next-level">${t('upgrade.next_level', { cur: p.cur, next: p.next })}</span>`;
  if (!p.effect) return level;
  const fmt = def.id === 'bag' ? Upgrades.formatMult : n => Number(n).toLocaleString(I18n.getCurrent());
  return `${level} <span class="upgrade-next-effect">${t(`upgrade.${def.id}.effect`, { cur: fmt(p.effect.cur), next: fmt(p.effect.next) })}</span>`;
}

function updateUpgradeButtonStates() {
  for (const def of Upgrades.DEFS) {
    // Aperçu lié à la profondeur (carte Chance, #32) : suit la descente sans redessiner la carte
    const preview = def.preview && elUpgradesList.querySelector(`.upgrade-preview[data-id="${def.id}"]`);
    if (preview) preview.textContent = def.preview(Upgrades.getLevel(def.id));
    const btn = elUpgradesList.querySelector(`.upgrade-btn[data-id="${def.id}"]`);
    if (!btn || btn.classList.contains('is-maxed')) continue;
    btn.disabled = !Upgrades.canAfford(def.id);
  }
}

// ── Rendu objectifs ───────────────────────────────────────────────────────────

function renderQuests() {
  const container = document.getElementById('quests-list');
  if (!container) return;
  container.innerHTML = '';

  for (const def of Quests.DEFS) {
    const done = Quests.isCompleted(def.id);
    const parts = [];
    if (def.reward.coins > 0) parts.push(`💰 ${def.reward.coins}`);
    if (def.reward.gems  > 0) parts.push(`💎 ${def.reward.gems}`);

    const card = document.createElement('div');
    card.className = `quest-card${done ? ' completed' : ''}`;
    card.innerHTML = `
      <div class="quest-icon">${def.icon}</div>
      <div class="quest-info">
        <div class="quest-name">${t(def.name)}</div>
        <div class="quest-desc">${t(def.desc)}</div>
      </div>
      <div class="quest-reward">${done ? t('ui.quest_claimed') : parts.join(' + ')}</div>`;
    container.appendChild(card);
  }
}

// ── Boutique de saison (coffres achetables) ───────────────────────────────────

function renderShopChests() {
  const container = document.getElementById('shop-chests-list');
  if (!container) return;
  container.innerHTML = '';

  for (const def of Balance.SHOP_CHESTS) {
    const bought    = GameState.shopChestsBought[def.id] ?? 0;
    const maxed     = def.maxPerSeason !== null && bought >= def.maxPerSeason;
    const canAfford = !maxed && GameState.coins >= def.cost;

    const card = document.createElement('div');
    card.className = `shop-chest-card${canAfford ? ' can-afford' : ''}${maxed ? ' maxed' : ''}`;

    const limitHtml = def.maxPerSeason !== null
      ? `<span class="shop-chest-limit">${t('ui.shop_chest_bought', { n: bought, max: def.maxPerSeason })}</span>`
      : '';

    const btnLabel = maxed
      ? t('ui.shop_chest_limit_reached')
      : `${def.icon} ${t('shop_chest.' + def.id + '.name')} — 💰 ${def.cost.toLocaleString(I18n.getCurrent())}`;

    card.innerHTML = `
      <div class="shop-chest-header">
        <span class="shop-chest-icon">${def.icon}</span>
        <div class="shop-chest-info">
          <div class="shop-chest-name">${t('shop_chest.' + def.id + '.name')}</div>
          <div class="shop-chest-desc">${t('shop_chest.' + def.id + '.desc')}</div>
        </div>
        <div class="shop-chest-right">
          ${limitHtml}
          <div class="shop-chest-cost${canAfford ? ' can-afford' : ''}">💰 ${def.cost.toLocaleString(I18n.getCurrent())}</div>
        </div>
      </div>
      <button class="shop-chest-btn" ${(canAfford && !maxed) ? '' : 'disabled'}
        aria-label="${btnLabel}">
        ${maxed ? t('ui.shop_chest_limit_reached') : t('ui.btn_open_chest')}
      </button>
      <button type="button" class="shop-chest-odds-btn">${t('chest_odds.btn')}</button>`;

    // Consultable avant tout achat, même sans pièces, sans compte ou limite atteinte (#20)
    card.querySelector('.shop-chest-odds-btn').addEventListener('click', e => showChestOdds(def.id, e.currentTarget));

    if (canAfford && !maxed) {
      card.querySelector('.shop-chest-btn').addEventListener('click', () => {
        openShopChest(def.id);
      });
    }

    container.appendChild(card);
  }
}

/**
 * Ouvre un coffre achetable.
 * - Joueur connecté  → validation + tirage côté serveur (anti-triche)
 * - Joueur anonyme   → validation + tirage côté client (fallback)
 */
async function openShopChest(chestId) {
  const def = Balance.SHOP_CHESTS.find(c => c.id === chestId);
  if (!def) return;

  // Validation préventive côté client (évite un aller-retour inutile)
  if (GameState.coins < def.cost) return;
  const bought = GameState.shopChestsBought[chestId] ?? 0;
  if (def.maxPerSeason !== null && bought >= def.maxPerSeason) return;

  let reward;

  if (_account) {
    // ── Mode connecté : le serveur valide et tire la récompense ──────────────
    const btn = document.querySelector(`#shop-chests-list .shop-chest-btn[aria-label*="${t('shop_chest.' + chestId + '.name')}"]`);
    if (btn) btn.disabled = true;

    // Le serveur tire le coffre sur sa sauvegarde : on lui envoie d'abord l'état local à jour.
    // Si la sauvegarde serveur était plus récente, elle vient d'être appliquée : achat annulé.
    Save.save();
    if (await _syncToCloud() === 'adopted') { renderShopChests(); return; }

    const { ok, status, data } = await _apiFetch('POST', '/api/me/shop/chest/open', { chestId, controllerId: _tabId });

    if (!ok) {
      if (btn) btn.disabled = false;
      if (status === 409 && data?.notController) { _lockPlay('device'); return; }
      showAchievement('❌', data?.error ?? t('ui.shop_chest_error'));
      return;
    }

    // Appliquer l'état retourné par le serveur (source de vérité)
    GameState.coins          = data.newCoins;
    GameState.relicFragments = data.newRelicFragments;
    GameState.shopChestsBought[chestId] = data.boughtThisSeason;
    if (Number.isInteger(data.cost)) def.cost = data.cost;
    if (data.revision) _setCloudMeta(data.revision);
    reward = data.reward;

  } else {
    // ── Mode anonyme : tirage côté client, avec la table publiée par le serveur ──
    if (!def.table && !(await _loadChestCatalog())) { showAchievement('❌', t('ui.shop_chest_error')); return; }
    if (GameState.coins < def.cost) return;
    GameState.spendCoins(def.cost);
    GameState.shopChestsBought[chestId] = bought + 1;
    reward = _rollShopChestClient(chestId, def);
  }

  // Appliquer les effets qui ne sont pas dans le blob (boost, collection)
  _applyShopChestReward(reward);

  renderStats();
  renderShopChests();
  if (reward.type === 'boost') renderBoostBanner();
  if (reward.type === 'relics' && Relics.DEFS.some(r => Relics.canUnlock(r.id) || Relics.canUpgrade(r.id))) {
    setNavBadge('collection');
  }

  Save.save();
  _showShopChestReward(def, reward);
}

/**
 * Tirage client-side (joueurs anonymes uniquement) : table et règles de quantité reçues de
 * GET /api/shop/chests (server/chestShop.js), donc probabilités identiques au serveur (#20).
 */
function _rollShopChestClient(chestId, def) {
  const table = def.table;
  const total = table.reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  let entry;
  for (const row of table) { r -= row.weight; if (r <= 0) { entry = row; break; } }
  entry = entry ?? table[table.length - 1];

  const reward = { type: entry.type };
  if (entry.type === 'coins') {
    reward.amount = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
  } else if (entry.type === 'relics') {
    reward.amount = Balance.chestFragmentAmount(entry.amount, Relics.getLevel('shard_magnet'));
  } else if (entry.type === 'boost') {
    reward.mult = entry.mult; reward.minutes = entry.minutes;
  } else if (entry.type === 'collection') {
    const { itemIds, consolationFragments } = Balance.chestRules.collection;
    const missing = itemIds.filter(id => !GameState.collection.includes(id) && Collection.getById(id));
    if (missing.length > 0) {
      reward.itemId = missing[Math.floor(Math.random() * missing.length)];
    } else {
      reward.type = 'relics'; reward.amount = consolationFragments;
    }
  }
  return reward;
}

/** Charge la table publique des coffres (probabilités, coûts, règles). @returns {Promise<boolean>} */
async function _loadChestCatalog() {
  try {
    const { ok, data } = await _apiFetch('GET', '/api/shop/chests');
    if (!ok || !Balance.applyChestCatalog(data)) return false;
    if (isViewActive('upgrades')) renderShopChests();   // coffres affichés sous les améliorations
    return true;
  } catch (err) {
    console.warn('[coffres] table indisponible', err);
    return false;
  }
}

/**
 * Fenêtre « Récompenses et chances » d'un coffre (#20) : toutes les récompenses possibles avec leur
 * probabilité exacte, les quantités (y compris celles que le joueur recevrait avec ses reliques),
 * la limite saisonnière et les règles de tirage. Données relues sur le serveur à chaque ouverture.
 * Aucun bouton d'achat : impossible d'acheter par erreur depuis cette fenêtre.
 */
async function showChestOdds(chestId, opener) {
  const modal = document.getElementById('odds-modal');
  const def   = Balance.SHOP_CHESTS.find(c => c.id === chestId);
  if (!modal || !def) return;
  const $     = id => document.getElementById(id);
  const close = $('btn-odds-modal-close');
  const lang  = I18n.getCurrent();
  const n     = v => Number(v).toLocaleString(lang);
  const name  = t('shop_chest.' + chestId + '.name');

  const hide = () => { modal.hidden = true; if (opener && opener.isConnected) opener.focus(); };
  close.onclick   = hide;
  modal.onclick   = e => { if (e.target === modal) hide(); };
  modal.onkeydown = e => { if (e.key === 'Escape') hide(); };

  $('odds-modal-title').textContent = t('chest_odds.title', { name: `${def.icon} ${name}` });
  $('odds-modal-meta').textContent  = '';
  const body = $('odds-modal-body');
  body.textContent = t('chest_odds.loading');
  modal.hidden = false;
  close.focus();

  if (!(await _loadChestCatalog()) || !def.table) {
    body.textContent = t('chest_odds.error');
    return;
  }

  const bought = GameState.shopChestsBought[chestId] ?? 0;
  $('odds-modal-meta').textContent = t('chest_odds.price', { cost: n(def.cost) }) + ' · '
    + (def.maxPerSeason !== null ? t('chest_odds.limit', { max: def.maxPerSeason, n: bought }) : t('chest_odds.unlimited'));

  const shardLevel = Relics.getLevel('shard_magnet');
  const pct = v => Number(v).toLocaleString(lang, { maximumFractionDigits: 4 }) + '\u00a0%';
  const rows = def.table.map(row => {
    let label;
    if (row.type === 'coins') {
      label = escapeHtml(t('chest_odds.coins', { min: n(row.min), max: n(row.max) }))
        + (row.jackpot ? `<span class="odds-tag">${escapeHtml(t('chest_odds.jackpot'))}</span>` : '');
    } else if (row.type === 'relics') {
      const you = Balance.chestFragmentAmount(row.amount, shardLevel);
      label = escapeHtml(t('chest_odds.relics', { n: n(row.amount), s: row.amount > 1 ? 's' : '' }))
        + (you !== row.amount ? `<span class="odds-you">${escapeHtml(t('chest_odds.relics_you', { n: n(you) }))}</span>` : '');
    } else if (row.type === 'boost') {
      label = escapeHtml(t('chest_odds.boost', { mult: row.mult, minutes: row.minutes }));
    } else if (row.type === 'collection') {
      label = escapeHtml(t('chest_odds.collection'));
    } else {
      label = escapeHtml(row.type);
    }
    return `<tr><td class="odds-chance">${pct(row.chance)}</td><td>${label}</td></tr>`;
  }).join('');

  const types = new Set(def.table.map(r => r.type));
  const { fragments, collection } = Balance.chestRules;
  const rules = [t('chest_odds.rule_draw')];
  if (types.has('coins')) rules.push(t('chest_odds.rule_coins'));
  if (types.has('relics')) {
    rules.push(t('chest_odds.rule_fragments', {
      mult: fragments.multiplier !== 1 ? t('chest_odds.rule_fragments_mult', { mult: Upgrades.formatMult(fragments.multiplier) }) : '',
    }));
  }
  if (types.has('boost')) rules.push(t('chest_odds.rule_boost'));
  if (types.has('collection')) {
    const missing = collection.itemIds.filter(id => !GameState.collection.includes(id)).length;
    rules.push(missing > 0
      ? t('chest_odds.rule_collection', { total: collection.itemIds.length, missing, pct: Number(100 / missing).toLocaleString(lang, { maximumFractionDigits: 1 }), n: collection.consolationFragments })
      : t('chest_odds.rule_collection_full', { total: collection.itemIds.length, n: collection.consolationFragments }));
  }

  body.innerHTML = `<table class="odds-table">
      <thead><tr><th scope="col">${escapeHtml(t('chest_odds.col_chance'))}</th><th scope="col">${escapeHtml(t('chest_odds.col_reward'))}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <ul class="odds-rules">${rules.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
}

/**
 * Applique les effets côté client d'une récompense de coffre shop
 * (les champs coins/fragments ont déjà été mis à jour par le serveur ou _rollShopChestClient).
 */
function _applyShopChestReward(reward) {
  if (reward.type === 'coins') {
    // Déjà appliqué via GameState.coins = data.newCoins (connecté)
    // ou reward.amount n'est pas ajouté ici — le serveur l'a intégré dans newCoins.
    // En mode anonyme, on l'applique ici.
    if (!_account) {
      GameState.addCoins(reward.amount);
      GameState.stats.totalCoinsEarned += reward.amount;
    }
  } else if (reward.type === 'relics') {
    if (!_account) {
      GameState.relicFragments += reward.amount;
    }
  } else if (reward.type === 'boost') {
    GameState.setCoinBoost(reward.mult, reward.minutes * 60_000);
  } else if (reward.type === 'collection' && reward.itemId) {
    if (!GameState.collection.includes(reward.itemId)) {
      Collection.add(reward.itemId);
      const find = Collection.getById(reward.itemId);
      if (find) handleFindDrop(find);
    }
  }
}

/** Affiche la récompense du coffre shop dans la popup existante. */
function _showShopChestReward(def, reward) {
  const modal    = document.getElementById('chest-modal');
  const inner    = document.getElementById('chest-modal-inner');
  const iconEl   = document.getElementById('chest-modal-icon');
  const rarityEl = document.getElementById('chest-modal-rarity');
  const titleEl  = document.getElementById('chest-modal-title');
  const rewardEl = document.getElementById('chest-modal-reward');
  const btn      = document.getElementById('btn-collect-chest');
  if (!modal) return;

  inner.style.animation = 'none'; iconEl.style.animation = 'none';
  void inner.offsetWidth;
  inner.style.animation = ''; iconEl.style.animation = '';

  iconEl.textContent   = def.icon;
  rarityEl.innerHTML   = `<span class="rarity-badge rarity-rare">${t('shop_chest.' + def.id + '.name')}</span>`;
  titleEl.textContent  = t('ui.shop_chest_opened', { name: t('shop_chest.' + def.id + '.name') });
  rewardEl.textContent = _shopChestRewardLabel(reward);
  modal.hidden = false;

  btn.onclick = () => { modal.hidden = true; };
}

function _shopChestRewardLabel(reward) {
  if (reward.type === 'coins')
    return t('ui.chest_reward_coins', { amount: reward.amount.toLocaleString() });
  if (reward.type === 'relics')
    return t('ui.chest_reward_relics', { amount: reward.amount, s: reward.amount > 1 ? 's' : '' });
  if (reward.type === 'boost')
    return t('ui.chest_reward_boost', { mult: reward.mult, minutes: reward.minutes });
  if (reward.type === 'collection' && reward.itemId) {
    const find = Collection.getById(reward.itemId);
    return find ? `${find.icon} ${Collection.displayName(find)}` : '';
  }
  return '';
}

// ── Badges et succès honorifiques (#38) ───────────────────────────────────────

function _badgeText(map) {
  if (!map || typeof map !== 'object') return '';
  return map[I18n.getCurrent()] || map.fr || '';
}

/** Toast discret (sans interrompre le minage), historisé dans Paramètres (#26). */
function _onBadgesEarned(list) {
  list.forEach((b, i) => {
    setTimeout(() => showAchievement(b.icon || '🏅', t('badges.toast', { name: _badgeText(b.names) }), 'success'), i * 600);
  });
  if (isViewActive('collection')) renderBadges();
}

let _badgesReq = 0;
async function renderBadges() {
  const el = document.getElementById('badges-panel');
  if (!el) return;
  if (!_account) { el.innerHTML = `<p class="badges-note">${escapeHtml(t('badges.login'))}</p>`; return; }
  const req = ++_badgesReq;
  if (!el.dataset.loaded) el.innerHTML = `<p class="badges-note">${escapeHtml(t('badges.loading'))}</p>`;
  let res;
  try { res = await _apiFetch('GET', '/api/me/badges'); } catch (_) { res = null; }
  if (req !== _badgesReq) return;
  if (!res || !res.ok) { el.innerHTML = `<p class="badges-note">${escapeHtml(t('badges.error'))}</p>`; return; }
  el.dataset.loaded = '1';
  const { badges = [], activatedAt } = res.data;
  const lang = I18n.getCurrent();
  const fmtDate = iso => new Date(iso).toLocaleDateString(lang);
  const fmtNum  = n => Number(n).toLocaleString(lang);
  const earned  = badges.filter(b => b.earned).length;
  // Obtenus d'abord (plus récents en tête), puis à obtenir (les plus avancés en tête)
  const sorted = [...badges].sort((a, b) => (b.earned - a.earned)
    || (a.earned ? String(b.earnedAt).localeCompare(String(a.earnedAt))
      : (b.progress.value / b.progress.target) - (a.progress.value / a.progress.target)));
  const cards = sorted.map(b => {
    const name = b.hidden ? t('badges.hidden') : _badgeText(b.names);
    const desc = b.hidden ? t('badges.hidden_desc') : _badgeText(b.descriptions);
    const icon = b.image ? `<img src="${escapeHtml(b.image)}" alt="" width="40" height="40" loading="lazy">` : escapeHtml(b.icon);
    let foot = '';
    if (b.earned) foot = `<div class="badge-date">${escapeHtml(t('badges.earned_on', { date: fmtDate(b.earnedAt) }))}</div>`;
    else if (b.progress) {
      const pct = Math.round((b.progress.value / b.progress.target) * 100);
      foot = `<div class="badge-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${b.progress.target}" aria-valuenow="${b.progress.value}"><span style="width:${pct}%"></span></div>`
        + `<div class="badge-progress">${escapeHtml(t('badges.progress', { value: fmtNum(b.progress.value), target: fmtNum(b.progress.target) }))}</div>`;
    }
    const tags = (b.event && !b.earned && b.event.endsAt ? `<span class="badge-tag">${escapeHtml(t('badges.event_until', { date: fmtDate(b.event.endsAt) }))}</span>` : '')
      + (b.archived ? `<span class="badge-tag">${escapeHtml(t('badges.archived'))}</span>` : '');
    return `<div class="badge-card${b.earned ? ' earned' : ''}">
      <div class="badge-icon" aria-hidden="true">${icon}</div>
      <div class="badge-body"><div class="badge-name">${escapeHtml(name)}</div>
        <div class="badge-desc">${escapeHtml(desc)}</div>${tags}${foot}</div></div>`;
  }).join('');
  el.innerHTML = `<p class="badges-note">${escapeHtml(t('badges.count', { n: earned, total: badges.length }))}`
    + (activatedAt ? ` · ${escapeHtml(t('badges.intro', { date: fmtDate(activatedAt) }))}` : '') + '</p>'
    + (badges.length ? `<div class="badges-grid">${cards}</div>` : `<p class="badges-note">${escapeHtml(t('badges.empty'))}</p>`);
}

// ── Rendu collection ──────────────────────────────────────────────────────────

function renderCollection() {
  const grid   = document.getElementById('collection-grid');
  const header = document.getElementById('collection-header');
  if (!grid) return;

  // Séries : en cours (permanentes ou de la saison du joueur) puis archives (#39).
  // Objet inactif non possédé : masqué. Série archivée : visible si le joueur en possède un objet.
  const owned = id => GameState.collection.includes(id);
  const groups = Collection.SERIES.map(series => ({
    series,
    archived: Collection.isArchived(series),
    items: Collection.FINDS.filter(f => (f.seriesId || 'origines') === series.id && (f.active !== false || owned(f.id))),
  })).filter(g => g.items.length && (!g.archived || g.items.some(f => owned(f.id)))
    && (g.series.active !== false || g.items.some(f => owned(f.id))));
  const current = groups.filter(g => !g.archived);

  const found = current.reduce((n, g) => n + g.items.filter(f => owned(f.id)).length, 0);
  const total = current.reduce((n, g) => n + g.items.length, 0);
  if (header) header.textContent = t('ui.collection_header', { found, total, s: found !== 1 ? 's' : '' });

  grid.innerHTML = '';
  let archivesTitle = false;
  for (const g of [...current, ...groups.filter(x => x.archived)]) {
    if (g.archived && !archivesTitle) {
      archivesTitle = true;
      const h = document.createElement('h3');
      h.className = 'collection-archives-title';
      h.textContent = t('collection.archives');
      grid.appendChild(h);
    }
    const section = document.createElement('section');
    section.className = 'collection-series';
    const title = document.createElement('h3');
    title.className = 'collection-series-title';
    const n = g.items.filter(f => owned(f.id)).length;
    const seasonInfo = g.series.seasonId != null ? Collection.SEASONS[g.series.seasonId] : null;
    title.textContent = `${g.series.icon || '📦'} ${Collection.seriesName(g.series)} · ${n}/${g.items.length}`
      + (seasonInfo ? ' · ' + seasonInfo.name : '');
    section.appendChild(title);
    const list = document.createElement('div');
    list.className = 'collection-series-grid';
    for (const find of g.items) {
      const isFound = owned(find.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `find-card${isFound ? ' found' : ''} find-rarity-${isFound ? find.rarity || 'commun' : 'unknown'}`;
      const icon = document.createElement('div');
      icon.className = 'find-icon';
      if (isFound && find.image) {
        const img = document.createElement('img');
        img.src = find.image; img.alt = ''; img.loading = 'lazy';
        icon.appendChild(img);
      } else {
        icon.textContent = isFound ? find.icon : '?';
      }
      const name = document.createElement('div');
      name.className = 'find-name';
      name.textContent = isFound ? Collection.displayName(find) : '???';
      card.append(icon, name);
      card.setAttribute('aria-label', isFound ? Collection.displayName(find) : t('collection.unknown_title'));
      card.addEventListener('click', () => showFindSheet(find, g.series));
      list.appendChild(card);
    }
    section.appendChild(list);
    grid.appendChild(section);
  }
}

/** Fiche détaillée d'un objet (#39) : grande image, nom, rareté, série/saison, date, quantité, histoire. */
function showFindSheet(find, series) {
  const modal = document.getElementById('find-modal');
  if (!modal) return;
  const isFound = GameState.collection.includes(find.id);
  const meta = (GameState.collectionMeta || {})[find.id] || null;
  const $ = id => document.getElementById(id);
  const art = $('find-modal-art');
  art.textContent = '';
  if (isFound && find.image) {
    const img = document.createElement('img');
    img.src = find.image; img.alt = Collection.displayName(find);
    art.appendChild(img);
  } else {
    art.textContent = isFound ? find.icon : '❔';
  }
  $('find-modal-title').textContent = isFound ? Collection.displayName(find) : t('collection.unknown_title');
  const rarity = $('find-modal-rarity');
  rarity.innerHTML = '';
  if (isFound) {
    const badge = document.createElement('span');
    badge.className = `rarity-badge rarity-${find.rarity || 'commun'}`;
    badge.textContent = t('rarity.' + (find.rarity || 'commun').replace('-', '_'));
    rarity.appendChild(badge);
  }
  const season = series && series.seasonId != null ? Collection.SEASONS[series.seasonId] : null;
  $('find-modal-series').textContent = series
    ? `${series.icon || '📦'} ${Collection.seriesName(series)}${season ? ' · ' + season.name : ''}` : '';
  const lang = I18n.getCurrent();
  let found = '';
  if (isFound && meta && Number.isFinite(meta.at)) {
    found = t('collection.found_on', { date: new Date(meta.at).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }) });
  } else if (isFound) {
    found = t('collection.found_before');
  }
  const qty = isFound ? Math.max(1, (meta && meta.n) || 1) : 0;
  $('find-modal-found').textContent = isFound ? `${found} · ${t('collection.quantity', { n: qty })}` : '';
  $('find-modal-story').textContent = isFound ? Collection.story(find)
    : t(Collection.isArchived(series) ? 'collection.unknown_archived' : 'collection.unknown_story');
  modal.hidden = false;
  const close = $('btn-find-modal-close');
  close.onclick = () => { modal.hidden = true; };
  modal.onclick = e => { if (e.target === modal) modal.hidden = true; };
  modal.onkeydown = e => { if (e.key === 'Escape') modal.hidden = true; };
  close.focus();
}

// ── Rendu quotidien ───────────────────────────────────────────────────────────

function renderDaily() {
  const container = document.getElementById('view-daily');
  if (!container) return;

  const today           = Daily.getToday();
  const yesterday       = Daily.getYesterday();
  const last            = GameState.daily.lastClaimDate;
  const lastDay         = GameState.daily.streakDay;
  const claimedToday    = (last === today);
  const streakContinues = (last === yesterday);
  const nextDay         = Daily.getNextDay();
  const available       = Daily.isAvailable();

  let html = `<div class="view-title-bar">${t('ui.view_daily')}</div><div class="daily-title">${t('ui.daily_title')}</div><div class="streak-row">`;
  for (let i = 1; i <= 7; i++) {
    let state;
    if (claimedToday) {
      state = i < lastDay ? 'done' : i === lastDay ? 'claimed-today' : 'upcoming';
    } else {
      const done = streakContinues && i < nextDay;
      state = done ? 'done' : i === nextDay ? 'available' : 'upcoming';
    }
    const r = Daily.REWARDS[i - 1];
    html += `
      <div class="streak-day ${state}">
        <div class="streak-circle">${(state === 'done' || state === 'claimed-today') ? '✓' : i}</div>
        <div class="streak-icon">${r.icon}</div>
      </div>`;
  }
  html += `</div>`;

  if (available) {
    const r = Daily.REWARDS[nextDay - 1];
    const parts = [];
    if (r.coins > 0) parts.push(t('ui.daily_reward_coins', { amount: r.coins, s: r.coins > 1 ? 's' : '' }));
    if (r.gems  > 0) parts.push(t('ui.daily_reward_gems',  { amount: r.gems,  s: r.gems  > 1 ? 's' : '' }));
    if (r.boost) parts.push(t('ui.daily_reward_boost', { mult: r.boost.mult, minutes: r.boost.minutes }));

    html += `
      <div class="daily-reward-box">
        <div class="daily-reward-day">${t('ui.daily_streak_day', { n: nextDay })}</div>
        <div class="daily-reward-items">${parts.join(' + ')}</div>
      </div>
      <button class="claim-btn" id="btn-claim">${t('ui.daily_btn_claim')}</button>`;
  } else {
    html += `
      <div class="daily-claimed-msg"><span class="claimed-check">✓</span>${t('ui.daily_claimed_msg')}</div>
      <div class="daily-next-msg">${t('ui.daily_next_msg')}</div>`;
  }

  // ── Section missions du jour ────────────────────────────────────────────
  html += `
    <div class="section-divider" style="margin-top:24px"><span>${t('ui.section_missions')}</span></div>
    <div id="daily-missions-list"></div>`;

  container.innerHTML = html;

  if (available) {
    document.getElementById('btn-claim').addEventListener('click', () => {
      const result = Daily.claim();
      if (!result) return;
      const { reward, day } = result;
      const parts = [];
      if (reward.coins > 0) parts.push(`💰 ${reward.coins}`);
      if (reward.gems  > 0) parts.push(`💎 ${reward.gems}`);
      if (reward.boost) parts.push(`⚡ ×${reward.boost.mult}`);
      showAchievement('📅', t('notif.daily_reward', { day, parts: parts.join(' + ') }));
      if (reward.boost) renderBoostBanner();
      renderDaily();      // reconstruit tout + missions
      renderStats();
      updateDailyBadge();
      Save.save();
      handleQuestsCompleted(Quests.checkAll());
    });
  }

  renderDailyMissions();   // injecte les cards dans #daily-missions-list
}

// ── Rendu reliques ────────────────────────────────────────────────────────────

function renderRelics() {
  const grid = document.getElementById('relics-grid');
  const info = document.getElementById('relics-info');
  if (!grid) return;

  const unlockedCount = Object.values(GameState.relics).filter(l => l >= 1).length;
  const totalCount    = Relics.DEFS.length;
  if (info) {
    info.textContent = t('ui.relic_header', {
      count: unlockedCount,
      total: totalCount,
      s1:    unlockedCount !== 1 ? 's' : '',
      frags: GameState.relicFragments,
      s2:    GameState.relicFragments !== 1 ? 's' : '',
    });
  }

  grid.innerHTML = '';

  for (const def of Relics.DEFS) {
    const level      = Relics.getLevel(def.id);
    const unlocked   = level >= 1;
    const maxed      = level >= def.maxLevel;
    const canUnlock  = Relics.canUnlock(def.id);
    const canUpgrade = Relics.canUpgrade(def.id);
    const nextCost   = Relics.getUpgradeCost(def.id);
    const isAffordable = !unlocked ? canUnlock : canUpgrade;

    const shortfall = !unlocked
      ? Math.max(0, (nextCost ?? 0) - GameState.relicFragments)
      : !maxed
        ? Math.max(0, (nextCost ?? 0) - GameState.relicFragments)
        : 0;

    const card = document.createElement('div');
    card.className = `relic-card${unlocked ? ' relic-unlocked' : isAffordable ? ' relic-affordable' : ''}`;
    card.title = t(def.desc);

    const levelChip = unlocked
      ? `<span class="relic-level">${t('relic.level_label', { cur: level, max: def.maxLevel })}</span>`
      : '';

    let actionHtml = '';
    if (!unlocked) {
      actionHtml = `
        <div class="relic-cost${canUnlock ? ' can-afford' : ''}">
          ${t('ui.relic_cost', { n: nextCost, s: nextCost > 1 ? 's' : '' })}
          ${!canUnlock ? `<span class="relic-shortfall">${t('ui.relic_shortfall', { n: shortfall })}</span>` : ''}
        </div>
        <button class="relic-unlock-btn" ${canUnlock ? '' : 'disabled'}
          aria-label="${canUnlock ? `${t('ui.btn_unlock')} ${t(def.name)}` : t('ui.relic_shortfall', { n: shortfall })}">
          ${t('ui.btn_unlock')}
        </button>`;
    } else if (maxed) {
      actionHtml = `<div class="relic-max-badge">${t('ui.btn_max')}</div>`;
    } else {
      actionHtml = `
        <div class="relic-cost${canUpgrade ? ' can-afford' : ''}">
          ${t('ui.relic_upgrade_cost', { n: nextCost, next: level + 1, s: nextCost > 1 ? 's' : '' })}
          ${!canUpgrade ? `<span class="relic-shortfall">${t('ui.relic_shortfall', { n: shortfall })}</span>` : ''}
        </div>
        <button class="relic-upgrade-btn" ${canUpgrade ? '' : 'disabled'}
          aria-label="${t('ui.btn_upgrade')} ${t(def.name)} ${t('relic.level_label', { cur: level + 1, max: def.maxLevel })}">
          ${t('ui.btn_upgrade')}
        </button>`;
    }

    card.innerHTML = `
      <div class="relic-icon">${def.icon}</div>
      <div class="relic-name">${t(def.name)}${levelChip}</div>
      <div class="relic-bonus">${Relics.formatBonus(def, level)}</div>
      ${actionHtml}`;

    const _clearBadgeIfNeeded = () => {
      if (!Relics.DEFS.some(r => Relics.canUnlock(r.id) || Relics.canUpgrade(r.id))) {
        clearNavBadge('collection');
      }
    };

    if (!unlocked && canUnlock) {
      card.querySelector('.relic-unlock-btn').addEventListener('click', () => {
        if (Relics.unlock(def.id)) {
          showAchievement('🔮', t('notif.relic_unlocked', { name: t(def.name) }));
          renderRelics();
          renderStats();
          _clearBadgeIfNeeded();
          Save.save();
        }
      });
    } else if (unlocked && !maxed && canUpgrade) {
      card.querySelector('.relic-upgrade-btn').addEventListener('click', () => {
        if (Relics.upgrade(def.id)) {
          showAchievement('🔮', t('notif.relic_upgraded', { name: t(def.name), n: Relics.getLevel(def.id) }));
          renderRelics();
          renderStats();
          _clearBadgeIfNeeded();
          Save.save();
        }
      });
    }

    grid.appendChild(card);
  }
}

// ── Badge Quotidien ───────────────────────────────────────────────────────────

/** Met à jour le badge "Quotidien" : visible si streak dispo OU mission réclamable. */
function updateDailyBadge() {
  if (Daily.isAvailable() || DailyMissions.hasUnclaimedCompleted()) {
    setNavBadge('daily');
  } else {
    clearNavBadge('daily');
  }
}

// ── Rendu missions quotidiennes ───────────────────────────────────────────────

function renderDailyMissions() {
  const list = document.getElementById('daily-missions-list');
  if (!list) return;

  DailyMissions.refresh();      // génère / actualise si nouveau jour

  list.innerHTML = '';
  const missions = GameState.dailyMissions.missions;

  missions.forEach((m, idx) => {
    const def = DailyMissions.getDef(m.id);
    if (!def) return;

    const progress = DailyMissions.getProgress(idx);
    const pct      = Math.min(100, m.target > 0 ? Math.round((progress / m.target) * 100) : 100);
    const done     = DailyMissions.isDone(idx);
    const claimed  = m.claimed;

    const rewardParts = [];
    if (m.reward.coins > 0) rewardParts.push(`💰\u202f${m.reward.coins}`);
    if (m.reward.gems  > 0) rewardParts.push(`💎\u202f${m.reward.gems}`);

    const card = document.createElement('div');
    card.className = `mission-card${claimed ? ' mission-claimed' : done ? ' mission-done' : ''}`;
    card.innerHTML = `
      <div class="mission-header">
        <span class="mission-icon">${def.icon}</span>
        <div class="mission-info">
          <div class="mission-name">${t(def.name)}</div>
          <div class="mission-desc">${def.descFn(m.target)}</div>
        </div>
        <div class="mission-count">${claimed ? '✓' : t('ui.mission_progress', { done: progress, target: m.target })}</div>
      </div>
      <div class="mission-progress-wrap">
        <div class="mission-progress-bar" style="width:${pct}%"></div>
      </div>
      <div class="mission-footer">
        <div class="mission-reward-text">${t('ui.mission_reward')} <span>${rewardParts.join(' + ')}</span></div>
        <button class="mission-claim-btn${claimed ? ' mission-claimed-btn' : ''}"
          ${(!done || claimed) ? 'disabled' : ''}
          aria-label="${claimed ? t('ui.mission_claimed') : t('ui.btn_mission_claim_aria', { reward: rewardParts.join(' + ') })}">
          ${claimed ? t('ui.mission_claimed') : t('ui.btn_mission_claim')}
        </button>
      </div>`;

    if (done && !claimed) {
      card.querySelector('.mission-claim-btn').addEventListener('click', () => {
        const reward = DailyMissions.claim(idx);
        if (!reward) return;
        const parts = [];
        if (reward.coins > 0) parts.push(`💰 ${reward.coins}`);
        if (reward.gems  > 0) parts.push(`💎 ${reward.gems}`);
        showAchievement('🎯', t('notif.mission_done', { parts: parts.join(' + ') }));
        renderDailyMissions();
        renderStats();
        updateDailyBadge();
        Save.save();
      });
    }

    list.appendChild(card);
  });
}

// ── API comptes ───────────────────────────────────────────────────────────────

async function _apiFetch(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

/** Relit le compte connecté (adresse e-mail, vérification) et la disponibilité des e-mails. */
async function _loadAccount() {
  const { ok, data } = await _apiFetch('GET', '/api/me');
  _account     = ok ? (data.user ?? null) : null;
  _mailEnabled = ok && !!data.mail;
  _social      = ok ? (data.social ?? null) : null;
}

async function _fetchMe() {
  try {
    await _loadAccount();
    // Retour de connexion Google : même chemin qu'une connexion explicite (#18, #28)
    if (_account) await _syncAfterLogin(_socialResult === 'ok');
  } catch (_) {
    _account = null;
  }
  if (isViewActive('settings')) renderSettings();
  // Initialise seasonId et CPS limit même sans compte connecté
  _pollSeason();
  _loadChestCatalog();   // probabilités des coffres (fenêtre des chances, tirage anonyme, #20)
}

async function _doRegister(username, email, password) {
  const { ok, data } = await _apiFetch('POST', '/api/register', { username, email, password });
  if (ok) { _account = data.user; return null; }
  return data.error || t('account.err_generic');
}

async function _doLogin(username, password) {
  const { ok, data } = await _apiFetch('POST', '/api/login', { username, password });
  if (ok) { _account = data.user; return null; }
  return data.error || t('account.err_generic');
}

/**
 * Liens reçus par e-mail (#28) : ?verify=… confirme l'adresse, ?reset=… ouvre le formulaire
 * de nouveau mot de passe. Le jeton est retiré de l'adresse aussitôt (historique, partage).
 */
function _handleAccountLinks() {
  const params = new URLSearchParams(location.search);
  const verify = params.get('verify');
  const reset  = params.get('reset');
  const social = params.get('social');
  if (!verify && !reset && !social) return;
  params.delete('verify');
  params.delete('reset');
  params.delete('social');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);

  // Retour de connexion Google (#28) : message, puis retour dans Paramètres → Compte.
  if (social && /^[a-z]{1,20}$/.test(social)) {
    _socialResult = social;
    if (social === 'linked') { try { localStorage.setItem(SOCIAL_SEEN_KEY, '1'); } catch (_) {} }
    const good = social === 'ok' || social === 'linked';
    const key  = `account.social_msg_${social}`;
    showAchievement(good ? '🔗' : (social === 'pending' ? '👤' : '⚠️'), t(key) !== key ? t(key) : t('account.social_msg_error'));
    switchView('settings');   // le parcours Google part toujours de Paramètres → Compte
  }
  if (reset) {
    _resetToken = reset;
    _accountTab = 'reset';
    switchView('settings');
  }
  if (verify) {
    _apiFetch('POST', '/api/auth/email/verify', { token: verify, lang: I18n.getCurrent() })
      .then(({ ok, data }) => {
        showAchievement(ok ? '✉️' : '⚠️', ok ? t('account.verify_ok') : (data.error || t('account.verify_fail')));
        if (ok && _account) { _account.email = data.email; _account.emailVerified = true; }
        if (isViewActive('settings')) renderSettings();
      })
      .catch(() => showAchievement('⚠️', t('account.verify_fail')));
  }
}

async function _doLogout() {
  // Dernier envoi de la progression, puis purge locale : le compte suivant part
  // d'une sauvegarde vierge (#18).
  Save.save();
  await _syncToCloud();
  await _apiFetch('POST', '/api/logout', { controllerId: _tabId });
  _account    = null;
  _cloudReady = false;
  _clearCloudMeta();
  Save.purge();
  NotifLog.clear();   // appareil partagé : le joueur suivant ne voit pas l'historique (#26)
  _refreshAllAfterReset();
  _pollSeason();
}

// ── Sauvegarde cloud regroupée ────────────────────────────────────────────────
// La sauvegarde locale reste immédiate (à chaque clic) ; le cloud reçoit au plus une
// sauvegarde toutes les CLOUD_SYNC_INTERVAL_MS, plus une sauvegarde finale quand l'onglet
// est masqué ou fermé (fetch keepalive).
//
// Révision serveur (#18) : chaque écriture cloud augmente la révision de la sauvegarde.
// Le client envoie la révision sur laquelle il travaille (baseRevision) ; si la sauvegarde
// a changé entre-temps (autre appareil, coffre, reset admin), le serveur refuse (409) et
// renvoie la version actuelle, que le client applique au lieu de l'écraser.

const CLOUD_SYNC_INTERVAL_MS = 12_000;
const CLOUD_META_KEY = 'dig_cloud_meta'; // { userId, revision } : révision connue de la save locale
let _cloudLastSync  = 0;     // horodatage du dernier envoi cloud
let _cloudTimer     = null;  // envoi différé en attente
let _cloudLastExit  = 0;     // dernier envoi de sortie (évite le doublon visibilitychange + pagehide)
let _cloudReady     = false; // true une fois la synchro de connexion faite (pas d'envoi avant)
let _cloudChain     = Promise.resolve(); // envois cloud sérialisés
let _lastSentSaveTime = null; // lastSaveTime du dernier envoi (reconnaît notre propre écriture)

function _getCloudMeta() {
  try { return JSON.parse(localStorage.getItem(CLOUD_META_KEY)) ?? null; } catch (_) { return null; }
}
function _setCloudMeta(revision) {
  if (!_account) return;
  try { localStorage.setItem(CLOUD_META_KEY, JSON.stringify({ userId: _account.id, revision })); } catch (_) {}
}
function _clearCloudMeta() {
  try { localStorage.removeItem(CLOUD_META_KEY); } catch (_) {}
}
/** Révision serveur de la save locale pour le compte connecté (null : aucune connue). */
function _baseRevision() {
  const meta = _getCloudMeta();
  return (meta && _account && meta.userId === _account.id) ? meta.revision ?? null : null;
}

/** Appelé après chaque sauvegarde locale : programme un envoi cloud (au plus 1 par intervalle). */
function _scheduleCloudSync() {
  if (_cloudTimer || !_cloudReady) return;
  const wait = Math.max(0, _cloudLastSync + CLOUD_SYNC_INTERVAL_MS - Date.now());
  _cloudTimer = setTimeout(() => {
    showSaveToast();
    _syncToCloud();
  }, wait);
}

/**
 * Pousse la sauvegarde locale courante vers le cloud (silencieux, envois sérialisés).
 * @returns {Promise<'ok'|'adopted'|'skipped'|'error'>}  'adopted' = la version serveur a été appliquée
 */
function _syncToCloud() {
  clearTimeout(_cloudTimer);
  _cloudTimer    = null;
  _cloudLastSync = Date.now();
  const run = _cloudChain.then(() => _pushSave(true)).then(_noteCloudResult);
  _cloudChain = run.catch(() => {});
  return run;
}

/** Historique (#26) : un seul message à la première erreur d'envoi, un autre à la reprise. */
let _cloudFailing = false;
function _noteCloudResult(result) {
  if (result === 'error' && !_cloudFailing) {
    _cloudFailing = true;
    NotifLog.add({ icon: '⚠️', type: 'warning', text: t('notif.cloud_save_error') });
  } else if ((result === 'ok' || result === 'adopted') && _cloudFailing) {
    _cloudFailing = false;
    NotifLog.add({ icon: '☁️', type: 'success', text: t('notif.cloud_save_restored') });
  }
  return result;
}

async function _pushSave(retry) {
  if (!_account || !_cloudReady || Save.disabled) return 'skipped';
  const raw = localStorage.getItem(Save.KEY);
  if (!raw) return 'skipped';
  const data = JSON.parse(raw);
  _lastSentSaveTime = data.lastSaveTime ?? null;
  const tele = _teleSnapshot();
  let res;
  try {
    res = await _apiFetch('POST', '/api/me/save', { data, baseRevision: _baseRevision(), telemetry: _telePayload(tele), controllerId: _tabId });
  } catch (_) { return 'error'; }
  if (res.ok) {
    _teleConsume(tele);
    _setCloudMeta(res.data.revision);
    if (Array.isArray(res.data.badgesEarned) && res.data.badgesEarned.length) _onBadgesEarned(res.data.badgesEarned);
    _refreshSeasonView();   // onglet Saison ouvert : chiffres serveur à jour après la sauvegarde
    return 'ok';
  }
  // Un autre appareil a la main : reprise automatique s'il ne joue plus (bail expiré), sinon verrou
  if (res.status === 409 && res.data?.notController) { _playHeartbeat(true); return 'locked'; }
  if (res.status === 409 && res.data?.conflict) return _handleSaveConflict(res.data.save, retry);
  if (res.status === 401) { _account = null; _cloudReady = false; }
  return 'error';
}

/**
 * Sauvegarde refusée car obsolète. Si la version serveur est notre propre dernier envoi
 * (réponse perdue, envoi de sortie), on reprend sa révision et on renvoie ; sinon on
 * applique la version serveur et on prévient le joueur.
 */
async function _handleSaveConflict(serverSave, retry) {
  if (!serverSave) { _clearCloudMeta(); return retry ? _pushSave(false) : 'error'; }
  const serverTime = serverSave.data?.lastSaveTime ?? null;
  if (retry && serverTime !== null && serverTime === _lastSentSaveTime) {
    _setCloudMeta(serverSave.revision);
    return _pushSave(false);
  }
  _applyCloudSave(serverSave);
  showAchievement('☁️', t('notif.save_conflict'));
  return 'adopted';
}

/** Applique une sauvegarde cloud ({ data, revision }) au jeu et à la save locale. */
function _applyCloudSave(cloudSave) {
  const cloudData = cloudSave.data;
  Save.loadFromData(cloudData);
  Relics.applyBonuses();
  // Bloc sauvegardé repris à l'identique (#35), sans animation (évite le double-spawn)
  blockAnimating = false;
  Blocks.resume(Save.loadedBlock, GameState.depth);
  // Même sérialisation que Save.save() (seasonStats, shopChestsBought et bloc compris)
  Save.writeLocal(cloudData.lastSaveTime ?? Date.now());
  _setCloudMeta(cloudSave.revision ?? cloudSave.version);

  renderUpgrades();
  renderShopChests();
  renderQuests();
  renderBoostBanner();
  renderStats();
  renderBlock();
}

/** Sauvegarde finale à la mise en arrière-plan / fermeture de l'onglet. */
function _flushCloudOnExit() {
  if (Save.disabled) return;
  if (Date.now() - _cloudLastExit < 1000) return;
  _cloudLastExit = Date.now();
  Save.save(); // état local à jour (programme aussi un envoi, annulé ci-dessous)
  clearTimeout(_cloudTimer);
  _cloudTimer    = null;
  _cloudLastSync = Date.now();
  if (!_account || !_cloudReady) return;
  try {
    const raw = localStorage.getItem(Save.KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    _lastSentSaveTime = data.lastSaveTime ?? null;
    const tele = _teleSnapshot();
    const body = JSON.stringify({ data, baseRevision: _baseRevision(), telemetry: _telePayload(tele), controllerId: _tabId });
    // keepalive survit à la fermeture de la page ; si l'onglet reste ouvert, la réponse
    // met à jour la révision connue.
    fetch('/api/me/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
    }).then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.revision) { _teleConsume(tele); _setCloudMeta(d.revision); } })
      .catch(() => {});
  } catch (_) { /* silencieux */ }
}

/**
 * Synchronise avec le cloud après login/register ou restauration de session.
 * @param {boolean} forceCloud  true = connexion explicite → toujours appliquer le cloud.
 *                              false = restauration de session → comparer les révisions.
 */
async function _syncAfterLogin(forceCloud = false) {
  _cloudReady = false;
  try {
    // Cette page prend la main sur le compte (#35) : les autres onglets et appareils
    // cessent de miner. La réponse contient la sauvegarde serveur à reprendre.
    let claimed = null;
    try { claimed = await _apiFetch('POST', '/api/me/play/claim', { controllerId: _tabId }); } catch (_) {}
    const { ok, data } = claimed?.ok ? claimed : await _apiFetch('GET', '/api/me/save');
    if (!ok || !_account || Save.disabled) return;

    const cloud = data.save;
    const meta  = _getCloudMeta();
    let adopt = false;

    if (cloud) {
      const revision = cloud.revision ?? cloud.version;
      if (forceCloud) {
        adopt = true;
      } else if (meta && meta.userId === _account.id) {
        // La save locale continue la révision `meta.revision` de ce compte :
        // si le serveur a avancé depuis (autre appareil, reset admin), il gagne.
        adopt = revision !== meta.revision;
      } else if (meta) {
        adopt = true; // save locale d'un autre compte
      } else {
        // Save locale sans révision (avant #18) : comparaison des dates, comme avant
        const localRaw  = localStorage.getItem(Save.KEY);
        const localTime = localRaw ? (JSON.parse(localRaw)?.lastSaveTime ?? 0) : 0;
        adopt = (cloud.data?.lastSaveTime ?? 0) > localTime;
        if (!adopt) _setCloudMeta(revision);
      }
      if (adopt) {
        _applyCloudSave(cloud);
        // Reprise silencieuse (autre appareil, « Jouer ici ») : gardée dans l'historique (#26)
        if (!forceCloud) NotifLog.add({ icon: '☁️', type: 'info', text: t('notif.cloud_resumed') });
      }
    } else {
      _clearCloudMeta(); // aucune sauvegarde cloud : la save locale devient celle du compte
    }
    _hasShownGuestWarning = true; // connecté → plus besoin d'avertir
    _cloudReady = true;
    if (!adopt) {
      // Local plus récent (ou pas de cloud) → pousser ; état vierge écrit si aucune save locale
      if (!localStorage.getItem(Save.KEY)) Save.writeLocal();
      await _syncToCloud();
    }
  } catch (_) { /* silencieux */ }
}

// ── Onglet unique (#18) ───────────────────────────────────────────────────────
// Deux onglets du même navigateur partagent la même save locale : le dernier ouvert
// prend la main, les autres cessent d'écrire et affichent un écran « Jouer ici ».

const ACTIVE_TAB_KEY = 'dig_active_tab';
const _tabId = Math.random().toString(36).slice(2) + Date.now().toString(36);

function _claimActiveTab() {
  try { localStorage.setItem(ACTIVE_TAB_KEY, `${_tabId}:${Date.now()}`); } catch (_) {}
}

function _onStorageEvent(e) {
  if (e.key !== ACTIVE_TAB_KEY || !e.newValue || Save.disabled) return;
  if (e.newValue.split(':')[0] === _tabId) return;
  _lockPlay('tab');
}

/**
 * Cette page perd la main (autre onglet de ce navigateur, ou autre appareil — #35) : plus de
 * clics, plus d'Auto-Dig, plus aucune écriture (ni locale, ni cloud). Le compte reste connecté ;
 * « Jouer ici » recharge la page, qui reprend la main et la progression du serveur.
 */
function _lockPlay(reason) {
  clearTimeout(_cloudTimer);
  _cloudTimer = null;
  Save.disabled = true;
  const device = reason === 'device';
  NotifLog.add({ icon: device ? '📱' : '🗂️', type: 'warning', text: t(device ? 'ui.device_inactive_title' : 'ui.tab_inactive_title') });
  const modal = document.getElementById('tab-inactive-modal');
  if (!modal) return;
  document.getElementById('tab-inactive-icon').textContent = device ? '📱' : '🗂️';
  document.getElementById('tab-inactive-title').textContent = t(device ? 'ui.device_inactive_title' : 'ui.tab_inactive_title');
  document.getElementById('tab-inactive-text').textContent  = t(device ? 'ui.device_inactive_text' : 'ui.tab_inactive_text');
  modal.hidden = false;
}

// ── Session de jeu unique entre appareils (#35) ──────────────────────────────
// Le serveur ne connaît qu'un contrôleur par compte (la dernière page qui a pris la main).
// Le contrôleur actif signale sa présence ; une page qui a perdu la main l'apprend au plus
// tard au signal suivant (ou dès sa sauvegarde refusée) et se verrouille. Si plus personne ne
// joue (bail expiré : onglet fermé, appareil éteint), elle reprend la main d'elle-même et relit
// la sauvegarde serveur avant de continuer.

const PLAY_HEARTBEAT_MS = 15_000;
let _heartbeatBusy = false;

async function _playHeartbeat(force = false) {
  if (_heartbeatBusy || !_account || !_cloudReady || Save.disabled) return;
  if (!force && document.visibilityState !== 'visible') return;
  _heartbeatBusy = true;
  try {
    const { ok, data } = await _apiFetch('POST', '/api/me/play/heartbeat', { controllerId: _tabId });
    if (!ok || data.active || Save.disabled) return;
    if (data.canResume) {
      const claim = await _apiFetch('POST', '/api/me/play/claim', { controllerId: _tabId, onlyIfFree: true });
      if (claim.ok) { await _syncAfterLogin(false); return; }
    }
    _lockPlay('device');
  } catch (_) { /* réseau indisponible : le serveur refusera de toute façon les écritures */ }
  finally { _heartbeatBusy = false; }
}

// ── Saisons ───────────────────────────────────────────────────────────────────

/** Applique le reset de début de saison (côté client). */
function _applySeasonReset(newSeasonId, gemsCap) {
  GameState.coins           = 0;
  GameState.gems            = Math.min(GameState.gems, gemsCap);
  GameState.coinBoost       = { multiplier: 1, expiresAt: 0 };
  DailyMissions.rebase('depth', 1);   // garde la progression du jour (B11)
  GameState.depth           = 1;
  GameState.pickaxeLevel    = 1;
  GameState.damage          = 1;
  GameState.upgrades         = { luck: 0, bag: 0, autodig: 0, fragment_shop: 0, block_reroll: 0 };
  GameState.shopChestsBought = { simple: 0, rare: 0, antique: 0 };
  GameState.seasonStats      = { seasonId: newSeasonId, maxDepth: 0, manualBlocks: 0, autoBlocks: 0, manualClicks: 0, suspiciousScore: 0, regularityScore: 0, isActive: false };
  _clickTimestamps.length   = 0;   // reset du buffer d'intervalles
  _clickLog.length          = 0;   // reset du buffer CPS
  // Recalcule damage = pickaxeLevel (1) + relicBonuses.damageFlat (permanent)
  // et recompute tous les relicBonuses depuis GameState.relics (inchangé).
  Relics.applyBonuses();
  Save.save();
  renderStats();
  renderUpgrades();
  renderShopChests();
  renderBoostBanner();
  blockAnimating = false;
  Blocks.spawn(GameState.depth);
  renderBlock();
  showAchievement('🏆', t('season.new_season'));
}

/** Paramètres économiques de l'admin (#20) : redessine ce qui affiche un coût ou un gain. */
function _applyServerEconomy(eco) {
  if (!Balance.applyEconomy(eco)) return;
  renderUpgrades();
  renderShopChests();
  if (!blockAnimating) renderBlock();   // gain affiché du bloc courant
}

/** Rotation : nouvelle synchronisation ~1 min après la fin (le planificateur passe chaque minute). */
let _seasonEndTimer = null;
function _scheduleSeasonEndPoll(diffMs) {
  if (_seasonEndTimer) clearTimeout(_seasonEndTimer);
  _seasonEndTimer = null;
  if (!(diffMs > -60_000) || diffMs > 6 * 3_600_000) return;
  _seasonEndTimer = setTimeout(() => {
    _seasonEndTimer = null;
    _pollSeason().then(() => { if (isViewActive('season')) _openSeasonView(); });
  }, Math.max(0, diffMs) + 75_000);
}

/** Polling toutes les 5 min : détecte un changement de saison. */
async function _pollSeason() {
  try {
    const { ok, data } = await _apiFetch('GET', '/api/seasons/current');
    if (!ok || !data.season) return;
    _seasonCpsLimit = data.config?.cpsLimit ?? 8;
    _applyServerEconomy(data.config?.economy);
    if (data.season.id !== GameState.seasonStats.seasonId && GameState.seasonStats.seasonId !== 0) {
      _applySeasonReset(data.season.id, data.config?.gemsCap ?? 100);
    } else if (GameState.seasonStats.seasonId === 0 && data.season.id) {
      // Premier sync : on enregistre juste l'ID sans reset
      GameState.seasonStats.seasonId = data.season.id;
    }
    if (isViewActive('season')) renderSeasonView(data);
  } catch (err) { console.warn('[saison] synchronisation impossible', err); }
}

// ── Rendu vue Saison ─────────────────────────────────────────────────────────

/**
 * @param {object} apiData    Réponse de GET /api/seasons/current
 * @param {object} [lbData]   Classement déjà chargé (actualisation : pas d'écran de chargement)
 */
function renderSeasonView(apiData, lbData) {
  const el = document.getElementById('view-season');
  if (!el) return;

  if (!apiData) {
    el.innerHTML = `<div class="view-title-bar">${t('season.title')}</div>
      <p class="season-loading">${t('season.loading')}</p>`;
    return;
  }

  const { season, config, player } = apiData;
  const endDate  = new Date(season.endAt + (season.endAt.includes('Z') ? '' : 'Z'));
  const diffMs   = endDate - Date.now();
  const diffDays = Math.max(0, Math.floor(diffMs / 86_400_000));
  const diffHrs  = Math.max(0, Math.floor((diffMs % 86_400_000) / 3_600_000));
  const diffMin  = Math.max(0, Math.floor((diffMs % 3_600_000) / 60_000));
  // Dernières 24 h : heures et minutes (fin exceptionnelle #44) ; date de fin en heure locale
  const endsIn   = (diffDays ? t('season.ends_in', { d: diffDays, h: diffHrs }) : t('season.ends_in_hm', { h: diffHrs, m: diffMin }))
    + ' · ' + t('season.ends_at', { date: escapeHtml(endDate.toLocaleString(I18n.getCurrent(), { dateStyle: 'medium', timeStyle: 'short' })) });
  _scheduleSeasonEndPoll(diffMs);

  let playerHtml = '';
  if (!_account) {
    playerHtml = `<p class="season-hint">${t('season.not_connected')}</p>`;
  } else if (!player || !player.isActive) {
    playerHtml = `<p class="season-hint">${t('season.not_active')}</p>`;
  } else {
    const leagueBadge = player.league
      ? `<span class="season-league-badge">${escapeHtml(player.league.icon)} ${escapeHtml(player.league.name)}</span>`
      : `<span class="season-league-badge muted">${t('season.no_league')}</span>`;
    playerHtml = `
      <div class="season-player-card">
        <div class="season-player-card-top">
          <div class="season-player-rank">${t('season.rank', { n: escapeHtml(player.rank ?? '?') })}</div>
          ${leagueBadge}
        </div>
        <div class="season-player-stats">
          <span>⛏ ${t('season.depth_label')} : <strong>${escapeHtml(player.maxDepth)}m</strong></span>
          <span>👆 ${t('season.blocks_label')} : <strong>${escapeHtml(player.manualBlocks)}</strong></span>
        </div>
      </div>`;
  }

  // Section info saison (collapsible) — reste ouverte lors d'une actualisation
  const infoOpen = el.querySelector('.season-info-card')?.open ? ' open' : '';
  const infoHtml = `
    <details class="season-info-card"${infoOpen}>
      <summary class="season-info-toggle">${t('season.info.toggle')}</summary>
      <div class="season-info-body">
        <p class="season-info-intro">${t('season.info.intro')}</p>
        <div class="season-info-grid">
          <div class="season-info-col season-info-col-reset">
            <div class="season-info-col-title">${t('season.info.reset_title')}</div>
            <ul class="season-info-list">
              <li>💰 ${t('season.info.r_coins')}</li>
              <li>⛏ ${t('season.info.r_depth')}</li>
              <li>⬆ ${t('season.info.r_upgrades')}</li>
              <li>⚡ ${t('season.info.r_boosts')}</li>
              <li>🏆 ${t('season.info.r_rank')}</li>
            </ul>
          </div>
          <div class="season-info-col season-info-col-kept">
            <div class="season-info-col-title">${t('season.info.kept_title')}</div>
            <ul class="season-info-list">
              <li>💎 ${t('season.info.k_gems')}</li>
              <li>🔮 ${t('season.info.k_frags')}</li>
              <li>✨ ${t('season.info.k_relics')}</li>
              <li>🎁 ${t('season.info.k_bonuses')}</li>
              <li>🏅 ${t('season.info.k_points')}</li>
            </ul>
          </div>
        </div>
        <div class="season-info-col-title">${t('season.merit.title')}</div>
        <ul class="season-info-list season-merit-list">
          <li>${t('season.merit.join')}</li>
          <li>${t('season.merit.order')}</li>
          <li>${t('season.merit.freeze', { date: escapeHtml(_fmtUtc(season.endAt, { dateStyle: 'medium', timeStyle: 'short' })) })}</li>
          <li>${t('season.merit.points')}</li>
        </ul>
      </div>
    </details>`;

  // Charger le leaderboard
  const lbId = 'season-lb-body';
  const scrollTop = el.scrollTop;
  el.innerHTML = `
    <div class="view-title-bar">${t('season.title')} — ${escapeHtml(season.name)}</div>
    <p class="season-ends-in">${endsIn}</p>
    ${playerHtml}
    <div id="season-last">${_lastResultHtml()}</div>
    <div id="season-points">${_pointsHtml()}</div>
    <div id="season-shop">${_shopHtml()}</div>
    ${infoHtml}
    <h3 class="season-section-title">${t('season.leaderboard')}</h3>
    <div class="season-leaderboard" id="${lbId}">
      ${lbData ? _leaderboardHtml(lbData) : `<p class="season-loading">${t('season.loading')}</p>`}
    </div>`;
  el.scrollTop = scrollTop;

  if (!lbData) _loadLeaderboard(season.id, lbId);
  if (!_pointsData && _account) _loadPoints();
  if (!_lastResult) _loadLastResult();
}

/** Date UTC du serveur (« AAAA-MM-JJ hh:mm:ss[.mmm] ») affichée en heure locale. */
function _fmtUtc(v, opts = { dateStyle: 'medium' }) {
  const x = new Date(String(v ?? '').replace(' ', 'T') + (String(v ?? '').includes('Z') ? '' : 'Z'));
  return isNaN(x) ? String(v ?? '') : x.toLocaleString(I18n.getCurrent(), opts);
}

/** Message d'erreur de l'onglet Saison, avec bouton « Réessayer ». */
function _seasonErrorHtml() {
  return `<p class="season-error" role="alert">${t('season.error')}
    <button type="button" class="season-retry-btn" data-season-retry>${t('season.retry')}</button></p>`;
}

// ── Résultat figé de la saison précédente (#29, #31) ─────────────────────────

let _lastResult = null;   // { state: 'ok', data } | { state: 'none' } | { state: 'error' }

async function _loadLastResult() {
  try {
    const res = await _apiFetch('GET', '/api/seasons/last/standings');
    _lastResult = res.ok ? { state: 'ok', data: res.data } : res.status === 404 ? { state: 'none' } : { state: 'error' };
  } catch (_) { _lastResult = { state: 'error' }; }
  const el = document.getElementById('season-last');
  if (el) el.innerHTML = _lastResultHtml();
}

function _lastResultHtml() {
  const r = _lastResult;
  if (!r || r.state === 'none') return '';
  if (r.state === 'error') return `<div class="last-card">${_seasonErrorHtml()}</div>`;
  const { season, snapshot, standings, me } = r.data;
  const n = v => Number(v).toLocaleString(I18n.getCurrent());
  const open = document.querySelector('#season-last .last-proof')?.open ? ' open' : '';

  const podium = standings.filter(x => x.eligible && x.rank <= 3).map(x => {
    const medal = ['🥇', '🥈', '🥉'][x.rank - 1];
    const isMe  = me && x.userId === me.userId;
    return `<li class="${isMe ? 'last-me' : ''}"><span><span aria-hidden="true">${medal}</span>
        <span class="sr-only">${t('season.last.rank_sr', { n: n(x.rank) })}</span>
        ${x.league ? `<span aria-hidden="true">${escapeHtml(x.league.icon)}</span>` : ''}${escapeHtml(x.username ?? t('season.last.deleted'))}</span>
      <span class="points-num">${t('season.last.depth', { n: n(x.maxDepth) })}</span></li>`;
  }).join('');

  let mine;
  if (!_account)           mine = '';
  else if (!me)            mine = t('season.last.me_absent');
  else if (!me.eligible)   mine = t('season.last.me_ineligible');
  else {
    const award = (_pointsData?.awards ?? []).find(a => a.seasonId === season.id && (a.mode === 'live' || _pointsData.mode !== 'live'));
    const pts = !award ? '' : award.mode === 'live'
      ? ' · ' + t('season.last.me_points', { n: n(award.points) })
      : ' · ' + t('season.last.me_points_sim', { n: n(award.points) });
    mine = t('season.last.me_rank', { rank: n(me.rank), n: n(snapshot.eligible), depth: n(me.maxDepth) }) + pts;
  }

  return `
    <section class="points-card last-card" aria-labelledby="last-title">
      <div class="points-head">
        <h3 class="points-title" id="last-title">${t('season.last.title', { name: escapeHtml(season.name ?? '') })}</h3>
      </div>
      <p class="points-note">${t('season.last.frozen', { date: escapeHtml(_fmtUtc(snapshot.createdAt, { dateStyle: 'medium', timeStyle: 'short' })), p: n(snapshot.participants), e: n(snapshot.eligible) })}</p>
      ${snapshot.eligible ? `<ol class="points-list last-podium" aria-label="${t('season.last.podium')}">${podium}</ol>`
        : `<p class="points-empty">${t('season.last.nobody')}</p>`}
      ${mine ? `<p class="points-potential last-mine">${mine}</p>` : ''}
      <details class="points-details last-proof"${open}>
        <summary>${t('season.last.proof_toggle')}</summary>
        <p class="points-note">${t('season.last.proof_text')}</p>
        <p class="points-note">${t('season.last.hash')} <code class="last-hash">${escapeHtml(snapshot.hash)}</code></p>
        <p class="points-note"><a href="/api/seasons/${encodeURIComponent(season.id)}/standings" target="_blank" rel="noopener">${t('season.last.proof_link')}</a></p>
      </details>
    </section>`;
}

// ── Points de récompense saisonniers (#33) ───────────────────────────────────

let _pointsData = null;   // dernière réponse de GET /api/points/me (joueur connecté)

async function _loadPoints() {
  if (!_account) { _pointsData = null; _shopData = null; return; }
  try {
    const [pts, cat, mine] = await Promise.all([
      _apiFetch('GET', '/api/points/me'), _apiFetch('GET', '/api/shop'), _apiFetch('GET', '/api/shop/me'),
    ]);
    _pointsData = pts.ok ? pts.data : null;
    _shopData   = cat.ok && mine.ok ? { ...cat.data, ...mine.data } : null;
    const el = document.getElementById('season-points');
    if (el) el.innerHTML = _pointsHtml();
    const sh = document.getElementById('season-shop');
    if (sh) sh.innerHTML = _shopHtml();
    const last = document.getElementById('season-last');
    if (last) last.innerHTML = _lastResultHtml();
  } catch (_) {}
}

/** Libellé traduit d'une catégorie du barème (construit depuis sa règle, pas le libellé serveur). */
function _tierLabel(tier) {
  if (!tier) return '';
  if (tier.rankMax === 1)  return t('points.tier_rank', { n: 1 });
  if (tier.rankMax)        return t('points.tier_ranks', { n: tier.rankMax });
  if (tier.percentMax)     return t('points.tier_pct', { p: tier.percentMax.toLocaleString(I18n.getCurrent()) });
  return t('points.tier_active');
}

function _pointsHtml() {
  const d = _pointsData;
  if (!_account || !d) return '';
  const n = v => Number(v).toLocaleString(I18n.getCurrent());
  const tiers = d.scale?.tiers ?? [];
  const tierById = Object.fromEntries(tiers.map(x => [x.id, x]));
  const open = sel => document.querySelector(`#season-points ${sel}`)?.open ? ' open' : '';

  const pot = d.potential;
  const potHtml = pot && pot.rank && pot.points > 0
    ? t('points.potential', { rank: n(pot.tied ? pot.tieRank : pot.rank) + (pot.tied ? ` (${t('points.tied')})` : ''), n: n(pot.eligibleCount), tier: escapeHtml(_tierLabel(tierById[pot.tier])), pts: n(pot.points) })
    : t('points.potential_none');

  const scaleRows = tiers.map(x => `
      <tr><td>${escapeHtml(_tierLabel(x))}${x.minEligible > 1 ? ` <span class="points-min">(${t('points.tier_min', { n: n(x.minEligible) })})</span>` : ''}</td>
          <td class="points-num">${t('points.pts', { n: n(x.points) })}</td></tr>`).join('');
  const notes = [d.scale?.tiesShareTier ? t('points.ties_note') : '',
    d.scale?.leagueBonusPctPerLevel ? t('points.league_note', { p: n(d.scale.leagueBonusPctPerLevel) }) : '']
    .filter(Boolean).map(x => `<p class="points-note">${x}</p>`).join('');

  // Historique : mouvements du portefeuille, puis attributions simulées (non créditées)
  const items = [
    ...(d.history ?? []).map(h => ({
      label: t(`points.k_${h.kind}`) + (h.seasonName ? ` — ${escapeHtml(h.seasonName)}` : ''),
      delta: h.delta, sim: false })),
    ...(d.awards ?? []).filter(a => a.mode === 'simulation' && d.mode !== 'live').map(a => ({
      label: `${escapeHtml(a.seasonName ?? '')} — #${n(a.rank)}/${n(a.eligibleCount)}`,
      delta: a.points, sim: true })),
  ];
  const histHtml = items.length
    ? items.map(i => `<li><span>${i.label}${i.sim ? ` <em class="points-sim">(${t('points.sim_award')})</em>` : ''}</span>
        <span class="points-num ${i.delta < 0 ? 'neg' : 'pos'}">${i.delta > 0 ? '+' : ''}${t('points.pts', { n: n(i.delta) })}</span></li>`).join('')
    : `<li class="points-empty">${t('points.history_empty')}</li>`;

  return `
    <div class="points-card">
      <div class="points-head">
        <span class="points-title">${t('points.title')}</span>
        <span class="points-balance">${t('points.balance')} <strong>${t('points.pts', { n: n(d.balance) })}</strong></span>
      </div>
      ${d.mode !== 'live' ? `<p class="points-sim-banner">${t('points.simulation')}</p>` : `<p class="points-live-banner">${t('points.live')}</p>`}
      <p class="points-potential">${potHtml}</p>
      ${_shopData ? `<button type="button" class="points-shop-link" data-scroll-shop>${t('points.shop_link', { n: n(_shopData.items.length) })}</button>` : ''}
      <details class="points-details points-scale"${open('.points-scale')}>
        <summary>${t('points.scale_toggle')}</summary>
        <table class="points-table">${scaleRows}</table>
        ${notes}
      </details>
      <details class="points-details points-history"${open('.points-history')}>
        <summary>${t('points.history_toggle')}</summary>
        <ul class="points-list">${histHtml}</ul>
      </details>
      <p class="points-rules">${t('points.rules')}</p>
    </div>`;
}

// ── Boutique de cadeaux (#34) ────────────────────────────────────────────────

let _shopData = null;   // catalogue (GET /api/shop) + solde et commandes (GET /api/shop/me)
let _shopMsg  = null;   // { ok, text } : résultat du dernier échange / annulation
let _shopBusy = false;

/** Texte d'un article dans la langue courante, à défaut en français. */
function _shopText(texts, field) {
  return texts?.[I18n.getCurrent()]?.[field] || texts?.fr?.[field] || '';
}

function _shopHtml() {
  const d = _shopData;
  if (!_account || !d) return '';
  const lang = I18n.getCurrent();
  const n = v => Number(v).toLocaleString(lang);
  const open = sel => document.querySelector(`#season-shop ${sel}`)?.open ? ' open' : '';
  const fmtDate = v => { const x = new Date(String(v).replace(' ', 'T') + 'Z'); return isNaN(x) ? v : x.toLocaleDateString(lang); };

  const items = d.items.map(it => {
    const title = _shopText(it.texts, 'title');
    const desc  = _shopText(it.texts, 'description');
    const cond  = _shopText(it.texts, 'conditions');
    const short = it.blocked ? null : Math.max(0, it.cost - d.balance);
    const label = it.blocked ? t(`giftshop.b_${it.blocked}`) : short > 0 ? t('giftshop.b_short', { n: n(short) }) : t('giftshop.btn');
    const facts = [
      it.stock !== null ? t('giftshop.stock', { n: n(it.stock) }) : '',
      it.maxPerUser ? t('giftshop.per_user', { n: n(it.maxPerUser) }) : '',
      it.validUntil ? t('giftshop.until', { d: escapeHtml(fmtDate(it.validUntil)) }) : '',
      it.kind === 'real' && it.faceValueCents != null && it.currency
        ? t('giftshop.face_value', { v: escapeHtml((it.faceValueCents / 100).toLocaleString(lang, { style: 'currency', currency: it.currency })) }) : '',
      it.kind === 'real' && it.territories.length ? t('giftshop.territories', { list: escapeHtml(it.territories.join(', ')) }) : '',
      it.kind === 'real' && it.minAge ? t('giftshop.min_age', { n: n(it.minAge) }) : '',
    ].filter(Boolean).join(' · ');
    const visual = it.imageUrl
      ? `<img class="shop-item-img" src="${escapeHtml(it.imageUrl)}" alt="" loading="lazy">`
      : `<span class="shop-item-icon" aria-hidden="true">${escapeHtml(it.icon || '🎁')}</span>`;
    return `<li class="shop-item${it.blocked || short > 0 ? ' shop-item-off' : ''}">
      ${visual}
      <div class="shop-item-body">
        <div class="shop-item-title">${escapeHtml(title)}</div>
        ${desc ? `<div class="shop-item-desc">${escapeHtml(desc)}</div>` : ''}
        ${facts ? `<div class="shop-item-facts">${facts}</div>` : ''}
        ${cond ? `<details class="shop-item-cond"><summary>${t('giftshop.conditions')}</summary><p>${escapeHtml(cond)}</p></details>` : ''}
      </div>
      <div class="shop-item-buy">
        <span class="shop-item-cost">${t('giftshop.cost', { n: n(it.cost) })}</span>
        <button class="shop-buy-btn" data-shop-item="${escapeHtml(it.id)}"${it.blocked || short > 0 || _shopBusy ? ' disabled' : ''}
          aria-label="${escapeHtml(`${label} — ${title} (${t('giftshop.cost', { n: n(it.cost) })})`)}">${escapeHtml(label)}</button>
      </div>
    </li>`;
  }).join('');

  const orders = d.orders.length
    ? d.orders.map(o => `<li>
        <span>#${escapeHtml(o.id)} ${escapeHtml(o.icon || '🎁')} ${escapeHtml(_shopText(o.texts, 'title'))}
          <span class="shop-order-meta">${escapeHtml(fmtDate(o.createdAt))} · ${t('giftshop.cost', { n: n(o.cost) })}</span></span>
        <span class="shop-order-status shop-status-${escapeHtml(o.status)}">${t(`giftshop.s_${o.status}`)}${o.status === 'pending'
          ? ` <button class="shop-cancel-btn" data-shop-cancel="${escapeHtml(o.id)}"${_shopBusy ? ' disabled' : ''}>${t('giftshop.cancel')}</button>` : ''}</span>
      </li>`).join('')
    : `<li class="points-empty">${t('giftshop.orders_empty')}</li>`;

  return `
    <div class="points-card shop-card">
      <div class="points-head">
        <span class="points-title">${t('giftshop.title')}</span>
        <span class="points-balance">${t('points.balance')} <strong>${t('points.pts', { n: n(d.balance) })}</strong></span>
      </div>
      <p class="points-note">${t('giftshop.intro')}</p>
      ${d.notice ? `<p class="points-sim-banner">${escapeHtml(d.notice)}</p>` : ''}
      ${_shopMsg ? `<p class="${_shopMsg.ok ? 'points-live-banner' : 'points-sim-banner'}" role="status">${escapeHtml(_shopMsg.text)}</p>` : ''}
      ${d.items.length ? `<ul class="shop-list">${items}</ul>` : `<p class="points-empty">${t('giftshop.empty')}</p>`}
      ${d.items.some(i => i.kind === 'real') && !d.realEnabled ? `<p class="points-note">${t('giftshop.real_note')}</p>` : ''}
      <details class="points-details shop-orders"${open('.shop-orders')}>
        <summary>${t('giftshop.orders_toggle')} (${n(d.orders.length)})</summary>
        <ul class="points-list">${orders}</ul>
      </details>
      <p class="points-rules">${t('giftshop.help')}</p>
    </div>`;
}

function _shopRequestId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

async function _shopAction(fn) {
  if (_shopBusy) return;
  _shopBusy = true;
  try { await fn(); }
  catch (_) { _shopMsg = { ok: false, text: t('giftshop.network') }; }
  finally {
    _shopBusy = false;
    await _loadPoints();
  }
}

async function _shopExchange(itemId) {
  const it = _shopData?.items.find(i => i.id === itemId);
  if (!it) return;
  const title = _shopText(it.texts, 'title');
  const n = v => Number(v).toLocaleString(I18n.getCurrent());
  if (!confirm(t('giftshop.confirm', { cost: t('giftshop.cost', { n: n(it.cost) }), title, after: t('points.pts', { n: n(_shopData.balance - it.cost) }) }))) return;
  const requestId = _shopRequestId();
  await _shopAction(async () => {
    // Même requestId en cas de nouvel essai réseau : le serveur ne débite qu'une fois.
    let res;
    try { res = await _apiFetch('POST', '/api/shop/orders', { itemId, requestId }); }
    catch (_) { res = await _apiFetch('POST', '/api/shop/orders', { itemId, requestId }); }
    _shopMsg = res.ok ? { ok: true, text: t('giftshop.done', { title }) } : { ok: false, text: t('giftshop.error', { msg: res.data?.error ?? res.status }) };
  });
}

async function _shopCancel(orderId) {
  if (!confirm(t('giftshop.cancel_confirm'))) return;
  await _shopAction(async () => {
    const res = await _apiFetch('POST', `/api/shop/orders/${orderId}/cancel`, {});
    _shopMsg = res.ok ? null : { ok: false, text: t('giftshop.error', { msg: res.data?.error ?? res.status }) };
  });
}

document.addEventListener('click', (e) => {
  const buy = e.target.closest?.('[data-shop-item]');
  if (buy) { _shopExchange(Number(buy.dataset.shopItem)); return; }
  const cancel = e.target.closest?.('[data-shop-cancel]');
  if (cancel) { _shopCancel(Number(cancel.dataset.shopCancel)); return; }
  if (e.target.closest?.('[data-scroll-shop]')) {
    const sh = document.querySelector('#season-shop .shop-card');
    sh?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sh?.querySelector('button:not([disabled]), summary')?.focus({ preventScroll: true });
    return;
  }
  if (e.target.closest?.('[data-season-retry]')) { _lastResult = null; _openSeasonView(); }
});

async function _loadLeaderboard(seasonId, containerId) {
  try {
    const { ok, data } = await _apiFetch('GET', `/api/seasons/${seasonId}/leaderboard`);
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = _leaderboardHtml(ok ? data : null);
  } catch (err) { console.warn('[saison] classement indisponible', err); }
}

function _leaderboardHtml(data) {
  if (!data?.leaderboard?.length) return `<p class="season-empty">${escapeHtml(t('season.empty'))}</p>`;
  return data.leaderboard.map(row => {
      const medal  = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${escapeHtml(row.rank)}`;
      const league = row.league ? `<span class="lb-league">${escapeHtml(row.league.icon)}</span>` : '';
      const isMe   = _account && row.username === _account.username;
      return `<div class="lb-row${isMe ? ' lb-row-me' : ''}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${league}${escapeHtml(row.username)}</span>
        <span class="lb-depth">${escapeHtml(row.maxDepth)}m</span>
        <span class="lb-blocks">👆${escapeHtml(row.manualBlocks)}</span>
      </div>`;
  }).join('');
}

// Actualisation de l'onglet Saison lorsqu'il est affiché : après chaque sauvegarde cloud
// réussie (≤ 1 toutes les 12 s pendant le minage) et toutes les 30 s sinon (progression des
// autres joueurs). Rien n'est demandé si l'onglet est masqué ou la page en arrière-plan.
const SEASON_REFRESH_MIN_MS  = 10_000;
const SEASON_REFRESH_IDLE_MS = 30_000;
let _seasonRefreshAt   = 0;
let _seasonRefreshing  = false;

async function _refreshSeasonView() {
  if (!isViewActive('season') || document.hidden || _seasonRefreshing) return;
  if (Date.now() - _seasonRefreshAt < SEASON_REFRESH_MIN_MS) return;
  _seasonRefreshing = true;
  _seasonRefreshAt  = Date.now();
  try {
    const cur = await _apiFetch('GET', '/api/seasons/current');
    if (!cur.ok || !cur.data.season) return;
    const lb = await _apiFetch('GET', `/api/seasons/${cur.data.season.id}/leaderboard`);
    if (isViewActive('season')) renderSeasonView(cur.data, lb.ok ? lb.data : null);
    if (isViewActive('season')) _loadPoints();
  } catch (_) {
  } finally { _seasonRefreshing = false; }
}

async function _openSeasonView() {
  const el = document.getElementById('view-season');
  if (el) el.innerHTML = `<div class="view-title-bar">${t('season.title')}</div><p class="season-loading">${t('season.loading')}</p>`;
  try {
    // Sauvegarde cloud en attente envoyée d'abord : le classement reflète le minage récent
    _seasonRefreshAt = Date.now();
    if (_cloudTimer) await _syncToCloud();
    const { ok, data } = await _apiFetch('GET', '/api/seasons/current');
    if (ok && data.season) {
      _seasonCpsLimit = data.config?.cpsLimit ?? 8;
      _applyServerEconomy(data.config?.economy);
      _seasonRefreshAt = Date.now();
      _pointsData = null;   // rechargé par renderSeasonView (compte courant)
      _shopData   = null;
      _shopMsg    = null;
      _lastResult = null;   // résultat figé : rechargé (nouvelle clôture, compte courant)
      renderSeasonView(data);
      return;
    }
  } catch (_) {}
  if (el && isViewActive('season')) el.innerHTML = `<div class="view-title-bar">${t('season.title')}</div>${_seasonErrorHtml()}`;
}

// ── Rendu paramètres ─────────────────────────────────────────────────────────

function renderSettings() {
  const container = document.getElementById('view-settings');
  if (!container) return;

  const current = I18n.getCurrent();

  // Sélecteur compact (#42) : un bouton « drapeau + langue » qui déplie une courte liste
  const curLang = I18n.LANGS.find(l => l.code === current) || I18n.LANGS[0];
  const optionsHtml = I18n.LANGS.map(lang => `
    <button type="button" class="lang-option${lang.code === current ? ' is-active' : ''}"
      data-lang="${lang.code}" lang="${lang.code}"
      aria-pressed="${lang.code === current}">
      ${lang.flagSvg}
      <span class="lang-option-name">${lang.label}</span>
      <span class="lang-option-check" aria-hidden="true">✓</span>
    </button>`).join('');

  // ── Section compte ──
  const accountHtml = _accountSectionHtml();

  // Compte en premier → plus visible, puis langue
  container.innerHTML = `
    <div class="view-title-bar">${t('settings.title')}</div>
    ${accountHtml}
    <div class="settings-section settings-section-lang">
      <div class="settings-section-label" id="lang-title">${t('settings.lang_title')}</div>
      <div class="lang-picker">
        <button type="button" class="lang-current" id="lang-current" lang="${curLang.code}"
          aria-haspopup="true" aria-expanded="false" aria-controls="lang-menu" aria-labelledby="lang-title lang-current">
          ${curLang.flagSvg}
          <span class="lang-option-name">${curLang.label}</span>
          <span class="lang-current-caret" aria-hidden="true">▾</span>
        </button>
        <div class="lang-menu" id="lang-menu" role="group" aria-labelledby="lang-title" hidden>${optionsHtml}</div>
      </div>
    </div>
    <div class="settings-section" id="notif-history"></div>
    <button class="settings-back-btn" id="btn-settings-back">
      ${t('settings.btn_back')}
    </button>
    <p class="settings-version">${window.APP_VERSION || '—'}</p>`;

  _bindLangPicker(container);

  _bindAccountSection(container);
  _refreshNotifHistory();

  // Retour à la vue précédente
  document.getElementById('btn-settings-back')
    .addEventListener('click', () => switchView(_previousView));
}

/** Ouverture/fermeture du sélecteur de langue compact (#42) : clic, Échap, clic à l'extérieur. */
function _bindLangPicker(container) {
  const toggle = container.querySelector('#lang-current');
  const menu   = container.querySelector('#lang-menu');
  if (!toggle || !menu) return;
  const onOutside = e => { if (!menu.contains(e.target) && !toggle.contains(e.target)) close(false); };
  function close(focusToggle) {
    if (menu.hidden) return;
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    if (focusToggle) toggle.focus();
  }
  function open() {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    (menu.querySelector('.lang-option.is-active') || menu.querySelector('.lang-option'))?.focus();
  }
  toggle.addEventListener('click', () => (menu.hidden ? open() : close(true)));
  container.querySelector('.lang-picker').addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); close(true); return; }
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !menu.hidden) {
      const items = [...menu.querySelectorAll('.lang-option')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      e.preventDefault();
    }
  });
  menu.querySelectorAll('.lang-option').forEach(btn => {
    btn.addEventListener('click', () => {
      close(false);
      I18n.setLang(btn.dataset.lang);
      renderSettings();
      document.getElementById('lang-current')?.focus();
    });
  });
}

// ── Historique des notifications (Paramètres, #26) ──────────────────────────

function _refreshNotifHistory() {
  const box = document.getElementById('notif-history');
  if (!box) return;
  const entries = NotifLog.list();
  const lang = I18n.getCurrent();
  const when = at => {
    try { return new Date(at).toLocaleString(lang, { dateStyle: 'short', timeStyle: 'medium' }); }
    catch (_) { return new Date(at).toLocaleString(); }
  };
  const items = entries.map(e => {
    const type = NotifLog.TYPES.includes(e.type) ? e.type : 'info';
    return `
    <li class="notif-entry notif-${type}">
      <div class="notif-meta">
        <span class="notif-type">${escapeHtml(t(`settings.notif_type_${type}`))}</span>
        <time datetime="${escapeHtml(new Date(e.at).toJSON() ?? '')}">${escapeHtml(when(e.at))}</time>
        ${e.count > 1 ? `<span class="notif-count">×${Math.floor(Number(e.count))}</span>` : ''}
      </div>
      <div class="notif-text">${escapeHtml(e.icon)} ${escapeHtml(e.text)}</div>
    </li>`;
  }).join('');
  box.innerHTML = `
    <div class="settings-section-label">${t('settings.notif_title')}</div>
    ${entries.length
      ? `<ul class="notif-list">${items}</ul>
         <button class="notif-clear-btn" id="btn-notif-clear">${t('settings.notif_clear')}</button>`
      : `<p class="notif-empty">${t('settings.notif_empty')}</p>`}`;
  box.querySelector('#btn-notif-clear')?.addEventListener('click', () => {
    if (!confirm(t('settings.notif_clear_confirm'))) return;
    NotifLog.clear();
    _refreshNotifHistory();
  });
}

// ── Section compte (Paramètres) ─────────────────────────────────────────────

/** Champ de saisie du formulaire compte. */
function _accInput(id, type, label, autocomplete, extra = '') {
  return `<input class="account-input" id="${id}" type="${type}" placeholder="${label}"
    aria-label="${label}" autocomplete="${autocomplete}" ${extra}>`;
}

function _accountSectionHtml() {
  const head = `<div class="settings-section-label">${t('account.title')}</div>`;

  // Lien « mot de passe oublié » ouvert : prioritaire, connecté ou non (#28)
  if (_resetToken) {
    return `<div class="settings-section">${head}
      <form class="account-form" id="form-account-reset" novalidate>
        <p class="account-hint">${t('account.reset_intro')}</p>
        ${_accInput('acc-new-password', 'password', t('account.label_new_password'), 'new-password', 'maxlength="200"')}
        <p class="account-hint">${t('account.hint_password')}</p>
        <button type="submit" class="account-submit-btn" id="btn-account-reset">${t('account.btn_reset')}</button>
        <button type="button" class="account-link-btn" id="btn-account-reset-cancel">${t('account.btn_cancel')}</button>
        <p class="account-error" id="acc-error" role="alert"></p>
      </form></div>`;
  }

  if (_account) {
    const email = _account.email
      ? `<div class="account-email">
          <span class="account-email-addr">✉️ ${escapeHtml(_account.email)}</span>
          <span class="account-badge ${_account.emailVerified ? 'is-ok' : 'is-warn'}">${
            _account.emailVerified ? t('account.email_verified') : t('account.email_unverified')}</span>
          ${(!_account.emailVerified && _mailEnabled)
            ? `<button class="account-link-btn" id="btn-account-send-verify">${t('account.btn_send_verify')}</button>` : ''}
          <p class="account-msg" id="acc-verify-msg" role="status"></p>
        </div>`
      : '';
    const changeEmail = _mailEnabled
      ? `<details class="account-details">
          <summary>${t('account.change_email')}</summary>
          <form class="account-form" id="form-account-change-email" novalidate>
            ${_accInput('acc-new-email', 'email', t('account.label_new_email'), 'email', 'maxlength="254"')}
            ${_accInput('acc-email-password', 'password', t('account.label_password'), 'current-password')}
            <p class="account-hint">${t('account.hint_change_email')}</p>
            <button type="submit" class="account-submit-btn" id="btn-account-change-email">${t('account.btn_change_email')}</button>
            <p class="account-msg" id="acc-email-msg" role="status"></p>
          </form>
        </details>`
      : '';
    return `<div class="settings-section">${head}
      <div class="account-logged">
        <div class="account-username">👤 ${t('account.logged_as', { name: escapeHtml(_account.username) })}</div>
        <button class="account-logout-btn" id="btn-account-logout">${t('account.btn_logout')}</button>
      </div>
      ${email}
      <details class="account-details">
        <summary>${t('account.change_password')}</summary>
        <form class="account-form" id="form-account-change-password" novalidate>
          ${_accInput('acc-cur-password', 'password', t('account.label_current_password'), 'current-password')}
          ${_accInput('acc-new-password', 'password', t('account.label_new_password'), 'new-password', 'maxlength="200"')}
          <p class="account-hint">${t('account.hint_password_others')}</p>
          <button type="submit" class="account-submit-btn" id="btn-account-change-password">${t('account.btn_change_password')}</button>
          <p class="account-msg" id="acc-password-msg" role="status"></p>
        </form>
      </details>
      ${changeEmail}
      ${_socialAccountHtml()}
    </div>`;
  }

  if (_accountTab === 'forgot') {
    return `<div class="settings-section">${head}
      <form class="account-form" id="form-account-forgot" novalidate>
        <p class="account-hint">${t('account.forgot_intro')}</p>
        ${_accInput('acc-identifier', 'text', t('account.label_identifier'), 'username', 'maxlength="254"')}
        <button type="submit" class="account-submit-btn" id="btn-account-forgot">${t('account.btn_forgot_send')}</button>
        <button type="button" class="account-link-btn" data-tab="login">${t('account.btn_back_login')}</button>
        <p class="account-msg" id="acc-forgot-msg" role="status"></p>
      </form></div>`;
  }

  const tab = _accountTab === 'register' ? 'register' : 'login';
  return `<div class="settings-section">${head}
    <div class="account-tabs">
      <button class="account-tab${tab === 'login'    ? ' is-active' : ''}" data-tab="login">${t('account.tab_login')}</button>
      <button class="account-tab${tab === 'register' ? ' is-active' : ''}" data-tab="register">${t('account.tab_register')}</button>
    </div>
    <form class="account-form" id="form-account-login" novalidate>
      <input class="account-input" id="acc-username" type="text"
        placeholder="${t('account.label_username')}" aria-label="${t('account.label_username')}" autocomplete="username" maxlength="20">
      ${tab === 'register'
        ? `<input class="account-input" id="acc-email" type="email"
            placeholder="${t('account.label_email')}" aria-label="${t('account.label_email')}" autocomplete="email">`
        : ''}
      <input class="account-input" id="acc-password" type="password"
        placeholder="${t('account.label_password')}" aria-label="${t('account.label_password')}" autocomplete="${tab === 'register' ? 'new-password' : 'current-password'}">
      ${tab === 'register'
        ? `<p class="account-hint">${t('account.hint_username')}<br>${t('account.hint_email')}<br>${t('account.hint_password')}</p>`
        : ''}
      <button type="submit" class="account-submit-btn" id="btn-account-submit">
        ${tab === 'login' ? t('account.btn_login') : t('account.btn_register')}
      </button>
      ${(tab === 'login' && _mailEnabled)
        ? `<button type="button" class="account-link-btn" data-tab="forgot">${t('account.btn_forgot')}</button>` : ''}
      <p class="account-error" id="acc-error" role="alert"></p>
    </form>
    ${tab === 'login' ? _socialLoginHtml() : ''}
  </div>`;
}

/**
 * Connexion Google (#28), sous le formulaire de connexion. Bouton visible si le serveur l'ouvre
 * à tous, ou si un compte Google a déjà été lié sur cet appareil (phase de test restreinte).
 */
function _socialLoginHtml() {
  if (!_social) return '';
  let seen = false;
  try { seen = localStorage.getItem(SOCIAL_SEEN_KEY) === '1'; } catch (_) {}
  const pending = _social.pending
    ? `<div class="account-social-pending" role="status">
        <p class="account-hint">${t('account.social_pending_hint')}</p>
        <button type="button" class="account-link-btn" id="btn-social-pending-cancel">${t('account.btn_social_ignore')}</button>
      </div>`
    : '';
  const button = (_social.loginButton || seen)
    ? `<div class="account-social">
        <button type="button" class="account-google-btn" id="btn-social-google">
          <span class="account-google-g" aria-hidden="true">G</span>${t('account.social_continue')}
        </button>
      </div>`
    : '';
  return pending + button;
}

/** Bloc Google du compte connecté (#28) : identité en attente, compte lié, ou lier un compte. */
function _socialAccountHtml() {
  if (!_social) return '';
  const linked = (_social.identities || []).find(i => i.provider === 'google');
  if (_social.pending && _social.pending.email !== undefined) {
    return `<div class="account-social-pending" role="status">
      <p class="account-hint">${t('account.social_confirm', { email: escapeHtml(_social.pending.email || 'Google') })}</p>
      <button type="button" class="account-submit-btn" id="btn-social-pending-link">${t('account.btn_social_confirm')}</button>
      <button type="button" class="account-link-btn" id="btn-social-pending-cancel">${t('account.btn_social_ignore')}</button>
      <p class="account-msg" id="acc-social-pending-msg" role="status"></p>
    </div>`;
  }
  if (linked) {
    return `<div class="account-email">
        <span class="account-email-addr">🔗 ${t('account.social_linked_as', { email: escapeHtml(linked.email || 'Google') })}</span>
      </div>
      <details class="account-details">
        <summary>${t('account.social_unlink_title')}</summary>
        <form class="account-form" id="form-account-social-unlink" novalidate>
          ${_accInput('acc-social-unlink-password', 'password', t('account.label_password'), 'current-password')}
          <p class="account-hint">${t('account.social_unlink_hint')}</p>
          <button type="submit" class="account-submit-btn" id="btn-social-unlink">${t('account.btn_social_unlink')}</button>
          <p class="account-msg" id="acc-social-unlink-msg" role="status"></p>
        </form>
      </details>`;
  }
  if (!_social.canLink) return '';
  return `<details class="account-details">
      <summary>${t('account.social_link_title')}</summary>
      <form class="account-form" id="form-account-social-link" novalidate>
        ${_accInput('acc-social-link-password', 'password', t('account.label_password'), 'current-password')}
        <p class="account-hint">${t('account.social_link_hint')}</p>
        <button type="submit" class="account-submit-btn" id="btn-social-link">${t('account.btn_social_link')}</button>
        <p class="account-msg" id="acc-social-link-msg" role="status"></p>
      </form>
    </details>`;
}

/** Quitte la page vers Google (via Auth0) après un dernier enregistrement local et cloud. */
async function _goToGoogle(url) {
  Save.save();
  if (_account) await _syncToCloud();
  location.assign(url);
}

/** Affiche un message de résultat sous un formulaire du compte. */
function _accMsg(id, text, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-ok', !!ok);
  el.classList.toggle('is-error', !ok);
}

/**
 * Erreur d'un formulaire du compte : le message est relié aux champs (lecteurs d'écran) et le
 * focus revient au premier champ vide, sinon au premier champ, pour corriger au clavier (#28).
 */
function _accFocusError(form, msgId) {
  if (!form || !form.isConnected) return;
  const inputs = [...form.querySelectorAll('.account-input')];
  inputs.forEach(el => el.setAttribute('aria-describedby', msgId));
  const target = inputs.find(el => !el.value) || inputs[0];
  if (target) target.focus();
}

/**
 * Formulaire du compte (#28) : soumission par Entrée comme par clic (événement « submit »),
 * un seul envoi à la fois, bouton désactivé pendant l'appel. Le gestionnaire renvoie
 * { ok, text } ; le message s'affiche dans msgId et, en cas d'erreur, le focus revient au champ.
 */
function _onAccountSubmit(formId, msgId, handler) {
  const form = document.getElementById(formId);
  if (!form) return;
  const btn = form.querySelector('button[type="submit"]');
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    form.setAttribute('aria-busy', 'true');
    let res;
    try { res = await handler(); } catch (_) { res = { ok: false, text: t('account.err_generic') }; }
    busy = false;
    if (!form.isConnected) return; // vue re-rendue par le gestionnaire
    if (btn) btn.disabled = false;
    form.removeAttribute('aria-busy');
    if (!res) return;
    _accMsg(msgId, res.text, res.ok);
    if (!res.ok) _accFocusError(form, msgId);
  });
}

/** Bouton désactivé pendant l'appel, réactivé ensuite. */
function _onAccountClick(id, handler) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await handler(); } catch (_) { /* réseau : message générique ci-dessous */ }
    if (btn.isConnected) btn.disabled = false;
  });
}

function _bindAccountSection(container) {
  const lang = I18n.getCurrent();

  // Onglets et liens de navigation (login / register / forgot)
  container.querySelectorAll('.account-tab, .account-link-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      _accountTab = btn.dataset.tab;
      renderSettings();
    });
  });

  // Logout
  const logoutBtn = document.getElementById('btn-account-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      await _doLogout();
      renderSettings();
    });
  }

  // Nouveau mot de passe depuis le lien reçu par e-mail
  _onAccountSubmit('form-account-reset', 'acc-error', async () => {
    const password = document.getElementById('acc-new-password').value;
    // Compte déjà connecté : dernier envoi de sa progression, puis aucun envoi cloud pendant
    // le changement de session (le serveur connecte ce navigateur au compte du lien).
    const prev = _account;
    if (prev) { Save.save(); await _syncToCloud(); }
    _cloudReady = false;
    const { ok, data } = await _apiFetch('POST', '/api/auth/password/reset', { token: _resetToken, password });
    if (!ok) {
      if (prev) _cloudReady = true;
      return { ok: false, text: data.error || t('account.err_generic') };
    }
    _resetToken = null;
    _accountTab = 'login';
    if (prev && prev.id === data.user.id) {
      _cloudReady = true;
    } else {
      // Autre compte (ou invité) : même chemin qu'une connexion explicite (#18)
      if (prev) { _clearCloudMeta(); Save.purge(); _refreshAllAfterReset(); }
      _account = data.user;
      await _syncAfterLogin(true);
      await _pollSeason();
    }
    await _loadAccount();
    showAchievement('🔑', t('account.reset_ok'));
    renderSettings();
  });
  const cancelReset = document.getElementById('btn-account-reset-cancel');
  if (cancelReset) cancelReset.addEventListener('click', () => {
    _resetToken = null;
    _accountTab = 'login';
    renderSettings();
  });

  // Mot de passe oublié
  _onAccountSubmit('form-account-forgot', 'acc-forgot-msg', async () => {
    const identifier = document.getElementById('acc-identifier').value.trim();
    const { ok, data } = await _apiFetch('POST', '/api/auth/password/forgot', { identifier, lang });
    return { ok, text: ok ? t('account.forgot_sent') : (data.error || t('account.err_generic')) };
  });

  // Renvoi du lien de vérification
  _onAccountClick('btn-account-send-verify', async () => {
    const { ok, data } = await _apiFetch('POST', '/api/auth/email/send-verification', { lang });
    _accMsg('acc-verify-msg', ok ? t('account.verify_sent') : (data.error || t('account.err_generic')), ok);
  });

  // Changement de mot de passe
  _onAccountSubmit('form-account-change-password', 'acc-password-msg', async () => {
    const currentPassword = document.getElementById('acc-cur-password').value;
    const newPassword     = document.getElementById('acc-new-password').value;
    const { ok, data } = await _apiFetch('POST', '/api/me/password', { currentPassword, newPassword });
    if (ok) {
      document.getElementById('acc-cur-password').value = '';
      document.getElementById('acc-new-password').value = '';
    }
    return { ok, text: ok ? t('account.password_changed') : (data.error || t('account.err_generic')) };
  });

  // Changement d'adresse e-mail (effectif après confirmation par lien)
  _onAccountSubmit('form-account-change-email', 'acc-email-msg', async () => {
    const email    = document.getElementById('acc-new-email').value.trim();
    const password = document.getElementById('acc-email-password').value;
    const { ok, data } = await _apiFetch('POST', '/api/me/email', { email, password, lang });
    if (ok) document.getElementById('acc-email-password').value = '';
    return { ok, text: ok
      ? (data.alreadyVerified ? t('account.email_verified') : t('account.email_change_sent', { email: data.pending }))
      : (data.error || t('account.err_generic')) };
  });

  // Connexion Google (#28)
  _onAccountClick('btn-social-google', () => _goToGoogle('/api/auth/social/start?intent=login'));
  _onAccountClick('btn-social-pending-cancel', async () => {
    await _apiFetch('POST', '/api/auth/social/pending/cancel');
    await _loadAccount();
    renderSettings();
  });
  _onAccountClick('btn-social-pending-link', async () => {
    const { ok, data } = await _apiFetch('POST', '/api/auth/social/pending/link', { lang });
    if (!ok) return _accMsg('acc-social-pending-msg', data.error || t('account.err_generic'), false);
    try { localStorage.setItem(SOCIAL_SEEN_KEY, '1'); } catch (_) {}
    showAchievement('🔗', t('account.social_msg_linked'));
    await _loadAccount();
    renderSettings();
  });
  _onAccountSubmit('form-account-social-link', 'acc-social-link-msg', async () => {
    const password = document.getElementById('acc-social-link-password').value;
    const { ok, data } = await _apiFetch('POST', '/api/auth/social/link/prepare', { password });
    if (!ok) return { ok: false, text: data.error || t('account.err_generic') };
    await _goToGoogle(data.url);
    return null;
  });
  _onAccountSubmit('form-account-social-unlink', 'acc-social-unlink-msg', async () => {
    const password = document.getElementById('acc-social-unlink-password').value;
    const { ok, data } = await _apiFetch('POST', '/api/auth/social/unlink', { password, lang });
    if (!ok) return { ok: false, text: data.error || t('account.err_generic') };
    showAchievement('🔗', t('account.social_unlinked'));
    await _loadAccount();
    renderSettings();
    return null;
  });

  // Connexion / inscription
  _onAccountSubmit('form-account-login', 'acc-error', async () => {
    const username = document.getElementById('acc-username').value.trim();
    const email    = (document.getElementById('acc-email')?.value ?? '').trim();
    const password = document.getElementById('acc-password').value;
    document.getElementById('acc-error').textContent = '';

    const error = _accountTab === 'register'
      ? await _doRegister(username, email, password)
      : await _doLogin(username, password);
    if (error) return { ok: false, text: error };

    await _syncAfterLogin(true); // connexion explicite → toujours appliquer le cloud
    await _pollSeason();
    try { await _loadAccount(); } catch (_) { /* l'adresse s'affichera au prochain chargement */ }
    renderSettings();
  });
}

// ── Rendu boutique ────────────────────────────────────────────────────────────

function renderShop() {
  const container = document.getElementById('view-shop');
  if (!container) return;

  container.innerHTML = `
    <div class="view-title-bar">${t('ui.view_shop')}</div>
    <div class="shop-header">
      <div class="shop-balance">💎 ${GameState.gems} ${t('stats.gems')}</div>
      <div class="shop-balance-sub">${t('shop.balance_label')}</div>
    </div>
    <div class="section-divider"><span>${t('shop.section_gems')}</span></div>
    <div class="shop-grid" id="shop-grid-gems"></div>
    <div class="section-divider"><span>${t('shop.section_skins')}</span></div>
    <div class="shop-grid shop-grid-2" id="shop-grid-skins"></div>
    <div class="section-divider"><span>${t('shop.section_boosts')}</span></div>
    <div class="shop-grid shop-grid-2" id="shop-grid-boosts"></div>
    <div class="shop-disclaimer">${t(Monetization.PAYMENTS_ENABLED ? 'shop.disclaimer_live' : 'shop.disclaimer')}</div>
  `;

  const gems  = Monetization.SHOP_ITEMS.filter(i => i.type === 'gems');
  const skins = Monetization.SHOP_ITEMS.filter(i => i.type === 'skin');
  const boosts = Monetization.SHOP_ITEMS.filter(i => i.type === 'boost');

  _fillShopGrid('shop-grid-gems',   gems);
  _fillShopGrid('shop-grid-skins',  skins);
  _fillShopGrid('shop-grid-boosts', boosts);
}

function _fillShopGrid(gridId, items) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  const enabled = Monetization.PAYMENTS_ENABLED;

  for (const item of items) {
    const owned = item.type === 'skin' && Monetization.hasSkin(item.value);
    const card  = document.createElement('div');
    card.className = 'shop-card';

    // Sans fournisseur de paiement, la carte reste visible mais le bouton est
    // désactivé : aucun article ne peut être obtenu (ticket #11).
    const btnText = owned ? t('shop.btn_owned') : enabled ? item.price : t('shop.btn_soon');
    card.innerHTML = `
      ${item.badge ? `<div class="shop-badge">${t(item.badge)}</div>` : ''}
      <div class="shop-item-icon">${item.icon}</div>
      <div class="shop-item-name">${t(item.name)}</div>
      <div class="shop-item-label">${t(item.label)}</div>
      <button class="shop-btn${owned ? ' owned' : ''}"
        ${owned || !enabled ? 'disabled' : ''}
        aria-label="${owned ? t('shop.btn_owned') : enabled ? `${t('ui.btn_upgrade')} ${t(item.name)}` : `${t(item.name)} — ${t('shop.btn_soon')}`}">
        ${btnText}
      </button>`;

    if (!owned && enabled) {
      card.querySelector('.shop-btn').addEventListener('click', () => {
        Monetization.purchase(item.id, (bought) => {
          const notif = bought.type === 'gems'  ? t('notif.gems_added', { amount: bought.value })
                      : bought.type === 'skin'  ? t('notif.skin_activated')
                      : t('notif.boost_activated', { mult: bought.mult });
          showAchievement('🛒', notif);
          if (bought.type === 'boost') renderBoostBanner();
          renderShop();
          renderStats();
          renderBlock(); // met à jour le skin sur le bloc
          Save.save();
        });
      });
    }

    grid.appendChild(card);
  }
}

// ── Notifications ─────────────────────────────────────────────────────────────

/**
 * Toast de notification, aussi enregistré dans l'historique de Paramètres (#26).
 * @param {string} [type]  info | success | warning | error (déduit de l'icône sinon)
 */
function showAchievement(icon, text, type) {
  NotifLog.add({ icon, text, type });
  if (isViewActive('settings')) _refreshNotifHistory();
  const el = document.createElement('div');
  el.className   = 'float-text achievement';
  el.textContent = `${icon} ${text}`;
  el.style.left  = `${window.innerWidth / 2}px`;
  el.style.top   = `${window.innerHeight * 0.20}px`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function handleQuestsCompleted(completed) {
  if (completed.length === 0) return;
  completed.forEach((q, i) => {
    setTimeout(() => showAchievement('🎯', t('notif.quest_done', { name: t(q.name) })), i * 500);
  });
  renderStats();
  if (isViewActive('upgrades')) renderQuests();
  else setNavBadge('upgrades');
}

function handleFindDrop(find) {
  showAchievement('🔍', t('notif.find_drop', { name: Collection.displayName(find) }));
  if (isViewActive('collection')) renderCollection();
  else setNavBadge('collection');
}

// ── Particules ────────────────────────────────────────────────────────────────

function spawnParticles(color) {
  const rect = elBlock.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;

  for (let i = 0; i < 14; i++) {
    const p = document.createElement('div');
    p.className        = 'particle';
    p.style.left       = `${cx}px`;
    p.style.top        = `${cy}px`;
    p.style.background = color;

    const angle = (i / 14) * 360 + (Math.random() * 26 - 13);
    const dist  = 35 + Math.random() * 60;
    p.style.setProperty('--dx', `${Math.cos(angle * Math.PI / 180) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle * Math.PI / 180) * dist}px`);

    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove(), { once: true });
  }
}

// ── Textes flottants ──────────────────────────────────────────────────────────

function spawnFloatText(text, cssClass, cx, cy) {
  const el = document.createElement('div');
  el.className   = `float-text ${cssClass}`;
  el.textContent = text;
  el.style.left  = `${cx + (Math.random() * 24 - 12)}px`;
  el.style.top   = `${cy - 8}px`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// ── Gains offline ────────────────────────────────────────────────────────────

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0 && m > 0) return `${h}\u202fh\u202f${m}\u202fmin`;
  if (h > 0)          return `${h}\u202fh`;
  return `${m}\u202fmin`;
}

function computeOfflineGains() {
  const last = Save.loadedSaveTime;
  if (!last) return null;

  const elapsedMs = Date.now() - last;
  const MIN_MS    = 60_000;
  const MAX_MS    = 4 * 60 * 60 * 1000;
  if (elapsedMs < MIN_MS) return null;

  const dps = Upgrades.getAutoDigDamage();
  if (dps === 0) return null;

  const cappedMs       = Math.min(elapsedMs, MAX_MS);
  const rewardMult     = Upgrades.getRewardMultiplier();
  const coinsPerMinute = Math.max(1, Math.floor(dps * rewardMult * 30));
  const totalCoins     = Math.floor(coinsPerMinute * (cappedMs / 60_000));
  if (totalCoins <= 0) return null;

  return { elapsedMs, cappedMs, coinsPerMinute, totalCoins };
}

function showOfflinePopup(gains) {
  const modal      = document.getElementById('offline-modal');
  const durationEl = document.getElementById('offline-modal-duration');
  const rewardEl   = document.getElementById('offline-modal-reward');
  const collectBtn = document.getElementById('btn-collect-offline');
  if (!modal) return;

  const cappedStr = formatDuration(gains.cappedMs);
  const elapsed   = gains.elapsedMs;
  const wasCapped = elapsed > gains.cappedMs;
  durationEl.textContent = wasCapped
    ? t('ui.offline_duration_cap', { full: formatDuration(elapsed), capped: cappedStr })
    : t('ui.offline_duration', { dur: cappedStr });
  rewardEl.textContent = t('ui.offline_reward', { coins: gains.totalCoins.toLocaleString(I18n.getCurrent()) });

  modal.hidden = false;

  collectBtn.onclick = () => {
    modal.hidden = true;
    GameState.addCoins(gains.totalCoins);
    GameState.stats.totalCoinsEarned += gains.totalCoins;
    renderStats();
    handleQuestsCompleted(Quests.checkAll());
    updateDailyBadge();
    Save.save();
  };
}

// ── Popup coffre ──────────────────────────────────────────────────────────────

function showChestPopup(chestType, reward) {
  const modal      = document.getElementById('chest-modal');
  const inner      = document.getElementById('chest-modal-inner');
  const iconEl     = document.getElementById('chest-modal-icon');
  const rarityEl   = document.getElementById('chest-modal-rarity');
  const titleEl    = document.getElementById('chest-modal-title');
  const rewardEl   = document.getElementById('chest-modal-reward');
  const collectBtn = document.getElementById('btn-collect-chest');

  if (!modal) {
    // Pas de modal dans le DOM : continuer normalement
    blockAnimating = false;
    spawnBlock();
    return;
  }

  // Remettre les animations à zéro pour que l'ouverture rejoue à chaque coffre
  inner.style.animation  = 'none';
  iconEl.style.animation = 'none';
  void inner.offsetWidth;
  inner.style.animation  = '';
  iconEl.style.animation = '';

  IconLibrary.render(iconEl, chestType);   // image v1 du coffre (emoji en legacy)
  rarityEl.innerHTML   = `<span class="rarity-badge rarity-${chestType.rarityKey}">${t('rarity.' + chestType.rarityKey.replace('-', '_'))}</span>`;
  titleEl.textContent  = t('ui.chest_title', { name: t(chestType.name) });
  rewardEl.textContent = Chests.rewardLabel(reward);

  modal.hidden = false;

  collectBtn.onclick = () => {
    modal.hidden = true;
    blockAnimating = false;
    nextBlock();
    renderStats();
    if (reward.type === 'boost') renderBoostBanner();
    // Si des fragments ont été gagnés, signaler si une relique devient abordable/améliorable
    if (reward.type === 'relics' && Relics.DEFS.some(r => Relics.canUnlock(r.id) || Relics.canUpgrade(r.id))) {
      setNavBadge('collection');
    }
    Save.save();
  };
}

// ── Logique de jeu ────────────────────────────────────────────────────────────

/** Après une destruction : bloc suivant, sauf si un bloc intact a été repris entre-temps (#35). */
function nextBlock() {
  if (Blocks.current && Blocks.current.hp > 0) { renderBlock(); return; }
  spawnBlock();
}

function spawnBlock() {
  Blocks.spawn(GameState.depth);
  elBlock.classList.remove(
    'anim-break','anim-hit','crack-1','crack-2','crack-3','hp-critical',
    'skin-golden','skin-diamond'
  );
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-spawn');
  // Re-render after animation: the GPU compositing layer (will-change:transform)
  // is captured at scale(0), so the emoji texture is blank until scale returns to 1.
  elBlock.addEventListener('animationend', () => {
    elBlock.classList.remove('anim-spawn');
    renderBlock();
  }, { once: true });
  renderBlock();
}

function handleBlockDestroyed(cx, cy, { isManual = false, isAuto = false } = {}) {
  // Avertissement unique si le joueur n'est pas connecté
  if (!_account && !_hasShownGuestWarning) {
    _hasShownGuestWarning = true;
    showAchievement('⚠️', t('ui.guest_warning'));
  }

  if (isManual) {
    GameState.seasonStats.manualBlocks++;
    GameState.seasonStats.isActive = true;
  } else if (isAuto) {
    GameState.seasonStats.autoBlocks++;
  }

  const { reward: baseReward, type } = Blocks.current;
  const depth = GameState.depth;
  // Compteur cumulé par type pour les badges (#38) : le serveur ne crédite que l'écart, borné
  const minedId = Blocks.idOf(type);
  if (minedId) GameState.stats.minedByType[minedId] = (GameState.stats.minedByType[minedId] || 0) + 1;

  GameState.nextDepth();
  spawnParticles(type.accent);
  screenFlash(type.accent);

  // Gains tirés avec le générateur du bloc (#35) : rejouer ce bloc donne les mêmes gains
  const find = Collection.tryDrop(type, depth, Blocks.rewardRng('find'));
  if (find) handleFindDrop(find);

  if (type.isChest) {
    // ── Coffre : récompense aléatoire + popup ──────────────────────────────
    GameState.stats.blocksDestroyed += 1;
    GameState.stats.chestsFound     += 1;

    const chestReward = Chests.open(type.rarityKey, Blocks.rewardRng('chest'));

    spawnFloatText(t('notif.chest_float'), 'chest', cx, cy - 55);
    handleQuestsCompleted(Quests.checkAll());
    updateDailyBadge();

    blockAnimating = true;
    elBlock.classList.remove('anim-hit', 'crack-1', 'crack-2', 'crack-3', 'hp-critical');
    void elBlock.offsetWidth;
    elBlock.classList.add('anim-break');
    elBlock.addEventListener('animationend', () => {
      // blockAnimating reste true : le popup bloque le jeu jusqu'à "Récupérer"
      showChestPopup(type, chestReward);
    }, { once: true });

  } else {
    // ── Bloc normal ────────────────────────────────────────────────────────
    const reward = Math.ceil(baseReward * Upgrades.getRewardMultiplier() * GameState.getCoinBoostMultiplier());
    GameState.addCoins(reward);
    GameState.recordDestroy(reward, type);

    spawnFloatText(t('notif.coin_float', { amount: reward }), 'coin', cx + 14, cy - 24);
    if (type.isGem) spawnFloatText(t('notif.gem_float'), 'gem', cx, cy - 55);
    handleQuestsCompleted(Quests.checkAll());
    updateDailyBadge();

    blockAnimating = true;
    elBlock.classList.remove('anim-hit', 'crack-1', 'crack-2', 'crack-3', 'hp-critical');
    void elBlock.offsetWidth;
    elBlock.classList.add('anim-break');
    elBlock.addEventListener('animationend', () => {
      blockAnimating = false;
      nextBlock();
    }, { once: true });
  }
}

function onBlockHit(cx, cy, ev) {
  if (blockAnimating || Save.disabled) return;   // page sans la main (#18, #35) : aucun coup

  // Safety: if no block is spawned yet (e.g. init failed silently), spawn one now
  if (!Blocks.current) { spawnBlock(); return; }

  // Chaque clic compte comme manuel, qu'il détruise ou non le bloc
  GameState.seasonStats.manualClicks++;
  _teleRecord(ev);
  _recordClickTs();
  GameState.seasonStats.regularityScore = _computeRegularityScore();

  const suspicious = _isSuspiciousCPS();
  if (suspicious) GameState.seasonStats.suspiciousScore++;

  const destroyed = Blocks.hit(GameState.damage);

  elBlock.classList.remove('anim-hit');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-hit');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-hit'), { once: true });

  spawnFloatText(t('notif.damage_float', { amount: GameState.damage }), 'dmg', cx, cy);

  if (destroyed) handleBlockDestroyed(cx, cy, { isManual: !suspicious });

  renderBlock();
  renderStats();
  Save.save();
}

function autoDigTick() {
  const dmg = Upgrades.getAutoDigDamage();
  if (dmg === 0 || blockAnimating || Save.disabled) return;   // Auto-Dig arrêté sans la main (#35)

  const destroyed = Blocks.hit(dmg);
  if (destroyed) {
    const rect = elBlock.getBoundingClientRect();
    handleBlockDestroyed(rect.left + rect.width / 2, rect.top + rect.height / 2, { isAuto: true });
    Save.save();   // bloc suivant et gains enregistrés aussitôt (reprise exacte, #35)
  }

  renderBlock();
  renderStats();
}

// ── Événements ────────────────────────────────────────────────────────────────

function coordsFrom(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

elBlock.addEventListener('click', (e) => {
  const { x, y } = coordsFrom(e);
  onBlockHit(x, y, e);
});

elBlock.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const { x, y } = coordsFrom(e);
  onBlockHit(x, y, e);
}, { passive: false });

// Clavier (#21) : Entrée ou Espace sur le bloc sélectionné = un coup de pioche.
// La répétition automatique d'une touche maintenue est ignorée (un appui = un coup).
elBlock.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  e.preventDefault();
  if (e.repeat) return;
  const rect = elBlock.getBoundingClientRect();
  onBlockHit(rect.left + rect.width / 2, rect.top + rect.height / 2, e);
});

// Bouton pub récompensée — accorde un boost ×2 pendant 2 min (visible sur le bloc)
// Si un boost plus fort est déjà actif, le pub prolonge simplement sa durée.
document.getElementById('btn-watch-ad').addEventListener('click', () => {
  if (!Monetization.canWatchAd()) return;
  if (!Blocks.current) return;

  Monetization.showRewardedAd(
    () => {
      const currentMult = GameState.getCoinBoostMultiplier();
      let finalMult;
      if (currentMult >= 2) {
        // Boost plus fort déjà actif → on prolonge sa durée de 2 min
        GameState.coinBoost.expiresAt += 2 * 60_000;
        finalMult = currentMult;
      } else {
        // Pas de boost actif → on active ×2 pendant 2 min
        GameState.setCoinBoost(2, 2 * 60_000);
        finalMult = 2;
      }
      showAchievement('📺', t('notif.boost_activated', { mult: finalMult }));
      renderBlock();          // affiche immédiatement "💰 X ⚡×N → 💰 Y"
      renderBoostBanner();
      renderStats();
      updateAdButtonState();
      Save.save();
    },
    () => { /* joueur a passé la pub — pas de récompense */ }
  );
});

// Bouton paramètres
document.getElementById('btn-settings').addEventListener('click', () => {
  // Mémorise la vue actuellement active avant d'ouvrir les paramètres
  const activeBtn = document.querySelector('.nav-btn.active');
  _previousView = activeBtn ? activeBtn.dataset.view : 'dig';
  switchView('settings');
});

// Bouton compte (raccourci direct vers les paramètres, section compte en premier)
document.getElementById('btn-account').addEventListener('click', () => {
  const activeBtn = document.querySelector('.nav-btn.active');
  _previousView = activeBtn ? activeBtn.dataset.view : 'dig';
  switchView('settings');
});

// Reset
elResetBtn.addEventListener('click', () => {
  if (!confirm(t('ui.confirm_reset'))) return;
  Save.reset();
  _refreshAllAfterReset();
});

/** Re-rendu complet après une remise à zéro de GameState (reset, déconnexion). */
function _refreshAllAfterReset() {
  Relics.applyBonuses();          // recompute (tout à 0 après reset)
  renderUpgrades();
  renderShopChests();
  renderQuests();
  renderCollection();
  if (isViewActive('collection')) renderRelics();
  renderBoostBanner();
  updateAdButtonState();
  if (isViewActive('daily')) renderDaily();
  if (isViewActive('shop'))  renderShop();
  updateDailyBadge();
  clearNavBadge('collection');    // plus de reliques abordables après reset
  spawnBlock();
  renderStats();
}

// ── Sélection langue (premier lancement) ─────────────────────────────────────

function _showLangPickScreen(onPicked) {
  const screen = document.getElementById('lang-pick-screen');
  const list   = document.getElementById('lang-pick-list');
  if (!screen) { onPicked(); return; }

  screen.hidden = false;

  list.innerHTML = I18n.LANGS.map(lang => `
    <button type="button" class="lang-pick-btn" data-lang="${lang.code}" lang="${lang.code}">
      ${lang.flagSvg}
      <span class="lang-pick-label">${lang.label}</span>
    </button>`).join('');

  list.querySelectorAll('.lang-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      I18n.setLang(btn.dataset.lang);
      screen.classList.add('lang-pick-out');
      setTimeout(() => {
        screen.hidden = true;
        onPicked();
      }, 350);
    });
  });
}

// ── Initialisation ────────────────────────────────────────────────────────────

function init() {
  // Premier lancement : aucune langue enregistrée → afficher le sélecteur
  if (!I18n.hasStoredLang()) {
    _showLangPickScreen(init);
    return;
  }

  I18n.init();             // charge la langue sauvegardée
  applyTranslations();     // remplit les [data-i18n] statiques

  // Re-rend les vues dynamiques quand la langue change
  I18n.onLangChange(() => {
    if (isViewActive('dig'))        { renderBlock(); renderStats(); }
    if (isViewActive('settings'))   renderSettings();
    if (isViewActive('upgrades'))   { renderUpgrades(); renderShopChests(); renderQuests(); }
    if (isViewActive('collection')) { renderCollection(); renderRelics(); renderBadges(); }
    if (isViewActive('daily'))      renderDaily();
    if (isViewActive('shop'))       renderShop();
  });

  _claimActiveTab();
  window.addEventListener('storage', _onStorageEvent);
  document.getElementById('btn-tab-play-here')?.addEventListener('click', () => location.reload());

  Save.onSave = _scheduleCloudSync;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') _flushCloudOnExit();
    else _playHeartbeat();   // retour sur la page : vérifie qu'elle a toujours la main (#35)
  });
  window.addEventListener('pagehide', _flushCloudOnExit);
  Blocks.loadCached();     // catalogue de blocs publié (#37) mémorisé, avant la reprise du bloc
  Collection.loadCached(); // collections publiées (#39) mémorisées
  Save.load();

  Relics.applyBonuses();   // recalcule les bonus depuis GameState.relics chargé
  const offlineGains = computeOfflineGains(); // calculé ici, après applyBonuses()

  Quests.checkAll(true);   // vérification silencieuse (migration / reprise)
  DailyMissions.refresh(); // génère les missions du jour si besoin

  renderUpgrades();
  renderShopChests();
  renderQuests();
  renderBoostBanner();
  updateAdButtonState();
  Blocks.resume(Save.loadedBlock, GameState.depth);   // bloc sauvegardé repris à l'identique (#35)
  renderBlock();
  renderStats();

  updateDailyBadge();
  if (Relics.DEFS.some(r => Relics.canUnlock(r.id) || Relics.canUpgrade(r.id))) setNavBadge('collection');

  if (offlineGains) showOfflinePopup(offlineGains);

  // Bibliothèque d'icônes (v1 par défaut, library.json) : re-rendu du bloc une fois la configuration lue.
  IconLibrary.load(() => { if (Blocks.current) renderBlock(); });
  // Catalogue de blocs publié (#37) : s'applique aux prochains blocs, le bloc courant est conservé.
  Blocks.fetchCatalog(() => { if (Blocks.current && isViewActive('dig')) renderBlock(); });
  // Collections publiées (#39) : séries, objets, fiches.
  Collection.fetchCatalog(() => { if (isViewActive('collection')) renderCollection(); });
  setInterval(() => Save.save(),  15_000);
  setInterval(autoDigTick,         1_000);
  setInterval(_playHeartbeat, PLAY_HEARTBEAT_MS);
  setInterval(() => { renderBoostBanner(); updateAdButtonState(); }, 1_000);
  setInterval(_pollSeason,      5 * 60_000); // vérifie la saison toutes les 5 min
  setInterval(_refreshSeasonView, SEASON_REFRESH_IDLE_MS); // onglet Saison affiché uniquement

  // Liens reçus par e-mail (vérification, mot de passe oublié — #28)
  _handleAccountLinks();

  // Récupère l'état de session (non bloquant — la page est déjà jouable)
  _fetchMe();

  // Contrôle de version au chargement : utile si la page vient du cache hors ligne
  // ou d'un onglet restauré, et enregistrement du service worker (#21).
  _maybeCheckForUpdate(true);
  _registerServiceWorker();
}

document.addEventListener('DOMContentLoaded', init);
