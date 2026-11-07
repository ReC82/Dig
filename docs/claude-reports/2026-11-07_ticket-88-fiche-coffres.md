# Ticket #88 — [P0][UX] Coffres — prix, chances et récompenses dans une seule fiche claire ; corriger simulation et brouillon

Lien : https://github.com/ReC82/Dig/issues/88

## Session du 07/11/2026 soir (DIGORCH) — fiche unique des coffres, prix dans le brouillon, cause du « 863 / 800 »

### 1. État réel

**Déployé en production (SHA `444ee81`) — en attente de recette.** Partie UI et sécurité : livrée. **Rien n'a été publié** : votre brouillon
des six coffres est conservé tel quel, aucun prix, taux, limite ni récompense en jeu n'a changé.
Classement : **Bloquant MVP public** pour la lisibilité et la sécurité des prix (bêta du 09/11) ;
le choix du barème reste votre décision (§ 8).

### 2. Pourquoi « 863 pièces pour un prix de 800 » (point 8 du ticket)

Reproduit sur une copie de la base de production (lecture seule, supprimée ensuite) :

- **Ce n'est pas le préréglage P.** Le journal ne contient aucun « préréglage chargé » : le brouillon
  vient de **8 enregistrements manuels le 07/11 entre 15:51 et 15:53 UTC** qui baissent les poids
  des fragments (coffre simple : 30 → 1 ; rare : 30 + 12 → 10 ; etc.).
- Le moteur tire **au poids** : en passant le poids des fragments de 30 à 1, le total passe de 100 à 71
  et la part des lignes de pièces monte de **55 % à 77,5 %**. Espérance : (45 × 750 + 10 × 2 750) / 71
  = **863 pièces** pour un prix réel de **800** → boucle de profit, refus correct.
- Le contrôle utilisait déjà le **vrai prix** (override 800) et non le défaut du code (2 000) : avec
  2 000, la même table serait acceptée. Le préréglage P, lui, rend 613 pièces (77 % de 800).
- **Ce qui était faux, c'est l'affichage** : des « poids » sans total, un écart brut « ligne 2 → ligne 3 »,
  aucun moyen de comprendre l'effet. C'est ce qui a été refait (§ 3). Tests de non-régression :
  `test/chest-sheet.test.js` (reproduction exacte, conseils chiffrés, contrôle au prix réel).

### 3. Changements réalisés

**Admin → 🎲 Coffres & drops** (le seul endroit pour les coffres) :

- **Bandeau d'état** : « En jeu : version v1 » / « Brouillon : N coffres modifiés, pas encore visible en jeu ».
  Puis **« ⛔ Publication impossible : 1 problème à corriger »** avec le coffre en lien, et une ligne
  regroupée pour la conformité #49 (non bloquante).
- **Une seule zone d'actions** : 🎲 Tester (simuler) · Publier le brouillon… · Abandonner le brouillon… ·
  Restaurer la version précédente…
- **Six cartes** : image, nom, type (🛍 Boutique / ⛏ Trouvé en minant), statut (● En jeu / ✎ Brouillon),
  prix et limite (boutique), chance de fragments et moyenne, pièces moyennes, équilibre (✓ / ⚠ / ⛔),
  valeur « en jeu » entre parenthèses quand elle change, avertissement #49. Un bouton « Modifier ce coffre ».
