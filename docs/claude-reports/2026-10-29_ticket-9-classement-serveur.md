# Ticket #9 — [P0] T-02 — Fiabiliser le classement côté serveur

- Ticket : https://github.com/ReC82/Dig/issues/9 (source : audit général #6, bug B2)
- Branche : `fix/9-classement-serveur`
- Dépendance : #10 (T-03, anti-autoclic cumulé), déjà intégré dans `develop` (`18476a0`)
- Sessions du 29/10/2026 et du 30/10/2026

## Session du 30/10/2026 — recette échouée, correction déployée

### 1. État réel

**Déployé en production (SHA `f5019c0`) — en attente de recette.** Version servie
`1.0.0+f5019c0` sur https://dig.lodygames.com et https://dig.lodylands.com. Classement :
**Bloquant MVP public** (le classement est le cœur de la saison).

### 2. Retour du propriétaire (recette en production, 30/10, sur téléphone)

- Compteur du haut **PROF. 131 m** ; carte « Rang #1 / Mimosa » : **Prof. max 128 m, Blocs
  manuels 114** ; ligne du classement « lody » : **128 m, 127 blocs manuels**.
- Le classement ouvert ne s'actualise pas pendant le minage.

### 3. Analyse (données de production lues en copie, en lecture seule)

**Écart 114 / 127 — une vraie anomalie, deux définitions différentes :**
- la carte du joueur (`GET /api/seasons/current`) affichait `manual_blocks`, le total **brut**
  déclaré par le client ;
- la ligne du classement affichait `effective_manual_blocks`, les blocs **validés** par
  l'anti-autoclic, eux-mêmes plafonnés à « profondeur − 1 » ;
- or le compteur interne de l'anti-autoclic (`player_click_tracking.accepted_blocks`) était
  **gonflé** : 403 blocs acceptés pour 88 déclarés dès la sauvegarde pré-déploiement de 00:46,
  c'est-à-dire **avant** le correctif #10 (ancienne version de l'anti-autoclic). Ce matin :
  456 acceptés pour 124 déclarés. Le plafond « profondeur − 1 » s'appliquait donc toujours :
  128 m → 127 blocs. La valeur du classement ne mesurait plus les blocs manuels.
- Depuis le déploiement de #10 (00:48), le compteur progresse exactement comme le total
  déclaré (+29 / +29) : le gonflement est **hérité**, pas produit par le code actuel.
- Seul compte concerné : le seul joueur classé de la saison en cours.

**Écart 131 m / 128 m — légitime, ce n'est pas un calcul faux :**
- « PROF. » en haut = profondeur **actuelle** du jeu, mise à jour à chaque bloc ;
- « Prof. max » de la saison = profondeur **validée par le serveur** à la dernière sauvegarde
  cloud reçue (au plus une toutes les 12 s depuis #10). Pendant le minage, l'écart correspond aux
  blocs cassés depuis la dernière sauvegarde, et l'onglet ne se rechargeait pas : l'écart
  grandissait tant que l'onglet restait ouvert.

### 4. Changements réalisés (commit `b4a8796`, intégré dans `develop` par `f5019c0`)

- `server/seasons.js` — `processAntiCheat` : **invariant « blocs validés ≤ blocs déclarés »**
  (plus grand total connu : sauvegarde reçue, référence, ligne de classement). Effets : le
  compteur gonflé hérité est ramené au total déclaré à la sauvegarde suivante ; plus de double
  comptage possible si les compteurs du client reculent puis remontent (deux sources de
  sauvegarde).
- `server/seasons.js` — **une seule définition de « Blocs manuels »** (`_validatedBlocks` :
  blocs validés, jamais plus que les blocs déclarés) pour la carte du joueur, le classement
  global et le classement de ligue. La carte ajoute `manualBlocksBroken` (brut, informatif).
  L'ordre du classement est inchangé (profondeur, puis blocs validés).
- `public/js/main.js` — **onglet Saison** :
  - à l'ouverture, la sauvegarde cloud en attente est envoyée d'abord : les chiffres reflètent le
    minage récent ;
  - pendant qu'il est affiché : actualisation après chaque sauvegarde cloud réussie (au plus une
    toutes les 10 s ; en pratique ≈ 12 s pendant le minage) et toutes les 30 s sinon ;
  - rien n'est demandé si l'onglet Saison est masqué ou la page en arrière-plan ;
  - l'actualisation se fait sans écran « Chargement », en gardant le bloc « Comment fonctionne la
    saison ? » ouvert et la position de défilement.
