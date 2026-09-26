#!/usr/bin/env bash
# Start the demo: `pnpm dev` on :3000 plus the Cloudflare Tunnel, together.
# Ctrl-C stops both. Logs: /tmp/covered-dev.log, /tmp/covered-tunnel.log.
#
# Usage: scripts/demo.sh            (PORT=3100 scripts/demo.sh to use another port)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEV_LOG="${DEV_LOG:-/tmp/covered-dev.log}"
TUNNEL_LOG="${TUNNEL_LOG:-/tmp/covered-tunnel.log}"
PORT="${PORT:-3000}"

pids=()
kill_tree() {
  local pid="$1"
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  echo
  echo "demo: stopping"
  for pid in "${pids[@]:-}"; do
    [[ -n "$pid" ]] && kill_tree "$pid"
  done
  # `pnpm dev` -> `next dev` -> worker; make sure nothing keeps the port.
  for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if lsof -iTCP:"$PORT" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  echo "demo: port $PORT already in use; stop the other server first" >&2
  exit 1
fi

echo "demo: starting pnpm dev on :$PORT (log: $DEV_LOG)"
pnpm dev -p "$PORT" >"$DEV_LOG" 2>&1 &
pids+=("$!")

for _ in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then break; fi
  sleep 1
done
if ! curl -sf -o /dev/null "http://localhost:$PORT/"; then
  echo "demo: Next did not come up on :$PORT; see $DEV_LOG" >&2
  exit 1
fi
echo "demo: Next ready at http://localhost:$PORT"

echo "demo: starting tunnel (log: $TUNNEL_LOG)"
LOCAL_URL="http://localhost:$PORT" scripts/tunnel.sh >"$TUNNEL_LOG" 2>&1 &
pids+=("$!")

# Surface the public URL: fixed hostname for the named tunnel, or the quick-tunnel URL from the log.
for _ in $(seq 1 30); do
  if grep -q "tunnel: named" "$TUNNEL_LOG" 2>/dev/null; then
    echo "demo: public URL https://covered.kawuc.uk"
    break
  fi
  url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1 || true)"
  if [[ -n "$url" ]]; then
    echo "demo: public URL $url"
    break
  fi
  sleep 1
done

echo "demo: running. Ctrl-C to stop both."
wait
