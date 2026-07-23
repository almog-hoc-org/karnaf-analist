#!/bin/bash
# Print all working URLs to the dev server.
# Run anytime: ./scripts/show_link.sh
set -e

HOSTNAME=$(scutil --get LocalHostName 2>/dev/null)
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
PORT=${PORT:-3000}
CLOUDFLARED_LOG=~/Library/Logs/Karnaf/cloudflared.log
PUBLIC_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$CLOUDFLARED_LOG" 2>/dev/null | tail -1)

echo "═════════════════════════════════════════════"
echo "  🔗 קישורים פעילים לאתר"
echo "═════════════════════════════════════════════"
echo ""

# Status check
if curl -sf --max-time 3 "http://localhost:${PORT}/" > /dev/null 2>&1; then
  echo "  ✓ השרת רץ ועונה (HTTP 200)"
else
  echo "  ✗ השרת לא עונה."
  echo "    הפעל: launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.karnaf.realestate.devserver.plist"
  exit 1
fi

# Test public URL if present
if [ -n "$PUBLIC_URL" ]; then
  CODE=$(curl -sf --max-time 5 -o /dev/null -w "%{http_code}" "$PUBLIC_URL" 2>/dev/null || echo "down")
  if [ "$CODE" = "200" ]; then
    echo "  ✓ Tunnel ציבורי פעיל (HTTP 200)"
  else
    PUBLIC_URL=""
  fi
fi

echo ""

if [ -n "$PUBLIC_URL" ]; then
  echo "  🌐 לכל מקום בעולם (סלולר/Wi-Fi/אחר):"
  echo "     $PUBLIC_URL"
  echo "     ↑ זה הקישור היחיד שאתה צריך לשלוח לאחרים"
  echo ""
fi

echo "  📱 לסלולרי באותו Wi-Fi (כתובת יציבה):"
echo "     http://${HOSTNAME}.local:${PORT}/"
echo ""
echo "  💻 ל-IP נוכחי (משתנה כשמתחברים מחדש לרשת):"
echo "     http://${LAN_IP}:${PORT}/"
echo ""
echo "  🖥️  למק עצמו:"
echo "     http://localhost:${PORT}/"
echo ""
echo "─────────────────────────────────────────────"
if [ -z "$PUBLIC_URL" ]; then
  echo "  ⚠ Tunnel לא פעיל. הפעל אותו:"
  echo "     launchctl kickstart -k gui/\$(id -u)/com.karnaf.realestate.cloudflared"
  echo "     ואז הרץ שוב ./scripts/show_link.sh"
fi
echo "─────────────────────────────────────────────"
