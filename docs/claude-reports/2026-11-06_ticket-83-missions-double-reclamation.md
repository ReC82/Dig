# Ticket #83 — Missions : réclamation réapparue après passage Pilote → Désactivé (risque de double crédit)

Lien : https://github.com/ReC82/Dig/issues/83 — priorité P0 — ticket parent #68.

## Session du 06/11/2026

### 1. État réel

**Déployé en production (SHA `b8cf434`) — en attente de recette.**
Branche `fix/83-missions-double-reclamation`, commit du correctif `79a7388`, intégré dans `develop` par `b8cf434`.

### 2. Cause racine (prouvée)

Les deux moteurs de missions gardaient leur état « réclamé » à deux endroits qui ne se voyaient pas :

| Moteur | Où est noté « réclamé » | Qui crédite |
|---|---|---|
| Navigateur (mode **Désactivé**) | `dailyMissions.missions[i].claimed` dans la sauvegarde du joueur | le navigateur (`GameState.addCoins`), puis la sauvegarde cloud |
| Serveur (mode **Pilote** / **Tous**) | table `daily_mission_claims` (joueur + jour + emplacement) | le serveur, dans la sauvegarde (transaction unique) |

- En mode Pilote, le serveur payait bien la mission et écrivait un mémo `dailyMissions.server` dans la sauvegarde. Le jeu ignorait ce mémo et la sauvegarde suivante l'écrasait. Les missions du navigateur restaient donc `claimed: false`.
- La rotation d'origine (v1) donne **exactement les mêmes missions** dans les deux moteurs (même tirage par date). Au retour en mode Désactivé, le jeu relisait ses missions locales : « Accumulateur 2000/2000 » apparaissait terminée et non réclamée, et le bouton redevenait actif.
- Un clic aurait crédité 500 pièces côté navigateur. Avant ce correctif, la sauvegarde cloud l'aurait **acceptée** : le **double crédit était réellement possible**.
- Le chemin inverse (Désactivé → Pilote) était lui aussi vulnérable : une mission réclamée par le navigateur pouvait être payée une seconde fois par le serveur.

**Constat en production (lecture seule, avant le correctif)** : le compte pilote avait une seule réclamation serveur aujourd'hui (`earn_coins`, objectif 2000, 500 pièces). Sa sauvegarde portait encore `earn_coins: claimed:false`. **Aucun second crédit n'a eu lieu.** La récompense légitime n'a pas été touchée. Aucun autre compte n'a de réclamation serveur.

### 3. Correctif

Règle unique : **une mission est payée au plus une fois par joueur, par jour et par identifiant de mission, quel que soit le moteur.** L'identité canonique est joueur + jour + identifiant (`earn_coins`, …), commune aux deux moteurs.

