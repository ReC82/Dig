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
