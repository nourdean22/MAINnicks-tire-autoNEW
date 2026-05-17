@echo off
title NOUR OS - Dashboard
color 0A

echo.
echo   ╔══════════════════════════════════════════════╗
echo   ║                                              ║
echo   ║        N O U R   O S   v0.1                  ║
echo   ║        Personal Mastery System               ║
echo   ║                                              ║
echo   ╚══════════════════════════════════════════════╝
echo.
echo   [1] Dashboard   (npm run dev)
echo   [2] Status      (CLI quick check)
echo   [3] Streaks     (habit streaks)
echo   [4] Drift       (drift alerts)
echo   [5] Search      (search your brain)
echo   [6] Score       (log today's score)
echo   [7] Exit
echo.

set /p choice="   Pick a number: "

if "%choice%"=="1" goto dashboard
if "%choice%"=="2" goto status
if "%choice%"=="3" goto streaks
if "%choice%"=="4" goto drift
if "%choice%"=="5" goto search
if "%choice%"=="6" goto score
if "%choice%"=="7" exit

:dashboard
echo.
echo   Starting dashboard at http://localhost:3001 ...
echo   Press Ctrl+C to stop.
echo.
cd /d "%~dp0"
start chrome http://localhost:3001/habits
npm run dev
goto end

:status
cd /d "%~dp0"
npx tsx cli/nour.ts status
echo.
pause
goto end

:streaks
cd /d "%~dp0"
npx tsx cli/nour.ts streaks
echo.
pause
goto end

:drift
cd /d "%~dp0"
npx tsx cli/nour.ts drift
echo.
pause
goto end

:search
echo.
set /p query="   Search for: "
cd /d "%~dp0"
npx tsx cli/nour.ts search "%query%"
echo.
pause
goto end

:score
cd /d "%~dp0"
npx tsx cli/nour.ts score
echo.
pause
goto end

:end
