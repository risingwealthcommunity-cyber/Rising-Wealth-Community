#!/bin/sh
# Daily backup of the database. Run from the repo folder on the server:  sh deploy/backup.sh
# Keeps the last 14 backups in /var/backups/rwc, and copies each one to Cloudflare R2 when R2_* are set in deploy/.env.
set -eu
cd "$(dirname "$0")/.."
DIR=/var/backups/rwc
mkdir -p "$DIR"
FILE="$DIR/rwc-$(date +%F-%H%M).sql.gz"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db pg_dump -U rwc rwc | gzip > "$FILE"
[ -s "$FILE" ] || { echo "Backup is empty, something is wrong" >&2; rm -f "$FILE"; exit 1; }
echo "Saved $FILE"
find "$DIR" -name 'rwc-*.sql.gz' -mtime +14 -delete

# optional: a copy in R2 (the same bucket, under backups/)
# read only the R2 values, as plain text (a value with spaces, like a mail app password, must not be run as a command)
envval() { grep -E "^$1=" deploy/.env | head -1 | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//'; }
R2_ENDPOINT=$(envval R2_ENDPOINT); R2_BUCKET=$(envval R2_BUCKET)
R2_ACCESS_KEY_ID=$(envval R2_ACCESS_KEY_ID); R2_SECRET_ACCESS_KEY=$(envval R2_SECRET_ACCESS_KEY)
if [ -n "${R2_ENDPOINT:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ]; then
  docker run --rm -v "$DIR:/b" -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" -e AWS_DEFAULT_REGION=auto \
    amazon/aws-cli s3 cp "/b/$(basename "$FILE")" "s3://$R2_BUCKET/backups/$(basename "$FILE")" --endpoint-url "$R2_ENDPOINT" \
    && echo "Copied to R2" || echo "R2 copy failed (the local backup is safe)" >&2
fi
