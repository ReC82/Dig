# Ticket #33 — Points de récompense saisonniers : attribution au mérite et portefeuille persistant

- Ticket : [#33 — [P1] Points de récompense saisonniers — attribution au mérite et portefeuille persistant](https://github.com/ReC82/Dig/issues/33)
- Session : 30/10/2026 (session 1)
- Classement MVP : **Après lancement.** Les points ne servent qu'avec la boutique (#34) ; le jeu peut
  être partagé sans eux. L'infrastructure est néanmoins en ligne pour que chaque saison soit déjà
  simulée.

## 1. État réel

**Déployé en production (SHA `2397123`) le 30/10/2026 à 15:18 (Bruxelles), en attente de recette.**
Fonctionne en **mode simulation** : le barème proposé est affiché et appliqué pour information, **aucun
point n'est crédité** tant que tu n'as pas validé le barème (ticket : « ne pas appliquer le barème
illustratif sans décision métier »).

## 2. Réconciliation et périmètre

Aucune branche, PR ni rapport antérieur pour #33. Socle utilisé : le classement figé de #29
(`season_standings`, ordre au mérite, sans tirage), le verrou des cadeaux réels de #30
(`CONTEST_REAL_PRIZES`) et la décision #27 (développement débloqué, cadeaux réels désactivés).
Hors périmètre, laissés à leurs tickets : catalogue et échange (#34), affichage complet saison/boutique
(#31), règles de ligues (#19), sanctions anti-bot (#25 lot C).

## 3. Résultat et changements

**Ce que voit le joueur connecté** (onglet **Saison**, nouvelle carte violette « 🏅 Points de
récompense », FR/EN/NL, mobile) :
- son **solde** de points ;
- un bandeau « Aperçu : le barème n'est pas encore validé… » tant que le mode est simulation ;
- **« Si la saison finissait maintenant : rang #r sur n → catégorie : +p pts »** (mention « ex æquo »
  si besoin) ;
- le **barème** (repliable) et l'**historique** (repliable : crédits, échanges, et attributions
  simulées des saisons passées marquées « simulation ») ;
- la règle : points conservés d'une saison à l'autre, non convertibles en pièces, gemmes ou argent,
  non transférables.

**Ce que voit l'admin** (panel, nouvel onglet **🏅 Points**) : mode, barème JSON versionné avec
aperçu sur une saison figée, bouton « Activer le crédit réel des points » / « Revenir en simulation »,
attributions par saison avec détail, totaux, contrôle du registre, ajustement manuel motivé.

| Fichier | Changement |
|---|---|
| `server/rewardPoints.js` (nouveau) | Barème (validation, catégories exclusives, top %, minimum d'éligibles, ex æquo, bonus de ligue, filtre anti-bot optionnel), attribution idempotente par (saison, mode), registre (crédit, dépense idempotente, remboursement, ajustement admin), verrou cadeaux réels, contrôle de cohérence, vues joueur/admin. |
| `server/db.js` | Migration **additive** : 6 tables (`reward_points_settings`, `reward_point_scales`, `reward_point_wallets`, `reward_point_ledger`, `reward_point_awards`, `reward_point_runs`), 2 index, 8 déclencheurs « ajout seul », `CHECK balance >= 0`. |
| `server/seasons.js` | Attribution juste après la clôture (hors transaction : une panne ne bloque pas la rotation) ; rattrapage chaque minute par le planificateur. |
| `server/index.js` | `GET /api/points/scale`, `GET /api/points/me` ; `GET/PUT/POST /api/admin/points/*` ; barème v1 installé au démarrage s'il n'y en a aucun. |
| `public/js/main.js`, `public/js/i18n.js`, `public/css/style.css` | Carte « Points de récompense » dans l'onglet Saison, FR/EN/NL. |
| `public/admin/index.html`, `public/admin/admin.js` | Onglet 🏅 Points (rendu DOM sûr, sans `innerHTML` dynamique). |
| `docs/POINTS.md` (nouveau) | Règles, modes, barème proposé, simulations de répartition, garanties, API, retour arrière. |
| `test/reward-points.test.js` (nouveau) | 11 tests (voir § 5). |

**Barème proposé v1 (non validé — simulation seulement) :**

| Catégorie | Condition | Points |
|---|---|---|
| 1er | dès 3 éligibles | 100 |
| Top 1 % | dès 10 éligibles | 60 |
| Top 5 % | dès 10 éligibles | 40 |
| Top 10 % | dès 10 éligibles | 30 |
| Top 25 % | dès 4 éligibles | 20 |
| Top 50 % | dès 2 éligibles | 12 |
| Autres participants éligibles | — | 5 |

Répartition : 1 éligible → 5 pts ; 3 → 117 pts au total ; 10 → 189 ; 100 → 1 260 (12,6/joueur) ;
1 000 → 12 240 (12,2/joueur). Détail dans `docs/POINTS.md` § 3.

## 4. SHA, branche et procédure de test

- Branche : `feature/33-points-recompense` — commit code `94f4ab8`.
- **SHA sur `develop`** : `2397123` (fusion `--no-ff`).
- Tests : `npm test` → **238/238** (worktree du ticket, `develop` et release au SHA exact) ;
  `node --test test/reward-points.test.js` → 11/11.
- Essai manuel : `curl https://dig.lodygames.com/api/points/scale` → `mode: "simulation"`,
  `scaleVersion: 1`, 7 catégories.

## 5. Vérifications

**Effectuées :**
- Barème : refus des barèmes incohérents (points négatifs ou décimaux, identifiants en double,
  `rankMax` + `percentMax`, pourcentage hors bornes…) ; bornes exactes des catégories pour 1, 2, 4,
  100 et 1 000 éligibles ; ex æquo parfaits ; bonus de ligue ; filtre de risque.
- Simulation par défaut : clôture → attributions et exécution enregistrées, **registre vide, solde 0** ;
  rejouer l'attribution ou le rattrapage ne crée rien.
- Mode live : crédit à la clôture suivante seulement (saison simulée avant l'activation **non**
  créditée), clé `season:<id>:user:<id>`, aucun double crédit en rejouant ; saison vide ; points
  conservés au changement de saison ; la récompense potentielle affichée correspond à ce que la
  clôture attribue (ex æquo compris).
- Registre : dépense rejouée avec la même clé = un seul débit ; même clé + autre montant = 409 ;
  solde insuffisant = 409 sans écriture ; cadeau réel = 403 ; remboursement borné ; ajustement admin
  motivé ; `UPDATE`/`DELETE` refusés par la base sur registre, barèmes, attributions, exécutions ;
  solde négatif refusé (`CHECK`).
- HTTP (port 3135, base temporaire) : barème public, 401 sans session, portefeuille joueur, admin 401
  sans jeton, 400 sur mode/barème invalides, ajustement, aperçu, clôture admin → attribution simulée.
- Navigateur (Chromium headless, serveur de test port 3101) : carte rendue en FR (390×844), NL et EN
  (1280×900), 0 erreur JS.
- **Migration sur une copie de la base de production** (mode production, port 3122) : santé et
  version OK ; empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking` **identiques** ; `quick_check` ok ; 5 saisons passées attribuées en
  simulation (2 × 5 pts simulés, 3 vides) ; registre vide ; 2ᵉ démarrage sans aucun ajout. Copie
  supprimée.

**Non effectuées / limites :**
- Pas de test en jeu avec ton compte en production (je ne me connecte pas à ton compte). Le test
  navigateur en production a été fait sans compte (onglet Saison et panel chargent sans erreur).
- **Le panel admin est inactif en production tant qu'`ADMIN_SECRET` n'est pas défini** (déjà signalé
  pour #30) : l'onglet 🏅 Points n'est utilisable qu'après l'ajout de ce secret.
- La « récompense potentielle » est calculée sur le classement vivant (même ordre que le figé) ;
  le classement figé à la clôture fait foi.
- Pas de dépense réelle possible côté joueur : aucune route joueur de dépense (relève de #34, qui
  utilisera `spend()` avec une clé d'idempotence par commande).

**Données des joueurs :** rien n'est supprimé, réinitialisé ni réécrit. Ajouts seuls (6 tables,
2 index, 8 déclencheurs). Les points ne sont pas dans la sauvegarde de jeu. Aucune clé étrangère vers
`users` : la suppression d'un compte reste possible et l'historique est conservé.

## 6. Déploiement

- **SHA déployé : `2397123`** (production précédente : `f42ae68`), `1.0.0+2397123` sur
  https://dig.lodygames.com et https://dig.lodylands.com (200).
- **Avant** : release détachée, `npm ci`, `npm test` **238/238** sur le SHA exact ; copie de la base
  de production démarrée en mode production (voir § 5).
- **Sauvegarde pré-déploiement vérifiée** : `~/backups/dig/dig-20261030-151821-pre-deploy-2397123.sqlite`.
- `main` avancé en avance rapide `f42ae68 → 2397123` (sans `--force`), `scripts/deploy.sh` de la
  release : « OK : 2397123 en service, santé et version vérifiées » (`npm ci` non nécessaire).
- **Après** : 2 domaines 200 et bonne version ; journal sans erreur (5 attributions simulées au
  démarrage) ; `quick_check` ok ; empreintes des 6 tables joueurs **identiques** à la sauvegarde ;
  `/api/points/scale` répond ; Chromium 390×844 et 1280×900 sans erreur JS, onglet admin présent.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep f42ae68` puis `sudo systemctl restart dig`
  (`package-lock.json` inchangé). Les tables ajoutées sont ignorées par l'ancien code. Base jamais
  restaurée.

**Test fonctionnel à faire par le propriétaire (3 min) :**
1. Ouvrir le jeu connecté, onglet **Saison** : sous ta carte de rang, carte violette
   « 🏅 Points de récompense », **Solde : 0 pts**, bandeau jaune « Aperçu : le barème n'est pas
   encore validé… ».
2. Ligne « Si la saison finissait maintenant : rang #1 sur 1 → Autres participants : +5 pts »
   (tu es seul éligible : « 1er » exige 3 participants dans la proposition). Si tu n'as pas encore
   cassé de bloc cette semaine : « Casse des blocs à la main… » ; casse quelques blocs, rouvre Saison.
3. Ouvrir « Barème de fin de saison » : 7 lignes (100, 60, 40, 30, 20, 12, 5 pts) avec les minimums.
4. Ouvrir « Historique » : « Saison 4-2026 — #1/1 +5 pts (simulation) » et une ligne pour la 2ᵉ
   saison où tu as joué ; solde toujours 0.
5. Passer l'interface en EN puis NL (Paramètres) : carte traduite.
6. **Lundi 02/11** : l'historique montre « Saison 44-2026 … (simulation) », solde toujours 0.
7. Facultatif, après ajout d'`ADMIN_SECRET` : /admin/ → 🏅 Points → mode simulation, barème v1,
   attributions des saisons passées.

## 7. Choix techniques faits seul

- **Simulation par défaut, crédit réel sur décision** : respecte « pas de barème sans décision
  métier » tout en rendant le système visible et testable dès maintenant.
- **Pas de crédit rétroactif à l'activation** : activer le mode réel ne fait pas apparaître d'un coup
  les points de saisons jouées sous un barème non validé. Si tu veux créditer le passé, c'est un
  ajustement motivé (tracé), sur ta décision.
- **Portefeuille hors sauvegarde de jeu** (tables serveur) : le client ne peut ni le modifier ni le
  perdre lors du reset de saison.
- **Registre en ajout seul + clés d'idempotence** : anti-double crédit et anti-double dépense
  garantis par la base, pas seulement par le code ; corrections uniquement par mouvements compensés.
- **Une seule monnaie de points, usage noté à la dépense** (`virtual` / `real`) : plutôt que deux
  soldes séparés ; les échanges contre un cadeau réel sont refusés tant que `CONTEST_REAL_PRIZES`
  ≠ `on` (#27). Plus simple pour le joueur ; à revoir si tu veux deux soldes (question 3).
- **Ex æquo parfaits = meilleure catégorie du groupe** : le départage technique (heure d'arrivée,
  identifiant) sert au rang et aux lots uniques (#30), mais ne doit pas coûter de points.
- **Mode stocké dans une table dédiée**, pas dans `admin_config` : la route générique de
  configuration ne peut pas l'activer par erreur.
- **Aucune exclusion anti-bot automatique** (`maxRiskLevel: null`) : le lot C de #25 n'est pas décidé.

## 8. Décisions demandées au propriétaire

Une décision groupée ; répondre « OK » = recommandations acceptées.

1. **Barème** : valider la proposition v1 (§ 3) ? Options : (a) OK tel quel ; (b) mêmes catégories,
   autres valeurs ; (c) barème plus simple (1er / top 10 % / top 50 % / participants).
   *Recommandation : (a) — progressif, récompense chaque participant actif, minimums contre les
   « victoires » à 1 ou 2 joueurs.*
2. **Activation** : quand passer en crédit réel ? (a) dès ta validation (je ne l'active pas
   moi-même : bouton du panel, ou dis-le dans le ticket et la prochaine session l'activera) ;
   (b) en même temps que la boutique #34. *Recommandation : (a), pour que les joueurs accumulent
   avant l'ouverture de la boutique.*
3. **Virtuel / réel** : une seule réserve de points dont l'usage « cadeau réel » est verrouillé
   (actuel), ou deux soldes séparés ? *Recommandation : une seule réserve.*
4. **Ligues** : bonus par niveau de ligue (0 % aujourd'hui) ? *Recommandation : 0 % tant que #19
   n'est pas décidé.*

## 9. Reste à réaliser

- Selon tes réponses : nouvelle version du barème et/ou activation du mode réel (aucun code).
- #34 : catalogue et échange (utiliser `rewardPoints.spend()` avec une clé par commande, `use`
  `virtual`/`real`) ; #31 : intégrer la carte dans la refonte de l'onglet Saison.
- Exclusion motivée d'un tricheur après la clôture : ajustement admin tracé (existant) ; une règle
  automatique dépend de #25 lot C.
- Signalé hors périmètre : l'ajustement admin n'a pas de clé d'idempotence côté panel (un double
  clic confirmé deux fois créerait deux mouvements, tous deux tracés).
