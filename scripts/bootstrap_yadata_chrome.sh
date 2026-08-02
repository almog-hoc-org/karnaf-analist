#!/bin/bash
# One-time bootstrap to teach Cloudflare that the dedicated Chrome profile is
# a real human. After you pass the challenge once, the cookie persists in this
# profile and the monthly automated refresh stops hitting the challenge.
#
# Usage:
#   bash scripts/bootstrap_yadata_chrome.sh
#
# What you do:
#   1. The script opens a fresh Chrome window (separate from your normal one)
#      pointed at https://yadata.yad2.co.il/market/sale?city=5000 (Tel Aviv).
#   2. If a "Verifying your browser" page shows up — wait a few seconds, or
#      click the checkbox if Cloudflare asks.
#   3. Once you see the actual Yadata content (numbers + Hebrew labels), CLOSE
#      the Chrome window (cookies are now saved in the profile).
#   4. Run scripts/refresh_yadata_monthly.sh to do the actual scrape.
set -uo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/paths.sh"
CHROME_PROFILE="$HOME/Library/Caches/karnaf-chrome-yadata-profile"

mkdir -p "$CHROME_PROFILE"

echo "═══════════════════════════════════════════════════════════"
echo "  Yadata Chrome bootstrap"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Opening a dedicated Chrome window. Steps:"
echo "  1. Wait for Yadata to load (might show a Cloudflare check briefly)"
echo "  2. Confirm you see real data (KPIs + Hebrew labels)"
echo "  3. CLOSE the Chrome window when ready"
echo ""

# Open a real, visible Chrome with the dedicated profile so the user can see the page
"$CHROME_BIN" \
  --user-data-dir="$CHROME_PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  "https://yadata.yad2.co.il/market/sale?city=5000"

echo ""
echo "✓ Bootstrap complete. Cookies saved to:"
echo "  $CHROME_PROFILE"
echo ""
echo "Next: run the monthly refresh to verify:"
echo "  bash scripts/refresh_yadata_monthly.sh"
