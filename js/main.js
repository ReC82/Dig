/**
 * main.js
 * Point d'entrée : DOM, événements, rendu.
 * Dépend de : GameState, Blocks, Upgrades, Save
 */

// ── Références DOM fixes ────────────────────────────────────────────────────
const elCoins       = document.getElementById('stat-coins');
const elGems        = document.getElementById('stat-gems');
const elDepth       = document.getElementById('stat-depth');
const elPickaxe     = document.getElementById('stat-pickaxe');
const elDamage      = document.getElementById('stat-damage');
const elBlock       = document.getElementById('block');
const elBlockIcon   = document.getElementById('block-icon');
const elBlockName   = document.getElementById('block-name');
const elBlockRarity = document.getElementById('block-rarity');
const elBlockReward = document.getElementById('block-reward');
const elHpBar       = document.getElementById('hp-bar');
const elHpText      = document.getElementById('hp-text');
const elUpgradesList = document.getElementById('upgrades-list');
const elResetBtn    = document.getElementById('btn-reset');
const elSaveToast   = document.getElementById('save-toast');

// ── État interne ─────────────────────────────────────────────────────────────
let blockAnimating = false;
let toastTimer     = null;

// ── Toast ─────────────────────────────────────────────────────────────────────

function showSaveToast() {
  elSaveToast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elSaveToast.classList.remove('visible'), 2000);
}

// ── Rendu stats ───────────────────────────────────────────────────────────────

function renderStats() {
  elCoins.textContent   = GameState.coins;
  elGems.textContent    = GameState.gems;
  elDepth.textContent   = `${GameState.depth}m`;
  elPickaxe.textContent = `Nv.${GameState.pickaxeLevel}`;
  elDamage.textContent  = GameState.damage;

  updateUpgradeButtonStates();
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
    'rarity-commun', 'rarity-peu-commun', 'rarity-rare', 'rarity-epique', 'rarity-legendaire'
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

  // Récompense finale (bag multiplier inclus)
  const finalReward = Math.ceil(b.reward * Upgrades.getRewardMultiplier());
  elBlockReward.innerHTML = `Récompense : <span class="reward-value">💰 ${finalReward}</span>`;
}

// ── Rendu upgrades ────────────────────────────────────────────────────────────

/**
 * Crée (ou recrée) les cartes d'upgrade.
 * Appelé une seule fois à l'init, puis après chaque achat.
 */
function renderUpgrades() {
  elUpgradesList.innerHTML = '';

  for (const def of Upgrades.DEFS) {
    const level  = Upgrades.getLevel(def.id);
    const cost   = def.getCost(level);
    const maxed  = cost === null;

    // Construction de l'affichage du coût
    let costHtml;
    if (maxed) {
      costHtml = '';
    } else {
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
      <button
        class="upgrade-btn${maxed ? ' is-maxed' : ''}"
        data-id="${def.id}"
        ${maxed || !canAfford ? 'disabled' : ''}
        aria-label="Améliorer ${def.name}"
      >${maxed ? 'MAX' : `Améliorer<span class="btn-cost">${costHtml}</span>`}</button>
    `;

    if (!maxed) {
      card.querySelector('.upgrade-btn').addEventListener('click', () => {
        if (Upgrades.buy(def.id)) {
          renderUpgrades();   // recrée les cartes (niveaux / coûts mis à jour)
          renderStats();
          Save.save();
        }
      });
    }

    elUpgradesList.appendChild(card);
  }
}

/**
 * Met à jour uniquement l'état disabled des boutons.
 * Appelé à chaque changement de coins/gems (fréquent).
 */
function updateUpgradeButtonStates() {
  for (const def of Upgrades.DEFS) {
    const btn = elUpgradesList.querySelector(`.upgrade-btn[data-id="${def.id}"]`);
    if (!btn || btn.classList.contains('is-maxed')) continue;
    btn.disabled = !Upgrades.canAfford(def.id);
  }
}

// ── Particules ────────────────────────────────────────────────────────────────

function spawnParticles(color) {
  const rect  = elBlock.getBoundingClientRect();
  const cx    = rect.left + rect.width  / 2;
  const cy    = rect.top  + rect.height / 2;

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

  elBlock.classList.remove('anim-break', 'anim-hit', 'crack-1', 'crack-2', 'crack-3');
  void elBlock.offsetWidth;

  elBlock.classList.add('anim-spawn');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-spawn'), { once: true });

  renderBlock();
}

/**
 * Logique commune à la destruction d'un bloc (clic ou auto-dig).
 * Calcule la récompense finale, met à jour le state, lance les effets visuels.
 */
function handleBlockDestroyed(cx, cy) {
  const { reward: baseReward, type } = Blocks.current;
  const reward = Math.ceil(baseReward * Upgrades.getRewardMultiplier());

  GameState.addCoins(reward);
  GameState.nextDepth();
  GameState.recordDestroy(reward, type);

  spawnFloatText(`+${reward} 💰`, 'coin', cx + 12, cy - 22);
  if (type.isGem)   spawnFloatText('✨ GEMME !',  'gem',   cx, cy - 52);
  if (type.isChest) spawnFloatText('📦 COFFRE !', 'chest', cx, cy - 52);
  spawnParticles(type.accent);

  blockAnimating = true;
  elBlock.classList.remove('anim-hit', 'crack-1', 'crack-2', 'crack-3');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-break');
  elBlock.addEventListener('animationend', () => {
    blockAnimating = false;
    spawnBlock();
  }, { once: true });
}

/** Frappe manuelle (clic / tap). */
function onBlockHit(cx, cy) {
  if (blockAnimating) return;

  const destroyed = Blocks.hit(GameState.damage);

  elBlock.classList.remove('anim-hit');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-hit');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-hit'), { once: true });

  spawnFloatText(`-${GameState.damage}`, 'dmg', cx, cy);

  if (destroyed) {
    handleBlockDestroyed(cx, cy);
  }

  renderBlock();
  renderStats();
  Save.save();
}

/** Frappe automatique (Auto-Dig, 1 tick/sec). */
function autoDigTick() {
  const dmg = Upgrades.getAutoDigDamage();
  if (dmg === 0 || blockAnimating) return;

  const destroyed = Blocks.hit(dmg);

  if (destroyed) {
    const rect = elBlock.getBoundingClientRect();
    handleBlockDestroyed(
      rect.left + rect.width  / 2,
      rect.top  + rect.height / 2
    );
  }

  renderBlock();
  renderStats();
  // Pas de Save.save() ici : la sauvegarde auto toutes les 15s suffit
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
  if (!confirm('Réinitialiser la partie ?\nTous les coins, gemmes et upgrades seront perdus.')) return;
  Save.reset();
  renderUpgrades();
  spawnBlock();
  renderStats();
});

// ── Initialisation ────────────────────────────────────────────────────────────

function init() {
  Save.onSave = showSaveToast;

  Save.load();
  renderUpgrades();
  spawnBlock();
  renderStats();

  setInterval(() => Save.save(), 15_000);  // sauvegarde auto
  setInterval(autoDigTick, 1000);          // auto-dig (inoffensif si level 0)
}

document.addEventListener('DOMContentLoaded', init);
