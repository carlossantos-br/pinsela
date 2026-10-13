#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="${PINSELA_LOCAL_RUNTIME_DIR:-$ROOT/.local-runtime}"
STATE_DIR="$RUNTIME_ROOT/runtime"
API_DIR="$ROOT/apps/api"
UI_DIR="$ROOT/ui"
BACKEND_PORT="${PINSELA_LOCAL_BACKEND_PORT:-8000}"
FRONTEND_PORT="${PINSELA_LOCAL_FRONTEND_PORT:-5173}"
BACKEND_PID_FILE="$STATE_DIR/backend.pid"
FRONTEND_PID_FILE="$STATE_DIR/frontend.pid"
BACKEND_PORT_FILE="$STATE_DIR/backend.port"
FRONTEND_PORT_FILE="$STATE_DIR/frontend.port"
BACKEND_LOG="$STATE_DIR/backend.log"
FRONTEND_LOG="$STATE_DIR/frontend.log"
TARGET_URL="http://127.0.0.1:${FRONTEND_PORT}/projects"
BACKEND_HEALTH_URL="http://127.0.0.1:${BACKEND_PORT}/health"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

# Data in apps/api/data (or PINSELA_SERVER_DATA_ROOT); PIDs and logs in .local-runtime/ (both outside git).
mkdir -p "$STATE_DIR"

die() {
  echo "Error: $*" >&2
  exit 1
}

pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

pid_command() {
  local pid="${1:-}"
  ps -p "$pid" -o command= 2>/dev/null || true
}

kill_pid() {
  local pid="$1"
  local label="$2"
  local _attempt

  if ! pid_alive "$pid"; then
    return 0
  fi

  echo "Stopping ${label} (PID ${pid})..."
  kill "$pid" 2>/dev/null || true

  for _attempt in {1..30}; do
    if ! pid_alive "$pid"; then
      return 0
    fi
    sleep 0.2
  done

  kill -9 "$pid" 2>/dev/null || true
}

stop_pid_file() {
  local file="$1"
  local label="$2"
  local pid=""

  if [[ ! -f "$file" ]]; then
    return 0
  fi

  pid="$(tr -dc '0-9' < "$file")"
  if [[ -n "$pid" ]]; then
    kill_pid "$pid" "$label"
  fi
  rm -f "$file"
}

stop_listener_on_port() {
  local port="$1"
  local label="$2"
  local pattern_a="$3"
  local pattern_b="$4"
  local pid=""
  local cmd=""

  pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
  if [[ -z "$pid" ]]; then
    return 0
  fi

  cmd="$(pid_command "$pid")"
  if [[ "$cmd" == *"$pattern_a"* ]] || [[ "$cmd" == *"$pattern_b"* ]]; then
    kill_pid "$pid" "$label"
    return 0
  fi

  die "Port ${port} is in use by another process: ${cmd}"
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local log_file="$3"
  local _attempt

  for _attempt in {1..80}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done

  echo "Failed to start ${label}. Last log lines:" >&2
  tail -n 40 "$log_file" >&2 || true
  return 1
}

export_env_file_literal() {
  local env_file="$1"
  local line=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || continue
    export "$line"
  done <"$env_file"
}

# Fresh clone: creates the API venv and installs dependencies if they do not exist yet.
if [[ ! -x "$API_DIR/.venv/bin/python" ]]; then
  PY_BIN="${PINSELA_PYTHON:-$(command -v python3 || true)}"
  [[ -x "$PY_BIN" ]] || die "Python 3 not found (set PINSELA_PYTHON)."
  echo "Creating the API venv at $API_DIR/.venv..."
  "$PY_BIN" -m venv "$API_DIR/.venv"
  "$API_DIR/.venv/bin/python" -m pip install --quiet --upgrade pip
  "$API_DIR/.venv/bin/python" -m pip install --quiet -r "$API_DIR/requirements.txt"
fi

if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
[[ -x "$NODE_BIN" ]] || die "Node not found."
if [[ ! -f "$UI_DIR/node_modules/vite/bin/vite.js" ]]; then
  command -v npm >/dev/null 2>&1 || die "npm not found."
  echo "Installing UI dependencies..."
  (cd "$UI_DIR" && npm ci --no-audit --no-fund)
