@echo off
cd /d C:\Users\nourd\NOUR-OS\apps\statenour-os
if not defined DATABASE_URL (echo Set DATABASE_URL in this shell first. Never commit it. & exit /b 1)
if not defined DIRECT_URL (echo Set DIRECT_URL in this shell first. Never commit it. & exit /b 1)
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
