#!/bin/bash
# Cloudflare quick-tunnel for the realestate portal (:3000), managed by launchd
# (com.karnaf.realestate.tunnel, KeepAlive). Writes the public URL to
# data/tunnel_url.txt on every (re)start — the trycloudflare URL is random per run.
set -u
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CLOUDFLARED="$HOME/bin/cloudflared"
URL_FILE="$PROJECT_DIR/data/tunnel_url.txt"
source "$(dirname "${BASH_SOURCE[0]}")/lib/paths.sh"
LOG_FILE="$LOG_DIR/karnaf-tunnel.log"

: > "$LOG_FILE"

# extractor: watch the log until the public URL shows up, then persist it
(
  for i in $(seq 1 60); do
    URL=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG_FILE" | head -1)
    if [ -n "${URL:-}" ]; then
      echo "$URL" > "$URL_FILE"
      echo "$(date '+%F %T') tunnel URL: $URL" >> "$LOG_FILE"
      exit 0
    fi
    sleep 2
  done
) &

# foreground so launchd owns the process lifecycle (KeepAlive restarts it)
exec "$CLOUDFLARED" tunnel --no-autoupdate --url http://127.0.0.1:3000 >> "$LOG_FILE" 2>&1
