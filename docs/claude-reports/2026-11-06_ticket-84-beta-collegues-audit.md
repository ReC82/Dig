# Ticket #84 — [P0][UX] Bêta collègues 09/11 : audit du parcours joueur et GO/NO-GO des invitations

Lien : https://github.com/ReC82/Dig/issues/84

## Session du 06/11/2026 — audit, 4 corrections UX, déploiement `0325c3a`

### 1. État réel

**Déployé en production (SHA `0325c3a`) — en attente de recette.** Aucun réglage de production n'a été modifié : mode d'inscription, invitations, bandeau, points de récompense et boutique sont restés tels quels. Aucune invitation n'a été créée ni envoyée. Aucune génération payante n'a été lancée. Rien n'a été annoncé.

### 2. Verdict

| Audience | Verdict | Pourquoi |
|---|---|---|
| **3 à 5 collègues invités, lundi 09/11** | **GO**, après 5 minutes de préparation de ta part (checklist §5) | Le parcours a été joué de bout en bout dans un vrai navigateur, sur PC 1280, Android 390 et 320 : lien d'invitation, inscription, premières minutes de jeu, coffres, onglets, F5, coupure réseau, passage PC↔mobile. Aucun blocage et aucune erreur JavaScript. Les 4 défauts UX trouvés sont corrigés et déployés (§3). |
| **10 à 20 testeurs, puis public** | **NO-GO** (inchangé) | Pas d'e-mail pour un mot de passe oublié (#43). Pas de sauvegarde hors de la machine (#36, bloqué). Anti-bot en observation seulement (#25/#77). Conformité légale du concours non faite (#27). Statut des points de récompense et de la boutique de cadeaux à trancher (question 1). |

Production relevée en lecture seule le 06/11 : inscription **sur invitation**, bandeau BÊTA affiché, bouton « 🐞 Signaler un bug » actif, **2 liens d'invitation encore actifs** (créés avant cet audit), lien Discord vide, texte de bêta par défaut, boutique de gemmes « Bientôt », publicité désactivée, missions serveur désactivées (missions du navigateur), pioche à charges désactivée.

La saison en cours se termine le **9/11 à 00:59**. Les collègues commenceront donc lundi dans une saison neuve (« La Saison des Lanternes »), avec le même classement de départ que les joueurs actuels.

### 3. Audit point par point

Légende : ✅ prouvé dans le navigateur · 🔧 bug corrigé et déployé · ⚠️ limite ou point à décider · ⬜ non vérifié.

