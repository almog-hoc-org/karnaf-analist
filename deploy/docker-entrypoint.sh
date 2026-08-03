#!/usr/bin/env bash
#
# Seed the data volume with the JSON files that ship in the image.
#
# WHY THIS EXISTS
# docker-compose mounts /var/lib/karnaf/data over /app/data. That is correct and
# deliberate — it is what keeps 1.35M transactions from being destroyed by a
# rebuild. But a bind mount REPLACES the directory: every data/*.json committed
# to the repo became invisible the moment the container started.
#
# The server was running with 5 of 28 files present. Four of the missing ones
# are read by the site itself — cbs_national_series.json, cbs_permits.json,
# cbs_press.json, scattered_city_facts.json — and every one of those readers
# catches its own error and falls back to empty. So pages rendered, with
# sections quietly showing nothing, and nothing anywhere said why.
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
  for src in "$SEED_DIR"/*.json; do
    [ -e "$src" ] || break          # empty glob — nothing shipped, nothing to do
    dest="$DATA_DIR/$(basename "$src")"
    if [ ! -e "$dest" ]; then
      cp "$src" "$dest"
      seeded=$((seeded + 1))
    fi
  done
  if [ "$seeded" -gt 0 ]; then
    echo "seed: הועתקו $seeded קבצי JSON חסרים אל $DATA_DIR"
  fi
fi

exec "$@"
