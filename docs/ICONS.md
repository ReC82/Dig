# Icônes des matériaux — bibliothèques `legacy` et `v1`

## Principe

| Bibliothèque | Rendu | Statut |
|---|---|---|
| `legacy` | emoji d'origine (`Blocks.TYPES[].icon`) sur le fond CSS du bloc — **inchangé** | **par défaut** |
| `v1` | images générées (`public/assets/icons/v1/<matériau>-128.webp` / `-256.webp`), matériau par matériau. Contenu actuel : **les 14 blocs du jeu** — pierre (validée le 29/10/2026), charbon et minerai de fer (validés le 30/10/2026), les 11 autres en statut « pilote » à valider | disponible, **non activée par défaut** |

- **Choix de la bibliothèque :** `public/js/iconLibrary.js`.
- **Configuration :** `public/assets/icons/library.json`, lue sans cache par le navigateur. Une modification s'applique au prochain chargement de page, sans redémarrage ni migration.
- **Repli sur `legacy`** dans trois cas :
  - un matériau absent du manifeste v1 ;
  - une image v1 manquante ou en erreur de chargement ;
  - une configuration illisible.

## Tester `v1` sans rien changer pour les joueurs

- `https://…/?icons=v1` : active `v1` pour **ce navigateur seulement** (choix mémorisé).
- `?icons=legacy` : force `legacy` pour ce navigateur.
- `?icons=default` : revient à la configuration du serveur.

## Activer `v1` pour tous (après validation visuelle)

Dans `public/assets/icons/library.json` : `"defaultLibrary": "v1"`.

## Rollback immédiat

1. **Global :** remettre `"defaultLibrary": "legacy"` dans `public/assets/icons/library.json`. Aucun redémarrage, aucune donnée touchée ; les joueurs retrouvent les emoji au prochain chargement.
2. **Un seul matériau :** retirer son entrée de `libraries.v1.materials`. Ce matériau repasse en `legacy`, les autres restent en `v1`.
3. **Complet :** `git revert` des commits du ticket #22, puis déploiement. Aucune migration : rien n'est stocké côté joueur, hormis le choix `?icons=` mémorisé dans le navigateur, sans effet si `v1` disparaît.

Les icônes `legacy` ne sont jamais supprimées ni modifiées : elles restent la valeur `icon` de chaque type de bloc.

## Générer un matériau (hors ligne, sur le serveur)

```bash
node tools/icons/generate.js pierre --count 3 --dry-run   # requête et budget, sans appel
node tools/icons/generate.js pierre --count 3             # 1 à 3 propositions
```

- **Prompt maître versionné :** `tools/icons/prompt-master.md`. Fiches des matériaux : `tools/icons/materials.json`.
- **Configuration OpenAI propre à Dig :** `~/.config/dig/openai.env` (mode 600). La clé est lue sur place depuis le fichier indiqué, jamais copiée ni affichée. Le budget est plafonné localement.
- **Journal des coûts :** `~/.local/state/dig-icons/ledger.jsonl`.
- **Sorties :** `art/icons/v1/candidates/<id>/`. On y trouve :
  - l'image brute ;
  - le PNG normalisé 1024 RGBA, avec une marge de 12 % ;
  - les WebP 256 et 128 ;
  - un aperçu sur fond sombre ;
  - `generation.json`, qui donne le modèle, les paramètres, le prompt, l'usage, le coût et les empreintes.
- **`input_fidelity` :** envoyé seulement si `DIG_IMAGE_INPUT_FIDELITY` est défini dans la configuration. Le modèle d'édition actuel le refuse (HTTP 400). Après une erreur 4xx, les propositions suivantes de la commande sont annulées, ce qui évite de répéter l'appel.
- **Référence officielle :** une fois validée, elle est placée dans `art/icons/v1/reference/` et envoyée **systématiquement** à l'endpoint d'édition pour chaque nouveau matériau.

## Contrôles

- `npm test` (`test/icons.test.js`) :
  - `legacy` identique pour les 14 matériaux ;
  - `v1` limité aux matériaux du manifeste ;
  - repli si l'image échoue ;
  - vrai canal alpha, marges, exports ;
  - garde-fous de la clé et du budget.
- `node tools/icons/compare.js --before <url> --after <url> --out <dossier>` : captures du vrai composant `#block` pour les 14 matériaux. Le script vérifie que `legacy` est identique au pixel près et que `v1` ne change que les matériaux du manifeste.

## Référence officielle

- `art/icons/v1/reference/pierre.png` : PNG maître 1024 RGBA de la pierre, **proposition C validée par le propriétaire le 29/10/2026**.
- `art/icons/v1/reference/pierre.json` : provenance (modèle, paramètres, prompt, coût) et empreintes du PNG maître et des exports WebP. `npm test` vérifie que les exports du jeu correspondent à cette référence.
- `generate.js` joint cette image **automatiquement** à chaque génération d'un nouveau matériau, pour garder le même style.
- **Ne pas remplacer ce fichier** sans nouvelle validation : il définit le style de toute la bibliothèque v1.

## Matériaux pilotes (non validés)

