# Ticket #59 — [P1] Langues extensibles : traductions IA automatiques et pilote italien

- Ticket : https://github.com/ReC82/Dig/issues/59
- Branche : `feature/59-langues-extensibles` (dernier commit de correction `83e6f70`, develop `ba5ccfb`, déployé `ba5ccfb`)
- Date : 03/11/2026

## Mise à jour du 03/11/2026 (soir) — corrections des recettes #59-A à #59-D

**État réel : déployé en production (SHA `ba5ccfb`) le 03/11/2026 à 20:16 — en attente de recette.**
Classement : **Après lancement** (qualité linguistique, aucune fonction bloquée).

### Résultat
Le propriétaire a testé la page Collection en anglais, néerlandais et espagnol (commentaires #59-A, B, C, D). Le basculement de langue et le souvenir d'événement (nom, description, date) sont validés dans les trois langues. Les défauts de rédaction et de mise en forme qu'il a relevés sont corrigés. **Aucun coût ni bonus n'a changé** : seuls les textes ont été modifiés.

| Langue | Avant | Après |
|---|---|---|
| EN | `+2 damages/click` | `+2 damage per click` |
| EN | `5 fragments(missing 3)` | `5 fragments (3 more needed)` |
| EN | `Event souvenirs` | `Event keepsakes` |
| EN | `+1 fragments/chest`, `+3 auto damage/sec` | `+1 fragment per chest`, `+3 automatic damage per second` |
| NL | `2 scherfs`, `5 scherfs(tekort 3)` | `2 scherven`, `5 scherven (nog 3 nodig)` |
| NL | `Souvenirs van evenementen` | `Evenementherinneringen` |
| NL | `Collectie van de oorsprong` (texte du jeu) | `Oorsprongscollectie` |
| NL | `+2 auto schade/sec`, `-10% blok HP` | `+2 automatische schade per seconde`, `-10% levenspunten van blokken` |
| NL | `Schervenagneet` (coquille) | `Schervenmagneet` |
| ES | `5 fragmentos(faltan 3)` ; `(faltan 1)` | `5 fragmentos (faltan 3)` ; `(falta 1)` |
| ES | `+2 de daño/clic`, `+2 de daño auto/s` | `+2 de daño por clic`, `+2 de daño automático por segundo` |
| ES | `-10% PV de bloques`, `+1 fragmento/cofre` | `−10 % de vida de los bloques`, `+1 fragmento por cofre` |

Autres corrections du même type :
- **Pluriels néerlandais.** Le « s » ajouté au français ne marche pas en néerlandais. Tous les pluriels NL sont maintenant de vrais pluriels : scherven, kisten, verbeteringen, edelstenen, munten, wissels. Un test interdit désormais tout `{s}` dans les textes NL.
- **Compteurs.** `0 / 2 earned` et `0 / 8 found` utilisent le même espacement que l'en-tête de collection (espace fine insécable autour de `/`), dans les trois langues.
- **Carte relique.** Le coût et le manque (`(3 more needed)`) étaient deux éléments « flex » : l'espace entre eux disparaissait au copier-coller et pour les lecteurs d'écran. C'est maintenant du texte centré avec un vrai espace. Le manque ne se coupe plus en deux lignes.

**Contenus enregistrés en base.** Le badge `100 metres deep` et le nom NL de la série `Oorsprongscollectie` sont des contenus modifiables dans l'admin et déjà enregistrés en base. Le texte de départ a été corrigé dans le code (`server/badges.js`, `server/collectionCatalog.js`), mais **la base de production n'est pas réécrite**. Pour voir le nouveau texte en jeu, modifiez-le dans l'admin (voir le test ci-dessous).

### Fichiers
- `public/js/i18n.js` : textes EN, NL et ES ; pluriels `{ one, other }` en NL, en EN (fragments par coffre) et en ES (falta/faltan).
- `public/css/style.css` : `.relic-cost` sans flex ; `.relic-shortfall` insécable.
- `server/badges.js` et `server/collectionCatalog.js` : textes de départ.
- Tests :
  - `test/i18n-languages.test.js` : nouveau test des recettes #59-A/C/D ;
  - `test/i18n-es.test.js` : la comparaison des clés accepte les pluriels propres à une langue ;
  - `test/collection-catalog.test.js` : nouveau nom NL de la série.

### SHA, tests et déploiement
- Branche : `feature/59-langues-extensibles`, commit `83e6f70`.
- `develop` : `ba5ccfb`. Déployé : **`ba5ccfb`** (précédent `0c44cf9`).
- `npm test` : 564/564 sur la branche et sur le SHA exact de la release.
- Copie de la base de production démarrée en mode production : empreintes identiques avant et après le démarrage (`users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`).
- Avant le déploiement : aucune génération IA en cours (dernier appel à 17:16 UTC).
- Sauvegarde vérifiée : `dig-20261103-201635-pre-deploy-ba5ccfb.sqlite`.
- Après le déploiement :
  - les deux domaines répondent 200 avec la version `1.0.0+ba5ccfb` ;
  - aucune erreur dans le journal ; `quick_check` ok ;
  - empreintes des données joueurs identiques à la sauvegarde ;
  - navigateur sans compte (390×844) en NL, EN et ES : cartes reliques conformes au tableau ci-dessus, 0 erreur JavaScript.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 0c44cf9` puis `sudo systemctl restart dig`. Aucune migration, aucune donnée joueur touchée.

### Test fonctionnel à faire par le propriétaire (3 min, nouveaux points seulement)
1. Compte `testeur`, langue **Nederlands** → Collectie → Relikwieën. Attendu : `5 scherven (nog 3 nodig)`, `+1 scherf per kist`, `Schervenmagneet`, section `Evenementherinneringen`.
2. Langue **English** → Collection → Relics. Attendu : `+2 damage per click`, `5 fragments (3 more needed)`, section `Event keepsakes`.
3. Langue **Español** → Colección → Reliquias. Attendu : `+2 de daño por clic`, `−10 % de vida de los bloques`, `5 fragmentos (faltan 3)`.
4. Facultatif, pour les contenus déjà en base :
   - Admin → Badges → `profondeur_100` → nom EN `100 metres deep` → Enregistrer ;
   - Admin → Collections → série « origines » → nom NL `Oorsprongscollectie` → Publier.

   Attendu : nouveau nom visible en jeu après rechargement.

À tester ensuite, sur d'autres écrans comme le propriétaire l'a demandé : Améliorations, Quotidien (missions NL `3 kisten openen`, récompenses `💰 … munten`) et Coffres.

### Choix techniques faits seul
- J'ai utilisé des pluriels `{ one, other }`, déjà gérés par `t()` via `Intl.PluralRules` depuis le pilote italien. Je n'ai pas modifié le code appelant, qui passe toujours `s` : aucun risque pour le français.
- J'ai gardé `keepsakes` plutôt que `collectibles` : ces objets sont des souvenirs conservés après l'événement, pas des objets à collectionner en série.
- Je n'ai pas réécrit les contenus en base (badge, série) : ce sont des données éditées dans l'admin. Le propriétaire garde la main.

### Décisions demandées
Aucune nouvelle décision. Les trois questions du § 8 restent ouvertes.

---

## 1. État réel

**Déployé en production (SHA `7d1cda6`) le 03/11/2026 à 06:09 — en attente de recette.**
L'italien est livré **masqué au public** : seuls les testeurs qui ouvrent le lien `?lang=it` le voient. Pour l'activer pour tous, il faut une décision du propriétaire après la recette native (§ 8).

Classement : **Après lancement**. Rien ici ne bloque le MVP public, la pré-bêta familiale ni les saisons #48 : les 4 langues actuelles fonctionnent exactement comme avant.

## 2. Réconciliation

Rien n'était livré pour #59 : pas de branche ni de commentaire. Ce qui existait déjà a été réutilisé, pas refait :

- l'espagnol et le sélecteur compact (#42) ;
- le repli FR des contenus (#37, #38, #39, #50, #56) ;
- la configuration IA et le plafond local partagé (#22, `tools/icons/openai-images.js`).

## 3. Résultat et changements réalisés

### Visible en jeu

- **Joueurs ordinaires : aucun changement.** Ils voient les mêmes 4 langues (Français, English, Nederlands, Español), au premier lancement et dans ⚙ Paramètres.
- **Testeur avec `https://dig.lodylands.com/?lang=it`** :
  - le jeu passe en italien (barre du bas : Scava · Potenzia · Collezione · Giornaliero · Negozio · Stagione) ;
  - le choix est mémorisé sur l'appareil ;
  - « Italiano » apparaît dans Paramètres → Langue, sur cet appareil seulement ;
  - les pluriels sont de vrais pluriels italiens (« 1 danno per clic » / « 3 danni per clic »).
- **Restent en français pour l'italien (repli explicite, jamais de clé technique) :**
  - thème et nom de saison ;
  - collections saisonnières, badges, actualités et événements saisis dans l'admin ;
  - messages d'erreur détaillés du serveur ;
  - e-mails.

### Ce qui a été construit

| Élément | Fichiers |
|---|---|
| **Registre central des langues** (BCP 47, statut active / preview / planned, nom natif, locale Intl, écriture, sens, drapeau facultatif). Le même fichier sert au navigateur et au serveur. | `public/js/languages.js`, `server/languages.js` |
| Plus aucune liste « fr/en/nl/es » recodée en dur : modules serveur (boutique, actualités, badges, collections, blocs, événements, thèmes de saison, assistants IA) et admin. Les valeurs restent identiques (langues actives). | `server/*.js` (10 fichiers), `public/admin/admin.js`, `index.html` ×2 |
| **i18n.js** : fichiers de langue chargés à la demande, accès testeur `?lang=<code>`, langue « planned » refusée, pluriels `Intl.PluralRules` (one/few/many pour le russe), repli FR, `<html lang/dir>` | `public/js/i18n.js`, `public/js/news.js` |
| **Outil de traduction IA** (voir ci-dessous) : file idempotente et reprenable, plafonds, journal de coût, glossaire, contrôles qualité, corrections humaines protégées, export/import CSV pour relecture native, détection des clés oubliées | `tools/i18n/{lib,check,translate,cli}.js`, `i18n/glossary.json` |
| **Pilote italien** : 579/579 textes, 0 erreur | `i18n/it.json` (mémoire), `public/js/locales/it.js` (généré) |
| Audit des textes, architecture, procédure d'ajout de langue | `docs/I18N.md` |
| Script de recette de 15 minutes pour le collègue italophone (en italien) | `docs/I18N-PILOTE-IT.md` |
| Tests | `test/i18n-languages.test.js` (10 tests), `test/robustness.test.js` (ajusté) |

### Fonctionnement de la traduction automatique

- **File de traduction :**
  - seules les clés manquantes, ou dont le français a changé (empreinte), sont envoyées ;
  - la mémoire est enregistrée après chaque lot, donc une interruption reprend là où elle s'est arrêtée ;
  - une file vide ne fait aucun appel.
- **Budget :**
  - nombre de lots par lancement limité ;
  - plafond par commande (0,50 USD par défaut) ;
  - plafond local partagé de `~/.config/dig/openai.env` ;
  - simulation par défaut (sans `--apply`) ;
  - coût estimé pour une langue complète : **environ 0,03 USD** ;
  - journal versionné et sans secret : `i18n/journal.jsonl`.
- **Qualité :**
  - chaque réponse du modèle est contrôlée avant d'être enregistrée ;
  - erreur (traduction refusée) : variable `{x}` cassée, balise, texte vide, mauvaise écriture latin/cyrillique ;
  - avertissement : texte identique au français, trop long pour mobile, emoji perdu, doublon, langue improbable.
- **Correction humaine (`origin: human`)** : jamais retraduite par l'IA. Si le français change, elle est signalée « à revoir ».
- **Le jeu n'appelle jamais l'IA** quand un joueur lit un texte. Aucune image n'est nécessaire.

## 4. SHA et procédure de test

- `develop` : **`7d1cda6`** (fusion de `9fd83a2`). Ce rapport est ajouté ensuite sur `develop`, sans redéploiement.
- `npm test` : **500/500**, sur la branche, sur `develop` fusionné et sur le SHA exact de la release.
- Commandes utiles :
  ```
  node tools/i18n/cli.js status        # it : 100 % (579/579), ru : planned
  node tools/i18n/cli.js check it      # 0 erreur, 2 avertissements (« Fossile », « Prof. max » : identiques au FR, corrects en italien)
  node tools/i18n/cli.js translate it  # simulation : file vide, aucun appel
  node tools/i18n/cli.js scan          # 493 clés utilisées dans le code, 0 absente
  ```

## 5. Vérifications effectuées

- **Tests automatisés** (`test/i18n-languages.test.js`) :
  - registre : codes BCP 47 uniques, statuts, normalisation (`it-IT` → `it`) ;
  - modules serveur alignés sur le registre ; l'italien n'est pas exigé à la publication ;
  - italien masqué au public, ouvert par `?lang=it` ; russe refusé (accès et enregistrement) ;
  - chargement du fichier, repli FR, pluriels, une langue intégrée ne peut pas être écrasée ;
  - contrôles qualité ;
  - file IA avec transport factice : reprise après limite de lots, plafonds de la commande et local, rejet des variables cassées, idempotence (0 appel en relance), correction humaine protégée et signalée « à revoir », fichier publié sans l'entrée en erreur, import CSV ;
  - pilote italien complet et fichier publié identique à la mémoire ;
  - garde-fou d'activation : une langue active doit avoir au moins 98 % de couverture et 0 erreur ; une langue planned ne publie rien ;
  - aucune clé oubliée.
- **Navigateur headless**, smartphone 390×844 et ordinateur 1280×900, sur le serveur de test (port 3101) puis **en production** (dig.lodylands.com) :
  - public : premier lancement en `fr, en, nl, es` seulement ;
  - `?lang=it` : navigation en italien, `<html lang="it">` ;
  - Paramètres : « Italiano » actif, titre « Lingua » ;
  - italien conservé après rechargement ;
  - retour au Français par le sélecteur ;
  - aucun débordement horizontal ;
  - aucune erreur console en production.
  - Captures vérifiées : Potenziamenti, Impostazioni et Stagione.
- **Copie de la base de production** démarrée en mode production (port 3122) : `/health`, `/api/version`, `it.js` et `languages.js` servis. Empreintes identiques avant et après démarrage. Copie supprimée.
- **Impact sur les données des joueurs : aucun.** Pas de migration, pas d'écriture en base. La langue reste un réglage local du navigateur.

Non vérifié :
- appareil physique ;
- appel réel à l'API OpenAI : le pilote italien a été traduit par Claude pendant cette session, sans dépense externe ; la file automatique est testée avec un transport factice.

## 6. Déploiement

- SHA déployé : **`7d1cda6`**, avance rapide de `main` depuis `0508d4f`, sans `--force`, `npm ci` non nécessaire.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261103-060947-pre-deploy-7d1cda6.sqlite`.
- Après déploiement :
  - dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+7d1cda6`, `js/locales/it.js` → 200 ;
  - journal sans erreur ;
  - `pragma quick_check` = ok ;
  - empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** à la sauvegarde ;
  - essai navigateur en production réussi.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 0508d4f && sudo systemctl restart dig` (aucune dépendance changée, aucune migration).

### Test fonctionnel à faire par le propriétaire (3 min, puis 15 min pour le testeur italien)

1. Sur le téléphone, ouvrir https://dig.lodylands.com normalement → ⚙ Paramètres → Langue. **Attendu :** toujours 4 langues, pas d'italien.
2. Ouvrir **https://dig.lodylands.com/?lang=it**. **Attendu :** jeu en italien (Scava, Potenzia, Collezione, Giornaliero, Negozio, Stagione).
3. Parcourir Potenzia et Collezione. **Attendu :** textes en italien. Le thème de la semaine reste en français (limite prévue).
4. Fermer et rouvrir le jeu. **Attendu :** italien conservé.
5. Paramètres → Lingua → Français. **Attendu :** tout revient en français.
6. Transmettre `docs/I18N-PILOTE-IT.md` (partie italienne) au collègue italophone. Il suit le script en 15 minutes sur son téléphone.

## 7. Choix techniques faits seul

- **Un seul fichier de registre partagé navigateur/serveur**, plutôt qu'une API : il est disponible avant le premier rendu, fonctionne hors ligne et ne demande aucun appel réseau.
- **Pilote masqué en production via `?lang=it`** : il n'existe pas d'environnement de recette isolé. Ce lien ne touche que l'appareil du testeur. Le serveur et les données ne changent pas.
- **Italien traduit par Claude (session #59)**, sans appel OpenAI :
  - aucune dépense externe, pas d'usage de clé ;
  - qualité relue texte par texte avec le glossaire ;
  - entrées marquées `origin: ai`, donc remplaçables par l'IA si le français change, et corrigeables par un humain.
  - Le transport OpenAI est prêt (`--apply`) pour les nouvelles langues et les textes futurs.
- **Langues de contenu serveur = langues actives seulement** : une langue preview ne bloque aucune publication de collection, badge ou événement. Aucun brouillon n'est publié et aucun drop n'est activé.
- **Drapeau facultatif** : sans drapeau, une pastille neutre avec le code est affichée, toujours à côté du nom natif (« une langue n'est pas un pays »).
- **Pluriels** : objets `{ $n, one, few, many, other }` choisis par `Intl.PluralRules`. Les marques françaises `{s}` restent facultatives dans les autres langues.
- Mémoire de traduction **versionnée dans Git** (`i18n/it.json`) : diff lisible, historique des corrections, aucune table en base.

## 8. Décisions demandées au propriétaire

1. **Activation de l'italien pour tous** (après la recette du collègue) :
   - a) activer quand la recette est concluante et les corrections importées (**recommandé**) ;
   - b) laisser en preview (testeurs seulement).

   Activer = passer `status: 'active'` dans `public/js/languages.js`. Conséquence : les nouveaux contenus serveur devront aussi exister en italien. Les assistants IA de l'admin le proposent automatiquement.
2. **Traduction automatique par l'API OpenAI** pour les prochaines langues (russe…) et les textes futurs, environ 0,03 USD par langue, dans le plafond local existant :
   - a) autorisée par commande manuelle (`translate <code> --apply`) (**recommandé**) ;
   - b) à chaque déploiement, automatiquement ;
   - c) non, traductions faites par Claude en session.
3. **Russe** : il reste `planned`, sans aucun lancement automatique. Le passer en preview pour tester le cyrillique quand vous le souhaitez ?

## 9. Éléments restant à réaliser (Après lancement)

- **Rattrapage des contenus serveur déjà publiés** lors d'une activation : collections saisonnières, badges, actualités, événements, thèmes de saison, articles de la boutique de cadeaux. Principe prévu : file de contenu serveur (table additive `content_translations`, même empreinte de source et même protection humaine). Non livré ici, car aucune langue n'est activée.
- Codes d'erreur serveur traduits côté client (aujourd'hui `{msg}` en français pour toutes les langues).
- E-mails dans les nouvelles langues (repli FR aujourd'hui ; SMTP de production non configuré, #43).
- Noms de saison et de ligue localisables (#19).
- Relecture native de l'espagnol (#42), possible avec le même circuit `export`/`import`, après migration de `es` vers un fichier de langue (facultatif).
