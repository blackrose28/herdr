#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/herdr/hub"
DASHBOARD_DIR="/opt/herdr/dashboard"
SERVICE_NAME="herdr-hub"
SERVICE_USER="herdr"
HERDR_DOMAIN="${HERDR_DOMAIN:-_}"
ENABLE_ORIGIN_SSL="${ENABLE_ORIGIN_SSL:-0}"

echo "==> Installing system packages..."
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl ca-certificates build-essential python3 nginx
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  echo "==> Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi

echo "==> Node $(node --version), npm $(npm --version)"

# ─── PostgreSQL ─────────────────────────────────────────────────────────────────

echo "==> Setting up PostgreSQL..."
if ! command -v psql >/dev/null 2>&1; then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-contrib
  sudo systemctl enable postgresql
  sudo systemctl start postgresql
fi

# Create DB user and database if they don't exist
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname = 'herdr'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE herdr WITH LOGIN PASSWORD 'herdr';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = 'herdr_hub'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE herdr_hub OWNER herdr;"

echo "==> PostgreSQL ready (herdr_hub database)"

# ─── Service User ───────────────────────────────────────────────────────────────

echo "==> Creating service user..."
if ! id "$SERVICE_USER" &>/dev/null; then
  sudo useradd --system --home-dir /opt/herdr --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ─── Hub Application ────────────────────────────────────────────────────────────

echo "==> Setting up Hub at $APP_DIR..."
sudo mkdir -p /opt/herdr
sudo rsync -a --delete \
  --exclude node_modules \
  --exclude data \
  --exclude .env \
  --exclude deploy \
  ./ "$APP_DIR/"

# Copy deploy directory (needed for nginx configs and service file)
sudo rsync -a deploy/ "$APP_DIR/deploy/"

if [[ -f .env ]]; then
  sudo cp .env "$APP_DIR/.env"
fi
sudo chown -R "$SERVICE_USER:$SERVICE_USER" /opt/herdr

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "ERROR: $APP_DIR/.env not found. Deploy script should upload it first." >&2
  exit 1
fi
sudo chown "$SERVICE_USER:$SERVICE_USER" "$APP_DIR/.env"
sudo chmod 600 "$APP_DIR/.env"

echo "==> Installing npm dependencies and building Hub..."
cd "$APP_DIR"
sudo -u "$SERVICE_USER" npm ci
sudo -u "$SERVICE_USER" npm run build
sudo -u "$SERVICE_USER" npm prune --omit=dev

echo "==> Running database migrations..."
sudo -u "$SERVICE_USER" npx drizzle-kit migrate 2>&1 || echo "    (migrations may already be applied)"

# ─── Dashboard ──────────────────────────────────────────────────────────────────

echo "==> Building and deploying Dashboard..."
DASHBOARD_SRC="$(dirname "$APP_DIR")/dashboard-src"

if [[ -d "$DASHBOARD_SRC" ]]; then
  cd "$DASHBOARD_SRC"
  sudo -u "$SERVICE_USER" npm ci
  sudo -u "$SERVICE_USER" npm run build

  sudo rm -rf "$DASHBOARD_DIR"
  sudo cp -r dist "$DASHBOARD_DIR"
  sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$DASHBOARD_DIR"
  echo "    Dashboard deployed to $DASHBOARD_DIR"
else
  echo "    WARNING: Dashboard source not found at $DASHBOARD_SRC"
  echo "    Dashboard will not be updated."
fi

# ─── Systemd ────────────────────────────────────────────────────────────────────

echo "==> Installing systemd unit..."
sudo cp "$APP_DIR/deploy/herdr-hub.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

# ─── Nginx ──────────────────────────────────────────────────────────────────────

echo "==> Configuring nginx reverse proxy (port 80 -> 127.0.0.1:3850)..."
sudo sed "s/_HERDR_DOMAIN_PLACEHOLDER_/${HERDR_DOMAIN}/g" \
  "$APP_DIR/deploy/nginx-herdr-hub.conf" | sudo tee /etc/nginx/sites-available/herdr-hub >/dev/null
sudo ln -sf /etc/nginx/sites-available/herdr-hub /etc/nginx/sites-enabled/herdr-hub

if [[ "$ENABLE_ORIGIN_SSL" == "1" && -f /etc/ssl/herdr/origin.pem && -f /etc/ssl/herdr/origin.key ]]; then
  echo "==> Enabling HTTPS on port 443 (origin certificate)..."
  sudo sed "s/_HERDR_DOMAIN_PLACEHOLDER_/${HERDR_DOMAIN}/g" \
    "$APP_DIR/deploy/nginx-herdr-hub-ssl.conf" | sudo tee /etc/nginx/sites-available/herdr-hub-ssl >/dev/null
  sudo ln -sf /etc/nginx/sites-available/herdr-hub-ssl /etc/nginx/sites-enabled/herdr-hub-ssl
fi

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl reload nginx

# ─── Health Check ───────────────────────────────────────────────────────────────

echo "==> Waiting for health checks..."
for _ in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:3850/health" >/dev/null 2>&1 \
    && curl -sf "http://127.0.0.1/health" >/dev/null 2>&1; then
    echo "==> Service is healthy (direct + nginx)."
    curl -s "http://127.0.0.1/health" | head -c 500
    echo
    exit 0
  fi
  sleep 2
done

echo "ERROR: Health check failed. Recent logs:" >&2
sudo journalctl -u "$SERVICE_NAME" -n 40 --no-pager >&2
sudo journalctl -u nginx -n 20 --no-pager >&2
exit 1