- `test/ranking-depth.test.js` : 3 tests de non-régression (compteur hérité 456/124 → carte =
  classement = 124 puis 129 après une sauvegarde ; compteurs qui oscillent → jamais plus que
  déclaré ; classement de ligue = carte).

### 5. SHA, tests et vérifications

- Branche `fix/9-classement-serveur` (`b4a8796`) ; **`develop` = `f5019c0`** ; `main` = `f5019c0`.
- `npm test` **133/133** (worktree du ticket, `develop`, et release au SHA exact) ;
  `node server/test-season.js` **62/62**.
- Navigateur (serveur de test port 3101, base de test, Chromium headless, 390×844 et 1280×900) :
  carte et ligne du classement identiques (ex. 9 m / 8 blocs des deux côtés) ; après 90 clics en
  restant sur l'onglet Saison, chiffres actualisés seuls (2 actualisations en ~30 s) ; aucune
  erreur JavaScript.
- Interactions #10 / #18 : sauvegardes refusées en 409 (révision obsolète) toujours exclues du
  classement ; suite anti-autoclic (#10) et révisions (#18) vertes.

### 6. Déploiement

- Copie de la base de production démarrée avec la release en mode production (port 3122) :
  `/health` et `/api/version` ok ; **empreintes identiques** avant/après démarrage (`users`,
  `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`) ; copie
  supprimée.
- `main` avancé en avance rapide `232c0b9 → f5019c0`, puis `scripts/deploy.sh` de la release.
- Sauvegarde vérifiée : `~/backups/dig/dig-20261030-100807-pre-deploy-f5019c0.sqlite`.
- Après : 200 et `1.0.0+f5019c0` sur les 2 domaines ; journaux sans erreur ; `quick_check` ok ;
  données joueurs identiques à la copie pré-déploiement ; page Saison publique en production :
  « lody 151 m 👆129 » (= blocs déclarés ; auparavant 150 = profondeur − 1), sans erreur.
- **Aucune donnée réécrite par le déploiement.** Le compteur interne gonflé de l'anti-autoclic
  sera ramené au total déclaré lors de ta prochaine sauvegarde en jeu (correction d'un compteur
  technique, aucune progression ni monnaie touchée ; ta profondeur reste 151 m).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 232c0b9` puis `sudo systemctl restart dig`
  (pas de changement de dépendances). La base n'est jamais restaurée.

### 7. Test fonctionnel à faire par le propriétaire (≈ 2 min, téléphone)

1. Ouvrir le jeu (recharger la page une fois pour prendre la nouvelle version).
2. Ouvrir **Saison** : sur la carte « Rang #1 » et sur ta ligne du classement, **la profondeur et
   les blocs manuels sont identiques**, et la profondeur est celle du compteur « PROF. » du haut.
3. Rester sur **Saison** et miner en tapant sur le bloc visible en haut pendant ~30 s : les deux
   chiffres augmentent seuls en même temps (toutes les ~12 s), sans recharger la page.
4. Attendu : jamais deux valeurs différentes entre la carte et la ligne. Un écart de quelques
   mètres avec « PROF. » pendant le minage est normal (dernière sauvegarde, ≤ 12 s) et se
   résorbe à l'actualisation suivante.

### 8. Choix techniques faits seul

- **Plafond « validé ≤ déclaré »** plutôt qu'une migration qui réécrirait les compteurs : la
  correction se fait d'elle-même à la sauvegarde suivante, sans toucher à la base au déploiement.
- **Blocs validés affichés partout** (et non le brut) : c'est la valeur qui sert au départage et
  aux promotions ; pour un joueur légitime, elle est égale au brut.
- **Actualisation liée aux sauvegardes** plutôt qu'un rafraîchissement rapide en boucle : au plus
  deux requêtes légères toutes les ~12 s, seulement quand l'onglet Saison est affiché.
- Envoi de la sauvegarde en attente à l'ouverture de l'onglet : réduit l'écart avec « PROF. ».

### 9. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

### 10. Éléments restant à réaliser

- Recette en jeu ci-dessus (clôture par le propriétaire).
- Après lancement : le champ d'API `effectiveBlocks` (non affiché dans le jeu) garde la valeur
  stockée jusqu'à la prochaine sauvegarde du joueur ; sans impact visible.
- Limites anti-bot résiduelles : suivies par #25.

---

## Session du 29/10/2026

## 1. État réel

**Intégré dans `develop` — en attente de validation et de déploiement.** (État du 29/10 ; déployé
ensuite le 30/10 à 00:48 en `18e3881`, voir la session du 30/10 ci-dessus.)

## 2. Problème de départ (audit B2)

`seasonStats.maxDepth`, critère n°1 du classement, était fourni par le client et enregistré via
`MAX()` sans aucun contrôle : une seule requête `POST /api/me/save` avec `maxDepth: 1e9` suffisait
pour devenir premier. Le critère de départage (`effective_manual_blocks`) pouvait aussi être gonflé
(la première sauvegarde de saison acceptait autant de blocs que de clics déclarés, sans contrôle de
temps ; une rafale très au-dessus du seuil CPS gardait 10 % des blocs déclarés).

## 3. Changements réalisés

### Règle de plausibilité (serveur — `server/seasons.js`, `validateDepth`)
Dans le jeu, chaque bloc détruit (clic ou autodig) fait descendre d'un mètre ; un bloc détruit à
la main exige au moins un clic ; l'autodig frappe une fois par seconde. Le serveur en déduit :

- **profondeur retenue ≤ profondeur retenue précédente + clics acceptés + blocs auto acceptés** ;
- les clics et blocs auto déclarés sont acceptés au rythme du **temps réel écoulé côté serveur**
  (seaux de jetons) : au plus **20 clics/s** (`depth_max_cps`, configurable) et **1,25 bloc
  auto/s** (1/s + 25 % de marge de rattrapage) ; capacité des seaux : **20 s** de jeu au rythme
  maximal (l'inactivité ne s'accumule pas) ;
- ce qui dépasse reste **en attente** et est accepté plus tard (gigue réseau, sauvegardes perdues :
  aucune perte pour un joueur normal) ; au-delà de **10 min de jeu au rythme maximal** en attente,
  l'excédent est **rejeté** ;
- **blocs manuels effectifs ≤ profondeur retenue − 1** (départage, `syncPlayerRanking`) ;
- compteurs revenus en arrière (autre appareil, réinitialisation) : nouvelle référence, aucun crédit.

La validation s'applique **à chaque sauvegarde cloud** (y compris sans bloc manuel, pour suivre
l'autodig). La sauvegarde elle-même reste toujours acceptée : seul le classement est plafonné.

### Journalisation (`anticheat_logs`)
- `depth_rejected` : un excédent de compteurs a été rejeté (ex. `maxDepth`/clics à 1e9) ;
- `depth_capped` : l'écart profondeur déclarée − retenue franchit 50 m (un seul log par épisode,
  pas un par sauvegarde) ;
- `admin_fix` : correction manuelle par l'admin (valeurs avant/après + motif) ;
- nouvelle colonne `details` (JSON) : profondeur déclarée/retenue, compteurs rejetés, motif.

### Outil admin de correction
- `PUT /api/admin/seasons/:seasonId/rankings/:userId` (Bearer `ADMIN_SECRET`), corps
  `{ maxDepth?, effectiveManualBlocks?, reason? }` : impose les valeurs (pas de `MAX`), met à jour
  les états de validation de la saison (la sauvegarde suivante du joueur ne rétablit pas l'ancienne
  valeur), journalise `admin_fix`. Réponses : 400 (valeurs invalides), 401, 404 (ligne absente).
- Panel admin, onglet **Classement** : colonnes « Prof. retenue » / « Prof. déclarée » (⚠ si
  différente) et bouton **Corriger** (saisie de la profondeur, des blocs et du motif).
- Journal anti-autoclicker : nouveaux filtres (profondeur plafonnée / rejetée / corrections admin)
  et détail lisible sous l'action.
- Rendu des lignes du classement et du journal via `textContent` (plus d'`innerHTML` avec des
  données joueur dans ces deux tableaux ; le reste de la XSS B6 relève de #15 / T-08).

### Données (`server/db.js`) — migrations additives et idempotentes
- nouvelle table `player_depth_tracking` (état de validation, une ligne par joueur) ;
- `season_rankings.reported_max_depth` (profondeur déclarée, audit), initialisée à `max_depth` ;
  `max_depth` devient la profondeur **validée** ;
- `anticheat_logs.details` (TEXT) ;
- config : `depth_validation_enabled = true`, `depth_max_cps = 20` (insérés seulement s'ils
  n'existent pas).
- Lignes de classement existantes : **conservées telles quelles** ; à la première sauvegarde après
  déploiement, la validation repart de la valeur enregistrée et des derniers compteurs enregistrés,
  sans crédit supplémentaire.
- L'API publique n'expose pas la profondeur déclarée (uniquement la vue admin).

### Tests
- `test/ranking-depth.test.js` (nouveau, inclus dans `npm test`, base dans `/tmp`, serveur de test
  port 3110).
- `server/test-season.js` (script hérité qui injecte des profondeurs arbitraires pour tester tri et
  promotions) : désactive la validation dans sa base isolée.

## 4. SHA, branche et procédure de test

- Branche : `fix/9-classement-serveur` ; SHA de fusion sur `develop` : indiqué dans le commentaire
  du ticket (fusion `--no-ff` faite après ce rapport).

### Tests automatisés
```bash
cd <copie de travail> && npm ci && npm test        # + node server/test-season.js
```
Résultat obtenu : **50/50** pour `npm test` en 31 s (dont 14 nouveaux pour #9) et **62/62** pour
`server/test-season.js`. Scénarios #9 :
jeu normal 5 CPS + autodig (30 sauvegardes) → retenue = déclarée, aucun log ; jeu rapide 12 CPS un
bloc par clic + autodig au maximum → aucune pénalité ; première sauvegarde avec progression →
rattrapée à la suivante ; 60 s de sauvegardes perdues à 8 CPS → rattrapage complet sans rejet ;
`maxDepth`/compteurs à 1e9 → profondeur retenue ≤ 1 et log `depth_rejected` (un seul) ; 1e9 avec
compteurs cohérents → ≤ 11 m et `depth_capped` ; joueur inactif 1 h puis triche → gain ≤ 425 m ;
100 sauvegardes en 1 s → rythme non dépassé ; ligne existante avant déploiement → conservée sans
crédit ; compteurs revenus en arrière ; validation désactivée ; blocs effectifs bornés ; scénario
HTTP complet (classement public, journal, vue admin, correction 200/400/401/404, la sauvegarde
suivante ne rétablit pas la triche).

### Contrôles complémentaires
- **Migration sur une copie de la base de production** (`.backup` en lecture seule dans `/tmp`,
  copie supprimée ensuite) : deux démarrages successifs (idempotence), `integrity_check = ok`,
  empreinte des colonnes `max_depth`/`effective_manual_blocks` **identique avant/après**, classement
  inchangé, `reported_max_depth = max_depth` pour toutes les lignes.
- **Panel admin dans Chromium headless** (serveur de test port 3101, base `/tmp`, arrêté ensuite) :
  le tricheur apparaît à 1 m (déclarée 1 000 000 000 m ⚠) derrière le joueur honnête ; bouton
  Corriger → 0 m / 0 bloc ; journal : « ✖ profondeur rejetée » puis « ✎ correction admin » avec
  détails.

### Procédure de test manuelle proposée au propriétaire
1. `PORT=3101 DB_FILE=/tmp/test-9.sqlite ADMIN_SECRET=<au choix> SESSION_SECRET=<au choix> node server/index.js`
2. Jouer normalement connecté quelques minutes : l'onglet Saison affiche la même profondeur que le
   jeu (au plus ~12 s de retard).
3. Dans un autre terminal, avec le cookie de session d'un second compte :
   `curl -X POST localhost:3101/api/me/save -H 'Content-Type: application/json' -H 'Cookie: …' -d '{"data":{"seasonStats":{"seasonId":<id>,"maxDepth":1000000000,"manualBlocks":1000000000,"manualClicks":1000000000,"autoBlocks":1000000000}}}'`
   → le classement ne change pas ; `/admin/` → Ligues & Saisons → journal : « profondeur rejetée ».
4. `/admin/` → Classement → « Corriger » sur ce compte → valeurs imposées, entrée « correction
   admin » au journal.

## 5. Vérifications, limites, impact données

- Vérifié : `node --check` des fichiers modifiés, `npm test` 50/50, `test-season.js` 62/62,
  migration sur copie, contrôle navigateur admin.
- Une première exécution de `npm test` a dépassé le délai de 400 s que j'avais fixé (sans échec affiché) ; relancée, la suite est passée en 31 s. Cause non identifiée (la machine est partagée) : à surveiller dans la CI (#17).
- Non vérifié : charge réelle multi-joueurs (une lecture + une écriture SQLite de plus par
  sauvegarde, au plus 1 sauvegarde / 12 s / joueur depuis #10) ; navigateurs mobiles (aucun
  changement côté client du jeu).
- **Impact données :** migrations additives uniquement ; aucune valeur existante modifiée. Les
  lignes déjà falsifiées éventuelles (aucune constatée en production : un seul joueur classé, à
  99 m) restent en place et se corrigent avec l'outil admin.
- Limites connues :
  - Les bornes sont **physiques**, pas économiques : un tricheur qui déclare des compteurs cohérents
    peut encore progresser jusqu'à ~21 m/s tant qu'il sauvegarde, et gagner au plus ~425 m d'un coup
    après une pause. Une borne plus serrée exigerait de simuler la progression côté serveur (PV des
    blocs, dégâts, améliorations) : ticket #25.
  - Un joueur qui a joué **en invité** avant de créer son compte voit sa progression d'invité
    acceptée progressivement (au rythme des seaux) plutôt qu'immédiatement.
  - Une ancienne sauvegarde dont la profondeur n'a jamais été remise à 1 par un reset de saison
    (`seasonId = 0` au premier contact) déclare une profondeur supérieure à ses blocs de saison :
    elle est plafonnée par les blocs réellement joués dans la saison, ce qui est le comportement
    voulu pour un classement saisonnier.
  - Pas de limitation de débit sur `POST /api/me/save` (#14 / T-07) ; les rafales sont sans effet
    sur la validation (seaux alimentés par le temps, pas par le nombre de requêtes).
  - Le client affiche sa propre profondeur ; seul le classement utilise la valeur retenue.

## 6. Procédure de déploiement proposée

1. Sauvegarde vérifiée de la base (outil du ticket #13 si installé : `npm run backup`, sinon
   `sqlite3 server/data/dig.sqlite ".backup /chemin/sauvegarde.sqlite"` puis
   `sqlite3 /chemin/sauvegarde.sqlite "PRAGMA integrity_check"`).
2. Mettre à jour le code de production avec la révision de `develop` validée (procédure habituelle
   ou `scripts/deploy.sh` du ticket #13), puis redémarrer `dig.service`. Au démarrage, le journal
   doit afficher les migrations `season_rankings.reported_max_depth` et `anticheat_logs.details`
   (une seule fois).
3. Vérifier : `curl -s https://dig.lodygames.com/api/version` ; classement public identique à avant
   le déploiement ; jouer 1 min connecté → la profondeur du classement suit le jeu.
4. Retour arrière : redéployer la révision précédente et redémarrer. Les colonnes/table ajoutées
   sont ignorées par l'ancien code (aucune restauration de base nécessaire). En cas de faux positif
   sans retour arrière : panel admin → Configuration → `depth_validation_enabled = false`.

## 7. Choix techniques faits seul

- **Seaux de jetons alimentés par le temps serveur**, avec mise en attente de l'excédent : bornent
  la triche sans pénaliser un joueur dont les sauvegardes arrivent en retard ou en rafale.
- **20 clics/s** pour la profondeur (configurable) : au-dessus du jeu humain soutenu, distinct du
  seuil anti-autoclic de 8 CPS qui ne réduit que le départage.
- **Autodig 1,25 bloc/s** : 1 bloc/s réel + 25 % pour rattraper un retard.
- **Capacité 20 s** : couvre l'intervalle de 12 s des sauvegardes cloud (#10) avec marge, limite le
  gain d'une requête isolée.
- **Rejet au-delà de 10 min en attente**, journalisé, pour qu'une valeur absurde ne soit pas
  « distillée » indéfiniment.
- **Blocs effectifs ≤ profondeur − 1** : conséquence directe des règles du jeu, sans nouveau
  paramètre.
- **Profondeur déclarée conservée** (`reported_max_depth`) pour l'audit, visible seulement par
  l'admin.
- **Interrupteur `depth_validation_enabled`** pour neutraliser la règle sans redéploiement.
- Correction admin : **valeurs imposées** et journalisées plutôt qu'une simple suppression de ligne.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Éléments restant à réaliser (hors périmètre, proposés)

- #25 : progression calculée côté serveur (borne économique : PV des blocs, dégâts, améliorations).
- #14 (T-07) : limitation de débit sur `POST /api/me/save`.
- #15 (T-08) : reste de la XSS de l'admin (autres tableaux en `innerHTML`).
- #19 (T-12) : départage déterministe (3e critère) et index aligné sur `effective_manual_blocks`.
