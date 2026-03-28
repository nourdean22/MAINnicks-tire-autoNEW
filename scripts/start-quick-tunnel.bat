@echo off
REM ============================================================================
REM start-quick-tunnel.bat
REM
REM Starts a Cloudflare quick tunnel (*.trycloudflare.com) pointing to
REM localhost:3000. Captures the assigned URL to:
REM   %USERPROFILE%\.cloudflared\tunnel-url.txt
REM
REM Works immediately without any DNS configuration.
REM URL changes on every restart.
REM ============================================================================

setlocal EnableDelayedExpansion

set "CLOUDFLARED=C:\Program Files (x86)\cloudflared\cloudflared.exe"
set "URL_FILE=%USERPROFILE%\.cloudflared\tunnel-url.txt"
set "LOG_FILE=%USERPROFILE%\.cloudflared\quick-tunnel.log"

if not exist "%CLOUDFLARED%" (
    echo [ERROR] cloudflared not found at %CLOUDFLARED%
    echo Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    exit /b 1
)

echo [INFO] Starting quick tunnel to http://localhost:3000...
echo [INFO] Capturing URL to %URL_FILE%
echo [INFO] Logs: %LOG_FILE%
echo.

REM Clear previous URL file
echo mode=quick> "%URL_FILE%"
echo url=pending>> "%URL_FILE%"
echo started=%DATE% %TIME%>> "%URL_FILE%"

REM Start cloudflared in the background, redirect stderr (where URL appears) to log
start "" /b "%CLOUDFLARED%" tunnel --url http://localhost:3000 2>"%LOG_FILE%"

REM Poll the log file for the tunnel URL (appears within ~5 seconds)
set "ATTEMPTS=0"
:waitloop
if !ATTEMPTS! GEQ 30 (
    echo [ERROR] Timed out waiting for tunnel URL after 30 seconds.
    echo [ERROR] Check %LOG_FILE% for details.
    exit /b 1
)

set /a ATTEMPTS+=1
timeout /t 1 /nobreak >nul

REM Search log for the trycloudflare.com URL
for /f "tokens=*" %%A in ('findstr /r "https://.*\.trycloudflare\.com" "%LOG_FILE%" 2^>nul') do (
    set "LINE=%%A"
)

if not defined LINE goto waitloop

REM Extract the URL from the log line
for /f "tokens=*" %%U in ('powershell -NoProfile -Command "if ('%LINE%' -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $matches[0] }"') do (
    set "TUNNEL_URL=%%U"
)

if not defined TUNNEL_URL goto waitloop

REM Write the captured URL
echo mode=quick> "%URL_FILE%"
echo url=!TUNNEL_URL!>> "%URL_FILE%"
echo started=%DATE% %TIME%>> "%URL_FILE%"

echo.
echo ============================================================
echo   TUNNEL ACTIVE
echo   URL: !TUNNEL_URL!
echo   Saved to: %URL_FILE%
echo ============================================================
echo.
echo Press Ctrl+C to stop the tunnel.

REM Keep the script alive; the background cloudflared process is running
REM Wait indefinitely (cloudflared runs until killed)
:keepalive
timeout /t 3600 /nobreak >nul
goto keepalive
