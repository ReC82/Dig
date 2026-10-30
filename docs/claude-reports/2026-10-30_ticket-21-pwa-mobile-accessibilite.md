# Ticket #21 — [P2] T-14 — PWA, ergonomie mobile et accessibilité

Lien : https://github.com/ReC82/Dig/issues/21
Session DIGORCH du 30/10/2026 (≈ 02:25–02:45, Bruxelles).

## 1. État réel

**Déployé en production (SHA `e32398d`) — en attente de recette.**
Classement : **Après lancement** (recommandé ; ne bloque pas le MVP, mais améliore nettement l'expérience sur téléphone).

## 2. Résultat et changements

Comportement visible :
- **Installable** : Chrome/Android propose « Installer l'application » ; sur iPhone, « Sur l'écran d'accueil » donne une icône DIG! (pioche dorée) et le jeu s'ouvre en plein écran, sans barre d'adresse.
- **Hors ligne** : une fois le jeu ouvert une première fois, il se relance sans réseau (progression locale conservée ; la synchronisation reprend au retour du réseau).
- **iPhone à encoche** : le titre n'est plus caché sous l'encoche, la barre de navigation reste au-dessus de la barre d'accueil, en portrait comme en paysage.
- **Zoom** : le zoom à deux doigts est de nouveau permis (accessibilité) ; le double-tap ne zoome toujours pas (`touch-action: manipulation`, inchangé).
- **Clavier** : Tab amène le focus sur le bloc (contour doré), Entrée ou Espace = un coup de pioche. Une touche maintenue ne compte qu'**un** coup (la répétition automatique est ignorée, pour ne pas créer d'autoclic). Contour de focus doré sur tous les boutons au clavier (pas au toucher ni à la souris).
- **Mouvements réduits** (réglage système « Réduire les animations ») : secousses, rebonds, particules et pulsations remplacés par des fondus. Le jeu continue normalement (le bloc suivant apparaît bien).
- **Contrôle de version** : au chargement de la page et au retour de l'application au premier plan (en plus du focus existant), la bannière « Mise à jour disponible » s'affiche si une nouvelle version est en ligne.

