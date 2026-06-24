#!/bin/bash
# Karnaf Real-Estate — Monthly Deals Refresh + Auto-Deploy
# ════════════════════════════════════════════════════════
# Stage 1 (quality-first automation):
#   1. Back up the live deals cache.
#   2. Refresh every city's nadlan.gov.il transaction cache (the live
#      comparison feature) — this is the ONE source that genuinely updates
#      and is safe to auto-refresh (separate cache, never touches the
#      curated golden_multiplier inputs).
#   3. VALIDATION GATE — refuse to ship if the refresh looks broken
#      (too many failures, collapsed deal counts, lost files). On failure
#      it restores the backup and does NOT push, so bad data never goes live.
#   4. If valid → git commit + push → Vercel rebuilds automatically.
#
# Manual run:        bash scripts/monthly-refresh.sh --force
# Dry run (no push): bash scripts/monthly-refresh.sh --force --no-push
# Logs:              ~/Library/Logs/Karnaf/monthly-refresh.log

set -u

# Resolve the project dir from this script's own location, so the same script
# works whether it runs from the iCloud copy (manual) or a local clone (launchd).
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/Karnaf"
LOG_FILE="$LOG_DIR/monthly-refresh.log"
STATE_FILE="$LOG_DIR/last-monthly-refresh.txt"
BACKUP_DIR="/tmp/karnaf-deals-backup"
INTERVAL_DAYS=30

mkdir -p "$LOG_DIR"
export PATH="$HOME/.npm-packages/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
notify() { osascript -e "display notification \"$1\" with title \"קרנף — רענון נתונים\"" 2>/dev/null || true; }

FORCE=0; NO_PUSH=0
for a in "$@"; do
  [[ "$a" == "--force" ]] && FORCE=1
  [[ "$a" == "--no-push" ]] && NO_PUSH=1
done

# Gate: skip unless INTERVAL_DAYS passed (robust across sleep, like launchd best-practice).
if [[ $FORCE -eq 0 && -f "$STATE_FILE" ]]; then
  LAST=$(cat "$STATE_FILE" 2>/dev/null || echo 0); NOW=$(date +%s)
  if (( NOW - LAST < INTERVAL_DAYS * 86400 )); then
    log "↩ skip — next refresh in $(( (INTERVAL_DAYS*86400 - (NOW-LAST)) / 86400 )) days"
    exit 0
  fi
fi

cd "$PROJECT_DIR" || { log "✗ project dir missing: $PROJECT_DIR"; exit 1; }

log "═══════════════════════════════════════════════"
log "▶ monthly deals refresh starting (dir: $PROJECT_DIR)"

# Sync with remote first (the automation working copy may be a local clone,
# while manual edits land via the iCloud copy → GitHub).
if [[ $NO_PUSH -eq 0 ]]; then
  git pull --ff-only origin main >> "$LOG_FILE" 2>&1 && log "  git pull ok" \
    || log "  ⚠ git pull skipped/failed — continuing on local state"
fi

CACHE_DIR="data/deals_cache"

# ── Capture PRE-state for the validation gate ───────────────────────────
pre_stats() {
  python3 - "$CACHE_DIR" <<'PY'
import sys, json, glob, os
d = sys.argv[1]
files = glob.glob(os.path.join(d, "*.json"))
total = 0
for f in files:
    try:
        total += int(json.load(open(f)).get("totalDealsAnalyzed", 0) or 0)
    except Exception:
        pass
print(f"{len(files)} {total}")
PY
}

read PRE_FILES PRE_DEALS < <(pre_stats)
log "  pre-state: $PRE_FILES cache files, $PRE_DEALS total deals"

# ── Backup before touching anything ─────────────────────────────────────
rm -rf "$BACKUP_DIR"; mkdir -p "$BACKUP_DIR"
cp -R "$CACHE_DIR/." "$BACKUP_DIR/" 2>/dev/null
log "  backed up cache → $BACKUP_DIR"

# ── Refresh ─────────────────────────────────────────────────────────────
log "─── refreshing nadlan deals for all cities (this takes a while) ───"
npx tsx lib/prefetch-deals.ts --force >> "$LOG_FILE" 2>&1
REFRESH_EXIT=$?
log "  prefetch exit: $REFRESH_EXIT"

# ── VALIDATION GATE ─────────────────────────────────────────────────────
read POST_FILES POST_DEALS < <(pre_stats)
log "  post-state: $POST_FILES cache files, $POST_DEALS total deals"

