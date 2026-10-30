#!/usr/bin/env bash
# DIG! — configuration de l'envoi d'e-mails du jeu (ticket #43) : vérification d'adresse,
# mot de passe oublié, notifications de liaison Google. Distinct du SMTP de DIGORCH.
#
#   sudo bash /home/ubuntu/Dig/scripts/dig-smtp-config.sh            configurer (ou reconfigurer)
#   sudo bash /home/ubuntu/Dig/scripts/dig-smtp-config.sh --test     contrôler + e-mail de test
#   sudo bash /home/ubuntu/Dig/scripts/dig-smtp-config.sh --off      désactiver les e-mails du jeu
#
# Le mot de passe SMTP est saisi sans écho. Les valeurs sont d'abord testées (connexion et
# authentification SMTP) SANS rien modifier ; puis écrites dans /etc/dig/dig.env (root, 600) après
# sauvegarde, le jeu est redémarré et contrôlé, avec retour automatique à l'ancienne
# configuration en cas d'échec. Aucun secret n'est affiché, journalisé ni passé en argument
# (les contrôles reçoivent la configuration sur leur entrée standard).
set -euo pipefail
umask 077

ENV_FILE=/etc/dig/dig.env
APP_DIR=/home/ubuntu/Dig
URL=http://127.0.0.1:3000
RUN_AS=ubuntu
KEYS='MAIL_TRANSPORT|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASS|MAIL_FROM|MAIL_REPLY_TO|PUBLIC_BASE_URL'

restart_service() { systemctl restart dig; }
service_log()     { journalctl -u dig --since "$1" --no-pager -o cat; }
as_app()          { runuser -u "$RUN_AS" -- "$@"; }

# Bac à sable des tests automatisés (test/smtp-config.test.js) : jamais actif sous sudo, qui
# ne transmet pas ces variables.
if [ "${DIG_SMTP_SANDBOX:-}" = 1 ] && [ "$(id -u)" -ne 0 ]; then
  ENV_FILE=$DIG_ENV_FILE; APP_DIR=$DIG_APP_DIR; URL=$DIG_URL
  restart_service() { bash -c "$DIG_SANDBOX_RESTART"; }
  service_log()     { cat "$DIG_SANDBOX_LOG"; }
  as_app()          { "$@"; }
else
  [ "$(id -u)" -eq 0 ] || { echo "À lancer avec sudo : sudo bash $0 ${*}"; exit 1; }
  [ -t 0 ] || [ "${1:-}" = --off ] || { echo "Terminal interactif requis (connexion SSH)."; exit 1; }
fi
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE introuvable. Rien n'a été modifié."; exit 1; }

CHECK=(node "$APP_DIR/scripts/mail-check.js" --config -)
mail_lines() { grep -E "^($KEYS)=" "$1" || true; }
check()      { mail_lines "$1" | (cd "$APP_DIR" && as_app "${CHECK[@]}" "${@:2}"); }

wait_up() {
  for _ in $(seq 1 40); do
    curl -fsS "$URL/api/version" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
mail_flag() { curl -fsS "$URL/api/me" 2>/dev/null | grep -oE '"mail":(true|false)' | cut -d: -f2; }

BACKUP=
rollback() {
  echo "ÉCHEC : $1 — retour à la configuration précédente."
  cp -p "$BACKUP" "$ENV_FILE"
  restart_service
  wait_up && echo "Ancienne configuration rétablie, jeu opérationnel (e-mails : $(mail_flag))." \
          || echo "ATTENTION : le jeu ne répond pas après le retour arrière — voir journalctl -u dig."
  exit 1
}

# Installe un nouveau fichier de configuration (sauvegarde, remplacement atomique, redémarrage).
install_env() {
  BACKUP="$ENV_FILE.avant-smtp-$(date +%Y%m%d-%H%M%S)"
  cp -p "$ENV_FILE" "$BACKUP"
  [ "$(id -u)" -eq 0 ] && chown root:root "$1"
  chmod 600 "$1"
  mv "$1" "$ENV_FILE"
  SINCE=$(date '+%Y-%m-%d %H:%M:%S')
  restart_service
  wait_up || rollback "le jeu ne répond plus"
}

classic_login_ok() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    -d '{"username":"__controle_smtp__","password":"x"}' "$URL/api/login")
  [ "$code" = 401 ] || [ "$code" = 400 ]
}

