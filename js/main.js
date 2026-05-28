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

  if (viewId === 'upgrades') {
    renderQuests();
    clearNavBadge('upgrades');
  }
  if (viewId === 'collection') {
    renderCollection();
    renderRelics();
    // Badge : effacer seulement si aucune relique n'est désormais abordable
    if (!Relics.DEFS.some(r => Relics.canUnlock(r.id))) clearNavBadge('collection');
  }
  if (viewId === 'daily') {
    renderDaily();
    updateDailyBadge();
  }
  if (viewId === 'shop') {
    renderShop();
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

function renderAdButton() {
  const btn     = document.getElementById('btn-watch-ad');
  const timerEl = document.getElementById('ad-timer');
  if (!btn) return;

  const available = Monetization.canWatchAd();
  btn.disabled = !available;

  if (timerEl) {
    if (available) {
      timerEl.textContent = '';
    } else {
      const ms = Monetization.getCooldownRemainingMs();
      const totalSec = Math.ceil(ms / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      timerEl.textContent = t('ui.ad_cooldown', { min, sec: String(sec).padStart(2, '0') });
    }
  }
}

// ── Rendu bloc ────────────────────────────────────────────────────────────────

function renderBlock() {
  const b = Blocks.current;
  if (!b) return;

  elBlockName.textContent  = t(b.type.name);
  elBlockIcon.textContent  = b.type.icon;
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

  // Récompense affichée (avec boost multiplié)
  const boostMult   = GameState.getCoinBoostMultiplier();
  const finalReward = Math.ceil(b.reward * Upgrades.getRewardMultiplier() * boostMult);
  const boostTag    = boostMult > 1 ? ` <span class="boost-tag">⚡×${boostMult}</span>` : '';
  elBlockReward.innerHTML = `${t('ui.reward_label')} : <span class="reward-value">💰 ${finalReward}${boostTag}</span>`;
}

// ── Rendu upgrades ────────────────────────────────────────────────────────────

function renderUpgrades() {
  elUpgradesList.innerHTML = '';

  for (const def of Upgrades.DEFS) {
    const level  = Upgrades.getLevel(def.id);
    const cost   = def.getCost(level);
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
        </div>
      </div>
      <button class="upgrade-btn${maxed ? ' is-maxed' : ''}" data-id="${def.id}"
        ${maxed || !canAfford ? 'disabled' : ''} aria-label="${t('ui.btn_upgrade')} ${t(def.name)}">
        ${maxed ? t('ui.btn_max') : `${t('ui.btn_upgrade')}<span class="btn-cost">${costHtml}</span>`}
      </button>`;

    if (!maxed) {
      card.querySelector('.upgrade-btn').addEventListener('click', () => {
        if (Upgrades.buy(def.id)) {
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

function updateUpgradeButtonStates() {
  for (const def of Upgrades.DEFS) {
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

// ── Rendu collection ──────────────────────────────────────────────────────────

function renderCollection() {
  const grid   = document.getElementById('collection-grid');
  const header = document.getElementById('collection-header');
  if (!grid) return;

  const found = Collection.countFound();
  const total = Collection.FINDS.length;
  if (header) header.textContent = t('ui.collection_header', { found, total, s: found !== 1 ? 's' : '' });

  grid.innerHTML = '';
  for (const find of Collection.FINDS) {
    const isFound = GameState.collection.includes(find.id);
    const card = document.createElement('div');
    card.className = `find-card${isFound ? ' found' : ''}`;
    if (isFound) card.title = t(find.desc);
    card.innerHTML = `
      <div class="find-icon">${isFound ? find.icon : '?'}</div>
      <div class="find-name">${isFound ? t(find.name) : '???'}</div>`;
    grid.appendChild(card);
  }
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

  const unlockedCount = GameState.relics.length;
  const totalCount    = Relics.DEFS.length;
  if (info) {
    info.textContent = t('ui.relic_header', {
      count: unlockedCount,
      total: totalCount,
      s1: unlockedCount !== 1 ? 's' : '',
      frags: GameState.relicFragments,
      s2: GameState.relicFragments !== 1 ? 's' : '',
    });
  }

  grid.innerHTML = '';

  for (const def of Relics.DEFS) {
    const unlocked  = Relics.isUnlocked(def.id);
    const canAfford = Relics.canUnlock(def.id);
    const shortfall = Math.max(0, def.cost - GameState.relicFragments);

    const card = document.createElement('div');
    card.className = `relic-card${unlocked ? ' relic-unlocked' : canAfford ? ' relic-affordable' : ''}`;
    card.title = t(def.desc);   // description visible au survol / long-press

    card.innerHTML = `
      <div class="relic-icon">${def.icon}</div>
      <div class="relic-name">${t(def.name)}</div>
      <div class="relic-bonus">${t(def.bonusLabel)}</div>
      ${unlocked
        ? `<div class="relic-unlocked-badge">${t('ui.relic_unlocked_badge')}</div>`
        : `<div class="relic-cost${canAfford ? ' can-afford' : ''}">
             ${t('ui.relic_cost', { n: def.cost, s: def.cost > 1 ? 's' : '' })}
             ${!canAfford ? `<span class="relic-shortfall">${t('ui.relic_shortfall', { n: shortfall })}</span>` : ''}
           </div>
           <button class="relic-unlock-btn" ${canAfford ? '' : 'disabled'}
             aria-label="${canAfford ? `${t('ui.btn_unlock')} ${t(def.name)}` : t('ui.relic_shortfall', { n: shortfall })}">
             ${t('ui.btn_unlock')}
           </button>`
      }`;

    if (!unlocked && canAfford) {
      card.querySelector('.relic-unlock-btn').addEventListener('click', () => {
        if (Relics.unlock(def.id)) {
          showAchievement('🔮', t('notif.relic_unlocked', { name: t(def.name) }));
          renderRelics();
          renderStats();
          // Vide le badge si plus aucune relique n'est abordable
          if (!Relics.DEFS.some(r => Relics.canUnlock(r.id))) clearNavBadge('collection');
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

// ── Rendu paramètres ─────────────────────────────────────────────────────────

function renderSettings() {
  const container = document.getElementById('view-settings');
  if (!container) return;

  const current = I18n.getCurrent();

  // Construit la liste des langues disponibles
  const optionsHtml = I18n.LANGS.map(lang => `
    <button class="lang-option${lang.code === current ? ' is-active' : ''}"
      data-lang="${lang.code}"
      aria-pressed="${lang.code === current}">
      <span class="lang-option-flag">${lang.flag}</span>
      <span class="lang-option-name">${lang.label}</span>
      <span class="lang-option-check" aria-hidden="true">✓</span>
    </button>`).join('');

  container.innerHTML = `
    <div class="view-title-bar">${t('settings.title')}</div>
    <div class="settings-section">
      <div class="settings-section-label">${t('settings.lang_title')}</div>
      <div class="lang-options-list">${optionsHtml}</div>
    </div>
    <button class="settings-back-btn" id="btn-settings-back">
      ${t('settings.btn_back')}
    </button>`;

  // Changement de langue
  container.querySelectorAll('.lang-option').forEach(btn => {
    btn.addEventListener('click', () => {
      I18n.setLang(btn.dataset.lang);
      // Re-rend les options pour mettre à jour l'état actif
      renderSettings();
    });
  });

  // Retour à la vue précédente
  document.getElementById('btn-settings-back')
    .addEventListener('click', () => switchView(_previousView));
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
    <div class="shop-disclaimer">${t('shop.disclaimer')}</div>
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

  for (const item of items) {
    const owned = item.type === 'skin' && Monetization.hasSkin(item.value);
    const card  = document.createElement('div');
    card.className = 'shop-card';

    card.innerHTML = `
      ${item.badge ? `<div class="shop-badge">${t(item.badge)}</div>` : ''}
      <div class="shop-item-icon">${item.icon}</div>
      <div class="shop-item-name">${t(item.name)}</div>
      <div class="shop-item-label">${t(item.label)}</div>
      <button class="shop-btn${owned ? ' owned' : ''}"
        ${owned ? 'disabled' : ''}
        aria-label="${owned ? t('shop.btn_owned') : `${t('ui.btn_upgrade')} ${t(item.name)}`}">
        ${owned ? t('shop.btn_owned') : item.price}
      </button>`;

    if (!owned) {
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

function showAchievement(icon, text) {
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
  showAchievement('🔍', t('notif.find_drop', { name: t(find.name) }));
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

  iconEl.textContent   = chestType.icon;
  rarityEl.innerHTML   = `<span class="rarity-badge rarity-${chestType.rarityKey}">${t('rarity.' + chestType.rarityKey.replace('-', '_'))}</span>`;
  titleEl.textContent  = t('ui.chest_title', { name: t(chestType.name) });
  rewardEl.textContent = Chests.rewardLabel(reward);

  modal.hidden = false;

  collectBtn.onclick = () => {
    modal.hidden = true;
    blockAnimating = false;
    spawnBlock();
    renderStats();
    if (reward.type === 'boost') renderBoostBanner();
    // Si des fragments ont été gagnés, signaler si une relique devient abordable
    if (reward.type === 'relics' && Relics.DEFS.some(r => Relics.canUnlock(r.id))) {
      setNavBadge('collection');
    }
    Save.save();
  };
}

// ── Logique de jeu ────────────────────────────────────────────────────────────

function spawnBlock() {
  Blocks.spawn(GameState.depth);
  elBlock.classList.remove(
    'anim-break','anim-hit','crack-1','crack-2','crack-3','hp-critical',
    'skin-golden','skin-diamond'
  );
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-spawn');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-spawn'), { once: true });
  renderBlock();
}

function handleBlockDestroyed(cx, cy) {
  const { reward: baseReward, type } = Blocks.current;
  const depth = GameState.depth;

  GameState.nextDepth();
  spawnParticles(type.accent);
  screenFlash(type.accent);

  const find = Collection.tryDrop(type, depth);
  if (find) handleFindDrop(find);

  if (type.isChest) {
    // ── Coffre : récompense aléatoire + popup ──────────────────────────────
    GameState.stats.blocksDestroyed += 1;
    GameState.stats.chestsFound     += 1;

    const chestReward = Chests.open(type.rarityKey);

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
      spawnBlock();
    }, { once: true });
  }
}

function onBlockHit(cx, cy) {
  if (blockAnimating) return;

  const destroyed = Blocks.hit(GameState.damage);

  elBlock.classList.remove('anim-hit');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-hit');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-hit'), { once: true });

  spawnFloatText(t('notif.damage_float', { amount: GameState.damage }), 'dmg', cx, cy);

  if (destroyed) handleBlockDestroyed(cx, cy);

  renderBlock();
  renderStats();
  Save.save();
}

function autoDigTick() {
  const dmg = Upgrades.getAutoDigDamage();
  if (dmg === 0 || blockAnimating) return;

  const destroyed = Blocks.hit(dmg);
  if (destroyed) {
    const rect = elBlock.getBoundingClientRect();
    handleBlockDestroyed(rect.left + rect.width / 2, rect.top + rect.height / 2);
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
  onBlockHit(x, y);
});

elBlock.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const { x, y } = coordsFrom(e);
  onBlockHit(x, y);
}, { passive: false });

// Bouton pub récompensée
document.getElementById('btn-watch-ad').addEventListener('click', () => {
  if (!Monetization.canWatchAd()) return;
  const b = Blocks.current;
  if (!b) return;
  const reward = Math.ceil(b.reward * Upgrades.getRewardMultiplier() * GameState.getCoinBoostMultiplier());

  Monetization.showRewardedAd(
    () => {
      GameState.addCoins(reward);
      showAchievement('📺', t('notif.ad_bonus', { amount: reward }));
      renderStats();
      renderAdButton();
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

// Reset
elResetBtn.addEventListener('click', () => {
  if (!confirm(t('ui.confirm_reset'))) return;
  Save.reset();
  Relics.applyBonuses();          // recompute (tout à 0 après reset)
  renderUpgrades();
  renderQuests();
  renderCollection();
  if (isViewActive('collection')) renderRelics();
  renderBoostBanner();
  renderAdButton();
  if (isViewActive('daily')) renderDaily();
  if (isViewActive('shop'))  renderShop();
  updateDailyBadge();
  clearNavBadge('collection');    // plus de reliques abordables après reset
  spawnBlock();
  renderStats();
});

// ── Sélection langue (premier lancement) ─────────────────────────────────────

function _showLangPickScreen(onPicked) {
  const screen = document.getElementById('lang-pick-screen');
  const list   = document.getElementById('lang-pick-list');
  if (!screen) { onPicked(); return; }

  screen.hidden = false;

  list.innerHTML = I18n.LANGS.map(lang => `
    <button class="lang-pick-btn" data-lang="${lang.code}">
      <span class="lang-pick-flag">${lang.flag}</span>
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
    if (isViewActive('settings'))   renderSettings();
    if (isViewActive('upgrades'))   { renderUpgrades(); renderQuests(); }
    if (isViewActive('collection')) { renderCollection(); renderRelics(); }
    if (isViewActive('daily'))      renderDaily();
    if (isViewActive('shop'))       renderShop();
  });

  Save.onSave = showSaveToast;
  Save.load();

  Relics.applyBonuses();   // recalcule les bonus depuis GameState.relics chargé
  const offlineGains = computeOfflineGains(); // calculé ici, après applyBonuses()

  Quests.checkAll(true);   // vérification silencieuse (migration / reprise)
  DailyMissions.refresh(); // génère les missions du jour si besoin

  renderUpgrades();
  renderQuests();
  renderBoostBanner();
  renderAdButton();
  spawnBlock();
  renderStats();

  updateDailyBadge();
  if (Relics.DEFS.some(r => Relics.canUnlock(r.id))) setNavBadge('collection');

  if (offlineGains) showOfflinePopup(offlineGains);

  setInterval(() => Save.save(),  15_000);
  setInterval(autoDigTick,         1_000);
  setInterval(() => { renderBoostBanner(); renderAdButton(); }, 1_000);
}

document.addEventListener('DOMContentLoaded', init);
