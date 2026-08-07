#!/usr/bin/env bash
#
# Install the scheduled timers. Idempotent — safe to re-run after edits.
#
#   bash /opt/karnaf/deploy/install-timers.sh
#
#   00:30      karnaf-collect   fetches new data from the government sources
#   02:30      karnaf-pipeline  cleans, classifies, aggregates and verifies it
#   Sun 04:30  karnaf-backup    publishes both databases to GitHub Releases
#
# The order is the whole point. For a while only the second existed, so the site
# re-derived a frozen snapshot every night — thoroughly, correctly, and without
# a single new transaction ever entering the database.
#
# Touches nothing outside its own four unit files: the OpenClaw bot and Traefik
# are not systemd-managed by us and are never referenced here.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

say() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[32m✓\033[0m %s\n" "$*"; }

command -v systemctl >/dev/null || { echo "✗ systemd לא זמין"; exit 1; }

say "התקנת יחידות systemd"
for u in karnaf-collect karnaf-pipeline karnaf-backup; do
  install -m 0644 "$u.service" /etc/systemd/system/
  install -m 0644 "$u.timer"   /etc/systemd/system/
  ok "/etc/systemd/system/$u.{service,timer}"
done

systemctl daemon-reload
ok "daemon-reload"

say "הפעלת הטיימרים"
systemctl enable --now karnaf-collect.timer
ok "karnaf-collect  — 00:30 · איסוף"
systemctl enable --now karnaf-pipeline.timer
ok "karnaf-pipeline — 02:30 · ניקוי ואגרגציה"
systemctl enable --now karnaf-backup.timer
ok "karnaf-backup   — ראשון 04:30 · גיבוי חוץ-שרתי"

# the backup unit needs a GitHub token; say so NOW, not on Sunday at 04:30
if [ ! -f /etc/karnaf/backup.env ]; then
  printf "  \033[33m⚠\033[0m חסר /etc/karnaf/backup.env — הגיבוי ייכשל בלי טוקן:\n"
  printf "      mkdir -p /etc/karnaf && echo 'GH_TOKEN=<token עם הרשאת repo>' > /etc/karnaf/backup.env && chmod 600 /etc/karnaf/backup.env\n"
fi
command -v gh >/dev/null || printf "  \033[33m⚠\033[0m gh CLI לא מותקן — נדרש לגיבוי: apt install gh\n"

say "מצב"
systemctl list-timers karnaf-collect.timer karnaf-pipeline.timer karnaf-backup.timer --no-pager || true

cat <<'EOF'

  ── בדיקה ראשונה מומלצת ─────────────────────────────────────

    docker compose exec -T app npx tsx scripts/collect.ts --probe-only

  זה בודק רק נגישות רשת לשלושת מארחי הממשלה, בלי לאסוף כלום.
  קוד יציאה 3 = אף מארח לא ענה (חסימה גיאוגרפית או רשת).

  ── פקודות שימושיות ─────────────────────────────────────────

    systemctl list-timers 'karnaf-*'          מתי הריצות הבאות
    systemctl start karnaf-collect.service    איסוף עכשיו
    systemctl start karnaf-pipeline.service   ניקוי עכשיו
    journalctl -u karnaf-collect -f           מעקב חי אחרי האיסוף
    journalctl -u karnaf-pipeline -f          מעקב חי אחרי הניקוי
    systemctl disable --now karnaf-collect.timer   כיבוי תזמון האיסוף

  ── קודי יציאה ──────────────────────────────────────────────

    karnaf-collect
      0  הכל רץ
      1  מקור אחד או יותר נכשל — האחרים המשיכו. רעש תפעולי רגיל.
      3  אף מארח לא ענה — בעיית רשת, לא באג. שום דבר לא נאסף.

    karnaf-pipeline
      0  הצלחה
      1  שלב נכשל — בדוק את הלוג
      2  שער אימות נכשל — הנתונים נכתבו אך לא עברו בדיקה עצמית.
         אל תריץ שוב לפני שהבנת למה.

EOF
