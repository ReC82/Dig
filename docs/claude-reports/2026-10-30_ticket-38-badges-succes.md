# Ticket #38 — [P2] Badges et succès honorifiques : progression, collection et administration

- Lien : https://github.com/ReC82/Dig/issues/38
- Branche : `feature/38-badges-succes`
- Session DIGORCH du 30/10/2026 (soir)
- Classement : **Après lancement**. Le MVP fonctionne sans les badges : ils servent la motivation et ne bloquent rien.

## 1. État réel

**Déployé en production (SHA `6e6f58a`) — en attente de recette.** Première livraison : `bee0df4`, mise en ligne le 30/10/2026 à 22:02 (Bruxelles). Lot du 31/10 (UX commune et création par IA) : `6e6f58a`, mis en ligne le 31/10/2026 à 22:55. Voir la section datée du 31/10 en fin de document.

## 2. Résultat

Le jeu dispose désormais d'un système de **badges purement honorifiques** :
- aucun badge ne donne de pièces, de gemmes, de fragments, de reliques, de points de récompense ni de place au classement ;
- le module n'écrit dans aucune table économique, et un test le vérifie ;
- chaque badge est attribué **une seule fois** par le serveur, à partir de statistiques qu'il borne lui-même ;
- le joueur reçoit un toast discret, qui n'interrompt pas le minage et reste consultable dans l'historique des notifications (#26).

### Ce que voit le joueur
Dans l'onglet **📦 Collection**, une nouvelle section **« 🏅 Badges et succès »** apparaît sous les reliques :
- le compteur « 1 / 3 obtenus » et la mention « Suivi depuis le 30/10/2026 » ;
- une carte par badge, avec icône, nom et description ;
- pour un badge obtenu : la date d'obtention, avec un liseré doré ;
- pour un badge à obtenir : une barre de progression chiffrée (« 7 / 100 ») ;
- pour un badge secret : « Badge secret » tant qu'il n'est pas obtenu ;
- pour un événement : le bandeau « Événement jusqu'au … » ;
- pour un badge archivé mais obtenu : le bandeau « Retiré ».

Les badges sont disponibles en FR, EN et NL. L'affichage est responsive : une colonne sur smartphone, plusieurs sur PC. Un joueur non connecté voit « Connecte-toi pour suivre tes badges ».

### Première série (proposée, pas un barème définitif)
| Badge | Condition | État |
|---|---|---|
| 🕳️ Cent mètres sous terre | profondeur ≥ 100 m | **actif** (exemple demandé) |
| 🪨 Tailleur de pierre | 100 blocs de pierre | **actif** (exemple demandé) |
| ⛰️ Cinq cents mètres / 🌋 Le kilomètre | profondeur ≥ 500 / 1 000 m | désactivé, à valider |
| ⛏️ Mille coups de pioche | 1 000 blocs minés | désactivé, à valider |
| 🧭 Explorateur | 10 types de blocs différents | désactivé, à valider |
| 🧰 Premier trésor | 1 coffre ouvert en minant | désactivé, à valider |
| 📆 Une semaine à la mine | 7 jours de jeu distincts | désactivé, à valider |

Comme le demande le ticket, les paliers supplémentaires ne deviennent pas un barème approuvé sans ton retour. Ils existent en base mais restent **désactivés** : un clic sur « Activer » dans le panel suffit.

### Panel admin : onglet « 🏅 Badges »
- **Créer et modifier** un badge :
  - identifiant stable (non modifiable), catégorie, condition et seuil ;
  - type de bloc, choisi dans le catalogue publié de #37 ;
  - icône emoji, et image facultative (`/media/blocks|icons/…`, `/assets/…`, images de #39) ;
  - visibilité (visible ou secret), statut, dates d'événement en UTC, ordre d'affichage ;
  - nom et description en FR (obligatoire), EN, NL et ES.
- **Prévisualiser** : le badge est validé (la liste des erreurs s'affiche), puis l'aperçu indique combien de joueurs suivis rempliraient déjà la condition et combien sont à mi-chemin.
- **Activer, désactiver ou archiver** un badge, avec confirmation. Rien n'est jamais supprimé : les joueurs qui ont obtenu un badge le gardent, même s'il est archivé. La liste indique pour chaque badge le nombre de joueurs qui l'ont obtenu.
- Un **journal** conserve chaque action : création, modification (avant et après), statut. Il complète le journal d'audit général de #25.

## 3. Statistiques fiables (audit et choix)

**Audit de l'existant.** Le jeu est simulé dans le navigateur. Côté serveur, une seule statistique est fiable : la **profondeur retenue**. Elle est validée par #9 et bornée par le budget de dégâts de #25 (`player_depth_tracking.accepted_depth`). Il n'existait **aucun compteur par minerai**, ni côté client ni côté serveur.

**Choix retenu.** Un bloc détruit fait descendre d'un mètre. Le nombre de mètres retenus par le serveur borne donc le nombre de blocs que le joueur a pu réellement miner. Le traitement se fait en trois temps :
1. Le client tient des compteurs cumulés par type de bloc (`stats.minedByType`), inclus dans la sauvegarde.
2. À chaque sauvegarde, le serveur ne crédite que l'**écart** depuis la dernière valeur vue, et dans la limite des **mètres nouvellement retenus**. Le surplus reste en attente : il n'est jamais crédité sans mètre validé.
3. Les écarts sont refusés pour un type inconnu, un type dont la profondeur d'apparition n'est pas atteinte (par exemple du diamant à 50 m), un identifiant mal formé ou un nombre négatif ou décimal.

Si le compteur du joueur diminue (réinitialisation, autre appareil), le serveur prend la nouvelle valeur comme référence, sans crédit en double.

**Statistiques suivies :**
- `max_depth` : profondeur retenue, jamais la valeur déclarée ;
- `blocks:<type>` : blocs crédités par type ;
- `blocks_total` : total des blocs crédités ;
- `chests_opened` : blocs crédités de catégorie « coffre » ;
- `distinct_types` : nombre de types crédités ;
- `play_days` : jours distincts (Europe/Brussels) avec au moins un bloc crédité.

**Aucune rétroactivité.** Tout le suivi part de l'activation : pas de compteur reconstitué, pas de badge offert. La profondeur d'une saison précédente ne compte pas. Après le déploiement, un joueur déjà à plus de 100 m dans la saison en cours obtient « 100 m » à sa prochaine sauvegarde : c'est sa profondeur actuelle validée, pas une reconstitution.

**Limite honnête.** Le serveur ne peut pas vérifier *quel* type a été miné, puisque le tirage se fait dans le navigateur. Un tricheur pourrait déclarer « pierre » pour des blocs de terre, mais jamais plus de blocs que de mètres validés, et jamais un type hors de portée. Une vérification complète supposerait de rejouer le tirage côté serveur (graine #35), ce qui relève du lot C/D de #25 ; c'est à décider plus tard si les badges prennent de la valeur.

**Événements.** Un badge daté ne s'obtient qu'entre son début et sa fin. Ses compteurs partent de la valeur du joueur à sa première sauvegarde pendant la période, si bien que rien de ce qui a été fait avant ne compte. Un badge obtenu le reste après la fin de l'événement.

## 4. Changements

| Fichier | Changement |
|---|---|
| `server/badges.js` (nouveau) | Tables **en ajout seul** : `badges`, `player_badges` (clé user+badge, `INSERT OR IGNORE`), `badge_player_stats`, `badge_tracking`, `badge_event_baselines`, `badge_audit`, `badge_meta`. Première série (une seule fois). Validation, CRUD, statut, aperçu, journal, moteur d'attribution (une transaction), vue joueur. |
| `server/index.js` | `badges.init()` au démarrage ; `badges.processSave()` après chaque sauvegarde acceptée (erreur isolée, ne bloque jamais la sauvegarde) ; `badgesEarned` dans la réponse ; `GET /api/me/badges` ; `GET/POST /api/admin/badges`, `POST /api/admin/badges/preview`, `GET /api/admin/badges/audit`, `PUT /api/admin/badges/:id`, `POST /api/admin/badges/:id/status` |
| `public/js/gameState.js`, `save.js` | `stats.minedByType` (sauvegardé, rechargé ; ancienne sauvegarde → `{}`) |
| `public/js/main.js` | Compteur par type à chaque bloc détruit (manuel ou Auto-Dig) ; toast « Badge obtenu : … » historisé ; `renderBadges()` (texte échappé) |
| `public/index.html`, `css/style.css`, `js/i18n.js` | Section Badges dans Collection, styles, textes FR/EN/NL |
| `public/admin/index.html`, `admin.js` | Onglet 🏅 Badges (rendu DOM sûr, sans `innerHTML` dynamique, conforme à #15) |
| `test/badges.test.js` (nouveau) | 11 tests (voir § 5) |

## 5. SHA, tests et procédure

- Commit : `475dc74` (branche `feature/38-badges-succes`)
- **SHA sur `develop` : `bee0df4`** (fusion `--no-ff`)
- `npm test` : **346/346** sur la branche, sur `develop` et dans la release du SHA exact `bee0df4` (aucun échec, aucun nouveau passage nécessaire).

Les 11 tests de `test/badges.test.js` :
1. Première série : seuls 2 badges sont actifs, et une nouvelle initialisation n'écrase pas les choix de l'admin.
2. Pierre ×100 : 150 déclarés pour 60 m retenus donnent 60 crédités ; à 130 m, les deux badges sont obtenus ; ensuite, plus aucune seconde attribution.
3. Compteurs forgés ignorés : type inconnu, diamant à 50 m, nombre négatif ou décimal, profondeur déclarée de 1e9, saison différente.
4. Compteur client remis à zéro : nouvelle référence, sans double crédit.
5. Total, coffres, types distincts et jours de jeu (un jour sans bloc ne compte pas) ; progression chiffrée ; badge désactivé invisible.
6. **Aucune récompense économique** : `users`, `user_saves` et `season_rankings` restent identiques à l'octet près.
7. Archivage : le badge obtenu est conservé, plus aucune attribution ; après réactivation, l'attribution reprend.
8. Événement : ce qui précède la période ne compte pas ; badge secret masqué ; badge conservé après la fin ; un joueur arrivé après la fin ne l'obtient pas.
9. Admin : validation (7 erreurs ou plus), identifiant unique (409), aperçu, modification, 404 et 400, journal.
10. HTTP : 401 sans clé ou sans session, création par l'API, badge obtenu via `POST /api/me/save` avec la profondeur réellement validée, une seule attribution, pièces inchangées, archivage conservé, journal.
11. Client : compteur, section, textes FR/EN/NL et échappement.

**Essai navigateur** (Chromium headless, port 3101, base de test, badge d'essai « 3 blocs » créé par l'API admin) :
- smartphone 390×844 en NL et PC 1280×900 en FR ;
- vrais clics sur le bloc, puis sauvegarde ;
- résultat : toast « Badge behaald: Eerste houwen » / « Badge obtenu : Premiers coups » présent dans l'historique #26 ; section Badges « 1 / 3 obtenus », progression 7 / 100 et 1 / 100 ;
- onglet admin : liste, journal et validation affichés ;
- aucune erreur JavaScript.

## 6. Données des joueurs et déploiement

- **Migration** : 7 tables ajoutées, 8 badges insérés une seule fois. Aucune table existante n'est modifiée, aucune sauvegarde n'est réécrite. Le champ `stats.minedByType` est simplement ajouté par le client.
- **Désactivation possible sans redéploiement** : passer les badges en « désactivé » dans le panel.

### Déploiement
- **SHA déployé : `bee0df4`** (avance rapide de `main` `df570a3` → `bee0df4`, `scripts/deploy.sh` de la release), le 30/10/2026 à 22:02 (Bruxelles).
- **Sauvegarde avant déploiement (vérifiée)** : `~/backups/dig/dig-20261030-220248-pre-deploy-bee0df4.sqlite`.
- **Essai préalable sur une copie de la base de production**, avec `NODE_ENV=production` :
  - `/health` OK, `/api/version` = `1.0.0+bee0df4` ;
  - 8 badges créés, 0 attribué ;
  - second démarrage : 8 badges et 1 entrée de journal, la migration est idempotente ;
  - empreintes (lignes + hachage de toutes les colonnes) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après ;
  - copie supprimée ensuite.
- **Vérifications après le déploiement** :
  - les deux domaines répondent 200 avec la version `1.0.0+bee0df4` ;
  - `/api/me/badges` et `/api/admin/badges` renvoient 401 sans session ou sans clé ;
  - `journalctl` ne montre aucune erreur ;
  - `pragma quick_check` = ok ;
  - empreintes joueurs **identiques** à celles de la sauvegarde pré-déploiement ;
  - Chromium sur la production, smartphone (lodylands) et PC (lodygames) : la section « 🏅 Badges et succès » s'affiche et un visiteur voit « Connecte-toi pour suivre tes badges », sans erreur JavaScript.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep df570a3 && sudo systemctl restart dig`. Les tables ajoutées sont ignorées par l'ancien code, et la base n'est jamais restaurée.

### Test fonctionnel à faire par le propriétaire (5 min)
1. Recharger le jeu (PC ou téléphone), connecté, puis jouer 1 à 2 minutes.
2. Ouvrir **📦 Collection** et descendre jusqu'à **« 🏅 Badges et succès »**. Attendu :
   - « Cent mètres sous terre » est **obtenu** si tu es au-delà de 100 m dans la saison en cours, sinon la progression « x / 100 » s'affiche ;
   - « Tailleur de pierre » affiche « n / 100 », en partant de 0 au déploiement (aucune rétroactivité) ; il augmente quand tu mines de la pierre.
3. À l'obtention : un toast « 🕳️ Badge obtenu : … » apparaît sans gêner le minage, et on le retrouve dans ⚙ → Historique des notifications.
4. Recharger, puis se reconnecter : le badge est toujours là, avec sa date, et **pas de second toast**. Pièces, gemmes et classement restent inchangés.
5. Côté admin, `/admin/` → 🏅 Badges :
   - créer un badge d'essai « 3 blocs minés », actif ;
   - « Prévisualiser » ;
   - miner 3 blocs, puis attendre au plus 12 s : le badge arrive ;
   - l'**archiver** : il reste dans ta collection avec la mention « Retiré ».
6. Changer de langue (EN/NL) : les textes sont traduits.

## 7. Choix techniques faits seul

- **Section dans Collection plutôt qu'un 7ᵉ onglet** : la barre du bas compte déjà 6 boutons sur 390 px. Les badges sont des objets de collection.
- **Mètres retenus comme budget** : c'est la seule statistique déjà validée côté serveur et bornée physiquement (#25). Aucun nouveau calcul anti-triche n'est inventé.
- **Seuls les deux exemples demandés sont actifs**, les autres paliers restent en brouillon désactivé (consigne du ticket).
- **Coffres** : seuls les coffres-blocs minés comptent. Les coffres achetés en boutique n'ont pas été branchés, pour rester dans le périmètre ; c'est une extension simple si tu la souhaites.
- **Mise en avant sur le profil** : non réalisée. Il n'existe pas de page de profil public à ce jour (voir § 8).
- **Modification de la condition d'un badge d'événement** : les points de départ des joueurs pour ce badge repartent de zéro. C'est une donnée technique interne, pas une progression du joueur.
- **Dates d'événement saisies en UTC** (comme la boutique).

## 8. Décisions demandées au propriétaire

Aucune n'est bloquante : la livraison fonctionne telle quelle.
1. **Paliers à activer** : 500 m, 1 000 m, 1 000 blocs, 10 types, premier coffre, 7 jours. Options : activer tout, une partie, ou modifier les seuils. *Recommandation : activer « Premier trésor », « Explorateur » et « 500 m » maintenant, garder le reste pour plus tard.*
2. **Badges mis en avant** (3 au maximum) : où les afficher ? Options : (a) à côté du pseudo dans le classement de la Saison ; (b) sur une future page de profil ; (c) pas pour l'instant. *Recommandation : (a), après lancement.*
3. **Coffres achetés en boutique** : doivent-ils compter dans « coffres ouverts » ? *Recommandation : non, pour que le badge récompense le minage et pas les dépenses.*

## 9. Reste à réaliser (tout « Après lancement »)

- Mise en avant de badges (selon la décision 2) et affichage des badges des autres joueurs.
- Icônes dédiées aux badges (#40, atelier d'icônes) : pour l'instant ce sont des emoji, et le champ image est prêt.
- Textes en espagnol avec #42 : le champ ES existe déjà côté admin.
- Vérification complète du type miné, en rejouant le tirage côté serveur (lot C/D de #25), si les badges prennent de la valeur.
- Badges « participation à un événement » liés aux événements de #37 étape C, quand ils existeront. Les badges datés couvrent déjà le cas d'Halloween.


---

## Mise à jour du 31/10/2026 (soir) — UX commune du panel et création de badges par IA

Ce lot répond à la demande du propriétaire du 31/10 à 20:19 ([commentaire](https://github.com/ReC82/Dig/issues/38#issuecomment-6548642561)) : appliquer à l'onglet Badges la même UX que le reste du panel, et proposer une création assistée par IA.

### État réel
**Déployé en production (SHA `6e6f58a`) — en attente de recette.** Classement : **Après lancement** (panel admin uniquement, rien ne change pour les joueurs).

### Ce qui change dans le panel admin (onglet 🏅 Badges)
- **La page montre d'abord les données.** On voit la liste des badges : miniature (image ou emoji), nom, identifiant, condition, statut, visibilité, période et nombre de joueurs qui l'ont obtenu. Une recherche et des filtres (catégorie, statut, « sans image ») sont disponibles. **Aucun formulaire n'est affiché par défaut.** Le texte d'explication et la liste des critères suivis sont dans « Comment ça marche ? » (replié). Le journal est replié lui aussi.
- **Ouvrir un badge.** Un clic sur une ligne (ou Entrée / Espace) ouvre la **fiche** du badge. Elle est organisée en sections : Identité, Critère de déblocage (avec une aide sur ce que mesure le critère), Textes FR/EN/NL/ES, Visuel, Période d'événement. Un **aperçu joueur** se met à jour pendant la saisie. Depuis la fiche, on peut Vérifier (combien de joueurs l'obtiendraient), Enregistrer, Activer ou Désactiver, Archiver, ou 🎨 Illustrer dans l'atelier. Si le badge est actif, l'enregistrement demande une confirmation. Échap, ✕ ou Annuler ferment la fiche sans rien modifier.
- **Bouton « ＋ Ajouter un badge »** : il propose « ✨ Créer avec l'IA » ou « ✍ Créer manuellement ». **Un nouveau badge est toujours enregistré désactivé.** Le choix « Actif » a disparu de la création : on active ensuite depuis la fiche.
- **Création avec l'IA.** L'admin écrit une description libre. Un seul appel texte a lieu, en arrière-plan (≈ 20 à 60 s ; on peut fermer la fiche). La proposition s'ouvre ensuite dans la même fiche, entièrement modifiable. Elle comprend : un nom et une description dans les quatre langues, un emoji, une catégorie, une visibilité, une période d'événement facultative, une consigne d'illustration (en anglais) et un **critère choisi uniquement parmi ceux que le serveur suit réellement** : profondeur retenue, blocs au total, blocs d'un type publié, types différents, coffres ouverts en minant, jours de jeu distincts.
  - Les demandes impossibles sont **signalées** comme « Non pris en charge » (par exemple « 7 jours d'affilée » : seuls les jours distincts sont suivis ; ou des pièces gagnées). Aucun suivi n'est inventé.
  - Un critère inconnu ou un type de bloc inexistant **bloque l'enregistrement** tant que l'admin ne l'a pas corrigé.
  - « Enregistrer comme badge désactivé » crée le badge (désactivé) et transmet la consigne d'illustration à l'atelier. **Rien n'est jamais activé automatiquement**, et aucune image n'est générée à ce moment-là.
  - Les propositions déjà faites restent dans « ✨ Propositions IA » (replié, visible seulement s'il y en a).
- **Atelier d'icônes (#40).** Les badges non archivés font maintenant partie des icônes de l'atelier (famille « Badges »). L'image se génère **une par une**, sur action explicite, avec le gabarit « objet » et la référence de style commune. Comme un badge n'a pas de brouillon, on ne peut appliquer une image à un badge **actif** qu'après une confirmation explicite (elle devient visible tout de suite). Sur un badge désactivé, l'image attend son activation.

Captures (serveur de test, IA en mode factice) :
- liste : `docs/claude-reports/img/2026-10-31_ticket-38-ux-desktop-list.png`
- relecture d'une proposition IA : `docs/claude-reports/img/2026-10-31_ticket-38-ux-desktop-proposal.png`
- atelier sur un badge : `docs/claude-reports/img/2026-10-31_ticket-38-ux-desktop-studio.png`
- nouvelle fiche sur smartphone (390 px) : `docs/claude-reports/img/2026-10-31_ticket-38-ux-mobile-new.png`

### Fichiers
- `server/badgeAi.js` (nouveau) : propositions, normalisation, contrôle des critères, enregistrement en badge désactivé.
- `server/index.js` : routes `GET /api/admin/badges/ai`, `POST|GET|PUT|DELETE /api/admin/badges/ai/proposals[/:id]`, `POST …/:id/draft` (toutes avec `requireAdmin`).
- `server/iconStudio.js` : nouvelle famille `badge:` (cibles, consigne par défaut, application protégée par « live » sur un badge actif).
- `server/badges.js` : export de `VISIBILITY`.
- `public/admin/index.html`, `public/admin/admin.js` : onglet refait sur le socle commun (`admDialogSetup` / `admDialogOpen` / `admRowOpen`, écrit pour #37).
- `test/badge-ai.test.js` (nouveau, 8 tests).

### SHA et tests
- Branche `feature/38-badges-succes`, commit `4d6a092` ; **develop `6e6f58a`** (merge).
- `npm test` : **400/400** sur la branche, sur develop et sur la release `6e6f58a`.
- Essai Chromium (serveur de test, port 3101, base de test, IA factice), avec de vrais clics et le clavier :
  - PC 1280×900 et smartphone 390×844 ;
  - aucun formulaire visible par défaut ; le filtre fonctionne ; la fiche s'ouvre au clavier ;
  - parcours IA complet : proposition, avertissement « jours consécutifs », création d'un badge désactivé, ouverture de l'atelier ;
  - un identifiant déjà pris est refusé et la fiche reste ouverte ;
  - pas de défilement horizontal sur smartphone ; aucune erreur JavaScript.
- Copie de la base de production démarrée deux fois en `NODE_ENV=production` : migration idempotente, empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`, `badges` et `player_badges` identiques avant et après. Seul ajout : la table `badge_ai_proposals`.

### Déploiement
- Avant le déploiement, aucune génération IA n'était en cours en production (un redémarrage l'aurait interrompue).
- `main` a été avancé en avance rapide de `5ad36b1` à `6e6f58a`, puis `scripts/deploy.sh` (celui de la release) a été lancé.
- Sauvegarde vérifiée : `~/backups/dig/dig-20261031-225525-pre-deploy-6e6f58a.sqlite`.
- Vérifications : les deux domaines répondent 200 avec la version `1.0.0+6e6f58a` ; `/api/admin/badges/ai` répond 401 sans clé ; journal sans erreur ; `quick_check` ok ; empreintes de production identiques à la sauvegarde ; nouveau panel servi.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 5ad36b1` puis `sudo systemctl restart dig` (aucun changement de dépendances). La table ajoutée peut rester en place, elle est sans effet.

### Impact sur les données des joueurs
Aucun. Une seule table est ajoutée (`badge_ai_proposals`). Aucun badge n'a été activé ou modifié, et aucune attribution n'a eu lieu.

### Test fonctionnel à faire par le propriétaire (panel admin → 🏅 Badges)
1. Ouvrir l'onglet : la liste des 8 badges s'affiche, sans formulaire. Taper « pierre » dans le filtre : seul « Tailleur de pierre » reste.
2. Cliquer sur « Cinq cents mètres » : la fiche s'ouvre. Appuyer sur Échap : la fiche se ferme et rien n'a changé.
3. Cliquer sur « ＋ Ajouter un badge », puis « ✨ Créer avec l'IA ». Décrire par exemple « un badge pour ceux qui minent 7 jours d'affilée pendant les vacances », puis « Proposer un badge ». Après 20 à 60 s, la fiche affiche la proposition. Résultat attendu : un critère pris en charge (par exemple jours de jeu distincts) et l'avertissement « Non pris en charge : jours consécutifs… ». Corriger un texte, puis « Enregistrer comme badge désactivé » : le badge apparaît dans la liste, avec le statut désactivé.
4. Ouvrir ce badge, puis « 🎨 Illustrer dans l'atelier » : la fiche de l'atelier s'ouvre avec la consigne proposée. Générer une image uniquement si vous le souhaitez (une par action). « Conserver » l'applique au badge désactivé.
5. Facultatif : activer le badge depuis sa fiche (une confirmation est demandée).

### Choix techniques faits seul
- **Brouillon d'un badge = badge désactivé.** Les badges n'ont pas de catalogue brouillon/publié comme les blocs ou les collections. Un badge désactivé n'est jamais attribué : c'est le brouillon le plus simple, sans nouvelle notion à apprendre.
- **Une seule fiche** pour la consultation, la création manuelle et la relecture d'une proposition IA. Cela évite de dupliquer le formulaire.
- **Critère « impossible » = condition vide** dans la proposition. Le serveur refuse de l'enregistrer : l'IA ne peut pas faire passer un critère inventé.
- **Image d'un badge actif = accord explicite (« live »)**, parce qu'il n'existe pas de publication différée pour les badges.
- Proposition texte via `blockAi.guardedJson`, partagée avec #37 et #39 : clé côté serveur, un appel à la fois, quota, plafond et journal communs. Aucune nouvelle infrastructure.

### Décisions demandées au propriétaire
Les questions du 30/10 restent ouvertes (aucune n'empêche ce lot) :
1. Quels paliers activer parmi 500 m, 1 000 m, 1 000 blocs, 10 types, premier coffre et 7 jours ? Recommandation : Premier trésor, Explorateur, 500 m.
2. Où mettre en avant 3 badges ? Recommandation : à côté du pseudo dans le classement Saison, après le lancement.
3. Les coffres achetés en boutique comptent-ils dans « coffres ouverts » ? Recommandation : non (c'est le comportement actuel).

### Restes à faire (Après lancement)
- Nouvelles métriques, si vous le souhaitez : jours consécutifs, collection complétée (#39). Elles demandent un suivi serveur supplémentaire et ne sont pas inventées ici.
- Dans l'atelier, la mention « Actuelle en jeu » s'affiche aussi pour un badge désactivé. C'est cosmétique.
