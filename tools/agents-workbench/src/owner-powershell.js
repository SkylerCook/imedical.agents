'use strict';

const { spawnSync } = require('node:child_process');

// Keep native UTF-8 JSON intact when a verified owner invokes Node under Windows PowerShell.
const command = Buffer.from(`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$invocation = ConvertFrom-Json -InputObject $env:IMEDICAL_WORKBENCH_OWNER
Remove-Item Env:IMEDICAL_WORKBENCH_OWNER
$parameters = @{}
foreach ($field in $invocation.parameters.PSObject.Properties) { $parameters[$field.Name] = $field.Value }
& $invocation.entry @parameters
if (-not $?) { exit 1 }
`, 'utf16le').toString('base64');

function runOwnerPowerShell(executable,entry,parameters,{cwd,env,timeout}) {
  return spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',command],{
    cwd,env:{...env,IMEDICAL_WORKBENCH_OWNER:JSON.stringify({entry,parameters})},windowsHide:true,
    encoding:'utf8',timeout,maxBuffer:8*1024*1024,
  });
}

module.exports = { runOwnerPowerShell };
