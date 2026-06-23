#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.." && npx next dev --port ${PORT:-3001}
