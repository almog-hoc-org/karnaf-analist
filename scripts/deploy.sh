#!/usr/bin/env bash
#
# Deploy: pull the latest code, rebuild the image, swap the container.
#
#   bash scripts/deploy.sh              # pull + build + restart
#   bash scripts/deploy.sh --no-pull    # rebuild what is already checked out
#
# SAFE TO RUN REPEATEDLY. The databases live in /var/lib/karnaf, outside this
# directory and outside the image, so a deploy cannot touch them — that
# separation is the single most important property of this setup.
#
# It also never touches the OpenClaw bot or Traefik: it builds one image and
# restarts one container.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

DATA_ROOT="/var/lib/karnaf"
say()  { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
die()  { printf "\n\033[31m✗ %s\033[0m\n" "$*"; exit 1; }

# ── preflight ───────────────────────────────────────────────────────
[ -f .env.production ] || die ".env.production חסר. הרץ: cp .env.example .env.production && nano .env.production"

# Compose interpolates ${APP_HOST} in the Traefik labels at PARSE time, and it
# only looks in the shell environment and in a file literally named `.env` —
# NOT in `env_file:`, which only populates the container's own environment.
#
# Without this symlink, running `docker compose up` by hand (rather than through
# this script) silently produces the label Host(``) with an empty hostname.
# Traefik then has no route matching the site and answers 404 for every path,
# while `docker ps` cheerfully reports the container as healthy — which is about
# the most confusing failure this setup can produce. The symlink makes the
# manual command behave identically to this script.
[ -e .env ] || ln -s .env.production .env

# shellcheck disable=SC1091
set -a; source .env.production; set +a
[ -n "${APP_HOST:-}" ]       || die "APP_HOST לא מוגדר ב-.env.production"
[ -n "${ADMIN_PASSWORD:-}" ] || die "ADMIN_PASSWORD ריק — לוח הניהול ייחסם לחלוטין (fail-closed מכוון)"

[ -d "$DATA_ROOT/data" ] || die "$DATA_ROOT/data לא קיים. הרץ קודם: bash scripts/server-setup.sh"

if [ ! -s "$DATA_ROOT/data/realestate.db" ]; then
  printf "\n\033[33m! %s\033[0m\n" "אין realestate.db ב-$DATA_ROOT/data — האתר יעלה ריק."
  read -rp "  להמשיך בכל זאת? [y/N] " a; [ "$a" = "y" ] || exit 1
fi

# ── record where we can roll back to ────────────────────────────────
PREV_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [ "${1:-}" != "--no-pull" ]; then
  say "משיכת קוד מגיטהאב"
  git pull --ff-only || die "git pull נכשל — יש שינויים מקומיים? נסה: git stash"
  ok "$PREV_SHA → $(git rev-parse --short HEAD)"
fi

# ── backup before anything can change the data ──────────────────────
say "גיבוי מסד הנתונים"
STAMP="$(date +%Y%m%d-%H%M%S)"
for db in realestate app; do
  if [ -s "$DATA_ROOT/data/$db.db" ]; then
    # .backup, not cp: it is consistent even while the DB is being written to.
    sqlite3 "$DATA_ROOT/data/$db.db" ".backup '$DATA_ROOT/backups/$db-$STAMP.db'" 2>/dev/null \
      && ok "$db.db → backups/$db-$STAMP.db" \
      || printf "  ! גיבוי %s נכשל — ממשיכים\n" "$db"
  fi
done
# Keep the last 10 of each; backups are insurance, not an archive.
#
# The `|| true` is load-bearing. With `set -euo pipefail`, `ls` over a glob that
# matches nothing exits non-zero, pipefail propagates that through the pipeline,
# and set -e kills the whole script — silently, right after the backup step, on
# the very FIRST deploy when no backups exist yet. Housekeeping must never be
# able to abort a deployment.
prune_backups() {
  ls -1t "$DATA_ROOT/backups"/"$1"-*.db 2>/dev/null | tail -n +11 | xargs -r rm -f || true
}
prune_backups realestate
prune_backups app
ok "גיבויים ישנים נוקו (נשמרים 10 אחרונים)"

# ── build ───────────────────────────────────────────────────────────
# Built BEFORE the running container is stopped, so a build failure leaves the
# current site untouched and serving.
say "בניית האימג׳ (הפעם הראשונה לוקחת כמה דקות)"
docker compose build || die "הבנייה נכשלה — האתר הישן ממשיך לרוץ ללא שינוי"
ok "נבנה"

say "החלפת הקונטיינר"
docker compose up -d --remove-orphans || die "ההעלאה נכשלה"
ok "רץ"

# ── verify ──────────────────────────────────────────────────────────
say "בדיקת בריאות"
HEALTH_PATH="${NEXT_PUBLIC_BASE_PATH:-}/api/health"
for i in $(seq 1 30); do
  if docker compose exec -T app curl -fsS "http://127.0.0.1:3000${HEALTH_PATH}" >/dev/null 2>&1; then
    ok "האפליקציה עונה (אחרי ${i}0 שניות לכל היותר)"
    break
  fi
  [ "$i" -eq 30 ] && {
    printf "\n\033[31m✗ לא ענתה תוך 5 דקות. לוג אחרון:\033[0m\n"
    docker compose logs --tail 40 app
    die "לחזרה לגרסה הקודמת:  git checkout $PREV_SHA && bash scripts/deploy.sh --no-pull"
  }
  sleep 10
done

# ── prove we did not disturb the neighbours ─────────────────────────
say "וידוא שלא נגענו בשכנים"
pgrep -f "openclaw" >/dev/null 2>&1 && ok "בוט OpenClaw עדיין רץ" || printf "  ! הבוט לא זוהה — בדוק\n"
docker ps --format '{{.Names}}' | grep -q traefik && ok "Traefik עדיין רץ" || printf "  ! Traefik לא רץ\n"

say "הושלם"
cat <<EOF

  🌐 https://${APP_HOST}

  התעודה מונפקת אוטומטית ע"י Traefik ועשויה לקחת עד דקה בפעם הראשונה.

  שימושי:
    docker compose logs -f app                לוגים חיים
    curl -s https://${APP_HOST}/api/status    טריות הנתונים
    docker stats --no-stream karnaf-analist   צריכת זיכרון

EOF
