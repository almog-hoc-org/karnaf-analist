#!/usr/bin/env bash
#
# ═══ הרץ את זה על המק — ממקם על המפה את הכתובות שקובץ מפ"י לא כיסה ═══
#
# ONE COMMAND, three halves of the geocode campaign:
#   the SERVER exports the residue — addresses with deals and no coordinate
#   the MAC (in Israel, where govmap answers) asks govmap about each one
#   the SERVER applies the answers into address_geocodes
#
# Per city: export → download → geocode → upload → apply → clean up. The
# server marks each finished city in govmap_geocode_status, and the Mac keeps
# partial answer files, so a stopped run resumes where it left off.
#
# Run scripts/import-mapi-addresses.ts on the server FIRST (it is a nightly
# collector, so usually it already ran): the national file covers most of
# the country for free, and this pass is only for what it missed.
#
# USAGE
#   bash scripts/push-geocodes.sh                # all pending cities, gap-first
#   bash scripts/push-geocodes.sh "חיפה"         # specific cities only
#   KARNAF_GEOCODE_BUDGET_MIN=120 bash scripts/push-geocodes.sh   # stop asking after 2h (resumable)
#
# PREREQUISITES: npm install in this repo · key-based ssh to the server.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVER="${KARNAF_SERVER:-root@72.62.7.226}"
REMOTE_DATA="/var/lib/karnaf/data"
REMOTE_APP="/opt/karnaf"
TODO_DIR="data/geocode_todo"
DONE_DIR="data/geocode_done"
BUDGET_MIN="${KARNAF_GEOCODE_BUDGET_MIN:-0}"
say()  { printf '\n\033[1m── %s ──\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

mkdir -p "$TODO_DIR" "$DONE_DIR"

# ── 1. the server exports the residue (gap-first; one file per city) ──────
say "השרת מייצא את הכתובות שעוד אין להן מיקום"
CITY_ARGS=""
for c in "$@"; do CITY_ARGS="$CITY_ARGS --city $(printf '%q' "$c")"; done
ssh "$SERVER" "mkdir -p $REMOTE_DATA/geocode_todo $REMOTE_DATA/geocode_done && cd $REMOTE_APP && docker compose exec -T app npx tsx scripts/export-geocode-residue.ts --out /app/data/geocode_todo $CITY_ARGS </dev/null" \
  || die "הייצוא בשרת נכשל"
rsync -az --delete "$SERVER:$REMOTE_DATA/geocode_todo/" "$TODO_DIR/" || die "הורדת קובצי המשימות נכשלה"
# gap-first, as the server ordered them (order.txt); a glob would be alphabetical
FILES=()
if [ -f "$TODO_DIR/order.txt" ]; then
  while IFS= read -r n; do [ -n "$n" ] && [ -f "$TODO_DIR/$n" ] && FILES+=("$TODO_DIR/$n"); done < "$TODO_DIR/order.txt"
else
  FILES=("$TODO_DIR"/*.json)
fi
[ "${#FILES[@]}" -gt 0 ] && [ -e "${FILES[0]}" ] || { ok "אין כתובות לגיאוקוד — הקמפיין הושלם"; exit 0; }
say "${#FILES[@]} ערים בתור (הפערים הגדולים קודם)"

# ── 2. this machine asks govmap ──────────────────────────────────────────
# The budget is for the WHOLE run, not per city: a deadline is fixed here and
# every city gets what is left of it. (Per-city budgets made a 4-hour night
# a 4-hour-per-city night, 7.9.2026.)
DEADLINE=0; [ "$BUDGET_MIN" -gt 0 ] 2>/dev/null && DEADLINE=$(( $(date +%s) + BUDGET_MIN * 60 ))
done_n=0; fail_n=0
for f in "${FILES[@]}"; do
  name=$(basename "$f")
  left=0
  if [ "$DEADLINE" -gt 0 ]; then
    left=$(( (DEADLINE - $(date +%s)) / 60 ))
    if [ "$left" -le 0 ]; then warn "תקציב הזמן נגמר — הריצה הבאה ממשיכה מכאן"; break; fi
  fi
  say "$name"
  set +e
  npx tsx scripts/geocode-govmap-residue.ts "$f" --out="$DONE_DIR" --budget-min "$left"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    warn "הגיאוקוד נעצר (קוד $rc) — אם ההודעה למעלה היא חסימה גיאוגרפית, המכונה הזו אינה בישראל"
    fail_n=$((fail_n + 1)); break
  fi
  # ── 3. upload + apply on the server + clean up ──
  if scp -q "$DONE_DIR/$name" "$SERVER:$REMOTE_DATA/geocode_done/$name" \
     && ssh "$SERVER" "cd $REMOTE_APP && docker compose exec -T app npx tsx scripts/apply-geocodes.ts /app/data/geocode_done/$(printf '%q' "$name") </dev/null && rm -f $REMOTE_DATA/geocode_done/$(printf '%q' "$name") $REMOTE_DATA/geocode_todo/$(printf '%q' "$name")"; then
    rm -f "$DONE_DIR/$name" "$f"
    done_n=$((done_n + 1))
    ok "$name הוחל ($done_n עד כה)"
  else
    fail_n=$((fail_n + 1))
    warn "$name נכשל בהחלה על השרת — התשובות נשמרו מקומית להרצה חוזרת"
  fi
done

say "סיכום"
ok "$done_n ערים הוחלו; $fail_n נכשלו/נעצרו"
echo "כיסוי גיאוקוד עדכני:"
ssh "$SERVER" "cd $REMOTE_APP && docker compose exec -T app npx tsx scripts/report-neighborhood-coverage.ts </dev/null" | grep -A 12 "גיאוקוד" | head -14 || true
echo
echo "המטמון מתרענן בצינור הלילי; לתוצאה מיידית: POST /api/revalidate עם טוקן."
