#!/usr/bin/env bash
# One-command deploy/migrate harmedi onto a fresh Fly.io Sprite (inherits connectors by name_prefix).
# Usage: ./scripts/redeploy.sh crystal-amber-hawk-3 [github-hook-id]
set -euo pipefail

SPRITE_NAME="${1:?Usage: ./scripts/redeploy.sh <sprite-name> [github-hook-id]}"
HOOK_ID="${2:-717307544}"
REPO="${HARMEDI_REPO:-ryssroad/harmedi}"
INBOX="${HARMEDI_INBOX:-alephzero@agentmail.to}"
CREATOR_EMAIL="${CREATOR_EMAIL:-}"

SECRET="$(openssl rand -hex 24)"

echo "== Creating sprite ${SPRITE_NAME} =="
sprite create --skip-console "${SPRITE_NAME}" || true

URL="$(sprite info -s "${SPRITE_NAME}" | awk '/^URL:/ {print $2}')"
echo "== Sprite URL: ${URL} =="

echo "== Cloning & starting harmedi inside ${SPRITE_NAME} =="
sprite exec -s "${SPRITE_NAME}" -- bash -lc "
set -euo pipefail
rm -rf /home/sprite/harmedi
git clone https://github.com/${REPO}.git /home/sprite/harmedi
cd /home/sprite/harmedi
cat > .env <<EOF
PINECONE_INDEX=harmedi
PINECONE_API_VERSION=2026-04
MUTATOR=auto
ANTHROPIC_MODEL=claude-sonnet-5-5
JEV_MODEL=jev-latest
HARMEDI_REPO=${REPO}
CREATOR_GITHUB=ryssroad
HARMEDI_INBOX=${INBOX}
CREATOR_EMAIL=${CREATOR_EMAIL}
GITHUB_WEBHOOK_SECRET=${SECRET}
AUTO_RESTORE_SPRITE=0
PORT=8080
EOF
sprite-env services delete harmedi 2>/dev/null || true
bash scripts/on-sprite.sh
sprite-env checkpoints create --comment 'gen-0 baseline'
"

echo "== Setting public URL =="
sprite config update -s "${SPRITE_NAME}" --url-auth public

if command -v gh >/dev/null 2>&1 && [ -n "${HOOK_ID}" ]; then
  echo "== Updating GitHub webhook #${HOOK_ID} -> ${URL}/github =="
  gh api -X PATCH "repos/${REPO}/hooks/${HOOK_ID}" \
    -F active=true \
    -f 'events[]=push' \
    -f "config[url]=${URL}/github" \
    -f "config[content_type]=json" \
    -f "config[secret]=${SECRET}" \
    --jq '{id, active, url: .config.url}'
fi

echo "== Verifying ${URL}/api/state =="
curl -s "${URL}/api/state" | node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8")); console.log({onSprite:s.onSprite, gen:s.generation, connectors:s.connectors.map(c=>c.provider), checkpoints:s.checkpoints.length});'
