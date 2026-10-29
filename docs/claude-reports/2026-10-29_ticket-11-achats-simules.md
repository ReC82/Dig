# Ticket #11 — [P1] T-04 — Désactiver les achats intégrés simulés

- Ticket : https://github.com/ReC82/Dig/issues/11 (source : audit général #6, bug B4)
- Session du 29/10/2026

## 1. État réel

**Intégré dans develop — en attente de validation et de déploiement.** Rien n'est déployé : `main`
et la production n'ont pas bougé.

## 2. Problème

Dans la boutique payante (onglet 🛒 Boutique), chaque bouton affichait un prix en euros mais
appelait `Monetization._fakePurchase()`, qui créditait **gratuitement** l'article : gemmes
(5 / 20 / 60), skins de pioche (doré, diamant) et boost ×3 pièces pendant 30 min. Ce mode démo
était actif en production.

## 3. Changements réalisés

| Fichier | Changement |
|---|---|
| `public/js/monetization.js` | Nouveau drapeau `PAYMENTS_ENABLED: false`. `purchase()` **refuse** tout achat (appelle `onCancel`, renvoie `false`) ; `_fakePurchase()` est **supprimé**. Même si quelqu'un passe le drapeau à `true` sans brancher de SDK, rien n'est accordé : `_grantItem()` n'est plus appelé que dans l'exemple de rappel de succès d'un vrai SDK (commenté). Guide d'intégration mis à jour. |
| `public/js/main.js` | La boutique reste visible (aperçu du catalogue) mais, sans fournisseur, chaque bouton est **désactivé** et affiche « Bientôt » ; aucun écouteur de clic n'est posé. Les prix en € ne sont plus affichés tant que l'achat est impossible. Les skins déjà possédés restent marqués « ✓ Possédé ». |
| `public/js/i18n.js` | FR/EN/NL : nouveau `shop.btn_soon` (« Bientôt » / « Coming soon » / « Binnenkort »), mention en bas de boutique « Achats bientôt disponibles · Aucun article ne peut être obtenu pour le moment » (remplace « Mode démo · Aucun achat réel ne sera effectué ») ; `shop.disclaimer_live` prévu pour le jour où les paiements seront branchés. |
| `public/css/style.css` | Style grisé pour un bouton de boutique désactivé (hors « Possédé »). |
| `test/monetization.test.js` | 5 tests automatiques (voir § 4). |

Comportement visible : onglet Boutique → solde de gemmes, cartes des 6 articles, boutons gris
« Bientôt » non cliquables, mention explicite en bas. Aucune modification serveur, aucune migration.

## 4. Révision, branche et procédure de test

