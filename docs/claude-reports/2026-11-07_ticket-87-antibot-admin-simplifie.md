# Ticket #87 — Admin Anti-bot simplifié : parcours de test guidé, diagnostics repliés

## 1. Ticket

#87 — [P0][UX] Simplifier Anti-bot admin — parcours de test guidé, diagnostics repliés —
https://github.com/ReC82/Dig/issues/87 (ouvert par le propriétaire le 07/11 après le test #25-F non validé :
il ne savait pas où aller ; les boutons « Essai Appliqué sur ce compte » et « Émettre un défi d'essai »
étaient difficiles à trouver). Lié : #25 (lot C), #84 (bêta du 09/11).

## 2. État réel

**Déployé en production (SHA `4feed13`) — en attente de recette.** Classement : **Bloquant MVP public**
(outil de recette de l'anti-bot avant la bêta du 09/11). Refonte livrée en une seule fois : pas besoin de la
livraison en deux temps prévue par le ticket.

## 3. Résultat et changements

Admin → 🛡 Anti-bot, de haut en bas :

1. **Trois cartes courtes** : « Protection des joueurs » (*Observation — aucune vérification imposée aux
   joueurs : le serveur mesure et note seulement* ; Appliquée = vérifications réelles ; indique aussi
   « Essai en cours sur : … »), « Joueurs à vérifier » (nombre + « Voir la liste »), et le bouton primaire
   **« ▶ Tester la protection »**.
2. **Parcours guidé « Tester la protection »** en 5 étapes numérotées, l'étape en cours encadrée en jaune,
   les étapes faites cochées ✓ avec leur état en clair :
   1. Choisir le compte de test (pseudo ou #ID ; prérempli depuis la fiche avec « 🧪 Tester la protection
      sur ce compte », ou après F5 avec le compte en essai) ;
   2. **« Lancer un essai uniquement pour ce compte »** — la seule étape confirmée (elle rend une
      suspension réelle possible) ;
   3. **« Afficher le défi de vérification »** ;
   4. « Revenez dans le jeu et résolvez » — suivi : *pas encore affichée* → *affichée dans le jeu depuis
      hh:mm* → *résolue : le compte peut miner normalement* (bouton « ↻ Voir où en est le compte ») ;
   5. **« Terminer le test / remettre l'état normal »** : annule la vérification en cours, lève une
      suspension, remet le palier à 0, arrête l'essai, puis vérifie que le mode global n'a pas changé
      (« Mode global inchangé : Observation »).
   Boutons verrouillés pendant chaque appel (double clic = un seul défi), indisponibles quand l'étape n'a
   pas de sens. Info-bulle sur « mode global » ; texte expliquant qu'un essai ne concerne qu'un compte.
3. **Joueurs à surveiller** : suspensions actives, vérifications en attente, essais en cours (« pensez à
   Terminer le test »), indices de triche (niveau ≥ 1, « rien n'est appliqué »), triés par urgence ; champ
   « Ouvrir la fiche d'un joueur ».
4. **Réglages** (replié) : explication simple des trois modes globaux, boutons du mode (passage en Appliqué
   toujours confirmé, inchangé), seuils actuels.
5. **Diagnostic et historique** (replié) : synthèse technique, historique vérifications / suspensions,
   derniers contrôles, comptes par score, **journal des anomalies joueurs** (filtre « anomalies joueur »
   par défaut, 25 lignes puis « Afficher plus »), **audit admin à part** (chargé seulement à l'ouverture),
   protocole de recette complet (mis à jour pour pointer vers le parcours). Tableaux limités à 10 lignes
   (« Afficher les N autres lignes »). Aucune donnée retirée.

**Fiche joueur** : en tête, un statut compréhensible — **« Peut miner normalement »**, **« Vérification en
attente »** ou **« Minage suspendu jusqu'à jj/mm hh:mm »** (heure de Bruxelles) — avec une phrase
d'explication, l'action principale « 🧪 Tester la protection sur ce compte » et, selon le cas, « Annuler la
vérification » / « Lever la suspension ». La vue essentielle garde les **quatre indicateurs validés
(#25-E/#76)**, avec des explications raccourcies (plus de *shadow / enforce / applied:false*) ; l'explication
longue « ni manuels ni Auto-Dig » est repliée. Les mesures du lot C (série, temps actif, palier, boutons
d'essai) et les modes / PV réels passent dans « Diagnostic avancé » (nouvelle section repliable
« Vérification et suspension — mesures et actions », 12 sections au total). Les actions d'essai admin
(défi d'essai, essai Appliqué, résolution) ne sont plus comptées comme « alertes » du joueur dans la vue
essentielle (elles restent dans le diagnostic).

Fichiers : `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`,
`docs/admin-navigation.md` (nouvelle action du plan « Tester la protection anti-bot sur un compte »,
`#a/sec-test` ; une cible dans une section repliée est maintenant ouverte automatiquement),
`test/antibot-admin-ux-87.test.js` (nouveau), `test/e2e/admin-antibot-87.e2e.js` (nouveau),
`test/antibot-player-report.test.js` et `test/e2e/admin-antibot-sheet.e2e.js` (section ajoutée).

**Non modifié** : aucun seuil, algorithme anti-bot, mode global, sanction, route serveur ni donnée joueur ;
le parcours n'appelle que les routes d'essai par compte déjà existantes (#25 lot C).

![PC — parcours en cours](img/2026-11-07_ticket-87-pc-parcours.png)
![PC — test terminé](img/2026-11-07_ticket-87-pc-termine.png)
![Mobile 390 — haut de l'onglet](img/2026-11-07_ticket-87-mobile-onglet.png)
![Mobile 390 — fiche joueur](img/2026-11-07_ticket-87-mobile-fiche.png)

## 4. SHA et procédure de test

Branche `feature/87-antibot-parcours-guide` (`af7d48c`) ; **`develop` = `4feed13`** (déployé).
- `npm test` : 896/896 (branche, `develop`, release `4feed13`).
- Essai navigateur (serveur de test port 3101, base neuve, vrai jeu dans un 2e contexte) :
  `PW=… CHROME=… BASE=http://127.0.0.1:3101 ADMIN=… node test/e2e/admin-antibot-87.e2e.js` → **TOUT OK**
  à 1280×900, 390×844 et 320×640 ; `admin-antibot-sheet.e2e.js` (#76) → TOUT OK.

## 5. Vérifications, limites, impact données

Contrôlé dans le navigateur à chaque taille : carte Observation, bouton visible, réglages / diagnostic
repliés et journal masqué, pas de débordement horizontal ; confirmation annulée = aucun essai (clic
accidentel) ; **F5 en plein parcours** : compte et étape retrouvés ; double clic → un seul défi ; étape 4
*pas encore affichée* → *affichée* → résolue dans le vrai jeu (grille) ; fiche : statut + action en tête,
mesures dans le diagnostic ; « Terminer » : essai arrêté, état normal, palier 0 ; **mode global Observation
inchangé** ; un autre compte créé en même temps **jamais concerné** ; minage manuel normal ensuite ; audit
admin séparé chargé à l'ouverture ; aucune erreur JavaScript.

Limites : après F5, le compte est retrouvé seulement une fois l'essai lancé (le panel ne garde rien dans le
navigateur, règle de sécurité existante) ; avant cela il faut le ressaisir. Vrais autoclickers non testés
(recette #25). Impact données joueurs : aucun (affichage admin ; actions = routes d'essai existantes).

## 6. Déploiement

- Aucune génération IA en cours. Copie de la production : empreintes des 6 tables identiques avant / après
  démarrage de la release (`NODE_ENV=production`, port 3122), `quick_check` ok, copie supprimée.
- `main` avancé `b500256` → `4feed13` ; `scripts/deploy.sh` de la release : sauvegarde vérifiée
  `~/backups/dig/dig-20261107-153643-pre-deploy-4feed13.sqlite`, « OK : 4feed13 en service ».
- Après : dig.lodygames.com et dig.lodylands.com → 200 et `1.0.0+4feed13`, journal sans erreur,
  `quick_check` ok, empreintes identiques à la copie, `antibot_response_mode` = `observe`, routes admin → 401
  sans session, nouvel `admin.js` servi.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep b500256` + `sudo systemctl restart dig` (aucune
  migration, aucun changement de dépendances).

**Test fonctionnel à faire par le propriétaire (< 2 min, PC ou téléphone)** :
1. /admin/ (**Ctrl+F5** ou fermer/rouvrir l'onglet) → 🛡 Anti-bot. Attendu : 3 cartes en haut, « Observation ».
2. « ▶ Tester la protection » → saisir votre compte de test → « Choisir ce compte » → « Lancer un essai
   uniquement pour ce compte » → confirmer → « Afficher le défi de vérification ».
3. Dans le jeu avec ce compte (F5) : « Petite vérification » → la résoudre. Admin → « ↻ Voir où en est le
   compte » : étape 4 ✓ « Résolue ».
4. « Terminer le test / remettre l'état normal ». Attendu : « ✓ Test terminé … Mode global inchangé :
   Observation » ; dans le jeu, minage normal.

## 7. Choix techniques faits seul

- Parcours entièrement côté panel, en enchaînant les routes d'essai existantes : aucun risque serveur, aucun
  nouvel accès au mode global.
- Confirmation uniquement pour « Lancer l'essai » (seule étape rendant une suspension possible) ; « Terminer »
  et « Afficher le défi » sans confirmation (le défi n'a d'effet que sur le compte en essai).
- « Joueurs à vérifier » = suspension active, vérification en attente, essai en cours, ou niveau de risque ≥ 1
  (score ≥ 30) ; les scores inférieurs restent dans le diagnostic.
- Reprise après F5 par l'état serveur (compte en essai) plutôt que `sessionStorage`, interdit dans le panel
  (test de sécurité existant).
- Événements `antibot_admin`, `challenge_*`, `suspension_started` exclus du compteur « Alertes » de la vue
  essentielle (ce sont des réponses ou des actions admin, pas des anomalies du joueur).

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire. (Le passage global en Appliqué reste la décision ouverte de #25.)

## 9. Éléments restant à réaliser

- Recette du propriétaire ci-dessus.
- Proposé, non réalisé : la fiche « Joueurs » (onglet Joueurs → 🛡) pourrait proposer aussi « Tester la
  protection sur ce compte ».
