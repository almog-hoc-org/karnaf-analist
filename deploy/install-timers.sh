#!/usr/bin/env bash
#
# Install the nightly pipeline timer. Idempotent — safe to re-run after edits.
#
#   bash /opt/karnaf/deploy/install-timers.sh
#
# Touches nothing outside its own two unit files: the OpenClaw bot and Traefik
# are not systemd-managed by us and are never referenced here.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

say() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[32m✓\033[0m %s\n" "$*"; }

command -v systemctl >/dev/null || { echo "✗ systemd לא זמין"; exit 1; }

say "התקנת יחידות systemd"
install -m 0644 karnaf-pipeline.service /etc/systemd/system/
install -m 0644 karnaf-pipeline.timer   /etc/systemd/system/
ok "/etc/systemd/system/karnaf-pipeline.{service,timer}"

systemctl daemon-reload
ok "daemon-reload"

say "הפעלת הטיימר"
systemctl enable --now karnaf-pipeline.timer
ok "מופעל ויפעל אוטומטית גם אחרי אתחול"

say "מצב"
systemctl list-timers karnaf-pipeline.timer --no-pager || true

cat <<'EOF'

  פקודות שימושיות:

    systemctl list-timers karnaf-pipeline.timer   מתי הריצה הבאה
    systemctl start karnaf-pipeline.service       הרצה עכשיו (לבדיקה)
    journalctl -u karnaf-pipeline -f              מעקב חי
    journalctl -u karnaf-pipeline -n 100          100 שורות אחרונות
    systemctl disable --now karnaf-pipeline.timer כיבוי התזמון

  קודי יציאה:
    0  הצלחה
    1  שלב נכשל  — בדוק את הלוג
    2  שער אימות נכשל — הנתונים נכתבו אך לא עברו בדיקה עצמית.
       אל תריץ שוב לפני שהבנת למה.

EOF
