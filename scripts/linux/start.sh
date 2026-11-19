#!/usr/bin/env bash
# Start the Codex daemon. Safe to run repeatedly (refuses if already up).
# Usage: bash scripts/linux/start.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIDFILE="$ROOT/_work/codexd.pid"
LOGDIR="$ROOT/_work/logs"
PORT="${CODEX_PORT:-8765}"
HOST="${CODEX_HOST:-127.0.0.1}"
mkdir -p "$LOGDIR"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "codexd already running (pid $(cat "$PIDFILE"))"
  exit 0
fi
# Stale pidfile from a machine that rebooted under it.
rm -f "$PIDFILE"

# Interpreter resolution: explicit override, then a local venv, then this
# machine's known dev venv, then whatever python3 is on PATH.
PY=""
if [ -n "${CODEX_PYTHON:-}" ] && [ -x "$CODEX_PYTHON" ]; then
  PY="$CODEX_PYTHON"
elif [ -x "$ROOT/.venv/bin/python" ]; then
  PY="$ROOT/.venv/bin/python"
elif [ -x "$HOME/.venvs/codex/bin/python" ]; then
  PY="$HOME/.venvs/codex/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PY="python3"
else
  echo "no Python found: create $ROOT/.venv (see README) or set CODEX_PYTHON" >&2
  exit 1
fi

# Shelf policy lives in <root>/data/shelf.json and is applied by codexd only
# when it discovers the roll set itself, so the default pass no --codex.
# CODEX_CODEXES overrides discovery with a space-separated list of paths/globs.
CODEX_ARGS=()
if [ -n "${CODEX_CODEXES:-}" ]; then
  for pat in $CODEX_CODEXES; do CODEX_ARGS+=(--codex "$pat"); done
fi

nohup "$PY" -u "$ROOT/app/codexd.py" \
  ${CODEX_ARGS[@]+"${CODEX_ARGS[@]}"} \
  --art "$ROOT/data/art.db" \
  --port "$PORT" --host "$HOST" \
  >> "$LOGDIR/codexd.out.log" 2>> "$LOGDIR/codexd.err.log" &
echo $! > "$PIDFILE"

echo "codexd starting (pid $(cat "$PIDFILE")) - waiting for http://$HOST:$PORT/api/health"
for _ in $(seq 1 180); do
  if curl -sf "http://$HOST:$PORT/api/health" >/dev/null 2>&1; then
    echo "codexd up: http://$HOST:$PORT/"
    if [ "${CODEX_NO_BROWSER:-0}" != "1" ] && command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://$HOST:$PORT/" >/dev/null 2>&1 || true
    fi
    exit 0
  fi
  sleep 1
done

echo "codexd did not come up in 180 s - see $LOGDIR/codexd.err.log" >&2
exit 1
