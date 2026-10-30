# Ticket #12 — [P1] T-05 — Sécuriser secrets, sessions et HTTP

- Ticket : https://github.com/ReC82/Dig/issues/12 (source : audit général #6, section T-05)
- Session du 29/10/2026

## 1. État réel

**Intégré dans develop — en attente de validation et de déploiement.** Rien n'est déployé : `main`,
`/home/ubuntu/Dig`, `dig.service` et nginx n'ont pas bougé.

⚠️ **Ce changement exige une action du propriétaire AVANT le déploiement** (création du fichier de
secret, § 6). Sans elle, la nouvelle version refuse de démarrer en production — c'est voulu ;
`scripts/deploy.sh` revient alors seul à la version précédente.

## 2. Problème

- `SESSION_SECRET` n'est pas défini en production : le serveur utilisait la valeur par défaut
  publiée dans le dépôt, ce qui permet à n'importe qui de **forger un cookie de session** et
  d'agir au nom de n'importe quel joueur.
- Cookie de session sans `Secure`, pas de `trust proxy`, Node à l'écoute sur `0.0.0.0:3000`
  (joignable sans passer par nginx), `X-Powered-By: Express`, ni HSTS ni `X-Frame-Options`.
- Comparaison non constante du jeton admin.
- `npm audit --omit=dev` : `proxy-addr` (critique), `body-parser` (haute), `qs` (moyenne).

## 3. Changements réalisés

| Fichier | Changement |
|---|---|
| `server/security.js` (nouveau) | Résolution des secrets, comparaison du jeton admin en temps constant (SHA-256 + `timingSafeEqual`), lecture de `TRUST_PROXY` / `COOKIE_SECURE`, middleware d'en-têtes de sécurité. |
| `server/index.js` | En production (`NODE_ENV=production`), **arrêt immédiat (code 1)** si `SESSION_SECRET` est absent, fait < 32 caractères ou vaut l'ancienne valeur publiée. Hors production : secret aléatoire éphémère (plus jamais de valeur fixe). `app.set('trust proxy', 'loopback')`, `x-powered-by` désactivé, cookie `Secure` (production) + `HttpOnly` + `SameSite=Lax`. Écoute sur `HOST` (défaut **127.0.0.1**). Admin : `ADMIN_SECRET` < 32 caractères ⇒ panel désactivé (503, comme aujourd'hui sans secret). |
| En-têtes ajoutés | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP minimale `frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'`, `Strict-Transport-Security: max-age=15552000` (HTTPS seulement). |
| `package.json`, `package-lock.json` | `express` ^4.22.3 (corrige `proxy-addr` 2.0.8, `body-parser` 1.20.9, `qs` 6.16.2) ; `npm audit fix` sur une dépendance de développement (`brace-expansion`, via nodemon). **`npm audit` : 0 vulnérabilité** (prod et dev). |
| `deploy/systemd/dig.service.d/secrets.conf` (nouveau) | Drop-in systemd `EnvironmentFile=/etc/dig/dig.env` (aucun secret dedans). |
| `docs/OPERATIONS.md` | Section « Secrets, sessions et HTTP » : création du fichier de secret, effet sur les joueurs, `ADMIN_SECRET`, vérifications, retour arrière. |
| `test/security.test.js` (nouveau) | 7 tests (voir § 4). |

Comportement visible pour les joueurs : aucun, sauf **une reconnexion unique** après le changement
de secret (voir § 5).

## 4. SHA, branche et procédure de test

- Branche : `fix/12-secrets-sessions-http` (commit `af03314`)
- **SHA sur `develop` : `1315fa7`** (fusion `--no-ff`) ; le présent rapport est intégré par une fusion suivante.

Tests automatiques (bases temporaires, port 3111, serveur lancé en `NODE_ENV=production`) :

```bash
npm ci && npm test          # 62 tests, 0 échec (dont 7 nouveaux dans test/security.test.js)
npm audit                   # found 0 vulnerabilities
```

`test/security.test.js` vérifie :
1. refus de démarrer en production sans `SESSION_SECRET`, ou avec l'ancienne valeur publiée (code 1) ;
2. secret trop court refusé ; hors production, secret aléatoire différent à chaque démarrage ;
3. requête relayée « comme nginx » (`X-Forwarded-Proto: https`) ⇒ cookie `Secure; HttpOnly; SameSite=Lax` et HSTS ; la session fonctionne ;
4. HTTP en clair direct ⇒ aucun cookie de session émis, pas de HSTS ;
5. **un cookie re-signé avec l'ancien secret publié est refusé** (plus de session forgée) ;
6. absence de `X-Powered-By`, présence de `nosniff`, `X-Frame-Options`, CSP ;
7. Node ne répond pas sur l'adresse IP externe de la machine (écoute 127.0.0.1) ;
8. admin : 503 si `ADMIN_SECRET` trop court ; 200 avec le bon jeton, 401 avec un jeton faux ou absent.

Test manuel possible : `NODE_ENV=production PORT=3101 DB_FILE=/tmp/test-12.sqlite node server/index.js`
⇒ doit afficher « SESSION_SECRET absent : démarrage refusé en production » et s'arrêter.

