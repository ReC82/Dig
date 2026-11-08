# Ticket #92 — Détection ciblée des extensions d'autoclick par navigateur : POC et interrupteurs admin

- Ticket : #92 « [P0][Anti-bot] Détection ciblée des extensions d'autoclick par navigateur — POC et interrupteurs admin » — https://github.com/ReC82/Dig/issues/92
- Session du 08/11/2026 (DIGORCH). Cible prioritaire donnée par le propriétaire le 08/11 : **OP Auto Clicker 0.1.4** (Chrome, `kpmbpdpbjjadabknommjfphilmecebab`, éditeur mousetool).

## 1. État réel

**Déployé en production (SHA `a70a024`, 08/11/2026 21:40 Bruxelles) — en attente de recette du propriétaire.**
Toutes les signatures sont **OFF** en production : rien n'a changé pour les joueurs. Les protections #25/#91 sont inchangées et toujours actives.

Classement : **Après lancement**. La protection du concours repose sur #91, qui détecte le comportement de l'outil quelle que soit sa marque. Les signatures d'extensions apportent un diagnostic en plus, sans remplacer #91.

## 2. Résultat de l'étude : ce qu'un site peut détecter

### Pourquoi les sites « détectent AdBlock » et ce que cela change ici
Un site anti-AdBlock **n'identifie pas** l'extension. Il place un « appât » (une bannière publicitaire factice, ou une requête vers un serveur de pubs) et constate que l'appât a été masqué ou bloqué : c'est la **détection d'un effet**. On peut faire de même avec certaines extensions d'autoclic, à condition qu'elles laissent un effet visible dans la page. Aucun site ne peut lire la liste des extensions installées : `chrome.management` et `browser.management` sont réservées aux extensions.

### OP Auto Clicker 0.1.4 — audit du code réel (téléchargé depuis le Chrome Web Store)
| Élément | Constat |
|---|---|
| `web_accessible_resources` | **Aucun** : impossible de le reconnaître par une adresse `chrome-extension://…` |
| Script de contenu | Sur **tous les sites** (`<all_urls>`), avec une **feuille CSS** `css/content.css` injectée dans chaque page |
| CSS injectée | `div#AutoClickerIndicator` : `z-index: 9999`, 15 × 15 px, pseudo-élément `::before` animé (`loading`), bordure `#1C1C1C` |
| Pendant les clics | ajoute `<div id="AutoClickerIndicator">` (petit cercle qui tourne) dans la page, à côté du pointeur |
| Clics | `new MouseEvent('click')` envoyé au point du dernier mouvement de souris : **isTrusted = false**, toujours au même pixel, toutes les 200 ms par défaut. Démarrage avec Alt+F1, arrêt avec Alt+F2 |