send_test() {
  local to=${1:-}
  if [ -z "$to" ]; then
    read -r -p "Adresse qui recevra l'e-mail de test (Entrée = pas d'envoi) : " to
  fi
  [ -z "$to" ] && { echo "Pas d'e-mail de test."; return 0; }
  check "$ENV_FILE" --send "$to"
}

# ── Désactivation ────────────────────────────────────────────────────────────
if [ "${1:-}" = --off ]; then
  TMP=$(mktemp "$(dirname "$ENV_FILE")/.dig.env.XXXXXX")
  grep -vE '^(MAIL_TRANSPORT|SMTP_HOST|SMTP_PORT|SMTP_SECURE|SMTP_USER|SMTP_PASS|MAIL_FROM|MAIL_REPLY_TO)=' "$ENV_FILE" > "$TMP" || true
  install_env "$TMP"
  [ "$(mail_flag)" = false ] || rollback "les e-mails sont toujours annoncés comme actifs"
  echo "E-mails du jeu désactivés (le jeu fonctionne comme avant #43). Sauvegarde : $BACKUP"
  exit 0
fi

# ── Contrôle de la configuration en place ────────────────────────────────────
if [ "${1:-}" = --test ]; then
  check "$ENV_FILE" --verify || exit 1
  check "$ENV_FILE" --dns || true
  echo "Jeu : e-mails $( [ "$(mail_flag)" = true ] && echo actifs || echo INACTIFS )"
  send_test "${2:-}"
  exit $?
fi