- **SHA sur `develop`** : voir le commit de fusion « Merge fix/11-achats-simules dans develop (#11) »
  (`a7eb519` pour le code ; le rapport est fusionné juste après).
- Branche : `fix/11-achats-simules` (commit de code `e75f598`).

Tests automatiques (aucun serveur, aucune base) :

```bash
npm ci
node --test test/monetization.test.js   # 5/5
npm test                                # suite complète : 55/55 avant ajout du rapport
```

Ils vérifient : drapeau désactivé et `_fakePurchase` absent ; pour **chaque** article du catalogue
(types gems, skin, boost), `purchase()` renvoie `false`, n'appelle pas `onSuccess`, appelle
`onCancel`, et ne modifie ni les gemmes, ni le skin, ni le boost ; idem en forçant
`PAYMENTS_ENABLED = true` ; article inconnu refusé ; la boutique pose `disabled` et n'attache aucun
clic sans fournisseur ; les 3 langues ont les nouveaux textes.

Vérification fonctionnelle manuelle (navigateur) :

```bash
DB_FILE=test-11.sqlite PORT=3101 SESSION_SECRET=test node server/index.js
# ouvrir http://127.0.0.1:3101/ → langue → onglet Boutique
```

Résultat attendu : 6 boutons gris « Bientôt » ; un clic ne fait rien ; en console,
`Monetization.purchase('gems_60', () => console.log('accordé'))` renvoie `false` sans rien
afficher et `GameState.gems` est inchangé.

## 5. Vérifications effectuées, limites, impact sur les joueurs

Effectué :
- `node --check` des 3 fichiers JS modifiés ; `npm test` 55/55 sur la branche ; tests du ticket
  5/5 après fusion dans `develop`.
- Navigateur headless (Chromium) sur un serveur de test (port 3101, base `test-11.sqlite`) : les
  6 boutons sont `disabled` avec le texte « Bientôt » ; clics forcés sur chaque bouton **et** appel
  direct de `Monetization.purchase()` pour les 6 articles → gemmes 0 → 0, skin `null` → `null`,
  boost inchangé, aucun rappel de succès. Capture d'écran contrôlée (boutons grisés). Serveur de
  test arrêté ensuite.
- Copie temporaire de la base de production (lecture seule, supprimée aussitôt) : 1 sauvegarde
  cloud, **aucune** avec un skin obtenu par le mode démo. Les gemmes ne peuvent pas être
  attribuées à leur origine (minage ou boutique) : aucune correction de données n'est proposée.

Limites :
- L'économie reste calculée côté client : un joueur peut toujours modifier `GameState.gems` en
  console. C'est le sujet des tickets T-13 (#20) / anti-bot (#25), hors périmètre.
- Les **publicités récompensées** restent simulées (modale de 5 s qui double une récompense de
  pièces) : hors périmètre de ce ticket (achats payants uniquement), signalé ci-dessous.

Impact sur les données des joueurs : **aucun**. Pas de migration, pas de réécriture de sauvegarde ;
gemmes, skins et boosts déjà possédés sont conservés.

## 6. Procédure de déploiement proposée

1. Sauvegarde vérifiée de la base (`npm run backup` si l'outil du ticket #13 est installé, sinon
   `sqlite3 server/data/dig.sqlite ".backup /chemin/sauvegarde.sqlite"` puis
   `sqlite3 /chemin/sauvegarde.sqlite "PRAGMA integrity_check"`). Par prudence seulement : ce
   ticket ne touche pas la base.
2. Mettre à jour le code de production avec la révision de `develop` validée (procédure habituelle
   ou `scripts/deploy.sh` du ticket #13), puis redémarrer `dig.service` (fichiers statiques
   seulement ; un redémarrage n'est utile que pour le contrôle de version côté client).
3. Vérifier : ouvrir https://dig.lodygames.com, onglet Boutique → boutons gris « Bientôt »,
   rechargement forcé si l'ancien script est en cache.
4. Retour arrière : redéployer la révision précédente. Aucune migration, aucune restauration de
   base nécessaire.

## 7. Choix techniques faits seul

- **Boutique visible en aperçu plutôt que masquée** : le ticket autorise les deux ; l'aperçu
  évite de casser la navigation (onglet, badge, rendu) et annonce l'offre sans rien créditer.
  Masquer l'onglet est trivial si le propriétaire le préfère (question 1).
- **Prix en € retirés des boutons** tant qu'aucun achat n'est possible : afficher un prix pour un
  article non achetable est trompeur.
- **Refus « fail-closed »** : passer le drapeau à `true` ne suffit pas, il faut brancher un SDK
  dont le rappel de succès appelle `_grantItem()`. Aucun crédit ne peut donc réapparaître par
  simple configuration.
- Pas de garde côté serveur : le serveur ne connaît pas la boutique payante (aucune route) ; une
  validation serveur des gemmes relève de T-13.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire pour ce ticket. Question facultative :

1. Préférez-vous **masquer complètement** l'onglet Boutique tant qu'aucun paiement n'existe ?
   Options : (a) garder l'aperçu « Bientôt » (fait, recommandé) ; (b) masquer l'onglet.

## 9. Éléments restant à réaliser / suites proposées

- Brancher un vrai fournisseur de paiement (Stripe, RevenueCat…) avec **validation serveur du
  reçu** et crédit côté serveur : nécessite une décision produit, pas de ticket existant.
- Publicités récompensées simulées (`_showFakeAd`, audit « Publicités récompensées 🟡 ») : à
  traiter dans un ticket dédié (désactiver le doublement ou brancher un SDK).
