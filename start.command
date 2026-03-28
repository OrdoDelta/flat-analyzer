#!/bin/zsh

set -u

SCRIPT_DIR="${0:A:h}"
APP_URL="http://127.0.0.1:8000"

cd "$SCRIPT_DIR" || {
  echo "Could not open project directory: $SCRIPT_DIR"
  read -r "?Press Enter to close..."
  exit 1
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 was not found."
  echo "Please install Python 3 and try again."
  read -r "?Press Enter to close..."
  exit 1
fi

python3 - <<'PY'
import socket
sock = socket.socket()
sock.settimeout(0.25)
try:
    sock.connect(("127.0.0.1", 8000))
except OSError:
    raise SystemExit(0)
else:
    raise SystemExit(1)
finally:
    sock.close()
PY
port_free=$?

if [ "$port_free" -ne 0 ]; then
  echo "Port 8000 is already in use."
  echo "If Flat Analyzer is already running, the app will open in your browser."
  open "$APP_URL"
  echo
  echo "Close the other server first if you want to relaunch it from this window."
  read -r "?Press Enter to close..."
  exit 0
fi

echo "Starting Flat Analyzer..."
echo "Project directory: $SCRIPT_DIR"
echo

python3 -u server.py &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1
    wait "$SERVER_PID" 2>/dev/null
  fi
}

trap cleanup EXIT INT TERM

for _ in {1..30}; do
  python3 - <<'PY'
import socket
sock = socket.socket()
sock.settimeout(0.25)
try:
    sock.connect(("127.0.0.1", 8000))
except OSError:
    raise SystemExit(1)
else:
    raise SystemExit(0)
finally:
    sock.close()
PY
  if [ $? -eq 0 ]; then
    break
  fi
  sleep 0.25
done

if ! kill -0 "$SERVER_PID" >/dev/null 2>&1; then
  echo
  echo "Flat Analyzer stopped before it finished starting."
  read -r "?Press Enter to close..."
  exit 1
fi

echo "Opening $APP_URL"
open "$APP_URL"
echo "Flat Analyzer is running. Keep this window open to keep the server alive."
echo "Press Ctrl+C in this window to stop it."
echo

wait "$SERVER_PID"
