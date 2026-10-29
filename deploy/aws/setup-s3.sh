#!/usr/bin/env bash
# Création des ressources AWS de la copie hors machine de DIG! (ticket #13).
#
# À lancer par le PROPRIÉTAIRE, avec des droits d'administration AWS (par exemple dans AWS CloudShell),
# jamais sur le serveur de jeu : celui-ci ne doit recevoir que le rôle d'instance limité.
#
#   bash deploy/aws/setup-s3.sh <bucket> <instance-id> [région]
#   ex. : bash deploy/aws/setup-s3.sh dig-backups-<id-compte> i-0123456789abcdef0 us-east-1
#
# Idempotent : une ressource déjà présente est conservée et reconfigurée à l'identique.
# Crée uniquement : 1 bucket privé, 1 rôle IAM « dig-backup-ec2 » (politique en ligne limitée au préfixe
# backups/ de ce bucket), 1 profil d'instance du même nom, et l'associe à l'instance si elle n'en a aucun.
# N'affiche ni ne crée aucune clé d'accès.

set -euo pipefail

BUCKET="${1:?nom du bucket manquant}"
INSTANCE_ID="${2:?identifiant de l instance EC2 manquant}"
REGION="${3:-us-east-1}"
ROLE="dig-backup-ec2"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
aws_() { aws --region "$REGION" "$@"; }
step() { echo "== $*"; }

for f in instance-role-policy bucket-policy; do
  sed "s/__BUCKET__/$BUCKET/g" "$HERE/$f.json" >"$TMP/$f.json"
done

step "Identité utilisée"
aws_ sts get-caller-identity --query '[Account, Arn]' --output text

step "Bucket s3://$BUCKET ($REGION)"
if aws_ s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "déjà présent"
elif [[ "$REGION" == "us-east-1" ]]; then
  aws_ s3api create-bucket --bucket "$BUCKET" >/dev/null
else
  aws_ s3api create-bucket --bucket "$BUCKET" \
    --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
fi
aws_ s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws_ s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
aws_ s3api put-bucket-encryption --bucket "$BUCKET" --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}'
aws_ s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws_ s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" \
  --lifecycle-configuration "file://$HERE/lifecycle.json"
aws_ s3api put-bucket-policy --bucket "$BUCKET" --policy "file://$TMP/bucket-policy.json"
aws_ s3api put-bucket-tagging --bucket "$BUCKET" --tagging 'TagSet=[{Key=project,Value=dig}]'

step "Rôle IAM $ROLE et profil d'instance"
if ! aws_ iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  aws_ iam create-role --role-name "$ROLE" --tags Key=project,Value=dig \
    --assume-role-policy-document "file://$HERE/trust-policy.json" >/dev/null
fi
aws_ iam put-role-policy --role-name "$ROLE" --policy-name dig-backup-s3 \
  --policy-document "file://$TMP/instance-role-policy.json"
if ! aws_ iam get-instance-profile --instance-profile-name "$ROLE" >/dev/null 2>&1; then
  aws_ iam create-instance-profile --instance-profile-name "$ROLE" >/dev/null
  aws_ iam add-role-to-instance-profile --instance-profile-name "$ROLE" --role-name "$ROLE"
  sleep 10  # propagation IAM avant l'association
fi

step "Association à l'instance $INSTANCE_ID"
current="$(aws_ ec2 describe-iam-instance-profile-associations \
  --filters "Name=instance-id,Values=$INSTANCE_ID" "Name=state,Values=associated" \
  --query 'IamInstanceProfileAssociations[0].IamInstanceProfile.Arn' --output text)"
if [[ "$current" == "None" ]]; then
  aws_ ec2 associate-iam-instance-profile --instance-id "$INSTANCE_ID" \
    --iam-instance-profile "Name=$ROLE" --query 'IamInstanceProfileAssociation.State' --output text
elif [[ "$current" == *":instance-profile/$ROLE" ]]; then
  echo "déjà associé"
else
  echo "ATTENTION : l'instance a déjà le profil $current (peut-être utilisé par un autre projet)."
  echo "Il n'est PAS remplacé. Ajouter plutôt la politique dig-backup-s3 au rôle de ce profil :"
  echo "  aws iam put-role-policy --role-name <rôle> --policy-name dig-backup-s3 --policy-document file://deploy/aws/instance-role-policy.json (après remplacement de __BUCKET__)"
fi

step "Terminé. Sur le serveur : installer l'AWS CLI puis le drop-in décrit dans docs/OPERATIONS.md."
