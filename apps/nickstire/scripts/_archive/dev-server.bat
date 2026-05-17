@echo off
REM ═══════════════════════════════════════════════════════════
REM Nickstire dev server launcher — used by Claude Preview MCP
REM
REM Uses wrapper that listens on 3500 IMMEDIATELY with a stub
REM server, then proxies to the real tsx watch server once it's
REM ready. This defeats Claude Preview's 30s health-check timeout
REM which was too short for nickstire's 50s full boot.
REM ═══════════════════════════════════════════════════════════

cd /d "C:\Users\nourd\MAINnicks-tire-autoNEW"

set NODE_ENV=development
if "%PORT%"=="" set PORT=3500

"C:\Program Files\nodejs\node.exe" scripts/dev-server-wrapper.mjs
