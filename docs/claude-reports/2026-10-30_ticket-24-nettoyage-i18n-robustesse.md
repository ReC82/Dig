# Ticket #24 — [P3] T-17 — Nettoyage, i18n et robustesse

- Ticket : https://github.com/ReC82/Dig/issues/24
- Source : audit général #6 (`docs/claude-reports/2026-10-29-2130-audit-general-dig.md`, B11 et risques P3)
- Branche : `fix/24-nettoyage-i18n-robustesse` (commit `a0a9a69`)
- Date : 30/10/2026

## 1. État réel

**Déployé en production (SHA `232c0b9`) le 30/10/2026 à 03:02 — en attente de recette.**
Classement : **Après lancement** (aucun point bloquant ; améliore la finition et la stabilité du MVP).

## 2. Réconciliation

Plusieurs points de l'audit avaient déjà été livrés par d'autres tickets et n'ont pas été refaits :

| Point de l'audit | Déjà livré par |
|---|---|
| Comparaison de la clé admin en temps constant | #12 (`security.isValidBearer`, `crypto.timingSafeEqual`) |
| En-tête `X-Powered-By` | #12 (`app.disable('x-powered-by')`) |
| Énumération des comptes (409 distincts) | #14 (message identique) |
| Synchro du classement côté serveur silencieuse | déjà journalisée (`[POST /api/me/save] sync saisonnier`) |
| Points « saisons » de B11 (nom au seed, `end_at` en `Z`, deux saisons actives, fichiers `-wal`) | #16 (rotation des saisons, index « une seule saison active ») |

## 3. Changements réalisés

| Point | Avant | Après | Fichiers |
|---|---|---|---|
| Pagination `NaN` | `?page=abc` → `NaN` → **erreur 500** sur les classements ; `?limit=xyz` idem dans l'admin | Valeur par défaut (page 1, limit 100, offset 0), bornes appliquées. ID de saison invalide côté admin → 400 | `server/validation.js` (`intParam`), `server/index.js` |
| Piles d'erreur « br » dans journald | Un corps compressé en Brotli (robots) ou un JSON invalide écrivait ~12 lignes de pile, 1 fois par jour environ | Gestionnaire d'erreurs Express : réponse JSON 4xx (`415`, `400`, `413`) et **une seule ligne** `[http] 415 POST /api/login — encoding.unsupported: …` | `server/index.js` |
| `uncaughtException` avalée | Le processus continuait dans un état incertain | Journalisée puis arrêt (`exit 1`) ; systemd (`Restart=always`, 10 s) relance un processus sain. Aucune occurrence dans le journal depuis le 30/09 | `server/index.js` |
| `catch` silencieux | 8 routes admin renvoyaient 500 sans rien journaliser ; la synchro saison et le classement côté client avalaient leurs erreurs | Erreur journalisée avec le nom de la route ; `console.warn` côté navigateur | `server/index.js`, `public/js/main.js` |
| Mission quotidienne « profondeur » négative | Après un reset de saison (profondeur → 1), la progression devenait négative (ex. −99/20) | Jamais négative ; au reset de saison, la progression **déjà acquise dans la journée est conservée** | `public/js/dailyMissions.js` (`rebase`), `public/js/main.js` |
| Chaînes non traduites | Coffres de saison en français en EN/NL ; « Aucun joueur actif pour l'instant. » ; nom de la barre de navigation (lecteur d'écran) ; bannière de mise à jour ; texte de la publicité simulée | Traduits FR/EN/NL (`shop_chest.*`, `season.empty`, `nav.main_aria`, `ui.ad_mock_sub`, bannière branchée sur `ui.update_*`) | `public/js/i18n.js`, `public/index.html`, `public/js/main.js` |
| README | Décrivait l'ancienne API `/api/players/:token` et 3 tables | Routes actuelles, variables d'environnement, structure, 13 tables | `README.md` |

**Visible en jeu :** en anglais ou néerlandais, les coffres de la boutique de saison sont traduits ; la mission « Descendre de N m » n'affiche plus de valeur négative après un changement de saison.

## 4. SHA et procédure de test

- `develop` : `232c0b9` (fusion de `a0a9a69`) — ce rapport est ajouté ensuite sur `develop` sans redéploiement.
- Tests automatisés : `npm test` → **129/129** (dont 6 nouveaux dans `test/robustness.test.js`).
  Les deux tests serveur échouent sur l'ancien code (500 au lieu de 200 ; processus non arrêté), ce qui prouve qu'ils détectent les défauts.
