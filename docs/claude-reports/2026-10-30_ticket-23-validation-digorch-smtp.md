# Ticket #23 — [P2] T-16 — Valider DIGORCH et SMTP sans doublons

Lien : https://github.com/ReC82/Dig/issues/23

## 1. État réel

**Validation technique faite, en attente de la validation du propriétaire.** Ce ticket n'a modifié
aucun code de Dig : rien à déployer. Le jeu reste en production sur `e32398d`. Ce ticket ajoute
seulement ce rapport et un script de contrôle.

Classement : **Après lancement.** DIGORCH fonctionne et ne bloque pas le MVP public.

## 2. Résultat

Contrôles faits le 30/10/2026 entre 02:44 et 03:00 (heure de Bruxelles), en lecture seule sur
l'installation réelle. Le code en service est `c558e1a9beeb` ; l'empreinte de
`/opt/dig-orch/lqorch.py` est la même.

| Point du ticket | Preuve | Résultat |
|---|---|---|
| Service | `dig-orch.service` active/running depuis le 29/10 23:53:57, activé au démarrage, `NRestarts=0`. `dig-orch-console.service` actif. Aucun avertissement dans `journalctl -u dig-orch -p warning` sur 6 h. | ✅ |
| Une seule session à la fois | 21 sessions enregistrées, **0 chevauchement** (requête croisée sur `sessions`). Disjoncteur : `consecutive_failures=0`. | ✅ |
| Reprise après redémarrage | Réel : 5 redémarrages ou rechargements du superviseur (22:53Z, 23:04Z, 23:13Z, 00:35Z…), état conservé à chaque fois, file reprise. **Aucun n'a eu lieu pendant une session** : le cas « session interrompue » a donc été testé hors ligne (voir plus bas) : la session orpheline est notée `INTERRUPTED` et son ticket repasse **en premier**, même devant un P0. | ✅ (cas interrompu : hors ligne seulement) |
| Synchronisation GitHub | Les 18 tickets ouverts sur GitHub sont tous dans la file locale, avec le statut qui correspond à leur label (`en attente de validation` ↔ `WAITING_OWNER`, `bloqué` ↔ `BLOCKED`, `en cours` ↔ `RUNNING`, `à faire` ↔ `READY`). #6 fermé sur GitHub → retiré de la file (événement 23:30Z). 8 réponses du propriétaire détectées, chacune a relancé son ticket. Le commentaire `<!-- digorch -->` publié sur #23 n'a pas été pris pour une réponse. | ✅ |
| Worktrees | Seulement `develop`, `ticket-22` (en attente de recette), `ticket-25` (bloqué) et `ticket-23`. `/home/ubuntu/Dig` est propre sur `main`. | ✅ |
| Notifications SMTP | 23 e-mails en file, **23 envoyés, 0 en attente, 0 erreur**. Chacun envoyé 2 à 4 s après sa mise en file, avec le bon rapport joint. Configuration SMTP « présente et complète » (aucune valeur lue ni affichée). | ✅ |
| Déduplication des envois | Le seul doublon réel est celui du 29/10 21:52 (#6), déjà connu : il date d'avant la correction. Depuis : 22 lignes et 22 envois. Les paires qui se ressemblent (#13 « Livré » à 21:17Z et 23:43Z, #22 « validation » à 22:00Z et 22:47Z) sont des messages **différents** : autre contenu, autre rapport ou autre étape. La clé est `ticket:type:empreinte(SHA livré ou questions)` en `INSERT OR IGNORE`, et l'envoi est réservé de façon atomique. | ✅ |
| Non-déploiement automatique | Le superviseur ne déploie jamais lui-même : `lqorch.py` ne contient ni `deploy.sh`, ni `git push`, ni `systemctl restart` (ses seuls appels `systemctl` sont des `show` en lecture). Les déploiements sont faits par les sessions, selon la politique du 30/10 (`scripts/deploy.sh` avec sauvegarde et retour arrière). | ✅ (politique du 30/10) |
| Isolation des autres projets | `lodyquests-orch`, `jury-central-orch`, `jury-central`, LodyQuests portail/discord : tous actifs. Aucun fichier de `/opt/jury-central-orch` n'a changé depuis le 21/10. Les fichiers de `/opt/lodyquests-orch` datent du 29/10 21:00, soit **avant** le premier démarrage de DIGORCH (21:51) : ils ont été modifiés par LQORCH lui-même. Les bases d'état des autres orchestrateurs ne sont ouvertes qu'en lecture (`mode=ro`), pour le quota partagé. | ✅ |
| Console automatique toutes les 5 min (commentaire du propriétaire du 29/10) | Fenêtre tmux `digorch:activite` : **34 points consécutifs** de 00:00 à 02:45, tous exactement à 5 min d'intervalle, sans doublon ni trou. Chaque point donne le ticket, la dernière activité réelle, les sessions X/30, le quota, la production et `develop`. Aucune alerte « ⚠ >15 min » : il n'y a pas eu d'inactivité. | ✅ |

### Tests hors ligne de la déduplication et de la reprise (8/8 OK)

Script : `docs/claude-reports/ticket-23/test_digorch_dedup.py`. Il travaille sur une **copie** de
`lqorch.py` dans `/tmp`, avec un état temporaire et un envoi SMTP simulé : aucun e-mail réel
n'est envoyé et l'installation réelle n'est pas touchée.

```
OK   clé unique : 1 ligne(s)
OK   même état mis en file 3 fois -> 1 envoi
OK   4 vidages concurrents -> 1 envoi
OK   échec -> réessai différé, erreur sans détail
OK   pas de renvoi avant le délai
OK   après le délai : 1 seul envoi
OK   session orpheline notée INTERRUPTED
OK   ticket interrompu repris en premier (devant un P0 READY)
```

## 3. Anomalies trouvées (non corrigées : `/opt/dig-orch` est hors du périmètre des sessions)

1. **Texte d'état des e-mails dépassé.** Depuis la politique du 30/10, les tickets sont déployés,
   mais `LQ_WAITING_TEXT` (dans `/opt/dig-orch/instance.env`) vaut encore « intégré dans develop,
   en attente de validation (non déployé) ». Exemple : l'e-mail #21 dit « (non déployé) » alors
   que son résumé dit « déployés en production (e32398d) ». C'est trompeur. Proposition :
   `LQ_WAITING_TEXT="en attente de recette (voir le résumé : déployé ou non)"`, puis `digorch reload`.
   **Après lancement.**
2. **Synchronisation et e-mails seulement entre deux sessions.** La boucle est séquentielle. Une
   session peut durer jusqu'à 2 h : pendant ce temps, un commentaire du propriétaire n'est pas lu
   et un e-mail en échec n'est pas réessayé. C'est sans doublon et sans perte, seulement retardé.
   **Après lancement.**
3. **Risque de doublon résiduel (rare).** Si le superviseur s'arrête brutalement entre
   l'acceptation SMTP et l'écriture de `sent_at`, l'e-mail repart après la réservation de 10 min.
   Ce cas ne s'est jamais produit. **Après lancement.**
4. **La protection de la production repose sur les consignes**, comme déjà écrit dans le rapport
   d'installation : `--dangerously-skip-permissions` et `sudo` sans mot de passe. **Après
   lancement.**

## 4. SHA, branche, procédure de test

- Branche : `docs/23-validation-digorch-smtp` (rapport + script, aucun code de Dig).
- SHA sur `develop` : voir le commentaire du ticket (fusion du rapport).
- Refaire les contrôles :
  ```
  digorch status ; digorch notifications
  sqlite3 -readonly ~/.local/state/dig-orch/state.db \
    "select issue,subject,count(*) from notifications group by 1,2 having count(*)>1"
  tmux attach -t digorch          # fenêtre « activite », Ctrl-b d pour quitter
  mkdir -p /tmp/t23/state && cp /opt/dig-orch/lqorch.py /tmp/t23/lqorch_copy.py \
    && python3 -I docs/claude-reports/ticket-23/test_digorch_dedup.py ; rm -rf /tmp/t23
  ```

## 5. Vérifications non faites, limites, données des joueurs

- Pas de redémarrage réel de `dig-orch` pendant une session : il aurait arrêté cette session.
  Le cas a été couvert hors ligne.
- Pas d'envoi SMTP de test : un envoi réel aurait été un e-mail en plus pour le propriétaire.
  Les preuves viennent des 23 envois réels de la nuit.
- Aucun accès à `smtp.env` ni à aucun secret. Aucune donnée joueur lue ni modifiée. Aucune
  écriture dans `/home/ubuntu/Dig` ni dans `/opt/*`.

## 6. Déploiement

**Aucun.** Ce ticket ne change pas le code du jeu. Un commit de rapport seul ne justifie pas un
déploiement. Production : `e32398d`.

**Test à faire par le propriétaire (2 min) :**
1. Dans la boîte mail, regarder les messages `[Dig]` de la nuit. Attendu : **un seul** e-mail par
   ticket et par étape, avec le rapport joint. Deux messages pour #13 ou #22 sont normaux : ce
   sont deux étapes différentes.
2. `tmux attach -t digorch`, fenêtre `activite` : un point toutes les 5 min. Quitter avec
   Ctrl-b d.
3. Si c'est conforme, fermer #23. Sinon, indiquer dans le ticket l'e-mail en double (heure et
   sujet).

## 7. Choix techniques faits seul

- Validation en lecture seule plutôt que par redémarrage ou envoi réel : cela ne gêne ni la
  session en cours ni la boîte mail.
- Test hors ligne sur une copie identique (même empreinte) du code en service : il prouve le
  code réellement en service sans y toucher.

## 8. Décisions demandées au propriétaire

1. Corriger le texte d'état des e-mails (anomalie 1) ? Options : (a) le superviseur ou le
   propriétaire modifie `LQ_WAITING_TEXT` dans `/opt/dig-orch/instance.env` ; (b) ne rien
   changer. **Recommandation : (a)**, une ligne puis `digorch reload`. Cela ne bloque pas le
   lancement.

## 9. Restant à réaliser

- Anomalies 1 à 3, toutes « Après lancement », à traiter dans l'outil DIGORCH, hors du dépôt Dig.
- Clôture de #23 par le propriétaire.
