#!/usr/bin/env bash
#
# Install the scheduled timers. Idempotent — safe to re-run after edits.
#
#   bash /opt/karnaf/deploy/install-timers.sh
#
#   00:30      karnaf-collect   fetches new data from the government sources
#   02:30      karnaf-pipeline  cleans, classifies, aggregates and verifies it
#   Sun 04:30  karnaf-backup    publishes both databases to GitHub Releases
#   Sun 08:00  karnaf-digest    emails followed-city summaries to opted-in users
#   every 2m   karnaf-heal      restarts the app container if it is unhealthy
#   on failure karnaf-alert@    emails the operator when any unit above fails
#
# The order is the whole point. For a while only the second existed, so the site
# re-derived a frozen snapshot every night — thoroughly, correctly, and without
# a single new transaction ever entering the database.
#
# Touches nothing outside its own unit files: the OpenClaw bot and Traefik are
# not systemd-managed by us and are never referenced here.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

say() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[32m✓\033[0m %s\n" "$*"; }

command -v systemctl >/dev/null || { echo "✗ systemd לא זמין"; exit 1; }

# Every schedule above is Israel time. The host runs on UTC and is shared with
# the OpenClaw bot, so its timezone is NOT changed here; each timer carries its
# own zone instead (OnCalendar=… Asia/Jerusalem). Until 28.9.2026 they did not,
# and "00:30" was 03:30 in Israel.
say "התקנת יחידות systemd"
for u in karnaf-collect karnaf-pipeline karnaf-backup karnaf-digest karnaf-heal; do
  install -m 0644 "$u.service" /etc/systemd/system/
  install -m 0644 "$u.timer"   /etc/systemd/system/
  ok "/etc/systemd/system/$u.{service,timer}"
done
# the failure-alert template (OnFailure= of every unit above); no timer
install -m 0644 "karnaf-alert@.service" /etc/systemd/system/
ok "/etc/systemd/system/karnaf-alert@.service"

systemctl daemon-reload
ok "daemon-reload"

say "הפעלת הטיימרים"
systemctl enable --now karnaf-collect.timer
ok "karnaf-collect  — 00:30 · איסוף"
systemctl enable --now karnaf-pipeline.timer
ok "karnaf-pipeline — 02:30 · ניקוי ואגרגציה"
systemctl enable --now karnaf-backup.timer
ok "karnaf-backup   — ראשון 04:30 · גיבוי חוץ-שרתי"
systemctl enable --now karnaf-digest.timer
ok "karnaf-digest   — ראשון 08:00 · סיכום שבועי לערים במעקב"
systemctl enable --now karnaf-heal.timer
ok "karnaf-heal     — כל 2 דקות · אתחול קונטיינר unhealthy + מייל"

# alerts go by email from the host (scripts/alert.sh); say now if they cannot
grep -q '^RESEND_API_KEY=.\+' /opt/karnaf/.env.production 2>/dev/null \
  || printf "  \033[33m⚠\033[0m חסר RESEND_API_KEY ב-.env.production — התראות יודפסו ליומן בלבד, לא יישלחו במייל\n"
command -v python3 >/dev/null || printf "  \033[33m⚠\033[0m python3 חסר — scripts/alert.sh צריך אותו לבניית המייל\n"

# the backup unit needs a GitHub token; say so NOW, not on Sunday at 04:30
if [ ! -f /etc/karnaf/backup.env ]; then
  printf "  \033[33m⚠\033[0m חסר /etc/karnaf/backup.env — הגיבוי ייכשל בלי טוקן:\n"
  printf "      mkdir -p /etc/karnaf && echo 'GH_TOKEN=<token עם הרשאת repo>' > /etc/karnaf/backup.env && chmod 600 /etc/karnaf/backup.env\n"
fi
command -v gh >/dev/null || printf "  \033[33m⚠\033[0m gh CLI לא מותקן — נדרש לגיבוי: apt install gh\n"
command -v age >/dev/null || printf "  \033[33m⚠\033[0m age לא מותקן — בלעדיו נתוני המשתמשים לא נכנסים לגיבוי: apt install age\n"
grep -q '^KARNAF_BACKUP_AGE_RECIPIENT=age1' /etc/karnaf/backup.env 2>/dev/null \
  || printf "  \033[33m⚠\033[0m חסר KARNAF_BACKUP_AGE_RECIPIENT ב-/etc/karnaf/backup.env — app.db לא יגובה (ראו scripts/publish-backup.sh)\n"

say "מצב"
systemctl list-timers karnaf-collect.timer karnaf-pipeline.timer karnaf-backup.timer karnaf-digest.timer karnaf-heal.timer --no-pager || true

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
    docker compose exec -T app npx tsx scripts/send-weekly-digest.ts --dry-run   תצוגה מקדימה של הסיכום השבועי
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
