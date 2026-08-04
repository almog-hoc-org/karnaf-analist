#!/usr/bin/env bash
#
# ═══ הרץ על המק, עם Chrome של bootstrap_nadlan_chrome.sh פתוח ═══
#
# Does the nadlan channel return data for the localities govmap leaves empty?
#
# THE ONE QUESTION LEFT
# A coverage audit found 53 of 165 localities almost empty — Kuseife with 1 deal
# across ten years against 21,849 residents, against a national median of 50.9
# per 1,000. Three explanations died on measurement: the property-type filter
# never ran, name resolution worked perfectly, and the endpoint is fine for
# Haifa. A privacy threshold by density is also out — a Haifa polygon indexed at
# 1 returns 608 deals while an Or Akiva polygon indexed at 215 returns 0.
#
# What remains is that the two channels appear to partition the country: in
# every one of those localities EXACTLY ONE of govmap and nadlan has data, never
# both. So the question is whether nadlan — a completely separate path, by CBS
# code through the settlement page, with no polygons and no neighborhood-deals
# call — reaches what govmap cannot.
#
# Hundreds returned means a bypass exists and the fix is a targeted campaign.
# Tens means the deals genuinely are not registered there, our coverage is
# honest, and the site's wording needs to say that instead of promising a
# completion we cannot deliver. Both answers are actionable; neither wastes the
# run.
#
# TOUCHES NOTHING. Collects into a throwaway database under /tmp. The live
# archive on the server is not involved, and neither is any working copy here.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROBE_DIR="${TMPDIR:-/tmp}/karnaf-nadlan-probe"
# Four localities where nadlan currently has nothing, one where it demonstrably
# worked (Isfiya — the control that proves a null result means something), and
# one extreme case.
CITIES=("שפרעם" "כפר מנדא" "טייבה" "עספיא" "רהט" "כסיפה")

say()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*"; exit 1; }

say "בדיקת Chrome"
curl -s --max-time 3 http://127.0.0.1:9222/json/version >/dev/null 2>&1 \
  || die "אין Chrome עם דיבאג על פורט 9222.
  פתח טרמינל נוסף והרץ:  bash scripts/bootstrap_nadlan_chrome.sh
  עבור את האימות פעם אחת, השאר את החלון פתוח, וחזור לכאן."
ok "Chrome מחובר"

say "קליינט Prisma"
# `prisma generate` runs only as part of `npm run build`, never on npm install,
# so a freshly cloned machine has no client and the collector dies with
# "Cannot find module '.prisma/client/default'". Seconds, and idempotent.
npx prisma generate >/dev/null 2>&1 || die "npx prisma generate נכשל."
ok "נוצר"

say "מסד זמני"
rm -rf "$PROBE_DIR"; mkdir -p "$PROBE_DIR"
npx prisma db push --url="file:$PROBE_DIR/realestate.db" --accept-data-loss >/dev/null 2>&1 \
  || die "יצירת המסד הזמני נכשלה."
ok "$PROBE_DIR/realestate.db  (המסד האמיתי לא מעורב)"

say "איסוף nadlan — ${#CITIES[@]} יישובים"
# --force because the scratch database is empty: every city is new here, and the
# freshness manifest belongs to the server's archive, not this one.
#
# ⚠️ THE EXIT CODE IS CHECKED, AND THAT IS THE WHOLE POINT OF THIS SCRIPT.
# This line ended in `|| true`. A crash therefore printed "0 עסקאות" followed by
# the reading guide — which is to say, it printed the exact reading that means
# "the source is thin", the conclusion this script exists to establish. That is
# the fourth time today a swallowed error has impersonated a real result, and
# the first time it was mine.
#
# A tool whose only job is to interpret a zero MUST distinguish "ran and found
# nothing" from "did not run". So: no results table and no reading guide unless
# the collector actually completed.
if ! KARNAF_DATA_DIR="$PROBE_DIR" npx tsx scripts/collect-nadlan-transactions.ts --force "${CITIES[@]}"; then
  die "הקולקטור נכשל — אין תוצאה לפרש.
  אפס עסקאות כאן פירושו שהאיסוף לא רץ, לא שהמקור דליל.
  תקן את השגיאה למעלה והרץ שוב."
fi

say "תוצאה"
sqlite3 -header -column "$PROBE_DIR/realestate.db" "
  SELECT city_name AS עיר,
         COUNT(*) AS עסקאות,
         COUNT(DISTINCT deal_year) AS שנים,
         MIN(deal_year) || '-' || MAX(deal_year) AS טווח,
         SUM(CASE WHEN year_built > 0 THEN 1 ELSE 0 END) AS שנת_בנייה
    FROM nadlan_transactions
   GROUP BY city_name
   ORDER BY COUNT(*) DESC;"

TOTAL=$(sqlite3 "$PROBE_DIR/realestate.db" "SELECT COUNT(*) FROM nadlan_transactions;")
cat <<EOF

  סה"כ $TOTAL עסקאות.

  איך לקרוא:
    מאות לעיר   → מסלול עוקף קיים. מריצים קמפיין ממוקד על 53 היישובים.
    עשרות לעיר  → הנתונים באמת דלילים במקור. מחדדים את הנוסח באתר.

  עספיא היא הביקורת: שם nadlan כבר הוכח כעובד. אם גם היא מחזירה עשרות,
  זה מחזק שהמקור דליל ולא שהערוץ שבור.

EOF
