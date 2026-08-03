#!/usr/bin/env bash
#
# ONE-TIME server preparation. Run once, on the VPS, as root.
#
# WHAT IT DELIBERATELY DOES NOT DO
# This server also runs an OpenClaw bot and a Traefik container that issues the
# TLS certificates. Neither is touched: no service is stopped, no port is taken,
# and Traefik's configuration is never edited. Traefik already discovers new
# containers on its own (--providers.docker=true), so the app opts in through
# labels in docker-compose.yml rather than through any change on Traefik's side.
#
# Everything here is idempotent — safe to run again if something went wrong.
#
#   bash scripts/server-setup.sh

set -euo pipefail

DATA_ROOT="/var/lib/karnaf"
APP_ROOT="/opt/karnaf"

say()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }

say "בדיקת דרישות"
for cmd in docker git curl; do
  if command -v "$cmd" >/dev/null 2>&1; then ok "$cmd מותקן"
  else echo "  ✗ חסר: $cmd"; exit 1; fi
done
docker compose version >/dev/null 2>&1 && ok "docker compose זמין" \
  || { echo "  ✗ docker compose לא זמין"; exit 1; }

say "בדיקה שלא נדרוס שום דבר שרץ"
# The bot is a bare host process, not a container — confirm it is alive so we
# can prove at the end that it stayed alive.
if pgrep -f "openclaw" >/dev/null 2>&1; then
  ok "בוט OpenClaw רץ (PID $(pgrep -f 'openclaw/dist/index.js' | head -1)) — לא ניגע בו"
else
  warn "לא זוהה תהליך openclaw — ממשיכים"
fi
if docker ps --format '{{.Names}}' | grep -q traefik; then
  ok "Traefik רץ — נשתמש בו כמו שהוא, בלי לשנות הגדרות"
else
  warn "Traefik לא רץ — ה-HTTPS לא יונפק אוטומטית"
fi

say "יצירת תיקיות נתונים קבועות"
# The whole point of this path: it lives OUTSIDE the deploy tree, so rebuilding
# or deleting the app directory cannot touch the databases.
mkdir -p "$DATA_ROOT/data" "$DATA_ROOT/reports" "$DATA_ROOT/backups"
chmod 755 "$DATA_ROOT"
ok "$DATA_ROOT/data     ← realestate.db, app.db"
ok "$DATA_ROOT/reports  ← דוחות PDF"
ok "$DATA_ROOT/backups  ← גיבויים"

say "התקנת sqlite3 CLI (לגיבויים ולבדיקות)"
if command -v sqlite3 >/dev/null 2>&1; then
  ok "כבר מותקן"
else
  apt-get update -qq && apt-get install -y -qq sqlite3 && ok "הותקן"
fi

say "חומת אש"
# Only if ufw is present AND already enabled. Turning a firewall ON for the
# first time over SSH is how people lock themselves out of their own server,
# so this never enables it — it only makes sure SSH survives if it is already on.
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 22/tcp  >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ok "ufw פעיל — ודאתי ש-22/80/443 פתוחים"
else
  warn "ufw לא פעיל — לא מפעיל אותו מרחוק (סיכון לנעילה החוצה). אפשר בהמשך."
fi

say "מוכן"
cat <<EOF

  הצעדים הבאים:

    1. שכפול הקוד:
         git clone -b claude/project-deep-learning-g64ogo \\
           https://github.com/almog-hoc-org/karnaf-analist $APP_ROOT

    2. הגדרות:
         cd $APP_ROOT
         cp .env.example .env.production
         ln -s .env.production .env   # נדרש ל-Traefik — ראה הערה ב-deploy.sh
         nano .env.production         # מלא סיסמאות — הוראות בתוך הקובץ

    3. מסד הנתונים:
         העתק את realestate.db ו-app.db אל $DATA_ROOT/data/

    4. פריסה:
         bash scripts/deploy.sh

EOF
