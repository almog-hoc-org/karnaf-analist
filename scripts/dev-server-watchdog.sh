#!/bin/bash
# Karnaf Real-Estate Dev Server Watchdog
# ──────────────────────────────────────
# Checks once whether the dev server is reachable on port 3000.
# If not, spawns a fresh `next dev` bound to all interfaces (so phones on the
# LAN can hit http://<lan-ip>:3000) and detaches it.
#
# Called every 30 minutes by ~/Library/LaunchAgents/com.karnaf.realestate.devserver.plist
#
# Usage (manual): bash scripts/dev-server-watchdog.sh
# Logs:          ~/Library/Logs/Karnaf/devserver.log

set -u

PROJECT_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/תיקיות עבודה/ביזנס/עסק/קרנף ליווי וייעוץ/ניהול עסק/קלוד קוד קרנף/my-realestate-project"
PORT=3000
source "$(dirname "${BASH_SOURCE[0]}")/lib/paths.sh"
LOG_FILE="$LOG_DIR/devserver.log"
PID_FILE="$LOG_DIR/devserver.pid"

mkdir -p "$LOG_DIR"

# Ensure /usr/local/bin is on PATH (where Node/npx live on Homebrew Intel and Apple-Silicon Macs).
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Health probes hit $BASE_PATH, not "/". Under a basePath the root returns 404,
# so a hardcoded "/" would read every healthy server as dead and restart it in a
# loop. /api/health is also a better probe than the homepage: it is cheap and it
# does not depend on page rendering.
BASE_PATH="${NEXT_PUBLIC_BASE_PATH:-}"
HEALTH_URL="http://127.0.0.1:$PORT${BASE_PATH}/api/health"

# Step 1 — is something already serving on :$PORT?
if curl -sf --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
  log "✓ healthy on :$PORT"
  exit 0
fi

# Step 2 — anything *listening* on the port that we should clean up first?
if lsof -ti TCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  log "⚠ port $PORT is in use but unresponsive — killing stale process"
  lsof -ti TCP:$PORT -sTCP:LISTEN | xargs -r kill -9 2>/dev/null || true
  sleep 2
fi

# Step 3 — start a fresh server in the background, fully detached.
cd "$PROJECT_DIR" || { log "✗ project dir missing: $PROJECT_DIR"; exit 1; }

log "↻ starting next dev on :$PORT…"
nohup npx next dev -H 0.0.0.0 -p $PORT >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Step 4 — wait up to 60s for the server to answer, log result.
for i in $(seq 1 60); do
  if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    log "✓ server up (pid $(cat "$PID_FILE")) after ${i}s"
    exit 0
  fi
  sleep 1
done

log "✗ server did not become healthy within 60s — see log for details"
exit 1
