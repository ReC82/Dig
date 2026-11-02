# Ticket #47 — Boost ×2 : ouvrir un coffre réduit la durée restante au lieu de la préserver

Lien : https://github.com/ReC82/Dig/issues/47

## 1. État réel — 02/11/2026

**Déployé en production (SHA `0e1a561`) — en attente de recette.**

Classement : **Bloquant MVP public** (un joueur perdait une récompense déjà gagnée).

## 2. Cause

Le boost de pièces est stocké dans la sauvegarde du joueur (`coinBoost = { multiplier, expiresAt }`).
Toutes les sources (coffre trouvé en creusant, coffre de la boutique, bonus du 6ᵉ jour, articles payants désactivés)
passaient par `GameState.setCoinBoost()`, qui faisait :

```js
expiresAt = Date.now() + durée   // écrase l'expiration en cours
```

Le coffre **rare** trouvé en creusant donne « ×2 pendant 3 min » (20 % des tirages) : avec un ×2 de
6 min restantes, l'expiration était remplacée par « maintenant + 3 min ». C'est exactement le
symptôme décrit. Le bouton « 📺 Doubler la récompense » échappait au bug : il prolongeait déjà le
boost actif avec son propre code.

Reproduit par un test automatisé sur l'ancien code : temps restant obtenu 3 min (180 000 ms) au lieu de 9 min.

## 3. Correction

`public/js/gameState.js` — `setCoinBoost(multiplier, durationMs)` applique une règle unique pour toutes les sources :

