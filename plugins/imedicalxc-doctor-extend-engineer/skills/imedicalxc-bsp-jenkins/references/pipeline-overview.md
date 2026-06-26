# 流水线概览

## 构建类型说明

Jenkins 上存在三种主要的 Job 类型：

| 类型 | 标识特征 | 用途 |
|------|---------|------|
| **Pipeline 流水线** | `_class: WorkflowRun`，名称含 `-pipeline` / `Pipeline` / `流水线` | 按产品组编排的多模块串联构建，自动触发下游 |
| **Maven 模块构建** | `_class: MavenModuleSetBuild`，名称含 `-mediway-boot` / `-mediway` | 单个微服务/模块的 Maven 构建，deploy 到私服 |
| **Freestyle 自由风格** | `_class: FreeStyleBuild`，如 hisfront、restart-all-hisapps | 前端打包、脚本执行、环境运维等特殊任务 |

## 核心流水线自动触发链

各流水线之间通过 Jenkins **ReverseBuildTrigger**（反向构建触发器）配置自动触发关系。

> **触发规则说明**：Jenkins 的 `ReverseBuildTrigger` 配置在下游 Job 的 `config.xml` 中，通过 `upstreamProjects` 和 `threshold` 控制。
> - `SUCCESS`：仅上游构建成功时触发下游
> - `FAILURE`：上游构建失败时也会触发下游

### 完整触发链（从 config.xml 解析）

```
base-pipeline (手动触发为主)
    └── [FAILURE threshold] ──► common-pipeline (公共模块)
                                   └── [SUCCESS] ──► ar_Pipeline (收费组)
                                                        └── [FAILURE] ──► msup-pipeline (物资供应)
                                                                             └── [SUCCESS] ──► doctor-pipeline (医生站)
                                                                                                  └── [SUCCESS] ──► nurse-pipeline (护理组)
                                                                                                                       └── [SUCCESS] ──► emr-pipeline (电子病历)
                                                                                                                                            └── [SUCCESS] ──► emersys-pipeline (急诊系统)
                                                                                                                                                                 └── [SUCCESS] ──► ph-pipeline (药房组)
                                                                                                                                                                                      └── [SUCCESS] ──► other-Pipeline (其他)
```

**废弃触发**：
- `insu-province-client-流水线` ←── [FAILURE] `ar_流水线`（`ar_流水线` 状态为 `aborted`，已废弃）

### 触发链关键说明

1. **base-pipeline 是起点**：以手动触发为主，是整个触发链的源头。
2. **FAILURE 触发点**：`base→common` 和 `ar→msup` 配置了 FAILURE threshold，即使上游构建失败，下游仍会被触发。
3. **全量回归预估时长**：约 80-100 分钟（base 12min + common 9min + ar 10min + msup 8min + doctor 14min + nurse 12min + emr 6min + emersys 8min + ph 4min + other 9min）。

### 各流水线构建范围（从 Groovy 脚本提取）

| 流水线 | 实际构建的模块 | 典型时长 |
|--------|---------------|---------|
| `base-pipeline` | his-mediway-parent、hisbase-mediway、hiscore-mediway-boot、hisbasesv-mediway、hissyscf-mediway-boot | ~12 min |
| `common-pipeline` | hissyscf-emr-common、hissyscf-emr-support 等公共模块 | ~9 min |
| `ar_Pipeline` | ar-mediway-boot 及收费相关 | ~10 min |
| `msup-pipeline` | 物资供应相关 | ~8 min |
| `doctor-pipeline` | comoe-mediway、commr-mediway、cfoe-mediway、cfmr-mediway、opcare-mediway-boot、ipcare-mediway-boot、aggcare-mediway-boot、opalloc-mediway-boot、ma-mediway-boot、opreg-mediway-boot、hispa-mediway-boot、curc-mediway-boot | ~14 min |
| `nurse-pipeline` | comnur-mediway、ipbmc-mediway-boot、ipnemr-mediway-boot、ipnur-mediway-boot | ~12 min |
| `emr-pipeline` | cfemr-mediway、comemr-mediway、emrdata-mediway-boot、hisca-mediway-boot、hosca-mediway-boot、ipemr-mediway-boot、opemr-mediway-boot、ememr-mediway-boot | ~6 min |
| `emersys-pipeline` | emcare、ememr、emnur、emsd、ekg 等急诊模块 | ~8 min |
| `ph-pipeline` | phop、phip、phm、phkm、phherb、phpiva 等药房模块 | ~4 min |
| `other-Pipeline` | ma、cpw、curc、opalloc 等未归类模块 | ~9 min |

### 各流水线职责速查

| 流水线 | 负责模块范围 | 上游触发源 | 触发阈值 | 自动下游触发 |
|--------|-------------|-----------|---------|-------------|
| `base-pipeline` | 基础框架 | 手动 | - | `common-pipeline` |
| `common-pipeline` | 公共核心 | `base-pipeline` | FAILURE | `ar_Pipeline` |
| `ar_Pipeline` | 收费组 | `common-pipeline` | SUCCESS | `msup-pipeline` |
| `msup-pipeline` | 物资供应 | `ar_Pipeline` | FAILURE | `doctor-pipeline` |
| `doctor-pipeline` | 医生站核心 | `msup-pipeline` | SUCCESS | `nurse-pipeline` |
| `nurse-pipeline` | 护理模块 | `doctor-pipeline` | SUCCESS | `emr-pipeline` |
| `emr-pipeline` | 电子病历 | `nurse-pipeline` | SUCCESS | `emersys-pipeline` |
| `emersys-pipeline` | 急诊模块 | `emr-pipeline` | SUCCESS | `ph-pipeline` |
| `ph-pipeline` | 药房模块 | `emersys-pipeline` | SUCCESS | `other-Pipeline` |
| `other-Pipeline` | 其他模块 | `ph-pipeline` | SUCCESS | 无（链尾） |
