#!/usr/bin/env bash
# Contrôle en LECTURE SEULE du bucket de la copie hors machine de DIG! (ticket #36).
#
# À lancer par le PROPRIÉTAIRE avec des droits de lecture de la configuration du bucket (par exemple
# dans AWS CloudShell). Ne crée, ne modifie et ne supprime rien : seuls des appels get-* sont faits.
# Permet de vérifier un bucket créé à la main dans la console avant de lancer (ou non) setup-s3.sh.
#
#   bash deploy/aws/check-s3.sh <bucket> [région attendue, défaut us-east-1]
#
# Vérifie : région, accès public bloqué (4 réglages), chiffrement par défaut SSE-S3, versionnement,
# règle d'expiration à 30 jours sur backups/. Code de sortie : 0 si tout est conforme, 1 sinon.

# shellcheck disable=SC2015  # ok() et ko() renvoient toujours 0 : « A && ok || ko » est sûr ici.
set -uo pipefail

BUCKET="${1:?nom du bucket manquant}"
REGION="${2:-us-east-1}"
AWS="${AWS_CLI:-aws}"
bad=0
ok()  { echo "  ok    $*"; }
ko()  { echo "  ÉCART $*"; bad=1; }
get() { "$AWS" --region "$REGION" s3api "$@" --bucket "$BUCKET" --output text 2>/dev/null; }

echo "== s3://$BUCKET"

loc="$(get get-bucket-location --query 'LocationConstraint')" || { echo "  bucket inaccessible"; exit 1; }
# us-east-1 est renvoyé comme « None » (ou vide) par l'API.
[[ "$loc" == "None" || -z "$loc" ]] && loc="us-east-1"
[[ "$loc" == "$REGION" ]] && ok "région $loc" || ko "région $loc (attendue : $REGION)"

pab="$(get get-public-access-block \
  --query '[PublicAccessBlockConfiguration.BlockPublicAcls, PublicAccessBlockConfiguration.IgnorePublicAcls, PublicAccessBlockConfiguration.BlockPublicPolicy, PublicAccessBlockConfiguration.RestrictPublicBuckets]')"
[[ "$pab" =~ ^True[[:space:]]+True[[:space:]]+True[[:space:]]+True$ ]] && ok "accès public bloqué" || ko "accès public : ${pab:-non configuré}"

sse="$(get get-bucket-encryption \
  --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm')"
[[ "$sse" == "AES256" ]] && ok "chiffrement SSE-S3" || ko "chiffrement par défaut : ${sse:-aucun} (attendu AES256)"

ver="$(get get-bucket-versioning --query 'Status')"
[[ "$ver" == "Enabled" ]] && ok "versionnement activé" || ko "versionnement : ${ver:-jamais activé}"

days="$(get get-bucket-lifecycle-configuration \
  --query "Rules[?Status=='Enabled' && (Filter.Prefix=='backups/' || Prefix=='backups/')].Expiration.Days | [0]")"
[[ "$days" == "30" ]] && ok "expiration 30 jours sur backups/" || ko "expiration sur backups/ : ${days:-aucune règle} (attendu 30)"

if [[ "$bad" == 0 ]]; then echo "== conforme"; else echo "== non conforme (setup-s3.sh corrige ces réglages sans toucher aux objets)"; fi
exit "$bad"
