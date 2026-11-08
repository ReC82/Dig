# Ticket #56 — Événements mensuels : objets exclusifs à miner et calendrier automatique

# Mise à jour du 08/11/2026, ~21 h 05 (Bruxelles) : recette #56-K corrigée (test de bascule, souvenirs proposés, préparation éditoriale)

Ticket : [#56](https://github.com/ReC82/Dig/issues/56). Retour pris en compte : [recette #56-K BLOQUÉE du 08/11 19:13](https://github.com/ReC82/Dig/issues/56#issuecomment-6725198013), avec la capture PDF « DIG! Admin(20261108-180904) » d'Admin → Événements. Chantier lié : [#93](https://github.com/ReC82/Dig/issues/93) (doubles et échanges), ouvert à part par le propriétaire ([commentaire](https://github.com/ReC82/Dig/issues/56#issuecomment-6725207106)).

## 1. État réel

**Déployé en production (SHA `eab1fa9`), en attente de la recette #56-K.**

- Aucun changement pour les joueurs. Novembre reste actif avec 30 objets. Noël reste planifié aux mêmes dates, avec les mêmes 5 objets publiés et les mêmes chances.
- Les 26 nouveaux souvenirs de Noël existent en production, mais **en proposition seulement**. Ils ne tombent pas et sont invisibles des joueurs, ce que j'ai vérifié sur `/api/events`. Ils attendent ta validation, chances comprises.

## 2. Résultat et changements

**Audit de départ (schéma et 5 fiches de Noël).**
- Avant ce changement, un objet était soit publié, soit absent. Il n'existait pas d'état « proposé ».
- Un événement planifié était entièrement figé : pour ajouter un objet, il fallait le repasser en brouillon, ce qui arrête les drops.
- Les 5 fiches de Noël sont complètes en FR, EN, NL et ES et ont une consigne d'image. En revanche :
  - aucune n'a de date de référence ;
  - 0 image est publiée (l'emoji est affiché, ce qui reste admissible) ;
  - aucune n'a de « Pourquoi cet objet ? » vérifié, donc rien n'est montré aux joueurs pour ces 5 objets.
- Je n'ai modifié aucune date, source, image ni chance de ces 5 fiches.

**Panel admin (Événements).**
1. **« 🧪 Tester le passage au mois suivant »** est maintenant un vrai bouton, placé à côté du titre « Préparation du mois prochain », avec une aide d'une ligne. Il ouvre une fenêtre marquée « 🔒 Simulation en lecture seule » (ce n'est pas « Planifier »). La fenêtre contient :
   - une colonne **Attendu** qui compare le résultat à la règle (✅ conforme, ⚠ écart) ;
   - le mois d'après, pour montrer qu'aucun événement n'est inventé ni prolongé ;
   - le simulateur d'une heure libre, qui reste en lecture seule et s'affiche dans cette même fenêtre.

   Résultat actuel :

   | Heure (Bruxelles) | Événement public actif |
   |---|---|
   | 30/11 23:59:59 | Novembre |
   | 01/12 00:00:00 | aucun |
   | 01/12 00:01 | Noël |
   | janvier 2027 | « aucun événement prévu » |
2. **« ＋ Ajouter » devient « ＋ Nouvel événement »**, pour qu'on ne le confonde plus avec l'ajout d'un objet.
3. **« ＋ Ajouter un souvenir »** se trouve dans la fiche de l'événement. Le formulaire ne s'ouvre qu'au clic. Ce bouton fonctionne sur un événement **en brouillon ET déjà planifié**. Le souvenir est enregistré tout de suite comme **proposition** (« 📝 Proposé — non publié »). Dans ce cas :
   - le statut de l'événement ne change pas et l'événement ne repasse pas en brouillon ;
   - les objets publiés et les drops en cours ne sont pas touchés ;
   - la proposition reste modifiable et peut être retirée.
4. **« 📤 Publier les propositions cochées »** se fait en deux étapes :
   - étape 1 : résumé et tableau des objets ;
   - étape 2 : « barème des nouveaux souvenirs validé ».

   La publication est atomique et journalisée (révision avant et après dans le journal). Les chances des objets déjà publiés ne changent pas. **Retour arrière :** « ↩ Remettre en proposition », possible tant que personne n'a trouvé l'objet. Le simulateur de chances marque les propositions (« 📝 … (proposé) ») pour qu'on puisse les simuler avant publication.
5. **Préparation éditoriale séparée de l'état technique.**
   - Le mois prochain s'affiche « 🗓️ Planifié » (au lieu de « ✅ Prêt — planifié »), suivi de la pastille **« 📚 5 préparé(s) / objectif 31 · Contenu à compléter »**.
   - L'**objectif éditorial** peut être modifié dans la fiche, dans tous les états, sans effet sur les drops. Ce n'est jamais une condition de planification : Noël a un objectif de 31, novembre n'en a aucun.
6. **Alertes hiérarchisées**, sans texte coupé (retour à la ligne) :
   - « ❌ » : bloquant ;
   - « ⚠ » : réellement à compléter (couverture de l'objectif, propositions en attente, « Pourquoi cet objet ? » non vérifiés, traductions, images conservées mais non publiées) ;
   - « ℹ » : admissible tel quel (emoji à la place d'une image, consigne d'image absente).

   Les mois terminés et les événements terminés n'affichent plus de « à compléter ».
7. **Calendrier annuel : actions directes.** Chaque mois propose « 📝 Préparer ce mois », « 👁 Voir ses objets » et « ＋ Ajouter un objet ». Le dernier ouvre la fiche de l'événement, puis le formulaire de proposition. Les cartes des mois (précédent, en cours, prochain) proposent aussi « ＋ Ajouter un souvenir » et « 👁 Voir ses objets ».
8. **Responsive.** Entre 0 et 1 100 px de large, la liste des événements et le calendrier s'affichent en cartes. Les fiches ne débordent plus sur téléphone (`fieldset` en `min-width: 0`). Mesures dans Chromium : aucun débordement horizontal de la page à 1280×900, 1024×800 et 390×844.
9. **Bonus des souvenirs (#81).** Une ligne dans la fiche de l'événement et un cadre dans chaque fiche d'objet indiquent « aucun bonus défini, inactif, ni permanent ni calendaire, cumul simulé : aucun effet ». Les micro-bonus restent à part, en brouillon. Rien n'a été activé.
10. **Doubles et échanges.** Le modèle « un exemplaire par joueur » ne change pas. Le sujet est suivi dans #93, sans rien d'activé.

**26 souvenirs de Noël proposés** (`server/content/event-proposals/noel-2026.json`).
- Ils sont importés **une seule fois** au démarrage, en proposition, avec un objectif de 31. L'import passe après les décisions du propriétaire et n'écrase rien.
- Chaque fiche contient :
  - un nom et une description humoristique en FR, EN, NL et ES ;
  - un emoji ;
  - une date de référence du 02/12 au 31/12 (sauf 06, 21, 23 et 24, que je suggère pour les 5 fiches existantes) ;
  - une rareté ;
  - une consigne d'image ;
  - une inspiration historique optionnelle, visible de l'admin seulement et marquée « à vérifier ». Exemples : Sainte-Barbe patronne des mineurs le 04/12, frères Wright le 17/12, Dickens le 19/12, frères Lumière le 28/12.
- Aucune source n'est marquée vérifiée et aucune image n'a été générée.
- Répartition : 5 communes, 8 peu communes, 7 rares, 4 épiques, 2 légendaires.
- **Barème suggéré, aligné sur novembre (#86) :**

  | Rareté | Chance par bloc | Profondeur minimale |
  |---|---|---|
  | Commune | 0,25 % | aucune |
  | Peu commune | 0,15 % | aucune |
  | Rare | 0,08 % | aucune |
  | Épique | 0,05 % | 10 m |
  | Légendaire | 0,03 % | 20 m |

  Tous les blocs comptent.

**Serveur** (`server/monthlyEvents.js`, `server/index.js`).
- Colonnes **ajoutées**, de manière idempotente : `monthly_event_items.proposal` et `monthly_events.item_target`.
- Fonctions : `addProposal`, `updateProposal`, `removeProposal`, `publishProposals` (exige `confirmRates`), `unpublishProposals`, `setItemTarget`, `contentChecks`, `importProposals`.
- Comment les propositions sont exclues :
  - le tirage, la vue joueur, l'annonce « Bientôt », la vérification avant planification, la publication des images et les compteurs ignorent les propositions ;
  - l'enregistrement d'un brouillon conserve l'état « proposé » connu du serveur : une proposition ne peut pas être publiée en douce.
- `monthStatus` renvoie `missing`, `acceptable` et `content` ; `warnings` reste présent pour la compatibilité.
- `preparation` renvoie `following`, le mois d'après.
- Routes admin :
  - `POST /api/admin/events/:id/proposals`
  - `PUT` et `DELETE /api/admin/events/:id/proposals/:itemId`
  - `POST …/proposals-publish`
  - `POST …/proposals-unpublish`
  - `PUT …/target`

## 3. SHA, branche, procédure de test

- Branche `feature/56-evenements-mensuels`, commit `b1073d5`. Fusionné dans `develop` en **`eab1fa9`** (arbre identique), déployé en `eab1fa9`.
- Tests : `npm test` → **995/995**. J'ai ajouté `test/monthly-events-proposals.test.js` (7 tests) :
  - une proposition sur un événement actif n'est jamais tirée ni visible ;
  - la publication exige le barème, est atomique et journalisée, avec retour arrière tant que l'objet n'est pas trouvé ;
  - l'enregistrement d'un brouillon conserve l'état « proposé » ;
  - objectif, alertes et état « Planifié » distinct ;
  - Noël : 26 propositions importées une seule fois, 5 objets intacts, bascule 23:59:59 / 00:00:00 / 00:01, janvier absent, aucun drop des propositions ;
  - présence des boutons et des routes dans le panel.

  `test/monthly-events-transition.test.js` a été adapté aux nouveaux compteurs, et `docs/admin-navigation.md` complété (action `#a/event-transition`).

## 4. Vérifications, limites, données joueurs

- Navigateur (Chromium headless, copie de la base de production, port 3101) à 1280×900 et 390×844, sans erreur JavaScript :
  - la fenêtre de bascule donne ✅ sur les 6 heures testées ;
  - la fiche Noël affiche « 5 préparé(s) / objectif 31 · Contenu à compléter » et 26 lignes « 📝 Proposé » ;
  - « ＋ Ajouter un souvenir » ouvre « Nouveau souvenir proposé » ;
  - une proposition s'ouvre en modification, avec un identifiant verrouillé.
- **Données joueurs :** aucune modification. Les empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` sont identiques avant et après, sur la copie comme en production. Les objets publiés (38 lignes) sont identiques à la production avant le déploiement.
- **Limites :**
  - « Cumul simulé » des bonus : il n'existe aucun modèle de bonus par souvenir, le cumul vaut donc 0. Le vrai modèle relève de #81.
  - Les inspirations historiques ne sont pas vérifiées et restent côté admin.
  - Je n'ai pas cliqué « Publier les propositions » en production : c'est une décision du propriétaire.

## 5. Déploiement

- Production : **`eab1fa9`** (précédent : `4f3c8fd`).
- Sauvegarde vérifiée avant le déploiement : `~/backups/dig/dig-20261108-205547-pre-deploy-eab1fa9.sqlite`.
- Contrôles faits avant le déploiement :
  - aucune génération IA en cours (dernière à 17:00 UTC) ;
  - release testée en 995/995 ;
  - migration testée sur une copie de la base de production, avec empreintes identiques.
- Contrôles faits après le déploiement :
  - les deux domaines répondent 200 avec `1.0.0+eab1fa9` ;
  - `quick_check` = ok ;
  - journal sans erreur ;
  - `/api/events` : novembre actif avec 30 objets, aucune proposition visible.
- Retour arrière : `git reset --keep 4f3c8fd` puis redémarrage. Les colonnes ajoutées sont ignorées par l'ancien code et les propositions restent inertes.

**Recette propriétaire #56-K (environ 2 minutes, PC ou téléphone)**
1. Admin → Événements. Sous « 🗓️ Préparation du mois prochain », clique **« 🧪 Tester le passage au mois suivant »**. Attendu :
   - 30/11 23:59:59 → Novembre ✅ ;
   - 01/12 00:00:00 → aucun ✅ ;
   - 01/12 00:01 → 🎄 Noël ✅ ;
   - en bas : « janvier 2027 — aucun événement prévu ».

   Ferme la fenêtre : rien n'a changé.
2. Ouvre « 🎄 Noël sous la mine ». Attendu :
   - « 🗓️ Planifié » ;
   - « 📚 5 préparé(s) / objectif 31 · Contenu à compléter » ;
   - 5 objets publiés et 26 lignes « 📝 Proposé — non publié ».
3. Clique **« ＋ Ajouter un souvenir »**. Le formulaire « Nouveau souvenir proposé » s'ouvre. Ferme-le avec Annuler, ou enregistre un essai puis retire-le avec « 🗑 Retirer la proposition ». Noël reste planifié.
4. Sur téléphone, la liste des événements et le calendrier s'affichent en cartes, sans défilement horizontal ni avertissement coupé.

Classement : **Après lancement.** Le lancement du MVP n'en dépend pas : novembre est actif et Noël démarrera seul.

## 6. Choix techniques faits seul

- **Proposition = drapeau sur l'objet**, et non une table séparée : les révisions, l'atelier d'images (`event:<événement>/<objet>`) et « Pourquoi cet objet ? » fonctionnent tels quels sur une proposition.
- **Tout ajout via « ＋ Ajouter un souvenir » sur un événement enregistré est une proposition**, même en brouillon, pour garder une seule règle. Seul un événement neuf, pas encore enregistré, reçoit directement ses objets.
- **Publier une proposition ne publie pas son image.** « Publier les images » reste une action séparée, comme pour #65.
- L'objectif éditorial **ne change pas le niveau technique** du bandeau (vert si planifié). Il apparaît en texte (« Contenu à compléter ») et en pastille séparée.
- Les 5 dates de référence suggérées pour les fiches existantes (charbon 06/12, guirlande 01/12, boule à neige 21/12, clochette 23/12, carte du traîneau 24/12) **ne sont pas appliquées**, puisque ces fiches sont planifiées et figées.

## 7. Décisions demandées au propriétaire

1. **Les 26 propositions et leur barème.** Faut-il les publier telles quelles, avec le barème aligné sur novembre (0,25 / 0,15 / 0,08 / 0,05 % dès 10 m / 0,03 % dès 20 m) ? Les options sont :
   - corriger ou retirer certaines fiches avant publication ;
   - tout publier d'un coup (cocher puis « Publier les propositions cochées ») ;
   - me demander de le faire sur décision écrite.

   *Recommandé : relire les noms, puis publier avant le 24/11, date de l'annonce J-7.*
2. **Barème des 5 objets déjà planifiés** (question déjà en attente). Faut-il garder 0,8 / 0,4 / 0,25 / 3 % coffres / 0,05 %, ou les aligner sur novembre ? Les aligner demande de repasser Noël en brouillon (aucun drop n'est en cours avant le 01/12), puis de le replanifier. *Recommandé : aligner, pour que le mois soit cohérent.*
3. **Dates de référence des 5 fiches existantes** : faut-il appliquer celles que je suggère (01, 06, 21, 23 et 24/12) en même temps que le point 2 ? *Recommandé : oui.*
4. Questions déjà en attente, inchangées :
   - assistant IA du panel : *recommandé, après la bêta* ;
   - thèmes 2027 : à choisir mois par mois, au plus tard à J-14.

## 8. Restant à réaliser

- Validation des 26 propositions, puis publication (par le propriétaire).
- « Pourquoi cet objet ? » vérifié pour Noël, avec des sources réelles.
- Images (atelier, sans génération automatique).
- Modèle de bonus par souvenir : #81, inactif.
- Doubles et échanges : #93.

---

# Mise à jour du 08/11/2026, ~16 h 15 (Bruxelles) — transition mensuelle automatique, préparation du mois prochain, novembre et Noël planifiés

Ticket : [#56](https://github.com/ReC82/Dig/issues/56). Demandes prises en compte : [priorité du 08/11 09:37](https://github.com/ReC82/Dig/issues/56#issuecomment-6719899927), [rectificatif du 08/11 09:57](https://github.com/ReC82/Dig/issues/56#issuecomment-6720078513) et [décision du 08/11 13:59](https://github.com/ReC82/Dig/issues/56#issuecomment-6722406304) (heures explicites, publication sans clic admin). Coordination [#86](https://github.com/ReC82/Dig/issues/86) : feu vert et barème de novembre ([commentaire du 08/11 09:49](https://github.com/ReC82/Dig/issues/86#issuecomment-6720004334), [décision du 08/11 13:59](https://github.com/ReC82/Dig/issues/86#issuecomment-6722405932)).

## 1. État réel

**Déployé en production (SHA `fdf90ee`) — en attente de recette.**

- « 🏛️ Novembre déterre l'Histoire » est **actif pour tous** depuis 16 h 10 (08/11), 30 objets. Vérifié en production : `/api/events` renvoie l'événement actif avec 30 objets.
- « 🎄 Noël sous la mine » est **planifié** : il démarrera seul le 01/12/2026 à 00 h 01.

Classement : **Bloquant bêta du 09/11** pour le lancement de novembre et la lisibilité ; **Après lancement** pour l'assistant IA.

## 2. Ce qui était déjà automatique dans #56, et ce qui manquait

**Déjà automatique (vérifié, pas réécrit)**
- Un événement planifié est actif dès que l'heure du serveur est dans ses bornes. Aucune tâche planifiée ni minuterie n'est en jeu. Un redémarrage, une absence du serveur ou un changement d'heure ne déclenchent donc rien deux fois et n'en ratent aucun.
- Pas de doublon : un objet par joueur (clé primaire).
- Pas de drop rétroactif : le minage d'avant le premier passage pendant l'événement ne compte pas.
- Pas de drop hors dates.
- Les souvenirs sont conservés à vie, même après la fin de l'événement.

**Ce qui manquait (fait dans ce lot)**
1. **Règle du mois civil entier.** Elle couvre du 1er à **00:01** (inclus) au 1er du mois suivant à **00:00** (exclu), heure de Bruxelles : `monthBounds()`.
   - Mois de 28, 29, 30 ou 31 jours, 2028 bissextile, heure d'été et d'hiver, changement d'année.
   - Une minute sans événement entre deux mois, jamais de chevauchement.
   - Dates écrites en clair, sans « minuit » : « du 1er décembre 2026 à 00 h 01 au 31 décembre 2026 à 23 h 59, heure de Bruxelles ».
2. **Calendrier annuel.**
   - Chaque mois propose le mois entier (avant : des fenêtres de 7 à 15 jours autour des fêtes). La fête du mois n'inspire plus que le thème.
   - Navigable par années (◀ ▶, 2024 à 2100), avec pour chaque mois : état, contenu (objets, images, traductions), échéance J-14 et un bouton direct.
3. **Tableau Admin → Événements « 🗓️ Préparation du mois prochain »** : trois cartes, mois précédent, en cours et suivant.
   - État explicite : **Absent / À compléter / Brouillon non planifié / Prêt — planifié / Actif / Terminé**.
   - Tâches bloquantes : aucun événement, 0 objet, textes obligatoires manquants, brouillon non planifié qui « ne démarrera pas tout seul »…
   - Avertissements non bloquants : images publiées x/n et « emoji affiché », images conservées mais non publiées, consignes d'image manquantes, traductions, dates qui ne couvrent pas le mois entier, chevauchements.
   - Rappels **J-14 / J-7 / J-1**, de plus en plus visibles.
   - Boutons directs : « Créer un événement » (brouillon public prérempli sur le mois entier, rien d'enregistré avant « Enregistrer »), « Ajouter les objets », « Ouvrir l'atelier d'images », « Vérifier / Planifier », « Arrêter / reporter… » (ouvre la fiche, où se trouve « Repasser en brouillon »).
4. **Indicateur d'accueil** en haut de toutes les rubriques, par exemple « 🎉 Événements — novembre 2026 : 🟢 Actif · décembre 2026 : ✅ Prêt — planifié ». Un clic mène au tableau. Il remplace la cloche ou le mail, puisque le SMTP n'est pas prêt.
5. **Aperçu d'un changement de mois**, en lecture seule. Il montre les événements actifs à 23:59:00, 23:59:59, 00:00:00, 00:00:30, 00:01:00 et 00:01:30. Un champ « Simuler l'heure » affiche l'état du tableau à n'importe quelle date sans rien modifier (`GET /api/admin/events/preparation?at=…`).
6. **Mois non préparé** : rien n'est inventé ni prolongé. Le tableau affiche « Aucun événement prévu pour … : le jeu reste jouable sans événement mensuel », avec le bouton « Créer un événement ».
7. **Décisions écrites du propriétaire appliquées une seule fois au démarrage** (`OWNER_DECISIONS` dans `server/monthlyEvents.js`, journal `owner_decision_*`). C'est le même mécanisme que les réglages #19 et #25 : le propriétaire n'a pas accès au panel et l'authentification n'est pas contournée.
   - Chaque décision passe par les mêmes contrôles que « Planifier » (fiche complète, période non terminée).
   - Elle n'agit que si la fiche est encore exactement celle relue (brouillon, même révision). Sinon, elle est ignorée et journalisée.
   - Elle n'est jamais rejouée : un « Repasser en brouillon » du propriétaire reste acquis après un redémarrage.
   - **Elle ne publie aucune image** : l'image de « La brique de la liberté », conservée dans la fiche, n'est pas montrée aux joueurs avant « Publier les images ».

Fichiers : `server/monthlyEvents.js`, `server/index.js` (deux routes en lecture seule, décisions au démarrage), `public/admin/{index.html,admin.js,admin.css}`, `test/monthly-events-transition.test.js` (nouveau, 6 tests), `test/monthly-events.test.js` (calendrier adapté à la règle du mois entier).

## 3. Statuts exacts en production (08/11 16:10, vérifiés en base)

| Événement | Statut | Bornes (UTC en base) | Heure de Bruxelles | Objets | Images joueurs |
|---|---|---|---|---|---|
| `novembre_histoire_2026` | planifié → **actif** (rév. 5) | 2026-10-31T23:01:00Z → 2026-11-30T23:00:00Z | 01/11 00:01 → 30/11 23:59 | 30 (barème #86 : 0,25 / 0,15 / 0,08 / 0,05 % dès 10 m / 0,03 % dès 20 m) | emoji (0 publiée) |
| `noel_2026` | **planifié** (rév. 3) | 2026-11-30T23:01:00Z → 2026-12-31T23:00:00Z | 01/12 00:01 → 31/12 23:59 | 5, barème de la fiche **inchangé** | emoji (0 publiée) |

- Aucun bonus ni micro-bonus activé : ceux de #81 et #86 restent en brouillon, et les événements n'en portent pas.
- Aucune trouvaille rétroactive : les premiers objets de novembre ne peuvent tomber que sur des blocs minés après 16 h 10 le 08/11.
- Annonce « Bientôt » de Noël automatique dans les Actualités à J-7 (24/11).

## 4. SHA et procédure de test

- Branche `feature/56-evenements-mensuels` : `7b33ffb`. **develop : `fdf90ee`** (= production).
- Tests : `node --test test/monthly-events-transition.test.js` (6/6).
  - Horloge 30/11 23:59:59 → 01/12 00:00:00 (aucun événement, aucun drop) → 00:01 (décembre seul).
  - 31/12 → 01/01, février 2028 avec son 29.
  - Bornes en heure d'été et d'hiver.
  - Janvier non prolongé en février.
  - Décisions : appliquées une seule fois, ignorées si la fiche a changé, si elle est incomplète, si le mois est terminé ou si l'événement est absent ; jamais rejouées après un « Repasser en brouillon ».
  - Souvenirs conservés après la fin.
  - Tableau : états, J-14/J-7/J-1, lecture seule.
  - Calendrier 2026 à 2028.
- `npm test` complet sur le SHA de release `fdf90ee` : **955/955**.

## 5. Vérifications, limites, données joueurs

- Copie de la base de production démarrée (port 3122) : les deux décisions s'appliquent ; empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** ; `quick_check` ok. Seules des lignes d'événements, de révisions et de journal sont ajoutées.
- Navigateur, ordinateur 1280×900 et téléphone 390×844 (copie de la base) : bandeau, trois cartes, simulation au 01/12 00:00, calendrier 2028 (février 29 jours). Seule erreur de console : le 401 normal avant connexion.
- Limites :
  - l'assistant IA demandé dans le rectificatif (« Proposer un autre thème / Améliorer / Proposer des objets », contraintes libres) **n'est pas fait** (voir §9) ;
  - la fiche joueur « Pourquoi cet objet ? » relève de #86 ;
  - il n'y a pas de cloche admin persistante : le bandeau d'accueil en tient lieu.

## 6. Déploiement

- Déployé `fdf90ee` le 08/11 à 16 h 10, par avance rapide de `main` (55240ce → fdf90ee) et `scripts/deploy.sh` de la release.
- Sauvegarde vérifiée : `~/backups/dig/dig-20261108-161003-pre-deploy-fdf90ee.sqlite`.
- Après déploiement :
  - dig.lodygames.com et dig.lodylands.com répondent 200, version `1.0.0+fdf90ee` ;
  - journal sans erreur, avec les deux lignes « Décision … planifié » ;
  - `quick_check` ok ; empreintes joueurs identiques à la sauvegarde.
- Retour arrière :
  - pour un événement, Admin → Événements → fiche → « Repasser en brouillon » : les drops s'arrêtent aussitôt, les objets trouvés restent ;
  - pour le code, revenir à `55240ce` (procédure habituelle), ce qui ne repasse pas les événements en brouillon.

**Test fonctionnel à faire par le propriétaire (≈ 3 min)**
1. /admin/ (Ctrl+F5) → bandeau du haut « 🎉 Événements — novembre 2026 : 🟢 Actif (Novembre déterre l'Histoire) · décembre 2026 : ✅ Prêt — planifié (Noël sous la mine) ».
2. Clic sur le bandeau → « Préparation du mois prochain » : novembre Actif, 30/30 objets, 🖼 0/30 publiées (+1 en fiche) ; décembre Prêt — planifié, 5/5.
3. Déplier « ⏱ Aperçu d'un changement de mois » :
   - 30/11 23:59:59 = Novembre ;
   - 01/12 00:00:00 et 00:00:30 = aucun ;
   - 01/12 00:01 = Noël.
   Saisir `30/12/2026 12:00` → « Voir l'état » : « Aucun événement prévu pour janvier 2027 : le jeu reste jouable… ».
4. « 📅 Calendrier annuel » ▶ ▶ 2028 : février « 29 jours », 01/02/2028 00:01 → 01/03/2028 00:00.
5. Jeu → Collection → Événements : « Novembre déterre l'Histoire » en cours, 30 « ? ». Miner un moment : un souvenir peut tomber.

## 7. Choix techniques faits seul

- **Planification par décision au démarrage plutôt qu'une écriture directe en base.** Les règles interdisent d'écrire dans la base de production hors `deploy.sh`. Ce mécanisme existe déjà (#19, #25), il est journalisé, idempotent et respecte toute modification ultérieure du propriétaire.
- **Novembre planifié dans ce ticket**, bien que la publication relève de #86. La décision du 08/11 13:59 sur #56 dit « Publication novembre immédiate autorisée… Respecter cette nouvelle décision en priorité P0 », et la bêta est lundi. La décision étant liée à la révision 3, une nouvelle exécution de #86 ne peut rien dupliquer.
- **Images non publiées par la décision** : le propriétaire avait demandé de ne pas toucher à la proposition « La brique de la liberté ».
- **Barème de Noël inchangé** : la décision interdit les « drops arbitraires ». Diviser par 2 était une recommandation jamais validée (question 1).
- **Pas de règle « mois entier » imposée** à la création : les événements TEST et courts spéciaux restent possibles. Un événement public qui ne couvre pas le mois entier reçoit seulement un avertissement.

## 8. Décisions demandées au propriétaire

1. **Barème de Noël (avant le 30/11)** : a) garder la fiche actuelle, qui est en ligne et planifiée (commun 0,8 % minerai, peu commun 0,4 % dès 10 m, rare 0,25 % pierre dès 25 m, épique 3 % coffres dès 40 m, légendaire 0,05 % dès 80 m) ; b) aligner sur l'échelle de novembre (0,25 / 0,15 / 0,08 / 0,05 / 0,03 %). **Recommandation : b)** pour la cohérence entre les mois. Pour le faire : fiche → Repasser en brouillon → modifier → Planifier. Il reste 23 jours.
2. **Assistant IA du panel** (« Proposer un autre thème », « Améliorer », « Proposer des objets », champ de contraintes) : faut-il le développer maintenant, avec un appel IA par clic dans le budget du panel, ou après la bêta ? **Recommandation : après la bêta** ; l'outil IA existant (« ✨ IA ») couvre déjà une proposition complète en brouillon.
3. **Thèmes 2027** : le calendrier affiche désormais chaque mois entier avec sa fête d'inspiration. Il reste à choisir les thèmes, au plus tard à J-14 de chaque mois.

## 9. Restant à réaliser

- Assistant IA (question 2), avec tests IA simulés sans dépense.
- Publication des images définitives de novembre et de Noël : action « Publier les images » du propriétaire, après génération dans l'atelier.
- #86 : fiche joueur « Pourquoi cet objet ? » et confirmation de publication lisible (hors de ce ticket).

---

# Mise à jour du 05/11/2026, ~17 h (Bruxelles) — tests automatiques manquants (priorisation du propriétaire)

Ticket : [#56](https://github.com/ReC82/Dig/issues/56). Demande prise en compte : [priorisation du 05/11](https://github.com/ReC82/Dig/issues/56#issuecomment-6661250025). Elle demande de continuer uniquement le câblage technique et les tests automatiques manquants (activation par dates, drops, conservation des souvenirs, traduction et rendu joueur), en environnement de test. Elle interdit de publier un événement, de toucher aux taux ou aux récompenses, et de générer des images payantes. Les recettes #56-H et #56-I ne sont pas à refaire.

## 1. État réel

**Intégré dans develop — non déployé.** La raison : seul un fichier de tests est ajouté. Aucun code exécuté par le serveur ou le navigateur n'a changé, donc un redémarrage de la production n'apporterait rien. Il partira avec le prochain déploiement ordinaire. La production reste en `1.0.0+922e21d`, qui contient déjà tout le #56 livré. Classement : **Après lancement**.

Rien n'a été publié ni modifié en production : Noël 2026 reste en **brouillon**, et aucun taux, aucune récompense, aucune traduction ni aucune image n'a été touché. Aucun appel IA n'a été fait.

## 2. Résultat et changements

Nouveau fichier `test/monthly-events-coverage.test.js` (10 tests). Il utilise une base temporaire hors de `server/data/` et exécute le vrai code du serveur et du panneau joueur. Le câblage existant n'avait pas d'anomalie : **aucun correctif de code n'a été nécessaire.**

- **Activation par les dates seules** (sans tâche planifiée) :
  - planifié → actif **à la milliseconde du début** (début inclus) → terminé **à la fin** (fin exclue) ;
  - l'invité voit un événement public actif, sans aucun objet révélé ;
  - « Bientôt » apparaît à **J-7 exactement** (rien à J-7 moins 1 ms), puis bascule dans « en cours » au début ; les objets désactivés ne sont pas comptés ;
  - le minage fait **avant le début ne compte jamais** : aucun curseur n'est créé avant le début, et la première sauvegarde pendant l'événement sert de référence.
- **Drops** :
  - événement public : drops pour tout compte connecté ;
  - borne de **probabilité** : 3 blocs à 10 % donnent 1 − 0,9³ = 27,1 %. Un tirage juste en dessous trouve l'objet, un tirage juste au-dessus le manque ;
  - borne de **profondeur** : 29 m < 30 m exclut l'objet, 30 m l'inclut ;
  - un objet **désactivé** ne tombe jamais ;
  - le **barème de la fiche est inchangé** après les tirages ;
  - un testeur dont le compte a **disparu** perd l'événement TEST mais garde le public ;
  - **deux événements simultanés** ont des curseurs indépendants (catégorie pierre pour l'un, coffre pour l'autre).
- **Noël 2026 de bout en bout, en base de TEST uniquement** : le vrai fichier préparé est importé (brouillon), puis planifié **dans la base temporaire seulement**. Résultats :
  - planifié le 30/11 à 23:59:59 (Bruxelles), actif le 1/12 à 00:00, terminé le 1/1 à 00:00, annoncé le 25/11 ;
  - à 31 m, avec du charbon, de la pierre et un coffre : la clochette (pierre, ≥ 25 m), la guirlande (≥ 10 m) et le charbon (minerai) tombent. La boule à neige (≥ 40 m) et la carte du traîneau (≥ 80 m) ne tombent pas ;
  - après la fin, plus aucun objet ne tombe et les trois restent en souvenirs ;
  - le barème est identique au fichier préparé.
- **Souvenirs** :
  - le **reset complet #75** les archive dans l'instantané ; le nouvel essai repart d'une référence vierge ;
  - la **restauration** les rend à l'identique, sans second exemplaire ;
  - un objet trouvé puis désactivé reste visible, tandis qu'un objet non trouvé et désactivé est masqué ;
  - après la fin, l'objet reste en souvenir, traduit dans les 4 langues, avec l'emoji tant qu'aucune image n'est publiée.
- **Traduction et rendu joueur** : le vrai panneau « 🎉 Événements » de `public/js/main.js` est exécuté avec `i18n.js` et la locale italienne générée :
  - FR/EN/NL/ES : nom de l'événement, accroche, compteur « 1 / 2 », « Souvenirs », « Bientôt » dans la langue ;
  - IT : textes du jeu en italien, contenu de l'événement en repli français (il n'existe qu'en 4 langues) ;
  - un objet non trouvé reste « ??? » : le serveur ne renvoie ni son nom, ni sa description, ni son icône ;
  - noms, souvenirs et adresse d'image sont **échappés** (guillemets, `<script>`, attribut `onerror`) ;
  - le panneau est masqué quand il n'y a rien à afficher ;
  - les 11 textes `events.*` existent en propre en FR, EN, NL, ES et IT.
- **Contrôle par mutation** (code cassé volontairement, puis remis en état) : début exclu → 3 échecs ; objet désactivé ou profondeur mal bornée → 1 échec ; nom non échappé → 1 échec ; langue ignorée → 1 échec ; souvenirs absents du reset #75 → 1 échec. L'unicité d'un objet est déjà protégée deux fois (objet déjà possédé + `INSERT OR IGNORE`) et couverte par `test/monthly-events.test.js`.

## 3. SHA et procédure de test

- Branche `feature/56-evenements-mensuels` (`69ae99a`). **SHA sur develop : `5d5b654`** (merge `--no-ff`).
- `node --test test/monthly-events-coverage.test.js` → 10/10. `npm test` complet sur la branche : **782/782**.

## 4. Vérifications, limites, données

- Tests : `npm test` **782/782** sur la branche et sur develop `5d5b654` après fusion.
- Aucune migration. Aucune donnée joueur lue ou écrite hors base temporaire. Seule une lecture `-readonly` de la base de production a été faite, pour préparer le test ci-dessous : il reste 3 souvenirs de l'ancien événement TEST sur le compte `testeur`, et Noël est en brouillon.
- **Limite** : ces tests ne remplacent pas un essai en jeu sur un événement public réel. Ce dernier reste soumis aux décisions sur le barème et les dates de Noël.

## 5. Déploiement et test à faire par le propriétaire

Non déployé, car seuls des tests ont été ajoutés. **Test joueur concret sur ce qui est DÉJÀ en production** (aucun formulaire admin, environ 3 min) :
1. Sur le jeu, connectez-vous avec le compte `testeur`, puis ouvrez **Collection**. **Attendu** : la section « 🎉 Événements » montre « Souvenirs d'événements », avec « 🧪 Événement test · 3 » et ses 3 objets (🔩 Boulon, 🪨 Caillou, 🎟️ Ticket de test).
2. Touchez un objet. **Attendu** : la fiche s'ouvre avec « Terminé le 5 novembre 2026 », et « Trouvé le 3 novembre 2026 » (caillou) ou « Trouvé le 5 novembre 2026 » (boulon, ticket : trouvés à 0 h 32, heure de Bruxelles).
3. Passez la langue en EN, NL puis ES. **Attendu** : « Test bolt », « Testbout », « Tornillo de prueba », etc., et des libellés traduits.
4. Faites F5. **Attendu** : les souvenirs sont toujours là. Avec un autre compte sans trouvaille (ex. `lody`) : aucune section Événements.

## 6. Choix techniques faits seul

- Les tests sont regroupés dans un fichier séparé, pour garder lisible `test/monthly-events.test.js` (19 tests). Chaque test utilise des années distinctes (2031–2037) pour éviter tout recouvrement de dates entre événements.
- Rendu joueur testé par exécution en `vm` des fonctions réelles extraites de `main.js` (méthode déjà utilisée par `test/block-resume.test.js`), sans navigateur ni dépendance ajoutée.
- Pas de nouveau « drapeau » : sans événement planifié, aucun drop n'est possible. C'est le cas en production, où Noël est en brouillon et le seul événement TEST est terminé. Le drapeau est donc OFF de fait.

## 7. Décisions demandées au propriétaire

Aucune nouvelle décision pour ce lot. Les questions en attente restent celles du premier incrément : barème de Noël (recommandé : diviser par 2 les 3 premiers objets), dates (recommandé : 1/12 → 1/1), planification avant le 24/11, thèmes 2027.

## 8. Restant à réaliser

- **Après lancement** :
  - planifier Noël après les décisions ci-dessus (rien ne sera publié sans elles) ;
  - illustrations (#65, génération payante non autorisée ici) ;
  - piste repérée, non implémentée : l'identifiant d'un objet non trouvé (ex. `noel26_carte_traineau`) est visible dans la réponse `/api/events`, ce qui peut donner un indice. On pourrait le remplacer par un identifiant opaque.

---

# Mise à jour du 04/11/2026, ~19 h (Bruxelles) — contraste des onglets de langue

Ticket : [#56](https://github.com/ReC82/Dig/issues/56). Retour pris en compte : [recette du 04/11](https://github.com/ReC82/Dig/issues/56#issuecomment-6630145253) (« OK mais pas très visible, noir sur gris foncé »). Les recettes du 04/11 valident aussi, sans rien modifier : statut TEST inactif, sélection du compte `testeur`, liste compacte et menu « + Ajouter » (#56-H), fiche d'objet (#56-I). Ces contrôles ne sont plus à refaire.

## 1. État réel

**Déployé en production (SHA `0afba02`) — en attente de recette.** Classement : **Après lancement** (confort de l'admin). Aucun événement, aucune traduction et aucune donnée n'ont été modifiés.

## 2. Résultat et changements

- **Cause** : le style commun des onglets de langue (`.co-lang-btn`) ne fixait aucune couleur de texte. Or un bouton n'hérite pas de la couleur de la page : le navigateur l'affichait en noir sur le fond sombre. Ce style sert à **six formulaires** : Événements (fiche et fiche d'objet), Boutique, Blocs, Collections (objets), Badges et Actualités. Le défaut était donc présent partout où aucun état coloré n'était appliqué.
- **Correctif** (`public/admin/admin.css`) :
  - onglet inactif : texte clair `#e8e8e8` sur fond `#242424`, avec un contour gris visible (contraste 13,4:1) ;
  - les états de complétude gardent leur code couleur, et leur contour n'est plus écrasé par la règle de base : vert = complet, ambre = partiel, gris clair `#b8b8b8` = à traduire (≥ 4,5:1 dans tous les cas) ;
  - onglet actif : fond or, texte foncé, en plus gras, avec un liseré ;
  - au survol, le fond s'éclaircit et le contour passe en or ;
  - focus clavier : contour blanc de 2 px, différent de l'or de l'onglet actif.
- **Événements** (`public/admin/admin.js`, `evLangTabs`) : les onglets portent maintenant l'état de complétude (vert si nom et accroche, ou nom et description, sont remplis). Les indicateurs `✓` / `·` sont conservés.
- **Test** `test/admin-lang-tabs-contrast.test.js` : il calcule le contraste WCAG de chaque état (inactif, survol, actif), vérifie l'ordre des règles et contrôle le marquage des onglets d'Événements.

## 3. SHA et procédure de test

- Branche `feature/56-evenements-mensuels`, commit `cfa7670`. Intégré dans `develop` par `0afba02`, puis déployé.
- `node --test test/admin-lang-tabs-contrast.test.js` → 4/4. `npm test` → 640/640.

## 4. Vérifications, limites, données

- Chromium sur une copie de la base de production (port 3101), en 1280 px et 390 px. Le brouillon Noël a été ouvert, ainsi qu'une fiche d'objet ; les captures montrent les onglets EN/NL/ES lisibles en vert, et FR actif en or. Sur les six formulaires, les couleurs calculées sont : texte `rgb(232,232,232)` sur `rgb(36,36,36)` à l'état inactif, `#111` sur or à l'état actif. 0 erreur JS, 0 boîte native, rien enregistré.
- Aucune donnée touchée : seuls un fichier CSS et une classe ajoutée dans le JS de l'admin changent.

## 5. Déploiement

- Release `0afba02` : `npm ci` + `npm test` 640/640. Sur la copie de prod en mode production (port 3122), `/health` et `/api/version` répondent bien, et les empreintes des 6 tables sont identiques avant et après le démarrage. Aucune génération IA n'était en cours. Copie supprimée.
- `main` avancé en avance rapide `0b990a1 → 0afba02`. `deploy.sh` : sauvegarde vérifiée `~/backups/dig/dig-20261104-185133-pre-deploy-0afba02.sqlite`, santé et version OK.
- Après le déploiement : les 2 domaines répondent 200 avec `1.0.0+0afba02`, et le nouveau CSS est bien servi. Le journal ne contient aucun avertissement, `quick_check` = ok, et les empreintes de prod sont identiques à la sauvegarde. Le jeu et la page admin se chargent sans erreur JS en 1280 px et 390 px.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 0b990a1` + `sudo systemctl restart dig` (aucune migration, lock inchangé).

**Test à faire par le propriétaire** (lecture seule, ne rien enregistrer) :
1. Faire Ctrl+F5 sur Admin → 🎉 Événements, puis ouvrir « Noël sous la mine ».
2. Vérifier que FR est en or (texte foncé) et que EN/NL/ES sont lisibles (texte vert clair `EN ✓`, avec contour) ; au survol, le contour devient or.
3. Optionnel : ouvrir un objet de Noël, puis un formulaire de Boutique, Badges ou Collections, et vérifier que les onglets de langue y sont aussi lisibles.

## 6. Choix techniques faits seul

- Correctif appliqué au style commun plutôt qu'au seul formulaire Événements : tous les formulaires concernés sont corrigés en une fois, sans toucher à leurs données ni à leurs traductions.
- Focus en blanc et non en or, pour qu'on ne le confonde pas avec l'onglet actif.

## 7. Décisions demandées au propriétaire

Aucune nouvelle décision pour ce correctif. Les questions du premier incrément restent ouvertes : barème de Noël (recommandé : diviser par 2 les 3 premiers objets), dates (recommandé : 1/12 → 1/1), planification avant le 24/11, thèmes 2027.

## 8. Restant à réaliser

- **Après lancement** : images souvenirs des objets (#65) ; illustrations de Noël ; aperçu joueur de l'événement entier.

---

# Mise à jour du 03/11/2026, ~19 h 30 (Bruxelles) — recettes #56-B à #56-G : refonte de l'admin

Ticket : [#56](https://github.com/ReC82/Dig/issues/56). Retours pris en compte : [#56-B](https://github.com/ReC82/Dig/issues/56#issuecomment-6600449019) (sélecteur de testeurs), [#56-C](https://github.com/ReC82/Dig/issues/56#issuecomment-6600513799) (refonte de la fiche, dates), [#56-D](https://github.com/ReC82/Dig/issues/56#issuecomment-6600600171) (confirmation native). #56-E, #56-F et #56-G **valident** le cycle complet en production : découverte réelle, persistance après F5, compteur admin, arrêt, souvenir conservé.

## 1. État réel

**Déployé en production (SHA `db38cc0`) — en attente de recette.** Classement : **Après lancement**. Aucun événement n'a été modifié ni planifié en production. Noël reste en brouillon. L'événement `test_2611030949` reste en brouillon, et ses testeurs restent au format d'origine tant qu'aucune action admin ne l'enregistre.

## 2. Résultat et changements

Fichiers : `server/monthlyEvents.js`, `server/index.js`, `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`, `test/monthly-events.test.js`.

**Testeurs (#56-B)**
- Le champ libre est remplacé par un **sélecteur**. On tape une partie du pseudo et la liste propose « pseudo · ID » (jamais l'e-mail). Il marche au clavier (↑/↓, Entrée, Échap) et au tactile.
- On peut choisir plusieurs testeurs. Chacun s'affiche en pastille, avec un ✕ pour le retirer.
- La liste affiche « Aucun pseudo ne contient… » quand rien ne correspond. Si l'admin tape un pseudo sans le choisir dans la liste, il est averti tout de suite.
- **Comptes proposés d'un clic** : les inscrits de la bêta (#57), dont `testeur`, et les testeurs déjà utilisés.
- **Stockage par ID stable** : `[{id, username}]`. Le serveur contrôle l'accès par ID, donc un renommage ne coupe pas l'accès. Un compte inconnu est refusé (400).
- **Compatibilité** : les anciens événements (`["testeur"]`) restent lisibles et le pseudo est résolu à la lecture, sans réécriture. Un pseudo introuvable bloque la planification, avec un message clair.

**Fiche (#56-C)**
- **Liste compacte** : état et audience en pastilles, dates JJ/MM/AAAA HH:mm, miniatures des objets, trouvailles. Les avertissements sont regroupés (« ⚠ 5 illustration(s) absente(s) »). Un clic (ou Entrée) sur une ligne ouvre la fiche.
- **Fiche modale** avec cinq blocs :
  - Identité, avec onglets FR/EN/NL/ES et une pastille ✓ par langue complète ;
  - Calendrier : JJ/MM/AAAA + HH:mm, heure de Bruxelles, durée et temps restant affichés, date inexistante refusée ;
  - Public, avec le sélecteur de testeurs ;
  - Objets en sous-liste compacte ;
  - Simulateur, replié par défaut.
- Les actions sont séparées dans une barre fixe : *Enregistrer le brouillon* / *Planifier…* / *Démarrer le test maintenant…* / *Repasser en brouillon…* / *Révisions*.
- **Fiche objet distincte** :
  - une langue à la fois, avec un **aperçu joueur** ;
  - catégories en grille, avec des libellés cliquables et l'aide « aucune case = tous les blocs » ;
  - le taux est traduit en exemple (« 1 chance sur N, X % en 100 blocs ») ;
  - illustration : URL ou téléversement, plus la consigne d'illustration.
- **Saisies non enregistrées** : une confirmation Dig apparaît avant de fermer la fiche ou l'objet (✕, Échap, fond, rechargement de la page).
- **« ＋ Ajouter »** propose trois choix : Événement manuel / Événement TEST / Avec l'IA. Ces formulaires ne sont plus affichés en permanence. Le calendrier et le journal sont repliés.

**Confirmations (#56-D)**
- Plus aucun `confirm()` dans l'onglet. Chaque confirmation est une boîte Dig qui détaille l'audience, les dates, les objets (taux et sources) et les conséquences, avec Annuler / Confirmer.
- Un événement public demande toujours deux confirmations.

**Période avant planification (#56-C)**
- Côté serveur, une période **terminée** est refusée (`expired`).
- Une période **déjà commencée** n'est planifiée qu'avec une confirmation explicite qui indique le temps restant (`confirmElapsed`, code `elapsed`).
- **« Démarrer le test maintenant pour N min »** (TEST en brouillon uniquement) recale les dates et planifie dans une seule transaction. L'audience TEST est conservée et les anciennes dates restent dans la révision précédente et dans le journal. Les dates ne changent jamais en silence.
- Le brouillon TEST créé par « ＋ Ajouter » s'ouvre directement sur sa fiche, prêt à être démarré.

## 3. SHA et procédure de test

Branche `feature/56-evenements-mensuels`, commit `7f163b5`, develop `db38cc0`.
- `npm test` : 563/563 sur develop `db38cc0` et sur la release (18 tests dans `test/monthly-events.test.js`, dont 3 nouveaux : testeurs par ID et ancien format, période expirée ou entamée et « Démarrer maintenant », suggestions sans donnée privée ; plus la route HTTP `start-now`).
- Copie de la base de production (port 3101, supprimée ensuite), Chromium 1280×900 et 390×844, 0 erreur JS, **0 boîte native**. Scénarios déroulés :
  - liste ;
  - fiche de l'ancien événement TEST : `testeur · ID 2` résolu ;
  - recherche « tes » → `testeur · ID 2` ; « zzz » → message ;
  - fiche objet en NL, modification puis Échap → confirmation Dig ;
  - « Planifier » sur la période expirée → message qui renvoie vers « Démarrer maintenant » ;
  - « ＋ Ajouter → TEST » : testeur proposé ajouté d'un clic → brouillon → « Démarrer pour 30 min » → 🟢 Actif → « Repasser en brouillon » → 📝 ;
  - date 31/02 refusée ;
  - fiche manuelle modifiée puis fermée → confirmation Dig.

## 4. Vérifications, limites, données

- **Données** : aucune migration (colonne `testers` existante, format JSON enrichi). Aucune donnée joueur touchée. Les anciennes lignes ne sont réécrites que lors d'une action admin.
- **Limites** :
  - la recherche est limitée à 10 résultats (sans pagination) : il suffit de préciser le pseudo ;
  - le bouton « Rafraîchir » reste sans retour visuel (#60) ;
  - la largeur commune du panel relève de #62 ;
  - l'atelier d'images pour les objets d'événement n'est toujours pas branché (#40).
- **Non vérifié** (recette #56-G) : l'absence de drop pour un compte non autorisé et l'unicité sur un long minage, en jeu. Les tests automatiques couvrent ces deux cas (`activeFor` d'un compte non testeur = vide, `INSERT OR IGNORE`).

## 5. Déploiement

- **Déployé `db38cc0`** : avance rapide de `main` `c04748e` → `db38cc0` (5 commits, sans `npm ci`), avec `scripts/deploy.sh` de la release. Sauvegarde vérifiée : `dig-20261103-192052-pre-deploy-db38cc0.sqlite`.
- **Avant** :
  - aucune génération IA en cours (dernier appel de l'atelier à 17:16 UTC, aucune proposition d'événement en attente) ;
  - release : `npm test` 563/563 ;
  - copie de la base de production en mode production (port 3122) : santé, version et `/api/events` OK ; empreintes des 6 tables joueurs identiques avant et après le démarrage ; événements intacts (`["testeur"]` non réécrit) ; copie supprimée.
- **Après** :
  - dig.lodygames.com et dig.lodylands.com → 200, version `1.0.0+db38cc0` ;
  - `/api/admin/events` sans clé → 401 ;
  - journal sans erreur ; `quick_check` ok ;
  - empreintes des 6 tables joueurs **identiques** à la sauvegarde pré-déploiement ;
  - Chromium 1280 et 390, jeu et page admin : 0 erreur JS.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep c04748e` puis `sudo systemctl restart dig`. Aucune donnée n'est à restaurer : le format des testeurs reste lisible par l'ancienne version, à une exception près. Un événement enregistré après ce déploiement porte des testeurs au format `{id}`, que l'ancienne version ne reconnaîtrait pas. Elle ne lui afficherait alors aucun testeur, sans perte de données.

### Test fonctionnel à faire par le propriétaire (5 min)
1. Admin (Ctrl+F5) → 🎉 Événements. **Attendu** : liste compacte, une ligne par événement, « ⚠ 5 illustration(s) absente(s) » regroupé sur Noël. Le calendrier et le journal sont repliés.
2. Cliquez sur la ligne `test_2611030949`. **Attendu** : la fiche s'ouvre en fenêtre, avec la pastille « testeur · ID 2 », des dates en 03/11/2026 10:49 et les 3 objets en lignes compactes. Cliquez sur un objet : fiche séparée, onglets FR/EN/NL/ES, aperçu joueur. Fermez sans rien changer.
3. « Planifier… » sur cet ancien test. **Attendu** : message « Période expirée : utilisez « Démarrer le test maintenant » » (aucune popup du navigateur).
4. « ＋ Ajouter → 🧪 Événement TEST ». Cliquez sur « ＋ testeur » dans « Proposés », ou tapez « tes » et choisissez dans la liste. Mettez 30 min, puis « Créer le brouillon TEST ». **Attendu** : la fiche du nouveau brouillon s'ouvre.
5. Facultatif : « ▶ Démarrer le test maintenant… » → la boîte Dig liste l'audience, les dates (maintenant → +30 min) et les 3 objets → Confirmer → 🟢 Actif. En jeu avec `testeur` : drops ; avec un autre compte (`lody`) : aucun objet. Puis « ⏸ Repasser en brouillon… ».

## 6. Choix techniques faits seul

- **Format `[{id, username}]`** : l'ID fait foi et le pseudo n'est qu'un repère lisible, mis à jour à la lecture. Les anciens pseudos sont lus sans migration, pour aucun risque sur la base.
- **Suggestions = bêta + testeurs déjà utilisés** : la demande parle de « comptes de bêta déjà inscrits ». Les autres comptes restent accessibles par la recherche.
- **Planification d'une période entamée** : autorisée seulement avec une confirmation explicite. Bloquer totalement gênerait un public qu'on lance en retard, et ne rien dire créerait des tests trop courts sans prévenir.
- **« Démarrer maintenant » réservé au TEST** : un événement public garde des dates choisies et annoncées (#50).
- Champs date et heure en texte JJ/MM/AAAA + HH:mm plutôt que `datetime-local`, dont le format dépend de la langue du navigateur.

## 7. Décisions demandées au propriétaire

Les questions du premier incrément restent ouvertes (voir plus bas) : barème de Noël (recommandé : diviser par 2 les 3 premiers objets), dates (recommandé : 1/12 → 1/1), planification avant le 24/11, thèmes 2027. Aucune nouvelle décision n'est nécessaire pour cette refonte.

## 8. Restant à réaliser

- **Après lancement** :
  - illustrations de Noël et branchement dans l'atelier #40 ;
  - pagination de la recherche de comptes si la base grossit ;
  - aperçu joueur de l'événement entier ;
  - harmonisation du bouton Rafraîchir (#60) et de la largeur (#62).

---

# Mise à jour du 03/11/2026, ~05 h 45 (Bruxelles) — premier incrément

Ticket : [#56](https://github.com/ReC82/Dig/issues/56).

## 1. État réel

**Déployé en production (SHA `0508d4f`) — en attente de recette.** Classement : **Après lancement** (aucun effet visible des joueurs tant qu'aucun événement n'est planifié).

- **Rien n'est publié** : Noël 2026 est importé en **brouillon** dans la production (statut « Brouillon », public visé mais non planifié). Aucun événement de test n'a été créé en production. L'économie active n'a pas changé : un objet d'événement ne donne ni pièces, ni gemmes, ni points.

## 2. Résultat et changements

Fichiers : `server/monthlyEvents.js` (nouveau), `server/content/events/noel-2026.json` (nouveau), `server/index.js`, `server/badges.js` (export d'une lecture), `server/news.js`, `public/js/main.js`, `public/js/i18n.js`, `public/index.html`, `public/admin/index.html`, `public/admin/admin.js`, `test/monthly-events.test.js` (nouveau).

### Audit des briques réutilisées (étape 1 du ticket)
- **Minage validé** : les compteurs `blocks:<type>` des badges (#38), crédités seulement dans la limite de la profondeur retenue par le serveur (#9/#25). C'est la base des drops d'événement, au lieu des drops de collection (#39) qui sont tirés par le navigateur.
- **IA** : `blockAi.guardedJson` (#37) — clé côté serveur, quota, plafond, journal.
- **Annonces** : centre d'actualités (#50), mêmes annonces automatiques que les saisons.
- **Images** : téléversement admin des collections (#39), URL acceptées aussi depuis l'atelier (`/media/icons/…`, #40).
- **Collections (#39) et saisons (#48)** : *non* réutilisées pour le modèle. Une série de collection est rattachée à une saison hebdomadaire et tirée côté client ; l'événement mensuel a ses propres dates et son propre stockage, pour une séparation nette événement ≠ saison.

### Modèle
- **Événement** : identifiant, icône, noms et accroches FR/EN/NL/ES, début/fin saisis en **heure de Bruxelles** (stockés en UTC, changement d'heure géré), **public** ou **TEST** (réservé à une liste de pseudos). États : brouillon → planifié → actif → terminé.
- **Objets** : icône, image facultative, consigne d'illustration, nom et description humoristique en 4 langues, rareté, **chance en % par bloc éligible**, profondeur minimale, catégories de blocs (terre, pierre, minerai, coffre, gemme ; aucune = toutes), activé.
- **Révisions** : chaque enregistrement crée une révision restaurable (en brouillon), plus un journal.

### Drops (serveur uniquement)
À chaque sauvegarde acceptée, juste après le crédit des badges : pour chaque événement actif visible du joueur, le serveur prend les **blocs validés minés depuis le dernier passage**, filtre par catégorie et profondeur, et tire avec `crypto`. Garde-fous :
- premier passage pendant l'événement = référence (la progression d'avant ne compte pas) ;
- **un exemplaire par joueur et par objet** (clé primaire, `INSERT OR IGNORE` : ni doublon, ni rejeu, y compris requêtes simultanées ou redémarrage) ;
- plus de 2 000 blocs d'un coup : aucun tirage (journal `skip_burst`) ;
- compteurs déclarés gonflés sans profondeur validée : rien.

### Conservation
Les trouvailles sont dans une table séparée, **jamais touchée par les saisons**. Après la fin de l'événement, ou s'il repasse en brouillon, elles restent dans « Souvenirs d'événements ». Un objet déjà trouvé ne peut plus être retiré de la fiche (seulement désactivé).

### Jeu
Vue **Collection**, nouveau bloc « 🎉 Événements » (masqué s'il n'y a rien) :
- événement en cours, avec dates, mention TEST, objets trouvés ou « ? » ;
- « Bientôt » pour un événement public qui commence dans 7 jours ;
- souvenirs des événements passés.

Une notification s'affiche à la trouvaille (historisée comme les autres, #26).

### Admin → 🎉 Événements
- **Liste** : état, public/TEST, dates de Bruxelles, objets, joueurs et trouvailles, manques bloquants et avertissements.
- **Fiche** : textes 4 langues, objets, téléversement d'image, **simulation** (part des blocs éligibles à une profondeur, chance réelle par bloc, blocs nécessaires, chance de l'obtenir sur la durée).
- **Planifier** : refusé si la fiche est incomplète. Un événement public exige **deux confirmations** (barème validé, publication validée par le propriétaire).
- **Repasser en brouillon** : arrête les drops aussitôt. **Révisions** : restauration.
- **🧪 Événement TEST** : gabarit de 3 objets à probabilités fortes (25 % tout bloc, 10 % pierre/minerai, 40 % coffre), pour les pseudos donnés, durée réglable. Créé en brouillon.
- **✨ IA** : thème → événement **TEST en brouillon** (noms, descriptions, consignes d'image, barème par défaut selon la rareté). Un appel texte, dans le budget IA existant.
- **📅 Calendrier** (année en cours et suivante) : une proposition par mois.
  - Fêtes calculées : Nouvel An, carnaval (Mardi gras), Nouvel An chinois, Saint-Valentin, Pâques, poisson d'avril, fête de la musique, fête nationale, rentrée, Halloween, Saint-Nicolas, Noël.
  - Mois sans fête : **idées à valider**, jamais imposées.
  - Dates suggérées, « à préparer avant » (début − 21 j), retard signalé, événement existant, bouton « Préparer un brouillon ».
- **Annonces #50** : pour un événement **public planifié**, « Bientôt : … » à J-7 et « L'événement … a commencé » au début (catégorie Événement). Elles sont archivées s'il repasse en brouillon. Jamais pour un événement TEST.

### Noël 2026 (brouillon)
« 🎄 Noël sous la mine », du 01/12/2026 00:00 au 01/01/2027 00:00 (Bruxelles). 5 objets en 4 langues, chacun avec sa consigne d'illustration :

| Objet | Rareté | Barème proposé (inactif tant que non planifié) |
|---|---|---|
| 🪨 Charbon du Père Noël | Commun | 0,8 % par bloc de minerai |
| 🎀 Bout de guirlande souterraine | Peu commun | 0,4 % tout bloc, dès 10 m |
| 🔔 Clochette fêlée de renne | Rare | 0,25 % par bloc de pierre, dès 25 m |
| 🔮 Boule à neige fossilisée | Épique | 3 % par coffre, dès 40 m |
| 🗺️ Itinéraire du traîneau (raturé) | Légendaire | 0,05 % tout bloc, dès 80 m |

Simulation à 50 m : il faut environ 170 à 420 blocs validés (médiane) pour chacun des 4 premiers objets. Un joueur à 300 blocs/jour les obtient presque sûrement en un mois ; le légendaire demande 80 m.

## 3. SHA, branche, procédure de test

- Branche `feature/56-evenements-mensuels` (commits `7f10e87`, `e7afd7d`), **develop `0508d4f`**.
- `npm test` : **490/490** sur la branche et sur la release `0508d4f` (SHA exact de develop). Nouveau fichier `test/monthly-events.test.js` (15 tests) :
  - heure de Bruxelles et changement d'heure ;
  - calendrier (Pâques 2026/2027/2028, carnaval, Nouvel An chinois, bornes de mois) ;
  - validation et planification protégée ;
  - drops (testeur seulement, référence, catégories, profondeur, unicité, rafale, fin d'événement) ;
  - souvenir conservé après retour en brouillon et **changement de saison pendant l'événement** ;
  - révisions, redémarrage et import unique, contenu de Noël ;
  - annonces J-7, début, archivage ;
  - gabarit TEST et IA factice ;
  - HTTP de bout en bout (objet tiré par `/api/me/save`, aucune pièce ajoutée, invité sans événement TEST) ;
  - admin sans `innerHTML`.
- Reproduire : `DB_FILE=test-56.sqlite PORT=3101 ADMIN_SECRET=… node server/index.js` sur une copie de base, puis Admin → 🎉 Événements.

## 4. Vérifications, limites, données joueurs

- **Copie de la base de production, port 3101** :
  - Noël importé en brouillon, complet ;
  - `/api/events` invité : vide ;
  - compte testeur créé sur la copie, événement TEST créé et planifié, puis sauvegardes simulées → « Caillou de test » tiré par le serveur et renvoyé dans `eventFinds`, vue joueur à jour ;
  - Chromium 1280 et 390 : panneau Événements et onglet admin (liste, fiche Noël, simulation) affichés, **0 erreur JS** ;
  - le débordement horizontal de l'admin à 1280 px existe déjà sur tous les onglets (barre d'onglets) : il n'est pas lié à ce ticket.

  La copie a ensuite été supprimée.
- **Limites** :
  - la génération d'**images IA** des objets d'événement n'est pas branchée dans l'atelier #40 (seulement le téléversement manuel et les URL de l'atelier) ;
  - le contrôle du sujet par l'IA n'est pas fait ;
  - les profondeurs suivent la saison en cours (la profondeur retenue repart à zéro chaque lundi) ;
  - la proposition IA n'a pas été essayée avec la vraie API (aucune dépense) ;
  - une invitation « testeur » se fait par pseudo exact (insensible à la casse).
- **Données des joueurs** : 7 tables **ajoutées** (`monthly_event*`), aucune colonne modifiée, aucune donnée réécrite.

## 5. Déploiement

- **Déployé `0508d4f`** : avance rapide de `main` `b2cbb44` → `0508d4f`, `scripts/deploy.sh` de la release, sans `npm ci`, aucune dépendance ajoutée. Sauvegarde vérifiée : `dig-20261103-053523-pre-deploy-0508d4f.sqlite`.
- **Avant le déploiement** :
  - aucune génération IA en cours (dernier appel de l'atelier à 23:25 UTC, aucune proposition en attente) ;
  - copie de la base de production démarrée en mode production (port 3122) : santé et version OK, `/api/events` vide, Noël importé en brouillon ;
  - empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après le démarrage ; `quick_check` ok ; copie supprimée.
- **Après le déploiement** :
  - dig.lodygames.com et dig.lodylands.com → 200, version `1.0.0+0508d4f` ;
  - `/api/admin/events` sans clé → 401 ; `/api/events` vide ;
  - journal propre (une seule ligne « événement préparé noel_2026 ajouté en brouillon ») ;
  - `quick_check` ok ; empreintes des 6 tables joueurs identiques à la sauvegarde pré-déploiement ;
  - Chromium sur la production, 1280 et 390 : vue Collection normale, panneau Événements masqué (aucun événement), 0 erreur JS.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep b2cbb44` puis `sudo systemctl restart dig`. Les tables ajoutées restent, inertes ; le brouillon de Noël reste dans la base sans effet.

### Test fonctionnel à faire par le propriétaire (5 minutes)
1. Admin (Ctrl+F5) → **🎉 Événements**. **Attendu** : « 🎄 Noël sous la mine » en 📝 Brouillon, public, 01/12 → 01/01, 5 objets, avertissements « pas d'illustration » seulement ; calendrier 2026/2027 avec Noël en décembre.
2. « Modifier » Noël → passer FR/EN/NL/ES en revue, puis **📊 Simuler** (essayer 20 m et 100 m). Ne **pas** planifier tant que le barème et les textes ne sont pas validés.
3. Section **🧪 Événement TEST** : saisir **votre pseudo de joueur**, 60 min → « Créer l'événement TEST », puis « Planifier » dans la liste.
4. Dans le jeu, connecté avec ce pseudo : creuser une vingtaine de blocs, attendre la sauvegarde (quelques secondes). **Attendu** : notification « Objet d'événement trouvé : … », et dans **Collection** le bloc « 🎉 Événements » (mention TEST) avec l'objet trouvé et des « ? ».
5. Admin : « Repasser en brouillon » sur l'événement TEST. **Attendu** : dans le jeu, l'objet passe dans « Souvenirs d'événements ». Il reste après un rechargement, et après la nouvelle saison de lundi.
6. Facultatif : ✨ IA, thème « Carnaval de Binche », dates 28/01 → 11/02/2027 → un brouillon TEST apparaît (un appel texte facturé).

## 6. Choix techniques faits seul

- **Drops serveur sur les compteurs validés de #38** plutôt que dans le navigateur, comme les collections : demandé par le ticket (« minage validé, prévenir duplication/abus »). Le client ne peut ni choisir ni rejouer un tirage.
- **Un exemplaire par objet** (souvenir) : pas de quantité, aucun effet économique.
- **Tables séparées des collections et des saisons** : la séparation demandée, et des souvenirs indépendants des remises à zéro.
- **Fiche figée une fois planifiée** : modifier oblige à repasser en brouillon, ce qui arrête les drops. On ne change pas un barème en cours en douce.
- **Événement TEST réservé à des pseudos** : il permet la recette en production sans rien montrer au public.
- **Annonces automatiques** pour les événements publics planifiés seulement, sous le même réglage que les annonces de saison.
- **Noël livré en fichier relu dans le dépôt** et importé une seule fois en brouillon (même mécanisme que les collections préparées #39).

## 7. Décisions demandées au propriétaire

1. **Barème de Noël** : le tableau du §2 donne presque tous les objets en un mois à un joueur régulier (300 blocs/jour), sauf le légendaire (≥ 80 m, ~10 % de chance). Options : a) garder ; b) diviser les chances par 2 pour plus de rareté. Recommandation : **b) pour les 3 premiers**, garder la boule à neige (coffres) et le légendaire.
2. **Dates de Noël** : 1er décembre → 1er janvier (calendrier de l'Avent) ou 15 → 29 décembre ? Recommandation : **1er décembre → 1er janvier**.
3. **Planification de Noël** : après vos réponses, les illustrations, puis « Planifier » (deux confirmations). La date idéale est **avant le 24/11**, pour que l'annonce J-7 paraisse à temps (préparation conseillée avant le 10/11).
4. **Thèmes 2027** : calendrier proposé (janvier Nouvel An, février carnaval, mars Pâques, etc. ; mai, août et novembre : idées). À valider mois par mois ; rien n'est créé sans vous.

## 8. Restant à réaliser

- **Après lancement** :
  - illustrations des 5 objets de Noël ;
  - branchement des objets d'événement dans l'atelier d'icônes #40 (génération d'une image par objet dans le budget) ;
  - annonce sur Discord ;
  - aperçu « vue joueur » d'un brouillon ;
  - profondeur minimale sur la profondeur record plutôt que celle de la saison.
- **Bloquant MVP** : rien.
