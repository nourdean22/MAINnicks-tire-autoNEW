@echo off
REM Statenour Agent - runs continuously, restarts on crash
:loop
echo [%date% %time%] Starting statenour-agent...
"C:\Users\nourd\AppData\Local\Programs\Python\Python311\python.exe" "C:\Users\nourd\NOUR-OS\apps\statenour-os\local-agent\agent.py"
echo [%date% %time%] Agent exited. Restarting in 10 seconds...
timeout /t 10 /nobreak >nul
goto loop
