@echo off
cd /d C:\Users\nourd\NOUR-OS\apps\statenour-os
git add app/api/body/route.ts app/api/capture/ app/api/commitments/route.ts app/api/decisions/route.ts app/api/drift/route.ts app/api/financial/route.ts app/api/habits/route.ts app/api/internal/runner/ app/api/knowledge/route.ts app/api/open-loops/route.ts app/api/personal-logs/ app/api/sync/business/route.ts app/api/sync/vision/route.ts scripts/run-push.bat scripts/verify-tables.bat
git commit -m "fix: commit outstanding route changes and migration scripts"
git push origin codex/ollama-local
echo DONE
