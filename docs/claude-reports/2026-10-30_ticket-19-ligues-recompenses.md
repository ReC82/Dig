# Ticket #19 — [P2] T-12 — Spécifier et implémenter ligues, promotions et récompenses

- Ticket : https://github.com/ReC82/Dig/issues/19
- Source : audit général #6, §4 et T-12 (`docs/claude-reports/2026-10-29-2130-audit-general-dig.md`, branche `docs/6-audit-general`)
- Session du 30 octobre 2026

## 1. État réel

**Partiel — bloqué sur des décisions métier.** La partie technique sans enjeu de jeu (départage
déterministe, index, tests 3 ligues × 30 joueurs, spécification écrite) est livrée :
**déployée en production (SHA `b64af44`) — en attente de recette.**
Les règles de relégation, de récompenses, de reset serveur et de départage final ne sont **pas**
implémentées : le ticket les marque « ATTENTE VALIDATION MÉTIER » et l'autorisation du 30 octobre
interdit toute règle métier (économie, récompenses, ligues) sans validation écrite.

**Classement MVP : « Après lancement ».** En production, il y a une seule ligue (Mimosa) et un seul
joueur actif par semaine. Ligues et récompenses n'ont de sens qu'avec une communauté ; leur absence
n'empêche pas de partager le jeu.

## 2. Réconciliation

Aucune branche, PR ni rapport antérieur pour #19. Le code des ligues sur `develop` : promotion seule
(`server/seasons.js`, `_applyPromotions`), aucune relégation, aucune récompense, reset de saison côté
client (`public/js/main.js`, `_applySeasonReset`). La rotation hebdomadaire est déjà serveur (#16).

## 3. Changements réalisés

| Fichier | Changement |
|---|---|
| `server/db.js` | Les 5 fonctions de classement et de promotion (`getSeasonLeaderboard`, `getPlayerSeasonRank`, `getLeagueLeaderboard`, `getAllActivePlayersInLeague`, `getPlayerLeagueRank`) ajoutent un 3e critère `user_id ASC` : deux joueurs à égalité parfaite (même profondeur, mêmes blocs validés) ont désormais toujours le même ordre, dans le classement comme pour la promotion. Avant, l'ordre dépendait de SQLite. Nouveaux index `idx_rankings_sort` et `idx_rankings_league_sort` sur le tri réel (`max_depth DESC, effective_manual_blocks DESC, user_id`) ; l'ancien index sur `manual_blocks` est conservé. Ajout seul, `IF NOT EXISTS`. |
| `test/leagues.test.js` (nouveau) | 4 tests (détail en section 4). |
| `docs/LIGUES.md` (nouveau) | Règles actuelles décrites précisément et proposition complète (structure, promotion, relégation, récompenses, reset serveur, départage). |

Comportement visible : aucun pour un joueur, sauf en cas d'égalité parfaite au classement (l'ordre ne
varie plus d'un affichage à l'autre).

## 4. Références et procédure de test

- **SHA sur `develop` : `b64af4449625dd3a4934c8e8f9c902e7406b722d`** (fusion `--no-ff`), commit `67622e6`.
- Branche : `feature/19-ligues-recompenses`.

```bash
npm ci
node --test test/leagues.test.js   # 4/4, base temporaire dans /tmp, aucun serveur
npm test                           # suite complète
```

`test/leagues.test.js` :

1. **3 ligues × 30 joueurs** (Mimosa, Bronze, Argent) + un inactif par ligue : 15, 10 et 7 promus
   (formule actuelle), exactement les meilleurs du classement ; ligue « Or » créée à la volée
   (nombre de ligues non limité) ; chaque joueur monte d'au plus un niveau ; non-promus et inactifs
   restent ; **aucune donnée joueur réécrite** (empreinte `users`, `season_rankings`, `user_saves`
   identique, hors `users.league_id`) ; double clôture refusée.
2. **Seuil d'actifs** : 9 actifs → aucune promotion (`not_enough_players`) ; 10 actifs au niveau 3 →
   2 promus vers un niveau 4 créé.
3. **Ex æquo parfaits** insérés dans le désordre → ordre par identifiant croissant dans le
   classement de ligue, le classement global, les rangs individuels et la promotion.
