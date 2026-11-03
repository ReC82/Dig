# Ticket #34 — Boutique de cadeaux : catalogue, échange de points et remise des lots

- Ticket : [#34 — [P1] Boutique de cadeaux — catalogue, échange de points et remise des lots](https://github.com/ReC82/Dig/issues/34)
- Session : 30/10/2026 (session 1)
- Classement MVP : **Après lancement.** Le jeu peut être partagé sans boutique ; elle prend son sens
  après la première clôture créditée (lundi 02/11) et quand tu auras choisi les premiers articles.

## 1. État réel

**Déployé en production (SHA `36b9e70`) le 30/10/2026 à 16:30 (Bruxelles) — en attente de recette.**
Phase 1 du ticket : catalogue + échanges contre **récompenses virtuelles** (remise manuelle).
Les cadeaux réels peuvent figurer au catalogue mais affichent « Bientôt » et sont **refusés** tant que
`CONTEST_REAL_PRIZES` ≠ `on` (#27). **Le catalogue est vide** en production : aucun article n'a été
inventé (contenu et prix = décision produit, voir § 8).

## 2. Réconciliation et dépendances

Aucune branche, PR ni rapport antérieur pour #34. Dépendance principale #33 livrée et déployée
(portefeuille, `rewardPoints.spend()/refund()`, crédit réel actif depuis le 30/10 15:49). #27 :
développement débloqué, réel verrouillé. #28 (e-mail vérifié) utilisé pour le réel. #30 (admin
concours) : même modèle de verrou. #13 (sauvegardes) : en place localement.

## 3. Résultat et changements

**Joueur connecté — onglet Saison**, sous la carte « 🏅 Points de récompense », nouvelle carte
« 🎁 Boutique de cadeaux » (FR/EN/NL, mobile) :
- solde, liste des articles (icône ou image, titre, description, coût, stock, limite par joueur,
  date de fin, conditions repliables ; pour le réel : valeur, pays, âge) ;
- bouton « Échanger » ou raison : « Il manque N pts », « Épuisé », « Indisponible », « Bientôt »,
  « Expiré », « Échanges fermés » ;
- **confirmation** avant l'échange (coût, solde après, possibilité d'annuler) ;
- « Mes échanges » : numéro, date, coût, statut (En attente / En préparation / Remis / Annulé
  (remboursé)), bouton « Annuler » tant que la commande est en attente ;
- procédure de remise/réclamation (numéro de commande) ; catalogue vide → « le catalogue ouvre bientôt ».

**Admin — nouvel onglet 🛍 Boutique** : réglages (échanges ouverts/fermés, message aux joueurs),
formulaire d'article (sorte, coût, stock, max/joueur, icône, image, valeur faciale, devise,
territoires, âge minimal, validité, ordre, visible, indisponible, textes FR/EN/NL + conditions),
catalogue, commandes filtrables avec transitions (→ En préparation, → Remis, Annuler + rembourser),
note sans e-mail ni code, journal de la boutique.

