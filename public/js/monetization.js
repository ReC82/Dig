/**
 * monetization.js
 * Couche de monétisation : publicités récompensées + boutique.
 * Dépend de : GameState
 *
 * ════════════════════════════════════════════════════════════════════════════
 *  GUIDE D'INTÉGRATION RÉELLE
 * ════════════════════════════════════════════════════════════════════════════
 *
 *  1. PUBLICITÉ RÉCOMPENSÉE
 *     Cherchez le commentaire  // [AD_SDK] REMPLACER ICI
 *     Remplacez l'appel à this._showFakeAd() par votre SDK :
 *       Ex. Google AdMob, IronSource, Unity Ads, AppLovin MAX…
 *
 *  2. PAIEMENTS IN-APP
 *     Cherchez le commentaire  // [PAYMENT_SDK] REMPLACER ICI
 *     Remplacez l'appel à this._fakePurchase() par votre SDK :
 *       Ex. Stripe, RevenueCat, Google Play Billing, Apple IAP…
 *     Supprimez la méthode _fakePurchase() et son appel.
 *
 * ════════════════════════════════════════════════════════════════════════════
 */
const Monetization = {

  // ── Configuration ────────────────────────────────────────────────────────
  AD_COOLDOWN_MS: 5 * 60 * 1000,  // 5 min entre deux pubs
  AD_DURATION_S:  5,               // durée de la simulation

  // ── Catalogue boutique ────────────────────────────────────────────────────
  SHOP_ITEMS: [
    // Gemmes
    {
      id: 'gems_5',
      type: 'gems', icon: '💎', value: 5,
      name: 'shop.gems_5.name',  label: 'shop.gems_5.label',
      price: '0,99 €',
    },
    {
      id: 'gems_20',
      type: 'gems', icon: '💎', value: 20,
      name: 'shop.gems_20.name', label: 'shop.gems_20.label',
      price: '2,99 €', badge: 'shop.badge_popular',
    },
    {
      id: 'gems_60',
      type: 'gems', icon: '💎', value: 60,
      name: 'shop.gems_60.name', label: 'shop.gems_60.label',
      price: '7,99 €', badge: 'shop.badge_best_value',
    },
    // Skins
    {
      id: 'skin_golden',
      type: 'skin', icon: '✨', value: 'golden',
      name: 'shop.skin_golden.name',   label: 'shop.skin_golden.label',
      price: '1,99 €',
    },
    {
      id: 'skin_diamond',
      type: 'skin', icon: '💠', value: 'diamond',
      name: 'shop.skin_diamond.name', label: 'shop.skin_diamond.label',
      price: '3,99 €',
    },
    // Boosts
    {
      id: 'boost_x3_30m',
      type: 'boost', icon: '⚡', mult: 3, minutes: 30,
      name: 'shop.boost_x3.name', label: 'shop.boost_x3.label',
      price: '0,99 €',
    },
  ],

  // ── Publicité récompensée ─────────────────────────────────────────────────

  canWatchAd() {
    return (Date.now() - GameState.monetization.adLastWatched) >= this.AD_COOLDOWN_MS;
  },

  getCooldownRemainingMs() {
    const elapsed = Date.now() - GameState.monetization.adLastWatched;
    return Math.max(0, this.AD_COOLDOWN_MS - elapsed);
  },

  /**
   * Affiche une publicité récompensée.
   * @param {Function} onRewarded  Appelé après visionnage complet.
   * @param {Function} [onSkipped] Appelé si le joueur passe la pub.
   * @returns {boolean}  false si le cooldown est actif.
   */
  showRewardedAd(onRewarded, onSkipped) {
    if (!this.canWatchAd()) return false;

    // [AD_SDK] REMPLACER ICI ─────────────────────────────────────────────────
    // Exemple de branchement SDK :
    //
    //   YourAdSDK.showRewardedAd({
    //     onReward:  () => { this._recordAdWatched(); onRewarded(); },
    //     onSkip:    () => { onSkipped && onSkipped(); },
    //     onError:   (e) => { console.warn('[Ad]', e); onSkipped && onSkipped(); },
    //   });
    //   return true;
    //
    // ─────────────────────────────────────────────────────────────────────────
    // Simulation (supprimer dès que le vrai SDK est branché) :
    this._showFakeAd(
      () => { this._recordAdWatched(); onRewarded(); },
      () => { onSkipped && onSkipped(); }
    );
    return true;
  },

  _recordAdWatched() {
    GameState.monetization.adLastWatched = Date.now();
  },

  /** Modale de simulation : compte à rebours de AD_DURATION_S secondes. */
  _showFakeAd(onComplete, onSkip) {
    const modal    = document.getElementById('ad-modal');
    const countEl  = document.getElementById('ad-countdown');
    const closeBtn = document.getElementById('btn-close-ad');
    const skipBtn  = document.getElementById('btn-skip-ad');
    const barFill  = document.getElementById('ad-bar-fill');
    if (!modal) { onSkip(); return; }

    let remaining = this.AD_DURATION_S;
    countEl.textContent = remaining;
    closeBtn.hidden     = true;
    skipBtn.hidden      = false;
    modal.hidden        = false;

    // Barre de progression
    if (barFill) {
      barFill.style.transition = 'none';
      barFill.style.width      = '0%';
      setTimeout(() => {
        if (barFill) {
          barFill.style.transition = `width ${this.AD_DURATION_S}s linear`;
          barFill.style.width      = '100%';
        }
      }, 60);
    }

    const cleanup = () => {
      clearInterval(timer);
      modal.hidden     = true;
      closeBtn.onclick = null;
      skipBtn.onclick  = null;
      if (barFill) { barFill.style.transition = 'none'; barFill.style.width = '0%'; }
    };

    const timer = setInterval(() => {
      remaining -= 1;
      countEl.textContent = remaining > 0 ? remaining : '✓';
      if (remaining <= 0) {
        clearInterval(timer);
        closeBtn.hidden = false;
        skipBtn.hidden  = true;
        closeBtn.onclick = () => { cleanup(); onComplete(); };
      }
    }, 1000);

    skipBtn.onclick = () => { cleanup(); onSkip(); };
  },

  // ── Boutique ──────────────────────────────────────────────────────────────

  /**
   * Déclenche l'achat d'un article.
   * @param {string}   itemId      ID de l'article (voir SHOP_ITEMS).
   * @param {Function} onSuccess   Appelé avec l'article si achat réussi.
   * @param {Function} [onCancel]  Appelé si annulé ou refusé.
   */
  purchase(itemId, onSuccess, onCancel) {
    const item = this.SHOP_ITEMS.find(i => i.id === itemId);
    if (!item) return;

    // [PAYMENT_SDK] REMPLACER ICI ────────────────────────────────────────────
    // Exemple de branchement SDK :
    //
    //   YourPaymentSDK.purchase(item.storeProductId, {
    //     onSuccess:   (receipt) => { this._grantItem(item); onSuccess && onSuccess(item); },
    //     onCancelled: ()        => { onCancel && onCancel(); },
    //     onError:     (e)       => { console.error('[Shop]', e); onCancel && onCancel(); },
    //   });
    //
    // ─────────────────────────────────────────────────────────────────────────
    // Mode démo — accorde l'article gratuitement (supprimer avant mise en prod) :
    this._fakePurchase(item, onSuccess);
  },

  /** DÉMO UNIQUEMENT — accorde l'article sans paiement réel. */
  _fakePurchase(item, onSuccess) {
    this._grantItem(item);
    onSuccess && onSuccess(item);
  },

  /** Applique la récompense d'un article dans GameState. */
  _grantItem(item) {
    if (item.type === 'gems')  { GameState.gems += item.value; }
    if (item.type === 'skin')  { GameState.monetization.pickaxeSkin = item.value; }
    if (item.type === 'boost') { GameState.setCoinBoost(item.mult, item.minutes * 60_000); }
  },

  /** Retourne true si le skin spécifié est actif. */
  hasSkin(skinId) {
    return GameState.monetization.pickaxeSkin === skinId;
  },
};
