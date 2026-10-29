# DIGORCH — plafond de 30 sessions, `digorch status` détaillé, console d'activité

- **Date :** 29-30/10/2026
- **Périmètre :** DIGORCH uniquement (`/opt/dig-orch`, `dig-orch*.service`). Aucune modification du jeu Dig, de sa base, de LQORCH ni de JCORCH.

## 1. Plafond quotidien : 6 → 30 sessions

- **Source de vérité :** `LQ_MAX_SESSIONS_PER_DAY=30` dans `/opt/dig-orch/instance.env`, chargé par `dig-orch.service` (`EnvironmentFile`). Aucune surcharge `digorch config set` n'existe, ni avant ni après.
- **Application :** `dig-orch` a été redémarré seul, à 23:53:57, alors qu'aucune session Claude n'était en cours (le service ne contenait que le superviseur). La nouvelle valeur a été relue après ce redémarrage : `digorch config` affiche « 30 (env LQ_MAX_SESSIONS_PER_DAY) ».
- **Compteur conservé :** les 6 sessions du 29/10 étaient toujours comptées après le redémarrage (6/30). Le compteur est calculé à partir de la table `sessions`, qui n'a pas été modifiée.
- **Reprise automatique confirmée :** une session a démarré seule à 23:53:58 sur #14 (7/30). L'ancien plafond était donc la seule cause de l'arrêt.
- **Garde-fous conservés :**
  - seuils de quota Claude : 90 % sur 5 h, 80 % sur 7 jours ;
  - disjoncteur après 4 sessions consécutives sans rapport ;
  - 3 tentatives par ticket ;
  - 60 s au moins entre deux sessions ;
  - 2 h au plus par session ;
  - coupure après 75 min sans sortie.

  Les quotas Anthropic et Claude Code ne sont pas modifiés.

## 2. `digorch status`

Rapport réécrit, avec un calcul d'état commun à `status` et `pulse` (`observe()`). Il compte six rubriques :

- **Services :** `dig`, `dig-orch`, `dig-orch-console`, `dig-backup.timer` (prochain et dernier déclenchement, résultat de la dernière sauvegarde) et session tmux.
- **Session Claude :** processus, dernière sortie, action en cours lue dans le journal, détection de blocage.
- **Activité :** état (ACTIF, AU REPOS, LIMITÉ, BLOQUÉ ou EN ERREUR) et sa raison ; dernier ticket terminé ; dernière activité réelle ; durée d'inactivité ; sessions terminées aujourd'hui.
- **Quotas :** X/30, sessions restantes, réinitialisation (heure locale, décalage UTC et heure UTC), alerte à 80 %, coût théorique, garde-fous, quota Claude (dernière lecture réelle, ou « indisponible »), prochaine reprise.
- **Tickets :** ticket en cours et priorité, tickets terminés aujourd'hui, tickets en attente de validation, tickets bloqués avec raison et questions, prochain ticket (estimé sur l'état local, sans appel GitHub).
- **E-mails et santé :**
  - e-mails : rapports envoyés, en attente, dernière erreur SMTP ;
  - santé : journal système sur 24 h, sessions en échec, disjoncteur, dernière exécution réussie, session figée.

**Lecture seule :**
- SQLite est ouvert en `mode=ro` : ni création de schéma, ni migration, ni écriture. La commande fonctionne même sur une base non inscriptible.
- `systemctl` et `tmux` ne servent qu'à consulter (`show` et `has-session`). Aucun appel GitHub.
- Vérification sur une copie isolée de la base : contenu identique avant et après. Sur la base réelle, trois `status` et trois `pulse` n'ont créé ni événement, ni notification, ni session.

## 3. Console : `digorch pulse` toutes les 5 minutes

