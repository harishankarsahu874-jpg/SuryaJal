@echo off
REM SuryaJal one-click start (Windows)
cd /d %~dp0
if not exist .venv (
  python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
pip install -q -r requirements.txt
python scripts\download_models.py
echo.
echo   SuryaJal is starting ->  http://localhost:8000
echo   Phones on the same Wi-Fi: run "ipconfig", then open http://YOUR-IPv4:8000
echo.
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
pause
