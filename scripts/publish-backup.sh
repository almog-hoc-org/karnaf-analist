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
#   realestate.db.gz  the deal archive — public-source market data only
#   app.db.gz.age     users, sessions, saved deals, feedback, rules — ENCRYPTED
#
# app.db IS NEVER UPLOADED IN THE CLEAR. It holds names, emails, phones,
# password hashes and session keys, and until 28.9.2026 it was published as a
# plain app.db.gz to a repository that turned out to be public. It is now
# encrypted with `age` to the public key in KARNAF_BACKUP_AGE_RECIPIENT
# (age1…, in /etc/karnaf/backup.env). Only the matching private key — kept by
# the operator, OFF the server — can open it. No recipient, or no `age`
# binary → app.db is skipped and the deal archive is published alone. There is
# no fallback that uploads it unencrypted.
#
# --dry-run: snapshot, check and encrypt, print what would be uploaded, upload
# nothing and prune nothing.
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
AGE_RECIPIENT="${KARNAF_BACKUP_AGE_RECIPIENT:-}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

command -v sqlite3 >/dev/null || { echo "✗ sqlite3 not installed"; exit 1; }
if [ "$DRY" = 0 ]; then
  command -v gh >/dev/null || { echo "✗ gh CLI not installed (apt install gh)"; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "✗ gh not authenticated — set GH_TOKEN or run: gh auth login"; exit 1; }
  # Say it on every run: the assets inherit the repository's visibility.
  VIS=$(gh repo view "$REPO" --json visibility -q .visibility 2>/dev/null || echo unknown)
  echo "▸ $REPO visibility: $VIS"
fi
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
if [ ! -f "$DATA_DIR/app.db" ]; then
  echo "▸ app.db not present — publishing the deal archive only"
elif [ -z "$AGE_RECIPIENT" ]; then
  echo "⚠ KARNAF_BACKUP_AGE_RECIPIENT not set — app.db (user data) is NOT published."
  echo "  Generate a key pair on YOUR machine: age-keygen -o karnaf-backup.key"
  echo "  and put its public line (age1…) in /etc/karnaf/backup.env as KARNAF_BACKUP_AGE_RECIPIENT=…"
elif ! command -v age >/dev/null; then
  echo "⚠ age not installed (apt install age) — app.db (user data) is NOT published."
else
  snapshot app.db
  gzip -f "$TMP/app.db"
  age -r "$AGE_RECIPIENT" -o "$TMP/app.db.gz.age" "$TMP/app.db.gz"
  rm -f "$TMP/app.db.gz"
  ASSETS+=("$TMP/app.db.gz.age")
fi

if [ "$DRY" = 1 ]; then
  echo "▸ dry run — would publish $TAG with:"
  for a in "${ASSETS[@]}"; do echo "    $(basename "$a")  $(du -h "$a" | cut -f1)"; done
  exit 0
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
# By TAG, read as JSON. The old version parsed the tab-separated listing with
# awk '$1', but the first column is the release TITLE ("Data backup data-…"),
# so nothing ever matched and nothing was ever pruned.
STALE=$(gh release list --repo "$REPO" --limit 100 --json tagName -q '.[].tagName' \
  | grep '^data-' | sort -r | tail -n "+$((KEEP + 1))")
for old in $STALE; do
  echo "▸ pruning old backup $old"
  gh release delete "$old" --repo "$REPO" --yes --cleanup-tag || echo "  (prune of $old failed — not fatal)"
done

echo "✓ backup $TAG published"
