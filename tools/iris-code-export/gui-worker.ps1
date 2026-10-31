#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$StateDirectory,[ValidateRange(1,600)][int]$IdleSeconds=120)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSVersion.Major -eq 5) { $env:PSModulePath = Join-Path $PSHOME 'Modules' }
[Console]::InputEncoding=New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
$utf8=New-Object Text.UTF8Encoding($false,$true)
$pool=@{}; $blocked=$false; $stop=$false
[void][IO.Directory]::CreateDirectory($StateDirectory)
$journal=Join-Path $StateDirectory 'session-state.json'
function Emit($kind,$value) { [Console]::Out.WriteLine((@{kind=$kind;data=$value}|ConvertTo-Json -Depth 15 -Compress)); [Console]::Out.Flush() }
function Save-Json($file,$data) {
    $temp=$file+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
    try {
        [IO.File]::WriteAllText($temp,($data|ConvertTo-Json -Depth 15),$utf8)
        if(Test-Path -LiteralPath $file){[IO.File]::Replace($temp,$file,[System.Management.Automation.Language.NullString]::Value)}else{[IO.File]::Move($temp,$file)}
    } finally {if(Test-Path -LiteralPath $temp){Remove-Item -LiteralPath $temp -Force}}
}
function Journal($active,$reason) { Save-Json $journal @{schema='iris-export-gui-session/v1';active=$active;blocked=$script:blocked;reason=$reason;at=[DateTime]::UtcNow.ToString('o')} }
function Close-Pool {
    if(-not $pool.workers){return}
    $results=@(); $requests=0
    foreach($w in $pool.workers){$requests+=$w.requests}
    foreach($snapshot in $pool.knownSessions.Values){$results+= & $pool.close $snapshot}
    $verified=($results.Count -gt 0 -and @($results|Where-Object{-not $_.accepted}).Count -eq 0) -or ($requests -eq 0 -and $pool.knownSessions.Count -eq 0)
    foreach($file in $pool.receipts){
        $receipt=[IO.File]::ReadAllText($file,$utf8)|ConvertFrom-Json
        $receipt.logoutRequested=($results.Count -gt 0);$receipt.logoutResponseReceived=($results.Count -gt 0 -and @($results|Where-Object{-not $_.responseReceived}).Count -eq 0)
        $receipt.logoutResults=$results;$receipt.logoutVerified=$verified
        $receipt.logoutReason=if($verified){$null}else{'atelier-logout-unverified'}
        if($results.Count){$receipt.logoutHttpStatus=$results[-1].httpStatus}
        $receipt.sessionRetained=$false
        $receipt.state=if($verified -and @($receipt.items|Where-Object{$_.status -ne 'fetched'}).Count -eq 0){'complete'}else{'partial'}
        Save-Json $file $receipt
    }
    foreach($w in $pool.workers){$w.client.Dispose();$w.handler.Dispose()}
    if($pool.mutex){$pool.mutex.ReleaseMutex();$pool.mutex.Dispose()}
    $pool.Clear()
    if(-not $verified){$script:blocked=$true}
    Journal $false $(if($verified){'closed'}else{'exit-unverified'})
    Emit 'closed' @{cleanupVerified=$verified;licenseReleaseVerified=$false;results=$results;blocked=$script:blocked}
}
$owner=New-Object Threading.Mutex($false,'Local\ImedicalSourceExporterGui')
$owned=$false
try {
    try{$owned=$owner.WaitOne(0)}catch [Threading.AbandonedMutexException]{$owned=$true}
    if(-not $owned){throw 'another-exporter-window-is-running'}
    if(Test-Path -LiteralPath $journal){$prior=[IO.File]::ReadAllText($journal,$utf8)|ConvertFrom-Json;$blocked=[bool]($prior.active -or $prior.blocked)}
    Emit 'ready' @{blocked=$blocked;idleSeconds=$IdleSeconds;maximumSessions=10}
    $reader=New-Object IO.StreamReader([Console]::OpenStandardInput(),$utf8)
    $pending=$reader.ReadLineAsync()
    while(-not $stop){
        if(-not $pending.IsCompleted){
            if($pool.lastUsed -and ([DateTime]::UtcNow-$pool.lastUsed).TotalSeconds -ge $IdleSeconds){Close-Pool}
            Start-Sleep -Milliseconds 100;continue
        }
        $line=$pending.GetAwaiter().GetResult()
        if($null -eq $line){break}
        try {
            $message=$line|ConvertFrom-Json
            if($message.op -eq 'quit'){Close-Pool;$stop=$true;continue}
            if($message.op -eq 'close'){Close-Pool;continue}
            if($message.op -eq 'reconcile'){
                if($pool.workers -or -not $message.confirm -or -not $message.evidence){throw 'onsite-cleanup-evidence-required'}
                Save-Json (Join-Path $StateDirectory ('reconciliation-'+[guid]::NewGuid().ToString('N')+'.json')) @{at=[DateTime]::UtcNow.ToString('o');evidence=$message.evidence;licenseReleaseVerified=$false}
                $blocked=$false;Journal $false 'operator-reconciled';Emit 'reconciled' @{blocked=$false};continue
            }
            if($message.op -ne 'run'){throw 'unknown-operation'}
            $job=$message.job
            $plan=[bool]$message.plan
            if(-not $plan -and $blocked){throw 'previous-session-unresolved-inspect-before-reconcile'}
            $sessions=[int]$job.sessions
            if($sessions -lt 1 -or $sessions -gt 10){throw 'sessions-must-be-1-through-10'}
            if(-not $plan -and (-not $message.user -or -not $message.password)){throw 'username-and-password-required'}
            $identity=(@($job.url,$job.ns,$message.user,$message.password,$sessions)|ConvertTo-Json -Compress)
            if(-not $plan -and $pool.workers -and $pool.requestIdentity -cne $identity){Close-Pool;if($blocked){throw 'previous-session-unresolved'}}
            $arguments=@{OutputDirectory=(Join-Path $job.batch 'export');AtelierUrl=$job.url;Namespace=$job.ns;IntervalMs=[int]$job.interval;Sessions=$sessions;CancelFile=(Join-Path $job.batch 'stop.request');PlanOnly=$plan;Resume=[bool]$message.resume;SessionTrial=[bool]$message.trial;ConfirmedSessionBudget=[bool]$message.confirmed}
            if(-not $plan){
                $secret=ConvertTo-SecureString $message.password -AsPlainText -Force
                $arguments.Credential=New-Object Management.Automation.PSCredential($message.user,$secret)
                $arguments.SessionContext=$pool;Journal $true 'active';$pool.requestIdentity=$identity
            }
            if($message.PSObject.Properties.Name -contains 'password'){$message.password=$null};$identity=$null
            if($job.version){
                $scriptFile=Join-Path $PSScriptRoot 'export-version-baseline.ps1'
                $arguments.Version=$job.version;$arguments.Scope=$job.scope;$arguments.CatalogDirectory=Join-Path $PSScriptRoot 'catalogs';$arguments.ConfirmWebPaths=[bool]$job.confirmWeb
                if(Test-Path -LiteralPath (Join-Path $job.batch 'files.txt')){$arguments.SupplementListFile=Join-Path $job.batch 'files.txt'}
            }else{
                $scriptFile=Join-Path $PSScriptRoot 'export-iris-code.ps1';$arguments.ListFile=Join-Path $job.batch 'files.txt'
            }
            $output=@(& $scriptFile @arguments 6>&1)|Out-String
            $code=$LASTEXITCODE
            $receiptFile=Join-Path $job.batch 'export/baseline-state.json'
            $receipt=$null
            if(-not $plan -and (Test-Path -LiteralPath $receiptFile)){$receipt=[IO.File]::ReadAllText($receiptFile,$utf8)|ConvertFrom-Json}
            if(-not $plan -and ($code -eq 1 -or $receipt.reason -or $message.trial)){
                if($receipt.reason -and $receipt.reason -ne 'cancelled-by-user'){$blocked=$true}
                Close-Pool
            }
            if(-not $plan -and -not $pool.workers){Journal $false $(if($blocked){'blocked'}else{'idle'})}
            Emit 'result' @{exitCode=$code;plan=$plan;output=$output;batch=$job.batch;retained=[bool]$pool.workers;blocked=$blocked}
        } catch {Emit 'error' @{reason=$_.Exception.Message;blocked=$blocked}}
        finally {$pending=$reader.ReadLineAsync()}
    }
} catch {Emit 'fatal' @{reason=$_.Exception.Message}}
finally {if($owned){try{Close-Pool}finally{$owner.ReleaseMutex()}};$owner.Dispose()}
