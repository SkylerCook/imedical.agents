# iMedicalXC Doctor Business Understanding

`imedicalxc-doctor-business-understanding` 是 HIS 医生站业务实现理解与变更影响分析插件，覆盖从前端UI入口追踪到后端数据库的完整调用链分析，及多方案变更影响评估工作流。

## 插件定位

- 承载业务实现理解与变更影响评估的可复用方法论和搜索策略。
- 目标工程差异、连接信息、敏感配置必须写入目标工程本地文件，不硬编码在插件中。
- 分析器本身不包含 HIS 领域规则，所有领域知识按需从目标工程本地规则加载。

## 使用约束

- 不在插件中硬编码服务器地址、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。
- 涉及项目差异时读取目标工程 `.agents/config/` 下的 project profile。
- 默认只做本地查询、分析报告；上传、编译、远程写入、数据库变更必须由用户明确要求。

## Skill 路由

- 核心分析工作流：`skills/imedicalxc-doctor-business-understanding/SKILL.md`

## Thin-Index 暴露范围

本插件仅暴露 `imedicalxc-doctor-business-understanding` 核心 skill 入口。

## 依赖的 Vendor 资产

本插件依赖以下 vendor 资产，部署时需确保它们存在于 `.agents/vendor/`：

- `vendor/superpowers/`：提供 `verification-before-completion` 等流程 skill。

## 引用说明

本插件的业务实现探索方法论参考自番薯(AI编码辅助)的企业工程实践文章（腾讯云开发者社区，文章 ID: 2676110），其从前端界面入口到后端数据的跨层调用链追踪策略与 Phase 1-3 的追溯流程一致。
