#!/bin/bash
# Monthly Yadata refresh — designed to be triggered by launchd.
#
# Strategy:
#   1. Launch a dedicated Chrome instance with --remote-debugging-port=9222
#      (separate profile so it doesn't fight with the user's normal Chrome).
#   2. Run the scraper in --connect mode against that Chrome.
#   3. Kill the Chrome instance.
#   4. Import the result into the DB.
#   5. Log everything to ~/Library/Logs/Karnaf/yadata-refresh.log
#
# Because we use a real (non-headless) Chrome session, Cloudflare's bot
# challenge clears automatically the first time and stays cleared for repeat
# requests in the same session.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/paths.sh"
LOG_FILE="$LOG_DIR/yadata-refresh.log"
CHROME_PROFILE="$HOME/Library/Caches/karnaf-chrome-yadata-profile"


mkdir -p "$LOG_DIR" "$CHROME_PROFILE"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

cleanup_chrome() {
  pkill -f -- "--user-data-dir=$CHROME_PROFILE" 2>/dev/null || true
}

log "═══════════════════════════════════════════════"
log "Yadata monthly refresh starting"
log "═══════════════════════════════════════════════"

cd "$PROJECT_DIR" || { log "✗ project dir not found"; exit 1; }

# Make sure no stale instance is using the port
cleanup_chrome
sleep 2

# Launch the dedicated Chrome instance
log "→ launching Chrome with remote debugging on :9222 (profile: $CHROME_PROFILE)"
"$CHROME_BIN" \
  --remote-debugging-port=9222 \
  --user-data-dir="$CHROME_PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1280,800 \
  about:blank \
  >> "$LOG_FILE" 2>&1 &
CHROME_PID=$!
log "  → Chrome started (PID=$CHROME_PID), waiting for debug port"

# Wait for Chrome to bind the port
for i in $(seq 1 20); do
  if curl -sf --max-time 1 http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    log "  → Chrome ready after ${i}s"
    break
  fi
  sleep 1
done

if ! curl -sf --max-time 2 http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
  log "✗ Chrome failed to expose port 9222"
  cleanup_chrome
  exit 2
fi

# Run the scraper
log "→ running scrape_yadata.ts --connect"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
npx tsx scripts/scrape_yadata.ts --connect >> "$LOG_FILE" 2>&1
SCRAPE_EXIT=$?
log "  → scraper exit code: $SCRAPE_EXIT"

# Stop Chrome
log "→ shutting down Chrome"
cleanup_chrome
sleep 2

# Import to DB
if [ $SCRAPE_EXIT -eq 0 ]; then
  log "→ importing fresh data into DB"
  npx tsx lib/import-yad2.ts >> "$LOG_FILE" 2>&1
  IMPORT_EXIT=$?
  log "  → import exit code: $IMPORT_EXIT"
else
  log "✗ skipping import because scrape failed"
fi

log "═══ Done. See above for results. ═══"
log ""
