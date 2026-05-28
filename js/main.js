/**
 * main.js
 * Point d'entrée : gestion du DOM, des événements et de la boucle de jeu.
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
const elHpBar       = document.getElementById('hp-bar');
const elHpText      = document.getElementById('hp-text');
const elUpgradeBtn  = document.getElementById('btn-upgrade');
const elUpgradeCost = document.getElementById('upgrade-cost');
const elResetBtn    = document.getElementById('btn-reset');

// ── État interne ─────────────────────────────────────────────────────────────
let blockAnimating = false; // empêche les clics pendant l'anim de destruction

// ── Rendu ────────────────────────────────────────────────────────────────────

function renderStats() {
  elCoins.textContent   = GameState.coins;
  elDepth.textContent   = `${GameState.depth}m`;
  elPickaxe.textContent = `Nv.${GameState.pickaxeLevel}`;
  elDamage.textContent  = GameState.damage;

  const cost = GameState.getUpgradeCost();
  elUpgradeCost.textContent  = `💰 ${cost}`;
  elUpgradeBtn.disabled      = !GameState.canAffordUpgrade();
}

function renderBlock() {
  const b = Blocks.current;
  if (!b) return;

  elBlockName.textContent    = b.type.name;
  elBlockIcon.textContent    = b.type.icon;
  elBlock.style.background   = b.type.color;

  const ratio = Blocks.hpRatio();
  elHpBar.style.width = `${(ratio * 100).toFixed(1)}%`;
  elHpText.textContent = `${b.hp} / ${b.maxHp} HP`;

  // Couleur de la barre selon les HP
  elHpBar.classList.remove('low', 'critical');
  if (ratio <= 0.25)      elHpBar.classList.add('critical');
  else if (ratio <= 0.55) elHpBar.classList.add('low');

  // Classe de craquelure visuelle
  elBlock.classList.remove('crack-1', 'crack-2', 'crack-3');
  if (ratio < 0.25)       elBlock.classList.add('crack-3');
  else if (ratio < 0.55)  elBlock.classList.add('crack-2');
  else if (ratio < 0.80)  elBlock.classList.add('crack-1');
}

// ── Textes flottants ──────────────────────────────────────────────────────────

function spawnFloatText(text, cssClass, clientX, clientY) {
  const el = document.createElement('div');
  el.className  = `float-text ${cssClass}`;
  el.textContent = text;
  // Décale aléatoirement pour éviter la superposition en cas de clics rapides
  el.style.left = `${clientX + (Math.random() * 20 - 10)}px`;
  el.style.top  = `${clientY - 10}px`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove(), { once: true });
}

// ── Logique de jeu ────────────────────────────────────────────────────────────

function spawnBlock() {
  Blocks.spawn(GameState.depth);

  // Retire les classes d'animation précédentes
  elBlock.classList.remove('anim-break', 'anim-hit', 'crack-1', 'crack-2', 'crack-3');

  // Petite astuce : forcer le reflow pour relancer l'animation
  void elBlock.offsetWidth;

  elBlock.classList.add('anim-spawn');
  elBlock.addEventListener('animationend', () => {
    elBlock.classList.remove('anim-spawn');
  }, { once: true });

  renderBlock();
}

function onBlockHit(cx, cy) {
  if (blockAnimating) return;

  const destroyed = Blocks.hit(GameState.damage);

  // Animation de frappe
  elBlock.classList.remove('anim-hit');
  void elBlock.offsetWidth;
  elBlock.classList.add('anim-hit');
  elBlock.addEventListener('animationend', () => {
    elBlock.classList.remove('anim-hit');
  }, { once: true });

  // Texte flottant dégâts
  spawnFloatText(`-${GameState.damage}`, 'dmg', cx, cy);

  if (destroyed) {
    const reward = Blocks.current.reward;
    GameState.addCoins(reward);
    GameState.nextDepth();
    spawnFloatText(`+${reward} 💰`, 'coin', cx + 12, cy - 20);

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

// ── Gestion des événements ────────────────────────────────────────────────────

function coordsFromEvent(e) {
  if (e.touches && e.touches.length > 0) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

elBlock.addEventListener('click', (e) => {
  const { x, y } = coordsFromEvent(e);
  onBlockHit(x, y);
});

// Sur mobile, touchstart donne un retour plus réactif que click
elBlock.addEventListener('touchstart', (e) => {
  e.preventDefault(); // empêche le click synthétique qui suivrait
  const { x, y } = coordsFromEvent(e);
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

  // Sauvegarde automatique toutes les 15 secondes
  setInterval(() => Save.save(), 15_000);
}

document.addEventListener('DOMContentLoaded', init);
