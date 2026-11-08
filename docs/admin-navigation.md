# Plan de navigation du panel admin

Source unique : les registres `ADM_NAV_GROUPS`, `ADM_NAV` (rubriques et sous-rubriques) et `ADM_NAV_ACTIONS`
(actions courantes) dans `public/admin/admin.js`. Le menu, la recherche du menu et le plan intégré au panel
(bouton **🧭 Plan & actions courantes**) sont construits depuis ces registres. Ce document en est le reflet :
`test/admin-nav.test.js` échoue si une rubrique, une sous-rubrique ou une action du registre n'y figure pas.

**Règle :** un lien du menu, du plan ou de la recherche ne fait qu'amener au bon endroit (rubrique, section dépliée,
curseur placé). Il ne clique sur rien : aucune publication, aucun enregistrement, aucune réinitialisation. L'action
elle-même reste un bouton avec sa confirmation.

Liens directs (à ajouter après `/admin/`) : `#<rubrique>` (ex. `#players`), `#<rubrique>/<sous-rubrique>`
(ex. `#economy/ledger`), `#a/<action>` (ex. `#a/reset-test`).

## Actions courantes

| Action | Où | Lien direct |
|---|---|---|
| Trouver un joueur (ouvrir sa fiche) | Joueurs & testeurs › Joueurs › recherche du pseudo (en tête de page) | `#a/find-player` |
| Recommencer un test à zéro (joueur) | Joueurs › fiche du joueur › 🧪 Essais de test › « Recommencer un test à zéro » | `#a/reset-test` |
| Exporter l'historique des essais d'un joueur | Joueurs › fiche du joueur › 🧪 Essais de test › Exporter CSV / JSON | `#a/export-tests` |
| Réinitialisation saisonnière partielle (joueur) | Joueurs › fiche du joueur › ⚠ Réinitialisation saisonnière partielle (repliée) | `#a/partial-reset` |
| Tester la protection anti-bot sur un compte | Joueurs & testeurs › Anti-bot › Tester la protection (parcours en 5 étapes) | `#a/sec-test` |
| Voir l'anti-bot d'un joueur | Joueurs & testeurs › Anti-bot › Joueurs à surveiller › Ouvrir la fiche d'un joueur (ou bouton 🛡 de la fiche Joueurs) | `#a/player-antibot` |
| Consulter le journal de sécurité | Joueurs & testeurs › Anti-bot › Diagnostic et historique › Journal des anomalies joueurs | `#a/sec-journal` |
| Préparer une invitation bêta | Joueurs & testeurs › Bêta fermée › « ➕ Inviter un testeur » | `#a/invite` |
| Lire les retours des testeurs | Joueurs & testeurs › Bêta fermée › Retours | `#a/beta-feedback` |
| Révoquer ou archiver un lien, retirer un testeur | Joueurs & testeurs › Bêta fermée › 🗂️ Gérer les invitations et testeurs | `#a/beta-manage` |
| Archiver un retour de test traité | Joueurs & testeurs › Bêta fermée › Retours › 🗄️ Archiver | `#a/beta-archive` |
| Modifier les gains (multiplicateurs) | Jeu & progression › Économie › Gains (prix des coffres en lecture) | `#a/gains` |
| Changer le prix des coffres | Jeu & progression › Coffres & drops (fiche du coffre, brouillon puis publication, #88) | `#a/chest-costs` |
| Vérifier le registre de gemmes | Jeu & progression › Économie › Registre de gemmes | `#a/gem-ledger` |
| Changer la date de fin de la saison | Saisons & compétition › Saison en cours › Date de fin de la saison active | `#a/season-end` |
| Clore la saison (zone critique) | Saisons & compétition › Saison en cours › Zone critique | `#a/season-close` |
| Ajuster les points de récompense d'un joueur | Saisons & compétition › Points de récompense › Ajustement manuel | `#a/points-adjust` |
| Gagnants du concours et remise des lots | Saisons & compétition › Concours › Gagnants et remise des lots | `#a/contest-winners` |
| Traiter les commandes de cadeaux | Saisons & compétition › Boutique de cadeaux › Commandes | `#a/shop-orders` |
| Suspendre une amélioration en urgence | Jeu & progression › Améliorations › 🚨 Suspension d'urgence | `#a/upgrade-suspend` |
| Rédiger une actualité | Contenu & événements › Actualités › « ＋ Ajouter » | `#a/news-add` |
| Préparer un événement | Contenu & événements › Événements › « ＋ Nouvel événement » | `#a/event-add` |
| Tester le passage au mois suivant | Contenu & événements › Événements › Préparation du mois prochain › « 🧪 Tester le passage au mois suivant » | `#a/event-transition` |
| Ajouter un bloc | Jeu & progression › Blocs › « ＋ Ajouter un bloc » | `#a/block-add` |
| Ajouter une mission quotidienne | Jeu & progression › Missions quotidiennes › « ＋ Ajouter une mission » | `#a/mission-add` |
| Voir les dépenses IA (budget) | Exploitation & paramètres › Configuration › 🤖 Budget IA | `#a/ai-budget` |
| Régler le mode anti-bot | Exploitation & paramètres › Configuration › 🛡 Protections (anti-triche) | `#a/antibot-mode` |

## Toutes les rubriques

- **👥 Joueurs & testeurs**
  - 👤 Joueurs (`#players`) — recherche du pseudo, fiche : progression, 🧪 essais de test, réinitialisation partielle, 🛡 anti-bot du joueur
  - 🛡 Anti-bot (`#security`)
  - 🧪 Bêta fermée (`#beta`)
- **⛏ Jeu & progression**
  - 🧱 Blocs (`#blocks`)
  - 🎲 Coffres & drops (`#rewards`)
  - ⬆ Améliorations (`#upgrades`)
  - 🔋 Pioche à charges (`#pickaxe`)
  - 🔮 Reliques (`#relics`)
  - 🎯 Missions quotidiennes (`#missions`)
  - 💰 Économie (`#economy`)
    - Gains (prix des coffres en lecture) (`#economy/gains`)
    - Registre de gemmes (`#economy/ledger`)
    - Règles économiques (`#economy/rules`)
    - Boutique en gemmes (`#economy/gemshop`)
    - Lot de fragments (€) (`#economy/fragpack`) — offre #85 désactivée : prix, plafonds, journal, activation refusée sans prestataire de paiement
- **🏆 Saisons & compétition**
  - 📊 Saison en cours (`#season-overview`)
  - 🗓 Historique des saisons (`#seasons`, rubrique par défaut)
  - 🏅 Ligues (`#leagues`)
  - 🏆 Classement (`#leaderboard`)
  - ⭐ Points de récompense (`#points`)
  - 🛍 Boutique de cadeaux (`#shop`)
  - 🎁 Concours (`#contest`)
- **📰 Contenu & événements**
  - 📰 Actualités (`#news`)
  - 🎉 Événements (`#events`)
  - ✨ Micro-bonus (brouillons) (`#microbonus`) — #81 : bonus de dégâts fractionnaires préparés en brouillon, jamais actifs en jeu
  - 📿 Collections (`#collections`)
  - 🎖 Badges (`#badges`)
- **🎨 Visuels**
  - 🎨 Atelier d'icônes (`#icons`)
- **🛠 Exploitation & paramètres**
  - 📢 Publicité (`#ads`)
  - ⚙ Configuration (`#config`)

## Ajouter une rubrique ou une action

1. Rubrique : une `<section id="tab-<id>" class="tab-content hidden">` dans `public/admin/index.html` + une ligne dans
   `ADM_NAV`. Sous-rubriques : `subs: [{ id, label, keywords }]` et l'attribut `data-sub="<id>"` sur les blocs de la
   section.
2. Action : une ligne dans `ADM_NAV_ACTIONS` (`tab`, `sub` facultatif, `target` = identifiant d'un élément existant,
   `player: true` si l'endroit est dans la fiche d'un joueur, `help` = aide courte).
3. Mettre ce document à jour (le test le vérifie).
