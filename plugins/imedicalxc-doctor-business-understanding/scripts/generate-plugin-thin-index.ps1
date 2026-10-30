# imedicalxc-doctor-business-understanding/tests/generate-plugin-thin-index.ps1
# Thin-index generation script for imedicalxc-doctor-business-understanding plugin.
# This script is a wrapper around the canonical generate-vendor-thin-index.ps1 script.

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$AgentsRoot,

    [ValidateSet("DryRun","Write")]
    [string]$Mode = "DryRun"
)

$ErrorActionPreference = "Stop"

$pluginRoot = Join-Path $AgentsRoot "plugins" "imedicalxc-doctor-business-understanding"
$outputDir = Join-Path $AgentsRoot "skills"

# Define thin-index entries for this plugin
$entries = @(
    @{
        SourceFile = Join-Path $pluginRoot "skills" "imedicalxc-doctor-business-understanding" "SKILL.md"
        OutputDir = Join-Path $outputDir "imedicalxc-doctor-business-understanding"
        Name = "imedicalxc-doctor-business-understanding"
    }
)

# Write thin-indices
foreach ($entry in $entries) {
    if (-not (Test-Path $entry.SourceFile)) {
        Write-Warning "Source not found: $($entry.SourceFile)"
        continue
    }

    $outputFile = Join-Path $entry.OutputDir "SKILL.md"
    if (-not (Test-Path $entry.OutputDir)) {
        if ($Mode -eq "Write") {
            New-Item -ItemType Directory -Path $entry.OutputDir -Force | Out-Null
        } else {
            Write-Host "[DryRun] Would create directory: $($entry.OutputDir)" -ForegroundColor Yellow
        }
    }

    if ($Mode -eq "Write") {
        @"
---
name: $($entry.Name)
description: |
  HIS 医生站业务实现理解与变更影响分析。从前端UI入口定位 -> 前端逻辑追踪 -> 后端调用链追溯 -> 业务实现方法罗列 -> 变更影响评估 -> 跨业务依赖分析 -> 结论输出。
  Use when 需要理解一个HIS业务流程的前后端完整实现链路，或评估一项需求变更对当前工程实现的影响范围和改造方案。
thin-index: true
source: $((Resolve-Path -RelativePath $entry.SourceFile -RelativeToBase $AgentsRoot).Replace('\','/'))
---

# 薄索引：$($entry.Name)

本文件是 thin-index / 薄索引，不包含完整 skill。

Agent 指令：读取本文件后，必须继续读取并遵循插件内真实 skill：

- `$((Resolve-Path -RelativePath $entry.SourceFile -RelativeToBase $AgentsRoot).Replace('\','/'))`

如任务涉及项目差异或服务器能力，还需要读取：

- `.agents/config/`
- `.mcp.json`

不要把 MCP 连接信息复制到本文件。
"@ | Out-File -FilePath $outputFile -Encoding utf8 -Force

        Write-Host "[Write] $outputFile" -ForegroundColor Green
    } else {
        Write-Host "[DryRun] Would generate: $outputFile" -ForegroundColor Yellow
        Write-Host "[DryRun]   Source: $($entry.SourceFile)" -ForegroundColor Gray
    }
}

Write-Host "Done."
