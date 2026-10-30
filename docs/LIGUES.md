# Ligues, promotions et récompenses — spécification (proposition, ticket #19)

> **Statut (30/10/2026, orientation du propriétaire) : comportement actuel conservé pour le MVP.**
> Seules les règles de la section 1 sont en place. Les évolutions de la section 2 sont classées
> **après lancement** et **ne sont pas approuvées** : rien n'est codé, aucune sauvegarde ni aucun
> classement n'est modifié. Une seule décision groupée sera demandée, au moment utile (section 4).

## 1. Ce qui existe (en place)

| Règle | Comportement actuel |
|---|---|
| Durée | Saison hebdomadaire, lundi 00:00:00 → dimanche 23:59:59 UTC, rotation serveur chaque minute, sans trou (#16). |
| Structure | Une ligue par **niveau** : tous les joueurs d'un niveau sont classés ensemble. Niveau 0 = Mimosa 🌼 (ligue d'arrivée), puis Bronze, Argent, Or, Platine, Diamant, Émeraude, Maître, Grand Maître, puis « Ligue N ». Une ligue supérieure est **créée à la volée** dès que quelqu'un doit y monter : il n'y a pas de limite au nombre de ligues. |
| Joueur actif | Au moins un bloc cassé manuellement dans la saison (`manual_blocks > 0`). |
| Classement | Profondeur max validée par le serveur ↓, puis blocs manuels validés par l'anti-autoclic ↓, puis **premier à avoir atteint cette profondeur ↑** (`max_depth_reached_at`, à la milliseconde ; lignes antérieures à #29 sans date : après), puis identifiant du compte ↑. Aucun hasard. |
| Classement figé (#29) | À la clôture, le classement est copié dans `season_standings` / `season_snapshots` (tables immuables, empreintes SHA-256 chaînées). Participants : actifs avec ≥ 1 bloc manuel ; éligibles : profondeur > 0. Le niveau de risque anti-bot est noté pour l'audit, sans exclusion automatique. Mode `simulation` : aucun prix réel. API : `GET /api/seasons/:id|last/standings`, admin `GET /api/admin/seasons/:id/standings` (avec vérification). |
| Promotion | À la clôture, pour chaque ligue ayant au moins `min_active_players_per_league` actifs (10) : les `max(1, ⌊actifs × promotion_rate / (1 + niveau × difficulty_coefficient)⌋)` premiers montent d'un niveau (0,50 et 0,45 par défaut). Exemple avec 30 actifs : 15 promus en Mimosa, 10 en Bronze, 7 en Argent, 6 en Or. Un joueur monte d'au plus un niveau par saison. |
| Relégation | **Aucune.** Un joueur ne descend jamais. |
| Récompenses | **Aucune.** |
| Reset de saison | Fait par le **client** quand il voit un nouvel identifiant de saison : pièces, profondeur, pioche, dégâts, améliorations, boost et compteurs de coffres remis à zéro ; gemmes plafonnées à `gems_cap` (100) ; reliques conservées. |

Production au 30 octobre 2026 : une seule ligue (Mimosa) et un seul joueur actif par saison. Avec le
seuil de 10 actifs, **aucune promotion n'aura lieu tant qu'il n'y aura pas 10 joueurs actifs dans la
même semaine**.

## 2. Classement MVP et recommandation post-lancement

### 2.1 Classement

| Élément | Classement | Raison |
|---|---|---|
| Ligues par niveau, promotion actuelle, départage déterministe, classement figé (#29) | **En place — MVP** | Stable, testé (`test/leagues.test.js`, tests #29), déployé. |
| Récompenses de fin de saison | **En place via #33** (points de récompense) | Le canal de récompense au mérite validé par le propriétaire est le portefeuille de points #33, pas un nouveau barème de gemmes. |
| Bonus de points par niveau de ligue (`leagueBonusPctPerLevel`) | **Après lancement** — reste à 0 % | Inutile tant qu'il n'existe qu'une ligue (Mimosa). |
| Seuil de promotion (10 → 5 actifs) | **Après lancement** | Sans effet tant qu'il y a moins de 5 joueurs actifs par semaine. |
| Relégation | **Après lancement** | Nécessite plusieurs ligues peuplées. |
| Barème de gemmes par rang | **Abandonné (recommandation)** | Double emploi avec #33 et inflation de l'économie de jeu ; remplacé par le bonus de ligue de #33. |
| Reset de saison par le serveur | **Après lancement** | Modifierait les sauvegardes ; le reset client actuel fonctionne. Accord écrit requis le jour venu. |
| Divisions de 30 joueurs | **Après lancement** (> ~100 actifs par niveau) | Sans objet avec la population actuelle. |

### 2.2 Recommandation cohérente avec #29 et #33 (non approuvée)

Un seul classement figé (#29) sert de source à tout : rang global (`position`) et rang dans la ligue
(`rank_in_league`). Les points #33 sont attribués sur le rang **global** au mérite ; la ligue n'agit
que par un **bonus multiplicatif** déjà prévu dans le code (`leagueBonusPctPerLevel`, 0 % aujourd'hui).
Aucune nouvelle monnaie, aucun nouveau circuit de crédit : idempotence, ledger et retour arrière de #33
s'appliquent tels quels.

Paquet proposé, à activer **ensemble** quand au moins 5 joueurs actifs par semaine seront atteints
deux semaines de suite :
1. seuil de promotion à **5 actifs**, formule inchangée (réglage `min_active_players_per_league` de la configuration, aucune migration) ;
2. bonus de ligue #33 à **+10 % par niveau** (réglage du barème, sans rétroactivité) ;
3. relégation des **20 % derniers actifs + inactifs** des niveaux ≥ 1, d'un niveau, jamais sous
   Mimosa, jamais pour un promu de la même clôture (seul `users.league_id` change, comme pour la
   promotion aujourd'hui).

Hors paquet, à décider séparément s'il devient utile : reset de saison par le serveur (modifie les
sauvegardes), divisions de taille fixe.

## 3. Impact sur les données

- MVP : **aucun changement** (rien n'est codé au-delà de la section 1).
- Paquet 2.2 : réglages (seuil, bonus) et changement de `users.league_id` à la clôture, déjà pratiqué
  pour la promotion. Aucune suppression, aucune sauvegarde réécrite.
- Reset serveur : modifierait les sauvegardes ; accord écrit, sauvegarde vérifiée et test sur copie
  obligatoires.

## 4. Décision (groupée, non urgente, après lancement)

Une seule question, à poser quand le seuil d'activité de 2.2 sera atteint : « Activer le paquet
ligues 2.2 (seuil 5, bonus +10 %/niveau, relégation 20 % + inactifs) : oui / non / ajuster ? »
Les 8 questions précédentes du ticket sont remplacées par celle-ci (questions 1, 3 : comportement
actuel conservé ; 7 : réalisée dans #29 ; 6 : remplacée par le bonus #33 ; 2, 8 : hors paquet).