- aucun boost actif (ou boost expiré) : `expiresAt = maintenant + durée`, multiplicateur de la récompense ;
- boost actif : `expiresAt = expiration actuelle + durée` (**la durée s'ajoute, ne diminue jamais**) ;
  le multiplicateur le plus fort des deux est conservé ;
- durée ≤ 0, non numérique, ou multiplicateur ≤ 1 : rien ne change.

C'est la règle que le bouton pub appliquait déjà (« un boost actif est prolongé de 2 min ») ; ce bouton
passe désormais par la même fonction (`public/js/main.js`), avec un comportement identique.

Sources couvertes : coffres trouvés en creusant (`chests.js`), coffres de la boutique (`main.js`,
`_applyShopChestReward`), bonus quotidien (`daily.js`), bouton pub (`main.js`), articles payants
(`monetization.js`, désactivés par #11).

Affichage : la bannière « ⚡ Bonus ×N pièces actif — m:ss » et la ligne Récompense lisent
`coinBoost`, donc reflètent directement la nouvelle durée.

Fichiers : `public/js/gameState.js`, `public/js/main.js`, `test/coin-boost.test.js` (nouveau, 7 tests).

## 4. Branche, SHA et procédure de test

- Branche : `fix/47-boost-coffre-duree` (commit `095a0c1`)
- `develop` : `0e1a561` (merge), déployé.
- Tests : `npm test` → **414/414** sur la branche, sur `develop` et sur la release `0e1a561`.
  `node --test test/coin-boost.test.js` : horloge simulée, cas du ticket (×2 6 min + coffre rare ×2 3 min → 9 min),
  aucun boost, boost expiré, gains plus courts/plus longs, multiplicateurs différents (×3 puis ×2, ×2 puis ×3),
  valeurs invalides, et contrôle qu'aucune source n'écrit `expiresAt` directement.

## 5. Vérifications, limites, données des joueurs

Faites : tests automatisés (ancien code : tests du nouveau fichier en échec, dont le cas du ticket — 3 min au lieu de 9 ; nouveau code : tous
réussis) ; démarrage de la release sur une copie de la base de production (santé, version, `gameState.js` servi avec la
correction, empreintes des 6 tables identiques avant/après) ; vérifications après déploiement (ci-dessous).

Non fait : essai manuel en navigateur (la règle est testée sur le vrai fichier client ; obtenir un coffre rare
pendant un boost ne se provoque pas à la demande).

Limites (signalées, hors périmètre) :
- Le boost reste un état **client** enregistré dans la sauvegarde ; le serveur ne le calcule ni ne le valide
  (le serveur tire le coffre boutique, le client applique le boost). Le passer côté serveur relève de la
  progression serveur #25 (anti-bot), pas de ce correctif. Les « requêtes concurrentes / double attribution »
  sont donc déjà couvertes par les protections existantes : achat de coffre boutique atomique côté serveur (#8),
  session de jeu unique multi-appareils (#35) et tirage reproductible des coffres-blocs (#35).
- Changement d'appareil / reconnexion : `coinBoost.expiresAt` est une heure absolue sauvegardée, donc reprise telle quelle.
  Le reset saisonnier remet le boost à zéro (règle existante, inchangée).
- Un boost ne peut porter qu'un multiplicateur : en cas de ×2 reçu pendant un ×3, le temps ajouté l'est au ×3
  (légèrement favorable au joueur, cas rare — voir question 1).

Données des joueurs : **aucune migration, aucune donnée réécrite**. Les boosts en cours sont conservés tels quels ;
seules les prochaines récompenses de boost suivent la nouvelle règle.

## 6. Déploiement

- SHA déployé : **`0e1a561`** (`00ae1ca` → `0e1a561`, sans `npm ci`), le 02/11/2026 à 22:30 (Bruxelles).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261102-223006-pre-deploy-0e1a561.sqlite`.
- Après déploiement : les deux domaines répondent 200, `/api/version` = `1.0.0+0e1a561`, `gameState.js` corrigé servi ;
  `journalctl -u dig` sans erreur ; `pragma quick_check` = ok ; `users`, `seasons`, `leagues` identiques à la sauvegarde ;
  `user_saves`, `season_rankings`, `player_click_tracking` : partie en cours (sauvegarde version 8270 → 8271, même profondeur) — progression, pas de perte.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 00ae1ca && sudo systemctl restart dig` (aucun `npm ci` nécessaire).

### Test fonctionnel à faire par le propriétaire (3 min)

1. https://dig.lodygames.com, actualiser (Ctrl+F5 ou bandeau de mise à jour).
2. Activer un boost : « 📺 Doubler la récompense » (×2 2:00), ou attendre un boost de coffre.
3. Pendant qu'il tourne, ouvrir un coffre qui donne un boost (coffre **rare** trouvé en creusant : « ×2 pendant 3 min »,
   ou coffre Simple de la boutique : « ×2 pendant 5 min »).
4. **Attendu** : le compte à rebours de la bannière **augmente** de la durée du coffre (ex. 6:00 → ≈ 9:00) ; il ne redescend jamais.
   Le multiplicateur affiché reste ×2 (ou ×3 si un ×3 était actif).
5. Actualiser la page : même temps restant.

## 7. Choix techniques faits seul

- **Cumul** (`max(maintenant, expiration) + durée`) plutôt que « garder le plus long » : c'est la règle déjà en place pour le
  bouton pub (seule règle existante dans le code) et la proposition recommandée du ticket ; aucune récompense n'est perdue.
- **Multiplicateur le plus fort conservé** avec durée cumulée : prolonge la règle existante du bouton pub, qui
  prolongeait déjà un boost plus fort.
- Correction dans la fonction unique appelée par toutes les sources, plutôt que source par source.

## 8. Décisions demandées au propriétaire

1. Boosts de **multiplicateurs différents** (×2 reçu pendant un ×3, ou l'inverse — coffres épique/légendaire seulement) :
   A) cumuler la durée sur le plus fort (**appliqué**, comme le bouton pub, légèrement favorable) ;
   B) file d'attente (le ×2 démarre après le ×3) — plus juste, plus de code et d'affichage ;
   C) garder le plus fort sans ajouter de durée — le ×2 serait perdu.
   **Recommandation : A**, sans action de ta part.
2. Faut-il un **plafond** de durée cumulée (ex. 60 min) ? Aujourd'hui aucun plafond (aucune règle existante).
   **Recommandation : pas de plafond** pour le MVP (les sources de boost sont rares et limitées).

## 9. Reste à réaliser

- Recette du propriétaire (ci-dessus).
- Après lancement : faire calculer le boost côté serveur dans le cadre de la progression serveur (#25).
