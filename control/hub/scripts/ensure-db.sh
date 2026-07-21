#!/usr/bin/env bash
# Ensure the PostgreSQL container is running and ready before starting the hub.
# Used by `npm run dev` to make local development failsafe.

set -euo pipefail

COMPOSE_FILE="$(dirname "$0")/../../docker-compose.yml"
SERVICE_NAME="postgres"
MAX_WAIT=30  # seconds

# Resolve the compose file path
COMPOSE_FILE="$(cd "$(dirname "$COMPOSE_FILE")" && pwd)/$(basename "$COMPOSE_FILE")"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "⚠  docker-compose.yml not found at $COMPOSE_FILE, skipping DB check"
  exit 0
fi

echo "🐘 Ensuring PostgreSQL is running..."

# Start the postgres service if not already running
docker compose -f "$COMPOSE_FILE" up -d "$SERVICE_NAME" 2>/dev/null || \
  docker-compose -f "$COMPOSE_FILE" up -d "$SERVICE_NAME" 2>/dev/null || {
    echo "⚠  Could not start PostgreSQL via docker compose — is Docker running?"
    exit 1
  }

# Wait for healthy
echo "⏳ Waiting for PostgreSQL to be ready (max ${MAX_WAIT}s)..."
elapsed=0
while [ $elapsed -lt $MAX_WAIT ]; do
  if docker compose -f "$COMPOSE_FILE" exec -T "$SERVICE_NAME" \
       pg_isready -U herdr -d herdr_hub -q 2>/dev/null; then
    echo "✅ PostgreSQL is ready"

    # Run migrations to ensure tables exist (idempotent — skips if already applied)
    SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
    echo "📦 Running database migrations..."
    npx drizzle-kit migrate --config "$SCRIPT_DIR/drizzle.config.ts" 2>&1 | tail -1
    exit 0
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

echo "❌ PostgreSQL did not become ready within ${MAX_WAIT}s"
exit 1
