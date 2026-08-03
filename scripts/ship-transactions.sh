#!/usr/bin/env bash
#
# ═══ הרץ את זה על המק, לא על השרת ═══
#
# Collect the Tax Authority deals from a machine in Israel and ship them to the
# server.
#
# WHY THE SPLIT
# govmap.gov.il and nadlan.gov.il are geo-restricted. Measured, same URL, same
# moment: 10,158,613 bytes of JavaScript from the Mac in Israel, 1,734 bytes of
# HTML shell from the VPS in Europe. No header, User-Agent or headless browser
# changes that — the only variable is where the request leaves from.
#
# So the division of labour is not a compromise, it is the shape of the problem:
#
#   VPS   the site, the database, the nightly cleaning, CBS + Chief Economist
#   Mac   the Tax Authority deals — twice a year, which is how often they matter
#
# The dependency we set out to remove was "the site goes down when the laptop
# does". That is not this. Nothing here runs while visitors are on the site.
#
# USAGE
#   bash scripts/ship-transactions.sh              pull, collect, verify, ship, rebuild
#   bash scripts/ship-transactions.sh --ship-only  skip collection, ship what is here
#   bash scripts/ship-transactions.sh --dry-run    pull, collect, verify — ship nothing
#   bash scripts/ship-transactions.sh --no-pull    keep this machine's database as the base
#
# PREREQUISITES ON THE MAC
#   · this repo, with npm install already run
#   · data/realestate.db — the working database
#   · ssh access to the server (key-based; you will not be asked for a password)
#   · for the nadlan half only: a debuggable Chrome —
#       bash scripts/bootstrap_nadlan_chrome.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVER="${KARNAF_SERVER:-root@72.62.7.226}"
REMOTE_DATA="/var/lib/karnaf/data"
REMOTE_APP="/opt/karnaf"
LOCAL_DB="data/realestate.db"
STAMP="$(date +%Y%m%d-%H%M%S)"

SHIP_ONLY=false
DRY_RUN=false
NO_PULL=false
for a in "$@"; do
  case "$a" in
    --ship-only) SHIP_ONLY=true ;;
    --dry-run)   DRY_RUN=true ;;
    --no-pull)   NO_PULL=true ;;
    *) echo "דגל לא מוכר: $a"; exit 1 ;;
  esac
done

say()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*"; exit 1; }

[ -f "$LOCAL_DB" ] || die "$LOCAL_DB לא קיים. אתה מריץ את זה על המק, נכון?"

# ── 0. am I actually in Israel? ──────────────────────────────────────────
# Ninety seconds of collection failure looks identical to a geo-block, and the
# error it produces ("Unexpected token '<'") explains nothing. One request up
# front turns that into a sentence.
say "בדיקה: האם המקור נגיש מכאן"
CT=$(curl -s -o /dev/null -w "%{content_type}" --max-time 25 \
      "https://www.govmap.gov.il/assets/index-df773dd4.js" || echo "")
case "$CT" in
  *javascript*) ok "govmap מגיב כרגיל — אתה בישראל" ;;
  *)            die "govmap החזיר '$CT' במקום JavaScript.
  זו החסימה הגיאוגרפית. הרץ את הסקריפט ממחשב בישראל, בלי VPN לחו\"ל." ;;
esac

# ── 0.5 start from the server's copy, not this machine's ─────────────────
#
# THE DATABASE IS NOT IN GIT. It is 312MB and GitHub rejects anything over 100,
# so it ships as a Release asset — a SNAPSHOT, frozen whenever that release was
# cut. `git pull` brings code and never brings data.
#
# Which means a laptop that has been away from this project for a while holds a
# database that is behind the server, and the server's has since gained
# everything the nightly run collected. Collecting on top of the stale copy and
# shipping it back would hand the server less than it already had. The gate
# would refuse it — correctly — but the right move is not to build that file in
# the first place.
#
# So: pull down, collect on top, ship back. The round trip is what makes the
# server the single source of truth even though the collection happens here.
if [ "$NO_PULL" = false ] && [ "$SHIP_ONLY" = false ]; then
  say "משיכת המסד מהשרת (הוא המקור העדכני, לא הגיט)"
  LOCAL_BAK="data/realestate.before-pull-$STAMP.db"
  cp "$LOCAL_DB" "$LOCAL_BAK"
  ok "גובה המסד המקומי → $LOCAL_BAK"

  ssh "$SERVER" "sqlite3 $REMOTE_DATA/realestate.db \".backup '/tmp/pull-$STAMP.db'\"" \
    || die "לא הצלחתי לייצר עותק בשרת."
  if command -v rsync >/dev/null; then
    rsync -h --progress "$SERVER:/tmp/pull-$STAMP.db" "$LOCAL_DB"
  else
    scp "$SERVER:/tmp/pull-$STAMP.db" "$LOCAL_DB"
  fi
  ssh "$SERVER" "rm -f /tmp/pull-$STAMP.db"

  read -r PCNT PCIT <<<"$(sqlite3 -separator ' ' "$LOCAL_DB" \
    "SELECT COUNT(*), COUNT(DISTINCT city_name) FROM nadlan_transactions;")"
  ok "התקבל: $PCNT עסקאות · $PCIT ערים — האיסוף ירוץ על גבי זה"