| Fichier | Changement |
|---|---|
| `server/shop.js` (nouveau) | Catalogue (validation), échange atomique et idempotent, annulation/remboursement, transitions, vues joueur/admin, journal. |
| `server/db.js` | Migration **additive** : `shop_settings`, `shop_items`, `shop_orders`, `shop_audit`, 2 index, 4 déclencheurs (journal en ajout seul, articles et commandes non supprimables). |
| `server/index.js` | `GET /api/shop`, `GET /api/shop/me`, `POST /api/shop/orders`, `POST /api/shop/orders/:id/cancel` ; `GET/PUT/POST /api/admin/shop/*`. |
| `server/rateLimits.js` | Limiteur `shop` : 10 échanges/annulations par minute et par compte (`RATE_SHOP_MAX`). |
| `public/js/main.js`, `public/js/i18n.js`, `public/css/style.css` | Carte boutique (clés `giftshop.*`), règle des points mise à jour (« s'échangent dans la boutique ci-dessous »). |
| `public/admin/index.html`, `public/admin/admin.js` | Onglet 🛍 Boutique (rendu DOM sûr, `textContent`). |
| `test/shop.test.js` (nouveau) | 5 tests (voir § 5). |

**Garanties de l'échange** (une seule transaction SQLite) : article visible, disponible, dans sa
période, en stock, limite par joueur ; débit du portefeuille avec la clé `shop:<joueur>:<requestId>`
(le client génère un identifiant par confirmation et le réutilise en cas de renvoi réseau) ;
décrément du stock ; commande + journal. Solde insuffisant ou rupture → rien n'est écrit.
Annulation → mouvement `refund` lié au débit (clé `shop-refund:<commande>`, une seule fois) et remise
en stock. Une commande remise ne s'annule plus (correction = ajustement motivé #33).

## 4. SHA, branche et procédure de test

- Branche `feature/34-boutique-cadeaux` — commit `520676f`.
- **SHA sur `develop` : `36b9e70`** (fusion `--no-ff`).
- `npm test` → **250/250** (worktree du ticket, `develop`, release au SHA exact) ;
  `node --test test/shop.test.js` → 5/5.
- Essai local : `ADMIN_SECRET=<48 car.> PORT=3101 DB_FILE=test-34.sqlite node server/index.js`,
  `/admin/` → 🛍 Boutique → créer un article visible ; dans le jeu, créditer des points (🏅 Points →
  ajustement) puis onglet Saison → Échanger.

## 5. Vérifications

**Faites :**
- Tests automatiques : validation du catalogue (titre FR, coût entier, image `javascript:`/`//`/`http:`
  refusées, devise, pays, dates, stock, limite, icône), mise à jour tracée avant/après, suppression
  refusée par la base ; échange idempotent (même requête = même commande, un seul débit et un seul
  décrément ; même requête pour un autre article = 409) ; solde insuffisant sans écriture ; rupture ;
  limite par joueur (une commande annulée ne compte plus) ; validité ; masqué (404, absent du
  catalogue) ; indisponible ; échanges fermés ; réel refusé (403) et, déverrouillé en test, e-mail
  vérifié exigé et débit marqué `real` ; transitions et refus (second remboursement, annulation d'une
  commande remise, annulation joueur d'une commande en préparation ou d'un autre joueur) ; notes avec
  e-mail ou code refusées ; journal en ajout seul ; registre des points cohérent ; routes HTTP (401,
  400, 403, 409, renvoi idempotent, admin).
- Navigateur (Chromium headless, serveur de test 3101) : 390×844 FR et NL, 1280×900 EN ; échange
  confirmé, annulation remboursée, bouton désactivé « Il manque 35 pts », « Bientôt » pour le réel ;
  panel admin : modification d'article, transition de commande, journal ; **0 erreur JS**.
- Copie de la base de production en `NODE_ENV=production` (port 3122) : santé, version, `/api/shop`
  (catalogue vide) ; empreintes des 6 tables joueurs **identiques** avant/après ; `quick_check` ok ;
  4 tables et 4 déclencheurs ajoutés. Copie supprimée.

**Non faites / limites :**
- Pas d'essai avec ton compte en production ; panel admin inactif en production tant
  qu'`ADMIN_SECRET` n'est pas défini (comme #30/#33) : **sans lui, aucun article ne peut être créé**.
- **Remise manuelle** : une récompense virtuelle n'a aucun effet automatique en jeu (pas de titre,
  cadre ou skin appliqué) : le jeu n'a pas encore d'objets cosmétiques gérés côté serveur (#38 badges).
- Pas d'inventaire de codes cadeaux (réel verrouillé) ; territoires/âge affichés mais non contrôlés
  (le jeu ne connaît ni pays ni âge) — à faire avant d'ouvrir le réel.
- Pas d'e-mail de confirmation de commande (SMTP #43).

**Données des joueurs :** rien de supprimé ni réécrit ; ajout de 4 tables. Les dépenses passent par
le registre en ajout seul de #33.

## 6. Déploiement

- **SHA déployé : `36b9e70`** (précédent : `f42989e`), `1.0.0+36b9e70` sur https://dig.lodygames.com
  et https://dig.lodylands.com (200).
- **Sauvegarde pré-déploiement vérifiée** : `~/backups/dig/dig-20261030-163025-pre-deploy-36b9e70.sqlite`.
- `main` avancé en avance rapide `f42989e → 36b9e70` (sans `--force`) ; `scripts/deploy.sh` de la
  release : « OK : 36b9e70 en service » (`npm ci` non nécessaire).
- Après : journal sans erreur, `quick_check` ok, empreintes des 6 tables joueurs **identiques à la
  sauvegarde pré-déploiement** (une partie en cours avait sauvegardé à 15:30:24 UTC entre la copie de
  test et la sauvegarde : progression, pas de perte) ; `/api/shop` répond ; Chromium 390×844 et
  1280×900 sur l'onglet Saison sans erreur JS.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep f42989e` puis `sudo systemctl restart dig`
  (`package-lock.json` inchangé). Les tables ajoutées sont ignorées par l'ancien code.

**Test fonctionnel à faire par le propriétaire :**
1. Sans rien configurer : jeu connecté → onglet **Saison** → sous la carte des points, carte
   « 🎁 Boutique de cadeaux », « Solde : 0 pts », « Aucun cadeau pour l'instant : le catalogue ouvre
   bientôt », « Mes échanges (0) ». Passer en EN/NL : carte traduite.
2. Avec `ADMIN_SECRET` configuré : `/admin/` → **🛍 Boutique** → créer un article **virtuel**, coût 5,
   « Visible » coché (ex. « Titre honorifique ») ; et un article **réel** (carte 5 €, coût 500).
3. Onglet **🏅 Points** → ajustement de +5 sur ton compte (motif « test boutique »), ou attendre le
   crédit de lundi 02/11.
4. Jeu → Saison : l'article virtuel affiche « Échanger » ; le réel « Bientôt ». Échanger → la
   confirmation montre le coût et le solde après → OK → « Échange enregistré », solde 0, commande
   « En attente ». Double-cliquer ne débite qu'une fois.
5. « Annuler » → solde revenu à 5, commande « Annulé (remboursé) ». Réessayer, puis dans l'admin
   passer la commande à « Remis » → le jeu affiche « Remis ».
6. Admin → journal de la boutique : chaque étape tracée ; 🏅 Points → « Contrôle du registre : OK ».

## 7. Choix techniques faits seul

- **Catalogue vide par défaut** : les articles et prix sont une décision économique ; rien n'est
  inventé en production.
- **Récompenses virtuelles à remise manuelle** : seul mode possible sans objets cosmétiques
  serveur ; les skins de pioche existants sont restés hors boutique (ils relèvent de la monétisation
  et de la sauvegarde client).
- **Un identifiant de requête par confirmation**, généré par le client : idempotence de bout en bout
  (double clic, renvoi réseau) en plus de la clé unique du registre.
- **Le joueur annule seul tant que la commande est en attente** ; ensuite seul l'admin annule
  (remboursement automatique). Pas d'annulation après remise.
- **E-mail vérifié exigé seulement pour le réel** ; le virtuel reste ouvert à tous (#27 § 3).
- **Interrupteur « échanges ouverts »** (urgence/fraude) distinct de la visibilité des articles.
- **Images limitées** à un chemin du site ou une URL `https` ; recommandé : images hébergées sur le site.
- Clés de traduction `giftshop.*` (la clé `shop` existe déjà pour la boutique de gemmes).

## 8. Décisions demandées au propriétaire

1. **Premiers articles virtuels** : lesquels et à quel prix ? Repère : un joueur seul gagne 5 pts par
   saison, un 1er (≥ 3 participants) 100 pts. *Recommandation : attendre #38 (badges/titres) pour des
   récompenses visibles en jeu ; en attendant, 1 article symbolique « Titre honorifique de la
   saison » à 20 pts, 1 par joueur, remise manuelle.* Options : (a) ma recommandation ; (b) ta liste ;
   (c) laisser vide jusqu'à #38.
2. **`ADMIN_SECRET`** : à ajouter dans `/etc/dig/dig.env` (je ne touche pas aux secrets) pour gérer le
   catalogue et les commandes — déjà demandé pour #30/#33.

## 9. Reste à réaliser

- Après lancement : remise automatique des récompenses virtuelles (avec #38) ; inventaire de codes
  cadeaux chiffré, contrôle pays/âge et accord parental, budget plafonné, e-mails de commande (#43) —
  uniquement le jour où les cadeaux réels sont ouverts (#27 § 4).
- #31 : intégration dans la refonte de l'onglet Saison.
- Signalé hors périmètre : l'ajustement admin des points (#33) n'a toujours pas de clé d'idempotence
  côté panel.

---

## Mise à jour du 30/10/2026, 17 h (Bruxelles) — recette mobile et contrôle d'`ADMIN_SECRET`

**Ticket** : #34 — [P1] Boutique de cadeaux — https://github.com/ReC82/Dig/issues/34

**État réel** : déployé en production (SHA `36b9e70`, inchangé) — affichage validé par le
propriétaire, recette de l'échange à faire. Aucun code modifié, aucun déploiement, aucun
redémarrage dans cette session.

### Retour du propriétaire pris en compte

- Carte « 🎁 Boutique de cadeaux » sur mobile **validée** (solde 0 pts, catalogue vide, « Mes
  échanges (0) ») : ne sera plus redemandée.
- `ADMIN_SECRET` ajouté par le propriétaire dans la configuration du service.

### Contrôle d'`ADMIN_SECRET` (sans lire ni afficher le secret)

Contrôle fait uniquement de l'extérieur, par des requêtes GET sans effet :

| Contrôle | dig.lodygames.com | dig.lodylands.com |
|---|---|---|
| Page `/admin/` | 200 | 200 |
| `GET /api/admin/seasons` sans authentification | 401 « Accès refusé. » | 401 |
| idem avec un faux jeton | 401 | 401 |
| `GET /api/admin/shop` sans authentification | 401 | 401 |

- **Le service a bien chargé le secret** : sans lui, l'API admin répond 503 « Panel admin non
  configuré » ; elle répond maintenant 401. Le service tourne depuis 16:30:25 (redémarrage
  déjà fait après l'ajout) : **aucun redémarrage nécessaire**.
- **Secret jugé assez robuste par le serveur** : le journal du service ne contient aucun
  avertissement « ADMIN_SECRET trop faible » depuis ce démarrage (un secret trop court ou
  connu désactiverait le panel → 503).
- **Authentification** : jeton `Authorization: Bearer …` comparé en temps constant (empreintes
  SHA-256), mêmes réponses 401 avec ou sans jeton ; HTTPS avec HSTS ; page admin protégée contre
  l'intégration dans un cadre (`X-Frame-Options`, `frame-ancestors`). Chaque action admin
  authentifiée qui modifie quelque chose est tracée dans le journal de sécurité.
- Fichier de configuration non lu (accès refusé à l'utilisateur de la session, comme prévu) ;
  environnement du processus non consulté.

### Test fonctionnel à faire par le propriétaire (en jeu, ~5 min)

Aucun article n'a été créé et aucun point attribué (consigne du propriétaire). Pour tester :

1. Ouvrir `https://dig.lodygames.com/admin/`, saisir le secret admin, onglet **🛍 Boutique**.
2. Créer un article **virtuel** de test (ex. « Titre honorifique de la saison », 1 pt pour le
   test ou 20 pts selon la recommandation, stock 1, 1 par joueur) et le rendre visible.
3. Avec un compte de joueur qui a des points (sinon, les attribuer soi-même via l'ajustement admin
   des points #33 — décision du propriétaire), onglet **Saison** → carte Boutique → **Échanger**
   → confirmer. Attendu : solde diminué du prix, commande « En attente » dans « Mes échanges »,
   stock décrémenté ; un double clic ne crée qu'une commande.
4. **Annuler** la commande côté joueur. Attendu : statut « Annulée », points remboursés.
5. Refaire un échange, puis côté admin (Commandes) le marquer **remis**. Attendu : statut
   « Remis » côté joueur, annulation plus possible. Journal admin : action tracée.
6. Masquer ou supprimer l'article de test si on ne veut pas le garder.

### Classement MVP

Boutique phase 1 : **Après lancement** pour le contenu (catalogue), mais ce qui est en ligne ne
bloque pas le MVP (carte propre même vide).

### Décisions demandées au propriétaire

1. **Premiers articles virtuels et prix** (inchangé) — recommandation : 1 « Titre honorifique de
   la saison » à 20 pts, 1 par joueur, remise manuelle ; ou attendre #38 (badges/titres). Le
   propriétaire peut désormais les créer lui-même depuis l'admin.

(La question `ADMIN_SECRET` est réglée.)

### Reste à réaliser / signalé

- Après lancement : aucune limitation de débit sur les échecs d'authentification admin
  (`/api/admin/*`). Le risque est faible avec un secret long et aléatoire, mais une limite
  (type `login`, échecs seuls comptés) serait une défense en profondeur ; hors périmètre de #34.
- Le reste est inchangé (voir § 9).

## Mise à jour du 03/11/2026 — recette UX croisée : trois boutiques peu compréhensibles

**Ticket** : #34 — [P1] Boutique de cadeaux — https://github.com/ReC82/Dig/issues/34
(retour du propriétaire : https://github.com/ReC82/Dig/issues/34#issuecomment-6607533151)

**État réel** : **déployé en production (SHA `0c66821`) le 03/11/2026 à 16:35 (Bruxelles) — en attente de recette.** Classement : **Bloquant MVP public (léger)** — la confusion entre les trois offres gêne un premier joueur ; l'étape 2 (regroupement) est « Après lancement ».

### Retour du propriétaire

« Il y a 3 boutiques si on compte celle de saison » : onglet **Boutique** (gemmes, skins, boosts,
tous « Bientôt »), **Amélios → Boutique de saison** (trois coffres payés en pièces) et **Saison →
Boutique de cadeaux** (points de saison). L'assistant lui-même s'était trompé de destination.
Demande : cartographier la navigation et présenter un point d'entrée cohérent qui dit quelle
monnaie est utilisée et si l'offre est disponible ; **ne pas fusionner les monnaies ni le backend,
ne pas déplacer les actions sensibles avant étude et validation**, vérifier PC/mobile, aucune
vente ni prix réel ouvert.

### Cartographie (avant)

| Offre | Où | Monnaie | Disponible ? | Action d'achat |
|---|---|---|---|---|
| Coffres simple / rare / antique | Amélios → section « 🏪 Boutique de saison » | 💰 pièces | oui | « Ouvrir » (serveur, `/api/shop/chests`) |
| Gemmes, skins de pioche, boosts | onglet 🛒 Boutique | 💶 argent réel | non (« Bientôt », paiements coupés #11) | aucune |
| Cadeaux (récompenses virtuelles) | 🏆 Saison → carte « 🎁 Boutique de cadeaux » (repliée) | 🏅 points de saison | oui (catalogue vide) | « Échanger » (`/api/shop/exchange`) |

Trois endroits nommés « boutique », trois monnaies, aucun lien entre eux.

### Ce qui change (étape 1, sans rien déplacer)

- **Bandeau « Où dépenser quoi ? »** identique en tête des trois offres : trois cases
  **📦 Coffres · 💰 Pièces**, **💎 Gemmes et cosmétiques · 💶 Argent réel · bientôt**,
  **🎁 Cadeaux · 🏅 Points de saison**. La case de l'offre affichée est encadrée d'or et marquée
  « ✓ Tu es ici » ; les deux autres sont des boutons « Amélios › », « Boutique › », « Saison › »
  qui ouvrent le bon onglet (défilement jusqu'aux coffres ; carte cadeaux **dépliée** et amenée en
  haut). Texte ≥ 12 px, contraste clair (retour #20 sur les textes gris illisibles).
- Section d'Amélios renommée **« 📦 Coffres de saison »** (au lieu de « 🏪 Boutique de saison ») :
  il n'y a plus trois « boutiques ».
- « bientôt » disparaît tout seul de la case Gemmes le jour où les paiements seront activés.
- FR/EN/NL/ES + pilote italien (`i18n/it.json`, état : 0 manquante, 0 périmée).
- **Inchangé** : emplacements et boutons d'achat, prix, probabilités, monnaies, API, base de données.

Fichiers : `public/js/main.js` (`_shopGuideHtml`, `_goToShop`, `_revealGiftShop`),
`public/index.html`, `public/css/style.css`, `public/js/i18n.js`, `i18n/it.json`,
`public/js/locales/it.js`, tests `test/shop-guide.test.js` et `test/e2e/shop-guide.e2e.js`.

### Vérifications

- `npm test` complet : **551/551** sur la branche (`dd27d37`) puis sur la release `0c66821` (arbre identique).
- Test automatique `test/shop-guide.test.js` (3 tests) : bandeau dans les trois offres, case courante
  marquée, liens vers les onglets existants, **aucune action d'achat dans le guide**, textes 4 langues.
- Essai navigateur (Chromium headless, serveur de test port 3101, base de test jetable, compte de
  test) en **1280×900 et 390×844** : Amélios → bandeau « Coffres · Pièces · Tu es ici » ; lien
  Gemmes → onglet Boutique actif ; lien Cadeaux → onglet Saison, carte cadeaux ouverte en haut de
  l'écran ; lien Coffres → Amélios, section coffres visible ; aucun défilement horizontal ;
  0 erreur JS. Défaut trouvé et corrigé pendant l'essai : sur téléphone, le compte se charge après
  le clic ; l'ouverture de la carte cadeaux reste donc en attente jusqu'à son affichage (et est
  abandonnée si l'on change d'onglet).
- Données joueurs : client seul, aucune migration.

### Étape 2 proposée (à valider avant de toucher aux achats)

Un **seul onglet « Boutique »** à trois sous-onglets **Coffres | Gemmes et cosmétiques | Cadeaux**,
chacun avec sa monnaie et son état, les coffres et la carte cadeaux y étant **déplacés** (avec un
lien de rappel depuis Amélios et Saison). C'est un déplacement d'actions d'achat : à faire seulement
après ta validation de l'étape 1 et de cette organisation (voir décision 2).

### SHA et branche

Branche `feature/34-boutique-cadeaux`, commit `dd27d37` ; **develop `0c66821`** (fusion `--no-ff`).

### Déploiement

- **Déployé `0c66821`** le 03/11 à 16:35 (précédent `13af375`, 4 commits, sans `npm ci`).
- Avant : release `npm test` 551/551 ; copie de la base de production démarrée en mode production
  (port 3122) : `/health` ok, version `1.0.0+0c66821`, empreintes de `users`, `user_saves`,
  `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** avant/après ;
  copie supprimée. Aucune génération IA en cours (dernière activité 13:56 Bruxelles).
- Sauvegarde vérifiée : `~/backups/dig/dig-20261103-163517-pre-deploy-0c66821.sqlite`.
- Après : 2 domaines 200, `/api/version` = `1.0.0+0c66821`, nouveau `main.js` servi, journal sans
  erreur, `pragma quick_check` = ok, empreintes production = sauvegarde. Essai Chromium sur
  https://dig.lodygames.com (1280×900 et 390×844, sans compte) : bandeau « Coffres · Pièces · Tu es
  ici » dans Amélios, liens vers Boutique puis Saison fonctionnels, 0 défilement horizontal, 0 erreur JS.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 13af375` + `sudo systemctl restart dig`
  (client seul, aucune donnée à reprendre).

### Test fonctionnel à faire par le propriétaire (téléphone puis PC, ~2 min, sans achat)

1. Jeu (Ctrl+F5 / actualiser si bandeau de mise à jour), connecté → **⚙ Amélios** : sous
   « 📦 COFFRES DE SAISON », bandeau **« Où dépenser quoi ? »** — case **📦 Coffres · 💰 Pièces ·
   ✓ Tu es ici** encadrée d'or, puis **💎 Gemmes et cosmétiques · 💶 Argent réel · bientôt** et
   **🎁 Cadeaux · 🏅 Points de saison**.
2. Toucher **« Boutique › »** → onglet 🛒 Boutique, même bandeau, case Gemmes marquée « Tu es ici ».
3. Toucher **« Saison › »** → onglet 🏆 Saison, la carte « 🎁 Boutique de cadeaux » s'ouvre seule en
   haut de l'écran avec le même bandeau.
4. Toucher **« Amélios › »** → retour aux coffres.
Attendu : textes lisibles sans zoom, aucun achat déclenché, prix et coffres inchangés.

### Choix techniques faits seul

- Bandeau commun plutôt que regroupement immédiat : la consigne interdit de déplacer les achats
  avant validation ; le bandeau répond à « où suis-je, quelle monnaie, est-ce disponible ».
- « Coffres de saison » : le mot « boutique » est réservé à l'onglet Boutique et à la boutique de
  cadeaux, déjà validée sous ce nom.
- Libellés « Amélios », « Boutique », « Saison » repris de la barre de navigation (mêmes mots que
  ce que le joueur voit en bas).

### Décisions demandées au propriétaire

1. (inchangée) Premiers articles virtuels et prix — reco : « Titre honorifique de la saison » à
   20 pts, 1 par joueur, remise manuelle ; ou attendre #38.
2. **Après ta recette de l'étape 1 : faut-il regrouper (étape 2) ?** Options : A) garder ce bandeau
   seul (reco pour le MVP : rien de sensible ne bouge) ; B) un onglet Boutique à trois sous-onglets
   Coffres | Gemmes et cosmétiques | Cadeaux, avec déplacement des coffres et de la carte cadeaux
   (après lancement).

### Reste à réaliser

- Étape 2 selon la décision 2 (après lancement).
- #20 (fenêtre des chances illisible sur mobile) est traitée dans son propre ticket.

## Mise à jour du 03/11/2026, 18 h (Bruxelles) — recettes #34-A/B/C : bandeau lisible, lien Cadeaux fiabilisé

**Ticket** : #34 — [P1] Boutique de cadeaux — https://github.com/ReC82/Dig/issues/34
(recettes du propriétaire : [#34-A](https://github.com/ReC82/Dig/issues/34#issuecomment-6608619541),
[#34-B](https://github.com/ReC82/Dig/issues/34#issuecomment-6609115686),
[#34-C](https://github.com/ReC82/Dig/issues/34#issuecomment-6609227705))

**État réel** : **déployé en production (SHA `de365b3`) le 03/11/2026 à 17:52 (Bruxelles) — en attente de recette.**
Classement : **Après lancement** (confort visuel ; l'étape 1 est acceptée sur le parcours testé).

### Retour du propriétaire

- #34-A : bandeau présent et conforme sur téléphone ; **réserve** : cartes très étroites,
  « Gemmes et cosmétiques » sur plusieurs lignes, « Argent réel · bientôt » serré — garder un texte
  lisible et aligné (libellés plus courts ou grille moins dense), sans déplacer ni fusionner.
- #34-B : Coffres → Boutique **validé** sur téléphone.
- #34-C : Boutique → Saison/Cadeaux **validé** (carte dépliée seule) ; retour Cadeaux → Coffres non
  testé ; étape 2 (onglet unique) reste une décision du propriétaire, non autorisée.

### Ce qui change

1. **Une ligne par boutique** au lieu de trois colonnes : nom et monnaie à gauche,
   « ✓ Tu es ici » ou « Amélios › / Boutique › / Saison › » à droite. **Mêmes textes** (rien
   raccourci : « cosmétiques » et « bientôt » restent des informations utiles). L'application est
   limitée à 440 px de large, **aussi sur ordinateur** : le défaut existait donc partout, la
   disposition en lignes s'applique sur PC comme sur téléphone. Hauteur du bandeau ≈ 3 × 44 px
   (zone tactile ≥ 44 px conservée).
2. **Lien « Saison › » fiabilisé** : l'essai navigateur (nouvelle largeur 360 px) a montré que la
   carte cadeaux restait parfois hors écran — le défilement animé était annulé quand la vue Saison
   se re-rendait pendant l'animation (position mémorisée à mi-course puis restaurée). Défilement
   désormais immédiat : 0/3 → 3/3 réussites sur le même scénario.

Fichiers : `public/css/style.css` (bloc `.shop-guide-*`), `public/js/main.js` (`_revealGiftShop`),
`test/shop-guide.test.js` (+1 test), `test/e2e/shop-guide.e2e.js` (largeur 360×740 ajoutée,
contrôle « chaque libellé tient sur une ligne »). Aucun achat, prix, texte, backend ni donnée modifié.

### SHA et branche

Branche `feature/34-boutique-cadeaux` (`457a3a6`, `a9c9fcb`) ; **develop `de365b3`**
(fusions `--no-ff` `67b160d` puis `de365b3`).

### Vérifications

- `npm test` complet : **554/554** sur develop `67b160d`, sur `de365b3` et sur chaque release.
- `test/shop-guide.test.js` : 4/4 (nouveau : une colonne pleine largeur, plus de trois colonnes
  étroites, pas de défilement animé dans `_revealGiftShop`).
- Essai Chromium (serveur de test port 3101, base jetable, compte de test) en **1280×900, 390×844 et
  360×740**, deux passages : chaque libellé tient sur **une ligne** dans Amélios et Boutique, liens
  Coffres → Boutique → Cadeaux → Coffres, carte cadeaux ouverte en haut, 0 débordement, 0 erreur JS.
  Le même contrôle « une ligne » **échoue avec l'ancien CSS** (3 lignes) : il détecte bien le défaut.
  Limite : dans la carte cadeaux (plus étroite) à **360 px**, « Gemmes et cosmétiques » passe encore
  sur 2 lignes, aligné et lisible ; à 390 px et sur PC, une ligne.
- Données joueurs : client seul, aucune migration.

### Déploiement

- Deux déploiements successifs le même soir : **`67b160d`** (17:40, ligne par boutique sur
  téléphone seulement) puis **`de365b3`** (17:52, la même disposition sur PC, constatée trop
  serrée en vérifiant la production). Précédent : `a49c604`.
- Avant chacun : release `npm test` 554/554 ; copie de la base de production démarrée en mode
  production (port 3122) : santé ok, version attendue, empreintes de `users`, `user_saves`,
  `season_rankings`, `seasons`, `leagues`, `player_click_tracking` **identiques** ; copie supprimée ;
  aucune génération IA en cours.
- Sauvegardes vérifiées : `~/backups/dig/dig-20261103-173958-pre-deploy-67b160d.sqlite` et
  `~/backups/dig/dig-20261103-175157-pre-deploy-de365b3.sqlite`.
- Après : 2 domaines 200, `/api/version` = `1.0.0+de365b3`, journal sans erreur,
  `quick_check` ok, empreintes production = sauvegarde ; Chromium sur https://dig.lodygames.com
  (1280×900 et 390×844, sans compte) : bandeau en une colonne, chaque libellé sur une ligne,
  0 débordement, 0 erreur JS.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep a49c604` + `sudo systemctl restart dig`
  (client seul).

### Test fonctionnel à faire par le propriétaire (téléphone, ~1 min, sans achat)

1. Actualiser le jeu → **⚙ Amélios** → « 📦 Coffres de saison » : le bandeau montre **trois
   lignes** pleine largeur ; « 💎 Gemmes et cosmétiques » et « 💶 Argent réel · bientôt » chacun
   sur **une seule ligne**, « Boutique › » aligné à droite.
2. **Saison ›** → la carte cadeaux s'ouvre en haut de l'écran.
3. Dans la carte cadeaux, **Amélios ›** → retour aux coffres (le seul trajet pas encore testé).
Attendu : textes lisibles, rien d'autre de changé, aucun achat.

### Choix techniques faits seul

- Lignes plutôt que libellés raccourcis : garder « cosmétiques » et « bientôt » (information
  utile) et aucune traduction à reprendre dans 5 langues.
- Disposition appliquée aussi sur PC : l'appli fait 440 px max, le défaut y était identique.
- Défilement immédiat plutôt qu'animé : seule façon simple de ne pas être annulé par un re-rendu.

### Décisions demandées au propriétaire

Inchangées : 1) premiers articles virtuels et prix (reco : « Titre honorifique de la saison »,
20 pts, 1 par joueur) ; 2) étape 2 — A) garder le bandeau seul (reco MVP) ou B) onglet Boutique à
trois sous-onglets (après lancement).

### Reste à réaliser

- Étape 2 selon la décision 2 (après lancement).