**Signature retenue** : le jeu crée un élément témoin `div#AutoClickerIndicator` invisible, lit ses styles calculés, puis le retire dans la même tâche (il n'est jamais laissé dans la page). Si les 4 propriétés imposées par l'extension sont présentes, l'extension est installée et active sur ce site. Si l'indicateur `body > div#AutoClickerIndicator` est présent, l'extension est en train de cliquer.

### Essais dans un vrai navigateur (Chrome for Testing 156, extension 0.1.4 réellement chargée)
| Situation | Trace « installée » | Indicateur « en train de cliquer » |
|---|---|---|
| Extension activée, accès « sur tous les sites » (cas de la capture du propriétaire) | **oui** | non |
| Extension en train de cliquer (Alt+F1) | **oui** | **oui** (6 clics en 1,2 s ; `isTrusted=false` ; même pixel) |
| Après Alt+F2 | oui | non |
| Accès au site « au clic » | non | — |
| Accès « sur des sites spécifiques » (Dig non inclus) | non | — |
| Extension désactivée, puis page rechargée | non | — |
| Extension désactivée **sans recharger** | **oui** (la CSS reste jusqu'au rechargement) | — |
| Extension réactivée **sans recharger** | non (pas d'injection avant le rechargement) | — |
| Contexte privé (équivalent navigation privée, extension non autorisée) | non | — |
| Sans extension | non | non |
| Extension innocente **Dark Reader 4.9.135** (réécrit les styles de toutes les pages) | non (**aucun faux positif**) | — |
| 4 extensions installées ensemble (OP, AutoFill, Auto Clicker, Dark Reader) | OP et AutoFill : oui ; aucune confusion entre les signatures | — |

### Table des extensions étudiées (manifestes téléchargés depuis les boutiques officielles le 08/11)
| Extension | Navigateur, ID exact, version | Statut | Méthode / raison |
|---|---|---|---|
| **OP Auto Clicker** | Chrome `kpmbpdpbjjadabknommjfphilmecebab` 0.1.4 | **Détectable** (installation + clics, vérifié) | CSS injectée + indicateur pendant les clics |
| **Auto Clicker - AutoFill** | Chrome `iapifmceeokikomajpccajhjpacjmibe` 5.4.1 | **Détectable** (installation seulement, vérifié) | CSS injectée `#auto-clicker-auto-fill-status`. Sert aussi à remplir des formulaires : sa présence ne dit rien du minage |
| IO Auto Clicker (Firefox) | AMO `{67794639-d1c6-4b41-a189-4f99f80237d2}` 2.0 | **Incertain** | Même code que OP (`div#ext-icon`). Pas de Firefox sur le serveur : à confirmer en mode « Mon compte de test » |
| Auto Clicker | Chrome `cpedeojecpbkcomgcolphimkjdnikbck` 3.9.1 | Non détectable | Aucune trace à l'installation (vérifié) ; son style n'est ajouté qu'en cours d'utilisation (non vérifié) |
| Simple Auto Clicker | Chrome `aljpppgbdpdjekfbgppppjoakabmkodo` 0.3.0 | Non détectable | Aucun script permanent (injection à la demande) |
| GG Auto Clicker | Chrome `fndokfnecpehdehdjpdldadienbcjllf` 1.2 | Non détectable | Ressource exposée seulement à orteil.dashnet.org |
| Auto Clicker / Fast Auto Clicker (Firefox) | AMO `{d4959848-de0d-4ac8-86d2-7784027fa952}` 2.0 | Non détectable | Aucun script permanent |
| OP Auto Clicker **application Windows** | — | Non détectable | Vrais clics système (`isTrusted=true`), aucune trace dans la page → #91 |

Opera, Edge et Brave installent les mêmes extensions du Chrome Web Store et utilisent le même moteur Chromium : la même trace est **attendue**, mais elle n'a pas été vérifiée dans ces navigateurs. L'admin indique « Chrome, Edge, Brave, Opera » sans en faire une garantie. Firefox attribue un identifiant interne aléatoire à chaque installation : seules les traces CSS ou DOM sont utilisables (aucune sonde par adresse n'est faite).

## 3. Ce qui a été réalisé

### Admin → 🛡 Anti-bot → « Extensions d'autoclic » (nouveau bloc replié, entre Réglages et Diagnostic)
- Explication honnête en tête : ce qu'un site peut savoir, la comparaison avec AdBlock, et le principe « aucune trace ne prouve l'absence d'extension ».
- **Tableau filtrable** (navigateur + recherche) : extension, ID et lien vers la boutique, navigateurs, version testée, statut **Détectable / Incertain / Non détectable**, méthode et limites, nombre de joueurs avec une trace sur 7 jours.
- **Interrupteur par signature, OFF par défaut** : `OFF` / `Mon compte de test` / `Tous les joueurs`.
  - « Tous les joueurs » n'est possible que pour une signature **Détectable** (refus côté serveur sinon, avec une confirmation qui rappelle de tester d'abord sur son compte).
  - Une signature **Incertaine** ne peut être activée que sur le compte de test.
  - Une extension **Non détectable** affiche « Indisponible — détection par le comportement #91 » : aucun interrupteur factice.
- **Comptes de test** : pseudo exact ou #ID, 5 au plus.
- **Arrêt d'urgence dédié** : « Tout couper maintenant ». Il coupe toutes les signatures sans toucher à #25/#91.
- **Réaction** : « Journal seulement » (par défaut) ou « Vérification (énigme) ». La vérification n'est envoyée que si l'indicateur « en train de cliquer », **vérifié**, est présent pendant au moins 5 coups d'une sauvegarde. Elle suit le mode global (simulée en Observation) et le délai minimal entre deux défis. **Jamais de suspension ni de bannissement pour une extension** : les suspensions restent celles de #91 (automatisation corroborée).
- **« 🔎 Tester ce navigateur maintenant »** : cherche les traces de toutes les signatures dans le navigateur de l'admin et affiche « DÉTECTÉE » ou « non détectée » pour chacune. L'essai est enregistré dans l'audit admin.
- **Journal court** : date, joueur, signature, résultat (installée / en train de cliquer avec le nombre de coups / non détectée), mode, réaction. Une ligne par joueur, signature et état toutes les 10 min, conservée 90 jours. Il apparaît aussi dans le filtre du journal anti-bot (« Signature d'extension d'autoclic (#92) »). Chaque changement de réglage est audité (Config admin).

### Dans le jeu
- Le serveur n'envoie au jeu que les signatures **activées pour ce compte** (liste vide par défaut : le jeu ne vérifie rien).
- Au chargement, le jeu vérifie la trace d'installation et l'envoie. **Un compte de test** voit alors un message : « 🧪 Essai anti-bot : OP Auto Clicker — DÉTECTÉE (installée et active sur ce site) » ou « — non détectée ». Les autres joueurs ne voient rien.
- À chaque coup de pioche, le jeu note si l'indicateur de l'extension est présent. Le nombre de coups concernés part avec la sauvegarde (≈ 12 s).
- **Données** : seulement `{ signature activée : trace oui/non, coups avec indicateur }`. Aucune liste d'extensions, aucune empreinte, aucune sonde par adresse d'extension.

### Fichiers
`server/extensionSignatures.js` (nouveau : catalogue, réglages, journal, vue admin), `public/js/extProbe.js` (nouveau : sonde partagée entre le jeu et l'admin), `server/index.js` (routes `POST /api/me/antibot/ext`, `GET /api/admin/antibot/extensions`, `PUT …/test-users`, `POST …/check`, validation des réglages), `server/seasons.js` (`config.extSignatures`, traitement à la sauvegarde), `server/antibotResponses.js` (motif `extension_active`), `server/antibot.js` (télémétrie `e`, groupe du journal), `public/js/main.js`, `public/index.html`, `public/admin/{index.html,admin.js,admin.css}`, `docs/ANTI-BOT.md` § 14, tests `test/extension-signatures-92.test.js` (10 tests) et `test/e2e/extensions-92.e2e.js`.

## 4. SHA, branche, procédure de test

- Branche : `feature/92-extensions-autoclick`, commit `e76a809` ; **develop : `a70a024`**.
- `npm test` : **1005/1005** (branche) et **1005/1005** (release, SHA exact `a70a024`).
- Essai navigateur réel avec l'extension OP Auto Clicker 0.1.4 chargée dans Chromium (serveur de test 3101) :
  `PW=…/playwright-core CHROME=…/chrome-linux64/chrome EXT=<dossier de l'extension décompressée> BASE=http://127.0.0.1:3101 ADMIN=<secret> node test/e2e/extensions-92.e2e.js` → **TOUT OK (27 contrôles)**.

| Scénario (réel) | Résultat |
|---|---|
| A. Compte de test, extension installée | message « DÉTECTÉE » au chargement ; journal « installée · chargement du jeu · Mon compte de test » ; seule la signature activée est envoyée |
| B. L'extension clique (Alt+F1), réaction « journal » | indicateur présent ; journal « en train de cliquer (43–45 coups) · sauvegarde » ; aucune vérification |
| C. Réaction « vérification », mode Appliqué | énigme affichée, motif `extension_active`, aucune suspension |
| D. Admin dans le navigateur avec l'extension | « OP Auto Clicker : DÉTECTÉE », les autres « non détectée » ; interrupteurs corrects (Incertain : « Tous » grisé ; non détectables : « Indisponible ») ; filtre Firefox |
| E. Navigateur sans extension | jeu « non détectée » (journalisé pour le compte de test) ; admin : rien détecté |
| F. Autre joueur (pas compte de test), extension installée | aucune signature reçue, aucun envoi |
| G. Admin smartphone 390×844 | lisible, pas de débordement horizontal, 0 erreur JS |
| H. Arrêt d'urgence | plus aucune signature envoyée au jeu |

## 5. Vérifications, limites, données joueurs

- **Données joueurs** : rien de supprimé ni réécrit ; **aucune migration** (journal dans `security_events` existant, réglages absents = OFF). Contrôle sur une copie de la base de production : empreintes identiques avant et après démarrage, aucun réglage `ab_ext_*` écrit.
- **Garanti** : OP Auto Clicker 0.1.4 est reconnu dans Chrome quand il a accès à Dig, installé (trace CSS) comme en train de cliquer (indicateur), sans faux positif avec les extensions essayées.
- **Non garanti** : absence de trace ≠ absence d'extension (accès « au clic », navigation privée, extension activée sans recharger, autre version). Une trace est falsifiable : un joueur peut masquer le style, et un client modifié peut mentir. Les extensions sans trace et les programmes Windows relèvent de #91.
- **Non vérifié ici** : vrai Firefox, Opera, Edge, Brave, ainsi que Chrome stable avec l'extension installée depuis la boutique (l'essai a utilisé la même version 0.1.4, chargée en mode développeur). C'est l'objet du test du propriétaire ci-dessous.
- Revue vie privée et sécurité : aucune donnée personnelle ; pas d'inventaire ; les identifiants de signatures inconnues ou non activées sont ignorés sans être lus ; l'élément témoin est toujours retiré ; tout le texte affiché dans l'admin passe par `textContent` (pas d'injection HTML).

## 6. Déploiement

- **SHA déployé : `a70a024`** (08/11 21:40 Bruxelles), `main` avancé en avance rapide depuis `eab1fa9`.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261108-214006-pre-deploy-a70a024.sqlite`.
- Après : dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+a70a024` ; journal sans erreur ; `pragma quick_check` = ok. Empreintes : mêmes nombres de lignes. 2 sauvegardes de joueurs ont progressé pendant le déploiement (révision +1, blocs, profondeur et clics inchangés ou en hausse, 0 régression). Chromium visiteur 1280 et 390 : `extProbe.js` chargé, 0 erreur JS, aucun envoi (tout OFF).
- Retour arrière immédiat : `git -C /home/ubuntu/Dig reset --keep eab1fa9` + `sudo systemctl restart dig` (aucune migration) ; ou, sans redéploiement, garder toutes les signatures sur OFF ou cliquer sur « Tout couper maintenant ».

### Test fonctionnel à faire par le propriétaire (≈ 5 min, Chrome PC, compte « lody »)
1. /admin/ (Ctrl+F5) → 🛡 Anti-bot → déplier **« Extensions d'autoclic »**.
2. **« 🔎 Tester ce navigateur maintenant »** (OP Auto Clicker activé, accès « sur tous les sites ») → attendu : « **OP Auto Clicker : DÉTECTÉE — installée et active sur ce site** ».
3. Comptes de test : taper `lody` → Enregistrer. Ligne OP Auto Clicker → interrupteur **« Mon compte de test »**.
4. Ouvrir le jeu avec `lody` (F5) → attendu, en quelques secondes : message **« 🧪 Essai anti-bot : OP Auto Clicker — DÉTECTÉE »**. Admin → Rafraîchir : journal « DÉTECTÉE — installée · chargement du jeu ».
5. Souris sur le bloc, **Alt+F1** pendant ≈ 15 s, puis Alt+F2 → journal « DÉTECTÉE — indicateur d'autoclic actif pendant les coups (n coups) · sauvegarde ». (#91 enverra probablement aussi sa vérification « même pixel » : c'est normal.)
6. Comparer : chrome://extensions → désactiver OP Auto Clicker → **recharger le jeu** → message « non détectée » ; idem dans l'admin après F5 → « Tester ce navigateur ». Réactiver l'extension, recharger → de nouveau « DÉTECTÉE ».
7. (Facultatif) Firefox avec IO Auto Clicker, Opera ou Edge avec OP Auto Clicker : même étape 2. Le résultat confirme ou infirme la signature « Incertaine » et les navigateurs « attendus ».
8. Remettre l'interrupteur sur **OFF** (ou le laisser sur « Mon compte de test » : cela ne concerne que vous). Arrêt d'urgence : « Tout couper maintenant ».

Attendu : aucun autre joueur n'est concerné, aucune suspension ni retrait.

## 7. Choix techniques faits seul

- **Trace CSS par élément témoin** plutôt qu'une sonde d'adresse : OP Auto Clicker n'expose aucune ressource, et Firefox rend les adresses aléatoires. La trace est indépendante de l'ID, ne dépend d'aucun réseau et reste ciblée (une seule propriété composée par signature, 4 critères pour OP).
- **4 propriétés exigées** pour OP (`z-index`, largeur, animation, couleur) : aucun faux positif, même avec Dark Reader qui réécrit les styles.
- **Élément témoin retiré dans la même tâche** : l'extension cherche son indicateur par `getElementById`. Un témoin laissé dans la page aurait pu fausser son fonctionnement ou la détection « en train de cliquer ».
- **Journal dans `security_events`** (existant, 90 jours) plutôt qu'une nouvelle table : aucune migration, filtres et purge déjà en place. Dédoublonnage à 10 min.
- **Réaction « vérification » limitée à l'indicateur d'activité vérifié et à au moins 5 coups**, jamais pour la simple installation (demande du ticket : pas de sanction du seul fait d'une extension installée). Pas de suspension spécifique : #91 corrobore déjà (clics `isTrusted=false` + même pixel + rythme).
- **Message d'essai en français** (uniquement pour les comptes de test choisis dans l'admin, comme le panel) : pas de nouvelle traduction en 5 langues pour un message que les joueurs ne voient jamais.

## 8. Décisions demandées au propriétaire

1. **Activer OP Auto Clicker pour tous les joueurs** après votre essai (étapes § 6) ? Options : (A) garder « Mon compte de test » seulement, en diagnostic ; (B, recommandé si votre essai réussit) « Tous les joueurs » avec réaction « Journal seulement », pour mesurer pendant le concours sans rien imposer ; (C) « Tous » + « Vérification (énigme) ». #91 envoie déjà une vérification à cet outil quand il clique au même pixel, donc C apporte peu.
2. **Auto Clicker - AutoFill** : la laisser OFF (recommandé). C'est aussi un outil de remplissage de formulaires, et son indicateur d'activité n'est pas vérifié.

## 9. Reste à réaliser

- Recette du propriétaire (Chrome réel avec l'extension installée depuis la boutique) ; essais Firefox, Opera et Edge pour confirmer ou retirer les statuts « attendu / incertain ».
- Ajouter d'autres signatures seulement sur preuve (manifeste + essai réel), au cas par cas. **Après lancement.**
- Remarque hors périmètre (non modifiée) : `POST /api/register` alors qu'un compte est déjà connecté dans le même navigateur crée le compte mais garde la session du premier compte (constaté pendant les essais). Sans risque, mais déroutant ; à revoir dans un ticket d'ergonomie si besoin.
