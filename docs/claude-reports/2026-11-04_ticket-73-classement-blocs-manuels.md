# Ticket #73 — Classement Dig : rang basé uniquement sur les blocs détruits manuellement

- Ticket : [#73 — [P0] Classement Dig : rang basé UNIQUEMENT sur les blocs détruits manuellement (pas la profondeur)](https://github.com/ReC82/Dig/issues/73)
- Branche : `fix/73-classement-blocs-manuels` (code `b806c12`)
- `develop` : `53d19ac` (fusion du code), puis le commit de ce rapport

## 1. État réel — 04/11/2026

**Déployé en production (SHA `53d19ac`), en attente de recette.**

- Mise en ligne le 04/11 à 23:57 (Bruxelles), de `5fc77d9` vers `53d19ac`.
- Ce déploiement met aussi en ligne **#70** (navigation admin en groupes). #70 était intégré dans `develop` mais pas encore déployé. Ce sont des fichiers d'admin seulement.
- Aucun prix n'a été attribué et aucune saison n'a été clôturée. Les résultats déjà figés n'ont pas été réécrits.

## 2. Résultat et changements

### Règle appliquée (décision du propriétaire du 04/11)

Le classement suit un seul ordre, défini dans `server/db.js` (`RANK_ORDER`) :

1. **Blocs détruits manuellement et validés par le serveur**, du plus grand au plus petit (`effective_manual_blocks`). Ce n'est pas le nombre de clics, et ce n'est jamais le `manualBlocks` brut envoyé par le client.
2. En cas d'égalité, **le premier à avoir atteint ce total** passe devant (nouvelle colonne `manual_blocks_reached_at`, horodatée par le serveur).
3. Puis le **plus petit identifiant de compte** (ordre stable).

**La profondeur ne compte plus, ni pour le score ni pour départager.** Elle reste affichée comme statistique.

Pour avoir un rang, il faut au moins un bloc manuel validé. Un joueur qui n'utilise que l'Auto-Dig, ou dont tous les blocs ont été refusés par l'anti-autoclic, n'a pas de rang.

### Où la règle s'applique (même ordre partout)

| Domaine | Fichier | Effet |
|---|---|---|
| Classement global, classement de ligue, rang du joueur, médailles | `server/db.js`, `server/seasons.js` | tri aux blocs validés ; joueurs sans bloc validé non classés |
| Promotions de ligue (#19) | `getAllActivePlayersInLeague` | ce tri décide qui est promu ; le rapport de clôture indique les blocs |
| Instantané figé à la clôture (#29) | `server/standings.js` | nouvel algorithme `merit-v2` ; motif d'exclusion `no_validated_blocks` (remplace `depth_zero`) ; date de départage figée |
| Points de récompense (#33) | `server/rewardPoints.js` | ex æquo = mêmes blocs validés ; la récompense potentielle (saison en cours) utilise le même ordre |
| Concours (#30, simulation) | `server/contest.js` | le lot suit l'ordre figé (aucun changement de code nécessaire, test ajouté) |
| Actualités de fin de saison (#50) | `server/news.js` | « {b} blocs détruits manuellement » pour les saisons `merit-v2` |
| Jeu (PC et mobile) | `public/js/main.js`, `public/css/style.css` | titre « Classement — blocs détruits manuellement », phrase de règle, en-tête de colonnes, blocs en premier (en or), profondeur à côté en gris ; plus de 👆 |
| Carte du joueur | idem | « Blocs détruits manuellement : N » en premier, puis « Prof. max » ; « Pas encore classé » si aucun bloc validé |
| Résultat de la saison passée | idem | une saison `merit-v2` affiche les blocs ; une saison `merit-v1` reste affichée à la profondeur, comme elle a été jugée |
| Admin → Classement / Ligues | `public/admin/*` | colonne « Blocs manuels validés (critère du rang) » en premier ; les joueurs non classés sont listés « — (non classé) » pour pouvoir les corriger |
| Textes | `public/js/i18n.js`, `i18n/it.json`, `public/js/locales/it.js` | FR, EN, NL, ES, IT (« Ordre au mérite », libellés, résultat) |

### Anti-fraude (point 4 du ticket)

- Le classement n'utilise que `effective_manual_blocks`. Ce compteur est déjà calculé par le serveur (#9, #10, #25) :
  - un bloc demande un clic : un excédent de blocs déclarés est refusé ;
  - les clics par seconde sont plafonnés (8 blocs/s par défaut) ;
  - les blocs ne peuvent pas dépasser la profondeur validée − 1 ;
  - l'Auto-Dig est compté à part et ne rapporte jamais de bloc classé.
- Nouveau garde-fou : les blocs validés ne dépassent jamais les blocs déclarés (`MIN` en base).
- Une sauvegarde rejouée n'ajoute aucun bloc et ne déplace pas la date de départage. Cette date n'est posée que si le total validé change.

**Limite de preuve.** Le serveur ne voit pas chaque clic : il juge les compteurs que le navigateur envoie à chaque sauvegarde. Il garantit le plausible (rythme humain, un clic par bloc, bornes de profondeur), mais pas qu'un humain a réellement cliqué. Un auto-clicker lent (≤ 8 clics/s), régulier et qui imite la télémétrie reste possible. Il relève de la détection anti-bot #25 (indices, niveau de risque enregistré dans l'instantané, sanctions du lot C pas encore décidées).

### Migration (ajout seul, idempotente)

- `season_rankings.manual_blocks_reached_at TEXT` (NULL pour les lignes existantes).
- `season_standings.manual_blocks_reached_at TEXT` (NULL pour les instantanés v1).
- Index `idx_rankings_blocks_sort` et `idx_rankings_league_blocks_sort`.
- Rien n'est supprimé ni réécrit. Les anciens index sont conservés.

### Saison en cours (45-2026) — ce qui change

Le changement s'applique immédiatement au classement vivant. En production, juste après le déploiement :

- avant : 1 003 m avec 18 blocs manuels validés → 1er ;
- après : 116 blocs (147 m) 1er, 65 blocs (114 m) 2e, 18 blocs (1 003 m) 3e.

Une clôture simulée sur une copie de la base donne un instantané `merit-v2` dans le même ordre, avec des empreintes valides. Les points suivent le barème actuel (100 / 12 / 5), sans aucune modification du barème.

Les joueurs dont le total n'a pas bougé depuis l'activation ont une date nulle. Ils passent devant un ex æquo qui atteint le même total plus tard, ce qui est juste puisqu'ils l'ont atteint avant. Entre deux dates nulles, l'identifiant de compte décide.

### Saisons passées

Les 7 instantanés `merit-v1` (saisons 1 à 7) ne sont **ni recalculés ni réécrits**. Leur empreinte se vérifie avec leurs propres colonnes. Les points déjà attribués et leur audit (`auditSeason`) restent identiques, et les 7 sont vérifiés sur la copie de production. Les actualités et l'écran « Résultat » de ces saisons gardent la profondeur.

## 3. SHA, branche et procédure de test

- `develop` : `53d19ac` ; branche `fix/73-classement-blocs-manuels` (`b806c12`).
- Tests automatisés : `npm test` → **700/700** sur la branche, sur `develop` et sur la release au SHA exact.
- Nouveau fichier `test/ranking-manual-blocks.test.js` (8 tests) :
  - tableau à 3 joueurs (le joueur à 589 m avec 17 blocs finit 3e) ;
  - égalités (date, puis identifiant, jamais la profondeur) ;
  - 0 bloc validé et Auto-Dig seul ;
  - sauvegardes réelles : forgée, Auto-Dig, rejouée ;
  - plafond et date ;
  - instantané v2 et vérification d'un v1 historique ;
  - points v1/v2.
- 10 fichiers de tests existants mis à jour : ils codaient l'ancienne règle (concours, ligues seuil 3, ligues audit, points, clôture des points, instantané, vue Saison, profondeur HTTP, outils). La profondeur y est souvent inversée exprès pour prouver qu'elle n'a pas d'effet.

## 4. Vérifications effectuées

- Copie de la base de production (2 fois : en développement, puis release au port 3122) : migration appliquée, empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`, `season_standings` et `season_snapshots` **identiques** avant et après démarrage. Les copies ont été supprimées.
- Chromium headless, base de test (port 3101) : 1280×900 et 390×844, classement et carte du joueur connecté (« Rang #3 · Blocs détruits manuellement : 17 · Prof. max : 589 m », récompense potentielle « rang #3 sur 3 »).
- Production : 2 domaines → 200 et `1.0.0+53d19ac` ; journal sans erreur (les 2 lignes de migration attendues) ; `quick_check` = ok ; comptes de lignes identiques à la sauvegarde pré-déploiement ; 0 régression sur `season_rankings`, `user_saves` et `users` ; Chromium en production (visiteur) PC + mobile, 0 erreur JavaScript.
- Non vérifié : un vrai joueur connecté en production. C'est la recette ci-dessous.

## 5. Impact sur les données des joueurs

- Aucune donnée supprimée, réinitialisée ou réécrite : deux colonnes et deux index ajoutés.
- Les rangs de la saison active changent, comme le ticket le demande.
- Aucun prix, taux, revenu, barème ou sanction n'a été modifié.

## 6. Déploiement

- SHA déployé : **`53d19ac`** (production précédente : `5fc77d9`).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261104-235755-pre-deploy-53d19ac.sqlite`.
- Retour arrière possible : `git -C /home/ubuntu/Dig reset --keep 5fc77d9` puis `sudo systemctl restart dig`. L'ancien code ignore simplement les colonnes ajoutées.

**Test fonctionnel à faire par le propriétaire (5 min) :**

1. Ouvrir https://dig.lodygames.com sur smartphone puis sur PC, et aller dans l'onglet 🏆 Saison.
   - **Attendu :** le titre est « Classement — blocs détruits manuellement », avec une phrase de règle et les colonnes « Joueur · Blocs manuels · Prof. ».
   - **Attendu :** 1er = 116 blocs (147 m), 2e = 65, 3e = 18 blocs (≈ 1 003 m). Plus de 👆.
2. Connecté, regarder la carte du joueur.
   - **Attendu :** « Blocs détruits manuellement : N » en or, puis « Prof. max » en gris.
3. Casser 10 blocs à la main, puis rester 15 s sur Saison.
   - **Attendu :** le nombre de blocs augmente (au rythme des sauvegardes). La profondeur bouge aussi, mais ne change pas le rang à elle seule.
4. Laisser tourner l'Auto-Dig seul 1 min.
   - **Attendu :** les blocs manuels n'augmentent pas.
5. Facultatif, admin → 🏆 Classement.
   - **Attendu :** la colonne « Blocs manuels validés (critère du rang) » est en premier.
6. Facultatif, « Comment est établi le classement ? ».
   - **Attendu :** « nombre de blocs détruits à la main et validés par le serveur… La profondeur ne compte pas. »

**Classement MVP : Bloquant MVP public** (règle fondamentale de la compétition). Livré.

## 7. Choix techniques faits seul

1. **Départage « premier arrivé »** sur une nouvelle date (le total validé change) plutôt que sur l'ancienne date de profondeur. Une date nulle (total atteint avant la règle) passe en premier, ce qui est chronologiquement exact.
2. **Seuil d'entrée : au moins 1 bloc validé**, et non plus seulement déclaré. Un compteur forgé ou un joueur Auto-Dig seul n'a pas de rang. L'instantané garde ces participants, exclus avec leur motif, pour l'audit.
3. **Instantanés versionnés** (`merit-v1` / `merit-v2`) : vérification, points, actualités et écran « Résultat » appliquent la règle de l'instantané. Le passé n'est jamais réécrit.
4. **Vue admin** : les non-classés sont listés en fin, sans rang, pour garder l'outil de correction utilisable.
5. **Pictogramme validé « blocs minés à la main » (#67)** : conservé dans l'en-tête de colonne, à côté du libellé, sans repli 👆.
6. **Plafond « blocs ≤ profondeur validée − 1 »** conservé. C'est une borne anti-fraude (chaque bloc fait descendre d'un mètre), pas un critère de rang.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur n'est nécessaire pour cette livraison. Un point à confirmer plus tard, sans bloquer :

1. **Concours (#27/#30) — critère « profondeur minimale »** (réglage admin, 1 m aujourd'hui) : c'est un seuil d'éligibilité, pas un rang, donc laissé tel quel. Options :
   - A : le remplacer par « blocs manuels minimum » ;
   - B : le garder.

   Recommandation : **A**, à traiter dans #30.

## 9. Restant à réaliser

- Recette du propriétaire ci-dessus.
- Après lancement :
  - option A ci-dessus (#30) ;
  - sanctions anti-bot (#25 lot C) pour les auto-clickers lents ;
  - les anciens index de tri à la profondeur pourront être supprimés plus tard (gain négligeable, non fait par prudence).
