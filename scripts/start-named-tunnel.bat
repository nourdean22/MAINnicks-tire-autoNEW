@echo off
REM ============================================================================
REM start-named-tunnel.bat
REM
REM Starts the named Cloudflare tunnel "nour-local" using the config at
REM %USERPROFILE%\.cloudflared\config.yml
REM
REM PREREQUISITE: nickstire.org nameservers must be migrated to Cloudflare.
REM Until then, dev.nickstire.org will not resolve. Use start-quick-tunnel.bat
REM for immediate access.
REM ============================================================================

setlocal EnableDelayedExpansion

set "CLOUDFLARED=C:\Program Files (x86)\cloudflared\cloudflared.exe"
set "URL_FILE=%USERPROFILE%\.cloudflared\tunnel-url.txt"

if not exist "%CLOUDFLARED%" (
    echo [ERROR] cloudflared not found at %CLOUDFLARED%
    echo Install from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    exit /b 1
)

echo [INFO] Starting named tunnel "nour-local"...
echo [INFO] Routes: dev.nickstire.org -^> http://localhost:3000
echo [INFO] NOTE: This requires nickstire.org DNS to be on Cloudflare.
echo.

REM Write tunnel info to URL file
echo mode=named> "%URL_FILE%"
echo url=https://dev.nickstire.org>> "%URL_FILE%"
echo started=%DATE% %TIME%>> "%URL_FILE%"

"%CLOUDFLARED%" tunnel run nour-local
