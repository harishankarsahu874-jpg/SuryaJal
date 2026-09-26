#!/usr/bin/env bash
# SuryaJal one-click start (Linux / macOS)
set -e
cd "$(dirname "$0")"
if [ ! -d .venv ]; then python3 -m venv .venv; fi
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
python scripts/download_models.py
PORT="${PORT:-8000}"
echo ""
echo "  SuryaJal is starting ->  http://localhost:${PORT}"
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "$IP" ] && echo "  Phones on the same Wi-Fi/hotspot ->  http://${IP}:${PORT}"
echo ""
python -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
