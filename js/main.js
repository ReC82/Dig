/**
 * main.js
 * Point d'entrée : DOM, événements, rendu.
 * Dépend de : GameState, Blocks, Upgrades, Save
 */

// ── Références DOM ──────────────────────────────────────────────────────────
const elCoins       = document.getElementById('stat-coins');
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
const elUpgradeBtn  = document.getElementById('btn-upgrade');
const elUpgradeCost = document.getElementById('upgrade-cost');
const elResetBtn    = document.getElementById('btn-reset');

// ── État interne ─────────────────────────────────────────────────────────────
let blockAnimating = false;

// ── Rendu ─────────────────────────────────────────────────────────────────────

function renderStats() {
  elCoins.textContent   = GameState.coins;
  elDepth.textContent   = `${GameState.depth}m`;
  elPickaxe.textContent = `Nv.${GameState.pickaxeLevel}`;
  elDamage.textContent  = GameState.damage;

  const cost = GameState.getUpgradeCost();
  elUpgradeCost.textContent = `💰 ${cost}`;
  elUpgradeBtn.disabled     = !GameState.canAffordUpgrade();
}

function renderBlock() {
  const b = Blocks.current;
  if (!b) return;

  // Nom, icône, couleur
  elBlockName.textContent  = b.type.name;
  elBlockIcon.textContent  = b.type.icon;
  elBlock.style.background = b.type.color;

  // Badge de rareté
  elBlockRarity.innerHTML = `<span class="rarity-badge rarity-${b.type.rarityKey}">${b.type.rarity}</span>`;

  // Rarity glow sur le bloc
  elBlock.classList.remove('rarity-commun', 'rarity-peu-commun', 'rarity-rare', 'rarity-epique', 'rarity-legendaire');
  elBlock.classList.add(`rarity-${b.type.rarityKey}`);

  // Barre de vie
  const ratio = Blocks.hpRatio();
  elHpBar.style.width  = `${(ratio * 100).toFixed(1)}%`;
  elHpText.textContent = `${b.hp} / ${b.maxHp} HP`;

  elHpBar.classList.remove('low', 'critical');
  if (ratio <= 0.25)      elHpBar.classList.add('critical');
  else if (ratio <= 0.55) elHpBar.classList.add('low');

  // Craquelures
  elBlock.classList.remove('crack-1', 'crack-2', 'crack-3');
  if (ratio < 0.25)      elBlock.classList.add('crack-3');
  else if (ratio < 0.55) elBlock.classList.add('crack-2');
  else if (ratio < 0.80) elBlock.classList.add('crack-1');

  // Récompense potentielle
  elBlockReward.innerHTML = `Récompense : <span class="reward-value">💰 ${b.reward}</span>`;
}

// ── Particules ────────────────────────────────────────────────────────────────

function spawnParticles(color) {
  const rect  = elBlock.getBoundingClientRect();
  const cx    = rect.left + rect.width  / 2;
  const cy    = rect.top  + rect.height / 2;
  const count = 10;

  for (let i = 0; i < count; i++) {
    const p     = document.createElement('div');
    p.className = 'particle';
    p.style.left       = `${cx}px`;
    p.style.top        = `${cy}px`;
    p.style.background = color;

    // Direction régulièrement répartie + petite variation aléatoire
    const angle = (i / count) * 360 + (Math.random() * 30 - 15);
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
  void elBlock.offsetWidth; // force reflow pour relancer l'animation

  elBlock.classList.add('anim-spawn');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-spawn'), { once: true });

  renderBlock();
}

function onBlockHit(cx, cy) {
  if (blockAnimating) return;

  const destroyed = Blocks.hit(GameState.damage);

  // Animation de frappe
  elBlock.classList.remove('anim-hit');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-hit');
  elBlock.addEventListener('animationend', () => elBlock.classList.remove('anim-hit'), { once: true });

  spawnFloatText(`-${GameState.damage}`, 'dmg', cx, cy);

  if (destroyed) {
    const { reward, type } = Blocks.current;
    GameState.addCoins(reward);
    GameState.nextDepth();

    // Textes spéciaux selon la catégorie
    spawnFloatText(`+${reward} 💰`, 'coin', cx + 12, cy - 22);
    if (type.isGem)   spawnFloatText('✨ GEMME !',  'gem',   cx, cy - 52);
    if (type.isChest) spawnFloatText('📦 COFFRE !', 'chest', cx, cy - 52);

    // Particules couleur du bloc
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

  renderBlock();
  renderStats();
  Save.save();
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

// touchstart = retour immédiat sur mobile ; preventDefault évite le double-feu
elBlock.addEventListener('touchstart', (e) => {
  e.preventDefault();
  const { x, y } = coordsFrom(e);
  onBlockHit(x, y);
}, { passive: false });

elUpgradeBtn.addEventListener('click', () => {
  if (Upgrades.upgradePickaxe()) {
    renderStats();
    Save.save();
  }
});

elResetBtn.addEventListener('click', () => {
  if (!confirm('Réinitialiser la partie ? Toute progression sera perdue.')) return;
  Save.reset();
  spawnBlock();
  renderStats();
});

// ── Initialisation ────────────────────────────────────────────────────────────

function init() {
  Save.load();
  spawnBlock();
  renderStats();
  setInterval(() => Save.save(), 15_000);
}

document.addEventListener('DOMContentLoaded', init);
