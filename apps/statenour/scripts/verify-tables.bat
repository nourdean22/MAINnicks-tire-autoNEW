@echo off
cd /d C:\Users\nourd\NOUR-OS\apps\statenour-os
if not defined DATABASE_URL (echo Set DATABASE_URL in this shell first. Never commit it. & exit /b 1)
if not defined DIRECT_URL (echo Set DIRECT_URL in this shell first. Never commit it. & exit /b 1)
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); (async () => { try { const tables = ['sessionReport','systemMetric','notificationQueue','integration','integrationSyncLog','apiRequestLog','scheduledAction','userPreference','brainMemory','automationRule','cameraRecording','errorLog']; for (const t of tables) { try { const c = await p[t].count(); console.log('OK: ' + t + ' (' + c + ' rows)'); } catch(e) { console.log('FAIL: ' + t + ' - ' + e.message.split('\n')[0]); } } } finally { await p.$disconnect(); } })();"
