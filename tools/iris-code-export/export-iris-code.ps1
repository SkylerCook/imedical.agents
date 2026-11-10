#requires -Version 5.1
<#
.SYNOPSIS
按 UTF-8 TXT 清单从内网 IRIS 读取当前源码，保存到指定本地目录。
.EXAMPLE
.\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory D:\work\snapshot -PlanOnly
.EXAMPLE
.\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory D:\work\snapshot
.EXAMPLE
.\export-iris-code.ps1 -ListFile .\files.txt -OutputDirectory D:\work\snapshot
.NOTES
只需 Windows PowerShell 5.1；脚本可单独拷贝。连接地址、namespace 和凭据在运行时输入。
AtelierUrl 为已启用 Atelier 应用的根 URL（以 /api/atelier/ 结尾），可含网关前缀。
默认单会话 GET 源码和 HEAD 退出会话；显式多会话最多 10 个，不上传、编译或提交。使用系统证书校验，无外网请求。
首次输出目录必须不存在。中断后原参数加 -Resume；本地已保存文件摘要变化时停止。
先用 -MaxFilesPerRun 1 验证落盘，再用新进程 -Resume 继续。退出码 0 完整、2 部分、1 阻断。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ListFile,
    [string]$VersionSelectionFile,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [string]$AtelierUrl,
    [string]$Namespace,
    [PSCredential]$Credential,
    [ValidateSet('CLS', 'MAC', 'INC', 'INT', 'CSP')][string[]]$Type = @('CLS', 'MAC', 'INC', 'INT', 'CSP'),
    [string]$Prefix = '',
    [ValidateRange(50, 60000)][int]$IntervalMs = 200,
    [ValidateRange(1, 600)][int]$TimeoutSec = 30,
    [ValidateRange(1, 2147483647)][int]$MaxFilesPerRun = 2147483647,
    [ValidateRange(1, 10)][int]$Sessions = 1,
    [switch]$SessionTrial,
    [ValidateRange(0, 100)][int]$SampleLimit = 0,
    [switch]$ConfirmedSessionBudget,
    [string]$CancelFile,
    [hashtable]$SessionContext,
    [string[]]$ConfirmedMissing = @(),
    [switch]$DisableTiming,
    [switch]$PlanOnly,
    [switch]$Resume
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding($false, $true)

