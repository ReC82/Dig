# Ticket #31 — Saison : classement, points de mérite et accès boutique

- Ticket : [#31 — [P2] Saison — classement, points de mérite et accès boutique](https://github.com/ReC82/Dig/issues/31)
- Session : 30/10/2026 (session 1)
- Classement MVP : **Après lancement** (le jeu se partage sans ; améliore la lisibilité de l'onglet
  Saison maintenant que les points sont crédités pour de vrai).

## 1. État réel

**Déployé en production (SHA `80d2e51`) le 30/10/2026 à 21:16 (Bruxelles) — en attente de recette.**
Changement client seul (affichage), sans migration ni écriture en base.

## 2. Réconciliation et périmètre

Le ticket décrivait d'abord une « probabilité personnelle » de gain. Le propriétaire l'a remplacée le
30/10 ([commentaire](https://github.com/ReC82/Dig/issues/31)) : **concours au mérite, pas de tirage** ;
afficher le rang, le barème de points (#33), le solde et l'accès à la boutique (#34) ; pas de prix réel
annoncé tant que #27 n'est pas activé.

Déjà livré par les tickets liés (non refait) :
- rang et statistiques de la saison en cours (carte joueur, #9) ;
- carte « 🏅 Points de récompense » : solde, « si la saison finissait maintenant : rang #r sur n →
  +p pts », barème, historique (#33) ;
- carte « 🎁 Boutique de cadeaux » sous les points (#34) ;
- classement figé à la clôture et son API publique `/api/seasons/last/standings` (#29), dont #29
  signalait l'affichage en jeu comme reste à faire pour #31.

Dépendances : #16, #28, #29, #33, #34 livrés et déployés ; #27 ne bloque plus le développement
(décision du 30/10) ; #30 et #26 ne sont pas nécessaires à cet affichage. Aucune dépendance bloquante.

## 3. Résultat et changements

**Ce que voit le joueur dans l'onglet Saison** (FR/EN/NL, ordinateur et mobile) :

1. **Nouvelle carte « 🏁 Résultat — <saison précédente> »** (visible aussi sans compte) :
   - « Classement figé le <date> · N participant(s) · M classé(s) » ;
   - podium des 3 premiers classés (pseudonyme, ligue, profondeur) ; le joueur est surligné ;
   - pour le joueur connecté : « Ton résultat : rang #r sur M · X m · +P pts crédités » (ou
     « simulation, non crédités »), « Tu n'as pas participé à cette saison » ou « Tu n'étais pas
     classé (aucune profondeur validée) » ;
   - aucun classé : « Aucun participant classé : pas de vainqueur ni de points pour cette saison » ;
   - **« Preuve publique »** (repliable) : le classement ne peut plus être modifié, seuls pseudonymes et
     scores sont publiés, empreinte SHA-256 de l'instantané et lien vers le classement figé complet.
2. **Bouton « 🎁 Ouvrir la boutique de cadeaux (N articles) »** dans la carte des points : fait défiler
   jusqu'à la boutique et y place le focus clavier.
3. **« Comment fonctionne la saison ? »** complété par **« 🏆 Comment est établi le classement ? »** :
   participer (connecté, au moins un bloc à la main), ordre au mérite (profondeur validée par le
   serveur, puis blocs à la main, puis premier arrivé — **aucun tirage au sort**), date de figement de
   la saison en cours, points puis boutique. « Points de récompense » ajouté à la liste « Conservé ».
4. **Visiteur** : « Connectez-vous pour participer au classement, gagner des points de récompense et
   accéder à la boutique de cadeaux ! »
5. **Erreurs** : si la saison ne se charge pas (réseau, serveur), message « Impossible de charger la
   saison pour l'instant » + bouton « Réessayer » (avant : « Chargement… » indéfiniment). Même
   message dans la carte du résultat si seule cette requête échoue. Pas encore de saison figée :
   la carte n'apparaît pas.

Aucun prix réel, montant, carte cadeau ou probabilité n'est affiché.

| Fichier | Changement |
|---|---|
| `public/js/main.js` | `_loadLastResult()` / `_lastResultHtml()` (carte du résultat), `_fmtUtc()`, `_seasonErrorHtml()`, règles du mérite, bouton d'accès à la boutique, état d'erreur avec « Réessayer », rechargement du résultat à chaque ouverture de l'onglet. |
| `public/js/i18n.js` | Clés `season.merit.*`, `season.last.*`, `season.error`, `season.retry`, `season.info.k_points`, `points.shop_link` ; `season.not_connected` complété (FR/EN/NL). |
| `public/css/style.css` | Carte du résultat (bleu), bouton boutique, message d'erreur, classe `.sr-only`. |
| `test/season-view.test.js` (nouveau) | 5 tests (voir § 5). |

## 4. SHA, branche et procédure de test

- Branche : `feature/31-saison-merite-boutique` — commit code `e3442c7`.
- **SHA sur `develop` : `80d2e51`** (fusion `--no-ff`), déployé tel quel.
- Tests : `npm test` → **330/330** (worktree du ticket, `develop` et release au SHA exact) ;
  `node --test test/season-view.test.js` → 5/5.
- Essai local : base de test avec une saison close figée (4 participants dont un à 0 m) et un compte
  connecté, `PORT=3101 DB_FILE=test-31.sqlite node server/index.js`, onglet Saison en 1280×900 (FR)
  et 390×844 (NL) + visiteur : aucune erreur JavaScript, rendu conforme.

## 5. Vérifications

**Effectuées :**
- Tests automatiques (bloc de rendu exécuté avec les vraies traductions) : podium, pseudonyme échappé
  (`<b>` affiché en texte), compte supprimé, non-classés exclus du podium, ligne du joueur surlignée,
  points crédités / simulation, non participant, non classé, visiteur, saison sans classé, absence de
  saison figée, erreur avec « Réessayer » (`role="alert"`), EN/NL ; aucune mention de tirage,
  probabilité, Amazon ou carte cadeau ; branchement dans l'onglet ; clés i18n (test existant).
- Copie de la base de production démarrée en mode production avec ce SHA : santé, version,
  `/api/seasons/last/standings` OK ; empreintes des 6 tables identiques ; copie supprimée.
- Production : voir § 6.

**Non effectuées / limites :**
- Pas d'essai connecté en production (pas d'identifiants) : seule la vue visiteur a été vérifiée en
  ligne ; la vue connectée a été vérifiée en local.
- Le lien « Voir le classement figé complet » ouvre la réponse JSON de l'API (preuve brute). Une page
  lisible pourrait venir plus tard (§ 9).
- Les attributions **simulées** ne sont pas affichées sous « Ton résultat » quand le crédit réel est
  actif (même règle que l'historique #33) : la saison 44-2026 (close à 16:45) a été créditée en réel,
  donc le cas ne se présente pas en production.
- « E-mail vérifié » et « participation explicite » : non affichés, car aucun des deux n'est exigé
  pour les points et la boutique virtuelle ; ils relèvent de l'activation des cadeaux réels (#27, #30).

**Données des joueurs :** aucune écriture, aucune migration. Affichage seul.

## 6. Déploiement

- **SHA déployé : `80d2e51`** (production précédente : `2f86161`), servi en `1.0.0+80d2e51` sur
  https://dig.lodygames.com et https://dig.lodylands.com (200).
- **Sauvegarde pré-déploiement vérifiée** : `~/backups/dig/dig-20261030-211634-pre-deploy-80d2e51.sqlite`.
- **Après** : 2 domaines 200 et bonne version ; `journalctl` sans erreur ; `quick_check` ok ;
  empreintes `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`,
  `player_click_tracking` **identiques** à la sauvegarde ; navigateur headless sur la production
  (visiteur, 390×844 et 1280×900) : carte « 🏁 Résultat — Saison 44-2026 » affichée, sans erreur.
- **Retour arrière** : `git -C /home/ubuntu/Dig reset --keep 2f86161` puis `sudo systemctl restart dig`
  (`package-lock.json` inchangé). Rien à défaire en base.

**Test fonctionnel à faire par le propriétaire (3 min) :**
1. Recharger le jeu (PC puis téléphone), connecté, et ouvrir **🏆 Saison**.
2. Sous ta carte de rang : carte bleue **« 🏁 Résultat — Saison 44-2026 »** → « Classement figé le
   30 oct. 2026, 16:45 · 1 participant(s) · 1 classé(s) », 🥇 lody 279 m surligné,
   « Ton résultat : rang #1 sur 1 · 279 m · +5 pts crédités ».
3. Ouvrir **« Preuve publique »** → empreinte `55ed46c5…` ; le lien ouvre le classement figé.
4. Carte des points → **« 🎁 Ouvrir la boutique de cadeaux (0 articles) »** → la page descend à la
   boutique.
5. Ouvrir « ℹ️ Comment fonctionne la saison ? » → section **« 🏆 Comment est établi le classement ? »**
   (aucun tirage au sort) ; « Points de récompense » dans « Conservé ».
6. Se déconnecter (ou fenêtre privée) → message d'invitation complété ; la carte du résultat reste
   visible, sans « Ton résultat ».
7. Changer la langue en EN puis NL → textes traduits.

## 7. Choix techniques faits seul

- **Pas de nouvelle route serveur** : l'API publique de #29 suffit ; le champ `me` donne le résultat du
  joueur et les points viennent de `/api/points/me` (#33). Zéro risque pour la base.
- **Carte du résultat placée avant les points** : elle explique d'où viennent les points du solde.
- **Podium limité aux 3 premiers** : le classement de la saison en cours reste plus bas ; le
  classement figé complet reste accessible par la preuve.
- **Rechargé à chaque ouverture de l'onglet** (et non à chaque actualisation de 30 s) : il ne change
  qu'à une clôture.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Éléments restant à réaliser

- (Après lancement) Page lisible pour la preuve publique / l'historique des saisons figées, au lieu du
  JSON brut.
- (Après lancement, avec #27/#30) Mentions « participation explicite », « e-mail vérifié », lot,
  contact privé du gagnant : seulement le jour où des cadeaux réels sont activés.
- (Après lancement) Traduction ES avec #42.
