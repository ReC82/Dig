# Ticket #85 — [P1] Boutique — lot de 10 fragments en euros, désactivé et simulation anti-pay-to-win

- Ticket : https://github.com/ReC82/Dig/issues/85 (décision du propriétaire du 06/11/2026)
- Liés : #49 (économie, rareté des fragments, interdiction pièces → fragments), #64 (reliques), #11 (achats simulés
  désactivés), #27 / #33 / #34 (concours, points et lots réels), #25 (anti-triche)

## Session du 06/11/2026 (DIGORCH)

### 1. État réel

**Déployé en production (SHA `b37e232`) — en attente de recette et de décision du propriétaire.** L'offre est **désactivée et non achetable** : rien n'apparaît en jeu, aucun paiement ni crédit de fragments n'est possible.

Classement : **Après lancement** (rien à faire pour la bêta du 09/11 : l'offre est invisible et non
achetable). La décision « fragments contre de l'argent ou non » n'est **pas** bloquante pour le MVP.

### 2. Résultat — ce qui existe maintenant

**Un squelette complet mais inerte.** Aucun paiement, aucun prestataire, aucune collecte bancaire, aucun
crédit de fragments. L'achat de fragments en pièces reste interdit (#49) : rien n'y touche.

Trois verrous indépendants empêchent toute activation par erreur :

1. **Serveur — activation refusée** : passer le drapeau à « activé » renvoie `409 no_payment_provider` tant
   qu'aucun prestataire de paiement n'est branché. Le prestataire est une **constante du code**
   (`PAYMENT_PROVIDER = null`), pas un réglage : il faut un développement, des tests et un déploiement
   pour la changer. En plus : confirmation `ACTIVER` à saisir et note.
2. **Serveur — paiement refusé** : même si le drapeau était forcé en base, `GET /api/fragment-pack`
   répond `{ open: false }` et `POST /api/fragment-pack/checkout` répond `403`. Il n'existe **aucun
   code qui crédite des fragments** ni qui écrit une commande.
