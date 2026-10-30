#!/usr/bin/env bash
# Test de restauration d'une sauvegarde DIG! depuis S3, sur une copie isolée (ticket #36).
#
# Usage :
#   scripts/restore-from-s3.sh [latest | dig-AAAAMMJJ-HHMMSS[-label].sqlite]
#
# Télécharge la sauvegarde et son manifeste dans un dossier temporaire neuf, vérifie le sha256
# (métadonnée S3 et manifeste), puis la restaure avec scripts/restore-db.js sur une base cible
# NEUVE dans ce même dossier (integrity_check + compteurs par table). La base du jeu n'est jamais
# lue ni écrite. Le dossier temporaire est supprimé à la fin, sauf avec DIG_S3_KEEP=1.
#
# Variables d'environnement : DIG_S3_BUCKET (obligatoire), DIG_S3_PREFIX (défaut : backups/),
# AWS_REGION, AWS_CLI (défaut : aws), TMPDIR. Identifiants : rôle d'instance / chaîne standard
# de l'AWS CLI uniquement ; aucun secret n'est lu ni affiché.
#
# Code de sortie : 0 si la copie restaurée est vérifiée, 1 sinon.

set -euo pipefail

want="${1:-latest}"
AWS="${AWS_CLI:-aws}"
bucket="${DIG_S3_BUCKET:-}"
prefix="${DIG_S3_PREFIX:-backups/}"
HERE="$(cd "$(dirname "$0")" && pwd)"

fail() { echo "[restore-s3] ÉCHEC : $*" >&2; exit 1; }

[[ -n "$bucket" ]] || fail "DIG_S3_BUCKET non défini"
[[ "$want" == "latest" || "$want" =~ ^dig-[0-9]{8}-[0-9]{6}(-[a-z0-9_-]+)?\.sqlite$ ]] \
  || fail "nom de sauvegarde invalide : $want"
command -v "$AWS" >/dev/null 2>&1 || fail "AWS CLI introuvable ($AWS)"

region_args=()
[[ -n "${AWS_REGION:-}" ]] && region_args=(--region "$AWS_REGION")

work="$(mktemp -d "${TMPDIR:-/tmp}/dig-restore-s3.XXXXXX")"
chmod 700 "$work"
[[ "${DIG_S3_KEEP:-0}" == "1" ]] || trap 'rm -rf "$work"' EXIT

if [[ "$want" == "latest" ]]; then
  # Les noms sont horodatés (dig-AAAAMMJJ-HHMMSS…) : le tri lexical donne la plus récente.
  want="$("$AWS" "${region_args[@]}" s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix" \
    --query 'Contents[].Key' --output text | tr '\t' '\n' | sed "s|^$prefix||" \
    | { grep -E '^dig-[0-9]{8}-[0-9]{6}(-[a-z0-9_-]+)?\.sqlite$' || true; } | sort | tail -n1)" \
    || fail "liste des sauvegardes impossible (s3://$bucket/$prefix)"
  [[ -n "$want" ]] || fail "aucune sauvegarde dans s3://$bucket/$prefix"
fi
manifest="${want%.sqlite}.json"

fetch() {
  "$AWS" "${region_args[@]}" s3api get-object --bucket "$bucket" --key "${prefix}$1" \
    --checksum-mode ENABLED "$work/$1" --output json >/dev/null || fail "téléchargement impossible : ${prefix}$1"
}
fetch "$want"
fetch "$manifest"

hex="$(sha256sum "$work/$want" | cut -d' ' -f1)"
meta="$("$AWS" "${region_args[@]}" s3api head-object --bucket "$bucket" --key "${prefix}$want" \
  --query 'Metadata.sha256' --output text)" || fail "head-object impossible pour ${prefix}$want"
[[ "$meta" == "$hex" ]] || fail "sha256 du fichier téléchargé différent de celui enregistré à l'envoi"
expected="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sha256 || "")' "$work/$manifest")"
[[ "$expected" == "$hex" ]] || fail "sha256 différent du manifeste"

# Cible neuve dans le dossier isolé : restore-db.js n'a aucune base existante à remplacer.
DIG_DB_PATH="$work/__aucune-base-du-jeu__.sqlite" DIG_BACKUP_DIR="$work/pre-restore" \
  node "$HERE/restore-db.js" "$work/$want" --target "$work/restored.sqlite" \
  || fail "restauration de $want refusée"

echo "[restore-s3] ok s3://$bucket/${prefix}$want → copie isolée vérifiée (sha256 $hex)"
[[ "${DIG_S3_KEEP:-0}" == "1" ]] && echo "[restore-s3] copie conservée : $work/restored.sqlite"
exit 0
