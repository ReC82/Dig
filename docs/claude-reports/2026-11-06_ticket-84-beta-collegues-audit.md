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