Fichiers modifiés :
- `server/missionsLive.js`
  - `paidByServer` : missions payées par le serveur, par jour.
  - `browserClaimed` : missions réclamées par le navigateur dans une sauvegarde.
  - `mergeInto` : marque « réclamée » (`serverPaid`) une mission payée par le serveur, uniquement dans la sauvegarde **renvoyée** au client ; rien n'est écrit en base.
  - `guardSave` : frontière serveur, voir ci-dessous.
  - Vue mode Désactivé : `{ live:false, paid:{ jour:[ids] } }` (aujourd'hui et hier, Bruxelles).
  - Vue Pilote / Tous : une mission déjà réclamée par le navigateur est affichée réclamée (`claimedBy:'browser'`) ; la réclamation serveur est refusée (409 `already_claimed`).
  - La réclamation serveur marque aussi la mission du navigateur `claimed + serverPaid`.
- `server/index.js`
  - `POST /api/me/save` : dans la transaction d'écriture, une sauvegarde qui fait passer « réclamée par le navigateur » une mission déjà payée par le serveur le même jour est **refusée en 409 conflit**. Le jeu reprend alors la version serveur (mécanisme #18 existant), sans aucun crédit. L'événement `daily_mission_double_claim_blocked` est journalisé.
  - `savePayload` applique `mergeInto` : un F5, un autre appareil ou une reprise de partie affichent « Réclamé ».
- `public/js/dailyMissions.js`, `public/js/save.js`, `public/js/main.js`
  - Le jeu applique la liste `paid` : la mission devient « ✓ Réclamé » sans crédit local.
  - Le marqueur `serverPaid` est conservé dans la sauvegarde.
  - En mode Désactivé, un clic « Réclamer » d'un compte connecté relit d'abord l'état du serveur.
  - Une réclamation serveur marque aussi la mission du navigateur de même identifiant.

**Ce qui n'a pas changé** : aucun barème, coût, taux ou gemme. Aucune activation : le drapeau reste sur Désactivé, comme réglé par le propriétaire. Aucune migration, aucune table ni colonne. Aucune sauvegarde réécrite.

### 4. SHA et procédure de test

- `develop` : `b8cf434` (fusion de `79a7388`).
- Tests automatisés : `npm test`, avec le nouveau fichier `test/missions-double-claim-83.test.js` (6 tests) :
  - **Pilote → Désactivé** : exactement un crédit. Un ancien client qui réclame obtient 409 et son solde reste inchangé. Un nouveau client marque la mission sans crédit. Les autres missions et les autres jours ne sont pas touchés.
  - **Désactivé → Pilote** : refus `already_claimed`, aucun second crédit.
  - Isolation des comptes hors pilote.
  - Minuit à Bruxelles : la réclamation de la veille reste listée.
  - Logique du client (vm).
  - Scénario HTTP complet : réclamation, retour en Désactivé, F5, double envoi, retour en Pilote = rejeu sans crédit.
  - **Ces tests échouent tous sans le correctif** (vérifié).
- Essai navigateur prolongé : `test/e2e/missions-live.e2e.js` (ordinateur 1280×900 et smartphone 390×844, base de test, port 3101). Après le retour en Désactivé et un F5, la mission payée est affichée « ✓ Réclamé » avec le bouton inactif. Un ancien état local non réclamé, une fois cliqué, ne crédite rien. Une sauvegarde d'ancienne page qui la réclame est refusée (409) et le solde reste inchangé.

### 5. Vérifications, limites, impact sur les données

- `npm test` : 829/829 sur la branche, puis 829/829 sur le SHA exact de la release.
- e2e missions-live : OK sur ordinateur et smartphone.
- Copie de la base de production :
  - démarrage `NODE_ENV=production`, `/health` et `/api/version` OK ;
  - empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques avant et après démarrage ;
  - sur les 3 sauvegardes : 0 refus parasite, 1 mission marquée payée à l'affichage (celle du compte pilote) ;
  - copie supprimée ensuite.
- **Limite connue (hors périmètre, #25/#77)** : les pièces restent déclarées par le client. Un client **modifié volontairement** peut ajouter `serverPaid` et créditer quand même, ou modifier son solde directement. Le correctif ferme le double paiement des clients honnêtes, des anciennes pages et des transitions de moteur, mais ne remplace pas une économie entièrement calculée par le serveur.
- Fuseaux horaires : le jour du navigateur (heure locale) peut différer du jour serveur (Bruxelles) pour un joueur hors fuseau. La correspondance se fait par date exacte, sur aujourd'hui et hier côté serveur.
- Une page restée ouverte avec l'ancien JavaScript peut encore afficher le bouton. Son clic est refusé à la sauvegarde (409, version serveur reprise) : aucun crédit.
- Données joueurs : aucune suppression ni réécriture. La sauvegarde du compte pilote est seulement **affichée** avec la mission réclamée ; elle sera enregistrée ainsi à sa prochaine sauvegarde normale.

### 6. Déploiement

- SHA déployé : **`b8cf434`** (06/11 12:36 Bruxelles). Précédent : `9d44664`.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261106-123609-pre-deploy-b8cf434.sqlite`.
- Après déploiement :
  - dig.lodygames.com et dig.lodylands.com répondent 200 avec la version `1.0.0+b8cf434` ;
  - journal sans erreur ;
  - `pragma quick_check` = ok ;
  - nombres de lignes et soldes des 3 sauvegardes identiques à la sauvegarde pré-déploiement.
- Aucune génération IA en cours au moment du redémarrage (dernier appel à 09:36 UTC).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 9d44664` puis `sudo systemctl restart dig`. Aucune migration à défaire.

**Test fonctionnel à faire par le propriétaire (2 min, sans aucun second paiement réel)** :
1. Garder le drapeau des missions sur **Désactivé**.
2. Se connecter au jeu avec le compte `testeur`, recharger la page (Ctrl+F5) → onglet 📅 Quotidien.
3. **Attendu** : la carte « Accumulateur 2000 » affiche **« ✓ Réclamé »** avec le bouton grisé. Les autres missions sont inchangées.
4. Facultatif : Admin → Missions → inspection de `testeur` : une seule réclamation (500 pièces) aujourd'hui.

Il n'est pas nécessaire de recliquer : même un clic sur une ancienne page ouverte ne crédite rien (refus serveur).

Classement : **Bloquant MVP public** pour l'activation des missions serveur (#68). Ce correctif lève ce blocage côté technique.

### 7. Choix techniques faits seul

- **Identité canonique joueur + jour + identifiant de mission**, pas l'emplacement : les emplacements peuvent différer entre moteurs. C'est le choix le plus prudent : pas de second crédit, même si les objectifs diffèrent.
- **Refus 409 plutôt que correction du solde** à la frontière serveur. Le serveur n'écrit rien et ne fait aucun calcul de pièces ; le jeu reprend la version serveur (mécanisme existant). Retirer des pièces d'une sauvegarde aurait été une réécriture des données d'un joueur.
- **Marquage à l'affichage (`mergeInto`) plutôt que réécriture des sauvegardes existantes** : non destructif. L'état est enregistré naturellement à la sauvegarde suivante.
- Pas de migration ni de nouvelle table : `daily_mission_claims` fait déjà foi.

### 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

### 9. Restant à réaliser

- Hors périmètre, signalé : l'affichage « ✓ ✓ Récompense réclamée » de la connexion quotidienne (double coche), mentionné dans le ticket comme bug visuel séparé. Après lancement.
- Hors périmètre, signalé : économie calculée côté serveur (pièces), à traiter dans #25/#77/#49. Après lancement.