function Hash-Bytes([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Assert-PlainPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        # FileSystemInfo reads attributes directly, avoiding PowerShell provider setup
        # for every ancestor of every object. Missing paths have attributes -1.
        $attributes = ([IO.FileInfo]::new($current)).Attributes
        if ([int]$attributes -ne -1 -and ($attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'linked-path-forbidden' }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}
function Save-State {
    Assert-PlainPath $statePath
    $state.updatedAt = [DateTime]::UtcNow.ToString('o')
    $state.checkpointCount++
    $tmp = $statePath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($tmp, ($state | ConvertTo-Json -Depth 12), $utf8)
        if (Test-Path -LiteralPath $statePath) { [IO.File]::Replace($tmp, $statePath, [System.Management.Automation.Language.NullString]::Value) }
        else { [IO.File]::Move($tmp, $statePath) }
    } catch { throw 'local-state-write-failed' } finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
}
function Get-Destination([string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Contains('\') -or $Relative.Split('/') -contains '..') { throw 'unsafe-output-path' }
    $file = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $Relative))
    if (-not $file.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'unsafe-output-path' }
    Assert-PlainPath $file
    return $file
}

function Get-TransportDiagnostic([Exception]$Exception) {
    $types = @(); $codes = @(); $tls = $false; $dns = $false; $connection = $false; $timeout = $false; $cancelled = $false
    for ($depth = 0; $Exception -and $depth -lt 16; $depth++) {
        $types += $Exception.GetType().FullName
        if ($Exception -is [Security.Authentication.AuthenticationException]) { $tls = $true }
        if ($Exception -is [TimeoutException]) { $timeout = $true }
        if ($Exception -is [OperationCanceledException]) { $cancelled = $true }
        if ($Exception -is [Net.WebException]) {
            $code = $Exception.Status.ToString(); $codes += 'WebExceptionStatus.' + $code
            if ($code -in @('TrustFailure', 'SecureChannelFailure')) { $tls = $true }
            if ($code -in @('NameResolutionFailure', 'ProxyNameResolutionFailure')) { $dns = $true }
            if ($code -eq 'Timeout') { $timeout = $true }
            if ($code -in @('ConnectFailure', 'ConnectionClosed', 'ReceiveFailure', 'SendFailure', 'KeepAliveFailure')) { $connection = $true }
        }
        if ($Exception -is [Net.Sockets.SocketException]) {
            $code = $Exception.SocketErrorCode.ToString(); $codes += 'SocketError.' + $code
            if ($code -in @('HostNotFound', 'TryAgain', 'NoData')) { $dns = $true }
            if ($code -eq 'TimedOut') { $timeout = $true }
            if ($code -in @('ConnectionRefused', 'ConnectionReset', 'ConnectionAborted', 'NetworkUnreachable', 'HostUnreachable', 'NetworkDown')) { $connection = $true }
        }
        $Exception = $Exception.InnerException
    }
    $category = 'transport'; $message = 'HTTP transport failed; inspect the local network and gateway.'
    if ($tls) { $category = 'tls'; $message = 'TLS certificate validation or secure channel failed.' }
    elseif ($dns) { $category = 'dns'; $message = 'Server name resolution failed.' }
    elseif ($timeout -or $cancelled) { $category = 'timeout-or-cancelled'; $message = 'The request timed out or was cancelled.' }
    elseif ($connection) { $category = 'connection'; $message = 'The connection was refused, interrupted or unreachable.' }
    # Never persist raw exception messages: they can contain URLs, headers or credentials.
    return [pscustomobject]@{category = $category; message = $message; exceptionTypes = @($types); nativeStatus = @($codes)}
}
function Get-SessionSnapshot([Net.CookieContainer]$Container, [uri]$BaseUri) {
    $cookies = @($Container.GetCookies($BaseUri)); $sessionCookies = @($cookies | Where-Object { $_.Name -match '^CSPSESSION' -and $_.Value })
    if (-not $sessionCookies.Count) { return $null }
    # Recognized CSP tokens contain variable gateway data (1-8), a fixed session
    # identity (9-22), and a MAC (23-50). A trusted server response may renew the
    # variable data and MAC while retaining the same session identity.
    # Unknown formats retain exact-value identity checks.
    $identity = Hash-Bytes ($utf8.GetBytes((($sessionCookies | ForEach-Object {
        $token=$_.Value
        if($token -cmatch '^[A-Za-z0-9_$]{50}$'){$token='csp50:'+ $token.Substring(8,14)}else{$token='exact:'+ $token}
        $_.Name + '|' + $_.Domain + '|' + $_.Path + '|' + $token
    } | Sort-Object) -join "`n")))
    $copies = @($cookies | ForEach-Object { $copy = New-Object Net.Cookie($_.Name, $_.Value, $_.Path, $_.Domain); $copy.Secure = $_.Secure; $copy.HttpOnly = $_.HttpOnly; $copy })
    $values = Hash-Bytes ($utf8.GetBytes((($sessionCookies | ForEach-Object { $_.Value } | Sort-Object) -join "`n")))
    $scopes = Hash-Bytes ($utf8.GetBytes((($sessionCookies | ForEach-Object { $_.Name + '|' + $_.Domain + '|' + $_.Path } | Sort-Object) -join "`n")))
    return [pscustomobject]@{identity = $identity; valueHash = $values; scopeHash = $scopes; count = $sessionCookies.Count; cookies = $copies}
}
function Record-SessionChange($Worker, $Current, $Response, [string]$Phase) {
    $before=$null;if($Worker.identity){$before=$knownSessions[$Worker.identity]}
    $event=[pscustomobject]@{at=[DateTime]::UtcNow.ToString('o');phase=$Phase;worker=$Worker.number;workerRequests=$Worker.requests;
        requestElapsedMs=if($Worker.started){[int]([DateTime]::UtcNow-$Worker.started).TotalMilliseconds}else{$null};
        httpStatus=if($Response){[int]$Response.StatusCode}else{$null};
        previousIdentity=$Worker.identity;currentIdentity=if($Current){$Current.identity}else{$null};
        cookieValueChanged=if($before -and $Current){$before.valueHash -cne $Current.valueHash}else{$null};
        cookieScopeChanged=if($before -and $Current){$before.scopeHash -cne $Current.scopeHash}else{$null};
        responseSetsCookie=if($Response){$Response.Headers.Contains('Set-Cookie')}else{$false}}
    $state | Add-Member NoteProperty sessionChange $event -Force
}
function Close-SessionSnapshot($Snapshot) {
    $result = [ordered]@{responseReceived = $false; httpStatus = $null; accepted = $false; reason = $null; diagnostic = $null}
    $exitHandler = $null; $exitClient = $null; $exitRequest = $null; $exitResponse = $null
    try {
        # A separate cookie jar sends precisely this owned session, including after local expiry/rotation.
        $exitHandler = New-Object Net.Http.HttpClientHandler
        $exitHandler.AllowAutoRedirect = $false; $exitHandler.UseProxy = $false; $exitHandler.UseCookies = $true
        foreach ($cookie in $Snapshot.cookies) { $exitHandler.CookieContainer.Add($uri, $cookie) }
        $exitClient = New-Object Net.Http.HttpClient($exitHandler); $exitClient.Timeout = [TimeSpan]::FromSeconds([Math]::Min($TimeoutSec, 10))
        $exitRequest = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Head, ($uri.AbsoluteUri + '?CacheLogout=end'))
        $exitResponse = $exitClient.SendAsync($exitRequest).GetAwaiter().GetResult()
        $result.responseReceived = $true; $result.httpStatus = [int]$exitResponse.StatusCode
        $result.accepted = (($result.httpStatus -ge 200 -and $result.httpStatus -lt 300) -or $result.httpStatus -eq 401)
        if (-not $result.accepted) { $result.reason = 'atelier-logout-http-' + $result.httpStatus }
    } catch { $result.reason = 'atelier-logout-transport-or-timeout'; $result.diagnostic = & $diagnosticCallback $_.Exception }
    finally { if ($exitResponse) { $exitResponse.Dispose() }; if ($exitRequest) { $exitRequest.Dispose() }; if ($exitClient) { $exitClient.Dispose() }; if ($exitHandler) { $exitHandler.Dispose() } }
    return [pscustomobject]$result
}

