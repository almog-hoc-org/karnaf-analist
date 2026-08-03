#!/usr/bin/env bash
#
# ═══ הרץ את זה על המק, פעם ברבעון ═══
#
# Collect the RECENT Tax Authority deals and push them to the server.
#
# THE SHAPE OF THIS
#   the live database lives on the server, and stays there
#   this machine collects only the recent window into a small scratch file
#   the server adds what it has never seen, and deletes nothing
#
# Nothing large moves in either direction. The scratch file is a few MB, not the
# 312MB archive, and this machine never has to hold a copy of the whole thing.
#
# WHY IT HAS TO RUN HERE AT ALL
# govmap.gov.il and nadlan.gov.il are geo-restricted. Measured, same URL, same
# moment: 10,158,613 bytes of JavaScript from a machine in Israel, 1,734 bytes
# of HTML shell from the server in Europe. No header, User-Agent or headless
# browser changes that — the only variable is where the request leaves from.
#
# The dependency worth avoiding was "the site goes down when the laptop does".
# This is not that. Nothing here runs while visitors are on the site, and if
# this machine is off for a year the site keeps serving what it has.
#
# USAGE
#   bash scripts/push-recent.sh              last 18 months
#   bash scripts/push-recent.sh 2024-01      from a specific month
#   bash scripts/push-recent.sh --dry-run    collect and report, push nothing
#
# PREREQUISITES
#   · npm install has been run in this repo
#   · ssh access to the server, key-based
#   · for year_built / hok_hamecher only: bash scripts/bootstrap_nadlan_chrome.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVER="${KARNAF_SERVER:-root@72.62.7.226}"
REMOTE_DATA="/var/lib/karnaf/data"
REMOTE_APP="/opt/karnaf"
STAMP="$(date +%Y%m%d-%H%M%S)"

DRY_RUN=false
FROM=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY_RUN=true ;;
    [0-9][0-9][0-9][0-9]-[0-9][0-9]) FROM="$a" ;;
    *) echo "שימוש: bash scripts/push-recent.sh [YYYY-MM] [--dry-run]"; exit 1 ;;
  esac
done

# 18 months by default: comfortably wider than a quarter, so a skipped run — or
# a deal the authority reports late — is picked up by the next one rather than
# lost. Overlap costs nothing; the server skips what it already holds.
if [ -z "$FROM" ]; then
  FROM=$(date -v-18m +%Y-%m 2>/dev/null || date -d "18 months ago" +%Y-%m)
fi

say()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*"; exit 1; }

SCRATCH_DIR="$(mktemp -d)/karnaf"
SCRATCH_DB="$SCRATCH_DIR/realestate.db"
mkdir -p "$SCRATCH_DIR"
cleanup() { rm -rf "$(dirname "$SCRATCH_DIR")"; }
trap cleanup EXIT

# ── 0. is this machine actually in Israel? ───────────────────────────────
# Hours of collection failure look identical to a geo-block, and the error it
# produces ("Unexpected token '<'") explains nothing. One request up front turns
# that into a sentence.
say "בדיקה: האם המקור נגיש מכאן"
CT=$(curl -s -o /dev/null -w "%{content_type}" --max-time 25 \
      "https://www.govmap.gov.il/assets/index-df773dd4.js" || echo "")
case "$CT" in
  *javascript*) ok "govmap מגיב כרגיל — אתה בישראל" ;;
  *)            die "govmap החזיר '$CT' במקום JavaScript.
  זו החסימה הגיאוגרפית. הרץ ממחשב בישראל, בלי VPN לחו\"ל." ;;
esac

# ── 1. an empty scratch database ─────────────────────────────────────────
# Collecting into a fresh file rather than a working copy is what keeps this
# small: whatever lands here IS the delta, with no need to diff anything
# afterwards, and nothing on this machine is at risk from a failed run.
say "הכנת מסד זמני"
npx prisma db push --url="file:$SCRATCH_DB" --accept-data-loss >/dev/null 2>&1 \
  || die "יצירת המסד הזמני נכשלה."
ok "$SCRATCH_DB"

