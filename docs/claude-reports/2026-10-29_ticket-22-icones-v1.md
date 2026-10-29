# Ticket #22 — T-15 : bibliothèque d'icônes (prototype pierre)

- **Ticket :** https://github.com/ReC82/Dig/issues/22
- **Date :** 2026-10-29
- **Branche :** `feature/22-icones-v1`, intégrée dans `develop`

## 1. État réel

**Partiel — bloqué.** L'infrastructure est livrée et testée : bibliothèques `legacy` et `v1`, repli, rollback, chaîne de génération, contrôles et comparaison visuelle. En revanche, **aucune icône n'a été générée** : la seule clé OpenAI présente sur le serveur, celle de Jury Central, est **refusée par OpenAI** (401 `invalid_api_key`). Coût API engagé : **0 USD**. Rien n'est déployé, et `legacy` reste la valeur par défaut.

## 2. Ce qui est livré

| Élément | Rôle |
|---|---|
| `public/js/iconLibrary.js` | Choix `legacy` / `v1`. `legacy` est **par défaut** et rend **exactement** l'ancien affichage (`textContent = emoji`, aucun attribut ajouté). `v1` est activé matériau par matériau ; si l'image est absente ou en erreur, le rendu repasse en `legacy` |
| `public/assets/icons/library.json` | Configuration lue sans cache : `defaultLibrary: "legacy"` ; manifeste v1 **vide** (aucun asset) |
| `public/js/main.js`, `public/index.html`, `public/css/style.css` | Un seul point d'appel dans `renderBlock()` ; styles appliqués **uniquement** quand `data-icon-lib="v1"` est présent (jamais en `legacy`) |
| `tools/icons/openai-images.js` | Client OpenAI Images de Dig, hors ligne. Endpoints `generations` (JSON) et `edits` (multipart `image[]`, `input_fidelity`), avec `background: transparent` et `output_format: png`. Clé lue sur place et jamais affichée, messages d'erreur expurgés, budget plafonné, journal des coûts |
| `tools/icons/prompt-master.md`, `materials.json` | Prompt maître versionné (`v1.0`), avec clause de référence pour les matériaux suivants. Fiche **pierre** seule, avec ton texte **mot pour mot** |
| `tools/icons/generate.js` | 1 à 3 propositions. La référence officielle validée est jointe **systématiquement** dès qu'elle existe. Métadonnées complètes par proposition |
| `tools/icons/process.js` | Contrôle du **vrai** canal alpha (coins, part transparente, bords anti-crénelés) ; recadrage et recentrage avec une **marge de 12 %** ; PNG RGBA 1024 ; WebP 256 et 128 ; mesure de lisibilité sur fond sombre et aperçu de contrôle |
| `tools/icons/compare.js` | Captures du **vrai composant** `#block` pour les 14 matériaux, puis comparaison au pixel près |
| `docs/ICONS.md` | Mode d'emploi et **procédure de rollback** |
| `test/icons.test.js` | 13 tests |
| `sharp` (dépendance de développement) | Traitement d'image, pour l'outil uniquement (absent en production avec `npm ci --omit=dev`) |

## 3. Tentative de génération

- Configuration propre à Dig : `~/.config/dig/openai.env` (mode 600, sans aucune valeur secrète). Modèle `gpt-image-2.5-flare`, qualité `high`, 1024×1024, fond transparent. Plafond local de **3 USD**, au plus 3 images par commande.
- La clé indiquée est **celle de Jury Central**, lue sur place (`/srv/jury-central/.env`). L'exception est autorisée explicitement dans la configuration, et un avertissement s'affiche à chaque utilisation, car ce fichier est en mode 664.
- Premier appel (une seule proposition, pour limiter le risque) : **401 `invalid_api_key`**. La clé est révoquée ou invalide. Aucune image et **aucun coût**. Les deux autres propositions n'ont donc pas été lancées.
- **Fuite évitée :** le message d'OpenAI contenait la forme masquée de la clé (ses 4 derniers caractères). Ces caractères ont été retirés du journal des coûts. Toutes les erreurs passent désormais par un filtre (`redact`), couvert par un test.
- ⚠️ **À signaler pour Jury Central :** si sa génération d'images utilise cette même clé, elle est probablement en panne. Rien n'a été modifié dans ce projet.

## 4. Vérifications effectuées

