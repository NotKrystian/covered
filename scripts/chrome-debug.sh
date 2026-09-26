#!/usr/bin/env bash
# Launch the user's own Chrome with a remote-debugging port so the reader can
# attach to it (COVERED_READER_CDP). Google is far more likely to draw the
# Shopping grid for a real signed-in profile than for a fresh headless one.
#
# The real profile is never touched: on first run it is COPIED (rsync, caches
# excluded) to $TMPDIR/covered-chrome-profile. Chrome refuses the debugging
# port on a profile that is already open, and we do not want to mutate the
# user's data, so the copy is the one we launch.
#
#   scripts/chrome-debug.sh          # start (or report an already-running one)
#   scripts/chrome-debug.sh stop     # quit the debug Chrome we started
#
# Env: COVERED_CDP_PORT (default 9222), COVERED_CHROME_APP (override .app bundle),
#      COVERED_CHROME_PROFILE_SRC (override source profile dir).
# This script prints no cookies or profile content.
set -euo pipefail

PORT="${COVERED_CDP_PORT:-9222}"
CDP_URL="http://127.0.0.1:${PORT}"
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"
DEST="${TMP_ROOT}/covered-chrome-profile"
PID_FILE="${DEST}.pid"
APP_SUPPORT="${HOME}/Library/Application Support"

if [[ "${1:-}" == "stop" ]]; then
  # Only the instance on our profile copy; never the user's real browser.
  PIDS="$(pgrep -f -- "--user-data-dir=${DEST}" || true)"
  if [[ -n "${PIDS}" ]]; then
    kill ${PIDS} 2>/dev/null || true
    echo "stopped debug browser"
  else
    echo "no debug browser running on ${DEST}"
  fi
  rm -f "${PID_FILE}"
  exit 0
fi

# Already up? Then just print the endpoint.
if curl -sf --max-time 2 "${CDP_URL}/json/version" >/dev/null 2>&1; then
  echo "debug browser already listening"
  echo "COVERED_READER_CDP=${CDP_URL}"
  exit 0
fi

# Google Chrome first, per the spec; fall back to other Chromium browsers on
# this Mac so the demo still has a real profile to attach to.
APP="${COVERED_CHROME_APP:-}"
SRC="${COVERED_CHROME_PROFILE_SRC:-}"
pick() {
  local app="$1" src="$2"
  if [[ -z "${APP}" && -d "${app}" ]]; then
    APP="${app}"
    [[ -z "${SRC}" ]] && SRC="${src}"
  fi
}
pick "/Applications/Google Chrome.app" "${APP_SUPPORT}/Google/Chrome"
pick "${HOME}/Applications/Google Chrome.app" "${APP_SUPPORT}/Google/Chrome"
pick "/Applications/Chromium.app" "${APP_SUPPORT}/Chromium"
pick "/Applications/Brave Browser.app" "${APP_SUPPORT}/BraveSoftware/Brave-Browser"
pick "/Applications/Microsoft Edge.app" "${APP_SUPPORT}/Microsoft Edge"

if [[ -z "${APP}" ]]; then
  echo "no Chromium-based browser found; install Google Chrome or set COVERED_CHROME_APP=/path/to/Browser.app" >&2
  exit 1
fi
APP_NAME="$(basename "${APP}" .app)"
echo "browser: ${APP_NAME}"

# First run: copy the profile, caches excluded. Later runs reuse the copy so
# any consent choice made in the debug window sticks.
if [[ ! -d "${DEST}/Default" ]]; then
  if [[ ! -d "${SRC}/Default" ]]; then
    echo "no profile at ${SRC}; starting with a blank profile in ${DEST}" >&2
    mkdir -p "${DEST}"
  else
    echo "copying profile (caches excluded) -> ${DEST}"
    mkdir -p "${DEST}"
    rsync -a --quiet \
      --exclude 'Cache*' --exclude '*Cache' --exclude 'Code Cache' --exclude 'GPUCache' \
      --exclude 'Service Worker' --exclude 'Crashpad' --exclude 'Singleton*' \
      --exclude '*.pma' --exclude 'BrowserMetrics*' --exclude 'component_crx_cache' \
      --exclude 'extensions_crx_cache' --exclude 'optimization_guide_model_store' \
      --exclude 'Safe Browsing' --exclude 'segmentation_platform' \
      "${SRC}/" "${DEST}/"
    echo "profile copied ($(du -sh "${DEST}" | cut -f1))"
  fi
else
  echo "reusing profile copy at ${DEST}"
fi
rm -f "${DEST}"/Singleton* 2>/dev/null || true

# `open -n` starts a separate instance through launchd, detached from this
# shell, so it survives the script (and the terminal) exiting.
open -na "${APP}" --args \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="${DEST}" \
  --no-first-run --no-default-browser-check \
  --window-size=1280,900 \
  --lang=en-GB \
  "about:blank"

for _ in $(seq 1 40); do
  if curl -sf --max-time 2 "${CDP_URL}/json/version" >/dev/null 2>&1; then
    # The main browser process is the one holding our unique --user-data-dir.
    pgrep -f -- "--user-data-dir=${DEST}" | sort -n | head -1 > "${PID_FILE}" || true
    echo "debug browser ready (pid $(cat "${PID_FILE}" 2>/dev/null || echo '?'))"
    echo "COVERED_READER_CDP=${CDP_URL}"
    exit 0
  fi
  sleep 0.5
done

echo "browser did not open ${CDP_URL} within 20s" >&2
exit 1
