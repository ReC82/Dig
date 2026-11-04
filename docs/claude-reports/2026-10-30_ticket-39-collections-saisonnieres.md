# Ticket #39 — Collections saisonnières : objets, fiches narratives et édition admin

# Mise à jour du 04/11/2026, 17 h 30 (Bruxelles) — barème « chance croissante » implémenté côté serveur, modèle et simulation dans l'admin (rien publié)

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite la **décision du propriétaire du 04/11 à 15:20 UTC** ([commentaire](https://github.com/ReC82/Dig/issues/39#issuecomment-6634456766)) : barème **chance croissante** choisi, à implémenter et simuler, **sans publier ni activer aucune collection**.

## A (04/11). État réel

**Déployé en production (SHA `e9e1471`). La fonction reste inactive : aucun objet publié n'a de hausse, donc rien ne change pour les joueurs.** Production vérifiée après déploiement : catalogue public v5, aucun objet tiré par le serveur. La Saint-Martin reste en **brouillon** : je ne l'ai pas modifiée moi-même (aucune écriture dans la base de production hors `deploy.sh`), et elle n'est ni publiée ni activée.

Classement : **« Bloquant pour la publication de la Saint-Martin (W46, 09/11) »**, pas pour le reste du MVP public.

## B (04/11). Ce qui a été fait

Trois étapes à bien distinguer :

1. **Développement technique (fait, déployé, inactif).**
   - `server/collectionPity.js` (nouveau). Un objet dont le drop porte une **hausse par tirage raté** (`pityStep` > 0) n'est plus tiré par le jeu : c'est le **serveur** qui le tire, après chaque sauvegarde acceptée, sur les **blocs validés** (les mêmes que ceux des badges #38 et des événements #56, limités par la profondeur retenue).
     - **Tirage éligible** : bloc d'une catégorie source, pendant la saison de la série, profondeur retenue ≥ profondeur minimale, objet pas encore possédé.
     - **Chance du (k+1)e tirage** = min(100 %, chance de départ + hausse × k), où k = tirages éligibles ratés jusque-là.
     - **Compteur** : un par joueur et par objet, dans la table `collection_pity`. Il reste en base après un redémarrage.
     - **Après la trouvaille** : le compteur est figé et l'objet n'est plus jamais tiré. Il n'y a qu'un exemplaire par objet, garanti par la clé primaire.
   - **Anti-fraude.**
     - Rejouer une sauvegarde ne donne rien : aucun nouveau bloc validé n'apparaît.
     - Au premier passage, après une nouvelle publication ou un changement de saison, le curseur est recalé **sans tirage** : rien n'est attribué rétroactivement, et la migration n'attribue aucun objet.
     - Une rafale de plus de 2 000 blocs en une sauvegarde ne déclenche aucun tirage.
     - Une sauvegarde qui contient un objet que **seul le serveur** peut donner, alors qu'il ne l'a pas donné, est corrigée : l'objet est retiré. Un objet déjà tombé dans le jeu avant de passer en chance croissante est **conservé**.
     - Session unique (#35) : un autre appareil ne peut ni sauvegarder ni déclencher de tirage.
   - **Côté jeu.** Le catalogue public envoie ces objets avec `dropEnabled: false`, ce qui empêche tout second tirage local, même par un onglet resté sur l'ancienne version. L'objet trouvé par le serveur arrive dans la réponse de sauvegarde (`collectionFinds`) et le joueur voit l'annonce habituelle « 🔍 trouvaille ». L'objet est aussi réinjecté à chaque lecture ou écriture de la sauvegarde, donc il ne se perd pas.
   - **Saisons clôturées et objets acquis.** Rien ne change pour eux. Une série terminée n'est plus tirée, et ses objets restent acquis.
2. **Panel Admin → Collections → nouvelle carte « 🎲 Barème et simulation des drops ».**
   - Pour chaque objet de la série choisie : le **type de barème** (*Fixe* ou *↗ Chance croissante*), le barème du brouillon, le barème que donnerait le modèle, et les compteurs des joueurs (joueurs suivis, objets trouvés, plus long compteur).
   - Bouton **« Appliquer le modèle « chance croissante » au brouillon »**, avec une confirmation qui liste chaque changement. Les taux appliqués : communs 4 %, rare 2 % + 0,1 pt, légendaire 3 % + 0,3 pt. Les peu communs et les épiques restent **inchangés** : aucun taux n'est inventé. Les images, les textes et la case « Drop activé » ne changent pas.
   - Bouton **« Lancer la simulation comparative »** (2 000 joueurs par profil par défaut, environ 1 à 2 minutes). Elle tourne en arrière-plan, dans un processus de basse priorité, et la page suit l'avancement. Elle compare la version publiée, le brouillon, le brouillon sans hausse et le modèle, sur tous les profils (dont l'entrant du vendredi). Pour chacun, elle donne : série complète, rare, légendaire et légendaire dès la fin du J1.
   - Dans la fiche d'un objet : champ **« Hausse par tirage raté (points) »**. 0 = barème fixe, et le maximum est 5 points.
3. **Enregistrement du brouillon Saint-Martin : à faire par le propriétaire, en un clic.** Publication : **non faite, interdite sans votre validation.**

## C (04/11). Simulation de référence rejouée (2 000 joueurs par profil)

Fichier complet : [`2026-11-04_ticket-39-simulation-chance-croissante.md`](2026-11-04_ticket-39-simulation-chance-croissante.md). Les chiffres du brouillon actuel sont **identiques** à ceux du 03/11 (non-régression). Avec le tirage serveur, la chance croissante tire l'objet **indépendamment** de la chaîne du jeu : un fossile trouvé sur la même gemme n'empêche plus le tirage du manteau. Ses chiffres changent donc un peu par rapport au 03/11 :

| Profil (saison) | Série complète : brouillon → chance croissante | Rare | Légendaire (7 j) | Légendaire fin J1 |
|---|---|---|---|---|
| Lent, compte neuf | 26 % → **40 %** (37 % le 03/11) | 67 % → 98 % | 40 % → 42 % | 2 % → 2 % |
| Lent, installé | 48 % → **65 %** (64 %) | 78 % → > 99 % | 62 % → 66 % | 20 % → 14 % |
| Entrant du vendredi | 76 % → **93 %** (91 %) | 93 % → 100 % | 82 % → 93 % | 0 % → 0 % |
| Auto-Dig, compte neuf | 83 % → 97 % | 95 % → 100 % | 87 % → 97 % | 3 % → 2 % |
| Régulier, compte neuf | 96 % → > 99 % | 99 % → 100 % | 97 % → > 99 % | **38 % → 42 %** (38 % le 03/11) |
| Régulier, installé | 99 % → 100 % | | | 77 % → 86 % |
| Assidu, compte neuf | 100 % → 100 % | | | 74 % → 85 % |

À noter : le repère « ne pas banaliser » (légendaire dès le J1 d'un régulier sur un compte neuf) passe de 38 % à **42 %** avec le tirage indépendant. La limite démontrée le 03/11 reste vraie : la semaine d'un joueur lent (environ 11 gemmes au-delà de 100 m) ne suffit pas pour que la hausse joue beaucoup sur le légendaire (40 → 42 %). Le gain du joueur lent vient surtout du rare.

## D (04/11). SHA, tests, déploiement

- Branche `feature/39-collections-saisonnieres` : `a494f0d`. **`develop` : `e9e1471`** (fusion, qui contient aussi le rapport #38 déjà fusionné).
- `npm test` : **615/615** sur la branche, sur `develop` et sur la release `e9e1471`. Le nouveau fichier `test/collection-pity.test.js` contient 9 tests :
  - barème borné et rétrocompatible ;
  - modèle appliqué au brouillon seul, et idempotent ;
  - aucun effet sans objet publié ;
  - compteur par joueur et par objet ;
  - profondeur et catégories ;
  - hausse exacte (2,5 % puis 2,6 %), chance bornée à 100 % ;
  - un seul exemplaire ;
  - rejeu sans effet, pas de rétroactif ;
  - rafale, fin de saison ;
  - sauvegarde falsifiée ;
  - simulateur reproductible ;
  - jeu (vm) qui ne tire jamais l'objet localement ;
  - HTTP de bout en bout : routes admin refusées sans clé (401), simulation en arrière-plan avec un seul calcul à la fois (409), objet donné à la sauvegarde, rejeu, **redémarrage** (trouvaille conservée), **session unique** (409).
- Copie de la base de production : démarrage de `e9e1471` sur la copie, empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après. Seules 2 tables sont ajoutées (`collection_pity`, `collection_pity_cursor`). Copie supprimée.
- Déploiement `8d03dbb → e9e1471` par `scripts/deploy.sh`. Sauvegarde vérifiée : `~/backups/dig/dig-20261104-173022-pre-deploy-e9e1471.sqlite`. Les deux domaines répondent 200, version `1.0.0+e9e1471`, `quick_check` = ok, aucune erreur dans le journal. Une partie était en cours et sa sauvegarde a progressé normalement (révision 2500 → 2501). **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 8d03dbb` puis redémarrage. Les deux tables ajoutées restent sans effet.
- Contrôle visuel (Chromium headless, serveur de test port 3101, base de test supprimée) sur PC 1280×900 et téléphone 390×844 : carte, confirmation, application du modèle (« Brouillon mis à jour : 4 objet(s) »), simulation à 100 joueurs, fiche objet (hausse = 0,3). Vérifié ensuite : aucune série publiée.

## E (04/11). Test fonctionnel à faire par le propriétaire (aucune publication)

1. Admin → **📿 Collections** → carte **« 🎲 Barème et simulation des drops »** → série **Les Trésors de la Saint-Martin**. Le tableau doit indiquer *Fixe* pour les 6 objets, et la colonne « Modèle » doit afficher lanterne et bonbon 4 %, manteau « ↗ 3 % + 0,3 pt/échec », fer « ↗ 2 % + 0,1 pt/échec », plume et lampion « = déjà appliqué ».
2. **Lancer la simulation comparative** (2 000 joueurs, environ 1 à 2 min) : le tableau compare le brouillon et la chance croissante pour chaque profil.
3. Si vous êtes d'accord : **Appliquer le modèle « chance croissante » au brouillon**. La confirmation liste les 4 changements, puis s'affiche « Brouillon mis à jour : 4 objet(s). Rien n'est publié. ». La bannière indique toujours un brouillon non visible des joueurs, et les 6 images sont inchangées.
4. Ouvrez le manteau : le champ « Hausse par tirage raté (points) » vaut 0,3 et la case « Drop activé » est toujours décochée.
5. **Ne publiez pas** tant que vous n'avez pas validé la simulation et la fiche prête à publier. La publication (étape suivante, avec votre accord écrit) demandera, comme avant, la case « Barème validé : j'active ces drops ».

## F (04/11). Choix techniques faits seul

- **Tirage serveur seulement pour les objets à hausse.** Les objets fixes restent tirés par le jeu, comme avant, ce qui évite de toucher aux séries publiées. Un compteur côté client aurait été falsifiable.
- **Éligibilité jugée sur la profondeur retenue à la sauvegarde**, faute de profondeur par bloc. Une sauvegarde couvre quelques secondes de minage : l'écart est négligeable et documenté dans l'outil.
- **Tirage indépendant de la chaîne « un objet par bloc » du jeu**, en conséquence du tirage serveur. Le simulateur suit désormais exactement cette règle.
- **Le modèle ne modifie que la chance et la hausse** : sources, profondeurs et activation restent inchangées. Peu communs et épiques gardent leur taux.
- **Résultat de simulation gardé en mémoire** : il est perdu au redémarrage et se relance en un clic.

## G (04/11). Décisions demandées au propriétaire

1. **Après votre test** : appliquer le modèle au brouillon Saint-Martin (étape 3 ci-dessus), puis valider la fiche prête à publier. La publication reste soumise à votre accord écrit explicite.
2. Questions toujours ouvertes et **non traitées par ce lot** (inchangées, comme vous l'avez demandé) : rattacher « Les Objets trouvés de la Légende » à 2026-W47 (recommandé : oui) ; reporter « Trésors de la vieille mine » sur 2026-W48 (recommandé : oui) ; objets d'une saison terminée exclusifs et non trouvés affichés en grisé (recommandé : oui).

## H (04/11). Reste à faire

- Enregistrement du brouillon Saint-Martin (par vous), puis publication après validation (avant le 09/11, début de W46).
- Après lancement : afficher au joueur une indication de progression (« chance en hausse »). Ce n'est pas demandé et c'est hors périmètre.

---

# Mise à jour du 03/11/2026, 17 h (Bruxelles) — fiche des souvenirs validée ; deux barèmes Saint-Martin plus accessibles aux joueurs lents (simulation seule)

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite le commentaire du propriétaire de [14:23 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6606311481) :

- la fiche des souvenirs d'événements est **validée** sur PC et téléphone : rien à faire de plus pour ce point ;
- le barème « Progressif » (légendaire 3 %) est **refusé en l'état**, car il fait passer la série complète d'un joueur lent de 26 % à 16 %. Le propriétaire demande une variante chiffrée qui aide les joueurs lents **sans banaliser le légendaire**, avec la même méthode, et sans rien activer.

## A (03/11 soir). État réel

**Intégré dans `develop` (`c7b6436`), non déployé : aucun changement du jeu.** Le lot ne modifie que l'outil de simulation, son test et des documents. La production reste à `0c66821`, qui contient déjà toute l'interface #39 validée. **Aucun taux modifié, aucun drop activé, rien publié.**

Classement : choix du barème = **bloquant pour la publication de la Saint-Martin (W46, 09/11)**, pas pour le reste du MVP public.

## B (03/11 soir). Méthode

C'est le même outil que la simulation précédente (`tools/balance/collection-drop-sim.js`, sur le simulateur économique #49 qui exécute le vrai code du jeu). Il simule 2 000 joueurs par profil, avec le même flux de blocs pour tous les barèmes. Les résultats sont reproductibles. Deux ajouts :

- **colonne « Légendaire fin J1 »** : part des joueurs qui ont déjà le légendaire à la fin du premier jour. C'est l'indicateur retenu pour « ne pas banaliser » : un légendaire trouvé dès la première séance par la plupart des joueurs actifs est banalisé ;
- **option `pityStep`** (simulation seulement) : la chance d'un objet augmente de N points à chaque tirage raté de cet objet.

Résultat complet : [`2026-11-03_ticket-39-simulation-drops-saint-martin.md`](2026-11-03_ticket-39-simulation-drops-saint-martin.md), régénéré avec les deux nouvelles variantes. Les chiffres des trois barèmes précédents sont inchangés (vérifié par diff).

## C (03/11 soir). Ce qui bloque les joueurs lents

Avec le brouillon actuel, le joueur lent (20 min/j, 4 j/7, compte neuf) trouve les communs et les peu communs à plus de 99 %. Deux objets le bloquent :

- **le rare** (fer à cheval, 1,5 % par minerai dès 40 m) : **67 %** ;
- **le légendaire** (manteau, 5 % par gemme dès 100 m) : **40 %**.

**Limite structurelle.** En une semaine, le joueur lent rencontre une médiane de **11 gemmes** au-delà de 100 m. C'est à peu près ce qu'un joueur régulier rencontre en **un seul jour** : avec le brouillon, 40 % des lents ont le légendaire en fin de semaine, et 38 % des réguliers l'ont dès le premier jour.

Avec une chance fixe par gemme, toute hausse pour les lents rend donc le légendaire plus fréquent au premier jour des actifs. Seule une chance qui **augmente avec les échecs** évite ce compromis : elle ne change presque rien aux premiers tirages, mais elle rattrape les malchanceux.

## D (03/11 soir). Les deux variantes proposées

| Variante | Communs | Peu communs | Rare | Légendaire |
|---|---|---|---|---|
| Brouillon actuel | 3 % | 2 % dès 20 m | 1,5 % dès 40 m | 5 % par gemme dès 100 m |
| Progressif (refusé) | 4 % | 2 % | 1,5 % | 3 % |
| **Accessible** (valeurs seules) | 4 % | 2 % | **3 %** | **6 %** |
| **Chance croissante** | 4 % | 2 % | **2 % + 0,1 pt par minerai raté** | **3 % + 0,3 pt par gemme ratée** |

**Série complète en 7 jours (légendaire dès la fin du 1er jour)** — 2 000 joueurs par profil ; saison 1 = compte neuf, saison 4 = joueur installé :

| Profil | Brouillon | Progressif | **Accessible** | **Chance croissante** |
|---|---|---|---|---|
| Lent, saison 1 | 26 % | 16 % | **38 %** | **37 %** |
| Lent, saison 4 | 48 % | 31 % | **62 %** | **64 %** |
| Nouvel entrant (vendredi → dimanche) | 76 % | 57 % | **86 %** | **91 %** |
| Auto-Dig, saison 1 | 83 % | 65 % | **91 %** | **96 %** |
| Régulier, saison 1 · saison 4 | 96 % · 99 % | 85 % · 98 % | **98 % · 100 %** | **> 99 % · 100 %** |
| *Légendaire dès la fin du J1 — régulier, saison 1* | *38 %* | *26 %* | ***45 %*** | ***38 %*** |
| *Légendaire dès la fin du J1 — assidu, saison 1* | *74 %* | *52 %* | ***79 %*** | ***82 %*** |

Lecture des deux variantes :

- **Accessible** : uniquement des valeurs. Elle peut être saisie telle quelle dans la fiche de la série (Admin → Collections), sans développement. Le rare passe de 67 % à 88 % chez le joueur lent, et la série complète des lents gagne 12 à 14 points. Contrepartie : le légendaire est un peu plus souvent trouvé dès le premier jour par un régulier (45 % au lieu de 38 %).
- **Chance croissante** : départ plus bas que le brouillon (légendaire 3 %), puis +0,3 point par gemme éligible ratée. Le premier jour d'un régulier reste au niveau du brouillon (**38 %**) : le légendaire n'est pas banalisé. Les joueurs lents gagnent autant qu'avec « Accessible », les nouveaux entrants et les profils Auto-Dig davantage. Tout joueur suffisamment actif finit la série. **Limite :** cette mécanique n'existe pas dans le jeu. Il faudrait une petite évolution : un compteur de tirages ratés par joueur et par objet, conservé dans la sauvegarde, et un champ « hausse par échec » dans l'admin. À faire seulement après votre accord, avant le 09/11.
- Aucune variante ne dépasse durablement environ 40 % pour un joueur lent sur un **compte neuf** sans rendre le légendaire courant dès le premier jour des actifs (voir C).

## E (03/11 soir). SHA, tests

- Branche `feature/39-collections-saisonnieres`, commit `9c733b9` ; `develop` **`c7b6436`**.
- `npm test` : **546/546** sur la branche, **552/552** sur `develop` après intégration (les tests en plus viennent des autres tickets). Nouveau test : le barème « Accessible » ne contient que des valeurs, la chance croissante ne peut qu'augmenter les trouvailles, et la part par jour est cumulative.
- Reproduire : `node tools/balance/collection-drop-sim.js --runs 2000` (ou `--scale CROISSANT`).
- **Non déployé** : aucun fichier servi aux joueurs ni à l'admin n'a changé (écart avec `main` : outil, test, documents). Production inchangée : `0c66821`. Aucune donnée joueur touchée.

## F (03/11 soir). Test fonctionnel

Aucun test en jeu pour ce lot. Il faut seulement lire les chiffres et choisir un barème (question 3 ci-dessous).

## G (03/11 soir). Choix techniques faits seul

- **« Banaliser » mesuré par la part des joueurs qui ont le légendaire dès la fin du premier jour**, comparée au brouillon. Ce critère est lisible et ne dépend pas d'un seuil arbitraire.
- **La proposition à 3 % n'est plus recommandée**, conformément à votre commentaire. Elle reste dans l'outil comme référence.

## H (03/11 soir). Décisions demandées au propriétaire

1. Rattacher « Les Objets trouvés de la Légende » à 2026-W47 ? Recommandation : **oui** (W46 = Saint-Martin).
2. « Trésors de la vieille mine » (fin 08/11, incomplète) : la reporter sur une semaine future, par exemple 2026-W48 ? Recommandation : **oui**.
3. **Barème Saint-Martin** :
   - (a) **Chance croissante** — **recommandé** : le légendaire n'est pas plus facile au premier jour, et les lents et nouveaux entrants sont rattrapés. Demande une petite évolution du jeu, faisable avant le 09/11.
   - (b) **Accessible** : valeurs seules, applicables immédiatement dans l'admin.
   - (c) Brouillon actuel.
4. Objets d'une saison terminée exclusifs ? Recommandation : **oui**. Objets non trouvés affichés en grisé ? Recommandation : **oui**.

Après votre choix, une session applique le barème (et, pour (a), développe le compteur), active les drops et prépare la publication ciblée. **Rien n'est publié sans votre feu vert.**

## I (03/11 soir). Restant à réaliser

- Appliquer le barème choisi, activer les drops de la Saint-Martin et publier sur votre feu vert (avant le 09/11).
- Après lancement : tirage des objets de collection contrôlé par le serveur, comme pour les événements #56.


# Mise à jour du 03/11/2026, 15 h 10 (Bruxelles) — fiche dédiée des souvenirs d'événements et simulation chiffrée des drops Saint-Martin

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite deux commentaires du propriétaire :

- la recette UX de [12:27 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6603768364) (Collection → Souvenirs d'événements) ;
- la décision « Progressif » de [13:31 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6605143555), qui demande une simulation chiffrée du barème (demande déjà formulée à [13:02 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6604514177)).

Les commentaires de 12:36 et 12:58 UTC sont des validations sans demande : les 6 images sont conservées et il ne faut rien régénérer. Le retour transversal sur le centrage relève de #62.

## A (03/11 après-midi). État réel

**Déployé en production (SHA `7e7c885`) — en attente de recette.**

- **Fiche dédiée des souvenirs d'événements** — classement : **Bloquant MVP public**. C'est un défaut visible dans l'écran Collection d'un joueur.
- **Simulation et barème** : livrés comme **proposition seulement**. **Aucun taux modifié, aucun drop activé, rien publié.** Le choix du barème revient au propriétaire. Classement : **Bloquant pour la publication de la Saint-Martin (W46, 09/11)**, pas pour le reste du MVP.

## B (03/11 après-midi). Souvenirs d'événements : cause et correction

**Cause du chevauchement.** Le titre « Souvenirs d'événements » réutilise le style des archives de collection. Ce style a une marge basse **négative** (`-6px`), prévue pour `#collection-grid`, qui est une grille flex avec 16 px d'écart. Le panneau des événements (`#events-panel`) n'avait pas cet écart : la marge négative faisait donc remonter le titre « 🧪 Événement test · 1 » sur « Souvenirs d'événements ». Le défaut a été reproduit en navigateur avant la correction.

**Correction (`public/css/style.css`).** `#events-panel` reçoit le même rythme vertical que la grille de collection : flex en colonne, écart de 16 px, marges des titres et notes ajustées. L'image de la fiche est responsive (`min(160px, 42vw)`).

**Fiche dédiée (`public/js/main.js`).**

- Le paragraphe de description qui s'affichait sous la petite carte est supprimé.
- Un clic sur un objet d'événement ouvre maintenant la **même fenêtre que les objets de collection**. Elle contient :
  - grande illustration, ou emoji agrandi si l'objet n'a pas d'image ;
  - badge de rareté ;
  - nom ;
  - « 🧪 Événement test · Terminé le 3 novembre 2026 » (ou « Jusqu'au … » pendant l'événement) ;
  - « Trouvé le … » ;
  - petite histoire.
- Un objet non trouvé d'un événement en cours affiche « ❔ Objet non découvert » avec l'invitation à creuser, sans rareté ni date.
- La fenêtre commune a été extraite dans `_openItemSheet`, utilisée par la collection (`showFindSheet`) et par les événements (`showEventItemSheet`).
- Accessibilité :
  - `role="dialog"` existant ;
  - le focus va sur « Fermer » et Tab y reste ;
  - Échap, un clic à l'extérieur ou « Fermer » ferment la fiche ;
  - **le focus revient à la carte** à la fermeture (nouveau, pour les deux usages) ;
  - texte inséré sans HTML.

**Textes.** Nouvelle clé `events.ended` (« Terminé le {date} ») en FR, EN, NL et ES. Elle est aussi ajoutée à la langue pilote italienne (#59, 602/602) via `tools/i18n` (mémoire `i18n/it.json` puis `build it`).

**Inchangés** : drops des événements, données des joueurs, règle « l'objet reste acquis après l'événement ».

## C (03/11 après-midi). Simulation chiffrée des drops Saint-Martin (lecture seule)

**Outil.** Nouvel outil `tools/balance/collection-drop-sim.js`. Il réutilise le simulateur économique #49 (`tools/balance/economy-sim.js`), qui exécute le **vrai code du jeu** :

- probabilités des blocs par profondeur (catalogue publié, 22 blocs), PV, pioche, Chance, Auto-Dig = 1 coup/s ;
- améliorations achetées, reliques, coffres, temps d'animation, gains hors ligne.

À chaque bloc détruit, l'outil reproduit `Collection.tryDrop` :

- seuls les objets éligibles sont tirés, **dans l'ordre du catalogue** ;
- **au plus un objet par bloc** ;
- les 8 objets permanents passent d'abord, puis les 6 de la Saint-Martin.

Le simulateur #49 reçoit un seul crochet `onBlock`, sans effet sur la partie (vérifié par un test). Le résultat complet est [`docs/claude-reports/2026-11-03_ticket-39-simulation-drops-saint-martin.md`](2026-11-03_ticket-39-simulation-drops-saint-martin.md) : 2 000 joueurs par profil, résultats reproductibles.

**Faits établis :**

- **Profondeur.** 1 bloc = 1 m et la profondeur repart de 1 à chaque saison. Au-delà de 100 m, la composition des blocs est stable : environ 63 % pierre, 25 % minerai, 6 % coffre, **3 % gemme**, 1,5 % terre.
- **Le légendaire.** « 5 % par gemme dès 100 m » donne donc ≈ **0,15 % par bloc** au-delà de 100 m.
- **Gemmes rencontrées au-delà de 100 m dans la semaine (médiane)** :

  | Profil | Saison 1 | Saison 4 |
  |---|---|---|
  | Occasionnel (20 min/j, 4 j/7) | 11 | 18 |
  | Nouvel entrant (1 h/j dès vendredi) | 35 | — |
  | Auto-Dig (15 min/j + 8 h onglet ouvert) | 41 | 73 |
  | Régulier (1 h/j) | 69 | 117 |
  | Assidu | 170 | 383 |

  Le seuil de 100 m est franchi dès la première séance pour tous les profils : **le risque d'une série « quasiment impossible » ne se vérifie pas**. En revanche, **le légendaire est presque garanti (97 % et plus) dès 1 h par jour**.
- **Mêmes sources, même rareté.** Les deux communs (et les deux peu communs) partagent leurs sources. Un bloc ne donne qu'un objet, mais les deux sont trouvés par plus de 99 % des joueurs : l'effet est négligeable.
- **Objets permanents prioritaires.** Sur un compte neuf, la dent de monstre (gemme dès 35 m) et l'orbe mystique (gemme dès 70 m) passent avant le légendaire de la Saint-Martin. C'est compris dans les chiffres « saison 1 ».
- **Auto-Dig et serveur.** Clic manuel et Auto-Dig passent par la même fonction (`handleBlockDestroyed` → `Collection.tryDrop`), avec le générateur déterministe du bloc (#35). Les chances sont donc identiques. Les objets de collection sont **tirés par le client** et conservés dans la sauvegarde. Le serveur ne retire pas le tirage, contrairement aux événements #56 (limite connue, à traiter **après lancement**).
- **Pas de limite par compte et par objet à ajouter** : un objet possédé n'est plus tiré.

**Série complète en 7 jours (part des joueurs)** — saison 1 = compte neuf, saison 4 = joueur installé :

| Profil | Brouillon actuel | **Progressif (recommandé)** | Exigeant |
|---|---|---|---|
| Occasionnel / lent, saison 1 | 26 % (légendaire 40 %) | **16 %** (légendaire 26 %) | 8 % |
| Occasionnel / lent, saison 4 | 48 % | **31 %** | 17 % |
| Nouvel entrant (vendredi → dimanche) | 76 % | **57 %** | 38 % |
| Auto-Dig, saison 1 · saison 4 | 83 % · 96 % | **65 % · 88 %** | 46 % · 71 % |
| Régulier 1 h/j, saison 1 · saison 4 | 96 % · 99 % | **85 % · 98 %** | 69 % · 88 % |
| Assidu, saison 1 · saison 4 | 100 % · 100 % | **99 % · 100 %** | 95 % · > 99 % |

Les communs sont trouvés par plus de 99 % des joueurs dans les trois barèmes, en général dès la première séance.

**Barèmes comparés** (sources et profondeurs inchangées, sauf mention) :

- **Brouillon actuel** : communs 3 % ; peu communs 2 % dès 20 m ; rare 1,5 % dès 40 m ; légendaire 5 % par gemme dès 100 m.
- **Progressif (recommandé)** : communs **4 %**, peu communs et rare inchangés, légendaire **3 %** par gemme dès 100 m. Les communs sont un peu plus immédiats. Le légendaire n'est plus garanti pour un joueur régulier (86 % sur un compte neuf), mais reste très probable pour quiconque joue chaque jour.
- **Exigeant** : rare **1 %**, légendaire **2 % par gemme dès 150 m**. La série complète devient un vrai défi, même pour un joueur régulier.

**Aucune de ces valeurs n'a été appliquée.**

**Limite.** Les profils sont des modèles (#49) : 4 à 6 clics/s en actif, Auto-Dig 1 coup/s. La production compte trop peu de classements pour les calibrer (4 classements non nuls, profondeurs maximales de 5 à 279 m). Un joueur qui joue moins que le profil « occasionnel » (par exemple 2 × 10 min) se situe en dessous de ses chiffres.

## D (03/11 après-midi). SHA, tests, déploiement

- Branche `feature/39-collections-saisonnieres`, commit `24e390e`. Intégration dans `develop` : **`7e7c885`** (arbre identique à la branche testée).
- **Tests automatiques**
  - `npm test` **545/545** sur la branche, sur `develop` et sur la release `7e7c885`.
  - Nouveaux tests :
    - `test/event-item-sheet.test.js` : clic → fiche, plus de description sous la carte, focus rendu, espacement du panneau, libellé « Terminé le » dans 4 langues. Il échoue sur l'ancien code.
    - `test/collection-drop-sim.test.js` : barème du brouillon, reproductibilité, crochet sans effet sur #49.
  - Un premier passage a signalé l'italien à 99,8 % (nouvelle clé) : corrigé avant intégration.
- **Essai navigateur** (`test/e2e/event-item-sheet.e2e.js`, serveur de test 3101, `/api/events` simulé avec « Caillou de test »), 1280×900 et 390×844 :
  - aucun chevauchement des titres et cartes, aucune description sous la carte, pas de défilement horizontal ;
  - fiche entièrement visible, contenu attendu ;
  - Échap ferme la fiche et rend le focus à la carte ;
  - 0 erreur JS.
  
  Le chevauchement avait été reproduit avant la correction.
- **Copie de la base de production** : empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` identiques avant et après démarrage de la release. Copie supprimée.
- **Avant le déploiement** : aucune génération IA en cours (dernière activité de l'atelier à 12:56 UTC).
- **Déploiement** : `deploy.sh` OK (7c0b521 → 7e7c885). Sauvegarde vérifiée : `dig-20261103-150644-pre-deploy-7e7c885.sqlite`.
- **Après le déploiement** :
  - dig.lodygames.com et dig.lodylands.com répondent 200 avec la version `1.0.0+7e7c885` ;
  - `quick_check` = ok, journal sans erreur ;
  - empreintes joueurs identiques à la sauvegarde pré-déploiement ;
  - le `main.js` servi contient la correction.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 7c0b521` puis `sudo systemctl restart dig`. Aucune migration.
- **Non fait** : essai navigateur sur la production avec un vrai compte qui possède un souvenir.

## E (03/11 après-midi). Test fonctionnel à faire par le propriétaire

1. En jeu, sur PC puis sur smartphone : Collection (Ctrl+F5 si besoin). Dans « 🎉 Événements », le titre « Souvenirs d'événements » puis « 🧪 Événement test · 1 » sont bien séparés, au-dessus de la carte « Caillou de test ».
2. Cliquer sur « Caillou de test ». Une fenêtre centrée s'ouvre avec :
   - 🪨 en grand ;
   - le badge « COMMUN » ;
   - « Caillou de test » ;
   - « 🧪 Événement test · Terminé le … » ;
   - « Trouvé le … » ;
   - l'histoire.
   
   Aucun texte n'apparaît sous la carte.
3. Fermer avec « Fermer », Échap ou un clic à l'extérieur. On retrouve la grille, et la carte garde le focus au clavier.
4. Barème : lire le tableau de la section C et choisir (question 3 ci-dessous).

## F (03/11 après-midi). Choix techniques faits seul

- **Une seule fenêtre pour la collection et les événements**, plutôt qu'une seconde fenêtre : même présentation, même accessibilité, moins de code.
- **Simulation construite sur le simulateur #49** plutôt qu'un nouveau modèle de joueur : chiffres cohérents avec l'audit économique, et les deux évoluent ensemble.
- **Même flux de blocs pour tous les barèmes** : la comparaison ne dépend pas du hasard du joueur simulé.
- **Barème « accessible »** (légendaire dès 60 m) étudié puis écarté : il n'aide pas les joueurs lents, car la limite vient du nombre de gemmes croisées, pas de la profondeur.

## G (03/11 après-midi). Décisions demandées au propriétaire

1. Rattacher « Les Objets trouvés de la Légende » à la semaine 2026-W47 ? Recommandation : oui (W46 = Saint-Martin).
2. Reporter « Trésors de la vieille mine » (saison en cours, fin 08/11, incomplète) sur une semaine future, par exemple 2026-W48 ? Recommandation : oui.
3. **Barème Saint-Martin** (section C) : **(a) Progressif — recommandé** (communs 4 %, légendaire 3 % par gemme dès 100 m, le reste inchangé) ; (b) brouillon actuel (plus généreux : légendaire presque garanti dès 1 h par jour) ; (c) Exigeant. Après le choix, une session applique les taux dans le brouillon, active les drops et prépare la publication ciblée, **sans publier sans votre feu vert**.
4. Objets d'une saison terminée : plus jamais obtenables (exclusivité) ? Recommandation : oui. Afficher en grisé ceux qui n'ont pas été trouvés ? Recommandation : oui.

## H (03/11 après-midi). Restant à réaliser

- **Bloquant pour W46** : appliquer le barème choisi, activer les drops et publier la série (après décision 3).
- **Après lancement** : faire vérifier par le serveur les drops de collection (comme les événements #56) pour empêcher un client modifié de s'attribuer des objets.

# Mise à jour du 03/11/2026, 12 h 55 (Bruxelles) — aperçu de la fiche objet : saison future au lieu de « Permanente »

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite la recette du propriétaire du [03/11 à 11:21 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6602490144), qui porte sur la fiche de « La lanterne en betterave ». La recette croisée #39/#40 de [11:30 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6602662639) valide l'illustration enregistrée dans le brouillon et ne demande aucun changement.

## A (03/11 midi). État réel

**Déployé en production (SHA `6b54ba7`) — en attente de recette.** Classement : **Après lancement**. C'est un défaut d'affichage dans l'admin, sans effet sur le jeu, mais il pouvait faire croire qu'une série future tomberait chaque semaine.

## B (03/11 midi). Cause et correction

- **Cause.** L'aperçu latéral de la fiche objet (`#co-preview-series`) appelait `coSeasonLabel(s.seasonId)` sans transmettre `seasonWeek`. Une série rattachée à une semaine future a `seasonId = null` : l'aperçu la présentait donc comme « Permanente (aucune saison) ». Les autres écrans (liste des séries, relecture, contrôle de publication) transmettaient déjà la semaine.
- **Correction** (`public/admin/admin.js`, une ligne) : l'aperçu transmet `seasonWeek`. Pour la Saint-Martin, il affiche maintenant « 🗓️ Saison future 2026-W46 … « La Saison des Lanternes » ».
- **Test de non-régression** (`test/collection-season-week.test.js`) :
  - le libellé d'une série future ne contient jamais « Permanente » ;
  - aucun appel de `coSeasonLabel` dans `admin.js` ne se fait sans la semaine.
  
  Ce test échoue sur l'ancien code et passe sur le nouveau.
- **Aucune donnée modifiée** : pas de saison créée, rien publié, aucun drop activé, aucune donnée joueur touchée. Vérification en lecture seule en production : la série `tresors_saint_martin` a toujours `seasonId = null` et `seasonWeek = 2026-W46` dans le brouillon, avec ses 6 objets.

## C (03/11 midi). SHA, tests, déploiement

- Branche `feature/39-collections-saisonnieres`, commit `e389fe5`. Intégration dans `develop` : `6b54ba7`.
- `npm test` : **528/528** sur la branche, sur `develop` et sur la release `6b54ba7`.
- **Copie de la base de production** :
  - empreintes identiques avant et après démarrage pour `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` ;
  - `/health` ok et `/api/version` = `1.0.0+6b54ba7` ;
  - copie supprimée ensuite.
- **Avant le déploiement** : aucune génération IA en cours (dernier appel à 11:23 UTC).
- **Déploiement** : `d37b478 → 6b54ba7` par `scripts/deploy.sh`.
  - Sauvegarde vérifiée : `~/backups/dig/dig-20261103-125314-pre-deploy-6b54ba7.sqlite`.
  - dig.lodygames.com et dig.lodylands.com répondent 200, `/api/version` = `1.0.0+6b54ba7`.
  - Journal sans erreur, `quick_check` = ok, nombres de lignes joueurs inchangés.
  - Le fichier `admin.js` servi contient bien la correction.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep d37b478`, puis `sudo systemctl restart dig`.
- **Non vérifié** : pas d'essai navigateur connecté à l'admin (cela demande une session admin). La correction est couverte par le test.

## D (03/11 midi). Test fonctionnel à faire par le propriétaire

1. Ouvrir Admin → 📿 Collections et faire Ctrl+F5.
2. Ouvrir la fiche de « La lanterne en betterave ».
3. Résultat attendu : l'aperçu latéral affiche « 🎃… Les Trésors de la Saint-Martin · 🗓️ Saison future 2026-W46 … « La Saison des Lanternes » », et non plus « Permanente (aucune saison) ».
4. Le compteur d'illustrations 1/6 évoqué dans la recette croisée pourra être relevé lors de la même visite (facultatif).

## E (03/11 midi). Choix techniques, décisions, restant

- Correction minimale, dans le périmètre de la recette : affichage uniquement.
- Le point UX sur les prompts très longs relève de #40 et n'est pas traité ici.
- **Décisions demandées** : les questions 1 à 4 des sections précédentes restent ouvertes, sans changement :
  1. rattacher « Objets trouvés de la Légende » à W47 ;
  2. reporter « Trésors de la vieille mine » sur une semaine future ;
  3. valider le barème des drops ;
  4. exclusivité des objets d'une saison terminée et affichage en grisé.
- **Restant** : publication de la série Saint-Martin avant le 09/11, sur décision du propriétaire. Les drops restent inactifs d'ici là.

# Mise à jour du 03/11/2026, 11 h 25 (Bruxelles) — rattachement à une saison future (2026-W46), Rafraîchir visible

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite les deux recettes du propriétaire du 03/11 : [#39 (09:35 UTC)](https://github.com/ReC82/Dig/issues/39#issuecomment-6600141959) (lecture du brouillon ; « Saint-Martin » est « Permanente » alors qu'elle est prévue pour la prochaine saison ; améliorations UX) et [#39-B (09:42 UTC)](https://github.com/ReC82/Dig/issues/39#issuecomment-6600264412) (saison future introuvable dans le choix de saison ; bouton Rafraîchir sans retour visible).

## A (03/11 matin). État réel

**Déployé en production (SHA `3ba07c6`) — en attente de recette.** Classement : **Bloquant MVP** pour le rattachement, à faire avant la rotation du 09/11 (sans lui, la collection de la saison des Lanternes ne pouvait pas être publiée correctement). L'UX de Rafraîchir et l'allègement de la section relèvent de **Après lancement**.
- **Rien n'a été publié** : le catalogue en jeu est toujours la v1 (1 série, 8 objets). Aucun drop n'a été activé, aucune saison n'a été créée, aucune illustration n'a été touchée.
- **Une seule écriture en production**, dans le brouillon admin et non dans les données joueurs : au démarrage, la série « Les Trésors de la Saint-Martin » a été rattachée à la semaine **2026-W46**, celle de son thème préparé « La Saison des Lanternes ». L'écriture est tracée dans le journal des collections (`draft_update_series`) et dans le journal des thèmes (`series_week`). Elle n'est faite qu'une fois : si l'admin choisit ensuite autre chose, ce choix n'est jamais écrasé.
- « Les Objets trouvés de la Légende » n'a pas été modifiée (question 1 toujours en attente). Elle peut maintenant être rattachée à 2026-W46 ou 2026-W47 sans programmer de saison.

## B (03/11 matin). Changements

Fichiers modifiés : `server/collectionCatalog.js`, `server/collectionAi.js`, `server/seasonThemes.js`, `public/admin/admin.js`, `public/admin/index.html`, ainsi que le nouveau test `test/collection-season-week.test.js`.

**Rattachement à une saison future par clé de semaine** (`seasonWeek`, semaine ISO « 2026-W46 ») :
- **Identité stable.** Une série porte soit `seasonId` (saison existante, comme avant), soit `seasonWeek` (saison pas encore créée). Si les deux sont présents, `seasonId` l'emporte. La semaine est validée : format, et existence de la semaine 53 selon l'année. Les séries existantes et les versions publiées ne changent pas : le champ est absent quand il n'est pas utilisé.
- **Résolution automatique, à la lecture.** La saison réelle d'une semaine est d'abord celle à laquelle le thème #48 de cette semaine a été attaché, sinon la première saison qui commence dans la semaine (lundi 00:00 → dimanche 23:59:59 UTC). Les versions publiées ne sont jamais réécrites. Le rattachement reste stable ensuite.
- **Aucun drop hors fenêtre.**
  - Tant que la saison n'existe pas, la série et ses objets sont **retirés du catalogue public**. Ils ne sont ni visibles ni obtenables, même pour un client ancien ou mis en cache. Cela évite qu'un tel client les prenne pour des objets « permanents ».
  - Dès que la saison existe, le catalogue public expose `seasonId` = cette saison. Le jeu applique alors sa règle habituelle : drops pendant cette saison seulement, archives ensuite.
- **Interopérabilité avec #48.**
  - Les nouveaux packs de saison importent leur collection directement rattachée à la semaine de leur thème.
  - À l'ouverture de la saison, le rattachement de #48 (`_linkSeries`) transforme la semaine en `seasonId` dans le brouillon, si la série n'est pas publiée. Une semaine choisie par l'admin pour une autre saison est respectée.
  - Les thèmes préparés avant ce changement, comme celui de Saint-Martin, sont corrigés une seule fois.
- **Publication ciblée.** Une série rattachée à une semaine future n'est plus « Permanente » : il n'y a pas de confirmation de permanence à donner. Elle peut être publiée **à l'avance** une fois complète : illustrations, 4 langues, et drops activés avec la case « barème validé ». Elle reste invisible jusqu'au lundi.
  - Si la semaine est passée sans qu'une saison ait été créée, la publication est bloquée.
  - Si la semaine a commencé mais que la rotation n'est pas encore passée, un simple avertissement s'affiche.
- **Admin, choix de la saison** (fiche Série et fiche de relecture IA) : trois groupes sont proposés.
  - « Permanente » ;
  - « **Saisons futures (pas encore créées)** » : les 8 prochaines semaines, avec le nom du thème préparé (ex. « 🗓️ 2026-W46 (semaine du 09/11/2026) — « La Saison des Lanternes » (thème préparé) ») ;
  - « Saisons existantes ».
- **Admin, liste des séries et contrôles** : la carte affiche « 🗓️ Saison future (pas encore créée) 2026-W46 » et explique ce qui se passera.

**Rafraîchir (Collections)** : le bouton reprend le comportement de la bêta #57.
- Pendant le chargement : « ↻ Actualisation… », bouton désactivé.
- Ensuite : « ✓ Données à jour à HH:MM:SS » et un toast, ou « ⚠️ Échec de l'actualisation (…) » avec l'heure des données affichées.
- Les données sont relues depuis la base (requête sans cache).
- Recherche, filtres et état des cartes sont conservés. Il n'y a aucune fenêtre native.

**Section « Brouillon et publication » allégée** :
- Une ligne repliée par série résume la saison, les illustrations x/6, les drops x/6 et le nombre de points bloquants.
- Le détail des 21 changements est replié.
- « Publier tout le brouillon », « Abandonner » et « Publier quand même des séries incomplètes » sont rangés dans un bloc replié « Publication globale et abandon (déconseillé) ».
- Le texte d'aide distingue la **préparation** (saison, illustrations, langues) de la **validation économique** (drops, « barème validé »).

## C (03/11 matin). SHA, branche, procédure de test

- Branche `feature/39-collections-saisonnieres` : commit `bcd0c9b`. Sur `develop` : merge `3ba07c6`, **déployé**.
- Tests automatisés : `npm test` → **521/521** sur la branche, sur develop `3ba07c6` et sur la release. Le nouveau test `test/collection-season-week.test.js` rejoue la production du 03/11 :
  1. la série du thème W46 est rattachée à sa semaine, une seule fois, sans écraser un choix de l'admin ;
  2. la semaine est proposée avec le nom de son thème ;
  3. la série complète est publiée seule **avant** le 09/11 : absente du catalogue public et sans drop ;
  4. rotation du 09/11 : résolue en saison 46, sans nouvelle version publiée ; drops en saison 46 et aucun pour un joueur encore en saison 45 ;
  5. rotation du 16/11 : la série passe en archives, sans drop, et son rattachement reste stable ;
  6. semaine sans thème, semaine passée bloquante, priorité du `seasonId`, semaine 53.
- Serveur de test (port 3101, copie de la base de production) :
  - Saint-Martin est rattachée à W46 au démarrage ;
  - contrôles : Saint-Martin « future » avec 2 manques (illustrations, drops), plus de blocage « Permanente » ;
  - le choix de saison est pré-rempli sur W46 ;
  - un PUT avec `2026-W47` est accepté et un PUT avec `2026-W60` est refusé (400) ;
  - le catalogue public est resté v1.
- Chromium 1280×900 et 390×844 tactile, sur le même serveur : Rafraîchir affiche « Actualisation… », puis « ✓ Données à jour à … » et le toast. Le filtre saisi est conservé. Aucune écriture, aucune fenêtre native, 0 erreur JS.
  - Limite : la console signale une ressource 404 sur ordinateur, sans requête réseau correspondante. Elle n'est pas liée à ce lot.

## D (03/11 matin). Déploiement

- Copie de la base de production démarrée en `NODE_ENV=production` : santé ok, version `1.0.0+3ba07c6`, catalogue public v1. Les empreintes des tables `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` sont identiques, ainsi que la dernière version publiée. `quick_check` ok. Copie supprimée.
- Aucune génération IA en cours avant le déploiement (dernier appel de l'atelier le 02/11 23:25 UTC).
- `scripts/deploy.sh` de la release : d2a49fc → `3ba07c6`, sauvegarde vérifiée `dig-20261103-112109-pre-deploy-3ba07c6.sqlite`, santé et version ok.
- Après le déploiement :
  - les 2 domaines répondent 200 avec `1.0.0+3ba07c6` ;
  - l'admin sans clé répond 401 ;
  - le journal est propre (seule ligne : rattachement de Saint-Martin) ;
  - `quick_check` ok ;
  - les empreintes joueurs sont **identiques** à la sauvegarde ;
  - le catalogue public est v1 ;
  - Chromium sur la production (jeu 1280 et 390, page admin) : 0 erreur JS.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep d2a49fc` puis `sudo systemctl restart dig`. Il n'y a pas de migration de schéma. Le champ `seasonWeek` est ignoré par l'ancien code ; Saint-Martin y redeviendrait « Permanente » non publiée, ce qui est sans risque puisque rien n'est publié.

**Test fonctionnel à faire par le propriétaire (3 min, sans rien publier)**
1. Admin → 📿 Collections → **↻ Rafraîchir**. **Attendu** : « Actualisation… », puis « ✓ Données à jour à HH:MM:SS » et un toast ; la recherche saisie reste en place.
2. « Brouillon et publication ». **Attendu** : 3 lignes repliées. Saint-Martin affiche « 🗓️ Saison future (pas encore créée) 2026-W46 · 0/6 illustré(s) · 0/6 drop(s) actif(s) · ❌ 2 point(s) » ; elle n'est plus « Permanente ». Le détail des 21 changements et la publication globale sont repliés.
3. Ouvrir la série Saint-Martin **sans enregistrer**. **Attendu** : Saison = « 🗓️ 2026-W46 (semaine du 09/11/2026) — « La Saison des Lanternes » (thème préparé) », dans le groupe « Saisons futures ».
4. Le lundi 09/11 après 00:00 UTC (01:00 à Bruxelles) : la carte Saint-Martin passe en « 🟢 Saison en cours Saison 46-2026 ». Si les objets ne sont pas publiés, rien ne change en jeu.

## E (03/11 matin). Choix techniques faits seul

- **Résolution à la lecture plutôt que réécriture.** Les versions publiées sont en ajout seul (garantie #39). Réécrire `seasonId` dans une version publiée aurait obligé à publier automatiquement une nouvelle version. La résolution est déterministe : thème #48 d'abord, puis première saison de la semaine.
- **Retrait du catalogue public tant que la saison n'existe pas**, plutôt qu'un marqueur : les anciens clients traitent `seasonId: null` comme « permanent ». Le retrait est la seule garantie de zéro drop hors fenêtre, quel que soit le client.
- **Correction de Saint-Martin** : appliquée automatiquement, car la série appartient au thème W46 (#48) et le propriétaire a demandé de « corriger le rattachement avant toute activation ». Elle reste dans le brouillon, est tracée et n'est faite qu'une fois.
- **Boîtes de confirmation natives** : celles des autres actions de Collections (publier, retirer) ne sont pas remplacées ici. C'est l'objet du ticket #60 (uniformisation de l'admin).

## F (03/11 matin). Décisions demandées au propriétaire

1. Rattacher « Les Objets trouvés de la Légende » à une semaine future (choix désormais direct dans la fiche Série, sans programmer de saison) ? Recommandation : **2026-W47** (semaine du 16/11), puisque W46 revient à Saint-Martin, la collection de son thème.
2. « Trésors de la vieille mine » (saison en cours, fin le 08/11, 4 illustrations manquantes, drops inactifs) : la reporter sur une semaine future ? Recommandation : **oui**, par exemple 2026-W48.
3. Barème des drops saisonniers (proposé précédemment : 2 communs à 3 % dès 5 m, 2 rares à 1,5 % dès 40 m, 1 épique à 8 % sur coffre dès 60 m, 1 légendaire à 5 % sur gemme dès 100 m) ? Recommandation : **oui**.
4. Objets d'une saison terminée : obtenables plus tard ? Recommandation : **non** (exclusivité). Les non trouvés révélés en grisé ? Recommandation : **oui**.

## G (03/11 matin). Restant à réaliser

- Illustrer les 6 objets de Saint-Martin (atelier #40), puis activer les drops et publier la série seule avant ou pendant la semaine 46. Cela reste à l'initiative du propriétaire.
- Ticket #60 (après lancement) : remplacer les confirmations natives restantes et uniformiser les autres boutons Rafraîchir.

---

# Mise à jour du 03/11/2026, 02 h 25 (Bruxelles) — cohérence des collections : publication ciblée par série, statut « Permanente » expliqué

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite le commentaire du propriétaire du [02/11 à 23:32 UTC « Nuit 03/11 — cohérence des collections »](https://github.com/ReC82/Dig/issues/39#issuecomment-6591199266) : ne pas publier le brouillon global ni activer de drops, ne pas effacer les illustrations validées, expliquer le statut « Permanente » des « Objets trouvés de la Légende », proposer un rattachement à une future saison (sans le faire), et préparer une publication atomique ciblée pour la saison sans exposer les séries incomplètes.

## A (03/11). État réel

**Déployé en production (SHA `abd53af`) — en attente de recette.** Classement : **Après lancement** (outil d'administration ; aucun effet sur les joueurs tant que rien n'est publié).
- **Rien n'a été publié** : la version des collections en jeu est toujours la v1 (8 objets d'origine). Le brouillon de production est intact (empreinte identique avant et après le déploiement). Aucun drop activé, aucune image générée, aucune illustration retirée, aucune saison créée.
- Le déploiement met aussi en ligne les commits de rapport #33 déjà dans develop (documentation seule).

## B (03/11). Diagnostic — pourquoi « Permanente » ?

Dans le brouillon de production, il y a deux séries nouvelles (plus la série d'origine) :

| Série | Saison | Illustrées | Drops actifs | Publiable seule ? |
|---|---|---|---|---|
| ⛏️ Trésors de la vieille mine | n° 8 « Saison 45-2026 » (en cours, fin dim. 08/11 23:59 UTC) | 2/6 | 0/6 | Non : 4 illustrations manquantes, drops inactifs |
| 🧳 Les Objets trouvés de la Légende | **aucune → « Permanente »** | 1/6 (culotte de Dagobert) | 0/6 | Non : pas de saison, 5 illustrations manquantes, drops inactifs |

**Explication** : « Permanente » est simplement l'affichage d'une série **sans saison** (`seasonId` vide). La collection a été importée ainsi exprès le 02/11 : le rattachement à une saison est une décision métier, et **aucune saison future n'existait** dans la base. Les saisons hebdomadaires ne sont créées qu'à leur ouverture (lundi 00:00 UTC), sauf si l'admin en programme une à l'avance (onglet Saisons, statut « programmée »). Le formulaire de série ne propose que des saisons existantes, donc la seule option possible était « Permanente ».

**Risque** : publiée telle quelle, une série permanente fait tomber ses objets **chaque semaine, sans fin**, comme la collection des origines. Ce serait contraire à l'idée « une collection unique par saison ». Ce risque est maintenant bloqué : voir C.

**Proposition de rattachement (non appliquée, décision demandée)** : la rattacher à la **saison du lundi 09/11 au dimanche 15/11 (semaine 46)**, en la programmant dans l'onglet Saisons. Une série rattachée à une saison programmée reste **invisible et sans drop** jusqu'à l'ouverture de la saison, puis tombe automatiquement pendant la semaine. Vérifié sur une copie de la base : la rotation active bien la saison programmée à sa date.

## C (03/11). Changements

Fichiers : `server/collectionCatalog.js`, `server/index.js`, `public/admin/admin.js`, `public/admin/index.html`, `public/admin/admin.css`, `test/collection-catalog.test.js`.

1. **Contrôle de complétude par série** (`seriesReadiness`). Chaque série touchée par le brouillon reçoit un état. Les **points bloquants** (en rouge) sont :
   - nouvelle série sans saison (« Permanente ») tant que ce n'est pas confirmé ;
   - saison terminée ;
   - aucun objet activé ;
   - nouvel objet sans illustration ;
   - nom ou histoire manquant dans une des 4 langues (FR/EN/NL/ES) ;
   - aucun drop activé (les objets seraient visibles mais introuvables).

   Il y a aussi des **avertissements** (illustration déjà publiée qui serait retirée ou remplacée, objets au drop inactif) et des **informations** (« Saison programmée : invisible jusqu'au … puis drops jusqu'au … », « Saison en cours : visible dès la publication »).
2. **Publication ciblée d'une série** (`POST /api/admin/collections/series/:id/publish`). La nouvelle version contient la version en vigueur, plus **cette série et ses objets seuls**. Les autres séries restent dans le brouillon, invisibles des joueurs, et le brouillon passe sur la nouvelle version. Tout se fait dans une seule transaction (atomique). La publication est refusée si la série est incomplète ou si la version a changé entre-temps. Il faut aussi cocher « barème validé » pour des drops nouveaux, et « série permanente voulue » pour une nouvelle série sans saison. Chaque publication est tracée au journal (`publish_series`) et peut être annulée par le retour arrière existant.
3. **Publication globale protégée** : « Publier tout le brouillon » est maintenant **refusé** si une série touchée est incomplète. Le message renvoie vers la publication ciblée. Une case explicite « Publier quand même des séries incomplètes (déconseillé) » permet de passer outre, et le choix est tracé au journal.
4. **Admin → 📿 Collections → Brouillon et publication** : nouveau bloc « **Publication ciblée — une série à la fois** ». Une carte par série montre la saison, le nombre d'objets illustrés et de drops actifs, puis ✅ prête ou ❌ n points à régler. Elle donne la liste des manques, les cases à cocher utiles et le bouton « **Publier cette série seule** » (désactivé tant que la série est incomplète). Autres changements :
   - le bouton global s'appelle « Publier tout le brouillon » ;
   - le libellé devient « Permanente (aucune saison) » ;
   - la fiche série explique ce que veut dire une saison vide ou programmée ;
   - « Abandonner le brouillon » indique combien d'illustrations appliquées à des objets non publiés seraient retirées du brouillon (les images restent dans l'atelier).

## D (03/11). SHA, branche, procédure de test

- Branche `feature/39-collections-saisonnieres`, commit `d74d463`. **develop `abd53af`** (fusion), déployé `abd53af`.
- Tests : `npm test` → **451/451** sur la branche, sur develop `abd53af` et sur la release. Nouveau test « publication ciblée » : états bloquants (Permanente, drops, illustrations, langues), refus de la publication ciblée et de la publication globale sur une série incomplète, rattachement à une saison programmée, barème exigé, version périmée refusée, seule la série visée est publiée, reste du brouillon rebasé, journal, côté jeu (série masquée et sans drop avant sa saison, drops à l'ouverture), alerte de retrait d'une illustration publiée, série permanente confirmée, brouillon supprimé quand il ne reste rien. Les tests de publication existants ont été adaptés à la nouvelle protection.

## E (03/11). Vérifications, limites, données joueurs

- **Copie de la base de production, serveur de test 3101** :
  - les deux séries apparaissent ❌ avec les manques exacts (tableau B) ; publication globale → 409 (séries incomplètes) ; publication ciblée de « Trésors » → 409 ;
  - **recette simulée de bout en bout** : saison 46 programmée du 09/11 au 15/11, « Objets trouvés » rattachée, illustrations factices, drops activés → refusée sans barème, puis **publiée seule** (v2). Le catalogue public contient alors origines + Objets trouvés (saison programmée), mais pas « Trésors », qui reste dans le brouillon rebasé sur v2. Cette copie a ensuite été supprimée ;
  - Chromium 1280 et 390 tactile : bloc rendu correctement, boutons désactivés, **0 écriture**, aucune erreur JS (un 404 de ressource, image de l'atelier absente du serveur de test).
- **Limites** :
  - une série publiée à l'avance pour une saison programmée figure dans `/api/collections/catalog` (lisible par un curieux), mais n'est ni affichée ni obtenable en jeu avant l'ouverture ;
  - les manques d'objets **déjà publiés** (ex. origines sans illustration) ne bloquent pas, puisqu'ils sont déjà en jeu.
- **Données joueurs** : aucune migration ni nouvelle table. Empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` et des tables de collections identiques avant et après le démarrage sur la copie, puis entre la sauvegarde pré-déploiement et la production.

## F (03/11). Déploiement

- **Déployé `abd53af`** (avance rapide de `main` `aeeb5e8` → `abd53af`, `scripts/deploy.sh` de la release). Sauvegarde vérifiée : `dig-20261103-021559-pre-deploy-abd53af.sqlite`.
- Avant le déploiement, aucune génération IA n'était en cours (dernière activité de l'atelier à 23:26 UTC).
- Après le déploiement :
  - dig.lodygames.com et dig.lodylands.com → 200, version `1.0.0+abd53af` ;
  - admin et nouvelle route de publication sans clé → 401 ;
  - journal propre, `quick_check` ok, empreintes identiques à la sauvegarde ;
  - catalogue public toujours v1 ;
  - Chromium sur la production (jeu + admin, 1280 et 390) : nouveau bloc présent, aucune erreur JS.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep aeeb5e8` puis `sudo systemctl restart dig`. Pas de dépendance ni de schéma modifié.

### Test fonctionnel à faire par le propriétaire (3 minutes)
1. Admin → 📿 Collections → section « Brouillon et publication ». **Attendu** : bloc « Publication ciblée » avec deux cartes ❌ : « Trésors de la vieille mine » (4 illustrations, drops) et « Les Objets trouvés de la Légende » (♾️ Permanente, 5 illustrations, drops). « Publier cette série seule » est grisé.
2. Cliquer « Publier tout le brouillon », puis confirmer. **Attendu** : refus « Le brouillon contient des séries incomplètes… » avec la liste des manques, et **rien de publié** (bandeau toujours « v1 »).
3. Ouvrir la série « Les Objets trouvés de la Légende » : le texte sous les champs explique « Permanente ».

### Recette de publication ciblée (à faire seulement après vos décisions)
1. Onglet **Saisons** : programmer la saison du lundi 09/11 00:00 au dimanche 15/11 23:59:59 UTC (statut « programmée »).
2. Fiche série « Objets trouvés » : choisir cette saison → la carte affiche 🗓️ « Saison programmée ».
3. Illustrer les 5 objets restants dans l'atelier (#40). La carte suit la progression (x/6 illustré(s)).
4. Après validation du barème : activer le drop des 6 objets.
5. La carte passe à ✅. Cocher « Barème validé », puis cliquer « **Publier cette série seule** ». « Trésors » reste en brouillon.
6. Contrôle : en jeu cette semaine, rien de visible ; lundi 09/11, la série apparaît et ses objets tombent.

Annulation : « Versions publiées → Revenir à v1 » (la série et ses objets sont désactivés, les objets déjà trouvés sont conservés).

## G (03/11). Choix techniques faits seul

- **Illustration obligatoire** pour publier un nouvel objet : vous voulez des collections illustrées et l'atelier (#40) est là pour ça. Les objets déjà publiés ne sont pas concernés.
- **Drops inactifs = série incomplète** : sinon les joueurs verraient des « ? » impossibles à obtenir.
- **Publication globale refusée par défaut** si une série est incomplète. Les tests existants ont été adaptés avec l'acceptation explicite.
- **Je n'ai rien rattaché, programmé ni publié** : ce sont des décisions métier.

## H (03/11). Décisions demandées au propriétaire

1. **Objets trouvés de la Légende → saison du 09–15/11 (semaine 46)**, programmée dans l'onglet Saisons ? Recommandation : **oui**. Autre option : la garder pour un thème plus tard (#48).
2. **Trésors de la vieille mine** est rattachée à la saison en cours, qui finit dimanche 08/11 avec 4 illustrations manquantes et des drops inactifs. Recommandation : **la reporter sur une saison suivante (semaine 47)** plutôt que la publier en fin de semaine. Si rien n'est fait, après le 08/11 elle sera bloquée (« saison terminée »).
3. Barème des drops saisonniers (question déjà posée) : 2 communs à 3 % dès 5 m, 2 rares à 1,5 % dès 40 m, 1 épique à 8 % sur coffre dès 60 m, 1 légendaire à 5 % sur gemme dès 100 m. Recommandation : oui.
4. Objets d'une saison terminée obtenables plus tard ? Recommandation : non (exclusivité). Révéler en grisé les objets non trouvés d'une saison finie ? Recommandation : oui.

## I (03/11). Restant à réaliser

- Illustrations des objets manquants (#40, atelier) : 5 pour « Objets trouvés », 4 pour « Trésors ».
- Publication programmée automatique au démarrage de la saison et annonce J-1 : à faire dans #48 et #50 (la publication ciblée en est la brique).
- Après lancement : un aperçu « vue joueur » d'une série avant publication.

---


# Mise à jour du 02/11/2026, 23 h 59 (Bruxelles) — ligne éditoriale humoristique et nouvelle collection en brouillon (directive du 02/11 au soir)

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite deux commentaires du propriétaire du 02/11 :
- [21:41 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6589165584) : **directive éditoriale durable**. Les collections doivent être absurdes mais ancrées dans une certaine réalité (humour, folklore, histoire, cinéma, sketches). Les clins d'œil doivent être originaux et variés, chaque objet doit avoir sa micro-histoire et sa propre description visuelle. Pas de faux faits historiques présentés comme vrais. Les œuvres protégées sont évoquées, jamais reproduites. Il faut aussi des contrôles de qualité, et rien n'est publié automatiquement.
- [22:12 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6589763613) : **priorité de nuit**. Créer une nouvelle collection de ce type en brouillon (FR/EN/NL/ES, histoires, consignes d'illustration uniques), sans activer les drops ni publier, et préparer les images pour une revue demain.

## A⁗. État réel

**Déployé en production (SHA `06ca5ba`) — en attente de recette.** Classement : **Après lancement** (contenu et outil d'administration, sans effet sur les joueurs tant que rien n'est publié).
- La collection « **Les Objets trouvés de la Légende** » est dans le **brouillon** des collections de la production : 6 objets, statut « Brouillon — non publié », drops inactifs.
- Aucune image n'a été générée et rien n'a été publié (version publiée toujours v1).
- Ce déploiement met aussi en ligne le lot #37 déjà intégré dans develop (fiche bloc : annulation par bloc, sections, aide, traductions IA). Il attendait un déploiement à cause d'une course dans un test, sans lien avec #37 : les tests passent maintenant à 424/424 sur le SHA exact.

## B⁗. Changements

Fichiers : `server/collectionAi.js`, `server/index.js`, `server/content/collections/objets-trouves-legende.json` (nouveau), `public/admin/admin.js`, `test/collection-ai.test.js`, `test/collection-catalog.test.js`.

1. **Ligne éditoriale dans le prompt IA des collections**. Le bouton ✨ « collection avec l'IA » suit maintenant votre directive :
   - Objets absurdes mais reconnaissables, ancrés dans le folklore, l'histoire, le cinéma, les sketches, les chansons, la BD ou les traditions du thème. Vos exemples sont donnés comme intention, pas à recopier.
   - Une **référence différente par objet**, si possible d'un type de source différent.
   - Faits réels seulement s'ils sont vrais ; toute anecdote inventée est présentée comme une légende (« on raconte que… », conditionnel).
   - Œuvres protégées : évocation ou parodie de la situation ou de l'objet. Jamais de marque, de personnage dessiné ou de plan de film recopié, et on évite de nommer des personnes vivantes.
   - Histoires : 2 à 3 phrases avec une chute, une blague propre à chaque objet.
   - Consigne d'image concrète (silhouette, forme, matière, couleurs, un détail drôle), une **silhouette différente par objet**, aucun texte dans l'image.
   - Deux nouveaux champs : **« Clin d'œil »** (pour chaque objet, la référence visée, pour la relecture) et une **relecture synthétique** de l'IA (variété, humour, références sensibles, objet faible à améliorer).
   - L'ancien prompt interdisait tout personnage ou personne réelle, ce qui empêchait « la culotte du roi Dagobert ». Cette règle est remplacée par la règle d'évocation ci-dessus.
2. **Contrôles de qualité automatiques** (alertes dans la relecture d'une proposition, avant l'enregistrement au brouillon) :
   - consignes d'illustration **très proches** (mots en commun ≥ 50 %, en plus des consignes strictement identiques déjà signalées) ;
   - histoires FR très proches (≥ 45 %) ;
   - noms FR en double ;
   - clin d'œil manquant pour une partie des objets.
   
   L'humour ne se mesure pas automatiquement : la relecture IA et vous en jugez.
3. **Relecture d'une proposition** (Admin → 📿 Collections → ✨ Propositions IA) : la relecture synthétique s'affiche sous le nom de la série. La fiche de chaque objet montre le champ « Clin d'œil (référence, pour la relecture) », modifiable et conservé quand on enregistre des corrections.
4. **Collection préparée livrée avec le code** (`server/content/collections/*.json`). Au démarrage, chaque collection préparée est importée **une seule fois** :
   - elle devient une proposition (n° 2 en production), puis elle est enregistrée dans le **brouillon** ;
   - les drops restent inactifs, l'image est vide et la consigne d'illustration de chaque objet est transmise à l'atelier ;
   - si vous la modifiez ou la supprimez ensuite, elle n'est **jamais réimportée** ;
   - si un identifiant est déjà pris, elle reste une proposition ouverte à corriger ;
   - l'import est désactivé en test (`NODE_ENV=test` ou `DIG_PREPARED_COLLECTIONS=0`).

### La collection « Les Objets trouvés de la Légende » 🧳

Thème : le bureau des objets trouvés de l'Histoire et du folklore. Ce sont des objets égarés par des rois de chanson, des carnavaliers, des chevaliers de cinéma ou des bricoleurs trop passionnés, et déterrés couche après couche. La série n'est rattachée à aucune saison : elle s'affiche « Permanente » dans la liste, et la saison se choisit avant publication (voir #48).

| Objet (FR) | Rareté | Clin d'œil | Image (silhouette) |
|---|---|---|---|
| 🍊 L'orange perdue d'un Gille | Commun | Folklore belge : carnaval de Binche, les Gilles lancent des oranges | orange cabossée, deux feuilles, un peu de terre |
| 🩲 La culotte du roi Dagobert | Commun | Chanson « Le bon roi Dagobert » (culotte à l'envers) | culotte bouffante en velours rouge, couronne brodée, étiquette cousue dehors |
| 🪨 Le menhir de poche | Rare | BD/cinéma : évocation du livreur de menhirs gaulois | petite pierre dressée avec sangle de cuir comme une poignée de valise |
| 🥥 Les noix de coco du chevalier | Rare | Parodie britannique : le galop imité avec deux demi-noix de coco | deux demi-noix de coco reliées par un cordon rouge et un petit fer à cheval |
| 🏺 Le vase de Soissons, recollé | Épique | Histoire de France : « Souviens-toi du vase de Soissons » | vase d'argent à anses, fissures recollées à l'or, un pansement |
| 🗼 La tour Eiffel en allumettes | Légendaire | Comédie française du « dîner » et son maquettiste passionné | tour Eiffel en allumettes à têtes rouges, antenne un peu tordue, socle en bois |

Exemple d'histoire (FR) : « Faute de cheval, un chevalier aurait traversé tout un royaume en entrechoquant ces deux demi-noix de coco : tagada, tagada. Personne n'a jamais osé lui demander d'où venaient des noix de coco en pleine Angleterre. » Toutes les histoires existent en FR, EN, NL et ES et font au plus 320 caractères.

Arbitrages éditoriaux :
- Six sources de types différents (folklore belge, chanson, BD, cinéma britannique, histoire, comédie française).
- Sur vos quatre exemples, j'en ai repris deux (Dagobert, tour Eiffel en allumettes). Les quatre autres objets sont nouveaux.
- Les faits réels sont vrais (Gilles de Binche, chanson, anecdote rapportée par Grégoire de Tours) et toujours présentés comme chanson, anecdote ou légende.
- Aucun nom de personnage protégé (ni Obélix, ni François Pignon, ni Monty Python) : les objets les évoquent seulement.
- Les raretés suivent le barème proposé (2 communs, 2 rares, 1 épique, 1 légendaire). Les drops sont pré-remplis selon ce barème et **inactifs**.

## C⁗. SHA, branche, procédure de test

- Branche `feature/39-collections-saisonnieres` : commit `2bb5162`. **develop : `06ca5ba`** (fusion), déployé en production.
- `npm test` : 424/424 sur la branche, sur develop `06ca5ba` et sur le worktree de release. 3 tests ajoutés :
  - directive dans le prompt, clin d'œil et relecture conservés après correction ;
  - alertes de consignes, d'histoires et de noms trop proches ;
  - collection préparée : 6 objets, 4 langues, ≤ 320 caractères, aucune alerte de qualité ; import une seule fois dans le brouillon, version publiée inchangée, drops inactifs, 6 consignes distinctes dans l'atelier ; jamais réimportée, même après suppression.
- Reproduire : `DB_FILE=test-39.sqlite PORT=3101 DIG_AI_FAKE=1 ADMIN_SECRET=… node server/index.js` sur une copie de base. Le journal affiche « collection préparée … ajoutée au brouillon ». Ensuite : Admin → 📿 Collections.

## D⁗. Vérifications, limites, données

- Serveur de test 3101 sur une copie de la base de production, Chromium 1280 et 390 tactile :
  - la série et les 6 objets apparaissent en « Brouillon — non publié », drops « inactif » ;
  - la proposition n° 2 affiche la relecture, aucune alerte, et le clin d'œil dans la fiche de chaque objet ;
  - l'atelier a la bonne consigne pour chaque objet (par exemple le vase de Soissons), `neverPublished` ;
  - aucune requête d'écriture, aucune erreur JS (seul `favicon.ico` répond 404, comme avant), aucun débordement.
- Copie de la base de production démarrée en mode production (release) : empreintes des 6 tables joueurs identiques, quick_check ok, version publiée des collections toujours 1.
- **Données des joueurs : aucune modification.** Seuls le brouillon admin des collections, une ligne de proposition et 6 consignes de l'atelier sont ajoutés.
- Limites :
  - Le prompt IA modifié n'a **pas été essayé avec la vraie API**, pour ne pas dépenser hors demande. Il a été vérifié par les tests en mode factice.
  - Le contrôle de similarité compte les mots en commun : il repère les clones, pas un manque d'humour.
  - Le « clin d'œil » et la relecture restent dans la proposition : la fiche d'un objet du catalogue ne les a pas.
  - Le brouillon des collections est **unique** : publier le brouillon publierait aussi « Trésors de la vieille mine » et cette collection, drops inactifs, sauf si vous retirez d'abord ce que vous ne voulez pas.

## E⁗. Déploiement

- SHA déployé : **`06ca5ba`** (8ec98ed → 06ca5ba, sans `npm ci`). Sauvegarde vérifiée : `dig-20261102-235701-pre-deploy-06ca5ba.sqlite`.
- Avant déploiement : aucune génération IA en cours (dernier appel d'icône à 21:28 UTC, aucune proposition en attente).
- Après déploiement :
  - les deux domaines répondent 200, version `1.0.0+06ca5ba` ; admin sans clé : 401 ;
  - journal propre (une ligne « collection préparée … ajoutée au brouillon (proposition 2) ») ;
  - quick_check ok ; empreintes des 6 tables joueurs identiques à la sauvegarde ;
  - Chromium production 1280/390, jeu et admin : 0 erreur.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 8ec98ed` puis redémarrage. Le brouillon ajouté resterait (inoffensif ; il se retire dans l'admin).

### Test fonctionnel à faire par le propriétaire (Admin → 📿 Collections, Ctrl+F5)

1. Liste **Séries** : « 🧳 Les Objets trouvés de la Légende », 6 objets, « Brouillon — non publié ».
2. Liste **Objets** : 6 objets (orange, culotte, menhir, noix de coco, vase, tour Eiffel), drops « inactif ». Ouvrez-en un, passez FR → EN → NL → ES : nom et histoire dans chaque langue, aperçu joueur.
3. **✨ Propositions IA** → proposition n° 2 : sous le nom, la ligne « Relecture : … » ; dans chaque objet, le champ « Clin d'œil ».
4. **🎨 Illustrer dans l'atelier** depuis un objet : la consigne propre à l'objet est préremplie (par exemple « Two coconut half-shells tied together with a cord… »). Rien n'est généré sans votre clic. Pour la revue de demain, vous pouvez générer les six images une par une, ou en une action pour toute la collection (#40). Si une image ne vous plaît pas, modifiez la consigne avant de régénérer.
5. Facultatif : ✨ « collection avec l'IA » sur un thème (« Bruxelles », « Rome », « Halloween »…). Résultat attendu : des objets drôles et variés, un clin d'œil par objet, une relecture, et des alertes si deux objets se ressemblent.

Résultat attendu : rien n'est visible côté joueur, la version publiée ne change pas, aucune image n'est générée automatiquement.

## F⁗. Choix techniques faits seul

- **Collection rédigée directement plutôt que générée par l'API en production** : je ne peux pas appeler l'admin de production sans sa clé, et le contenu peut ainsi être relu dans le dépôt. Le format d'import est réutilisable par #48 (saisons préparées automatiquement).
- **Import dans le brouillon plutôt que proposition à valider** : vous vouliez réduire vos interventions. Le brouillon n'est pas publié et les drops sont inactifs. Un repère empêche toute réimportation.
- **Pas d'image générée** : la génération payante se demande dans l'atelier (#40) et reste soumise à votre validation visuelle. Les 6 consignes sont prêtes.
- **Contrôle par mots en commun (Jaccard)** : il est simple, explicable et sans coût d'API.

## G⁗. Décisions demandées au propriétaire

Aucune nouvelle décision bloquante. Les trois questions de la section 7 restent ouvertes : barème des drops saisonniers (recommandation : oui), exclusivité des objets d'une saison terminée (recommandation : non obtenables ensuite), révélation en grisé (recommandation : oui). La saison de rattachement de la nouvelle collection se choisira à la publication ou via #48.

## H⁗. Restant à réaliser

- Images des 6 objets (atelier, à votre demande), puis revue visuelle.
- Choix de la saison et publication contrôlée du brouillon (drops seulement après validation du barème).
- #48 : réutiliser `server/content/collections/` ou le prompt pour préparer automatiquement la collection de chaque saison.
- Après lancement : afficher le « clin d'œil » dans la fiche d'objet du catalogue (aujourd'hui seulement dans la proposition).

---

# Mise à jour du 02/11/2026, 16 h 30 (Bruxelles) — statut publié/brouillon, fiche objet par langue, consigne de l'atelier (recettes du 02/11 après-midi)

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite deux recettes du propriétaire du 02/11 :
- [14:35 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6579819338) : enregistrement de « Trésors de la vieille mine » dans le brouillon **validé** ; deux corrections demandées (statut ambigu « actif · modifié · nouveau » ; fiche d'objet qui montre encore les quatre noms et les quatre histoires).
- [14:37 UTC](https://github.com/ReC82/Dig/issues/39#issuecomment-6579869348) : navigation Collections → Atelier **validée** ; défaut : la consigne d'illustration préparée par l'IA n'apparaît pas, le champ montre un exemple de minerai.

## A'''. État réel

**Déployé en production (SHA `029e6cf`) — en attente de recette.** Classement : **Après lancement**, car cela ne concerne que l'outil d'administration. Rien n'a été publié, aucun drop n'a été activé, aucune image n'a été générée, et aucune donnée de la production n'a été réécrite.

## B'''. Changements

Fichiers : `public/admin/index.html`, `admin.js`, `admin.css`, `server/collectionAi.js`, `server/iconStudio.js`, `test/collection-ai.test.js`.

1. **Statut des lignes (Séries et Objets)**. L'état de **publication** passe en premier :
   - « **Brouillon — non publié** » (en jaune) : l'objet n'existe que dans le brouillon, les joueurs ne le voient pas ;
   - « **Publié · modifié dans le brouillon** » (en bleu) : les joueurs voient la version publiée, et les changements s'appliqueront à la publication ;
   - « **Publié** » (en vert) : identique à ce qui est en jeu.
   
   En dessous, en petit et séparément : « Objet activé / désactivé » (« Série activée / désactivée »). C'est un **indicateur de contenu**, indépendant de la publication : désactivé veut dire que l'objet n'apparaît plus et ne tombe plus une fois publié. La case de la fiche s'appelle maintenant « Objet activé » (« Série activée »), avec une infobulle. La sémantique serveur n'a pas changé.
2. **Fiche de modification d'un objet**. Le même sélecteur **FR / EN / NL / ES** que la relecture IA (FR par défaut à chaque ouverture, flèches ← → au clavier, pastilles vert/jaune selon que la langue est complète ou non) n'affiche que le **nom et l'histoire de la langue choisie**.
   - Les autres langues restent dans la fiche et sont enregistrées ensemble.
   - L'aperçu joueur suit la langue choisie.
   - Le texte FR est disponible en référence (replié) quand on édite une autre langue.
   - Si le nom FR manque à l'enregistrement, la fiche revient sur FR.
   - **Fermer avec des modifications non enregistrées** (✕, Annuler, Échap, clic hors de la fiche, ou « Illustrer dans l'atelier ») demande une confirmation.
   - L'image, le téléversement, « Illustrer dans l'atelier » et le drop sont inchangés.
3. **Atelier d'icônes ouvert sur un objet de collection**.
   - **Constat** : les consignes existaient bien et avaient été transmises à l'atelier, mais seulement dans « Plus d'options → Description de l'icône », qui est replié. Le champ visible « Consigne (facultative) » est un complément.
   - **Constat important** : en production, l'IA a renvoyé la **même consigne pour les 6 objets** de « Trésors de la vieille mine » (« Worn brass miner's lantern… »). Seule la Lanterne de poche est donc bien décrite. Je l'ai vérifié en lecture seule dans la proposition enregistrée.
   - **Désormais**, l'étape principale montre « **Consigne d'illustration de cet objet** » (Sujet, Forme et matière, Couleurs), **préremplie et modifiable**. Elle n'est enregistrée qu'au clic sur « ✨ Générer une image ». Rien ne part automatiquement.
   - Le champ libre s'appelle « Précision supplémentaire (facultative) ». Son exemple est adapté au type d'icône : pour un objet, « ex. vue de trois quarts, reflets plus chauds » ; plus d'exemple de minerai.
   - **Saisies conservées** (consigne et précision) quand on quitte la fiche pour une autre icône ou pour la fiche de l'objet, puis qu'on revient. Un bouton « **← Retour à la fiche de l'objet** » recharge la fiche avec les données à jour.
   - **Consigne identique sur plusieurs objets** : un avertissement l'indique (« identique pour 6 objets… ») avec un bouton « **Repartir du nom et de l'histoire** », qui remplit une consigne tirée du nom anglais et de l'histoire de l'objet. Aucun appel payant.
   - La vignette d'un objet jamais publié indique « Actuelle (objet en brouillon, jamais publié) » au lieu de « Actuelle en jeu ».
4. **IA des collections (prochaines propositions)**.
   - La consigne demandée est désormais propre à chaque objet : sujet et détails différents, seuls le style et les couleurs restent cohérents.
   - Les consignes identiques sont signalées dans la relecture.
   - À l'ajout au brouillon, une consigne répétée n'est pas reprise : l'atelier part du nom et de l'histoire.

## C'''. SHA, branche, procédure de test

- Branche `feature/39-collections-saisonnieres`, commit `2396958` ; **develop `029e6cf`**.
- `npm test` : 405/405 (3 tests ajoutés dans `test/collection-ai.test.js`).
- Navigateur (Chromium, serveur de test 3101, base de test, IA factice), en 1280 et en 390 tactile :
  - statuts « Publié / Brouillon — non publié / Publié · modifié dans le brouillon » + « Objet activé » ;
  - fiche : seuls Nom FR et Histoire FR sont visibles, focus sur Nom FR ; EN → seuls les champs EN, aperçu en EN, FR en référence ; flèche → NL ; corrections FR et EN conservées ;
  - Échap refusé → la fiche reste ouverte ; enregistrement → les 4 langues sont envoyées ;
  - Atelier : consigne préremplie, avertissement « identique pour 2 objets », « Repartir du nom et de l'histoire », précision saisie conservée après retour à la fiche ;
  - aucune requête de génération, 0 erreur JS, pas de débordement.

## D'''. Vérifications, limites, données

- Aucune route de publication ni de drop modifiée. Le serveur ajoute seulement trois champs en lecture à la fiche atelier d'un objet : `defaultBrief`, `briefSharedWith`, `neverPublished`.
- **Les consignes déjà enregistrées en production ne sont pas corrigées automatiquement** (aucune réécriture) : c'est à vous de choisir, objet par objet, dans l'atelier (voir le test ci-dessous).
- Le même libellé ambigu existe encore dans l'onglet 🧱 Blocs (« actif · modifié · nouveau ») : il n'a pas été touché (hors périmètre, à harmoniser avec #37).

## E'''. Déploiement

- **SHA déployé : `029e6cf`** (le 02/11 à 16 h 02, Bruxelles), par `scripts/deploy.sh` depuis la release : avance rapide de `main` `1e53430` → `029e6cf`, `npm ci` non nécessaire.
- Sauvegarde pré-déploiement vérifiée : `dig-20261102-160157-pre-deploy-029e6cf.sqlite`.
- Avant : `npm test` 405/405 sur la branche, sur develop et sur la release. Copie de la production démarrée en mode production (3122) : santé OK, version `1.0.0+029e6cf`, empreintes des 6 tables joueurs identiques, `quick_check` ok. Aucune génération IA en cours.
- Après : les 2 domaines répondent 200 avec la version `1.0.0+029e6cf` ; admin sans clé → 401 ; journal sans erreur ; `quick_check` ok ; empreintes identiques à la sauvegarde ; Chromium sur la production (jeu et admin, 1280 et 390) : 0 erreur JS.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 1e53430` puis `sudo systemctl restart dig` (aucune migration, aucun changement de dépendance).

**Test à faire par le propriétaire** (Admin → 📿 Collections) :
1. Liste des objets : les six objets de « Trésors de la vieille mine » affichent « **Brouillon — non publié** » et, dessous, « Objet activé » ; les objets d'origine affichent « Publié ».
2. Ouvrir « Lanterne de poche » : seuls Nom (FR) et Histoire (FR) sont visibles. Cliquer EN : on voit le nom et l'histoire anglais, et l'aperçu passe en anglais. Revenir à FR : une correction faite reste. Annuler avec une correction → confirmation.
3. « 🎨 Illustrer dans l'atelier » : la « Consigne d'illustration de cet objet » est préremplie (lanterne) et modifiable ; l'exemple ne parle plus de minerai.
4. Ouvrir ensuite « Boussole tordue » dans l'atelier : un avertissement indique que la consigne est identique pour 6 objets. Cliquer « Repartir du nom et de l'histoire » ou corriger le sujet (par exemple « A bent brass miner's compass »). Ne cliquez sur « Générer » que si vous voulez réellement une image (une image par clic).
5. Taper une précision, cliquer « ← Retour à la fiche de l'objet », puis revenir dans l'atelier : la précision est toujours là.

## F'''. Choix techniques faits seul

- **Consigne préremplie = la description de l'icône** (sujet/forme/couleurs), plutôt qu'une copie dans le champ « Consigne » : sinon, le texte aurait été envoyé deux fois à l'IA. Le champ libre reste disponible pour une précision.
- **Pas de correction automatique des 5 consignes erronées en production** : cela aurait été une réécriture de données. L'avertissement et le repli en un clic suffisent, et sont réversibles.
- **Langues de la fiche objet** : les huit champs restent dans la page (masqués hors de la langue choisie). La lecture et l'enregistrement sont donc inchangés et aucune saisie ne peut se perdre.

## G'''. Décisions demandées au propriétaire

Pas de nouvelle question. Les trois questions de la section 7 (barème des drops saisonniers, exclusivité, révélation en grisé) restent ouvertes.

## H'''. Restant à réaliser

- Images des objets (atelier, à votre demande), publication contrôlée du brouillon « Trésors de la vieille mine » (drops inactifs tant que le barème n'est pas validé), tests finaux.
- Harmoniser le statut de l'onglet Blocs (#37).

---


# Mise à jour du 02/11/2026, 13 h 45 (Bruxelles) — relecture des propositions IA et ligne technique IA (recettes du 02/11)

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Ce lot traite deux retours de recette du 02/11 qui n'avaient pas encore été appliqués :
- 11:52 et 11:54 UTC : retirer des fiches la ligne technique « IA : gpt-5-mini — budget restant … appels sur 24 h ».
- 12:03 UTC : la relecture d'une proposition IA affichait les six objets dépliés dans les quatre langues, d'où un défilement interminable.

## A''. État réel

**Déployé en production (SHA `1e53430`) — en attente de recette.** Classement : **Après lancement**, car cela ne concerne que l'outil d'administration. Aucune donnée, aucun drop, aucune route API et aucun contrôle de budget n'a été modifié.

## B''. Changements (`public/admin/index.html`, `admin.js`, `admin.css`, `test/collection-ai.test.js`)

- **Fenêtre « ＋ Ajouter »** : la ligne technique est remplacée par une mention simple : « La génération IA peut entraîner un coût ; rien n'est publié automatiquement. » Deux cas particuliers :
  - IA non configurée : « IA non configurée : création manuelle seulement. »
  - Limite atteinte : « Limite IA atteinte pour le moment (détails : ⚙ Config → Budget IA). »
- **Fiche « ✨ Créer une collection avec l'IA »** : le modèle, le budget restant, le coût estimé et le quota sur 24 h sont maintenant dans « Aide technique », qui est repliée par défaut. Une ligne courte s'affiche seulement si la limite est atteinte. Le plafond, le quota et le journal restent appliqués par le serveur, sans changement.
- **Relecture d'une proposition IA**, en deux niveaux :
  1. **Synthèse.** Elle commence par la description et la série : identifiant, icône, saison, et le nom dans la langue choisie. Le thème et le raisonnement de l'IA sont repliés. Viennent ensuite les objets, **une ligne compacte par objet** : miniature, nom FR et identifiant, rareté, image (« emoji · à illustrer », consigne prête ou non), drop (sources, profondeur, taux, « inactif ») et pastilles de langues FR/EN/NL/ES. Les avertissements du serveur s'affichent sous la liste.
  2. **Fiche d'un seul objet**, ouverte par un clic, Entrée ou Espace sur une ligne :
     - boutons « ← Tous les objets », « ‹ Précédent » et « Suivant › » ;
     - identité : identifiant, rareté, emoji ;
     - **sélecteur de langue FR / EN / NL / ES**, FR par défaut, avec les flèches ← → au clavier ;
     - un seul nom et une seule histoire à l'écran, avec le texte FR repliable comme référence quand on traduit ;
     - **aperçu joueur en face**, dans la langue éditée ;
     - consigne d'illustration repliée, rappel du drop pré-rempli (inactif) et « Retirer cet objet ».
- **Corrections conservées** : elles restent dans une copie de travail quand on change d'objet, de langue ou qu'on revient à la synthèse. Les pastilles se mettent à jour pendant la saisie.
  - « Enregistrer les corrections » sauvegarde la proposition et reste sur l'objet et la langue en cours.
  - Si des corrections ne sont pas enregistrées, ✕, Fermer, Échap ou un clic hors de la fiche demandent confirmation.
- **Contrôle avant « Enregistrer dans le brouillon »** : un objet sans nom FR ouvre directement sa fiche en FR, avec un message. Si un nom ou une histoire manque dans une langue, une confirmation l'annonce. Le serveur revalide tout, comme avant. Si le brouillon est refusé (identifiant déjà utilisé, par exemple), l'écran revient à la synthèse, où se trouvent l'identifiant de la série et les avertissements.
- Rien n'a changé pour les drops : ils restent inactifs. Aucune image n'est générée, aucune publication n'a lieu.

## C''. SHA, tests, déploiement

- Branche `feature/39-collections-saisonnieres` : commit `954d063`. `develop` : fusion `1e53430`.
- `npm test` : **402/402** sur la branche, sur `develop` `1e53430` et sur la release. Deux tests ont été ajoutés :
  - aucune ligne technique dans la fenêtre « ＋ Ajouter », détails dans l'aide repliée ;
  - synthèse puis fiche d'objet, FR par défaut, un seul nom et une seule histoire éditables, confirmation à Échap.
- Chromium sur un serveur de test (port 3101, base de test, IA factice, base et serveur supprimés ensuite), en 1280×900 et en 390×844 tactile :
  - fenêtre « ＋ Ajouter » : la mention simple s'affiche ;
  - fiche IA : la ligne technique n'apparaît que dans l'aide dépliée ;
  - génération : la synthèse affiche 6 lignes, sans aucun champ de texte d'objet ;
  - clavier : Entrée sur une ligne ouvre la fiche, avec le focus sur « Nom (FR) » ;
  - langue : correction FR, passage en EN, correction EN, flèche → vers NL, Suivant puis Précédent, retour en FR : **la correction FR est conservée** ;
  - « ← Tous les objets » rend le focus à la ligne d'origine ;
  - Échap avec des corrections non enregistrées affiche bien la confirmation ;
  - à la réouverture, la langue repart en FR ;
  - « Enregistrer » garde l'objet et la langue en cours (NL enregistré en base de test) ;
  - brouillon refusé pour identifiant de série en double : le message s'affiche ;
  - mobile : pas de débordement de la fiche, le tableau défile dans son cadre ;
  - 0 erreur JavaScript.
- Copie de la base de production en mode production (port 3122) : `/health` ok, version `1.0.0+1e53430`, empreintes des 6 tables joueurs identiques avant et après démarrage, `quick_check` ok, copie supprimée.
- Avant de déployer, j'ai vérifié qu'aucune génération IA n'était en cours en production (dernier appel à 12:00 UTC, aucune proposition « en cours »).
- **Déploiement** `605d320 → 1e53430` avec `scripts/deploy.sh` de la release :
  - sauvegarde vérifiée `~/backups/dig/dig-20261102-134039-pre-deploy-1e53430.sqlite` ;
  - santé et version contrôlées ;
  - les 2 domaines répondent 200 en `1.0.0+1e53430` ;
  - API admin sans clé : 401 ;
  - journal sans erreur, `quick_check` ok ;
  - **empreintes identiques à la sauvegarde** ;
  - Chromium sur la production (jeu et admin, PC et mobile) : 0 erreur.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 605d320` puis `sudo systemctl restart dig`. Aucune migration, `package-lock.json` inchangé.

## D''. Test fonctionnel à faire par le propriétaire (Admin → 📿 Collections, Ctrl+F5)

1. « ＋ Ajouter » : la ligne « IA : gpt-5-mini — budget… » a disparu. À la place : « La génération IA peut entraîner un coût ; rien n'est publié automatiquement. »
2. « ✨ Créer une collection avec l'IA » : pas de ligne technique visible. En dépliant « Aide technique », on voit le modèle, le budget et le quota.
3. « ✨ Propositions IA » → votre proposition « Trésors de la vieille mine » : la fiche montre la série puis **6 lignes compactes**, sans défilement interminable.
4. Cliquer sur « Lanterne de poche » : la fiche de cet objet seul s'ouvre en **FR**, avec l'aperçu à droite.
5. Modifier le nom FR, passer en **EN**, modifier l'histoire, puis cliquer sur « Suivant › » et « ‹ Précédent ». Revenir en FR : vos deux corrections sont toujours là.
6. « Enregistrer les corrections » : un message de confirmation s'affiche et vous restez sur l'objet.
7. Essayer de fermer avec une correction non enregistrée : une confirmation est demandée.
8. Clavier : Tab jusqu'à une ligne puis Entrée. Dans la fiche, les flèches ← → changent de langue.
9. Ensuite, « Enregistrer dans le brouillon » (rien n'est publié, les drops restent inactifs), puis 🎨 et « Publier » quand vous le souhaitez. Ces étapes restent à recetter.

## E''. Choix techniques faits seul

- **Copie de travail côté navigateur** plutôt qu'un enregistrement à chaque changement d'objet ou de langue : vous l'avez demandé (« conserver les corrections en cours »), et l'API n'est appelée que sur vos boutons.
- **La langue choisie s'applique aussi au nom de la série** dans la synthèse. C'est cohérent : une seule langue à l'écran à la fois.
- **Nom FR obligatoire contrôlé côté navigateur** avant le brouillon, pour éviter un aller-retour en erreur. Les traductions manquantes ne bloquent pas : elles sont signalées et peuvent être complétées avant de publier. Le serveur reste juge.
- **Badges (#38)** : sa fiche IA affiche encore la même ligne technique. Je ne l'ai pas modifiée, car ce n'est pas le périmètre de #39. À reprendre dans #38 si vous le souhaitez (même correctif, quelques lignes).

## F''. Décisions demandées au propriétaire

Aucune nouvelle décision. Les 3 questions du 30/10 sur le barème des drops saisonniers restent ouvertes (voir F ci-dessous).

## G''. Restant à réaliser

- Votre recette de la nouvelle relecture, puis brouillon → illustration → publication (#39 reste ouvert).
- Après lancement : la même mention simple pour la fiche IA des Badges (#38) ; masquer sur mobile les colonnes Image et Drop de la synthèse si le défilement horizontal gêne.

---

# Mise à jour du 02/11/2026, 13 h 30 (Bruxelles) — présentation des listes (recette du 02/11)

Ticket : [#39](https://github.com/ReC82/Dig/issues/39). Suite à la recette du propriétaire du 02/11 (commentaire 11:50 UTC). Validé partiellement : vue de consultation, « ＋ Ajouter », v1 avec 8 objets et 8 drops. Demande : utiliser la largeur de l'écran, élargir les colonnes, agrandir les miniatures avec un aperçu au survol ou au focus, comme pour les blocs (#37), et garder le mobile.

## A'. État réel

**Déployé en production (SHA `605d320`) — en attente de recette.** Classement : **Après lancement** (présentation du panel admin seulement). Aucune donnée, aucun drop ni aucune route API n'a été modifié.

## B'. Changements (`public/admin/index.html`, `admin.js`, `admin.css`)

- **Largeur** : l'onglet Collections monte à 1440 px, comme Blocs (960 px avant). Les paragraphes d'aide restent limités à 90 caractères par ligne pour rester lisibles.
- **Miniatures des objets** : 56 px au lieu de 40, dans le même cadre que les blocs.
  - Une image s'affiche entière, sans recadrage ni étirement.
  - Un objet sans image montre son emoji dans un cadre en pointillés.
- **Aperçu agrandi** en 256 px, avec le nom, l'identifiant, la rareté et « image » ou « emoji · à illustrer » :
  - au survol de la miniature à la souris ;
  - au focus clavier de la ligne (Tab).
  - Il se ferme quand on quitte la miniature, quand on fait défiler ou quand la fiche s'ouvre.
  - Sur écran tactile, un tap ouvre directement la fiche, qui montre déjà l'aperçu en grand.
- **Colonnes** :
  - identifiant en police à chasse fixe ;
  - série (avec son icône) et rareté sur une seule ligne ;
  - drop sur deux lignes courtes : « sources · dès N m », puis le taux, avec « inactif » le cas échéant ;
  - langues en pastilles FR / EN / NL / ES : vert = nom et histoire, jaune « XX* » = nom seul, « — » = absent. Une infobulle explique chaque pastille.
  - Dans la liste des séries, l'icône est plus grande et la saison tient sur une ligne.
- **Mobile** : les tableaux défilent horizontalement dans leur carte, comme pour les blocs. La page ne déborde pas.
- **Test #44 rendu indépendant de la date** (`test/season-end.test.js`, test seulement). La base de test créait la saison de la semaine réelle, alors que le scénario simule la semaine 44. Le test échouait donc depuis le lundi 02/11, ce qui aurait bloqué tout déploiement. Le code de production n'a pas changé.

## C'. SHA, tests, déploiement

- Branche `feature/39-collections-saisonnieres`, commit `5681366`. **`develop` = `605d320`** (merge `--no-ff`).
- `npm test` : **400/400** sur la branche, sur `develop` et sur la release `605d320`.
  - Lors du 1er passage de la release, `ranking-depth` a échoué : un serveur de test de ce même passage est resté orphelin sur le port 3110, puis les tests suivants ont reçu un 409.
  - Ce processus a été identifié (dossier de la release, base `/tmp`) et arrêté. Le passage complet suivant : 400/400.
  - La session précédente avait vu le même cas. Fragilité connue du test, à fiabiliser après le lancement.
- **Serveur de test 3101** (copie de la base de prod, Chromium) :
  - 1280×900 et 1920×1080 : onglet à 1280 et 1440 px, miniatures de 56 px, aperçu de 256 px au survol, masqué en sortant ;
  - aperçu au focus clavier, Entrée ouvre la fiche (aperçu masqué), Échap ferme et rend le focus à la ligne ;
  - une image large simulée (côté navigateur seulement) est affichée entière (`object-fit: contain`) en miniature et en aperçu ;
  - 390×844 tactile : un tap ouvre la fiche, aucun débordement de page ;
  - **0 requête d'écriture**, 0 erreur JavaScript.
- **Copie de la base de prod en mode production** (port 3122) : `/health` 200, version `605d320`. Empreintes des 6 tables joueurs identiques avant et après le démarrage, `quick_check` ok, copie supprimée.
- **Production** :
  - sauvegarde vérifiée `dig-20261102-132057-pre-deploy-605d320.sqlite` ;
  - déploiement `6e6f58a → 605d320` sans `npm ci` (lock inchangé) ;
  - les 2 domaines renvoient 200, version `1.0.0+605d320` ; admin Collections sans clé : 401 ;
  - journal sans erreur, `quick_check` ok, empreintes identiques à la sauvegarde ;
  - Chromium : jeu et admin sur les deux domaines, 0 erreur.
  - Avant le déploiement, j'ai vérifié qu'aucune génération IA n'était en cours. La proposition de collection créée à 12:00 UTC était terminée (« open »).
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 6e6f58a` puis `sudo systemctl restart dig`. Seuls des fichiers statiques de l'admin ont changé.

## D'. Test fonctionnel à faire par le propriétaire (Admin → 📿 Collections)

1. Sur PC, actualiser la page (Ctrl+F5). Les listes Séries et Objets utilisent la largeur de l'écran, jusqu'à 1440 px. Le texte d'aide reste en colonne lisible.
2. Liste Objets :
   - les miniatures font environ 56 px ;
   - série et rareté tiennent sur une ligne ;
   - le drop est sur deux lignes (sources · profondeur, puis taux) ;
   - les langues sont des pastilles vertes FR EN NL ES.
3. Survoler une miniature : un aperçu de 256 px apparaît à côté (emoji en pointillés tant qu'il n'y a pas d'image). Il disparaît quand la souris s'en va.
4. Au clavier (Tab jusqu'à une ligne) : l'aperçu apparaît. Entrée ouvre la fiche, Échap la ferme.
5. Sur smartphone : la page ne déborde pas, les tableaux défilent dans leur carte et un tap ouvre la fiche.
6. Toujours à tester (lot du 31/10) : ouverture des fiches, création IA → brouillon → publication. Une proposition IA existe déjà en base (créée le 02/11 à 12:00 UTC) : la relire dans « ✨ Propositions IA ».

## E'. Choix techniques faits seul

- J'ai repris le gabarit des blocs (classes `bk-thumb`, `bk-zoom`) plutôt que d'en créer un nouveau : rendu identique et pas de CSS en double. L'aperçu des Collections a son propre conteneur (`#co-zoom`), parce que celui des blocs est dans un onglet masqué.
- Je n'ai pas ajouté de tri par colonne : la recette ne le demande pas et il y a 8 objets. Cela reste possible après le lancement.
- J'ai corrigé le test #44 dans ce ticket, car il bloquait le déploiement. Le correctif ne touche que la base temporaire du test.

## F'. Décisions demandées au propriétaire

Aucune nouvelle décision. Les 3 questions du 30/10 sur le barème des drops saisonniers restent ouvertes (voir F ci-dessous).

## G'. Restant à réaliser

- Votre recette de la création IA et de la publication (#39 reste ouvert).
- Après lancement : fiabiliser `ranking-depth` (le serveur enfant doit être arrêté même en cas d'échec) ; tri par colonne des listes de collections si utile ; favicon de l'admin.

---

# Mise à jour du 31/10/2026, 22 h 30 (Bruxelles) — UX commune des Collections et création assistée par IA

Suite à la demande du propriétaire du 31/10 (commentaire 20:19 UTC, aussi publiée sur #37, #38 et #40) : les pages montrent d'abord les données, aucun formulaire d'ajout n'est visible par défaut, « ＋ Ajouter » ouvre une fiche, un clic sur une ligne ouvre sa fiche. Pour les collections : « Créer avec l'IA » ou « Créer manuellement ».

## A. État réel

**Déployé en production (SHA `5ad36b1`) — en attente de recette.** Classement : **Après lancement** (panel admin seulement, aucun effet sur les joueurs ; aucun drop activé, rien de publié).

## B. Changements

**Onglet 📿 Collections** (`public/admin/index.html`, `admin.js`, `admin.css`), sur le socle commun de #37 (`admDialogSetup`, `admDialogOpen`, `admRowOpen`) :
- La page s'ouvre sur le bandeau, la liste **Séries** puis la liste **Objets**. La liste des objets a une miniature (image ou emoji), un compteur et 3 filtres : texte, série, état (sans image, histoire incomplète, nouveaux ou modifiés, drop actif).
- Plus aucun formulaire visible. Les boutons « Modifier » et « Nouveau (vider) » sont retirés. Un clic, Entrée ou Espace sur une ligne ouvre sa **fiche**. Échap, ✕, Annuler ou un clic sur le fond la ferment **sans effet**, et le focus revient à la ligne.
- **« ＋ Ajouter »** (en haut à droite) propose 3 choix : **✨ Créer une collection avec l'IA**, **✍ Nouvelle série (manuel)**, **✍ Nouvel objet (manuel)**. Le choix IA est grisé si l'API n'est pas configurée.
- La fiche d'un objet est organisée en sections : Identité, Noms et histoires, Image, Drop (avec infobulle sur la chance). L'aperçu par langue est conservé. Nouveau bouton **🎨 Illustrer dans l'atelier**, qui ouvre l'atelier #40 sur l'objet : une image par action, jamais automatique.
- Après « Enregistrer », la fiche se ferme et un message de confirmation s'affiche sous le bandeau.
- Les cartes Brouillon et publication restent visibles. Versions, Images téléversées, Journal et l'aide « Comment ça marche ? » sont **repliés**.

**Création assistée par IA** (`server/collectionAi.js`, routes `/api/admin/collections/ai…`) :
- L'admin saisit une description libre, le nombre d'objets (3 à 8) et la saison (facultatif). L'IA fait **un seul appel texte** et propose :
  - une série : identifiant, noms FR/EN/NL/ES, emoji, thème ;
  - des objets : noms et **histoires** FR/EN/NL/ES dans le ton des 8 objets d'origine, rareté, emoji et **consigne d'illustration** ;
  - une courte justification.
- L'appel tourne **en arrière-plan** (environ 30 à 60 s, au-delà du délai de 60 s du proxy). La fiche affiche « ⏳ génération en cours » puis la proposition. Un appel interrompu par un redémarrage s'affiche comme tel. Rien n'est relancé automatiquement.
- **Fiche de relecture** : tous les champs sont modifiables. Un aperçu de la fiche joueur s'affiche par langue. On peut retirer un objet. Les problèmes sont signalés (identifiant déjà utilisé, langue manquante). « Enregistrer les corrections » ne fait aucun appel IA.
- **« Enregistrer dans le brouillon »** ajoute la série et ses objets au **brouillon** des collections, avec les mêmes validations que les fiches manuelles. **Rien n'est publié.** La publication reste le bouton « Publier » habituel.
- **Drops** : paramètres pré-remplis selon la rareté (barème proposé, **non validé**), toujours **inactifs**. La case « barème validé » reste obligatoire pour en activer un.
- **Images** : aucune n'est générée. La consigne d'illustration de chaque objet est transmise à l'atelier d'icônes. On y génère ensuite les images **une par une**, sur action explicite.
- **Infrastructure IA réutilisée de #37**, sans duplication : `blockAi.guardedJson` / `precheckText`. Clé côté serveur, un appel à la fois, quota de 40 appels par 24 h, plafond et journal partagés (source `admin-collections`, type `collection-text`).
- Les propositions déjà faites sont des données. Elles sont listées dans une carte repliée « ✨ Propositions IA », absente s'il n'y en a aucune.

**Base** : nouvelle table `collection_ai_proposals` (création seulement, idempotente). Aucune table existante n'est modifiée.

## C. SHA, tests, déploiement

- Branche `feature/39-collections-saisonnieres`, commit `425bfd5`. **`develop` = `5ad36b1`** (fusion). **Déployé : `5ad36b1`.**
- `npm test` : **392/392** sur la branche, sur `develop` et sur la release. Ce total inclut 8 nouveaux tests (`test/collection-ai.test.js`, transport IA factice, aucune dépense) :
  - nettoyage de la proposition, identifiants uniques, rareté inconnue ramenée à « commun » ;
  - drops inactifs pré-remplis ;
  - corrections sans appel IA ;
  - brouillon seulement, version publiée inchangée, consigne transmise à l'atelier ;
  - validations ;
  - échec IA sans écriture au catalogue, appel interrompu affiché ;
  - quota partagé ;
  - routes protégées (401) et parcours HTTP complet ;
  - contrôle statique de l'onglet (aucun champ hors fiche, un seul « ＋ Ajouter », lignes cliquables, fermeture sans effet).
  - Lors de l'intégration, une première exécution a échoué sur `ranking-depth`. Cause : un serveur de test orphelin de ma propre exécution occupait le port 3110. Après son arrêt : 392/392.
- Chromium sur le serveur de test (port 3101), copie de la base de production, IA factice, en 1280×900 et 390×844 tactile :
  - aucun champ de création visible : seuls le filtre et la note de publication sont des outils ;
  - « ＋ Ajouter » puis Échap : **0 écriture**, le focus revient au bouton ;
  - Entrée sur une ligne ouvre la fiche, Échap la ferme et rend le focus à la ligne, **0 écriture** ;
  - parcours IA : proposition de 4 objets, correction du nom NL, aperçu en NL, ajout au brouillon. Résultat : 12 objets, version en vigueur toujours v1, drops inactifs ;
  - « 🎨 Illustrer » ouvre l'atelier sur l'objet, avec la consigne proposée ;
  - pas de débordement à 390 px ; 0 erreur JS (un 404 sur le bureau, sans doute le `favicon.ico` de l'admin déjà connu).
- Release sur une copie de la base de production (`NODE_ENV=production`, port 3122) : santé OK, `1.0.0+5ad36b1`, **empreintes des 6 tables joueurs identiques** avant et après le démarrage, `quick_check` ok, nouvelle table créée vide.
- Avant le déploiement : aucune génération IA en cours (dernier appel à 16:26 UTC).
- Déploiement : avance rapide de `main` `27f5be2` → `5ad36b1`. Sauvegarde vérifiée : `~/backups/dig/dig-20261031-222923-pre-deploy-5ad36b1.sqlite`. Lock inchangé, donc pas de `npm ci`.
- En production :
  - les 2 domaines répondent 200 avec `1.0.0+5ad36b1` ; `/api/admin/collections/ai` sans clé répond 401 ;
  - journal sans erreur, `quick_check` ok ;
  - **empreintes joueurs identiques à la sauvegarde** ; catalogue public toujours v1 avec 8 objets ;
  - Chromium 1280 et 390 sur `/` et `/admin/` : 0 erreur, les 5 fiches Collections sont présentes.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 27f5be2` puis `sudo systemctl restart dig`. La table ajoutée est simplement ignorée par l'ancienne version.

Captures : [liste 1280](img/2026-10-31_ticket-39-ux-desktop-list.png), [choix « Ajouter »](img/2026-10-31_ticket-39-ux-desktop-add.png), [relecture de la proposition IA](img/2026-10-31_ticket-39-ux-desktop-proposal.png), [après ajout au brouillon](img/2026-10-31_ticket-39-ux-desktop-after-draft.png), [nouvel objet 390](img/2026-10-31_ticket-39-ux-mobile-new-item.png), [proposition 390](img/2026-10-31_ticket-39-ux-mobile-proposal.png).

## D. Test fonctionnel à faire par le propriétaire (Admin → 📿 Collections, PC puis smartphone)

1. La page montre le bandeau, les Séries et les Objets avec miniatures. **Aucun formulaire n'est visible.**
2. Cliquez sur « Fossile » : sa fiche s'ouvre (sections, aperçu). Fermez avec Échap : rien n'est modifié.
3. « ＋ Ajouter » affiche 3 choix. Cliquez sur **Annuler** : rien n'est créé.
4. « ＋ Ajouter » → **✨ Créer une collection avec l'IA**. Exemple de description : « trésors gelés de l'hiver, ton drôle et tendre », 6 objets, saison au choix. Cliquez sur « Proposer une collection ».
   - Coût : un appel texte, quelques centimes au plus, dans le plafond actuel. Aucune image n'est générée.
   - Après environ 30 à 60 s, la proposition s'affiche. Relisez les noms et histoires, changez la langue de l'aperçu, corrigez si besoin.
5. « Enregistrer dans le brouillon » : la série et ses objets apparaissent dans les listes, marqués « nouveau ». Le bandeau indique toujours la **version v1 en vigueur**. Les drops sont inactifs.
6. Facultatif : ouvrez un nouvel objet, puis « 🎨 Illustrer dans l'atelier ». La consigne proposée est pré-remplie. Ne générez que si vous le souhaitez (payant, une image).
7. **Ne publiez pas** si vous ne voulez pas que la série soit visible des joueurs. « Abandonner le brouillon » efface tout le brouillon, y compris d'éventuelles autres modifications en cours.

Résultat attendu : rien ne change pour les joueurs tant que vous ne cliquez pas sur « Publier ». Aucun drop n'est activé sans la case « barème validé ».

## E. Choix techniques faits seul

- **Appel IA en arrière-plan avec état visible** : un appel pour 6 objets en 4 langues peut dépasser les 60 s du proxy, et un redémarrage interrompt l'appel. Rien n'est relancé automatiquement, car une relance coûte.
- **Propositions conservées en base** (`collection_ai_proposals`) plutôt qu'écrites directement dans le brouillon : on peut relire et corriger avant tout ajout au catalogue, et une fiche fermée ne fait pas perdre un appel payé.
- **L'IA ne propose aucun taux de drop.** Les paramètres sont pré-remplis selon la rareté (barème proposé le 30/10, non validé) et restent **inactifs**. L'économie reste votre décision.
- **Images via l'atelier #40** plutôt qu'un second générateur : une image par action, retouche par consigne, budget et verrouillage déjà en place. Pas de logique en double.
- Refactorisation minimale de `blockAi.js` : l'appel JSON est extrait et partagé. Les blocs gardent le même comportement (tests block-ai inchangés et réussis).

## F. Décisions demandées au propriétaire

Aucune nouvelle décision pour ce lot. Les questions du 30/10 restent ouvertes :
1. Barème des drops saisonniers. Proposition : 6 objets par saison, 2 communs à 3 % dès 5 m, 2 rares à 1,5 % dès 40 m, 1 épique à 8 % sur coffre dès 60 m, 1 légendaire à 5 % sur gemme dès 100 m. Recommandation : oui.
2. Objets d'une saison terminée obtenables plus tard ? Recommandation : non (exclusivité).
3. Révéler en grisé les objets non trouvés après la fin de leur saison ? Recommandation : oui.

## G. Restant à réaliser

- Badges (#38) : même socle et création IA, traités dans leur ticket.
- Après lancement : favicon de l'admin (404 inoffensif) ; tri par colonne des listes de collections, comme pour les blocs, si utile.

---

Lien : https://github.com/ReC82/Dig/issues/39 — rapport du 30/10/2026 (session autonome digorch).

## 1. État réel

**Étape A déployée en production (SHA `80bd4a6`), en attente de recette.**
Aucun nouveau drop n'est activé. Les 8 objets d'origine tombent exactement comme avant ; seuls l'affichage et l'outil d'administration changent.

Classement : **« Après lancement »**. Le MVP fonctionne avec la collection d'origine. Ce lot ajoute la fiche joueur et l'outil qui permettra de créer une collection par saison.

## 2. Résultat et changements

### Pour les joueurs (onglet 📦 Collection)
- Les objets sont **groupés par série**. Les séries en cours apparaissent en premier : la série permanente « Collection des origines », puis la série de la saison du joueur. Viennent ensuite les **« 🗄 Archives des saisons passées »**. Une série archivée n'est visible que si le joueur en possède au moins un objet, et les objets acquis restent consultables pour toujours.
- **Toucher ou cliquer un objet ouvre une fiche détaillée** adaptée à l'écran. Elle contient :
  - une grande image (ou l'emoji) ;
  - le nom et la rareté ;
  - la série et la saison ;
  - « Trouvé le … » et la quantité ;
  - une **petite histoire originale et amusante**, écrite en FR, EN, NL et ES pour les 8 objets.
- **Objet inconnu** : la fiche affiche « Objet non découvert » avec une phrase d'encouragement. Elle ne montre ni le nom, ni la rareté, ni l'histoire, ni la profondeur. Si l'objet vient d'une saison terminée, la phrase indique « non trouvé à temps ».
- **Date et quantité** : elles sont enregistrées à chaque nouvelle trouvaille (`collectionMeta` dans la sauvegarde). Pour les objets trouvés avant cette mise à jour, la fiche affiche « Trouvé avant le suivi des dates » : **aucune date n'est inventée**.
- La langue suit le choix du joueur (FR/EN/NL). Les textes ES sont stockés et seront affichés dès que l'espagnol existera dans le jeu (#42). Si une traduction manque, le texte français s'affiche.

### Panel admin, onglet 📿 Collections
- **Séries** : création et modification avec identifiant, noms en 4 langues, icône et état actif. Une série est soit **permanente**, soit **rattachée à une saison** (liste des saisons).
- **Objets** : création et modification avec :
  - la série et la rareté ;
  - l'icône et l'image ;
  - les noms et les histoires en 4 langues ;
  - le drop : catégories de blocs sources, profondeur de départ (« dès X m »), chance par bloc en %, drop activé ou non ;
  - l'état actif.

  La liste se filtre et montre les langues manquantes.
- **Aperçu de la fiche** dans chaque langue, pendant la saisie.
- **Images** : téléversement PNG, JPEG ou WebP (350 Ko maximum). Le format est vérifié sur le contenu réel du fichier. Les images sont stockées **dans la base**, donc couvertes par les sauvegardes, et réutilisables via le bouton « Utiliser ».
- **Brouillon → publication → retour arrière**, sur le même modèle que l'onglet Blocs (#37) :
  - liste des changements champ par champ, erreurs et avertissements ;
  - note de publication ;
  - versions conservées, avec « Revenir à vN » ;
  - **journal d'audit en ajout seul**.
- **Garde-fou sur les drops** : un drop nouveau ou un barème modifié (chance, profondeur, blocs, série ou saison) s'affiche en rouge. La publication est **refusée** (par le panel et par le serveur) tant que la case « Barème validé : j'active ces drops » n'est pas cochée. La confirmation est inscrite au journal.
- Une série ou un objet déjà publié ne peut pas être supprimé, seulement désactivé.

### Technique
- `server/collectionCatalog.js` (nouveau) ; routes `GET /api/collections/catalog` et `GET /api/collections/images/<sha256>.<ext>` (publiques) ; routes `/api/admin/collections/*`, qui exigent `ADMIN_SECRET` (401 sans clé, testé).
- La **version 1** reprend les 8 trouvailles d'origine **à l'identique** : même ordre, mêmes blocs, mêmes profondeurs, mêmes chances. Un test rejoue 3 × 20 000 blocs et obtient les mêmes trouvailles aux mêmes blocs, avec et sans le catalogue publié.
- Jeu :
  - `collection.js` applique le catalogue publié (mémorisé localement) ;
  - un objet ne tombe que s'il est actif, que son drop est activé et que sa série est permanente ou de la saison en cours du joueur.
- Les coffres de la boutique continuent de donner uniquement les 8 objets d'origine (comme le serveur `chestShop.js`).
- Fichiers modifiés :
  - `server/collectionCatalog.js`, `server/index.js` ;
  - `public/js/collection.js`, `main.js`, `save.js`, `gameState.js`, `i18n.js` ;
  - `public/index.html`, `public/css/style.css` ;
  - `public/admin/index.html`, `public/admin/admin.js` ;
  - `test/collection-catalog.test.js` (nouveau, 7 tests).

## 3. SHA, branche, procédure de test

- Branche : `feature/39-collections-saisonnieres` (commit `3e7aae4`).
- **`develop` : `80bd4a6`** (fusion). Déployé : `80bd4a6`.
- `npm test` : **281/281** sur la branche et sur la release `80bd4a6` (dont 7 nouveaux tests).
- Essai navigateur sur un serveur de test (port 3101, base temporaire supprimée ensuite), sur ordinateur 1280×900 et smartphone 390×844 :
  - admin : création de la série « Trésors de l'hiver » (saison active) et de l'objet « Flocon éternel » avec une image téléversée ;
  - aperçu en ES ;
  - publication refusée sans « barème validé », puis acceptée (v2) ;
  - jeu : séries, fiche avec date, fiche d'un objet ancien « Trouvé avant le suivi des dates », fiche d'un objet inconnu, passage en archives après changement de saison, image affichée, NL.
  - Seule erreur console : un 404 dans le panel admin (le favicon, déjà connu).

## 4. Vérifications, limites, données joueurs

- **Migration uniquement additive** : 4 tables nouvelles (`collection_catalog_versions`, `collection_catalog_draft`, `collection_catalog_audit`, `collection_images`). Versions et journal sont en ajout seul (triggers). Aucune colonne ni sauvegarde n'est réécrite.
- Testée sur une copie de la base de production : empreintes identiques avant et après démarrage pour `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` ; `quick_check` ok ; copie supprimée.
- La sauvegarde réelle (7 objets sur 8) est inchangée et compatible : tous ses objets existent dans la v1.
- Limites :
  - les noms et histoires sont visibles dans le catalogue public (comme l'étaient déjà les 8 trouvailles dans le JS). L'interface ne les révèle pas, mais un joueur curieux peut les lire. Un masquage serveur est possible plus tard ;
  - le tirage reste calculé par le client, comme avant ;
  - une trouvaille ne tombe qu'une fois (règle d'origine), donc la quantité vaut 1 sauf nouvelle règle ;
  - la **génération d'images par IA depuis le panel** relève du ticket #40 (atelier d'icônes) : ce lot permet le téléversement.

## 5. Déploiement

- SHA déployé : **`80bd4a6`** (avance rapide de `main` de `1710147` à `80bd4a6`, avec `scripts/deploy.sh` de la release).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-181624-pre-deploy-80bd4a6.sqlite`.
- Après déploiement :
  - dig.lodygames.com et dig.lodylands.com répondent 200, `/api/version` = `1.0.0+80bd4a6` ;
  - `/api/collections/catalog` = v1 (8 objets), `/api/admin/collections` sans clé = 401 ;
  - journal sans erreur, `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde ;
  - Chromium sur la production (1280×900 et 390×844) : onglet Collection, ouverture d'une fiche, aucune erreur.
- Retour arrière :
  - code : `git -C /home/ubuntu/Dig reset --keep 1710147` puis redémarrage (l'ancien code ignore les 4 tables et le champ `collectionMeta`) ;
  - contenu : « Revenir à vN » dans l'onglet.

### Test fonctionnel à faire par le propriétaire (5 min)
1. **Jeu**, onglet 📦 Collection : ta série « 📦 Collection des origines · 7/8 ». Touche le Cristal bleu → fiche avec grande icône, « PEU COMMUN », « Trouvé avant le suivi des dates · Quantité : 1 » et une petite histoire. Touche l'objet « ??? » → « Objet non découvert », sans indice. Ferme avec « Fermer », un clic à côté ou Échap. Change la langue (EN/NL) : noms et histoires suivent.
2. **Admin** https://dig.lodygames.com/admin/, onglet **📿 Collections** : bandeau « v1 — 1 série, 8 objets, 8 drops actifs ».
3. Essai sans risque :
   - « Modifier » sur *fossil*, change l'histoire FR, regarde l'aperçu (sélecteur de langue), puis « Enregistrer l'objet dans le brouillon » → le changement est listé, rien ne change en jeu ;
   - crée une série « Test » rattachée à la saison active et un objet avec drop activé → encadré rouge « Drops nouveaux » ; « Publier » sans cocher → refusé ;
   - « Abandonner le brouillon ».
4. (Facultatif, visible des joueurs) publier une simple correction de texte, la vérifier en jeu après rechargement, puis « Revenir à v1 ».

Résultat attendu : tout fonctionne sans changer le jeu tant que rien n'est publié.

## 6. Choix techniques faits seul

- **Série « origines » permanente** pour la collection actuelle : elle ne disparaît pas à la fin de saison. Rien n'est effacé, l'historique n'est pas faussé, et les joueurs gardent leur progression 7/8.
- Le modèle de #37 (versions en ajout seul, brouillon unique, retour arrière qui publie une nouvelle version) est réutilisé, pour un comportement cohérent dans le panel.
- **Images stockées en base** plutôt qu'en fichiers : couvertes par les sauvegardes et le retour arrière, sans écriture dans le dossier servi. Elles sont adressées par empreinte SHA-256 (immuables, mise en cache longue) et contrôlées par signature binaire (pas de SVG téléversé, pour éviter le XSS).
- Il n'y avait pas de rareté pour les 8 objets : je l'ai fixée d'après leur difficulté réelle (fossile commun ; cristal et pièce peu communs ; relique, dent et carte rares ; couronne épique ; orbe légendaire). Affichage seul, modifiable dans le panel.
- `collectionMeta` est un champ facultatif de la sauvegarde, sans changement de version : les anciennes sauvegardes restent valides et aucune date n'est inventée.

## 7. Décisions demandées au propriétaire

1. **Barème des drops saisonniers** (aucun n'est activé).
   - Proposition pour une série de saison de 6 objets : 2 communs (chance 3 % sur pierre/terre dès 5 m), 2 rares (1,5 % sur minerai dès 40 m), 1 épique (8 % sur coffre dès 60 m), 1 légendaire (5 % sur gemme dès 100 m).
   - Options :
     - (a) valider ce barème ;
     - (b) donner le vôtre ;
     - (c) créer les séries vous-même dans le panel en cochant « barème validé ».
   - Recommandation : (a), saisi pour la saison suivante.
2. **Objets d'une saison terminée** : les rendre encore obtenables plus tard (dans des coffres « héritage », par exemple) ? Recommandation : non, pour l'exclusivité ; ils restent visibles dans les archives pour ceux qui les ont.
3. **Révéler les objets non trouvés après la fin de leur saison** (nom et image en grisé) ? Aujourd'hui ils restent « ??? ». Recommandation : oui, après la fin de saison seulement (petit changement).

## 8. Restant à réaliser

- Génération d'images IA pilotée depuis le panel : #40 (atelier d'icônes), qui pourra écrire directement dans `collection_images`.
- Liaisons :
  - #20 : coffres donnant des objets de la série de la saison (les coffres de la boutique donnent aujourd'hui seulement les 8 d'origine) ;
  - #38 : badges « série complète » ;
  - #31 : carte Saison, avec le rappel de la série en cours.
- Affichage ES quand la langue sera ajoutée au jeu (#42).
- Statistiques admin (nombre de joueurs possédant chaque objet), révélation après saison (décision 3), quantité > 1 si les doublons deviennent possibles.
