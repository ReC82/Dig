#!/usr/bin/env bash
# scripts/deploy.sh — déploiement réversible de DIG! (remplace ~/update-dig.sh).
#
# Étapes : verrou → contrôles (arbre propre, bonne branche, avance rapide possible)
#          → sauvegarde vérifiée de la base → git merge --ff-only → npm ci si le lock a changé
#          → redémarrage → contrôle de santé (/health + /api/version = nouveau SHA)
#          → en cas d'échec : retour au SHA précédent (code + dépendances), redémarrage, contrôle.
# La base n'est JAMAIS restaurée automatiquement (des parties ont pu être jouées entre-temps) :
# la commande de restauration de la sauvegarde pré-déploiement est affichée.
#
# Utilisation (depuis le dossier de production, ou avec APP_DIR) :
#   scripts/deploy.sh            déploie origin/main
#   scripts/deploy.sh --dry-run  contrôles seulement, rien n'est modifié
#   TARGET=<sha|ref> scripts/deploy.sh
#
# Variables : APP_DIR (défaut : dossier parent du script), BRANCH (main), REMOTE (origin),
#   TARGET (défaut $REMOTE/$BRANCH), SERVICE (dig), PORT (3000), HEALTH_URL (http://127.0.0.1:$PORT),
#   HEALTH_TIMEOUT (secondes, 40), RESTART_CMD (défaut « sudo systemctl restart $SERVICE »),
#   DIG_BACKUP_DIR, DB_FILE, DIG_DEPLOY_LOCK, DIG_DEPLOY_LOG.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SCRIPT_DIR")}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
SERVICE="${SERVICE:-dig}"
PORT="${PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:$PORT}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-40}"
RESTART_CMD="${RESTART_CMD:-sudo systemctl restart $SERVICE}"
DB_PATH="${DIG_DB_PATH:-$APP_DIR/server/data/${DB_FILE:-dig.sqlite}}"
BACKUP_DIR="${DIG_BACKUP_DIR:-$HOME/backups/dig}"
LOCK="${DIG_DEPLOY_LOCK:-/tmp/dig-deploy.lock}"
LOG="${DIG_DEPLOY_LOG:-$BACKUP_DIR/deploy.log}"
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

mkdir -p "$BACKUP_DIR"
log() { local m; m="$(date '+%F %T') [deploy] $*"; echo "$m"; echo "$m" >>"$LOG"; }
fail() { log "ÉCHEC : $*"; exit 1; }

exec 9>"$LOCK"
flock -n 9 || fail "un autre déploiement est en cours ($LOCK)"

git_app() { git -C "$APP_DIR" "$@"; }

# ── Contrôles ────────────────────────────────────────────────────────────────
[[ -d "$APP_DIR/.git" ]] || fail "$APP_DIR n'est pas un dépôt Git"
[[ "$(git_app rev-parse --abbrev-ref HEAD)" == "$BRANCH" ]] || fail "branche courante ≠ $BRANCH"
[[ -z "$(git_app status --porcelain --untracked-files=no)" ]] || fail "modifications locales suivies dans $APP_DIR : rien n'est touché"
git_app fetch --quiet "$REMOTE"
PREV="$(git_app rev-parse HEAD)"
NEXT="$(git_app rev-parse "${TARGET:-$REMOTE/$BRANCH}^{commit}")"
if [[ "$PREV" == "$NEXT" ]]; then log "déjà à jour ($(git_app rev-parse --short HEAD)) : rien à déployer"; exit 0; fi
git_app merge-base --is-ancestor "$PREV" "$NEXT" || fail "$NEXT n'est pas une avance rapide de $PREV"
LOCK_CHANGED=0
git_app diff --quiet "$PREV" "$NEXT" -- package-lock.json || LOCK_CHANGED=1
log "déploiement ${PREV:0:7} → ${NEXT:0:7} ($(git_app rev-list --count "$PREV..$NEXT") commit(s), npm ci : $([[ $LOCK_CHANGED == 1 ]] && echo oui || echo non))"
if [[ $DRY_RUN == 1 ]]; then log "--dry-run : contrôles OK, rien n'a été modifié"; exit 0; fi

# ── Sauvegarde vérifiée (obligatoire) ────────────────────────────────────────
BACKUP_JSON="$(DIG_DB_PATH="$DB_PATH" DIG_BACKUP_DIR="$BACKUP_DIR" \
  node "$SCRIPT_DIR/backup-db.js" --label "pre-deploy-${NEXT:0:7}" --json)" \
  || fail "sauvegarde impossible : déploiement annulé, rien n'a été modifié"
BACKUP_FILE="$(node -e 'console.log(JSON.parse(process.argv[1]).path)' "$BACKUP_JSON")"
log "sauvegarde vérifiée : $BACKUP_FILE"

health() {
  local want="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) version
  while (( SECONDS < deadline )); do
    if curl -fsS -m 5 "$HEALTH_URL/health" 2>/dev/null | grep -q '"ok":true'; then
      version="$(curl -fsS -m 5 "$HEALTH_URL/api/version" 2>/dev/null || true)"
      [[ "$version" == *"+${want:0:7}"* ]] && return 0
    fi
    sleep 2
  done
  return 1
}

rollback() {
  log "retour arrière vers ${PREV:0:7} : $*"
  git_app reset --quiet --keep "$PREV" || { log "git reset --keep impossible : intervention manuelle requise"; exit 2; }
  if [[ $LOCK_CHANGED == 1 ]]; then (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund >/dev/null 9>&-) || log "npm ci du retour arrière en échec"; fi
  bash -c "$RESTART_CMD" 9>&- || log "redémarrage du retour arrière en échec"
  if health "$PREV"; then
    log "retour arrière OK : ${PREV:0:7} répond. Base non restaurée (voir ci-dessous si nécessaire)."
  else
    log "RETOUR ARRIÈRE EN ÉCHEC : le service ne répond pas sur ${PREV:0:7} — intervention manuelle requise"
  fi
  log "restauration éventuelle de la base (service arrêté) : node $APP_DIR/scripts/restore-db.js $BACKUP_FILE --live"
  exit 1
}

# ── Mise à jour du code ─────────────────────────────────────────────────────
git_app merge --quiet --ff-only "$NEXT" || fail "git merge --ff-only refusé : rien n'a été modifié"
if [[ $LOCK_CHANGED == 1 ]]; then
  (cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund >/dev/null 9>&-) || rollback "npm ci en échec"
fi
bash -c "$RESTART_CMD" 9>&- || rollback "redémarrage en échec"
health "$NEXT" || rollback "contrôle de santé en échec après ${HEALTH_TIMEOUT}s ($HEALTH_URL)"
log "OK : ${NEXT:0:7} en service, santé et version vérifiées"
