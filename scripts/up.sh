#!/usr/bin/env bash
# One-command dev: starts web (Next.js), writer (mathwriter sidecar), and
# teacher (FastAPI + deepagents) concurrently. Ctrl+C kills all three.
#
# Each process starts independently — a missing Python venv just skips that
# service with a warning (the chat UI works without teach mode / handwriting).
# The web app degrades gracefully: teach mode falls back to text, and
# handwriting falls back to plain text when the writer is down.
set -euo pipefail
cd "$(dirname "$0")/.."

PIDS=()
cleanup() {
  echo ""
  echo "Shutting down…"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "Stopped."
}
trap cleanup EXIT INT TERM

# --- web (Next.js, port 3000) — always starts ---
echo "▶  web      http://localhost:3000"
(npm run dev) &
PIDS+=($!)

# --- writer (mathwriter sidecar, port 8931) — starts if venv exists ---
if [ -x "mathwriter/.venv/bin/python" ]; then
  echo "▶  writer   http://localhost:8931"
  (npm run writer) &
  PIDS+=($!)
else
  echo "⚠  writer   skipped (no mathwriter/.venv — run: npm run writer:install)"
fi

# --- teacher (FastAPI + deepagents, port 8900) — starts if venv exists ---
if [ -x "teacher/.venv/bin/uvicorn" ]; then
  echo "▶  teacher  http://localhost:8900"
  (npm run teacher) &
  PIDS+=($!)
else
  echo "⚠  teacher  skipped (no teacher/.venv — run: npm run teacher:install)"
fi

echo ""
echo "AI Teacher is up. Open http://localhost:3000"
echo "Press Ctrl+C to stop all services."
echo ""
wait