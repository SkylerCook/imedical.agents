#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$CodeExe,[string]$PwshExe,[string]$PackageDirectory)
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../tools/ai-dev-offline'))
if($PackageDirectory){$source=[IO.Path]::GetFullPath($PackageDirectory)}
$parent=Join-Path ([IO.Path]::GetTempPath()) 'Codex'
if(Test-Path -LiteralPath 'D:\tmp'){$parent='D:\tmp\Codex'}
$root=Join-Path $parent ('ai-dev-project-worker-'+[guid]::NewGuid().ToString('N'))
$realSettings=Join-Path $env:APPDATA 'Code/User/settings.json'
$beforeHash=if(Test-Path -LiteralPath $realSettings){(Get-FileHash -LiteralPath $realSettings).Hash}else{'absent'}
$checks=0
function Assert($Condition,[string]$Message){if(-not $Condition){throw $Message};$script:checks++}
try {
    [void][IO.Directory]::CreateDirectory((Join-Path $root 'project'))
    $requestFile=Join-Path $root 'request.json'
    $fakeMcp=Join-Path $root 'iris-agentic-dev.exe'
    Add-Type -AssemblyName System.Security
    $secret='fixture-only-password-中文'
    $protected=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($secret),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    $request=@{action='projectPlan';projectRoot=(Join-Path $root 'project');codeExe=$CodeExe;userDataMode='Installed';commonSettings=$true;configureMcp=$true;mcpExe=$fakeMcp;
        connection=@{alias='cache~fixture';host='localhost';scheme='http';port=57772;namespace='TEST';tlsVerify=$false;writeCredentials=$true;username='test-user';protectedPassword=[Convert]::ToBase64String($protected)}}
    if($PwshExe){$request.pwshExe=$PwshExe}
    function Invoke-Worker {
        [IO.File]::WriteAllText($requestFile,($request|ConvertTo-Json -Depth 12 -Compress),(New-Object Text.UTF8Encoding($false)))
        Assert (-not ([IO.File]::ReadAllText($requestFile).Contains($secret))) 'plaintext password entered request file'
        $info=New-Object Diagnostics.ProcessStartInfo
        $info.FileName=Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $info.Arguments='-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "'+(Join-Path $source 'gui-worker.ps1')+'" -RequestFile "'+$requestFile+'"'
        $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
        $info.StandardOutputEncoding=New-Object Text.UTF8Encoding($false);$info.StandardErrorEncoding=New-Object Text.UTF8Encoding($false)
        $info.EnvironmentVariables['APPDATA']=Join-Path $root 'AppData'
        $info.EnvironmentVariables['PATH']=Join-Path $env:WINDIR 'System32'
        $process=New-Object Diagnostics.Process;$process.StartInfo=$info
        try {
            [void]$process.Start();$output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync();$process.WaitForExit()
            $text=$output.GetAwaiter().GetResult()+$errors.GetAwaiter().GetResult()
            Assert ($process.ExitCode -eq 0) ('worker failed: '+$text)
            Assert (-not $text.Contains($secret) -and -not $text.Contains('test-user')) 'credentials entered worker logs'
            $line=@($text -split '\r?\n' | Where-Object { $_.StartsWith('PROJECT_RESULT:') })
            Assert ($line.Count -eq 1) 'expected one structured result'
            return ($line[0].Substring(15)|ConvertFrom-Json)
        } finally {$process.Dispose()}
    }
    $plan=Invoke-Worker
    Assert ($plan.state -eq 'planned') 'plan failed'
    Assert ($plan.mcpProgramPresent -eq $false -and @($plan.warnings).Count -gt 0) 'missing MCP should allow preparation with a notice'
    Assert (-not(Test-Path -LiteralPath (Join-Path $root 'project/.mcp.json'))) 'plan wrote configuration'
    $request.action='projectApply';$request.fingerprint=$plan.fingerprint
    $result=Invoke-Worker
    Assert ($result.state -eq 'applied') 'apply failed'
    Assert ($result.mcpProgramPresent -eq $false) 'missing MCP result not reported'
    $mcp=Get-Content -LiteralPath (Join-Path $root 'project/.mcp.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ($mcp.mcpServers.'iris-agentic-dev'.env.IRIS_PASSWORD -ceq $secret) 'protected credential did not roundtrip'
    $settings=Get-Content -LiteralPath (Join-Path $root 'AppData/Code/User/settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    Assert ($settings.'files.autoGuessEncoding' -eq $true) 'common user settings not applied'
    if($PwshExe){Assert ($settings.'terminal.integrated.defaultProfile.windows' -eq 'PowerShell 7') 'terminal settings not applied'}
    $request.action='projectInspect';$request.Remove('connection')
    $loaded=Invoke-Worker
    Assert ($loaded.hasCredentials -eq $true -and $loaded.port -eq 57772) 'inspect did not read existing configuration'
    $request.action='projectRollback';$request.receiptFile=$result.receiptFile
    $restored=Invoke-Worker
    Assert ($restored.state -eq 'rolled-back') 'rollback failed'
    Assert (-not(Test-Path -LiteralPath (Join-Path $root 'project/.mcp.json'))) 'new MCP not removed on rollback'
    Assert (-not(Test-Path -LiteralPath (Join-Path $root 'AppData/Code/User/settings.json'))) 'new user settings not removed on rollback'
    $afterHash=if(Test-Path -LiteralPath $realSettings){(Get-FileHash -LiteralPath $realSettings).Hash}else{'absent'}
    Assert ($beforeHash -ceq $afterHash) 'real user settings changed'
    Write-Host "$checks project worker checks passed on Windows PowerShell $($PSVersionTable.PSVersion), using selected VS Code runtime without Node PATH."
} finally {
    if(Test-Path -LiteralPath $root){
        $resolved=[IO.Path]::GetFullPath($root)
        if([IO.Path]::GetDirectoryName($resolved) -ne $parent -or -not [IO.Path]::GetFileName($resolved).StartsWith('ai-dev-project-worker-')){throw 'unsafe-cleanup'}
        foreach($item in @((Get-Item -LiteralPath $resolved -Force))+@(Get-ChildItem -LiteralPath $resolved -Recurse -Force)){if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'linked-cleanup'}}
        Remove-Item -LiteralPath $resolved -Recurse -Force
        if(Test-Path -LiteralPath $resolved){throw 'cleanup-failed'}
    }
}
