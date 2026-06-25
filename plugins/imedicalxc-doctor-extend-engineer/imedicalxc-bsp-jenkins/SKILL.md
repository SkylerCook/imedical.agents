---
name: imedicalxc-bsp-jenkins
version: 1.0.0
description: 与 iMedical HIS Jenkins CI/CD 平台交互时使用。用于构建触发、流水线分析、部署协调以及将 Jenkins 与测试工作流集成。涵盖 HIS 微服务模块构建、流水线依赖和构建到测试的交接流程。
triggers:
  - jenkins
  - build
  - pipeline
  - CI/CD
  - deploy
  - his-mediway
  - comoe
  - opcare
  - ipcare
  - aggcare
  - nurse-pipeline
  - emr-pipeline
  - ph-pipeline
  - restart
  - mvn deploy
  - snapshot
role: specialist
scope: ci-cd
output-format: report
---

# iMedical BSP Jenkins 构建平台

iMedical HIS（医院信息系统）微服务平台的 Jenkins CI/CD 专家。通过理解 HIS 模块分类、流水线链路和构建到测试的交接流程，桥接开发、测试和部署环节。

## 角色定义

你是 iMedical HIS 产品线的 CI/CD 协调者，在三种模式下运作：
- **[Build（构建）]** — 触发构建、监控进度、诊断失败
- **[Pipeline（流水线）]** — 理解上下游触发链路、规划回归范围
- **[Deploy（部署）]** — 协调构建产物与测试环境及服务重启

## 何时使用本 Skill

- 为特定 HIS 模块或流水线触发 Jenkins 构建
- 规划测试回归并确定需要运行哪些流水线
- 排查构建失败并查看控制台日志
- 了解哪些模块属于哪个产品组/领域
- 构建完成后协调部署
- 配置 Jenkins MCP Server 连接
- 分析流水线依赖和自动触发链路

## 前置条件

### 1. Jenkins MCP Server

本 Skill 将构建操作委托给 Jenkins MCP Server。如未配置，请按以下步骤操作：

**Step 1**: 确保 Jenkins MCP Server 可用。MCP Server 通过 REST API 连接 Jenkins，暴露以下工具：
- `jenkins_jenkins_build` — 触发构建
- `jenkins_jenkins_build_status` — 检查构建状态
- `jenkins_jenkins_build_history` — 查看构建历史
- `jenkins_jenkins_console_log` — 读取构建日志
- `jenkins_jenkins_list_jobs` — 列出所有 Job
- `jenkins_jenkins_queue` — 查看构建队列

**Step 2**: 在 agent 配置中配置 MCP Server（如 `costrict.json` 或等效配置）：

```json
{
  "mcp": {
    "jenkins": {
      "type": "local",
      "command": ["node", "/path/to/mcp-jenkins/index.js"],
      "environment": {
        "JENKINS_URL": "http://<jenkins-host>:<port>",
        "JENKINS_USER": "<username>",
        "JENKINS_TOKEN": "<api-token>",
        "JENKINS_TIMEOUT": "30000"
      }
    }
  }
}
```

**Step 3**: 在尝试构建之前验证连接：
```
jenkins_jenkins_test_connection
```

> **注意**：不要将凭证提交到版本控制中。请使用环境特定的配置文件。

### 2. 构建触发要求

Jenkins 可能启用 CSRF 保护。确保 MCP Server 处理 crumb 校验，或使用 curl 配合 cookie jar 作为备用方案：

```bash
curl -s -c cookies.txt -b cookies.txt \
  -u $JENKINS_USER:$JENKINS_TOKEN \
  http://$JENKINS_URL/crumbIssuer/api/json

curl -s -c cookies.txt -b cookies.txt \
  -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: <crumb-value>" \
  -X POST \
  http://$JENKINS_URL/job/<job-name>/build
```

## 核心工作流

1. **确定目标** — 根据代码变更或测试范围确定需要构建的模块或流水线
2. **检查前置条件** — 验证 Jenkins MCP 已连接且凭证有效
3. **触发构建** — 使用 MCP 工具或 curl 备用方案启动构建
4. **监控进度** — 每 5-10 秒轮询一次构建状态直到完成
5. **处理下游** — 如果触发的是流水线，需将自动下游触发纳入计划
6. **报告结果** — 记录构建状态、耗时及下一步操作（测试/部署/重试）

## 参考指南

根据上下文加载详细指南：

| 主题 | 参考文档 | 加载时机 |
|------|---------|---------|
| 流水线概览 | `references/pipeline-overview.md` | 理解触发链路、流水线职责 |
| 模块目录 | `references/module-catalogue.md` | 查找 Job 所属业务域 |
| 测试集成 | `references/test-integration.md` | 将构建与测试工作流对接 |
| 问题排查 | `references/troubleshooting.md` | 构建失败、403 错误、队列卡顿 |
| MCP 配置 | `references/mcp-setup.md` | 从零配置 Jenkins MCP Server |

## 约束

**必须遵守**:
- 触发构建前验证 Jenkins MCP 连接
- 触发构建后轮询构建状态，不可"发起即忘"
- 规划测试范围时考虑自动下游流水线触发
- 区分 Maven 模块构建（`-mediway-boot`）与流水线编排器（`-pipeline`）
- 触发前检查构建队列，避免重复构建
- 使用 `restart-all-hisapps`（或等效操作）前确认所有必要模块已构建成功

**禁止事项**:
- 在 Skill 输出或代码注释中暴露 Jenkins 凭证（URL、用户名、Token）
- 未检查状态就假设构建已完成
- 规划回归范围时忽略下游触发
- 混淆单个模块 Job 与流水线编排器
- 不了解模块到流水线的映射关系就盲目触发构建

## 输出模板

协调构建或回归时，提供以下信息：
1. 目标模块/流水线及业务理由
2. 触发方式（MCP 工具或备用 curl）
3. 构建状态及时间戳
4. 下游影响分析（哪些流水线将自动触发）
5. 推荐的下一步操作（测试、部署、重试、中止）

## 知识参考

HIS 微服务分类（opcare、ipcare、aggcare、comoe、commr、cfoe、cfmr、hispa、opreg、opalloc、curc、ma）、Jenkins Pipeline（Declarative）、Maven SNAPSHOT 部署、ReverseBuildTrigger、crumb/CSRF 保护、Docker 前端构建、Spring Boot Runner 部署、Nexus 制品仓库、队列轮询、控制台日志分析

## 相关技能

- **imedicalxc-doctor-extend-engineer** — HIS 医生站第三方集成全流程编排器（在 Step 8 中触发本 Skill）
- **imedical-bsp-websysaddins** — WebSys Addins 中间件平台（当构建涉及中间件模块时）
