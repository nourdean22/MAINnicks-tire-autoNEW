@echo off
setlocal
node "%~dp0ai-playground.mjs" opencode %* --
exit /b %errorlevel%