4. **Index** présents, utilisés par la requête de classement de ligue (plan SQLite sans tri
   temporaire), `initDb()` rejouable.

Les tests 3 et 4 échouent sur le code d'avant le correctif (vérifié), les tests 1 et 2 décrivent le
comportement actuel conservé.

## 5. Vérifications effectuées, limites, impact données

- `npm test` complet dans le worktree du ticket : **109/109**. Un premier passage avait échoué sur
  `security.test.js` (409 au lieu de 200) : un serveur de test d'un passage précédent écoutait encore
  sur le port 3111 avec sa base ; après son arrêt, 7/7 puis 109/109.
- Release `b64af44` (worktree détaché, `npm ci`) : **109/109** sur le SHA exact, du premier coup.
- Copie de la base de production démarrée en mode production (port 3122) : `/health` ok, version
  `1.0.0+b64af44`, empreintes (lignes + hachage des colonnes) de `users`, `user_saves`,
  `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** ; seuls les deux
  index ont été ajoutés ; `quick_check` ok. Copie supprimée.
- **Impact données** : création de deux index ; aucune ligne modifiée ou supprimée.
- Non vérifié : comportement avec des milliers de joueurs (les index visent ce cas, sans test de charge).

## 6. Déploiement

- **SHA déployé : `b64af44`** (`main` avancé en avance rapide depuis `cf1f605`, sans `--force`),
  le 30/10/2026 à 02:10 (Bruxelles), par `scripts/deploy.sh` de la release.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-021019-pre-deploy-b64af44.sqlite`.
