@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -File "%~dp0configure-vscode.ps1" -Action Apply -Interactive
set "settings_result=%errorlevel%"
echo.
if not "%settings_result%"=="0" echo User settings were not applied. Read the error and README.md.
pause
exit /b %settings_result%
