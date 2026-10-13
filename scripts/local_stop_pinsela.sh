#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_ROOT="${PINSELA_LOCAL_RUNTIME_DIR:-$ROOT/.local-runtime}"
STATE_DIR="$RUNTIME_ROOT/runtime"
BACKEND_PORT="${PINSELA_LOCAL_BACKEND_PORT:-8000}"
FRONTEND_PORT="${PINSELA_LOCAL_FRONTEND_PORT:-5173}"
BACKEND_PID_FILE="$STATE_DIR/backend.pid"
FRONTEND_PID_FILE="$STATE_DIR/frontend.pid"
BACKEND_PORT_FILE="$STATE_DIR/backend.port"
FRONTEND_PORT_FILE="$STATE_DIR/frontend.port"

# Uses the ports recorded by start, if they exist.
[[ -f "$STATE_DIR/backend.port" ]] && BACKEND_PORT="$(tr -dc '0-9' < "$STATE_DIR/backend.port")"
[[ -f "$STATE_DIR/frontend.port" ]] && FRONTEND_PORT="$(tr -dc '0-9' < "$STATE_DIR/frontend.port")"

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
  fi
}

stop_pid_file "$BACKEND_PID_FILE" "backend"
stop_pid_file "$FRONTEND_PID_FILE" "frontend"
stop_listener_on_port "$BACKEND_PORT" "backend" "$ROOT/apps/api" "pinsela.main:app"
stop_listener_on_port "$FRONTEND_PORT" "frontend" "$ROOT/ui" "$ROOT/ui/node_modules/vite"

rm -f "$BACKEND_PORT_FILE" "$FRONTEND_PORT_FILE"

echo "Pinsela local services were stopped."
