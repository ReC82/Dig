# Ticket #35 — [P1] Session de jeu unique multi-appareils et bloc courant persistant

Lien : https://github.com/ReC82/Dig/issues/35 · Branche : `feature/35-session-unique-bloc-persistant` · Session DIGORCH du 30/10/2026

## 1. État réel

**Déployé en production (SHA `68a67eb`) — en attente de recette du propriétaire.** Mise en ligne le 30/10/2026 à 17:24 (Bruxelles).

Classement : **Bloquant MVP public**. Sans ce correctif, ouvrir un second onglet ou un autre appareil relançait le bloc courant. Un joueur pouvait donc relancer à volonté pour obtenir un matériau rare, ce qui fausse le classement et les récompenses.

## 2. Problème constaté (recette du propriétaire, 30/10)

- Le bloc courant n'était pas sauvegardé, et chaque chargement de page tirait un nouveau bloc. Sont concernés : un second onglet, un rafraîchissement, un autre appareil et une reconnexion.
- L'exclusivité « un seul onglet » de #18 ne valait que dans **un même navigateur**. Deux appareils (PC et PWA du téléphone) pouvaient miner en même temps sur le même compte.

## 3. Changements réalisés

### Session de jeu unique (serveur)

| Fichier | Changement |
|---|---|
| `server/db.js` | Nouvelle table **`play_controllers`** (`user_id`, `controller_id`, `epoch`, `claimed_ms`, `heartbeat_ms`). La migration ne fait qu'**ajouter** cette table : aucune donnée existante n'est modifiée. |
| `server/playSession.js` (nouveau) | Fonctions `claim`, `heartbeat`, `mayWrite` et `release`. Un seul contrôleur par compte (un onglet, un navigateur, un appareil ou une PWA), avec un bail de 45 s. |
| `server/index.js` | **`POST /api/me/play/claim`** : la page prend la main et reçoit la sauvegarde serveur à reprendre. Avec `onlyIfFree`, elle ne prend la main que si personne ne joue.<br>**`POST /api/me/play/heartbeat`** : signal de présence.<br>`POST /api/me/save` et l'achat de coffre de saison refusent l'ancien contrôleur avec un **409 `notController`**. Ce contrôle a lieu **dans la même transaction que l'écriture** : rien n'est écrit, rien n'est dupliqué et aucune prise de contrôle ne peut s'intercaler.<br>La déconnexion libère la main, et seulement celle de la page qui se déconnecte. |
| `server/rateLimits.js` | Nouveau limiteur `play` : 30 requêtes par minute et par compte (`RATE_PLAY_MAX`). |

### Bloc courant persistant et tirage reproductible (client)

| Fichier | Changement |
|---|---|
| `public/js/blocks.js` | Chaque bloc porte un **numéro** (`blockSeq`). Sa nature et ses PV sont tirés par un générateur à graine (mulberry32), à partir de **graine de la sauvegarde + numéro**. `Blocks.snapshot()` et `Blocks.resume()` sauvegardent et reprennent le bloc à l'identique : type, PV restants, PV max, récompense, profondeur et numéro. `rewardRng()` sert au tirage des gains à la destruction. |
| `public/js/chests.js`, `public/js/collection.js` | Le contenu d'un coffre-bloc et les trouvailles de collection sont tirés avec le générateur du bloc. **Rejouer un bloc donne exactement les mêmes gains.** |
| `public/js/save.js`, `public/js/gameState.js` | Format de sauvegarde **v16** : ajout de `blockSeed`, `blockSeq` et `block`. Une sauvegarde v15 se charge sans perte : la graine est créée au premier bloc, et le bloc suivant est tiré au chargement, une seule fois. |
| `public/js/main.js` | Les changements, par situation :<ul><li>**Chargement, adoption d'une sauvegarde serveur ou conflit** : le bloc sauvegardé est **repris** au lieu d'en tirer un nouveau.</li><li>**Après une destruction** : le bloc suivant n'est tiré que si le bloc courant est réellement détruit.</li><li>**Chargement et connexion** : la page prend la main sur le compte.</li><li>**Signal de présence** : toutes les 15 s, et au retour sur la page.</li><li>**Écran « 📱 Partie ouverte sur un autre appareil — Jouer ici »** : il s'affiche sur l'ancien appareil. Les clics **et l'Auto-Dig** y sont arrêtés et plus rien n'y est écrit. Le compte reste connecté.</li><li>**Reprise automatique** : si le contrôleur actif a disparu (bail expiré : onglet fermé, appareil éteint, plantage), une autre page déjà ouverte reprend la main d'elle-même, puis relit la sauvegarde serveur.</li><li>**Auto-Dig** : il sauvegarde dès qu'il détruit un bloc.</li></ul> |
| `public/js/i18n.js` | Textes de l'écran en FR, EN et NL. |
| `tools/balance/luck-sim.js` | Le simulateur de #32 réinitialise la graine à chaque simulation. Ses résultats restent reproductibles et ses statistiques ne changent pas. |

### Comportement visible

