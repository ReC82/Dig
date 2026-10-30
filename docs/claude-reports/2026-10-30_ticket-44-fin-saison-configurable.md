# Ticket #44 — Clôture exceptionnelle de saison + date de fin configurable dans l'admin

- Ticket : [#44 — [P0] Clôture exceptionnelle saison 30/10 à 16h Bruxelles + date de fin configurable dans l'admin](https://github.com/ReC82/Dig/issues/44)
- Session : 30/10/2026, de 15:51 à 16:15 (Bruxelles)
- Classement MVP : **Après lancement** pour l'outil lui-même. La clôture réelle d'aujourd'hui est
  un test que tu as demandé ; elle ne bloque pas le partage du MVP.

## 1. État réel

**Déployé en production le 30/10/2026 à 16:07:55 (Bruxelles), SHA `f42989e`. En attente de ta
confirmation écrite d'un créneau de clôture.**

**Aucune clôture n'a été programmée.** La saison 44-2026 se termine toujours le 01/11 à 23:59:59 UTC
(02/11 à 00:59:59 à Bruxelles). Ton commentaire du 30/10 à 15:47 l'impose : pas d'heure de clôture
sans ta confirmation écrite. L'échéance de 16:00 était déjà intenable (ticket pris en charge à 15:51).

Prérequis vérifié en base de production (lecture seule) : **#33 crédite réellement les points.**
Les points sont en mode `live` depuis le 30/10 à 15:49:05 (Bruxelles), avec le barème validé
(version 2 en base, intitulé « Barème v1 (validé le 30/10/2026) »). Une saison qui se termine
après cette heure sera donc **créditée réellement** ; l'aperçu le confirme (`liveCredit: true`).

## 2. Réconciliation

Rien n'avait été livré pour #44 (pas de branche, de PR ni de rapport). La clôture elle-même existait
déjà et n'a pas été modifiée. Le planificateur passe chaque minute (#16), puis fige le classement
(#29) et attribue les points de façon idempotente (#33). #44 ajoute seulement une façon **sûre**
de déplacer la date de fin de la saison active.

## 3. Résultat et changements

**Admin** (panel → « 📊 Ligues & Saisons » → nouvelle carte « Date de fin de la saison active ») :
- heure du serveur, fin actuelle et fin hebdomadaire d'origine, chacune en **Europe/Brussels
  (UTC+1/+2) et en UTC** ;
- saisie de la nouvelle fin en **heure de Bruxelles**. Les heures inexistantes (passage à l'heure
  d'été) ou ambiguës (retour à l'heure d'hiver) sont refusées ;
- **aperçu des conséquences** avant toute écriture : heure de clôture, nombre de joueurs actifs,
  crédit **réel** ou **simulation** des points, version du barème, bornes de la saison suivante ;
- **confirmation explicite** : il faut retaper le nom exact de la saison. Motif facultatif ;
- **annulation** (retour à la fin hebdomadaire) possible jusqu'à 2 min avant l'échéance ;
- **journal** des changements (table `season_end_changes`, en ajout seul : modification et
  suppression sont bloquées par des déclencheurs), en plus du journal admin global (#25) ;
- **bornes** : au moins 10 min dans le futur (jamais de clôture immédiate ni rétroactive), au moins
  1 h après le début, au plus 7 jours après la fin hebdomadaire, avant une saison programmée ;
- **concurrence** : la fin attendue est renvoyée avec la demande et l'écriture est conditionnelle.
  Si un autre onglet a modifié la date entre-temps, ou si la saison est déjà close, la réponse est
  409 « rechargez » ;
- la route générique `PUT /api/admin/seasons/:id` refuse désormais de modifier la fin de la saison
  active (409) : on passe obligatoirement par la route protégée. Toutes les routes exigent le jeton
  admin ; rien n'est exposé aux joueurs.

**Outil en ligne de commande** `scripts/season-end.js` : mêmes contrôles que le panel, ajouté parce
que **le panel admin est désactivé en production** (`ADMIN_SECRET` absent, l'API répond 503) :
```
cd /home/ubuntu/Dig
node scripts/season-end.js                                     # état
node scripts/season-end.js --at 2026-10-30T17:00               # aperçu (heure de Bruxelles), aucune écriture
npm run backup                                                 # sauvegarde avant d'appliquer
node scripts/season-end.js --at 2026-10-30T17:00 --apply --confirm "Saison 44-2026" --reason "test clôture"
node scripts/season-end.js --cancel --apply                    # annuler (jusqu'à 2 min avant)
```

**Joueur** (onglet Saison) : dans les dernières 24 h, le compte à rebours affiche heures et minutes
(« Fin dans 2h 59min ») ; il est suivi de la date de fin en heure locale (« Fin : 30 oct. 2026,
17:00 »). La page se resynchronise automatiquement environ 75 s après l'échéance : nouvelle
saison, classement et points rechargés. Traduit en FR, EN et NL.

**Ce qui se passe à l'échéance** (mécanisme existant, inchangé) : dans la minute qui suit, la saison
est close, son classement est figé de façon immuable et les points sont crédités **une seule fois par
joueur** (clé d'idempotence unique dans le registre). **Une seule** nouvelle saison s'ouvre à
fin + 1 s.

**Stratégie pour la saison courte entre vendredi et lundi** (déjà prévue par #16) : la nouvelle saison
« Saison 44-2026 · 2 » va de la clôture jusqu'au **dimanche 23:59:59 UTC** (environ 56 h pour une
clôture à 17:00). Elle a son propre classement figé et ses propres points, avec le même barème,
la même activité requise et les mêmes seuils. Lundi 00:00:00 UTC, la saison 45-2026 reprend le
calendrier habituel. Il n'y a ni chevauchement, ni trou, ni double clôture le lundi. Les crédits
ne se répètent pas pour une même saison, mais les joueurs actifs reçoivent **deux attributions
cette semaine-là** (une par saison) : voir la question 2.

Fichiers : `server/seasonEnd.js` (nouveau), `server/seasonCalendar.js` (fuseau Europe/Brussels),
`server/seasons.js` (`planNextSeason`, calcul partagé avec l'aperçu), `server/db.js` (table
`season_end_changes`), `server/index.js` (4 routes admin + blocage de la route générique),
`public/admin/*`, `public/js/main.js`, `public/js/i18n.js`, `scripts/season-end.js`,
`test/season-end.test.js`.

## 4. SHA, branche, procédure de test

- Branche `feature/44-fin-saison-configurable` ; **`develop` = `f42989e`** (déployé).
- `npm test` → **245/245**, dont `test/season-end.test.js`, qui couvre :
  - l'horloge simulée sur le scénario exact (vendredi 30/10 à 16:00 Bruxelles = 15:00 UTC) ;
  - les bornes, la confirmation, la concurrence, l'annulation, et le journal en ajout seul ;
  - la seconde qui précède l'échéance (rien ne se passe), puis la clôture ;
  - 4 passages successifs du planificateur (collision de jobs ou relance) : **3 crédits, pas un de
    plus** ;
  - la saison courte jusqu'au dimanche, puis lundi la saison 45-2026, avec un seul crédit pour la
    saison courte ;
  - une saison sans joueur (aucun crédit, aucune erreur), la contiguïté de toutes les saisons et la
    cohérence du registre ;
  - les fuseaux et les heures d'été/hiver ;
  - une saison programmée ;
  - les routes HTTP : 401 sans jeton, aperçu, confirmation, 409 sur fin périmée, annulation, route
    générique bloquée ;
  - l'outil en ligne de commande.
- Navigateur (serveur de test, port 3101, base de test) : panel 1280×900 (aperçu, confirmation,
  programmation, badge « fin exceptionnelle programmée », aucune erreur JS) et vue joueur 390×844
  (« Fin dans 2h 59min · Fin : 30 oct. 2026, 18:57 »).

## 5. Vérifications, limites, impact sur les données

- Copie de la base de production : démarrage de la release, `/health` et `/api/version` OK.
  **Empreintes identiques** avant et après pour `users`, `user_saves`, `season_rankings`,
  `seasons`, `leagues` et `player_click_tracking`. Seul ajout : la table `season_end_changes`
  (vide).
- Sur cette copie uniquement, l'outil CLI a été essayé : aperçu à 17:00, programmation, annulation.
  Les empreintes sont restées identiques et la copie a été supprimée.
- Production après déploiement : saison 6 « Saison 44-2026 » active, fin inchangée au 01/11
  23:59:59 UTC, `season_end_changes` vide.
- Limites :
  - l'aperçu nomme la saison suivante « Saison 44-2026 », alors que la clôture la nommera « Saison
    44-2026 · 2 » (nom unique) : c'est cosmétique ;
  - l'aperçu indique « barème v2 » (numéro interne de la version validée « Barème v1 ») ;
  - l'aperçu ne simule pas le montant des points par joueur ; pour cela, utiliser l'onglet 🏅 Points
    de #33 ;
  - un serveur de test laissé par une session précédente (release de #33, port 3123, dossier
    supprimé) a été arrêté.

## 6. Déploiement

- SHA déployé : **`f42989e`** (`main` avancé sans `--force` depuis `6fb036c`). Sauvegarde
  pré-déploiement vérifiée : `~/backups/dig/dig-20261030-160753-pre-deploy-f42989e.sqlite`.
- Contrôles : https://dig.lodygames.com et https://dig.lodylands.com répondent 200 avec la
  version `1.0.0+f42989e` ; journal sans erreur ; `quick_check` = ok ; empreintes joueurs
  identiques à la sauvegarde.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 6fb036c && sudo systemctl restart dig`.
  La table ajoutée est sans effet sur l'ancienne version.

**Test fonctionnel à faire par toi (3 étapes) :**
1. **Confirme par écrit sur #44** un créneau (voir la question 1) et choisis comment l'appliquer :
   - (a) **toi-même**, avec l'outil CLI ci-dessus (`npm run backup`, puis `--apply`) ;
   - (b) via le panel, après avoir ajouté `ADMIN_SECRET` (`docs/OPERATIONS.md`) ;
   - (c) en autorisant explicitement une session DIGORCH à lancer la commande `--apply` (elle ne
     peut pas écrire dans la base de production sans ton accord écrit).
2. **Avant l'échéance**, ouvre l'onglet **Saison** dans le jeu. Attendu : « Fin dans Xh Ymin ·
   Fin : 30 oct. 2026, 17:00 ».
3. **2 à 3 min après l'échéance**, sans recharger la page, reste sur Saison. Attendu :
   - le titre « Saison — Saison 44-2026 · 2 » ;
   - « Fin dans 2j 7h » (fin le 02/11 à 00:59 Bruxelles) ;
   - la carte 🏅 Points : solde augmenté selon ton rang, et l'historique avec une ligne « Saison
     44-2026 » (crédit réel, pas « simulation ») ;
   - ta progression de jeu remise à zéro comme à chaque nouvelle saison (gemmes conservées dans la
     limite du plafond).

   Je fournirai ensuite les preuves en base (lecture seule) : snapshot, exécution `live`, lignes du
   registre.

## 7. Choix techniques faits seul

- **Aucune nouvelle logique de clôture** : déplacer `end_at` suffit, et le mécanisme testé et
  idempotent de #16/#29/#33 fait le reste. Moins de code, donc moins de risque de double clôture.
- **Délai minimal de 10 min et verrou d'annulation à 2 min** : ils évitent une clôture accidentelle
  immédiate et une annulation qui croiserait le planificateur (passage chaque minute).
- **Écriture conditionnelle** (`UPDATE … WHERE status='active' AND end_at=<attendue>`) dans une
  transaction, avec l'audit : cela empêche les modifications concurrentes de s'écraser.
- **Heure de Bruxelles convertie côté serveur** (Intl), pour ne pas dépendre du fuseau du
  navigateur de l'admin. Les heures ambiguës sont refusées plutôt que devinées.
- **Prolongation limitée à +7 jours** : au-delà, la saison sortirait du calendrier hebdomadaire.
- **Outil en ligne de commande** : le panel est désactivé en production et je n'ai pas le droit de
  modifier `/etc/dig/dig.env`.

## 8. Décisions demandées au propriétaire

1. **Créneau de la clôture exceptionnelle.** Le déploiement vérifié date de 16:07:55. Au plus tôt
   30 min après, comme tu l'as demandé :
   - option A (**recommandée**) : **aujourd'hui à 17:00 Bruxelles = 16:00 UTC** ;
   - option B : **18:00 Bruxelles = 17:00 UTC** ;
   - option C : un autre créneau. Il faut au moins 10 min d'avance au moment où il est programmé.

   Rien ne sera programmé sans ta réponse écrite, et il faut aussi choisir le mode d'application
   (a, b ou c ci-dessus). Si ta réponse arrive après l'heure choisie, la session suivante proposera
   le créneau suivant et ne programmera rien rétroactivement.
2. **Saison courte vendredi → dimanche** :
   - option A (**recommandée**, comportement actuel) : saison « 44-2026 · 2 » jusqu'au dimanche,
     avec ses propres points (même barème). Les joueurs actifs sont crédités deux fois cette
     semaine, et cela teste aussi la rotation normale du lundi ;
   - option B : après la clôture, reporter la fin de la saison courte au 08/11 23:59:59 UTC (un
     seul crédit). C'est faisable avec le même outil, sans code.

## 9. Reste à faire

- Après ta confirmation : programmer (ou laisser programmer) le créneau, puis observer la clôture et
  fournir les preuves en base (snapshot, `reward_point_runs` live, registre).
- Après lancement (petits correctifs possibles) : nom exact de la saison suivante dans l'aperçu,
  libellé du barème validé au lieu du numéro interne.
- Toujours en attente de ton côté : `ADMIN_SECRET` pour activer le panel (#30, #33, #44).
