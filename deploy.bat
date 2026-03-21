@echo off
cd /d C:\Users\nourd\nickstire
git add -A
git commit -m "%~1"
git push origin main
echo.
echo Done. Changes pushed to GitHub. Manus will pull automatically.
