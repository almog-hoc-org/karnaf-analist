#!/usr/bin/env bash
#
# ═══ הרץ את זה על המק — משלים כתובות מ-nadlan.gov.il לכל העסקאות בשרת ═══
#
# ONE COMMAND, both halves of the nadlan address campaign:
#   the MAC (with the debuggable Chrome on :9222) captures each city's deal
#   feed with addresses, parcels and floors
#   the SERVER (where the live DB is) donates them onto the existing rows —
#   UPDATE-only, never inserts, never overwrites.
#
# Per city: capture → upload → apply → delete the file. The capture is
# resumable (the file remembers which windows are done), and the server
# marks each finished city in nadlan_address_backfill_status.
#
# WHY THIS CAMPAIGN. Measured 4.9.2026: 807k rows carry no street, all of
# them nadlan-channel, and nadlan's own deal feed carries a full address for
# every deal. scripts/push-addresses.sh (govmap) cannot reach them — govmap
# holds 2016+ only, and only part of it.
#
# USAGE
#   bash scripts/bootstrap_nadlan_chrome.sh        # once: opens the debuggable Chrome
#   bash scripts/push-nadlan-addresses.sh          # all pending cities, gap-first
#   bash scripts/push-nadlan-addresses.sh "חיפה"   # specific cities only
#   KARNAF_NADLAN_BUDGET_MIN=40 bash scripts/push-nadlan-addresses.sh   # per-city time cap
#
# PREREQUISITES: npm install in this repo · key-based ssh to the server ·
# Chrome with --remote-debugging-port=9222 (the bootstrap script), a city's
# "עסקאות" tab opened once so reCAPTCHA has blessed the session.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVER="${KARNAF_SERVER:-root@72.62.7.226}"
REMOTE_DATA="/var/lib/karnaf/data"
REMOTE_APP="/opt/karnaf"
OUT_DIR="data/nadlan_addr"
say()  { printf '\n\033[1m── %s ──\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

mkdir -p "$OUT_DIR"

# ── the debuggable Chrome must be up, or nothing below can run ───────────
if ! curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1; then
  die "אין Chrome עם דיבאג על פורט 9222 — קודם: bash scripts/bootstrap_nadlan_chrome.sh (ולפתוח פעם אחת 'עסקאות' של עיר כלשהי)"
fi

# ── which cities still lack addresses (server knows; gap-first) ──────────
if [ "$#" -gt 0 ]; then
  CITIES=("$@")
else
  say "שולף מהשרת את רשימת הערים שעוד חסרות כתובות (ערוץ nadlan)"
  CITY_LIST=$(ssh "$SERVER" "cd $REMOTE_APP && docker compose exec -T app node -e '
    const D = require(\"better-sqlite3\");
    const db = new D(\"/app/data/realestate.db\", { readonly: true });
    let done = new Set();
    try { done = new Set(db.prepare(\"SELECT city_name FROM nadlan_address_backfill_status WHERE status=\\\"ok\\\"\").all().map(r => r.city_name)); } catch {}
    const rows = db.prepare(\`SELECT city_name, COUNT(*) m FROM nadlan_transactions
      WHERE COALESCE(source,\\\"nadlan\\\") = \\\"nadlan\\\" AND street IS NULL AND price>0 AND area>0
      GROUP BY city_name ORDER BY m DESC\`).all();
    for (const r of rows) if (!done.has(r.city_name)) console.log(r.city_name);
  ' </dev/null") || die "לא הצלחתי לשלוף את רשימת הערים מהשרת"
  CITIES=()
  while IFS= read -r c; do [ -n "$c" ] && CITIES+=("$c"); done <<< "$CITY_LIST"
fi
[ "${#CITIES[@]}" -gt 0 ] || { ok "אין ערים עם כתובות חסרות — הקמפיין הושלם"; exit 0; }
say "${#CITIES[@]} ערים בתור (הפערים הגדולים קודם)"

ssh "$SERVER" "mkdir -p $REMOTE_DATA/nadlan_addr"

done_n=0; fail_n=0
for city in "${CITIES[@]}"; do
  # same sanitization as capture-nadlan-addresses.ts cityFileName() — via node,
  # because BSD sed on the Mac does not treat a Unicode range the way JS does
  fname=$(node -e 'console.log(process.argv[1].replace(/[^֐-׿A-Za-z0-9-]+/g, "_") + ".json")' "$city")
  say "$city"

  # 1. capture on this machine (resumes a partial file; exit 2 = nadlan blocked the session)
  set +e
  npx tsx scripts/capture-nadlan-addresses.ts "$city" --out="$OUT_DIR" ${KARNAF_NADLAN_BUDGET_MIN:+--budget-min "$KARNAF_NADLAN_BUDGET_MIN"}
  rc=$?
  set -e
  if [ "$rc" -eq 2 ]; then die "nadlan חסם את הסשן — לסגור את הכרום, להפעיל מחדש דרך bootstrap_nadlan_chrome.sh ולהריץ שוב; הקובץ נשמר וההמשך מאותה נקודה"; fi
  if [ "$rc" -ne 0 ]; then warn "הלכידה של $city נכשלה — ממשיך לעיר הבאה"; fail_n=$((fail_n + 1)); continue; fi
  if [ ! -f "$OUT_DIR/$fname" ]; then warn "אין קובץ לכידה — ממשיך"; continue; fi

  # 2. upload + 3. apply on the server + 4. clean up
  if scp -q "$OUT_DIR/$fname" "$SERVER:$REMOTE_DATA/nadlan_addr/$fname" \
     && ssh "$SERVER" "cd $REMOTE_APP && docker compose exec -T app npx tsx scripts/backfill-nadlan-addresses.ts $(printf '%q' "$city") --from-file=/app/data/nadlan_addr/$(printf '%q' "$fname") </dev/null && rm -f $REMOTE_DATA/nadlan_addr/$(printf '%q' "$fname")"; then
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
echo "מצב הקמפיין בשרת:"
ssh "$SERVER" "cd $REMOTE_APP && docker compose exec -T app npx tsx scripts/backfill-nadlan-addresses.ts --status </dev/null" | head -20 || true
echo
echo "הצינור הלילי (02:30) יפיץ את הכתובות החדשות לעמודי השכונות, לחיפוש, לעמודי הרחוב והבניין ולנעצים על המפה."
