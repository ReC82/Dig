# Ticket #20 — [P2] T-13 — Rendre les paramètres économiques effectifs

- Ticket : https://github.com/ReC82/Dig/issues/20
- Source : audit général #6 (T-13, bug B8, risque P2 « paramètres d'admin morts »)
- Branche : `feature/20-parametres-economiques` (commit `ee2340b`)

## Session du 30/10/2026 (nuit, DIGORCH)

### 1. État réel

**Déployé en production (SHA `5a35fa3`) — en attente de recette.**
Classement : **Après lancement** (aucun effet visible tant que les réglages restent à leur valeur neutre).

### 2. Résultat

Avant : trois réglages de l'admin ne servaient à rien (`upgrade_cost_multiplier`,
`coin_gain_multiplier`, `season_duration`). Un coût de coffre modifié dans l'admin était débité
par le serveur, mais le jeu affichait toujours l'ancien prix. Le bonus de la relique Shard Magnet
était ignoré par le serveur (B8) : le serveur lisait `relicBonuses`, un cache du navigateur
jamais sauvegardé.

Maintenant :

| Réglage admin | Effet en jeu |
|---|---|
| `upgrade_cost_multiplier` (0.1–10) | Coût en pièces de toutes les améliorations (onglet Améliorations), arrondi à l'unité supérieure. |
| `coin_gain_multiplier` (0.1–10) | Pièces gagnées par bloc (et affichées sous le bloc) et gains hors ligne. |
| `fragment_drop_multiplier` (0.1–10) | Fragments des coffres de la boutique. C'était déjà appliqué par le serveur ; c'est maintenant aussi le cas pour un joueur sans compte. |
| `chest_cost_simple/rare/antique` (entier ≥ 1) | Prix affiché dans la boutique de saison = prix débité par le serveur. |
| `season_duration` | **Retiré** des paramètres de saison. Depuis #16, les saisons durent une semaine ISO (du lundi au dimanche, UTC). Il reste visible dans la config brute, marqué « Inutilisé ». La valeur en base est conservée. |

Les effets s'appliquent **sans redéploiement** :
- au prochain chargement de la page ;
- ou sous 5 minutes pour une partie déjà ouverte (interrogation existante de `/api/seasons/current`).

Le serveur recalcule le bonus Shard Magnet à partir du niveau de la relique enregistré dans la
sauvegarde, soit +1 à +5 fragments par coffre. Les anciennes sauvegardes, où les reliques sont
une liste, sont comprises (niveau 1).

Fichiers :
- `server/economy.js` (nouveau) : lecture bornée de la config, validation des saisies admin, bonus de relique.
- `server/chestShop.js` : coûts, multiplicateur et bonus via `economy.js`. La réponse indique le coût débité.
- `server/seasons.js` : `GET /api/seasons/current` → `config.economy`.
- `server/index.js` : `PUT /api/admin/config` répond 400 à une valeur économique hors bornes. L'achat de coffre renvoie `cost`.
- `public/js/balance.js` : `Balance.economy`, `applyEconomy()`, `scaleUpgradeCoins()`.
- `public/js/upgrades.js` : coût multiplié dans `Upgrades.getCost`, gain multiplié dans `getRewardMultiplier`.
- `public/js/main.js` : application à chaque réponse saison, puis redessin des améliorations, de la boutique et du gain du bloc. L'affichage des améliorations passe par `Upgrades.getCost`. Le tirage anonyme applique le multiplicateur de fragments.
- `public/admin/admin.js`, `public/admin/index.html` : libellés, `season_duration` retiré, erreurs de validation affichées.
- `test/economy.test.js` (nouveau) : 9 tests.

### 3. SHA et procédure de test technique

- **SHA sur `develop` : `5a35fa3`** (fusion `--no-ff` de `ee2340b`), identique au SHA déployé.
- Tests : `npm test` → 118/118, sur la branche, sur `develop` et sur la release `5a35fa3`.
  - `node --test test/economy.test.js` → 9/9 : bornes, valeurs invalides en base ignorées, Shard Magnet, tirage d'un coffre avec coût, multiplicateur et bonus, cohérence des valeurs client/serveur, application côté client, puis en HTTP un changement admin visible sans redémarrage et un achat de coffre au prix réglé.
- Essai navigateur sur un serveur de test (port 3101, base temporaire) :
  - après le passage de l'admin à ×2 coût, ×1,5 gain et coffre simple à 1 000, puis un rechargement : pioche 100 → 200, multiplicateur 1 → 1,5, boutique « 💰 1,000 » ;
  - après le retour à 1 et un `_pollSeason()` sans rechargement, l'interface revient à 100 et 2 000 ;
  - aucune erreur console sur ordinateur ni sur smartphone.

### 4. Vérifications, limites, données des joueurs

