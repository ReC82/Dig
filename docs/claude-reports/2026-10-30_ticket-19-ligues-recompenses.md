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
