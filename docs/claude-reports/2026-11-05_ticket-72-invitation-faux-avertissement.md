# Ticket #72 — Invitation bêta créée : faux avertissement « modifications non enregistrées » à la fermeture

- Ticket : [#72 — [P1][BUG] Invitation bêta créée : faux avertissement « modifications non enregistrées » à la fermeture](https://github.com/ReC82/Dig/issues/72)
- Session : 05/11/2026 (nuit), DIGORCH
- Liens : #57 (fiche « Inviter un testeur »), #61 (garde commun des fiches admin)

## 1. État réel

**Déployé en production (SHA `2169b5c`) — en attente de recette.**
Changement limité au panel admin (HTML/JS). Aucune migration, aucune route serveur modifiée, aucune donnée joueur touchée, aucune invitation de production créée, consommée ni révoquée.

## 2. Cause et résultat

**Cause (reproduite avant correction)** : le garde générique #61 (`admTrack`) suit chaque champ modifié de la fiche. Le prénom saisi à l'étape 1 (« Pour qui ? ») restait marqué « modifié » après la création. À l'étape 2, l'invitation est pourtant déjà enregistrée, mais « Terminé », « ✕ Fermer » ou Échap ouvraient quand même la boîte générique « Modifications non enregistrées … rien n'est enregistré ni publié ». La zone « Message » n'y était pour rien : elle était en lecture seule. Sans prénom, le bug n'apparaissait pas. Le parcours automatique #72 lancé sur l'ancien code s'arrête bien sur cette boîte.

**Comportement après correction** (fiche Admin → Bêta → « ➕ Inviter un testeur ») :

| Situation | Avant | Après |
|---|---|---|
| Étape 1 (formulaire), prénom saisi, fermeture | « Modifications non enregistrées » (#61) | identique : rien n'est encore créé |
| Étape 2 (lien créé), « Terminé », « ✕ » ou Échap | faux avertissement | **fermeture directe** |
| Étape 2, message retouché à la main puis fermeture | (message non modifiable) | boîte **« Message personnalisé non copié »** : « L'invitation est déjà créée et reste valide : seul ton texte personnalisé sera perdu ». Choix : « Revenir au message » (par défaut, le texte est conservé) ou « Abandonner le texte » |
| Message retouché puis « ✉️ Copier un message prêt à envoyer » | — | plus rien à perdre : fermeture directe |
| Message retouché puis « ➕ Inviter quelqu'un d'autre » | — | même boîte spécifique ; la première invitation reste dans « Liens d'invitation créés » |

- La zone « Message » est désormais **modifiable** (« Message (modifiable avant de le copier) »). Le ticket prévoit ce cas, et « Copier un message prêt à envoyer » copie le texte tel qu'il a été adapté.
- « Créer le lien » ignore un second clic pendant la requête, ce qui garantit un seul lien par clic.
- Chaque création affiche son propre lien. « Inviter quelqu'un d'autre » repart d'un formulaire vide et donne un nouveau lien distinct. « Copier le lien » copie bien ce nouveau lien.

### Fichiers

| Fichier | Changement |
|---|---|
| `public/admin/admin.js` | Fiche d'invitation : `betaInviteDirty` / `betaInviteCanClose` (étape 1 = garde #61, étape 2 = retouche du message seulement), `betaInviteKeepMsg` (confirmation spécifique), suivi remis à zéro après la création, garde anti double clic ; `betaCopy` rend `true` si la copie a réussi. |
| `public/admin/index.html` | Zone « Message » modifiable. |
| `test/admin-unsaved.test.js` | Test statique #72 (dans `npm test`). |
| `test/e2e/beta-invite-close.e2e.js` | Parcours Chromium PC 1280×900 + mobile 390×844 (hors `npm test`, navigateur requis). |

## 3. SHA et procédure de test

- Branche `fix/72-invitation-faux-avertissement`, commits `dc99ab5` et `63c4d29` ; **`develop` = `2169b5c`** (fusion `--no-ff`).
- `npm test` : 739/739 sur la branche et sur la release `2169b5c`.
- Parcours navigateur (serveur de test, base neuve, jamais la production) :
  ```
  ADMIN_SECRET=$(cat /tmp/secret) DB_FILE=test-72.sqlite PORT=3101 node server/index.js
  DIG_E2E_BASE=http://127.0.0.1:3101 DIG_E2E_SECRET_FILE=/tmp/secret NODE_PATH=<…>/node_modules node test/e2e/beta-invite-close.e2e.js
  ```
  Résultat : **38/38 OK** (19 PC + 19 mobile). Le parcours vérifie aussi :
  - 7 créations donnent exactement 7 invitations en base, avec les bons libellés, aucune utilisée ni révoquée ;
  - les liens affichés correspondent aux invitations en base ;
  - aucune boîte native, aucune erreur JS ;
  - aucun code d'invitation n'est écrit dans la sortie.

## 4. Vérifications et limites

- Non-régression :
  - parcours #61 `admin-unsaved.e2e.js` : 56/56 OK ;
  - parcours #57 `beta-invite.e2e.js` : OK (invitation, inscription de l'invité, lien déjà utilisé, mode fermé).
- Aucun e-mail : la fiche n'envoie rien (copie manuelle seulement), et le code serveur n'a pas changé.
- En production, seuls ont été contrôlés le chargement du panel (PC et mobile, 0 erreur JS) et la zone Message modifiable. **Aucune invitation n'a été créée en production** : la recette réelle revient au propriétaire.
- Limite : si la copie automatique échoue (navigateur sans presse-papiers), la fenêtre « Copie impossible ici » s'affiche. Le texte retouché reste alors considéré « non copié », par prudence : la fermeture demandera encore confirmation.

## 5. Déploiement

- SHA déployé : **`2169b5c`** (précédent : `e8c345a`), le 05/11/2026 à 04:27 (Bruxelles), par `scripts/deploy.sh` de la release.
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261105-042752-pre-deploy-2169b5c.sqlite`.
- Copie de la base de production démarrée avec `2169b5c` : santé OK, version OK. Les empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking` et `beta_invites` sont identiques avant et après le démarrage. La copie a ensuite été supprimée.
- Après déploiement :
  - `dig.lodygames.com` et `dig.lodylands.com` répondent 200, `/api/version` = `1.0.0+2169b5c` ;
  - journal sans erreur, `quick_check` ok ;
  - empreintes identiques à la sauvegarde pré-déploiement.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep e8c345a` puis `sudo systemctl restart dig`. Le changement ne touche que le panel, sans migration ni `npm ci`.

### Test fonctionnel à faire par le propriétaire

1. Admin → Bêta → « ➕ Inviter un testeur », saisir un prénom, « Créer le lien ».
2. Cliquer « Terminé » : la fiche se ferme **sans aucune boîte**. Le lien apparaît une seule fois dans « Liens d'invitation créés ».
3. Recréer un lien, ajouter une phrase dans « Message », puis cliquer « ✕ Fermer ».
   - La boîte « Message personnalisé non copié » apparaît et précise que l'invitation reste valide.
   - « Revenir au message » conserve le texte.
   - « ✉️ Copier un message prêt à envoyer », puis « Terminé » : la fiche se ferme directement.
4. Facultatif : « Inviter quelqu'un d'autre » donne un nouveau lien, différent du précédent.

Les liens créés pendant ce test sont de vraies invitations (1 inscription, 14 jours). Révoque-les ensuite dans « Liens d'invitation créés » si tu ne les envoies pas.

**Classement : Bloquant MVP public** (outil de la bêta privée, P1).

## 6. Choix techniques faits seul

- **Message modifiable.** Le ticket décrit le cas « message modifié manuellement ». Rendre la zone modifiable est la seule façon d'adapter le texte avant de le copier.
- **Texte conservé après « Revenir au message ».** C'est le point « à trancher » du ticket ; c'est l'option la moins surprenante.
- **Pas de boîte après copie du message retouché.** Le texte est déjà dans le presse-papiers.
- **Boîte spécifique sans bouton rouge.** Seul un texte local est en jeu, aucune donnée serveur.
- **Garde propre à la fiche** (`dirty` / `canClose` d'`admDialogSetup`), sans affaiblir le garde #61 global ni la protection de l'étape 1.

## 7. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 8. Restant à réaliser

Rien pour ce ticket, hors recette. Suggestion « Après lancement », non implémentée : afficher dans « Liens d'invitation créés » un bouton « Copier le message » pour les liens déjà créés.