| Situation | Résultat |
|---|---|
| Rafraîchissement, second onglet, autre appareil, reconnexion, redémarrage du serveur | **Même bloc, mêmes PV restants, même récompense.** |
| Ouverture du jeu sur le téléphone | Le PC affiche « Partie ouverte sur un autre appareil » (en moins de 15 s, ou dès sa sauvegarde suivante). Il ne mine plus. |
| « Jouer ici » | L'appareil reprend la main et l'état exact de l'autre. |

## 4. SHA et procédure de test

- Commit : `e286e3d` (branche `feature/35-session-unique-bloc-persistant`).
- **SHA sur `develop` : `68a67eb`** (merge), déployé tel quel.

### Tests automatisés

`npm ci && npm test` : **267/267**, sur la branche, sur `develop` et dans la release du SHA exact.

`test/play-session.test.js` (10 tests HTTP) :
- PC puis téléphone : prise de contrôle, requête tardive du PC refusée sans écriture, PC toujours connecté, « Jouer ici » ;
- prise de contrôle idempotente ;
- **rafales concurrentes** : 15 sauvegardes de chaque appareil, seul le contrôleur écrit, et 8 prises de contrôle simultanées obtiennent chacune leur propre époque, avec un seul gagnant ;
- coffre acheté par l'ancien contrôleur : refusé, pièces inchangées ;
- **bail expiré** (plantage) : reprise automatique ;
- ancien client sans `controllerId` ;
- prise de contrôle implicite ;
- déconnexion ;
- entrées invalides ;
- **redémarrage serveur** : bloc et session conservés.

`test/block-resume.test.js` (7 tests unitaires) :
- reprise exacte sur un autre appareil et après rafraîchissement ;
- même graine, même suite de 300 blocs ;
- **aucune relance** : 25 reprises d'une sauvegarde prise juste avant la destruction donnent un seul résultat possible (bloc suivant, coffre, trouvaille) ;
- bloc détruit, profondeur changée ou **changement de saison** : c'est le bloc suivant qui est tiré ;
- bloc falsifié ignoré ;
- **migration v15 → v16** sans perte ;
- **chances des matériaux rares inchangées** (30 000 tirages, écart < 1 point).

### Essai navigateur

Serveur de test `PORT=3101 DB_FILE=test-35.sqlite`, Chromium headless, PC 1280×900 et téléphone 390×844 : **19/19 contrôles réussis**.
- rafraîchissement ;
- second onglet ;
- téléphone connecté : même bloc, mêmes PV et mêmes pièces que le PC, puis rechargé ;
- PC verrouillé en moins de 15 s : ni clics ni Auto-Dig, requête tardive 409, toujours connecté ;
- « Jouer ici » sur le PC : il reprend le bloc du téléphone, qui se verrouille à son tour ;
- destruction : bloc suivant ;
- 0 erreur JavaScript.

## 5. Vérifications, limites, impact sur les données

### Données des joueurs

Une seule table est **ajoutée**. Aucune colonne n'est modifiée et aucune sauvegarde n'est réécrite par le serveur.

Le format v16 n'ajoute que 3 champs, écrits par le client à sa sauvegarde suivante. La sauvegarde réelle de production (copie) a été passée par la migration client v15 → v16 : pièces, profondeur et tous les autres champs sont identiques.

### Transition

Un onglet resté ouvert avec l'ancien code (sans `controllerId`) reste accepté tant qu'aucun appareil à jour n'a la main. La bannière « mise à jour disponible » invite à recharger.

### Limites (choix assumés)

- **Changement d'appareil quand l'ancien reste affiché**
  - Le nouvel appareil reprend la dernière sauvegarde cloud. L'envoi a lieu au plus toutes les 12 s, et immédiatement quand l'onglet est masqué ou fermé.
  - Si l'ancien appareil reste affiché et actif au moment de la prise de contrôle, ses dernières secondes de jeu (12 s au maximum) ne sont pas reprises. **Ce n'est jamais une relance** : le tirage est reproductible, et rejouer ces secondes redonne les mêmes blocs et les mêmes gains.
  - Ouvrir un second onglet dans le même navigateur, ou quitter l'appli du téléphone, masque l'ancienne page et déclenche un envoi immédiat : aucune perte dans ce cas.
