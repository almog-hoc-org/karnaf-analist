#!/usr/bin/env bash
#
# Install the two nightly timers. Idempotent — safe to re-run after edits.
#
#   bash /opt/karnaf/deploy/install-timers.sh
#
#   00:30  karnaf-collect   fetches new data from the government sources
#   02:30  karnaf-pipeline  cleans, classifies, aggregates and verifies it
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
for u in karnaf-collect karnaf-pipeline; do
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

say "מצב"
systemctl list-timers karnaf-collect.timer karnaf-pipeline.timer --no-pager || true

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
