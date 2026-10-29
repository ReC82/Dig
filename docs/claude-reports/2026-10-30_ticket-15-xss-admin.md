# Ticket #15 — [P1] T-08 — Corriger la XSS stockée dans le panel admin

- Ticket : https://github.com/ReC82/Dig/issues/15
- Source : audit général #6, bug B6 (`docs/claude-reports/2026-10-29-2130-audit-general-dig.md`)
- Session du 30 octobre 2026

## 1. État réel

**Intégré dans develop — en attente de validation et de déploiement.** Rien n'est déployé : `main` et la production n'ont pas bougé.

## 2. Résultat

Avant la correction, une donnée piégée (e-mail, nom de saison, nom ou icône de ligue, pseudo hérité) s'exécutait comme du JavaScript dans le panel admin. Ce script pouvait lire la clé admin gardée en mémoire par la page. Le même problème existait dans le classement public du jeu. Ces données s'affichent maintenant comme du texte brut, et l'API refuse les e-mails piégés.

### Changements

| Fichier | Changement |
|---|---|
| `public/admin/admin.js` | Plus aucune donnée de l'API ne passe par `innerHTML`. Les tableaux (saisons, ligues, classement, vue d'ensemble, classement par ligue, recherche de joueurs), la config, les paramètres de saison, les badges de statut et le message de clôture sont construits avec `textContent` et des propriétés DOM. Les attributs `onclick="…(${…})"` sont remplacés par `addEventListener`. Le filtre `action` du journal anti-triche est encodé dans l'URL. Ajout des utilitaires `addCell`, `addButtonCell` et `statusBadge`. |
| `public/js/main.js` | `escapeHtml()` sur les données serveur de la vue Saison : nom de saison, nom et icône de ligue, pseudo, rang, profondeur et blocs du classement, pseudo connecté. |
| `public/js/escapeHtml.js` (nouveau) | Échappe `& < > " ' \``. Chargé avant `main.js` dans `public/index.html` et exporté pour les tests Node. |
| `server/validation.js` (nouveau) | `isValidEmail` plus strict : caractères « atom » de la RFC 5322, 254 caractères au total et 64 pour la partie locale au maximum, domaine en libellés alphanumériques, extension alphabétique d'au moins 2 lettres. Refuse les espaces, `< > " \`, les caractères de contrôle et les points en tête ou doublés. |
| `server/index.js` | Utilise `isValidEmail` de `server/validation.js` (l'ancienne regex `^[^\s@]+@[^\s@]+\.[^\s@]+$` est supprimée). |
| `test/xss.test.js` (nouveau) | 6 tests, détaillés en section 4. |

Ce qui change pour l'utilisateur : rien pour des données normales. Un e-mail comme `a@b.c<img…>` reçoit à l'inscription « Adresse e-mail invalide. ».

## 3. Références

- **SHA sur `develop` : `16e86d9b0e2b7652ee789e01252fd559b944c132`** (fusion `--no-ff`), commit du correctif `3dceb06`.
- Branche : `fix/15-xss-admin`.

## 4. Procédure de test

### Tests automatisés

```bash
npm ci
npm test                         # 78/78 dont les 6 de test/xss.test.js
node --test test/xss.test.js     # le ticket seul (port 3115, base temporaire dans /tmp)
```

`test/xss.test.js` vérifie :
1. `escapeHtml` neutralise les caractères dangereux, y compris `null`, `undefined` et les nombres.
2. `isValidEmail` accepte des adresses courantes (`+tag`, sous-domaines, `o'brien@…`).
3. `isValidEmail` refuse 30 adresses piégées ou malformées.
4. Inspection statique de `admin.js` : chaque `innerHTML =` reçoit une chaîne littérale statique. Pas d'`onclick` inline, pas d'`insertAdjacentHTML`, `outerHTML` ni `document.write`. Ce test protège aussi contre une régression future.
5. `main.js` n'insère plus de pseudo, de nom de saison ou de ligue sans `escapeHtml`, et `escapeHtml.js` est chargé avant `main.js`.
6. Serveur réel (port 3115, base jetable) : `POST /api/register` avec un e-mail piégé renvoie 400, avec un e-mail normal 200.

### Vérification dans un navigateur (Chromium headless, faite pendant la session)

Scénario : serveur de test `PORT=3101`, `DB_FILE=/tmp/…/test-15.sqlite`, `ADMIN_SECRET` aléatoire de test. Des payloads `<img src=x onerror=…>` sont injectés **directement en base**, ce qui simule des données héritées ou un admin piégé. Emplacements : nom de saison, nom et icône de ligue, pseudo (avec une variante `');…//` pour l'ancien `onclick`), e-mail, journal anti-triche (pseudo et motif), valeur de config. Le parcours ouvre ensuite le panel admin (connexion, tous les onglets, classement par ligue, recherche de joueur, fiche joueur) et la vue Saison du jeu avec un compte légitime.

| Code | Payloads exécutés (admin) | Payloads exécutés (jeu) | `<img>` injectés |
|---|---|---|---|
| `origin/develop` avant fusion | 9 (saison, ligue, icône, pseudo, e-mail) | 3 (saison, icône, pseudo) | 7 |
| `fix/15-xss-admin` | **0** | **0** | **0** |

Avec le correctif, les payloads s'affichent en texte littéral : e-mail dans la recherche, pseudo dans la fiche joueur et le classement du jeu, nom de saison. Le serveur de test a été arrêté et la base de test supprimée.

### Test manuel proposé au propriétaire (après déploiement)

1. Sur le jeu, tenter l'inscription avec l'e-mail `test@example.com<b>x` : le message « Adresse e-mail invalide. » doit s'afficher.
2. Panel admin : vérifier que saisons, ligues, classement, recherche de joueurs, « Voir », « Corriger », « Supprimer » et « Clore » fonctionnent comme avant.

## 5. Vérifications, limites, impact sur les données

- **Données des joueurs : aucun impact.** Pas de migration, pas d'écriture en base. Une copie en lecture seule de la base de production (`.backup` dans `/tmp`, supprimée aussitôt) a été contrôlée avec la nouvelle règle : **0 e-mail existant invalide, 0 contenant des caractères HTML, 0 pseudo non conforme**. Aucun compte ne devient incohérent. Seul le nombre de comptes a été lu, aucune donnée personnelle n'a été conservée.
- La nouvelle règle d'e-mail ne s'applique qu'à l'inscription : la connexion se fait par pseudo et n'est pas concernée.
- Non fait, hors périmètre : les autres `innerHTML` de `main.js` (boutique, améliorations, quotidien, paramètres…) n'affichent que des traductions (`i18n.js`) et des définitions statiques. Ils ne contiennent pas de données saisies par un joueur ou un admin et n'ont pas été modifiés.
- Non fait : une Content-Security-Policy `script-src` complète. L'admin n'a plus de handler inline, mais le jeu en a peut-être ailleurs. À traiter dans un ticket de durcissement, voir section 9.
- Le panel admin reste désactivé en production tant que `ADMIN_SECRET` n'est pas défini (#12).

## 6. Procédure de déploiement proposée

Rien côté serveur, pas de dépendance nouvelle (`package-lock.json` inchangé), pas de migration.

1. Sauvegarder la base : `npm run backup`, ou bien `sqlite3 server/data/dig.sqlite ".backup /chemin/sauvegarde.sqlite"`.
2. Mettre la production à jour avec la procédure habituelle vers le SHA validé de `develop`, puis `main`.
3. Redémarrer `dig.service`, puis vérifier `GET /api/version` et le chargement du jeu. `escapeHtml.js` doit répondre 200 : une erreur `escapeHtml is not defined` dans la console casserait la vue Saison.
4. Faire le test manuel de la section 4.
5. Retour arrière : revenir au commit précédent et redémarrer. Aucune donnée à restaurer.

## 7. Choix techniques faits seul

- **DOM plutôt qu'échappement dans `admin.js`** : la page détient la clé admin. Construire les éléments avec `textContent` ne dépend pas d'un oubli d'`esc()`, et le test statique peut garantir qu'aucun `innerHTML` dynamique ne revient.
- **`escapeHtml` dans `main.js`** : le rendu du jeu repose sur de grands gabarits. Les réécrire en DOM aurait été lourd et risqué. L'échappement est ciblé sur les seules données serveur.
- **Défense en profondeur** : les pseudos sont déjà limités à `[a-z0-9_-]` côté serveur, mais ils sont échappés quand même. D'anciennes lignes, un futur changement de règle ou une écriture directe en base restent ainsi sans effet.
- **Validation e-mail stricte mais pratique** : partie locale RFC « atom » (apostrophe et `+` permis). Pas d'adresses entre guillemets ni d'IP littérales, qui sont rares pour un jeu grand public.
- `playwright-core` a servi uniquement à la vérification navigateur, installé dans `/tmp` hors du projet. Il n'est pas ajouté aux dépendances.

## 8. Décisions demandées au propriétaire

Aucune décision utilisateur nécessaire.

## 9. Éléments restant à réaliser

- Validation par le propriétaire, déploiement et clôture.
- Suggestion à traiter hors de ce ticket, par exemple dans T-17 : ajouter `script-src 'self'` à la CSP (`server/security.js`) une fois les éventuels handlers inline du jeu retirés. Cela bloquerait toute XSS future, même en cas d'oubli d'échappement.
