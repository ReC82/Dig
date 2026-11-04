# Ticket #56 — Événements mensuels : objets exclusifs à miner et calendrier automatique

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
