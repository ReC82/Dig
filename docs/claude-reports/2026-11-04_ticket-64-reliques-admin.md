# Ticket #64 — Admin : catalogue et gestion complète des reliques (effets, coûts, images IA)

Lien : https://github.com/ReC82/Dig/issues/64

## Session du 04/11/2026 (soir)

### 1. État réel

**Intégré dans `develop` (`6916fd0`), non déployé.** Le passage complet des tests de la release a échoué sur un test sans lien avec #64, que je pense instable : `gem-ledger` « achats simultanés depuis 4 processus » (détails au § 6). Les règles de déploiement n'admettent une relance que pour `rate-limit`, donc je n'ai pas déployé. Sur le même SHA, la suite complète a réussi dans le worktree d'intégration (652/652). Ce test isolé passe aussi 3 fois sur 3. La migration a été testée sur une copie de la base de production, sans perte.

Classement : **Après lancement** (outil d'administration). Il ne bloque pas le MVP public : le jeu reste identique tant que rien n'est publié.

### 2. Audit préalable : formules du moteur

- Avant ce ticket, le catalogue n'existait que dans le client (`public/js/relics.js`, `DEFS`). Le serveur n'en connaissait qu'une copie partielle : le bonus de l'Aimant à éclats dans `server/economy.js`, pour la boutique de coffres. L'anti-bot (#25) suppose au maximum +10 dégâts/clic (Œil), +14 dégâts auto/s (Moteur) et 50 % de réduction de PV (Griffe).
- Les six effets sont réellement calculés par `Relics.applyBonuses()` :

| Effet | Calcul dans le jeu |
|---|---|
| Dégâts par clic (`damage_flat`) | clic = niveau de pioche + bonus |
| Pièces (`coins_pct`) | pièces × (1 + 0,3 × Sac) × (1 + bonus) |
| Fragments des coffres (`relic_fragment_bonus`) | fragments du coffre + bonus (calcul serveur pour la boutique) |
| Chance / blocs rares (`luck_pct`) | poids rare/épique/légendaire × (1 + 0,10 × Chance + bonus) |
| PV des blocs (`hp_reduction`) | PV × (1 − réduction), réduction totale plafonnée à 90 % |
| Auto-dig (`autodig_bonus`) | dégâts auto/s = niveau d'Auto-Dig + bonus |

- **Écart constaté, non corrigé (hors périmètre)** : les textes `relic.<id>.bonus` de `i18n.js` (« +25% pièces », « +3 dégâts auto/sec »…) ne correspondent pas aux valeurs réelles (Cœur d'or niveau 1 = +15 %). Ces textes ne sont **affichés nulle part** : le jeu calcule le bonus avec `relic.bonus_types.*`. Rien de visible pour les joueurs ; à nettoyer avec #24.
- Les « règles d'obtention » sont documentées dans la fiche (déblocage puis amélioration contre des fragments, issus des coffres minés et de la boutique de coffres ; les reliques sont permanentes). Elles ne sont **pas paramétrables** : un tel champ n'aurait aucun effet réel dans le moteur (exigence du ticket).

### 3. Changements réalisés

- **`server/relicCatalog.js`** (nouveau), sur le modèle du catalogue de blocs #37 :
  - tables ajoutées uniquement : `relic_catalog_versions` et `relic_catalog_audit` (en ajout seul, protégées par des triggers), `relic_catalog_draft` ;
  - **version 1 = les six reliques à l'identique**, relues dans `relics.js` (coûts, niveaux, effets, icônes) et `i18n.js` (noms et descriptions FR/EN/NL/ES) ;
  - validation côté serveur :
    - seuls les 6 effets réels sont acceptés, avec des bornes par niveau ;
    - les bonus ne peuvent pas baisser d'un niveau au suivant ;
    - plafonds anti-bot sur la somme des reliques d'un même effet (dégâts/clic ≤ 10, auto ≤ 14, PV ≤ 50 %) ;
    - le bonus de fragments est réservé à l'Aimant à éclats (le serveur le calcule par son niveau) ;
    - de 1 à 10 niveaux, et le nombre de niveaux ne peut jamais baisser (niveaux possédés) ;
    - une relique publiée ne peut pas être supprimée, seulement archivée ;
    - une image ne peut venir que de l'atelier (`/media/icons/…`) ;
  - cycle complet : brouillon, écarts champ par champ, **publication explicite** (note, contrôle de version périmée), abandon, annulation par relique, **retour arrière** (republie une version antérieure : les reliques ajoutées depuis sont archivées, le nombre de niveaux ne baisse jamais), journal ;
  - détenteurs par relique et par niveau, lus dans les sauvegardes cloud (lecture seule).
- **Routes** :
  - `GET /api/relics/catalog` (public) ;
  - `GET /api/admin/relics`, `PUT|DELETE /api/admin/relics/draft/relics/:id`, `POST …/:id/revert`, `DELETE /api/admin/relics/draft`, `POST /api/admin/relics/publish`, `POST /api/admin/relics/rollback`, `GET /api/admin/relics/audit` (admin).
- **Jeu** (`public/js/relics.js`, `main.js`) : le jeu lit le catalogue publié et le garde en cache, comme le catalogue de blocs. Nom et description viennent du catalogue, avec repli sur les traductions intégrées ; l'image s'affiche si elle existe. Une relique archivée reste visible pour ses détenteurs, garde son bonus, mais ne se débloque ni ne s'améliore plus. Elle est masquée pour les autres joueurs. Le bonus d'un niveau au-delà du maximum est borné (aucun bonus perdu).
- **Serveur** (`economy.js`, `chestShop.js`) : le bonus de l'Aimant à éclats (fragments des coffres achetés) suit le catalogue publié. Le serveur repasse sur les valeurs d'origine si le catalogue n'est pas initialisé.
- **Atelier d'icônes (#40)**, étendu sans être recréé : nouvelle famille « Reliques » (`relic:<id>`), consigne par défaut tirée du nom et de la description EN. « Conserver » écrit l'image dans le **brouillon** des reliques (jamais publiée directement). Bouton « ← Retour à la fiche de la relique ».
- **Admin → 🔮 Reliques** (`index.html`, `admin.js`, `admin.css`) :
  - liste compacte (visuel, nom et identifiant, effet, niveaux, coûts, bonus niveau 1 → max, détenteurs, état), recherche et filtre par état ;
  - bouton « ＋ Ajouter une relique » ;
  - carte « Brouillon non publié » (tableau avant/après, erreurs, avertissements, « Publier… », « Abandonner le brouillon ») ;
  - versions publiées avec « Revenir à cette version… » ; journal ;
  - **fiche**, avec une langue à la fois (FR/EN/NL/ES, pastilles ●/◐/○) :
    - identifiant stable (non modifiable après création), case active/archivée ;
    - emoji, image, « 🎨 Générer / Refaire dans Icônes », « Revenir à l'emoji » ;
    - effet documenté (calcul, bornes, plafond anti-bot) ; tableau des niveaux : coût, bonus total, fragments cumulés, détenteurs ;
    - **aperçu réel « niveau actuel → suivant »**, calculé avec les formules du moteur et une valeur de référence modifiable (ex. Cœur d'or niveau 0 → 1 : 100 → 115 pièces, déblocage pour 8 fragments) ;
    - comparaison avec la version en vigueur ;
    - section repliée « Règles d'obtention et calcul ».
  - Fiche protégée contre la perte de saisies (#61). Responsive PC et 390 px.

Fichiers : `server/relicCatalog.js` (nouveau), `server/index.js`, `server/economy.js`, `server/chestShop.js`, `server/iconStudio.js`, `public/js/relics.js`, `public/js/main.js`, `public/admin/{index.html,admin.js,admin.css}`, `test/relic-catalog.test.js` (nouveau), `test/i18n-languages.test.js` (le module `relicCatalog` est ajouté au contrôle du registre de langues).

### 4. SHA, branche et procédure de test

- Branche `feature/64-reliques-admin` (`b18f899`), intégrée dans **`develop` `6916fd0`**.
- Tests automatisés : `npm test` puis `node --test test/relic-catalog.test.js` (6 tests). Ils couvrent :
  - la version 1 identique au client ;
  - la validation (bornes, plafonds anti-bot, suppression et baisse de niveaux refusées) ;
  - **le scénario de recette** (modifier Cœur d'or dans un brouillon puis l'abandonner : catalogue public inchangé) ;
  - la publication, le refus d'une version périmée, le retour arrière et le journal en ajout seul ;
  - le bonus serveur de l'Aimant qui suit la publication ;
  - côté client : catalogue appliqué, relique archivée sans perte, catalogue invalide refusé ;
  - les routes HTTP (401 sans session admin, cible `relic:` de l'atelier sans aucune génération).

### 5. Vérifications effectuées

- `npm test` sur la branche : 651/652. Le seul échec venait de `i18n-languages` (liste de langues codée en dur) ; c'est corrigé, et ce test passe ensuite avec `relic-catalog`.
- `npm test` sur `develop` `6916fd0` (worktree d'intégration) : **652/652**.
- Release `6916fd0` : 651/652 (`gem-ledger`, voir § 6).
- Chromium headless, PC 1280×900 et smartphone 390×844, serveur de test (port 3101, base de test) :
  - 6 reliques listées ;
  - fiche Cœur d'or : aperçu « 100 → 115 pièces, déblocage pour 8 fragments » ;
  - bonus du niveau 1 passé de 15 à 20 → la comparaison s'affiche, et Échap demande confirmation ;
  - enregistrement dans le brouillon, puis tableau avant/après ;
  - abandon du brouillon : catalogue public toujours en version 1, valeurs [0,15…1] ;
  - « Générer / Refaire dans Icônes » ouvre l'atelier sur « Aimant à éclats », avec le bouton de retour ;
  - jeu : catalogue chargé en version 1, 6 reliques, affichage identique.
  - Aucune erreur JavaScript ; seuls des 401/404 attendus, avant la connexion admin.
- **Copie de la base de production** (release `6916fd0`, `NODE_ENV=production`, port 3122) :
  - `/health` ok, `/api/version` = `1.0.0+6916fd0`, catalogue en version 1 identique ;
  - empreintes (nombre de lignes et hachage) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** avant et après le démarrage ;
  - 3 tables `relic_catalog_*` ajoutées ; copie supprimée ensuite.
- **Impact sur les données des joueurs : aucun.** Les niveaux de reliques, les fragments et les sauvegardes ne sont ni lus en écriture ni modifiés. La version 1 reproduit exactement les valeurs actuelles.
- Non fait : aucune génération d'image (aucune dépense) ; rien n'a été publié.

### 6. Déploiement

**Non déployé.** Lors du passage complet des tests de la release `6916fd0`, un seul échec : `test/gem-ledger.test.js` « achats simultanés depuis 4 processus : jamais plus que le solde ». Les 6 achats attendus ont réussi, mais au moins un refus n'était pas « insufficient ». C'est très probablement un verrou SQLite entre les 4 processus, sur une machine chargée par l'installation et les tests. Ce test ne touche ni les reliques ni le code modifié ; il a réussi 3 fois sur 3 en relance isolée et dans le passage complet de `develop` au même SHA. La règle « tout autre échec que `rate-limit` bloque le déploiement » s'applique, comme pour #37 le 02/11. Production inchangée : `5a32746`.

Ce qui est prêt pour le prochain déploiement : migration testée sur une copie de production (empreintes identiques), retour arrière immédiat possible (code seul ; les 3 tables ajoutées sont ignorées par l'ancien code).

**Test fonctionnel à faire par le propriétaire, après déploiement** (5 min, ne rien publier) :
1. /admin/ (Ctrl+F5) → onglet **🔮 Reliques** : 6 reliques. Cœur d'or : coûts `8 / 18 / 35 / 55 / 80`, bonus `+15 % → +100 %`, colonne « Détenteurs ».
2. Cliquer **Cœur d'or** : les valeurs correspondent au jeu (Collection → Reliques). Aperçu « Niveau actuel » → choisir votre niveau : bonus actuel → suivant et coût.
3. Remplacer le bonus du niveau 1 par `20`, puis « Enregistrer dans le brouillon » : la carte « 📝 Brouillon non publié » montre `+15 % … → +20 % …`. Dans le jeu (recharger) : **rien n'a changé**.
4. « Abandonner le brouillon » → confirmer : la carte disparaît, la version 1 reste en vigueur, journal « brouillon abandonné ».
5. Facultatif : fiche → « 🎨 Générer / Refaire dans Icônes » ouvre l'atelier sur la relique (aucune génération sans clic sur Générer), avec « ← Retour à la fiche de la relique ».

### 7. Choix techniques faits seul

- Même architecture que les blocs (#37) : versions en ajout seul, brouillon unique, publication et retour arrière. C'est le modèle déjà validé dans le panel, et il garantit l'audit.
- Les reliques publiées sont **archivées, jamais supprimées**, et le nombre de niveaux ne baisse jamais : aucun niveau possédé ne devient invalide.
- Une relique archivée garde son bonus pour ses détenteurs (aucune perte de progression) mais ne se débloque ni ne s'améliore plus.
- Les plafonds anti-bot sont imposés par la validation, au lieu de faire évoluer l'anti-bot (#25) : un bonus plus fort serait une décision économique et de sécurité à part.
- Le bonus de fragments est réservé à l'Aimant à éclats : le serveur, la fenêtre des chances et le calcul des coffres raisonnent sur ce seul niveau.
- Les règles d'obtention ne sont pas paramétrables (documentées seulement) : un champ sans effet réel est exclu par le ticket.
- Aucun appel IA depuis l'onglet Reliques : l'image passe par l'atelier existant (une image par clic, budget de ⚙ Config).

### 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire pour cette étape. Rien n'est publié : toute modification de coût, de bonus ou d'image reste dans un brouillon jusqu'à votre « Publier… ».

### 9. Reste à réaliser

- **Déploiement de `6916fd0`** (ou du SHA `develop` suivant) dès qu'un passage complet des tests de la release réussit.
- Fiabiliser `test/gem-ledger.test.js` (attente du verrou SQLite, ou motif d'erreur affiché dans l'assertion). Le corriger relève de #49 / #17, pas de ce ticket.
- Plus tard, si souhaité : des bonus au-delà des plafonds anti-bot exigeraient de faire évoluer l'anti-bot (#25) avec le catalogue ; de nouveaux types d'effet exigeraient du code moteur.
- Nettoyer les textes `relic.<id>.bonus` inutilisés et faux dans `i18n.js` (#24).
