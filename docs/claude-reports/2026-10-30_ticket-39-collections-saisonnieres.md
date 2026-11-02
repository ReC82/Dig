# Ticket #39 — Collections saisonnières : objets, fiches narratives et édition admin

# Mise à jour du 03/11/2026, 0 h 05 (Bruxelles) — ligne éditoriale humoristique et nouvelle collection en brouillon (directive du 02/11 au soir)

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