# ── 2. collect the window ────────────────────────────────────────────────
say "איסוף עסקאות מ-$FROM ואילך"
warn "צפוי כ-20-40 דקות ל-168 ערים."
# --force because the scratch file is empty: every city is "new" here, and the
# freshness manifest belongs to the server's database, not this one.
KARNAF_DATA_DIR="$SCRATCH_DIR" KARNAF_COLLECT_FROM="$FROM" \
  npx tsx scripts/collect-govmap-transactions.ts --force \
  || warn "האיסוף נכשל חלקית — ממשיך עם מה שנאסף"

say "איסוף nadlan — שנת בנייה וחוק מכר"
if curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  KARNAF_DATA_DIR="$SCRATCH_DIR" \
    npx tsx scripts/collect-nadlan-transactions.ts --force || warn "nadlan נכשל חלקית"
  ok "nadlan הושלם"
else
  warn "אין Chrome עם דיבאג על פורט 9222 — מדלג על nadlan."
  warn "זהו המקור היחיד לשנת בנייה ולחוק מכר, שבלעדיהם עסקאות"
  warn "חדשות נשארות ללא סיווג ומחוץ לסדרת \"כללי\". להפעלה:"
  warn "  bash scripts/bootstrap_nadlan_chrome.sh"
fi

# ── 3. what did we actually get ──────────────────────────────────────────
say "אימות"
INTEG=$(sqlite3 "$SCRATCH_DB" "PRAGMA integrity_check;" | head -1)
[ "$INTEG" = "ok" ] || die "המסד הזמני פגום: $INTEG"

read -r CNT CITIES YB <<<"$(sqlite3 -separator ' ' "$SCRATCH_DB" \
  "SELECT COUNT(*), COUNT(DISTINCT city_name), SUM(CASE WHEN year_built>0 THEN 1 ELSE 0 END) FROM nadlan_transactions;")"
ok "$CNT עסקאות · $CITIES ערים · ${YB:-0} עם שנת בנייה"
ok "גודל: $(du -h "$SCRATCH_DB" | cut -f1)"
[ "${CNT:-0}" -gt 0 ] || die "לא נאספה אף עסקה. אל תשלח קובץ ריק."

if [ "$DRY_RUN" = true ]; then
  say "DRY RUN — לא נשלח דבר"
  exit 0
fi

# ── 4. push ──────────────────────────────────────────────────────────────
say "שליחה לשרת"
scp "$SCRATCH_DB" "$SERVER:$REMOTE_DATA/incoming.db" >/dev/null
ok "הועלה"

# ── 5. merge — adds only, never deletes ──────────────────────────────────
# Identity is the full natural key (city, date, address, area, price), so
# re-collecting a period simply finds the same rows and skips them. Verified
# idempotent: the same file applied twice adds nothing the second time.
say "מיזוג בשרת"
ssh "$SERVER" "cd $REMOTE_APP && \
  sqlite3 $REMOTE_DATA/realestate.db \".backup '$REMOTE_DATA/backups/realestate-pre-merge-$STAMP.db'\" && \
  docker compose exec -T app npx tsx scripts/import-transactions.ts /app/data/incoming.db" \
  || die "המיזוג נכשל. המסד בשרת לא השתנה — הפלט למעלה מסביר למה."

# ── 6. rebuild ───────────────────────────────────────────────────────────
# Mandatory. Until this runs the new deals are in the database and in none of
# the graphs: every price series reads the aggregate table, not the raw rows.
say "הרצת הצינור — ניקוי, סיווג ואגרגציה"
ssh "$SERVER" "systemctl start karnaf-pipeline.service" \
  || die "הצינור נכשל. בדוק: ssh $SERVER 'journalctl -u karnaf-pipeline -n 60'"
ok "הצינור הושלם"

ssh "$SERVER" "rm -f $REMOTE_DATA/incoming.db"

say "הושלם"
cat <<EOF

  לבדיקה:
    curl -s https://srv1773229.hstgr.cloud/api/status

  גיבוי שנלקח לפני המיזוג, אם משהו נראה לא נכון:
    $REMOTE_DATA/backups/realestate-pre-merge-$STAMP.db

EOF
