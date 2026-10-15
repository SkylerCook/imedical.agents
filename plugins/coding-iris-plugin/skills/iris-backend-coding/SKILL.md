---
name: iris-backend-coding
description: Use when working on IRIS ObjectScript backend code with coding-iris-plugin backend rules and the target project's profile.
---

# IRIS Backend Coding

编写 `.cls` 前读取[CLS 命名与格式规范](../../references/cls-coding-format.md)，最终 diff 后按同一规范检查。新类使用规范模板；已有类只规范本次新增代码，不格式化被功能需求修改的原有代码。可选本地自检不阻断提交，不要求上传、回读或编译证据。

## 使用时机

当任务涉及 IRIS ObjectScript、`.cls`、BLH/DATA/SQL、Broker、Query、SQL 写入层或后端 MCP 编译验证时使用本 Skill。

## 路由与默认方法

执行路径统一由 rules/iris_coding_general.md 判定；guidanceMode 按共享 execution-guidance 协议解析。步骤可合并、重排，硬约束不变；不因文件数自动升级、不因 full/guarded 自动建 run。

## 部署方式

日常开发部署默认 direct，不要求需求号或 Git 基线会话；已有修改不触发基线确认。仅在用户或项目要求 guarded 时，在第一次修改前读取[建立会话要求](../../references/deployment-protection.md#建立会话)。完整模式与保护范围见[部署契约](../../references/deployment-protection.md)。上传、编译仍需明确授权。

## 流程

1. 先读取目标工程 `.agents/config/iris_project_profile.md`。
2. 再读取 `rules/iris_coding_index.md`、`rules/iris_coding_general.md`、`rules/iris_coding_backend.md`。
3. 仅当任务涉及上传、编译、远程读取或只读 SQL 时，再读取 `.mcp.json` 和 `rules/iris_coding_workflow.md`。
4. 本地搜索现有实现和同类代码，复用业务实现与接口契约；命名与格式按 CLS 规范的适用顺序执行，不从历史代码推断默认风格。
5. 按 BLH/DATA/SQL 职责分层修改，不把项目专属类名写回插件规则。
6. 默认只做本地修改；用户明确要求后再上传或编译。

## 完成检查

按实际改动选择验收层级：内部方法直接验证，对外 Broker/REST/SOAP 经真实入口验证，写入增加独立回读；纯后端不强制走前端。返回契约影响前端消费者时补受影响页面。Broker 机器调用与授权/证据边界见 [分层验收接入](../../../../docs/night-acceptance.md)。

- 最终 diff 已按 CLS 规范检查命名、格式、改动范围和兼容性；脚本检查与 Agent 审查结果分别说明。
- 调用独立 review-agent 时传入冻结 diff、需求、范围、项目显式规范和 CLS 规范路径；不要求额外安装 formatter skill，无子 Agent 时按同一清单串行复核。
- SQL 写入层返回格式稳定。
- 参数校验避免 `<UNDEFINED>`。
- 未引入源工程硬编码服务器、namespace 或业务前缀。
