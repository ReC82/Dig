# Ticket #40 — Atelier d'icônes IA dans le panel : objets, reliques, blocs et cohérence graphique

Lien : https://github.com/ReC82/Dig/issues/40. Rapport du 30/10/2026, 19 h 20 (Bruxelles), rédigé par une session autonome digorch.

## 1. État réel

**Déployé en production (SHA `af523fb`). En attente de recette.**

Classement : **« Après lancement »**. Il s'agit de contenu graphique : le MVP fonctionne avec les emoji actuels.

## 2. Résultat et changements

Le panel admin a un nouvel onglet, **🎨 Icônes**. Il regroupe toutes les icônes du jeu :

- **Les 22 blocs du catalogue** : minerais, pierres, coffres et gemmes. Les 8 minerais de l'étape B #37 n'ont encore qu'un emoji.
- **Les objets de collection et les reliques.** Leurs icônes actuelles sont provisoires.
- **8 pictogrammes d'interface** :
  - profil 👤 ;
  - paramètres ⚙ ;
  - améliorations ⚙ ;
  - creuser, collection, quotidien, boutique et saison.
- **Profil, paramètres et améliorations ont désormais des briefs bien distincts.** Aujourd'hui, paramètres et améliorations utilisent le même ⚙. Les briefs imposent :
  - un **portrait de mineur** pour le profil ;
  - un **engrenage avec curseurs** pour les paramètres ;
  - une **pioche avec une flèche montante** pour les améliorations.

