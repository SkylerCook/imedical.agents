@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1
if not "%~1"=="" goto launch
powershell.exe -NoProfile -STA -Command "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object Windows.Forms.FolderBrowserDialog; $d.Description='Select the project folder'; if($d.ShowDialog() -eq 'OK'){ & '.\runtime\node.exe' 'tools/agents-workbench/prototype/serve.js' --open --project $d.SelectedPath; exit $LASTEXITCODE }"
exit /b %errorlevel%
:launch
"runtime\node.exe" "tools\agents-workbench\prototype\serve.js" --open %*
if errorlevel 1 (
  echo.
  echo Workbench could not start. Check the message above.
  pause
  exit /b 1
)