fi

# ── 1. collect ───────────────────────────────────────────────────────────
if [ "$SHIP_ONLY" = false ]; then
  say "איסוף govmap — כל הערים, 10 שנים"
  warn "זה לוקח שעות. אפשר לעזוב את זה רץ."
  # --force overrides the freshness skip: this is the twice-yearly full sweep,
  # not the incremental run, and skipping a city because it was touched three
  # weeks ago is exactly wrong here.
  npx tsx scripts/collect-govmap-transactions.ts --force
  ok "govmap הושלם"

  say "איסוף nadlan — שנת בנייה וחוק מכר"
  if curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
    npx tsx scripts/collect-nadlan-transactions.ts --force || warn "nadlan נכשל חלקית — ממשיך"
    ok "nadlan הושלם"
  else
    warn "אין Chrome עם דיבאג על פורט 9222 — מדלג על nadlan."
    warn "זה המקור היחיד של שנת בנייה וחוק מכר. להפעלה:"
    warn "  bash scripts/bootstrap_nadlan_chrome.sh"
  fi
fi

# ── 2. verify locally, before anything leaves this machine ───────────────
say "אימות מקומי"
INTEG=$(sqlite3 "$LOCAL_DB" "PRAGMA integrity_check;" | head -1)
[ "$INTEG" = "ok" ] || die "המסד המקומי פגום: $INTEG"
ok "שלמות המסד תקינה"

read -r CNT CITIES YB <<<"$(sqlite3 -separator ' ' "$LOCAL_DB" \
  "SELECT COUNT(*), COUNT(DISTINCT city_name), SUM(CASE WHEN year_built>0 THEN 1 ELSE 0 END) FROM nadlan_transactions;")"
ok "$CNT עסקאות · $CITIES ערים · $YB עם שנת בנייה"
[ "${CNT:-0}" -gt 0 ] || die "אין עסקאות במסד המקומי."

if [ "$DRY_RUN" = true ]; then
  say "DRY RUN — לא נשלח דבר"
  exit 0
fi

# ── 3. ship ──────────────────────────────────────────────────────────────
# A COPY, never the live file: sqlite3 .backup is consistent even if something
# is mid-write, which plain cp is not.
say "הכנת עותק לשליחה"
TMP="/tmp/karnaf-tx-$STAMP.db"
sqlite3 "$LOCAL_DB" ".backup '$TMP'"
ok "$(du -h "$TMP" | cut -f1) → $TMP"

say "העלאה לשרת"
# Fall back to scp where rsync is missing; the progress readout is the only loss.
if command -v rsync >/dev/null; then
  rsync -h --progress "$TMP" "$SERVER:$REMOTE_DATA/incoming.db"
else
  scp "$TMP" "$SERVER:$REMOTE_DATA/incoming.db"
fi
ok "הועלה"
rm -f "$TMP"

# ── 4. merge on the server, behind its own gates ─────────────────────────
# The server backs up and gate-checks before it writes: refuses a set more than
# 2% smaller than what is live, or one missing cities. Sending a file is not the
# same as accepting it.
say "מיזוג בשרת"
ssh "$SERVER" "cd $REMOTE_APP && \
  sqlite3 $REMOTE_DATA/realestate.db \".backup '$REMOTE_DATA/backups/realestate-pre-import-$STAMP.db'\" && \
  docker compose exec -T app npx tsx scripts/import-transactions.ts /app/data/incoming.db" \
  || die "המיזוג נדחה או נכשל. המסד בשרת לא השתנה — הפלט למעלה מסביר למה."
ok "מוזג"

# ── 5. rebuild ───────────────────────────────────────────────────────────
# Mandatory, not optional. Until this runs the site still serves statistics
# derived from the previous set: new deals are in the database and in none of
# the graphs.
say "הרצת הצינור — ניקוי, סיווג ואגרגציה"
ssh "$SERVER" "systemctl start karnaf-pipeline.service" \
  || die "הצינור נכשל. בדוק: ssh $SERVER 'journalctl -u karnaf-pipeline -n 60'"
ok "הצינור הושלם"

ssh "$SERVER" "rm -f $REMOTE_DATA/incoming.db"

say "הושלם"
cat <<EOF

  לבדיקה:
    curl -s https://srv1773229.hstgr.cloud/api/status

  אם משהו נראה לא נכון, הגיבוי שנלקח לפני המיזוג:
    $REMOTE_DATA/backups/realestate-pre-import-$STAMP.db

EOF
