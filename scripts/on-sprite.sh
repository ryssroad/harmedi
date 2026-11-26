#!/usr/bin/env bash
# Run inside the Fly.io Sprite after cloning harmedi there.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Node & preinstalled agents =="
node -v
which claude codex git sprite-env || true

echo "== Connected Sprites Connectors =="
curl -s https://api.sprites.dev/v1/gateway/list | node -e '
  const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const c of d.connections || []) console.log("  ✓", c.provider, "→", c.gateway_base_url);
  if (!(d.connections || []).length) console.log("  (none yet — connect them in the Sprites dashboard)");
'

# Register persistent HTTP service on :8080 (auto-starts on HTTP wake)
sprite-env services create harmedi \
  --cmd node \
  --args "--no-warnings,cage/server.ts" \
  --dir "$PWD" \
  --http-port 8080 || true

sprite-env services list

echo
echo "Next steps from your laptop:"
echo "  1. sprite url update -s <sprite-name> --auth public"
echo "  2. Point GitHub webhook (push)        → https://<sprite-url>/github"
echo "  3. Point AgentMail (message.received) → https://<sprite-url>/agentmail"