**1. Première minute**
- ✅ Le lien `/?invite=…` mène au choix de la langue, puis au formulaire « 🎟️ Tu es invité·e à la bêta… », sans champ « code ». Le code disparaît de la barre d'adresse.
- ✅ Les erreurs sont claires et le formulaire garde la saisie : « Mot de passe trop court (6 caractères minimum). », « Nom d'utilisateur ou mot de passe incorrect. ». La touche Entrée valide l'inscription et la connexion.
- ✅ L'avertissement « la récupération du mot de passe par e-mail n'est pas encore active » s'affiche dès l'inscription.
- 🔧 **Après « Créer le compte », le joueur restait sur Paramètres**, sans aucune indication de la suite (et l'onglet « Dig » du bas restait surligné). Désormais, le jeu revient directement au bloc, affiche « ✅ Compte créé ! Touche le bloc pour creuser. » et propose la carte « Première partie ? » (tutoriel #79). La connexion d'un compte existant reste sur Paramètres, comme avant.
- ✅ La mise en page tient à 1280, 390 et 320 px, sans débordement horizontal.

**2. Les 10 à 15 premières minutes**
- 🔧 **Le vocabulaire changeait d'un écran à l'autre** : la barre affichait « Coins » et le bloc « 3 / 3 HP », alors que l'aide et les missions parlent de « pièces » et de « PV ». Le français affiche désormais **Pièces** et **PV** partout (bloc, reliques). L'espagnol suit aussi la traduction (« PV »). L'anglais et le néerlandais gardent « HP ».
- 🔧 **« Doubler la récompense » ouvrait une fausse pub « DIG! — Edition Pro / Doublez tous vos gains ! »**, c'est-à-dire un produit qui n'existe pas. La fenêtre affiche maintenant « **Bonus ×2 pendant 2 min** — Bêta : pub simulée, aucune vraie publicité. Attends la fin du décompte pour doubler tes pièces. ». Le mécanisme (boost ×2 de 2 min) n'a pas changé.
- 🔧 Les messages flottants trop longs sortaient de l'écran sur un téléphone de 320 px. Ils passent maintenant à la ligne.
- ✅ Environ 1 400 coups joués à 320 px : le point rouge sur « Amélios » apparaît dès qu'une amélioration est achetable. Les coffres (« Coffre en bois ouvert ! … RÉCUPÉRER ! ») et le retour au minage fonctionnent. Les « ? » s'ouvrent et se ferment.
- ✅ Les missions quotidiennes (Bricoleur, Accumulateur, Explorateur) et la connexion quotidienne (jour 1/7) sont lisibles.
- ⚠️ Rythme sans amélioration : environ 30 m après 2 000 coups. Ce n'est pas bloquant, l'économie est hors périmètre (#49).

**3. Motivation sociale**
- ✅ Onglet Saison : « Rang #1 · Ligue 🌼 Mimosa », « Blocs détruits manuellement : N », profondeur affichée à titre d'information. Le texte explique que seuls les blocs détruits à la main comptent, pas l'Auto-Dig (#73). Le compte à rebours de fin de saison est visible.
- ⚠️ **Points de récompense** : la carte affiche « Crédit réel actif » et « 🎁 Ouvrir la boutique de cadeaux (0 articles) » (« le catalogue ouvre bientôt. Tes points restent acquis. »). Aucun article n'est visible, donc aucun lot matériel n'est montré, mais le mot « cadeaux » peut être compris comme une promesse. Voir la question 1.
- ⚠️ Une seule ligue existe (Mimosa), alors que l'aide parle de « monter de ligue par promotion ». Ce n'est pas faux, mais aucune ligue supérieure n'existe encore (#19).

**4. Reprise**
- ✅ **F5** : même bloc, mêmes PV (34/171 → 34/171), mêmes pièces.
- ✅ **Coupure réseau** pendant le minage : le jeu continue. Après le retour du réseau puis un F5, rien n'est perdu (8 m, 18 pièces, 3/6 PV identiques).
- ✅ **PC ↔ mobile** : la connexion sur PC fait apparaître sur le téléphone « 📱 Partie ouverte sur un autre appareil… Jouer ici » (environ 15 s après). « Jouer ici » reprend la partie.
- ⚠️ Si les deux appareils restent ouverts en même temps, les derniers coups du premier (au plus environ 12 s, la cadence de synchronisation) peuvent ne pas être repris. Constaté : 3 PV d'écart. Quand l'onglet est fermé ou masqué, une sauvegarde finale a lieu. Classement : après lancement.
- ⚠️ « Sauvegardé ✓ » s'affiche aussi hors ligne : la sauvegarde est alors locale, puis envoyée au retour du réseau. Classement : après lancement.

**5. Boutique**
- ✅ Gemmes (5 / 20 / 60) et Boost ×3 : boutons grisés « Bientôt ». Aucun paiement possible. Le guide « Où dépenser quoi ? » distingue Pièces → Coffres, Argent réel → bientôt, Points de saison → Cadeaux. Rien n'est nécessaire pour progresser.

**6. Sécurité et accès bêta**
- ✅ Le mode invitation est actif en production. Les liens individuels sont créés depuis Admin → 🧪 Bêta (« ➕ Inviter un testeur », recettes #57/#72/#80 déjà validées, non redemandées ici). Un lien réutilisé est refusé clairement.
- ✅ « 🐞 Signaler un bug » est visible dans le bandeau sur chaque écran. Le texte de bêta (« la progression peut être ajustée ou remise à zéro… aucune récompense réelle n'est promise ») est affiché dans Paramètres → Bêta.
- ⬜ Lien Discord non configuré : le bouton n'apparaît pas, ce qui est normal. Le chemin de signalement reste le bouton du jeu.
- Dépendances : #43 (SMTP) en attente, donc un mot de passe perdu passe par toi (Admin → Paramètres avancés → « Mot de passe perdu »). #36 (sauvegarde hors machine) est bloqué, mais les sauvegardes locales quotidiennes et avant chaque déploiement fonctionnent. #25/#77 (anti-bot) restent en observation. #27 (concours) est désactivé. **Ces points suffisent pour 3 à 5 collègues, pas pour une vague plus large.**

### 4. Changements réalisés (SHA `0325c3a` sur `develop` et `main`, branche `feature/84-beta-collegues-audit`, commit `87c9c39`)

- `public/js/main.js` : retour au bloc et message après la création du compte. Le texte des PV du bloc passe par la traduction (`ui.hp_text`).
- `public/js/i18n.js` : FR « Pièces » et « PV ». Nouveaux textes `account.registered_play` et `ui.ad_mock_title`. Texte de la pub simulée réécrit (FR/EN/NL/ES).
- `public/index.html` : titre et sous-titre de la pub simulée traduits.
- `public/css/style.css` : retour à la ligne des messages flottants.
- `i18n/it.json` et `public/js/locales/it.js` : pilote italien mis à jour (7 entrées), toujours couvert à 100 %.
- `test/e2e/beta-first-minute.e2e.js` (nouveau) et `test/e2e/decimal-damage.e2e.js` (« PV »).

**Vérifications effectuées**
- `npm test` : 841/841 dans le worktree, dans `develop` après fusion et dans la release `0325c3a`.
- Essais Chromium sur un serveur de test (base neuve, mode invitation) : `beta-first-minute` 11/11 (1280, 390, 320), `tutorial` 128/128, `help` 123/123, `decimal-damage` 31/31, `beta-invite` 8/8, sans erreur JavaScript.
- Parcours exploratoires scriptés : inscription, environ 3 000 coups, onglets, F5, coupure réseau, PC↔mobile.
- Commande : `PW=…/playwright-core CHROME=…/chrome-headless-shell BASE=http://127.0.0.1:<port> ADMIN=<secret de test> OUT=/tmp/x node test/e2e/beta-first-minute.e2e.js`.

**Non vérifié** : un vrai téléphone Android et l'installation PWA (seule l'émulation Chromium a été utilisée), un iPhone/Safari, et un réseau lent réel (seule une coupure franche a été testée).

**Données des joueurs** : aucune migration. Seuls des textes et le style de l'interface ont changé.

### 5. Déploiement et préparation de lundi

- Déployé : `8cf6674 → 0325c3a` avec `scripts/deploy.sh` (release). Sauvegarde vérifiée : `~/backups/dig/dig-20261106-184958-pre-deploy-0325c3a.sqlite`.
- Avant déploiement : copie de la base de production démarrée en `NODE_ENV=production`. Empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques.
- Après déploiement : les 2 domaines répondent 200 avec `1.0.0+0325c3a`. `quick_check` = ok. Journal sans erreur. Empreintes de production identiques à la copie. Chromium sur la production en visiteur, sans créer de compte : « Pièces », « 3 / 3 PV », « Bonus ×2 pendant 2 min », carte « Première partie ? », aucun débordement ni erreur (1280 et 390).
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep 8cf6674` puis `sudo systemctl restart dig`. Aucune base à restaurer.

**Checklist avant d'inviter (5 min, à faire par toi) :**
1. Admin → 🧪 Bêta → « 🗂️ Gérer les invitations » : révoque les 2 liens encore actifs s'ils ne sont pas destinés à des collègues.
2. Crée **un lien par collègue** (« ➕ Inviter un testeur », prénom) et envoie-le avec le message du §6.
3. (Facultatif) « ⚙️ Configurer la bêta » : colle un lien Discord si tu en as un.
4. Réponds à la question 1 (points et cadeaux) avant l'envoi.
5. Le soir : Admin → 🧪 Bêta → « 💬 Voir les retours ».

**Recette humaine — 10 minutes, 5 étapes, uniquement des tests nouveaux :**
1. **Téléphone, fenêtre privée, ton propre lien d'invitation de test** → Français → pseudo, e-mail, mot de passe « 123 » puis **Entrée**. *Attendu :* « Mot de passe trop court (6 caractères minimum). », pseudo conservé. Corrige le mot de passe, puis **Entrée**. *Attendu :* le jeu revient seul au bloc, « ✅ Compte créé ! Touche le bloc pour creuser. » (sur 2 lignes si l'écran est étroit) et la carte « Première partie ? ».
2. Touche « Passer », puis regarde la barre du haut. *Attendu :* « **PIÈCES** » (et non « Coins »), et sous le bloc « 3 / 3 **PV** » (et non « HP »).
3. Touche « 📺 Doubler la récompense ». *Attendu :* « **Bonus ×2 pendant 2 min** — Bêta : pub simulée, aucune vraie publicité… » (plus d'« Edition Pro »). Attends le décompte, puis « Récupérer le bonus » → « Boost ×2 actif ! ».
4. Mine 1 à 2 minutes. Ouvre ensuite le même compte **sur le PC** (connexion, Entrée). *Attendu :* le PC reste sur Paramètres (« Connecté : … »). Environ 15 s plus tard, le téléphone affiche « Partie ouverte sur un autre appareil », et « Jouer ici » reprend la partie.
5. Sur le PC : onglet 🏆 Saison. Ton compte de test apparaît avec ses « Blocs détruits manuellement ». Lis la carte « Points de récompense » et réponds à la question 1. Garde ce compte de test : il ne gêne pas les collègues.

Classement : **Bloquant MVP (bêta collègues)** pour l'étape 1 (première minute). **Après lancement** pour les étapes 2 et 3 (clarté), livrées quand même.

### 6. Message d'invitation proposé (à copier, à adapter)

> Salut ! Je teste **DIG!**, un petit jeu où l'on creuse en touchant un bloc. Ton lien personnel (valable une seule fois) : **<lien>**
> 1. Ouvre-le sur ton téléphone ou ton PC, choisis la langue, puis crée ton compte (pseudo, e-mail, mot de passe). **Note bien ton mot de passe** : la récupération par e-mail n'existe pas encore.
> 2. Touche le bloc pour creuser. Le tutoriel de 6 étapes est facultatif, et le **?** en haut à gauche explique tout.
> 3. C'est une **bêta** : ta progression peut être ajustée ou remise à zéro, rien n'est payant, et **aucune récompense réelle n'est promise** (les points et la « boutique de cadeaux » sont des tests).
> 4. **Un bug ou une remarque ?** Touche **🐞 Signaler un bug** dans le bandeau violet en haut de l'écran : décris ce que tu faisais, coche « joindre le diagnostic », et envoie. Tu peux suivre son statut dans Paramètres → Bêta → « Mes signalements ».
> 5. Mot de passe oublié, ou souci pour te connecter : écris-moi directement.
>
> Merci ! Le classement de la saison repart à zéro lundi : rattrape tes collègues 😉

### 7. Choix techniques faits seul

- Retour au bloc seulement après une **inscription**. Après une connexion, on reste sur Paramètres : la liaison Google ou X peut y être proposée, et c'est le comportement attendu par les recettes #28/#63.
- Le bloc utilise désormais la clé `ui.hp_text`, qui existait déjà sans être utilisée, au lieu d'un « HP » codé en dur. Les espaces fines ont été remplacées par des espaces normales, pour que l'affichage reste identique dans les autres langues.
- Pub simulée : seul le texte change. La durée, le boost et le délai entre deux bonus ne bougent pas (règle « ne pas changer l'économie »).
- Italien : 7 entrées retraduites par cette session (`origin: ai`), pas marquées comme relues par un humain.

### 8. Décisions demandées au propriétaire

1. **Points de récompense et « boutique de cadeaux » pendant la bêta collègues.** L'onglet Saison affiche « Crédit réel actif » et « Ouvrir la boutique de cadeaux (0 articles) — le catalogue ouvre bientôt ». Options :
   - **A.** Ne rien changer, et préciser dans le message d'invitation que les points et les cadeaux sont des tests. Aucun article n'existe, donc rien de matériel n'est montré. **Recommandé pour lundi.**
   - **B.** Passer les points en mode « simulation » (réglage existant et réversible de l'admin) pendant la bêta : la carte affiche alors « Aperçu… pas encore crédités ». Les points déjà crédités restent acquis. Un retour en « réel » ne crédite pas rétroactivement les saisons closes pendant la simulation.
   - **C.** Masquer la boutique de cadeaux tant que le catalogue #34 n'est pas prêt. Il faudrait un développement : à demander dans #34.
2. Aucune autre décision n'est nécessaire pour inviter 3 à 5 collègues.

### 9. Reste à faire

- Après lancement (signalé, non fait) :
  - synchronisation immédiate quand un autre appareil prend la main (au lieu d'attendre jusqu'à 12 s) ;
  - « Sauvegardé ✓ » à nuancer hors ligne (« sauvegardé sur cet appareil ») ;
  - erreurs serveur d'inscription et de connexion en français seulement, même pour un joueur EN/NL/ES ;
  - ligne « Compte X — Non disponible pour le moment » superflue dans Paramètres ;
  - texte des ligues à ajuster tant qu'une seule ligue existe (#19).
- Avant 10 à 20 testeurs ou le public : #43, #36, #25/#77 (décision enforce), #27, ainsi que #34/question 1.

---

## Mise à jour du 07/11/2026 : accès Discord demandé par le propriétaire

**État réel : en attente de #50.** Aucun code modifié dans #84 et aucun déploiement pour cette mise à jour.

**Demande.** Le propriétaire a commenté le 07/11 ([commentaire](https://github.com/ReC82/Dig/issues/84#issuecomment-6705096166)). Il demande pour la bêta du lundi 09/11 une entrée « Rejoindre le Discord » dans le jeu, avec le lien officiel `https://discord.gg/eGzJrzbaq`. La spécification complète est sur **#50**. Le contrôle d'ouverture sur PC et sur mobile doit être ajouté à la recette #84. Il ne faut ni refaire les parcours d'inscription ni envoyer d'invitations automatiquement.

**Ce qui existe déjà (vérifié en lecture le 07/11, production `1.0.0+8a26e0b`).**
- **Un seul champ** « Lien d'invitation Discord » dans Admin → 🧪 Bêta → Configurer la bêta (`server/beta.js`). Il est relu par les Actualités (`server/news.js`).
- **Côté joueur**, le lien n'apparaît que s'il est renseigné :
  - bannière bêta et fenêtre de signalement (`public/js/beta.js`) ;
  - panneau Actualités (`public/js/news.js`) ;
  - aide « mot de passe oublié » du compte (`public/js/main.js`).
- **En production, le lien n'est pas configuré** : `GET /api/beta/config` renvoie `"discordUrl": null`. Aucun lien Discord n'est donc visible dans le jeu aujourd'hui.

**Choix.** Ce développement appartient à #50. Il faut y ajouter :
- un accès bien visible à 320 et 390 px ;
- une validation stricte des adresses d'invitation Discord ;
- le texte en italien ;
- des tests avec et sans lien.

Le faire aussi dans #84 doublerait le travail et risquerait des conflits. #84 est donc rendu **« prêt, dépend de #50 »**. Une fois #50 déployé, la session #84 ajoutera le contrôle d'ouverture ci-dessous à la recette, sans rien refaire d'autre.

**Action simple pour le propriétaire (possible dès maintenant).**
1. Ouvre `/admin/` → 🧪 Bêta → Configurer la bêta.
2. Colle `https://discord.gg/eGzJrzbaq` dans « Lien d'invitation Discord ».
3. Enregistre.

Le lien apparaît alors tout de suite dans la bannière bêta et dans Actualités, avec la version actuelle. Aucune session ne modifie ce réglage de production à ta place.

**Contrôle d'ouverture à ajouter à la recette #84 (après #50).**
1. Sur PC (1280 px), ouvre le jeu puis Actualités. « Rejoindre le Discord » s'ouvre dans un nouvel onglet sur `discord.gg/eGzJrzbaq`. En revenant sur l'onglet du jeu, tu retrouves le même bloc et la même progression.
2. Sur Android (navigateur, puis PWA installée), fais le même parcours. L'application Discord ou le navigateur s'ouvre, et le retour au jeu ne perd pas l'état de minage.
3. Vide le lien dans l'admin. Aucun bouton Discord ne reste visible et le jeu reste jouable.

**Classement.** Après lancement pour le MVP public. Il est utile pour la bêta collègues, mais pas bloquant : le chemin de signalement des bugs dans le jeu existe déjà.

**Décision demandée.** Aucune nouvelle. La question sur les points de récompense et la boutique de cadeaux reste ouverte (options A, B ou C ; A recommandée).

---

## Mise à jour du 07/11/2026 (2) : #50 déployé, contrôle d'ouverture Discord ajouté à la recette

### 1. État réel

**Déployé en production via #50 (SHA `b500256`) — en attente de recette.** Cette session ne modifie aucun code : elle vérifie l'accès Discord livré par #50 et complète la recette #84. Il n'y a pas de nouveau déploiement. Le lien Discord **n'est toujours pas saisi en production** : à 11:00 UTC le 07/11, `GET /api/beta/config` renvoie `"discordUrl": null` avec la version `1.0.0+b500256`. Aucune session ne modifie ce réglage à ta place.

### 2. Ce qui a été vérifié (SHA `3b782db` sur `develop` = code `b500256` en production + rapport)

Le parcours Chromium `test/e2e/discord-access-50.e2e.js` a tourné sur un serveur de test (port 3101, base `test-84.sqlite`, supprimée ensuite), en 1280×900, 390×844 et 320×640.
- **Avec `https://discord.gg/eGzJrzbaq`** : 39/39 OK.
  - Le bouton est en tête d'Actualités, visible sans défiler, haut de 44 px, sans débordement.
  - L'adresse ouverte est exactement celle-ci, dans un nouvel onglet (`noopener`), sans accès à la fenêtre du jeu.
  - Le jeu reste dans son onglet avec **le même bloc et les mêmes PV**.
  - Il est accessible au clavier (Tab, puis Entrée).
  - Le lien apparaît aussi dans Aide → « Communauté ».
- **Lien vidé** : 6/6 OK. Il n'y a plus aucun bouton Discord, ni dans Actualités ni dans l'Aide.

**Non vérifié par la machine** : l'ouverture réelle de l'application Discord sur Android et en PWA installée. Seul un vrai téléphone peut le confirmer, d'où l'étape 6 ci-dessous.

### 3. Recette #84 complétée : contrôle d'ouverture Discord (≈ 3 min, à ajouter aux étapes 1 à 5 du 06/11)

Aucune inscription à refaire. Aucune invitation Dig n'est envoyée.

0. **Préalable (toi, 30 s)** : `/admin/` → 🧪 Bêta → « ⚙️ Configurer la bêta » → colle `https://discord.gg/eGzJrzbaq` dans « Lien d'invitation Discord » → Enregistrer.
6. **PC** : sur ton compte de test, mine un coup et note le bloc et ses PV. Ouvre la cloche 🔔 et clique sur « 💬 Rejoindre le Discord » (tout en haut). *Attendu :* un nouvel onglet s'ouvre sur l'invitation Discord. Reviens sur l'onglet du jeu : même bloc, mêmes PV, et le minage continue.
7. **Téléphone, navigateur puis PWA installée** : fais le même essai depuis 🔔, puis depuis **?** → « Communauté ». *Attendu :* le navigateur ou l'application Discord s'ouvre. Au retour sur Dig, la partie est intacte : même bloc, pas de reconnexion et pas de « Partie ouverte sur un autre appareil ».
8. *(Facultatif)* Vide le champ dans l'admin, puis rouvre 🔔 et **?**. *Attendu :* aucun bouton Discord, et le jeu reste jouable. Remets ensuite le lien avant lundi.

Le message d'invitation du §6 peut ajouter une ligne : « 6. Envie d'échanger ? 🔔 → Rejoindre le Discord (facultatif). »

### 4. Classement

**Après lancement** pour le MVP public : c'est utile pour la bêta collègues, mais pas bloquant, puisque le signalement de bugs dans le jeu existe. Le verdict du 06/11 ne change pas : **GO pour 3 à 5 collègues, NO-GO pour 10 à 20 testeurs et le public**.

### 5. Décisions demandées au propriétaire

1. *(Toujours ouverte)* **Points de récompense et boutique de cadeaux pendant la bêta** :
   - **A** : ne rien changer et le préciser dans le message. **Recommandé.**
   - **B** : mode simulation, réversible.
   - **C** : masquer la boutique de cadeaux (développement dans #34).
2. Action d'admin, ce n'est pas une décision : saisir le lien Discord (étape 0).

### 6. Reste à faire

Rien côté code pour #84. Il reste la recette du propriétaire (étapes 1 à 8) et la réponse à la question 1.

---

## Mise à jour du 08/11/2026 : #84-B validé, préparation de la recette #84-C (premier coffre)

### 1. État réel

**Partiel — correction prête sur la branche, non intégrée et non déployée.** Le 08/11 à 09:19 UTC, le propriétaire a validé **#84-B** (premières améliorations comprises, effet perceptible). Il demande de poursuivre avec **#84-C : premier coffre et compréhension de la récompense**, à distinguer du chantier économique #49/#88, et précise : « Aucun changement de production autorisé par ce test ».

La production reste donc en `1.0.0+444ee81`, sans changement. La correction de texte ci-dessous est committée sur `feature/84-beta-collegues-audit` (`4648133`), mais **pas fusionnée dans `develop`**. Sinon, le prochain ticket déployé l'emporterait en production sans ton accord.

### 2. Ce qui a été vérifié (code de production `444ee81` + `develop` `b5cac5a`, docs seulement)

Parcours joué dans Chromium à 390×844 (mode invitation, nouveau compte, serveur de test sur le port 3101, base `test-84.sqlite` supprimée ensuite) :
- **Coffre miné** : le premier est apparu à 24 m avec 562 pièces (une « Vieille caisse » : 317 pièces). Sur un autre compte, aucun coffre n'est apparu en 1 500 coups. L'apparition est aléatoire.
- **Coffres de saison** (onglet Amélios, sous les améliorations) : les cartes, le guide « Où dépenser quoi ? » et le bouton « ℹ️ Récompenses et chances » sont clairs. Le tableau des chances explique bien le boost (« des pièces des blocs ») et le fait que les pièces d'un coffre ne sont pas multipliées.
- **Achat d'un Coffre simple** avec un compte connecté : tirage côté serveur, pièces débitées, fenêtre de récompense affichée. Aucune erreur JavaScript.
- Prix publiés en production (`GET /api/shop/chests`) : Coffre simple **800**, rare 15 000, antique 80 000 (limité à 5). Les brouillons #88/#49 ne sont pas publiés et ne changent pas ce que voit le joueur.

**3 défauts de vocabulaire trouvés en français** (dans les fenêtres que #84-C teste) :

| Où | En production | Après la correction (`4648133`) |
|---|---|---|
| Titre d'un coffre miné | « Vieille caisse **ouvert** ! » (faute d'accord) | « Coffre ouvert : Vieille caisse » |
| Récompense boost (coffre miné ou acheté) | « ⚡ Boost ×2 **coins** — 3 min » | « ⚡ Boost ×2 des pièces des blocs — 3 min » |
| Description du Coffre simple | « **Coins**, fragments ou boost… » | « Pièces, fragments ou boost… » |
| (même mot, récompense quotidienne) | « ⚡ ×2 **coins** pendant 10 min » | « ⚡ ×2 pièces pendant 10 min » |

Changements : `public/js/i18n.js` (4 textes FR), pilote italien (`i18n/it.json`, `public/js/locales/it.js`, 4 entrées), nouveau test `test/first-chest-84c.test.js`. Le test échoue sans la correction et réussit avec. **`npm test` : 917/917.** Le rendu a été revérifié dans Chromium à 390 px, sans débordement et sans erreur JS. Les données des joueurs ne sont pas concernées : ce sont des textes seulement, sans migration.

### 3. Recette #84-C proposée (≈ 5 min, téléphone, compte de test de #84-B)

Elle peut se faire **sur la production actuelle**. Les 3 textes ci-dessus y apparaissent encore, sauf si tu autorises le déploiement (question 2).
1. Onglet **Amélios**, descends jusqu'à « 📦 Coffres de saison ». *Attendu :* tu comprends que les coffres se paient en **pièces**, et tu vois le prix (Coffre simple : 800).
2. Touche « ℹ️ Récompenses et chances » du Coffre simple. *Attendu :* tu comprends qu'une ouverture donne **une seule** récompense, tirée au sort, et ce que fait un boost. Ferme la fenêtre.
3. Avec au moins 800 pièces, touche « Ouvrir ». *Attendu :* une fenêtre affiche la récompense. Après « Récupérer ! », tu vois l'effet : les **Pièces** changent, le compteur **🔮 Frags** augmente, ou un bandeau « Bonus ×2 pièces actif » apparaît.
4. Mine jusqu'à tomber sur un coffre à la place d'un bloc (Vieille caisse, Coffre en bois ou en fer), ce qui peut prendre quelques minutes. *Attendu :* même fenêtre, et la récompense arrive dans le compteur correspondant.
5. Si tu as reçu des fragments, touche **?** puis « Fragments ». *Attendu :* tu comprends à quoi ils servent (reliques, onglet Collection).

À noter dans ta réponse : « #84-C validé » ou ce qui n'était pas clair.

### 4. Classement

Les 3 défauts de vocabulaire sont **Après lancement** : ils sont cosmétiques, ne bloquent rien, et le sens reste compréhensible. Le verdict du 06/11 ne change pas : **GO pour 3 à 5 collègues**, NO-GO pour 10 à 20 testeurs et le public.

### 5. Choix techniques faits seul

- **Pas d'intégration dans `develop`** : tout ce qui entre dans `develop` part en production avec le ticket suivant. Or ta consigne du 08/11 exclut tout changement de production pour ce test.
- Titre « Coffre ouvert : {nom} » plutôt que « {nom} ouvert(e) ! » : une seule formulation, juste pour tous les coffres, sans gérer le genre de chaque nom.
- Le boost reprend la formule du tableau des chances (« des pièces des blocs »), pour un seul vocabulaire.
- Je n'ai pas ajouté de phrase « à quoi servent les fragments » dans la fenêtre du coffre : ce serait un nouveau texte à traduire dans 5 langues. L'aide l'explique déjà. C'est proposé « après lancement ».

### 6. Décisions demandées au propriétaire

1. *(Toujours ouverte)* **Points de récompense et boutique de cadeaux pendant la bêta** : **A** ne rien changer et le préciser dans le message (**recommandé**), **B** mode simulation, **C** masquer la boutique (#34).
2. **Déployer avant lundi la correction de texte `4648133`** (4 textes FR, sans risque pour les données) ?
   - **A** : oui. Elle est intégrée dans `develop` et déployée par la procédure habituelle (sauvegarde, retour arrière). **Recommandé** : les collègues verront « pièces » partout.
   - **B** : non, après la bêta.

### 7. Reste à faire

Ta recette #84-C, puis ta réponse aux questions 1 et 2. Suite proposée, après lancement : une ligne d'aide sous une récompense « fragments » dans la fenêtre du coffre.

## Mise à jour du 08/11/2026 (2) : #84-C validé, recette #84-D — ordre de l'onglet Saison corrigé et déployé `5f0c2a6`

### 1. État réel

**Déployé en production (`1.0.0+5f0c2a6`) — en attente de recette #84-D (ordre et repli des blocs).**

Le propriétaire a validé **#84-C** (premier coffre, 08/11 09:26 UTC), puis testé l'onglet **Saison** sur téléphone (**#84-D**, 08/11 09:33 UTC). La compréhension du classement est validée. Il demande de corriger la hiérarchie, sans question et avant la bêta du 09/11 : classement plus haut, « Prochaine saison » plus bas, points de récompense sur une ligne repliable, plus de doublon avec la boutique de cadeaux. Aucun calcul, aucun réglage et aucun mode de production ne devait changer.

### 2. Changements (branche `feature/84-saison-hierarchie`, commit `264f2d6`, fusion `develop` `5f0c2a6`)

Nouvel ordre de l'onglet Saison :

| Avant (`444ee81`) | Après (`5f0c2a6`) |
|---|---|
| Thème · fin · **Prochaine saison** · rang · **grande carte Points** (avec bouton « Ouvrir la boutique de cadeaux ») · classement · résultat précédent · **Boutique de cadeaux** · explications · historique | Thème · fin · rang · **classement** · **🏅 Points de récompense · Solde : 10 pts ›** (une ligne repliée) · **Prochaine saison** · résultat précédent · explications · historique |

- **Points de récompense** : une ligne repliée par défaut, avec le titre, le solde et un chevron qui tourne à l'ouverture. Dépliée, elle contient tout ce qui existait : la bannière « Crédit réel actif » (ou simulation), l'estimation de fin de saison, le barème, l'historique et la **boutique de cadeaux** (catalogue, commandes, échanges). Rien n'est supprimé.
- **Doublon retiré** : le bouton « 🎁 Ouvrir la boutique de cadeaux (0 articles) » et la carte boutique séparée en bas sont remplacés par une seule boutique, rangée dans les points dépliés. Le solde n'y est plus répété.
- **État conservé** : la section reste ouverte après l'actualisation automatique (30 s) et après un échange. Elle est repliée à chaque nouvelle ouverture de l'onglet. Le lien « 🎁 Cadeaux » du guide « Où dépenser quoi ? » (Amélios, Boutique) déplie les points et la boutique, puis y fait défiler l'écran.
- **Clavier et petits écrans** : Tab puis Entrée déplie et replie la section, avec un contour de focus visible. En dessous de 380 px, le libellé « Solde : » est masqué (« 🏅 Points de récompense 10 pts › ») pour garder une seule ligne sans couper le titre.
- Fichiers : `public/js/main.js` (rendu de l'onglet Saison), `public/css/style.css`, nouveau test `test/season-points-fold-84d.test.js`, tests mis à jour `test/season-view.test.js`, `test/e2e/season-player-fold.e2e.js`, `test/e2e/shop-ux.e2e.js`.

### 3. Vérifications

- `npm test` : **920/920** sur la branche, sur `develop` `5f0c2a6` et dans la release. Le nouveau test échoue (0/4) avec l'ancien `main.js` et réussit avec le nouveau.
- Chromium sur un serveur de test (port 3101, **copie locale de la base**, avec un compte de test à 10 points et 40 blocs ; copie supprimée ensuite) en **320×640, 360, 390×844 et 1280×900** :
  - À 390×844 et 1280×900, le titre du classement et les premiers rangs sont **visibles dès l'ouverture**, sans défilement. À 320×640, le titre du classement apparaît en bas de l'écran.
  - Ordre vérifié : thème < rang < classement < points < prochaine saison < résultat < explications < historique.
  - Points repliés par défaut, sur une ligne de 32 px, titre non coupé à 320, 360 et 390 px. Une seule boutique, rangée dans les points. Plus de lien en double.
  - Dépliage au clavier, chevron qui tourne, section toujours ouverte après l'actualisation. Le guide des boutiques ouvre la boutique de cadeaux dépliée.
  - Aucun défilement horizontal, **0 erreur JS**. `season-player-fold.e2e.js` et `shop-guide.e2e.js` : OK.
- Non lancé : `shop-ux.e2e.js` (il demande un article créé dans l'admin). Il a seulement été adapté à la nouvelle structure.

### 4. Déploiement

- Release `5f0c2a6` : `npm ci` et `npm test` 920/920. Copie de la base de production démarrée en `NODE_ENV=production` sur le port 3122 : `/health` ok, version `1.0.0+5f0c2a6`, **empreintes identiques** avant et après le démarrage (`users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`). Copie supprimée.
- Aucune génération IA en cours (dernier appel de l'atelier : 09:43 UTC, déjà appliqué).
- `main` avancé `444ee81 → 5f0c2a6` (avance rapide). `scripts/deploy.sh` : sauvegarde vérifiée `~/backups/dig/dig-20261108-114028-pre-deploy-5f0c2a6.sqlite`, sans `npm ci`, santé et version OK.
- Après le déploiement : dig.lodygames.com et dig.lodylands.com renvoient 200, `1.0.0+5f0c2a6`. Le journal ne contient aucune erreur. `quick_check` = ok. Les empreintes des joueurs sont identiques à la sauvegarde. Onglet Saison en visiteur à 390 et 1280 px : classement avant « Prochaine saison », 0 erreur JS.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 444ee81` puis `sudo systemctl restart dig`. Il n'y a ni migration ni donnée touchée : changement d'affichage seulement.
- La correction de vocabulaire des coffres `4648133` **n'est pas incluse** : elle attend toujours ta réponse à la question 2.

### 5. Recette #84-D — ordre et repli (≈ 2 min, téléphone, compte de test)

1. Ouvre l'onglet **Saison**. *Attendu :* sous la saison en cours et le compte à rebours, ton rang, puis tout de suite **« Classement — blocs détruits manuellement »**, avec les premiers joueurs visibles sans défiler.
2. Sous le classement : une seule ligne **« 🏅 Points de récompense · Solde : … pts › »**, repliée. *Attendu :* plus de grande carte de points en haut, et plus de bouton « Ouvrir la boutique de cadeaux » en double.
3. Touche cette ligne. *Attendu :* le chevron tourne et tu retrouves « Crédit réel actif », l'estimation de fin de saison, le barème, l'historique et la **🎁 Boutique de cadeaux**. Touche-la de nouveau : elle se replie.
4. Descends. *Attendu :* « Prochaine saison : … » apparaît après les points, puis le résultat de la saison précédente, « Comment fonctionne la saison ? » et l'historique.

Réponds « #84-D validé » ou indique ce qui ne convient pas dans l'ordre ou le repli.

**Note** : la saison 45 se termine ce soir (09/11 00:59, heure de Bruxelles). Après cette heure, la carte « Prochaine saison » disparaît, parce que la saison des Lanternes sera en cours. Pour voir l'étape 4 telle quelle, teste avant ; sinon, vérifie seulement les étapes 1 à 3.

### 6. Classement MVP

**Bloquant bêta collègues** (demandé P1 UX avant le 09/11) : livré et déployé. Le verdict ne change pas : **GO pour 3 à 5 collègues**.

### 7. Choix techniques faits seul

- **Boutique de cadeaux rangée dans les points dépliés**, et non laissée seule plus bas. Ta demande 3 liste la boutique parmi ce qu'on retrouve « au dépliage ». C'est aussi ce qui supprime le doublon (demande 4) sans supprimer de fonction.
- **Points placés juste après le classement**, avant « Prochaine saison » : ils tiennent sur une ligne et concernent le joueur, alors que l'annonce est informative.
- **Repliée à chaque ouverture de l'onglet**, ouverte pendant les actualisations : c'est le comportement des autres sections repliables de l'onglet. Pas de mémoire entre les visites, pour garder la page courte par défaut.
- Branche dédiée `feature/84-saison-hierarchie`, créée depuis `develop`, pour ne pas embarquer `4648133` (encore soumis à ta question 2).
- La clé de traduction `points.shop_link` n'est plus utilisée, mais elle est conservée : aucun texte n'est supprimé dans les 5 langues.

### 8. Décisions demandées au propriétaire

1. *(Toujours ouverte)* **Points de récompense et boutique de cadeaux pendant la bêta** : **A** ne rien changer et le préciser dans le message (**recommandé**), **B** mode simulation, **C** masquer la boutique (#34). La nouvelle disposition replie déjà ces éléments, sans changer de mode.
2. *(Toujours ouverte)* **Déployer avant lundi la correction de texte `4648133`** (4 textes FR des coffres) : **A** oui (**recommandé**) / **B** après la bêta.

### 9. Reste à faire

Ta recette #84-D (ordre et repli). Après lancement : à 320×640, compacter la carte du thème pour faire remonter les premiers rangs du classement.

## Mise à jour du 08/11/2026 (3) : compétition entre collègues avec petits lots réels — protections vérifiées, bouton « Signaler une erreur », déployé `b565fd9`

### 1. État réel

**Déployé en production (`1.0.0+b565fd9`) — en attente de recette #84-E.**

Ton commentaire du 08/11 à 13:33 UTC change le cadre de la bêta : une **compétition interne d'une semaine**, avec **un sandwich pour le 1er** et **un petit chocolat pour le 2e**. Tu demandes aussi de mettre en service les protections #25, #91 et #71 sans clic de ta part, de surveiller les contestations, de dire aux collègues qu'ils peuvent signaler une erreur, de permettre une levée immédiate dans l'admin, de conserver les journaux et de ne rien annoncer comme actif sans vérification en production.

L'activation des protections est traitée dans leurs propres tickets, déjà déployés aujourd'hui : #25 en `55240ce`, #71 en `edf25f2`. Dans #84, j'ai **vérifié leur état réel en production** et ajouté le seul élément manquant pour les collègues : un moyen de contester une vérification ou une suspension **depuis la fenêtre anti-bot**.

### 2. Protections : ce qui est vraiment actif en production (relevé en lecture seule le 08/11 vers 16:20 UTC)

| Protection | État constaté en base de production | Ce que ça fait vraiment |
|---|---|---|
| Anti-bot #25, réponses | `antibot_response_mode = enforce` (Appliqué pour tous). Décision `issue25-global-enforce-2026-11-08` appliquée à 14:36 UTC. | Une vraie vérification arrive après **60 min de minage continu**, puis selon les cumuls 6 h / 24 h (au plus une toutes les 30 min). Le classement du joueur est gelé jusqu'à la réponse. Une suspension n'arrive que si les clics continuent pendant une vérification. |
| Pioche à charges #71 | Mode **Tous**, **5 000 coups**, **+1 toutes les 2 s**. Décision `issue71-global-on-2026-11-08` appliquée à 15:36 UTC. | Un autoclicker simple, qui clique toujours au même endroit, tombe en panne après environ 10 min. Il ne fait ensuite qu'1 dégât par coup. |
| Détection rapide #91 (25 clics au même pixel, cadence de 125 ms) | **Non livrée** (ticket #91 encore à faire). | Rien. Un autoclicker n'est donc pas repéré en quelques secondes. |
| Extensions de navigateur #92 | **Non livrée.** | Rien. |
| PV exacts #77 | `exact_hp_mode = shadow` (observation, selon ta décision du 05/11). | Observation seulement. |

**Activité depuis l'activation** : 0 vérification et 0 suspension créées. Aucun joueur n'a encore atteint un seuil. La chaîne de vérification n'a donc **pas encore été observée sur un vrai joueur en production**, seulement dans les tests et sur le serveur de test. Ta recette #25 (« Tester la protection ») en fera la preuve.

**Ce qu'on peut dire aux collègues** : « des protections anti-triche sont en test et peuvent afficher une petite vérification ». Il ne faut pas dire « la triche est impossible » : tant que #91 n'est pas livré, un autoclicker lancé moins d'une heure d'affilée n'est pas arrêté par l'anti-bot. Seule la pioche le freine.

**Levée immédiate et journaux** (déjà en place, vérifié dans le code déployé) :
- Admin → Anti-bot → fiche du joueur : **lever une suspension**, annuler une vérification, remettre le palier à 0. Chaque action est journalisée. En haut de la page, le bouton rouge **« Arrêt d'urgence : repasser en Observation »** agit en un clic.
- Les vérifications et suspensions (`antibot_challenges`, `antibot_suspensions`) ne sont **jamais purgées**. Le journal des événements de sécurité garde **90 jours**, largement plus que la semaine de compétition. Les signalements des joueurs restent dans Admin → 🧪 Bêta → « 💬 Voir les retours ».
- Pendant la compétition, ne supprime aucun compte de collègue (#90). Sa fiche et ses journaux disparaîtraient avec lui.

### 3. Changement livré : « 🐞 Signaler une erreur » dans la fenêtre anti-bot

Avant, la fenêtre de suspension disait « Écris-nous via Aide », mais l'Aide ne propose qu'un lien Discord. Le bouton « 🐞 Signaler un bug » du bandeau violet existait, mais rien ne le reliait à la vérification.

- Dans la fenêtre **« Petite vérification »** comme dans **« Minage manuel en pause »**, un bouton **« 🐞 Signaler une erreur »** apparaît sous « Fermer ». Il ferme la fenêtre et ouvre le formulaire de la bêta (le même que celui du bandeau), avec le champ « Ce que tu faisais » **pré-rempli** :
  - pour une vérification : « Vérification anti-bot affichée pendant que je jouais normalement (sans autoclicker). » ;
  - pour une suspension : « Minage manuel suspendu par l'anti-bot jusqu'au dim. 8 nov., 17:15, alors que je jouais normalement (sans autoclicker). »
- Le joueur complète, coche ou non « joindre le diagnostic », puis envoie. Le signalement arrive dans Admin → 🧪 Bêta → « 💬 Voir les retours ». Si le joueur ferme sans rien écrire, aucune confirmation n'est demandée. Un brouillon déjà commencé n'est jamais écrasé.
- Le bouton est **masqué** si les signalements de la bêta sont désactivés dans l'admin (« ⚙️ Configurer la bêta »). En production, ils sont **actifs**.
- Textes en FR, EN, NL, ES et IT (italien traduit par cette session, `origin: ai`, non relu par un humain). Rien d'autre ne change : seuils, sanctions, énigme et chrono sont identiques.
- Fichiers : `public/js/antibotGate.js`, `public/js/beta.js` (pré-remplissage, `reportsEnabled()`), `public/js/i18n.js`, `i18n/it.json`, `public/js/locales/it.js`. Tests : `test/antibot-report-84.test.js` (3 contrôles, qui échouent tous sans le changement), `test/e2e/antibot-report-84.e2e.js` (essai navigateur).

Branche `feature/84-signalement-faux-positifs` (commit `430cd88`, créée depuis `develop` pour ne pas embarquer `4648133`), fusion **`develop` `b565fd9`**.

### 4. Vérifications

- `npm test` : **960/960** sur la branche, sur `develop` `b565fd9` et dans la release.
- Essai navigateur `antibot-report-84.e2e.js` sur un serveur de test (port 3101, base de test neuve, supprimée ensuite) en **1280×900 et 390×844** : TOUT OK. Les étapes vérifiées sont : vérification émise, bouton visible et d'au moins 44 px, formulaire pré-rempli, fermeture sans confirmation ; suspension active avec l'heure de fin dans le texte ; signalements coupés, bouton masqué. **0 erreur JS.**
- Production après le déploiement, en visiteur, en 1280 et 390 : `DigBeta.reportsEnabled()` = vrai, **0 erreur JS**.

### 5. Déploiement

- Release `b565fd9` : `npm ci`, `npm test` 960/960. Copie de la base de production démarrée en `NODE_ENV=production` sur le port 3122 : `/health` ok, version `1.0.0+b565fd9`, **empreintes identiques** avant et après le démarrage (`users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`). Copie supprimée.
- Aucune génération IA n'était en cours. `main` a été avancé de `edf25f2` à `b565fd9` (avance rapide). `scripts/deploy.sh` a fait la sauvegarde vérifiée `~/backups/dig/dig-20261108-171704-pre-deploy-b565fd9.sqlite`, sans `npm ci`, puis contrôlé la santé et la version.
- Après le déploiement : les 2 domaines renvoient 200 avec `1.0.0+b565fd9`. Le journal ne contient aucune erreur et `quick_check` = ok. Les comptes, les saisons, les ligues et les valeurs du classement sont identiques à la sauvegarde. Seule différence : la sauvegarde automatique d'un joueur en cours de partie (version +1, même profondeur). C'est une progression, pas une perte. Réglages inchangés : `enforce`, pioche Tous 5 000.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep edf25f2` puis `sudo systemctl restart dig`. Aucune migration et aucune donnée touchée : seul l'affichage change.
- `4648133` (textes des coffres) **n'est toujours pas inclus**. Il attend ta réponse à la question 2.

### 6. Verdict mis à jour et préparation de la compétition

| Audience | Verdict |
|---|---|
| **Collègues, compétition d'une semaine avec sandwich et chocolat** | **GO**, à 4 conditions (ci-dessous). |
| 10 à 20 testeurs, puis public | **NO-GO** (inchangé) : #43, #36, #91, #27. |

1. **Période = la saison « des Lanternes »**. Les saisons sont hebdomadaires. La prochaine commence le **lundi 09/11 à 00:59** et se termine le **lundi 16/11 à 00:59** (heure de Bruxelles). À cette heure, le classement est **figé** côté serveur (#29). Annonce cette fin et donne les lots d'après le classement figé (onglet Saison → « Résultat de la saison précédente »). Pas besoin de capture au bon moment.
2. **Critère = « blocs détruits manuellement »** (#73), celui de l'onglet Saison. L'Auto-Dig ne compte pas. Écarte toi-même tes comptes de test du podium.
3. **Message** : utilise la version mise à jour ci-dessous. Elle n'annonce pas les protections comme infaillibles, elle explique la vérification et elle indique le bouton de signalement.
4. **Contestations** : chaque soir, regarde Admin → 🧪 Bêta → « 💬 Voir les retours » et Admin → Anti-bot (vérifications et suspensions du jour). Lève une suspension injustifiée depuis la fiche du joueur. En cas de série de faux positifs, utilise l'arrêt d'urgence. Avant de remettre les lots, regarde dans Admin → Anti-bot la fiche des 2 premiers : vérifications réussies, suspensions, coups par seconde.

Lots réels : ils sont remis par toi, hors du jeu. Dans le jeu, **rien ne change** : le concours intégré #27 reste désactivé (`enabled = 0`), aucun article n'est dans la boutique de cadeaux et aucun paiement n'est actif. Ton commentaire précise « Aucun cadeau payé en boutique ni paiement réel activé ». J'en déduis l'option **A** de la question 1 : ne rien changer et l'expliquer dans le message. Aucun réglage n'a donc été modifié. *Information, pas un blocage* : pour un concours ouvert au public, la conformité belge reste à traiter dans #27. Une compétition interne, gratuite, entre collègues, avec des lots symboliques, est ta décision.

**Message d'invitation mis à jour (à copier, à adapter)**

> Salut ! Je teste **DIG!**, un petit jeu où l'on creuse en touchant un bloc. Ton lien personnel (valable une seule fois) : **<lien>**
> 1. Ouvre-le sur ton téléphone ou ton PC, choisis la langue, puis crée ton compte (pseudo, e-mail, mot de passe). **Note bien ton mot de passe** : la récupération par e-mail n'existe pas encore.
> 2. Touche le bloc pour creuser. Le tutoriel est facultatif, et le **?** en haut explique tout.
> 3. **Petite compétition** du lundi 09/11 (00:59) au lundi 16/11 (00:59) : classement de l'onglet 🏆 Saison, « blocs détruits manuellement » (l'Auto-Dig ne compte pas). 🥪 Un sandwich pour le 1er, 🍫 un chocolat pour le 2e, offerts par moi. Les points et la « boutique de cadeaux » du jeu sont des tests et ne donnent rien de réel.
> 4. C'est une **bêta** : des protections anti-triche sont **en test**. Si tu creuses longtemps sans pause, une « Petite vérification » peut s'afficher. Touche les 2 symboles demandés et c'est reparti, sans rien perdre. Autoclickers et scripts interdits : ils peuvent exclure du classement.
> 5. **Un bug, ou une vérification ou une pause injustifiée ?** Touche **🐞 Signaler une erreur** dans la fenêtre, ou **🐞 Signaler un bug** dans le bandeau violet. Décris ce que tu faisais et envoie. Je regarde chaque soir et je peux lever une pause tout de suite.
> 6. Mot de passe oublié, ou souci pour te connecter : écris-moi directement.
>
> Merci, et bonne chance 😉

### 7. Recette #84-E — contester une vérification (≈ 3 min, ton compte de test)

1. Admin → Anti-bot → recherche ton compte de test → « Tester la protection » → « Sans autoclicker : envoyer la vérification tout de suite ».
2. Ouvre le jeu avec ce compte, sur ton téléphone. *Attendu :* la fenêtre « Petite vérification », puis sous « Fermer (je reviens plus tard) » un bouton **« 🐞 Signaler une erreur »**.
3. Touche-le. *Attendu :* la fenêtre se ferme et le formulaire de la bêta s'ouvre, avec « Vérification anti-bot affichée pendant que je jouais normalement (sans autoclicker). » déjà écrit. Ajoute « essai #84-E » et envoie.
4. Admin → 🧪 Bêta → « 💬 Voir les retours ». *Attendu :* ton signalement « essai #84-E ».
5. Touche le bloc. *Attendu :* la vérification revient. Résous-la, puis « Terminer le test » dans l'admin. Le mode global reste **Appliqué**.

Réponds « #84-E validé » ou dis ce qui ne convient pas. #84-D (ordre de l'onglet Saison) reste aussi à recetter.

### 8. Classement MVP

**Bloquant bêta collègues** (contestation demandée avant la compétition) : livré et déployé. **Après lancement** : #91 (détection rapide) reste le vrai frein contre un autoclicker. C'est le ticket P0 suivant à traiter pour que la compétition soit vraiment protégée.

### 9. Choix techniques faits seul

- **Réutilisation du formulaire « Signaler un bug » de la bêta**, plutôt qu'un nouveau canal de contestation. Il est déjà relié à l'admin et au diagnostic, et il est suivi dans Paramètres → Bêta → « Mes signalements ». Aucune table ni route nouvelle.
- **Bouton aussi sur la vérification**, pas seulement sur la suspension. Tu veux recueillir les faux positifs, et une vérification injustifiée en est déjà un.
- **Texte pré-rempli à la 1re personne**, que le joueur peut modifier. Le diagnostic reste un choix du joueur (case à cocher), comme avant.
- **Aucun changement des seuils, de la pioche ou de #91** dans #84. Ces réglages ont leurs propres tickets.
- **Question 1 considérée comme tranchée (A)** par ton commentaire. A consistait justement à ne rien changer, donc rien n'a été modifié. Si tu voulais B ou C, dis-le : c'est réversible.

### 10. Décisions demandées au propriétaire

1. *(Toujours ouverte)* **Déployer avant lundi la correction de texte `4648133`** (4 textes FR des coffres, aucune donnée touchée) : **A** oui, intégration et déploiement habituel (**recommandé**) / **B** après la bêta.

### 11. Reste à faire

Tes recettes #84-D et #84-E. Avant d'élargir : #91 (détection rapide de l'autoclicker), #43, #36, #27.

## Mise à jour du 08/11/2026 (4) : recette #84-E échouée, correction du retour à la vérification après « Signaler une erreur », déployée `4682799`

### 1. État réel

**Déployé en production (`1.0.0+4682799`) — en attente de la recette #84-E corrigée.** Ta validation #84-D (commentaire du 08/11 à 16:48 UTC) est notée : A, B, C et D sont acquis et ne seront plus redemandés.

### 2. Ce que tu as constaté (commentaires du 08/11, de 17:07 à 17:09 UTC) et ce que j'ai reproduit

Constat : le CAPTCHA disparaît à l'envoi du signalement. Il ne revient que lorsque tu retouches le bloc, et alors parfois sur une énigme à **00:00** (« Le temps est écoulé. Demande une autre énigme »).

Reproduction sur un serveur de test en mode **Appliqué** (390×844 puis 1280×900, vérification émise par l'admin, signalement envoyé après 36 s de rédaction) :

| Moment | Fenêtre de vérification | Côté serveur |
|---|---|---|
| Vérification affichée | visible, 00:30 | défi **en attente**, 0 bloc, 0 clic |
| Signalement envoyé | **cachée** (fermée par le bouton) | défi **en attente**, 0 bloc, 0 clic |
| Formulaire fermé | **toujours cachée** ← le bug | défi **en attente**, 0 bloc, 0 clic |
| Coup sur le bloc | revient | défi **en attente**, 0 bloc, 0 clic |

**Conclusion : il s'agissait seulement d'une fermeture visuelle prévue, pas d'un déblocage.** Le serveur n'a jamais levé le défi, et aucun bloc, clic, pièce, profondeur ni coup de pioche n'a été crédité pendant la transition. Le signalement est enregistré **une seule fois**. Le « compte remis à 0 » était bien le **chrono de l'énigme à 00:00**, et aucune progression n'a été perdue.

D'où venait le 00:00 : une énigme dure 30 s, et ce délai continue de courir pendant qu'on écrit le signalement. En revenant juste avant la fin (il restait par exemple 2 s), on retrouvait l'ancienne énigme, qui expirait aussitôt. Si l'énigme avait déjà expiré, le jeu en demandait déjà une nouvelle.

### 3. Correction

- **La vérification revient seule** dès que le formulaire se ferme, quelle que soit la manière (envoi puis bouton, Annuler, ✕, Échap, clic sur le fond, « Abandonner »). Elle ne revient que si le serveur dit qu'un défi ou une suspension est toujours en cours.
- **Après l'envoi**, le bouton de fermeture du formulaire devient **« 🛡️ Reprendre la vérification »** (bouton violet, qui reçoit le focus). Pour une suspension, il s'appelle **« ⏸️ Retour au jeu »** et ramène à la fenêtre « Minage manuel en pause ».
- **Jamais d'énigme à 00:00 à la réouverture** : s'il reste moins de 10 s (ou plus rien), une nouvelle énigme est demandée, avec un chrono complet. Cela vaut aussi quand la fenêtre est rouverte par un coup sur le bloc. Les durées (30 s, ou 60 s en version texte), la marge serveur, la limite de 15 énigmes par 10 min et les règles « jamais de sanction » sont **inchangées**. Aucune règle anti-bot n'a été touchée : tout se passe dans l'affichage.
- Textes FR, EN, NL, ES et IT (italien traduit par cette session, non relu par un humain).
- Fichiers : `public/js/beta.js` (`openReport` accepte `onClose` et `returnLabel` ; une seule fermeture « officielle »), `public/js/antibotGate.js` (retour automatique, seuil `REOPEN_MIN_LEFT_MS = 10 s`), `public/js/i18n.js`, `i18n/it.json`, `public/js/locales/it.js`.
- Tests : `test/antibot-report-84.test.js` passe de 3 à **4 contrôles**. Sans la correction, **3 sur 4 échouent**. `test/e2e/antibot-report-84.e2e.js` est étendu au scénario #84-E.

Branche `feature/84-signalement-faux-positifs` (commit `2421605`), fusion **`develop` `4682799`**.

### 4. Vérifications

- `npm test` : **969/969** sur la branche, sur `develop` `4682799` et dans la release.
- Essai navigateur `antibot-report-84.e2e.js` sur un serveur de test (port 3101, base neuve supprimée ensuite) en **1280×900 et 390×844** : TOUT OK, 0 erreur JS. Scénario #84-E :
  - formulaire fermé sans envoi → la vérification revient seule ;
  - signalement envoyé **après expiration** de l'énigme (31 s d'attente) → bouton « 🛡️ Reprendre la vérification » → nouvelle énigme jouable, chrono ≥ 25 s, sans message « temps écoulé » ;
  - 12 coups sur le bloc fenêtre fermée, puis attente d'une sauvegarde, puis F5 → la vérification revient. **Côté serveur** : défi toujours `challenge` (en attente) ; relevé de la sauvegarde et du classement (pièces, profondeur, blocs, charges de pioche, ligne de classement) **identique** avant et après ;
  - un seul signalement enregistré, visible dans la liste admin des retours ;
  - suspension → formulaire → fermeture → la fenêtre « Minage manuel en pause » revient ;
  - signalements coupés → bouton masqué (inchangé).
- Limite : le compte d'essai est neuf (0 bloc), donc l'essai prouve qu'aucun crédit n'apparaît, pas qu'un crédit existant serait gelé. Le gel côté serveur d'un compte qui progresse est déjà prouvé par l'essai #25 `antibot-freeze-proof.e2e.js` et ses tests unitaires, que cette correction ne touche pas.
- Production après le déploiement, en visiteur, en 1280 et 390 : **0 erreur JS**, nouveau code servi.

### 5. Déploiement

- Release `4682799` : `npm ci`, `npm test` 969/969. Copie de la base de production démarrée en `NODE_ENV=production` (port 3122) : `/health` ok, `1.0.0+4682799`, **empreintes identiques** avant et après le démarrage. Copie supprimée.
- Aucune génération IA en cours (dernier appel à 17:00 UTC). `main` avancé de `ce0a4db` à `4682799` (avance rapide). La sauvegarde vérifiée `~/backups/dig/dig-20261108-190739-pre-deploy-4682799.sqlite` a été faite, sans `npm ci`, puis la santé et la version ont été contrôlées.
- Après le déploiement : les 2 domaines renvoient 200 avec `1.0.0+4682799`, le journal ne contient aucune erreur et `quick_check` = ok. Les empreintes des 6 tables joueurs sont **identiques** à la sauvegarde pré-déploiement.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep ce0a4db` puis `sudo systemctl restart dig`. Aucune migration et aucune donnée touchée.
- `4648133` (textes des coffres) **n'est toujours pas inclus** : il attend ta réponse à la question 1.

### 6. Recette #84-E corrigée (≈ 3 min, ton compte de test, téléphone)

1. Admin → Anti-bot → ton compte de test → « Tester la protection » → envoyer la vérification tout de suite.
2. Dans le jeu : « Petite vérification » → **🐞 Signaler une erreur**. Écris « essai #84-E bis », **attends au moins 30 s**, puis envoie. *Attendu :* « Merci ! Signalement n° … reçu » et un bouton violet **« 🛡️ Reprendre la vérification »**.
3. Touche-le. *Attendu :* la vérification revient **tout de suite**, sans toucher le bloc, avec une **nouvelle énigme** et un chrono plein (00:30), pas 00:00.
4. Bonus : rouvre « Signaler une erreur » puis « Annuler » sans écrire. *Attendu :* la vérification revient aussi.
5. Admin → 🧪 Bêta → « 💬 Voir les retours ». *Attendu :* ton signalement, **une seule fois**. Résous l'énigme, puis « Terminer le test ». Le mode global reste **Appliqué**.

Réponds « #84-E validé » ou dis ce qui ne convient pas.

### 7. Classement MVP

**Bloquant bêta collègues** (la compétition démarre le 09/11 à 00:59) : corrigé et déployé. **Après lancement** : #91 (détection rapide de l'autoclicker), inchangé.

### 8. Choix techniques faits seul

- **Retour automatique plutôt qu'un simple bouton** : tu demandais l'un ou l'autre. J'ai fait les deux. La fenêtre revient à toute fermeture, et le bouton nomme clairement l'action après l'envoi.
- **Seuil de 10 s à la réouverture** : en dessous, l'énigme est quasiment injouable. En demander une nouvelle est déjà prévu sans sanction (bouton « Autre énigme »), et la limite de 15 énigmes par 10 min s'applique toujours. Les délais de protection ne changent pas.
- **Le formulaire reste par-dessus, la vérification est fermée pendant la rédaction** : les deux fenêtres superposées seraient illisibles sur téléphone. L'énigme ne peut de toute façon pas être résolue pendant qu'on écrit.

### 9. Décisions demandées au propriétaire

1. *(Toujours ouverte)* **Déployer avant lundi la correction de texte `4648133`** (4 textes FR des coffres, aucune donnée touchée) : **A** oui, intégration et déploiement habituel (**recommandé**) / **B** après la bêta.

### 10. Reste à faire

Ta recette #84-E corrigée. Avant d'élargir : #91, #43, #36, #27.
