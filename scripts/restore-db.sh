#!/bin/bash
# Restore the deal archive from the latest GitHub Release.
#
# realestate.db is 312MB — past GitHub's 100MB file limit — so it ships as a
# gzipped Release asset (~59MB) instead of living in the repo. This pulls the
# newest one back and verifies it before putting it in place.
#
# Usage: bash scripts/restore-db.sh [release-tag]
set -euo pipefail

REPO="${KARNAF_REPO:-almoghoc/karnaf-analist}"
DEST="data/realestate.db"
TAG="${1:-}"

command -v gh >/dev/null || { echo "✗ gh CLI not installed — brew install gh && gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "✗ not signed in — run: gh auth login"; exit 1; }

[ -d data ] || mkdir -p data

# newest data-* release unless a tag was given
if [ -z "$TAG" ]; then
  TAG=$(gh release list --repo "$REPO" --limit 30 2>/dev/null | awk '$1 ~ /^data-/ {print $1; exit}')
  [ -n "$TAG" ] || { echo "✗ no data-* release found in $REPO"; exit 1; }
fi
echo "▸ restoring $TAG from $REPO"

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

if [ -f "$DEST" ]; then
  BACKUP="$DEST.replaced-$(date +%Y%m%d-%H%M%S)"
  mv "$DEST" "$BACKUP"
  echo "▸ previous database kept at $BACKUP"
fi
mv "$TMP/realestate.db" "$DEST"
# stale -wal/-shm from the old file would be read against the new one
rm -f "$DEST-wal" "$DEST-shm"

echo "✓ restored $(printf "%'d" "$DEALS" 2>/dev/null || echo "$DEALS") deals → $DEST"
