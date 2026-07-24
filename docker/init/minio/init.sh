#!/bin/sh
set -eu

case "$MINIO_BUCKET" in
  ""|*[!a-z0-9.-]*|.*|-*|*..*|*.-*|*-.*|*-) echo "Invalid MINIO_BUCKET" >&2; exit 1 ;;
esac
[ "${#MINIO_BUCKET}" -ge 3 ] && [ "${#MINIO_BUCKET}" -le 63 ] || {
  echo "MINIO_BUCKET must contain 3 to 63 characters" >&2
  exit 1
}

until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  sleep 1
done

mc mb --ignore-existing "local/$MINIO_BUCKET"
mc anonymous set none "local/$MINIO_BUCKET"
sed "s/__BUCKET__/$MINIO_BUCKET/g" /config/policy.template.json > /tmp/hermes-policy.json
mc admin policy create local hermes-app /tmp/hermes-policy.json
if mc admin user info local "$MINIO_APP_ACCESS_KEY" >/dev/null 2>&1; then
  mc admin user enable local "$MINIO_APP_ACCESS_KEY"
else
  mc admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY"
fi
mc admin policy attach local hermes-app --user "$MINIO_APP_ACCESS_KEY"
mc cors set "local/$MINIO_BUCKET" /config/cors.xml
