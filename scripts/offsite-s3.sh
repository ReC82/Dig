#!/usr/bin/env bash
# Copie hors machine d'une sauvegarde DIG! vers S3, avec vérification de l'objet (ticket #13).
#
# Usage (appelé par scripts/backup-db.js via DIG_BACKUP_OFFSITE_CMD) :
#   scripts/offsite-s3.sh <sauvegarde.sqlite> <manifeste.json>
#
# Variables d'environnement :
#   DIG_S3_BUCKET   bucket privé dédié à Dig (obligatoire)
#   DIG_S3_PREFIX   préfixe des objets (défaut : backups/)
#   AWS_REGION      région du bucket (défaut : celle de la configuration AWS)
#   AWS_CLI         binaire AWS CLI (défaut : aws)
#
# Identifiants : uniquement ceux du rôle d'instance (IMDS) ou de la chaîne standard de l'AWS CLI.
# Aucun secret n'est lu, passé en argument ni affiché par ce script.
#
# Vérification : chiffrement SSE-S3 demandé, sha256 transmis à S3 (contrôlé à la réception par S3,
# --checksum-algorithm SHA256), puis head-object : taille, chiffrement et sha256 doivent correspondre.
# Code de sortie : 0 si les deux objets sont vérifiés, 1 sinon (la sauvegarde locale est conservée).

set -euo pipefail

backup="${1:-}"
manifest="${2:-}"
AWS="${AWS_CLI:-aws}"
bucket="${DIG_S3_BUCKET:-}"
prefix="${DIG_S3_PREFIX:-backups/}"

fail() { echo "[offsite-s3] ÉCHEC : $*" >&2; exit 1; }

[[ -n "$bucket" ]] || fail "DIG_S3_BUCKET non défini"
[[ -f "$backup" ]] || fail "sauvegarde introuvable : $backup"
[[ -f "$manifest" ]] || fail "manifeste introuvable : $manifest"
command -v "$AWS" >/dev/null 2>&1 || fail "AWS CLI introuvable ($AWS)"

region_args=()
[[ -n "${AWS_REGION:-}" ]] && region_args=(--region "$AWS_REGION")

# sha256 en base64 (format attendu par S3 pour ChecksumSHA256) et en hexadécimal (métadonnée lisible).
sha_b64() { openssl dgst -sha256 -binary "$1" | base64; }
sha_hex() { sha256sum "$1" | cut -d' ' -f1; }

upload_and_verify() {
  local file="$1" key="$2" b64 hex size head
  b64="$(sha_b64 "$file")"
  hex="$(sha_hex "$file")"
  size="$(stat -c %s "$file")"

  "$AWS" "${region_args[@]}" s3api put-object \
    --bucket "$bucket" --key "$key" --body "$file" \
    --server-side-encryption AES256 \
    --checksum-algorithm SHA256 --checksum-sha256 "$b64" \
    --metadata "sha256=$hex" \
    --output json >/dev/null || fail "put-object refusé pour $key"

  head="$("$AWS" "${region_args[@]}" s3api head-object \
    --bucket "$bucket" --key "$key" --checksum-mode ENABLED \
    --query '[ContentLength, ServerSideEncryption, ChecksumSHA256, Metadata.sha256]' \
    --output text)" || fail "head-object impossible pour $key"

  local got_size got_sse got_b64 got_hex
  read -r got_size got_sse got_b64 got_hex <<<"$head"
  [[ "$got_size" == "$size" ]] || fail "$key : taille $got_size ≠ $size"
  [[ "$got_sse" == "AES256" ]] || fail "$key : chiffrement « $got_sse » ≠ AES256"
  [[ "$got_b64" == "$b64" ]] || fail "$key : checksum S3 différent"
  [[ "$got_hex" == "$hex" ]] || fail "$key : sha256 différent"
  echo "[offsite-s3] ok s3://$bucket/$key ($size octets, sha256 $hex)"
}

upload_and_verify "$backup" "${prefix}$(basename "$backup")"
upload_and_verify "$manifest" "${prefix}$(basename "$manifest")"
