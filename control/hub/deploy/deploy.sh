#!/usr/bin/env bash
set -euo pipefail

SSH_USER="${SSH_USER:-chuonglevan}"
SSH_HOST="${SSH_HOST:-34.132.245.157}"
SSH_TARGET="${SSH_USER}@${SSH_HOST}"
REMOTE_STAGE="/tmp/herdr-hub-deploy"
CONTROL_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HUB_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DASHBOARD_ROOT="${CONTROL_ROOT}/dashboard"
HERDR_DOMAIN="${HERDR_DOMAIN:-_}"

SSH_CMD=(ssh)
SCP_CMD=(scp)
RSYNC_SSH="ssh"
if [[ -n "${SSH_IDENTITY_FILE:-}" ]]; then
  SSH_CMD=(ssh -i "$SSH_IDENTITY_FILE" -o IdentitiesOnly=yes)
  SCP_CMD=(scp -i "$SSH_IDENTITY_FILE" -o IdentitiesOnly=yes)
  RSYNC_SSH="ssh -i ${SSH_IDENTITY_FILE} -o IdentitiesOnly=yes"
fi

echo "==> Deploying Herdr Hub to ${SSH_TARGET}"
if [[ "$HERDR_DOMAIN" != "_" ]]; then
  echo "    Domain: ${HERDR_DOMAIN}"
fi

# ─── Validate .env ──────────────────────────────────────────────────────────────

ENV_SOURCE="${ENV_FILE:-${HUB_ROOT}/.env}"
if [[ ! -f "$ENV_SOURCE" ]]; then
  echo "ERROR: ${ENV_SOURCE} not found. Copy .env.example and configure it first." >&2
  exit 1
fi

# Production overrides: bind locally; nginx exposes port 80/443.
PROD_ENV="$(mktemp)"
trap 'rm -f "$PROD_ENV"' EXIT

python3 - "$ENV_SOURCE" "$PROD_ENV" <<'PY'
import secrets
import sys

src, dst = sys.argv[1], sys.argv[2]
lines = []
has_host = False
has_token = False
has_port = False

with open(src) as f:
    for raw in f:
        line = raw.rstrip("\n")
        if line.startswith("HOST="):
            lines.append("HOST=127.0.0.1")
            has_host = True
            continue
        if line.startswith("PORT="):
            lines.append("PORT=3850")
            has_port = True
            continue
        if line.startswith("HUB_ACCESS_TOKEN="):
            value = line.split("=", 1)[1]
            if not value or value == "herdr-hub-dev-token":
                value = secrets.token_urlsafe(32)
            lines.append(f"HUB_ACCESS_TOKEN={value}")
            has_token = True
            continue
        lines.append(line)

if not has_host:
    lines.append("HOST=127.0.0.1")
if not has_port:
    lines.append("PORT=3850")
if not has_token:
    lines.append(f"HUB_ACCESS_TOKEN={secrets.token_urlsafe(32)}")

with open(dst, "w") as f:
    f.write("\n".join(lines) + "\n")
PY

# ─── Sync Hub ───────────────────────────────────────────────────────────────────

echo "==> Syncing Hub files..."
"${SSH_CMD[@]}" "$SSH_TARGET" "rm -rf '$REMOTE_STAGE' && mkdir -p '$REMOTE_STAGE'"
rsync -az --delete -e "$RSYNC_SSH" \
  --exclude node_modules \
  --exclude dist \
  --exclude data \
  --exclude .env \
  "${HUB_ROOT}/" "${SSH_TARGET}:${REMOTE_STAGE}/"

# ─── Sync Dashboard ────────────────────────────────────────────────────────────

if [[ -d "$DASHBOARD_ROOT" ]]; then
  echo "==> Syncing Dashboard files..."
  rsync -az --delete -e "$RSYNC_SSH" \
    --exclude node_modules \
    --exclude dist \
    --exclude .env \
    "${DASHBOARD_ROOT}/" "${SSH_TARGET}:/opt/herdr/dashboard-src/"
else
  echo "    WARNING: Dashboard not found at $DASHBOARD_ROOT"
fi

# ─── Upload .env ────────────────────────────────────────────────────────────────

echo "==> Uploading production .env..."
"${SCP_CMD[@]}" "$PROD_ENV" "${SSH_TARGET}:${REMOTE_STAGE}/.env"

# ─── Run Remote Install ────────────────────────────────────────────────────────

echo "==> Running remote install..."
"${SSH_CMD[@]}" "$SSH_TARGET" "cd '$REMOTE_STAGE' && chmod +x deploy/install.sh && HERDR_DOMAIN='${HERDR_DOMAIN}' ./deploy/install.sh"

# ─── Summary ────────────────────────────────────────────────────────────────────

echo "==> Deployment complete."
if [[ "$HERDR_DOMAIN" != "_" ]]; then
  echo "    Health (after DNS): https://${HERDR_DOMAIN}/health"
  echo "    Dashboard: https://${HERDR_DOMAIN}/"
else
  echo "    Health (direct IP): http://${SSH_HOST}/health"
  echo "    Dashboard: http://${SSH_HOST}/"
fi
echo "    Hub token: /opt/herdr/hub/.env on the server"
echo "    Open GCP firewall TCP 80 (and 443 if using origin SSL)."
