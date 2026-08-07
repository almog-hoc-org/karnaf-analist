#!/bin/bash
# Publish an off-server backup of both databases as a GitHub Release.
#
# WHY THIS EXISTS
# scripts/restore-db.sh has always known how to pull the newest data-* release
# — but nothing ever created those releases except a human remembering to. So
# the restore path was real and the thing it restores from was stale: if the
# VPS vanished, the recovery point was whenever someone last published by hand.
# This script is the missing half, run weekly by deploy/karnaf-backup.timer.
#
# WHAT IT PUBLISHES (release tag data-YYYYMMDD)
#   realestate.db.gz  the deal archive — the asset restore-db.sh looks for
#   app.db.gz         users, saved deals, feedback, rules — the un-recollectable data
#
# Snapshots are taken with sqlite3's online .backup (safe against concurrent
# writers under WAL), integrity-checked, and sanity-checked for row counts
# before anything is uploaded. Old data-* releases beyond KARNAF_BACKUP_KEEP
# are pruned so the repo doesn't accumulate gigabytes forever.
#
# AUTH: needs the gh CLI signed in, or GH_TOKEN in the environment
# (the systemd unit reads /etc/karnaf/backup.env for exactly that).
#
# Usage: bash scripts/publish-backup.sh
set -euo pipefail

REPO="${KARNAF_REPO:-almog-hoc-org/karnaf-analist}"
DATA_DIR="${KARNAF_DATA_DIR:-/var/lib/karnaf/data}"
KEEP="${KARNAF_BACKUP_KEEP:-8}"
TAG="data-$(date +%Y%m%d)"

command -v gh >/dev/null      || { echo "✗ gh CLI not installed (apt install gh)"; exit 1; }
command -v sqlite3 >/dev/null || { echo "✗ sqlite3 not installed"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "✗ gh not authenticated — set GH_TOKEN or run: gh auth login"; exit 1; }
[ -f "$DATA_DIR/realestate.db" ] || { echo "✗ $DATA_DIR/realestate.db not found"; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

snapshot() { # name — online .backup + integrity check (gzip happens after any row-count checks)
  local name="$1"
  echo "▸ snapshotting $name…"
  sqlite3 "$DATA_DIR/$name" ".backup '$TMP/$name'"
  local integrity
  integrity=$(sqlite3 "$TMP/$name" "PRAGMA integrity_check;" | head -1)
  [ "$integrity" = "ok" ] || { echo "✗ $name integrity check failed: $integrity"; exit 1; }
}

snapshot realestate.db
# same floor restore-db.sh enforces — never publish an obviously truncated archive
DEALS=$(sqlite3 "$TMP/realestate.db" "SELECT COUNT(*) FROM nadlan_transactions;" 2>/dev/null || echo 0)
if [ "$DEALS" -le 100000 ]; then
  echo "✗ only $DEALS deals in the snapshot — refusing to publish it as a backup"
  exit 1
fi
gzip -f "$TMP/realestate.db"

ASSETS=("$TMP/realestate.db.gz")
if [ -f "$DATA_DIR/app.db" ]; then
  snapshot app.db
  gzip -f "$TMP/app.db"
  ASSETS+=("$TMP/app.db.gz")
else
  echo "▸ app.db not present — publishing the deal archive only"
fi

echo "▸ publishing $TAG to $REPO ($DEALS deals)…"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" "${ASSETS[@]}" --repo "$REPO" --clobber
else
  gh release create "$TAG" "${ASSETS[@]}" --repo "$REPO" \
    --title "Data backup $TAG" \
    --notes "Automated weekly backup — restore with: bash scripts/restore-db.sh $TAG"
fi

# ── prune: keep the newest $KEEP data-* releases ─────────────────────────────
STALE=$(gh release list --repo "$REPO" --limit 100 | awk '$1 ~ /^data-/ {print $1}' | sort -r | tail -n "+$((KEEP + 1))")
for old in $STALE; do
  echo "▸ pruning old backup $old"
  gh release delete "$old" --repo "$REPO" --yes --cleanup-tag || echo "  (prune of $old failed — not fatal)"
done

echo "✓ backup $TAG published"
