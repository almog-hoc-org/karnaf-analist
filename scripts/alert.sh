#!/bin/bash
# Email the operator from the HOST, without going through the app container.
#
# WHY ON THE HOST
# The failures this reports are exactly the ones where the container cannot be
# trusted: it is unhealthy, stopped, or the job inside it hung. Sending through
# the app (lib/notify.ts) would fail in the same moment. This talks to Resend's
# HTTP API directly with curl, reading the same keys the app uses from
# /opt/karnaf/.env.production.
#
# Usage:
#   bash scripts/alert.sh "<subject>" "<body text>"
#   bash scripts/alert.sh --unit <systemd-unit>       (subject + last 40 journal lines)
#
# Called by deploy/karnaf-alert@.service (OnFailure= of every karnaf unit) and
# by scripts/heal-container.sh. With no RESEND_API_KEY it prints and exits 0:
# an alert that cannot be sent must never turn into a second failure.
set -uo pipefail

ENV_FILE="${KARNAF_ENV_FILE:-/opt/karnaf/.env.production}"
read_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

KEY="${RESEND_API_KEY:-$(read_env RESEND_API_KEY)}"
FROM="${NOTIFY_FROM_EMAIL:-$(read_env NOTIFY_FROM_EMAIL)}"
TO="${NOTIFY_TO_EMAIL:-$(read_env NOTIFY_TO_EMAIL)}"
HOST_NAME="$(hostname 2>/dev/null || echo server)"

if [ "${1:-}" = "--unit" ]; then
  UNIT="${2:-unknown}"
  SUBJECT="קרנף אנליסט: $UNIT נכשל"
  BODY="$(printf 'היחידה %s נכשלה על %s בשעה %s.\n\n--- 40 השורות האחרונות ביומן ---\n%s\n' \
    "$UNIT" "$HOST_NAME" "$(date '+%d.%m.%Y %H:%M')" \
    "$(journalctl -u "$UNIT" -n 40 --no-pager 2>/dev/null || echo '(אין גישה ליומן)')")"
else
  SUBJECT="${1:-קרנף אנליסט: התראה}"
  BODY="${2:-}"
fi

echo "▸ alert: $SUBJECT"
if [ -z "$KEY" ] || [ -z "$FROM" ] || [ -z "$TO" ]; then
  echo "  (RESEND_API_KEY / NOTIFY_FROM_EMAIL / NOTIFY_TO_EMAIL not set — printed only)"
  printf '%s\n' "$BODY"
  exit 0
fi

# JSON-encode with python3 (present on every Ubuntu host) so journal text with
# quotes, backslashes or Hebrew cannot break the payload.
PAYLOAD=$(SUBJECT="$SUBJECT" BODY="$BODY" FROM="$FROM" TO="$TO" python3 -c '
import json, os
print(json.dumps({
  "from": os.environ["FROM"],
  "to": [t.strip() for t in os.environ["TO"].split(",") if t.strip()],
  "subject": os.environ["SUBJECT"],
  "text": os.environ["BODY"],
}))')

code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "$PAYLOAD" https://api.resend.com/emails || echo 000)
if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 300 ]; then
  echo "  ✓ sent ($code)"
else
  echo "  ✗ send failed (HTTP $code)"
fi
exit 0
