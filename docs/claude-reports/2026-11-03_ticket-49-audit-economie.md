# Ticket #49 — [P1] Audit et rééquilibrage de l'économie — gemmes, fragments, coffres et boutique

Lien : https://github.com/ReC82/Dig/issues/49

## Session du 06/11/2026 (DIGORCH) — rareté des fragments, coffres et conversion des pièces (demande du propriétaire du 06/11)

Réponse à la nouvelle priorité du propriétaire (commentaire 6690234297 : « rééquilibrer les coffres
et rendre les fragments sensiblement plus rares avant les invitations du 09/11 »). **Aucun taux,
quantité, limite, coût ni réglage économique n'a été changé en production ; rien n'est publié.**
Ce qui est livré : l'analyse sur les valeurs **réellement publiées**, deux barèmes chargeables en
un clic dans le brouillon de l'admin #37, le simulateur et les tests.

### 1. État réel

**Déployé en production (`c5ae266`) — en attente de décision du propriétaire.** Le jeu
n'a pas changé : les préréglages ne remplissent que le brouillon de 🎲 Coffres & drops. Classement :
**Bloquant MVP public** pour la décision (conversion pièces → fragments illimitée encore ouverte,
voir § 2) ; le reste (tirage serveur des coffres minés, #85) **Après lancement**.

### 2. Ce qui est réellement en production (relevé le 06/11 sur une copie en lecture seule)

| Élément | Valeur publiée | Réglable où | Remarque |
|---|---|---|---|
| Tables des 6 coffres (#37) | **v1 = tables d'origine**, aucun brouillon | 🎲 Coffres & drops | jamais republiées depuis le 04/11 |
| Vieille caisse (bloc commun) | 20 % → 1 🔮 (0,2 🔮 / coffre) | idem | + Aimant par tirage « fragments » |
| Coffre en bois (bloc rare) | 30 % → 1, 10 % → 2 (0,5 🔮) | idem | |
| Coffre en fer (bloc épique) | 25 % → 2, 20 % → 3 (1,1 🔮) | idem | |
| Coffre simple de boutique | **800 🪙, illimité**, 30 % → 1 (0,3 🔮), rend 613 🪙 en moyenne | prix : ⚙ Config ; limite : 🎲 | **conversion pièces → fragments illimitée** |
| Coffre rare de boutique | **15 000 🪙, illimité**, 30 % → 4, 12 % → 7 (2,0 🔮), 8 % objet de collection (→ 5 🔮 si collection complète) | idem | **illimité** |
| Coffre antique de boutique | 80 000 🪙, 5 / saison, 20 / 30 / 50 🔮 (12,4 🔮) | idem | |
| Boutique de fragments en pièces | **suspendue et masquée depuis le 05/11** (« Les fragments doivent être récoltables par clic et coffre uniquement ») | 🛠 Améliorations (#69) | aucune nouvelle conversion par ce chemin |
| Aimant à éclats (#64) | +1 / +2 / +3 / +4 / +5 🔮 **par tirage « fragments »** | 🏺 Reliques | s'applique aux coffres minés ET de boutique |
| `fragment_drop_multiplier` | 1 | ⚙ Config | **coffres de la boutique seulement** (les coffres minés l'ignorent) |
| Fragments de consolation (collection complète) | 5 | **codé en dur** (`server/chestShop.js`) | |
| Fréquence des blocs coffres | catalogue de blocs v3 | 🧱 Blocs | non modifiée par les barèmes (elle porte aussi les pièces) |
| Reliques | 6 × 5 niveaux = **1 617 🔮** au total | 🏺 Reliques | effets permanents |

**Conclusion : la conversion illimitée pièces → fragments interdite par la décision du 04/11 est
toujours ouverte en production par les coffres simple et rare de la boutique.** Le 05/11, seule la
boutique de fragments a été suspendue. Le journal de production le montre (agrégé, sans identité) :
**≈ 950 coffres rares ouverts les 04 et 05/11 par 1 à 2 comptes, dont 486 tirages « fragments »**
(≈ 2 400 🔮, soit plus que toutes les reliques). C'est exactement « maxer les reliques trop vite ».
Les chemins de conversion de pièces existants sont donc : coffres simple et rare (illimités),
antique (5 / saison) ; la boutique de fragments (10 / saison) est fermée ; aucune autre conversion
(les points saisonniers #33 et les gemmes ne s'échangent pas contre des fragments).

Autres points vérifiés : les coffres **trouvés en minant sont tirés par le navigateur** et les
fragments sont enregistrés tels quels par la sauvegarde (aucun contrôle serveur du solde de
fragments, seulement les échantillons anti-bot #25) ; seuls les coffres de boutique sont tirés par
le serveur. À traiter après lancement (lot « tirage serveur des coffres minés », avec #25/#77).
Soldes actuels en production : 3 sauvegardes, **au plus 12 🔮 et 3 niveaux de reliques** — aucun
joueur n'a encore d'avance acquise : c'est le meilleur moment pour changer le barème.

### 3. Barèmes proposés (préréglages, AUCUN n'est publié)

Gemmes inchangées (barème A d'Admin → Économie non concerné). Le poids retiré aux fragments passe
aux pièces et aux boosts ; aucune table de boutique ne rend ≥ 80 % de son prix (pas de boucle de profit).

| Coffre | Actuel | **P — prudente (recommandée pour le 09/11)** | R — nettement plus rare |
|---|---|---|---|
| Vieille caisse | 20 % × 1 = 0,2 🔮 | 10 % × 1 = **0,1** | 5 % × 1 = **0,05** |
| Coffre en bois | 0,5 🔮 | 15 % × 1, 5 % × 2 = **0,25** | 12 % × 1, 3 % × 2 = **0,18** |
| Coffre en fer | 1,1 🔮 | 20 % × 1, 15 % × 2 = **0,5** | 15 % × 1, 10 % × 2 = **0,35** |
| Simple (800 🪙) | illimité, 0,3 🔮 | **20 / saison**, 15 % × 1 = 0,15 | **20 / saison, aucun fragment** (boost à la place) |
| Rare (15 000 🪙) | illimité, 2,0 🔮 | **10 / saison**, 2 et 4 🔮 = 1,08 | **10 / saison**, 1 et 2 🔮 = 0,35 |
| Antique (80 000 🪙) | 5 / saison, 12,4 🔮 | 5 / saison, 10 / 15 / 25 = 6,2 | 5 / saison, 4 / 6 = 1,9 |
| **Plafond pièces → 🔮 par saison** | **illimité** | **≈ 52 🔮 (3 % des reliques)** | **≈ 19 🔮 (1 %)** |

Variante étudiée en plus : **R + Aimant réduit** (1/1/2/2/3 au lieu de 1…5, demanderait une version
du catalogue de reliques #64) : effet visible seulement chez l'assidu en saison 3–4 (−20 à −35 % de
fragments) ; non recommandée maintenant (elle retouche un objet déjà acheté).

### 4. Chiffres (outil `tools/balance/fragment-rarity-sim.js`, vrai code du jeu, hasard à graine)

2 500 joueurs × 4 saisons = **10 000 saisons par profil et par variante**, 10 000 heures par ligne
pour les profondeurs, 2 000 joueurs pour anciens/nouveaux et #85. Production = tables v1, boutique
de fragments suspendue. Tables complètes en annexe C. Médianes.

**Fragments par heure selon la profondeur (coffres minés seulement, médiane · p90)**

| Équipement | Actuel | P | R |
|---|---|---|---|
| 30 m (début) | 5 · 9 | 2 · 5 | 1 · 4 |
| 122 m (capture du 02/11) | 8 · 14 | 4 · 7 | 3 · 6 |
| 300 m | 12 · 21 | 6 · 12 | 4 · 9 |
| 800 m (tout au max, reliques 3) | 26 · 41 | 13 · 25 | 9 · 19 |

**Niveaux de reliques cumulés (sur 30) en saisons 1 → 4 — sans achat de coffres · avec achats**

| Profil | Actuel | P | R |
|---|---|---|---|
| Débutant (20 min/j) | 2→7 · 4→23 | 1→3 · 2→11 | 0→2 · 1→5 |
| Régulier (1 h/j) | 5→18 · **26→30 (100 % au max en S2)** | 2→10 · 7→20 | 2→7 · 3→12 |
| Assidu (3 h/j + onglet) | 9→30 (93 % au max en S4) · **30 dès S1 (7 245 🔮)** | 5→18 · 8→26 | 3→13 · 5→17 |
| Automatique (onglet ouvert) | 3→14 · 27→30 | 2→7 · 6→18 | 1→5 · 3→10 |

**Frustration** (part des joueurs sans aucun nouveau niveau de relique dans la semaine) : actuel
≈ 0–4 % ; **P : débutant 21–35 %, autres ≈ 0 %** ; R : débutant 33–55 %, régulier ≤ 4 %. Un
débutant de 20 min/j obtient sa première relique (5 🔮) en ≈ 1 h de jeu avec P, ≈ 1,5 h avec R (chiffres sans achat de coffres ; avec achats, la frustration P tombe à 0–2 %).

**Profondeur** (avec achats de coffres, écart à l'actuel) : P −26 % (régulier S1) à −17 %
(assidu S4) ; R −27 % à −41 %. **Ce n'est pas une perte de contenu** : l'actuel est gonflé par la
conversion illimitée. Sans achat de coffres, l'écart est de −3 à −13 % (P) et −4 à −32 % (R) en S4.
Le classement (#73) compte les blocs détruits manuellement, qui suivent la même tendance.

**Anciens / nouveaux joueurs** (4 saisons au régime actuel puis bascule) : avec P, un ancien
régulier reste à 30/30 et 1 780 m contre 995 m pour un nouveau (+79 %, contre +33 % sans
changement) ; assidu +67 %. Aucun fragment ni niveau n'est retiré, donc **l'avance des anciens
devient durable** si l'on change tard. En production aujourd'hui, personne n'a d'avance
(≤ 12 🔮, ≤ 3 niveaux) : changer **avant** le 09/11 évite ce problème.

### 5. #85 (lot de 10 fragments en euros) — coordination, rien n'est développé ici

10 🔮 gratuits = ≈ 1 h (débutant), 2,5 h (régulier) avec l'actuel ; 2 h et 4 h avec P ; 3 h et 9 h
avec R. **Effet d'un lot unique acheté en début de saison 1** (sans achat de coffres) : débutant
+6 à +8 % de profondeur en S1, encore +4 à +6 % en S4 ; régulier +2 % ; assidu +2 %. 10 lots :
+15 à +28 %. **Plus les fragments sont rares, plus un lot pèse** (R : 1 lot = 2,5 saisons de
fragments d'un débutant). Deux scénarios pour #85 : (1) **un seul lot par compte, à vie**, et une
mission gratuite équivalente (10 🔮) pour les non-payeurs → avantage ≤ 1 semaine de jeu, pas de
cumul ; (2) **pas de fragments contre de l'argent**, uniquement cosmétique / confort. Recommandation :
(2) tant que le classement saisonnier donne des lots ; (1) au plus tôt après la bêta. La décision
reste dans #85 et ne retarde pas #84.

### 6. Changements réalisés (fichiers)

- `server/rewardTables.js` : `PRESETS` (P `fragments_prudente`, R `fragments_rare`),
  `presetTables`, `applyPreset` (remplace le brouillon dans une transaction, journal
  `draft_preset`, **jamais de publication**) ; la vue admin liste les préréglages.
- `server/index.js` : `POST /api/admin/rewards/draft/preset` (admin seulement).
- `public/admin/index.html`, `public/admin/admin.js` : 🎲 Coffres & drops → « Brouillon et
  publication » : liste « Préréglage » + « Charger dans le brouillon » (confirmation : « Rien ne
  change en jeu… »), note listant ce qui n'est pas réglable ici (Aimant → 🏺 Reliques,
  multiplicateur → ⚙ Config, coffres de boutique seulement, consolation 5 codée, fréquence des
  coffres → 🧱 Blocs, coffres minés tirés par le navigateur). Journal : « préréglage chargé ».
- `tools/balance/economy-sim.js` : tables des coffres, limites, Aimant et boutique de fragments
  injectables par les règles (valeurs par défaut identiques : rapports précédents reproductibles).
- `tools/balance/fragment-rarity-sim.js` (nouveau) ; `test/fragment-presets.test.js` (nouveau, 4 tests).

### 7. SHA, branche, procédure de test

Branche `feature/49-audit-economie`, commits `d591e5f` (code) et `bdb5577` (rapport) ; **`develop` = `c5ae266`, déployé**.

- `node --test test/fragment-presets.test.js` ; `npm test` complet.
- `node tools/balance/fragment-rarity-sim.js --runs 2500 --hour-runs 10000 --pack-runs 2000`
  (≈ 17 min) ; `--runs 100 --hour-runs 100 --pack-runs 50` pour un aperçu en 20 s.

### 8. Vérifications, déploiement

- Tests : `npm test` **861/861** sur la branche ; nouveaux tests : préréglages valides aux prix de
  production sans boucle de profit ; chargement = brouillon seul (version, tirage serveur, tables
  publiques inchangés) ; rechargement idempotent ; préréglage inconnu refusé sans effet ; sur base
  de test seulement : publication de R → limite 20 / 10 appliquée par le serveur, coffre simple sans
  fragment, **aucun fragment acquis retiré**, retour à v1 (nouvelle version) et achats de nouveau
  illimités ; simulateur reproductible sans effet sur les tables du jeu.
- Serveur de test (port 3101, base `test-49.sqlite`, supprimée) + Chromium headless 1280×900 et
  390×844 : préréglage R chargé, bandeau « brouillon en cours (6 coffres modifiés, non visible en
  jeu) », écarts listés, aucun débordement, aucune erreur JavaScript ; simulation du brouillon par
  l'API conforme (0 / 0,35 / 1,9 / 0,05 / 0,18 / 0,35 🔮) ; `GET /api/shop/chests` inchangé.
- **Déploiement du 06/11 : `c5ae266` (develop) en production** — tests 861/861 sur l'arbre exact de
  la release ; copie de la base de production démarrée sur le port 3122 : santé et version OK,
  empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking` identiques avant/après ; `main` avancé en avance rapide ; `deploy.sh` :
  sauvegarde vérifiée `dig-20261106-204753-pre-deploy-c5ae266.sqlite`, santé et version vérifiées ;
  deux domaines 200 + `1.0.0+c5ae266` ; journal sans erreur ; `quick_check` ok ; empreintes des six
  tables identiques à la sauvegarde. En production : tables des coffres **v1 seule, aucun brouillon**,
  `GET /api/shop/chests` inchangé (simple 800 / illimité, rare 15 000 / illimité, antique 5).
  Retour arrière : `git -C /home/ubuntu/Dig reset --keep 3a87ffd` + redémarrage (aucune migration).

### 9. Test à faire par le propriétaire (aucun effet en jeu tant que vous ne publiez pas)

1. Admin → 🎲 Coffres & drops → « Brouillon et publication » → Préréglage « Fragments — variante
   prudente (P) » → « Charger dans le brouillon » → confirmer. Attendu : bandeau « brouillon en
   cours (6 coffre(s) modifié(s), non visible en jeu) », liste des écarts, version en vigueur v1.
2. « Simuler le brouillon » (10 000) : fragments moyens 0,15 / 1,08 / 6,2 (boutique) et
   0,1 / 0,25 / 0,5 (minés).
3. **Seulement si vous validez les chiffres** : « Publier le brouillon » avec une note. Effet aux
   prochaines ouvertures ; retour arrière = « Revenir à v1 » (nouvelle version, rien n'est retiré
   aux joueurs). Sinon « Abandonner le brouillon ».

### 10. Choix techniques faits seul

- Préréglages dans le **module #37 existant** (brouillon unique, publication, retour arrière, journal)
  plutôt qu'un nouvel écran : un seul endroit règle probabilités, quantités et limites.
- Le retrait d'une ligne « fragments » d'un coffre de boutique est le seul moyen, sans code nouveau,
  de mettre la conversion à zéro : la limite par saison va de 1 à 1 000 (pas de 0) et il n'existe pas
  d'interrupteur « coffre fermé ». Je ne l'ai pas ajouté (pas demandé, et R couvre le besoin).
- Fréquence des blocs coffres et Aimant laissés tels quels dans P et R : ils touchent aussi les
  pièces ou des reliques déjà achetées.

### 11. Décisions demandées au propriétaire

1. **Publier un barème avant le 09/11 ?** (a) **P — prudente** ; (b) R — nettement plus rare ;
   (c) rien. **Recommandation : (a) P**, publié avant les invitations (aucun joueur n'a encore
   d'avance) : conversion des pièces bornée à ≈ 52 🔮 par saison, fragments des coffres minés
   divisés par deux, frustration limitée aux débutants (1 semaine sur 4–5 sans nouveau niveau).
   R si vous voulez des reliques « de long terme » (régulier 7/30 après un mois). Publication par
   vous dans l'admin, ou écrivez « publier P » / « publier R » dans le ticket.
2. Aimant à éclats réduit (1/1/2/2/3) ? **Recommandation : non pour l'instant** (effet faible, retouche un objet acheté).
3. #85 : scénario (2) « pas de fragments contre de l'argent » tant que le classement donne des lots ? **Recommandation : oui.**
4. Décisions du 04/11 toujours en attente (inchangées) : plafond 150, ramassage auto, limites/courbe, ordre d'activation.

### 12. Reste à réaliser

- Après décision : publication du barème choisi (un clic), contrôle en production.
- Après lancement : tirage serveur des coffres minés et contrôle serveur du solde de fragments
  (aujourd'hui calculés par le navigateur) — avec #25/#77 ; interrupteur « coffre de boutique fermé ».

## Session du 04/11/2026, soir (DIGORCH) — lot 1.2 (Admin → Économie) et lot 2.6 (boutique en gemmes fermée)

Suite de la décision du propriétaire du 04/11 (commentaire 6632720020, déjà prise en compte par la
session précédente). **Aucun prix, taux, plafond, limite, récompense ni solde n'a été modifié en
production ; aucun drapeau économique n'est activé ; rien n'est publié.**

### 1. État réel

**Déployé en production (SHA `0b990a1`), inactif : en attente de recette.** Lots 1.1, 1.2, 2.3–2.5 et
2.6 livrés. Il reste une étape : faire **appliquer par le jeu** les règles publiées (lot 1.3). Elle
ne sera faite qu'après validation des résultats par le propriétaire.
Classement : **Après lancement.**

### 2. Changements réalisés

**Règles économiques versionnées** : `server/economyRules.js`, sur le modèle des tables de récompenses #37.
- Contenu : gemmes par bloc gemme, gemmes des coffres de la mine (chance et quantité), série
  quotidienne (7 jours), bonus « trois missions », plafond de fin de saison, coûts Auto-Dig en
  gemmes (niveaux 3 à 6), courbe des pièces (segments), limites par saison des coffres de la
  boutique, prix et disponibilité des articles de la boutique en gemmes.
- **v1 = valeurs en vigueur relevées à la migration** : rubis, émeraude et diamant à 1 ; saphir,
  améthyste et cristal à 0 ; aucune gemme dans les coffres de la mine ; série 0/0/1/0/2/0/4 ;
  bonus 0 ; plafond 100 (⚙ Config) ; Auto-Dig 4/8/18/35 ; courbe actuelle ; limites simple et rare
  illimitées, antique 5 (tables #37). La boutique en gemmes reprend les prix de simulation
  150/350/30/8.
- **Barème A préparé en brouillon** (jamais publié) : gemmes par bloc 1/1/2/2/3/3, coffre de mine
  épique 10 % → 1 💎, bonus trois missions +1, plafond 150, Auto-Dig inchangé.
- Préréglages cumulables : barème A, limites 20/10, courbe b, courbe c, courbe actuelle.
- Cycle de vie : brouillon validé (bornes, courbe cohérente) → **simulation comparative** →
  **publication explicite** (confirmation et note obligatoires ; un brouillon périmé est refusé) →
  **retour arrière** (nouvelle version qui reprend le contenu d'une ancienne). Les versions et le
  journal sont en ajout seul : des déclencheurs SQLite bloquent toute modification ou suppression.
- **Ces règles ne sont pas appliquées par le jeu.** Le jeu continue de suivre son code, ⚙ Config
  et les tables #37. L'admin l'indique en toutes lettres, et signale les valeurs du jeu qui
  diffèrent de la version publiée. Ainsi, le changement de code reste séparé de l'activation du
  barème, comme demandé.

**Simulation comparative** : `tools/balance/economy-rules-sim.js`.
- Elle tourne dans un **processus séparé** (délai maximal 45 s, une seule à la fois) : le serveur
  de jeu n'est jamais bloqué.
- Elle compare la version publiée et le brouillon sur les mêmes graines, pour les 4 profils, avec
  100 à 1 000 joueurs par profil. Indicateurs : 💎 gagnées, 💎/h, 💎 perdues au plafond,
  fragments, niveaux de reliques, pièces, profondeur médiane, coffres achetés en boutique.

**Boutique en gemmes** : `server/gemShop.js`, **fermée**.
- Articles : pioche dorée, pioche diamant, ramassage automatique, boost ×2 30 min. Les prix
  viennent de la version publiée des règles.
- **Ouverture** : il faut à la fois le drapeau, avec la saisie `OUVRIR`, et le registre de gemmes
  en mode « fait foi ». Sinon le serveur refuse avec un code 409. Tant qu'elle est fermée, le
  joueur reçoit `{ open: false }` et tout achat est refusé avec un code 403.
- **Achat atomique et idempotent**, dans une seule transaction : contrôle de l'article, débit du
  registre (`gemLedger.spend`) et enregistrement de l'achat. Rejouer la même requête ne débite pas
  une seconde fois. Un article permanent ne s'achète qu'une fois. Un solde insuffisant renvoie 409
  sans rien écrire. Les achats sont en ajout seul.
- **L'effet en jeu n'est pas branché** : skin, ramassage et boost restent côté client, pour le lot
  suivant.

**Admin → 💰 Économie & Joueurs** : deux nouvelles cartes, « 📐 Règles économiques (référence) » et
« 🛒 Boutique en gemmes », plus le libellé « Achat boutique en gemmes » dans le registre.
- Les cartes reprennent les confirmations Dig et le suivi des saisies non enregistrées (#61), et
  les boutons Rafraîchir communs (#60).
- Routes : `/api/admin/economy/rules` (GET), `…/draft` (PUT/DELETE), `…/preset`, `…/simulate`,
  `…/publish`, `…/rollback`, `…/audit`, `/api/admin/economy/gem-shop` (GET), `…/flag` (POST), plus
  les routes joueur `GET /api/gem-shop` et `POST /api/gem-shop/buy`.
- Nouvelles tables, toutes ajoutées : `economy_rule_versions`, `economy_rule_draft`,
  `economy_rule_audit`, `gem_shop_settings`, `gem_shop_purchases`, `gem_shop_audit`.

### 3. Chiffres : simulation publiée (v1) → brouillon

Résultats de l'admin, 300 joueurs par profil, 1 saison. Pour cet essai, le plafond du brouillon a
été mis à 140 au lieu de 150. Écarts en pourcentage :

| Profil | 💎 gagnées | 💎 perdues au plafond | Fragments | Pièces | Profondeur médiane |
|---|---|---|---|---|---|
| Débutant | 17,9 → 28,2 (+58 %) | 0 → 0 | +1 % | +3 % | 309 → 311 |
| Régulier | 94,6 → 212,3 (+124 %) | 0 → 9,5 | +1 % | +2 % | 1 341 → 1 351 |
| Assidu | 224,4 → 574,4 (+156 %) | 59 → 359 | 0 % | 0 % | 3 207 → 3 210 |
| Automatique | 61,3 → 128,5 (+110 %) | 0 → 0 | 0 % | +21 % | 859 → 911 |

Lecture :
- Le barème A double ou triple les gemmes sans toucher à la profondeur des joueurs actifs.
- Le joueur assidu perd beaucoup au plafond : la boutique en gemmes est donc nécessaire pour
  donner un usage à ces gemmes.
- Le profil automatique gagne +6 % de profondeur et +21 % de pièces, parce que l'Auto-Dig arrive
  plus tôt.

**Effet du ramassage automatique sur la progression** (vérification demandée ; règles actuelles,
1 000 joueurs par profil) :
- Régulier et Assidu : aucun effet mesurable (moins de 0,5 %).
- Profil automatique (8 h d'onglet ouvert) : **profondeur médiane 693 → 720 (+4 %), pièces +10 %**.
  Aujourd'hui, la fenêtre d'un coffre trouvé met l'Auto-Dig en pause jusqu'au clic.
- C'est donc un article de **confort qui fait aussi progresser** les joueurs inactifs, ce qui
  touche le classement de façon modérée.

### 4. SHA, branche et procédure de test

- SHA sur `develop` et en production : **`0b990a1`**. Commit de fonctionnalité `142cf5f`, branche
  `feature/49-audit-economie`.
- Tests :
  - `npm test` : **636/636**, sur la branche et sur l'arbre exact de la release `0b990a1`.
  - 7 nouveaux tests dans `test/economy-rules.test.js` : migration v1 = valeurs en vigueur, barème
    A en brouillon, ajout seul, validation, préréglages, publication (note, version périmée),
    retour arrière, simulation identique quand les règles sont identiques, boutique fermée,
    ouverture refusée sans « fait foi », achat idempotent, article permanent, solde insuffisant,
    HTTP (401, confirmations, 403 joueur).
- Navigateur headless sur serveur de test (1280×900 et 390×844) :
  - les cartes se chargent ; simulation en 5,7 s ; enregistrement du brouillon ;
  - l'ouverture de la boutique est refusée avec le message attendu ;
  - aucun débordement de page ; la seule erreur JS est un 401 attendu, avant la connexion.

### 5. Vérifications, limites, données des joueurs

- **Copie de la base de production** (port 3122) : santé et version correctes ; empreintes
  identiques pour `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et
  `player_click_tracking`. v1 correspond aux valeurs en vigueur, le brouillon part de v1,
  la boutique est fermée et le registre est sur « off ». La copie a été supprimée.
- Limites :
  - le jeu n'applique pas les règles publiées ;
  - les effets de la boutique ne sont pas branchés côté client ;
  - la simulation utilise le catalogue de blocs v3 et les hypothèses d'ouverture de coffres du 04/11 ;
  - les achats simultanés entre processus reposent sur `gemLedger.spend`, testé à 4 processus
    lors de la session précédente.
- Données des joueurs : aucune modification. Seules des tables vides ou de référence ont été
  ajoutées.

### 6. Déploiement

- **SHA déployé : `0b990a1`**, de `020bad4` à `0b990a1`, avec `scripts/deploy.sh` de la release.
- Sauvegarde vérifiée : `dig-20261104-183123-pre-deploy-0b990a1.sqlite`.
- Les deux domaines répondent 200 avec `1.0.0+0b990a1`. Journal sans erreur, `quick_check` ok.
- Hachages de `users`, `user_saves`, `season_rankings`, `seasons` et `leagues` identiques à la
  sauvegarde.
- En production : v1 seule, brouillon A non publié, boutique fermée, 0 achat, registre « off ».
- Retour arrière : `git reset --keep 020bad4` puis redémarrage. Les nouvelles tables sont ignorées
  par l'ancien code.

**Test fonctionnel à faire par le propriétaire** (admin seulement, rien n'est visible en jeu) :
1. Admin → 💰 Économie & Joueurs → « 📐 Règles économiques (référence) ». Attendu : version
   publiée v1 et un brouillon « basé sur v1, 9 écarts », ce qui correspond au barème A (rubis 1,
   saphir 1, émeraude 2, améthyste 2, diamant 3, cristal 3, coffre épique 10 % → 1, bonus +1,
   plafond 150).
2. Cliquer « Simuler publiée → brouillon » avec 300 joueurs. Attendu : un tableau de 4 profils en
   moins de 10 s environ, avec les écarts du §3. Le jeu reste fluide pendant le calcul.
3. Facultatif : appliquer le préréglage « Limites 20/10 » ou « Courbe b », puis simuler de nouveau
   pour comparer. **Ne pas publier** tant que les résultats ne sont pas validés. Une publication
   serait de toute façon sans effet en jeu et réversible.
4. Carte « 🛒 Boutique en gemmes ». Attendu : « fermée », 4 articles (150/350/30/8), 0 achat. Le
   bouton « Ouvrir » est refusé tant que le registre n'est pas en « fait foi ».

### 7. Choix techniques faits seul

- Les règles sont une référence et ne sont pas lues par le jeu. Brancher le client sur le barème
  serait une activation, ce que la décision interdit avant validation.
- v1 est relevée depuis les sources réelles : catalogue de blocs, ⚙ Config, tables #37,
  `balance.js` et `daily.js`. Le brouillon A est créé une seule fois, à la migration.
- La simulation tourne dans un processus enfant : un calcul de plusieurs secondes dans le
  processus du jeu aurait figé tous les joueurs.
- La boutique ne peut pas s'ouvrir sans le registre « fait foi » : sinon un solde écrit par le
  navigateur pourrait acheter.
- La publication exige une note et une confirmation. Les versions et le journal sont en ajout seul.

### 8. Décisions demandées au propriétaire

1. **Résultats du barème A** (§3) : valider A tel quel pour une future activation, ou d'abord
   ajuster le plafond ? Avec 150, les assidus perdent environ 300 💎 par saison. Recommandation :
   garder 150 tant que la boutique n'est pas ouverte, puis revoir.
2. **Ramassage automatique** (+4 % de profondeur pour les joueurs inactifs) : (a) le garder à
   30 💎, (b) le réserver au jeu actif (onglet visible), (c) le retirer de la première boutique.
   Recommandation : **(b)**.
3. **Limites 20/10 et courbe des pièces** : décision inchangée depuis le rapport précédent (§8
   ci-dessous). Recommandation : limites (a) ou (b) avec un puits de pièces, courbe (a) pour
   l'instant.
4. **Activation** : quand les résultats sont validés, l'ordre proposé est : registre en
   « Observation » une semaine → lot 1.3 (le jeu applique les règles publiées) → publication du
   barème → registre « fait foi » → ouverture de la boutique. D'accord ?

### 9. Reste à réaliser

- Lot 1.3 : le jeu applique les règles publiées (client et registre), après accord.
- Effets de la boutique côté client (skin, ramassage, boost) et affichage joueur, derrière le drapeau.
- Registre en « Observation », puis « fait foi », sur décision du propriétaire.

## Session du 04/11/2026 (DIGORCH) — décision du propriétaire : lot 1 (registre de gemmes) et lot 2 (simulations)

Décision du propriétaire du 04/11 (commentaire 6632720020) : barème A comme direction cible,
limites 20/10 **à simuler**, coffre simple à 800 provisoirement, courbe des pièces **à simuler**,
première boutique en gemmes derrière un drapeau désactivé, **journal de gemmes serveur prioritaire**.
**Interdiction explicite** de changer prix, taux, plafonds, limites, récompenses ou soldes en
production, et d'activer un drapeau économique, sans nouvelle validation des résultats.

### 1. État réel

**Partiel — lot 1.1 (registre de gemmes de référence) et lot 2 (simulations 3, 4, 5) livrés ;
déployé en production (SHA `020bad4`) À L'ÉTAT DÉSACTIVÉ — en attente de recette ; rien n'est activé.** Restent à faire
dans ce ticket (sessions suivantes, sans attendre le propriétaire) : lot 1.2 (Admin → Économie avec
brouillon / simulation / publication / versions / retour arrière), barème A rendu pilotable mais
non publié, boutique en gemmes derrière un drapeau OFF (lot 2.6).

Classement : **Après lancement** (l'économie actuelle fonctionne ; le registre est un prérequis
de la boutique en gemmes, pas du MVP).

### 2. Ce qui a été codé (lot 1.1) — registre de gemmes de référence côté serveur

Nouveau module `server/gemLedger.js`, tables **en ajout seul** (`gem_accounts`, `gem_ledger`,
`gem_anomalies`, `gem_ledger_settings`, `gem_ledger_audit`) :

- **Trois modes**, réglage journalisé, **`off` par défaut** (et en production) :
  - `off` : rien n'est lu ni écrit — comportement identique à avant ;
  - `observe` : à chaque sauvegarde acceptée, le serveur tient un solde de référence et note les
    écarts ; **la sauvegarde et le solde du joueur ne sont jamais modifiés** ;
  - `enforce` (« fait foi ») : le solde de référence remplace `gems` dans la sauvegarde **renvoyée**
    au client (lecture `GET /api/me/save` et réponse de `POST /api/me/save`) ; la sauvegarde stockée
    n'est pas réécrite. Le jeu applique l'écart sans perdre les gemmes gagnées depuis l'envoi.
    Exige une double confirmation (saisir `ENFORCE`).
- **Migration sûre** : à la première observation, solde de référence = gemmes de la sauvegarde
  (« ouverture ») → **aucune gemme retirée**. Le solde de référence ne baisse que par une dépense
  ou le plafond de saison ; une baisse inexpliquée côté client est notée, jamais reportée.
- **Crédits selon preuves** : blocs gemmes **validés par le serveur** (statistiques fiables de
  #38, bornées par la profondeur retenue et le budget de dégâts) × gemmes par bloc (catalogue
  publié ; `gemReward: false` → 0) — jamais le compteur déclaré ; série / missions / objectifs
  (calculés par le navigateur) : écart déclaré crédité dans une **allocation de 8 💎 par jour**
  (Europe/Brussels ; barème actuel max 7 + 1 pour le bonus « 3 missions » du barème A), surplus
  noté en anomalie et non crédité ; dépenses Auto-Dig déduites de la montée de niveau (coûts
  vérifiés contre `public/js/balance.js` par un test).
- **Idempotence / rejeu** : une révision de sauvegarde déjà traitée (ou plus ancienne, réponse
  dans le désordre) ne compte jamais deux fois ; chaque mouvement a une clé unique par joueur.
- **Dépenses / crédits atomiques et idempotents** (`spend`, `credit`) pour la future boutique :
  même clé = même résultat, solde insuffisant → 409 sans écriture ; testé avec **4 processus
  simultanés** sur la même base (jamais plus que le solde, journal = solde). Aucune route joueur
  ne les appelle aujourd'hui.
- **Saisons et reset** : nouvelle saison → plafond `gems_cap` appliqué une fois, Auto-Dig repart
  de 0 sans remboursement ; reset saisonnier admin → même plafond.
- **Multisession / PC / mobile** : la session de jeu unique (#35) et les révisions (#18) s'appliquent
  avant l'observation (une sauvegarde refusée n'est jamais observée).
- **Admin → 💰 Économie & Joueurs → « 💎 Registre de gemmes (serveur) »** : mode, comptes suivis,
  soldes, joueurs au-dessus de la référence, mouvements par motif, anomalies récentes, changement de
  mode avec confirmation Dig. Routes `GET /api/admin/economy/gems`,
  `GET /api/admin/economy/gems/players/:id`, `POST /api/admin/economy/gems/mode` (admin seulement).

Fichiers : `server/gemLedger.js` (nouveau), `server/index.js` (branchement : init, observation
après les badges, injection en mode `enforce`, reset admin, routes), `public/js/main.js` (réponse
`gems` appliquée — inerte tant que le mode n'est pas `enforce`), `public/admin/index.html`,
`public/admin/admin.js`, `test/gem-ledger.test.js` (11 tests).

### 3. Simulations (lot 2.3–2.5) — rien n'est appliqué au jeu

Outil `tools/balance/economy-sim.js` étendu (variantes internes à l'outil, aucun effet sur le jeu).
Commande : `node tools/balance/economy-sim.js --runs 5000 --long-runs 1000 --seasons 8`
(5 000 saisons par profil pour la saison 1, 1 000 joueurs × 8 saisons pour les combinaisons ;
réduit de 10 000 à 5 000 pour tenir dans un temps raisonnable sur la machine partagée — mêmes
tendances, graines fixes). Sortie complète en annexe B.

**Hypothèse nouvelle** (différente du 03/11) : tous les profils achètent des coffres de la boutique
dès que leurs améliorations en pièces sont au maximum, avec un budget d'ouvertures par saison
(débutant 50, régulier 300, assidu 1 800, automatique 300). Les chiffres « actuel » diffèrent donc
du 03/11, où seul l'assidu convertissait ses pièces.

**Limites 20 simples / 10 rares par saison (antique 5) — résumé (médianes)** :

| Profil | Combinaison | Profondeur S1 / S2 / S4 / S8 | 💎/h S1 | 🔮 S1 | Toutes reliques au max | Améliorations max (h) | 💰 inutilisées S1 |
|---|---|---|---|---|---|---|---|
| Débutant | Actuel | 309 / 362 / 480 / 662 | 13,5 | 47 | S7 (100 %) | — | 760 |
| Débutant | A + limites 20/10 | 311 / 361 / 457 / 645 | 21,0 | 39 | S8 (63 %) | — | 3 844 |
| Régulier | Actuel | 1 346 / 1 759 / 1 779 / 1 778 | 6,8 | 1 248 | S2 | 3,3 | 196,6 M |
| Régulier | A seul | 1 359 / 1 763 / 1 779 / 1 778 | 15,2 | 1 270 | S2 | 3,2 | 202,3 M |
| Régulier | A + limites 20/10 | 1 083 / 1 284 / 1 663 / 1 778 | 10,4 | 215 | S4 | 3,2 | 61,2 M |
| Régulier | A + limites + courbe (b) | 1 070 / 1 280 / 1 657 / 1 779 | 10,1 | 210 | S4 | 4,0 | 33,0 M |
| Assidu | Actuel | 3 207 / 3 384 / 3 383 / 3 383 | 4,6 | 7 626 | S1 | 2,8 | 1 277 M |
| Assidu | A + limites 20/10 | 2 196 / 2 681 / 3 383 / 3 384 | 6,6 | 358 | S3 | 2,8 | 319 M |
| Assidu | A + limites + courbe (b) | 2 194 / 2 678 / 3 383 / 3 385 | 6,6 | 356 | S3 | 3,1 | 160 M |
| Automatique | Actuel | 861 / 1 606 / 1 633 / 1 633 | 1,1 | 1 238 | S2 | 33,0 | 33,6 M |
| Automatique | A + limites 20/10 | 753 / 973 / 1 304 / 1 634 | 1,6 | 176 | S5 | 30,3 | 13,6 M |

Lecture :

1. **Les limites 20/10 sont le levier qui compte** : fragments de la saison 1 divisés par ≈ 6
   (régulier 1 248 → 215) à ≈ 20 (assidu 7 626 → 358) ; toutes les reliques au maximum en S3–S5
   au lieu de S1–S2 ; l'écart de profondeur saison 1 entre assidu et régulier redevient lié au
   temps de jeu. À long terme (S8), tout le monde atteint le même plafond (reliques au max).
2. **Frustration** : avec 20/10, 100 % des réguliers, assidus et automatiques atteignent la limite
   dès la saison 1 et restent « bloqués » (pièces et temps disponibles, plus rien d'utile à acheter) ;
   les débutants l'atteignent à 66 % en S1. Les pièces inutilisées restent massives (61 M pour un
   régulier) : la limite déplace le problème des pièces sans puits, elle ne le résout pas.
3. **Courbe des pièces** (b : +5 %/m jusqu'à 200 m puis +2 %/m ; c : +1 %/m) : pièces gagnées
   −39 % (b) à −52 % (c) pour un régulier, −48 % à −65 % pour un assidu ; **profondeur quasi
   inchangée** (−0,3 à −0,4 % en saison 1) ; améliorations au max après 4,0 h (b) / 4,1 h (c) au
   lieu de 3,2 h ; pièces inutilisées en fin de saison 1 (régulier, sans coffres) 43 M → 25 M (b) →
   18 M (c). **La courbe seule ne crée pas de puits** : les coûts des améliorations sont bornés, les
   pièces restent saturées après ≈ 4 h.
4. **Sac / boost / Cœur d'or** : boost ×2 30 min/jour : +4,8 à +5,1 % (débutant), +0,5 à +0,6 %
   (régulier), quelle que soit la courbe ; sans Sac : −5 % à −5,6 % (un peu plus marqué avec b/c,
   les pièces redeviennent un peu plus rares) ; Cœur d'or : effet nul à négatif sur la profondeur
   en S4 (les fragments rendent plus en Moteur/Griffe), indépendant de la courbe.
5. **Barème A** : ≈ ×2 de gemmes (régulier 6,8 → 15,2 💎/h S1 sans limites ; 10,4 avec limites, car
   moins de coffres de mine profonds), +0,1 à +6 % de profondeur selon le profil (Auto-Dig 6 plus tôt).

### 4. SHA, branche et procédure de test

- Branche `feature/49-audit-economie` ; **SHA sur `develop` = SHA déployé : `020bad4`**.
- `node --test test/gem-ledger.test.js` (11 tests) ; `node --test test/economy-sim.test.js`
  (8 tests dont 3 nouveaux : courbe b/c, limites respectées, combinaisons reproductibles et sans
  effet sur le jeu) ; `npm test` complet.
- Reproduire les chiffres : commande de la section 3 (≈ 25 min) ; `--runs 500 --long-runs 100`
  pour un aperçu rapide.

### 5. Vérifications, limites, données des joueurs

- **Aucune donnée joueur modifiée** : en production le registre est `off` (aucune ligne écrite) ;
  les cinq tables sont créées vides au démarrage (ajout seul, idempotent). Migration testée sur une
  copie de la base de production (empreintes identiques, section 6).
- Limites du registre : l'allocation journalière borne la falsification des sources calculées par le
  navigateur à 8 💎/jour (série, missions, objectifs restent déclaratifs tant qu'ils ne sont pas
  validés côté serveur) ; les blocs gemmes validés peuvent arriver avec une sauvegarde de retard
  (écart temporaire visible dans l'admin) ; en mode `enforce`, un joueur qui falsifie verrait ses
  gemmes ramenées au solde de référence — à n'activer qu'après lecture du mode `observe`.
- Limites des simulations : joueur rationnel, ordre d'achat des coffres fixe, budget d'ouvertures
  par profil supposé, objets de collection = 5 🔮 ; 5 000 (et non 10 000) saisons par profil.

### 6. Déploiement

**Déployé en production : `020bad4`** (merge `--no-ff` dans `develop`, arbre identique à la branche
testée) — **registre en mode `off`, aucun réglage économique modifié.**

- `npm test` complet sur l'arbre exact de `020bad4` : **629 / 629 réussis** (dont 11 nouveaux
  `gem-ledger` et 3 nouveaux `economy-sim`).
- Copie de la base de production (`.backup`) démarrée en production sur le port 3122 : `/health` ok,
  `/api/version` = `1.0.0+020bad4`, tables du registre créées vides, mode `off` ; **empreintes
  identiques** avant/après (`users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking`) ; copie supprimée.
- `scripts/deploy.sh` (script de la release) : sauvegarde vérifiée
  `~/backups/dig/dig-20261104-180704-pre-deploy-020bad4.sqlite`, `e9e1471 → 020bad4`, santé et
  version vérifiées. Après : les deux domaines → 200 et `1.0.0+020bad4`, journal sans erreur,
  `quick_check` = ok, mode `off`, 0 ligne de registre, comptes / sauvegardes / classements inchangés.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep e9e1471` + redémarrage (les tables
  ajoutées, vides, sont ignorées par l'ancien code).

**Test fonctionnel à faire par le propriétaire** (≈ 3 min, sans rien activer) :
1. Admin → **💰 Économie & Joueurs** → carte **« 💎 Registre de gemmes (serveur) »** : attendu
   « Mode actuel : Désactivé », 0 compte suivi, aucune anomalie.
2. En jeu : jouer quelques minutes, trouver une gemme, acheter un niveau d'Auto-Dig si possible :
   attendu **aucun changement** (gemmes affichées comme avant).
3. (Facultatif, seulement si vous le décidez — question 1) : passer en **Observation**, jouer 10 min,
   puis « ↻ Rafraîchir » : attendu 1 compte suivi, solde d'ouverture = vos gemmes, mouvements
   « Blocs gemmes validés » / « Série / missions », aucune anomalie pour un jeu normal ; vos gemmes en
   jeu ne bougent pas. Revenir à « Désactivé » est immédiat.

### 7. Choix techniques faits seul

- Mode par défaut `off` (et non `observe`) : la décision interdit toute activation sans accord ; le
  passage en observation est donc une question (1), bien qu'il ne modifie aucun solde.
- Solde de référence = **borne haute du solde légitime** : il ne suit jamais une baisse côté client
  (perte notée), si bien que le mode `enforce` ne peut que rendre des gemmes perdues, jamais retirer
  des gemmes justifiées.
- Sources calculées par le navigateur bornées par une **allocation journalière** plutôt que
  recalculées côté serveur : la série et les missions vivent dans le navigateur ; les valider côté
  serveur demanderait de déplacer ces systèmes (hors périmètre de ce lot).
- En mode `enforce`, le solde est injecté dans la sauvegarde **renvoyée** (comme les objets de
  collection serveur #39) au lieu de réécrire la sauvegarde stockée : aucune réécriture de données.
- Clé d'idempotence d'observation = révision serveur de la sauvegarde (monotone) : pas de ligne de
  journal par sauvegarde sans mouvement.
- Courbe alternative (c) = +5 %/m jusqu'à 200 m puis +1 %/m : borne basse plausible pour mesurer
  l'élasticité (b se situe entre l'actuelle et c).
- Simulations à 5 000 saisons/profil (et non 10 000) : durée sur machine partagée ; mêmes graines.

### 8. Décisions demandées au propriétaire

1. **Registre de gemmes** : passer en mode **Observation** en production pour 1 à 2 semaines
   (aucun solde ni sauvegarde modifié, réversible d'un clic) ? Recommandation : **oui** — c'est la
   recette du registre avant tout mode « fait foi » et avant la boutique en gemmes.
2. **Limites 20/10** : les simulations montrent l'effet attendu (fragments ÷ 6 à ÷ 20 en S1, reliques
   au max en S3–S5) mais **100 % des joueurs réguliers et assidus sont bloqués dès la S1**. Options :
   (a) 20/10 tel quel ; (b) 20/10 + les pièces restantes servent à un nouveau puits (ex. coffre
   antique supplémentaire ou boutique de fragments étendue) ; (c) limites plus larges (ex. 50/20).
   Recommandation : **(a) ou (b)** — (a) est simple et réversible, à accompagner d'un puits plus tard.
3. **Courbe des pièces** : (b) et (c) réduisent les pièces de 40 à 65 % **sans effet sur la
   profondeur** et ne repoussent la saturation que de 3,2 h à ≈ 4 h. Options : (a) ne rien changer ;
   (b) courbe b ; (c) courbe c. Recommandation : **(a) pour l'instant** — la courbe ne résout pas
   l'inflation ; le vrai levier est un puits de pièces (question 2b).
4. **Boutique en gemmes** : je la développe derrière un drapeau désactivé (pioche dorée 150, pioche
   diamant 350, ramassage auto 30, boost ×2 30 min 8 💎 = prix de simulation). Aucune question
   bloquante ; les prix restent à confirmer après simulation.

### 9. Éléments restant à réaliser (dans ce ticket, sessions suivantes)

- Lot 1.2 : Admin → Économie — règles économiques versionnées (gemmes par bloc, gemmes des coffres
  de mine, bonus missions, plafond, limites des coffres, courbe des pièces, boutique gemmes),
  brouillon, simulation comparative, aperçu des impacts, publication explicite, versions, journal,
  retour arrière ; version publiée initiale = valeurs actuelles (aucun changement).
- Barème A et limites préparés comme **brouillon** (non publiés), jeu lisant les règles publiées.
- Lot 2.6 : boutique en gemmes derrière drapeau OFF, achats via `gemLedger.spend` (idempotent).
- Mode `enforce` : seulement après recette de l'observation et accord du propriétaire.

### Annexe B (04/11) — sortie de `node tools/balance/economy-sim.js --runs 5000 --long-runs 1000 --seasons 8`

<details><summary>Afficher la sortie complète</summary>

<!-- généré par node tools/balance/economy-sim.js --runs 5000 --long-runs 1000 --seasons 8 -->
#### Probabilités exactes par bloc (catalogue v3 publié, Chance 0 et 5)

| Profondeur | Chance | Gemme qui rapporte 💎 | Gemme sans 💎 (saphir, améthyste, cristal) | Coffre de la mine | 💎 / 1 000 blocs (A · B) |
|---|---|---|---|---|---|
| 20 m | 0 | 0,00 % | 0,00 % | 5,64 % | 0,0 (0,0 · 0,0) |
| 20 m | 5 | 0,00 % | 0,00 % | 7,07 % | 0,0 (0,0 · 0,0) |
| 35 m | 0 | 2,15 % | 0,00 % | 7,51 % | 21,5 (21,5 · 42,9) |
| 35 m | 5 | 3,11 % | 0,00 % | 9,59 % | 31,1 (31,1 · 62,2) |
| 50 m | 0 | 2,06 % | 0,00 % | 7,20 % | 20,6 (20,6 · 41,1) |
| 50 m | 5 | 2,93 % | 0,00 % | 9,03 % | 29,3 (29,3 · 58,6) |
| 70 m | 0 | 3,05 % | 0,00 % | 7,13 % | 30,5 (40,7 · 71,3) |
| 70 m | 5 | 4,33 % | 0,00 % | 8,90 % | 43,3 (57,7 · 101,0) |
| 100 m | 0 | 3,05 % | 0,00 % | 7,13 % | 30,5 (40,7 · 71,3) |
| 100 m | 5 | 4,33 % | 0,00 % | 8,90 % | 43,3 (57,7 · 101,0) |
| 122 m | 0 | 3,55 % | 0,00 % | 7,09 % | 35,5 (55,7 · 96,2) |
| 122 m | 5 | 5,01 % | 0,00 % | 8,83 % | 50,1 (78,8 · 136,1) |
| 150 m | 0 | 3,31 % | 0,00 % | 6,62 % | 33,1 (52,0 · 89,9) |
| 150 m | 5 | 4,70 % | 0,00 % | 8,28 % | 47,0 (73,8 · 127,5) |
| 250 m | 0 | 3,08 % | 0,00 % | 6,16 % | 30,8 (48,4 · 83,5) |
| 250 m | 5 | 4,39 % | 0,00 % | 7,73 % | 43,9 (68,9 · 119,0) |
| 400 m | 0 | 2,95 % | 1,06 % | 5,91 % | 29,5 (57,0 · 101,3) |
| 400 m | 5 | 4,14 % | 1,48 % | 7,29 % | 41,4 (79,8 · 141,9) |
| 600 m | 0 | 2,87 % | 1,84 % | 5,74 % | 28,7 (71,7 · 123,0) |
| 600 m | 5 | 3,97 % | 2,55 % | 7,00 % | 39,7 (99,4 · 170,3) |
| 900 m | 0 | 2,85 % | 2,08 % | 5,70 % | 28,5 (78,6 · 134,4) |
| 900 m | 5 | 3,94 % | 2,87 % | 6,94 % | 39,4 (108,6 · 185,7) |

#### Espérance des coffres (pièces, fragments)

| Coffre | Coût | Pièces rendues | Fragments (Aimant 0 → 5) | Boost | Objet | Pièces nettes / fragment |
|---|---|---|---|---|---|---|
| Mine — vieille caisse | gratuit | 155 | 0,20 → 1,20 | 0 % | — | — |
| Mine — coffre en bois | gratuit | 180 | 0,50 → 2,50 | 20 % | — | — |
| Mine — coffre en fer | gratuit | 270 | 1,10 → 3,35 | 25 % | — | — |
| Boutique — simple (∞/saison) | 800 | 613 | 0,30 → 1,80 | 15 % | 0 % | 625 → 104 |
| Boutique — rare (∞/saison) | 15 000 | 3 200 | 2,04 → 4,14 | 8 % | 8 % | 5 784 → 2 850 |
| Boutique — antique (5/saison) | 80 000 | 11 000 | 12,40 → 14,75 | 10 % | 12 % | 5 565 → 4 678 |

#### Une heure à équipement figé — 5 000 heures simulées par ligne (barème actuel · A · B)

Médiane (p10–p90) ; 💎 et 🔮 : moyenne ± écart-type en plus.

| Équipement | Mètres / h | 💎 / h actuel | 💎 / h A | 💎 / h B | 🔮 / h (mine) | 💰 / h |
|---|---|---|---|---|---|---|
| Début — 30 m, pioche 3, 4 clics/s | 127 (117–135) | 4 (1–6) · 3,8 ± 1,9 | 5 (2–9) · 5,3 ± 2,9 | 10 (4–17) · 10,1 ± 5,0 | 5 (1–9) · 5,0 ± 3,0 | 58 937 |
| Capture 02/11 — 122 m, pioche 8 (+4 Œil), Chance 5, Sac 6, Auto-Dig 4, 4 clics/s | 195 (182–206) | 9 (5–13) · 8,7 ± 2,9 | 14 (8–21) · 14,1 ± 5,1 | 25 (15–37) · 25,4 ± 8,6 | 8 (4–14) · 8,6 ± 4,0 | 691 259 |
| Milieu — 300 m, pioche 12, Chance 8, Sac 9, Auto-Dig 6, 5 clics/s | 170 (157–183) | 8 (5–12) · 8,1 ± 2,8 | 15 (9–22) · 15,3 ± 5,2 | 27 (17–39) · 27,8 ± 8,8 | 12 (5–21) · 12,7 ± 5,9 | 2 373 765 |
| Avancé — 800 m, tout au max, reliques 3, 6 clics/s | 158 (143–173) | 10 (6–14) · 9,7 ± 3,1 | 27 (18–36) · 27,2 ± 7,1 | 47 (33–63) · 47,6 ± 11,9 | 26 (13–41) · 26,4 ± 11,1 | 18 309 698 |
| Onglet ouvert seul — 300 m, Auto-Dig 6, passage /10 min | 14 (10–19) | 0 (0–2) · 0,7 ± 0,8 | 1 (0–3) · 1,1 ± 1,4 | 2 (0–5) · 2,0 ± 2,4 | 0 (0–2) · 0,7 ± 1,1 | 53 833 |

#### Saison 1 (nouveau joueur, 7 jours) — 5 000 saisons par profil et par barème

Médiane (p10–p90) · moyenne ± écart-type.

##### Débutant (20 min/j, 4 j/7) — 1,3 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 310 (291–330) · moy. 310 ± 15 | 312 (292–331) · moy. 312 ± 15 | 312 (294–331) · moy. 312 ± 15 |
| 💎 gagnées / saison | 18,0 (13,0–24,0) · moy. 18,1 ± 4,4 | 28,0 (19,0–38,0) · moy. 28,3 ± 7,2 | 52,0 (38,0–69,0) · moy. 52,8 ± 12,2 |
| 💎 / heure de jeu | 13,50 (9,75–18,00) · moy. 13,55 ± 3,28 | 21,00 (14,25–28,50) · moy. 21,26 ± 5,41 | 39,00 (28,50–51,75) · moy. 39,59 ± 9,18 |
| — dont blocs gemmes | 13,0 (8,0–19,0) · moy. 13,6 ± 4,2 | 20,0 (12,0–30,0) · moy. 20,4 ± 6,8 | 35,0 (22,0–51,0) · moy. 35,9 ± 11,5 |
| — dont série quotidienne | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 4,0 (4,0–4,0) · moy. 4,0 ± 0,0 |
| — dont missions du jour | 4,0 (3,0–4,0) · moy. 3,5 ± 0,6 | 7,0 (5,0–7,0) · moy. 6,2 ± 1,1 | 10,0 (7,0–10,0) · moy. 9,0 ± 1,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–2,0) · moy. 0,7 ± 0,8 | 3,0 (0,0–6,0) · moy. 2,9 ± 2,2 |
| 💎 dépensées (Auto-Dig) | 12,0 (12,0–12,0) · moy. 11,7 ± 2,5 | 12,0 (12,0–30,0) · moy. 19,4 ± 8,9 | 50,0 (20,0–50,0) · moy. 37,6 ± 14,8 |
| 💎 en fin de saison (avant plafond) | 6,0 (2,0–12,0) · moy. 6,4 ± 3,7 | 9,0 (1,0–16,0) · moy. 8,9 ± 5,3 | 15,0 (3,0–27,0) · moy. 15,2 ± 9,3 |
| 🔮 fragments / saison | 21,0 (14,0–29,0) · moy. 21,2 ± 5,9 | 21,0 (14,0–29,0) · moy. 21,4 ± 6,0 | 21,0 (14,0–30,0) · moy. 21,4 ± 6,0 |
| 🔮 / heure de jeu | 15,75 (10,50–21,75) · moy. 15,93 ± 4,45 | 15,75 (10,50–21,75) · moy. 16,06 ± 4,48 | 15,75 (10,50–22,50) · moy. 16,05 ± 4,50 |
| — dont coffres de la mine | 15,0 (8,0–23,0) · moy. 15,3 ± 5,7 | 15,0 (8,0–23,0) · moy. 15,4 ± 5,7 | 15,0 (8,0–23,0) · moy. 15,4 ± 5,7 |
| — dont boutique de fragments | 6,0 (5,0–7,0) · moy. 5,9 ± 0,9 | 6,0 (5,0–7,0) · moy. 6,0 ± 0,9 | 6,0 (5,0–7,0) · moy. 6,0 ± 0,9 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 1 329 152 (825 080–2 167 044) · moy. 1 431 348 ± 553 686 | 1 386 831 (877 468–2 257 708) · moy. 1 495 164 ± 574 594 | 1 406 911 (901 028–2 238 005) · moy. 1 508 763 ± 568 851 |
| 💰 / heure de jeu | 996 864 (618 810–1 625 283) · moy. 1 073 511 ± 415 265 | 1 040 123 (658 101–1 693 281) · moy. 1 121 373 ± 430 945 | 1 055 183 (675 771–1 678 504) · moy. 1 131 572 ± 426 638 |
| Auto-Dig atteint (niveau) | 4,0 (4,0–4,0) · moy. 3,9 ± 0,3 | 4,0 (4,0–5,0) · moy. 4,4 ± 0,5 | 5,0 (4,0–5,0) · moy. 4,6 ± 0,5 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 94 % · 1 % · 0 % | 100 % · 100 % · 41 % · 0 % | 100 % · 100 % · 59 % · 0 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | — | — | 1,1 (1,1–1,1) · moy. 1,1 ± 0,0 |
| — part des joueurs qui ont tout au max | 0 % | 0 % | 0 % |
| 💰 non dépensées en fin de saison | 84 258 (17 518–172 326) · moy. 91 545 ± 63 137 | 86 724 (17 499–177 995) · moy. 94 374 ± 67 261 | 88 477 (17 710–177 648) · moy. 95 882 ± 66 963 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,3 · 0,8 · 1,3 · — | 0,3 · 0,6 · 1,1 · — | 0,2 · 0,5 · 1,0 · — |

##### Régulier (1 h/j, 7 j/7, bonus pub) — 14,0 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 994 (967–1 022) · moy. 994 ± 22 | 1 001 (973–1 029) · moy. 1 001 ± 22 | 1 001 (975–1 031) · moy. 1 002 ± 22 |
| 💎 gagnées / saison | 65,0 (56,0–75,0) · moy. 65,6 ± 7,5 | 130,0 (111,0–150,0) · moy. 130,1 ± 14,9 | 229,0 (197,0–264,0) · moy. 229,8 ± 25,8 |
| 💎 / heure de jeu | 4,64 (4,00–5,36) · moy. 4,69 ± 0,53 | 9,29 (7,93–10,71) · moy. 9,29 ± 1,06 | 16,36 (14,07–18,86) · moy. 16,41 ± 1,84 |
| — dont blocs gemmes | 51,0 (42,0–60,0) · moy. 50,8 ± 7,4 | 110,0 (91,0–129,0) · moy. 109,9 ± 14,8 | 190,0 (159,0–224,0) · moy. 190,9 ± 25,2 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (6,0–7,0) · moy. 6,8 ± 0,4 | 10,0 (9,0–10,0) · moy. 9,9 ± 0,5 | 13,0 (12,0–13,0) · moy. 12,9 ± 0,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 2,0 (0,0–4,0) · moy. 2,3 ± 1,5 | 10,0 (5,0–15,0) · moy. 10,0 ± 4,1 |
| 💎 dépensées (Auto-Dig) | 65,0 (30,0–65,0) · moy. 49,3 ± 17,4 | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 110,0 (110,0–110,0) · moy. 110,0 ± 0,0 |
| 💎 en fin de saison (avant plafond) | 13,0 (1,0–33,0) · moy. 16,3 ± 12,3 | 65,0 (46,0–85,0) · moy. 65,1 ± 14,9 | 119,0 (87,0–154,0) · moy. 119,8 ± 25,8 |
| 🔮 fragments / saison | 75,0 (55,0–97,0) · moy. 75,6 ± 16,2 | 75,0 (55,0–97,0) · moy. 76,2 ± 16,4 | 76,0 (55,0–98,0) · moy. 76,2 ± 16,6 |
| 🔮 / heure de jeu | 5,36 (3,93–6,93) · moy. 5,40 ± 1,16 | 5,36 (3,93–6,93) · moy. 5,44 ± 1,17 | 5,43 (3,93–7,00) · moy. 5,44 ± 1,19 |
| — dont coffres de la mine | 65,0 (45,0–87,0) · moy. 65,6 ± 16,2 | 65,0 (45,0–87,0) · moy. 66,2 ± 16,4 | 66,0 (45,0–88,0) · moy. 66,2 ± 16,6 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 47 356 847 (38 718 204–58 166 428) · moy. 47 937 444 ± 7 778 422 | 48 433 219 (39 588 239–59 120 371) · moy. 49 020 316 ± 7 861 312 | 48 590 645 (39 646 504–60 068 157) · moy. 49 276 085 ± 7 997 836 |
| 💰 / heure de jeu | 3 382 632 (2 765 586–4 154 745) · moy. 3 424 103 ± 555 602 | 3 459 516 (2 827 731–4 222 884) · moy. 3 501 451 ± 561 522 | 3 470 760 (2 831 893–4 290 583) · moy. 3 519 720 ± 571 274 |
| Auto-Dig atteint (niveau) | 6,0 (5,0–6,0) · moy. 5,6 ± 0,5 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 55 % | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 3,2 (2,4–4,1) · moy. 3,3 ± 0,6 | 3,2 (2,4–4,1) · moy. 3,2 ± 0,6 | 3,2 (2,3–4,1) · moy. 3,2 ± 0,6 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 42 369 377 (33 730 734–53 178 958) · moy. 42 949 974 ± 7 778 422 | 43 445 749 (34 600 769–54 132 901) · moy. 44 032 846 ± 7 861 312 | 43 603 175 (34 659 034–55 080 687) · moy. 44 288 615 ± 7 997 836 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,3 · 1,3 · 4,3 · 12,0 | 0,2 · 1,0 · 2,3 · 6,0 | 0,2 · 0,5 · 2,2 · 5,3 |

##### Assidu (3 h/j + 4 h onglet ouvert) — 49,0 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 2 051 (1 990–2 106) · moy. 2 049 ± 46 | 2 057 (1 995–2 112) · moy. 2 055 ± 46 | 2 057 (1 995–2 112) · moy. 2 055 ± 46 |
| 💎 gagnées / saison | 124,0 (111,0–139,0) · moy. 124,2 ± 10,9 | 293,5 (264,0–323,0) · moy. 293,6 ± 23,4 | 514,0 (463,0–567,0) · moy. 514,5 ± 40,4 |
| 💎 / heure de jeu | 2,53 (2,27–2,84) · moy. 2,53 ± 0,22 | 5,99 (5,39–6,59) · moy. 5,99 ± 0,48 | 10,49 (9,45–11,57) · moy. 10,50 ± 0,82 |
| — dont blocs gemmes | 109,0 (96,0–124,0) · moy. 109,2 ± 10,9 | 271,0 (242,0–301,0) · moy. 270,8 ± 23,2 | 465,0 (415,0–516,0) · moy. 464,7 ± 39,4 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 13,0 (13,0–13,0) · moy. 13,0 ± 0,0 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 5,0 (2,0–8,0) · moy. 4,8 ± 2,2 | 20,0 (13,0–29,0) · moy. 20,7 ± 5,9 |
| 💎 dépensées (Auto-Dig) | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 110,0 (110,0–110,0) · moy. 110,0 ± 0,0 |
| 💎 en fin de saison (avant plafond) | 59,0 (46,0–74,0) · moy. 59,2 ± 10,9 | 228,5 (199,0–258,0) · moy. 228,6 ± 23,4 | 404,0 (353,0–457,0) · moy. 404,5 ± 40,4 |
| 🔮 fragments / saison | 1 860,0 (1 801,0–2 462,0) · moy. 1 924,5 ± 215,6 | 1 862,0 (1 802,0–2 464,0) · moy. 1 932,3 ± 222,6 | 1 861,0 (1 802,0–2 465,0) · moy. 1 932,1 ± 226,4 |
| 🔮 / heure de jeu | 37,96 (36,76–50,24) · moy. 39,28 ± 4,40 | 38,00 (36,78–50,29) · moy. 39,43 ± 4,54 | 37,98 (36,78–50,31) · moy. 39,43 ± 4,62 |
| — dont coffres de la mine | 166,0 (125,0–211,0) · moy. 167,7 ± 33,8 | 167,0 (125,0–213,0) · moy. 168,8 ± 34,0 | 167,0 (124,0–213,0) · moy. 167,9 ± 34,3 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 1 681,0 (1 642,0–2 236,0) · moy. 1 746,7 ± 198,8 | 1 684,0 (1 642,0–2 242,0) · moy. 1 753,5 ± 205,3 | 1 684,0 (1 642,0–2 243,0) · moy. 1 754,2 ± 208,8 |
| 💰 pièces gagnées / saison | 250 249 819 (215 543 767–286 634 717) · moy. 250 937 810 ± 27 800 413 | 250 725 290 (217 672 678–288 885 063) · moy. 252 111 417 ± 27 986 652 | 250 809 191 (216 554 947–287 380 876) · moy. 251 761 890 ± 27 944 297 |
| 💰 / heure de jeu | 5 107 139 (4 398 852–5 849 688) · moy. 5 121 180 ± 567 355 | 5 116 843 (4 442 300–5 895 614) · moy. 5 145 131 ± 571 156 | 5 118 555 (4 419 489–5 864 916) · moy. 5 137 998 ± 570 292 |
| Auto-Dig atteint (niveau) | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 243 426 349 (208 720 297–279 811 247) · moy. 244 114 340 ± 27 800 413 | 243 901 820 (210 849 208–282 061 593) · moy. 245 287 947 ± 27 986 652 | 243 985 721 (209 731 477–280 557 406) · moy. 244 938 420 ± 27 944 297 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,2 · 0,7 · 5,0 · 17,7 | 0,2 · 0,4 · 2,5 · 5,6 | 0,1 · 0,4 · 2,4 · 5,3 |

##### Automatique (15 min/j + 8 h onglet) — 57,8 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 691 (662–719) · moy. 691 ± 22 | 722 (691–750) · moy. 721 ± 23 | 727 (697–755) · moy. 727 ± 23 |
| 💎 gagnées / saison | 48,0 (40,0–57,0) · moy. 48,6 ± 6,6 | 88,0 (73,0–105,0) · moy. 88,7 ± 12,8 | 158,0 (131,0–186,0) · moy. 158,1 ± 21,8 |
| 💎 / heure de jeu | 0,83 (0,69–0,99) · moy. 0,84 ± 0,11 | 1,52 (1,26–1,82) · moy. 1,54 ± 0,22 | 2,74 (2,27–3,22) · moy. 2,74 ± 0,38 |
| — dont blocs gemmes | 34,0 (26,0–43,0) · moy. 34,0 ± 6,4 | 69,0 (53,0–85,0) · moy. 68,7 ± 12,6 | 121,0 (94,0–148,0) · moy. 120,8 ± 21,6 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (6,0–7,0) · moy. 6,6 ± 0,6 | 10,0 (9,0–12,0) · moy. 10,4 ± 1,0 | 15,0 (12,0–17,0) · moy. 14,2 ± 1,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 1,0 (0,0–3,0) · moy. 1,6 ± 1,3 | 7,0 (3,0–12,0) · moy. 7,1 ± 3,4 |
| 💎 dépensées (Auto-Dig) | 30,0 (30,0–30,0) · moy. 30,3 ± 3,3 | 65,0 (65,0–65,0) · moy. 64,1 ± 5,5 | 110,0 (110,0–110,0) · moy. 109,3 ± 6,3 |
| 💎 en fin de saison (avant plafond) | 18,0 (10,0–27,0) · moy. 18,3 ± 6,5 | 24,0 (9,0–40,0) · moy. 24,6 ± 12,0 | 49,0 (22,0–76,0) · moy. 48,8 ± 21,0 |
| 🔮 fragments / saison | 49,0 (35,0–66,0) · moy. 49,9 ± 12,4 | 52,0 (36,0–70,0) · moy. 52,3 ± 12,9 | 52,0 (36,0–70,0) · moy. 52,8 ± 12,8 |
| 🔮 / heure de jeu | 0,85 (0,61–1,14) · moy. 0,86 ± 0,21 | 0,90 (0,62–1,21) · moy. 0,91 ± 0,22 | 0,90 (0,62–1,21) · moy. 0,91 ± 0,22 |
| — dont coffres de la mine | 39,0 (25,0–56,0) · moy. 39,9 ± 12,4 | 42,0 (26,0–60,0) · moy. 42,3 ± 12,9 | 42,0 (26,0–60,0) · moy. 42,8 ± 12,8 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 13 606 051 (10 929 168–16 517 084) · moy. 13 683 263 ± 2 155 725 | 15 410 095 (12 463 644–18 839 037) · moy. 15 544 168 ± 2 464 986 | 15 776 740 (12 767 974–19 115 929) · moy. 15 870 802 ± 2 482 084 |
| 💰 / heure de jeu | 235 603 (189 250–286 010) · moy. 236 940 ± 37 329 | 266 841 (215 821–326 217) · moy. 269 163 ± 42 684 | 273 190 (221 090–331 012) · moy. 274 819 ± 42 980 |
| Auto-Dig atteint (niveau) | 5,0 (5,0–5,0) · moy. 5,0 ± 0,1 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,2 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,1 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 1 % | 100 % · 100 % · 100 % · 97 % | 100 % · 100 % · 100 % · 99 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 33,0 (27,6–38,5) · moy. 33,0 ± 4,0 | 30,3 (26,2–35,8) · moy. 30,8 ± 3,6 | 30,3 (25,3–35,5) · moy. 30,3 ± 3,7 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 8 618 581 (5 941 698–11 529 614) · moy. 8 695 793 ± 2 155 725 | 10 422 625 (7 476 174–13 851 567) · moy. 10 556 698 ± 2 464 986 | 10 789 270 (7 780 504–14 128 459) · moy. 10 883 332 ± 2 482 084 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 5,5 · 12,4 · 33,0 · 55,4 | 5,4 · 8,3 · 19,3 · 42,0 | 4,4 · 8,3 · 16,6 · 39,3 |

#### Accumulation sur 8 saisons — 1 000 joueurs par profil (barème actuel)

| Profil | Saison | Profondeur max | 💎 gagnées | 💎 en fin (avant plafond) | 💎 perdues au plafond | 🔮 gagnées | Niveaux de reliques | Coffres boutique |
|---|---|---|---|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | 1 | 311 | 18,0 | 6,0 | 0,0 (moy.) | 21 | 2 / 30 | 0 |
| Débutant (20 min/j, 4 j/7) | 4 | 394 | 24,0 | 9,0 | 0,0 (moy.) | 45 | 8 / 30 | 0 |
| Débutant (20 min/j, 4 j/7) | 8 | 472 | 31,0 | 13,0 | 0,0 (moy.) | 90 | 16 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 1 | 994 | 66,0 | 12,0 | 0,0 (moy.) | 76 | 6 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 4 | 1 325 | 95,0 | 75,0 | 0,8 (moy.) | 243 | 20 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 8 | 1 779 | 137,0 | 172,0 | 72,5 (moy.) | 502 | 30 / 30 | 0 |
| Assidu (3 h/j + 4 h onglet ouvert) | 1 | 2 050 | 124,0 | 59,0 | 0,0 (moy.) | 1 861 | 30 / 30 | 1 800 |
| Assidu (3 h/j + 4 h onglet ouvert) | 4 | 3 384 | 252,0 | 287,0 | 186,4 (moy.) | 4 235 | 30 / 30 | 1 800 |
| Assidu (3 h/j + 4 h onglet ouvert) | 8 | 3 383 | 250,5 | 285,5 | 185,6 (moy.) | 4 239 | 30 / 30 | 1 800 |
| Automatique (15 min/j + 8 h onglet) | 1 | 694 | 48,0 | 18,0 | 0,0 (moy.) | 50 | 4 / 30 | 0 |
| Automatique (15 min/j + 8 h onglet) | 4 | 949 | 69,0 | 25,0 | 0,0 (moy.) | 151 | 16 / 30 | 0 |
| Automatique (15 min/j + 8 h onglet) | 8 | 1 447 | 113,0 | 130,0 | 29,8 (moy.) | 410 | 29 / 30 | 0 |

#### Effet des avantages sur la profondeur (saison 1, 5 000 saisons, barème actuel)

| Profil | Référence | Sans Auto-Dig en gemmes | Ramassage auto des coffres (onglet ouvert) | Boost ×2 pièces 30 min / jour | Écart Auto-Dig gemmes | Écart ramassage | Écart boost |
|---|---|---|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | 310 m | 304 m | — | 326 m | -1,9 % | — | +5,2 % |
| Régulier (1 h/j, 7 j/7, bonus pub) | 994 m | 965 m | 995 m | 998 m | -2,9 % | +0,1 % | +0,4 % |
| Assidu (3 h/j + 4 h onglet ouvert) | 2 051 m | 1 979 m | 2 054 m | 2 055 m | -3,5 % | +0,1 % | +0,2 % |
| Automatique (15 min/j + 8 h onglet) | 691 m | 559 m | 720 m | 701 m | -19,1 % | +4,2 % | +1,4 % |

#### Conversion des pièces en coffres de la boutique — 1 000 joueurs × 4 saisons

| Scénario | 🔮 saison 1 | Reliques S1 (/30) | Profondeur S1 | Profondeur S2 | Écart S2 | Profondeur S4 | Écart S4 |
|---|---|---|---|---|---|---|---|
| Assidu — sans coffres de la boutique | 178 | 10 | 2 049 m | 2 408 m | +0,0 % | 3 328 m | +0,0 % |
| Assidu — simple à 800 (production), 1 h d'ouvertures (1 800) | 1 861 | 30 | 2 049 m | 3 385 m | +40,6 % | 3 382 m | +1,6 % |
| Assidu — simple à 2 000 (défaut du code), 1 800 ouvertures | 1 861 | 30 | 2 049 m | 3 385 m | +40,6 % | 3 382 m | +1,6 % |
| Assidu — simple à 800, 300 ouvertures / saison | 512 | 18 | 2 049 m | 2 736 m | +13,6 % | 3 384 m | +1,7 % |
| Assidu — script au plafond du limiteur (30/min, 24 h) | 39 121 | 30 | 2 049 m | 3 385 m | +40,6 % | 3 382 m | +1,6 % |
| Régulier — sans coffres de la boutique | 75 | 6 | 993 m | 1 127 m | +0,0 % | 1 328 m | +0,0 % |
| Régulier — simple à 800, 300 ouvertures / saison | 408 | 16 | 993 m | 1 313 m | +16,5 % | 1 780 m | +34,1 % |

### Simulations du 04/11 — limites des coffres, courbe des pièces, combinaisons (rien n'est appliqué au jeu)

Hypothèses communes : tous les profils achètent des coffres de la boutique dès que toutes les améliorations en pièces sont au max (fin de journée), et le dernier jour joué de la saison avec les pièces restantes. Budget d'ouvertures par saison (temps de clic accepté) : Débutant 50, Régulier 300, Assidu 1 800, Automatique 300. Ordre d'achat : pièces abondantes → le plus de 🔮 par ouverture (antique, rare, simple) ; pièces comptées → le moins de pièces nettes par 🔮 (simple, rare, antique). Prix 800 / 15 000 / 80 000 (production). Objet de collection = 5 🔮 (repli), boost des coffres ignoré.

Courbes de la récompense des blocs (multiplicateur de la récompense de base) :

| Profondeur | Courbe actuelle | Courbe b | Courbe c |
|---|---|---|---|
| 50 m | ×3,5 | ×3,5 | ×3,5 |
| 100 m | ×6,0 | ×6,0 | ×6,0 |
| 200 m | ×11,0 | ×11,0 | ×11,0 |
| 300 m | ×16,0 | ×13,0 | ×12,0 |
| 500 m | ×26,0 | ×17,0 | ×14,0 |
| 1 000 m | ×51,0 | ×27,0 | ×19,0 |
| 2 000 m | ×101,0 | ×47,0 | ×29,0 |
| 3 000 m | ×151,0 | ×67,0 | ×39,0 |

(a) actuelle : +5 %/m sans limite ; (b) +5 %/m jusqu'à 200 m puis +2 %/m ; (c) +5 %/m jusqu'à 200 m puis +1 %/m.

#### 1. Limites des coffres de la boutique : illimité vs 20 simples + 10 rares par saison (antique 5) — 1 000 joueurs × 8 saisons par profil

Médianes. « Limite atteinte » = part des joueurs qui atteignent la limite des simples ou des rares ; « bloqué » = en fin de saison, il reste des ouvertures et des pièces, mais chaque coffre payable est à sa limite (frustration : achat refusé). « 💰 restantes » = pièces perdues à la remise à zéro.

| Profil | Barème | Limites | 🔮 / saison S1 | 🔮 / h S1 | 🔮 cumulés S8 | Reliques S1 · S4 · S8 (/30) | Toutes reliques au max (saison ; part) | Profondeur S1 · S2 · S4 · S8 | 💎 / saison S1 | Coffres S1 simple · rare · antique | Limite atteinte S1 · S8 | Bloqués S1 · S8 | 💰 restantes fin S1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Débutant | actuel | illimité | 47 | 35,3 | 2 537 | 4 · 21 · 30 | S7 ; 100 % | 309 · 362 · 480 · 662 m | 18,0 | 43 · 2 · 1 | 0 % · 0 % | 0 % · 0 % | 760 |
| Débutant | actuel | 20/10 | 36 | 27,0 | 1 650 | 3 · 17 · 30 | S8 ; 56 % | 309 · 358 · 449 · 638 m | 18,0 | 20 · 3 · 1 | 68 % · 100 % | 67 % · 100 % | 3 891 |
| Débutant | A | illimité | 51 | 38,3 | 2 571 | 4 · 21 · 30 | S7 ; 100 % | 311 · 366 · 488 · 666 m | 28,0 | 42 · 2 · 1 | 0 % · 0 % | 0 % · 0 % | 754 |
| Débutant | A | 20/10 | 39 | 29,3 | 1 704 | 4 · 17 · 30 | S8 ; 63 % | 311 · 361 · 457 · 645 m | 28,0 | 20 · 3 · 1 | 66 % · 100 % | 66 % · 100 % | 3 844 |
| Régulier | actuel | illimité | 1 248 | 89,1 | 14 305 | 27 · 30 · 30 | S2 ; 100 % | 1 346 · 1 759 · 1 779 · 1 778 m | 95,0 | 0 · 295 · 5 | 0 % · 0 % | 0 % · 0 % | 196 628 348 |
| Régulier | actuel | 20/10 | 213 | 15,2 | 4 276 | 11 · 30 · 30 | S4 ; 100 % | 1 075 · 1 276 · 1 661 · 1 781 m | 71,0 | 20 · 10 · 5 | 100 % · 100 % | 100 % · 100 % | 59 571 941 |
| Régulier | A | illimité | 1 270 | 90,7 | 14 315 | 27 · 30 · 30 | S2 ; 100 % | 1 359 · 1 763 · 1 779 · 1 778 m | 213,0 | 0 · 295 · 5 | 0 % · 0 % | 0 % · 0 % | 202 317 379 |
| Régulier | A | 20/10 | 215 | 15,4 | 4 287 | 11 · 30 · 30 | S4 ; 100 % | 1 083 · 1 284 · 1 663 · 1 778 m | 146,0 | 20 · 10 · 5 | 100 % · 100 % | 100 % · 100 % | 61 209 902 |
| Assidu | actuel | illimité | 7 626 | 155,6 | 71 347 | 30 · 30 · 30 | S1 ; 100 % | 3 207 · 3 384 · 3 383 · 3 383 m | 224,0 | 0 · 1 795 · 5 | 0 % · 0 % | 0 % · 0 % | 1 277 318 068 |
| Assidu | actuel | 20/10 | 363 | 7,4 | 7 555 | 15 · 30 · 30 | S3 ; 100 % | 2 196 · 2 684 · 3 385 · 3 382 m | 136,0 | 20 · 10 · 5 | 100 % · 100 % | 100 % · 100 % | 321 163 204 |
| Assidu | A | illimité | 7 603 | 155,2 | 71 303 | 30 · 30 · 30 | S1 ; 100 % | 3 210 · 3 383 · 3 386 · 3 382 m | 574,0 | 0 · 1 795 · 5 | 0 % · 0 % | 0 % · 0 % | 1 283 421 710 |
| Assidu | A | 20/10 | 358 | 7,3 | 7 549 | 15 · 30 · 30 | S3 ; 100 % | 2 196 · 2 681 · 3 383 · 3 384 m | 324,0 | 20 · 10 · 5 | 100 % · 100 % | 100 % · 100 % | 319 183 331 |
| Automatique | actuel | illimité | 1 238 | 21,4 | 14 036 | 27 · 30 · 30 | S2 ; 100 % | 861 · 1 606 · 1 633 · 1 633 m | 62,0 | 0 · 295 · 5 | 0 % · 0 % | 0 % · 0 % | 33 590 359 |
| Automatique | actuel | 20/10 | 167 | 2,9 | 3 769 | 10 · 27 · 30 | S5 ; 100 % | 716 · 948 · 1 288 · 1 633 m | 51,0 | 20 · 10 · 5 | 100 % · 100 % | 100 % · 100 % | 11 029 021 |
| Automatique | A | illimité | 1 256 | 21,7 | 14 056 | 27 · 30 · 30 | S2 ; 100 % | 918 · 1 612 · 1 631 · 1 633 m | 128,5 | 0 · 295 · 5 | 0 % · 0 % | 0 % · 0 % | 42 451 961 |
| Automatique | A | 20/10 | 176 | 3,0 | 3 795 | 10 · 27 · 30 | S5 ; 100 % | 753 · 973 · 1 304 · 1 634 m | 94,0 | 20 · 10 · 5 | 100 % · 100 % | 100 % · 100 % | 13 641 095 |

#### 2. Courbe des pièces — saison 1, barème A, 5 000 saisons par profil et par courbe (sans coffres de la boutique)

Médiane (p10–p90) · moyenne ± écart-type. Écarts de profondeur (médianes) : boost ×2 pièces 30 min / jour ; sans Sac (jamais acheté).

##### Débutant (20 min/j, 4 j/7)

| Mesure | Courbe actuelle | Courbe b | Courbe c |
|---|---|---|---|
| Profondeur max (m) | 312 (292–331) · moy. 312 ± 15 | 311 (292–331) · moy. 311 ± 15 | 311 (292–330) · moy. 311 ± 15 |
| 💰 gagnées / saison | 1 386 831 (877 468–2 257 708) · moy. 1 495 164 ± 574 594 | 1 280 625 (830 935–2 057 983) · moy. 1 378 015 ± 509 756 | 1 246 735 (815 896–1 987 962) · moy. 1 338 982 ± 488 283 |
| 💰 / heure de jeu | 1 040 123 (658 101–1 693 281) · moy. 1 121 373 ± 430 945 | 960 468 (623 201–1 543 487) · moy. 1 033 511 ± 382 317 | 935 051 (611 922–1 490 971) · moy. 1 004 237 ± 366 212 |
| Toutes améliorations en pièces au max (h de jeu) | — | — | — |
| — part des joueurs qui ont tout au max | 0 % | 0 % | 0 % |
| — profondeur à ce moment (m) | — | — | — |
| 💰 non dépensées en fin de saison | 86 724 (17 499–177 995) · moy. 94 374 ± 67 261 | 82 167 (17 002–163 543) · moy. 88 278 ± 59 890 | 81 045 (17 309–159 582) · moy. 86 785 ± 57 759 |
| Pioche atteinte (niveau) | 11,0 (11,0–12,0) · moy. 11,2 ± 0,7 | 11,0 (10,0–12,0) · moy. 11,1 ± 0,6 | 11,0 (10,0–12,0) · moy. 11,1 ± 0,6 |
| Auto-Dig atteint (niveau) | 4,0 (4,0–5,0) · moy. 4,4 ± 0,5 | 4,0 (4,0–5,0) · moy. 4,4 ± 0,5 | 4,0 (4,0–5,0) · moy. 4,4 ± 0,5 |
| Écart de profondeur vs courbe actuelle | +0,0 % | -0,3 % | -0,3 % |
| Boost ×2 30 min / jour : profondeur (écart) | 327 m (+4,8 %) | 327 m (+5,1 %) | 326 m (+4,8 %) |
| Sans Sac : profondeur (écart) | 295 m (-5,4 %) | 295 m (-5,1 %) | 295 m (-5,1 %) |

##### Régulier (1 h/j, 7 j/7, bonus pub)

| Mesure | Courbe actuelle | Courbe b | Courbe c |
|---|---|---|---|
| Profondeur max (m) | 1 001 (973–1 029) · moy. 1 001 ± 22 | 998 (970–1 027) · moy. 999 ± 22 | 997 (969–1 026) · moy. 997 ± 23 |
| 💰 gagnées / saison | 48 433 219 (39 588 239–59 120 371) · moy. 49 020 316 ± 7 861 312 | 29 613 409 (24 500 787–35 960 592) · moy. 30 011 662 ± 4 529 745 | 23 449 837 (19 503 295–28 162 045) · moy. 23 710 028 ± 3 436 217 |
| 💰 / heure de jeu | 3 459 516 (2 827 731–4 222 884) · moy. 3 501 451 ± 561 522 | 2 115 244 (1 750 056–2 568 614) · moy. 2 143 690 ± 323 553 | 1 674 988 (1 393 093–2 011 575) · moy. 1 693 573 ± 245 444 |
| Toutes améliorations en pièces au max (h de jeu) | 3,2 (2,4–4,1) · moy. 3,2 ± 0,6 | 4,0 (3,0–4,7) · moy. 3,8 ± 0,7 | 4,1 (3,1–5,2) · moy. 4,1 ± 0,8 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| — profondeur à ce moment (m) | 439 (390–485) · moy. 439 ± 38 | 479 (421–532) · moy. 478 ± 43 | 501 (437–555) · moy. 499 ± 46 |
| 💰 non dépensées en fin de saison | 43 445 749 (34 600 769–54 132 901) · moy. 44 032 846 ± 7 861 312 | 24 625 939 (19 513 317–30 973 122) · moy. 25 024 192 ± 4 529 745 | 18 462 367 (14 515 825–23 174 575) · moy. 18 722 558 ± 3 436 217 |
| Pioche atteinte (niveau) | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| Auto-Dig atteint (niveau) | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 |
| Écart de profondeur vs courbe actuelle | +0,0 % | -0,3 % | -0,4 % |
| Boost ×2 30 min / jour : profondeur (écart) | 1 006 m (+0,5 %) | 1 004 m (+0,6 %) | 1 003 m (+0,6 %) |
| Sans Sac : profondeur (écart) | 963 m (-3,8 %) | 948 m (-5,0 %) | 941 m (-5,6 %) |

##### Assidu (3 h/j + 4 h onglet ouvert)

| Mesure | Courbe actuelle | Courbe b | Courbe c |
|---|---|---|---|
| Profondeur max (m) | 2 057 (1 995–2 112) · moy. 2 055 ± 46 | 2 054 (1 995–2 112) · moy. 2 054 ± 46 | 2 054 (1 994–2 110) · moy. 2 052 ± 46 |
| 💰 gagnées / saison | 249 577 490 (216 493 129–287 714 284) · moy. 250 956 948 ± 27 985 389 | 128 768 991 (112 404 918–147 262 022) · moy. 129 402 410 ± 13 669 085 | 88 598 293 (77 676 202–100 583 947) · moy. 88 966 911 ± 8 999 968 |
| 💰 / heure de jeu | 5 093 418 (4 418 227–5 871 720) · moy. 5 121 570 ± 571 130 | 2 627 939 (2 293 978–3 005 347) · moy. 2 640 866 ± 278 961 | 1 808 128 (1 585 229–2 052 734) · moy. 1 815 651 ± 183 673 |
| Toutes améliorations en pièces au max (h de jeu) | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 | 3,1 (2,6–4,8) · moy. 3,3 ± 0,9 | 3,2 (2,7–5,0) · moy. 3,7 ± 1,0 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| — profondeur à ce moment (m) | 438 (379–491) · moy. 436 ± 44 | 483 (410–540) · moy. 479 ± 52 | 507 (426–567) · moy. 501 ± 56 |
| 💰 non dépensées en fin de saison | 244 590 020 (211 505 659–282 726 814) · moy. 245 969 478 ± 27 985 389 | 123 781 521 (107 417 448–142 274 552) · moy. 124 414 940 ± 13 669 085 | 83 610 823 (72 688 732–95 596 477) · moy. 83 979 441 ± 8 999 968 |
| Pioche atteinte (niveau) | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| Auto-Dig atteint (niveau) | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 |
| Écart de profondeur vs courbe actuelle | +0,0 % | -0,1 % | -0,1 % |
| Boost ×2 30 min / jour : profondeur (écart) | 2 062 m (+0,2 %) | 2 061 m (+0,3 %) | 2 060 m (+0,3 %) |
| Sans Sac : profondeur (écart) | 2 028 m (-1,4 %) | 2 017 m (-1,8 %) | 2 011 m (-2,1 %) |

##### Automatique (15 min/j + 8 h onglet)

| Mesure | Courbe actuelle | Courbe b | Courbe c |
|---|---|---|---|
| Profondeur max (m) | 722 (691–750) · moy. 721 ± 23 | 720 (689–749) · moy. 720 ± 23 | 720 (689–748) · moy. 719 ± 24 |
| 💰 gagnées / saison | 15 410 095 (12 463 644–18 839 037) · moy. 15 544 168 ± 2 464 986 | 11 199 732 (9 249 145–13 402 210) · moy. 11 273 368 ± 1 607 065 | 9 820 307 (8 191 513–11 611 132) · moy. 9 861 059 ± 1 328 067 |
| 💰 / heure de jeu | 266 841 (215 821–326 217) · moy. 269 163 ± 42 684 | 193 935 (160 158–232 073) · moy. 195 210 ± 27 828 | 170 049 (141 844–201 059) · moy. 170 754 ± 22 997 |
| Toutes améliorations en pièces au max (h de jeu) | 30,3 (26,2–35,8) · moy. 30,8 ± 3,6 | 35,2 (30,3–39,7) · moy. 34,8 ± 3,9 | 36,3 (31,8–41,3) · moy. 36,8 ± 4,0 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| — profondeur à ce moment (m) | 481 (447–513) · moy. 480 ± 26 | 521 (483–553) · moy. 519 ± 27 | 538 (503–571) · moy. 537 ± 27 |
| 💰 non dépensées en fin de saison | 10 422 625 (7 476 174–13 851 567) · moy. 10 556 698 ± 2 464 986 | 6 212 262 (4 261 675–8 414 740) · moy. 6 285 898 ± 1 607 065 | 4 832 837 (3 204 043–6 623 662) · moy. 4 873 589 ± 1 328 067 |
| Pioche atteinte (niveau) | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| Auto-Dig atteint (niveau) | 6,0 (6,0–6,0) · moy. 6,0 ± 0,2 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,2 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,2 |
| Écart de profondeur vs courbe actuelle | +0,0 % | -0,3 % | -0,3 % |
| Boost ×2 30 min / jour : profondeur (écart) | 731 m (+1,2 %) | 730 m (+1,4 %) | 730 m (+1,4 %) |
| Sans Sac : profondeur (écart) | 703 m (-2,6 %) | 701 m (-2,6 %) | 700 m (-2,8 %) |

#### 3. Combinaisons — 1 000 joueurs × 8 saisons par profil (mêmes graines pour toutes les combinaisons)

Médiane (p10–p90) · moyenne ± écart-type. Coffres de la boutique achetés selon les hypothèses ci-dessus.

##### Débutant (20 min/j, 4 j/7)

| Mesure | Actuel | Actuel + limites 20/10 | A seul | A + limites 20/10 | A + limites + courbe (b) | A + limites + courbe (c) |
|---|---|---|---|---|---|---|
| Profondeur S1 (m) | 309 (291–327) · moy. 309 ± 14 | 309 (291–327) · moy. 309 ± 14 | 311 (293–331) · moy. 311 ± 15 | 311 (293–331) · moy. 311 ± 15 | 311 (293–330) · moy. 311 ± 15 | 310 (293–330) · moy. 311 ± 15 |
| Profondeur S2 (m) | 362 (341–397) · moy. 366 ± 22 | 358 (338–385) · moy. 360 ± 19 | 366 (343–403) · moy. 369 ± 22 | 361 (341–390) · moy. 364 ± 20 | 360 (340–386) · moy. 362 ± 18 | 359 (340–382) · moy. 361 ± 17 |
| Profondeur S4 (m) | 480 (430–530) · moy. 480 ± 39 | 449 (415–491) · moy. 451 ± 30 | 488 (439–535) · moy. 487 ± 37 | 457 (420–497) · moy. 458 ± 29 | 447 (415–489) · moy. 449 ± 28 | 444 (412–480) · moy. 445 ± 26 |
| Profondeur S8 (m) | 662 (646–681) · moy. 662 ± 14 | 638 (583–667) · moy. 630 ± 33 | 666 (648–683) · moy. 666 ± 14 | 645 (587–674) · moy. 637 ± 33 | 636 (575–670) · moy. 627 ± 37 | 627 (572–667) · moy. 623 ± 37 |
| 💎 gagnées S1 | 18,0 (13,0–24,0) · moy. 17,8 ± 4,2 | 18,0 (13,0–24,0) · moy. 17,8 ± 4,2 | 28,0 (19,9–38,0) · moy. 28,2 ± 7,0 | 28,0 (19,9–38,0) · moy. 28,2 ± 7,0 | 28,0 (20,0–38,0) · moy. 28,2 ± 6,9 | 28,0 (20,0–38,0) · moy. 28,1 ± 6,9 |
| 💎 / heure S1 | 13,50 (9,75–18,00) · moy. 13,36 ± 3,12 | 13,50 (9,75–18,00) · moy. 13,36 ± 3,12 | 21,00 (14,93–28,50) · moy. 21,18 ± 5,23 | 21,00 (14,93–28,50) · moy. 21,18 ± 5,23 | 21,00 (15,00–28,50) · moy. 21,12 ± 5,20 | 21,00 (15,00–28,50) · moy. 21,10 ± 5,19 |
| 💎 perdues au plafond S8 (moy.) | 0,0 | 0,0 | 1,0 | 0,0 | 0,0 | 0,0 |
| 🔮 / saison S1 | 47 (28–84) · moy. 52 ± 23 | 36 (23–72) · moy. 43 ± 20 | 51 (29–88) · moy. 55 ± 24 | 39 (24–74) · moy. 46 ± 21 | 38 (24–72) · moy. 45 ± 19 | 37 (24–68) · moy. 43 ± 18 |
| 🔮 / heure S1 | 35,25 (21,00–63,00) · moy. 39,32 ± 17,32 | 27,00 (17,25–54,00) · moy. 32,25 ± 15,19 | 38,25 (21,75–66,08) · moy. 41,26 ± 17,88 | 29,25 (18,00–55,50) · moy. 34,29 ± 15,94 | 28,50 (18,00–54,00) · moy. 33,38 ± 14,62 | 27,75 (18,00–51,00) · moy. 32,29 ± 13,42 |
| 🔮 / saison S8 | 489 (409–563) · moy. 488 ± 61 | 351 (281–427) · moy. 353 ± 57 | 483 (406–565) · moy. 485 ± 61 | 355 (286–430) · moy. 357 ± 57 | 349 (274–427) · moy. 349 ± 59 | 346 (275–417) · moy. 346 ± 55 |
| 🔮 cumulés après 8 saisons | 2 537 (2 148–2 904) · moy. 2 531 ± 296 | 1 650 (1 372–1 987) · moy. 1 664 ± 243 | 2 571 (2 225–2 942) · moy. 2 570 ± 282 | 1 704 (1 378–2 005) · moy. 1 696 ± 237 | 1 629 (1 282–1 923) · moy. 1 619 ± 244 | 1 594 (1 274–1 907) · moy. 1 586 ± 239 |
| Niveaux de reliques S2 (/30) | 9 (7–12) · moy. 9 ± 2 | 8 (6–11) · moy. 8 ± 2 | 9 (7–12) · moy. 9 ± 2 | 8 (6–11) · moy. 8 ± 2 | 8 (6–10) · moy. 8 ± 2 | 8 (6–10) · moy. 8 ± 2 |
| Niveaux de reliques S4 (/30) | 21 (16–24) · moy. 20 ± 3 | 17 (13–20) · moy. 17 ± 2 | 21 (17–24) · moy. 21 ± 3 | 17 (14–20) · moy. 17 ± 2 | 16 (13–20) · moy. 16 ± 2 | 16 (13–19) · moy. 16 ± 2 |
| Niveaux de reliques S8 (/30) | 30 (30–30) · moy. 30 ± 0 | 30 (28–30) · moy. 29 ± 1 | 30 (30–30) · moy. 30 ± 0 | 30 (28–30) · moy. 29 ± 1 | 30 (27–30) · moy. 29 ± 1 | 29 (27–30) · moy. 29 ± 1 |
| Toutes reliques au max : saison (part ≤ S8) | 7,0 (6,0–7,0) · moy. 6,6 ± 0,7 (100 %) | 8,0 (7,0–8,0) · moy. 7,8 ± 0,4 (56 %) | 7,0 (6,0–7,0) · moy. 6,5 ± 0,6 (100 %) | 8,0 (7,0–8,0) · moy. 7,8 ± 0,4 (63 %) | 8,0 (7,0–8,0) · moy. 7,9 ± 0,3 (52 %) | 8,0 (7,0–8,0) · moy. 7,9 ± 0,3 (45 %) |
| Améliorations en pièces au max S1 (h ; part) | — (0 %) | — (0 %) | — (0 %) | — (0 %) | — (0 %) | — (0 %) |
| 💰 / heure S1 | 989 959 (638 299–1 582 104) · moy. 1 066 770 ± 388 344 | 982 425 (627 322–1 572 553) · moy. 1 057 828 ± 388 195 | 1 070 474 (693 107–1 696 689) · moy. 1 137 917 ± 410 273 | 1 058 392 (685 747–1 686 587) · moy. 1 129 449 ± 410 474 | 984 105 (644 466–1 535 217) · moy. 1 040 101 ± 362 228 | 965 623 (627 890–1 471 056) · moy. 1 010 577 ± 346 104 |
| 💰 non dépensables fin S1 | 760 (187–8 861) · moy. 3 053 ± 3 507 | 3 891 (318–10 089) · moy. 4 432 ± 3 813 | 754 (176–8 200) · moy. 2 848 ± 3 421 | 3 844 (242–9 725) · moy. 4 420 ± 4 782 | 3 050 (243–9 451) · moy. 4 086 ± 4 731 | 3 374 (244–9 809) · moy. 4 138 ± 3 812 |
| 💰 non dépensables fin S8 | 34 091 816 (26 284 742–43 918 389) · moy. 34 619 707 ± 6 862 279 | 29 345 148 (19 245 803–41 033 863) · moy. 29 819 678 ± 8 445 015 | 35 148 951 (26 247 623–45 344 926) · moy. 35 495 936 ± 7 233 376 | 30 547 355 (20 426 732–42 008 960) · moy. 30 836 385 ± 8 330 899 | 20 419 065 (12 361 338–28 056 047) · moy. 20 379 744 ± 6 168 566 | 16 874 587 (10 352 241–23 540 522) · moy. 16 989 871 ± 5 213 797 |
| Coffres de la boutique S1 | 48 (21–50) · moy. 40 ± 13 | 22 (8–26) · moy. 20 ± 7 | 47 (19–50) · moy. 39 ± 14 | 22 (8–26) · moy. 20 ± 7 | 22 (7–25) · moy. 19 ± 7 | 22 (7–25) · moy. 19 ± 7 |
| Limite 20/10 atteinte S1 · S8 | 0 % · 0 % | 68 % · 100 % | 0 % · 0 % | 66 % · 100 % | 62 % · 100 % | 63 % · 100 % |
| Bloqués par une limite S1 · S8 | 0 % · 0 % | 67 % · 100 % | 0 % · 0 % | 66 % · 100 % | 60 % · 100 % | 61 % · 100 % |

##### Régulier (1 h/j, 7 j/7, bonus pub)

| Mesure | Actuel | Actuel + limites 20/10 | A seul | A + limites 20/10 | A + limites + courbe (b) | A + limites + courbe (c) |
|---|---|---|---|---|---|---|
| Profondeur S1 (m) | 1 346 (1 243–1 447) · moy. 1 343 ± 76 | 1 075 (1 032–1 114) · moy. 1 073 ± 33 | 1 359 (1 250–1 455) · moy. 1 354 ± 75 | 1 083 (1 039–1 120) · moy. 1 080 ± 32 | 1 070 (1 028–1 110) · moy. 1 070 ± 33 | 1 067 (1 029–1 108) · moy. 1 067 ± 32 |
| Profondeur S2 (m) | 1 759 (1 723–1 797) · moy. 1 760 ± 28 | 1 276 (1 224–1 324) · moy. 1 276 ± 40 | 1 763 (1 726–1 799) · moy. 1 762 ± 28 | 1 284 (1 231–1 332) · moy. 1 282 ± 40 | 1 280 (1 224–1 325) · moy. 1 277 ± 41 | 1 278 (1 225–1 327) · moy. 1 277 ± 41 |
| Profondeur S4 (m) | 1 779 (1 747–1 810) · moy. 1 779 ± 24 | 1 661 (1 548–1 759) · moy. 1 656 ± 79 | 1 779 (1 745–1 810) · moy. 1 778 ± 25 | 1 663 (1 549–1 757) · moy. 1 655 ± 80 | 1 657 (1 548–1 752) · moy. 1 652 ± 79 | 1 662 (1 543–1 752) · moy. 1 652 ± 81 |
| Profondeur S8 (m) | 1 778 (1 748–1 811) · moy. 1 779 ± 25 | 1 781 (1 747–1 813) · moy. 1 780 ± 25 | 1 778 (1 747–1 811) · moy. 1 778 ± 25 | 1 778 (1 746–1 811) · moy. 1 778 ± 25 | 1 779 (1 746–1 810) · moy. 1 778 ± 26 | 1 778 (1 746–1 809) · moy. 1 778 ± 25 |
| 💎 gagnées S1 | 95,0 (80,0–109,0) · moy. 95,3 ± 11,5 | 71,0 (61,0–82,0) · moy. 71,3 ± 8,1 | 213,0 (175,0–249,0) · moy. 212,4 ± 27,4 | 146,0 (125,0–166,0) · moy. 145,5 ± 16,6 | 142,0 (122,0–164,1) · moy. 143,3 ± 16,7 | 142,0 (122,0–165,0) · moy. 143,0 ± 16,7 |
| 💎 / heure S1 | 6,79 (5,71–7,79) · moy. 6,81 ± 0,82 | 5,07 (4,36–5,86) · moy. 5,09 ± 0,58 | 15,21 (12,50–17,79) · moy. 15,17 ± 1,96 | 10,43 (8,93–11,86) · moy. 10,39 ± 1,18 | 10,14 (8,71–11,72) · moy. 10,24 ± 1,19 | 10,14 (8,71–11,79) · moy. 10,21 ± 1,19 |
| 💎 perdues au plafond S8 (moy.) | 72,2 | 73,0 | 256,4 | 257,5 | 257,8 | 257,1 |
| 🔮 / saison S1 | 1 248 (982–1 531) · moy. 1 251 ± 212 | 213 (149–278) · moy. 214 ± 50 | 1 270 (1 007–1 546) · moy. 1 265 ± 206 | 215 (149–280) · moy. 216 ± 50 | 210 (143–276) · moy. 209 ± 50 | 211 (144–272) · moy. 210 ± 49 |
| 🔮 / heure S1 | 89,11 (70,11–109,36) · moy. 89,36 ± 15,17 | 15,21 (10,64–19,86) · moy. 15,27 ± 3,57 | 90,68 (71,91–110,44) · moy. 90,32 ± 14,71 | 15,36 (10,64–20,01) · moy. 15,40 ± 3,54 | 14,96 (10,21–19,71) · moy. 14,96 ± 3,59 | 15,07 (10,29–19,43) · moy. 15,03 ± 3,52 |
| 🔮 / saison S8 | 1 869 (1 799–1 945) · moy. 1 869 ± 56 | 664 (575–753) · moy. 664 ± 69 | 1 867 (1 799–1 939) · moy. 1 868 ± 56 | 658 (568–752) · moy. 659 ± 72 | 660 (577–746) · moy. 661 ± 68 | 660 (576–750) · moy. 663 ± 68 |
| 🔮 cumulés après 8 saisons | 14 305 (13 944–14 672) · moy. 14 308 ± 278 | 4 276 (3 990–4 585) · moy. 4 290 ± 236 | 14 315 (13 987–14 658) · moy. 14 316 ± 263 | 4 287 (3 978–4 601) · moy. 4 288 ± 239 | 4 260 (3 981–4 571) · moy. 4 270 ± 234 | 4 279 (3 965–4 570) · moy. 4 275 ± 235 |
| Niveaux de reliques S2 (/30) | 30 (30–30) · moy. 30 ± 0 | 19 (17–20) · moy. 19 ± 2 | 30 (30–30) · moy. 30 ± 0 | 19 (17–21) · moy. 19 ± 2 | 18 (16–20) · moy. 18 ± 2 | 19 (17–20) · moy. 18 ± 1 |
| Niveaux de reliques S4 (/30) | 30 (30–30) · moy. 30 ± 0 | 30 (28–30) · moy. 29 ± 1 | 30 (30–30) · moy. 30 ± 0 | 30 (28–30) · moy. 29 ± 1 | 30 (28–30) · moy. 29 ± 1 | 30 (28–30) · moy. 29 ± 1 |
| Niveaux de reliques S8 (/30) | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 |
| Toutes reliques au max : saison (part ≤ S8) | 2,0 (2,0–2,0) · moy. 2,0 ± 0,2 (100 %) | 4,0 (4,0–5,0) · moy. 4,5 ± 0,5 (100 %) | 2,0 (2,0–2,0) · moy. 2,0 ± 0,2 (100 %) | 4,0 (4,0–5,0) · moy. 4,5 ± 0,5 (100 %) | 4,0 (4,0–5,0) · moy. 4,5 ± 0,5 (100 %) | 4,0 (4,0–5,0) · moy. 4,5 ± 0,5 (100 %) |
| Améliorations en pièces au max S1 (h ; part) | 3,3 (2,4–4,1) · moy. 3,3 ± 0,6 (100 %) | 3,3 (2,4–4,1) · moy. 3,3 ± 0,6 (100 %) | 3,2 (2,4–4,1) · moy. 3,2 ± 0,6 (100 %) | 3,2 (2,4–4,1) · moy. 3,2 ± 0,6 (100 %) | 4,0 (3,0–4,5) · moy. 3,8 ± 0,7 (100 %) | 4,1 (3,1–5,1) · moy. 4,1 ± 0,8 (100 %) |
| 💰 / heure S1 | 14 745 773 (10 937 058–18 943 368) · moy. 14 872 835 ± 3 095 288 | 4 651 815 (3 704 452–5 684 451) · moy. 4 689 062 ± 768 894 | 15 143 352 (11 307 069–19 393 239) · moy. 15 197 263 ± 3 115 341 | 4 768 812 (3 820 358–5 768 050) · moy. 4 797 456 ± 775 993 | 2 755 658 (2 239 428–3 346 662) · moy. 2 781 915 ± 437 818 | 2 138 424 (1 774 522–2 581 025) · moy. 2 157 491 ± 320 721 |
| 💰 non dépensables fin S1 | 196 628 348 (143 503 312–255 394 687) · moy. 198 488 919 ± 43 268 093 | 59 571 941 (46 308 852–74 028 851) · moy. 60 093 404 ± 10 764 514 | 202 317 379 (148 486 499–261 692 870) · moy. 203 022 789 ± 43 551 190 | 61 209 902 (47 931 545–75 199 229) · moy. 61 610 913 ± 10 863 905 | 33 025 737 (25 798 527–41 299 801) · moy. 33 393 344 ± 6 129 459 | 24 384 460 (19 289 841–30 580 883) · moy. 24 651 410 ± 4 490 098 |
| 💰 non dépensables fin S8 | 426 548 377 (374 738 410–490 732 193) · moy. 429 387 150 ± 45 237 728 | 434 363 719 (383 006 718–495 869 393) · moy. 437 480 966 ± 44 019 362 | 427 420 429 (376 914 970–484 174 922) · moy. 428 867 542 ± 41 979 093 | 432 168 154 (379 569 535–492 987 966) · moy. 434 837 620 ± 45 138 804 | 234 790 673 (208 892 447–265 713 018) · moy. 235 880 877 ± 21 939 780 | 168 743 514 (149 943 101–188 319 138) · moy. 169 356 777 ± 14 970 221 |
| Coffres de la boutique S1 | 300 (300–300) · moy. 300 ± 0 | 35 (35–35) · moy. 35 ± 0 | 300 (300–300) · moy. 300 ± 0 | 35 (35–35) · moy. 35 ± 0 | 35 (35–35) · moy. 35 ± 0 | 35 (35–35) · moy. 35 ± 0 |
| Limite 20/10 atteinte S1 · S8 | 0 % · 0 % | 100 % · 100 % | 0 % · 0 % | 100 % · 100 % | 100 % · 100 % | 100 % · 100 % |
| Bloqués par une limite S1 · S8 | 0 % · 0 % | 100 % · 100 % | 0 % · 0 % | 100 % · 100 % | 100 % · 100 % | 100 % · 100 % |

##### Assidu (3 h/j + 4 h onglet ouvert)

| Mesure | Actuel | Actuel + limites 20/10 | A seul | A + limites 20/10 | A + limites + courbe (b) | A + limites + courbe (c) |
|---|---|---|---|---|---|---|
| Profondeur S1 (m) | 3 207 (3 161–3 253) · moy. 3 207 ± 36 | 2 196 (2 131–2 274) · moy. 2 199 ± 56 | 3 210 (3 169–3 256) · moy. 3 211 ± 34 | 2 196 (2 132–2 272) · moy. 2 199 ± 55 | 2 194 (2 126–2 268) · moy. 2 196 ± 57 | 2 195 (2 126–2 273) · moy. 2 196 ± 58 |
| Profondeur S2 (m) | 3 384 (3 339–3 430) · moy. 3 384 ± 35 | 2 684 (2 590–2 789) · moy. 2 686 ± 79 | 3 383 (3 340–3 429) · moy. 3 384 ± 35 | 2 681 (2 591–2 793) · moy. 2 684 ± 79 | 2 678 (2 589–2 777) · moy. 2 681 ± 76 | 2 678 (2 587–2 781) · moy. 2 680 ± 77 |
| Profondeur S4 (m) | 3 383 (3 340–3 430) · moy. 3 384 ± 35 | 3 385 (3 338–3 428) · moy. 3 383 ± 35 | 3 386 (3 339–3 428) · moy. 3 384 ± 35 | 3 383 (3 335–3 429) · moy. 3 383 ± 36 | 3 383 (3 338–3 429) · moy. 3 383 ± 35 | 3 384 (3 340–3 428) · moy. 3 384 ± 35 |
| Profondeur S8 (m) | 3 383 (3 336–3 427) · moy. 3 382 ± 35 | 3 382 (3 337–3 432) · moy. 3 383 ± 37 | 3 382 (3 341–3 430) · moy. 3 383 ± 35 | 3 384 (3 341–3 429) · moy. 3 384 ± 34 | 3 385 (3 340–3 428) · moy. 3 384 ± 35 | 3 385 (3 339–3 428) · moy. 3 384 ± 35 |
| 💎 gagnées S1 | 224,0 (206,0–243,1) · moy. 224,7 ± 14,8 | 136,0 (122,0–152,0) · moy. 136,1 ± 11,6 | 574,0 (533,9–615,0) · moy. 574,0 ± 31,5 | 324,0 (292,0–358,1) · moy. 324,8 ± 26,1 | 323,0 (293,0–356,0) · moy. 323,9 ± 25,5 | 323,0 (292,0–357,0) · moy. 324,2 ± 26,0 |
| 💎 / heure S1 | 4,57 (4,20–4,96) · moy. 4,59 ± 0,30 | 2,78 (2,49–3,10) · moy. 2,78 ± 0,24 | 11,71 (10,90–12,55) · moy. 11,71 ± 0,64 | 6,61 (5,96–7,31) · moy. 6,63 ± 0,53 | 6,59 (5,98–7,27) · moy. 6,61 ± 0,52 | 6,59 (5,96–7,29) · moy. 6,62 ± 0,53 |
| 💎 perdues au plafond S8 (moy.) | 184,1 | 184,4 | 571,2 | 571,4 | 571,0 | 570,7 |
| 🔮 / saison S1 | 7 626 (7 035–8 095) · moy. 7 583 ± 408 | 363 (274–460) · moy. 365 ± 70 | 7 603 (6 955–8 060) · moy. 7 551 ± 426 | 358 (272–451) · moy. 359 ± 70 | 356 (267–448) · moy. 357 ± 71 | 357 (266–451) · moy. 358 ± 72 |
| 🔮 / heure S1 | 155,62 (143,57–165,21) · moy. 154,76 ± 8,33 | 7,41 (5,59–9,39) · moy. 7,45 ± 1,44 | 155,16 (141,93–164,49) · moy. 154,10 ± 8,70 | 7,31 (5,55–9,20) · moy. 7,33 ± 1,43 | 7,27 (5,45–9,14) · moy. 7,28 ± 1,45 | 7,29 (5,43–9,20) · moy. 7,30 ± 1,48 |
| 🔮 / saison S8 | 9 103 (9 002–9 203) · moy. 9 102 ± 76 | 1 094 (981–1 200) · moy. 1 092 ± 88 | 9 101 (9 004–9 201) · moy. 9 102 ± 77 | 1 087 (979–1 202) · moy. 1 090 ± 87 | 1 085 (973–1 204) · moy. 1 088 ± 89 | 1 091 (978–1 206) · moy. 1 090 ± 87 |
| 🔮 cumulés après 8 saisons | 71 347 (70 717–71 883) · moy. 71 305 ± 458 | 7 555 (7 192–7 913) · moy. 7 560 ± 280 | 71 303 (70 645–71 870) · moy. 71 281 ± 482 | 7 549 (7 188–7 903) · moy. 7 545 ± 282 | 7 526 (7 158–7 920) · moy. 7 533 ± 290 | 7 526 (7 171–7 931) · moy. 7 540 ± 286 |
| Niveaux de reliques S2 (/30) | 30 (30–30) · moy. 30 ± 0 | 25 (23–27) · moy. 25 ± 2 | 30 (30–30) · moy. 30 ± 0 | 25 (23–27) · moy. 25 ± 2 | 25 (23–27) · moy. 25 ± 2 | 25 (23–27) · moy. 25 ± 2 |
| Niveaux de reliques S4 (/30) | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 |
| Niveaux de reliques S8 (/30) | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 |
| Toutes reliques au max : saison (part ≤ S8) | 1,0 (1,0–1,0) · moy. 1,0 ± 0,0 (100 %) | 3,0 (3,0–3,0) · moy. 3,0 ± 0,1 (100 %) | 1,0 (1,0–1,0) · moy. 1,0 ± 0,0 (100 %) | 3,0 (3,0–3,0) · moy. 3,0 ± 0,1 (100 %) | 3,0 (3,0–3,0) · moy. 3,0 ± 0,1 (100 %) | 3,0 (3,0–3,0) · moy. 3,0 ± 0,1 (100 %) |
| Améliorations en pièces au max S1 (h ; part) | 2,8 (2,5–3,2) · moy. 2,8 ± 0,6 (100 %) | 2,8 (2,5–3,2) · moy. 2,8 ± 0,6 (100 %) | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 (100 %) | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 (100 %) | 3,1 (2,6–4,8) · moy. 3,4 ± 0,9 (100 %) | 3,2 (2,7–5,0) · moy. 3,7 ± 1,0 (100 %) |
| 💰 / heure S1 | 26 727 154 (24 573 672–29 204 209) · moy. 26 773 918 ± 1 813 324 | 6 667 687 (5 614 108–7 853 476) · moy. 6 711 994 ± 886 459 | 26 851 718 (24 536 156–29 409 192) · moy. 26 893 302 ± 1 925 327 | 6 627 282 (5 578 962–7 862 614) · moy. 6 683 961 ± 903 309 | 3 373 389 (2 851 685–3 953 628) · moy. 3 383 501 ± 425 252 | 2 289 470 (1 934 701–2 671 481) · moy. 2 298 160 ± 285 154 |
| 💰 non dépensables fin S1 | 1 277 318 068 (1 171 797 466–1 398 693 781) · moy. 1 279 610 932 ± 88 852 142 | 321 163 204 (269 537 837–379 266 857) · moy. 323 334 258 ± 43 436 476 | 1 283 421 710 (1 169 959 167–1 408 737 937) · moy. 1 285 460 950 ± 94 340 659 | 319 183 331 (267 815 649–379 714 602) · moy. 321 960 628 ± 44 262 121 | 159 742 576 (134 179 109–188 174 304) · moy. 160 238 076 ± 20 837 337 | 106 630 552 (89 246 872–125 349 105) · moy. 107 056 374 ± 13 972 554 |
| 💰 non dépensables fin S8 | 1 468 270 795 (1 345 143 432–1 593 699 332) · moy. 1 470 616 383 ± 97 329 529 | 1 492 168 419 (1 375 386 138–1 633 209 357) · moy. 1 498 606 358 ± 101 083 329 | 1 467 683 369 (1 340 902 949–1 607 879 875) · moy. 1 472 597 929 ± 104 482 506 | 1 496 170 485 (1 374 488 151–1 632 518 522) · moy. 1 499 403 700 ± 99 866 523 | 721 270 857 (664 987 114–782 234 857) · moy. 722 752 354 ± 46 787 711 | 464 468 771 (428 348 008–499 951 042) · moy. 464 592 741 ± 28 831 287 |
| Coffres de la boutique S1 | 1 800 (1 800–1 800) · moy. 1 800 ± 0 | 35 (35–35) · moy. 35 ± 0 | 1 800 (1 800–1 800) · moy. 1 800 ± 0 | 35 (35–35) · moy. 35 ± 0 | 35 (35–35) · moy. 35 ± 0 | 35 (35–35) · moy. 35 ± 0 |
| Limite 20/10 atteinte S1 · S8 | 0 % · 0 % | 100 % · 100 % | 0 % · 0 % | 100 % · 100 % | 100 % · 100 % | 100 % · 100 % |
| Bloqués par une limite S1 · S8 | 0 % · 0 % | 100 % · 100 % | 0 % · 0 % | 100 % · 100 % | 100 % · 100 % | 100 % · 100 % |

##### Automatique (15 min/j + 8 h onglet)

| Mesure | Actuel | Actuel + limites 20/10 | A seul | A + limites 20/10 | A + limites + courbe (b) | A + limites + courbe (c) |
|---|---|---|---|---|---|---|
| Profondeur S1 (m) | 861 (782–947) · moy. 864 ± 66 | 716 (681–760) · moy. 718 ± 31 | 918 (844–997) · moy. 919 ± 63 | 753 (712–801) · moy. 755 ± 34 | 746 (707–786) · moy. 746 ± 32 | 741 (702–781) · moy. 742 ± 31 |
| Profondeur S2 (m) | 1 606 (1 564–1 649) · moy. 1 606 ± 33 | 948 (886–1 010) · moy. 948 ± 48 | 1 612 (1 569–1 655) · moy. 1 612 ± 33 | 973 (911–1 033) · moy. 972 ± 45 | 969 (910–1 029) · moy. 969 ± 44 | 965 (907–1 030) · moy. 965 ± 45 |
| Profondeur S4 (m) | 1 633 (1 592–1 679) · moy. 1 633 ± 33 | 1 288 (1 188–1 381) · moy. 1 287 ± 79 | 1 631 (1 589–1 672) · moy. 1 631 ± 32 | 1 304 (1 210–1 398) · moy. 1 305 ± 78 | 1 298 (1 212–1 401) · moy. 1 301 ± 75 | 1 297 (1 204–1 391) · moy. 1 299 ± 76 |
| Profondeur S8 (m) | 1 633 (1 592–1 675) · moy. 1 634 ± 32 | 1 633 (1 590–1 676) · moy. 1 633 ± 33 | 1 633 (1 590–1 676) · moy. 1 633 ± 34 | 1 634 (1 592–1 674) · moy. 1 633 ± 32 | 1 633 (1 591–1 675) · moy. 1 633 ± 32 | 1 633 (1 592–1 675) · moy. 1 633 ± 31 |
| 💎 gagnées S1 | 62,0 (49,0–76,0) · moy. 62,5 ± 10,5 | 51,0 (42,0–60,0) · moy. 50,9 ± 7,3 | 128,5 (103,9–159,0) · moy. 130,2 ± 21,7 | 94,0 (78,0–114,1) · moy. 95,2 ± 14,1 | 93,0 (76,0–112,0) · moy. 93,4 ± 14,2 | 93,0 (76,0–111,0) · moy. 93,0 ± 13,8 |
| 💎 / heure S1 | 1,07 (0,85–1,32) · moy. 1,08 ± 0,18 | 0,88 (0,73–1,04) · moy. 0,88 ± 0,13 | 2,23 (1,80–2,75) · moy. 2,25 ± 0,38 | 1,63 (1,35–1,98) · moy. 1,65 ± 0,24 | 1,61 (1,32–1,94) · moy. 1,62 ± 0,25 | 1,61 (1,32–1,92) · moy. 1,61 ± 0,24 |
| 💎 perdues au plafond S8 (moy.) | 62,2 | 62,3 | 228,6 | 228,7 | 228,8 | 229,3 |
| 🔮 / saison S1 | 1 238 (1 067–1 407) · moy. 1 238 ± 134 | 167 (115–228) · moy. 169 ± 44 | 1 256 (1 074–1 421) · moy. 1 251 ± 136 | 176 (116–238) · moy. 176 ± 45 | 172 (117–231) · moy. 173 ± 44 | 171 (114–231) · moy. 171 ± 45 |
| 🔮 / heure S1 | 21,44 (18,47–24,36) · moy. 21,44 ± 2,31 | 2,89 (1,99–3,95) · moy. 2,93 ± 0,76 | 21,75 (18,60–24,61) · moy. 21,66 ± 2,36 | 3,05 (2,01–4,12) · moy. 3,05 ± 0,79 | 2,98 (2,02–4,00) · moy. 3,00 ± 0,77 | 2,95 (1,97–4,00) · moy. 2,96 ± 0,77 |
| 🔮 / saison S8 | 1 823 (1 765–1 890) · moy. 1 825 ± 50 | 623 (541–709) · moy. 623 ± 67 | 1 827 (1 765–1 896) · moy. 1 828 ± 52 | 623 (539–706) · moy. 625 ± 65 | 619 (538–703) · moy. 621 ± 65 | 624 (538–712) · moy. 624 ± 67 |
| 🔮 cumulés après 8 saisons | 14 036 (13 782–14 296) · moy. 14 041 ± 203 | 3 769 (3 440–4 038) · moy. 3 756 ± 233 | 14 056 (13 801–14 316) · moy. 14 055 ± 196 | 3 795 (3 489–4 085) · moy. 3 790 ± 238 | 3 789 (3 494–4 063) · moy. 3 782 ± 231 | 3 782 (3 466–4 091) · moy. 3 780 ± 235 |
| Niveaux de reliques S2 (/30) | 30 (30–30) · moy. 30 ± 0 | 17 (14–18) · moy. 16 ± 2 | 30 (30–30) · moy. 30 ± 0 | 17 (15–19) · moy. 17 ± 2 | 17 (15–18) · moy. 17 ± 2 | 17 (15–18) · moy. 17 ± 2 |
| Niveaux de reliques S4 (/30) | 30 (30–30) · moy. 30 ± 0 | 27 (25–29) · moy. 27 ± 1 | 30 (30–30) · moy. 30 ± 0 | 27 (26–29) · moy. 27 ± 1 | 27 (25–29) · moy. 27 ± 1 | 27 (25–29) · moy. 27 ± 1 |
| Niveaux de reliques S8 (/30) | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 | 30 (30–30) · moy. 30 ± 0 |
| Toutes reliques au max : saison (part ≤ S8) | 2,0 (2,0–2,0) · moy. 2,0 ± 0,0 (100 %) | 5,0 (5,0–6,0) · moy. 5,1 ± 0,4 (100 %) | 2,0 (2,0–2,0) · moy. 2,0 ± 0,0 (100 %) | 5,0 (5,0–5,0) · moy. 5,0 ± 0,4 (100 %) | 5,0 (5,0–5,0) · moy. 5,0 ± 0,3 (100 %) | 5,0 (5,0–5,0) · moy. 5,1 ± 0,4 (100 %) |
| Améliorations en pièces au max S1 (h ; part) | 33,0 (27,6–38,5) · moy. 32,9 ± 3,9 (100 %) | 33,0 (27,6–38,5) · moy. 32,9 ± 3,9 (100 %) | 30,3 (26,4–35,8) · moy. 30,7 ± 3,6 (100 %) | 30,3 (26,4–35,8) · moy. 30,7 ± 3,6 (100 %) | 35,1 (30,3–39,4) · moy. 34,7 ± 3,8 (100 %) | 35,9 (32,3–41,3) · moy. 36,7 ± 3,8 (100 %) |
| 💰 / heure S1 | 751 564 (486 476–1 069 532) · moy. 763 348 ± 231 635 | 287 143 (223 300–364 477) · moy. 290 802 ± 54 899 | 904 488 (636 626–1 240 808) · moy. 923 727 ± 235 154 | 332 373 (258 140–417 840) · moy. 336 574 ± 62 910 | 226 783 (180 338–277 557) · moy. 228 892 ± 38 827 | 193 276 (157 487–232 830) · moy. 194 863 ± 30 457 |
| 💰 non dépensables fin S1 | 33 590 359 (18 281 491–51 953 010) · moy. 34 273 228 ± 13 376 316 | 11 029 021 (7 342 096–15 495 089) · moy. 11 240 323 ± 3 170 393 | 42 451 961 (26 952 681–61 844 187) · moy. 43 535 420 ± 13 579 099 | 13 641 095 (9 354 120–18 576 812) · moy. 13 883 674 ± 3 633 046 | 7 543 253 (4 861 030–10 475 475) · moy. 7 665 044 ± 2 242 276 | 5 608 193 (3 541 409–7 892 475) · moy. 5 699 854 ± 1 758 898 |
| 💰 non dépensables fin S8 | 234 137 326 (207 075 760–260 877 175) · moy. 234 122 773 ± 21 398 755 | 234 927 422 (209 578 752–262 758 504) · moy. 235 943 210 ± 21 178 531 | 232 678 994 (205 312 950–262 560 726) · moy. 233 368 034 ± 21 984 709 | 235 503 940 (210 298 878–262 537 495) · moy. 236 170 422 ± 20 999 043 | 134 941 114 (121 726 370–149 538 393) · moy. 135 336 926 ± 10 850 007 | 101 775 687 (93 181 155–112 135 147) · moy. 102 418 203 ± 7 364 583 |
| Coffres de la boutique S1 | 300 (300–300) · moy. 300 ± 0 | 35 (35–35) · moy. 35 ± 0 | 300 (300–300) · moy. 300 ± 0 | 35 (35–35) · moy. 35 ± 0 | 35 (35–35) · moy. 35 ± 0 | 35 (35–35) · moy. 35 ± 0 |
| Limite 20/10 atteinte S1 · S8 | 0 % · 0 % | 100 % · 100 % | 0 % · 0 % | 100 % · 100 % | 100 % · 100 % | 100 % · 100 % |
| Bloqués par une limite S1 · S8 | 0 % · 0 % | 100 % · 100 % | 0 % · 0 % | 100 % · 100 % | 100 % · 100 % | 100 % · 100 % |

##### Résumé (médianes) — peu actifs vs assidus

| Profil | Combinaison | Prof. S1 / S2 / S4 / S8 | 💎 / h S1 | 🔮 S1 | Reliques au max | Améliorations max (h) | 💰 inutilisées S1 |
|---|---|---|---|---|---|---|---|
| Débutant | Actuel | 309 / 362 / 480 / 662 | 13,50 | 47 | S7 (100 %) | — | 760 |
| Débutant | Actuel + limites 20/10 | 309 / 358 / 449 / 638 | 13,50 | 36 | S8 (56 %) | — | 3 891 |
| Débutant | A seul | 311 / 366 / 488 / 666 | 21,00 | 51 | S7 (100 %) | — | 754 |
| Débutant | A + limites 20/10 | 311 / 361 / 457 / 645 | 21,00 | 39 | S8 (63 %) | — | 3 844 |
| Débutant | A + limites + courbe (b) | 311 / 360 / 447 / 636 | 21,00 | 38 | S8 (52 %) | — | 3 050 |
| Débutant | A + limites + courbe (c) | 310 / 359 / 444 / 627 | 21,00 | 37 | S8 (45 %) | — | 3 374 |
| Régulier | Actuel | 1 346 / 1 759 / 1 779 / 1 778 | 6,79 | 1 248 | S2 (100 %) | 3,3 | 196 628 348 |
| Régulier | Actuel + limites 20/10 | 1 075 / 1 276 / 1 661 / 1 781 | 5,07 | 213 | S4 (100 %) | 3,3 | 59 571 941 |
| Régulier | A seul | 1 359 / 1 763 / 1 779 / 1 778 | 15,21 | 1 270 | S2 (100 %) | 3,2 | 202 317 379 |
| Régulier | A + limites 20/10 | 1 083 / 1 284 / 1 663 / 1 778 | 10,43 | 215 | S4 (100 %) | 3,2 | 61 209 902 |
| Régulier | A + limites + courbe (b) | 1 070 / 1 280 / 1 657 / 1 779 | 10,14 | 210 | S4 (100 %) | 4,0 | 33 025 737 |
| Régulier | A + limites + courbe (c) | 1 067 / 1 278 / 1 662 / 1 778 | 10,14 | 211 | S4 (100 %) | 4,1 | 24 384 460 |
| Assidu | Actuel | 3 207 / 3 384 / 3 383 / 3 383 | 4,57 | 7 626 | S1 (100 %) | 2,8 | 1 277 318 068 |
| Assidu | Actuel + limites 20/10 | 2 196 / 2 684 / 3 385 / 3 382 | 2,78 | 363 | S3 (100 %) | 2,8 | 321 163 204 |
| Assidu | A seul | 3 210 / 3 383 / 3 386 / 3 382 | 11,71 | 7 603 | S1 (100 %) | 2,8 | 1 283 421 710 |
| Assidu | A + limites 20/10 | 2 196 / 2 681 / 3 383 / 3 384 | 6,61 | 358 | S3 (100 %) | 2,8 | 319 183 331 |
| Assidu | A + limites + courbe (b) | 2 194 / 2 678 / 3 383 / 3 385 | 6,59 | 356 | S3 (100 %) | 3,1 | 159 742 576 |
| Assidu | A + limites + courbe (c) | 2 195 / 2 678 / 3 384 / 3 385 | 6,59 | 357 | S3 (100 %) | 3,2 | 106 630 552 |
| Automatique | Actuel | 861 / 1 606 / 1 633 / 1 633 | 1,07 | 1 238 | S2 (100 %) | 33,0 | 33 590 359 |
| Automatique | Actuel + limites 20/10 | 716 / 948 / 1 288 / 1 633 | 0,88 | 167 | S5 (100 %) | 33,0 | 11 029 021 |
| Automatique | A seul | 918 / 1 612 / 1 631 / 1 633 | 2,23 | 1 256 | S2 (100 %) | 30,3 | 42 451 961 |
| Automatique | A + limites 20/10 | 753 / 973 / 1 304 / 1 634 | 1,63 | 176 | S5 (100 %) | 30,3 | 13 641 095 |
| Automatique | A + limites + courbe (b) | 746 / 969 / 1 298 / 1 633 | 1,61 | 172 | S5 (100 %) | 35,1 | 7 543 253 |
| Automatique | A + limites + courbe (c) | 741 / 965 / 1 297 / 1 633 | 1,61 | 171 | S5 (100 %) | 35,9 | 5 608 193 |

#### Effet du Cœur d'or selon la courbe — profondeur en saison 4, 1 000 joueurs (A + limites 20/10)

Sans Cœur d'or = relique jamais achetée (fragments placés dans les autres reliques).

| Profil | Courbe | Avec | Sans Cœur d'or | Écart |
|---|---|---|---|---|
| Débutant | actuelle | 457 m | 457 m | +0,0 % |
| Débutant | b | 447 m | 447 m | +0,0 % |
| Débutant | c | 444 m | 445 m | +0,2 % |
| Régulier | actuelle | 1 663 m | 1 758 m | +5,7 % |
| Régulier | b | 1 657 m | 1 758 m | +6,1 % |
| Régulier | c | 1 662 m | 1 759 m | +5,8 % |
| Assidu | actuelle | 3 383 m | 3 382 m | -0,0 % |
| Assidu | b | 3 383 m | 3 382 m | -0,0 % |
| Assidu | c | 3 384 m | 3 382 m | -0,1 % |
| Automatique | actuelle | 1 304 m | 1 486 m | +14,0 % |
| Automatique | b | 1 298 m | 1 481 m | +14,1 % |
| Automatique | c | 1 297 m | 1 474 m | +13,6 % |


</details>

---

## Session du 03/11/2026 (DIGORCH) — audit chiffré, simulations, deux barèmes proposés

### 1. État réel

**Audit livré, intégré dans `develop`, non déployé (aucun changement du jeu à déployer). En attente
de l'arbitrage du propriétaire.** Conformément au ticket et à la décision du 02/11, **aucun taux,
prix, solde ni effet n'a été modifié**, ni dans le code du jeu ni dans les réglages de production.
Le livrable est : ce rapport, un simulateur reproductible (`tools/balance/economy-sim.js`) et ses
tests automatisés (`test/economy-sim.test.js`).

Classement : **Après lancement** pour le MVP public (l'économie actuelle fonctionne et ne perd
aucune donnée). En revanche, la recommandation R1 (solde de gemmes tenu par le serveur) est
**bloquante pour l'ouverture d'une boutique en gemmes**, et R3 (fragments quasi illimités) pèse
sur l'équité du classement dès qu'il y aura plusieurs joueurs assidus.

### 2. Réponse courte au constat du 02/11 (2 gemmes, 5 fragments, 37 735 pièces vers 122 m)

- **Ce n'est pas un problème de rareté, c'est un problème de puits.** À 122 m avec l'équipement de
  la capture (pioche 8, Œil du mineur 2, Chance 5, Sac 6, Auto-Dig 4, 4 clics/s), le jeu donne
  **≈ 8,7 💎/h** (médiane 9, p10–p90 5–13) et **≈ 8,6 🔮/h** : à peu près autant de gemmes que de
  fragments. La sauvegarde de production (seul compte) le confirme : **14 gemmes trouvées**, dont
  **12 dépensées** en Auto-Dig 3 et 4 (4 + 8). Il en reste 2.
- **Les gemmes n'ont qu'un seul usage : Auto-Dig 3 → 6 (65 💎), remis à zéro chaque lundi.** Les
  articles « gemmes », « skins » et « boost » de la boutique sont des achats en euros désactivés
  (#11, « Bientôt »). Une fois l'Auto-Dig 6 atteint (≈ 12 h de jeu pour un joueur régulier),
  les gemmes ne servent plus à rien et sont écrêtées à 100 en fin de saison.
- **Les fragments, eux, sont permanents** et ont un débouché clair (6 reliques × 5 niveaux =
  1 617 🔮). Ils arrivent par paquets (1 à 3, + Aimant) : d'où l'impression qu'ils sont plus
  faciles à obtenir.
- Deux déséquilibres structurels plus graves sont apparus (détails en 4) : **inflation des pièces**
  (toutes les améliorations en pièces sont au maximum après ≈ 3 h de jeu) et **fragments quasi
  illimités** via le coffre simple de la boutique (achat illimité, 800 🪙 en production).

### 3. Inventaire réel — sources et puits (code de `develop` = production, réglages relevés le 03/11)

Réglages `admin_config` de production (lecture seule d'une copie) : `chest_cost_simple = 800`
(modifié le **02/11 à 20:38–20:39 UTC** : 2 000 → 500 → 800), `chest_cost_rare = 15000`,
`chest_cost_antique = 80000`, multiplicateurs pièces / améliorations / fragments = 1, `gems_cap = 100`.
Catalogue de blocs publié : **v3** (14 blocs d'origine + 8 minerais de l'étape B, #37).

| Monnaie | Portée | Sources | Puits |
|---|---|---|---|
| 💰 Pièces | Saison (remises à 0 le lundi) | Blocs : `récompense × (1 + 0,05 × (prof. − 1)) × Sac (1 + 0,3/niv.) × Cœur d'or × coin_gain_multiplier × boost` ; coffres de la mine (80–1 200) ; hors ligne (Auto-Dig × multiplicateurs × 30/min, 4 h max) ; série quotidienne (50–600) ; missions ; objectifs ; pièces rendues par les coffres de la boutique | Pioche 1 946 450 ; Chance 520 050 ; Sac 622 170 ; Auto-Dig 1–2 : 3 800 ; boutique de fragments 1 895 000 (10/saison) ; relance de bloc 3 887 200 (99 max) ; coffres de la boutique (simple 800 et rare 15 000 **illimités**, antique 80 000 × 5) |
| 💎 Gemmes | Permanentes, **écrêtées à 100** en fin de saison | Rubis (≥ 35 m), émeraude (≥ 70 m), diamant (≥ 120 m) : **+1 chacun** ; saphir, améthyste, cristal ancien (étape B) : **0** (`gemReward: false`) ; série quotidienne 1 + 2 + 4 = **7/semaine** (7 jours d'affilée seulement) ; missions « Trouver des gemmes » (+1) et « Ouvrir 4–5 coffres » (+1) ; objectif « Première gemme » (+1, une fois) | **Auto-Dig 3/4/5/6 : 4 + 8 + 18 + 35 = 65**, à racheter chaque saison. Rien d'autre (boutique en euros désactivée). |
| 🔮 Fragments | Permanents | Coffres de la mine : vieille caisse 20 % × 1, bois 30 % × 1 + 10 % × 2, fer 25 % × 2 + 20 % × 3 (+ Aimant 1–5 par lot) ; boutique de fragments (1 par achat, 10/saison) ; coffres de la boutique (simple 30 % × 1 ; rare 4 / 7 ; antique 20 / 30 / 50 ; × `fragment_drop_multiplier` + Aimant ; objet déjà possédé → 5) | Reliques : 1 617 au total (Œil 129, Cœur 196, Aimant 222, Lentille 280, Griffe 350, Moteur 440). Au-delà : aucun usage. |
| 🏅 Points saisonniers (#33) | Portefeuille séparé | Classement de fin de saison | Boutique de cadeaux (#34). **Aucune conversion** avec gemmes ou pièces (vérifié : `server/shop.js` n'accepte que les points). |

Leviers liés : **Chance** (+10 % de poids par niveau pour rare/épique/légendaire, #32) → à 122 m,
gemmes 3,55 % des blocs à Chance 0, **5,01 % à Chance 5** (+41 %), coffres 7,1 % → 8,8 % ;
**boosts** (pièces seulement : coffres de la mine, série jour 6, coffres de la boutique, bouton
« bonus » ×2 2 min toutes les 5 min) ; **Auto-Dig** (1 coup/s ; s'arrête sur la fenêtre d'un coffre).

Où l'argent est tenu : les pièces, gemmes, missions, série et reliques sont calculées **dans le
navigateur** et enregistrées telles quelles par `POST /api/me/save` ; seuls l'achat des coffres
de la boutique (`server/chestShop.js`, transactionnel) et le plafond de fin de saison sont côtés
serveur. La profondeur du classement est, elle, validée par le budget de dégâts (#9, #25).

### 4. Simulations (vrai code du jeu, 10 000 saisons par profil et par barème)

Outil : `node tools/balance/economy-sim.js` (≈ 6 min ; `--runs 500` pour un aperçu en 20 s). Il
charge `balance.js`, `blocks.js`, `chests.js`, `relics.js`, `daily.js`, `dailyMissions.js`,
`quests.js`, le catalogue v3 (`server/blockCatalog.js`), les tables et la formule des coffres de la
boutique (`server/chestShop.js`, `server/economy.js`) et les réglages de production ci-dessus.
Hasard à graine : mêmes options → mêmes chiffres. Tables complètes en annexe.

Profils (saison de 7 jours, réinvestissement : l'amélioration la moins chère d'abord, Auto-Dig en
gemmes dès que possible, fragments → relique la moins chère) :

| Profil | Jeu actif | Onglet ouvert (Auto-Dig seul) | Jours | Autres |
|---|---|---|---|---|
| Débutant | 20 min/j, 4 clics/s | — | 4 / 7 (série brisée) | — |
| Régulier | 1 h/j, 5 clics/s | 1 h/j | 7 / 7 | bouton bonus |
| Assidu | 3 h/j, 6 clics/s | 4 h/j (passage /15 min) | 7 / 7 | bonus ; fin de saison : pièces → coffres (1 800 ouvertures = 1 h au maximum du limiteur) |
| Automatique | 15 min/j | 8 h/j (passage /20 min) | 7 / 7 | — |

**Résultats clés — barème actuel, saison 1** (médiane, p10–p90) :

| Profil | Heures | Profondeur | 💎 / saison | 💎 / h | 💎 dépensées | 🔮 / saison | Toutes améliorations en 💰 au max |
|---|---|---|---|---|---|---|---|
| Débutant | 1,3 | 310 m (291–330) | **18** (13–24) | 13,5 | 12 (Auto-Dig 4 au mieux) | 21 | non |
| Régulier | 14 | 994 m | **66** (56–75) | 4,7 | 65 (Auto-Dig 6 pour 56 %, vers 12 h) | 75 | après **3,2 h** |
| Assidu | 49 | 2 051 m | **124** (110–138) | 2,5 | 65 (Auto-Dig 6 vers 17,5 h) | **1 860** | après **2,8 h** |
| Automatique | 58 | 692 m | **49** (40–57) | 0,85 | 30 (Auto-Dig 5 ; 6 pour 1 %) | 49 | après 33 h |

Constats chiffrés :

1. **Les gemmes par heure baissent quand on progresse** (13,5/h pour un débutant, 2,5/h pour un
   assidu) : la part de blocs gemmes reste ≈ 3 % à toute profondeur, mais les blocs deviennent
   lents (PV × (1 + 0,12/m)), et les gemmes profondes de l'étape B ne rapportent rien
   (2,1 % des blocs à 900 m). Plus on joue, moins chaque heure rapporte de gemmes.
2. **Accumulation inutile** : sur 8 saisons, un joueur régulier perd en moyenne 72 💎 par saison
   au plafond dès la saison 8, un assidu ≈ 185 💎 par saison dès la saison 4 (aucun débouché).
3. **Inflation des pièces** : la récompense des blocs croît de 5 % par mètre sans limite, alors que
   les coûts sont fixes et bornés (≈ 5 M au total + 3,9 M de relances). Un joueur régulier gagne
   ≈ 47 M de pièces par saison et en laisse **42 M inutilisées** ; un assidu, 243 M. Les pièces ne
   pilotent la progression que pendant les ≈ 3 premières heures de chaque saison.
4. **Fragments quasi illimités** : le coffre simple (800 🪙, illimité) donne 0,3 🔮 et rend 613 🪙
   en moyenne → **625 🪙 nets par fragment, 104 🪙 avec l'Aimant 5** (au défaut de 2 000 🪙 :
   4 600). Avec des dizaines de millions de pièces inutiles, la limite n'est plus le prix mais le
   nombre d'ouvertures (limiteur : 30/min). Une heure d'ouvertures en fin de saison suffit pour
   **toutes les reliques au maximum dès la saison 1** (1 860 🔮), soit **+40 % de profondeur en
   saison 2** pour un assidu ; 300 ouvertures/saison donnent +16 % (S2) et **+34 % (S4)** à un
   joueur régulier. Le prix de 800 ou 2 000 ne change rien chez l'assidu (même résultat) : c'est
   l'**absence de limite** combinée à l'inflation qui pose problème. Un script au maximum du
   limiteur sur 24 h obtiendrait ≈ 39 000 🔮 par saison.
5. **Effet des avantages sur la profondeur (classement)**, saison 1 : sans l'Auto-Dig en gemmes,
   −1,9 % (débutant) à −3,5 % (assidu), mais **−19 % pour le profil automatique** ; « ramassage
   automatique des coffres » : +0,1 % (actif) à **+4,0 %** (automatique) ; boost ×2 pièces 30 min
   par jour : **+5,2 % pour un débutant**, +0,2 à +1,3 % ensuite (pièces déjà saturées).
6. Les reliques (permanentes) sont le vrai moteur à long terme : un assidu passe de 2 050 m (S1) à
   3 380 m (S4) à temps de jeu égal.

### 5. Barèmes proposés (AUCUN n'est appliqué)

Deux variantes cohérentes avec le modèle hybride validé le 02/11 (cosmétiques + confort +
progression mesurée, gemmes gagnées en jouant). Elles ne changent que les **sources** de gemmes,
le plafond et (B) le prix de l'Auto-Dig ; pièces, fragments et points saisonniers sont inchangés.

| Paramètre | Actuel | **A — mesurée (recommandée)** | B — généreuse |
|---|---|---|---|
| Gemmes par bloc : rubis / saphir / émeraude / améthyste / diamant / cristal | 1 / 0 / 1 / 0 / 1 / 0 | 1 / 1 / 2 / 2 / 3 / 3 | 2 / 2 / 3 / 3 / 5 / 5 |
| Gemmes dans les coffres de la mine | aucune | coffre en fer : 10 % → 1 💎 | caisse 2 % → 1, bois 6 % → 1, fer 15 % → 2 |
| Série quotidienne (jours 1 → 7) | 0,0,1,0,2,0,4 (7/sem.) | inchangée | 1,1,2,1,3,1,6 (15/sem.) |
| Bonus « 3 missions du jour réussies » | 0 | +1 💎 | +2 💎 |
| Plafond de fin de saison | 100 | 150 | 250 |
| Auto-Dig 3 / 4 / 5 / 6 | 4 / 8 / 18 / 35 (65) | inchangé | 6 / 14 / 30 / 60 (110) |

Résultats (saison 1, médianes) :

| Profil | 💎 / saison actuel → A → B | 💎 libres après Auto-Dig (fin de saison) actuel → A → B | Auto-Dig 6 atteint (h de jeu) actuel → A → B | Profondeur actuel → A → B |
|---|---|---|---|---|
| Débutant | 18 → 28 → 52 | 6 → 9 → 15 | jamais | 310 → 312 → 312 m |
| Régulier | 66 → 130 → 229 | 13 → 65 → 119 | 12,0 (56 %) → 6,0 → 5,3 | 994 → 1 001 → 1 001 m |
| Assidu | 124 → 293 → 515 | 59 → 228 → 405 | 17,5 → 5,6 → 5,3 | 2 051 → 2 057 → 2 056 m |
| Automatique | 49 → 89 → 158 | 18 → 24 → 48 | 55,6 (1 %) → 41,8 → 39,4 | 692 → 722 → 728 m |

Effet sur le classement : **+0,3 % à +4,3 %** de profondeur selon le profil (l'Auto-Dig 6 arrive
plus tôt). Les deux variantes doublent (A) ou triplent (B) le revenu en gemmes ; les gemmes
profondes redeviennent intéressantes à miner. **A est recommandée** : elle laisse ≈ 65 💎 libres
par semaine à un joueur régulier (un vrai budget pour la boutique) sans inonder les assidus ; B
n'a de sens que si la boutique propose beaucoup d'articles, et rend l'Auto-Dig plus cher.

**Première tranche de boutique en gemmes gagnées** (prix suggérés ; durée = « temps pour un
joueur régulier », gemmes libres après l'Auto-Dig). Rien n'est achetable aujourd'hui ; aucun
paiement réel ; ces articles ne seront activés qu'après décision.

| Rayon | Article | Durée | Effet sur la profondeur | Prix A | Prix B |
|---|---|---|---|---|---|
| Apparences | Pioche dorée (le style `skin-golden` existe déjà) | permanent | aucun | 150 💎 (≈ 2,5 sem.) | 250 💎 |
| Apparences | Pioche diamant (`skin-diamond` existe déjà) | permanent | aucun | 350 💎 (≈ 5 sem.) | 600 💎 |
| Apparences | Effet de destruction (particules) / cadre de pseudo au classement | permanent | aucun | 80–120 💎 | 150–200 💎 |
| Confort | Ramassage automatique des coffres de la mine (l'Auto-Dig ne s'arrête plus) | saison | +0,1 % (actif) à +4 % (onglet ouvert) | 30 💎 | 50 💎 |
| Confort | Gains hors ligne 4 h → 8 h | saison | aucun (pièces seulement) | 20 💎 | 35 💎 |
| Améliorations | Auto-Dig 3 → 6 (existant) | saison | −2 à −19 % sans | 65 💎 (inchangé) | 110 💎 |
| Améliorations | Boost ×2 pièces 30 min (2 par jour max) | temporaire | +5 % débutant, < +1,5 % ensuite | 8 💎 | 12 💎 |
| Améliorations | +1 coffre antique cette saison (2 max) | saison | faible (fragments) — à revoir après R3 | 40 💎 | 70 💎 |

Pas de pioche plus forte, de relique ni de bonus de profondeur permanent vendus en gemmes : ce
serait obligatoire pour le classement. Si un jour des gemmes sont vendues contre de l'argent, seuls
les rayons Apparences et Confort devraient être achetables avec des gemmes payantes.

### 6. Panel admin (#20, #37) — effectif ou non

| Réglage | Effectif ? | Remarque |
|---|---|---|
| `upgrade_cost_multiplier`, `coin_gain_multiplier` | oui (jeu, toutes les 5 min) | multiplicateurs globaux |
| `fragment_drop_multiplier` | oui, **coffres de la boutique seulement** | libellé admin exact ; les coffres de la mine l'ignorent |
| `chest_cost_*` | oui (serveur) | simple = 800 en production |
| `gems_cap` | oui (client + serveur) | |
| `season_duration` | non | déjà libellé « Inutilisé » |
| Catalogue de blocs (#37) | oui : brouillon, simulation, publication, versions, retour arrière, journal | `gemReward` par gemme ; **pas de quantité de gemmes par bloc** |
| Gemmes par bloc, coûts Auto-Dig, série quotidienne, missions, tables des coffres de la mine et de la boutique, reliques, limites des coffres | **non administrables** (codés en dur, côté client pour la plupart) | à rendre pilotables selon la variante retenue |

Proposition (après décision) : un onglet « Économie » sur le modèle de #37 — brouillon, aperçu
chiffré par `economy-sim` (gemmes/h par profil, temps d'accès à chaque article), publication avec
note, versions, retour arrière, journal d'audit ; valeurs publiées par le serveur (comme le
catalogue des coffres) pour ne plus rien recopier côté client.

### 7. Protection du gameplay

- **Classement** : seule la profondeur compte, validée par le budget de dégâts (#25). Les gemmes
  n'y pèsent qu'à travers l'Auto-Dig (chiffré ci-dessus). Les reliques pèsent beaucoup plus (R3).
- **R1 — solde de gemmes non tenu par le serveur** : le navigateur écrit le nombre de gemmes dans
  la sauvegarde ; un client modifié peut en écrire autant qu'il veut. Sans conséquence grave
  aujourd'hui (seul usage : Auto-Dig, borné par le budget de dégâts), mais **à corriger avant toute
  boutique en gemmes** : journal de gemmes côté serveur (comme `reward_point_ledger`), crédits des
  gemmes recalculés ou bornés par le serveur (blocs gemmes via `minedByType` borné par la profondeur,
  série et missions validées côté serveur), achats transactionnels et idempotents (modèle #34).
- Doubles crédits : achats de coffres transactionnels (#8), une seule session de jeu (#35), boosts
  qui s'additionnent sans se raccourcir (#47) — rien de nouveau trouvé.
- Pay-to-win : aucun paiement réel actif (#11). Le bouton « bonus » accorde son boost après une
  publicité **simulée** (5 s) — hors périmètre, relève de #45.
- Joueurs existants : aucune proposition ne retire de gemmes, fragments ou reliques déjà acquis.

### 8. SHA, branche et procédure de test

- Branche `feature/49-audit-economie` (commit `7680aee`) ; **SHA sur `develop` : `5ed7046`**
  (merge `--no-ff`, arbre identique à la branche testée).
- Fichiers : `tools/balance/economy-sim.js` (nouveau), `test/economy-sim.test.js` (nouveau), ce
  rapport. **Aucun fichier du jeu ni du serveur modifié.**
- Reproduire : `node tools/balance/economy-sim.js` (≈ 6 min, annexe identique) ou
  `node tools/balance/economy-sim.js --runs 500 --long-runs 100` (≈ 20 s, mêmes tendances) ;
  `node --test test/economy-sim.test.js` (5 tests : catalogue et gemmes réels, tirage rapide =
  `Blocks.spawn`, coffres = `rollChest`, reproductibilité et plafond, variantes sans effet sur le jeu).

### 9. Vérifications, limites, données des joueurs

- Réglages et statistiques lus sur une **copie** de la base (`.backup` en lecture seule, supprimée
  ensuite) ; seule la sauvegarde du compte du propriétaire existe. Aucune écriture en production.
- `npm test` complet sur l'arbre exact de `5ed7046` : **465 / 465 réussis** (dont les 5 nouveaux).
- Limites du modèle : joueur « rationnel » qui réinvestit au mieux et réclame tout ; temps de
  rupture d'un bloc calculé en dégâts/s (pas clic par clic) ; objets de collection supposés déjà
  possédés lors des conversions massives ; reliques achetées « la moins chère d'abord » ; pas de
  relance de bloc ; budget de dégâts non simulé (joueur honnête). Les valeurs absolues dépendent du
  profil ; les comparaisons entre barèmes (mêmes graines) sont robustes.

### 10. Déploiement

**Non déployé, volontairement** : ni le jeu ni le serveur ne changent (outil hors ligne, test et
rapport). La production (`61a5cbc`) exécute déjà exactement le même code ; le prochain déploiement
ordinaire embarquera ces fichiers. Rien à tester en jeu pour l'instant.

**Test fonctionnel proposé au propriétaire** (≈ 5 min, sans rien changer) : relire les sections 2,
4 et 5, puis répondre aux questions ci-dessous dans le ticket. Pour vérifier un chiffre en jeu :
noter gemmes et fragments au début d'une séance d'une heure vers 120 m, puis à la fin — attendu
≈ 5 à 13 gemmes et 4 à 14 fragments.

### 11. Choix techniques faits seul

- Simulateur séparé de `luck-sim.js` (#32) mais même principe (vrai code dans `vm`, graines) ;
  tirage des blocs à partir des probabilités exactes de `Blocks.blockOdds` mises en cache (vérifié
  contre `Blocks.spawn` par un test) pour tenir 10 000 saisons par profil en quelques minutes.
- Conversion massive des pièces en coffres : au-delà de 200 coffres d'un coup, le lot est crédité à
  son espérance exacte (même table et même formule), sinon tirage coffre par coffre.
- Réglages de production figés dans l'outil (`PROD_CONFIG`, relevé du 03/11) plutôt que lus en
  base : l'outil ne touche jamais une base.

### 12. Décisions demandées au propriétaire

1. **Barème des gemmes** : (a) variante A « mesurée », (b) variante B « généreuse », (c) autre.
   Recommandation : **A**.
2. **Fragments illimités (R3)** : (a) limiter les coffres simple et rare (ex. 20 et 10 par
   saison), (b) coût croissant à chaque achat comme la boutique de fragments, (c) retirer les
   fragments du coffre simple, (d) ne rien changer. Recommandation : **(a)**. Le prix de 800 🪙
   réglé le 02/11 est-il voulu ? (sans effet chez les assidus, mais il rend le coffre simple très
   rentable pour les autres).
3. **Inflation des pièces (R2)** : (a) l'accepter (les pièces ne servent qu'aux premières heures
   de chaque saison), (b) ralentir la croissance des récompenses en profondeur (ex. +5 %/m jusqu'à
   200 m puis +2 %/m), simulée avant toute application, (c) ajouter des puits de pièces qui
   suivent la profondeur. Recommandation : **(b)**, simulée dans ce ticket avant décision finale.
4. **Boutique en gemmes** : valider la première tranche (section 5) et ses prix, ou la réduire
   (ex. seulement les deux pioches + ramassage automatique). Recommandation : pioche dorée, pioche
   diamant, ramassage automatique, boost ×2 pièces 30 min ; le reste plus tard.
5. **Ordre de réalisation** proposé : R1 (journal de gemmes côté serveur, invisible pour le joueur)
   → barème retenu → boutique en gemmes → onglet admin « Économie ». D'accord ?

### 13. Éléments restant à réaliser

- Selon les réponses : appliquer le barème retenu (le rendre administrable), R1 (journal de gemmes
  serveur — prérequis de la boutique), limites des coffres (R3), courbe des récompenses (R2),
  boutique en gemmes, onglet admin « Économie » avec simulation avant publication.
- Signalé, hors périmètre : publicité simulée qui accorde un vrai boost (#45).

### Annexe — sortie complète de `node tools/balance/economy-sim.js`

<!-- généré par node tools/balance/economy-sim.js --runs 10000 --long-runs 2000 --seasons 8 -->
### Probabilités exactes par bloc (catalogue v3 publié, Chance 0 et 5)

| Profondeur | Chance | Gemme qui rapporte 💎 | Gemme sans 💎 (saphir, améthyste, cristal) | Coffre de la mine | 💎 / 1 000 blocs (A · B) |
|---|---|---|---|---|---|
| 20 m | 0 | 0,00 % | 0,00 % | 5,64 % | 0,0 (0,0 · 0,0) |
| 20 m | 5 | 0,00 % | 0,00 % | 7,07 % | 0,0 (0,0 · 0,0) |
| 35 m | 0 | 2,15 % | 0,00 % | 7,51 % | 21,5 (21,5 · 42,9) |
| 35 m | 5 | 3,11 % | 0,00 % | 9,59 % | 31,1 (31,1 · 62,2) |
| 50 m | 0 | 2,06 % | 0,00 % | 7,20 % | 20,6 (20,6 · 41,1) |
| 50 m | 5 | 2,93 % | 0,00 % | 9,03 % | 29,3 (29,3 · 58,6) |
| 70 m | 0 | 3,05 % | 0,00 % | 7,13 % | 30,5 (40,7 · 71,3) |
| 70 m | 5 | 4,33 % | 0,00 % | 8,90 % | 43,3 (57,7 · 101,0) |
| 100 m | 0 | 3,05 % | 0,00 % | 7,13 % | 30,5 (40,7 · 71,3) |
| 100 m | 5 | 4,33 % | 0,00 % | 8,90 % | 43,3 (57,7 · 101,0) |
| 122 m | 0 | 3,55 % | 0,00 % | 7,09 % | 35,5 (55,7 · 96,2) |
| 122 m | 5 | 5,01 % | 0,00 % | 8,83 % | 50,1 (78,8 · 136,1) |
| 150 m | 0 | 3,31 % | 0,00 % | 6,62 % | 33,1 (52,0 · 89,9) |
| 150 m | 5 | 4,70 % | 0,00 % | 8,28 % | 47,0 (73,8 · 127,5) |
| 250 m | 0 | 3,08 % | 0,00 % | 6,16 % | 30,8 (48,4 · 83,5) |
| 250 m | 5 | 4,39 % | 0,00 % | 7,73 % | 43,9 (68,9 · 119,0) |
| 400 m | 0 | 2,95 % | 1,06 % | 5,91 % | 29,5 (57,0 · 101,3) |
| 400 m | 5 | 4,14 % | 1,48 % | 7,29 % | 41,4 (79,8 · 141,9) |
| 600 m | 0 | 2,87 % | 1,84 % | 5,74 % | 28,7 (71,7 · 123,0) |
| 600 m | 5 | 3,97 % | 2,55 % | 7,00 % | 39,7 (99,4 · 170,3) |
| 900 m | 0 | 2,85 % | 2,08 % | 5,70 % | 28,5 (78,6 · 134,4) |
| 900 m | 5 | 3,94 % | 2,87 % | 6,94 % | 39,4 (108,6 · 185,7) |

### Espérance des coffres (pièces, fragments)

| Coffre | Coût | Pièces rendues | Fragments (Aimant 0 → 5) | Boost | Objet | Pièces nettes / fragment |
|---|---|---|---|---|---|---|
| Mine — vieille caisse | gratuit | 155 | 0,20 → 1,20 | 0 % | — | — |
| Mine — coffre en bois | gratuit | 180 | 0,50 → 2,50 | 20 % | — | — |
| Mine — coffre en fer | gratuit | 270 | 1,10 → 3,35 | 25 % | — | — |
| Boutique — simple (∞/saison) | 800 | 613 | 0,30 → 1,80 | 15 % | 0 % | 625 → 104 |
| Boutique — rare (∞/saison) | 15 000 | 3 200 | 2,04 → 4,14 | 8 % | 8 % | 5 784 → 2 850 |
| Boutique — antique (5/saison) | 80 000 | 11 000 | 12,40 → 14,75 | 10 % | 12 % | 5 565 → 4 678 |

### Une heure à équipement figé — 10 000 heures simulées par ligne (barème actuel · A · B)

Médiane (p10–p90) ; 💎 et 🔮 : moyenne ± écart-type en plus.

| Équipement | Mètres / h | 💎 / h actuel | 💎 / h A | 💎 / h B | 🔮 / h (mine) | 💰 / h |
|---|---|---|---|---|---|---|
| Début — 30 m, pioche 3, 4 clics/s | 127 (117–135) | 4 (1–6) · 3,8 ± 1,9 | 5 (2–9) · 5,3 ± 2,9 | 10 (4–17) · 10,1 ± 5,1 | 5 (1–9) · 5,0 ± 3,1 | 58 964 |
| Capture 02/11 — 122 m, pioche 8 (+4 Œil), Chance 5, Sac 6, Auto-Dig 4, 4 clics/s | 195 (182–206) | 9 (5–13) · 8,7 ± 2,9 | 14 (8–21) · 14,1 ± 5,1 | 25 (15–37) · 25,5 ± 8,7 | 8 (4–14) · 8,6 ± 4,1 | 691 197 |
| Milieu — 300 m, pioche 12, Chance 8, Sac 9, Auto-Dig 6, 5 clics/s | 170 (157–183) | 8 (5–12) · 8,1 ± 2,8 | 15 (9–22) · 15,4 ± 5,2 | 27 (17–40) · 28,0 ± 8,8 | 12 (6–21) · 12,8 ± 5,9 | 2 376 155 |
| Avancé — 800 m, tout au max, reliques 3, 6 clics/s | 158 (143–173) | 10 (6–14) · 9,7 ± 3,1 | 27 (18–37) · 27,2 ± 7,1 | 47 (33–63) · 47,6 ± 11,9 | 26 (13–41) · 26,5 ± 11,1 | 18 380 080 |
| Onglet ouvert seul — 300 m, Auto-Dig 6, passage /10 min | 14 (10–19) | 0 (0–2) · 0,7 ± 0,8 | 1 (0–3) · 1,1 ± 1,4 | 2 (0–5) · 2,0 ± 2,5 | 0 (0–2) · 0,7 ± 1,1 | 53 759 |

### Saison 1 (nouveau joueur, 7 jours) — 10 000 saisons par profil et par barème

Médiane (p10–p90) · moyenne ± écart-type.

#### Débutant (20 min/j, 4 j/7) — 1,3 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 310 (291–330) · moy. 310 ± 15 | 312 (293–331) · moy. 312 ± 15 | 312 (294–332) · moy. 313 ± 15 |
| 💎 gagnées / saison | 18,0 (13,0–24,0) · moy. 18,1 ± 4,4 | 28,0 (19,0–38,0) · moy. 28,4 ± 7,3 | 52,0 (38,0–69,0) · moy. 52,9 ± 12,3 |
| 💎 / heure de jeu | 13,50 (9,75–18,00) · moy. 13,54 ± 3,28 | 21,00 (14,25–28,50) · moy. 21,29 ± 5,46 | 39,00 (28,50–51,75) · moy. 39,66 ± 9,21 |
| — dont blocs gemmes | 13,0 (8,0–19,0) · moy. 13,6 ± 4,2 | 20,0 (12,0–30,0) · moy. 20,5 ± 6,9 | 35,0 (22,0–51,0) · moy. 36,0 ± 11,6 |
| — dont série quotidienne | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 4,0 (4,0–4,0) · moy. 4,0 ± 0,0 |
| — dont missions du jour | 4,0 (3,0–4,0) · moy. 3,5 ± 0,6 | 7,0 (5,0–7,0) · moy. 6,2 ± 1,1 | 10,0 (7,0–10,0) · moy. 9,0 ± 1,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–2,0) · moy. 0,7 ± 0,8 | 3,0 (0,0–6,0) · moy. 3,0 ± 2,2 |
| 💎 dépensées (Auto-Dig) | 12,0 (12,0–12,0) · moy. 11,7 ± 2,5 | 12,0 (12,0–30,0) · moy. 19,4 ± 8,9 | 50,0 (20,0–50,0) · moy. 37,6 ± 14,8 |
| 💎 en fin de saison (avant plafond) | 6,0 (2,0–12,0) · moy. 6,4 ± 3,7 | 9,0 (1,0–16,0) · moy. 9,0 ± 5,3 | 15,0 (2,0–27,0) · moy. 15,2 ± 9,3 |
| 🔮 fragments / saison | 21,0 (14,0–29,0) · moy. 21,2 ± 5,9 | 21,0 (14,0–29,0) · moy. 21,4 ± 5,9 | 21,0 (14,0–29,0) · moy. 21,5 ± 6,0 |
| 🔮 / heure de jeu | 15,75 (10,50–21,75) · moy. 15,93 ± 4,43 | 15,75 (10,50–21,75) · moy. 16,05 ± 4,45 | 15,75 (10,50–21,75) · moy. 16,10 ± 4,50 |
| — dont coffres de la mine | 15,0 (9,0–23,0) · moy. 15,3 ± 5,6 | 15,0 (8,0–23,0) · moy. 15,4 ± 5,7 | 15,0 (9,0–23,0) · moy. 15,4 ± 5,7 |
| — dont boutique de fragments | 6,0 (5,0–7,0) · moy. 5,9 ± 0,9 | 6,0 (5,0–7,0) · moy. 6,0 ± 0,9 | 6,0 (5,0–7,0) · moy. 6,0 ± 0,9 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 1 333 681 (827 200–2 172 245) · moy. 1 433 430 ± 553 933 | 1 389 935 (880 739–2 258 561) · moy. 1 497 656 ± 575 386 | 1 409 587 (910 061–2 255 309) · moy. 1 518 396 ± 571 602 |
| 💰 / heure de jeu | 1 000 261 (620 400–1 629 183) · moy. 1 075 072 ± 415 450 | 1 042 451 (660 554–1 693 920) · moy. 1 123 242 ± 431 540 | 1 057 190 (682 546–1 691 482) · moy. 1 138 797 ± 428 702 |
| Auto-Dig atteint (niveau) | 4,0 (4,0–4,0) · moy. 3,9 ± 0,3 | 4,0 (4,0–5,0) · moy. 4,4 ± 0,5 | 5,0 (4,0–5,0) · moy. 4,6 ± 0,5 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 94 % · 1 % · 0 % | 100 % · 100 % · 41 % · 0 % | 100 % · 100 % · 59 % · 0 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 1,2 (1,2–1,2) · moy. 1,2 ± 0,0 | 1,2 (1,2–1,3) · moy. 1,3 ± 0,0 | 1,3 (1,1–1,3) · moy. 1,2 ± 0,1 |
| — part des joueurs qui ont tout au max | 0 % | 0 % | 0 % |
| 💰 non dépensées en fin de saison | 83 030 (17 513–173 993) · moy. 91 444 ± 64 407 | 87 086 (17 766–177 581) · moy. 94 771 ± 66 692 | 88 967 (18 103–180 446) · moy. 97 189 ± 68 483 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,3 · 0,8 · 1,3 · — | 0,3 · 0,6 · 1,1 · — | 0,2 · 0,5 · 1,0 · — |

#### Régulier (1 h/j, 7 j/7, bonus pub) — 14,0 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 994 (967–1 022) · moy. 994 ± 22 | 1 001 (973–1 029) · moy. 1 001 ± 22 | 1 001 (975–1 030) · moy. 1 002 ± 22 |
| 💎 gagnées / saison | 66,0 (56,0–75,0) · moy. 65,7 ± 7,5 | 130,0 (111,0–150,0) · moy. 130,3 ± 15,1 | 229,0 (197,0–263,0) · moy. 229,6 ± 25,7 |
| 💎 / heure de jeu | 4,71 (4,00–5,36) · moy. 4,69 ± 0,54 | 9,29 (7,93–10,71) · moy. 9,31 ± 1,08 | 16,36 (14,07–18,79) · moy. 16,40 ± 1,84 |
| — dont blocs gemmes | 51,0 (41,0–60,0) · moy. 50,8 ± 7,5 | 110,0 (91,0–130,0) · moy. 110,1 ± 15,0 | 190,0 (159,0–224,0) · moy. 190,8 ± 25,1 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (6,0–7,0) · moy. 6,8 ± 0,4 | 10,0 (9,0–10,0) · moy. 9,9 ± 0,5 | 13,0 (12,0–13,0) · moy. 12,9 ± 0,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 2,0 (0,0–4,0) · moy. 2,3 ± 1,5 | 10,0 (5,0–15,0) · moy. 9,9 ± 4,1 |
| 💎 dépensées (Auto-Dig) | 65,0 (30,0–65,0) · moy. 49,5 ± 17,4 | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 110,0 (110,0–110,0) · moy. 110,0 ± 0,0 |
| 💎 en fin de saison (avant plafond) | 13,0 (1,0–33,0) · moy. 16,2 ± 12,3 | 65,0 (46,0–85,0) · moy. 65,3 ± 15,1 | 119,0 (87,0–153,0) · moy. 119,6 ± 25,7 |
| 🔮 fragments / saison | 75,0 (55,0–97,0) · moy. 75,5 ± 16,3 | 76,0 (55,0–98,0) · moy. 76,3 ± 16,4 | 76,0 (55,0–98,0) · moy. 76,2 ± 16,6 |
| 🔮 / heure de jeu | 5,36 (3,93–6,93) · moy. 5,40 ± 1,17 | 5,43 (3,93–7,00) · moy. 5,45 ± 1,17 | 5,43 (3,93–7,00) · moy. 5,45 ± 1,18 |
| — dont coffres de la mine | 65,0 (45,0–87,0) · moy. 65,5 ± 16,3 | 66,0 (45,0–88,0) · moy. 66,3 ± 16,4 | 66,0 (45,0–88,0) · moy. 66,2 ± 16,6 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 47 360 981 (38 582 627–58 269 780) · moy. 47 989 248 ± 7 791 202 | 48 617 699 (39 599 090–59 343 389) · moy. 49 134 221 ± 7 898 163 | 48 554 486 (39 680 052–59 859 394) · moy. 49 256 157 ± 7 939 855 |
| 💰 / heure de jeu | 3 382 927 (2 755 902–4 162 127) · moy. 3 427 803 ± 556 514 | 3 472 693 (2 828 506–4 238 813) · moy. 3 509 587 ± 564 155 | 3 468 178 (2 834 289–4 275 671) · moy. 3 518 297 ± 567 132 |
| Auto-Dig atteint (niveau) | 6,0 (5,0–6,0) · moy. 5,6 ± 0,5 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 56 % | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 3,2 (2,4–4,1) · moy. 3,3 ± 0,6 | 3,2 (2,4–4,1) · moy. 3,2 ± 0,6 | 3,2 (2,3–4,1) · moy. 3,2 ± 0,6 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 42 373 511 (33 595 157–53 282 310) · moy. 43 001 778 ± 7 791 202 | 43 630 229 (34 611 620–54 355 919) · moy. 44 146 751 ± 7 898 163 | 43 567 016 (34 692 582–54 871 924) · moy. 44 268 687 ± 7 939 855 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,2 · 1,3 · 4,3 · 12,0 | 0,2 · 1,0 · 2,3 · 6,0 | 0,2 · 0,5 · 2,2 · 5,3 |

#### Assidu (3 h/j + 4 h onglet ouvert) — 49,0 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 2 051 (1 990–2 106) · moy. 2 049 ± 46 | 2 057 (1 996–2 112) · moy. 2 055 ± 46 | 2 056 (1 995–2 113) · moy. 2 055 ± 46 |
| 💎 gagnées / saison | 124,0 (110,0–138,0) · moy. 124,2 ± 10,8 | 293,0 (264,0–324,0) · moy. 293,7 ± 23,8 | 515,0 (463,0–567,0) · moy. 515,0 ± 40,4 |
| 💎 / heure de jeu | 2,53 (2,24–2,82) · moy. 2,53 ± 0,22 | 5,98 (5,39–6,61) · moy. 5,99 ± 0,49 | 10,51 (9,45–11,57) · moy. 10,51 ± 0,83 |
| — dont blocs gemmes | 109,0 (95,0–123,0) · moy. 109,2 ± 10,8 | 270,0 (241,0–301,0) · moy. 270,9 ± 23,6 | 465,0 (415,0–516,0) · moy. 465,3 ± 39,5 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 13,0 (13,0–13,0) · moy. 13,0 ± 0,0 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 5,0 (2,0–8,0) · moy. 4,8 ± 2,2 | 20,0 (13,0–29,0) · moy. 20,8 ± 6,1 |
| 💎 dépensées (Auto-Dig) | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 65,0 (65,0–65,0) · moy. 65,0 ± 0,0 | 110,0 (110,0–110,0) · moy. 110,0 ± 0,0 |
| 💎 en fin de saison (avant plafond) | 59,0 (45,0–73,0) · moy. 59,2 ± 10,8 | 228,0 (199,0–259,0) · moy. 228,7 ± 23,8 | 405,0 (353,0–457,0) · moy. 405,0 ± 40,4 |
| 🔮 fragments / saison | 1 860,0 (1 801,0–2 463,0) · moy. 1 928,9 ± 221,2 | 1 862,0 (1 802,0–2 464,0) · moy. 1 933,7 ± 223,4 | 1 861,0 (1 802,0–2 465,0) · moy. 1 932,5 ± 226,7 |
| 🔮 / heure de jeu | 37,96 (36,76–50,27) · moy. 39,37 ± 4,51 | 38,00 (36,78–50,29) · moy. 39,46 ± 4,56 | 37,98 (36,78–50,31) · moy. 39,44 ± 4,63 |
| — dont coffres de la mine | 167,0 (125,0–212,0) · moy. 168,2 ± 34,1 | 167,0 (125,0–213,0) · moy. 168,6 ± 34,0 | 167,0 (124,0–213,0) · moy. 168,1 ± 34,4 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 1 681,0 (1 642,0–2 240,0) · moy. 1 750,7 ± 203,8 | 1 684,0 (1 642,0–2 243,0) · moy. 1 755,1 ± 206,1 | 1 684,0 (1 642,0–2 245,0) · moy. 1 754,4 ± 209,1 |
| 💰 pièces gagnées / saison | 250 215 905 (215 649 566–287 356 389) · moy. 251 060 294 ± 28 108 315 | 250 865 926 (217 123 380–289 495 566) · moy. 252 199 455 ± 28 230 888 | 251 242 434 (216 762 418–288 220 049) · moy. 252 070 527 ± 28 014 376 |
| 💰 / heure de jeu | 5 106 447 (4 401 012–5 864 416) · moy. 5 123 679 ± 573 639 | 5 119 713 (4 431 089–5 908 073) · moy. 5 146 928 ± 576 141 | 5 127 397 (4 423 723–5 882 042) · moy. 5 144 296 ± 571 722 |
| Auto-Dig atteint (niveau) | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,0 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % | 100 % · 100 % · 100 % · 100 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 | 2,8 (2,4–3,2) · moy. 2,8 ± 0,6 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 243 392 435 (208 826 096–280 532 919) · moy. 244 236 824 ± 28 108 315 | 244 042 456 (210 299 910–282 672 096) · moy. 245 375 985 ± 28 230 888 | 244 418 964 (209 938 948–281 396 579) · moy. 245 247 057 ± 28 014 376 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 0,2 · 0,7 · 5,0 · 17,5 | 0,2 · 0,4 · 2,5 · 5,6 | 0,1 · 0,4 · 2,4 · 5,3 |

#### Automatique (15 min/j + 8 h onglet) — 57,8 h de jeu (actif + onglet ouvert)

| Mesure | Actuel | Variante A | Variante B |
|---|---|---|---|
| Profondeur max (m) | 692 (663–719) · moy. 691 ± 22 | 722 (691–751) · moy. 721 ± 23 | 728 (697–756) · moy. 727 ± 23 |
| 💎 gagnées / saison | 49,0 (40,0–57,0) · moy. 48,7 ± 6,7 | 89,0 (73,0–105,0) · moy. 88,8 ± 12,7 | 158,0 (131,0–186,0) · moy. 158,2 ± 21,8 |
| 💎 / heure de jeu | 0,85 (0,69–0,99) · moy. 0,84 ± 0,12 | 1,54 (1,26–1,82) · moy. 1,54 ± 0,22 | 2,74 (2,27–3,22) · moy. 2,74 ± 0,38 |
| — dont blocs gemmes | 34,0 (26,0–43,0) · moy. 34,1 ± 6,5 | 69,0 (53,0–85,0) · moy. 68,8 ± 12,6 | 120,0 (94,0–149,0) · moy. 120,9 ± 21,5 |
| — dont série quotidienne | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 7,0 (7,0–7,0) · moy. 7,0 ± 0,0 | 15,0 (15,0–15,0) · moy. 15,0 ± 0,0 |
| — dont missions du jour | 7,0 (6,0–7,0) · moy. 6,6 ± 0,6 | 10,0 (9,0–12,0) · moy. 10,4 ± 1,0 | 14,0 (12,0–17,0) · moy. 14,2 ± 1,5 |
| — dont coffres de la mine | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 1,0 (0,0–3,0) · moy. 1,6 ± 1,3 | 7,0 (3,0–12,0) · moy. 7,1 ± 3,4 |
| 💎 dépensées (Auto-Dig) | 30,0 (30,0–30,0) · moy. 30,3 ± 3,6 | 65,0 (65,0–65,0) · moy. 64,1 ± 5,5 | 110,0 (110,0–110,0) · moy. 109,4 ± 5,9 |
| 💎 en fin de saison (avant plafond) | 18,0 (10,0–27,0) · moy. 18,3 ± 6,6 | 24,0 (9,0–40,0) · moy. 24,7 ± 12,0 | 48,0 (22,0–76,0) · moy. 48,8 ± 21,1 |
| 🔮 fragments / saison | 49,0 (35,0–66,0) · moy. 49,9 ± 12,3 | 52,0 (36,0–70,0) · moy. 52,4 ± 12,9 | 52,0 (36,0–70,0) · moy. 52,8 ± 13,0 |
| 🔮 / heure de jeu | 0,85 (0,61–1,14) · moy. 0,86 ± 0,21 | 0,90 (0,62–1,21) · moy. 0,91 ± 0,22 | 0,90 (0,62–1,21) · moy. 0,91 ± 0,22 |
| — dont coffres de la mine | 39,0 (25,0–56,0) · moy. 39,9 ± 12,3 | 42,0 (26,0–60,0) · moy. 42,4 ± 12,9 | 42,0 (26,0–60,0) · moy. 42,8 ± 13,0 |
| — dont boutique de fragments | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 | 10,0 (10,0–10,0) · moy. 10,0 ± 0,0 |
| — dont coffres de la boutique | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 | 0,0 (0,0–0,0) · moy. 0,0 ± 0,0 |
| 💰 pièces gagnées / saison | 13 604 082 (10 982 335–16 538 256) · moy. 13 700 015 ± 2 161 183 | 15 461 679 (12 488 815–18 820 764) · moy. 15 558 070 ± 2 456 454 | 15 781 500 (12 787 871–19 119 317) · moy. 15 880 734 ± 2 470 328 |
| 💰 / heure de jeu | 235 569 (190 170–286 377) · moy. 237 230 ± 37 423 | 267 735 (216 257–325 901) · moy. 269 404 ± 42 536 | 273 273 (221 435–331 070) · moy. 274 991 ± 42 776 |
| Auto-Dig atteint (niveau) | 5,0 (5,0–5,0) · moy. 5,0 ± 0,1 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,2 | 6,0 (6,0–6,0) · moy. 6,0 ± 0,1 |
| Auto-Dig 3 · 4 · 5 · 6 : part des joueurs (actuel) | 100 % · 100 % · 100 % · 1 % | 100 % · 100 % · 100 % · 98 % | 100 % · 100 % · 100 % · 99 % |
| Toutes améliorations en pièces au max (h de jeu ; part) | 33,0 (27,5–38,5) · moy. 33,0 ± 4,0 | 30,3 (26,1–35,8) · moy. 30,7 ± 3,7 | 30,3 (25,2–35,6) · moy. 30,3 ± 3,7 |
| — part des joueurs qui ont tout au max | 100 % | 100 % | 100 % |
| 💰 non dépensées en fin de saison | 8 616 612 (5 994 865–11 550 786) · moy. 8 712 545 ± 2 161 183 | 10 474 209 (7 501 345–13 833 294) · moy. 10 570 600 ± 2 456 454 | 10 794 030 (7 800 401–14 131 847) · moy. 10 893 264 ± 2 470 328 |
| Auto-Dig 3 · 4 · 5 · 6 : heures de jeu (médiane) | 5,5 · 12,4 · 33,0 · 55,6 | 5,4 · 8,3 · 19,3 · 41,8 | 4,3 · 8,3 · 16,6 · 39,4 |

### Accumulation sur 8 saisons — 2 000 joueurs par profil (barème actuel)

| Profil | Saison | Profondeur max | 💎 gagnées | 💎 en fin (avant plafond) | 💎 perdues au plafond | 🔮 gagnées | Niveaux de reliques | Coffres boutique |
|---|---|---|---|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | 1 | 310 | 18,0 | 6,0 | 0,0 (moy.) | 21 | 2 / 30 | 0 |
| Débutant (20 min/j, 4 j/7) | 4 | 395 | 24,0 | 9,0 | 0,0 (moy.) | 45 | 8 / 30 | 0 |
| Débutant (20 min/j, 4 j/7) | 8 | 472 | 31,0 | 13,0 | 0,0 (moy.) | 90 | 16 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 1 | 994 | 66,0 | 12,0 | 0,0 (moy.) | 75 | 6 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 4 | 1 325 | 95,0 | 74,5 | 0,8 (moy.) | 244 | 20 / 30 | 0 |
| Régulier (1 h/j, 7 j/7, bonus pub) | 8 | 1 778 | 137,0 | 172,0 | 72,5 (moy.) | 503 | 30 / 30 | 0 |
| Assidu (3 h/j + 4 h onglet ouvert) | 1 | 2 049 | 124,0 | 59,0 | 0,0 (moy.) | 1 861 | 30 / 30 | 1 800 |
| Assidu (3 h/j + 4 h onglet ouvert) | 4 | 3 383 | 252,0 | 287,0 | 186,3 (moy.) | 4 239 | 30 / 30 | 1 800 |
| Assidu (3 h/j + 4 h onglet ouvert) | 8 | 3 383 | 249,0 | 284,0 | 184,6 (moy.) | 4 239 | 30 / 30 | 1 800 |
| Automatique (15 min/j + 8 h onglet) | 1 | 694 | 49,0 | 18,0 | 0,0 (moy.) | 49 | 4 / 30 | 0 |
| Automatique (15 min/j + 8 h onglet) | 4 | 948 | 69,0 | 25,0 | 0,0 (moy.) | 151 | 16 / 30 | 0 |
| Automatique (15 min/j + 8 h onglet) | 8 | 1 448 | 113,0 | 130,5 | 30,2 (moy.) | 410 | 29 / 30 | 0 |

### Effet des avantages sur la profondeur (saison 1, 10 000 saisons, barème actuel)

| Profil | Référence | Sans Auto-Dig en gemmes | Ramassage auto des coffres (onglet ouvert) | Boost ×2 pièces 30 min / jour | Écart Auto-Dig gemmes | Écart ramassage | Écart boost |
|---|---|---|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | 310 m | 304 m | — | 326 m | -1,9 % | — | +5,2 % |
| Régulier (1 h/j, 7 j/7, bonus pub) | 994 m | 965 m | 995 m | 998 m | -2,9 % | +0,1 % | +0,4 % |
| Assidu (3 h/j + 4 h onglet ouvert) | 2 051 m | 1 979 m | 2 053 m | 2 055 m | -3,5 % | +0,1 % | +0,2 % |
| Automatique (15 min/j + 8 h onglet) | 692 m | 559 m | 720 m | 701 m | -19,2 % | +4,0 % | +1,3 % |

### Conversion des pièces en coffres de la boutique — 2 000 joueurs × 4 saisons

| Scénario | 🔮 saison 1 | Reliques S1 (/30) | Profondeur S1 | Profondeur S2 | Écart S2 | Profondeur S4 | Écart S4 |
|---|---|---|---|---|---|---|---|
| Assidu — sans coffres de la boutique | 176 | 10 | 2 048 m | 2 408 m | +0,0 % | 3 330 m | +0,0 % |
| Assidu — simple à 800 (production), 1 h d'ouvertures (1 800) | 1 860 | 30 | 2 048 m | 3 384 m | +40,5 % | 3 383 m | +1,6 % |
| Assidu — simple à 2 000 (défaut du code), 1 800 ouvertures | 1 860 | 30 | 2 048 m | 3 384 m | +40,5 % | 3 383 m | +1,6 % |
| Assidu — simple à 800, 300 ouvertures / saison | 511 | 18 | 2 048 m | 2 734 m | +13,5 % | 3 384 m | +1,6 % |
| Assidu — script au plafond du limiteur (30/min, 24 h) | 39 120 | 30 | 2 048 m | 3 384 m | +40,5 % | 3 383 m | +1,6 % |
| Régulier — sans coffres de la boutique | 75 | 6 | 993 m | 1 127 m | +0,0 % | 1 327 m | +0,0 % |
| Régulier — simple à 800, 300 ouvertures / saison | 407 | 16 | 993 m | 1 314 m | +16,5 % | 1 779 m | +34,1 % |

### Annexe C (06/11) — sortie de `node tools/balance/fragment-rarity-sim.js --runs 2500 --hour-runs 10000 --pack-runs 2000`

#### Espérance par ouverture (sans Aimant) — fragments · pièces

| Coffre | Actuel (production) | P — prudente | R — nettement plus rare | R + Aimant réduit (1/1/2/2/3) |
|---|---|---|---|---|
| Miné — commun | 0,2 🔮 · 155 💰 | 0,1 🔮 · 177 💰 | 0,1 🔮 · 183 💰 | 0,1 🔮 · 183 💰 |
| Miné — rare | 0,5 🔮 · 180 💰 | 0,3 🔮 · 225 💰 | 0,2 🔮 · 248 💰 | 0,2 🔮 · 248 💰 |
| Miné — epique | 1,1 🔮 · 270 💰 | 0,5 🔮 · 315 💰 | 0,4 🔮 · 360 💰 | 0,4 🔮 · 360 💰 |
| Boutique — simple | 0,3 🔮 · 613 💰 · ∞/saison | 0,2 🔮 · 613 💰 · 20/saison | 0 🔮 · 613 💰 · 20/saison | 0 🔮 · 613 💰 · 20/saison |
| Boutique — rare | 2 🔮 · 3 200 💰 · ∞/saison | 1,1 🔮 · 3 200 💰 · 10/saison | 0,4 🔮 · 3 550 💰 · 10/saison | 0,4 🔮 · 3 550 💰 · 10/saison |
| Boutique — antique | 12,4 🔮 · 11 000 💰 · 5/saison | 6,2 🔮 · 11 000 💰 · 5/saison | 1,9 🔮 · 12 625 💰 · 5/saison | 1,9 🔮 · 12 625 💰 · 5/saison |

Reliques : 30 niveaux, 1 617 🔮 au total. Plafond de conversion pièces → fragments par saison (espérance, boutique au maximum des limites, sans Aimant) : Actuel (production) = illimité ; P — prudente = 52 🔮 (3,2 % des reliques) ; R — nettement plus rare = 19 🔮 (1,1 % des reliques) ; R + Aimant réduit (1/1/2/2/3) = 19 🔮 (1,1 % des reliques).

#### Fragments par heure selon la profondeur — équipement figé, coffres minés seulement, 10 000 heures par ligne (médiane · p90)

| Équipement | Actuel (production) | P — prudente | R — nettement plus rare | R + Aimant réduit (1/1/2/2/3) |
|---|---|---|---|---|
| Début — 30 m, pioche 3, 4 clics/s | 5 · 9 | 2 · 5 | 1 · 4 | 1 · 4 |
| Capture 02/11 — 122 m, pioche 8 (+4 Œil), Chance 5, Sac 6, Auto-Dig 4, 4 clics/s | 8 · 14 | 4 · 7 | 3 · 6 | 3 · 6 |
| Milieu — 300 m, pioche 12, Chance 8, Sac 9, Auto-Dig 6, 5 clics/s | 12 · 21 | 6 · 12 | 4 · 9 | 4 · 9 |
| Avancé — 800 m, tout au max, reliques 3, 6 clics/s | 26 · 41 | 13 · 25 | 9 · 19 | 7 · 15 |
| Onglet ouvert seul — 300 m, Auto-Dig 6, passage /10 min | 0 · 2 | 0 · 1 | 0 · 1 | 0 · 1 |

#### Saisons 1 → 4 SANS achat de coffres de la boutique — 2 500 joueurs par profil et par variante

##### Débutant (20 min/j, 4 j/7)

| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l'actuel |
|---|---|---|---|---|---|---|---|---|
| Actuel (production) | S1 | 15 · 23 | 11,3 · 17,3 | 2 | 2 % | 0 % | 310 m | — |
|  | S2 | 17 · 29 | 12,8 · 21,8 | 3 | 4 % | 0 % | 344 m | — |
|  | S3 | 27 · 41 | 20,3 · 30,8 | 5 | 2 % | 0 % | 362 m | — |
|  | S4 | 33 · 47 | 24,8 · 35,3 | 7 | 1 % | 0 % | 375 m | — |
| P — prudente | S1 | 7 · 12 | 5,3 · 9 | 1 | 22 % | 0 % | 301 m | −2,9 % |
|  | S2 | 8 · 12 | 6 · 9,1 | 2 | 21 % | 0 % | 328 m | −4,7 % |
|  | S3 | 8 · 13 | 6 · 9,8 | 2 | 35 % | 0 % | 339 m | −6,4 % |
|  | S4 | 9 · 16 | 6,8 · 12 | 3 | 31 % | 0 % | 355 m | −5,3 % |
| R — nettement plus rare | S1 | 4 · 9 | 3 · 6,8 | 0 | 50 % | 0 % | 296 m | −4,5 % |
|  | S2 | 5 · 9 | 3,8 · 6,8 | 1 | 33 % | 0 % | 322 m | −6,4 % |
|  | S3 | 5 · 9 | 3,8 · 6,8 | 2 | 44 % | 0 % | 332 m | −8,3 % |
|  | S4 | 5 · 10 | 3,8 · 7,5 | 2 | 55 % | 0 % | 338 m | −9,9 % |
| R + Aimant réduit (1/1/2/2/3) | S1 | 4 · 9 | 3 · 6,8 | 0 | 50 % | 0 % | 296 m | −4,5 % |
|  | S2 | 5 · 9 | 3,8 · 6,8 | 1 | 33 % | 0 % | 322 m | −6,4 % |
|  | S3 | 5 · 9 | 3,8 · 6,8 | 2 | 44 % | 0 % | 332 m | −8,3 % |
|  | S4 | 5 · 10 | 3,8 · 7,5 | 2 | 55 % | 0 % | 338 m | −9,9 % |

##### Régulier (1 h/j, 7 j/7, bonus pub)

| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l'actuel |
|---|---|---|---|---|---|---|---|---|
| Actuel (production) | S1 | 58 · 80 | 4,1 · 5,7 | 5 | 0 % | 0 % | 990 m | — |
|  | S2 | 104 · 137 | 7,4 · 9,8 | 10 | 0 % | 0 % | 1 105 m | — |
|  | S3 | 153 · 201 | 10,9 · 14,4 | 14 | 0 % | 0 % | 1 189 m | — |
|  | S4 | 215 · 266 | 15,4 · 19 | 18 | 0 % | 0 % | 1 294 m | — |
| P — prudente | S1 | 23 · 31 | 1,6 · 2,2 | 2 | 0 % | 0 % | 956 m | −3,4 % |
|  | S2 | 33 · 50 | 2,4 · 3,6 | 5 | 0 % | 0 % | 1 017 m | −8 % |
|  | S3 | 48 · 64 | 3,4 · 4,6 | 7 | 0 % | 0 % | 1 056 m | −11,2 % |
|  | S4 | 60 · 84 | 4,3 · 6 | 10 | 0 % | 0 % | 1 131 m | −12,6 % |
| R — nettement plus rare | S1 | 16 · 22 | 1,1 · 1,6 | 2 | 0 % | 0 % | 947 m | −4,3 % |
|  | S2 | 17 · 27 | 1,2 · 1,9 | 3 | 4 % | 0 % | 1 001 m | −9,4 % |
|  | S3 | 27 · 40 | 1,9 · 2,9 | 5 | 2 % | 0 % | 1 023 m | −14 % |
|  | S4 | 33 · 46 | 2,4 · 3,3 | 7 | 1 % | 0 % | 1 044 m | −19,3 % |
| R + Aimant réduit (1/1/2/2/3) | S1 | 16 · 22 | 1,1 · 1,6 | 2 | 0 % | 0 % | 947 m | −4,3 % |
|  | S2 | 17 · 27 | 1,2 · 1,9 | 3 | 4 % | 0 % | 1 001 m | −9,4 % |
|  | S3 | 27 · 40 | 1,9 · 2,9 | 5 | 2 % | 0 % | 1 023 m | −14 % |
|  | S4 | 33 · 46 | 2,4 · 3,3 | 7 | 1 % | 0 % | 1 044 m | −19,3 % |

##### Assidu (3 h/j + 4 h onglet ouvert)

| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l'actuel |
|---|---|---|---|---|---|---|---|---|
| Actuel (production) | S1 | 150 · 194 | 3,1 · 4 | 9 | 0 % | 0 % | 2 018 m | — |
|  | S2 | 337 · 408 | 6,9 · 8,3 | 17 | 0 % | 0 % | 2 361 m | — |
|  | S3 | 555 · 681 | 11,3 · 13,9 | 25 | 0 % | 0 % | 2 706 m | — |
|  | S4 | 874 · 990 | 17,8 · 20,2 | 30 | 0 % | 93 % | 3 277 m | — |
| P — prudente | S1 | 52 · 73 | 1,1 · 1,5 | 5 | 0 % | 0 % | 1 907 m | −5,5 % |
|  | S2 | 98 · 130 | 2 · 2,7 | 9 | 0 % | 0 % | 2 096 m | −11,2 % |
|  | S3 | 153 · 196 | 3,1 · 4 | 14 | 0 % | 0 % | 2 254 m | −16,7 % |
|  | S4 | 222 · 271 | 4,5 · 5,5 | 18 | 0 % | 0 % | 2 451 m | −25,2 % |
| R — nettement plus rare | S1 | 31 · 44 | 0,6 · 0,9 | 3 | 0 % | 0 % | 1 873 m | −7,2 % |
|  | S2 | 55 · 73 | 1,1 · 1,5 | 6 | 0 % | 0 % | 1 965 m | −16,8 % |
|  | S3 | 76 · 104 | 1,6 · 2,1 | 10 | 0 % | 0 % | 2 140 m | −20,9 % |
|  | S4 | 105 · 135 | 2,1 · 2,8 | 13 | 0 % | 0 % | 2 240 m | −31,6 % |
| R + Aimant réduit (1/1/2/2/3) | S1 | 31 · 44 | 0,6 · 0,9 | 3 | 0 % | 0 % | 1 873 m | −7,2 % |
|  | S2 | 55 · 73 | 1,1 · 1,5 | 6 | 0 % | 0 % | 1 965 m | −16,8 % |
|  | S3 | 67 · 84 | 1,4 · 1,7 | 9 | 0 % | 0 % | 2 137 m | −21 % |
|  | S4 | 72 · 90 | 1,5 · 1,8 | 12 | 0 % | 0 % | 2 203 m | −32,8 % |

##### Automatique (15 min/j + 8 h onglet)

| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l'actuel |
|---|---|---|---|---|---|---|---|---|
| Actuel (production) | S1 | 35 · 51 | 0,6 · 0,9 | 3 | 0 % | 0 % | 691 m | — |
|  | S2 | 63 · 84 | 1,1 · 1,5 | 7 | 0 % | 0 % | 767 m | — |
|  | S3 | 88 · 121 | 1,5 · 2,1 | 10 | 0 % | 0 % | 841 m | — |
|  | S4 | 120 · 159 | 2,1 · 2,8 | 14 | 0 % | 0 % | 918 m | — |
| P — prudente | S1 | 16 · 23 | 0,3 · 0,4 | 2 | 0 % | 0 % | 684 m | −1 % |
|  | S2 | 19 · 29 | 0,3 · 0,5 | 3 | 1 % | 0 % | 746 m | −2,7 % |
|  | S3 | 30 · 43 | 0,5 · 0,7 | 5 | 0 % | 0 % | 751 m | −10,7 % |
|  | S4 | 35 · 48 | 0,6 · 0,8 | 7 | 1 % | 0 % | 778 m | −15,3 % |
| R — nettement plus rare | S1 | 11 · 17 | 0,2 · 0,3 | 1 | 3 % | 0 % | 683 m | −1,2 % |
|  | S2 | 12 · 18 | 0,2 · 0,3 | 2 | 10 % | 0 % | 738 m | −3,8 % |
|  | S3 | 14 · 24 | 0,2 · 0,4 | 4 | 10 % | 0 % | 747 m | −11,2 % |
|  | S4 | 21 · 32 | 0,4 · 0,6 | 5 | 6 % | 0 % | 755 m | −17,8 % |
| R + Aimant réduit (1/1/2/2/3) | S1 | 11 · 17 | 0,2 · 0,3 | 1 | 3 % | 0 % | 683 m | −1,2 % |
|  | S2 | 12 · 18 | 0,2 · 0,3 | 2 | 10 % | 0 % | 738 m | −3,8 % |
|  | S3 | 14 · 24 | 0,2 · 0,4 | 4 | 10 % | 0 % | 747 m | −11,2 % |
|  | S4 | 21 · 32 | 0,4 · 0,6 | 5 | 6 % | 0 % | 755 m | −17,8 % |

#### Saisons 1 → 4 AVEC achats de coffres de la boutique (hypothèses du 04/11 : 50 / 300 / 1 800 / 300 ouvertures max. par saison) — 2 500 joueurs par profil et par variante

##### Débutant (20 min/j, 4 j/7)

| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l'actuel |
|---|---|---|---|---|---|---|---|---|
| Actuel (production) | S1 | 47 · 94 | 35,3 · 70,5 | 4 | 0 % | 0 % | 310 m | — |
|  | S2 | 134 · 271 | 100,5 · 203,3 | 10 | 0 % | 0 % | 369 m | — |
|  | S3 | 288 · 371 | 216 · 278,3 | 17 | 0 % | 0 % | 445 m | — |
|  | S4 | 356 · 442 | 267 · 331,5 | 23 | 0 % | 0 % | 520 m | — |
| P — prudente | S1 | 19 · 36 | 13,9 · 27 | 2 | 1 % | 0 % | 301 m | −2,9 % |
|  | S2 | 34 · 74 | 25,5 · 55,5 | 5 | 2 % | 0 % | 345 m | −6,5 % |
|  | S3 | 64 · 104 | 48 · 78 | 8 | 0 % | 0 % | 373 m | −16,2 % |
|  | S4 | 90 · 125 | 67,5 · 93,8 | 11 | 0 % | 0 % | 416 m | −20 % |
| R — nettement plus rare | S1 | 9 · 17 | 6,8 · 12,8 | 1 | 17 % | 0 % | 296 m | −4,5 % |
|  | S2 | 11 · 23 | 8,3 · 17,3 | 2 | 14 % | 0 % | 330 m | −10,6 % |
|  | S3 | 16 · 33 | 12 · 24,8 | 4 | 13 % | 0 % | 350 m | −21,3 % |
|  | S4 | 23 · 40 | 17,3 · 30 | 5 | 8 % | 0 % | 364 m | −30 % |
| R + Aimant réduit (1/1/2/2/3) | S1 | 9 · 17 | 6,8 · 12,8 | 1 | 17 % | 0 % | 296 m | −4,5 % |
|  | S2 | 11 · 23 | 8,3 · 17,3 | 2 | 14 % | 0 % | 330 m | −10,6 % |
|  | S3 | 16 · 33 | 12 · 24,8 | 4 | 13 % | 0 % | 350 m | −21,3 % |
|  | S4 | 23 · 40 | 17,3 · 30 | 5 | 8 % | 0 % | 364 m | −30 % |

##### Régulier (1 h/j, 7 j/7, bonus pub)

| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l'actuel |
|---|---|---|---|---|---|---|---|---|
| Actuel (production) | S1 | 1 183 · 1 519 | 84,5 · 108,5 | 26 | 0 % | 3 % | 1 348 m | — |
|  | S2 | 1 844 · 1 918 | 131,7 · 137 | 30 | 3 % | 100 % | 1 757 m | — |
|  | S3 | 1 856 · 1 930 | 132,6 · 137,9 | 30 | 100 % | 100 % | 1 779 m | — |
|  | S4 | 1 857 · 1 928 | 132,6 · 137,7 | 30 | 100 % | 100 % | 1 779 m | — |
| P — prudente | S1 | 93 · 122 | 6,6 · 8,7 | 7 | 0 % | 0 % | 997 m | −26 % |
|  | S2 | 138 · 173 | 9,9 · 12,4 | 12 | 0 % | 0 % | 1 145 m | −34,8 % |
|  | S3 | 177 · 223 | 12,6 · 15,9 | 16 | 0 % | 0 % | 1 244 m | −30,1 % |
|  | S4 | 211 · 262 | 15,1 · 18,7 | 20 | 0 % | 0 % | 1 328 m | −25,4 % |
| R — nettement plus rare | S1 | 34 · 53 | 2,4 · 3,8 | 3 | 0 % | 0 % | 978 m | −27,4 % |
|  | S2 | 52 · 71 | 3,7 · 5,1 | 6 | 0 % | 0 % | 1 034 m | −41,1 % |
|  | S3 | 64 · 88 | 4,6 · 6,3 | 9 | 0 % | 0 % | 1 122 m | −36,9 % |
|  | S4 | 82 · 105 | 5,9 · 7,5 | 12 | 0 % | 0 % | 1 167 m | −34,4 % |
| R + Aimant réduit (1/1/2/2/3) | S1 | 34 · 53 | 2,4 · 3,8 | 3 | 0 % | 0 % | 978 m | −27,4 % |
|  | S2 | 52 · 70 | 3,7 · 5 | 6 | 0 % | 0 % | 1 034 m | −41,1 % |
|  | S3 | 59 · 76 | 4,2 · 5,4 | 9 | 0 % | 0 % | 1 121 m | −37 % |
|  | S4 | 61 · 78 | 4,4 · 5,6 | 11 | 0 % | 0 % | 1 153 m | −35,2 % |

##### Assidu (3 h/j + 4 h onglet ouvert)

| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l'actuel |
|---|---|---|---|---|---|---|---|---|
| Actuel (production) | S1 | 7 245 · 7 765 | 147,9 · 158,5 | 30 | 0 % | 100 % | 3 207 m | — |
|  | S2 | 9 092 · 9 193 | 185,6 · 187,6 | 30 | 100 % | 100 % | 3 383 m | — |
|  | S3 | 9 095 · 9 197 | 185,6 · 187,7 | 30 | 100 % | 100 % | 3 384 m | — |
|  | S4 | 9 095 · 9 199 | 185,6 · 187,7 | 30 | 100 % | 100 % | 3 385 m | — |
| P — prudente | S1 | 136 · 183 | 2,8 · 3,7 | 8 | 0 % | 0 % | 2 025 m | −36,9 % |
|  | S2 | 235 · 301 | 4,8 · 6,1 | 15 | 0 % | 0 % | 2 292 m | −32,3 % |
|  | S3 | 337 · 413 | 6,9 · 8,4 | 21 | 0 % | 0 % | 2 553 m | −24,6 % |
|  | S4 | 457 · 556 | 9,3 · 11,3 | 26 | 0 % | 0 % | 2 807 m | −17,1 % |
| R — nettement plus rare | S1 | 62 · 84 | 1,3 · 1,7 | 5 | 0 % | 0 % | 1 920 m | −40,1 % |
|  | S2 | 97 · 129 | 2 · 2,6 | 9 | 0 % | 0 % | 2 125 m | −37,2 % |
|  | S3 | 137 · 175 | 2,8 · 3,6 | 13 | 0 % | 0 % | 2 258 m | −33,3 % |
|  | S4 | 186 · 228 | 3,8 · 4,7 | 17 | 0 % | 0 % | 2 425 m | −28,4 % |
| R + Aimant réduit (1/1/2/2/3) | S1 | 62 · 84 | 1,3 · 1,7 | 5 | 0 % | 0 % | 1 920 m | −40,1 % |
|  | S2 | 90 · 111 | 1,8 · 2,3 | 9 | 0 % | 0 % | 2 122 m | −37,3 % |
|  | S3 | 97 · 118 | 2 · 2,4 | 12 | 0 % | 0 % | 2 230 m | −34,1 % |
|  | S4 | 122 · 156 | 2,5 · 3,2 | 15 | 0 % | 0 % | 2 338 m | −30,9 % |

##### Automatique (15 min/j + 8 h onglet)

| Variante | Saison | 🔮 / saison (médiane · p90) | 🔮 / h (médiane · p90) | Niveaux de reliques cumulés (médiane, /30) | Semaine sans nouveau niveau | 30/30 atteints | Profondeur (médiane) | Écart à l'actuel |
|---|---|---|---|---|---|---|---|---|
| Actuel (production) | S1 | 1 271 · 1 440 | 22 · 24,9 | 27 | 0 % | 0 % | 944 m | — |
|  | S2 | 1 813 · 1 891 | 31,4 · 32,7 | 30 | 0 % | 100 % | 1 606 m | — |
|  | S3 | 1 815 · 1 885 | 31,4 · 32,6 | 30 | 100 % | 100 % | 1 634 m | — |
|  | S4 | 1 816 · 1 886 | 31,4 · 32,7 | 30 | 100 % | 100 % | 1 633 m | — |
| P — prudente | S1 | 79 · 106 | 1,4 · 1,8 | 6 | 0 % | 0 % | 694 m | −26,4 % |
|  | S2 | 114 · 147 | 2 · 2,5 | 11 | 0 % | 0 % | 846 m | −47,4 % |
|  | S3 | 140 · 182 | 2,4 · 3,2 | 14 | 0 % | 0 % | 917 m | −43,9 % |
|  | S4 | 172 · 214 | 3 · 3,7 | 18 | 0 % | 0 % | 1 020 m | −37,5 % |
| R — nettement plus rare | S1 | 30 · 43 | 0,5 · 0,7 | 3 | 0 % | 0 % | 688 m | −27,1 % |
|  | S2 | 42 · 57 | 0,7 · 1 | 6 | 0 % | 0 % | 756 m | −52,9 % |
|  | S3 | 49 · 66 | 0,8 · 1,1 | 8 | 0 % | 0 % | 786 m | −51,9 % |
|  | S4 | 63 · 85 | 1,1 · 1,5 | 10 | 0 % | 0 % | 865 m | −47 % |
| R + Aimant réduit (1/1/2/2/3) | S1 | 30 · 43 | 0,5 · 0,7 | 3 | 0 % | 0 % | 688 m | −27,1 % |
|  | S2 | 42 · 57 | 0,7 · 1 | 6 | 0 % | 0 % | 756 m | −52,9 % |
|  | S3 | 48 · 63 | 0,8 · 1,1 | 8 | 0 % | 0 % | 786 m | −51,9 % |
|  | S4 | 51 · 67 | 0,9 · 1,2 | 10 | 0 % | 0 % | 854 m | −47,7 % |

#### Anciens et nouveaux joueurs — 2 000 joueurs (avec achats de coffres) : 4 saisons au régime actuel puis 1 au nouveau, contre un nouveau joueur

| Profil | Variante | Ancien : profondeur S5 · reliques | Nouveau : profondeur S1 · reliques | Écart de profondeur ancien / nouveau |
|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | Actuel (production) | 575 m · 27/30 | 310 m · 4/30 | +85,5 % |
|  | P — prudente | 552 m · 24/30 | 301 m · 2/30 | +83,4 % |
|  | R — nettement plus rare | 549 m · 24/30 | 296 m · 1/30 | +85,5 % |
|  | R + Aimant réduit (1/1/2/2/3) | 547 m · 23/30 | 296 m · 1/30 | +84,8 % |
| Régulier (1 h/j, 7 j/7, bonus pub) | Actuel (production) | 1 780 m · 30/30 | 1 342 m · 26/30 | +32,6 % |
|  | P — prudente | 1 780 m · 30/30 | 995 m · 7/30 | +78,9 % |
|  | R — nettement plus rare | 1 781 m · 30/30 | 976 m · 3/30 | +82,5 % |
|  | R + Aimant réduit (1/1/2/2/3) | 1 781 m · 30/30 | 976 m · 3/30 | +82,5 % |
| Assidu (3 h/j + 4 h onglet ouvert) | Actuel (production) | 3 383 m · 30/30 | 3 205 m · 30/30 | +5,6 % |
|  | P — prudente | 3 383 m · 30/30 | 2 025 m · 8/30 | +67,1 % |
|  | R — nettement plus rare | 3 384 m · 30/30 | 1 919 m · 5/30 | +76,3 % |
|  | R + Aimant réduit (1/1/2/2/3) | 3 384 m · 30/30 | 1 919 m · 5/30 | +76,3 % |

#### #85 — lots de 10 fragments achetés une fois au début de la saison 1 (sans achat de coffres) — 2 000 joueurs

| Profil | Variante | Lots | Reliques S1 · S4 (médiane, /30) | Profondeur S1 · S4 (médiane) | Gain de profondeur S1 · S2 · S4 vs 0 lot |
|---|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | Actuel (production) | 0 | 2 · 7 | 310 · 375 m | — |
|  |  | 1 | 3 · 8 | 329 · 394 m | +6,1 % · +4,1 % · +5,1 % |
|  |  | 2 | 4 · 9 | 344 · 410 m | +11 % · +5,2 % · +9,3 % |
|  |  | 5 | 6 · 11 | 354 · 428 m | +14,2 % · +13,8 % · +14,1 % |
|  |  | 10 | 8 · 14 | 397 · 451 m | +28,1 % · +22,6 % · +20,3 % |
|  | R — nettement plus rare | 0 | 1 · 2 | 296 · 338 m | — |
|  |  | 1 | 2 · 3 | 319 · 360 m | +7,8 % · +4,3 % · +6,5 % |
|  |  | 2 | 3 · 4 | 327 · 365 m | +10,5 % · +11,8 % · +8 % |
|  |  | 5 | 5 · 7 | 346 · 387 m | +16,9 % · +14,6 % · +14,5 % |
|  |  | 10 | 7 · 9 | 375 · 424 m | +26,7 % · +29,5 % · +25,4 % |
| Régulier (1 h/j, 7 j/7, bonus pub) | Actuel (production) | 0 | 5 · 18 | 990 · 1 295 m | — |
|  |  | 1 | 6 · 19 | 1 007 · 1 314 m | +1,7 % · +1,7 % · +1,5 % |
|  |  | 2 | 7 · 20 | 1 021 · 1 328 m | +3,1 % · +3,2 % · +2,5 % |
|  |  | 5 | 9 · 22 | 1 085 · 1 384 m | +9,6 % · +6,7 % · +6,9 % |
|  |  | 10 | 11 · 24 | 1 136 · 1 431 m | +14,7 % · +11,3 % · +10,5 % |
|  | R — nettement plus rare | 0 | 2 · 7 | 946 · 1 044 m | — |
|  |  | 1 | 3 · 8 | 969 · 1 088 m | +2,4 % · +1,8 % · +4,2 % |
|  |  | 2 | 4 · 9 | 1 003 · 1 123 m | +6 % · +2,1 % · +7,6 % |
|  |  | 5 | 6 · 11 | 1 014 · 1 155 m | +7,2 % · +8,5 % · +10,6 % |
|  |  | 10 | 8 · 14 | 1 108 · 1 201 m | +17,1 % · +14,1 % · +15 % |
| Assidu (3 h/j + 4 h onglet ouvert) | Actuel (production) | 0 | 9 · 30 | 2 018 · 3 276 m | — |
|  |  | 1 | 10 · 30 | 2 060 · 3 317 m | +2,1 % · +1,7 % · +1,3 % |
|  |  | 2 | 11 · 30 | 2 096 · 3 343 m | +3,9 % · +3,3 % · +2 % |
|  |  | 5 | 13 · 30 | 2 180 · 3 374 m | +8 % · +6,8 % · +3 % |
|  |  | 10 | 15 · 30 | 2 267 · 3 384 m | +12,3 % · +11,3 % · +3,3 % |
|  | R — nettement plus rare | 0 | 3 · 13 | 1 873 · 2 241 m | — |
|  |  | 1 | 4 · 14 | 1 919 · 2 271 m | +2,5 % · +2,1 % · +1,3 % |
|  |  | 2 | 5 · 15 | 1 939 · 2 306 m | +3,5 % · +6,1 % · +2,9 % |
|  |  | 5 | 8 · 17 | 2 011 · 2 420 m | +7,4 % · +10,7 % · +8 % |
|  |  | 10 | 10 · 19 | 2 151 · 2 522 m | +14,8 % · +14,9 % · +12,5 % |
