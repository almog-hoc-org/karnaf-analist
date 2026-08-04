#!/usr/bin/env bash
#
# ═══ הרץ פעם אחת, על השרת ═══
#
# Create a deploy key so GitHub Actions can deploy without a human in the loop.
#
# WHY A SEPARATE KEY
# Reusing the key you log in with would hand a CI runner the same access you
# have, forever, with no way to revoke one without breaking the other. This
# generates a dedicated key that does one job and can be deleted in one line the
# day it is no longer wanted — or the day it leaks.
#
# The private key is printed ONCE, for you to paste into GitHub's secret store.
# It is never committed, never sent anywhere by this script, and the file is
# removed from the server afterwards: GitHub holds the only copy, which is the
# point — a private key sitting on the machine it unlocks is not a second factor.
set -euo pipefail

KEY=/root/.ssh/karnaf_ci
AUTH=/root/.ssh/authorized_keys

say() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()  { printf "  \033[32m✓\033[0m %s\n" "$*"; }

mkdir -p /root/.ssh && chmod 700 /root/.ssh

say "יצירת מפתח ייעודי ל-CI"
rm -f "$KEY" "$KEY.pub"
ssh-keygen -t ed25519 -f "$KEY" -N "" -C "karnaf-github-actions" >/dev/null
ok "נוצר"

say "הרשאה בשרת"
# A missing trailing newline on the existing file would concatenate this key
# onto the previous line and silently disable BOTH. That exact bug cost an hour
# earlier in this project, so the file is normalised first.
[ -f "$AUTH" ] && [ -n "$(tail -c1 "$AUTH")" ] && echo >> "$AUTH"
cat "$KEY.pub" >> "$AUTH"
chmod 600 "$AUTH"
ok "נוסף ל-authorized_keys"

cat <<EOF

════════════════════════════════════════════════════════════
  העתק את שלושת הערכים לגיטהאב
════════════════════════════════════════════════════════════

  Settings → Secrets and variables → Actions → New repository secret

  ┌─ VPS_HOST ─────────────────────────────────────────────
  $(curl -s --max-time 5 ifconfig.me || echo "72.62.7.226")

  ┌─ VPS_USER ─────────────────────────────────────────────
  root

  ┌─ VPS_SSH_KEY ──────────────────────────────────────────
  כל מה שבין השורות הבאות, כולל שורות ה-BEGIN וה-END:

EOF
cat "$KEY"
cat <<'EOF'

════════════════════════════════════════════════════════════

  אחרי שהדבקת את שלושתם בגיטהאב — מחק את המפתח מהשרת:

    rm -f /root/.ssh/karnaf_ci /root/.ssh/karnaf_ci.pub

  גיטהאב יחזיק את העותק היחיד. מפתח פרטי ששוכב על המכונה
  שהוא פותח אינו גורם אימות שני.

  לביטול הגישה בעתיד — שורה אחת:
    sed -i '/karnaf-github-actions/d' /root/.ssh/authorized_keys

EOF