Fichiers :
- `public/index.html` — viewport `viewport-fit=cover` sans `user-scalable=no`, manifest, `theme-color`, balises iOS, icônes ; bloc `role="button"`, `tabindex="0"`, libellé traduit.
- `public/manifest.webmanifest` — nom, `start_url`, `display: standalone`, couleurs, icônes 192/512/maskable.
- `public/sw.js` — service worker (voir §7).
- `public/assets/pwa/*.png` + `tools/pwa/make-icons.js` — icônes générées localement par dessin vectoriel (sharp), sans service externe.
- `public/css/style.css` — marges sûres (haut, côtés, modales), `:focus-visible`, bloc `prefers-reduced-motion`.
- `public/js/main.js` — clavier sur le bloc, enregistrement du service worker, contrôle de version au chargement et au retour au premier plan.
- `public/js/i18n.js` — libellé `ui.block_aria` (fr, en, nl).
- `server/index.js` — route `/sw.js` (version injectée, `Cache-Control: no-cache`), `manifest.webmanifest` et `library.json` servis sans cache longue durée (ils n'ont pas de `?v=`).
- `test/pwa.test.js` — 5 tests.

## 3. SHA, branche, procédure de test

- Branche : `feature/21-pwa-mobile-accessibilite` (commit `58038ff`).
- **`develop` : `e32398d`** (merge), puis le commit de ce rapport.
- Tests automatisés : `npm test` → **123/123** (dont `test/pwa.test.js`).
- Essai navigateur local (Chromium headless, port 3101, base de test) :
  - service worker actif et page contrôlée après rechargement, cache `dig-<version>` avec 20 fichiers ;
  - rechargement **hors ligne** : le jeu s'affiche avec la progression ;
  - clavier : Tab atteint le bloc, Entrée fait 3/3 → 2/3 HP, 41 appuis Entrée/Espace cassent plusieurs blocs (11 pièces), aucun blocage d'animation ; touche maintenue = 1 seul coup ;
  - mouvements réduits activés : les blocs se succèdent normalement ;
  - au toucher ou au clic, le contour de focus n'apparaît pas ;
  - Chrome (`Page.getInstallabilityErrors`) : aucune erreur, sauf « in-incognito », propre au navigateur de test ; manifest sans erreur.

## 4. Vérifications, limites, données joueurs

- **Données joueurs** : aucune migration, aucune écriture en base. Copie de la base de production démarrée avec la release : empreintes (lignes + hachage) de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` identiques. Après déploiement : identiques à la sauvegarde pré-déploiement, `quick_check` = ok.
- Non vérifié : un vrai iPhone ou Android (aucun appareil physique ici). Les marges sûres ne se voient que sur un appareil à encoche : c'est l'objet de la recette.
- Le service worker ne met **jamais** en cache l'API (`/api/…`), l'admin, ni les requêtes autres que GET : sauvegardes, classement et connexion passent toujours par le réseau.
- Les icônes sont **provisoires** (pioche vectorielle simple). Elles pourront être remplacées par une icône de la direction artistique #22 : il suffit de remplacer les PNG de `public/assets/pwa/`.

## 5. Déploiement

- SHA déployé : **`e32398d`** (`/api/version` = `1.0.0+e32398d`), 02:38. Précédent : `5a35fa3`.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-023823-pre-deploy-e32398d.sqlite`.
- Contrôles : 123/123 sur le SHA exact (release), copie de prod identique, `https://dig.lodygames.com` et `https://dig.lodylands.com` → 200, `/sw.js` et `/manifest.webmanifest` → 200, journal sans erreur, `quick_check` ok, empreintes identiques, essai navigateur en production (ordinateur 1280×900 et smartphone 390×844) : service worker actif, aucune erreur JavaScript, aucune erreur d'installabilité.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 5a35fa3` puis `sudo systemctl restart dig` (pas de changement de dépendances). Sans la route `/sw.js`, le navigateur reçoit une 404 lors de sa vérification et **désinstalle le service worker de lui-même** : le retour arrière ne laisse pas de cache bloquant chez les joueurs.

### Test fonctionnel à faire par le propriétaire

1. **Android (Chrome)** : ouvrir https://dig.lodygames.com → menu ⋮ → « Installer l'application » (ou bannière). Lancer depuis l'icône : plein écran, icône pioche dorée.
2. **iPhone (Safari)** : Partager → « Sur l'écran d'accueil ». Lancer : le titre DIG! n'est pas sous l'encoche, la barre du bas n'est pas sous la barre d'accueil. Tourner en paysage : rien n'est coupé sur les côtés.
3. **Hors ligne** : après avoir joué une fois, passer en mode avion et relancer l'app : le jeu s'ouvre avec ta progression. Réactiver le réseau : la sauvegarde cloud reprend.
4. **Ordinateur, clavier** : Tab jusqu'au bloc (contour doré), Entrée ou Espace = un coup ; maintenir Espace = un seul coup.
5. **Mouvements réduits** (Windows : Paramètres → Accessibilité → Effets d'animation désactivés ; iPhone : Accessibilité → Mouvement → Réduire les animations) : les blocs se cassent par fondu, le jeu continue.
6. Au prochain déploiement, revenir dans l'app déjà ouverte : la bannière « Mise à jour disponible » apparaît ; « Recharger » charge la nouvelle version.

Résultat attendu : tout ce qui précède, sans perte de progression.

## 6. Choix techniques faits seul

- **Réseau d'abord pour la page, cache d'abord pour les fichiers `?v=`** : les joueurs ont toujours la dernière version en ligne ; les fichiers versionnés ne changent jamais, donc aucun risque de mélange. Le cache porte la version et est purgé à chaque déploiement.
- **`/sw.js` servi par le serveur avec la version injectée et sans cache** : chaque déploiement modifie le worker, le navigateur l'installe tout seul (`skipWaiting` + `clients.claim`). Pas de rechargement forcé : la bannière existante laisse le joueur choisir.
- **Zoom à deux doigts rétabli** (retrait de `user-scalable=no`, ignoré par iOS de toute façon) : exigence d'accessibilité ; le double-tap reste bloqué par `touch-action: manipulation`.
- **Mouvements réduits par remplacement, jamais par `animation: none`** sur les éléments dont le jeu attend la fin d'animation (bloc, textes flottants, particules) : sinon le bloc suivant n'apparaîtrait plus. Un test automatique le vérifie.
- **Répétition clavier ignorée** : une touche maintenue n'est pas un autoclic gratuit ; les coups clavier passent par le même compteur anti-autoclic que les clics.
- `library.json` ajouté aux fichiers servis sans cache longue durée : il était servi « immuable » alors qu'il n'a pas de `?v=` (le client le lisait déjà en `no-store`, donc aucun effet visible).

## 7. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. Optionnel : souhaites-tu une icône d'application dans le style « pierre C » (#22) à la place de la pioche provisoire ? Recommandation : oui, après lancement, dans le cadre de #22.

## 8. Reste à réaliser (Après lancement)

- Icône d'application définitive (#22).
- Gestion clavier des modales (Échap pour fermer, piège de focus) et navigation clavier complète des vues : non demandé explicitement par le ticket, à prévoir dans #24 si utile.
- Écran « hors ligne » dédié si la page n'a jamais été chargée (aujourd'hui : erreur réseau standard du navigateur).
