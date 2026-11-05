# Ticket #80 — Bêta fermée : gérer, révoquer et archiver invitations, testeurs et retours

- Ticket : [#80 — [P1][UX] Bêta fermée — gérer, révoquer et archiver invitations, testeurs et retours](https://github.com/ReC82/Dig/issues/80)
- Session du 05/11/2026 (soir)

## 1. État réel

**Déployé en production (SHA `326b31d`), en attente de recette.**
Classement : **Après lancement** (confort d'administration de la bêta ; rien ne bloque le MVP public).

## 2. Résultat visible

Dans **Admin → Bêta fermée** :

- Nouveau bouton **« 🗂️ Gérer les invitations et testeurs »** sur le tableau de bord. Il ouvre une fiche légère avec trois onglets : **🔗 Liens**, **👥 Testeurs** et **🕘 Historique**, plus une recherche (pseudo, « pour qui », fin du code) et un filtre.
- **Liens** : chaque lien affiche « pour qui », son état (actif, utilisé, révoqué, expiré, archivé), le nombre d'inscriptions, la date et l'auteur de la création, la date d'expiration ou de révocation. Le code n'est jamais affiché en entier (`DIG-••••-WZFM`) ; « 📋 Copier le lien » reste disponible pour un lien actif.
  - **Révoquer** (lien actif) : confirmation courte, puis le lien est refusé par le serveur dès la requête suivante. Les comptes déjà créés avec ce lien ne sont pas touchés.
  - **🗄️ Archiver** (lien utilisé, révoqué ou expiré) : le lien sort de la liste courante. Filtre « Archives » → **↩️ Réafficher**. Un lien encore actif ne peut pas être archivé : il resterait utilisable tout en étant caché, le serveur refuse donc et demande de le révoquer d'abord.
  - Filtres : liste courante (hors archives), actifs, utilisés, révoqués, expirés, archives, tous.
- **Testeurs** : liste avec lien utilisé, date d'inscription, dernière sauvegarde, retours J+1/J+7 et nombre de signalements. Les colonnes du tableau d'avant sont reprises.
  - **Retirer du programme** : confirmation qui énonce les conséquences. Le testeur sort de la liste et des compteurs de la bêta ; son compte, sa connexion, sa progression, son classement et ses retours ne changent pas. Filtre « Hors programme » → **↩️ Réintégrer**.
- **Retours des testeurs** : nouveau sélecteur **Afficher : Retours actifs / Archives** et bouton **🗄️ Archiver** (ou **↩️ Réafficher**) sur chaque retour. Le texte, le diagnostic, le statut, la note et le lien GitHub sont conservés. Les compteurs portent sur les retours actifs, avec le nombre d'archivés.
- **Historique** : qui a fait quoi et quand, par exemple « Lien révoqué — DIG-…WZFM — admin (session) ».
- Les tableaux « Liens d'invitation créés » et « Testeurs inscrits » ont quitté « Paramètres avancés » pour cette fiche. Il reste dans « Paramètres avancés » : lots de codes, bugs connus et mot de passe perdu.
- **Plan & actions courantes** et recherche du menu : « Révoquer ou archiver un lien, retirer un testeur » (`#a/beta-manage`) et « Archiver un retour de test traité » (`#a/beta-archive`).

### Limite documentée : retirer un testeur ne coupe pas l'accès au jeu

La bêta ne contrôle que la **création** de compte : depuis #57, la connexion n'a jamais dépendu du code d'invitation. Il n'existe pas non plus de suspension de compte dans le jeu. Le retrait est donc **administratif et réversible**, et la confirmation le dit en toutes lettres : « le compte reste jouable normalement ». Il n'y a aucun masquage qui prétendrait couper l'accès. Couper réellement l'accès d'un compte demanderait une suspension de compte, qui est une décision produit hors du périmètre de ce ticket (voir décision 1).

## 3. Changements techniques

| Fichier | Changement |
|---|---|
| `server/db.js` | Migration **additive et idempotente** : `beta_invites.archived_at`, `beta_invites.created_by`, `beta_invite_uses.removed_at`, `bug_reports.archived_at` (toutes NULL par défaut) et nouvelle table `beta_audit`, en ajout seul (des déclencheurs refusent UPDATE et DELETE). |
| `server/beta.js` | `revokeInvite` (idempotente, journalisée, renvoie `changed`) ; `archiveInvite` / `unarchiveInvite` (409 sur un lien actif) ; `removeTester` (exige `confirm: true`) / `restoreTester` ; `archiveReport` / `unarchiveReport` ; `listReports({ archived })` ; `listAudit` ; compteurs testeurs sans les retirés ; auteur de la création noté. |
| `server/index.js` | 6 routes `POST /api/admin/beta/{invites/:id/archive,unarchive}`, `{testers/:userId/remove,restore}` et `{reports/:id/archive,unarchive}`, toutes derrière `requireAdmin` (session du panel + en-tête anti-CSRF `X-Dig-Admin`, ou clé). Elles sont aussi tracées par le journal admin existant (`security_events`, #25). |
| `public/admin/*` | Fiche de gestion, filtre et archivage des retours, styles (cibles tactiles ≥ 40 px, sans débordement à 320 px), deux actions courantes. |
| `docs/admin-navigation.md` | Les deux actions ajoutées. |
| `test/beta-manage.test.js` | 7 tests : liens, testeurs, retours, journal, migration d'une base d'avant #80, routes HTTP (autorisation, effets ciblés), contrôle statique du panel. |
| `test/e2e/beta-manage.e2e.js` | Essai navigateur sur PC 1280 px et mobile 390 et 320 px. |

Aucune suppression nulle part : aucun compte, aucune sauvegarde, aucun classement, aucune donnée anti-bot et aucun retour n'est effacé.

## 4. SHA, branche et procédure de test

- Branche `feature/80-gestion-beta`, commit `50a88f9`. Fusion dans `develop` : **`326b31d`**, déployé.
- Tests automatisés : `npm test` (808/808).
- Essai navigateur, sur un serveur de test avec une base vide :
  `PW=…/playwright-core CHROME=…/chrome-headless-shell BASE=http://127.0.0.1:3101 ADMIN=<secret> OUT=/tmp/x node test/e2e/beta-manage.e2e.js`

## 5. Vérifications

- `npm test` complet : **808/808** sur la branche, puis à nouveau sur le worktree de release du SHA exact `326b31d`.
- `test/e2e/beta-manage.e2e.js` : 9 étapes réussies, 4 passages consécutifs (PC 1280 px, 390 px, 320 px, aucune erreur JavaScript, codes jamais affichés en entier, fermeture sans faux avertissement).
- Non-régression #72 : `test/e2e/beta-invite-close.e2e.js` entièrement OK (fermeture directe, protection #61, 7 invitations).
- Non-régression #70 : `test/e2e/admin-nav.e2e.js` « TOUT OK » (39 contrôles).
- Migration sur une copie de la base de production (démarrage en `NODE_ENV=production`) : empreintes de `users`, `user_saves`, `season_rankings`, `seasons`, `leagues`, `player_click_tracking`, `beta_invites`, `beta_invite_uses` et `bug_reports` identiques avant et après ; nouvelles colonnes toutes à NULL ; `beta_audit` vide. La vue d'ensemble garde les mêmes compteurs (2 testeurs, 2 liens actifs, 1 retour). Copie supprimée.
- Les 2 liens et les 2 testeurs réels n'ont été ni révoqués ni retirés : tous les essais ont tourné sur des bases de test.
- Non vérifié : essai navigateur dans le panel de **production**, qui demande la clé admin (jamais lue). C'est le rôle de la recette du propriétaire.

## 6. Déploiement

- SHA déployé : **`326b31d`** (précédent : `52a8fab`), via `scripts/deploy.sh` lancé depuis la release.
- Sauvegarde vérifiée avant déploiement : `~/backups/dig/dig-20261105-193633-pre-deploy-326b31d.sqlite`.
- Après déploiement : dig.lodygames.com et dig.lodylands.com → 200, `/api/version` = `1.0.0+326b31d`, page admin servie avec `admin.js?v=1.0.0+326b31d` et le nouveau bouton, nouvelle route en 401 sans autorisation, `journalctl` sans erreur, `pragma quick_check` = ok, empreintes joueurs identiques à la sauvegarde.
- Retour arrière possible tout de suite : `git -C /home/ubuntu/Dig reset --keep 52a8fab` puis `sudo systemctl restart dig`. Les colonnes ajoutées sont ignorées par l'ancien code ; aucune restauration de base n'est nécessaire.

### Test fonctionnel à faire par le propriétaire

1. Admin → Bêta fermée : les compteurs n'ont pas changé (« 2 testeurs inscrits », « 2 liens d'invitation actifs »).
2. Cliquer **« 🗂️ Gérer les invitations et testeurs »**. Onglet Liens : tes liens apparaissent avec « pour qui », leur état et un code masqué.
3. Créer un lien de test (« ➕ Inviter un testeur », prénom « essai »), puis le retrouver dans la fiche. **Révoquer** : la confirmation explique l'effet, le compteur de liens actifs baisse de 1, et l'ouvrir dans une fenêtre privée affiche « lien révoqué ».
4. Sur ce lien révoqué : **🗄️ Archiver**. Il disparaît de la liste ; filtre « Archives » → il y est → **↩️ Réafficher** fonctionne.
5. Onglet Testeurs : les 2 testeurs réels sont listés. Si tu veux tester le retrait, fais-le sur un compte de test, ou réintègre aussitôt. La confirmation dit bien que le compte reste jouable.
6. Onglet Historique : tes actions y figurent avec date et heure.
7. Retours des testeurs : **🗄️ Archiver** un retour traité, puis « Afficher : Archives » → il y est, avec tout son contenu → **↩️ Réafficher**.
8. Sur téléphone : la fiche est lisible et les boutons se touchent facilement.
9. Fermer la fiche après une recherche : aucun avertissement « modifications non enregistrées ».

## 7. Choix techniques faits seul

- **Révoquer ≠ archiver ≠ retirer** : la révocation est définitive pour un lien (pour réinviter, on crée un nouveau lien). L'archivage et le retrait d'un testeur sont des marquages réversibles, sans aucune suppression.
- **Un lien actif ne s'archive pas** : sinon un lien caché resterait utilisable.
- **Retrait de testeur = marquage administratif**, faute de mécanisme d'accès à couper, et dit honnêtement (voir la limite plus haut). `confirm: true` est exigé côté serveur, en plus de la confirmation dans le panel.
- **Confirmations proportionnées** : seuls « Révoquer » et « Retirer du programme » demandent confirmation. Archiver, réafficher et réintégrer se font en un clic, puisqu'ils s'annulent aussitôt.
- **Journal dédié `beta_audit`**, en ajout seul et lisible dans le panel. Il ne contient qu'une ligne par changement réel : répéter une action ne crée pas de doublon. Le journal admin global (`security_events`) continue de tracer chaque requête.
- **Codes masqués dans la fiche** (`DIG-••••-XXXX`) ; la recherche accepte la fin du code.
- **Confirmation dans la fiche** et pas seulement en toast, parce qu'un toast est caché sous une fiche modale.
- Les anciens liens n'ont pas d'auteur noté (`created_by` NULL) : la fiche n'affiche alors pas « par … ».

## 8. Décisions demandées au propriétaire

1. **Couper réellement l'accès d'un testeur (facultatif)** : aujourd'hui, « Retirer du programme » ne bloque pas la connexion. Options : (a) en rester là, **recommandé** pour la bêta, car un testeur indésirable est rare et son lien peut être révoqué ; (b) créer un ticket « suspension de compte réversible » (connexion refusée avec un message, compte et données intacts), qui est une règle produit à valider.

## 9. Reste à faire

- Rien pour ce ticket, en dehors de la recette.
- Idée hors périmètre, signalée seulement : purge réelle (suppression définitive) des liens archivés très anciens. Elle n'est pas faite volontairement : la suppression de données demande ton accord écrit.
