@echo off
cd /d C:\Users\nourd\NOUR-OS\apps\statenour-os
set "DATABASE_URL=postgresql://neondb_owner:npg_PcSDw9NXCuE2@ep-quiet-wave-am320eo1-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
set "DIRECT_URL=postgresql://neondb_owner:npg_PcSDw9NXCuE2@ep-quiet-wave-am320eo1.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
echo DATABASE_URL set
echo Running prisma db push...
call npx prisma db push
echo Exit code: %ERRORLEVEL%
if %ERRORLEVEL% EQU 0 (
    echo Running prisma generate...
    call npx prisma generate
    echo Done!
) else (
    echo Push failed!
)
