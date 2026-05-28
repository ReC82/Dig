/**
 * daily.js
 * Récompense quotidienne et série de connexion sur 7 jours.
 * Dépend de : GameState
 */
const Daily = {

  // ── Récompenses (jour 1 → 7) ─────────────────────────────────────────────
  REWARDS: [
    { day: 1, coins:  50, gems: 0, boost: null,                    icon: '💰' },
    { day: 2, coins: 150, gems: 0, boost: null,                    icon: '💰' },
    { day: 3, coins:   0, gems: 1, boost: null,                    icon: '💎' },
    { day: 4, coins: 400, gems: 0, boost: null,                    icon: '💰' },
    { day: 5, coins:   0, gems: 2, boost: null,                    icon: '💎' },
    { day: 6, coins: 100, gems: 0, boost: { mult: 2, minutes: 5 }, icon: '⚡' },
    { day: 7, coins: 600, gems: 4, boost: null,                    icon: '🎁' },
  ],

  // ── Dates ─────────────────────────────────────────────────────────────────

  getToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  getYesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // ── État ──────────────────────────────────────────────────────────────────

  isAvailable() {
    return GameState.daily.lastClaimDate !== this.getToday();
  },

  /**
   * Retourne le numéro du jour qui sera réclamé au prochain claim (1–7).
   * - Jamais réclamé           → 1
   * - Déjà réclamé aujourd'hui → jour déjà réclamé (inchangé)
   * - Réclamé hier             → jour suivant (cycle 1–7)
   * - Série brisée             → 1 (repart du début)
   */
  getNextDay() {
    const last = GameState.daily.lastClaimDate;
    if (!last)                       return 1;
    if (last === this.getToday())    return GameState.daily.streakDay;
    if (last === this.getYesterday()) return (GameState.daily.streakDay % 7) + 1;
    return 1;
  },

  // ── Réclamation ───────────────────────────────────────────────────────────

  claim() {
    if (!this.isAvailable()) return null;

    const day    = this.getNextDay();
    const reward = this.REWARDS[day - 1];

    if (reward.coins > 0) GameState.addCoins(reward.coins);
    if (reward.gems  > 0) GameState.gems += reward.gems;
    if (reward.boost) GameState.setCoinBoost(reward.boost.mult, reward.boost.minutes * 60_000);

    GameState.daily.lastClaimDate = this.getToday();
    GameState.daily.streakDay     = day;

    return { reward, day };
  },

  // ── Boost ─────────────────────────────────────────────────────────────────

  getBoostRemainingMs() {
    const exp = GameState.coinBoost.expiresAt;
    return exp > Date.now() ? exp - Date.now() : 0;
  },
};
