#!/bin/bash
# Karnaf Real-Estate Bi-Weekly Data Refresh
# ─────────────────────────────────────────
# Pulls fresh data from CBS, MoF, nadlan.gov.il and yad2 and re-imports.
# Runs every 14 days (gated by state file ~/Library/Logs/Karnaf/last-refresh.txt).
#
# Called once a day by ~/Library/LaunchAgents/com.karnaf.realestate.refresh.plist
# It exits immediately if fewer than 14 days have passed since the last run —
# this is more reliable across sleep/shutdown cycles than launchd's
# StartCalendarInterval (which can miss windows while the Mac is asleep).
#
# Usage (manual force-run): bash scripts/biweekly-refresh.sh --force
# Logs:                     ~/Library/Logs/Karnaf/refresh.log

set -u

PROJECT_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/תיקיות עבודה/ביזנס/עסק/קרנף ליווי וייעוץ/ניהול עסק/קלוד קוד קרנף/my-realestate-project"
LOG_DIR="$HOME/Library/Logs/Karnaf"
LOG_FILE="$LOG_DIR/refresh.log"
STATE_FILE="$LOG_DIR/last-refresh.txt"
INTERVAL_DAYS=14

mkdir -p "$LOG_DIR"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Gate: skip if less than INTERVAL_DAYS passed since last successful run.
FORCE=0
if [[ "${1:-}" == "--force" ]]; then
  FORCE=1
fi

if [[ $FORCE -eq 0 && -f "$STATE_FILE" ]]; then
  LAST_RUN=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  ELAPSED=$(( NOW - LAST_RUN ))
  THRESHOLD=$(( INTERVAL_DAYS * 24 * 3600 ))
  if (( ELAPSED < THRESHOLD )); then
    DAYS_LEFT=$(( (THRESHOLD - ELAPSED) / 86400 ))
    log "↩ skipping — next refresh in $DAYS_LEFT days"
    exit 0
  fi
fi

log "═══════════════════════════════════════════════"
log "▶ starting bi-weekly refresh"
cd "$PROJECT_DIR" || { log "✗ project dir missing"; exit 1; }

run_step() {
  local name="$1"; shift
  log "─── $name ───"
  if "$@" >> "$LOG_FILE" 2>&1; then
    log "  ✓ $name done"
    return 0
  else
    log "  ✗ $name failed (exit $?) — continuing"
    return 1
  fi
}

# 1. Poll CBS + MoF for new reports → updates data/seen_reports.json, sends notifications.
run_step "check-new-reports" npx tsx lib/check-new-reports.ts || true

# 2. Re-import any updates the prior step (or you) staged into /data.
run_step "import-updates"     npx tsx lib/import-updates.ts || true

# 3. Re-import the latest Yad2 scrape JSON if present.
run_step "import-yad2"        npx tsx lib/import-yad2.ts || true

# 4. Refresh nadlan.gov.il deal cache (per-city files under data/deals_cache/).
run_step "prefetch-deals"     npx tsx lib/prefetch-deals.ts || true

# 5. Re-extract national completions from the latest CBS PDF (if present in /data).
if [[ -f "data/נתוני סיום בנייה לפי רבעון 10 שנים.pdf" ]]; then
  run_step "national-completions" python3 scripts/import_national_completions.py || true
fi

# Stamp success and exit.
date +%s > "$STATE_FILE"
log "✓ bi-weekly refresh complete — next run in $INTERVAL_DAYS days"
log ""