# Hard fail if the refresh itself crashed (e.g. native module / DB load error).
# Without this, a total crash leaves post==pre and the gate would wrongly pass
# as "no changes".
if [[ $REFRESH_EXIT -ne 0 ]]; then
  log "✗ refresh crashed (exit $REFRESH_EXIT) — restoring backup, NOT pushing."
  rm -rf "$CACHE_DIR"; mkdir -p "$CACHE_DIR"; cp -R "$BACKUP_DIR/." "$CACHE_DIR/"
  notify "רענון קרס — לא עלה לאוויר. בדוק לוג."
  exit 1
fi

VALID=$(python3 - "$PRE_FILES" "$PRE_DEALS" "$POST_FILES" "$POST_DEALS" "$CACHE_DIR" <<'PY'
import sys, json, glob, os
pre_f, pre_d, post_f, post_d, cache = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), sys.argv[5]
reasons = []
# 1. No cache files lost.
if post_f < pre_f:
    reasons.append(f"lost cache files: {pre_f}→{post_f}")
# 2. Total deals must not collapse (catch API returning empty/garbage).
if pre_d > 0 and post_d < pre_d * 0.5:
    reasons.append(f"deal count collapsed: {pre_d}→{post_d} (<50%)")
# 3. Every file must be valid JSON with a neighborhoods array.
broken = 0
for f in glob.glob(os.path.join(cache, "*.json")):
    try:
        j = json.load(open(f))
        if not isinstance(j.get("neighborhoods"), list):
            broken += 1
    except Exception:
        broken += 1
if broken > post_f * 0.25:
    reasons.append(f"too many broken/empty files: {broken}/{post_f}")
print("OK" if not reasons else "FAIL: " + "; ".join(reasons))
PY
)
log "  validation: $VALID"

if [[ "$VALID" != OK* ]]; then
  log "✗ VALIDATION FAILED — restoring backup, NOT pushing."
  rm -rf "$CACHE_DIR"; mkdir -p "$CACHE_DIR"; cp -R "$BACKUP_DIR/." "$CACHE_DIR/"
  notify "רענון נכשל באימות — לא עלה לאוויר. בדוק לוג."
  exit 1
fi

# ── Ship it ─────────────────────────────────────────────────────────────
if ! git diff --quiet -- "$CACHE_DIR" 2>/dev/null; then
  CHANGED=$(git diff --name-only -- "$CACHE_DIR" | wc -l | tr -d ' ')
  if [[ $NO_PUSH -eq 1 ]]; then
    log "  --no-push: $CHANGED files changed, skipping commit/push (dry run)."
  else
    git add "$CACHE_DIR"
    git commit -q -m "Monthly deals refresh — $POST_DEALS deals across $POST_FILES cities" \
      -m "Automated nadlan.gov.il cache refresh. Validation gate passed."
    git push -q origin main 2>>"$LOG_FILE" && log "  pushed to GitHub" || log "  ⚠ git push failed (continuing to deploy)"

    # GitHub→Vercel auto-deploy is NOT wired, so deploy explicitly via CLI.
    # IMPORTANT: a CLI `vercel deploy` from a dir that contains .git stalls
    # forever (status UNKNOWN, never builds). So we stage a .git-less copy to
    # /tmp (with the .vercel link) and deploy from there — the one path proven
    # to build reliably. --force avoids dedup skipping the build.
    if command -v vercel >/dev/null 2>&1 && [[ -d .vercel ]]; then
      STAGE="/tmp/karnaf-deploy-stage"
      rm -rf "$STAGE"; mkdir -p "$STAGE"
      rsync -a --exclude .git --exclude node_modules --exclude .next --exclude out \
        "$PROJECT_DIR/" "$STAGE/" >> "$LOG_FILE" 2>&1
      cp -R "$PROJECT_DIR/.vercel" "$STAGE/.vercel"
      if (cd "$STAGE" && vercel deploy --prod --force --yes) >> "$LOG_FILE" 2>&1; then
        log "✓ deployed to Vercel. $CHANGED city caches updated."
        notify "רענון הצליח — $CHANGED ערים עודכנו, האתר מתעדכן."
      else
        log "✗ vercel deploy failed (see log). Data is on GitHub."
        notify "רענון בוצע אך deploy נכשל — בדוק לוג."
        exit 1
      fi
    else
      log "⚠ vercel CLI or .vercel link missing — pushed to GitHub only."
      notify "רענון בוצע, נדחף לגיטהאב. צריך deploy ידני."
      exit 1
    fi
  fi
else
  log "  no changes after refresh — nothing to deploy."
fi

date +%s > "$STATE_FILE"
log "✓ monthly refresh complete"
log ""
