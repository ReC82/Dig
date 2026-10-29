# DIGORCH — installation de l'orchestration Claude de DIG! (2026-10-29)

## Ce qui est installé

| Élément | Emplacement |
|---|---|
| Superviseur (copie de JCORCH, empreinte d'origine `2270d042fdfc`) | `/opt/dig-orch/lqorch.py` |
| Consignes des sessions | `/opt/dig-orch/session_prompt.md` |
| Configuration (sans secret) | `/opt/dig-orch/instance.env` |
| Commande | `/usr/local/bin/digorch` |
| Service superviseur | `dig-orch.service` (activé au démarrage, `Restart=on-failure`) |
| Console tmux persistante | `dig-orch-console.service` → session tmux `digorch` (fenêtres status / journal / events) |
| État, verrou, journaux, rapports | `~/.local/state/dig-orch/` (`state.db`, `supervisor.lock`, `sessions/`, `reports/`) |
| Worktrees | `/home/ubuntu/dig-worktrees/ticket-<n>` (jamais `/home/ubuntu/Dig`, qui est la production) |
| SMTP | fichier existant de PlugAdmin, lu sur place, jamais copié ; même transport et même destinataire que JCORCH |

Modifications par rapport à JCORCH :
- libellés `digorch` / `DIGORCH` ;
- labels de statut configurables ;
- e-mail aussi pour les tickets terminés et en échec ;
- commande `digorch notify N rapport.md` ;
- réservation atomique des e-mails en file, pour éviter les doublons.

## Fonctionnement

- **Synchronisation GitHub toutes les 10 min.** Tous les tickets ouverts de `ReC82/Dig` sont pris en compte, avec la priorité des labels `P0`…`P3` (P2 par défaut).
- **Une seule session à la fois.** Un verrou `flock` empêche qu'un même ticket soit traité deux fois en parallèle.
- **Reprise après redémarrage.** Une session interrompue est arrêtée, puis son ticket repasse en premier.
- **États** (labels GitHub) :

  | État | Label |
  |---|---|
  | à faire | `statut: à faire` |
  | en cours | `statut: en cours` |
  | bloqué | `statut: bloqué` |
  | en attente de validation | `statut: en attente de validation` |
  | terminé | `statut: terminé` |

  `statut: suspendu` et `statut: abandonné` font ignorer le ticket.
- **Reprise sur réponse.** Un commentaire du propriétaire sur un ticket bloqué ou en attente le relance.
- **E-mail** pour chaque ticket livré, bloqué, terminé ou en échec, avec le rapport Markdown joint. Un envoi échoué est réessayé avec un délai croissant.
- **Garde-fous :**
  - 6 sessions par jour, 2 h par session ;
  - pause si le quota partagé du compte Claude dépasse 90 % sur 5 h ou 80 % sur 7 jours ;
  - disjoncteur après 4 échecs consécutifs.

## Règles de développement imposées aux sessions

- Analyse, code, tests, commit et push autorisés. Intégration directe dans **`develop`** ; Pull Request facultative.
- **Jamais `main`, jamais de déploiement en production.** Le propriétaire installe, jusqu'à ce que les sauvegardes et la restauration (T-06) soient opérationnelles et qu'il autorise explicitement le déploiement automatique. Même alors, jamais de déploiement d'une correction P0 sans confirmation.
- Tests sur un worktree, une base de test et un port ≥ 3100. Jamais `server/data/` de la production ni le port 3000.
- Aucune migration destructive sans sauvegarde vérifiée et accord écrit. Les données des joueurs sont préservées.
- Aucun ticket fermé par l'agent : le propriétaire valide et ferme.
- Rapports dans `docs/claude-reports/`, copiés dans `~/.local/state/dig-orch/reports/` pour être joints à l'e-mail.

## Supervision et redémarrage

```
digorch status                 # état complet (file, bloqués, à valider, quota, e-mails)
digorch queue | sessions | notifications [--retry] | log [ticket]
digorch pause | resume         # ne plus démarrer / reprendre
digorch stop [--now]           # arrêter après la session (ou tout de suite) ; « resume » pour réarmer
digorch sync                   # synchroniser GitHub maintenant
digorch add N | skip N | set N champ valeur
digorch reload                 # relire le code installé entre deux sessions
tmux attach -t digorch         # console (Ctrl-b d pour quitter sans l'arrêter)
journalctl -u dig-orch -f
sudo systemctl restart dig-orch          # redémarrage (session en cours arrêtée puis reprise)
sudo systemctl restart dig-orch-console  # recréer la console tmux
```

## Tests réalisés le 2026-10-29

| Test | Résultat |
|---|---|
| Démarrage du service (en pause), synchronisation GitHub | ✅ #6 découvert en « en attente de validation », P1 |
| Redémarrage du service puis `resume` | ✅ superviseur relancé, état conservé, mode RUNNING |
| Second superviseur lancé à la main | ✅ refusé (« Un autre superviseur tourne déjà ») |
| `digorch reload` | ✅ code rechargé sans interruption |
| Accès GitHub (`gh`, droit push sur ReC82/Dig) | ✅ |
| Envoi SMTP réel du rapport d'audit #6 (pièce jointe) | ✅ accepté par le serveur SMTP à 21:52:21 (heure de Bruxelles). Un **doublon** est parti à 21:52:24 (course entre la commande et la boucle), corrigé par la réservation atomique et vérifié par un test (3 envois simultanés → 1 seul envoi) |
| Autres projets (LQORCH, JCORCH, sites) | ✅ services actifs, aucun fichier modifié |

## Points ouverts

- **Aucun ticket à traiter pour l'instant.** Le #6 est en attente de validation et les tickets T-01…T-17 de l'audit ne sont pas encore créés sur GitHub.
- **La protection de la production repose sur le prompt.** Les sessions tournent avec `--dangerously-skip-permissions`, sous un utilisateur qui a `sudo` sans mot de passe.
