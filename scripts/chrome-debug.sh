#!/usr/bin/env bash
# OPT-IN ONLY. Launch a Chromium-based browser the user names explicitly, with a
# remote-debugging port, so the reader can attach to it (COVERED_READER_CDP).
#
# This script never picks a browser on its own and never touches a real
# profile. It does nothing unless COVERED_CHROME_APP is set. On first run it
# COPIES the profile you name in COVERED_CHROME_PROFILE_SRC (caches excluded)
# to $TMPDIR/covered-chrome-profile and launches that copy; with no source it
# starts a blank profile in the same place.
#
#   COVERED_CHROME_APP="/Applications/Google Chrome.app" \
#   COVERED_CHROME_PROFILE_SRC="$HOME/Library/Application Support/Google/Chrome" \
#   scripts/chrome-debug.sh            # start (or report an already-running one)
#   scripts/chrome-debug.sh stop       # quit only the instance on the profile copy
#
# Env: COVERED_CHROME_APP (required .app bundle), COVERED_CHROME_PROFILE_SRC
#      (optional profile dir to copy), COVERED_CDP_PORT (default 9222).
# Prints no cookies or profile content.
set -euo pipefail

PORT="${COVERED_CDP_PORT:-9222}"
CDP_URL="http://127.0.0.1:${PORT}"
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"
DEST="${TMP_ROOT}/covered-chrome-profile"

if [[ "${1:-}" == "stop" ]]; then
  # Only the instance on our profile copy; never the user's real browser.
  PIDS="$(pgrep -f -- "--user-data-dir=${DEST}" || true)"
  if [[ -n "${PIDS}" ]]; then
    kill ${PIDS} 2>/dev/null || true
    echo "stopped debug browser on ${DEST}"
  else
    echo "no debug browser running on ${DEST}"
  fi
  exit 0
fi

APP="${COVERED_CHROME_APP:-}"
if [[ -z "${APP}" ]]; then
  echo "chrome-debug.sh: doing nothing. Set COVERED_CHROME_APP=/path/to/Browser.app to opt in to attaching the reader to a browser you choose; the default reader is headless Playwright and needs no browser of yours."
  exit 0
fi
if [[ ! -d "${APP}" ]]; then
  echo "COVERED_CHROME_APP=${APP} is not an .app bundle" >&2
  exit 1
fi

# Already up? Then just print the endpoint.
if curl -sf --max-time 2 "${CDP_URL}/json/version" >/dev/null 2>&1; then
  echo "debug browser already listening"
  echo "COVERED_READER_CDP=${CDP_URL}"
  exit 0
fi

SRC="${COVERED_CHROME_PROFILE_SRC:-}"
if [[ ! -d "${DEST}/Default" ]]; then
  mkdir -p "${DEST}"
  if [[ -n "${SRC}" && -d "${SRC}/Default" ]]; then
    echo "copying profile (caches excluded) -> ${DEST}"
    rsync -a --quiet \
      --exclude 'Cache*' --exclude '*Cache' --exclude 'Code Cache' --exclude 'GPUCache' \
      --exclude 'Service Worker' --exclude 'Crashpad' --exclude 'Singleton*' \
      --exclude '*.pma' --exclude 'BrowserMetrics*' --exclude 'component_crx_cache' \
      --exclude 'extensions_crx_cache' --exclude 'optimization_guide_model_store' \
      --exclude 'Safe Browsing' --exclude 'segmentation_platform' \
      "${SRC}/" "${DEST}/"
    echo "profile copied ($(du -sh "${DEST}" | cut -f1))"
  else
    echo "no COVERED_CHROME_PROFILE_SRC; starting a blank profile in ${DEST}"
  fi
else
  echo "reusing profile copy at ${DEST}"
fi
rm -f "${DEST}"/Singleton* 2>/dev/null || true

echo "browser: $(basename "${APP}" .app)"
# `open -n` starts a separate instance through launchd, detached from this shell.
open -na "${APP}" --args \
  --remote-debugging-port="${PORT}" \
  --user-data-dir="${DEST}" \
  --no-first-run --no-default-browser-check \
  --window-size=1280,900 \
  --lang=en-GB \
  "about:blank"

for _ in $(seq 1 40); do
  if curl -sf --max-time 2 "${CDP_URL}/json/version" >/dev/null 2>&1; then
    echo "debug browser ready"
    echo "COVERED_READER_CDP=${CDP_URL}"
    exit 0
  fi
  sleep 0.5
done

echo "browser did not open ${CDP_URL} within 20s" >&2
exit 1