3. **Navigateur** : la carte n'apparaît que si le serveur dit l'offre ouverte ; même alors, le bouton
   reste « Indisponible » tant que `Monetization.PAYMENTS_ENABLED` est faux (#11).

| Fichier | Changement |
|---|---|
| `server/fragmentPack.js` (nouveau) | Produit unique `fragments_10` (10 🔮, EUR) ; réglages : drapeau (OFF), prix TTC en centimes (hypothèse 99 = 0,99 €, bornes 0,49–9,99 €), plafond **par compte** (1, bornes 1–10) et **par saison** (1, bornes 1–10, ≤ plafond du compte) — jamais illimité. Journal `fragment_pack_audit` et modèle de commandes `fragment_pack_orders` (référence du prestataire **unique** = idempotence des webhooks, saison, montant TTC, statut) en **ajout seul** (déclencheurs). Calcul du reste achetable (min compte / saison, seules les commandes `paid` comptent). |
| `server/index.js` | `GET /api/admin/economy/fragment-pack`, `PUT …/settings`, `POST …/flag` (admin) ; `GET /api/fragment-pack`, `POST /api/fragment-pack/checkout` (joueur, limité en débit). Initialisation des 3 tables (ajout seul, idempotent). |
| `public/admin/index.html`, `admin.js` | Admin → 💰 Économie → **Lot de fragments (€)** : état, prestataire (« aucun »), commandes (0), prix TTC et plafonds modifiables (confirmation, journalisés), **aperçu de la carte joueur**, bouton « Activer l'offre… » (refusé par le serveur), journal. Zone protégée contre la perte de saisie (#61). |
| `public/js/main.js`, `public/css/style.css` | Onglet Boutique : section « 🔮 Fragments de relique » (effets, usage pour les reliques, gratuité via les coffres, limite et reste, prix total TTC, paiement unique), **masquée** tant que le serveur ne l'ouvre pas ; bouton toujours désactivé sans paiement. |
| `public/js/i18n.js`, `i18n/it.json`, `public/js/locales/it.js` | Textes FR, EN, NL, ES et IT (11 clés `fragpack.*`). |
| `tools/balance/fragment-pack-sim.js` (nouveau), `tools/balance/economy-sim.js` | Simulateur pay-to-win (§ 4) ; le moteur compte désormais les blocs détruits au clic (critère du classement #73), sans changer aucun autre chiffre. |
| `test/fragment-pack-85.test.js`, `test/fragment-pack-sim-85.test.js` (nouveaux), `test/admin-nav.test.js`, `docs/admin-navigation.md` | 11 tests (§ 5) ; nouvelle sous-rubrique documentée. |

Impact joueurs : **aucun** — rien de visible en jeu, 3 tables vides ajoutées (+ 4 réglages), aucune
donnée existante lue ou modifiée.

### 3. SHA, branche et procédure de test

- Branche `feature/85-lot-fragments-euros`, commit de code `804c4bb`. **`develop` = `b37e232`** (fusion), déployé ; le rapport est fusionné juste après (sans redéploiement).
- Tests : `node --test test/fragment-pack-85.test.js test/fragment-pack-sim-85.test.js` ; `npm test` complet.
- Simulation : `node tools/balance/fragment-pack-sim.js --runs 2000` (≈ 35 min sur la machine, 2 cœurs) ;
  `--runs 50 --variants actuel` pour un aperçu en 30 s.

### 4. Simulation anti-pay-to-win (vrai code du jeu, hasard à graine, 2 000 joueurs par ligne)

Hypothèses : profils de #49 (débutant 20 min/j 4 j/7 ; régulier 1 h/j + 1 h d'onglet, pub ; assidu
3 h/j + 4 h d'onglet), reliques d'origine (6 × 5 niveaux, 1 617 🔮), **sans achat de coffres de la
boutique** (hypothèse prudente : avec la conversion pièces → fragments encore ouverte en production,
l'achat compte encore moins), lots crédités au début de la saison et dépensés aussitôt en reliques
(le niveau le moins cher d'abord). Trois barèmes de coffres : **production (tables v1, publiées)**, P et
R de #49 (préréglages non publiés). Mêmes graines avec et sans achat : l'écart ne vient que des
fragments achetés. Le classement saisonnier (#73) compte les **blocs détruits au clic**.

**a) Obtenir 10 🔮 gratuitement (saison 1, sans achat)**

| Profil | Production (v1) | P (#49) | R (#49) |
|---|---|---|---|
| Débutant (20 min/j, 4 j/7 ≈ 1,3 h/sem.) | 85 % y arrivent en S1, médiane **0,7 h** de jeu (J3) | **24 %** seulement en S1 (≈ 2 h nécessaires, #49) | **6 %** en S1 (≈ 3 h, #49) |
| Régulier (1 h/j + onglet) | 100 %, **1 h** (J1) | 99 %, **3 h** (J2) | 91 %, **5,2 h** (J3) |
| Assidu (3 h/j + onglet) | 100 %, **0,5 h** (J1) | 100 %, **2,6 h** (J1) | 100 %, **7 h** (J2) |

Un lot de 10 🔮 = 1 niveau de relique (+ un reste) : Œil du mineur niv. 1 (5 🔮) puis Cœur d'or niv. 1 (8 🔮) au lot suivant.

**b) Effet au classement — production (tables v1), blocs détruits au clic, écart médian du même joueur avec / sans achat (S1 · S4) et rang du payeur médian parmi les non-payeurs de même assiduité (S1 · S4)**

| Scénario d'achat | Débutant | Régulier | Assidu |
|---|---|---|---|
| 1 lot une fois | +5,5 % · +4,2 % — rang 88 % · 81 % | +1,8 % · +1,2 % — 79 % · 67 % | +2,1 % · +0,8 % — 81 % · 67 % |
| 2 lots une fois | +10,7 % · +8,9 % — 99 % · 94 % | +3,5 % · +2,5 % — 92 % · 80 % | +3,9 % · +1,4 % — 94 % · 76 % |
| 5 lots une fois | +14 % · +14,1 % — 100 % · 98 % | +9,7 % · +6,5 % — 100 % · 99 % | +7,7 % · +2,3 % — 100 % · 87 % |
| 10 lots une fois | +27,6 % · +20,7 % — 100 % · 100 % | +14,6 % · +10 % — 100 % · 100 % | +11,8 % · +2,5 % — 100 % · 90 % |
| **Payeur régulier** 1 lot / saison (4 en S4) | +5,5 % · **+11,2 %** — 88 % · 97 % | +1,8 % · +2,6 % — 79 % · 83 % | +2,1 % · +1,4 % — 81 % · 73 % |
| 2 lots / saison | +10,7 % · +15,1 % — 99 % · 99 % | +3,5 % · +5,9 % — 92 % · 98 % | +3,9 % · +2 % — 94 % · 85 % |
| 5 lots / saison | +14 % · +28,1 % — 100 % · 100 % | +9,7 % · +11,1 % — 100 % · 100 % | +7,7 % · +2,5 % — 100 % · 90 % |
| 10 lots / saison (40 en S4) | +27,6 % · **+38,8 %** — 100 % · 100 % | +14,6 % · **+22,2 %** — 100 % · 100 % | +11,8 % · +2,5 % — 100 % · 90 % |
| **Protection A** : mission gratuite 10 🔮 pour tous + 1 lot à vie (vs non-payeur ayant fait la mission) | +4,7 % · +3,6 % — 83 % · 76 % | +1,5 % · +1,1 % — 75 % · 67 % | +1,7 % · +0,4 % — 76 % · 61 % |

Avec P ou R (fragments plus rares), le même lot pèse **plus longtemps** : payeur régulier 1 lot / saison,
débutant S4 +7,3 % (P) et +9,3 % (R) ; régulier S4 +3 % (P) et **+8,6 %** (R) contre +2,6 % aujourd'hui ;
assidu +3,1 % (P) et +3,7 % (R) — l'assidu n'atteint plus les 30/30 qui « effacent » l'achat. Tables
complètes en annexe.

**Lecture**

- **Le temps de jeu domine** : un débutant qui achète 10 lots chaque saison (517 blocs au clic en S4)
  reste très loin d'un régulier non-payeur (1 224). Un achat ne fait pas monter d'une catégorie d'assiduité.
- **Mais à assiduité égale, l'achat décide** : les joueurs d'un même profil sont serrés ; **un seul lot**
  place le payeur médian devant **≈ 80 à 90 %** des non-payeurs de même assiduité en S1. Au sommet du
  classement (assidus entre eux), c'est exactement là que se jouent les lots réels.
- **Risque cumulatif** : un achat unique s'efface (assidu : 30/30 reliques atteint en S4 de toute façon) ;
  un **payeur régulier** creuse l'écart saison après saison (débutant +5,5 % → +11,2 %, 10 lots/saison
  +27,6 % → +38,8 %). Seul un plafond **par compte à vie** empêche ce cumul ; un plafond par saison ne le
  fait pas.
- **La mission gratuite équivalente** (protection A) réduit l'écart à +0,4 à +4,7 % mais ne l'annule pas :
  le payeur a toujours 10 🔮 de plus.
- Plafond d'effets possible (non simulé) : fragments achetés utilisables seulement pour les niveaux 1–2 des
  reliques (≤ 5 + 8 + 12 + … 🔮) ; il limite le gain total mais pas l'avance en début de saison.

### 5. Vérifications effectuées

- `npm test` : **872/872** sur la branche, puis **872/872** sur l'arbre exact de la release `b37e232`.
- Nouveaux tests : désactivé par défaut et hypothèses 0,99 € / 1 / 1 ; activation refusée (409) sans
  prestataire, refus non journalisé ; prix et plafonds bornés (0, 1000, 0,99, texte, 0, 11, null, ∞
  refusés ; saison > compte refusé), journal en ajout seul ; drapeau forcé en base → toujours fermé,
  vue joueur `{ open: false }`, paiement 403 ; plafonds compte ET saison (commandes insérées sur base
  de test, remboursée non comptée, référence prestataire unique, commandes non modifiables) ; aucun
  code de crédit ni d'appel externe ; 5 langues ; HTTP (routes admin 401 sans clé ou en joueur,
  `ACTIVER` requis puis 409, prix hors bornes 400, joueur `{ open: false }`, paiement 403).
  Simulateur : reproductible, 0 lot = base, « mission + 1 lot » = « 2 lots » en S1, emploi du temps.
- Serveur de test (port 3101, base `test-85.sqlite`, supprimée) + Chromium headless 1280×900 et
  390×844 : sous-rubrique affichée, tentative d'activation → message de refus du serveur, prix
  0,99 → 1,49 € enregistré et journalisé, état toujours « désactivée — non achetable » ; en jeu,
  aucune section tant que l'offre est fermée ; réponse serveur « ouverte » simulée (interception) →
  carte pleine largeur, NL et FR lisibles, bouton « Indisponible » / « Niet beschikbaar » désactivé,
  aucun débordement, aucune erreur JavaScript. Serveur arrêté.
- **Non fait (volontairement)** : aucun prestataire, aucun paiement de test, aucune clé, aucune
  écriture dans `fragment_pack_orders` hors base de test.

### 6. Déploiement du 06/11 et test à faire

- **`b37e232` déployé le 06/11 à 21:37 (Bruxelles)** : tests 872/872 sur la release ; copie de la base de
  production démarrée sur le port 3122 (santé et version OK, 3 tables ajoutées avec `enabled = 0`,
  prix 99, plafonds 1/1, 0 commande) ; empreintes de `users`, `user_saves`, `season_rankings`,
  `seasons`, `leagues`, `player_click_tracking` identiques avant/après ; `main` avancé en avance rapide
  (`c5ae266` → `b37e232`) ; `deploy.sh` : sauvegarde vérifiée `dig-20261106-213731-pre-deploy-b37e232.sqlite`,
  santé et version vérifiées. Après : deux domaines 200 + `1.0.0+b37e232`, journal sans erreur,
  `quick_check` ok, empreintes des six tables identiques à la sauvegarde, `GET /api/fragment-pack` 401
  sans session. Aucune génération IA en cours au moment du redémarrage.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep c5ae266` + `sudo systemctl restart dig`
  (lock inchangé ; les 3 tables ajoutées restent, vides et sans effet).

**Test fonctionnel à faire par le propriétaire (≈ 3 min)**

1. Jeu → 🛒 Boutique : **aucune** section « Fragments de relique » (attendu : l'offre est désactivée).
2. Admin → 💰 Économie → **Lot de fragments (€)** : état « désactivée — non achetable », prestataire
   « aucun », commandes 0, prix 0,99 €, plafonds 1 / 1, aperçu de la carte joueur.
3. « Activer l'offre… » → saisir `ACTIVER` → attendu : **refus** « Activation refusée : aucun prestataire
   de paiement n'est branché… » ; l'état ne change pas.
4. (Facultatif) changer le prix (ex. 1,49) avec une note → « Enregistré (offre toujours désactivée) » et
   une ligne au journal ; remettez 0,99 si vous voulez. Rien ne change en jeu.
5. Lire § 4 et § 8 et répondre à la décision 1 (scénario 1 ou 2).

### 7. Analyse de conformité — à faire valider avant tout paiement réel (pas un avis juridique)

| Sujet | Règle (Belgique / UE) | Conséquence pour le lot |
|---|---|---|
| **Loot boxes** | Belgique : les « loot boxes » payantes sont des jeux de hasard interdits sans licence (Commission des jeux de hasard, 2018). | Le lot doit rester **à contenu fixe** (10 🔮) ; les fragments achetés ne doivent **jamais** pouvoir payer un tirage aléatoire (coffres). Aujourd'hui les fragments ne paient que des reliques (déterministes) : à préserver. |
| **Compétition à lots réels** | Concours / points / boutique de cadeaux (#27, #33, #34) : un avantage payant dans un classement qui donne des lots réels expose à la qualification de jeu de hasard ou de pratique déloyale, et ruine l'équité. | **Pas de fragments payants tant que le classement donne des lots réels**, ou exclure les payeurs de ces lots (complexe). Voir § 8. |
| **Prix** | Code de droit économique (CDE) VI.3–VI.5 : prix total TTC, clair, avant l'achat ; monnaie réelle affichée à côté de la monnaie du jeu (principes CPC « monnaies virtuelles », 2025). | Carte : « Prix total TTC », quantité exacte, usage, limite — prévus. |
| **Droit de rétractation (14 jours)** | Directive 2011/83/UE art. 16 m) / CDE VI.53 13° : perdu pour un contenu numérique fourni immédiatement **seulement** avec consentement exprès préalable + reconnaissance de la perte du droit + confirmation sur support durable (e-mail). | Case à cocher dédiée avant paiement, e-mail de confirmation (SMTP #43), sinon remboursement possible 14 jours. |
| **Mineurs** | Directive pratiques commerciales déloyales, annexe I point 28 : interdit d'inciter directement les enfants à acheter ; contrats des mineurs annulables (sauf petits achats courants) ; RGPD : âge numérique 13 ans en Belgique. | Aucun message d'incitation (« Achète maintenant ! »), pas de minuterie ni de pression, pas de mise en avant après un échec ; limite par compte ; prévoir une politique de remboursement parental. |
| **TVA** | Service électronique B2C : TVA du pays du client (guichet unique OSS) ; 21 % en Belgique → 0,99 € TTC = 0,82 € HT. | Soit prestataire « marchand officiel » (Merchant of Record : Paddle, Lemon Squeezy… — il collecte et reverse la TVA), soit Stripe + Stripe Tax + inscription OSS. Coût du prestataire sur 0,99 € : souvent 0,30 € + % → **marge faible**. |
| **Conditions et transparence** | CDE VI.45 : informations précontractuelles, conditions générales de vente, identité du vendeur, facture. | CGV à rédiger, page légale (#27/legal.js), reçu. |
| **Paiement sûr** | DSP2 (authentification forte, via le prestataire), PCI-DSS (aucune donnée de carte chez Dig). | Paiement hébergé par le prestataire ; webhooks **signés** ; idempotence (référence unique prévue) ; anti-fraude du prestataire ; remboursements et contestations (chargebacks) → **reprise** des fragments ou gel. |
| **Livraison atomique** | — | **Prérequis technique** : aujourd'hui les fragments sont calculés par le navigateur (#49 § 2). Il faut d'abord un **registre serveur des fragments** (comme le registre de gemmes #49), sinon impossible de livrer, plafonner, reprendre ou restaurer de façon fiable. |

### 8. Décisions demandées au propriétaire

1. **Vendre des fragments contre de l'argent ?** Deux scénarios précis :
   - **Scénario 1 — « Lot unique de bienvenue »** : 1 lot de 10 🔮 **par compte, à vie** (pas par saison),
     0,99 € TTC, **plus une mission gratuite unique de 10 🔮 pour tous** ; activé seulement quand (a) le
     classement saisonnier ne donne plus de lots réels **ou** que la conformité l'a validé, (b) le registre
     serveur des fragments existe, (c) un prestataire Merchant of Record est intégré. Effet mesuré § 4 :
     avantage au classement +4,7 % (débutant), +1,5 % (régulier), +1,7 % (assidu) en S1, qui s'efface en S4 (+0,4 à +3,6 %), sans cumul possible ; le payeur médian reste devant ≈ 75–83 % des non-payeurs de même assiduité en S1.
   - **Scénario 2 — « Aucun fragment contre de l'argent »** (recommandé) : les fragments restent 100 %
     gagnés en jeu ; la boutique en euros ne vend que du cosmétique ou du confort sans effet sur le
     classement (pioches/skins, cadres de profil, badge de soutien « Supporter », éventuellement ramassage
     automatique déjà à l'étude dans #49). Avantage au classement : nul. Le squelette #85 reste en place,
     désactivé, réutilisable pour un article cosmétique.
   **Recommandation : scénario 2** tant que le classement, les points et la boutique de cadeaux donnent des
   lots réels (#27/#33/#34) — même un seul lot fait passer le payeur médian au-dessus de la majorité des
   joueurs de même assiduité (§ 4) ; et parce qu'à 0,99 € la marge après frais et TVA est faible.
   Le scénario 1 reste possible plus tard, après la bêta, si les lots réels disparaissent.
2. **Si scénario 1** : confirmer prix (0,99 € TTC), plafond (1 par compte à vie), et la mission gratuite
   équivalente. Rien de cela n'est appliqué aujourd'hui.

### 9. Choix techniques faits seul

- **Activation verrouillée par le code** (prestataire = constante) plutôt que par un simple réglage : la
  demande « ne pas laisser l'offre activable par erreur » ne peut pas dépendre d'un clic d'admin.
- Même structure que la boutique en gemmes (#49 lot 2.6) : drapeau OFF journalisé, tables en ajout seul,
  vue joueur `{ open: false }`, confirmation à saisir.
- Plafonds **par compte ET par saison**, tous deux finis (1–10) ; le plafond de saison ne peut pas dépasser
  celui du compte (sinon il n'aurait aucun sens).
- Table de commandes créée mais **jamais écrite** : elle fixe le modèle (référence unique du prestataire
  pour rejouer un webhook sans double crédit) sans livrer de paiement fictif.
- Carte joueur masquée tant que l'offre est fermée (pas de prix non approuvé montré aux bêta-testeurs) ;
  l'aperçu est dans l'admin.
- Simulation sans achat de coffres de la boutique : c'est le cas où un lot pèse le plus pour un
  non-converti ; les chiffres de #49 « avec achats » montrent un effet encore plus dilué.

### 10. Reste à réaliser

- Décision du propriétaire (§ 8). Aucun développement supplémentaire n'est utile avant.
- Si scénario 1 : registre serveur des fragments (prérequis, avec #25/#77), intégration d'un prestataire
  (webhooks signés, livraison atomique, remboursement/chargeback, reprise), CGV et consentement de
  rétractation, e-mail de confirmation, revue de conformité, puis feu vert écrit.
- Si scénario 2 : réutiliser le squelette pour un article cosmétique (ticket à créer par le propriétaire).

### Annexe — sortie complète de `node tools/balance/fragment-pack-sim.js --runs 2000` (06/11, 1 806 s)

#### 1. Obtenir 10 fragments gratuitement (saison 1, sans achat) — 2 000 joueurs par ligne

| Profil | Barème | Atteint en S1 | Heures de jeu (médiane · p90) | Jour de saison (médiane · p90) |
|---|---|---|---|---|
| Débutant (20 min/j, 4 j/7) | Production (tables v1) | 85 % | 0,7 h · 1,1 h | J3 · J6 |
|  | P — prudente (#49) | 24 % | 1 h · 1,3 h | J5 · J6 |
|  | R — nettement plus rare (#49) | 6 % | 1,1 h · 1,3 h | J6 · J6 |
| Régulier (1 h/j, 7 j/7, bonus pub) | Production (tables v1) | 100 % | 1 h · 2,1 h | J1 · J2 |
|  | P — prudente (#49) | 99 % | 3 h · 6,3 h | J2 · J4 |
|  | R — nettement plus rare (#49) | 91 % | 5,2 h · 10,3 h | J3 · J6 |
| Assidu (3 h/j + 4 h onglet ouvert) | Production (tables v1) | 100 % | 0,5 h · 1 h | J1 · J1 |
|  | P — prudente (#49) | 100 % | 2,6 h · 7 h | J1 · J2 |
|  | R — nettement plus rare (#49) | 100 % | 7 h · 14 h | J2 · J3 |

Heures de jeu = actif + onglet ouvert, comme dans les rapports #49. « Jour » = jour de la saison de 7 jours (J8 = pas atteint dans la saison).

##### 2. Payeurs vs non-payeur — Production (tables v1) — 2 000 joueurs par ligne, mêmes graines

Colonnes S1 · S2 · S4. « Blocs au clic » = critère du classement saisonnier (#73). « Gain » = écart médian de blocs au clic du même joueur avec et sans achat. « Rang » = centile du payeur médian parmi les non-payeurs du même profil (50 % = au milieu).

##### Débutant (20 min/j, 4 j/7)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 2 · 3 · 7 | 310 · 373 m | 309 · 372 | — | — | — |
| 1 lot une fois (S1) | 1 | 3 · 4 · 8 | 328 · 394 m | 327 · 393 | +5,5 % · +3,9 % · +4,2 % | +12,3 % | 88 % · 81 % |
| 2 lots une fois (S1) | 2 | 4 · 5 · 9 | 344 · 411 m | 343 · 410 | +10,7 % · +5,2 % · +8,9 % | +17,8 % | 99 % · 94 % |
| 5 lots une fois (S1) | 5 | 6 · 8 · 11 | 354 · 427 m | 353 · 426 | +14 % · +13,7 % · +14,1 % | +23 % | 100 % · 98 % |
| 10 lots une fois (S1) | 10 | 8 · 10 · 14 | 398 · 451 m | 397 · 450 | +27,6 % · +22,4 % · +20,7 % | +30,1 % | 100 % · 100 % |
| 1 lot chaque saison | 4 | 3 · 5 · 10 | 328 · 418 m | 327 · 417 | +5,5 % · +4,8 % · +11,2 % | +19,8 % | 88 % · 97 % |
| 2 lots chaque saison | 8 | 4 · 7 · 12 | 344 · 431 m | 343 · 430 | +10,7 % · +7,5 % · +15,1 % | +24,2 % | 99 % · 99 % |
| 5 lots chaque saison | 20 | 6 · 10 · 16 | 354 · 478 m | 353 · 477 | +14 % · +21,6 % · +28,1 % | +37,3 % | 100 % · 100 % |
| 10 lots chaque saison | 40 | 8 · 13 · 21 | 398 · 518 m | 397 · 517 | +27,6 % · +30,5 % · +38,8 % | +49,1 % | 100 % · 100 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 3 · 4 · 8 | 328 · 394 m | 327 · 393 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 4 · 5 · 9 | 344 · 411 m | 343 · 410 | +4,7 % · +1,1 % · +3,6 % | +11 % | 83 % · 76 % |

##### Régulier (1 h/j, 7 j/7, bonus pub)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 5 · 10 · 18 | 989 · 1 294 m | 947 · 1 224 | — | — | — |
| 1 lot une fois (S1) | 1 | 6 · 10 · 19 | 1 006 · 1 312 m | 965 · 1 241 | +1,8 % · +1,7 % · +1,2 % | +4,3 % | 79 % · 67 % |
| 2 lots une fois (S1) | 2 | 7 · 11 · 20 | 1 020 · 1 327 m | 979 · 1 254 | +3,5 % · +2,9 % · +2,5 % | +6,4 % | 92 % · 80 % |
| 5 lots une fois (S1) | 5 | 9 · 13 · 22 | 1 083 · 1 383 m | 1 041 · 1 306 | +9,7 % · +6,2 % · +6,5 % | +11 % | 100 % · 99 % |
| 10 lots une fois (S1) | 10 | 11 · 16 · 24 | 1 135 · 1 431 m | 1 086 · 1 347 | +14,6 % · +10,9 % · +10 % | +14,6 % | 100 % · 100 % |
| 1 lot chaque saison | 4 | 6 · 11 · 20 | 1 006 · 1 331 m | 965 · 1 257 | +1,8 % · +2,5 % · +2,6 % | +6,1 % | 79 % · 83 % |
| 2 lots chaque saison | 8 | 7 · 12 · 22 | 1 020 · 1 374 m | 979 · 1 298 | +3,5 % · +4,4 % · +5,9 % | +9,8 % | 92 % · 98 % |
| 5 lots chaque saison | 20 | 9 · 15 · 25 | 1 083 · 1 445 m | 1 041 · 1 358 | +9,7 % · +9 % · +11,1 % | +15,9 % | 100 % · 100 % |
| 10 lots chaque saison | 40 | 11 · 18 · 29 | 1 135 · 1 610 m | 1 086 · 1 494 | +14,6 % · +16,1 % · +22,2 % | +28,5 % | 100 % · 100 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 6 · 10 · 19 | 1 006 · 1 312 m | 965 · 1 241 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 7 · 11 · 20 | 1 020 · 1 327 m | 979 · 1 254 | +1,5 % · +1,1 % · +1,1 % | +4,2 % | 75 % · 67 % |

##### Assidu (3 h/j + 4 h onglet ouvert)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 9 · 17 · 30 | 2 017 · 3 279 m | 1 916 · 2 970 | — | — | — |
| 1 lot une fois (S1) | 1 | 10 · 18 · 30 | 2 059 · 3 319 m | 1 957 · 2 999 | +2,1 % · +1,5 % · +0,8 % | +3,8 % | 81 % · 67 % |
| 2 lots une fois (S1) | 2 | 11 · 19 · 30 | 2 093 · 3 344 m | 1 987 · 3 013 | +3,9 % · +2,9 % · +1,4 % | +4,8 % | 94 % · 76 % |
| 5 lots une fois (S1) | 5 | 13 · 21 · 30 | 2 179 · 3 374 m | 2 065 · 3 035 | +7,7 % · +6,5 % · +2,3 % | +6,4 % | 100 % · 87 % |
| 10 lots une fois (S1) | 10 | 15 · 23 · 30 | 2 265 · 3 382 m | 2 143 · 3 043 | +11,8 % · +10,6 % · +2,5 % | +7 % | 100 % · 90 % |
| 1 lot chaque saison | 4 | 10 · 19 · 30 | 2 059 · 3 337 m | 1 957 · 3 009 | +2,1 % · +2 % · +1,4 % | +4,5 % | 81 % · 73 % |
| 2 lots chaque saison | 8 | 11 · 20 · 30 | 2 093 · 3 365 m | 1 987 · 3 030 | +3,9 % · +3,9 % · +2 % | +5,7 % | 94 % · 85 % |
| 5 lots chaque saison | 20 | 13 · 22 · 30 | 2 179 · 3 385 m | 2 065 · 3 043 | +7,7 % · +8,7 % · +2,5 % | +7,2 % | 100 % · 90 % |
| 10 lots chaque saison | 40 | 15 · 25 · 30 | 2 265 · 3 385 m | 2 143 · 3 044 | +11,8 % · +13,5 % · +2,5 % | +7,1 % | 100 % · 90 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 10 · 18 · 30 | 2 059 · 3 319 m | 1 957 · 2 999 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 11 · 19 · 30 | 2 093 · 3 344 m | 1 987 · 3 013 | +1,7 % · +1,2 % · +0,4 % | +2,7 % | 76 % · 61 % |

##### 2. Payeurs vs non-payeur — P — prudente (#49) — 2 000 joueurs par ligne, mêmes graines

Colonnes S1 · S2 · S4. « Blocs au clic » = critère du classement saisonnier (#73). « Gain » = écart médian de blocs au clic du même joueur avec et sans achat. « Rang » = centile du payeur médian parmi les non-payeurs du même profil (50 % = au milieu).

##### Débutant (20 min/j, 4 j/7)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 1 · 2 · 3 | 301 · 353 m | 300 · 352 | — | — | — |
| 1 lot une fois (S1) | 1 | 2 · 3 · 4 | 320 · 364 m | 319 · 363 | +6,3 % · +4,4 % · +3 % | +11,8 % | 87 % · 73 % |
| 2 lots une fois (S1) | 2 | 3 · 4 · 5 | 335 · 368 m | 334 · 367 | +10,8 % · +10,5 % · +4,5 % | +13,6 % | 98 % · 79 % |
| 5 lots une fois (S1) | 5 | 5 · 6 · 8 | 350 · 406 m | 349 · 405 | +15,8 % · +13,4 % · +15 % | +25,5 % | 100 % · 100 % |
| 10 lots une fois (S1) | 10 | 8 · 8 · 11 | 384 · 427 m | 383 · 426 | +26,8 % · +28,1 % · +21 % | +31,2 % | 100 % · 100 % |
| 1 lot chaque saison | 4 | 2 · 3 · 7 | 320 · 377 m | 319 · 376 | +6,3 % · +9,3 % · +7,3 % | +16,6 % | 87 % · 91 % |
| 2 lots chaque saison | 8 | 3 · 5 · 9 | 335 · 418 m | 334 · 417 | +10,8 % · +11,3 % · +18,5 % | +28,8 % | 98 % · 100 % |
| 5 lots chaque saison | 20 | 5 · 8 · 13 | 350 · 453 m | 349 · 452 | +15,8 % · +26,8 % · +28,4 % | +39,2 % | 100 % · 100 % |
| 10 lots chaque saison | 40 | 8 · 12 · 18 | 384 · 505 m | 383 · 504 | +26,8 % · +35,2 % · +43,4 % | +55,2 % | 100 % · 100 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 2 · 3 · 4 | 320 · 364 m | 319 · 363 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 3 · 4 · 5 | 335 · 368 m | 334 · 367 | +4,2 % · +5,9 % · +0,9 % | +7,6 % | 82 % · 59 % |

##### Régulier (1 h/j, 7 j/7, bonus pub)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 2 · 5 · 10 | 955 · 1 130 m | 912 · 1 081 | — | — | — |
| 1 lot une fois (S1) | 1 | 3 · 6 · 11 | 987 · 1 146 m | 945 · 1 091 | +3,5 % · +0,7 % · +1 % | +4,2 % | 92 % · 65 % |
| 2 lots une fois (S1) | 2 | 4 · 7 · 12 | 1 006 · 1 161 m | 966 · 1 102 | +6 % · +2,5 % · +2,1 % | +6 % | 99 % · 80 % |
| 5 lots une fois (S1) | 5 | 7 · 9 · 14 | 1 026 · 1 202 m | 986 · 1 142 | +8 % · +10,5 % · +5,7 % | +10 % | 100 % · 99 % |
| 10 lots une fois (S1) | 10 | 9 · 12 · 16 | 1 115 · 1 268 m | 1 072 · 1 203 | +17,5 % · +13,2 % · +11,4 % | +15,9 % | 100 % · 100 % |
| 1 lot chaque saison | 4 | 3 · 7 · 12 | 987 · 1 171 m | 945 · 1 111 | +3,5 % · +1,5 % · +3 % | +6,5 % | 92 % · 89 % |
| 2 lots chaque saison | 8 | 4 · 8 · 14 | 1 006 · 1 203 m | 966 · 1 144 | +6 % · +6,5 % · +5,9 % | +10,3 % | 99 % · 99 % |
| 5 lots chaque saison | 20 | 7 · 11 · 18 | 1 026 · 1 315 m | 986 · 1 241 | +8 % · +12,4 % · +14,9 % | +19,2 % | 100 % · 100 % |
| 10 lots chaque saison | 40 | 9 · 15 · 23 | 1 115 · 1 424 m | 1 072 · 1 345 | +17,5 % · +18,7 % · +24,6 % | +29,5 % | 100 % · 100 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 3 · 6 · 11 | 987 · 1 146 m | 945 · 1 091 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 4 · 7 · 12 | 1 006 · 1 161 m | 966 · 1 102 | +2,2 % · +1,5 % · +0,9 % | +4,1 % | 82 % · 66 % |

##### Assidu (3 h/j + 4 h onglet ouvert)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 5 · 9 · 18 | 1 907 · 2 448 m | 1 808 · 2 298 | — | — | — |
| 1 lot une fois (S1) | 1 | 6 · 10 · 19 | 1 933 · 2 491 m | 1 836 · 2 334 | +1,5 % · +1,9 % · +1,4 % | +4,3 % | 80 % · 74 % |
| 2 lots une fois (S1) | 2 | 7 · 11 · 20 | 1 954 · 2 521 m | 1 858 · 2 361 | +2,9 % · +3,4 % · +3 % | +6,1 % | 94 % · 88 % |
| 5 lots une fois (S1) | 5 | 9 · 13 · 22 | 2 077 · 2 642 m | 1 976 · 2 476 | +9,2 % · +6,6 % · +7,5 % | +11,1 % | 100 % · 100 % |
| 10 lots une fois (S1) | 10 | 11 · 16 · 24 | 2 173 · 2 727 m | 2 059 · 2 545 | +14 % · +11,5 % · +10,8 % | +14,8 % | 100 % · 100 % |
| 1 lot chaque saison | 4 | 6 · 11 · 20 | 1 933 · 2 523 m | 1 836 · 2 363 | +1,5 % · +2,7 % · +3,1 % | +6 % | 80 % · 89 % |
| 2 lots chaque saison | 8 | 7 · 12 · 22 | 1 954 · 2 619 m | 1 858 · 2 450 | +2,9 % · +4,7 % · +6,6 % | +9,9 % | 94 % · 100 % |
| 5 lots chaque saison | 20 | 9 · 15 · 25 | 2 077 · 2 753 m | 1 976 · 2 564 | +9,2 % · +9,6 % · +12 % | +15,9 % | 100 % · 100 % |
| 10 lots chaque saison | 40 | 11 · 18 · 29 | 2 173 · 3 102 m | 2 059 · 2 841 | +14 % · +16,7 % · +23,7 % | +29,4 % | 100 % · 100 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 6 · 10 · 19 | 1 933 · 2 491 m | 1 836 · 2 334 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 7 · 11 · 20 | 1 954 · 2 521 m | 1 858 · 2 361 | +1,2 % · +1,4 % · +1,2 % | +4,1 % | 77 % · 72 % |

##### 2. Payeurs vs non-payeur — R — nettement plus rare (#49) — 2 000 joueurs par ligne, mêmes graines

Colonnes S1 · S2 · S4. « Blocs au clic » = critère du classement saisonnier (#73). « Gain » = écart médian de blocs au clic du même joueur avec et sans achat. « Rang » = centile du payeur médian parmi les non-payeurs du même profil (50 % = au milieu).

##### Débutant (20 min/j, 4 j/7)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 1 · 1 · 2 | 297 · 338 m | 296 · 337 | — | — | — |
| 1 lot une fois (S1) | 1 | 2 · 2 · 3 | 318 · 359 m | 317 · 358 | +7 % · +4,1 % · +6 % | +14,6 % | 90 % · 87 % |
| 2 lots une fois (S1) | 2 | 3 · 3 · 4 | 327 · 366 m | 326 · 365 | +10,2 % · +11,9 % · +8,2 % | +17 % | 97 % · 93 % |
| 5 lots une fois (S1) | 5 | 5 · 6 · 7 | 346 · 387 m | 345 · 386 | +16,3 % · +14,6 % · +14,2 % | +24,7 % | 100 % · 99 % |
| 10 lots une fois (S1) | 10 | 7 · 8 · 9 | 374 · 424 m | 373 · 423 | +25,7 % · +29,1 % · +25,2 % | +35,5 % | 100 % · 100 % |
| 1 lot chaque saison | 4 | 2 · 3 · 6 | 318 · 370 m | 317 · 369 | +7 % · +10,5 % · +9,3 % | +17,7 % | 90 % · 95 % |
| 2 lots chaque saison | 8 | 3 · 5 · 8 | 327 · 411 m | 326 · 410 | +10,2 % · +12,7 % · +21,1 % | +31,2 % | 97 % · 100 % |
| 5 lots chaque saison | 20 | 5 · 8 · 13 | 346 · 451 m | 345 · 450 | +16,3 % · +27,7 % · +33,3 % | +43,3 % | 100 % · 100 % |
| 10 lots chaque saison | 40 | 7 · 12 · 18 | 374 · 494 m | 373 · 493 | +25,7 % · +35,1 % · +46,1 % | +57,3 % | 100 % · 100 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 2 · 2 · 3 | 318 · 359 m | 317 · 358 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 3 · 3 · 4 | 327 · 366 m | 326 · 365 | +1,9 % · +7,1 % · +1,7 % | +9,8 % | 71 % · 63 % |

##### Régulier (1 h/j, 7 j/7, bonus pub)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 2 · 3 · 7 | 947 · 1 043 m | 904 · 998 | — | — | — |
| 1 lot une fois (S1) | 1 | 3 · 4 · 8 | 970 · 1 092 m | 928 · 1 043 | +2,8 % · +2,1 % · +3,7 % | +8,1 % | 87 % · 86 % |
| 2 lots une fois (S1) | 2 | 4 · 5 · 9 | 1 002 · 1 123 m | 962 · 1 077 | +6,4 % · +2,4 % · +7,1 % | +11,5 % | 100 % · 97 % |
| 5 lots une fois (S1) | 5 | 6 · 8 · 11 | 1 013 · 1 155 m | 972 · 1 097 | +7,6 % · +9 % · +9,9 % | +14,4 % | 100 % · 99 % |
| 10 lots une fois (S1) | 10 | 8 · 10 · 13 | 1 107 · 1 201 m | 1 064 · 1 142 | +17,7 % · +14 % · +14,3 % | +19,4 % | 100 % · 100 % |
| 1 lot chaque saison | 4 | 3 · 5 · 10 | 970 · 1 136 m | 928 · 1 087 | +2,8 % · +2,3 % · +8,6 % | +12,5 % | 87 % · 98 % |
| 2 lots chaque saison | 8 | 4 · 7 · 12 | 1 002 · 1 162 m | 962 · 1 102 | +6,4 % · +3,9 % · +10,2 % | +14,6 % | 100 % · 99 % |
| 5 lots chaque saison | 20 | 6 · 10 · 16 | 1 013 · 1 269 m | 972 · 1 205 | +7,6 % · +13,7 % · +20,6 % | +25,5 % | 100 % · 100 % |
| 10 lots chaque saison | 40 | 8 · 13 · 21 | 1 107 · 1 357 m | 1 064 · 1 283 | +17,7 % · +19,3 % · +28,5 % | +34,9 % | 100 % · 100 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 3 · 4 · 8 | 970 · 1 092 m | 928 · 1 043 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 4 · 5 · 9 | 1 002 · 1 123 m | 962 · 1 077 | +3,5 % · +0,3 % · +2,8 % | +7,7 % | 90 % · 81 % |

##### Assidu (3 h/j + 4 h onglet ouvert)

| Scénario | Lots cumulés S4 | Reliques /30 (S1 · S2 · S4) | Profondeur S1 · S4 | Blocs au clic S1 · S4 | Gain S1 · S2 · S4 (médiane) | Gain S4 p90 | Rang S1 · S4 |
|---|---|---|---|---|---|---|---|
| Non-payeur | 0 | 3 · 6 · 13 | 1 874 · 2 240 m | 1 773 · 2 108 | — | — | — |
| 1 lot une fois (S1) | 1 | 4 · 7 · 14 | 1 918 · 2 270 m | 1 821 · 2 139 | +2,6 % · +2,2 % · +1,4 % | +4,2 % | 88 % · 74 % |
| 2 lots une fois (S1) | 2 | 5 · 8 · 15 | 1 940 · 2 303 m | 1 844 · 2 173 | +3,9 % · +5,7 % · +3,2 % | +6,6 % | 97 % · 92 % |
| 5 lots une fois (S1) | 5 | 8 · 11 · 17 | 2 012 · 2 421 m | 1 912 · 2 276 | +7,9 % · +10,2 % · +8 % | +11,4 % | 100 % · 100 % |
| 10 lots une fois (S1) | 10 | 10 · 13 · 19 | 2 151 · 2 522 m | 2 046 · 2 360 | +15,2 % · +13,8 % · +12 % | +15,8 % | 100 % · 100 % |
| 1 lot chaque saison | 4 | 4 · 8 · 15 | 1 918 · 2 317 m | 1 821 · 2 184 | +2,6 % · +4 % · +3,7 % | +7 % | 88 % · 94 % |
| 2 lots chaque saison | 8 | 5 · 9 · 17 | 1 940 · 2 414 m | 1 844 · 2 271 | +3,9 % · +8,5 % · +7,6 % | +10,8 % | 97 % · 100 % |
| 5 lots chaque saison | 20 | 8 · 13 · 21 | 2 012 · 2 592 m | 1 912 · 2 428 | +7,9 % · +12,8 % · +15,3 % | +19,5 % | 100 % · 100 % |
| 10 lots chaque saison | 40 | 10 · 16 · 25 | 2 151 · 2 765 m | 2 046 · 2 566 | +15,2 % · +20,2 % · +22,3 % | +26,9 % | 100 % · 100 % |
| Non-payeur + mission gratuite 10 🔮 (S1) | 0 | 4 · 7 · 14 | 1 918 · 2 270 m | 1 821 · 2 139 | — | — | — |
| Mission gratuite + 1 lot à vie (vs « Non-payeur + mission gratuite 10 🔮 (S1) ») | 1 | 5 · 8 · 15 | 1 940 · 2 303 m | 1 844 · 2 173 | +1,2 % · +3 % · +1,6 % | +4,6 % | 77 % · 76 % |

