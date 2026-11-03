# Ticket #56 — Événements mensuels : objets exclusifs à miner et calendrier automatique

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