| Demande du ticket | Livré |
|---|---|
| Style graphique commun | La référence `pierre.png` validée est jointe à chaque génération. Les blocs gardent le prompt maître v1.0, inchangé. Les objets et l'interface utilisent de nouveaux gabarits v1.1 (même lumière, même angle, même finition, mêmes marges). Les icônes validées (pierre, charbon, minerai de fer) sont affichées à côté de chaque proposition pour comparer. |
| Génération unitaire ou par lot, variantes | 1 à 3 variantes. Un lot va jusqu'à 20 icônes et tourne en arrière-plan avec un suivi de progression. Une seule génération à la fois. |
| Upload manuel | PNG ou WebP avec fond transparent, 4 Mo maximum. Les JPEG et les images sans transparence sont refusés avec la raison. |
| Contrôles transparence / marges / cadrage | Ce sont les contrôles de `tools/icons/process.js` (#22) : vrai canal alpha, coins transparents, contour anti-crénelé, recadrage, marge de 12 %, contraste sur fond sombre. Une image refusée n'est pas stockée. |
| Aperçu à taille réelle mobile | Maquette 390 px : bloc en jeu, case de collection, fiche ou barre de navigation selon le type. Tailles 24, 36, 64 et 128 px. |
| Coût estimé et réel, budget plafond configurable | Estimation affichée et vérifiée **avant** chaque lot, puis coût réel par image et par icône, et journal des appels. Deux plafonds s'appliquent : le plafond global de la configuration (partagé avec #22 et #37) et un **plafond propre à l'atelier, réglable dans le panel**, qui ne peut pas dépasser le global. Quota : 40 images par 24 h. |
| Stockage, provenance, historique, rollback | Tout est stocké dans la base, donc sauvegardé avec elle, et en ajout seul. Pour chaque image : prompt, version du gabarit, modèle, référence, contrôles, coût et empreinte. L'historique trace génération, upload, choix, validation et application. Retour arrière possible vers l'emoji d'origine ou vers l'icône précédente, en plus de « Revenir à vN » dans le catalogue. |
| Ne pas modifier les icônes validées sans accord | Les icônes 🔒 validées (v1 #22, ou validées dans l'atelier) sont refusées sans confirmation explicite. Un remplacement confirmé est tracé. |
| Ne pas basculer le jeu sans recette | « Appliquer » écrit seulement dans le **brouillon** du catalogue Blocs ou Collections. Rien ne change pour les joueurs avant la publication. `defaultLibrary` reste `legacy`. |
| Sécurité | Les routes exigent la clé admin (401 sinon). La clé OpenAI reste côté serveur et les erreurs sont masquées. Les actions sont limitées à 60 par 15 min (`RATE_ICONS_MAX`). Le corps de 4 Mo de l'upload n'est lu qu'après vérification de la clé admin ; partout ailleurs, la limite reste 512 Ko. |

Fichiers :
- nouveaux : `server/iconStudio.js`, `test/icon-studio.test.js` (8 tests) ;
- modifiés : `server/index.js` (routes, `/media/icons/<sha>.webp`), `server/rateLimits.js`, `server/blockCatalog.js` et `server/collectionCatalog.js` (ils acceptent maintenant les images `/media/icons/…`), `public/js/iconLibrary.js`, `public/css/style.css` (image de catalogue dimensionnée comme les icônes v1 : 70 % du bloc), `public/admin/index.html`, `public/admin/admin.js`, `tools/icons/prompt-master.md` (gabarits v1.1), `docs/ICONS.md`.

## 3. SHA, branche, procédure de test

- Branche : `feature/40-atelier-icones`, commit `0f2f5c7`.
- **`develop` : `af523fb`**, qui est aussi le SHA déployé.
- `npm test` : **299/299** sur la branche, sur `develop` et sur la release.
- Essai complet sur un serveur de test (port 3101, base jetable, transport IA factice, traitement d'image réel) :
  1. lot de 2 objets × 2 variantes ;
  2. ouverture de la relique, aperçus et contrôles affichés, application au brouillon ;
  3. vérification du verrou sur la pierre ;
  4. génération pour « terre meuble », application, publication du catalogue de blocs ;
  5. dans le jeu, l'icône s'affiche (ordinateur 1280×900 et smartphone 390×844, aucune erreur JS).

## 4. Vérifications, limites, données joueurs

- Migration **additive** : 5 tables `icon_studio_*`, aucune colonne ni donnée existante touchée. Testée sur une copie de la base de production : les empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` sont identiques avant et après le démarrage, et `quick_check` est ok. La copie a été supprimée.
- **Aucune génération réelle (payante) n'a été faite** dans cette session : le budget est presque épuisé (voir décision 1). Tests et essais ont utilisé le transport factice. Le chemin réel est celui de #37, déjà validé par un essai réel le 30/10.
- Limites :
  - les pictogrammes d'interface sont stockés mais pas encore appliqués en jeu (#41) ;
  - les badges n'existent pas encore (#38) ;
  - un lot en cours est perdu si le serveur redémarre (les images déjà générées restent) ;
  - l'atelier et la création IA de blocs (#37) ont chacun leur verrou « une génération à la fois » : lancés en même temps, ils peuvent dépasser le plafond d'au plus une image ;
  - le panel est pensé pour l'ordinateur.

## 5. Déploiement

- SHA déployé : **`af523fb`**, par avance rapide de `main` `db94b8e` → `af523fb` puis `scripts/deploy.sh` de la release.
- Sauvegarde vérifiée : `~/backups/dig/dig-20261030-191746-pre-deploy-af523fb.sqlite`.
- Contrôles après déploiement :
  - dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+af523fb` ;
  - `/api/admin/icons` sans clé → 401 ;
  - journal sans erreur, `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde ;
  - navigateur : le jeu se charge (emoji inchangés, aucune erreur) et l'onglet 🎨 Icônes est présent.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep db94b8e` puis redémarrage. Les tables ajoutées sont ignorées par l'ancien code. Une image `/media/icons/…` déjà **publiée** dans un catalogue ne serait plus servie après ce retour arrière : le jeu retomberait alors sur l'emoji. Dans ce cas, utiliser aussi « Revenir à vN » dans le catalogue.

### Test fonctionnel à faire par le propriétaire

1. https://dig.lodygames.com/admin/ → onglet **🎨 Icônes**. La ligne d'état indique le modèle, la dépense (≈ 2,02 / 3 USD) et le nombre d'images restantes.
2. Famille « Objets / reliques » → **Ouvrir** sur *Relique*. Vérifier le brief proposé, puis cliquer **✨ Générer** avec 1 variante (≈ 1 min, ≈ 0,08 à 0,25 USD).
3. Comparer la proposition aux icônes validées (pierre, charbon, fer) affichées en haut, et regarder la maquette smartphone et les tailles 24 à 128 px.
4. Si elle convient : **★ Retenir**, puis **Appliquer au brouillon**. Aller dans 📿 Collections : le brouillon contient l'image. **Publier** (facultatif), puis vérifier la fiche de l'objet dans le jeu.
5. Ouvrir *Pierre* : elle est marquée 🔒 validée. « Revenir à l'emoji » demande une confirmation explicite.
6. (Facultatif) **Téléverser** un PNG transparent : il est accepté et normalisé. Un JPEG est refusé.

Attendu : propositions dans le style des icônes validées, contrôles affichés, rien ne change en jeu avant la publication.

## 6. Choix techniques faits seul

- **Images stockées dans la base**, comme pour #37 : elles sont sauvegardées et restaurées avec la base, l'URL est persistante et rien n'est écrit dans le dossier du code. Seuls le WebP 256 et l'empreinte du maître 1024 sont conservés, pour éviter d'alourdir la base (≈ 1 Mo par maître).
- **Application par le brouillon** des catalogues existants, plutôt qu'un nouveau mécanisme de bascule : la recette, la publication et le retour arrière se font comme pour tout autre contenu.
- **Gabarit des blocs inchangé** (v1.0), pour que les icônes déjà validées restent reproductibles. Nouveaux gabarits v1.1 pour les objets et l'interface, avec la même lumière, le même angle et la même finition.
- **Plafond de l'atelier en plus du plafond global**, au lieu de modifier `~/.config/dig/openai.env` (fichier non modifiable par les sessions).
- **Briefs par défaut** construits à partir du nom anglais et de l'histoire de l'objet (aucun appel texte payant) ; ils restent modifiables.
- **Pictogrammes d'interface** : génération et stockage seulement. L'application en jeu touche à la navigation et relève de #41.

## 7. Décisions demandées au propriétaire

1. **Budget IA** : 2,02 / 3 USD sont consommés, ce qui laisse ≈ 3 à 4 images au tarif estimé (0,25 USD). C'est insuffisant pour remplacer les icônes des reliques et des 8 nouveaux minerais (≈ 16 icônes à 1 variante, ≈ 4 USD). Recommandation : relever `DIG_IMAGE_BUDGET_USD` à **10** dans `~/.config/dig/openai.env` (les sessions ne modifient pas ce fichier), puis régler au besoin un plafond d'atelier dans le panel.
2. **Validation visuelle** : après vos essais, marquez 🔒 Valider les icônes retenues. Une fois tout un lot validé, faut-il générer de la même façon les 8 minerais de l'étape B ? Recommandation : oui, en un lot de 1 variante, avec régénération ciblée sur demande (même règle que #22).

## 8. Éléments restant à réaliser

- Remplacer réellement les icônes des reliques, des objets et des 8 minerais. Cela dépend du budget (décision 1) et de votre validation visuelle.
- Appliquer les pictogrammes d'interface en jeu : #41.
- Icônes des badges : #38, quand il existera.
- Améliorations possibles : verrou commun avec la création IA de blocs (#37), reprise d'un lot après un redémarrage, panel adapté au smartphone.
