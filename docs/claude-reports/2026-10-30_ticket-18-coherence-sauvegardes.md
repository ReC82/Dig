# Ticket #18 — [P1] T-11 — Cohérence des sauvegardes et révisions

Lien : https://github.com/ReC82/Dig/issues/18 · Branche : `fix/18-coherence-sauvegardes` · Session DIGORCH du 30/10/2026

## 1. État réel

**Déployé en production (SHA `cf1f605`) — en attente de recette du propriétaire.** Déployé le 30/10/2026 à 01:51 (Bruxelles). Ce déploiement met aussi en ligne #17 (tests et CI), qui attendait dans `develop` et ne change rien au comportement du jeu.

Classement : **Bloquant MVP public** (risque de perte ou d'écrasement silencieux de progression dès que les joueurs ont deux onglets ou deux appareils ; un nouveau compte créé après une déconnexion héritait de la progression du compte précédent).

## 2. Problème (audit B5, B9 et risques P2)

- Les sauvegardes cloud n'avaient aucun contrôle de version : une sauvegarde ancienne (deuxième onglet, téléphone resté ouvert) écrasait en silence une plus récente.
- Le reset saisonnier admin était écrasé par la synchro suivante du client (B5).
- `_syncAfterLogin` réécrivait la sauvegarde locale avec une sérialisation dupliquée qui avait perdu `seasonStats` et `shopChestsBought` (B9).
- La déconnexion ne purgeait rien : un nouveau compte créé ensuite partait de la progression du précédent.

## 3. Changements réalisés

| Fichier | Changement |
|---|---|
| `server/db.js` | `upsertUserSave(userId, json, { expectedVersion })` : contrôle de la révision et écriture **dans une transaction**. La colonne `version` existante de `user_saves` sert de révision serveur : **aucune migration, aucun changement de schéma**. |
| `server/index.js` | `POST /api/me/save` accepte `baseRevision` (révision sur laquelle le client a travaillé, `null` = aucune sauvegarde connue). Si la sauvegarde serveur a changé depuis → **409** `{ conflict: true, save: { data, revision } }`, rien n'est écrit et le classement n'est pas mis à jour. Sans `baseRevision` (ancien onglet encore ouvert pendant le déploiement) : comportement inchangé. `GET/POST /api/me/save`, l'achat de coffre et le reset admin renvoient `revision`. Le reset admin rafraîchit aussi `lastSaveTime`. Panel admin : `updatedAt` (toujours vide, mauvais nom de colonne) corrigé et `revision` exposée. |
| `public/js/save.js` | **Sérialisation unique** `Save.serialize()` utilisée partout (local et cloud), `Save.writeLocal()` (écrit sans déclencher d'envoi cloud), `Save.purge()` (déconnexion), `Save.disabled` (onglet inactif). |
| `public/js/main.js` | Révision connue de la save locale dans `localStorage` (`dig_cloud_meta` = compte + révision). Sur 409 : si la version serveur est notre propre dernier envoi (réponse perdue, envoi de fermeture d'onglet), on reprend sa révision et on renvoie ; sinon **on applique la version serveur** et un message s'affiche (« Progression mise à jour depuis le serveur… »). Envois cloud sérialisés ; aucun envoi avant la synchro de connexion (plus de 401 inutiles pour les invités). Restauration de session : comparaison des révisions (repli sur les dates pour les saves d'avant #18). Achat de coffre : l'état local est envoyé avant le tirage serveur (le solde utilisé par le serveur est à jour). **Un seul onglet actif par navigateur** : le dernier ouvert prend la main, les autres affichent « Jeu ouvert dans un autre onglet — Jouer ici » et n'écrivent plus rien. **Déconnexion** : dernier envoi, puis purge locale complète. |
| `public/index.html`, `public/css/style.css`, `public/js/i18n.js` | Écran « autre onglet » (fr/en/nl) et message de conflit. |
| `test/save-revision.test.js` | 7 tests HTTP (révisions, 409 deux onglets, `null` refusé si une save existe, ancien client accepté, entrées invalides, reset admin conservé, coffre et révision, classement non touché par une save refusée). |
| `test/save-serialize.test.js` | 3 tests unitaires de `save.js` (aller-retour sans perte avec `seasonStats`/`shopChestsBought`, onglet désactivé n'écrit rien, purge). |

Comportement visible : rien ne change en jeu normal. Avec deux onglets, l'ancien affiche « Jouer ici ». Si un autre appareil (ou un admin) a modifié la sauvegarde, le jeu reprend cette version et l'annonce au lieu de l'écraser. Après « Se déconnecter », le jeu repart de zéro (la progression reste sur le compte).

## 4. SHA et procédure de test

- Commit du correctif : `c8a70d5` (branche `fix/18-coherence-sauvegardes`).
- **SHA sur `develop`** : `cf1f605` (merge `fix/18-coherence-sauvegardes` → `develop`), déployé tel quel.

Tests automatisés : `npm ci && npm test` (105/105 sur la branche, sur `develop` après fusion et dans le worktree de release du SHA exact `cf1f605`, après `npm ci`. Le test instable `rate-limit` n'a pas échoué).

Essai navigateur reproductible (serveur de test `PORT=3101 DB_FILE=test-18.sqlite`, Chromium headless, ordinateur 1280×900 et smartphone 390×844) — 22 contrôles, tous réussis :
- session restaurée après rechargement, progression locale conservée, clics réels comptés ;
- deux onglets : l'ancien affiche l'écran « autre onglet », n'écrit plus (ni local ni cloud) ; « Jouer ici » reprend l'état de l'autre onglet, qui devient inactif ;
- reset admin puis synchro suivante du client : le reset est appliqué (pièces 0) et conservé dans le cloud ; synchro suivante normale ;
- appareil 2 (smartphone) sauvegarde, appareil 1 périmé : l'appareil 1 reprend la version de l'appareil 2, rien n'est écrasé ;
- coffre acheté puis sauvegarde suivante acceptée (révision suivie) ;
- déconnexion : progression locale purgée ; nouveau compte → sauvegarde cloud vierge ; compte 1 intact ;
- aucune erreur JavaScript.

## 5. Vérifications, limites, impact sur les données

- **Données joueurs :** aucune migration, aucun changement de schéma, aucune réécriture. Les sauvegardes existantes gardent leur `version` actuelle, qui devient leur révision.
- **Transition :** un onglet resté ouvert avec l'ancien code envoie sans `baseRevision` et reste accepté comme avant (la bannière « mise à jour disponible » invite à recharger). Au premier chargement avec le nouveau code, la save locale n'a pas encore de révision : la comparaison par dates d'avant est utilisée une fois.
- **Limites (choix assumés) :** en cas de conflit, la version serveur gagne (pas de fusion champ par champ) : l'appareil périmé perd au plus ses ~12 dernières secondes de jeu, avec un message. Deux appareils joués **en même temps** sur le même compte se reprendront mutuellement la main toutes les ~12 s (avec message) ; l'onglet unique, lui, ne concerne qu'un même navigateur. Le bouton « Réinitialiser » des paramètres efface toujours aussi le cloud (action volontaire, confirmée, hors périmètre).

## 6. Déploiement

- **SHA déployé : `cf1f605`** (précédent : `b456a4d`), via `scripts/deploy.sh` de la release. Le script a fait une avance rapide de `main`, sans `npm ci` (dépendances inchangées).
- **Sauvegarde pré-déploiement vérifiée :** `~/backups/dig/dig-20261030-015138-pre-deploy-cf1f605.sqlite`.
- **Avant le déploiement :**
  - copie de la base de production démarrée en `NODE_ENV=production` (port 3122) ;
  - `/health` et `/api/version` OK ;
  - empreintes identiques avant et après démarrage (lignes + hachage) pour `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` ;
  - aucune colonne ajoutée ni modifiée ;
  - copie supprimée.
- **Après le déploiement :**
  - `https://dig.lodygames.com` et `https://dig.lodylands.com` → 200, `/api/version` = `1.0.0+cf1f605` ;
  - `journalctl` sans erreur ;
  - `pragma quick_check` = ok ;
  - empreintes des 6 tables identiques à la sauvegarde pré-déploiement (sauvegarde du compte existant : révision 6782, inchangée) ;
  - essai Chromium en production, ordinateur 1280×900 et smartphone 390×844, sans compte : page chargée, clics OK, écran « autre onglet » fonctionnel, plus aucun POST de sauvegarde pour un invité, aucune erreur JavaScript.
- **Retour arrière immédiat :**
  - `git -C /home/ubuntu/Dig reset --keep b456a4d && sudo systemctl restart dig` (dépendances identiques) ;
  - aucune donnée à restaurer, car le schéma est inchangé ;
  - l'ancien code ignore simplement `dig_cloud_meta`.

**Test fonctionnel à faire par le propriétaire (environ 3 minutes) :**
1. Ouvrir le jeu connecté, jouer 30 s, puis ouvrir le jeu dans un **deuxième onglet** : le premier onglet affiche « Jeu ouvert dans un autre onglet — Jouer ici ». Jouer dans le deuxième, puis cliquer « Jouer ici » dans le premier : il reprend exactement la progression du deuxième.
2. (Si possible) Jouer sur le téléphone avec le même compte, fermer l'appli, revenir sur l'ordinateur et recharger : la progression du téléphone est là, rien n'est revenu en arrière.
3. Paramètres → **Se déconnecter** : le jeu repart de zéro. Créer un compte de test : il part de zéro. Se déconnecter, se reconnecter sur ton compte : toute ta progression revient.
4. (Facultatif, panel admin) Reset saisonnier d'un compte de test pendant qu'il joue : dans les 12 s, le jeu affiche « Progression mise à jour depuis le serveur » et repart à 0 pièce ; recharger : le reset est conservé.

## 7. Choix techniques faits seul

- **Rejet (409) plutôt que fusion** : une fusion automatique (max des valeurs) annulerait précisément le reset admin et les dépenses ; « le serveur gagne + message » est simple, prévisible et sans écrasement silencieux.
- **Réutiliser la colonne `version`** déjà incrémentée à chaque écriture : zéro migration.
- **Onglet unique** via l'événement `storage` (compatible avec tous les navigateurs) plutôt que la fusion entre onglets qui partagent la même save locale.
- **Rétrocompatibilité** : `baseRevision` facultatif côté serveur pour ne pas casser les onglets ouverts pendant le déploiement.
- **Purge des cosmétiques** à la déconnexion : ils sont dans la sauvegarde du compte et reviennent à la reconnexion.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Reste à réaliser

- (Après lancement) Le bouton « Réinitialiser » des paramètres efface aussi le cloud : à confirmer ou à limiter au local (risque P2 de l'audit, hors critères de T-11).
- (Après lancement) Fusion fine entre appareils joués simultanément, si le besoin apparaît.
- Économie toujours calculée côté client (hors périmètre, voir #20/#25).
