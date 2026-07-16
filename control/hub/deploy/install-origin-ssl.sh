#!/usr/bin/env bash
set -euo pipefail

# Install a Cloudflare origin certificate on the server.
# Generate the cert in Cloudflare: SSL/TLS -> Origin Server -> Create Certificate.
# Save PEM as origin.pem and private key as origin.key, then run:
#   ORIGIN_CERT=./origin.pem ORIGIN_KEY=./origin.key HERDR_DOMAIN=herdr.chuonglv.site ./deploy/install-origin-ssl.sh

SSH_USER="${SSH_USER:-chuonglevan}"
SSH_HOST="${SSH_HOST:-34.132.245.157}"
SSH_TARGET="${SSH_USER}@${SSH_HOST}"
HERDR_DOMAIN="${HERDR_DOMAIN:?Set HERDR_DOMAIN=subdomain.example.com}"
ORIGIN_CERT="${ORIGIN_CERT:?Set ORIGIN_CERT path to Cloudflare origin PEM}"
ORIGIN_KEY="${ORIGIN_KEY:?Set ORIGIN_KEY path to Cloudflare origin private key}"

ssh "$SSH_TARGET" "sudo mkdir -p /etc/ssl/herdr && sudo chmod 700 /etc/ssl/herdr"
scp "$ORIGIN_CERT" "${SSH_TARGET}:/tmp/herdr-origin.pem"
scp "$ORIGIN_KEY" "${SSH_TARGET}:/tmp/herdr-origin.key"
ssh "$SSH_TARGET" "sudo mv /tmp/herdr-origin.pem /etc/ssl/herdr/origin.pem && sudo mv /tmp/herdr-origin.key /etc/ssl/herdr/origin.key && sudo chmod 600 /etc/ssl/herdr/origin.key /etc/ssl/herdr/origin.pem"

HUB_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ssh "$SSH_TARGET" "sudo sed 's/_HERDR_DOMAIN_PLACEHOLDER_/${HERDR_DOMAIN}/g' -" \
  < "${HUB_ROOT}/deploy/nginx-herdr-hub-ssl.conf" \
  | ssh "$SSH_TARGET" "sudo tee /etc/nginx/sites-available/herdr-hub-ssl >/dev/null"
ssh "$SSH_TARGET" "sudo ln -sf /etc/nginx/sites-available/herdr-hub-ssl /etc/nginx/sites-enabled/herdr-hub-ssl && sudo nginx -t && sudo systemctl reload nginx"

echo "==> Origin SSL enabled on port 443 for ${HERDR_DOMAIN}"
echo "    Set Cloudflare SSL/TLS mode to Full (strict)."