# ── Configuration ────────────────────────────────────────────────────────────
echo "Configuration des e-mails du jeu DIG! (e-mails actuellement : $(mail_flag || echo '?'))."
echo "Le mot de passe est saisi sans écho. Rien n'est modifié avant la réussite du test SMTP."
echo
read -r -p "Serveur SMTP (ex. smtp.fournisseur.com) : " HOST
read -r -p "Port [587] : " PORT; PORT=${PORT:-587}
if [ "$PORT" = 465 ]; then SECURE=true; else SECURE=false; fi
read -r -p "Identifiant SMTP (souvent l'adresse ; Entrée = sans authentification) : " SUSER
SPASS=
if [ -n "$SUSER" ]; then read -r -s -p "Mot de passe SMTP : " SPASS; echo; fi
read -r -p "Adresse d'expédition (ex. no-reply@lodygames.com) : " FROM_ADDR
read -r -p "Nom affiché [DIG!] : " FROM_NAME; FROM_NAME=${FROM_NAME:-DIG!}
read -r -p "Adresse de réponse (facultative) : " REPLY_TO
read -r -p "Adresse publique du jeu pour les liens [https://dig.lodygames.com] : " BASE
BASE=${BASE:-https://dig.lodygames.com}

fail() { echo "$1 Rien n'a été modifié."; exit 1; }
EMAIL_RE='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
[[ "$HOST" =~ ^[A-Za-z0-9.-]+$ ]]               || fail "Serveur SMTP invalide."
[[ "$PORT" =~ ^(25|465|587|2525)$ ]]           || fail "Port inattendu (25, 465, 587 ou 2525)."
[[ -z "$SUSER" || "$SUSER" =~ ^[^[:space:][:cntrl:]\']{1,254}$ ]] || fail "Identifiant invalide (espaces et apostrophes refusés)."
[[ -z "$SUSER" || ( ${#SPASS} -ge 1 && ${#SPASS} -le 512 ) ]]     || fail "Mot de passe vide."
[[ "$SPASS" != *"'"* && ! "$SPASS" =~ [[:cntrl:]] ]] || fail "Le mot de passe contient une apostrophe ou un caractère de contrôle (non pris en charge)."
[[ "$FROM_ADDR" =~ $EMAIL_RE ]]                || fail "Adresse d'expédition invalide."
[[ "$FROM_NAME" =~ ^[A-Za-z0-9\ !._-]{1,40}$ ]] || fail "Nom affiché invalide (lettres, chiffres, espace, ! . _ -)."
[[ -z "$REPLY_TO" || "$REPLY_TO" =~ $EMAIL_RE ]] || fail "Adresse de réponse invalide."
[[ "$BASE" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || fail "Adresse publique invalide (https://domaine, sans chemin)."

# Fichier candidat : configuration actuelle sans les clés e-mail, puis les nouvelles valeurs
# entre apostrophes (valeur littérale pour systemd).
TMP=$(mktemp "$(dirname "$ENV_FILE")/.dig.env.XXXXXX")
trap 'rm -f "$TMP"' EXIT
grep -vE "^($KEYS)=" "$ENV_FILE" > "$TMP" || true
{
  printf "%s\n" "SMTP_HOST='$HOST'" "SMTP_PORT='$PORT'" "SMTP_SECURE='$SECURE'"
  [ -n "$SUSER" ] && printf "%s\n" "SMTP_USER='$SUSER'" "SMTP_PASS='$SPASS'"
  printf "%s\n" "MAIL_FROM='$FROM_NAME <$FROM_ADDR>'"
  [ -n "$REPLY_TO" ] && printf "%s\n" "MAIL_REPLY_TO='$REPLY_TO'"
  printf "%s\n" "PUBLIC_BASE_URL='$BASE'"
} >> "$TMP"
unset SPASS

echo
echo "Test de connexion SMTP (aucune modification tant qu'il échoue)…"
check "$TMP" --verify || fail "Le serveur SMTP refuse la connexion ou les identifiants (EAUTH = identifiants refusés, ECONNECTION/ETIMEDOUT = serveur ou port injoignable)."
check "$TMP" --dns || echo "  → l'envoi fonctionnera, mais sans SPF/DKIM les e-mails risquent d'arriver dans les indésirables."

install_env "$TMP"
trap - EXIT

for _ in $(seq 1 25); do
  LOG=$(service_log "$SINCE" | grep '\[mail\]' || true)
  grep -qE 'connexion SMTP (vérifiée|refusée)' <<<"$LOG" && break
  sleep 1
done
grep -q 'e-mails de compte actifs' <<<"$LOG" || rollback "le jeu n'a pas activé les e-mails ($(tail -1 <<<"$LOG" | sed -E 's/.*\[mail\] *//'))"
grep -q 'connexion SMTP vérifiée' <<<"$LOG"  || rollback "le jeu n'a pas pu se connecter au serveur SMTP ($(grep -oE 'refusée : .*' <<<"$LOG" | tail -1))"
grep -q 'DÉSACTIVÉES' <<<"$LOG"              && rollback "les limites d'envoi sont désactivées (RATE_LIMIT=off)"
[ "$(mail_flag)" = true ]                    || rollback "/api/me n'annonce pas les e-mails"
classic_login_ok                             || rollback "la connexion classique ne répond plus normalement"
echo "✓ Jeu : $(grep -oE 'e-mails de compte actifs.*' <<<"$LOG" | tail -1 | sed -E 's/, liens vers/\n  liens vers/')"
echo "✓ Connexion SMTP du jeu vérifiée ; connexion classique opérationnelle"

if ! send_test ""; then
  rollback "l'e-mail de test a été refusé (adresse d'expédition non autorisée par le fournisseur ?)"
fi

echo
echo "Sauvegarde de l'ancienne configuration : $BACKUP"
echo "Désactivation immédiate si besoin : sudo bash $APP_DIR/scripts/dig-smtp-config.sh --off"
echo "À vérifier dans l'e-mail reçu : pas dans les indésirables ; « Afficher l'original » → SPF PASS et DKIM PASS."
echo "Recette : Paramètres → Vérifier mon adresse ; « Mot de passe oublié » depuis l'écran de connexion."
