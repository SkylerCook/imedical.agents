param(
    [string]$ProjectRoot = ".",
    [string[]]$TemplateNames = @(),
    [string]$TargetLanguage = "EN",
    [string]$McpServerName = "iris-agentic-dev",
    [string]$McpConfigPath = ".mcp.json",
    [string]$IrisNamespace = "",
    [string]$ReferencesDir = "references/xmlPrintTemp",
    [string]$OutputDir = "docs/xmlPrintTemp",
    [string]$ObjectScriptToolName = "",
    [ValidateSet("JsonLine", "ContentLength")]
    [string]$McpFraming = "JsonLine",
    [string]$EpisodeID = "",
    [switch]$ShowMcpStart,
    [switch]$TraceIrisOutput,
    [string]$DescribeMcpTool = "",
    [string]$QuerySql = "",
    [switch]$DiscoverFromConfig,
    [switch]$DiscoverOutpatientOverview,
    [string]$DiscoverFromPrintJson = "",
    [switch]$InspectOutpatientOverviewConfig,
    [switch]$ListMcpTools,
    [switch]$CheckConfig,
    [switch]$DryRun,
    [switch]$VerifyOnly,
    [switch]$Apply,
    [switch]$Overwrite,
    [ValidateRange(512, 16000)]
    [int]$ApplyChunkSize = 6000,
    [string]$I18nProfilePath = ".agents/config/i18n_project_profile.md"
)

Set-StrictMode -Version 3.0
$ErrorActionPreference = "Stop"

$script:ProjectRootPushed = $false
$projectRootResolved = [System.IO.Path]::GetFullPath($ProjectRoot)
Push-Location $projectRootResolved
$script:ProjectRootPushed = $true

function Resolve-RootPath([string]$Path) {
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Path))
}

function Escape-OsString([string]$Text) {
    return ($Text -replace '"', '""')
}

function Get-I18nLanguageDisplayMap([string]$ProfilePath) {
    $map = @{}
    if ([string]::IsNullOrWhiteSpace($ProfilePath)) { return $map }

    $resolvedPath = Resolve-RootPath $ProfilePath
    if (-not (Test-Path -LiteralPath $resolvedPath)) { return $map }

    foreach ($line in [System.IO.File]::ReadLines($resolvedPath, [System.Text.Encoding]::UTF8)) {
        $trimmed = $line.Trim()
        if (-not $trimmed.StartsWith("|")) { continue }
        if ($trimmed -match '^\|\s*-+\s*\|') { continue }

        $cells = @($trimmed.Trim("|").Split("|") | ForEach-Object { $_.Trim() })
        if ($cells.Count -lt 3) { continue }
        if ($cells[0] -eq "langId" -or $cells[1] -eq "Code") { continue }

        $code = $cells[1].ToUpperInvariant()
        $name = $cells[2]
        if (-not [string]::IsNullOrWhiteSpace($code) -and -not [string]::IsNullOrWhiteSpace($name)) {
            $map[$code] = $name
        }
    }

    return $map
}

function Get-LanguageDisplayName([string]$LanguageCode, [hashtable]$LanguageDisplayMap = @{}) {
    $code = $LanguageCode.ToUpperInvariant()
    if ($null -ne $LanguageDisplayMap -and $LanguageDisplayMap.ContainsKey($code)) {
        return [string]$LanguageDisplayMap[$code]
    }
    return $code
}

function Get-NormalizedTemplateNames([string[]]$Names) {
    return @($Names | ForEach-Object {
        if ($null -ne $_) { [string]$_ -split ',' }
    } | ForEach-Object {
        $_.Trim()
    } | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_)
    } | Select-Object -Unique)
}

function Add-PrintTempFromObject($Value, [System.Collections.Generic.HashSet[string]]$Set) {
    if ($null -eq $Value) { return }
    if ($Value -is [System.Array]) {
        foreach ($item in $Value) { Add-PrintTempFromObject $item $Set }
        return
    }
    if ($Value -is [System.Collections.IDictionary]) {
        foreach ($key in $Value.Keys) {
            if ($key -eq "PrintTemp" -and -not [string]::IsNullOrWhiteSpace([string]$Value[$key])) {
                [void]$Set.Add([string]$Value[$key])
            }
            Add-PrintTempFromObject $Value[$key] $Set
        }
        return
    }
    if ($Value.PSObject -and $Value.PSObject.Properties) {
        foreach ($prop in $Value.PSObject.Properties) {
            if ($prop.Name -eq "PrintTemp" -and -not [string]::IsNullOrWhiteSpace([string]$prop.Value)) {
                [void]$Set.Add([string]$prop.Value)
            }
            Add-PrintTempFromObject $prop.Value $Set
        }
    }
}

function Get-PrintTempNamesFromJsonFile([string]$Path) {
    $resolved = Resolve-RootPath $Path
    $json = Get-Content -LiteralPath $resolved -Raw | ConvertFrom-Json
    $set = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    Add-PrintTempFromObject $json $set
    return @($set)
}

function Get-ChineseDefaultValueCount([string]$Xml) {
    if ([string]::IsNullOrWhiteSpace($Xml)) { return 0 }
    return @([regex]::Matches($Xml, 'defaultvalue="([^"]*)"', 'IgnoreCase') | Where-Object {
        $_.Groups[1].Value -match '[\u4e00-\u9fff]'
    }).Count
}

