#!/bin/bash
# Quick helper — print the current working URLs for the dev server.
# Run anytime: ./scripts/show_link.sh
set -e

HOSTNAME=$(scutil --get LocalHostName 2>/dev/null)
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
PORT=${PORT:-3000}

echo "═════════════════════════════════════════════"
echo "  🔗 קישורים פעילים לאתר"
echo "═════════════════════════════════════════════"
echo ""

# Status check
if curl -sf --max-time 3 "http://localhost:${PORT}/" > /dev/null 2>&1; then
  echo "  ✓ השרת רץ ועונה (HTTP 200)"
else
  echo "  ✗ השרת לא עונה. הפעל ב-launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.karnaf.realestate.devserver.plist"
  exit 1
fi

echo ""
echo "  📱 לסלולרי / טאבלט באותו Wi-Fi (כתובת יציבה — לא משתנה):"
echo "     http://${HOSTNAME}.local:${PORT}/"
echo ""
echo "  💻 ל-IP נוכחי (משתנה כשמתחברים מחדש לרשת):"
echo "     http://${LAN_IP}:${PORT}/"
echo ""
echo "  🖥️  למק עצמו (תמיד עובד):"
echo "     http://localhost:${PORT}/"
echo ""
echo "─────────────────────────────────────────────"
echo "  💡 לכתובת קצרה ויפה (karnaf.local) הרץ פעם אחת:"
echo "     sudo scutil --set LocalHostName karnaf"
echo "─────────────────────────────────────────────"
