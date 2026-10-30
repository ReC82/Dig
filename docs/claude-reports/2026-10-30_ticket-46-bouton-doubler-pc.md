# Ticket #46 — Bouton « Doubler vos récompenses » absent sur PC mais visible sur mobile

- Ticket : [#46 — [P1] Bouton « Doubler vos récompenses » absent sur PC mais visible sur mobile](https://github.com/ReC82/Dig/issues/46)
- Session : 30/10/2026, 23:15–23:50 (Bruxelles)
- Branche : `fix/46-bouton-doubler-pc` — commit `dc4b5b4`
- **SHA sur `develop` : `9c93981`** (fusion `--no-ff`)
- **SHA déployé : `9c93981`** (30/10 à 23:34), sur dig.lodygames.com et dig.lodylands.com
- Classement : **Après lancement** pour le correctif, déjà en ligne. La question 1 (publicité simulée) est à trancher **avant de partager le MVP** : c'est une recommandation, pas un blocage technique.

## 1. État réel

**Déployé en production (SHA `9c93981`) — en attente de recette.**

## 2. Cause et résultat

**Cause.** Le bouton portait la classe `ad-btn`. La liste **EasyList**, utilisée par uBlock Origin, AdBlock, Adblock Plus et les protections de Brave ou Opera, contient la règle générique `##.ad-btn`. Cette règle masque tout élément de cette classe, sur tous les sites. Les bloqueurs de publicité sont courants sur ordinateur et rares sur téléphone, d'où l'écart.

Les autres pistes demandées ont été écartées :
- **Affichage responsive** : aucune règle CSS ne masque le bouton selon la taille d'écran. Il est visible en 1280×900, 1366×768, 1920×1080, 1440×700 et 390×844.
- **Réglages et conditions** : il n'y a ni drapeau de fonctionnalité, ni test A/B, ni condition d'éligibilité. Le bouton est toujours présent, avec trois états : disponible, utilisé, recharge.
- **Cache** : le service worker est versionné à chaque déploiement.

**Reproduction.** Avant correction, en production, à 1280×900, avec les règles cosmétiques génériques d'EasyList, de Liste FR et de Fanboy Annoyance (≈ 42 700 sélecteurs) :
- `#btn-watch-ad` passe à `display:none`, à cause de la seule règle `##.ad-btn` ;
- sans ces filtres, le bouton est visible, sur PC comme sur mobile.

**Correctif.** Les identifiants et les classes du bouton et de sa fenêtre portent désormais des noms neutres :

| Avant | Après |
|---|---|
| `#ad-zone` | `#bonus-zone` |
| `.ad-btn` | `.bonus-btn` |
| `#btn-watch-ad` | `#btn-bonus-boost` |
| `#ad-timer` | `#bonus-timer` |
| `#ad-modal` | `#bonus-modal` |
| `#ad-mock-*` | `#bonus-card-*` |
| `#ad-bar-*` | `#bonus-bar-*` |
| `#ad-countdown` | `#bonus-countdown` |
| `#btn-close-ad` / `#btn-skip-ad` | `#btn-close-bonus` / `#btn-skip-bonus` |
| `data-ad-state` | `data-bonus-state` |

Autre correction : l'attribut `aria-labelledby` de la fenêtre pointait vers un identifiant inexistant. Il vise maintenant son titre.

**Ce qui ne change pas :**
- les textes, l'apparence, la position (sous la récompense du bloc, sans chevauchement avec la zone de minage) ;
- le comportement : écran de 5 s, puis **bonus ×2 pièces pendant 2 min**, une fois toutes les 5 min ;
- l'économie : aucune récompense ajoutée ni modifiée.

**Fichiers** : `public/index.html`, `public/css/style.css`, `public/js/main.js`, `public/js/monetization.js`, `test/robustness.test.js`, et le nouveau fichier `test/adblock-ui.test.js`.

**Statut actuel du bouton, lié à #45.** Le bouton lance une **publicité simulée** : un écran maison « DIG! — Edition Pro » avec un décompte de 5 s, sans régie ni vidéo. Ensuite, il **accorde réellement** le bonus ×2. Cette fonction existait avant cette nuit ; elle n'a pas été modifiée (voir la question 1). Aucune régie n'a été activée. La bannière de #45 reste désactivée par défaut.

## 3. Procédure de test (technique)

```bash
cd <worktree> && npm ci && npm test                 # 369/369
node --test test/adblock-ui.test.js                 # 3/3 : aucun id/classe « pub » dans l'interface du jeu
```

Le test `adblock-ui` refuse tout identifiant ou classe de l'interface du jeu qui contient un segment « publicitaire » (`ad`, `ads`, `advert`, `sponsor`, `promo`, `pub`…). Il porte sur `index.html`, `style.css`, `main.js` et `monetization.js`. Seuls les éléments de la vraie bannière de #45 sont exclus : `ad-top` et la demande de consentement `ad-consent*`.

**Essai navigateur.** Chromium headless, avec les filtres EasyList, Liste FR et Fanboy injectés en CSS, sur un serveur local (port 3101) :
- **Balayage de toutes les vues** (Creuser, Améliorations, Collection, Quotidien, Boutique, Saison, Paramètres) : aucun élément du jeu n'est masqué.
- **Parcours complet, PC 1280×900 et mobile 390×844** : clic sur le bouton, fenêtre visible, « Récupérer le bonus », puis bonus ×2 actif, bannière « Bonus ×2 pièces actif — 2:00 », état « Bonus déjà utilisé ». Aucune erreur JavaScript.

## 4. Vérifications et impact sur les données

- **Tests** : `npm test` 369/369 sur `develop` `9c93981` et sur la release du même SHA, sans relance.
- **Copie de la base de production** démarrée en mode production (port 3122) : `/health` ok, version `1.0.0+9c93981`. Empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques avant et après. Seuls ajouts : 3 tables de #45 (`ad_settings`, `ad_slots`, `ad_daily_stats`). Copie supprimée ensuite.
- **Impact du correctif #46 sur les données joueurs** : aucun. Il ne touche que le client : pas de migration, pas de modification des sauvegardes.
- **Non vérifié** : l'essai avec une vraie extension uBlock installée. Les règles cosmétiques génériques ont été injectées à la place. Les règles propres à un domaine et les règles réseau ne s'appliquent pas aux fichiers du jeu.

## 5. Déploiement

- **SHA déployé : `9c93981`**, le 30/10 à 23:34, par `scripts/deploy.sh` (version de la release). Passage depuis `90e0267`, 8 commits, sans `npm ci`.
- **`9c93981` contient aussi #45** (préparation publicitaire, **désactivée par défaut**). Son déploiement avait été refusé à cause d'un délai dépassé dans `antibot.test.js`. Cette fois, la suite complète de la release est verte (369/369) : #45 passe aussi en ligne. Aucune publicité n'est diffusée tant qu'elle n'est pas activée dans l'admin.
- **Sauvegarde pré-déploiement vérifiée** : `~/backups/dig/dig-20261030-233451-pre-deploy-9c93981.sqlite`.
- **Après déploiement** :
  - les 2 domaines répondent 200 avec `/api/version` = `1.0.0+9c93981` ;
  - `journalctl -u dig` ne montre aucune erreur ;
  - `pragma quick_check` = ok ;
  - empreintes joueurs identiques à celles d'avant déploiement ;
  - en production, PC + filtres EasyList : `#btn-bonus-boost` visible (219×41) sur les deux domaines.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 90e0267 && sudo systemctl restart dig`. Les dépendances sont inchangées. Les tables de #45 restent, vides et sans effet.

### Test fonctionnel à faire par le propriétaire (2 min)

1. Sur le **PC où le bouton manquait**, avec le bloqueur de pub toujours actif, ouvrir https://dig.lodygames.com. Si le bandeau « mise à jour » apparaît, actualiser.
2. Écran **Creuser**, sous la ligne « Récompense » : le bouton **« 📺 Doubler la récompense »** est visible.
3. Cliquer dessus. Un écran de 5 s s'ouvre, puis « Récupérer le bonus → ». Attendu : bannière « ⚡ Bonus ×2 pièces actif — 2:00 », bouton « ✅ Bonus déjà utilisé », puis décompte de recharge (5 min).
4. Vérifier sur le téléphone que rien n'a changé. Même essai sur https://dig.lodylands.com.

Si le bouton manque encore : le signaler dans #46 avec le navigateur et le bloqueur utilisés.

## 6. Choix techniques faits seul

- **Renommer plutôt que contourner** (pas de `display:flex !important`, pas de détection de bloqueur) : c'est la façon standard de ne pas être confondu avec une publicité. La règle cosmétique ne peut alors plus viser le bouton. Le bloqueur continue de bloquer les vraies publicités, comme attendu.
- **« promo » évité aussi** (`bonus-card-*` et non `bonus-promo-*`), car ce mot est fréquent dans les listes « annoyances ».
- **Clés de traduction inchangées** (`ui.btn_watch_ad`…) : elles ne sont jamais visibles dans la page et n'ont aucun effet sur les bloqueurs.
- **Comportement du bouton inchangé** : le modifier relève d'une décision produit (question 1).
- **Déploiement de #45 dans le même SHA** : `develop` contenait #45, et la règle demande de ne pas laisser s'accumuler des tickets terminés. Toutes les conditions étaient réunies sur ce SHA exact : suite verte, copie de base testée, sauvegarde vérifiée.

## 7. Décisions demandées au propriétaire

1. **Que faire de la publicité simulée derrière ce bouton ?** Aujourd'hui, un faux écran de pub de 5 s accorde un vrai bonus ×2 pendant 2 min.
   - A. Garder tel quel jusqu'à une vraie vidéo récompensée (#45).
   - B. **(recommandé)** Garder le même bonus ×2, gratuit et sans faux écran de pub : par exemple un bouton « ⚡ Bonus ×2 (2 min) » toutes les 5 min. Économie identique, plus honnête pour un MVP public.
   - C. Masquer le bouton jusqu'à une vraie régie avec preuve serveur. Les joueurs perdent un bonus existant.

   Aucune de ces options ne change le barème si les valeurs ×2 / 2 min / 5 min sont conservées.

## 8. Restant à réaliser

- Selon la question 1 : adapter le bouton (B ou C). Classement : avant le partage du MVP, recommandé.
- **Après lancement** : une vraie vidéo récompensée (#45) sera bloquée par les bloqueurs de pub. Il faudra alors un message clair (« publicité indisponible ») au lieu d'un échec silencieux. Le bonus reste aujourd'hui calculé côté client (cooldown dans la sauvegarde) : une preuve serveur sera nécessaire avec une vraie régie.
- À signaler, hors périmètre : la demande de consentement de #45 (`#ad-consent`) peut elle aussi être masquée par un bloqueur. C'est sans conséquence : sans réponse, aucune publicité ne se charge, et le jeu n'est pas bloqué.
