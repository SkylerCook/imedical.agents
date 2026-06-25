# 测试集成

## 与测试环节打通指南

### 场景 1：开发提交代码后触发构建

1. 开发人员 push 代码到 Git 仓库
2. 对应的 **Pipeline** 自动/手动触发构建
3. 构建成功后，Maven SNAPSHOT 版本自动更新到 Nexus
4. 测试人员通知运维或使用 `restart-all-hisapps` 重启服务端加载新包
5. 前端构建成功后，Nginx/Docker 自动刷新静态资源

### 场景 2：测试回归指定产品组

**单模块快速验证**：
```
触发单个 Maven Job（如 comoe-mediway）
    └─ 仅构建该模块，deploy 到 Nexus
    └─ 如需验证，手动重启服务加载新包
```

**医生站完整回归**（按自动触发链执行）：
```
触发 doctor-pipeline
    ├─ 构建：comoe-mediway、commr-mediway、cfoe-mediway、cfmr-mediway
    ├─ 构建：opcare-mediway-boot、ipcare-mediway-boot、aggcare-mediway-boot
    ├─ 构建：opalloc-mediway-boot、ma-mediway-boot、opreg-mediway-boot
    ├─ 构建：hispa-mediway-boot、curc-mediway-boot
    └─ [SUCCESS] 自动触发 nurse-pipeline（护理组）
           └─ [SUCCESS] 自动触发 emr-pipeline（电子病历）
                  └─ [SUCCESS] 自动触发 emersys-pipeline（急诊）
                         └─ [SUCCESS] 自动触发 ph-pipeline（药房）
                                └─ [SUCCESS] 自动触发 other-Pipeline（其他）
```

> 注意：doctor-pipeline 的触发链会一路连锁触发到 other-Pipeline，若只想验证医生站本身，可以只触发 doctor-pipeline 并在 nurse-pipeline 执行前停止。

**基础框架变更后全量回归**：
```
触发 base-pipeline
    └─ [FAILURE/SUCCESS] 自动触发 common-pipeline
           └─ [SUCCESS] 自动触发 ar_Pipeline
                  └─ [FAILURE/SUCCESS] 自动触发 msup-pipeline
                         └─ [SUCCESS] 自动触发 doctor-pipeline
                                └─ [SUCCESS] 自动触发 nurse-pipeline
                                       └─ ...（继续触发到 other-Pipeline）
```

> 全量回归总时长预估：约 80-100 分钟。
>
> 由于 `base→common` 和 `ar→msup` 配置了 FAILURE threshold，即使中间某个流水线失败，后续仍会尝试执行。

### 场景 3：快速重启测试环境

若仅需加载最新已构建的 SNAPSHOT 包，**无需重新打包**，直接执行：
- Job: `restart-all-hisapps`
- 作用：SSH 到服务器执行 `shutdown.sh` + `startup.sh`
- 耗时：约 3-5 分钟

### 场景 4：定位某模块的构建历史

使用 `jenkins_jenkins_build_history` 查询最近构建记录，结合 `jenkins_jenkins_console_log` 查看失败原因。常用排查方向：
- Maven 依赖下载失败（检查 Nexus 网络）
- 编译错误（代码问题）
- 单元测试失败（测试代码问题，目前多数模块 `No tests to run`）

### 场景 5：触发构建并轮询进度

**Step 1**: 触发构建
```
jenkins_jenkins_build name="comoe-mediway"
```

**Step 2**: 获取构建号（从队列或最近历史）
```
jenkins_jenkins_build_history name="comoe-mediway" limit=1
jenkins_jenkins_queue
```

**Step 3**: 轮询直到完成
```
jenkins_jenkins_build_status name="comoe-mediway"
```

轮询频率建议每 5-10 秒一次，超时阈值根据 `estimatedDuration` 设定。

**PowerShell 轮询示例**：
```powershell
for ($i = 1; $i -le 30; $i++) {
    $t = Get-Date -Format 'HH:mm:ss'
    # 使用 MCP 工具或 curl 检查状态
    $status = jenkins_jenkins_build_status name="comoe-mediway"
    if ($status.building -eq $false) {
        Write-Host "[$t] FINISHED => $($status.result) in $($status.duration)ms"
        break
    } else {
        Write-Host "[$t] BUILDING ... ($i/30)"
    }
    Start-Sleep -Seconds 5
}
```
