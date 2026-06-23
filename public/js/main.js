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
let _account              = null;    // { id, username } si connecté, null sinon
let _accountTab           = 'login'; // onglet actif dans le formulaire compte
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

// Vérifie une fois que la page regagne le focus, au maximum toutes les 5 min
window.addEventListener('focus', () => {
  const now = Date.now();
  if (now - _updateCheckLast > 5 * 60 * 1000) {
    _updateCheckLast = now;
    _checkForUpdate();
  }
});

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

  // Récompense : les coffres ont leur propre table de loot — on n'affiche pas de coins
  let rewardHtml;
  if (b.type.isChest) {
    // Dérive les types de loot possibles depuis la table du coffre
    const table  = Chests.TABLES[b.type.rarityKey] ?? Chests.TABLES.commun;
    const ICONS  = { coins: '💰', relics: '🔮', boost: '⚡' };
    const icons  = [...new Set(table.map(e => ICONS[e.type]))].filter(Boolean).join(' ');
    rewardHtml   = `<span class="reward-chest">${icons} ${t('ui.chest_loot')}</span>`;
  } else {
    // Bloc normal : coins avec décomposition des multiplicateurs
    const boostMult   = GameState.getCoinBoostMultiplier();
    const upgradeBase = b.reward * Upgrades.getRewardMultiplier();
    const baseReward  = Math.ceil(upgradeBase);
    const finalReward = Math.ceil(upgradeBase * boostMult);
    if (boostMult > 1) {
      rewardHtml = `<span class="reward-base">💰 ${baseReward}</span>`
                 + `<span class="reward-boost-sep"> ⚡×${boostMult} → </span>`
                 + `<span class="reward-final">💰 ${finalReward}</span>`;
    } else {
      rewardHtml = `<span class="reward-value">💰 ${finalReward}</span>`;
    }
  }
  elBlockReward.innerHTML = `${t('ui.reward_label')} : ${rewardHtml}`;
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
      : `${def.icon} ${t('shop_chest.' + def.id + '.name')} — 💰 ${def.cost.toLocaleString()}`;

    card.innerHTML = `
      <div class="shop-chest-header">
        <span class="shop-chest-icon">${def.icon}</span>
        <div class="shop-chest-info">
          <div class="shop-chest-name">${t('shop_chest.' + def.id + '.name')}</div>
          <div class="shop-chest-desc">${t('shop_chest.' + def.id + '.desc')}</div>
        </div>
        <div class="shop-chest-right">
          ${limitHtml}
          <div class="shop-chest-cost${canAfford ? ' can-afford' : ''}">💰 ${def.cost.toLocaleString()}</div>
        </div>
      </div>
      <button class="shop-chest-btn" ${(canAfford && !maxed) ? '' : 'disabled'}
        aria-label="${btnLabel}">
        ${maxed ? t('ui.shop_chest_limit_reached') : t('ui.btn_open_chest')}
      </button>`;

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

    const { ok, data } = await _apiFetch('POST', '/api/me/shop/chest/open', { chestId });

    if (!ok) {
      if (btn) btn.disabled = false;
      showAchievement('❌', data?.error ?? t('ui.shop_chest_error'));
      return;
    }

    // Appliquer l'état retourné par le serveur (source de vérité)
    GameState.coins          = data.newCoins;
    GameState.relicFragments = data.newRelicFragments;
    GameState.shopChestsBought[chestId] = data.boughtThisSeason;
    reward = data.reward;

  } else {
    // ── Mode anonyme : tirage côté client ────────────────────────────────────
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

/** Tirage client-side (joueurs anonymes uniquement — probabilités identiques au serveur). */
function _rollShopChestClient(chestId, def) {
  const tables = {
    simple: [
      { weight: 50, type: 'coins',  min:  80, max:  200 },
      { weight: 25, type: 'coins',  min: 200, max:  500 },
      { weight: 20, type: 'relics', amount: 1 },
      { weight:  5, type: 'boost',  mult: 2, minutes: 3 },
    ],
    rare: [
      { weight: 30, type: 'coins',      min: 1_000, max: 3_000 },
      { weight: 20, type: 'coins',      min: 3_000, max: 8_000 },
      { weight: 25, type: 'relics',     amount: 2 },
      { weight: 12, type: 'relics',     amount: 3 },
      { weight:  8, type: 'boost',      mult: 2, minutes: 10 },
      { weight:  5, type: 'collection', amount: 1 },
    ],
    antique: [
      { weight: 25, type: 'coins',      min: 10_000, max: 25_000 },
      { weight: 25, type: 'relics',     amount:  5 },
      { weight: 15, type: 'relics',     amount: 10 },
      { weight: 13, type: 'boost',      mult: 3, minutes: 15 },
      { weight: 12, type: 'collection', amount:  1 },
      { weight:  7, type: 'relics',     amount: 20 },
      { weight:  3, type: 'relics',     amount: 30 },
    ],
  };
  const table = tables[chestId] ?? tables.simple;
  const total = table.reduce((s, r) => s + r.weight, 0);
  let r = Math.random() * total;
  let entry;
  for (const row of table) { r -= row.weight; if (r <= 0) { entry = row; break; } }
  entry = entry ?? table[table.length - 1];

  const reward = { type: entry.type };
  if (entry.type === 'coins') {
    reward.amount = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
  } else if (entry.type === 'relics') {
    reward.amount = entry.amount + (GameState.relicBonuses?.relicFragmentBonus ?? 0);
  } else if (entry.type === 'boost') {
    reward.mult = entry.mult; reward.minutes = entry.minutes;
  } else if (entry.type === 'collection') {
    const missing = Collection.FINDS.map(f => f.id).filter(id => !GameState.collection.includes(id));
    if (missing.length > 0) {
      reward.itemId = missing[Math.floor(Math.random() * missing.length)];
    } else {
      reward.type = 'relics'; reward.amount = 5;
    }
  }
  return reward;
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
      GameState.collection.push(reward.itemId);
      const find = Collection.FINDS.find(f => f.id === reward.itemId);
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
    const find = Collection.FINDS.find(f => f.id === reward.itemId);
    return find ? `${find.icon} ${t(find.name)}` : '';
  }
  return '';
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

async function _fetchMe() {
  try {
    const { ok, data } = await _apiFetch('GET', '/api/me');
    _account = ok ? (data.user ?? null) : null;
    if (_account) await _syncAfterLogin();
  } catch (_) {
    _account = null;
  }
  // Initialise seasonId et CPS limit même sans compte connecté
  _pollSeason();
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

async function _doLogout() {
  await _apiFetch('POST', '/api/logout');
  _account = null;
}

/** Pousse la sauvegarde locale courante vers le cloud (silencieux).
 *  N'attend pas _account — le cookie de session suffit ; le serveur retourne 401 si non connecté. */
async function _syncToCloud() {
  try {
    const raw = localStorage.getItem(Save.KEY);
    if (!raw) return;
    await _apiFetch('POST', '/api/me/save', { data: JSON.parse(raw) });
  } catch (_) { /* silencieux — 401 ignoré si non connecté */ }
}

/**
 * Synchronise avec le cloud après login/register ou restauration de session.
 * @param {boolean} forceCloud  true = connexion explicite → toujours appliquer le cloud.
 *                              false = restauration de session → comparer les timestamps.
 */
async function _syncAfterLogin(forceCloud = false) {
  try {
    const { ok, data } = await _apiFetch('GET', '/api/me/save');
    if (!ok) return;

    if (data.save) {
      const cloudData = data.save.data;
      const cloudTime = cloudData?.lastSaveTime ?? 0;
      const localRaw  = localStorage.getItem(Save.KEY);
      const localTime = localRaw ? (JSON.parse(localRaw)?.lastSaveTime ?? 0) : 0;

      if (forceCloud || cloudTime > localTime) {
        // Appliquer la sauvegarde cloud
        Save.loadFromData(cloudData);
        // Persister immédiatement en localStorage pour les prochains refreshs
        try {
          localStorage.setItem(Save.KEY, JSON.stringify({
            saveVersion:   Save.SAVE_VERSION,
            lastSaveTime:  cloudData.lastSaveTime ?? Date.now(),
            coins:         GameState.coins,
            gems:          GameState.gems,
            depth:         GameState.depth,
            pickaxeLevel:  GameState.pickaxeLevel,
            damage:        GameState.damage,
            upgrades:      { ...GameState.upgrades },
            collection:    [...GameState.collection],
            quests:        { ...GameState.quests },
            stats:         { ...GameState.stats },
            daily:         { ...GameState.daily },
            coinBoost:     { ...GameState.coinBoost },
            monetization:  { ...GameState.monetization },
            relicFragments: GameState.relicFragments,
            relics:        { ...GameState.relics },
            dailyMissions: {
              date:     GameState.dailyMissions.date,
              missions: GameState.dailyMissions.missions.map(m => ({
                id: m.id, target: m.target,
                reward: { coins: m.reward.coins, gems: m.reward.gems },
                claimed: m.claimed,
              })),
              baselineStats: GameState.dailyMissions.baselineStats
                ? { ...GameState.dailyMissions.baselineStats } : null,
            },
          }));
        } catch (_) { /* localStorage indisponible */ }

        Relics.applyBonuses();
        renderUpgrades();
        renderQuests();
        renderBoostBanner();
        renderStats();
        // Respawn sans animation pour éviter le double-spawn et le bug de bloc vide
        blockAnimating = false;
        Blocks.spawn(GameState.depth);
        renderBlock();
        _hasShownGuestWarning = true; // connecté → plus besoin d'avertir
      } else {
        // Local plus récent → pousser vers le cloud
        await _syncToCloud();
      }
    } else {
      // Pas de sauvegarde cloud → pousser la locale
      await _syncToCloud();
    }
  } catch (_) { /* silencieux */ }
}

// ── Saisons ───────────────────────────────────────────────────────────────────

/** Applique le reset de début de saison (côté client). */
function _applySeasonReset(newSeasonId, gemsCap) {
  GameState.coins           = 0;
  GameState.gems            = Math.min(GameState.gems, gemsCap);
  GameState.coinBoost       = { multiplier: 1, expiresAt: 0 };
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

/** Polling toutes les 5 min : détecte un changement de saison. */
async function _pollSeason() {
  try {
    const { ok, data } = await _apiFetch('GET', '/api/seasons/current');
    if (!ok || !data.season) return;
    _seasonCpsLimit = data.config?.cpsLimit ?? 8;
    if (data.season.id !== GameState.seasonStats.seasonId && GameState.seasonStats.seasonId !== 0) {
      _applySeasonReset(data.season.id, data.config?.gemsCap ?? 100);
    } else if (GameState.seasonStats.seasonId === 0 && data.season.id) {
      // Premier sync : on enregistre juste l'ID sans reset
      GameState.seasonStats.seasonId = data.season.id;
    }
    if (isViewActive('season')) renderSeasonView(data);
  } catch (_) { /* silencieux */ }
}

// ── Rendu vue Saison ─────────────────────────────────────────────────────────

function renderSeasonView(apiData) {
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
  const endsIn   = t('season.ends_in', { d: diffDays, h: diffHrs });

  let playerHtml = '';
  if (!_account) {
    playerHtml = `<p class="season-hint">${t('season.not_connected')}</p>`;
  } else if (!player || !player.isActive) {
    playerHtml = `<p class="season-hint">${t('season.not_active')}</p>`;
  } else {
    const leagueBadge = player.league
      ? `<span class="season-league-badge">${player.league.icon} ${player.league.name}</span>`
      : `<span class="season-league-badge muted">${t('season.no_league')}</span>`;
    playerHtml = `
      <div class="season-player-card">
        <div class="season-player-card-top">
          <div class="season-player-rank">${t('season.rank', { n: player.rank ?? '?' })}</div>
          ${leagueBadge}
        </div>
        <div class="season-player-stats">
          <span>⛏ ${t('season.depth_label')} : <strong>${player.maxDepth}m</strong></span>
          <span>👆 ${t('season.blocks_label')} : <strong>${player.manualBlocks}</strong></span>
        </div>
      </div>`;
  }

  // Section info saison (collapsible)
  const infoHtml = `
    <details class="season-info-card">
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
            </ul>
          </div>
        </div>
      </div>
    </details>`;

  // Charger le leaderboard
  const lbId = 'season-lb-body';
  el.innerHTML = `
    <div class="view-title-bar">${t('season.title')} — ${season.name}</div>
    <p class="season-ends-in">${endsIn}</p>
    ${playerHtml}
    ${infoHtml}
    <h3 class="season-section-title">${t('season.leaderboard')}</h3>
    <div class="season-leaderboard" id="${lbId}">
      <p class="season-loading">${t('season.loading')}</p>
    </div>`;

  _loadLeaderboard(season.id, lbId);
}

async function _loadLeaderboard(seasonId, containerId) {
  try {
    const { ok, data } = await _apiFetch('GET', `/api/seasons/${seasonId}/leaderboard`);
    const el = document.getElementById(containerId);
    if (!el) return;
    if (!ok || !data.leaderboard?.length) {
      el.innerHTML = '<p class="season-empty">Aucun joueur actif pour l\'instant.</p>';
      return;
    }
    el.innerHTML = data.leaderboard.map(row => {
      const medal  = row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`;
      const league = row.league ? `<span class="lb-league">${row.league.icon}</span>` : '';
      const isMe   = _account && row.username === _account.username;
      return `<div class="lb-row${isMe ? ' lb-row-me' : ''}">
        <span class="lb-rank">${medal}</span>
        <span class="lb-name">${league}${row.username}</span>
        <span class="lb-depth">${row.maxDepth}m</span>
        <span class="lb-blocks">👆${row.manualBlocks}</span>
      </div>`;
    }).join('');
  } catch (_) {}
}

async function _openSeasonView() {
  const el = document.getElementById('view-season');
  if (el) el.innerHTML = `<div class="view-title-bar">${t('season.title')}</div><p class="season-loading">${t('season.loading')}</p>`;
  try {
    const { ok, data } = await _apiFetch('GET', '/api/seasons/current');
    if (ok && data.season) {
      _seasonCpsLimit = data.config?.cpsLimit ?? 8;
      renderSeasonView(data);
    }
  } catch (_) {}
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

  // ── Section compte ──
  const accountHtml = _account
    ? `<div class="settings-section">
        <div class="settings-section-label">${t('account.title')}</div>
        <div class="account-logged">
          <div class="account-username">👤 ${t('account.logged_as', { name: _account.username })}</div>
          <button class="account-logout-btn" id="btn-account-logout">${t('account.btn_logout')}</button>
        </div>
      </div>`
    : `<div class="settings-section">
        <div class="settings-section-label">${t('account.title')}</div>
        <div class="account-tabs">
          <button class="account-tab${_accountTab === 'login'    ? ' is-active' : ''}" data-tab="login">${t('account.tab_login')}</button>
          <button class="account-tab${_accountTab === 'register' ? ' is-active' : ''}" data-tab="register">${t('account.tab_register')}</button>
        </div>
        <div class="account-form">
          <input class="account-input" id="acc-username" type="text"
            placeholder="${t('account.label_username')}" autocomplete="username" maxlength="20">
          ${_accountTab === 'register'
            ? `<input class="account-input" id="acc-email" type="email"
                placeholder="${t('account.label_email')}" autocomplete="email">`
            : ''}
          <input class="account-input" id="acc-password" type="password"
            placeholder="${t('account.label_password')}" autocomplete="${_accountTab === 'register' ? 'new-password' : 'current-password'}">
          ${_accountTab === 'register'
            ? `<p class="account-hint">${t('account.hint_username')}<br>${t('account.hint_email')}<br>${t('account.hint_password')}</p>`
            : ''}
          <button class="account-submit-btn" id="btn-account-submit">
            ${_accountTab === 'login' ? t('account.btn_login') : t('account.btn_register')}
          </button>
          <p class="account-error" id="acc-error"></p>
        </div>
      </div>`;

  // Compte en premier → plus visible, puis langue
  container.innerHTML = `
    <div class="view-title-bar">${t('settings.title')}</div>
    ${accountHtml}
    <div class="settings-section">
      <div class="settings-section-label">${t('settings.lang_title')}</div>
      <div class="lang-options-list">${optionsHtml}</div>
    </div>
    <button class="settings-back-btn" id="btn-settings-back">
      ${t('settings.btn_back')}
    </button>
    <p class="settings-version">${window.APP_VERSION || '—'}</p>`;

  // Changement de langue
  container.querySelectorAll('.lang-option').forEach(btn => {
    btn.addEventListener('click', () => {
      I18n.setLang(btn.dataset.lang);
      renderSettings();
    });
  });

  // Onglets compte (login / register)
  container.querySelectorAll('.account-tab').forEach(btn => {
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

  // Submit login / register
  const submitBtn = document.getElementById('btn-account-submit');
  if (submitBtn) {
    const doSubmit = async () => {
      const username = document.getElementById('acc-username').value.trim();
      const email    = (document.getElementById('acc-email')?.value ?? '').trim();
      const password = document.getElementById('acc-password').value;
      const errEl    = document.getElementById('acc-error');
      errEl.textContent = '';
      submitBtn.disabled = true;

      const error = _accountTab === 'login'
        ? await _doLogin(username, password)
        : await _doRegister(username, email, password);

      if (error) {
        errEl.textContent = error;
        submitBtn.disabled = false;
      } else {
        await _syncAfterLogin(true); // connexion explicite → toujours appliquer le cloud
        await _pollSeason();
        renderSettings();
      }
    };

    submitBtn.addEventListener('click', doSubmit);

    // Submit on Enter key in any input
    ['acc-username', 'acc-email', 'acc-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doSubmit(); });
    });
  }

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
    // Si des fragments ont été gagnés, signaler si une relique devient abordable/améliorable
    if (reward.type === 'relics' && Relics.DEFS.some(r => Relics.canUnlock(r.id) || Relics.canUpgrade(r.id))) {
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

  // Safety: if no block is spawned yet (e.g. init failed silently), spawn one now
  if (!Blocks.current) { spawnBlock(); return; }

  // Chaque clic compte comme manuel, qu'il détruise ou non le bloc
  GameState.seasonStats.manualClicks++;
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
  if (dmg === 0 || blockAnimating) return;

  const destroyed = Blocks.hit(dmg);
  if (destroyed) {
    const rect = elBlock.getBoundingClientRect();
    handleBlockDestroyed(rect.left + rect.width / 2, rect.top + rect.height / 2, { isAuto: true });
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
  Relics.applyBonuses();          // recompute (tout à 0 après reset)
  renderUpgrades();
  renderShopChests();
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
    if (isViewActive('dig'))        { renderBlock(); renderStats(); }
    if (isViewActive('settings'))   renderSettings();
    if (isViewActive('upgrades'))   { renderUpgrades(); renderShopChests(); renderQuests(); }
    if (isViewActive('collection')) { renderCollection(); renderRelics(); }
    if (isViewActive('daily'))      renderDaily();
    if (isViewActive('shop'))       renderShop();
  });

  Save.onSave = () => { showSaveToast(); _syncToCloud(); };
  Save.load();

  Relics.applyBonuses();   // recalcule les bonus depuis GameState.relics chargé
  const offlineGains = computeOfflineGains(); // calculé ici, après applyBonuses()

  Quests.checkAll(true);   // vérification silencieuse (migration / reprise)
  DailyMissions.refresh(); // génère les missions du jour si besoin

  renderUpgrades();
  renderShopChests();
  renderQuests();
  renderBoostBanner();
  renderAdButton();
  spawnBlock();
  renderStats();

  updateDailyBadge();
  if (Relics.DEFS.some(r => Relics.canUnlock(r.id) || Relics.canUpgrade(r.id))) setNavBadge('collection');

  if (offlineGains) showOfflinePopup(offlineGains);

  setInterval(() => Save.save(),  15_000);
  setInterval(autoDigTick,         1_000);
  setInterval(() => { renderBoostBanner(); renderAdButton(); }, 1_000);
  setInterval(_pollSeason,      5 * 60_000); // vérifie la saison toutes les 5 min

  // Récupère l'état de session (non bloquant — la page est déjà jouable)
  _fetchMe();
}

document.addEventListener('DOMContentLoaded', init);
