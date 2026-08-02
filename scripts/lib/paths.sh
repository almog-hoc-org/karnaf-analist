# shellcheck shell=bash
#
# Shared path resolution for the shell scripts.
#
# WHY THIS EXISTS
# The scripts were written for one macOS machine and encoded that assumption in
# three ways: an absolute PROJECT_DIR containing a specific user's home
# directory and an iCloud path, a log directory under ~/Library/Logs (macOS
# only), and a Chrome binary under /Applications. On a Linux VPS all three are
# wrong, and the failure is not loud — refresh_yadata_monthly.sh would simply
# `cd` to a path that does not exist and give up.
#
# Everything here resolves from the script's own location or from an environment
# variable, with the previous macOS values kept as the fallback so nothing
# changes on the machine these were written for.
#
# Usage, from any script in scripts/:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/paths.sh"

# Repo root, derived from this file's location. Works from a clone, a symlink
# farm, or the iCloud copy, and does not care who is running it.
KARNAF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export KARNAF_ROOT
PROJECT_DIR="$KARNAF_ROOT"
export PROJECT_DIR

# Logs: honour KARNAF_LOG_DIR, else the macOS location when it applies, else
# the XDG-ish Linux default. Never fails on a machine without ~/Library.
if [ -n "${KARNAF_LOG_DIR:-}" ]; then
  LOG_DIR="$KARNAF_LOG_DIR"
elif [ -d "$HOME/Library/Logs" ]; then
  LOG_DIR="$HOME/Library/Logs/Karnaf"
else
  LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/karnaf/logs"
fi
export LOG_DIR
mkdir -p "$LOG_DIR" 2>/dev/null || true

# Persistent data directory. On the VPS this points outside the deploy tree so a
# redeploy cannot wipe the databases; locally it stays ./data.
KARNAF_DATA_DIR="${KARNAF_DATA_DIR:-$KARNAF_ROOT/data}"
export KARNAF_DATA_DIR

# Chrome, for the collectors that drive a real browser. First match wins.
if [ -z "${CHROME_BIN:-}" ]; then
  for _candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$(command -v google-chrome-stable 2>/dev/null)" \
    "$(command -v google-chrome 2>/dev/null)" \
    "$(command -v chromium 2>/dev/null)" \
    "$(command -v chromium-browser 2>/dev/null)" \
    "/opt/pw-browsers/chromium"; do
    if [ -n "$_candidate" ] && [ -x "$_candidate" ]; then
      CHROME_BIN="$_candidate"
      break
    fi
  done
  unset _candidate
fi
export CHROME_BIN

# Base URL for links the scripts put into emails and logs. localhost:3000 is
# only correct on a developer machine; a notification that links there is
# useless to anyone reading it elsewhere.
KARNAF_SITE_URL="${KARNAF_SITE_URL:-http://localhost:3000}"
export KARNAF_SITE_URL
