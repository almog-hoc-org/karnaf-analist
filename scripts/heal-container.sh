#!/bin/bash
# Restart the app container when Docker reports it unhealthy, and say so.
#
# WHY THIS EXISTS (20–28.9.2026)
# The Dockerfile HEALTHCHECK marks the container "unhealthy" after three failed
# probes of /api/health. Traefik then stops routing to it and the domain answers
# 404. But Docker's `restart: unless-stopped` reacts only to the process
# EXITING — an unhealthy container that is still running is left exactly as it
# is. So a one-minute stall became a week of 404 that nobody was told about.
#
# Run every 2 minutes by deploy/karnaf-heal.timer. It does nothing unless the
# container is both running and unhealthy, and it never restarts twice within
# COOLDOWN seconds, so a container that is unhealthy for a real reason (a bad
# deploy) is not bounced in a loop — the operator gets one email per attempt.
set -uo pipefail

CONTAINER="${KARNAF_CONTAINER:-karnaf-analist}"
COOLDOWN="${KARNAF_HEAL_COOLDOWN:-900}"
STAMP_FILE="/run/karnaf-heal.last"
cd "$(dirname "${BASH_SOURCE[0]}")/.."

state=$(docker inspect -f '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo "missing")
case "$state" in
  "true unhealthy") ;;
  *) exit 0 ;;
esac

now=$(date +%s)
last=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
if [ $((now - last)) -lt "$COOLDOWN" ]; then
  echo "unhealthy, but restarted $((now - last))s ago — waiting (cooldown ${COOLDOWN}s)"
  exit 0
fi
echo "$now" > "$STAMP_FILE"

# What the probe said, and what the box looked like, BEFORE the restart erases it.
HEALTH_LOG=$(docker inspect -f '{{range .State.Health.Log}}{{.Start}} exit={{.ExitCode}} {{.Output}}{{"\n"}}{{end}}' "$CONTAINER" 2>/dev/null | tail -3)
STATS=$(docker stats --no-stream --format '{{.MemUsage}} · CPU {{.CPUPerc}}' "$CONTAINER" 2>/dev/null)
PROCS=$(docker exec "$CONTAINER" sh -c 'ps -o pid,rss,etime,args 2>/dev/null | head -12' 2>/dev/null)

echo "▸ $CONTAINER unhealthy — restarting"
docker restart "$CONTAINER" >/dev/null 2>&1
sleep 60
after=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER" 2>/dev/null || echo unknown)

bash scripts/alert.sh "קרנף אנליסט: הקונטיינר אותחל (היה unhealthy, עכשיו $after)" "$(printf '%s\n\nמצב אחרי אתחול: %s\n\nזיכרון ומעבד לפני: %s\n\nבדיקות health אחרונות:\n%s\n\nתהליכים לפני:\n%s\n' \
  "הקונטיינר $CONTAINER סומן unhealthy ולכן Traefik הפסיק לנתב אליו (האתר החזיר 404). הוא אותחל אוטומטית." \
  "$after" "$STATS" "$HEALTH_LOG" "$PROCS")"