fi

stop_pid_file "$BACKEND_PID_FILE" "old backend"
stop_pid_file "$FRONTEND_PID_FILE" "old frontend"
stop_listener_on_port "$BACKEND_PORT" "old backend" "$ROOT/apps/api" "pinsela.main:app"
stop_listener_on_port "$FRONTEND_PORT" "old frontend" "$ROOT/ui" "$ROOT/ui/node_modules/vite"

: >"$BACKEND_LOG"
: >"$FRONTEND_LOG"

export PINSELA_LOCAL_ROOT="$ROOT"
export PINSELA_LOCAL_RUNTIME_DIR="$RUNTIME_ROOT"
export PINSELA_LOCAL_BACKEND_PORT="$BACKEND_PORT"
export PINSELA_LOCAL_FRONTEND_PORT="$FRONTEND_PORT"
export PINSELA_LOCAL_NODE_BIN="$NODE_BIN"

echo "Starting backend at 127.0.0.1:${BACKEND_PORT}..."
nohup /bin/bash -lc '
  set -euo pipefail
  cd "$PINSELA_LOCAL_ROOT/apps/api"
  export PYTHONUNBUFFERED=1
  export_env_file_literal() {
    local env_file="$1"
    local line=""

    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ -z "$line" ]] && continue
      [[ "$line" == \#* ]] && continue
      [[ "$line" == *=* ]] || continue
      export "$line"
    done <"$env_file"
  }
  # .env.v2 is optional: without it the backend starts in dev mode with local defaults.
  if [[ -f "$PINSELA_LOCAL_ROOT/apps/api/.env.v2" ]]; then
    export_env_file_literal "$PINSELA_LOCAL_ROOT/apps/api/.env.v2"
  fi
  ./.venv/bin/python -m alembic upgrade head
  exec ./.venv/bin/python -m uvicorn pinsela.main:app --host 127.0.0.1 --port "$PINSELA_LOCAL_BACKEND_PORT"
' >>"$BACKEND_LOG" 2>&1 &
echo "$!" >"$BACKEND_PID_FILE"
echo "$BACKEND_PORT" >"$BACKEND_PORT_FILE"
wait_for_url "$BACKEND_HEALTH_URL" "backend" "$BACKEND_LOG"

echo "Starting frontend at 127.0.0.1:${FRONTEND_PORT}..."
nohup /bin/bash -lc '
  set -euo pipefail
  cd "$PINSELA_LOCAL_ROOT/ui"
  export BROWSER=none
  # Proxy mode: the browser only uses the Vite origin; /api is forwarded to the backend.
  export VITE_PROXY_API_TARGET="http://127.0.0.1:${PINSELA_LOCAL_BACKEND_PORT}"
  export VITE_API_BASE=""
  export PORT="$PINSELA_LOCAL_FRONTEND_PORT"
  exec "$PINSELA_LOCAL_NODE_BIN" ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port "$PINSELA_LOCAL_FRONTEND_PORT" --strictPort
' >>"$FRONTEND_LOG" 2>&1 &
echo "$!" >"$FRONTEND_PID_FILE"
echo "$FRONTEND_PORT" >"$FRONTEND_PORT_FILE"
wait_for_url "$TARGET_URL" "frontend" "$FRONTEND_LOG"

if [[ "${PINSELA_LOCAL_NO_OPEN:-0}" != "1" ]]; then
  if command -v open >/dev/null 2>&1; then open "$TARGET_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$TARGET_URL" >/dev/null 2>&1 || true
  fi
fi

echo
echo "Pinsela local no ar."
echo "Data dir: ${PINSELA_SERVER_DATA_ROOT:-$API_DIR/data}"
echo "Runtime (PIDs+logs):  $RUNTIME_ROOT"
echo "Projects: $TARGET_URL"
echo "Backend health: $BACKEND_HEALTH_URL"
echo "Log backend: $BACKEND_LOG"
echo "Log frontend: $FRONTEND_LOG"
