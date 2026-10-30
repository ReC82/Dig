# Ticket #22 — T-15 : bibliothèque d'icônes (prototype pierre)

- **Ticket :** https://github.com/ReC82/Dig/issues/22
- **Date :** 2026-10-29
- **Branche :** `feature/22-icones-v1`, intégrée dans `develop`

## 1. État réel

> **Mise à jour du 30/10 (voir §11) :** la pierre C est **en production depuis le 30/10 à 00:48** (SHA déployé `18e3881`, aujourd'hui `e32398d`). On la voit seulement avec `https://dig.lodylands.com/?icons=v1`. L'adresse normale garde les emoji pour tous les joueurs. **En attente de ton retour visuel sur téléphone.** Aucune autre image générée.
>
> *Historique (29/10) :* **Partiel — bloqué.** L'infrastructure est livrée et testée : bibliothèques `legacy` et `v1`, repli, rollback, chaîne de génération, contrôles et comparaison visuelle. En revanche, **aucune icône n'a été générée** : la seule clé OpenAI présente sur le serveur, celle de Jury Central, est **refusée par OpenAI** (401 `invalid_api_key`). Coût API engagé : **0 USD**. Rien n'est déployé, et `legacy` reste la valeur par défaut.

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

## 10. Validation et intégration de la pierre (29/10)

- **Choix du propriétaire : proposition C** (`pierre-20261029-215555-c`), définitif.
- **Référence officielle :** `art/icons/v1/reference/pierre.png`, copie exacte du PNG maître présenté (sha256 `93527a1a0dc5…`). Sa provenance est dans `pierre.json`. Elle sera jointe automatiquement à toute future génération.
- **Bibliothèque v1 :** `public/assets/icons/v1/pierre-128.webp` et `pierre-256.webp`, identiques aux exports de la proposition C ; entrée `pierre` ajoutée au manifeste.
- **Inchangé :** `defaultLibrary` reste `legacy`. Les emoji ne sont ni modifiés ni supprimés, et les trois niveaux de rollback de §5 s'appliquent tels quels.
- **Vérifications :**
  - `npm test` : 23/23, dont un nouveau test de cohérence entre manifeste, exports et référence ;
  - vrai bloc du jeu : `legacy` identique au pixel près (14/14). En `v1`, seule la pierre change, avec un rendu identique à l'aperçu C validé.
- **Rien n'est déployé.** Aucun autre matériau n'a été généré. Les propositions A et B restent sur le serveur, hors Git.
- **Reste :** décider de l'activation de `v1` (au moment d'un déploiement validé), puis des matériaux suivants, sur ta demande.

## 11. Pierre C visible dans le vrai jeu (30/10)

**Réponse à la demande du 29/10, 22:48 :** voir la pierre C dans Dig, sur téléphone, avant toute autre image.

### État réel
**Déployé en production, en attente de ton retour visuel.** Aucun nouveau code ni nouveau déploiement n'a été nécessaire pour cette étape.

- **URL à ouvrir :** **https://dig.lodylands.com/?icons=v1** (ou `https://dig.lodygames.com/?icons=v1`).
- **Commit de la pierre C :** `0f37780`, sur `feature/22-icones-v1`, fusionné dans `develop` en `b7635b3`.
- **Mise en ligne :** avec le lot 1, le 30/10 à 00:48 (SHA `18e3881`).
- **Version servie aujourd'hui :** `1.0.0+e32398d`.

### Écart avec ta demande, en toute transparence
Tu demandais un déploiement ciblé, sans mettre `develop` en ligne d'un bloc. Ta directive du 30/10 a remplacé celle du 29 : elle autorise le déploiement ordinaire des tickets intégrés. Cette nuit, `develop` a donc été déployé en lots, avec #8 à #21. La pierre C est arrivée avec le premier lot, en tant qu'aperçu.

Aucun déploiement ciblé spécial n'a donc été fait, et il n'est plus utile : le code de #22 en production est exactement celui de `develop`. Chaque lot a été déployé avec :
- une sauvegarde vérifiée ;
- des empreintes des données joueurs identiques ;
- `quick_check` ok.

Le détail se trouve dans le rapport de nuit.

### Preuves d'isolation, vérifiées le 30/10 sur la vraie production
Essais navigateur Chromium (sans écran) sur `https://dig.lodylands.com`, en invité :
- **Téléphone :** 390×844, densité 3.
- **Ordinateur :** 1280×900.

| Adresse | Bloc « Pierre » obtenu en minant | Rendu |
|---|---|---|
| `/?icons=v1` | oui (téléphone : 63 coups ; ordinateur : 31 coups) | image v1 : `pierre-256.webp` sur téléphone, `pierre-128.webp` sur ordinateur, chargée |
| `/?icons=default` | oui | emoji 🪨 (legacy) |
| `/` (adresse normale) | oui | emoji 🪨 (legacy) |

Autres contrôles :
- **Aucune erreur JavaScript.**
- **Aucune requête d'écriture** vers le serveur pendant l'essai : l'invité ne sauvegarde rien, donc aucune donnée joueur n'a été touchée.
- Les fichiers servis sur les deux domaines (`library.json`, `pierre-128.webp`, `pierre-256.webp`) ont des empreintes identiques à ceux du dépôt.
- `defaultLibrary` vaut `legacy`, et seule l'entrée `pierre` existe dans `v1`. Les 13 autres matériaux restent donc en emoji, même avec `?icons=v1`.

### Rollback
Trois retours possibles, tous immédiats, sans redémarrage ni migration, et sans aucun effet sur la base :
- **Global :** `defaultLibrary` est déjà `legacy`, donc rien n'est à faire pour les joueurs ordinaires.
- **Retirer la pierre C même en aperçu :** supprimer l'entrée `pierre` de `public/assets/icons/library.json`, ou supprimer `pierre-*.webp`. Dans le second cas, le repli automatique remet l'emoji.
- **Pour ton navigateur :** `?icons=v1` est mémorisé dans le navigateur. Ouvre `/?icons=default` pour revenir au rendu normal.

### Test à faire sur ton téléphone
1. Ouvre **https://dig.lodylands.com/?icons=v1**, choisis la langue, puis joue en invité ou connecté.
2. Mine jusqu'à **5 m de profondeur** : la pierre n'apparaît qu'à partir de 5 m. Avant, ce sont la terre meuble et l'argile, toujours en emoji.
3. **Résultat attendu :**
   - un bloc « Pierre » montre la pierre C dessinée à la place de l'emoji 🪨 ;
   - grès, granite, charbon et les autres matériaux restent en emoji.
4. Ouvre ensuite **https://dig.lodylands.com/?icons=default** : la pierre redevient 🪨.

### Classement
**Après lancement**, car cosmétique : ce ticket ne bloque pas le MVP public.

### Décisions demandées
1. **La pierre C te convient-elle en jeu sur téléphone ?**
   - Si oui, je recommande de lancer ensuite le pilote charbon, fer et diamant : au plus 3 propositions par matériau, budget autour de 0,65 USD.
   - Si non, dis-moi ce qu'il faut ajuster : taille, contraste ou style.
2. **Activer `v1` par défaut pour tous ?** Je recommande d'attendre plusieurs matériaux : un seul matériau dessiné parmi 14 emoji donne un rendu hétérogène.

### Reste à faire
- Ton retour visuel.
- Les autres matériaux, seulement sur ta demande : aucune image générée dans cette session.
- La bascule par défaut.
- Le nettoyage de `art/icons/v1/candidates/`, non committé.