- Un matériau en aperçu, mais pas encore validé par le propriétaire, figure dans le manifeste v1 avec `"status": "pilote"`.
- Sa provenance est dans `art/icons/v1/pilot/<matériau>.json` : proposition retenue, alternatives, modèle, prompt, coût et empreintes des exports. `npm test` vérifie que les exports correspondent à cette provenance.
- Pour **changer de proposition**, copier `<id>/<matériau>-{128,256}.webp` depuis `art/icons/v1/candidates/` vers `public/assets/icons/v1/`, puis mettre à jour `candidate` et `exports` dans le fichier de provenance.
- Pour **retirer un pilote**, supprimer son entrée du manifeste : le matériau repasse en emoji, même avec `?icons=v1`.
- Après validation, l'entrée reçoit `"validated": "<date>"` et `status` disparaît. `defaultLibrary` ne bascule qu'une fois **tout le lot** validé.

## Lot complet (30/10/2026)

- Consigne du propriétaire (#22, 30/10) : **une seule génération par bloc**, sans variantes préventives ; correction ciblée sur demande.
- `node tools/icons/promote.js <id-proposition> …` : intègre une proposition contrôlée en statut « pilote » (exports WebP vers `public/assets/icons/v1/`, maître 1024 en WebP sans perte et provenance dans `art/icons/v1/pilot/`, entrée du manifeste). Refuse de remplacer un matériau validé ; ne modifie jamais `defaultLibrary`.
- `node tools/icons/board.js --out <png> [--webp <webp>]` : **planche exhaustive** des 14 blocs (ordre du jeu, fond réel du bloc, nom, rareté, profondeur, statut, emoji remplacé). Planche livrée : `art/icons/v1/planche-v1.png` et, en ligne, `https://dig.lodylands.com/assets/icons/planche-v1.webp` (image statique, aucune page ni route ajoutée).

## Atelier d'icônes du panel (#40, 30/10/2026)

Onglet **🎨 Icônes** du panel admin : toutes les icônes du jeu au même endroit.

- **Cibles** : blocs du catalogue (minerais, pierres, coffres, gemmes — brouillon s'il existe, sinon version en vigueur), objets de collection et reliques (#39), pictogrammes d'interface (profil 👤, paramètres ⚙, améliorations ⚙, navigation). Les badges (#38) s'ajouteront quand ils existeront.
- **Style commun** : le gabarit des blocs reste le prompt maître v1.0 ci-dessus (inchangé) ; objets/reliques et pictogrammes utilisent les gabarits **v1.1** (`PROMPT_OBJECT`, `PROMPT_UI`, `REFERENCE_OBJECT` dans `tools/icons/prompt-master.md`) : même lumière, angle, finition et marges. La référence validée `pierre.png` est jointe à chaque génération. Les icônes validées (pierre, charbon, minerai de fer) sont affichées à côté de chaque proposition comme étalon.
- **Brief** par icône (sujet, détails, palette), proposé par défaut (fiche `materials.json`, nom anglais, histoire de l'objet) et modifiable.
- **Génération** : 1 à 3 variantes, pour une icône ou un **lot** (≤ 20 icônes), en arrière-plan, une génération à la fois. Coût estimé affiché et vérifié **avant** le lot ; budget revérifié avant chaque image.
- **Téléversement manuel** : PNG ou WebP **avec fond transparent** (≤ 4 Mo, 128 à 4096 px) ; JPEG refusé.
- **Contrôles** (identiques à l'outil hors ligne `process.js`) : vrai canal alpha, coins transparents, contour anti-crénelé, recadrage sur l'objet, marge 12 %, lisibilité sur fond sombre. Une image refusée n'est pas stockée.
- **Aperçu** : maquette smartphone 390 px (bloc en jeu, case de collection + fiche, barre de navigation) et tailles 24/36/64/128 px.
- **Statuts** : proposition, ★ retenue, rejetée, 🔒 **validée**. Une icône validée (dans la bibliothèque v1 ou dans l'atelier) n'est remplacée qu'avec un accord explicite (confirmation + `override`), tracé dans l'historique.
- **Appliquer au brouillon** : l'image est placée dans le **brouillon** du catalogue de blocs ou de collections. **Rien ne change pour les joueurs avant la publication** dans l'onglet 🧱 Blocs ou 📿 Collections. Les pictogrammes d'interface sont stockés mais leur application en jeu relève de #41.
- **Retour arrière** : « Revenir à l'emoji d'origine », « Revenir à l'icône d'avant » (historique), ou « Revenir à vN » dans le catalogue.
- **Stockage et provenance** : tables en **ajout seul** `icon_studio_assets` (WebP 256 + prompt, version de gabarit, modèle, référence, contrôles, coût, empreinte du maître 1024), `icon_studio_events` (historique), `icon_studio_calls` (journal des appels). Tables modifiables : `icon_studio_briefs`, `icon_studio_settings` (plafond). Images servies sous `/media/icons/<sha>.webp` (immuables), sauvegardées avec la base.
- **Budget** : plafond **global** de `~/.config/dig/openai.env` (journal partagé `ledger.jsonl`, source `admin-icons`) **et** plafond propre à l'atelier, réglable dans le panel (vide = global seul). Quota : 40 images / 24 h. Limitation de débit des actions : 60 / 15 min par IP (`RATE_ICONS_MAX`).
- **Sécurité** : routes `/api/admin/icons…` protégées par la clé admin ; clé OpenAI lue côté serveur seulement, jamais renvoyée ; erreurs masquées ; le corps de 4 Mo du téléversement n'est lu qu'après vérification de la clé admin (512 Ko ailleurs).
- **Test sans dépense** : `DIG_AI_FAKE=1` (hors production) remplace l'API par une image factice ; le traitement reste réel.
