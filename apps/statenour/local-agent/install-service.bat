@echo off
REM Install Statenour Agent as a Windows Scheduled Task
REM Runs at user login, restarts on failure

echo Installing Statenour Smart Home Agent...

REM Delete existing task if any
schtasks /Delete /TN "StatenourAgent" /F 2>nul

REM Create task that runs at logon and restarts on failure
schtasks /Create /TN "StatenourAgent" /TR "C:\Users\nourd\NOUR-OS\apps\statenour-os\local-agent\run-agent.bat" /SC ONLOGON /RL HIGHEST /F

echo.
echo Task created. To start it now:
echo   schtasks /Run /TN "StatenourAgent"
echo.
echo To check status:
echo   schtasks /Query /TN "StatenourAgent"
echo.
echo To stop:
echo   schtasks /End /TN "StatenourAgent"
echo.
echo To remove:
echo   schtasks /Delete /TN "StatenourAgent" /F
