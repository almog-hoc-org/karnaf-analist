#!/bin/bash
# Restore both databases from a GitHub Release published by publish-backup.sh.
#
# realestate.db is 312MB — past GitHub's 100MB file limit — so it ships as a
# gzipped Release asset instead of living in the repo. This pulls it back and
# verifies it before putting it in place.
#
# app.db (users, sessions, saved deals, feedback, rules) ships ENCRYPTED since
# 28.9.2026 as app.db.gz.age. Opening it needs the operator's private key:
#   KARNAF_BACKUP_AGE_IDENTITY=/path/to/karnaf-backup.key
# Releases from before that date carry a plain app.db.gz, which is still read.
#
# WHERE IT WRITES: $KARNAF_DATA_DIR (default ./data — a laptop checkout). On
# the server, run it as
#   KARNAF_DATA_DIR=/var/lib/karnaf/data bash scripts/restore-db.sh [tag]
# If the app container is running it is stopped first (SQLite files must not be
# swapped under a live process) and started again at the end.
#
# Usage: bash scripts/restore-db.sh [release-tag]
set -euo pipefail

# default matches where publish-backup.sh publishes (the org repo — the old
# personal-account default predated the org migration and pointed at nothing)
REPO="${KARNAF_REPO:-almog-hoc-org/karnaf-analist}"
DATA_DIR="${KARNAF_DATA_DIR:-data}"
DEST="$DATA_DIR/realestate.db"
APP_DEST="$DATA_DIR/app.db"
IDENTITY="${KARNAF_BACKUP_AGE_IDENTITY:-}"
CONTAINER="karnaf-analist"
TAG="${1:-}"

command -v gh >/dev/null || { echo "✗ gh CLI not installed — brew install gh && gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "✗ not signed in — run: gh auth login"; exit 1; }

mkdir -p "$DATA_DIR"

# newest data-* release unless a tag was given. By TAG, read as JSON: the plain
# listing's first column is the release TITLE, which the old awk read, so the
# no-argument form never found anything.
if [ -z "$TAG" ]; then
  TAG=$(gh release list --repo "$REPO" --limit 30 --json tagName,createdAt \
        -q 'sort_by(.createdAt) | reverse | .[].tagName' 2>/dev/null | grep '^data-' | head -1 || true)
  [ -n "$TAG" ] || { echo "✗ no data-* release found in $REPO"; exit 1; }
fi
echo "▸ restoring $TAG from $REPO into $DATA_DIR"

# Never clobber an existing archive before the new one is known good.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
gh release download "$TAG" --repo "$REPO" --pattern "realestate.db.gz" --dir "$TMP"

echo "▸ decompressing…"
gunzip -c "$TMP/realestate.db.gz" > "$TMP/realestate.db"

# A truncated download decompresses fine but yields a corrupt database, so ask
# SQLite itself whether the file is sound before trusting it.
echo "▸ verifying…"
INTEGRITY=$(sqlite3 "$TMP/realestate.db" "PRAGMA integrity_check;" 2>&1 | head -1)
[ "$INTEGRITY" = "ok" ] || { echo "✗ integrity check failed: $INTEGRITY"; exit 1; }
DEALS=$(sqlite3 "$TMP/realestate.db" "SELECT COUNT(*) FROM nadlan_transactions;")
[ "$DEALS" -gt 100000 ] || { echo "✗ only $DEALS deals — archive looks incomplete"; exit 1; }

# ── app.db: fetch and verify BEFORE anything is swapped ──────────────────────
APP_READY=0
if gh release download "$TAG" --repo "$REPO" --pattern "app.db.gz.age" --dir "$TMP" 2>/dev/null; then
  if [ -z "$IDENTITY" ] || ! command -v age >/dev/null; then
    echo "⚠ $TAG carries an encrypted app.db — set KARNAF_BACKUP_AGE_IDENTITY to the private key"
    echo "  (and install age) to restore user data. Restoring the deal archive only."
  else
    age -d -i "$IDENTITY" -o "$TMP/app.db.gz" "$TMP/app.db.gz.age"
    APP_READY=1
  fi
elif gh release download "$TAG" --repo "$REPO" --pattern "app.db.gz" --dir "$TMP" 2>/dev/null; then
  APP_READY=1   # a release from before encryption
else
  echo "▸ no app.db in $TAG — user data not included in this release"
fi
if [ "$APP_READY" = 1 ]; then
  gunzip -c "$TMP/app.db.gz" > "$TMP/app.db"
  APP_INTEGRITY=$(sqlite3 "$TMP/app.db" "PRAGMA integrity_check;" 2>&1 | head -1)
  [ "$APP_INTEGRITY" = "ok" ] || { echo "✗ app.db integrity check failed: $APP_INTEGRITY"; exit 1; }
fi

# ── swap: stop the app, replace, start it again ──────────────────────────────
WAS_RUNNING=0
if command -v docker >/dev/null && [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]; then
  echo "▸ stopping $CONTAINER while the files are replaced"
  docker stop "$CONTAINER" >/dev/null
  WAS_RUNNING=1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
if [ -f "$DEST" ]; then
  mv "$DEST" "$DEST.replaced-$STAMP"
  echo "▸ previous database kept at $DEST.replaced-$STAMP"
fi
mv "$TMP/realestate.db" "$DEST"
# stale -wal/-shm from the old file would be read against the new one
rm -f "$DEST-wal" "$DEST-shm"
echo "✓ restored $(printf "%'d" "$DEALS" 2>/dev/null || echo "$DEALS") deals → $DEST"

if [ "$APP_READY" = 1 ]; then
  if [ -f "$APP_DEST" ]; then
    mv "$APP_DEST" "$APP_DEST.replaced-$STAMP"
    echo "▸ previous app.db kept at $APP_DEST.replaced-$STAMP"
  fi
  mv "$TMP/app.db" "$APP_DEST"
  rm -f "$APP_DEST-wal" "$APP_DEST-shm"
  echo "✓ restored app.db (users, saved deals, feedback, rules)"
fi

if [ "$WAS_RUNNING" = 1 ]; then
  docker start "$CONTAINER" >/dev/null && echo "▸ $CONTAINER started again"
fi