$diagnosticCallback = ${function:Get-TransportDiagnostic}
try {
    if ($env:OS -ne 'Windows_NT') { throw 'windows-powershell-required' }
    $inputFile = $ListFile
    $baselinePath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($inputFile)
    $root = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputDirectory)).TrimEnd('\', '/')
    if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\', '/')) { throw 'output-must-not-be-volume-root' }
    Assert-PlainPath $baselinePath
    Assert-PlainPath $root
    $nodes = New-Object 'Collections.Generic.List[object]'
    $lineNumber = 0
    foreach ($line in $utf8.GetString([IO.File]::ReadAllBytes($baselinePath)).TrimStart([char]0xFEFF).Split("`n")) {
        $lineNumber++; $entry = $line.Trim()
        if (-not $entry -or $entry.StartsWith('#')) { continue }
        if ($entry -match '\.(cls|mac|inc|int)$' -and -not $entry.Contains('/')) { $kind = $Matches[1].ToUpperInvariant() }
        elseif ($entry.StartsWith('/') -and $entry -match '\.(csp|csr|js|css|html|htm|png|jpg|jpeg|gif|ico|bmp|svg|webp|avif)$') { $kind = 'CSP' }
        else { throw ('list-format-invalid-line-' + $lineNumber) }
        $nodes.Add([pscustomobject]@{name=$entry;type=$kind})
    }
    if (-not $nodes.Count) { throw 'empty-catalog' }
    $items = New-Object 'Collections.Generic.List[object]'; $excluded = @(); $seen = @{}; $paths = @{}
    foreach ($node in $nodes) {
        $name = $node.name; $kind = $node.type
        if ($kind -ne 'CSP') {
            $ext = '.' + $kind.ToLowerInvariant()
            if ($name.EndsWith($ext, [StringComparison]::OrdinalIgnoreCase)) { $name = $name.Substring(0, $name.Length - 4) }
            if ($name -cnotmatch '^[%A-Za-z][%A-Za-z0-9]*(\.[%A-Za-z][%A-Za-z0-9]*)*$') { throw 'invalid-backend-name' }
            $document = $name + $ext
            if ($kind -eq 'CLS') { $relative = 'src/' + $name.Replace('.', '/') + $ext }
            else { $relative = 'src/routines/' + $document }
        } else {
            $document = $name.Substring(1)
            if ($document -match '[\\:%?#*,;\x00-\x1f\x7f]' -or $document.Split('/') -contains '' -or
                $document.Split('/') -contains '.' -or $document.Split('/') -contains '..') { throw 'unsafe-web-name' }
            $relative = 'src/' + $document
            $ext = [IO.Path]::GetExtension($document).ToLowerInvariant()
        }
        foreach ($segment in $relative.Split('/')) {
            if ($segment -match '[<>:"|?*\x00-\x1f]' -or $segment -match '[. ]$' -or $segment -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)') { throw 'unsafe-windows-name' }
        }
        $key = $kind + ':' + $document
        if ($seen.ContainsKey($key)) { throw 'duplicate-scope-item' }; $seen[$key] = $true
        if ($ext -in @('.png', '.jpg', '.jpeg', '.gif', '.ico', '.bmp', '.svg', '.webp', '.avif')) { $excluded += $document; continue }
        if ($ext -notin @('.cls', '.mac', '.inc', '.int', '.csp', '.csr', '.js', '.css', '.html', '.htm')) { throw 'unsupported-code-type' }
        if ($kind -notin $Type -or -not $name.StartsWith($Prefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($paths.ContainsKey($relative)) { throw 'output-path-collision' }; $paths[$relative] = $true
        [void](Get-Destination $relative)
        $items.Add([pscustomobject]@{document = $document; path = $relative; status = 'pending'; sha256 = $null; bytes = 0; observedAt = $null; reason = $null})
    }
    $items = $items.ToArray()
    foreach ($relative in $paths.Keys) {
        $parent = $relative
        while ($parent.Contains('/')) { $parent = $parent.Substring(0, $parent.LastIndexOf('/')); if ($paths.ContainsKey($parent)) { throw 'output-path-collision' } }
    }
    if ($PlanOnly) {
        [pscustomobject]@{total = $items.Count; excludedImageCount = $excluded.Count; excludedImages = $excluded; items = $items} | ConvertTo-Json -Depth 8
        exit 0
    }
    if ($Resume -and (Test-Path -LiteralPath (Join-Path $root '.baseline'))) { throw 'development-baseline-exists-do-not-resume' }
    if (-not $items.Count) { throw 'no-code-selected' }
    if ($SampleLimit -gt 0 -and $items.Count -gt $SampleLimit) { throw 'sample-scope-exceeds-limit' }
    if ($Sessions -gt 1 -and $SampleLimit -eq 0 -and -not $SessionTrial -and -not $ConfirmedSessionBudget) { throw 'multi-session-budget-confirmation-required' }
    if ($SessionTrial) { $MaxFilesPerRun = $Sessions }
    if ($CancelFile) { $CancelFile = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CancelFile); Assert-PlainPath $CancelFile }
    if (-not $AtelierUrl) { $AtelierUrl = Read-Host 'Atelier root URL (ending /api/atelier/)' }
    if (-not $Namespace) { $Namespace = Read-Host 'Namespace' }
    $uri = [uri]($AtelierUrl.TrimEnd('/') + '/')
    if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        $uri.AbsolutePath -notmatch '/api/atelier/$' -or -not $Namespace -or $Namespace -match '[\x00-\x20/\\?#]') { throw 'invalid-atelier-target' }
    $target = Hash-Bytes ($utf8.GetBytes($uri.AbsoluteUri + '|' + $Namespace))
    $baselineHash = (Get-FileHash -LiteralPath $baselinePath -Algorithm SHA256).Hash
    $versionSelection = $null; $versionSelectionHash = $null
    if ($VersionSelectionFile) {
        $selectionPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($VersionSelectionFile)
        Assert-PlainPath $selectionPath
        $selectionBytes = [IO.File]::ReadAllBytes($selectionPath)
        $versionSelection = $utf8.GetString($selectionBytes) | ConvertFrom-Json
        if ($versionSelection.schema -ne 'iris-version-selection/v1' -or $versionSelection.version -cnotmatch '^v\d+\.\d+$' -or
            $versionSelection.scope -notin @('doctor','all-products') -or $versionSelection.filesSha256 -ne $baselineHash -or
            $versionSelection.selectedFileCount -ne $items.Count) { throw 'version-selection-does-not-match-list' }
        $versionSelectionHash = Hash-Bytes $selectionBytes
    }
    $scopeHash = Hash-Bytes ($utf8.GetBytes(($items.document -join "`n")))
    $scriptHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
    $statePath = Join-Path $root 'baseline-state.json'
    $mutex = New-Object Threading.Mutex($false, ('Local\IrisCodeExport-' + (Hash-Bytes ($utf8.GetBytes($uri.AbsoluteUri)))))
    $outputMutex = New-Object Threading.Mutex($false, ('Local\IrisCodeOutput-' + (Hash-Bytes ($utf8.GetBytes($root.ToLowerInvariant())))))
    $acquired = $false; $outputAcquired = $false
    try {
        try { $acquired = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $acquired = $true }
        if (-not $acquired) { throw 'another-export-is-running-for-target' }
        try { $outputAcquired = $outputMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $outputAcquired = $true }
        if (-not $outputAcquired) { throw 'another-export-is-running-for-output' }
        if ($Resume) {
            Assert-PlainPath $statePath
            $state = [IO.File]::ReadAllText($statePath, $utf8) | ConvertFrom-Json
            if ($state.schema -ne 'iris-standalone-baseline/v1' -or $state.target -ne $target -or $state.baselineHash -ne $baselineHash -or
                $state.scopeHash -ne $scopeHash -or $state.scriptHash -ne $scriptHash -or $state.outputRoot -ne $root -or @($state.items).Count -ne $items.Count) { throw 'resume-source-or-scope-mismatch' }
            if ($state.versionSelectionHash -cne $versionSelectionHash) { throw 'resume-version-selection-mismatch-use-the-original-version-entry' }
            $skipMissing = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
            foreach ($name in $ConfirmedMissing) {
                if (-not @($state.items | Where-Object { $_.document -ceq $name -and $_.status -eq 'missing' }).Count) { throw 'confirmed-missing-must-match-previous-404' }
                [void]$skipMissing.Add($name)
            }
            for ($i = 0; $i -lt $items.Count; $i++) {
                $old = $state.items[$i]; $expected = $items[$i]
                if ($old.document -cne $expected.document -or $old.path -cne $expected.path) { throw 'resume-item-mismatch' }
                $file = Get-Destination $old.path
                if (Test-Path -LiteralPath $file) {
                    if (-not $old.sha256 -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $old.sha256) { throw 'local-source-drift' }
                    $old.status = 'fetched'
                } elseif ($old.status -eq 'fetched') { throw 'local-source-missing' }
                elseif ($old.status -eq 'missing' -and $skipMissing.Contains($old.document)) {
                    $old | Add-Member NoteProperty missingDisposition 'operator-confirmed-no-retry' -Force
                }
                else {
                    $old.status = 'pending'; $old.sha256 = $null
                    if ($old.PSObject.Properties.Name -contains 'missingDisposition') { $old.PSObject.Properties.Remove('missingDisposition') }
                }
            }
            if (-not $state.logoutVerified -and -not @($state.items | Where-Object { $_.status -ne 'fetched' }).Count) { throw 'resume-previous-session-exit-unverified' }
        } else {
            if ($ConfirmedMissing.Count) { throw 'confirmed-missing-requires-resume' }
            if (Test-Path -LiteralPath $root) { throw 'output-directory-must-be-new-or-use-Resume' }
            [void][IO.Directory]::CreateDirectory($root)
            $state = [pscustomobject]@{schema = 'iris-standalone-baseline/v1'; target = $target; source = [ordered]@{atelierUrl = $uri.AbsoluteUri; namespace = $Namespace}; baselineHash = $baselineHash; scopeHash = $scopeHash; scriptHash = $scriptHash;
                outputRoot = $root; startedAt = [DateTime]::UtcNow.ToString('o'); updatedAt = $null; state = 'partial'; reason = $null;
                excludedImages = @($excluded); excludedImageCount = $excluded.Count; items = @($items); logoutVerified = $false; logoutHttpStatus = $null; licenseReleaseVerified = $false}
            if ($versionSelection) {
                $state | Add-Member -MemberType NoteProperty -Name versionSelection -Value $versionSelection
                $state | Add-Member -MemberType NoteProperty -Name versionSelectionHash -Value $versionSelectionHash
            }
        }
        foreach ($entry in @{
            session = [pscustomobject]@{cookieVerified = $false; requestCount = 0; authenticationCount = 0}
            checkpointCount = 0
            transportDiagnostic = $null; logoutRequested = $false; logoutResponseReceived = $false; logoutResults = @(); logoutReason = $null
        }.GetEnumerator()) { $state | Add-Member -MemberType NoteProperty -Name $entry.Key -Value $entry.Value -Force }
        $state.logoutHttpStatus = $null; $state.licenseReleaseVerified = $false
        Save-State
        if (-not $Credential) { $Credential = Get-Credential -Message 'IRIS read access (kept in memory only)' }
        if (-not $Credential) { throw 'credential-required' }
        Add-Type -AssemblyName System.Net.Http
        $identity = Hash-Bytes ($utf8.GetBytes($uri.AbsoluteUri + '|' + $Namespace + '|' + $Credential.UserName + '|' + $Credential.GetNetworkCredential().Password + '|' + $Sessions + '|' + $scriptHash))
        if ($SessionContext -and $SessionContext.workers -and $SessionContext.identity -cne $identity) { throw 'retained-session-identity-changed-close-first' }
        $workers = @()
        if ($SessionContext -and $SessionContext.workers) { $workers = $SessionContext.workers }
        for ($w = $workers.Count; $w -lt $Sessions; $w++) {
            $handler = New-Object Net.Http.HttpClientHandler
            $handler.AllowAutoRedirect = $false; $handler.UseProxy = $false; $handler.UseCookies = $true
            $handler.CookieContainer = New-Object Net.CookieContainer
            $client = New-Object Net.Http.HttpClient($handler)
            $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec); $client.MaxResponseContentBufferSize = 16777216
            $workers += [pscustomobject]@{number=$w;handler=$handler;client=$client;identity=$null;task=$null;request=$null;item=$null;ready=[DateTime]::MinValue;started=$null;clock=$null;requests=0}
        }
        $authorization = [Convert]::ToBase64String($utf8.GetBytes($Credential.UserName + ':' + $Credential.GetNetworkCredential().Password))
        $processed = 0; $state.reason = $null; $state.logoutVerified = $false
        $state.session | Add-Member NoteProperty requestedSessions $Sessions -Force
        $state.session | Add-Member NoteProperty intervalMs $IntervalMs -Force
        $knownSessions = @{}; $stopDispatch = $false
        if ($SessionContext -and $SessionContext.knownSessions) { $knownSessions = $SessionContext.knownSessions }
        foreach ($worker in $workers) { $worker.requests = 0 }
        if ($null -ne $SessionContext) {
            $SessionContext.identity = $identity; $SessionContext.workers = $workers; $SessionContext.knownSessions = $knownSessions
            $SessionContext.close = ${function:Close-SessionSnapshot}.GetNewClosure()
            if (-not $SessionContext.mutex) { $SessionContext.mutex = $mutex; $acquired = $false }
        }
        $queue = New-Object Collections.Queue
        foreach ($candidate in $state.items) {
            if ($candidate.status -ne 'fetched' -and -not ($candidate.status -eq 'missing' -and $skipMissing -and $skipMissing.Contains($candidate.document))) { $queue.Enqueue($candidate) }
        }
        try {
            while ($queue.Count -or @($workers | Where-Object { $_.task }).Count) {
                if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { $stopDispatch = $true; if (-not $state.reason) { $state.reason = 'cancelled-by-user' } }
                $pendingWrites = New-Object 'Collections.Generic.List[object]'
                $stateChanged = $false
                foreach ($worker in $workers) {
                    $handler = $worker.handler; $client = $worker.client
                    if (-not $worker.task -and -not $stopDispatch -and $queue.Count -and $processed -lt $MaxFilesPerRun -and [DateTime]::UtcNow -ge $worker.ready -and (-not $SessionTrial -or $worker.requests -eq 0)) {
                        $item = $queue.Dequeue(); $worker.item = $item
                        $encodedDocument = ($item.document.Split('/') | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
                        $url = $uri.AbsoluteUri + 'v1/' + [uri]::EscapeDataString($Namespace) + '/doc/' + $encodedDocument
                        $request = New-Object Net.Http.HttpRequestMessage([Net.Http.HttpMethod]::Get, $url)
                        $request.Headers.Accept.ParseAdd('application/json'); $worker.request = $request
                        try {
                            if ($worker.identity) {
                                $snapshot = Get-SessionSnapshot $handler.CookieContainer $uri
                                if (-not $snapshot) { throw 'atelier-session-lost' }
                                if ($snapshot.identity -cne $worker.identity) { Record-SessionChange $worker $snapshot $null 'before-request'; throw 'atelier-session-changed' }
                            } else {
                                $request.Headers.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Basic', $authorization)
                                $state.session.authenticationCount++
                            }
                            $state.session.requestCount++; $processed++; $worker.requests++
                            $worker.started = [DateTime]::UtcNow
                            $worker.ready = $worker.started.AddMilliseconds($IntervalMs)
                            $worker.clock = $null
                            if (-not $DisableTiming) {
                                $worker.clock = [Diagnostics.Stopwatch]::StartNew()
                                $item | Add-Member NoteProperty timing ([pscustomobject]@{schema='export-item-timing/v1';worker=$worker.number;startedAt=$worker.started.ToString('o');responseObservedMs=$null;parseValidateMs=$null;writeVerifyMs=$null;totalMs=$null}) -Force
                            }
                            $worker.task = $client.SendAsync($request)
                        } catch {
                            $item.status = 'failed'; $item.reason = $_.Exception.Message; $state.reason = $item.reason; $stopDispatch = $true
                            $request.Dispose(); $worker.request = $null; $stateChanged = $true
                        }
                    }
                    if (-not $worker.task -or -not $worker.task.IsCompleted) { continue }
                    $item = $worker.item; $request = $worker.request; $response = $null
                    if ($worker.clock) { $item.timing.responseObservedMs = $worker.clock.Elapsed.TotalMilliseconds }
                    $parseClock = if ($worker.clock) { [Diagnostics.Stopwatch]::StartNew() } else { $null }
                    try {
                        try { $response = $worker.task.GetAwaiter().GetResult() }
                        catch { $state.transportDiagnostic = Get-TransportDiagnostic $_.Exception; throw 'atelier-transport-or-timeout' }
                    $previousSession=$null;if($worker.identity){$previousSession=$knownSessions[$worker.identity]}
                    $currentSession = Get-SessionSnapshot $handler.CookieContainer $uri
                    if ($currentSession -and $currentSession.count -eq 1) { $knownSessions[$currentSession.identity] = $currentSession }
                    $httpStatus = [int]$response.StatusCode
                    if (($httpStatus -lt 200 -or $httpStatus -ge 300) -and $httpStatus -ne 404) { throw ('atelier-http-' + $httpStatus) }
                    if (-not $currentSession) { if ($worker.identity) { throw 'atelier-session-lost' }; throw 'atelier-session-cookie-missing' }
                    if ($currentSession.count -ne 1) { throw 'atelier-session-ambiguous' }
                    if ($worker.identity -and $currentSession.identity -cne $worker.identity) { Record-SessionChange $worker $currentSession $response 'after-response'; throw 'atelier-session-changed' }
                    if($previousSession -and $previousSession.valueHash -cne $currentSession.valueHash){
                        if(-not ($state.session.PSObject.Properties.Name -contains 'cookieRefreshCount')){$state.session|Add-Member NoteProperty cookieRefreshCount 0}
                        $state.session.cookieRefreshCount++
                    }
                    $worker.identity = $currentSession.identity; $state.session.cookieVerified = $true
                    if ($httpStatus -eq 404) { $item.status = 'missing'; $item.reason = $null; $stateChanged = $true; continue }
                    try { $payload = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json } catch { throw 'atelier-json-invalid' }
                    $value = $payload.result
                    if ($payload.status.errors.Count -or $payload.status.summary -or ($value.status -and $value.status -ne 'OK')) { throw 'atelier-document-error' }
                    if (-not $value -or $value.content -isnot [array] -or ($value.name -and $value.name -cne $item.document) -or
                        @($value.content | Where-Object { $_ -isnot [string] }).Count -or
                        ($null -ne $value.enc -and $value.enc -isnot [bool])) { throw 'atelier-text-document-invalid' }
                    if ($value.enc) {
                        # Each API chunk is independently base64 encoded (including padding).
                        # Preserve original bytes rather than interpreting legacy Web encodings.
                        $decoded = New-Object IO.MemoryStream
                        try {
                            foreach ($chunk in $value.content) {
                                try { $part = [Convert]::FromBase64String($chunk) } catch { throw 'atelier-base64-invalid' }
                                $decoded.Write($part, 0, $part.Length)
                            }
                            $content = $decoded.ToArray()
                        } finally { $decoded.Dispose() }
                        $item | Add-Member NoteProperty contentEncoding 'base64' -Force
                    } else { $content = $utf8.GetBytes(($value.content -join "`n")) }
                    $item.observedAt = [DateTime]::UtcNow.ToString('o')
                    if (-not $content.Length) { $item.status = 'empty'; $item.reason = $null; $stateChanged = $true; continue }
                    if ($item.document.EndsWith('.cls') -and $utf8.GetString($content) -notmatch ('(?m)^\s*Class\s+' + [regex]::Escape($item.document.Substring(0, $item.document.Length - 4)) + '(?=\s|\(|$)')) { throw 'class-identity-mismatch' }
                    $file = Get-Destination $item.path
                    if (Test-Path -LiteralPath $file) { throw 'existing-file-conflict' }
                    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
                    $item.sha256 = Hash-Bytes $content; $item.bytes = $content.Length; $item.status = 'writing'
                    $item.reason = $null
                    $pendingWrites.Add([pscustomobject]@{item=$item;file=$file;content=$content;sequence=$processed;clock=$worker.clock})
                    $stateChanged = $true
                    } catch {
                        $item.status = 'failed'; $item.reason = $_.Exception.Message
                        if (-not $state.reason -or $item.reason -eq 'atelier-http-503') { $state.reason = $item.reason }
                        if ($item.reason -like 'atelier-session-*') { $state.session.cookieVerified = $false }
                        $stopDispatch = $true; $stateChanged = $true
                    } finally {
                        if ($worker.clock) {
                            $item.timing.parseValidateMs = $parseClock.Elapsed.TotalMilliseconds
                            $item.timing.totalMs = $worker.clock.Elapsed.TotalMilliseconds
                        }
                        if ($response) { $response.Dispose() }; $request.Dispose()
                        $worker.task = $null; $worker.request = $null
                    }
                }
                if ($pendingWrites.Count) {
                    # Persist all expected hashes before publishing any file in this group.
                    Save-State
                    foreach ($pending in $pendingWrites) {
                        $item = $pending.item; $file = $pending.file; $content = $pending.content
                        $writeClock = if ($pending.clock) { [Diagnostics.Stopwatch]::StartNew() } else { $null }
                        try {
                            # Publish complete bytes only; CreateNew/Move never replace an existing source.
                            $temporary = $file + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
                            try {
                                $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                                try { $stream.Write($content, 0, $content.Length); $stream.Flush($true) } finally { $stream.Dispose() }
                                Assert-PlainPath $file
                                [IO.File]::Move($temporary, $file)
                            } finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force } }
                            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $item.sha256) { throw 'write-readback-mismatch' }
                            $item.status = 'fetched'
                            Write-Host ('[{0}] {1}' -f $pending.sequence, $item.document)
                                } catch {
                            $item.status = 'failed'; $item.reason = $_.Exception.Message
                            if (-not $state.reason) { $state.reason = $item.reason }
                            $stopDispatch = $true
                        } finally {
                            if ($pending.clock) {
                                $item.timing.writeVerifyMs = $writeClock.Elapsed.TotalMilliseconds
                                $item.timing.totalMs = $pending.clock.Elapsed.TotalMilliseconds
                            }
                        }
                    }
                }
                if ($stateChanged) { Save-State }
                if (($stopDispatch -or $processed -ge $MaxFilesPerRun) -and -not @($workers | Where-Object { $_.task }).Count) { break }
                Start-Sleep -Milliseconds 10
            }
        } finally {
            # Only observed, owned sessions; never send credentials or re-authenticate on exit.
            # Response headers may have arrived even when buffering the response body timed out.
            foreach ($worker in $workers) {
                $lastSession = Get-SessionSnapshot $worker.handler.CookieContainer $uri
                if ($lastSession -and $lastSession.count -eq 1) { $knownSessions[$lastSession.identity] = $lastSession }
            }
            $retain = $null -ne $SessionContext
            if ($retain) {
                $state | Add-Member NoteProperty sessionRetained $true -Force
                if (-not $SessionContext.receipts) { $SessionContext.receipts = @() }
                if ($statePath -notin $SessionContext.receipts) { $SessionContext.receipts += $statePath }
                $SessionContext.lastUsed = [DateTime]::UtcNow
            }
            if (-not $retain) {
            foreach ($snapshot in $knownSessions.Values) { $state.logoutRequested = $true; $state.logoutResults += Close-SessionSnapshot $snapshot }
            if ($state.logoutRequested) {
                $state.logoutResponseReceived = (@($state.logoutResults | Where-Object { -not $_.responseReceived }).Count -eq 0)
                $state.logoutHttpStatus = $state.logoutResults[-1].httpStatus
                $state.logoutVerified = (@($state.logoutResults | Where-Object { -not $_.accepted }).Count -eq 0)
                if (-not $state.logoutVerified) { $state.logoutReason = 'atelier-logout-unverified' }
            } elseif ($state.session.requestCount -eq 0) { $state.logoutVerified = $true; $state.logoutReason = 'atelier-no-request-sent' }
            else { $state.logoutReason = 'atelier-session-cookie-unavailable' }
            if (-not $state.logoutVerified -and -not $state.reason) { $state.reason = 'atelier-logout-unverified' }
            $authorization = $null; foreach ($worker in $workers) { $worker.client.Dispose(); $worker.handler.Dispose() }
            }
            $state.state = 'partial'
            if($state.reason -like 'atelier-session-*'){$state.session.cookieVerified=$false}
            if (@($state.items | Where-Object { $_.status -ne 'fetched' }).Count -eq 0 -and $state.logoutVerified) { $state.state = 'complete' }
            Save-State
        }
        $summary = [ordered]@{state = $state.state; total = @($state.items).Count; excludedImageCount = $state.excludedImageCount; session = $state.session;
            logoutRequested = $state.logoutRequested; logoutResponseReceived = $state.logoutResponseReceived; logoutVerified = $state.logoutVerified; logoutHttpStatus = $state.logoutHttpStatus;
            logoutReason = $state.logoutReason; logoutResults = $state.logoutResults; licenseReleaseVerified = $false; reason = $state.reason; transportDiagnostic = $state.transportDiagnostic}
        foreach ($status in @('fetched', 'missing', 'empty', 'failed', 'pending', 'writing')) { $summary[$status] = @($state.items | Where-Object { $_.status -eq $status }).Count }
        $summary | ConvertTo-Json -Depth 8
        $exitCode = 2; if ($state.state -eq 'complete') { $exitCode = 0 }
    } finally {
        if ($outputAcquired) { $outputMutex.ReleaseMutex() }; $outputMutex.Dispose()
        if ($acquired) { $mutex.ReleaseMutex() }; if ($null -eq $SessionContext -or $SessionContext.mutex -ne $mutex) { $mutex.Dispose() }
    }
    exit $exitCode
} catch {
    if ($null -ne $SessionContext) { $SessionContext.lastError = $_.Exception.Message }
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
