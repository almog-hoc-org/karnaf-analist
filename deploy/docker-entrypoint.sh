#!/usr/bin/env bash
#
# Seed the data volume with source files that ship in the image.
#
# WHY THIS EXISTS
# docker-compose mounts /var/lib/karnaf/data over /app/data. That is correct and
# deliberate — it is what keeps 1.35M transactions from being destroyed by a
# rebuild. But a bind mount REPLACES the directory: every data/*.json committed
# to the repo became invisible the moment the container started.
#
# The server was running with 5 of 28 files present. Four of the missing JSONs
# are read by the site itself, and the national-completions collector also needs
# a shipped PDF. Each reader catches its own error and falls back to empty or
# fails one collection step, so pages rendered while data quietly disappeared.
#
# NEVER OVERWRITES. Several of these files are live state, not shipped content:
# seen_reports.json and recent_reports.json are written by the collection run
# and are how it knows what it has already processed. Copying the image's
# version over them would make the collector re-download every publication it
# has ever seen. Only genuinely absent files are seeded.
set -euo pipefail

SEED_DIR=/app/data-seed
DATA_DIR=/app/data

if [ -d "$SEED_DIR" ]; then
  mkdir -p "$DATA_DIR"
  seeded=0
  while IFS= read -r -d '' src; do
    rel="${src#"$SEED_DIR"/}"
    dest="$DATA_DIR/$rel"
    if [ ! -e "$dest" ]; then
      mkdir -p "$(dirname "$dest")"
      cp "$src" "$dest"
      seeded=$((seeded + 1))
    fi
  done < <(find "$SEED_DIR" -type f -print0)
  if [ "$seeded" -gt 0 ]; then
    echo "seed: הועתקו $seeded קבצי מקור חסרים אל $DATA_DIR"
  fi
fi

exec "$@"