- **Économie toujours calculée par le client** (hors périmètre, voir #25 et #20)
  - Un tricheur qui modifie le JavaScript peut toujours falsifier son état.
  - Ce ticket supprime la relance **par le jeu normal** : onglets, appareils, rafraîchissement, reconnexion.
  - Le budget de dégâts de #25 continue de borner la progression côté serveur.
- **Invités (sans compte)** : seule l'exclusivité par navigateur de #18 s'applique (pas de serveur). Leur bloc est lui aussi persistant et reproductible.
- **Coffres de la boutique de saison** : leur tirage reste côté serveur (#8) et n'est pas concerné.

## 6. Déploiement

**SHA déployé : `68a67eb`** (précédent : `36b9e70`), via `scripts/deploy.sh` de la release (avance rapide de `main`, `npm ci` non nécessaire).

**Sauvegarde pré-déploiement vérifiée :** `~/backups/dig/dig-20261030-172442-pre-deploy-68a67eb.sqlite`.

### Avant le déploiement

- copie de la base de production démarrée en `NODE_ENV=production` (port 3122) ;
- `/health` et `/api/version` OK ;
- empreintes identiques avant et après démarrage (lignes + hachage de toutes les colonnes) pour `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` ;
- seule la table `play_controllers` a été ajoutée ;
- copie supprimée.

### Après le déploiement

- les 2 domaines répondent 200, `/api/version` = `1.0.0+68a67eb` ;
- journal sans erreur ;
- `pragma quick_check` = ok ;
- **empreintes des 6 tables identiques à la sauvegarde pré-déploiement** ;
- Chromium en production, sans compte (aucun compte de test créé dans la base réelle), PC 1280×900 et mobile 390×844 : **9/9** (rafraîchissement et second onglet : bloc identique, premier onglet verrouillé, version, 0 erreur JavaScript).

### Retour arrière immédiat

`git -C /home/ubuntu/Dig reset --keep 36b9e70 && sudo systemctl restart dig` (dépendances identiques).
- La table `play_controllers` est simplement ignorée par l'ancien code.
- Les champs `block*` des sauvegardes sont ignorés aussi (sans perte).

### Incident de contrôle (transparence)

Lors du premier `npm test` sur `develop`, `security.test.js` a été signalé au niveau du fichier (0 sous-test en échec), et `develop` a été poussé avant l'analyse.
- Cause : un serveur de test orphelin occupait le port 3111.
- Correction : il a été arrêté, puis la suite a été relancée.
- Résultat : 267/267 sur ce même SHA, puis à nouveau 267/267 dans la release, avant tout déploiement.

### Test fonctionnel à faire par le propriétaire (environ 4 minutes)

1. **Second onglet (PC)** : connecté, donne quelques coups au bloc (PV entamés), note son nom et ses PV, puis ouvre le jeu dans un 2ᵉ onglet. Résultat attendu :
   - le **même bloc avec les mêmes PV** ;
   - le 1ᵉʳ onglet affiche « Jeu ouvert dans un autre onglet — Jouer ici ».
2. **Rafraîchissement** : recharge la page (F5) plusieurs fois. Résultat attendu : le bloc ne change jamais tant qu'il n'est pas cassé.
3. **PC → téléphone (PWA)** : sur le PC, mets l'onglet en arrière-plan, puis ouvre l'appli sur le téléphone. Résultat attendu :
   - le téléphone montre le **même bloc, les mêmes PV et les mêmes pièces** ;
   - sur le PC, au plus tard 15 s après, l'écran « 📱 Partie ouverte sur un autre appareil — Jouer ici » s'affiche ;
   - le PC ne mine plus, ni par clic ni par Auto-Dig, et tu restes connecté.
4. **« Jouer ici »** : joue un peu sur le téléphone, puis touche « Jouer ici » sur le PC. Résultat attendu :
   - le PC reprend l'état exact du téléphone ;
   - le téléphone se verrouille à son tour.
5. **Rien ne se relance** : casse un bloc rare ou un coffre, puis recharge. Résultat attendu :
   - la récompense est déjà acquise ;
   - le bloc suivant est le même, quel que soit le nombre de rechargements ou d'appareils.

## 7. Choix techniques faits seul

- **La dernière page ouverte prend la main automatiquement**, comme l'onglet unique de #18 que tu as validé. L'ancien appareil reprend la main par un clic explicite (« Jouer ici »). Ainsi, le joueur n'est jamais bloqué et on évite les reprises de main mutuelles toutes les 12 s.
- **Tirage reproductible (graine + numéro de bloc) plutôt que tirage serveur à chaque bloc.**
  - Il supprime toute relance au changement d'onglet ou d'appareil et au rafraîchissement, même après une sauvegarde plus ancienne.
  - Il ne coûte aucune requête par bloc.
  - Il garde les probabilités exactes de #32 (vérifié).
  - Le tirage entièrement côté serveur relève de l'économie autoritaire (#25, lots C/D/E).
- **Contrôle du contrôleur dans la transaction d'écriture** : aucune course possible entre une prise de contrôle et une sauvegarde tardive.
- **Bail de 45 s** (signal toutes les 15 s, onglet visible seulement) : il permet la reprise automatique après fermeture ou plantage, sans action du joueur.
- **Ancien contrôleur avec un bail expiré** : il ne peut pas écrire directement. Il doit d'abord reprendre la main, puis relire la sauvegarde serveur. Cela évite qu'un téléphone resté des heures en veille écrase la progression faite sur le PC.
- **La déconnexion n'est jamais forcée** : seul le droit de jouer est retiré (exigence du ticket).

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Reste à réaliser

- (Après lancement) Prise de contrôle « douce » : demander à l'ancien appareil d'envoyer ses dernières secondes avant de céder la main, au lieu de reprendre sa dernière sauvegarde (12 s au maximum).
- (Après lancement, #25 lots C/D/E) Économie et tirage autoritaires côté serveur, pour résister à un client modifié.
- (Après lancement) Panel admin : afficher l'appareil qui a la main et son époque (utile au support).
