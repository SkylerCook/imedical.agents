@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1
"runtime\node.exe" "tools\agents-workbench\prototype\serve.js" --open %*
if errorlevel 1 (
  echo.
  echo Workbench could not start. Check the message above.
  pause
  exit /b 1
)
