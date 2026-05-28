/**
 * main.js
 * Point d'entrée : DOM, événements, rendu.
 * Dépend de : GameState, Blocks, Upgrades, Collection, Quests, Daily, Save
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

// ── État interne ─────────────────────────────────────────────────────────────
let blockAnimating = false;
let toastTimer     = null;

// ── Toast "Sauvegardé" ────────────────────────────────────────────────────────

function showSaveToast() {
  elSaveToast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elSaveToast.classList.remove('visible'), 2000);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(panelId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isActive = btn.dataset.panel === panelId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  document.querySelectorAll('.panel').forEach(p => {
    p.classList.toggle('hidden', p.id !== `panel-${panelId}`);
  });

  // Rendu paresseux + effacement du badge
  if (panelId === 'quests') {
    renderQuests();
    clearTabBadge('quests');
  }
  if (panelId === 'collection') {
    renderCollection();
    clearTabBadge('collection');
  }
  if (panelId === 'daily') {
    renderDaily();
    clearTabBadge('daily');
  }
}

function setTabBadge(name) {
  const el = document.getElementById(`badge-${name}`);
  if (el) el.hidden = false;
}

function clearTabBadge(name) {
  const el = document.getElementById(`badge-${name}`);
  if (el) el.hidden = true;
}

function isTabActive(panelId) {
  const p = document.getElementById(`panel-${panelId}`);
  return p ? !p.classList.contains('hidden') : false;
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.panel));
});

// ── Rendu stats ───────────────────────────────────────────────────────────────

function renderStats() {
  elCoins.textContent   = GameState.coins;
  elGems.textContent    = GameState.gems;
  elDepth.textContent   = `${GameState.depth}m`;
  elPickaxe.textContent = `Nv.${GameState.pickaxeLevel}`;
  elDamage.textContent  = GameState.damage;
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
  const mult = GameState.coinBoost.multiplier;
  elBoostText.textContent  = `⚡ Bonus ×${mult} pièces actif`;
  elBoostTimer.textContent = `— ${min}:${String(sec).padStart(2, '0')} restant`;
}

// ── Rendu bloc ────────────────────────────────────────────────────────────────

function renderBlock() {
  const b = Blocks.current;
  if (!b) return;

  elBlockName.textContent  = b.type.name;
  elBlockIcon.textContent  = b.type.icon;
  elBlock.style.background = b.type.color;

  elBlockRarity.innerHTML = `<span class="rarity-badge rarity-${b.type.rarityKey}">${b.type.rarity}</span>`;

  elBlock.classList.remove(
    'rarity-commun','rarity-peu-commun','rarity-rare','rarity-epique','rarity-legendaire'
  );
  elBlock.classList.add(`rarity-${b.type.rarityKey}`);

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

  const boostMult  = GameState.getCoinBoostMultiplier();
  const finalReward = Math.ceil(b.reward * Upgrades.getRewardMultiplier() * boostMult);
  const boostTag   = boostMult > 1 ? ` <span class="boost-tag">⚡×${boostMult}</span>` : '';
  elBlockReward.innerHTML = `Récompense : <span class="reward-value">💰 ${finalReward}${boostTag}</span>`;
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
            ${def.name}
            <span class="upgrade-level">Nv.${level}${maxed ? ' <span class="maxed-tag">MAX</span>' : ''}</span>
          </div>
          <div class="upgrade-desc">${def.describe(level)}</div>
        </div>
      </div>
      <button class="upgrade-btn${maxed ? ' is-maxed' : ''}" data-id="${def.id}"
        ${maxed || !canAfford ? 'disabled' : ''} aria-label="Améliorer ${def.name}">
        ${maxed ? 'MAX' : `Améliorer<span class="btn-cost">${costHtml}</span>`}
      </button>`;

    if (!maxed) {
      card.querySelector('.upgrade-btn').addEventListener('click', () => {
        if (Upgrades.buy(def.id)) {
          renderUpgrades();
          renderStats();
          const completed = Quests.checkAll();
          handleQuestsCompleted(completed);
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
        <div class="quest-name">${def.name}</div>
        <div class="quest-desc">${def.desc}</div>
      </div>
      <div class="quest-reward">${done ? '✓ Réclamé' : parts.join(' + ')}</div>`;

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
  if (header) header.textContent = `${found} / ${total} trouvée${found !== 1 ? 's' : ''}`;

  grid.innerHTML = '';
  for (const find of Collection.FINDS) {
    const isFound = GameState.collection.includes(find.id);
    const card = document.createElement('div');
    card.className = `find-card${isFound ? ' found' : ''}`;
    if (isFound) card.title = find.desc;

    card.innerHTML = `
      <div class="find-icon">${isFound ? find.icon : '?'}</div>
      <div class="find-name">${isFound ? find.name : '???'}</div>`;

    grid.appendChild(card);
  }
}

// ── Rendu quotidien ───────────────────────────────────────────────────────────

function renderDaily() {
  const container = document.getElementById('panel-daily');
  if (!container) return;

  const today          = Daily.getToday();
  const yesterday      = Daily.getYesterday();
  const last           = GameState.daily.lastClaimDate;
  const lastDay        = GameState.daily.streakDay;  // 0 si jamais réclamé
  const claimedToday   = (last === today);
  const streakContinues = (last === yesterday);
  const nextDay        = Daily.getNextDay();
  const available      = Daily.isAvailable();

  // ── Ligne des 7 cercles ────────────────────────────────────────────────────
  let html = `<div class="daily-title">Connexion quotidienne</div>`;
  html += `<div class="streak-row">`;

  for (let i = 1; i <= 7; i++) {
    let state;
    if (claimedToday) {
      if (i < lastDay)      state = 'done';
      else if (i === lastDay) state = 'claimed-today';
      else                  state = 'upcoming';
    } else {
      const doneBefore = streakContinues && i < nextDay;
      if (doneBefore)      state = 'done';
      else if (i === nextDay) state = 'available';
      else                 state = 'upcoming';
    }

    const r = Daily.REWARDS[i - 1];
    html += `
      <div class="streak-day ${state}">
        <div class="streak-circle">${(state === 'done' || state === 'claimed-today') ? '✓' : i}</div>
        <div class="streak-icon">${r.icon}</div>
      </div>`;
  }

  html += `</div>`;

  // ── Bloc récompense / message ──────────────────────────────────────────────
  if (available) {
    const r = Daily.REWARDS[nextDay - 1];
    const parts = [];
    if (r.coins > 0) parts.push(`💰 ${r.coins} pièces`);
    if (r.gems  > 0) parts.push(`💎 ${r.gems} gemme${r.gems > 1 ? 's' : ''}`);
    if (r.boost) parts.push(`⚡ ×${r.boost.mult} coins pendant ${r.boost.minutes} min`);

    html += `
      <div class="daily-reward-box">
        <div class="daily-reward-day">Jour ${nextDay} sur 7</div>
        <div class="daily-reward-items">${parts.join(' + ')}</div>
      </div>
      <button class="claim-btn" id="btn-claim">Réclamer la récompense</button>`;
  } else {
    html += `
      <div class="daily-claimed-msg"><span class="claimed-check">✓</span>Récompense réclamée !</div>
      <div class="daily-next-msg">Reviens demain pour continuer ta série.</div>`;
  }

  container.innerHTML = html;

  // ── Bouton de réclamation ──────────────────────────────────────────────────
  if (available) {
    document.getElementById('btn-claim').addEventListener('click', () => {
      const result = Daily.claim();
      if (!result) return;

      const { reward, day } = result;
      const parts = [];
      if (reward.coins > 0) parts.push(`💰 ${reward.coins}`);
      if (reward.gems  > 0) parts.push(`💎 ${reward.gems}`);
      if (reward.boost) parts.push(`⚡ ×${reward.boost.mult}`);
      showAchievement('📅', `Jour ${day} : ${parts.join(' + ')} !`);

      if (reward.boost) renderBoostBanner();

      clearTabBadge('daily');
      renderDaily();
      renderStats();
      Save.save();

      const completed = Quests.checkAll();
      handleQuestsCompleted(completed);
    });
  }
}

// ── Notifications (objectifs & trouvailles) ───────────────────────────────────

function showAchievement(icon, text) {
  const el = document.createElement('div');
  el.className   = 'float-text achievement';
  el.textContent = `${icon} ${text}`;
  el.style.left  = `${window.innerWidth / 2}px`;
  el.style.top   = `${window.innerHeight * 0.22}px`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

function handleQuestsCompleted(completed) {
  if (completed.length === 0) return;
  completed.forEach((q, i) => {
    setTimeout(() => showAchievement('🎯', `${q.name} terminé !`), i * 500);
  });
  renderStats(); // les récompenses peuvent changer coins/gems
  if (isTabActive('quests')) renderQuests();
  else setTabBadge('quests');
}

function handleFindDrop(find) {
  showAchievement('🔍', `${find.name} trouvé !`);
  if (isTabActive('collection')) renderCollection();
  else setTabBadge('collection');
}

// ── Particules ────────────────────────────────────────────────────────────────

function spawnParticles(color) {
  const rect = elBlock.getBoundingClientRect();
  const cx   = rect.left + rect.width  / 2;
  const cy   = rect.top  + rect.height / 2;

  for (let i = 0; i < 10; i++) {
    const p     = document.createElement('div');
    p.className = 'particle';
    p.style.left       = `${cx}px`;
    p.style.top        = `${cy}px`;
    p.style.background = color;

    const angle = (i / 10) * 360 + (Math.random() * 30 - 15);
    const dist  = 38 + Math.random() * 52;
    p.style.setProperty('--dx', `${Math.cos(angle * Math.PI / 180) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle * Math.PI / 180) * dist}px`);

    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove(), { once: true });
  }
}

// ── Textes flottants ──────────────────────────────────────────────────────────

function spawnFloatText(text, cssClass, cx, cy) {
  const el       = document.createElement('div');
  el.className   = `float-text ${cssClass}`;
  el.textContent = text;
  el.style.left  = `${cx + (Math.random() * 20 - 10)}px`;
  el.style.top   = `${cy - 10}px`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// ── Logique de jeu ────────────────────────────────────────────────────────────

function spawnBlock() {
  Blocks.spawn(GameState.depth);
  elBlock.classList.remove('anim-break','anim-hit','crack-1','crack-2','crack-3');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-spawn');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-spawn'), { once: true });
  renderBlock();
}

function handleBlockDestroyed(cx, cy) {
  const { reward: baseReward, type } = Blocks.current;
  const depth  = GameState.depth;
  const reward = Math.ceil(baseReward * Upgrades.getRewardMultiplier() * GameState.getCoinBoostMultiplier());

  GameState.addCoins(reward);
  GameState.nextDepth();
  GameState.recordDestroy(reward, type);

  spawnFloatText(`+${reward} 💰`, 'coin', cx + 12, cy - 22);
  if (type.isGem)   spawnFloatText('✨ GEMME !',  'gem',   cx, cy - 52);
  if (type.isChest) spawnFloatText('📦 COFFRE !', 'chest', cx, cy - 52);
  spawnParticles(type.accent);

  // Tentative de drop de trouvaille
  const find = Collection.tryDrop(type, depth);
  if (find) handleFindDrop(find);

  // Vérification des objectifs
  const completed = Quests.checkAll();
  handleQuestsCompleted(completed);

  blockAnimating = true;
  elBlock.classList.remove('anim-hit','crack-1','crack-2','crack-3');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-break');
  elBlock.addEventListener('animationend', () => {
    blockAnimating = false;
    spawnBlock();
  }, { once: true });
}

function onBlockHit(cx, cy) {
  if (blockAnimating) return;

  const destroyed = Blocks.hit(GameState.damage);

  elBlock.classList.remove('anim-hit');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-hit');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-hit'), { once: true });

  spawnFloatText(`-${GameState.damage}`, 'dmg', cx, cy);

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

elResetBtn.addEventListener('click', () => {
  if (!confirm('Réinitialiser la partie ?\nTous les coins, gemmes, upgrades, objectifs, trouvailles et la série quotidienne seront perdus.')) return;
  Save.reset();
  renderUpgrades();
  renderQuests();
  renderCollection();
  renderBoostBanner();
  if (isTabActive('daily')) renderDaily();
  if (Daily.isAvailable()) setTabBadge('daily');
  spawnBlock();
  renderStats();
});

// ── Initialisation ────────────────────────────────────────────────────────────

function init() {
  Save.onSave = showSaveToast;

  Save.load();

  // Vérifier silencieusement les objectifs déjà remplis (migration / reprise)
  Quests.checkAll(true);

  renderUpgrades();
  spawnBlock();
  renderStats();
  renderBoostBanner();

  // Badge sur l'onglet Quotidien si une récompense est disponible
  if (Daily.isAvailable()) setTabBadge('daily');

  setInterval(() => Save.save(),   15_000);
  setInterval(autoDigTick,          1_000);
  setInterval(renderBoostBanner,    1_000);
}

document.addEventListener('DOMContentLoaded', init);
