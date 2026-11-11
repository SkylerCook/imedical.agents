#requires -Version 5.1
$ErrorActionPreference='Stop'
$source=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../tools/ai-dev-offline'))
$parent=Join-Path ([IO.Path]::GetTempPath()) 'Codex'
if(Test-Path -LiteralPath 'D:\tmp'){$parent='D:\tmp\Codex'}
$testRoot=Join-Path $parent ('ai-dev-gui-tests-'+[guid]::NewGuid().ToString('N'))
$beforePath=$env:PATH
$beforeJava=$env:JAVA_HOME
$checks=0
function Assert($Condition,[string]$Message){if(-not $Condition){throw $Message};$script:checks++}
try {
    [void][IO.Directory]::CreateDirectory((Join-Path $testRoot 'java/bin'))
    foreach($file in @('gui-worker.ps1','build-gui.ps1','configure-environment.ps1')){
        $errors=$null
        [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $source $file),[ref]$null,[ref]$errors)
        Assert ($errors.Count -eq 0) "parse failed: $file"
    }
    $code='class Tool { static void Main() { System.Console.WriteLine("test-runtime 1.8.0"); } }'
    Add-Type -TypeDefinition $code -OutputAssembly (Join-Path $testRoot 'java/bin/java.exe') -OutputType ConsoleApplication
    $env:JAVA_HOME='original-java'
    & "$source/configure-environment.ps1" -Action Apply -Root $testRoot -Components java8 -Scope Process -ExecutablePaths @{java8=(Join-Path $testRoot 'java/bin/java.exe')} | Out-Null
    Assert ($env:JAVA_HOME -eq (Join-Path $testRoot 'java')) 'JAVA_HOME not set'
    $receipt=(Get-ChildItem -LiteralPath "$testRoot/.ai-dev-environment" -File | Select-Object -First 1).FullName
    $env:JAVA_HOME='later-change'
    $blocked=$false
    try {& "$source/configure-environment.ps1" -Action Rollback -Scope Process -ReceiptFile $receipt} catch {$blocked=$true}
    Assert $blocked 'later JAVA_HOME must block rollback'
    $env:JAVA_HOME=Join-Path $testRoot 'java'
    & "$source/configure-environment.ps1" -Action Rollback -Scope Process -ReceiptFile $receipt
    Assert ($env:JAVA_HOME -eq 'original-java') 'JAVA_HOME rollback failed'
    Assert ($env:PATH -ceq $beforePath) 'PATH rollback failed'
    $form=Get-Content -LiteralPath "$source/InstallerForm.cs" -Raw -Encoding UTF8
    Assert ($form.Contains('installOnly')) 'install-only entry missing'
    $worker=Get-Content -LiteralPath "$source/gui-worker.ps1" -Raw -Encoding UTF8
    Assert ($worker.Contains("'-y -o")) 'PortableGit output argument missing'
    Assert ($worker.Contains('Threading.Mutex')) 'concurrent install protection missing'
    Assert ($form.Contains('summary.Replace("\r\n","\n").Replace("\n",Environment.NewLine)')) 'preview CRLF missing'
    Assert ($form.Contains('if(running || confirming)return;')) 'reentrant confirmation protection missing'
    $compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    $formAssembly=Join-Path $testRoot 'InstallerForm.dll'
    & $compiler /nologo /codepage:65001 /target:library /platform:x64 "/out:$formAssembly" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Security.dll (Join-Path $source 'InstallerForm.cs') (Join-Path $source 'ProjectConfigurationForm.cs')
    Assert ($LASTEXITCODE -eq 0) 'GUI compilation failed'
    $assembly=[Reflection.Assembly]::Load([IO.File]::ReadAllBytes($formAssembly))
    $formType=$assembly.GetType('AiDevOffline.InstallerForm')
    $staticMethods=[Reflection.BindingFlags]'Static,NonPublic'
    $locations=$assembly.GetType('AiDevOffline.ToolLocations')
    $preferenceFile=Join-Path $testRoot 'preferences/last-project.json'
    $preferences=New-Object 'Collections.Generic.Dictionary[string,object]'
    $preferences.Add('projectRoot',$testRoot)
    $preferences.Add('codeExe',(Join-Path $testRoot 'Code.exe'))
    $preferences.Add('connection',@{host='private-host';password='private-secret'})
    $preferences.Add('password','private-secret')
    [void]$locations.GetMethod('Save',$staticMethods).Invoke($null,@($preferenceFile.PSObject.BaseObject,$preferences.PSObject.BaseObject))
    $saved=Get-Content -LiteralPath $preferenceFile -Raw -Encoding UTF8
    Assert (-not $saved.Contains('private-') -and -not $saved.Contains('connection')) 'directory preferences leaked connection details'
    $loaded=$locations.GetMethod('Read',$staticMethods).Invoke($null,@($preferenceFile.PSObject.BaseObject))
    Assert ($loaded['projectRoot'] -eq $testRoot -and $loaded.Count -eq 2) 'directory preferences did not roundtrip'
    $createStartInfo=$formType.GetMethod('CreateWorkerStartInfo',$staticMethods)
    $describeFailure=$formType.GetMethod('DescribeStartupFailure',$staticMethods)
    $nativeException=New-Object ComponentModel.Win32Exception(5)
    $failure=$describeFailure.Invoke($null,@($nativeException.PSObject.BaseObject,'test-start','test-powershell.exe'))
    Assert ($failure.Contains('test-start') -and $failure.Contains('test-powershell.exe') -and $failure.Contains('5')) 'startup failure details missing'
    $blockedLogDirectory=Join-Path $testRoot 'blocked-logs'
    Set-Content -LiteralPath $blockedLogDirectory -Value 'user-file'
    $logArguments=New-Object 'object[]' 1
    $logArguments[0]=[string[]]@($blockedLogDirectory,(Join-Path $testRoot 'fallback-logs'))
    $logger=$assembly.GetType('AiDevOffline.InstallLog').GetMethod('Create',$staticMethods).Invoke($null,$logArguments)
    try {
        $logger.Write('中文启动失败 Win32=5')
        $logged=Get-Content -LiteralPath $logger.FilePath -Raw -Encoding UTF8
        Assert ($logged.Contains('中文启动失败 Win32=5') -and $logged.Contains($blockedLogDirectory)) 'fallback log did not flush diagnostic details'
        $exported=Join-Path $testRoot 'exported.log'
        Copy-Item -LiteralPath $logger.FilePath -Destination $exported
        Assert ((Get-Content -LiteralPath $exported -Raw -Encoding UTF8) -ceq $logged) 'running log export changed content'
    } finally {$logger.Dispose()}
    Assert ((Get-Content -LiteralPath $blockedLogDirectory -Raw).Trim() -eq 'user-file') 'logging fallback changed existing file'
    $fixture=Join-Path $testRoot 'package'
    $payload=Join-Path $fixture 'payload'
    $archiveRoot=Join-Path $testRoot 'archive/node-v1.8.0-win-x64'
    [void][IO.Directory]::CreateDirectory($payload)
    [void][IO.Directory]::CreateDirectory($archiveRoot)
    Copy-Item -LiteralPath "$testRoot/java/bin/java.exe" -Destination "$archiveRoot/node.exe"
    foreach($name in @('gui-worker.ps1','configure-environment.ps1','verify-packages.ps1')){
        Copy-Item -LiteralPath (Join-Path $source $name) -Destination $fixture
    }
    Compress-Archive -LiteralPath $archiveRoot -DestinationPath "$payload/node.zip"
    $manifest=@{schemaVersion=1;components=@(@{id='node';name='Node fixture';version='1.8.0';file='node.zip';command='node-v1.8.0-win-x64/node.exe';bytes=(Get-Item "$payload/node.zip").Length;sha256=(Get-FileHash "$payload/node.zip").Hash.ToLowerInvariant()})}
    $manifest|ConvertTo-Json -Depth 8|Set-Content -LiteralPath "$fixture/manifest.json" -Encoding UTF8
    $installed=Join-Path $testRoot '安装 空格'
    $request=@{action='apply';scope='Process';root=$installed;items=@(@{id='node';mode='install'})}
    function Invoke-Worker {
        $request|ConvertTo-Json -Depth 8|Set-Content -LiteralPath "$testRoot/request.json" -Encoding UTF8
        $process=New-Object Diagnostics.Process
        $process.StartInfo=$createStartInfo.Invoke($null,@($fixture.PSObject.BaseObject,"$testRoot/request.json"))
        try {
            [void]$process.Start()
            $output=$process.StandardOutput.ReadToEndAsync()
            $errors=$process.StandardError.ReadToEndAsync()
            $process.WaitForExit()
            $script:workerOutput=$output.GetAwaiter().GetResult()+$errors.GetAwaiter().GetResult()
            $script:workerExit=$process.ExitCode
        } finally {$process.Dispose()}
    }
    $workerScript=Join-Path $fixture 'gui-worker.ps1'
    Set-Content -LiteralPath $workerScript -Stream Zone.Identifier -Value "[ZoneTransfer]`r`nZoneId=3"
    try {
        Invoke-Worker
        Assert ($workerExit -ne 0 -and -not(Test-Path -LiteralPath $installed)) 'internet-marked unsigned script was allowed'
    } finally {Remove-Item -LiteralPath $workerScript -Stream Zone.Identifier}
    Invoke-Worker
    Assert ($workerExit -eq 0) "worker install failed: $workerOutput"
    $installedExe=Join-Path $installed 'Node/1.8.0/node-v1.8.0-win-x64/node.exe'
    Assert (Test-Path -LiteralPath $installedExe) 'worker did not install executable'
    $installedTime=(Get-Item -LiteralPath $installedExe).LastWriteTimeUtc
    Invoke-Worker
    Assert ($workerExit -eq 0 -and (Get-Item -LiteralPath $installedExe).LastWriteTimeUtc -eq $installedTime) 'retry must reuse completed installation'
    $request.scope='Machine';$request.items[0].mode='installOnly'
    $receiptCount=@(Get-ChildItem -LiteralPath "$installed/.ai-dev-environment" -File).Count
    Invoke-Worker
    Assert ($workerExit -eq 0) "install-only failed: $workerOutput"
    Assert (@(Get-ChildItem -LiteralPath "$installed/.ai-dev-environment" -File).Count -eq $receiptCount) 'install-only changed environment'
    $request.scope='Process';$request.items[0].mode='existing';$request.items[0].path=$installedExe
    Invoke-Worker
    Assert ($workerExit -eq 0) "existing mode failed: $workerOutput"
    $sha=[Security.Cryptography.SHA256]::Create()
    try {$key=[BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($installed).ToUpperInvariant()))).Replace('-','')} finally {$sha.Dispose()}
    $mutex=New-Object Threading.Mutex($false,('Local\AiDevOffline-'+$key))
    try {
        [void]$mutex.WaitOne()
        Invoke-Worker
        Assert ($workerExit -ne 0) 'concurrent worker was accepted'
    } finally {$mutex.ReleaseMutex();$mutex.Dispose()}
    $request.items[0].path=Join-Path $testRoot 'absent.exe'
    Invoke-Worker
    Assert ($workerExit -ne 0) 'missing existing executable accepted'
    $request.items[0].mode='install';$request.root=Join-Path $testRoot 'collision'
    [void][IO.Directory]::CreateDirectory((Join-Path $request.root 'Node/1.8.0'))
    Set-Content -LiteralPath (Join-Path $request.root 'Node/1.8.0/user.txt') -Value 'preserve'
    Invoke-Worker
    Assert ($workerExit -ne 0 -and (Test-Path -LiteralPath (Join-Path $request.root 'Node/1.8.0/user.txt'))) 'unknown directory was overwritten'
    $splitPackages=Join-Path $testRoot 'packages'
    foreach($movePath in @($payload,$splitPackages)){if(-not [IO.Path]::GetFullPath($movePath).StartsWith($testRoot+[IO.Path]::DirectorySeparatorChar)){throw 'unsafe fixture move'}}
    Move-Item -LiteralPath $payload -Destination $splitPackages
    $request.root=Join-Path $testRoot 'split-install';$request.items[0].mode='installOnly'
    Invoke-Worker
    Assert ($workerExit -eq 0 -and (Test-Path -LiteralPath (Join-Path $request.root 'Node/1.8.0/node-v1.8.0-win-x64/node.exe'))) "split packages install failed: $workerOutput"
    Move-Item -LiteralPath $splitPackages -Destination $payload
    $request.items[0].mode='install'
    $request.root=Join-Path $testRoot 'damaged'
    [IO.File]::AppendAllText("$payload/node.zip",'corrupt')
    Invoke-Worker
    Assert ($workerExit -ne 0 -and -not(Test-Path -LiteralPath $request.root)) 'corrupt package was installed'
    Write-Host "$checks GUI checks passed on PowerShell $($PSVersionTable.PSVersion)"
} finally {
    $env:PATH=$beforePath;$env:JAVA_HOME=$beforeJava
    if(Test-Path -LiteralPath $testRoot){
        if([IO.Path]::GetDirectoryName($testRoot) -ne $parent -or (Get-Item -LiteralPath $testRoot).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'unsafe-test-cleanup'}
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