function Get-ObjectPropertyValue($Object, [string]$Name, $Default = "") {
    if ($null -eq $Object) { return $Default }
    if ($Object.PSObject.Properties.Name -contains $Name) { return $Object.$Name }
    return $Default
}

function ConvertFrom-JsonArray([string]$Json) {
    $items = @($Json | ConvertFrom-Json)
    if ($items.Count -eq 1 -and $items[0] -is [System.Array]) {
        return @($items[0])
    }
    return @($items)
}

function Get-XmlDeclaredEncoding([string]$Text) {
    $m = [regex]::Match($Text, 'encoding\s*=\s*["'']([^"'']+)["'']', 'IgnoreCase')
    if ($m.Success) { return $m.Groups[1].Value }
    return "utf-8"
}

function Get-TextEncoding([string]$EncodingName) {
    switch -Regex ($EncodingName.ToLowerInvariant()) {
        'gb2312|gbk|gb18030' { return [System.Text.Encoding]::GetEncoding(936) }
        default { return [System.Text.Encoding]::UTF8 }
    }
}

function Write-XmlTextFile([string]$Path, [string]$Text) {
    $encodingName = Get-XmlDeclaredEncoding $Text
    $encoding = Get-TextEncoding $encodingName
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Path)) | Out-Null
    [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

function Read-XmlTextFile([string]$Path) {
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $utf8Text = [System.Text.Encoding]::UTF8.GetString($bytes)
    $encodingName = Get-XmlDeclaredEncoding $utf8Text
    if ($encodingName -match 'gb2312|gbk|gb18030') {
        return [System.Text.Encoding]::GetEncoding(936).GetString($bytes)
    }
    return $utf8Text
}

function Assert-XmlParseable([string]$Xml, [string]$Name) {
    try {
        [xml]$null = $Xml
    } catch {
        throw "XML parse failed for $Name`: $($_.Exception.Message)"
    }
}

function Read-McpLine([System.IO.Stream]$Stream) {
    $bytes = New-Object System.Collections.Generic.List[byte]
    while ($true) {
        $b = $Stream.ReadByte()
        if ($b -lt 0) { throw "MCP process closed stdout." }
        if ($b -eq 10) { break }
        if ($b -ne 13) { $bytes.Add([byte]$b) }
    }
    return [System.Text.Encoding]::ASCII.GetString($bytes.ToArray())
}

function Read-McpMessage($Client) {
    if ($Client.Framing -eq "JsonLine") {
        $stream = $Client.Process.StandardOutput.BaseStream
        $bytes = New-Object System.Collections.Generic.List[byte]
        while ($true) {
            $b = $stream.ReadByte()
            if ($b -lt 0) { throw "MCP process closed stdout." }
            if ($b -eq 10) { break }
            if ($b -ne 13) { $bytes.Add([byte]$b) }
        }
        $line = [System.Text.Encoding]::UTF8.GetString($bytes.ToArray())
        return $line | ConvertFrom-Json
    }
    $stream = $Client.Process.StandardOutput.BaseStream
    $contentLength = $null
    while ($true) {
        $line = Read-McpLine $stream
        if ($line -eq "") { break }
        if ($line -match '^Content-Length:\s*(\d+)$') {
            $contentLength = [int]$matches[1]
        }
    }
    if ($null -eq $contentLength) { throw "MCP response missing Content-Length." }
    $buf = New-Object byte[] $contentLength
    $read = 0
    while ($read -lt $contentLength) {
        $n = $stream.Read($buf, $read, $contentLength - $read)
        if ($n -le 0) { throw "MCP process closed while reading response body." }
        $read += $n
    }
    $json = [System.Text.Encoding]::UTF8.GetString($buf)
    return $json | ConvertFrom-Json
}

function Send-McpRequest($Client, [string]$Method, $Params) {
    $Client.NextId += 1
    $id = $Client.NextId
    $req = [ordered]@{
        jsonrpc = "2.0"
        id = $id
        method = $Method
        params = $Params
    }
    $json = ($req | ConvertTo-Json -Depth 100 -Compress)
    if ($Client.Framing -eq "JsonLine") {
        $Client.Process.StandardInput.WriteLine($json)
        $Client.Process.StandardInput.Flush()
    } else {
    $body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $header = [System.Text.Encoding]::ASCII.GetBytes("Content-Length: $($body.Length)`r`n`r`n")
    $stdin = $Client.Process.StandardInput.BaseStream
    $stdin.Write($header, 0, $header.Length)
    $stdin.Write($body, 0, $body.Length)
    $stdin.Flush()
    }

    while ($true) {
        $resp = Read-McpMessage $Client
        if ($resp.PSObject.Properties.Name -contains "id" -and $resp.id -eq $id) {
            if ($resp.PSObject.Properties.Name -contains "error") {
                throw "MCP $Method failed: $($resp.error | ConvertTo-Json -Depth 20 -Compress)"
            }
            return $resp.result
        }
    }
}

function Send-McpNotification($Client, [string]$Method, $Params) {
    $req = [ordered]@{
        jsonrpc = "2.0"
        method = $Method
        params = $Params
    }
    $json = ($req | ConvertTo-Json -Depth 100 -Compress)
    if ($Client.Framing -eq "JsonLine") {
        $Client.Process.StandardInput.WriteLine($json)
        $Client.Process.StandardInput.Flush()
        return
    }
    $body = [System.Text.Encoding]::UTF8.GetBytes($json)
    $header = [System.Text.Encoding]::ASCII.GetBytes("Content-Length: $($body.Length)`r`n`r`n")
    $stdin = $Client.Process.StandardInput.BaseStream
    $stdin.Write($header, 0, $header.Length)
    $stdin.Write($body, 0, $body.Length)
    $stdin.Flush()
}

function Set-ProcessEnvironmentValue($ProcessStartInfo, [string]$Name, [string]$Value) {
    $environmentProperty = $ProcessStartInfo.PSObject.Properties["Environment"]
    if ($null -ne $environmentProperty -and $null -ne $environmentProperty.Value) {
        $environmentProperty.Value[$Name] = $Value
        return
    }
    $ProcessStartInfo.EnvironmentVariables[$Name] = $Value
}

function Start-McpClient([string]$ConfigPath, [string]$ServerName) {
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    $server = $config.mcpServers.$ServerName
    if ($null -eq $server) { throw "MCP server '$ServerName' not found in $ConfigPath." }

    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $server.command
    $psi.WorkingDirectory = (Get-Location).Path
    $serverArgs = @($server.args)
    if (($serverArgs -notcontains "--config") -and (Test-Path ".iris-agentic-dev.toml")) {
        $serverArgs += @("--config", (Resolve-RootPath ".iris-agentic-dev.toml"))
    }
    $envMap = @{}
    foreach ($p in $server.env.PSObject.Properties) { $envMap[$p.Name] = [string]$p.Value }
    if (($serverArgs -notcontains "--host") -and $envMap.ContainsKey("IRIS_HOST")) {
        $serverArgs += @("--host", $envMap["IRIS_HOST"])
    }
    if (($serverArgs -notcontains "--web-port") -and $envMap.ContainsKey("IRIS_WEB_PORT")) {
        $serverArgs += @("--web-port", $envMap["IRIS_WEB_PORT"])
    }
    if (($serverArgs -notcontains "--scheme") -and $envMap.ContainsKey("IRIS_SCHEME")) {
        $serverArgs += @("--scheme", $envMap["IRIS_SCHEME"])
    }
    if (($serverArgs -notcontains "--namespace") -and $envMap.ContainsKey("IRIS_NAMESPACE")) {
        $serverArgs += @("--namespace", $envMap["IRIS_NAMESPACE"])
    }
    $psi.Arguments = ($serverArgs | ForEach-Object {
        $arg = [string]$_
        if ($arg -match '[\s"]') {
            '"' + ($arg -replace '"', '\"') + '"'
        } else {
            $arg
        }
    }) -join " "
    if ($ShowMcpStart) {
        Write-Host "MCP command: $($psi.FileName)"
        Write-Host "MCP args: $($psi.Arguments)"
    }
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    foreach ($p in $server.env.PSObject.Properties) {
        Set-ProcessEnvironmentValue $psi $p.Name ([string]$p.Value)
    }

    $proc = [System.Diagnostics.Process]::Start($psi)
    $client = [pscustomobject]@{ Process = $proc; NextId = 0; Framing = $McpFraming }
    [void](Send-McpRequest $client "initialize" @{
        protocolVersion = "2024-11-05"
        capabilities = @{}
        clientInfo = @{ name = "sync-xml-print-template"; version = "1.0.0" }
    })
    Send-McpNotification $client "notifications/initialized" @{}
    return $client
}

function Stop-McpClient($Client) {
    if ($null -ne $Client -and -not $Client.Process.HasExited) {
        $Client.Process.Kill()
        $Client.Process.WaitForExit()
    }
}

function Get-McpTools($Client) {
    $result = Send-McpRequest $Client "tools/list" @{}
    return @($result.tools)
}

function Select-ObjectScriptTool($Tools, [string]$PreferredName) {
    if ($PreferredName) {
        $tool = @($Tools | Where-Object { $_.name -eq $PreferredName })[0]
        if ($null -eq $tool) { throw "ObjectScript MCP tool '$PreferredName' not found." }
        return $tool
    }
    $ranked = @($Tools | Where-Object {
        $props = @()
        if ($_.inputSchema -and ($_.inputSchema.PSObject.Properties.Name -contains "properties") -and $_.inputSchema.properties) {
            $props = @($_.inputSchema.properties.PSObject.Properties.Name)
        }
        (
            ($_.name -match 'objectscript|execute|exec|command|code|class|method|routine') -or
            ($_.description -match 'ObjectScript|execute ObjectScript|class method|IRIS command')
        ) -and
        ($_.name -notmatch 'config|status|ping|health') -and
        (
            ($props | Where-Object { $_ -in @("code", "objectscript", "script", "command", "source", "content", "text") }).Count -gt 0
        )
    })
    if ($ranked.Count -eq 0) {
        $names = ($Tools | ForEach-Object { $_.name }) -join ", "
        throw "No likely ObjectScript execution MCP tool found. Available tools: $names"
    }
    return $ranked[0]
}

function New-ObjectScriptToolArgs($Tool, [string]$Code) {
    $props = @()
    if ($Tool.inputSchema -and ($Tool.inputSchema.PSObject.Properties.Name -contains "properties") -and $Tool.inputSchema.properties) {
        $props = @($Tool.inputSchema.properties.PSObject.Properties.Name)
    }
    foreach ($name in @("code", "objectscript", "script", "command", "source", "content", "text")) {
        if ($props -contains $name) { return @{ $name = $Code } }
    }
    if ($props.Count -eq 1) { return @{ $props[0] = $Code } }
    throw "Cannot map ObjectScript code to MCP tool '$($Tool.name)' input schema. Pass -ObjectScriptToolName for a compatible code execution tool."
}

function Get-McpToolText($Result) {
    if (($Result.PSObject.Properties.Name -contains "structuredContent") -and $Result.structuredContent -and ($Result.structuredContent.PSObject.Properties.Name -contains "output")) {
        return [string]$Result.structuredContent.output
    }
    if (($Result.PSObject.Properties.Name -contains "content") -and $Result.content) {
        $text = (@($Result.content) | ForEach-Object {
            if ($_.text) { $_.text } else { $_ | ConvertTo-Json -Depth 50 -Compress }
        }) -join "`n"
        try {
            $obj = $text | ConvertFrom-Json
            if ($obj.PSObject.Properties.Name -contains "output") { return [string]$obj.output }
        } catch {}
        return $text
    }
    if (($Result.PSObject.Properties.Name -contains "structuredContent") -and $Result.structuredContent) { return ($Result.structuredContent | ConvertTo-Json -Depth 100 -Compress) }
    return ($Result | ConvertTo-Json -Depth 100 -Compress)
}

function Invoke-IrisObjectScript($Client, $Tool, [string]$Code) {
    $args = New-ObjectScriptToolArgs $Tool $Code
    if (($Tool.inputSchema.properties.PSObject.Properties.Name -contains "namespace") -and $script:IrisNamespace) {
        $args["namespace"] = $script:IrisNamespace
    }
    $result = Send-McpRequest $Client "tools/call" @{ name = $Tool.name; arguments = $args }
    return Get-McpToolText $result
}

function Test-IrisTemporarySyntaxFailure([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return ($Text -match '(?is)Execute\+[^\r\n]*<SYNTAX>')
}

function Test-IrisMcpConnection($Client, $Tools) {
    $tool = @($Tools | Where-Object { $_.name -eq "check_config" })[0]
    if ($null -eq $tool) { return }
    $result = Send-McpRequest $Client "tools/call" @{ name = $tool.name; arguments = @{} }
    $text = Get-McpToolText $result
    try {
        $cfg = $text | ConvertFrom-Json
        if (($cfg.PSObject.Properties.Name -contains "host") -and [string]::IsNullOrWhiteSpace([string]$cfg.host)) {
            throw "IRIS MCP connection is not initialized. check_config reports empty host/namespace even though .mcp.json was loaded. Run with -CheckConfig -ShowMcpStart and verify iris-agentic-dev accepts the configured connection."
        }
    } catch {
        if ($_.Exception.Message -like "IRIS MCP connection is not initialized*") { throw }
    }
}

function New-DiscoverTemplatesCode([string]$CodesDelimited) {
    return @"
set wanted="$($CodesDelimited)"
set out=[]
set id=0
for {
 set id=`$order(^User.DocCFTreatPrintMainInfoD(id))
 quit:id=""
 set data=`$get(^User.DocCFTreatPrintMainInfoD(id))
 set value=`$listget(data,28)
 set preview=`$listget(data,17)
 continue:wanted'[(";"_value_";")
 continue:preview=""
 do out.%Push(preview)
}
write out.%ToJSON()
"@
}

function New-InspectOutpatientOverviewConfigCode() {
    return @"
set out=[]
set sql="SELECT DirectoryName,Value,IsActive,PreviewXMLName,PrintMethod FROM SQLUser.DocCFTreatPrintMainInfo ORDER BY DisplayNum"
set stmt=##class(%SQL.Statement).%New()
set sc=stmt.%Prepare(sql)
if `$system.Status.IsError(sc) { write out.%ToJSON(); quit }
set rs=stmt.%Execute()
while rs.%Next() {
 set row={}
 set row.DirectoryName=rs.%Get("DirectoryName")
 set row.Value=rs.%Get("Value")
 set row.IsActive=rs.%Get("IsActive")
 set row.PreviewXMLName=rs.%Get("PreviewXMLName")
 set row.PrintMethod=rs.%Get("PrintMethod")
 do out.%Push(row)
}
write out.%ToJSON()
"@
}

function New-ExportTemplatesCode([string[]]$Names) {
    $joined = ($Names | ForEach-Object { Escape-OsString $_ }) -join ";"
    return @"
set names="$joined"
set out=[]
for i=1:1:`$length(names,";") {
 set name=`$piece(names,";",i)
 continue:name=""
 set key=" "_`$zconvert(name,"U")
 set id=`$order(^User.DHCXMLPConfigI("XPCFlagIndex",key,0))
 set rec={}
 set rec.name=name
 set rec.id=id
 if id="" {
  set rec.exists=0
  do out.%Push(rec)
  continue
 }
 set obj=##class(User.DHCXMLPConfig).%OpenId(id)
 set rec.exists=1
 try {
  set rec.XPCFlag=`$property(obj,"XPCFlag")
 } catch ex {
 }
 try {
  set rec.XPCNote1=`$property(obj,"XPCNote1")
 } catch ex {
 }
 try {
  set rec.XPCNote2=`$property(obj,"XPCNote2")
 } catch ex {
 }
 try {
  set rec.XPCLangCode=`$property(obj,"XPCLangCode")
 } catch ex {
 }
 try {
  set rec.XPCOriginFlag=`$property(obj,"XPCOriginFlag")
 } catch ex {
 }
 set text=""
 if `$isobject(obj.XPCFileData) {
  do obj.XPCFileData.Rewind()
  while 'obj.XPCFileData.AtEnd {
   set text=text_obj.XPCFileData.Read(32000)
  }
 }
 set rec.xml=text
 do out.%Push(rec)
}
write out.%ToJSON()
"@
}

function New-ApplyTemplateCodeBody([string]$SourceName, [string]$TargetName, [string]$XmlLoadCode, [bool]$OverwriteFlag, [string]$TargetLanguage, [hashtable]$LanguageDisplayMap = @{}) {
    $source = Escape-OsString $SourceName
    $target = Escape-OsString $TargetName
    $language = Escape-OsString $TargetLanguage
    $languageDisplayName = Escape-OsString (Get-LanguageDisplayName $TargetLanguage $LanguageDisplayMap)
    $overwrite = if ($OverwriteFlag) { "1" } else { "0" }
    return @"
set sourceName="$source"
set targetName="$target"
set targetLanguage="$language"
set targetLanguageDisplayName="$languageDisplayName"
set overwrite=$overwrite
set sourceId=`$order(^User.DHCXMLPConfigI("XPCFlagIndex"," "_`$zconvert(sourceName,"U"),0))
set targetId=`$order(^User.DHCXMLPConfigI("XPCFlagIndex"," "_`$zconvert(targetName,"U"),0))
set ret={}
set ret.sourceName=sourceName
set ret.targetName=targetName
set ret.sourceId=sourceId
set ret.targetId=targetId
if sourceId="" {
 set ret.status="missing-source"
 write ret.%ToJSON()
 quit
}
if targetId'="",'overwrite {
 set ret.status="exists"
 write ret.%ToJSON()
 quit
}
set source=##class(User.DHCXMLPConfig).%OpenId(sourceId)
if targetId'="" {
 set target=##class(User.DHCXMLPConfig).%OpenId(targetId)
} else {
 set target=source.%ConstructClone(1)
}
set target.XPCFlag=targetName
set sourceDesc=""
try {
set sourceDesc=`$property(source,"XPCNote1")
} catch ex {
}
set targetDesc=`$select(sourceDesc'="":sourceDesc_"("_targetLanguageDisplayName_")",1:targetName)
try {
 set `$property(target,"XPCNote1")=targetDesc
} catch ex {
}
try {
 set `$property(target,"XPCNote2")=""
} catch ex {
}
try {
 set `$property(target,"XPCLangCode")=targetLanguage
} catch ex {
}
try {
 set `$property(target,"XPCOriginFlag")=sourceName
} catch ex {
}
$XmlLoadCode
if '`$isobject(target.XPCFileData) {
 set target.XPCFileData=##class(%Stream.GlobalCharacter).%New()
}
do target.XPCFileData.Clear()
do target.XPCFileData.Write(xml)
set sc=target.%Save()
set ret.saved=`$system.Status.IsOK(sc)
set ret.status=`$select(ret.saved:"saved",1:"save-failed")
set ret.error=`$select(ret.saved:"",1:`$system.Status.GetErrorText(sc))
set ret.newId=target.%Id()
set ret.XPCNote1=targetDesc
set ret.XPCLangCode=targetLanguage
set ret.XPCOriginFlag=sourceName
write ret.%ToJSON()
"@
}

function New-ApplyTemplateCode([string]$SourceName, [string]$TargetName, [string]$XmlBase64, [bool]$OverwriteFlag, [string]$TargetLanguage, [hashtable]$LanguageDisplayMap = @{}) {
    $xmlLoadCode = 'set xml=$system.Encryption.Base64Decode("' + $XmlBase64 + '")'
    return New-ApplyTemplateCodeBody $SourceName $TargetName $xmlLoadCode $OverwriteFlag $TargetLanguage $LanguageDisplayMap
}

function New-InitializeTemplateChunksCode([string]$TaskToken) {
    $token = Escape-OsString $TaskToken
    return @"
kill ^CacheTemp("i18nXmlPrintTemplateSync","$token")
set ret={}
set ret.status="initialized"
write ret.%ToJSON()
"@
}

function New-StageTemplateChunkCode([string]$TaskToken, [int]$ChunkIndex, [string]$Chunk) {
    $token = Escape-OsString $TaskToken
    $escapedChunk = Escape-OsString $Chunk
    return @"
set ^CacheTemp("i18nXmlPrintTemplateSync","$token",$ChunkIndex)="$escapedChunk"
set ret={}
set ret.status="staged"
set ret.chunk=$ChunkIndex
write ret.%ToJSON()
"@
}

function New-CleanupTemplateChunksCode([string]$TaskToken) {
    $token = Escape-OsString $TaskToken
    return @"
kill ^CacheTemp("i18nXmlPrintTemplateSync","$token")
set ret={}
set ret.status="cleaned"
write ret.%ToJSON()
"@
}

function New-ApplyTemplateFromChunksCode([string]$SourceName, [string]$TargetName, [string]$TaskToken, [int]$ExpectedChunkCount, [bool]$OverwriteFlag, [string]$TargetLanguage, [hashtable]$LanguageDisplayMap = @{}) {
    $token = Escape-OsString $TaskToken
    $xmlLoadCode = @"
set xmlBase64=""
set chunkIndex=0
set chunkCount=0
for {
 set chunkIndex=`$order(^CacheTemp("i18nXmlPrintTemplateSync","$token",chunkIndex))
 quit:chunkIndex=""
 set chunkCount=chunkCount+1
 set xmlBase64=xmlBase64_`$get(^CacheTemp("i18nXmlPrintTemplateSync","$token",chunkIndex))
}
if chunkCount'=$ExpectedChunkCount {
 set ret.status="incomplete-staging"
 set ret.expectedChunks=$ExpectedChunkCount
 set ret.actualChunks=chunkCount
 write ret.%ToJSON()
 quit
}
set xml=`$system.Encryption.Base64Decode(xmlBase64)
"@
    return New-ApplyTemplateCodeBody $SourceName $TargetName $xmlLoadCode $OverwriteFlag $TargetLanguage $LanguageDisplayMap
}

function Invoke-ChunkedTemplateApply($Client, $Tool, [string]$SourceName, [string]$TargetName, [string]$XmlBase64, [bool]$OverwriteFlag, [string]$TargetLanguage, [hashtable]$LanguageDisplayMap = @{}, [int]$ChunkSize = 6000) {
    $taskToken = [guid]::NewGuid().ToString("N")
    $chunkCount = [int][Math]::Ceiling($XmlBase64.Length / [double]$ChunkSize)
    try {
        $initText = Invoke-IrisObjectScript $Client $Tool (New-InitializeTemplateChunksCode $taskToken)
        if (Test-IrisTemporarySyntaxFailure $initText) { throw "Chunk initialization failed with temporary ObjectScript <SYNTAX>." }

        for ($index = 0; $index -lt $chunkCount; $index++) {
            $offset = $index * $ChunkSize
            $length = [Math]::Min($ChunkSize, $XmlBase64.Length - $offset)
            $chunk = $XmlBase64.Substring($offset, $length)
            $stageText = Invoke-IrisObjectScript $Client $Tool (New-StageTemplateChunkCode $taskToken ($index + 1) $chunk)
            if (Test-IrisTemporarySyntaxFailure $stageText) {
                throw "Chunk $($index + 1)/$chunkCount failed with temporary ObjectScript <SYNTAX>."
            }
        }

        $applyText = Invoke-IrisObjectScript $Client $Tool (New-ApplyTemplateFromChunksCode $SourceName $TargetName $taskToken $chunkCount $OverwriteFlag $TargetLanguage $LanguageDisplayMap)
        if (Test-IrisTemporarySyntaxFailure $applyText) { throw "Chunked apply failed with temporary ObjectScript <SYNTAX>." }
        return $applyText
    } finally {
        try {
            $cleanupText = Invoke-IrisObjectScript $Client $Tool (New-CleanupTemplateChunksCode $taskToken)
            if (Test-IrisTemporarySyntaxFailure $cleanupText) {
                Write-Warning "Temporary XML template chunks may require manual cleanup."
            }
        } catch {
            Write-Warning "Temporary XML template chunk cleanup failed: $($_.Exception.Message)"
        }
    }
}

function Invoke-TemplateApplyWithFallback($Client, $Tool, [string]$SourceName, [string]$TargetName, [string]$XmlBase64, [bool]$OverwriteFlag, [string]$TargetLanguage, [hashtable]$LanguageDisplayMap = @{}, [int]$ChunkSize = 6000) {
    $inlineFailure = $null
    try {
        $applyText = Invoke-IrisObjectScript $Client $Tool (New-ApplyTemplateCode $SourceName $TargetName $XmlBase64 $OverwriteFlag $TargetLanguage $LanguageDisplayMap)
        if (Test-IrisTemporarySyntaxFailure $applyText) {
            $inlineFailure = $applyText
        } else {
            return [pscustomobject]@{ Json = $applyText; UsedFallback = $false }
        }
    } catch {
        if (Test-IrisTemporarySyntaxFailure $_.Exception.Message) {
            $inlineFailure = $_.Exception.Message
        } else {
            throw
        }
    }

    if ($null -ne $inlineFailure) {
        Write-Warning "Inline XML template apply hit temporary ObjectScript <SYNTAX>; switching to chunked fallback without regenerating local artifacts."
        $fallbackText = Invoke-ChunkedTemplateApply $Client $Tool $SourceName $TargetName $XmlBase64 $OverwriteFlag $TargetLanguage $LanguageDisplayMap $ChunkSize
        return [pscustomobject]@{ Json = $fallbackText; UsedFallback = $true }
    }
}

function New-TranslationManifest([array]$Exported, [string]$TargetLanguage, [string]$ReferencesDir, [string]$OutputDir) {
    $sourceFiles = @($Exported | Where-Object {
        $null -ne $_ -and $_.PSObject.Properties.Name -contains "exists" -and $_.exists -eq 1
    } | ForEach-Object {
        Join-Path $ReferencesDir "$($_.name).txt"
    })
    return [ordered]@{
        targetLanguage = $TargetLanguage
        sourceFiles = $sourceFiles
        outputDir = $OutputDir
        skill = "i18n-xml-template"
        instructions = "Use the i18n-xml-template skill to translate only defaultvalue attributes. Generate {filename}-$TargetLanguage.txt and layout outputs only when required."
    }
}

function Write-TranslationPrompt([string]$Path, $Manifest) {
    $files = ($Manifest.sourceFiles | ForEach-Object { "- `$_" }) -join "`n"
    $text = @"
Use the i18n-xml-template skill.

targetLanguage: $($Manifest.targetLanguage)
outputDir: $($Manifest.outputDir)
sourceFiles:
$files

Translate only user-visible defaultvalue attributes. Preserve XML structure, coordinates, variable placeholders, fonts, printer settings, barcodes, and encoding rules. Generate layout files and layout reports only if layout risk requires coordinate adjustment.
"@
    [System.IO.File]::WriteAllText($Path, $text, [System.Text.Encoding]::UTF8)
}

$mcpConfig = Resolve-RootPath $McpConfigPath
$refDir = Resolve-RootPath $ReferencesDir
$outDir = Resolve-RootPath $OutputDir
$languageDisplayMap = Get-I18nLanguageDisplayMap $I18nProfilePath
$mcpJson = Get-Content $mcpConfig -Raw | ConvertFrom-Json
if (-not $IrisNamespace) {
    $serverCfg = $mcpJson.mcpServers.$McpServerName
    if ($serverCfg -and $serverCfg.env -and ($serverCfg.env.PSObject.Properties.Name -contains "IRIS_NAMESPACE")) {
        $IrisNamespace = [string]$serverCfg.env.IRIS_NAMESPACE
    }
}
$script:IrisNamespace = $IrisNamespace
[System.IO.Directory]::CreateDirectory($refDir) | Out-Null
[System.IO.Directory]::CreateDirectory($outDir) | Out-Null

$client = $null
try {
    $client = Start-McpClient $mcpConfig $McpServerName
    $tools = Get-McpTools $client
    if ($ListMcpTools) {
        $tools | ForEach-Object {
            $props = @()
            if ($_.inputSchema -and ($_.inputSchema.PSObject.Properties.Name -contains "properties") -and $_.inputSchema.properties) {
                $props = @($_.inputSchema.properties.PSObject.Properties.Name)
            }
            [pscustomobject]@{
                name = $_.name
                description = $_.description
                inputProperties = ($props -join ",")
            }
        } | Format-Table -AutoSize
        return
    }
    if ($DescribeMcpTool) {
        $tool = @($tools | Where-Object { $_.name -eq $DescribeMcpTool })[0]
        if ($null -eq $tool) { throw "MCP tool '$DescribeMcpTool' not found." }
        Write-Output ($tool | ConvertTo-Json -Depth 50)
        return
    }
    if ($QuerySql) {
        $tool = @($tools | Where-Object { $_.name -eq "iris_query" })[0]
        if ($null -eq $tool) { throw "MCP tool 'iris_query' not found." }
        $args = @{ query = $QuerySql }
        if ($IrisNamespace) { $args["namespace"] = $IrisNamespace }
        $result = Send-McpRequest $client "tools/call" @{ name = $tool.name; arguments = $args }
        Write-Output (Get-McpToolText $result)
        return
    }
    if ($CheckConfig) {
        $tool = @($tools | Where-Object { $_.name -eq "check_config" })[0]
        if ($null -eq $tool) { throw "MCP tool check_config not found." }
        $result = Send-McpRequest $client "tools/call" @{ name = $tool.name; arguments = @{} }
        Write-Output (Get-McpToolText $result)
        return
    }
    $osTool = Select-ObjectScriptTool $tools $ObjectScriptToolName
    Test-IrisMcpConnection $client $tools
    Write-Host "Using MCP ObjectScript tool: $($osTool.name)"

    if ($InspectOutpatientOverviewConfig) {
        $inspectJson = Invoke-IrisObjectScript $client $osTool (New-InspectOutpatientOverviewConfigCode)
        Write-Output $inspectJson
        return
    }

    $names = @(Get-NormalizedTemplateNames $TemplateNames)
    if ($DiscoverFromPrintJson) {
        $combinedNames = @($names) + @(Get-PrintTempNamesFromJsonFile $DiscoverFromPrintJson)
        $names = @($combinedNames | Where-Object { $_ } | Select-Object -Unique)
    }
    if ($DiscoverFromConfig -or $DiscoverOutpatientOverview -or $names.Count -eq 0) {
        $codes = ";DZD;SYDO;ZSDO;ZLDO;JYDO;JCDMZ;BLDMZ;CFZ;CFD;"
        $discoverJson = Invoke-IrisObjectScript $client $osTool (New-DiscoverTemplatesCode $codes)
        $discovered = ConvertFrom-JsonArray $discoverJson
        $combinedNames = @($names) + @($discovered)
        $names = @($combinedNames | Where-Object { $_ } | Select-Object -Unique)
    }
    if ($names.Count -eq 0) { throw "No template names supplied or discovered." }

    if ($VerifyOnly) {
        $targetNames = @($names | ForEach-Object { "$_-$TargetLanguage" })
        $verifyNames = @($names + $targetNames)
        $verifyNames = @($verifyNames | Select-Object -Unique)
        $records = @()
        foreach ($verifyName in $verifyNames) {
            $verifyJson = Invoke-IrisObjectScript $client $osTool (New-ExportTemplatesCode @($verifyName))
            if ($TraceIrisOutput) {
                Write-Host "Raw verify output for ${verifyName}:"
                Write-Host $verifyJson
            }
            $records += @(ConvertFrom-JsonArray $verifyJson)
        }
        $records = @($records | Where-Object {
            $null -ne $_ -and $_.PSObject.Properties.Name -contains "name"
        })
        $report = foreach ($name in $names) {
            $targetName = "$name-$TargetLanguage"
            $source = $records | Where-Object { $_.name -eq $name } | Select-Object -First 1
            $target = $records | Where-Object { $_.name -eq $targetName } | Select-Object -First 1
            [pscustomobject]@{
                SourceTemplate = $name
                SourceExists = [bool]($source -and $source.exists -eq 1)
                SourceId = Get-ObjectPropertyValue $source "id"
                TargetTemplate = $targetName
                TargetExists = [bool]($target -and $target.exists -eq 1)
                TargetId = Get-ObjectPropertyValue $target "id"
                TargetNote1 = Get-ObjectPropertyValue $target "XPCNote1"
                TargetLangCode = Get-ObjectPropertyValue $target "XPCLangCode"
                TargetOriginFlag = Get-ObjectPropertyValue $target "XPCOriginFlag"
                TargetChineseDefaultCount = if ($target -and $target.exists -eq 1) { Get-ChineseDefaultValueCount ([string](Get-ObjectPropertyValue $target "xml")) } else { $null }
            }
        }
        Write-Output ($report | ConvertTo-Json -Depth 10)
        return
    }

    $exportJson = Invoke-IrisObjectScript $client $osTool (New-ExportTemplatesCode $names)
    if ($TraceIrisOutput) {
        Write-Host "Raw export output:"
        Write-Host $exportJson
    }
    $exported = ConvertFrom-JsonArray $exportJson

    foreach ($rec in $exported) {
        if ($rec.exists -ne 1) {
            Write-Warning "Template not found on server: $($rec.name)"
            continue
        }
        $xml = [string]$rec.xml
        Assert-XmlParseable $xml $rec.name
        $path = Join-Path $refDir "$($rec.name).txt"
        Write-XmlTextFile $path $xml
        Write-Host "Exported $($rec.name) -> $path"
    }

    $manifest = New-TranslationManifest $exported $TargetLanguage $refDir $outDir
    $manifestPath = Join-Path $outDir "sync-xml-print-template-manifest.json"
    $promptPath = Join-Path $outDir "sync-xml-print-template-prompt.md"
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), [System.Text.Encoding]::UTF8)
    Write-TranslationPrompt $promptPath $manifest
    Write-Host "Wrote translation manifest: $manifestPath"
    Write-Host "Wrote Codex prompt: $promptPath"

    if (-not $Apply) {
        Write-Host "Dry run complete. Generate translated files in $outDir, then rerun with -Apply."
        return
    }

    foreach ($rec in $exported) {
        if ($rec.exists -ne 1) { continue }
        $targetName = "$($rec.name)-$TargetLanguage"
        $layoutPath = Join-Path $outDir "$targetName-layout.txt"
        $standardPath = Join-Path $outDir "$targetName.txt"
        $translatedPath = if (Test-Path $layoutPath) { $layoutPath } else { $standardPath }
        if (-not (Test-Path $translatedPath)) {
            Write-Warning "Translated file missing, skip apply: $translatedPath"
            continue
        }
        $translatedXml = Read-XmlTextFile $translatedPath
        Assert-XmlParseable $translatedXml $targetName
        $xmlBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($translatedXml))

        if ($Overwrite) {
            $backupDir = Join-Path $outDir "backups"
            [System.IO.Directory]::CreateDirectory($backupDir) | Out-Null
            $existingJson = Invoke-IrisObjectScript $client $osTool (New-ExportTemplatesCode @($targetName))
            $existing = @($existingJson | ConvertFrom-Json)[0]
            if ($existing.exists -eq 1) {
                $existingXml = [string]$existing.xml
                Write-XmlTextFile (Join-Path $backupDir "$targetName.$(Get-Date -Format yyyyMMddHHmmss).txt") $existingXml
            }
        }

        $applyOutcome = Invoke-TemplateApplyWithFallback $client $osTool $rec.name $targetName $xmlBase64 ([bool]$Overwrite) $TargetLanguage $languageDisplayMap $ApplyChunkSize
        $applyResult = $applyOutcome.Json | ConvertFrom-Json
        Write-Host "Apply $($rec.name) -> $targetName : $($applyResult.status)"
        if ($applyResult.status -notin @("saved", "exists")) {
            $errorText = if ($applyResult.PSObject.Properties.Name -contains "error") { [string]$applyResult.error } else { [string]$applyResult.status }
            throw "Apply failed for $targetName`: $errorText"
        }

        if ($applyOutcome.UsedFallback -and $applyResult.status -eq "saved") {
            $verifyJson = Invoke-IrisObjectScript $client $osTool (New-ExportTemplatesCode @($targetName))
            $verified = @(ConvertFrom-JsonArray $verifyJson)[0]
            if ($null -eq $verified -or $verified.exists -ne 1) { throw "Fallback verification could not read target template: $targetName" }
            if ([string](Get-ObjectPropertyValue $verified "XPCLangCode") -ne $TargetLanguage) { throw "Fallback verification found unexpected XPCLangCode for $targetName." }
            if ([string](Get-ObjectPropertyValue $verified "XPCOriginFlag") -ne [string]$rec.name) { throw "Fallback verification found unexpected XPCOriginFlag for $targetName." }
            $verifiedXml = [string](Get-ObjectPropertyValue $verified "xml")
            Assert-XmlParseable $verifiedXml $targetName
            $residueCount = Get-ChineseDefaultValueCount $verifiedXml
            Write-Host "Fallback verification $targetName : XML parseable, Chinese defaultvalue residue=$residueCount"
        }
    }
} finally {
    Stop-McpClient $client
    if ($script:ProjectRootPushed) { Pop-Location }
}
