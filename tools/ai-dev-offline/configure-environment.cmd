@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -File "%~dp0configure-environment.ps1" -Action Apply -Interactive
set "configure_result=%errorlevel%"
echo.
if not "%configure_result%"=="0" echo Configuration failed. Read README.md. Machine PATH writes require administrator rights.
pause
exit /b %configure_result%