- **Fenêtre tmux :** `activite`, affichée par défaut (`tmux attach -t digorch`). Elle exécute `/opt/dig-orch/console-pulse.sh`, qui lance `digorch pulse` à chaque multiple de 5 minutes de l'horloge.
- **Contenu (2 ou 3 lignes) :** heure, état, ticket en cours ou prochain ticket, sessions X/30 (avec alerte à 80 %). Ensuite, soit l'action actuelle de Claude et le temps écoulé depuis sa dernière activité réelle, soit la raison de l'inactivité (repos normal, attente de quota, session bloquée, erreur ou attente de validation).
- **Service actif ≠ session qui progresse :** au-delà de 15 min sans sortie, « SANS ACTIVITÉ » et un avertissement s'affichent. Le « blocage confirmé » est réservé aux cas suivants :
  - processus disparu ;
  - superviseur absent ;
  - dépassement des seuils de coupure.

  Aucun redémarrage automatique.
- **Sans effet externe :** ni e-mail, ni commentaire GitHub, ni session Claude.
- **Persistance :** les fenêtres sont dans `dig-orch-console.service` (unité activée). Trois redémarrages de la console ont été testés ; la session Claude en cours (pid 650669, dans `dig-orch.service`) n'a pas été touchée.
- **Taille :** la console fait 200 colonnes même sans terminal attaché, puis prend la taille du terminal qui s'y connecte.

**Cas testés sur une copie isolée de la base :**
- session silencieuse depuis 20 min : avertissement ;
- silence au-delà de 75 min : blocage confirmé ;
- processus disparu : blocage confirmé ;
- file vide avec des validations en attente : BLOQUÉ, « attente de validation » ;
- plafond atteint : LIMITÉ, « attente de quota », avec l'heure de reprise.

## 4. Problèmes rencontrés

- **Fenêtre tmux à 65 colonnes :** sans terminal attaché, la console prenait la taille d'un autre client du serveur tmux. La solution : `default-size 200x50`, `window-size largest` et un redimensionnement sans verrou.
- **Code du superviseur :** il tourne encore sur la version précédente. `digorch reload` est demandé et sera appliqué à la fin de la session en cours, sans la couper. Le nouveau code ne change que l'affichage (`status` et `pulse`).

## 5. Rollback

- Sauvegarde : `~/backups/dig-orch/config-20261029-235350/` (`lqorch.py`, `instance.env`, `README.md`, `dig-orch-console.service`).
- Restaurer ces fichiers, lancer `sudo systemctl daemon-reload`, puis `digorch reload` (sans couper de session) et `sudo systemctl restart dig-orch-console`.

## 6. Directive du 30/10 : déploiement continu (mise à jour)

- **`/opt/dig-orch/session_prompt.md`** est réécrit selon la directive du propriétaire. Le cycle d'un ticket devient : développer → tester → sauvegarder → déployer → vérifier → test proposé → recette.
- **Procédure de déploiement imposée aux sessions :**
  1. release au SHA exact, avec `npm ci` et `npm test` ;
  2. migration essayée sur une copie de la base en mode production, avec comparaison d'empreintes ;
  3. avance rapide de `main` ;
  4. `scripts/deploy.sh` de la release ;
  5. vérifications ;
  6. retour arrière sans jamais restaurer la base.
- **Interdits maintenus :**
  - suppression ou réinitialisation de données ;
  - migration irréversible ;
  - AWS ;
  - dépense externe significative ;
  - règle métier majeure non validée ;
  - autres projets.
- **#22 :** génération autorisée dans le plafond local, au plus 3 propositions par matériau, avec la pierre C en référence. `legacy` reste par défaut.
- **Rapport de nuit :** `~/.local/state/dig-orch/reports/rapport-de-nuit.md`, tenu à jour par chaque session et envoyé par e-mail à 07:00 (timer transitoire `dig-rapport-de-nuit`).
- **`digorch pulse`** affiche maintenant 3 lignes :
  1. état, ticket, sessions X/30 et quota Claude (5 h et 7 jours) ;
  2. dernière action de Claude ou raison de l'inactivité ;
  3. version servie en production, commits de `develop` non déployés, tickets bloqués, et l'avertissement au-delà de 15 min sans activité.
