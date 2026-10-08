#!/usr/bin/env bash
# Stop the Codex daemon on macOS. Safe to run when nothing is running.
# Usage: bash scripts/macos/stop.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDFILE="$ROOT/_work/codexd.pid"

if [ -f "$PIDFILE" ] && [ -n "$(cat "$PIDFILE" 2>/dev/null)" ]; then
  PID="$(cat "$PIDFILE")"
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    for _ in $(seq 1 30); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "still alive after 30 s - sending SIGKILL"
      kill -9 "$PID" 2>/dev/null
    fi
    echo "codexd stopped"
  else
    echo "no codexd running (stale pidfile, removed)"
  fi
  rm -f "$PIDFILE"
else
  if pkill -f "app/codexd.py" 2>/dev/null; then
    echo "codexd stopped (by command line)"
  else
    echo "no codexd running"
  fi
fi
