# Ticket #53 — [Idée future] Statut OG — ancienneté, activité réelle et évolution visuelle du pseudo

Lien : https://github.com/ReC82/Dig/issues/53

## Session du 03/11/2026 (DIGORCH) — étude : deux conceptions et règles d'attribution

### 1. État réel

**Étude livrée (ce rapport), intégrée dans `develop`, non déployée : rien ne change dans le jeu.**
Le ticket demande de « présenter 2 conceptions et critères d'attribution, **pas d'implémentation
automatique ni de modification des pseudos** avant validation métier ». Je n'ai donc modifié
aucune ligne de code, aucune table, aucun pseudo et aucun réglage. Il n'y a rien à mettre en
production ni à tester en jeu pour l'instant.

Classement : **Après lancement** (marqueur honorifique, sans effet sur le jeu ; le MVP public
n'en a pas besoin).

### 2. Ce qui existe déjà (vérifié dans le code et sur une copie de la base en lecture seule, agrégats uniquement)

| Élément | Où | Utilité pour le statut OG |
|---|---|---|
| **Saisons hebdomadaires** (lundi 00:00 → dimanche 23:59:59 UTC, semaines ISO) | `server/seasonCalendar.js` (#16) | « 1 point par saison » ≈ **1 point par semaine jouée**, soit au plus ≈ 52 par an |
| **Classement figé à la clôture**, immuable (déclencheurs SQL), empreintes chaînées | `season_snapshots` / `season_standings` (#29) | **Source idéale** : une ligne par joueur et par saison, jamais réécrite → attribution idempotente et vérifiable |
| `effective_manual_blocks` | `season_standings` | blocs minés **à la main** et **validés par le serveur** (anti-autoclic) : Auto-Dig et clics suspects exclus |
| `risk_level` (0–4) | `season_standings`, `server/antibot.js` (#25) | niveau de risque anti-bot au moment de la clôture (3 = score ≥ 80, 4 = ≥ 90) |
| `eligible` / `exclusion_reason` | `season_standings` | compte supprimé ou profondeur nulle → non éligible |
| `users.created_at` | `users` | **ancienneté historique** (date de création du compte), fiable, côté serveur |
| `play_days` | `badge_player_stats` (#38) | jours distincts avec au moins un bloc validé ; depuis le 02/11/2026 seulement |
| Pseudos | `server/index.js` : `^[a-z0-9_-]{3,20}$` | **ASCII minuscule, 3 à 20 caractères, non modifiable** aujourd'hui (aucune route de changement) |

Constats sur la copie de la base (lecture seule, supprimée ensuite) :
- **1 seul compte** à ce jour ; **8 saisons** (n° 1 à 8), dont la 8 en cours.
- Instantanés figés : saisons 1 à 5 reconstitués **a posteriori** (`source = backfill`, à partir
  de chiffres déclarés par le navigateur avant les contrôles serveur #9/#25) ; saisons 6 et 7
  figées **à la clôture réelle** (`source = close`).
- Les saisons **6 et 7 sont dans la même semaine ISO (44)** : c'est la clôture exceptionnelle du
  30/10 (#44), une saison coupée en deux. C'est exactement le cas « double clôture » que le
  propriétaire veut traiter : avec « 1 point par saison » brut, ce joueur gagnerait 2 points pour
  une seule semaine.
- Saison 7 (2 jours et demi) : 4 blocs manuels validés seulement.

Conséquence : aucune donnée historique fiable ne permet aujourd'hui d'attribuer des points OG
rétroactifs sans contestation ; la base fiable commence avec les clôtures réelles (#29).

### 3. Règle d'attribution proposée (commune aux deux conceptions)

**Score OG = nombre de « semaines OG » validées.** Une semaine OG est gagnée, une seule fois,
par un joueur pour une semaine ISO dont **au moins une saison close** contient pour lui une
ligne figée qui remplit **tous** ces critères :

1. `eligible = 1` (compte existant, profondeur > 0) ;
2. `effective_manual_blocks ≥ 20` (réglable ; ≈ 10 minutes de jeu actif : le simulateur #49
   donne ≈ 126 blocs/h en début de partie) — **une connexion seule, l'Auto-Dig seul ou un
   onglet ouvert ne comptent pas** ;
3. `risk_level < 3` au moment de la clôture (pas de point sous suspicion forte de bot) ;
4. saison `source = close` (figée à la clôture réelle) — **jamais** un instantané reconstitué.

Pourquoi la **semaine ISO** plutôt que la saison brute :
- la double clôture (#44) ou une saison exceptionnelle courte ne donnent qu'**un** point ;
- un éventuel « reroll » ou une saison relancée la même semaine non plus ;
- une saison plus longue qu'une semaine (si un jour le calendrier change) compte pour la
  semaine de son début : **règle explicite** à confirmer (question 3), car on pourrait aussi lui
  donner un point par semaine couverte.
- Les critères sont évalués **sur l'ensemble des saisons de la semaine** (somme des blocs
  manuels validés, pire `risk_level`), pour qu'une saison coupée en deux ne fasse pas perdre le
  point (saison 6 : 224 blocs + saison 7 : 4 blocs → 1 point).

**Ancienneté historique distincte (« Fondateur »)** : la date de création du compte n'entre pas
dans le score. Elle peut donner un **marqueur séparé et figé** (« Fondateur » pour les comptes
créés avant la date du lancement public, à fixer par le propriétaire), sans points.

**Rétroactivité** : aucune attribution automatique. Proposition : point de départ = première
clôture réelle après activation ; en option, le propriétaire peut décider de compter les
saisons figées à la clôture (`source = close`) depuis #29 (pour le seul compte actuel : semaine
44 → 1 point). Les saisons 1 à 5 (reconstituées) ne comptent jamais.

**Pas d'effet économique ni de jeu** : le score OG ne donne ni monnaie, ni bonus, ni points de
récompense (#33), et n'entre dans aucun classement ni concours.

**Comptes multiples et bots** : chaque compte accumule seul ; l'intérêt de tricher est faible
(purement honorifique) ; le seuil de blocs manuels validés et le filtre `risk_level` écartent
l'automatisation ; le temps est le facteur limitant (impossible de gagner plus d'un point par
semaine).

**Modèle de données proposé (non créé)** — ajouts purs, migration idempotente :
- `og_weeks(user_id, iso_week TEXT, season_ids TEXT, manual_blocks INTEGER, criteria_version
  INTEGER, awarded_at TEXT, PRIMARY KEY(user_id, iso_week))`, en ajout seul (déclencheurs comme
  `season_standings`) → `INSERT OR IGNORE`, idempotent même si la clôture est rejouée ;
- `og_settings` (une ligne : activé ou non, seuil de blocs, seuil de risque, barème, date
  « Fondateur ») ; désactivé par défaut ;
- calcul juste après le gel du classement (même point d'accroche que les points de récompense
  #33), plus une reprise au démarrage pour une clôture manquée. Score = `COUNT(*)`.

### 4. Barème proposé : 18 paliers (6 emplacements × bronze/argent/or)

Le **nombre de paliers ne dépend pas du pseudo** : la progression est un pourcentage, puis elle
est dessinée sur le pseudo, quelle que soit sa longueur (3 à 20 lettres). Un pseudo long ne
progresse ni plus vite ni plus lentement.

| Palier | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Métal | B | B | B | B | B | B | A | A | A | A | A | A | O | O | O | O | O | O |
| Semaines OG | 1 | 2 | 3 | 4 | 6 | 8 | 11 | 14 | 17 | 21 | 25 | 30 | 36 | 42 | 48 | 55 | 63 | 72 |

Au-delà de 72 : **prestige** (couronne/emblème à 104 = deux ans de semaines OG, puis une étoile
par tranche de 52), sans changer le pseudo.

Simulation (2 000 tirages par profil, une semaine jouée avec la probabilité indiquée ; médianes) :

| Profil (semaines jouées) | 1er bronze | Bronze complet | 1er argent | Argent complet | 1er or | Or complet |
|---|---|---|---|---|---|---|
| Assidu (90 %) | 1 sem. | 9 sem. | 12 sem. | 33 sem. | 40 sem. | 80 sem. (≈ 1,5 an) |
| Régulier (60 %) | 1 sem. | 13 sem. | 18 sem. | 49 sem. | 59 sem. | ≈ 2,3 ans |
| Occasionnel (30 %) | 2 sem. | 26 sem. | 36 sem. | ≈ 2 ans | ≈ 2,3 ans | ≈ 4,6 ans |
| Ponctuel (10 %) | 7 sem. | ≈ 1,5 an | ≈ 2 ans | ≈ 5,7 ans | ≈ 6,8 ans | > 10 ans |

Lecture : un nouveau joueur voit sa première lettre changer dès la première semaine (effet
immédiat) ; l'argent récompense un trimestre d'assiduité ; l'or complet reste rare (≈ 1,5 an
pour les plus fidèles). Un ancien joueur n'est jamais rattrapé « artificiellement » : la seule
source est le temps réellement joué. Le barème est un réglage (une liste de 18 seuils), donc
ajustable sans code.

### 5. Conception A — « Pseudo forgé » (évolution des lettres)

Le pseudo lui-même change de couleur, lettre par lettre. Deux ordres possibles :

- **A1 — ordre du propriétaire (lettre par lettre)** : la 1re lettre passe bronze → argent → or,
  puis la 2e, etc. Pour être équitable, on ne compte pas « une lettre par palier » mais une
  proportion : `étapes = floor(palier / 18 × 3 × L)` (L = nombre de lettres), et la lettre `i`
  reçoit le métal `min(3, max(0, étapes − 3i))`.
  Exemple (0 = normal, 1 = bronze, 2 = argent, 3 = or) au palier 6 :
  `abc` → `300` ; `abcdefgh` → `33200000` ; pseudo de 20 lettres → `3333332000…`.
  Inconvénient : **de l'or apparaît dès le palier 1–2** sur la 1re lettre ; « or » ne signifie
  plus « ancien », la lecture des métaux devient ambiguë.
- **A2 — en vagues (recommandé si A est choisi)** : tout le pseudo devient bronze de gauche à
  droite (paliers 1–6), puis argent (7–12), puis or (13–18). Lettres concernées :
  `round((palier mod 6) / 6 × L)` premières lettres au métal suivant. Un pseudo de 3 lettres
  change une lettre tous les deux paliers, un pseudo de 20 lettres trois ou quatre lettres par
  palier : **même proportion**, même métal dominant, quel que soit le pseudo.

Rendu : une `<span>` par lettre avec une classe `og-m1/2/3` (dégradé + léger contour pour rester
lisible en thème clair et sombre). 20 lettres × 50 lignes = 1 000 éléments : négligeable.
Unicode : aujourd'hui les pseudos sont ASCII ; si des accents/émojis sont un jour permis, on
découpe par **graphèmes** (`Intl.Segmenter`) et on ignore les espaces ; la progression n'est
jamais stockée dans le texte, donc un éventuel changement de pseudo ne perd rien.

Accessibilité : la couleur ne peut pas être le seul indice → libellé lisible par les lecteurs
d'écran (« statut OG : argent, palier 9 sur 18, 17 semaines ») et un petit chiffre ou une
infobulle à côté du pseudo.

Avantages : très visible, original, conforme à l'intention. Limites : pseudo moins lisible sur
mobile dans un classement compact (métal sur métal) ; or/argent proches en contraste ; plus de
travail CSS et de tests d'accessibilité.

### 6. Conception B — « Emblème OG » (pseudo inchangé)

Le pseudo garde sa couleur ; un **petit emblème** (pioche ou blason) est placé juste avant lui :
- métal de l'emblème = bronze / argent / or selon le palier ;
- **1 à 6 crans** (points ou encoches) sous l'emblème = position dans le métal ;
- au-delà : couronne, puis étoiles de prestige ;
- profil : barre de progression « 17 semaines OG — prochain palier à 21 », règles en clair ;
- option « Fondateur » : liseré distinct, figé.

Avantages : lisible en classement compact mobile (16–20 px), **aucune dépendance à la longueur
du pseudo**, accessible (forme + nombre de crans + libellé, pas seulement la couleur),
réutilise le système d'icônes (#22/#40) et l'affichage des badges (#38), coût faible.
Limites : moins spectaculaire ; ressemble à un badge.

### 7. Recommandation

**Combiner** : **B dans le classement** (compact, lisible, accessible) et **A2 sur le profil**
et le podium (vitrine du pseudo forgé, là où la place et la lisibilité le permettent). Ordre de
réalisation si le propriétaire valide : (1) règle d'attribution + table + calcul à la clôture,
désactivé par défaut ; (2) emblème B + règles affichées ; (3) pseudo forgé A2 sur le profil.
Estimation : (1) ≈ 1 session, (2) ≈ 1 session, (3) ≈ 1 session, avec tests et aperçu.

### 8. SHA, branche et procédure de test

- Branche : `docs/53-statut-og` ; rapport intégré dans `develop` (SHA dans le commentaire du
  ticket et dans le rapport de nuit).
- Rien à tester en jeu : aucun changement de comportement. Pour relire : ce fichier.
- Pour reproduire la simulation : le petit calcul est décrit en section 4 (barème + probabilité
  hebdomadaire de jouer) ; il n'a pas été ajouté au dépôt.

### 9. Vérifications effectuées, limites, impact sur les données

- Lecture du code : `seasonCalendar.js`, `standings.js`, `db.js` (schémas), `badges.js`,
  `antibot.js`, `rewardPoints.js`, validation des pseudos dans `index.js`.
- Copie de la base de production par `.backup` vers `/tmp`, **lecture seule**, agrégats
  uniquement (aucun pseudo ni e-mail repris), copie supprimée à la fin.
- **Aucune donnée joueur touchée.** Aucun serveur de test n'a été nécessaire.
- Limite : un seul compte réel ; la simulation est probabiliste et ne modélise pas les
  vacances ni l'arrêt de joueurs.

### 10. Déploiement

**Non déployé : rien à déployer** (document seul, aucun code). Le commit de rapport n'entraîne
pas de nouveau déploiement. **Test fonctionnel en jeu : aucun** ; seule une relecture et les
décisions ci-dessous sont attendues.

### 11. Choix faits seul

- Source = classement figé (#29), parce qu'il est immuable et horodaté : attribution
  idempotente et vérifiable, aucune nouvelle collecte de données.
- Regroupement par semaine ISO : règle la double clôture du 30/10 sans cas particulier.
- Seuil en blocs **manuels validés** plutôt qu'en connexions ou en `play_days` :
  `play_days` n'existe que depuis le 02/11 et ne distingue pas l'Auto-Dig.
- 18 paliers indépendants du pseudo : équité entre pseudos courts et longs.

### 12. Décisions demandées au propriétaire

1. **Conception** : A (pseudo forgé), B (emblème) ou **A+B** (B au classement, A2 au profil) ?
   Recommandation : **A+B**. Si A : ordre **A2 (vagues)** recommandé plutôt que A1 (lettre par
   lettre), pour que l'or reste le signe des plus anciens.
2. **Critère de participation** : ≥ **20 blocs manuels validés** dans la semaine, risque anti-bot
   < 3 ? Recommandation : oui, seuil réglable dans l'admin.
3. **Saisons courtes / exceptionnelles** : un point par **semaine ISO** (double clôture = 1 point)
   ? Et une saison de plus d'une semaine = 1 point (recommandé) ou 1 point par semaine couverte ?
4. **Rétroactivité** : aucune (recommandé), ou seulement les saisons figées à la clôture réelle
   depuis #29 (semaine 44 → 1 point pour le compte actuel) ? Les saisons reconstituées 1–5 ne
   compteraient jamais.
5. **Barème** : les 18 seuils de la section 4 (or complet ≈ 1,5 an pour un joueur assidu) vous
   conviennent-ils ? Préférez-vous plus court (≈ 1 an) ou plus long ?
6. **« Fondateur »** : un marqueur figé pour les comptes créés avant le lancement public ?
   Si oui, à quelle date ?
7. **Confidentialité** : le statut OG est-il public dans le classement (recommandé, c'est un
   honneur), avec plus tard une option « masquer mon statut » ?

### 13. Reste à réaliser (après validation)

- Table `og_weeks` + réglages + calcul à la clôture (désactivé par défaut), tests (double
  clôture, rejeu, compte supprimé, risque élevé, Auto-Dig seul).
- Emblème B dans le classement et le profil, textes FR/EN/NL/ES, règles affichées.
- Pseudo forgé A2 sur le profil/podium, aperçu en vrai composant (ordinateur et mobile).
- Admin : activation, seuils, barème, liste des points attribués (lecture seule).
