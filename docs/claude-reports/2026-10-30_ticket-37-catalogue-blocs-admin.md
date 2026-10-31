# Ticket #37 — Panel admin : catalogue de blocs, découvertes, événements et tables de récompenses

Lien : https://github.com/ReC82/Dig/issues/37 — rapport du 30/10/2026 (session autonome digorch).

---

# Mise à jour du 31/10/2026, 14 h 31 (Bruxelles) — vrais visuels dans Admin → Blocs, état de l'image IA

Suite à la recette visuelle du propriétaire du 31/10 (commentaire 13:11 UTC) : v3, 22 blocs et probabilités à 250 m validés ; deux défauts signalés : (1) la liste et le formulaire montraient des emoji au lieu des illustrations du jeu ; (2) la proposition IA « cuivre oxydé » montrait un carré vert à la place d'une image.

## A. État réel

**Déployé en production (SHA `580b9a8`) — en attente de recette.** Correction faite dans #37 (même ticket). Classement : **Après lancement** (panel admin, sans effet sur les joueurs). #37 reste ouvert pour les découvertes, les événements et les drops.

## B. Diagnostic de l'image IA (proposition n° 1, constaté en production en lecture seule)

- Journal des appels de la proposition : **un seul appel, de type texte** (réussi à 09:50:01 UTC, 0,0049 USD). **Aucun appel image n'a été enregistré**, ni réussi, ni en échec, et aucune image n'est stockée.
- Cause : **le déploiement de `bc684be` a redémarré le serveur à 09:50:31 UTC**, 30 s après la réponse texte, pendant la génération de l'image (≈ 45 s). L'appel a été coupé avant d'être journalisé. **Rien n'a été facturé pour l'image.**
- Le panel affichait alors l'emoji de secours de la proposition (🟩, sur le fond aux couleurs du bloc), sans aucun état : d'où le « carré vert bordé ».
- Second défaut trouvé à cette occasion : le proxy nginx du jeu garde son délai par défaut de 60 s. Or la création attendait texte + image (≈ 15–30 s + 45 s). Même sans redémarrage, elle pouvait donc échouer en 504 côté navigateur. Les essais du 30/10 avaient été faits sans proxy.

## C. Changements

**1. Visuels réels dans la liste et le formulaire** (`public/admin/admin.js`, `admin.css`, `index.html`)
- Le panel charge le **même module que le jeu** (`/js/iconLibrary.js`) et la même configuration (`/assets/icons/library.json`). Il applique la même priorité : **image personnalisée du catalogue → bibliothèque v1 par défaut (si le matériau y figure) → emoji de secours**.
- Le panel affiche le rendu par défaut des joueurs : une préférence `?icons=…` propre au navigateur de l'admin est ignorée.
- Nouvelle colonne « Visuel » : miniature de 40 px sur le fond du bloc, avec la source en dessous (`v1`, `image` ou `emoji`). Un emoji de secours a une **bordure en pointillés**. Si une image ne se charge pas : emoji + « ⚠ absente ».
- Aperçu du formulaire : la même résolution, mise à jour pendant la saisie (identifiant, image, emoji, couleurs), avec la source en clair. Exemples : « Bibliothèque v1 validée (affichée en jeu) », « Aucune image : emoji de secours », chemin refusé, image introuvable.
- Résultat sur le catalogue v3 : **14 blocs avec leur illustration v1** et **8 nouveaux minerais** (quartz → cristal ancien) signalés en emoji de secours. Ils n'ont pas encore d'icône. Aucune icône validée n'a été régénérée ni remplacée.

