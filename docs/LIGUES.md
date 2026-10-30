# Ligues, promotions et récompenses — spécification (proposition, ticket #19)

> **Statut : proposition à valider par le propriétaire.** Seules les parties marquées
> « en place » sont implémentées. Les autres décrivent la recommandation ; rien n'est codé
> avant la réponse aux questions de la section 4.

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

## 2. Proposition (recommandations, à valider)

1. **Structure** : garder une ligue unique par niveau pour le lancement. Les divisions de taille fixe
   (groupes de 30 joueurs par niveau, à la Duolingo) ne deviennent utiles qu'au-delà de ~100 joueurs
   actifs par niveau : à prévoir après le lancement.
2. **Durée** : inchangée (hebdomadaire, UTC).
3. **Promotion** : formule inchangée, mais seuil abaissé à **5 actifs** pour que les premières
   promotions aient lieu avec une petite communauté.
4. **Relégation** (niveaux ≥ 1 uniquement, jamais sous Mimosa) : les **20 % derniers actifs**
   (arrondi inférieur, au moins 1 si la ligue a au moins 5 actifs) et **tous les inactifs** de la
   ligue descendent d'un niveau. Un joueur promu à cette clôture ne peut pas être relégué à la même
   clôture. Les ligues vides sont conservées.
5. **Récompenses de fin de saison** en gemmes, par ligue, versées **après** le plafonnement à
   `gems_cap` : 1er 50, 2e 30, 3e 20, autres actifs 5, multipliées par `1 + 0,5 × niveau`
   (arrondi inférieur) ; +10 pour une promotion. Mécanisme : le serveur enregistre une récompense
   « en attente » (nouvelle table, aucune sauvegarde réécrite) ; le client l'encaisse à la connexion
   suivante, l'affiche, l'ajoute et sauvegarde ; le serveur la marque encaissée (une seule fois).
6. **Reset de saison par le serveur** : appliqué **à la lecture** de la sauvegarde (chargement ou
   première sauvegarde de la nouvelle saison), mêmes règles que le reset client actuel, idempotent
   (marqué par l'identifiant de saison). Aucune réécriture en masse à la clôture.
7. **Départage** (réalisé dans #29) : profondeur ↓, blocs validés ↓, **date à laquelle la profondeur max a été atteinte ↑**
   (le premier arrivé gagne), puis identifiant ↑. Demande une colonne ajoutée
   `season_rankings.max_depth_reached_at` (ajout seul ; les lignes existantes restent sans date et
   passent après celles qui en ont une, à égalité).

## 3. Impact sur les données

- Points 3, 4, 5 et 7 : ajouts de colonnes/tables et changement de `users.league_id` à la clôture
  (déjà le cas aujourd'hui pour la promotion). Rien n'est supprimé.
- Point 6 : modifie les sauvegardes des joueurs (comme le fait déjà le client). Il exige un **accord
  écrit** du propriétaire, une sauvegarde vérifiée et un test sur copie de la base.

## 4. Décisions demandées

Voir le rapport `docs/claude-reports/2026-10-30_ticket-19-ligues-recompenses.md` (section 8) et le
commentaire du ticket #19.
