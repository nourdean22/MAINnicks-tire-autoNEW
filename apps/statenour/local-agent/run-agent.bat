@echo off
REM Statenour OS Smart Home Agent - Background Runner
REM Runs continuously, auto-restarts on crash
REM NOTE: No log redirect here — agent.py manages its own log via RotatingFileHandler

cd /d C:\Users\nourd\NOUR-OS\apps\statenour-os\local-agent

:loop
echo [%date% %time%] Starting Statenour agent...
python agent.py
echo [%date% %time%] Agent exited (code %ERRORLEVEL%). Restarting in 10s...
timeout /t 10 /nobreak >nul
goto loop
