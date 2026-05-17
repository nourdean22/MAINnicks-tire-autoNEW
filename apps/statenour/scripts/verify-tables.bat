@echo off
cd /d C:\Users\nourd\NOUR-OS\apps\statenour-os
set "DATABASE_URL=postgresql://neondb_owner:npg_PcSDw9NXCuE2@ep-quiet-wave-am320eo1-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
set "DIRECT_URL=postgresql://neondb_owner:npg_PcSDw9NXCuE2@ep-quiet-wave-am320eo1.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
node -e "const { PrismaClient } = require('@prisma/client'); const p = new PrismaClient(); (async () => { try { const tables = ['sessionReport','systemMetric','notificationQueue','integration','integrationSyncLog','apiRequestLog','scheduledAction','userPreference','brainMemory','automationRule','cameraRecording','errorLog']; for (const t of tables) { try { const c = await p[t].count(); console.log('OK: ' + t + ' (' + c + ' rows)'); } catch(e) { console.log('FAIL: ' + t + ' - ' + e.message.split('\n')[0]); } } } finally { await p.$disconnect(); } })();"
