# DIG! — Déploiement des lots 1 et 2 (30/10/2026) et lancement du rapport de nuit

> Tenu à jour par chaque session DIGORCH (une ligne par ticket). Envoyé par e-mail à 07:00 (Bruxelles).
> Rapport détaillé à tout moment : `digorch status`.

## En tête

- **Version en production :** `b456a4d` (lot 2, #16), déployée à 00:51. Auparavant : `18e3881` (lot 1, #8 à #15), à 00:48. Avant cette nuit : `49faf2d`.
- **Données joueurs :** aucune perte. Empreintes identiques avant et après chaque déploiement ; la seule différence vient de la partie en cours du compte existant, dont la sauvegarde est passée de la version 6760 à 6767.
- **Prochain test concret à faire dans le jeu :**
  1. Te reconnecter une fois : le nouveau secret de session de #12 a fermé les anciennes sessions.
  2. Jouer 2 minutes.
  3. Recharger la page.
  4. Vérifier que pièces, profondeur et pioche sont conservées (#10).
- **Avant de partager le MVP :** voir la section « Reste avant le MVP public » en bas du fichier.

## Déploiements de la nuit

| Heure | SHA | Contenu | Sauvegarde pré-déploiement | Résultat |
|---|---|---|---|---|
| 00:48 | `18e3881` | #8, #9, #10, #11, #12, #14, #15 (+ #13 scripts, #22 aperçu `?icons=v1`) | `~/backups/dig/dig-20261030-004603-pre-deploy-18e3881.sqlite` | OK : santé et version, 2 domaines, en-têtes de sécurité, port 3000 fermé à l'extérieur, `/api/players` → 404, essai navigateur ordinateur et smartphone |
| 00:51 | `b456a4d` | #16 (rotation des saisons) | `~/backups/dig/dig-20261030-005124-pre-deploy-b456a4d.sqlite` | OK : saison 44-2026 active jusqu'au 01/11 23:59:59 UTC, index « une seule saison active » créé |

**Avant le lot 1 :**
- `npm ci` et `npm test` : 78/78 sur le SHA exact.
- Migration testée sur une copie de la base de production, en mode production : données identiques, seules des colonnes, des tables et 2 réglages ont été ajoutés.
- Secret de session créé dans `/etc/dig/dig.env` (root, 600, jamais affiché).
- Sauvegardes des configurations nginx et systemd, et de `node_modules`, dans `~/backups/dig/predeploy-20261030-004122/`.

**Avant le lot 2 :** 89/89 au second passage. Au premier, un seul échec : le test instable connu `rate-limit` « connexion : 429 ».

**Retour arrière :** `git -C /home/ubuntu/Dig reset --keep <SHA>`, puis `sudo systemctl restart dig`. Si le fichier de dépendances diffère : `npm ci --omit=dev`, ou recopier `~/backups/dig/predeploy-20261030-004122/node_modules-49faf2d`.

## Tickets — état et recette

| Ticket | MVP | État | Test à faire dans le jeu |
|---|---|---|---|
| #8 Coffres de saison | Bloquant | Déployé `18e3881` | Améliorations → Boutique de saison : acheter un coffre avec des pièces. Le montant est débité une seule fois et le coffre s'ouvre. Recharger : le solde reste cohérent. |
| #9 Classement serveur | Bloquant | Déployé | Miner quelques minutes, puis ouvrir Saison : ta profondeur au classement correspond à ta profondeur en jeu. |
| #10 Sauvegardes cloud et anti-autoclic | Bloquant | Déployé | Jouer 2 min, recharger : la progression est conservée. Cliquer vite à la main ne doit pas te pénaliser. ⚠ Voir le point anti-triche ci-dessous. |
| #11 Achats simulés désactivés | Bloquant | Déployé | Boutique : les achats payants sont en aperçu et n'accordent rien. |
| #12 Secrets, sessions, HTTP | Bloquant | Déployé | Te reconnecter une fois. Après rechargement, tu restes connecté. |
| #14 Limitation de débit, API legacy | Bloquant | Déployé | Une connexion normale fonctionne. Après 10 mauvais mots de passe en 1 min, un message d'attente s'affiche. |
| #15 XSS admin et classement | Bloquant | Déployé | Rien de visible à faire : un pseudo contenant `<b>` s'afficherait en texte brut. |
| #16 Rotation des saisons | Bloquant | Déployé `b456a4d` | Saison : « Saison 44-2026 », fin le 01/11 à 23:59:59 UTC. Lundi 2/11 : « Saison 45-2026 » ouverte sans action. |
| #22 Icônes v1 | Après lancement | Aperçu déployé | `https://dig.lodylands.com/?icons=v1` : la pierre C s'affiche à la place de l'emoji ; `?icons=legacy` revient aux emoji. |
| #13 Copie S3 | Après lancement | Reporté (AWS, demain) | — |
| #23 Console DIGORCH | Après lancement | Point d'activité toutes les 5 min | `tmux attach -t digorch`, fenêtre `activite` |

## Points d'attention

- **Anti-triche :** le compte existant est marqué « flagged » plusieurs fois depuis 00:37, déjà avec l'ancien code. Les détections sont `period_clicks` 1699 et `inferred_cps` 56 à 268. C'est probablement un faux positif (cumul de clics) : à examiner dans #10 si ta recette le confirme. Aucune sanction n'est appliquée au-delà du marquage.
- **Test instable :** `test/rate-limit.test.js` « connexion : 429 » échoue environ 1 fois sur 3 (fenêtre d'une minute). À corriger dans #17.

## Suite de la nuit (DIGORCH, une session à la fois)

Ordre : #17 (tests et CI, en cours), #18, #25, puis les autres selon leur impact sur le lancement. Chaque ticket livré est déployé s'il passe les contrôles ; sa ligne est ajoutée ci-dessous.

<!-- Les sessions ajoutent ici leur ligne : | #N titre | MVP | SHA déployé ou raison | test en jeu | -->

## Reste avant le MVP public (estimation à 00:55)

- **Bloquant :**
  - ta recette des 8 tickets déployés ;
  - #17 (CI, pour fiabiliser les déploiements suivants) ;
  - #25 (anti-bot global) ;
  - examen du faux positif anti-triche (#10).
- **Recommandé :**
  - #18 (cohérence des sauvegardes) ;
  - #21 (PWA, ergonomie mobile).
- **Après lancement :**
  - #13 (copie S3) ;
  - #19 (ligues) ;
  - #20 (paramètres économiques) ;
  - #22 (icônes) ;
  - #23 (console) ;
  - #24 (nettoyage).
