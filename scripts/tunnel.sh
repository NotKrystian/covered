#!/usr/bin/env bash
# Expose the local Next app (port 3000) through a Cloudflare Tunnel.
#
# Two modes, chosen from ~/.config/covered/cloudflare.env (never in the repo):
#   named  — CLOUDFLARE_TUNNEL_TOKEN is set  -> https://covered.kawuc.uk
#   quick  — no tunnel token                 -> a throwaway https://*.trycloudflare.com URL
#
# To get the named tunnel, give the Cloudflare API token `Cloudflare Tunnel:Edit`
# and `DNS:Edit` on kawuc.uk, then run infra/cloudflare/setup-tunnel.py once.
set -euo pipefail

ENV_FILE="${COVERED_CF_ENV:-$HOME/.config/covered/cloudflare.env}"
LOCAL_URL="${LOCAL_URL:-http://localhost:3000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not installed (brew install cloudflared)" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
  echo "tunnel: named -> https://covered.kawuc.uk"
  exec cloudflared tunnel run --token "$CLOUDFLARE_TUNNEL_TOKEN"
fi

echo "tunnel: quick (no CLOUDFLARE_TUNNEL_TOKEN in $ENV_FILE)"
echo "tunnel: watch below for the https://*.trycloudflare.com URL"
exec cloudflared tunnel --url "$LOCAL_URL" --no-autoupdate
