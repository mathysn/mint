#!/usr/bin/env bash
# Nightly database dump (cron: /etc/cron.d/mint, written by setup.sh).
# Keeps BACKUP_KEEP_DAYS days in /opt/mint/backups and, if R2 is set in .env, a copy on Cloudflare R2.
# Restore: deploy/restore.md.
set -euo pipefail
cd "$(dirname "$0")/.."

val() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- | tr -d '\r' || true; }
KEEP="$(val BACKUP_KEEP_DAYS)"; KEEP="${KEEP:-14}"

mkdir -p backups
chmod 700 backups
name="mint-$(date -u +%Y-%m-%d-%H%M).dump"
docker compose exec -T postgres pg_dump -U mint -d mint -Fc > "backups/$name.part"
mv "backups/$name.part" "backups/$name"
find backups -name 'mint-*.dump' -mtime "+$KEEP" -delete
echo "$(date -u +%FT%TZ) dump ok: $name ($(du -h "backups/$name" | cut -f1))"

ACCOUNT="$(val R2_ACCOUNT_ID)"
if [[ -n "$ACCOUNT" ]]; then
  r2=(
    -e RCLONE_CONFIG_R2_TYPE=s3
    -e RCLONE_CONFIG_R2_PROVIDER=Cloudflare
    -e "RCLONE_CONFIG_R2_ACCESS_KEY_ID=$(val R2_ACCESS_KEY_ID)"
    -e "RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$(val R2_SECRET_ACCESS_KEY)"
    -e "RCLONE_CONFIG_R2_ENDPOINT=https://$ACCOUNT.r2.cloudflarestorage.com"
    -e RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
  )
  bucket="$(val R2_BUCKET)"
  docker run --rm "${r2[@]}" -v "$PWD/backups:/backups:ro" rclone/rclone:1.68 copy "/backups/$name" "r2:${bucket:-mint-backups}/"
  docker run --rm "${r2[@]}" rclone/rclone:1.68 delete "r2:${bucket:-mint-backups}/" --min-age "${KEEP}d"
  echo "$(date -u +%FT%TZ) copied to R2"
fi
