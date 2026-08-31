#!/usr/bin/env bash
#
# ═══ הרץ את זה על המק — משלים כתובות רחוב לכל העסקאות בשרת ═══
#
# ONE COMMAND, both halves of the address campaign:
#   the MAC (in Israel, where govmap answers) captures each city's deal feed
#   the SERVER (where the live DB is) applies it with the backfill's
#   --from-file mode — UPDATE-only, never inserts, never overwrites.
#
# Per city: capture → upload (a few MB) → apply → delete the file. The server
# marks each finished city in govmap_address_backfill_status, so a stopped run
# resumes where it left off; a re-run after completion is a fast no-op.
#
# WHY THIS SHAPE. The backfill needs govmap AND the live DB on one machine —
# no machine has both: govmap answers 403 to the VPS (measured 8/2026), and
# the Mac does not hold the 1.4M-row live DB. So the campaign splits at the
# JSON file. Expect ~4-8 minutes per city of polite-paced requests; the whole
# country is an overnight run, and it is safe to stop and resume any time.
#
# USAGE
#   bash scripts/push-addresses.sh              # all pending cities, gap-first
#   bash scripts/push-addresses.sh "חיפה"       # specific cities only
#
# PREREQUISITES: npm install in this repo · key-based ssh to the server.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVER="${KARNAF_SERVER:-root@72.62.7.226}"
REMOTE_DATA="/var/lib/karnaf/data"
REMOTE_APP="/opt/karnaf"
OUT_DIR="data/govmap_addr"
say()  { printf '\n\033[1m── %s ──\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

mkdir -p "$OUT_DIR"

# ── which cities still need addresses (server knows; gap-first) ──────────
if [ "$#" -gt 0 ]; then
  CITIES=("$@")
else
  say "שולף מהשרת את רשימת הערים שעוד חסרות כתובות"
  # NOT filtered by the status table's 'ok' on purpose: a city the blocked VPS
  # run marked 'error' must be retried, and one marked 'ok' by an earlier Mac
  # run is skipped cheaply by the backfill itself.
  CITY_LIST=$(ssh "$SERVER" "cd $REMOTE_APP && docker compose exec -T app node -e '
    const D = require(\"better-sqlite3\");
    const db = new D(\"/app/data/realestate.db\", { readonly: true });
    const rows = db.prepare(\`SELECT city_name, COUNT(*) m FROM nadlan_transactions
      WHERE (street IS NULL OR neighborhood IS NULL) AND price>0 AND area>0
      GROUP BY city_name ORDER BY m DESC\`).all();
    for (const r of rows) console.log(r.city_name);
  ' </dev/null") || die "לא הצלחתי לשלוף את רשימת הערים מהשרת"
  CITIES=()
  while IFS= read -r c; do [ -n "$c" ] && CITIES+=("$c"); done <<< "$CITY_LIST"
fi
[ "${#CITIES[@]}" -gt 0 ] || { ok "אין ערים עם כתובות חסרות — הקמפיין הושלם"; exit 0; }
say "${#CITIES[@]} ערים בתור (הפערים הגדולים קודם)"

ssh "$SERVER" "mkdir -p $REMOTE_DATA/govmap_addr"

done_n=0; fail_n=0
for city in "${CITIES[@]}"; do
  # same sanitization as capture-govmap-addresses.ts cityFileName() — via node,
  # because BSD sed on the Mac does not treat a Unicode range the way JS does,
  # and a filename mismatch between the two halves would silently skip cities
  fname=$(node -e 'console.log(process.argv[1].replace(/[^֐-׿A-Za-z0-9-]+/g, "_") + ".json")' "$city")
  say "$city"

  # 1. capture on this machine (skips instantly if the file already exists)
  npx tsx scripts/capture-govmap-addresses.ts "$city" --out="$OUT_DIR" \
    || die "הלכידה נכשלה — אם ההודעה למעלה היא חסימה גיאוגרפית, המכונה הזו אינה בישראל"
  if [ ! -f "$OUT_DIR/$fname" ]; then warn "אין קובץ לכידה (עיר ריקה ב-govmap) — ממשיך"; continue; fi

  # 2. upload + 3. apply on the server + 4. clean up
  if scp -q "$OUT_DIR/$fname" "$SERVER:$REMOTE_DATA/govmap_addr/$fname" \
     && ssh "$SERVER" "cd $REMOTE_APP && docker compose exec -T app npx tsx scripts/backfill-govmap-addresses.ts $(printf '%q' "$city") --from-file=/app/data/govmap_addr/$(printf '%q' "$fname") </dev/null && rm -f $REMOTE_DATA/govmap_addr/$(printf '%q' "$fname")"; then
    rm -f "$OUT_DIR/$fname"
    done_n=$((done_n + 1))
    ok "$city הושלמה ($done_n עד כה)"
  else
    fail_n=$((fail_n + 1))
    warn "$city נכשלה בהחלה על השרת — הקובץ נשמר מקומית להרצה חוזרת"
  fi
done

say "סיכום"
ok "$done_n ערים הוחלו; $fail_n נכשלו"
echo "דוח כיסוי עדכני:"
ssh "$SERVER" "cd $REMOTE_APP && docker compose exec -T app npx tsx scripts/report-neighborhood-coverage.ts </dev/null" | tail -3 || true
echo
echo "הצינור הלילי (02:30) יפיץ את הכתובות החדשות לעמודי השכונות, לחיפוש ולהשוואות."
