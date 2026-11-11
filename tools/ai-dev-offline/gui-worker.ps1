#requires -Version 5.1
param([Parameter(Mandatory=$true)][string]$RequestFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
function Say([string]$Message) { [Console]::WriteLine($Message) }
function Run([string]$Exe,[string]$Arguments) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$Exe; $info.Arguments=$Arguments; $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process
    $process.StartInfo=$info
    try {
        [void]$process.Start()
        $output=$process.StandardOutput.ReadToEndAsync(); $errors=$process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $text=$output.GetAwaiter().GetResult()+$errors.GetAwaiter().GetResult()
        if($process.ExitCode -notin @(0,3010)){throw "程序退出码 $($process.ExitCode) $text"}
        if($text.Trim()){Say $text.Trim()}
    } finally {$process.Dispose()}
}
function SafePath([string]$Path) {
    if($Path -match '[";\r\n]'){throw '路径包含不支持的字符。'}
    $full=[IO.Path]::GetFullPath($Path)
    $current=$full
    while($current){
        if((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw '请选择实体目录，不能使用目录链接。'}
        $current=[IO.Path]::GetDirectoryName($current)
    }
    return $full
}
try {
    $request=Get-Content -LiteralPath $RequestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if($request.action -in @('projectInspect','projectPlan','projectApply','projectRollback')){
        if(-not (Test-Path -LiteralPath $request.codeExe -PathType Leaf) -or [IO.Path]::GetFileName($request.codeExe) -ine 'Code.exe'){throw '请选择已安装的 Code.exe。'}
        if($request.connection -and $request.connection.writeCredentials){
            Add-Type -AssemblyName System.Security
            $secretBytes=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($request.connection.protectedPassword),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
            try {$request.connection | Add-Member -NotePropertyName password -NotePropertyValue ([Text.Encoding]::UTF8.GetString($secretBytes))}
            finally {[Array]::Clear($secretBytes,0,$secretBytes.Length)}
            $request.connection.PSObject.Properties.Remove('protectedPassword')
        }
        $info=New-Object Diagnostics.ProcessStartInfo
        $info.FileName=$request.codeExe
        $info.Arguments='"'+(Join-Path $PSScriptRoot 'configure-project.js')+'"'
        $info.UseShellExecute=$false;$info.CreateNoWindow=$true
        $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
        $info.StandardOutputEncoding=New-Object Text.UTF8Encoding($false)
        $info.StandardErrorEncoding=New-Object Text.UTF8Encoding($false)
        $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE']='1'
        $process=New-Object Diagnostics.Process;$process.StartInfo=$info
        try {
            [void]$process.Start()
            $output=$process.StandardOutput.ReadToEndAsync();$errors=$process.StandardError.ReadToEndAsync()
            $inputBytes=[Text.Encoding]::UTF8.GetBytes(($request|ConvertTo-Json -Depth 12 -Compress))
            try {$process.StandardInput.BaseStream.Write($inputBytes,0,$inputBytes.Length)}
            finally {[Array]::Clear($inputBytes,0,$inputBytes.Length);$process.StandardInput.Close()}
            $process.WaitForExit()
            $result=$output.GetAwaiter().GetResult();$errorText=$errors.GetAwaiter().GetResult()
            if($process.ExitCode -ne 0){throw $errorText.Trim()}
            $parsed=$result|ConvertFrom-Json
            Say ('项目配置结果：'+$parsed.state)
            if($parsed.warnings){foreach($warning in $parsed.warnings){Say ('提示：'+$warning)}}
            if($parsed.files){foreach($file in $parsed.files){Say ($file.operation+' '+$file.file+' ['+($file.keys -join ', ')+']')}}
            if($parsed.receiptFile){Say ('配置回执：'+$parsed.receiptFile)}
            Say ('PROJECT_RESULT:'+($parsed|ConvertTo-Json -Depth 12 -Compress))
            exit 0
        } finally {$process.Dispose()}
    }
    if($request.scope -notin @('User','Machine','Process')){throw '无效的环境变量作用域。'}
    if($request.action -eq 'rollback'){
        & "$PSScriptRoot/configure-environment.ps1" -Action Rollback -Scope $request.scope -ReceiptFile $request.receipt
        exit 0
    }
    if($request.scope -eq 'Machine' -and @($request.items | Where-Object mode -ne 'installOnly').Count -gt 0){
        $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
        try {$principal=New-Object Security.Principal.WindowsPrincipal($identity); if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw '所有用户配置需要管理员权限。请关闭后右键启动程序，选择「以管理员身份运行」。'}} finally {$identity.Dispose()}
    }
    if($request.action -ne 'apply'){throw '无效操作。'}
    $root=SafePath $request.root
    $hash=[Security.Cryptography.SHA256]::Create()
    try {$key=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToUpperInvariant()))).Replace('-','')} finally {$hash.Dispose()}
    $mutex=New-Object Threading.Mutex($false,('Local\AiDevOffline-'+$key))
    $locked=$false
    try {$locked=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$locked=$true}
    if(-not $locked){throw '该安装目录正在由另一个安装助手使用，请等待完成后重试。'}
    $manifest=Get-Content -LiteralPath "$PSScriptRoot/manifest.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    $selected=@($request.items)
    if($selected.Count -eq 0){throw '请先选择至少一个工具。'}
    $failed=0
    foreach($item in $selected){
        try {
            $component=@($manifest.components | Where-Object id -eq $item.id)
            if($component.Count -ne 1 -or $item.id -eq 'codebuddy'){throw '不支持的工具。'}
            $component=$component[0]
            Say "正在处理 $($component.name)…"
            if($item.mode -in @('install','installOnly')){
                Say '校验离线安装包…'
                $verified=@(& "$PSScriptRoot/verify-packages.ps1" -PackageRoot $PSScriptRoot -Components $item.id)
                $archive=$verified[0].path
                Say ('原包位置：'+$archive)
                $folder=@{vscode='VSCode';git='Git';powershell='PowerShell';node='Node';python='Python';java8='Java'}[$item.id]
                $target=SafePath (Join-Path $root "$folder/$($component.version)")
                $exe=Join-Path $target $component.command
                $marker=Join-Path $target '.ai-dev-install.json'
                if(Test-Path -LiteralPath $target){
                    if(-not(Test-Path -LiteralPath $marker)){throw "目标目录已存在，请选择空目录或使用「已有工具」。$target"}
                    $owned=Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
                    if($owned.sha256 -ne $component.sha256){throw '安装目录属于其它版本，请更换目录。'}
                } else {
                    [void][IO.Directory]::CreateDirectory($target)
                    @{sha256=$component.sha256;state='installing'}|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8
                }
                $owned=Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
                if($owned.state -ne 'complete' -or -not(Test-Path -LiteralPath $exe)){
                    Say "安装到 $target"
                    switch($item.id){
                        git { Run $archive ('-y -o"'+$target+'"') }
                        python {
                            foreach($registry in @('HKCU:\Software\Python\PythonCore\3.14\InstallPath','HKLM:\Software\Python\PythonCore\3.14\InstallPath')){
                                if(Test-Path $registry){$existing=(Get-Item $registry).GetValue(''); if($existing -and $existing.TrimEnd('\') -ine $target.TrimEnd('\')){throw '检测到已有 Python 3.14，请使用「已有工具」选择 python.exe，避免修改原安装。'}}
                            }
                            Run $archive ('/quiet /norestart InstallAllUsers=0 TargetDir="'+$target+'" Include_pip=1 Include_test=0 Include_launcher=0 AssociateFiles=0 Shortcuts=0 PrependPath=0 Include_symbols=0 Include_debug=0 Include_freethreaded=0')
                        }
                        default { Expand-Archive -LiteralPath $archive -DestinationPath $target -Force }
                    }
                    if(-not(Test-Path -LiteralPath $exe -PathType Leaf)){throw "安装后未找到 $exe"}
                    if($item.id -eq 'vscode'){[void][IO.Directory]::CreateDirectory((Join-Path $target 'data'))}
                    @{sha256=$component.sha256;state='complete'}|ConvertTo-Json|Set-Content -LiteralPath $marker -Encoding UTF8
                }
            } elseif($item.mode -eq 'existing'){
                $exe=SafePath $item.path
                if(-not(Test-Path -LiteralPath $exe -PathType Leaf) -or [IO.Path]::GetFileName($exe) -ine [IO.Path]::GetFileName($component.command)){throw "请选择 $([IO.Path]::GetFileName($component.command))"}
            } else {throw '无效操作。'}
            if($item.mode -eq 'installOnly') {
                $versionArgs=if($item.id -eq 'java8'){'-version'}else{'--version'}
                if($item.id -eq 'vscode') { Say '编辑器文件已安装。' } else { Run $exe $versionArgs }
                Say "[成功] $($component.name) 已安装，现有环境变量保持原值。"
                continue
            }
            Say '配置环境变量并检查命令…'
            [void][IO.Directory]::CreateDirectory($root)
            $paths=@{}
            if($item.mode -eq 'existing'){$paths[$item.id]=$exe}
            & "$PSScriptRoot/configure-environment.ps1" -Action Apply -Root $root -Components $item.id -Scope $request.scope -ExecutablePaths $paths | Out-String | ForEach-Object { Say $_ }
            Say "[成功] $($component.name)"
        } catch {$failed++; Say "[失败] $($item.id) — $($_.Exception.Message)"}
    }
    if($failed){Say "有 $failed 项未完成。处理原因后重新点击开始，已安装的工具将复用。";exit 1}
    Say '所选工具已处理完成。请关闭并重新打开终端，使环境变量生效。'
} catch {Say $_.Exception.Message;exit 1}

finally { if($locked){$mutex.ReleaseMutex()}; if($mutex){$mutex.Dispose()} }
