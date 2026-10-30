# Ticket #26 — Historique des notifications dans Paramètres

- Ticket : [#26 — [P2] Historique des notifications dans Paramètres](https://github.com/ReC82/Dig/issues/26)
- Date : 30/10/2026 (session DIGORCH)
- Classement : **Après lancement** (amélioration UX, non bloquante pour le MVP). Le correctif d'affichage
  inclus (§3.4) améliore tous les onglets dès maintenant.

## 1. État réel

**Déployé en production (SHA `2f86161`), en attente de recette.**

## 2. Résultat

Les notifications du jeu (toasts) restent consultables après leur disparition, dans
**Paramètres (⚙) → Historique des notifications**. Le journal est lisible sur smartphone. Il est
conservé au rechargement et peut être effacé.

## 3. Changements

### 3.1 `public/js/notifLog.js` (nouveau)
Journal local stocké dans `localStorage` (clé `dig_notif_log`), sur l'appareil seulement, sans aucun envoi au serveur :
- chaque entrée contient l'heure, le type (information, succès, avertissement ou erreur), l'icône et le texte intégral ;
- **100 entrées au maximum** ; les plus anciennes sont supprimées en premier ;
- **anti-spam** : si le même message (même type, même texte) revient dans les 10 minutes, l'entrée existante remonte en tête avec un compteur « ×N », sans créer de doublon ;
- une erreur de stockage (quota plein, navigation privée, données corrompues) est ignorée : le journal ne bloque jamais l'affichage ni le minage.

### 3.2 Ce qui est historisé (`public/js/main.js`)
- **Tous les toasts `showAchievement`**, avec un type déduit de l'icône (❌ = erreur, ⚠️ = avertissement, ☁️/👤 = information, autres = succès). Exemples : conflit de synchronisation « Progression mise à jour depuis le serveur (autre appareil ou action admin) », nouvelle saison, erreurs de la boutique, reliques, quêtes, missions, objets trouvés, messages du compte.
- **Nouveaux événements, enregistrés sans toast** pour ne rien changer à l'affichage actuel :
  - « Partie ouverte sur un autre appareil » ou « sur un autre onglet » (avertissement), quand cette page perd la main ;
  - « Progression reprise depuis le serveur (autre appareil ou action admin) » (information), quand un rechargement ou « Jouer ici » applique une sauvegarde serveur plus récente ;
  - « Sauvegarde en ligne impossible pour l'instant… » (avertissement) **une seule fois** à la première erreur d'envoi, puis « Sauvegarde en ligne rétablie » (succès) à la reprise.
- **Non historisé** : le toast « Sauvegardé ✓ », qui revient toutes les 12 secondes.
- **Déconnexion** : le journal est vidé, pour que le joueur suivant ne le voie pas sur un appareil partagé.

### 3.3 Paramètres
Une nouvelle section apparaît sous « Langue ». Chaque entrée affiche le type, la date et l'heure locales (`30/10/2026 20:59:54`), le compteur « ×N » éventuel et le texte complet. Elle porte une bordure de couleur selon le type. La liste défile si elle est longue. Le bouton « Effacer l'historique » demande une confirmation. Si le journal est vide, le message « Aucune notification pour l'instant. » s'affiche. Tout le texte est échappé (`escapeHtml`). Textes en FR, EN et NL.

### 3.4 Correctif d'affichage (`public/css/style.css`)
En vérifiant l'écran, j'ai constaté un défaut ancien (présent depuis mai), aussi visible en production avant ce déploiement. La règle `#view-dig { display: flex }`, basée sur un identifiant, l'emportait sur `.view.hidden`. La vue « Creuser » (bloc, bouton « Doubler ») **restait donc affichée au-dessus de tous les autres onglets** : Amélios, Paramètres, etc. Le contenu de l'onglet ouvert était repoussé vers le bas, ce qui rendait l'historique peu lisible sur smartphone (critère 2). La correction tient en une ligne : `#view-dig.hidden { display: none; }`. Vérification faite : l'onglet Dig s'affiche toujours normalement, et les autres onglets ne montrent plus que leur propre contenu.

### 3.5 Tests
`test/notif-log.test.js` (5 tests) vérifie l'ordre des entrées, le type, la déduplication, la limite de 100, la persistance, l'effacement, la tolérance aux erreurs de stockage, l'absence de « Sauvegardé » dans le journal, la section de Paramètres, l'échappement, le correctif CSS et les traductions en FR, EN et NL.

## 4. Références et procédure de test

- Branche : `feature/26-historique-notifications` (commit `a537305`)
- **SHA sur `develop` : `2f86161`** (fusion `--no-ff`)
- Tests : `npm test` → 325/325.
- Essai navigateur (Chromium headless) en local, sur le port 3101 avec une base de test, en 390×844 et 1280×900 : toasts historisés, ×2 sur une répétition, `<b>` affiché tel quel, historique conservé après rechargement, effacement fonctionnel, aucune erreur JavaScript.
- **Scénario multi-appareils réel** (deux navigateurs, même compte de test) : A joue, puis B se connecte. A est verrouillé, et son journal contient « Partie ouverte sur un autre appareil ». Après rechargement de A (« Jouer ici »), son journal contient aussi « Progression reprise depuis le serveur (autre appareil ou action admin) ». L'historique est conservé.

## 5. Vérifications, limites, données

- Données des joueurs : **aucun impact**. Le changement concerne seulement le client (JS, CSS, HTML), sans migration ni route serveur.
- Le journal est **propre à chaque appareil et navigateur** : un message reçu sur le PC n'apparaît pas dans le journal du téléphone. C'est le comportement voulu par le ticket (« historique local »).
- Les textes sont enregistrés dans la langue du moment : après un changement de langue, les anciennes entrées restent dans la langue d'origine.
- Les erreurs serveur affichées par certains toasts (boutique, compte) sont reprises telles quelles. Elles ne contiennent ni adresse e-mail ni secret.

## 6. Déploiement

- SHA déployé : **`2f86161`** (avance rapide de `main` depuis `d04a6ad`), le 30/10/2026 à 20:59 (Bruxelles).
- Release : `npm ci` et `npm test`, 325/325 sur le SHA exact.
- Copie de la base de production démarrée en mode production sur le port 3122 : `/health` et `/api/version` OK, empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` **identiques** avant et après démarrage. Copie supprimée ensuite.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-205941-pre-deploy-2f86161.sqlite`.
- Après déploiement : dig.lodygames.com et dig.lodylands.com en 200 avec la version `1.0.0+2f86161`, `notifLog.js` servi, journal `dig` sans erreur, `quick_check` ok, empreintes joueurs identiques à la sauvegarde. Capture smartphone en production : section affichée, vue Dig masquée dans Paramètres et Amélios.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep d04a6ad && sudo systemctl restart dig`, sans changement de dépendances.

### Test fonctionnel à faire par le propriétaire (≈ 3 min)
1. Sur le PC, jouer quelques secondes, puis ouvrir le jeu sur le téléphone (même compte). Attendre au plus 15 s : le PC affiche « Partie ouverte sur un autre appareil ». Toucher « Jouer ici » sur le PC.
2. Sur le PC : ⚙ → descendre jusqu'à **Historique des notifications**. **Attendu :** « Partie ouverte sur un autre appareil » (avertissement) et « Progression reprise depuis le serveur (autre appareil ou action admin) » (information), avec la bonne date et heure locale et le texte complet.
3. Actualiser la page (F5), puis rouvrir ⚙ : **l'historique est toujours là**.
4. Jouer 1 minute : les « Sauvegardé ✓ » **n'apparaissent pas** dans le journal. Une quête ou un objet trouvé y apparaît, et une répétition du même message affiche « ×2 ».
5. Sur le téléphone, ⚙ → Historique : lisible, sans débordement. « Effacer l'historique » → confirmer → « Aucune notification pour l'instant. »
6. Bonus (correctif §3.4) : ouvrir Amélios, Collection ou Paramètres. **Le bloc à creuser ne s'affiche plus au-dessus** de ces onglets.

## 7. Choix techniques faits seul

- **Stockage local seulement**, sans serveur : c'est la demande (« historique local », « effacer l'historique local »). Cela évite toute migration et toute donnée personnelle côté serveur.
- **Tous les toasts sont historisés**, et non une liste choisie : le ticket demande le texte intégral des messages qu'on peut manquer. La limite de 100 entrées et le regroupement « ×N » évitent l'inondation. Le seul toast répétitif (« Sauvegardé ») est exclu.
- **Journal vidé à la déconnexion**, pour la confidentialité sur un appareil partagé, comme la purge de la sauvegarde locale (#18).
- **Type déduit de l'icône** plutôt que d'un paramètre ajouté aux ~25 appels existants : changement minimal, et un type explicite reste possible.
- Correctif CSS §3.4 inclus dans ce ticket : il conditionne directement la lisibilité mobile de la nouvelle section (critère 2) et tient en une ligne.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Restant à réaliser

- Rien pour ce ticket, sauf retour de recette.
- Suggestion (après lancement, non implémentée) : un badge « nouvelles notifications » sur ⚙ quand un avertissement ou une erreur a été historisé sans toast.