- **Fiche d'un coffre** :
  - boutique : **Prix (pièces)** et **Limite par saison**, avec « ⓘ Quand le prix change-t-il ? » ;
  - une ligne par récompense : type, quantité (de/à, quantité, ×/minutes, gros lot), **Chance en %**,
    ✕ ; « ＋ Ajouter une récompense » ; **total des chances affiché, 100 % exigé**,
    bouton « Ramener le total à 100 % » (mêmes proportions). Un brouillon ancien en poids quelconques
    s'affiche converti en % et reste identique s'il est enregistré sans changement ;
  - **équilibre en direct** : « Ce coffre coûte 800 pièces mais rend en moyenne 863 pièces — on pourrait
    gagner des pièces en l'achetant en boucle », la cause (22,5 % de tirages sans pièces contre 45 % en jeu)
    et **deux corrections chiffrées, rien n'est appliqué tout seul** : porter les tirages sans pièces à
    au moins 28,3 % (42,6 % pour rester sous 80 %) ou un prix d'au moins 864 (1 100 sous 80 %) ;
  - remarque #49 si un coffre acheté avec des pièces donne des fragments ;
  - **« Aujourd'hui en jeu / Mon brouillon »** : seules les lignes qui changent, avant → après en %,
    plus prix, limite, pièces moyennes, fragments ;
  - protection contre les modifications non enregistrées (#61) inchangée (vérifiée : Annuler → « Modifications non enregistrées »).
- Coffres minés : la fiche rappelle que la **chance de trouver** le coffre se règle dans 🧱 Blocs ;
  la légende explique Aimant (🏺 Reliques) et multiplicateur (⚙ Config) sans les mélanger aux calculs.
- **Repliés** : « 🖼 Images des coffres » (atelier #66 inchangé) et « ⚙ Détails avancés »
  (préréglages, simulation détaillée 10k/100k, écarts techniques en poids, versions, journal).

**Prix : une seule source, publiée avec les récompenses (point 5)**

- La valeur appliquée en jeu reste `admin_config.chest_cost_*` (overrides actuels conservés : 800 / 15 000 / 80 000, aucune migration).
- Un prix saisi dans la fiche va **dans le brouillon** (`shop[id].cost`) : aucun effet en jeu.
- **Publier** écrit, dans **une seule transaction SQLite**, la nouvelle version (avec les prix effectifs),
  les prix dans `admin_config`, la suppression du brouillon et le journal ; le changement de prix est
  aussi consigné au journal de sécurité. Publication des **six coffres ensemble** (atomique).
- **Retour arrière** : une version publiée depuis #88 restaure aussi ses prix ; la v1 n'en mémorisait
  pas, les prix actuels sont alors gardés (dit dans la confirmation).
- **Économie → Gains** : prix en lecture seule + bouton « 🎲 Modifier dans Coffres & drops » ;
  **⚙ Config** : champs de prix en lecture seule ; l'API `PUT /api/admin/config` refuse `chest_cost_*` (409).
  Raccourci « Changer le prix des coffres » → Coffres & drops.

**Préréglages (point 7)** — Détails avancés :

- P et R affichés « ⚠ non conforme » (fragments dans des coffres achetés avec des pièces).
- **Nouveau S — « Boutique sans fragments (conforme) »** : simple 45 % pièces / 45 % boost / 10 % gros lot ;
  rare : pièces, boost, 18 % objet de collection, gros lot ; antique : pièces, boost, 20 % objet de collection ;
  limites 20 / 10 / 5 ; coffres minés = P. Pièces rendues 613 / 3 550 / 19 975 (77 %, 24 %, 25 % du prix).
- Charger un préréglage ou abandonner le brouillon **garde une copie du brouillon remplacé dans le journal**.

Fichiers : `server/rewardTables.js`, `server/index.js`, `public/admin/{index.html,admin.js,admin.css}`,
`tools/balance/fragment-rarity-sim.js` (variante S), `docs/admin-navigation.md`, tests
`test/chest-sheet.test.js` (nouveau, 6 tests), `test/economy.test.js`, `test/reward-tables.test.js`,
`test/fragment-presets.test.js`.

Captures (serveur de test, copie de la base) :
`docs/claude-reports/img/2026-11-07_ticket-88-desktop-page.png`, `…-desktop-sheet.png`,
`…-m390-sheet.png`, `…-m320-page.png`, `…-m320-compare.png`.

### 4. Simulation comparée de S (`node tools/balance/fragment-rarity-sim.js --runs 1000 --hour-runs 2000 --pack-runs 300`)

Sans achat de coffres de la boutique, **S = P** (mêmes coffres minés : fragments ÷ 2 environ par rapport à aujourd'hui).
Avec achats (hypothèses du 04/11), médianes, niveaux de reliques cumulés /30 en S1 → S4 et profondeur S4 :

| Profil | Actuel | P | R | **S** |
|---|---|---|---|---|
| Débutant | 4 → 23 · 520 m | 2 → 11 · 416 m | 1 → 5 · 365 m | **1 → 5 · 366 m** (semaine sans relique : 11 % en S1) |
| Régulier | 26 → 30 · 1 779 m | 7 → 20 · 1 327 m | 3 → 12 · 1 166 m | **4 → 13 · 1 182 m** |
| Assidu | 30 → 30 · 3 387 m | 8 → 26 · 2 809 m | 5 → 17 · 2 425 m | **6 → 21 · 2 544 m** |
| Automatique | 27 → 30 · 1 633 m | 6 → 18 · 1 023 m | 3 → 10 · 865 m | **3 → 10 · 867 m** |

Conversion pièces → fragments par saison : actuel illimitée ; P ≈ 52 🔮 ; R ≈ 19 ; **S ≈ 14 🔮 (0,9 % des
reliques), uniquement par la consolation « collection complète = 5 fragments » (codée)**. Les écarts de
profondeur viennent surtout de la fin de la conversion illimitée (l'actuel est gonflé par elle).

### 5. SHA, branche, procédure de test

Branche `feature/88-fiche-coffres` (`acd301f`) ; **`develop` = `444ee81`**.

- `npm test` : **916/916** sur la branche et sur la release `444ee81`.
- `node --test test/chest-sheet.test.js`.
- Navigateur (Chromium headless, serveur de test port 3188, copie de la base, supprimée) : 1280×900,
  390×844 et **320×640** ; aucun débordement horizontal (page, fiche, simulation), aucune erreur JS
  (seuls le 401 attendu avant connexion et le favicon) ; brouillon réel affiché avec l'erreur 863/800 et ses corrections ;
  fiche modifiée puis Annuler → confirmation ; Économie et Config en lecture seule.

### 6. Déploiement

**Déployé en production (SHA `444ee81`) — en attente de recette.**

- Release `444ee81` : `npm test` **916/916** sur l'arbre exact.
- Copie de la base de production démarrée (port 3122) : santé et `1.0.0+444ee81` OK ; empreintes de `users`,
  `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** avant/après ;
  **brouillon des coffres identique** (même empreinte), prix 800 / 15 000 / 80 000 et version v1 inchangés ; copie supprimée.
- `main` avancé en avance rapide `5206c69` → `444ee81` ; `deploy.sh` : sauvegarde vérifiée
  `~/backups/dig/dig-20261107-185529-pre-deploy-444ee81.sqlite`, santé et version vérifiées.
- Après déploiement : deux domaines 200 et `1.0.0+444ee81` ; journal sans erreur ; `quick_check` ok ;
  empreintes des six tables (et du brouillon) identiques à la sauvegarde ; `/api/admin/rewards` sans clé = 401 ;
  `/api/shop/chests` inchangé (simple 800 illimité, rare 15 000 illimité, antique 80 000 / 5).
- Non vérifié : l'admin de production dans un navigateur (pas de clé admin côté Claude) — vérifié sur copie.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 5206c69` + redémarrage (aucune migration ;
  l'ancien code ignore le champ `cost` facultatif des versions).

### 7. Test fonctionnel à faire par le propriétaire (2 minutes, un seul coffre, rien n'est publié)

1. Admin → **🎲 Coffres & drops**. Attendu : « En jeu : version v1 », « Brouillon : 6 coffre(s) modifié(s) »,
   « ⛔ Publication impossible : 1 problème à corriger » et la carte **Coffre simple** encadrée en rouge.
2. Cliquer « Modifier ce coffre » sur le **Coffre simple**. Attendu : prix 800, chances 63,38 / 1,41 /
   21,13 / 14,08 % (total 100 %), le cadre rouge explique les deux corrections, et « Aujourd'hui en jeu /
   Mon brouillon » montre 45 % → 63,38 %, 30 % → 1,41 %, etc.
3. Mettre le prix à **1 100** (sans enregistrer). Attendu : le cadre passe au vert « ✓ Équilibré … ».
   Cliquer **Annuler** → « Modifications non enregistrées » → « Abandonner les modifications ».
   Rien n'est enregistré ni publié.

### 8. Choix techniques faits seul

- **Prix gardés dans `admin_config`** (lu par le jeu) plutôt que déplacés : aucune migration ni risque pour
  les overrides ; l'unicité vient de l'API (refus 409 ailleurs) et de la publication transactionnelle.
- **Chances en % avec total 100 % exigé**, enregistrées comme poids (le moteur tire au poids) : aucun
  changement côté jeu ; les anciens brouillons restent compatibles.
- **Conformité #49 non bloquante** : la v1 en jeu et P/R donnent des fragments contre des pièces ; bloquer
  la publication serait une décision économique qui vous revient. C'est signalé partout.
- Simulation d'un brouillon en boucle de profit autorisée (pour comprendre) ; publication toujours refusée.
- Coffres minés de S = ceux de P (pour ne pas cumuler deux baisses non décidées).

### 9. Décisions demandées au propriétaire

1. **Quel barème publier avant le 09/11 ?** (a) **S — boutique sans fragments** (conforme à votre décision) ;
   (b) votre brouillon actuel corrigé (prix ou boost, voir fiche) ; (c) P ou R (non conformes) ; (d) rien.
   **Recommandation : (a) S**, à charger dans Détails avancés → Préréglages, puis « Tester », puis « Publier » par vous.
   Votre brouillon actuel sera remplacé mais reste lisible dans le journal.
2. **Coffres minés avec S** : garder P (fragments ÷ 2, débutant ≈ 1 relique en S1) ou revenir aux taux
   actuels pour compenser la fin des fragments en boutique ? Recommandation : garder P pour la bêta, réévaluer avec les retours.
3. **Consolation « collection complète = 5 fragments »** dans les coffres achetés : la remplacer (par ex.
   des pièces) pour une conformité totale ? Recommandation : oui, après la bêta (≈ 14 🔮 par saison au maximum).

### 10. Reste à réaliser

- Après votre décision : publication du barème (par vous, un clic), contrôle en production.
- Après lancement : consolation de collection paramétrable (décision 3) ; tirage serveur des coffres minés (#49/#25).