**2. Image IA : génération en arrière-plan et état visible** (`server/blockAi.js`, `server/index.js`)
- « ✨ Proposer un bloc » répond dès que le texte est prêt. L'image se génère ensuite **en arrière-plan**, et la carte se rafraîchit seule toutes les 4 s tant qu'elle est en cours. « ↻ Image seule » fonctionne de la même façon.
- **État enregistré** avec la proposition (dans ses données JSON, sans changement de schéma), affiché sous l'aperçu :
  - « ✓ Image IA générée » ;
  - « ⏳ en cours » ;
  - « ⚠ Image en échec : <raison> » (plafond, quota, erreur de l'API…) ;
  - « Aucune image générée ».
- Une génération coupée par un redémarrage apparaît comme « ⚠ Génération interrompue (serveur redémarré pendant l'appel) : relancez « ↻ Image seule » ».
- Pendant une génération : « Ajouter au brouillon » et les régénérations sont désactivés (le serveur les refuse aussi). Les corrections de noms faites pendant la génération sont conservées.
- Garde-fous inchangés : un appel à la fois, 40 appels / 24 h, plafond de dépense partagé, clé côté serveur, journal en ajout seul. **Aucune publication automatique.**
- La proposition n° 1 existante s'affiche « Aucune image générée pour cette proposition — emoji de secours affiché ». **Je n'ai lancé aucune génération réelle** : elle coûte ≈ 0,08 USD et revient à votre recette.

Captures (serveur de test, copie de la base de production, transport IA factice) : [liste 1280 px](img/2026-10-31_ticket-37-visuels-liste-1280.png), [formulaire 390 px](img/2026-10-31_ticket-37-visuels-formulaire-390.png), [proposition n° 1, état de l'image](img/2026-10-31_ticket-37-ia-etat-image-1280.png).

## D. SHA, tests, déploiement

- Branche `feature/37-catalogue-blocs-admin` : `bc0e9c0` ; **`develop` : `580b9a8`** (fusion `--no-ff`).
- `npm test` : 370/370 sur la branche, sur `develop`, puis sur la release `580b9a8`.
- Tests ajoutés ou adaptés (`test/block-ai.test.js`, transport factice, aucune dépense) :
  - passages `pending → ok` ;
  - « Ajouter au brouillon » refusé pendant la génération ;
  - seconde génération refusée (429) ;
  - correction conservée ;
  - « interrompue » après redémarrage simulé ;
  - « none » pour une ancienne proposition ;
  - échec enregistré et relu ;
  - route HTTP : réponse immédiate puis image disponible.
- Navigateur (Chromium, serveur de test sur une copie de la base de production, port 3101) :
  - en 1280×900 et en 390×844 : 22 lignes, 14 en v1, 8 en emoji, 0 image cassée, aucun débordement de page ;
  - formulaire correct (v1 / emoji) ;
  - « ↻ Image seule » : la carte passe de « Aucune image » à « ✓ Image IA générée », avec l'image servie ;
  - état « interrompue » affiché ;
  - 0 erreur JS (seule la 404 connue du favicon).
- Copie de la base de production démarrée avec la release (port 3122) : `/health` 200, `/api/version` = `1.0.0+580b9a8`, empreintes des 6 tables joueurs identiques, `quick_check` ok. Copie supprimée.
- Déploiement `bc684be → 580b9a8` par `scripts/deploy.sh` (de la release). Avant de lancer, j'ai vérifié qu'aucune génération IA n'était en cours en production. Sauvegarde vérifiée : `~/backups/dig/dig-20261031-143057-pre-deploy-580b9a8.sqlite`. Pas de `npm ci` (lock inchangé).
- Production :
  - 2 domaines → 200, `1.0.0+580b9a8` ;
  - journal sans erreur ; `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde pré-déploiement ;
  - Chromium 1280×900 et 390×844 sur `/` et `/admin/` sans erreur JS, `IconLibrary` chargé dans l'admin.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep bc684be` puis `sudo systemctl restart dig`. Aucune migration ; l'état d'image ajouté aux données d'une proposition est ignoré par l'ancien code.
- Non vérifié par moi en production : l'onglet connecté (pas de clé admin) et une vraie génération d'image (dépense).

## E. Test fonctionnel à faire par le propriétaire

1. Admin → 🧱 Blocs (Ctrl+F5).
   - Attendu : colonne « Visuel » avec les illustrations du jeu pour terre meuble … diamant (mention `v1`) ; les 8 nouveaux minerais en emoji à bordure pointillée (mention `emoji`) ; rien ne déborde, sur PC comme sur mobile.
2. « Modifier » sur pierre.
   - Attendu : l'aperçu montre l'illustration et la mention « Bibliothèque v1 validée (affichée en jeu) ».
   - Sur quartz : « Aucune image : emoji de secours ».
3. Carte IA, proposition n° 1 (cuivre oxydé).
   - Attendu : « Aucune image générée pour cette proposition ».
   - Cliquer « ↻ Image seule » (≈ 0,08 USD) : « ⏳ en cours », puis après ≈ 1 min « ✓ Image IA générée » avec la vraie image.
   - Rien n'est publié tant que vous n'utilisez pas « Ajouter au brouillon » puis « Publier ».
4. Facultatif : une nouvelle proposition. La réponse arrive après le texte (≈ 30 s), puis l'image suit dans la carte.

## F. Choix techniques faits seul

- Réutilisation de `iconLibrary.js` du jeu plutôt qu'une copie de ses règles dans le panel : une seule source de vérité pour la priorité et les chemins acceptés.
- Génération en arrière-plan plutôt qu'un allongement du délai nginx : l'infrastructure n'est pas modifiable et une génération IA n'a pas à tenir une requête HTTP ouverte.
- État enregistré dans le JSON de la proposition : aucune migration de schéma ; ancien code compatible.
- Un « en cours » enregistré sans génération active dans le processus est présenté comme « interrompu ». Pas de relance automatique : elle serait payante.

## G. Décisions demandées au propriétaire

Inchangées : 1. plafond de dépense IA (2,03 / 3 USD utilisés ; recommandation : 10 USD) ; 2. gemmes pour saphir, améthyste et cristal ancien (recommandation : non pour l'instant).

## H. Restant à réaliser

- Recette : vraie image IA (étape E.3) et une publication.
- Icônes des 8 nouveaux minerais (via la carte IA ou #40). Je n'ai rien généré sans demande.
- Étapes : découvertes côté joueur, C (événements), D (tables de drops).
- Signalé, non fait : lors d'un déploiement, une génération IA en cours est coupée. Elle est désormais signalée comme « interrompue », mais `deploy.sh` ne l'attend pas. Favicon absent dans `/admin/`.

---

# Mise à jour du 31/10/2026, 10 h 55 (Bruxelles) — correction de la mise en page de l'onglet 🧱 Blocs

Suite à la recette du propriétaire du 31/10 (commentaire 09:35 UTC) : catalogue v3, 22 blocs, probabilités à 250 m validés ; défauts de mise en page sur ordinateur signalés.

## A. État réel

**Déployé en production (SHA `bc684be`) — en attente de recette.** Correction faite dans #37 (même ticket, pas de nouveau ticket). Classement : **Après lancement** (panel admin, sans effet sur les joueurs). #37 reste ouvert pour les étapes C et D.

## B. Changements (mise en page uniquement)

Fichiers : `public/admin/admin.css`, `public/admin/admin.js` (`bkRenderTable`), `public/admin/index.html`. Aucune donnée, aucune règle de probabilité, aucun brouillon ni aucune route serveur modifiés.

| Défaut constaté | Correction |
|---|---|
| Tableau limité à 960 px | L'onglet Blocs utilise toute la largeur, jusqu'à 1440 px (les autres onglets ne changent pas). |
| Champs de filtre très hauts (69 px, champ de recherche blanc non stylé) | Champs de 34 px dans le thème sombre ; le libellé « Probabilités à … m » reste sur une seule ligne. Sur mobile, les filtres passent à la ligne. |
| « Prob. » et d'autres valeurs coupées sur deux lignes | Colonnes numériques (PV, Récompense, Poids, Prob.) alignées à droite, sans retour à la ligne ; en-têtes sur une ligne ; « Peu commun » sur une ligne. |
| Colonne « Dès » trop longue (« dès 1 m (atténué > 12 m : 2.1) ») | Colonne renommée « Apparition » : « dès 1 m » sur une ligne, et l'atténuation en petit gris sur une seconde ligne. |
| Boutons « Modifier » hors du tableau | Le tableau est dans un conteneur à défilement horizontal : il ne sort jamais de la carte. Bouton aligné à droite. |

Mesures dans Chromium (serveur de test) :

| Mesure | Avant | Après |
|---|---|---|
| Largeur de la section en 1280×900 | 960 px | 1280 px |
| Largeur de la section en 1920×1080 | 960 px | 1440 px |
| Bord droit du bouton « Modifier » le plus à droite (bord de la carte : 1260 px) | 1058 px, pour une carte qui s'arrête à 940 px (débordement) | 1229 px |
| Hauteur du champ de filtre | 69 px | 34 px |

Captures en 1280×900 : [avant](img/2026-10-31_ticket-37-blocs-avant-1280.png), [après](img/2026-10-31_ticket-37-blocs-apres-1280.png). Sur mobile (390×844), le tableau défile horizontalement dans sa carte, comme avant.

Fonctionnement contrôlé après la modification : filtre texte « quartz » → 1 ligne ; catégorie « gemme » → 6 ; « Probabilités à 10 m » recalcule ; « Modifier » remplit le formulaire avec le bon bloc ; aucune erreur JavaScript.

## C. SHA, tests, déploiement

- Branche `feature/37-catalogue-blocs-admin` : `b9086eb` ; **`develop` : `bc684be`** (fusion `--no-ff`).
- `npm test` : 369/369 sur la branche, puis 369/369 sur la release `bc684be` (même arbre que `develop`).
- Copie de la base de production démarrée avec la release (port 3122) : `/health` ok, `/api/version` = `1.0.0+bc684be`, empreintes des 6 tables joueurs identiques, `quick_check` ok. Copie supprimée.
- Déploiement `9c93981 → bc684be` par `scripts/deploy.sh` (de la release) ; sauvegarde vérifiée `~/backups/dig/dig-20261031-105031-pre-deploy-bc684be.sqlite` ; aucun `npm ci` (lock inchangé).
- Contrôles en production : les 2 domaines répondent 200 avec `1.0.0+bc684be` ; journal sans erreur ; `quick_check` ok ; empreintes joueurs identiques à celles d'avant le déploiement ; Chromium 1280×900 et 390×844 sur `/` et `/admin/` sans erreur JS, nouvelle feuille de style chargée.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 9c93981` puis `sudo systemctl restart dig` (aucune migration, aucune donnée touchée).
- Non vérifié par moi en production : l'affichage connecté de l'onglet Blocs (je n'ai pas la clé admin) ; il a été vérifié sur un serveur de test avec le même code.

## D. Test fonctionnel à faire par le propriétaire

1. Admin → 🧱 Blocs, sur ordinateur (rechargement forcé : Ctrl+F5).
2. Attendu : le tableau occupe la largeur de l'écran ; filtres sur une seule ligne, de hauteur normale ; « 0.92 % » et « 3.52 % ★ » sur une ligne ; terre meuble et argile affichent « dès 1 m » / « dès 4 m » avec l'atténuation en petit gris en dessous ; tous les boutons « Modifier » sont à l'intérieur de la carte.
3. Vérifier que les données n'ont pas bougé : v3, 22 blocs, aucun brouillon, terre meuble 0,92 % et argile 0,59 % à 250 m.

## E. Choix techniques faits seul

- Élargissement limité à l'onglet Blocs (`#tab-blocks`) pour ne modifier aucun autre onglet sans demande. Le même défaut de largeur (960 px) existe ailleurs : signalé ci-dessous, non corrigé.
- Ajout d'un conteneur à défilement horizontal plutôt que la réduction de colonnes : aucune information retirée.
- Pas de test automatisé : le changement est purement visuel ; il a été contrôlé par mesures et captures dans Chromium.

## F. Décisions demandées au propriétaire

Inchangées (voir la section du 30/10 ci-dessous) : 1. plafond de dépense IA (recommandation : 10 USD) ; 2. gemmes pour saphir, améthyste et cristal ancien (recommandation : non pour l'instant).

## G. Restant à réaliser

- Recette restante, signalée par le propriétaire : test de la génération IA et d'une publication.
- Étapes : découvertes côté joueur, C (événements), D (tables de drops) — voir la section G du 30/10.
- Signalé, non fait : les autres onglets de l'admin restent limités à 960 px (même défaut possible sur les grands écrans) ; favicon absent dans `/admin/`.

---

# Mise à jour du 30/10/2026, 18 h 55 (Bruxelles) — étape B, règle de profondeur, création IA

Suite à la décision du propriétaire (commentaire du 30/10, 17:09 UTC : étape B approuvée, création IA demandée, règle « sans borne maximale »).

## A. État réel

**Déployé en production (SHA `db94b8e`) — en attente de recette.** Deux déploiements successifs ce soir :
- `556858e` : étape B (8 minerais) + terre/argile sans borne maximale (atténuées) ;
- `db94b8e` : création de blocs assistée par IA dans l'onglet 🧱 Blocs.

Classement : **« Après lancement »** (le MVP fonctionne sans) ; l'étape B donne enfin du contenu au-delà de 249 m.

## B. Changements

### Étape B — 8 nouveaux minerais (publiés : catalogue **v2**)
Chiffres du rapport, inchangés. Noms FR/EN/NL réels (aucun français recopié) :

| Bloc (id) | FR / EN / NL | Catégorie / rareté | Dès | PV base | Récompense | Poids |
|---|---|---|---|---|---|---|
| quartz | Quartz / Quartz / Kwarts | minerai / peu commun | 150 m | 45 | 70 | 14 |
| obsidienne | Obsidienne / Obsidian / Obsidiaan | pierre / peu commun | 200 m | 60 | 40 | 16 |
| minerai_argent | Minerai d'argent / Silver ore / Zilvererts | minerai / rare | 260 m | 95 | 260 | 7 |
| saphir | Saphir / Sapphire / Saffier | gemme / épique | 330 m | 150 | 1 900 | 2,5 |
| minerai_platine | Minerai de platine / Platinum ore / Platinaerts | minerai / rare | 420 m | 120 | 520 | 5 |
| amethyste | Améthyste / Amethyst / Amethist | gemme / épique | 520 m | 170 | 2 600 | 2 |
| fer_meteorique | Fer météorique / Meteoric iron / Meteorietijzer | minerai / légendaire | 650 m | 220 | 5 200 | 1 |
| cristal_ancien | Cristal ancien / Ancient crystal / Oeroud kristal | gemme / légendaire | 800 m | 300 | 9 000 | 0,6 |

- **Aucune gemme premium nouvelle** : saphir, améthyste et cristal ancien sont des « gemmes » d'apparence mais `gemReward: false` (pas de +1 gemme ; seuls rubis/émeraude/diamant en donnent, comme avant). À trancher à l'étape D.
- Icônes : emoji en attendant (#22/#40, ou génération IA ci-dessous).

### Règle de profondeur (publiée : catalogue **v3**)
Terre meuble et argile n'ont **plus de borne maximale** : au-delà de 12 m (terre) et 22 m (argile), leur poids est **atténué** (70 → 2,1 et 45 → 1,35) au lieu de tomber à zéro. Nouveau mécanisme générique « Atténué au-delà de X m / poids atténué » dans le formulaire (poids atténué > 0 et < poids : un bloc débloqué garde toujours une probabilité > 0).

| Profondeur | Terre + argile avant → après | Nouveaux minerais | PV moyens avant → après | Récompense moyenne avant → après |
|---|---|---|---|---|
| 12 m | 46,4 % → 46,4 % | — | 26 → 26 | 14 → 14 |
| 13 m | 25,3 % → 26,2 % | — | 35 → 35 | 20 → 20 |
| 23 m | 0 % → 2,3 % | — | 77 → 75 | 40 → 39 |
| 50 m | 0 % → 1,8 % | — | 197 → 194 | 145 → 143 |
| 249 m | 0 % → 1,5 % | 13,2 % | 984 → 1 056 | 967 → 921 |
| 500 m | 0 % → 1,4 % | 18,4 % | 1 947 → 2 378 | 1 873 → 2 660 |
| 1 000 m | 0 % → 1,4 % | 19,6 % | 3 866 → 5 016 | 3 678 → 8 424 |

(Au lieu des ≈ 36 % de terre/argile qu'aurait donné une suppression brute de la borne.)

- **Joueurs dont le navigateur n'a pas encore rechargé le jeu** : le catalogue public sans `format=2` leur présente l'ancienne borne (12/22 m) et les nouvelles gemmes comme « minerai » → aucun comportement incohérent (pas de terre à 36 %, pas de gemme distribuée). Le jeu à jour lit `?format=2` (nouvelle clé de cache local).
- **Anti-bot #25** : la part atténuée n'abaisse pas le PV minimum du budget (sinon 3 PV au lieu de 8 à toute profondeur) ; justification dans `minHpSegments()` ; budget identique aux valeurs d'origine (testé).
- Migrations de contenu **une seule fois** (marqueurs `content:step-b-ores` / `content:surface-fade` dans le journal), par-dessus la version en vigueur, sans écraser une modification de l'admin. Annulables par « Revenir à v1 » (les 8 blocs restent présents mais désactivés).

### Création de blocs assistée par IA (onglet 🧱 Blocs, carte « ✨ Création assistée par IA »)
- L'admin décrit un bloc/minerai/coffre → le **serveur** appelle l'IA : noms **FR/EN/NL** (consigne : vraie traduction, terminologie cohérente avec le catalogue ; avertissement si une langue est vide ou recopie le français), catégorie, rareté, emoji, couleurs, PV/récompense/profondeur/poids (contexte : catalogue en vigueur + règles d'équilibrage), justification, **icône générée dans la direction artistique validée** (prompt maître #22 + référence `pierre.png` jointe + contrôles/normalisation `process.js` → WebP 256 px).
- Aperçu image + 3 noms côte à côte ; **correction indépendante par langue** ; **régénération ciblée** (noms/traductions seuls, image seule, tout le texte) ; **Impact** (part du nouveau bloc, PV et récompense moyens avant → après à 4 profondeurs) ; **Ajouter au brouillon** (identifiant technique stable, unique) → puis simulation et **Publier** comme tout autre changement. **Jamais de publication automatique.** Édition ultérieure : bouton « Modifier » de la liste (champs localisés `names.fr/en/nl`, extensible à d'autres langues via `LANGS`).
- Images stockées **dans la base** (table en ajout seul) → sauvegardées avec elle, **URL persistante** `/media/blocks/<sha>.webp` (cache immuable), aucune écriture dans le dossier du code.
- Sécurité : clé uniquement côté serveur (infrastructure #22 : `~/.config/dig/openai.env`, jamais envoyée au navigateur ni journalisée, messages d'erreur masqués) ; routes admin (401 sans clé) ; sorties IA traitées comme des données (nettoyage, bornes, validation du catalogue) ; une génération à la fois ; **quota 40 appels / 24 h** ; **plafond de dépense partagé** avec l'outil d'icônes (refus 402 au-delà) ; **journal d'appels** en ajout seul (modèle, durée, usage, coût estimé, erreur) affiché dans la carte et ajouté au journal `~/.local/state/dig-icons/ledger.jsonl`.
- Gemme créée par IA : `gemReward: false` par défaut (pas de gemme premium sans validation).
- **Essai réel effectué** (serveur de test, base jetable) : concept « minerai de cuivre oxydé vers 300 m » → *Cuivre oxydé / Oxidized Copper Ore / Geoxideerd kopererts*, minerai peu commun, 110 PV, 80, dès 300 m, poids 9, icône low-poly cuivre/vert-de-gris cohérente avec les icônes validées ; impact +7,6 % PV / +0,3 % récompense à 300 m. Durées : texte 26 s, image 45 s. Coût réel estimé : **0,088 USD** (texte 0,0055 + image 0,082).
- Dépendance : `sharp` passe en dépendance de production (déjà utilisé par l'outil d'icônes ; installé et vérifié en production).

Fichiers : `server/blockCatalog.js`, `server/blockAi.js` (nouveau), `server/index.js`, `public/js/blocks.js`, `public/js/iconLibrary.js`, `public/admin/index.html`, `public/admin/admin.js`, `package.json`, `package-lock.json`, tests `test/block-catalog-step-b.test.js` (4), `test/block-ai.test.js` (6, transport factice, aucune dépense), `test/block-catalog.test.js` (adapté).

## C. SHA, tests, déploiement

- Branche `feature/37-catalogue-blocs-admin` : `c814329` (étape B), `ab03d1f` (IA). **`develop` : `556858e` puis `db94b8e`.**
- `npm test` : 285/285 (étape B) puis **291/291** sur la branche, `develop` et chaque release.
- Copie de la base de production (×2) : empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` identiques avant/après démarrage ; `quick_check` ok ; seules des tables ajoutées (`block_ai_*`) et des versions de catalogue ajoutées (v2, v3).
- Production : sauvegardes vérifiées `~/backups/dig/dig-20261030-183326-pre-deploy-556858e.sqlite` et `~/backups/dig/dig-20261030-185045-pre-deploy-db94b8e.sqlite` ; 2 domaines 200, `/api/version` = `1.0.0+db94b8e`, `/api/admin/blocks/ai` sans clé = 401, journal sans erreur, `quick_check` ok, empreintes identiques à la sauvegarde ; navigateur 1280×900 et 390×844 : catalogue v3 (22 blocs) appliqué, aucune erreur.
- Non vérifié : le statut IA **en production** (nécessite la clé admin) ; le service tourne sous le même compte que l'essai réel (configuration lisible, pas de sandbox), il doit donc afficher « API IA : texte gpt-5-mini, image … ».
- Retour arrière : code → `git -C /home/ubuntu/Dig reset --keep 80bd4a6` + `npm ci --omit=dev` + redémarrage (tables ajoutées ignorées par l'ancien code) ; contenu → « Revenir à v1 » dans Versions.

## D. Test fonctionnel à faire par le propriétaire

1. **Jeu** : recharger https://dig.lodygames.com. À 150 m+ apparaissent Quartz, puis Obsidienne (200 m), Minerai d'argent (260 m)… Passer en NL (Paramètres) : « Kwarts », « Zilvererts ». Un saphir ne fait **pas** monter le compteur de gemmes.
2. **Admin → 🧱 Blocs** : « Version en vigueur : v3 », 22 blocs. « Probabilités à » 249 → terre meuble ≈ 0,9 %, argile ≈ 0,6 %, colonne « Dès » : « 1 m (atténué > 12 m : 2.1) ».
3. **Création IA** : la ligne d'état indique les modèles et la dépense (≈ 2,02 / 3 USD). Saisir un concept (ex. « coffre de mineur rouillé vers 100 m »), « ✨ Proposer un bloc » (≈ 1 min 30). Vérifier image + noms FR/EN/NL, corriger une langue, « Enregistrer les corrections », « Impact », puis « Ajouter au brouillon » → le bloc apparaît dans la liste (statut « nouveau »), **rien ne change en jeu** tant que vous ne publiez pas. Publier (facultatif) ou « Abandonner le brouillon ».

Attendu : contenu au-delà de 249 m, aucune gemme distribuée par les nouveaux blocs, proposition IA complète sans publication automatique.

## E. Choix techniques faits seul

- Atténuation **par palier** (poids réduit d'un coup au-delà de l'ancienne borne) plutôt que décroissance progressive : distribution quasi identique à l'existant (aucun changement à ≤ 12 m, < 1 point entre 13 et 22 m), lisible pour l'admin, toujours > 0.
- Projection « ancien format » du catalogue public pour les clients non rechargés (évite 36 % de terre et des gemmes chez eux).
- Anti-bot : part atténuée ignorée pour le PV minimum (un joueur honnête ne peut pas enchaîner des blocs à 1,5 %).
- IA : réutilisation de l'infrastructure #22 (configuration, clé, plafond, journal, prompt maître, référence, traitement) ; modèle texte `gpt-5-mini` (configurable par `DIG_TEXT_MODEL`) ; images en base plutôt qu'en fichiers (sauvegarde et retour arrière gratuits) ; gemmes IA sans gemme premium par défaut.

## F. Décisions demandées au propriétaire

1. **Plafond de dépense IA** : 2,02 / 3 USD consommés (outil d'icônes + essai) → ≈ 10 images restantes. Pour un usage régulier, relever `DIG_IMAGE_BUDGET_USD` dans `~/.config/dig/openai.env` (je ne modifie pas ce fichier). Recommandation : 10 USD.
2. (Étape D, inchangé) Saphir / améthyste / cristal ancien doivent-ils un jour rapporter des gemmes ? Recommandation : non pour l'instant.

## G. Restant à réaliser

- Étape B (suite) : écran « découvertes » côté joueur (blocs vus, « ??? dès X m ») ; icônes des 8 minerais (via la carte IA ou #22/#40).
- Étape C : événements temporaires. Étape D : tables de drops (gemmes, fragments, reliques, coffres).
- IA : génération en lot ; création IA étendue aux objets/reliques = périmètre #40.
- Signalé : favicon absent dans `/admin/` (404 en console).

---

# Rapport initial (étape A)

## 1. État réel

**Étape A déployée en production (SHA `1710147`) — en attente de recette.**
Étape B : **proposée** (nouveaux minerais chiffrés ci-dessous, rien d'activé). Étapes C (événements) et D (tables de drops gemmes/reliques/coffres) : **non commencées**.

Classement : **« Après lancement »** pour l'ensemble du ticket (le MVP public fonctionne avec les 14 blocs actuels) ; l'étape B (contenu au-delà de 249 m) est prioritaire parmi les suites car le propriétaire n'a plus rien à découvrir.

## 2. Résultat et changements

### Audit de l'existant (avant #37)
- Les 14 blocs étaient codés en dur dans `public/js/blocks.js` (tirage 100 % côté client, pondéré par profondeur, Chance #32, tirage reproductible #35).
- Tous les blocs avaient une borne cachée `maxDepth: 9999` (au-delà : repli sur la pierre seule) ; seules **terre meuble (≤ 12 m)** et **argile (≤ 22 m)** avaient une vraie profondeur maximale.
- Le budget de dégâts anti-bot (#25, `server/antibot.js`) recopiait à la main les PV minimum (3 / 6 / 8) : tout changement de catalogue l'aurait faussé.
- Coffres : contenu tiré par rareté (`public/js/chests.js`) ; trouvailles par catégorie (`collection.js`) — non modifiés (étape D).

### Ce qui est livré
- **`server/blockCatalog.js`** (nouveau) : catalogue versionné.
  - Version 1 = conversion **à l'identique** des 14 blocs, relus directement dans `public/js/blocks.js` (testé : mêmes probabilités au 1e-12 de 1 à 600 m, Chance 0 et 5).
  - Champs par bloc : identifiant stable, noms FR/EN/NL (les 14 d'origine gardent leurs traductions intégrées si vides), catégorie, rareté, icône emoji, image `/assets/…` facultative, couleurs, PV de base, récompense, **dès X m**, poids, actif/inactif.
  - **Brouillon unique → publication atomique** (refusée si invalide ou si une autre version a été publiée entre-temps), **retour arrière** (publie une nouvelle version au contenu d'une ancienne ; les blocs ajoutés depuis restent présents mais désactivés), **journal en ajout seul** (triggers SQLite), versions jamais modifiées ni supprimées.
  - Validation serveur : nom FR obligatoire pour un nouveau bloc, **aucune profondeur maximale pour un nouveau bloc**, poids > 0 (pour retirer : désactiver), **aucun bloc publié supprimable**, au moins un bloc actif à chaque profondeur, couleurs/images/noms filtrés (XSS).
  - Simulation 10 000 / 100 000 tirages par profondeur (probabilité théorique, fréquence observée, PV et récompense moyens), avec niveau de Chance.
- **Routes** : `GET /api/blocks/catalog` (public, lu par le jeu) ; `GET/PUT/DELETE/POST /api/admin/blocks…` protégées par `ADMIN_SECRET` (401 sans clé, testé) et tracées aussi par l'audit admin #25.
- **Jeu** (`blocks.js`, `main.js`, `iconLibrary.js`) : le catalogue publié est appliqué aux **prochains** blocs et mémorisé localement ; le bloc en cours, ses PV et les sauvegardes ne changent pas (#35 : un bloc désactivé sauvegardé est repris tel quel). Nom du bloc dans la langue du joueur. Image du catalogue affichée seulement si l'admin en renseigne une (les icônes v1 restent non activées par défaut).
- **Anti-bot #25** : PV minimum du budget de dégâts = minimum, profondeur par profondeur, sur **toutes** les versions publiées, et jamais plus strict que les valeurs d'origine (un joueur sur une ancienne version ne peut pas être freiné). Affiché dans l'onglet.
- **Panel admin, onglet « 🧱 Blocs »** : liste filtrable (texte, catégorie, statut, modifiés), probabilités à une profondeur choisie, formulaire avec aperçu du bloc, brouillon (changements champ par champ, erreurs, avertissements), publication avec note, simulation, versions avec « Revenir à vN », journal.
- La borne cachée 9 999 m est supprimée (sans effet pour les joueurs actuels, tous < 9 999 m).

Fichiers : `server/blockCatalog.js`, `server/index.js`, `server/antibot.js`, `public/js/blocks.js`, `public/js/main.js`, `public/js/iconLibrary.js`, `public/admin/index.html`, `public/admin/admin.js`, `test/block-catalog.test.js` (nouveau, 7 tests), `test/antibot.test.js` (adapté : plus de profondeur maximale implicite).

## 3. SHA, branche, procédure de test

- Branche : `feature/37-catalogue-blocs-admin` (commit `b84966d`) ; **`develop` : `1710147`** (fusion) ; déployé : `1710147`.
- Tests : `npm test` → 274/274 sur la branche, sur `develop` et sur la release `1710147`.
- Essai navigateur sur serveur de test (port 3101, base temporaire) : ajout d'un bloc dans le brouillon, simulation, publication v2, retour au jeu → le jeu reçoit la v2 et affiche le nouveau bloc (ordinateur 1280×900 et smartphone 390×844, aucune erreur JS).

## 4. Vérifications, limites, données joueurs

- Migration **additive uniquement** : 3 tables nouvelles (`block_catalog_versions`, `block_catalog_draft`, `block_catalog_audit`), aucune colonne ni donnée existante touchée. Testée sur une copie de la base de production : empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` identiques avant/après démarrage ; `quick_check` ok ; copie supprimée.
- Limites : les étapes C et D ne sont pas faites ; le tirage reste calculé par le client (comme avant), le serveur est source de vérité du **catalogue** et borne la progression via le budget anti-bot — un tirage côté serveur est un chantier distinct (#25 lot C / étape D) ; pas de « découverte » visible côté joueur (bestiaire) encore (étape B) ; sur smartphone, le tableau de l'onglet Blocs défile horizontalement (panel prévu pour ordinateur).

## 5. Déploiement

- SHA déployé : **`1710147`** (avance rapide `main` 68a67eb → 1710147, `scripts/deploy.sh` de la release).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-175531-pre-deploy-1710147.sqlite`.
- Après déploiement : dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+1710147`, `/api/blocks/catalog` = v1 (14 blocs), `/api/admin/blocks` sans clé = 401, journal sans erreur, `quick_check` ok, empreintes joueurs identiques à la sauvegarde ; jeu chargé en navigateur (ordinateur et smartphone) : catalogue v1 appliqué, aucune erreur.
- Retour arrière : code → `git -C /home/ubuntu/Dig reset --keep 68a67eb` + redémarrage (les 3 tables ajoutées sont simplement ignorées par l'ancien code) ; contenu → bouton « Revenir à vN » dans l'onglet.

### Test fonctionnel à faire par le propriétaire
1. Ouvrir https://dig.lodygames.com/admin/, saisir la clé admin, onglet **🧱 Blocs**.
2. Vérifier la liste : 14 blocs, « Version en vigueur : v1 ». Mettre « Probabilités à » = 249 : terre meuble / argile « — », pierre ≈ 30,9 %, diamant ≈ 0,52 %.
3. Simulation : Profondeurs `249`, 100 000 tirages, Simuler → colonnes Probabilité et Observé proches.
4. Essai sans risque : cliquer « Modifier » sur *diamant*, saisir un nom EN « Diamond », « Enregistrer dans le brouillon » → le bandeau indique un brouillon, la section Brouillon montre `names : null → {"en":"Diamond"}` ; **rien ne change en jeu**. Puis « Abandonner le brouillon ».
5. (Facultatif, visible des joueurs) publier une petite modification, vérifier en jeu après rechargement (s'applique aux blocs suivants), puis « Revenir à v1 » dans Versions.

Résultat attendu : tout fonctionne sans changer le jeu tant que rien n'est publié.

## 6. Choix techniques faits seul

- **Conversion à l'identique** : les bornes de terre meuble (12 m) et argile (22 m) sont conservées comme « bornes héritées » (avertissement dans le panel) — les supprimer changerait toutes les probabilités au-delà de 22 m (décision 1 ci-dessous). Un nouveau bloc ne peut pas avoir de profondeur maximale.
- Catalogue d'origine relu dans `blocks.js` plutôt que recopié : une seule source, migration prouvée par test.
- Catalogue public incluant les blocs désactivés : nécessaire pour reprendre un bloc sauvegardé (#35).
- Budget anti-bot = minimum sur toutes les versions : ne peut que rester permissif ; aucun joueur honnête freiné par un changement de PV.
- Le jeu applique le catalogue en arrière-plan (jamais bloquant) ; s'il est injoignable, le catalogue mémorisé ou d'origine sert.

## 7. Décisions demandées au propriétaire

1. **Bornes de surface** : terre meuble (jusqu'à 12 m) et argile (jusqu'à 22 m) disparaissent ensuite. (a) Les garder (recommandé : c'est la sensation « on quitte la surface », et cela ne touche pas « un type débloqué » au sens de nouvelles découvertes) ; (b) les supprimer : ils réapparaîtraient en profondeur (≈ 36 % des blocs à 249 m, PV moyens fortement réduits — gros changement d'équilibrage).
2. **Étape B — premiers nouveaux minerais** (proposition, non activée ; PV/récompense de base, ×(1+0,12 d) et ×(1+0,05 d) en jeu) :

| Bloc | Catégorie / rareté | Dès | PV base | Récompense | Poids |
|---|---|---|---|---|---|
| Quartz | minerai / peu commun | 150 m | 45 | 70 | 14 |
| Obsidienne | pierre / peu commun | 200 m | 60 | 40 | 16 |
| Minerai d'argent | minerai / rare | 260 m | 95 | 260 | 7 |
| Saphir | gemme / épique | 330 m | 150 | 1 900 | 2,5 |
| Minerai de platine | minerai / rare | 420 m | 120 | 520 | 5 |
| Améthyste | gemme / épique | 520 m | 170 | 2 600 | 2 |
| Fer météorique | minerai / légendaire | 650 m | 220 | 5 200 | 1 |
| Cristal ancien | gemme / légendaire | 800 m | 300 | 9 000 | 0,6 |

   Effet simulé (catalogue actuel → avec proposition) : à 260 m, PV moyens +14,5 %, récompense moyenne +5 %, 16 % de blocs nouveaux ; à 520 m, PV +27 %, récompense +73 % ; à 1 000 m, PV +31 %, récompense ×2,3, 20 % de nouveaux. Options : (a) valider tel quel ; (b) valider les noms/profondeurs mais réduire PV ou récompenses ; (c) proposer vos propres noms. Recommandation : (a) pour Quartz → Platine d'abord, le reste après observation. Les icônes (#22/#40) suivront.
3. Gemmes « saphir/améthyste » : doivent-elles compter comme gemmes (monnaie gemmes) ? Aujourd'hui seule la catégorie « gemme » sert de marqueur ; la monnaie gemmes relève de l'étape D (#20).

## 8. Restant à réaliser

- Étape B : après décision 2, saisir les blocs (directement dans l'onglet) + écran « découvertes » côté joueur (bestiaire : blocs vus, « ??? dès X m »).
- Étape C : événements temporaires (dates UTC, blocs/chances d'événement, calendrier).
- Étape D : tables de drops gemmes/fragments/reliques et contenu des coffres par bloc/profondeur/événement, probabilités affichées aux joueurs, cohérence #20.
- Amélioration signalée (hors périmètre) : favicon absent dans `/admin/` (404 dans la console).