- Après déploiement : `https://dig.lodygames.com` et `https://dig.lodylands.com` → 200, version
  `1.0.0+b64af44` ; journal sans erreur ; `quick_check` ok ; index présents ; empreintes joueurs
  identiques à la sauvegarde pré-déploiement ; `/api/seasons/current`, classement global et
  classement de ligue répondent normalement.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep cf1f605` puis
  `sudo systemctl restart dig` (dépendances inchangées). Les deux index ajoutés sont inoffensifs
  pour l'ancien code ; aucune restauration de base nécessaire.

**Test fonctionnel à faire par le propriétaire** (court, rien de visible n'a changé) :
1. Ouvrir le jeu, onglet **Saison** : le classement s'affiche comme avant, avec votre rang et votre
   ligue (Mimosa 🌼).
2. Casser quelques blocs à la main, revenir dans **Saison** : la profondeur et le rang se mettent à
   jour normalement.
3. Surtout : **lire `docs/LIGUES.md` et répondre aux questions de la section 8** (commentaire sur le
   ticket #19).

## 7. Choix techniques faits seul

- **`user_id ASC` comme dernier critère** : c'est le seul départage déterministe disponible sans
  nouvelle donnée. Il favorise les comptes anciens ; il est explicitement **provisoire** en attendant
  la réponse à la question 7 (date d'atteinte de la profondeur).
- **Ancien index `idx_rankings` conservé** : il ne sert plus au tri, mais le supprimer n'apporte
  rien et toute suppression est évitée par principe.
- **Pas d'implémentation « désactivée par défaut »** de la relégation ou des récompenses : la forme
  même des règles n'est pas décidée ; coder une variante risquait d'être jeté.

## 8. Décisions demandées au propriétaire

Détail et chiffres dans `docs/LIGUES.md`. Répondre par numéro (« OK » = recommandation acceptée).

1. **Classement MVP** : ligues et récompenses passent-elles « après lancement » ? *Recommandation : oui.*
2. **Structure** : une ligue unique par niveau (actuel) ou des divisions de 30 joueurs par niveau ?
   *Recommandation : une ligue par niveau pour le lancement, divisions plus tard.*
3. **Durée** : saison hebdomadaire lundi → dimanche UTC, inchangée ? *Recommandation : oui.*
4. **Seuil de promotion** : 10 actifs aujourd'hui (aucune promotion tant que la communauté est
   petite). *Recommandation : 5 actifs, formule inchangée (50 % / (1 + 0,45 × niveau)).*
5. **Relégation** : aucune / 20 % derniers actifs + inactifs des niveaux ≥ 1 descendent d'un niveau
   / autre. *Recommandation : 20 % + inactifs, jamais sous Mimosa, pas de relégation pour un promu
   de la même clôture.*
6. **Récompenses** : en gemmes par rang dans la ligue (1er 50, 2e 30, 3e 20, autres actifs 5,
   × (1 + 0,5 × niveau), +10 pour une promotion), versées après le plafond `gems_cap`, encaissées
   par le client à la connexion suivante ? Ou autre (reliques, coffres, titre) ? *Recommandation :
   gemmes selon ce barème.*
7. **Départage** : ajouter « le premier à avoir atteint la profondeur max » avant l'identifiant ?
   *Recommandation : oui (colonne ajoutée, aucune donnée réécrite).*
8. **Reset de saison par le serveur** : il modifie les sauvegardes des joueurs (mêmes règles que le
   reset client actuel : pièces, profondeur, pioche, améliorations à zéro, gemmes plafonnées,
   reliques conservées). L'autorisez-vous, appliqué à la prochaine lecture de chaque sauvegarde ?
   *Recommandation : oui, après une sauvegarde vérifiée ; sinon garder le reset client.*

## 9. Restant à réaliser

- Selon les réponses : relégation, récompenses (table de récompenses en attente + encaissement
  client + affichage), colonne de date de départage, reset serveur, ajustement de
  `min_active_players_per_league`, tests associés (promotion **et** relégation sur 3 ligues × 30).
- Après lancement : divisions par niveau si la communauté grandit ; affichage dans le jeu de la
  zone de promotion/relégation.

---

## Mise à jour du 30/10/2026 (soir) — orientation MVP du propriétaire

Ticket : #19 — [P2] T-12 — Spécifier et implémenter ligues, promotions et récompenses — https://github.com/ReC82/Dig/issues/19

**État réel : partie technique déployée en production depuis `b64af44` (toujours en ligne dans la
version actuelle) ; aucune nouvelle règle implémentée, conformément à l'orientation du propriétaire.
Mise à jour de la spécification seulement (documentation, aucun déploiement nécessaire).**

Commentaire du propriétaire (11:19) : ne pas considérer les 8 règles proposées comme approuvées,
conserver le comportement actuel, classer relégation, récompenses, reset serveur et nouveau barème en
post-MVP, sans modification de sauvegarde ni de classement ; recommandation cohérente avec #29/#33 ;
une seule décision groupée quand nécessaire ; ne pas redemander la recette profondeur/rang (couverte
par #9).

**Changements** : `docs/LIGUES.md` uniquement.
- Section 2.1 : classement de chaque élément — en place MVP (ligues par niveau, promotion actuelle,
  départage, classement figé #29), récompenses assurées par les points #33, après lancement (bonus de
  ligue, seuil 5, relégation, reset serveur, divisions), barème de gemmes abandonné (recommandation :
  double emploi avec #33, inflation de l'économie).
- Section 2.2 : recommandation unifiée — un seul classement figé (#29), points #33 sur le rang global,
  ligue = bonus multiplicatif `leagueBonusPctPerLevel` déjà présent (0 % aujourd'hui). Paquet à activer
  ensemble quand ≥ 5 actifs/semaine deux semaines de suite : seuil 5, bonus +10 %/niveau, relégation
  20 % derniers + inactifs (niveaux ≥ 1).
- Section 4 : les 8 questions sont remplacées par **une seule décision groupée, non urgente, après
  lancement**.

**Vérifications** : relecture du code en place (`server/seasons.js` : seuil `min_active_players_per_league`
et `promotion_rate` en configuration ; `server/rewardPoints.js` : attribution sur le rang global de
`season_standings`, bonus de ligue à 0 % imposé par la décision #33). Aucun code modifié, donc pas de
nouveau test ni de déploiement. Impact données : aucun.

**Test fonctionnel à faire par le propriétaire** : aucun nouveau (la recette profondeur/rang relève de
#9, celle des points de #33). Lecture de `docs/LIGUES.md` sections 2 et 4 si souhaité.

**Classement MVP** : #19 — partie en place suffisante pour le MVP ; tout le reste **après lancement**.
Ticket non bloquant ; il peut être clôturé par le propriétaire ou laissé ouvert pour le paquet post-lancement.

**Décision demandée** : aucune maintenant. Plus tard (quand ≥ 5 actifs/semaine) : « Activer le paquet
ligues 2.2 (seuil 5, bonus +10 %/niveau, relégation 20 % + inactifs) : oui / non / ajuster ? »
Recommandation : oui.

**Restant à réaliser (après lancement)** : paquet 2.2 sur décision ; éventuellement reset serveur et
divisions de taille fixe.

---

## Mise à jour du 03/11/2026 — audit de nuit des promotions et de « Mimosa » (lié à #48)

Demande du propriétaire (commentaire du 02/11, 23:32 UTC) : vérifier la formule de promotion pour N
ligues évolutives, une ligue très difficile et les petits effectifs (minimum d'un promu), tester
3 ligues × 30, les égalités, le départage manuel sans auto-dig, le redémarrage et la relégation selon
les règles existantes ; distinguer « Mimosa = ligue » ou « Mimosa = saison » ; pas de barème modifié.

### 1. État réel

**Déployé en production (SHA `fb5846a`) — en attente de recette.** Branche
`feature/19-ligues-recompenses` (`072582d`), intégrée dans `develop` (`fb5846a`).

### 2. Diagnostic « Mimosa »

**Mimosa est la ligue, pas la saison.** En production (copie lue, supprimée ensuite) :
- table `leagues` : une seule ligue, **Mimosa 🌼, niveau 0** (ligue d'arrivée de tout nouveau compte) ;
- table `seasons` : 8 saisons aux noms distincts (« Saison 44-2026 », « Saison 44-2026 · 2 »,
  « Saison 45-2026 » active du 02/11 au 08/11 23:59:59 UTC…) ;
- rapports de clôture du 30/10 et du 02/11 : `Mimosa — 1 actif, 0 promu, raison not_enough_players`.

Mimosa reste affichée parce que **personne n'a jamais été promu** : un seul joueur actif par semaine,
pour un seuil de 10 actifs par ligue. La rotation des saisons fonctionne. Renommer la ligue chaque
semaine serait faux (une ligue est un palier durable) ; ce qui manque est l'affichage distinct de la
saison (nom, bornes, temps restant) à côté de la ligue, qui relève de **#48** (non fait ici).

### 3. Vérification de la formule (règles actuelles, inchangées)

`promus = max(1, ⌊actifs × 0,50 / (1 + niveau × 0,45)⌋)`, seulement si la ligue a ≥ 10 actifs ;
« actif » = au moins un bloc manuel dans la saison ; tri : profondeur ↓, blocs manuels validés ↓,
premier arrivé ↑, compte ↑ ; pas de relégation.

| Cas | Résultat vérifié |
|---|---|
| 3 ligues × 30 | 15 / 10 / 7 promus, ligue Or créée (test existant `leagues.test.js`) |
| N ligues, 40 joueurs, 5 clôtures | répartition `{0:20,1:20}` → `{0:10,1:24,2:6}` → `{0:5,1:21,2:14}` → `{0:5,1:14,2:18,3:3}` → `{0:5,1:10,2:18,3:7}` ; +1 niveau max par clôture, jamais de descente |
| Ligue très difficile (niveau 12, 10 actifs) | formule 0,78 → **1 promu** garanti ; ligue 13 créée (« Ligue 13 ») |
| Petits effectifs (1 à 9 actifs) | 0 promu (règle actuelle) ; seuil mis à 1 dans le panel → le joueur seul est promu |
| Égalités | même profondeur : plus de blocs manuels validés devant ; puis le premier arrivé ; puis le compte le plus ancien |
| Auto-dig | un joueur 100 % auto-dig n'entre ni dans l'effectif ni dans la promotion ; 99 999 blocs auto ne font pas passer devant |
| Panne à la clôture | rien n'est appliqué (saison toujours active, aucune promotion, aucune ligue créée) ; après redémarrage, promotion appliquée **une seule fois** |
| 12 transitions de saisons | couvert par `season-cycles-12.test.js` (#57), toujours vert |

**Défaut trouvé et corrigé** : une valeur illisible de `promotion_rate` (ex. « abc »),
`difficulty_coefficient` ou `min_active_players_per_league` donnait un calcul NaN et **0 promu en
silence**, contraire au minimum d'un promu. Le panel admin ne contrôlait pas ces trois réglages.

### 4. Changements réalisés

- `server/seasons.js` : `leagueSettings()` — valeur absente, illisible ou hors bornes → valeur par
  défaut (0,50 / 0,45 / 10, inchangées) ; nombre de promus borné à l'effectif ;
  `validateLeagueConfigValue()` pour le panel.
- `server/index.js` : `PUT /api/admin/config` refuse un taux hors 0–1, un coefficient négatif, un
  seuil non entier ou < 1.
- `public/admin/admin.js` : libellé du seuil corrigé (« Joueurs actifs min dans une ligue pour qu'il
  y ait des promus » au lieu de « … pour créer une ligue », qui était faux).
- `test/leagues-audit.test.js` : 7 tests (Mimosa = ligue, N ligues, ligue difficile, petits
  effectifs, paramètres invalides, égalités/auto-dig, panne et redémarrage).
- `docs/LIGUES.md` : section 1.1 « Audit du 03/11/2026 ».

Procédure de test : `npm test` (ou `node --test test/leagues-audit.test.js`) — attendu 442/442.

### 5. Vérifications, limites, impact données

- `npm test` 442/442 sur la branche, sur `develop` et sur la release `fb5846a`.
- Copie de la base de production démarrée en `NODE_ENV=production` (port 3122) : `/health` ok,
  version `fb5846a`, empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking` identiques avant/après ; copie supprimée.
