#!/bin/bash
# Bootstrap a dedicated, debuggable Chrome for the nadlan.gov.il build-year scrape.
#
# nadlan's /deal-data endpoint (which carries שנת בנייה / yearBuilt + ₪/מ"ר) is
# protected by reCAPTCHA Enterprise. A headless/stealth browser scores too low
# (HTTP 401). A REAL, visible Chrome on your real IP scores fine. This launches
# such a Chrome with remote-debugging so Claude can attach and pull the deals.
#
# It uses a SEPARATE profile, so it runs happily ALONGSIDE your normal Chrome.
#
# Usage:
#   bash scripts/bootstrap_nadlan_chrome.sh
#
# Then:
#   1. A new Chrome window opens on nadlan.gov.il.
#   2. If a "אני לא רובוט"/Cloudflare/verify screen appears — pass it once.
#   3. Click into any city → neighborhood → עסקאות, so real deal data loads once
#      (this warms the reCAPTCHA token). Leave the window open.
#   4. Tell Claude "Chrome מוכן" — it will attach on port 9222 and start.
set -uo pipefail

CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
CHROME_PROFILE="$HOME/Library/Caches/karnaf-chrome-nadlan-profile"
PORT=9222

mkdir -p "$CHROME_PROFILE"

echo "═══════════════════════════════════════════════════════════"
echo "  nadlan.gov.il  —  debuggable Chrome bootstrap"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Opening a dedicated Chrome window (separate from your normal one)."
echo "Steps:"
echo "  1. Wait for nadlan.gov.il to load."
echo "  2. If a verify / 'אני לא רובוט' screen shows — pass it once."
echo "  3. Open any city → neighborhood → עסקאות so deals load once."
echo "  4. Leave this window OPEN and tell Claude 'Chrome מוכן'."
echo ""
echo "Debug port: http://127.0.0.1:$PORT"
echo ""

exec "$CHROME_BIN" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$CHROME_PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=Translate \
  "https://www.nadlan.gov.il/"
