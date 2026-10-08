#!/usr/bin/env bash
# Is the daemon running, and is it healthy?
# Usage: bash scripts/linux/status.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDFILE="$ROOT/_work/codexd.pid"
PORT="${CODEX_PORT:-8765}"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  echo "codexd : running (pid $(cat "$PIDFILE"))"
else
  echo "codexd : not running"
fi

if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "health : ok - http://127.0.0.1:$PORT/"
  curl -s "http://127.0.0.1:$PORT/api/health" | head -c 600
  echo
else
  echo "health : no response on port $PORT"
fi
