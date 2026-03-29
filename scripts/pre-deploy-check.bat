@echo off
echo === Pre-Deploy Check ===
echo.
echo 1. TypeScript...
call npx tsc --noEmit 2>&1
echo.
echo 2. Build...
call pnpm run build 2>&1
echo.
echo 3. Git status...
git status --short
echo.
echo === Done ===
