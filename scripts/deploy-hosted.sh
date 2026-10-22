#!/usr/bin/env bash
# The hosted deploy, in one command. Everything comes from .env.local.
#
#   Supabase: link, migrations, functions, the player pool, the client's config
#   Netlify:  the published dist/
#
# Safe to re-run: migrations are versioned, the pool upserts, the functions and
# the site replace themselves.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

missing=0
for name in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD \
            SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
            NETLIFY_AUTH_TOKEN NETLIFY_SITE_NAME; do
  if [ -z "${!name:-}" ]; then
    echo "missing $name (set it in .env.local)" >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  exit 1
fi

case "$SUPABASE_URL" in
  https://*) ;;
  *) echo "SUPABASE_URL must start with https:// (got '$SUPABASE_URL')" >&2; exit 1 ;;
esac

echo "==> Linking $SUPABASE_PROJECT_REF"
npx supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD" --yes

echo "==> Pushing the migrations"
npx supabase db push --password "$SUPABASE_DB_PASSWORD" --yes

echo "==> Deploying the functions"
npm run supabase:deploy

echo "==> Uploading the player pool"
npm run supabase:upload

echo "==> Pointing the client at the project"
npm run supabase:sync

echo "==> Publishing the site"
npm run publish

echo "==> Deploying to Netlify"
team=()
if [ -n "${NETLIFY_TEAM:-}" ]; then
  team=(--team "$NETLIFY_TEAM")
fi
npx netlify deploy --prod --no-build --dir=dist \
  --auth "$NETLIFY_AUTH_TOKEN" \
  --site-name "$NETLIFY_SITE_NAME" \
  "${team[@]}"

echo
echo "Done. The site is at https://$NETLIFY_SITE_NAME.netlify.app"
echo "client/src/config.js now points at $SUPABASE_URL - commit it."
