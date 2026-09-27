@echo off
setlocal
set "SCRIPT=%~dp0install-eufy-shop-runtime.ps1"
if not exist "%SCRIPT%" (
  echo Missing installer: %SCRIPT%
  pause
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File ""%SCRIPT%"" -InstallPrerequisites'"
if errorlevel 1 (
  echo Failed to launch elevated installer.
  pause
  exit /b 3
)
endlocal