## 5. Vérifications, limites, impact sur les données

- Fait : suite complète `npm test` sur la branche et sur `develop` après fusion ; `node --check` ;
  lecture (sans modification) de la configuration nginx : elle proxifie vers `127.0.0.1:3000` et
  transmet déjà `X-Forwarded-Proto` / `X-Forwarded-For` ⇒ `trust proxy loopback` et cookie
  `Secure` fonctionneront sans toucher à nginx.
- Non fait (interdit dans cette session) : création du secret, installation du drop-in,
  redémarrage du service, vérification en production.
- **Données des joueurs : aucune migration, aucune écriture en base.** Le nouveau secret invalide
  les cookies de session existants : les joueurs connectés devront se reconnecter **une fois** ;
  leurs sauvegardes cloud, comptes et classements sont intacts. Les fichiers de
  `server/data/sessions/` deviennent inutilisables et sont purgés à expiration (7 jours).
- Après déploiement, `curl http://<IP publique>:3000` ne répond plus (voulu). Tout outil externe
  qui interrogerait directement le port 3000 depuis une autre machine cesserait de fonctionner
  (aucun n'est connu ; `deploy.sh` et les tests utilisent 127.0.0.1).
- `X-Frame-Options: SAMEORIGIN` / `frame-ancestors 'self'` interdisent d'intégrer le jeu dans une
  iframe d'un autre site (portail, plateforme de jeux). Aucune intégration de ce type trouvée
  dans le dépôt ; à signaler si elle existe (question 2).
- CSP volontairement minimale : une CSP complète (`script-src`…) casserait les scripts et
  attributs `on…` en ligne du jeu ; à traiter avec T-08 (XSS admin) / T-17.

## 6. Procédure de déploiement proposée

Ordre impératif : **secret d'abord, déploiement ensuite.**

```bash
# 0. Sauvegarde de la base (T-06 si installé, sinon) :
sqlite3 /home/ubuntu/Dig/server/data/dig.sqlite ".backup /home/ubuntu/backups/dig-avant-12.sqlite"

# 1. Secret (affiché nulle part) + drop-in systemd
sudo install -d -m 700 -o root -g root /etc/dig
sudo install -m 600 -o root -g root /dev/null /etc/dig/dig.env
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 48)" | sudo tee /etc/dig/dig.env >/dev/null
sudo install -D -m 644 deploy/systemd/dig.service.d/secrets.conf /etc/systemd/system/dig.service.d/secrets.conf
sudo systemctl daemon-reload
sudo systemctl show dig -p EnvironmentFiles      # doit citer /etc/dig/dig.env

# 2. Déploiement (après fusion develop → main) : npm run deploy (ou procédure manuelle habituelle)

# 3. Vérifications
curl -fsS http://127.0.0.1:3000/health
ss -ltnp | grep ':3000'                          # 127.0.0.1:3000 uniquement
curl -sI https://dig.lodygames.com/ | grep -i -E 'strict-transport|x-frame|x-powered'
# Connexion d'un compte dans le navigateur : cookie connect.sid marqué Secure ; se reconnecter une fois.
```

Retour arrière : redéployer le SHA précédent (`scripts/deploy.sh` le fait seul si `/health`
échoue). Le drop-in peut rester : l'ancienne version utilise `SESSION_SECRET` s'il est défini. Pour
le retirer : `sudo rm /etc/systemd/system/dig.service.d/secrets.conf && sudo systemctl daemon-reload`.

## 7. Choix techniques faits seul

- **`trust proxy = 'loopback'`** plutôt que `1` : seul nginx local est cru pour `X-Forwarded-*` ;
  un client ne peut pas usurper son IP ou HTTPS. Configurable par `TRUST_PROXY`.
- **Seuil de 32 caractères** pour les deux secrets ; l'ancienne valeur publiée est explicitement
  refusée. `ADMIN_SECRET` trop court désactive le panel (503) au lieu d'empêcher le démarrage :
  le jeu reste en ligne.
- **Fichier de secret root:root 600** lu par systemd (pas par Node) ; pas de `.env` dans le dossier
  de l'application.
- **Secret éphémère hors production** au lieu d'une valeur par défaut : aucune valeur fixe connue.
- HSTS 180 jours, **sans** `includeSubDomains` ni `preload` (d'autres sites partagent ces domaines).
- Pas de nouvelle dépendance (`helmet` non ajouté) : 5 en-têtes posés à la main.
- Cookie : nom `connect.sid` conservé ; le changement de secret suffit à invalider les anciennes sessions.

## 8. Décisions demandées au propriétaire

1. **Activer le panel admin en production ?** Options : (a) laisser `ADMIN_SECRET` absent, panel
   désactivé (état actuel) ; (b) l'ajouter au fichier `/etc/dig/dig.env` (commande dans
   `docs/OPERATIONS.md`). **Recommandation : (a) tant que la XSS du panel (T-08, #15) n'est pas
   corrigée.** Non bloquant.
2. **Le jeu est-il intégré dans une iframe d'un autre site** (portail Lodylands, plateforme de
   jeux) ? Si oui, indiquer le domaine : il faudra l'autoriser dans `frame-ancestors`. Par défaut,
   l'intégration externe est bloquée. Non bloquant.

## 9. Restant à réaliser

- Action propriétaire : créer `/etc/dig/dig.env`, installer le drop-in, déployer (§ 6).
- Hors périmètre, signalé : énumération des comptes (409 distincts à l'inscription),
  `uncaughtException` avalé, CSP complète (nécessite de sortir les scripts en ligne), pare-feu
  `ufw` inactif (infrastructure, décision propriétaire), rate limiting (T-07, #14).

---

## Session du 30/10/2026 (≈ 11:25Z) — bilan de sécurité restant, proposition de clôture

Demande du propriétaire (commentaire du 30/10 11:19Z) : ne plus demander la recette (déjà validée),
fournir un bilan de sécurité restant avec preuves automatisées et proposer la clôture si les
critères sont remplis. **Aucun changement de code** dans cette session ; production inchangée
(`1.0.0+c23f521`), `develop` = `0bcbe46` (contient T-05 depuis le 29/10).

**État réel : Déployé en production — recette validée par le propriétaire — clôture proposée.**

### Preuves relevées en production (sondes en lecture seule, 30/10 ≈ 11:25Z)

| Critère du ticket | Preuve | Résultat |
|---|---|---|
| `SESSION_SECRET` fort via EnvironmentFile mode 600 | `systemctl cat dig` → `EnvironmentFile=/etc/dig/dig.env` ; `stat` → `600 root:root` (contenu jamais lu) | OK |
| Secret absent / publié / court refusé | tests `resolveSessionSecret…` et « production sans SESSION_SECRET… démarrage refusé » | OK |
| Aucun secret dans le dépôt | `git ls-files` : seuls `.env.example` et le drop-in systemd (sans valeur) ; `.env` ignoré, absent du dossier de production | OK |
| Node en localhost uniquement | `ss -ltnp` → `127.0.0.1:3000` ; port 3000 injoignable depuis l'IP publique | OK |
| `trust proxy` | `loopback` (seul nginx local cru) ; test `parseTrustProxy / cookieSecure` | OK |
| Cookie de session | `HttpOnly`, `SameSite=Lax`, `Secure` en production (test « cookie Secure via nginx »), 7 jours, `saveUninitialized: false` | OK |
| En-têtes HTTP (2 domaines) | `nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP `frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'`, HSTS 180 j ; aucun `X-Powered-By` | OK sur dig.lodygames.com et dig.lodylands.com |
| Panel admin | `/api/admin/stats` → 404/503 hors configuration (`ADMIN_SECRET` absent) ; comparaison stricte du Bearer testée | OK (désactivé) |
| Vulnérabilités npm | `npm audit` et `npm audit --omit=dev` → 0 vulnérabilité | OK |
| Déconnexion des sessions existantes | faite au déploiement T-05 (changement de secret) ; depuis #28, changement/réinitialisation de mot de passe révoque les autres sessions (`auth_version`, test `account-recovery`) | OK |
| Non-régression | `npm test` sur `develop` `0bcbe46` : **158/158 OK** (dont 7 tests sécurité) | OK |
| Vérification fonctionnelle | recette du propriétaire 30/10 : connexion persistante après fermeture/réouverture, progression conservée | Validée |

### Risques restants (aucun bloquant MVP public)

1. **Pas de rotation de l'identifiant de session à la connexion** (`req.session.regenerate`) —
   risque de fixation de session **faible** (cookie HttpOnly, host-only, HTTPS, aucune session
   créée avant connexion). *Après lancement* — petit correctif possible en ticket dédié.
2. **CSP partielle** (pas de `script-src`, scripts en ligne dans le client). *Après lancement.*
3. **Pare-feu `ufw` inactif** : seuls nginx (80/443) exposent Dig, Node écoute en local ; décision
   infrastructure du propriétaire, hors périmètre. *Après lancement.*
4. **Inscription : 409 si nom ou e-mail déjà pris** (message unique pour les deux) — énumération
   limitée par le rate limiting (#14). *Après lancement.*
5. Points signalés le 29/10 désormais traités ailleurs : XSS admin (#15), rate limiting (#14),
   `uncaughtException` (arrêt propre du processus, redémarrage par systemd).

### Questions ouvertes (non bloquantes, inchangées)

1. Activer le panel admin en production (`ADMIN_SECRET`) ? La XSS du panel (#15) est corrigée ;
   **recommandation : seulement quand le besoin admin (#30) le justifie**, avec un secret ≥ 32
   caractères dans `/etc/dig/dig.env`.
2. Intégration du jeu en iframe sur un autre site ? Par défaut bloquée (`frame-ancestors 'self'`).

### Conclusion

Tous les critères techniques de T-05 sont prouvés et la vérification fonctionnelle a été validée :
**clôture proposée au propriétaire.** Classement : **Bloquant MVP public — fait.**
