# Ticket #45 — Monétisation Dig : publicité non intrusive et pilotable

- Ticket : [#45 — [P1] Monétisation Dig — intégration Google AdSense non intrusive et pilotable](https://github.com/ReC82/Dig/issues/45)
- Session : 30/10/2026, 22:45–23:45 (Bruxelles)
- Branche : `feature/45-publicite` — commit `a8e4ba3`
- **SHA sur `develop` : `3dc9fa3`** (05/11, promotion interne + mise en page ; préparation initiale `f647ec0`)
- **Déployé en production : `3dc9fa3`** (05/11/2026 03:26)
- Classement : **Après lancement** (le MVP peut être partagé sans publicité ; rien ne bloque le lancement)

## Mise à jour du 05/11/2026 — promotion interne DIG! et mise en page de l'onglet Publicité

**État réel : déployé en production (SHA `3dc9fa3`) — en attente de recette.** Branche
`feature/45-publicite` (commit `65afaa3`), **SHA sur `develop` : `3dc9fa3`**. La promotion est
livrée **désactivée** : c'est toi qui l'actives dans l'admin. Je n'ai pas accès à la clé admin, et
c'est le comportement par défaut voulu. Classement : **Après lancement**, mais utile au lancement
selon ta demande P1. Aucun élément ne bloque le MVP.

### Demandes traitées (commentaires du propriétaire du 04/11)

1. **Retouche de mise en page (recette du 04/11, Admin → 📢 Publicité)** :
   - **Cases à cocher** : chaque case est sur la même ligne que son libellé (`label` flex,
     `align-items:center`, écart mesuré : 0 px), avec un espacement constant. Un clic sur le texte
     coche la case, le survol est visible et le focus clavier apparaît en contour doré.
   - **Boutons** : chaque carte a sa barre d'actions, à droite sous un filet. « Effacer le code »
     (secondaire) est à gauche et grisé s'il n'y a aucun code. « Enregistrer l'emplacement »
     (principal) est à droite.
   - **Cartes** : l'interrupteur général de la régie a sa propre carte, avec son message.
   - **Champs** : les zones de saisie sont sombres (fond du thème, bordure #4a4a4a, placeholder
     #a3a3a3 lisible, focus doré). L'ads.txt et les codes sont en police à chasse fixe.
   - **Mobile** : les actions passent en pleine largeur.
   - Aucun état, aucune règle, aucun domaine, aucun code et aucun consentement n'a été modifié.
2. **Promotion interne DIG! → boutique de gemmes** :
   - **Création maison** aux deux formats, 728×90 (PC) et 320×50 (mobile) : gemme en pixel art
     (SVG local), « Besoin de gemmes ? », « Toutes les offres de gemmes sont dans la boutique. »
     (PC seulement), bouton « Découvrir la boutique » (PC) ou « Boutique » (mobile), et la mention
     « PROMOTION DIG! ».
   - **Contenu** : aucun prix, aucune quantité, aucune promesse de gemmes gratuites, aucune image
     générée ni distante. Textes en FR, EN, NL, ES et IT.
   - **Clic ou toucher** : ouvre l'onglet Boutique sur la section 💎 Gemmes. Pas d'achat, pas de
     rechargement, pas de lien externe, et la session est conservée. Si la boutique est
     introuvable, la bannière ne s'affiche pas (pas de lien mort ni de zone vide).
   - **Emplacements** : la promotion utilise les mêmes emplacements en haut, au-dessus de
     l'en-tête, uniquement quand aucune annonce de régie n'y est servie.
   - **Masquer sur l'écran de minage** : réglage propre à la promotion, initialisé une fois depuis
     celui de la régie (mobile : oui, PC : non) et modifiable par format dans l'admin.
   - **Admin → 📢 Publicité → « Promotion interne DIG! »** : état, interrupteur, masquage par
     format, **aperçu aux deux tailles réelles**, et « Enregistrer la promotion ».
   - **Indépendance** : la promotion ne dépend ni de l'interrupteur de la régie ni de
     `ADS_DISABLED`. Elle a son propre coupe-circuit, `PROMO_DISABLED=1`.
   - **Sécurité inchangée** : la régie reste OFF, l'iframe reste sandbox, et les domaines et le
     consentement des annonces tierces ne changent pas. La promotion ne déclenche aucune demande
     de consentement, ne charge aucun script tiers et n'enregistre aucun clic.
   - **Pas de décalage** : le format affiché la dernière fois est réservé dès le chargement du
     script, avant l'arrivée de la configuration. Sans promotion, rien n'est réservé et il n'y a
     pas de zone blanche.

### Fichiers

`server/ads.js` (`updatePromo`, `promoState`, `promo` dans la configuration publique,
`PROMO_DISABLED`), `server/db.js` (colonnes ajoutées `ad_settings.promo_enabled` et
`ad_slots.promo_hide_on_dig`, migration idempotente), `server/index.js`
(`PUT /api/admin/ads/promo`, admin seulement), `public/js/gemCallout.js` et
`public/css/gemCallout.css` (création, partagée par le jeu et l'aperçu admin), `public/js/ads.js`
(choix régie / promotion, réservation de la hauteur, conteneur neutre `#top-strip`),
`public/css/style.css`, `public/js/main.js` (ancre `#shop-gems-anchor`), `public/js/i18n.js` et
`i18n/it.json` → `public/js/locales/it.js`, `public/admin/*`, `docs/PUBLICITE.md`,
`test/ads.test.js` (+2 tests et des assertions) et `test/adblock-ui.test.js`.

### Vérifications

- `npm test` : branche 732/732, **release `3dc9fa3` 732/732** (aucune relance) ; `npm run check` OK.
- **Navigateur Chromium** (serveur de test, port 3101, base de test) :
  - **Promotion désactivée** : rien n'est monté à 320, 390, 1280 et 1920 px.
  - **Promotion active** :
    - 1280 et 1920 px : bannière 728×90 visible y compris sur Creuser ; le clic et la touche
      Entrée ouvrent la boutique, section Gemmes.
    - 320 et 390 px : bannière 320×50, masquée sur Creuser et visible sur les autres onglets ; le
      toucher ouvre la boutique.
    - Au rechargement, la place est réservée dès `DOMContentLoaded` (même hauteur).
  - Zéro requête externe et zéro erreur JS.
  - **Admin PC 1280 et mobile 390** : 9 cases alignées (écart de 0 px), un clic sur le libellé
    coche la case, les champs sont sombres (`rgb(26,26,26)`) et les aperçus sont corrects.
- **Copie de la base de production** : `/health` OK et version `3dc9fa3`. Empreintes de `users`,
  `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`, `ad_settings` et
  `ad_slots` identiques. Seules les 2 colonnes ont été ajoutées, et la promotion est OFF.
- **Production** : sauvegarde vérifiée
  `~/backups/dig/dig-20261105-032616-pre-deploy-3dc9fa3.sqlite`, déploiement `497b52a → 3dc9fa3`.
  Les deux domaines répondent 200 avec `1.0.0+3dc9fa3`, `quick_check` donne ok, le journal est
  sans erreur et les empreintes joueurs sont identiques. Contrôle navigateur PC et mobile : aucune
  bannière ni demande de consentement (promotion OFF), aucune erreur JS.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 497b52a` puis
  `sudo systemctl restart dig`. Les colonnes ajoutées sont ignorées par l'ancien code.
- **Non vérifié** : l'installation PWA réelle sur un téléphone. Le rendu en mode standalone
  utilise le même code (`safe-area-inset-top` est pris en compte).

### Test fonctionnel à faire (≈ 3 min)

1. `/admin/` → 📢 Publicité :
   - les cases sont alignées avec leur texte ;
   - les champs sont sombres ;
   - les boutons sont regroupés à droite sous un filet ;
   - deux aperçus de la bannière s'affichent.
2. Dans « Promotion interne DIG! » : cocher **Promotion active** → **Enregistrer la promotion**.
   Le message « ACTIVE » apparaît.
3. **PC** : recharger le jeu. La bannière « Besoin de gemmes ? » apparaît au-dessus de l'en-tête.
   Un clic ouvre la Boutique sur 💎 Gemmes, sans achat.
4. **Téléphone** :
   - sur Creuser, pas de bannière (réglage par défaut) ;
   - sur Amélios, bannière 320×50 ;
   - un toucher ouvre la Boutique.
5. Pour l'arrêter : décocher la case → Enregistrer. La bannière disparaît au prochain chargement.

### Choix techniques faits seul

- **Promotion sur les deux domaines.** Le contenu vient du jeu, sans régie ni tiers, donc la règle
  « pas de publicité sur lodylands » ne s'y applique pas. Elle reste coupable par
  `PROMO_DISABLED`.
- **Noms neutres** (`#top-strip`, `.gem-callout`). Les filtres cosmétiques des bloqueurs visent
  `ad-…` et pourraient masquer le conteneur en laissant un vide (même cause que #46). Le
  conteneur de la régie a été renommé pour la même raison.
- **Bouton court « Boutique » en 320×50**, pour que « Besoin de gemmes ? » ne soit pas tronqué.
- **Bannière de régie prioritaire** quand elle est active et acceptée par le joueur. La promotion
  prend la place en cas de refus, d'absence de choix ou de script bloqué.
- **Aucun comptage des clics** (« pas de tracking intrusif »).

### Décisions demandées

Aucune décision nécessaire pour cette livraison. Les questions de la régie externe ci-dessous
restent ouvertes et ne bloquent pas la promotion.

### Remarque hors périmètre

`main.js` appelle `DigAds.*` sans garde. Si un bloqueur bloque l'URL `js/ads.js`, Paramètres
pourrait échouer. Je n'ai pas modifié ce point, faute de preuve qu'il se produise. Si tu le
constates, la correction tient en une ligne.

---

## 1. État réel

**Intégré dans `develop` (`f647ec0`) — non déployé.** Lors de la répétition de la release, la
suite complète a donné 365 réussites et 1 échec : le fichier `test/antibot.test.js`, sans lien
avec ce ticket, a dépassé le délai de 120 s. Tous ses sous-tests avaient réussi, mais le fichier
n'a pas rendu la main et son serveur de test est resté orphelin. Le même SHA était entièrement
vert dans `develop` (366/366), et deux relances isolées du fichier ont réussi (26/26). La règle de
déploiement n'admet de relance que pour le test `rate-limit` : déploiement refusé, comme prévu.
Prochaine session : relancer la suite complète sur une release `f647ec0` et déployer si elle est
verte.

Même après déploiement, **aucune publicité ne sera diffusée** : tout est désactivé par défaut et
ne s'active que depuis le panel admin, par ta décision.

## 2. Résultat et changements

Préparation complète d'une **bannière haute** (format validé par toi le 30/10), adaptée aux deux
unités de ta régie (320×50 mobile, 728×90 ordinateur) :

- **Emplacements réservés** au-dessus de l'en-tête : jamais sur le bloc, les commandes ni la
  barre de navigation. Sur mobile, la bannière est **masquée sur l'écran de minage** (option
  admin) et visible dans les autres vues. Sur PC (1280×900), il y a environ 190 px entre la
  bannière et le bloc. L'espace est réservé à la taille exacte avant le chargement, donc pas de
  décalage à l'arrivée de l'annonce.
- **Isolation** : le code « GET CODE » n'est jamais exécuté dans la page du jeu. Il est servi par
  `/ads/frame/<emplacement>` dans une iframe `sandbox` sans `allow-same-origin` ni
  `allow-top-navigation`. La régie n'a donc accès ni aux cookies, ni à la session, ni au
  stockage, ni au DOM du jeu, et ne peut pas rediriger l'onglet. Chaque unité a son propre
  document, ce qui règle le conflit de la variable `atOptions`. Le cadre a sa propre CSP à
  nonce ; la page du jeu garde la sienne et ne contient aucun script tiers.
- **Domaine** : publicité, cadres et `ads.txt` seulement sur `dig.lodygames.com`.
  `dig.lodylands.com` est servi directement, **sans redirection ni publicité**, et son
  `robots.txt` le désindexe. Ajout de `<link rel="canonical" href="https://dig.lodygames.com/">`.
- **Consentement** : fenêtre « Publicité et vie privée » avec Accepter / Refuser de même poids.
  Elle n'apparaît que si une bannière peut s'afficher. Sans accord, **aucune requête vers la
  régie**. Le choix se retire ou s'accorde dans **⚙ Paramètres → Publicité**. Textes en
  FR/EN/NL/ES.
- **Pas de trafic invalide** : un seul chargement par page, ni minuteur ni rafraîchissement, aucun
  lien avec les clics, l'Auto-Dig, les scores ou le classement.
- **Bloqueur ou échec du script** : l'emplacement se replie, sans message ni pénalité.
- **Panel admin → 📢 Publicité** :
  - interrupteur général, avec la saisie `ACTIVER` exigée pour l'allumer ;
  - choix de la régie et des domaines autorisés ;
  - collage du code de chaque unité : il est analysé (clé, format iframe, dimensions de
    l'emplacement, script HTTPS correspondant à la clé), jamais exécuté ;
  - option « masquer sur l'écran de minage » ;
  - `ads.txt` validé ligne par ligne ;
  - coordonnées de l'éditeur ;
  - possibilité de redemander le consentement à tous les joueurs ;
  - **état effectif par domaine** ;
  - **« cadres servis »** par jour : mesure technique, clairement distincte des impressions ;
    aucun revenu estimé.
  - Arrêt d'urgence : `ADS_DISABLED=1` dans l'environnement.
- **Page `/legal/confidentialite`** : données réellement traitées (vérifiées dans le code),
  cookies (`connect.sid`, 7 jours), stockage local, publicité selon l'état réel, droits, APD.
  Les coordonnées de l'éditeur sont à saisir dans l'admin ; aucune n'est inventée. Le lien est
  dans Paramètres et dans la fenêtre de consentement.
- **Option « sans publicité » future** : point d'entrée unique `isAdFree()`, qui renvoie toujours
  `false`. Aucun prix, aucune durée, aucun achat.
- **Documentation `docs/PUBLICITE.md`** : fonctionnement, mise en service pas à pas, checklist
  PASS/PARTIEL/À CONFIRMER et architecture proposée pour la vidéo récompensée.

Fichiers :
- nouveaux : `server/ads.js`, `server/legal.js`, `public/js/ads.js`, `test/ads.test.js`,
  `docs/PUBLICITE.md` ;
- modifiés : `server/index.js` (routes), `server/db.js` (3 tables ajoutées), `public/index.html`,
  `public/js/main.js`, `public/js/i18n.js`, `public/css/style.css`, `public/admin/*`.

## 3. Procédure de test (technique)

```bash
cd <worktree> && npm ci && node --test test/ads.test.js   # 7/7
npm test                                                   # suite complète
```

Le test HTTP démarre un serveur sur le port 3164 avec une base temporaire. Il vérifie :
- tout désactivé par défaut (cadre 404, pas d'`ads.txt`) ;
- la confirmation `ACTIVER` ;
- le cadre servi seulement sur `dig.lodygames.com`, avec sa CSP ;
- 404 sur `dig.lodylands.com` ;
- la page d'accueil de l'adresse alternative servie sans redirection ;
- la page légale, qui suit l'état réel ;
- le compteur de cadres et le retour à l'état sûr.

## 4. Vérifications effectuées

- `node --test test/ads.test.js` : 7/7.
- Suite complète : branche du ticket 365/366 (l'échec venait de l'ordre des scripts dans
  `index.html`, corrigé) ; `develop` `f647ec0` **366/366** ; release `f647ec0` 365/366 (dépassement
  de délai d'`antibot.test.js`, voir §1). `npm run check` OK.
- Navigateur Chromium headless, ordinateur 1280×900 et smartphone 390×844, serveur de test local
  (port 3101, base de test). Les requêtes externes ont été interceptées : un faux script a dessiné
  un rectangle « ANNONCE TEST », sans aucun script réel de régie. Résultats :
  - consentement affiché puis accepté → bannière 728×90 en haut sur PC ;
  - mobile : bannière masquée sur Creuser, visible sur Améliorations ;
  - retrait dans Paramètres → bannière retirée ;
  - script bloqué → emplacement replié ;
  - publicité désactivée → page identique à l'actuelle, aucune fenêtre, **zéro requête externe** ;
  - un script de test injecté dans le cadre n'a pas pu lire le `localStorage` du jeu (isolation
    confirmée).
- Onglet admin 📢 Publicité : rendu sans erreur JavaScript.
- **Non vérifié** : le vrai script de la régie. Depuis le serveur, `https://bauval.org/22/<clé>`
  répond **403 avec un corps vide** (Cloudflare), donc son contenu et ses domaines n'ont pas pu
  être audités. Je ne l'ai exécuté nulle part.
- **Données des joueurs** : aucune table existante modifiée. Trois tables ajoutées
  (`ad_settings`, `ad_slots`, `ad_daily_stats`, création idempotente). Le test de migration sur
  copie de la base de production n'a pas été fait, puisque la release s'est arrêtée à l'étape 1.

## 5. Déploiement

**Non déployé.** Raison : échec par dépassement de délai d'`antibot.test.js` lors de la répétition
de la release (règle : seul le test `rate-limit` peut être relancé). La production reste en
`90e0267`, sans aucun changement. Le worktree de release a été supprimé et le serveur de test
orphelin arrêté.

**Test fonctionnel à faire par le propriétaire (après déploiement, ≈ 5 min)** :
1. Jeu sur `https://dig.lodygames.com`, PC et téléphone : **aucune différence**, ni fenêtre ni
   bannière (publicité désactivée). ⚙ Paramètres → en bas, lien « Confidentialité, cookies et
   contact » → la page s'ouvre et indique « aucune publicité ».
2. `/admin/` → 📢 Publicité : bandeau « 🔒 Aucune publicité diffusée » ; saisir « Éditeur et
   contact » → Enregistrer → la page de confidentialité l'affiche.
3. *(Seulement si tu décides d'activer, après confirmation de la régie pour `bauval.org`)* : coller
   les deux codes GET CODE, cocher les emplacements, choisir « Adsterra », interrupteur + `ACTIVER`.
   Sur `dig.lodygames.com`, la fenêtre de consentement apparaît ; Accepter → bannière en haut (sur
   mobile : pas sur l'écran Creuser). Sur `dig.lodylands.com` : rien. Paramètres → Publicité →
   « Retirer mon accord » → la bannière disparaît. Pour revenir en arrière : décocher
   l'interrupteur.

## 6. Choix techniques faits seul

- **Iframe sandbox servie par le jeu plutôt que le script dans la page** : c'est la seule façon
  d'exécuter un script tiers non audité sans exposer la session ni les données du jeu, et cela
  isole la variable globale `atOptions` de chaque unité.
- **`'strict-dynamic'` dans la CSP du cadre** : la régie charge probablement des sous-scripts
  depuis d'autres domaines. Ils sont admis, mais restent confinés à l'origine opaque du cadre.
- **Mobile masqué sur l'écran de minage par défaut** : sur un clicker mobile, c'est l'écran où le
  risque de clic accidentel est le plus fort (règle « si séparation impossible, ne pas afficher »).
  Réglable dans l'admin.
- **Consentement maison accepter/refuser, sans TCF** : aucune CMP certifiée n'est nécessaire pour
  *ne rien charger* sans accord. Voir la question 2 pour la conformité complète.
- **Codes des unités non commités** : ils se collent dans l'admin et sont stockés en base.
  Ils ne sont pas secrets, mais les garder hors dépôt rend l'activation explicite.
- **Compteur « cadres servis » seulement** : c'est la seule mesure fiable et légale de notre côté.
  Les impressions et revenus réels relèvent de la régie.
- **`robots.txt` `Disallow: /` sur l'adresse alternative** : elle reste utilisable mais
  n'apparaît pas dans les moteurs, conformément à ton rôle pour ce domaine.

## 7. Décisions demandées au propriétaire

1. **Légitimité de `bauval.org`** : demander au support officiel de ta régie une confirmation
   écrite que `bauval.org` (BPGame / Game Plan Zero Limited) diffuse bien les unités 32005478 et
   32005479. *Recommandation : ne pas activer avant cette réponse.*
2. **Consentement EEE / Royaume-Uni / Suisse** :
   - (a) garder la fenêtre maison (aucun chargement sans accord, mais aucun signal TCF transmis) ;
   - (b) intégrer une CMP certifiée IAB TCF v2.2, éventuellement payante.
   *Recommandation : (a) pour un premier essai limité, (b) si la régie exige le TCF ou pour
   AdSense.*
3. **Mineurs** :
   - (a) pas de publicité tant que l'âge n'est pas connu ;
   - (b) publicité seulement après une déclaration « j'ai 13 ans ou plus », sinon rien ;
   - (c) publicité pour tous, avec catégories adultes désactivées côté régie.
   *Recommandation : (b).*
4. **Coordonnées de l'éditeur** à publier sur la page de confidentialité (nom ou raison sociale,
   pays, e-mail de contact). À saisir dans l'admin.
5. **Vidéo récompensée** : à arbitrer quand une régie fournissant un postback serveur aura été
   choisie : durée, multiplicateur du boost de pièces, délai de récupération, plafond par jour.

## 8. Reste à faire

- Déployer `f647ec0` après une suite complète verte sur la release (prochaine session).
- Après lancement :
  - traductions EN/NL/ES de la page de confidentialité ;
  - CMP TCF si décidée ;
  - vidéo récompensée avec preuve serveur ;
  - option « sans publicité » ;
  - comparaison officielle des régies (Adsterra, Monetag, Nitro, CrazyGames), non confirmée dans
    cette session faute de sources officielles trouvées.
- À signaler (hors périmètre) :
  - le bouton actuel « Doubler la récompense » lance une **publicité simulée** qui accorde
    réellement le bonus (traité par #46) ;
  - `test/antibot.test.js` peut ne pas rendre la main à la fin de son exécution (fermeture du
    serveur de test à fiabiliser).
