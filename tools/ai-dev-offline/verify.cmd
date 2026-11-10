@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -File "%~dp0verify-packages.ps1"
set "verify_result=%errorlevel%"
echo.
if not "%verify_result%"=="0" echo Verification failed. Read README.md before using the packages.
pause
exit /b %verify_result%