| Contrôle | Résultat |
|---|---|
| `npm test` | **21/21** (13 tests #22, plus les tests #13). Le test de déploiement de #13 était fragile (il n'attendait pas le serveur) : il est corrigé |
| Comparaison visuelle, vrai composant, 14 matériaux, avant (`develop`) / après | **`legacy` identique au pixel près pour les 14 matériaux**. `v1` avec manifeste vide : identique pour les 14 |
| Mécanique v1 avec une pierre **factice** (polygones générés par programme, jamais committée), sur une copie jetable | Image affichée dans `#block`, à 70 % du bloc (≈ 119 px sur 170), en WebP 128 et 256 pour les écrans haute densité ; les **13 autres matériaux restent identiques** au pixel près ; marges mesurées 12,0 % (axe le plus long) |
| Repli : image v1 supprimée (404) | La pierre retombe sur l'emoji, **identique au pixel près** (14/14) |
| Production | Inchangée : `49faf2d`, aucun déploiement |

## 5. Rollback (voir `docs/ICONS.md`)

1. **Global, immédiat :** `"defaultLibrary": "legacy"` dans `public/assets/icons/library.json`. Pas de redémarrage, pas de migration, aucune donnée de joueur touchée.
2. **Un seul matériau :** retirer son entrée v1.
3. **Complet :** `git revert` des commits #22.

## 6. Choix techniques

- **La marge de 12 % est imposée en post-traitement**, pas confiée au modèle. Le recadrage sur l'alpha suivi d'un recentrage donne un cadrage identique pour tous les futurs matériaux (objet à ≈ 76 % de la toile, conforme à « environ 75 % »).
- **Pas de détourage « maison » si l'API ne fournit pas de vrai alpha** : la proposition est **refusée** par le contrôle. Une transparence peinte, en damier, ne passe pas.
- **Configuration côté client sans redéploiement :** fichier JSON lu sans cache, plutôt qu'un réglage serveur. Le rollback ne touche ni le code ni la base.
- **Taille d'affichage :** 70 % du bloc, une taille qui suit les media queries existantes du bloc.

## 7. Décisions demandées

1. **Clé OpenAI dédiée à Dig (bloquant).** Recommandation : un projet OpenAI « Dig » avec un **plafond de dépense mensuel**, et une clé limitée à l'API Images. Pour l'installer sans me la transmettre, tape dans cette session :
   `! umask 077; printf 'OPENAI_API_KEY=%s\n' 'sk-…' > ~/.config/dig/openai.key`
   Puis, dans `~/.config/dig/openai.env`, remplace `DIG_OPENAI_KEY_FILE=` par `/home/ubuntu/.config/dig/openai.key` et supprime la ligne `DIG_OPENAI_ALLOW_SHARED_KEY_FILE=1`. Je lance ensuite 3 propositions au plus, dans la limite de 3 USD.
2. **Plafond local :** 3 USD pour ce prototype, à confirmer.
3. **Clé de Jury Central :** à vérifier ou remplacer de ton côté (hors périmètre Dig).

## 8. Reste à faire

- Générer 2 ou 3 propositions de pierre. Pour chacune : contrôles automatiques et aperçus dans le composant réel (avant/après, fond sombre).
- Après ta validation visuelle :
  - enregistrer le PNG maître dans `art/icons/v1/reference/pierre.png` ;
  - remplir l'entrée `pierre` du manifeste v1 ;
  - garder `legacy` par défaut jusqu'à ta décision d'activation.
- Charbon, fer et diamant : **plus tard**, uniquement sur ta demande, avec la pierre comme référence.

## 9. Mise à jour — génération avec la clé dédiée (29/10, 22:55)

- **Clé dédiée Dig** installée par le propriétaire dans `~/.config/dig/openai.key` (mode 600). Configuration basculée dessus ; l'exception de clé partagée (`DIG_OPENAI_ALLOW_SHARED_KEY_FILE`) est supprimée. Le fichier contient la clé brute (sans `OPENAI_API_KEY=`) : ce format est désormais accepté (`b9ed934`, test ajouté, 14/14).
- **Vérification de la clé** par un appel gratuit (`GET /v1/models`) : HTTP 200, `gpt-image-2.5-flare` disponible.
- **Génération :** 3 propositions de pierre, texte V3 envoyé mot pour mot, sans image de référence (aucune « Pierre V3 » fournie dans le répertoire de travail). Aucun autre matériau.

| Proposition | Coût | Contraste bloc clair / foncé / page | Contrôles |
|---|---|---|---|
| A `pierre-20261029-215555-a` | 0,0712 USD | 1,72 / 2,35 / 4,05 | alpha, marge 12 %, exports : ok |
| B `pierre-20261029-215555-b` | 0,0712 USD | 1,46 / 1,99 / 3,42 | ok |
| C `pierre-20261029-215555-c` | 0,0712 USD | 1,49 / 2,03 / 3,50 | ok |

- **Dépense cumulée : 0,2136 USD** sur un plafond de 3 USD (estimation depuis l'usage renvoyé par l'API).
- **Vrai composant du jeu** (serveurs jetables en local, arrêtés ensuite) : pour chacune des trois, `legacy` identique au pixel près sur les 14 matériaux, et en `v1` seule la pierre change (13/13 autres identiques).
- **Fichiers :** `art/icons/v1/candidates/pierre-20261029-215555-{a,b,c}/`, sur le serveur, **non committés** : seul le PNG maître validé sera versionné.
- **En attente :** le choix A, B ou C par le propriétaire. Ensuite : référence `art/icons/v1/reference/pierre.png`, entrée `pierre` du manifeste v1, `legacy` toujours par défaut. Aucun déploiement.
