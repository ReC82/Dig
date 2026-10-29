# Ticket #9 — [P0] T-02 — Fiabiliser le classement côté serveur

- Ticket : https://github.com/ReC82/Dig/issues/9 (source : audit général #6, bug B2)
- Branche : `fix/9-classement-serveur`
- Dépendance : #10 (T-03, anti-autoclic cumulé), déjà intégré dans `develop` (`18476a0`)
- Session du 29/10/2026

## 1. État réel

**Intégré dans `develop` — en attente de validation et de déploiement.** Rien n'est déployé :
`main` et la production ne sont pas modifiés.

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
