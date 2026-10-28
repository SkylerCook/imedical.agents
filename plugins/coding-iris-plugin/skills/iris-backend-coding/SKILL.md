---
name: iris-backend-coding
description: Use when working on IRIS ObjectScript backend code with coding-iris-plugin backend rules and the target project's profile.
---

# IRIS Backend Coding

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

开发方式先读取当前 ContextRoot 的 `config/iris-development.json`。`developmentMode: offline` 时按[离线开发协议](../../references/iris-offline-development.md)处理当前源码或完整 XML，完成本地检查和 Review 后交付用户现场验证；不要求连接、资格或服务器元数据，不调用原生 IRIS MCP。下文服务器同步只适用于 `connected`（含旧配置缺省）；非法值停止核对。

编写 `.cls` 前读取[CLS 命名与格式规范](../../references/cls-coding-format.md)，最终 diff 后按同一规范检查。新类参考规范模板，并按后端规则完成基类选择与项目适配；已有类只规范本次新增代码，不格式化被功能需求修改的原有代码。可选本地自检不阻断提交，不要求上传、回读或编译证据。

## 使用时机

当任务涉及 IRIS ObjectScript、`.cls`、BLH/DATA/SQL、Broker、Query、SQL 写入层或后端 MCP 编译验证时使用本 Skill。

## 路由与默认方法

执行路径统一由 rules/iris_coding_general.md 判定；guidanceMode 按共享 execution-guidance 协议解析。步骤可合并、重排，硬约束不变；不因文件数自动升级、不因 full/guarded 自动建 run。

## 部署方式

已确认 `project` 需求且 `contextMode: intent-first-on-demand-export` 时，修改前先读[项目开发协议](../../references/project-demand-development.md)，执行需求基线、现场保护及部署前同步复审；不以本地已有文件判断服务器最新。标版沿既有分支，不能从 contextMode 推导需求类型。

其它工程日常开发部署默认 direct，不要求需求号或 Git 基线会话；已有修改不触发基线确认。仅在用户或项目要求 guarded 时，在第一次修改前读取[建立会话要求](../../references/deployment-protection.md#建立会话)。完整模式与保护范围见[部署契约](../../references/deployment-protection.md)。上传、编译仍需明确授权。

## 流程

1. 先读取目标工程 `.agents/config/iris_project_profile.md`。
2. 再读取 `rules/iris_coding_index.md`、`rules/iris_coding_general.md`、`rules/iris_coding_backend.md`。
3. 仅当任务涉及上传、编译、远程读取或只读 SQL 时，再读取 `.mcp.json` 和 `rules/iris_coding_workflow.md`。
4. 本地搜索现有实现和同类代码，复用业务实现与接口契约；命名与格式按 CLS 规范的适用顺序执行，不从历史代码推断默认风格。
5. 新建类先完成[后端规则的基类核对](../../rules/iris_coding_backend.md#三层架构)，再适配模板的 `Extends`；按实际职责分层修改，不把项目专属类名写回通用规则。
6. 默认只做本地修改；用户明确要求后再上传或编译。

## 完成检查

按实际改动选择验收层级：内部方法直接验证，对外 Broker/REST/SOAP 经真实入口验证，写入增加独立回读；纯后端不强制走前端。返回契约影响前端消费者时补受影响页面。Broker 机器调用与授权/证据边界见 [分层验收接入](../../../../docs/night-acceptance.md)。

- 最终 diff 已按 CLS 规范检查命名、格式、改动范围和兼容性；脚本检查与 Agent 审查结果分别说明。
- 对本次新增注册类/非表模型、表类、成员及变量，按 [ObjectScript 注释约定](../../references/cls-coding-format.md#注释与空行) 核对适用标签、参数/返回契约、结构引用和自然语言说明；SQL 投影或返回结构不明时报告缺口，Debug 仅作为文档内容，不自动编译、调试或改写历史注释。
- 调用独立 review-agent 时传入冻结 diff、需求、范围、项目显式规范和 CLS 规范路径；新增类附基类选择及 profile/源码依据，按共用清单审查继承。不要求额外安装 formatter skill，无子 Agent 时按同一清单串行复核。
- SQL 写入层返回格式稳定。
- 参数校验避免 `<UNDEFINED>`。
- 未引入源工程硬编码服务器、namespace 或业务前缀。