- **Aucune migration, aucune donnée joueur modifiée**, aucun réglage changé en production
  (le seuil reste 10).
- Non fait : essai HTTP du refus admin avec un vrai compte admin (validateur couvert en test
  unitaire, branchement d'une ligne) ; captures navigateur (rien de visible n'a changé côté joueur).

### 6. Déploiement

- SHA déployé : **`fb5846a`** (avant : `2b6c457`) ; sauvegarde vérifiée
  `dig-20261103-012840-pre-deploy-fb5846a.sqlite`.
- dig.lodygames.com et dig.lodylands.com : 200, `/api/version` = `1.0.0+fb5846a` ; journal sans
  erreur ; `quick_check` ok ; empreintes joueurs identiques à la sauvegarde.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 2b6c457` + redémarrage (aucun changement de
  dépendances ni de schéma).

**Test fonctionnel (2 minutes)** : panel admin → section « Ligues & Saisons » → champ « Joueurs
actifs min par ligue », saisir `2.5` et enregistrer → refus « min_active_players_per_league : entier
≥ 1 attendu » (avant : accepté). Remettre `10`. Dans la liste générale de Config, le seuil se lit
« Joueurs actifs min dans une ligue pour qu'il y ait des promus ». Côté jeu, rien ne change : la
ligue affichée reste Mimosa tant qu'aucune ligue n'atteint le seuil.

**Classement** : correctif **utile au MVP** (robustesse) ; affichage distinct saison / ligue :
**Bloquant pré-bêta selon le propriétaire, périmètre #48** ; paquet ligues (relégation, bonus) :
après lancement.

### 7. Choix techniques faits seul

- Valeur invalide → valeur par défaut plutôt que blocage de la clôture : la rotation ne doit jamais
  s'arrêter pour un réglage mal saisi, et le défaut est le barème actuel.
- Seuil laissé à 10 : le modifier est une règle de ligue, à la main du propriétaire (panel).
- Pas de renommage de Mimosa ni de changement d'affichage : diagnostic transmis à #48.

### 8. Décisions demandées au propriétaire

1. **Seuil de promotion pendant la bêta** (réglage du panel, sans code ni redéploiement) :
   garder 10 / descendre à 3 / à 1 ? Avec 10, aucun testeur ne verra de promotion tant qu'il y a
   moins de 10 actifs la même semaine ; à 1, même un joueur seul monte chaque semaine.
   *Recommandation : 3 pendant la bêta fermée*, pour que les testeurs voient la mécanique sans
   promotion automatique d'un joueur isolé. Non urgent ; rien n'est changé sans réponse.

### 9. Restant à réaliser

- Affichage distinct saison (nom, bornes, temps restant) / ligue / collection : **#48**.
- Paquet ligues après lancement (relégation, bonus de ligue #33) : décision groupée inchangée.