- **Données des joueurs :** aucune migration, aucune écriture.
  - Les réglages de production valaient déjà 1.0 et 2000/15000/80000 (vérifié en lecture seule) : **le jeu est strictement inchangé tant que l'admin ne les modifie pas.**
  - Empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues` et `player_click_tracking` identiques à chaque contrôle : sur la copie de production avant et après démarrage, et en production avant et après le déploiement.
- Limite 1 : l'économie reste calculée dans le navigateur (risque P1 de l'audit, hors périmètre). Les multiplicateurs de coût et de gain ne sont donc appliqués que par le client. Seuls les coffres sont contrôlés par le serveur.
- Limite 2 : le **panel admin est désactivé en production** (`ADMIN_SECRET` absent, `/api/admin/*` répond 503). Les réglages ne peuvent donc pas être modifiés en production aujourd'hui. Voir la décision 1.
- Non vérifié : l'interface de l'admin dans un navigateur. La sauvegarde a été vérifiée par l'API, et le code de l'interface a seulement été relu.

### 5. Déploiement

- SHA déployé : **`5a35fa3`** (production précédente : `b64af44`).
- Contrôles avant déploiement :
  - release propre `npm ci` + `npm test` 118/118 ;
  - copie de la base de production démarrée en `NODE_ENV=production` sur le port 3122 : `/health` ok, version `1.0.0+5a35fa3`, `config.economy` neutre, empreintes identiques ;
  - copie supprimée.
- Sauvegarde vérifiée par `deploy.sh` : `~/backups/dig/dig-20261030-022331-pre-deploy-5a35fa3.sqlite`.
- Après déploiement :
  - les 2 domaines répondent 200 et `/api/version` = `1.0.0+5a35fa3` ;
  - journal sans erreur ;
  - `quick_check` ok ;
  - empreintes joueurs identiques à la sauvegarde pré-déploiement ;
  - essai Chromium sur dig.lodygames.com (1280×900 et 390×844) : pioche 100, coffres 2 000 / 15 000 / 80 000, multiplicateur 1, aucune erreur.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep b64af44 && sudo systemctl restart dig`. Les dépendances sont inchangées et il n'y a aucune migration à défaire.

### 6. Test fonctionnel à faire par le propriétaire

**Sans admin (possible tout de suite), environ 2 minutes :**
1. Ouvrir https://dig.lodygames.com et se connecter.
2. Onglet Améliorations : les prix sont inchangés (pioche niveau 1 → 2 : 100 pièces).
3. Boutique de saison : 2 000 / 15 000 / 80 000.
4. Casser un bloc : le gain correspond au gain affiché sous le bloc, comme avant.
5. Avec la relique Shard Magnet débloquée : un coffre qui donne des fragments en donne désormais +1 à +5 de plus selon le niveau de la relique.

**Avec l'admin (si tu l'actives, voir la décision 1) :**
1. Admin → « Économie & Joueurs » :
   - « Coût des upgrades » = 2 ;
   - « Gain de coins » = 2 ;
   - « Coffre simple » = 1000 ;
   - Enregistrer.
2. Recharger le jeu. Résultat attendu :
   - Améliorations : la pioche coûte 200 ;
   - le gain affiché sous le bloc est doublé ;
   - la boutique affiche 1 000 pour le coffre simple ;
   - l'achat débite exactement 1 000.
3. Saisir 0 ou 50 comme multiplicateur : message d'erreur, valeur non enregistrée.
4. Remettre 1 / 1 / 2000, puis recharger : tout revient comme avant.

### 7. Choix techniques faits seul

- **Appliquer plutôt que supprimer** les deux multiplicateurs. Ils existaient déjà dans l'admin avec leur libellé et valaient 1.0 en production : les activer ne change aucune règle tant que personne ne les modifie. C'est toi qui décides de toute variation.
- **Bornes 0.1–10** pour les multiplicateurs, qui reprennent les bornes déjà présentes dans le formulaire admin. Les coûts de coffre doivent être des entiers ≥ 1. Une valeur invalide déjà en base est ignorée (valeur par défaut) : une mauvaise saisie ne peut ni casser le jeu ni rendre un coffre gratuit.
- **`season_duration` retiré de l'interface** plutôt qu'appliqué : depuis #16, les saisons sont des semaines ISO, et une durée variable contredirait ce calendrier. La ligne en base est conservée.
- **Bonus de relique recalculé côté serveur** à partir du niveau sauvegardé, plutôt que de sauvegarder le cache `relicBonuses` qui serait falsifiable. Un test vérifie que la table du serveur est identique à `public/js/relics.js`.
- **Le multiplicateur de coût s'applique à toutes les améliorations payées en pièces**, y compris la boutique de fragments et le reroll. Elles sont toutes saisonnières et remises à zéro à chaque saison.
- **Pas de nouvelle requête** : les paramètres passent par `/api/seasons/current`, déjà interrogé au chargement et toutes les 5 minutes.

### 8. Décisions demandées au propriétaire

Aucune décision n'est nécessaire pour ce ticket. Une option :

1. **Activer le panel admin en production ?** Il faut définir `ADMIN_SECRET` (au moins 32 caractères) dans `/etc/dig/dig.env`, puis `sudo systemctl restart dig`. C'est une opération sur un secret : à faire par toi.
   - Option A : l'activer pour pouvoir régler l'économie sans redéploiement.
   - Option B : le laisser désactivé jusqu'au lancement.
   - Recommandation : **A** si tu veux tester le scénario « avec admin » ci-dessus. Sinon **B** : aucun risque, le jeu reste au réglage neutre.

### 9. Reste à faire

- Rien pour le périmètre du ticket.
- Suite possible, après lancement : faire calculer l'économie par le serveur (risque P1 de l'audit, à rattacher à #25 « progression serveur »). C'est seulement alors que les multiplicateurs de coût et de gain deviendront impossibles à contourner.