- Reproduction manuelle :
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' 'https://dig.lodygames.com/api/seasons/active/leaderboard?page=abc'   # 200 (avant : 500)
  ```

## 5. Vérifications effectuées

- `npm run check` (syntaxe), `npm test` 129/129 sur la branche, sur `develop` fusionné et sur le SHA exact de la release.
- Navigateur headless sur serveur de test (port 3101, base de test supprimée ensuite) : EN, smartphone 390×844, aucune erreur console.
- Copie de la base de production démarrée en mode production (port 3122) : `/health` et `/api/version` OK, `?page=abc` → 200, corps `br` → 415 avec une ligne de journal ; **empreintes identiques** avant et après démarrage (users, user_saves, season_rankings, seasons, leagues, player_click_tracking). Copie supprimée.
- **Impact sur les données joueurs : aucun.** Aucune migration de schéma ; aucune donnée modifiée.

Non vérifié : comportement réel sur un iPhone/Android physique (seulement l'émulation), et le reset de saison réel (simulé dans le test unitaire ; prochain reset le 02/11).

## 6. Déploiement

- SHA déployé : **`232c0b9`** (avance rapide de `main` depuis `e32398d`).
- Sauvegarde pré-déploiement vérifiée : `~/backups/dig/dig-20261030-030256-pre-deploy-232c0b9.sqlite`.
- Après déploiement : `dig.lodygames.com` et `dig.lodylands.com` → 200, `/api/version` = `1.0.0+232c0b9` ; journal sans erreur ; `pragma quick_check` = ok ; empreintes de la base de production **identiques** à la sauvegarde pré-déploiement ; essai navigateur en production : smartphone 390×844 en anglais et ordinateur 1280×900 en néerlandais, aucune erreur console.
- Retour arrière : `git -C /home/ubuntu/Dig reset --keep e32398d && sudo systemctl restart dig` (pas de changement de dépendances, aucune migration).

### Test fonctionnel à faire par le propriétaire

1. Ouvrir https://dig.lodylands.com, ⚙ Paramètres → langue **English**.
2. Onglet **Upgrades** → section « 🏪 Season Shop » : les trois coffres s'appellent *Simple chest*, *Rare chest*, *Antique chest*, avec une description en anglais. Même essai en **Nederlands** : *Eenvoudige kist*, *Zeldzame kist*, *Antieke kist*.
3. Onglet **Daily** : les missions affichent une progression ≥ 0 (jamais « -… »).
   Après le changement de saison du lundi 02/11, si la mission « profondeur » était commencée, sa progression du jour est conservée.
4. Revenir en **Français** : tout est comme avant.

Résultat attendu : aucun texte français dans ces écrans en anglais ou néerlandais, aucun nombre négatif dans les missions.

## 7. Choix techniques faits seul

- **Arrêt sur `uncaughtException`** plutôt que poursuite : recommandation de Node.js (l'état du processus n'est plus fiable). systemd relance en 10 s ; SQLite en WAL garantit la base. `unhandledRejection` reste seulement journalisée (moins grave, évite des redémarrages inutiles).
- **Paramètre invalide → valeur par défaut** (et non 400) : un lien `?page=abc` affiche la première page au lieu d'une erreur ; plafond `1e9` pour éviter un `OFFSET` hors limites.
- **Message générique** (« Requête invalide. ») pour les corps illisibles : ne divulgue pas de détail interne ; le détail reste dans le journal sur une ligne.
- **Mission profondeur** : la référence est recalculée au reset de saison pour conserver la progression déjà faite, plus un plancher à 0 pour les autres baisses (save cloud, reset admin).
- Les traductions anglaises et néerlandaises des coffres sont des propositions (relecture bienvenue).

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Restes et suggestions (non implémentés, hors périmètre)

- **Après lancement** — Le nom des saisons vient du serveur en français (« Saison 44-2026 ») et s'affiche tel quel en EN/NL (« Season — Saison 44-2026 »). Suggestion : afficher le numéro et traduire le libellé côté client.
- **Après lancement** — Le journal de production contient environ 3 000 lignes `[seasons] recordAutoBreaks …` par jour pour un seul joueur : à réduire (niveau debug) avant d'avoir beaucoup de joueurs.
- **Après lancement** — Le texte de marque de la publicité simulée « DIG! — Edition Pro » n'est pas traduit (nom de produit).
