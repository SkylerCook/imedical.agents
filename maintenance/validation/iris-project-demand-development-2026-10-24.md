# IRIS 项目开发链路验证（2026-10-24）

本轮只修改能力包。实际环境为 Windows、Node.js 24.14.1；隔离 Git、合成工作区和本机 HTTP mock 不连接业务服务器，不初始化业务仓，不暂存、提交或推送框架代码。

## 实现与分支

完整运行契约归 [项目开发协议](../../plugins/coding-iris-plugin/references/project-demand-development.md)。`standard/project`、源码 contextMode、taskKind、执行路径与授权独立；skill、rule、IRIS agent 和 workflow 复用公共机制并条件加载项目分支。测试／正式各自使用本地 Git；无变化不产生 export／空提交，回滚追加新提交。

source-sync 与 promotion 共用提交事务、仓库锁及恢复；服务器内容先落私有 staging，export 与逐需求重放分开。冻结发布身份包含完整 index 条目及 flags；生产批准、覆盖决定和恢复 token 不互代。混合发布最后统一回读；Storage 收尾重新核验，只提交已核验部分，不再次部署。

## 本机证据

| 范围 | 实际结果 | 覆盖 |
|---|---|---|
| source-sync | 全项 25/25；随后新增声明身份核验及读取恢复 2/2 定向 | 纯 export、无变化、三方合并、foreign index／新文件、私有冲突、两环境 Git、追加回滚、逐需求重放、Storage／混合收尾、类型不推断 |
| 提交事务 | 7/7 | pre/post CAS、真实 hooks、五类提交归属、index 意图前后恢复、rollback 双故障恢复、后端 Git clean 规范化与前端字节保护 |
| promotion | 全项 30/30；最后 legacy／类型门禁 2/2 定向（当前 31 个用例，未冒称 31 项全量） | 来源／等价／语义选源、partial supersession 拦截、未部署层、独立需求边界、持久断点、共享事务及 review／verify 接口 |
| 部署 | 原六 suite 70/70；分支／事务／CSP 组合 27/27 | direct 旁路、独立生产批准、批准失效、未知结果、混合分组最终回读和漂移、Storage 回执 |
| index 与 Storage 最终补测 | 16/16（有意按 test-name-pattern 选择，非整个文件全量） | index flag 失效、生产发布回执、混合最终回读、收尾／部分收尾与读取期间漂移 |
| 远端生命周期 | 联合 30/30；最终 remote 14/14 | Cookie 后去 Basic、注销路径、跨进程互斥、503 零重试、未知写保留、受限恢复 GET、活 owner／旧 token 拒绝、MCP／Broker／CSP 边界 |
| 帮助／分发／文档 | 17 项通过；fast-path 定向通过 | 入口可达、原分发范围、类型条件指针；修正过时 feedback 字面断言并支持同文件锚点 |

专项文件见 coding owner 的 `scripts/iris-tools/tests/source-sync.test.js`、`source-sync-transaction.test.cjs`、`source-publication.test.cjs`、`iris-demand-promote.test.js`，根 `scripts/tests/iris-remote-operations.tests.js` 和既有部署／CSP／MCP／导出测试。

维护者运行了组件 `validate --base-ref HEAD --worktree` 并与 HEAD 的原有问题逐项比较：本次 9 个 owner 版本及直接依赖兼容无新增问题；既存发布记录债务保持原状。未执行需要暂存内容的提交门禁，不据此宣称全仓历史审计通过。变更文件 UTF-8、JSON、JavaScript 语法及 `git diff --check` 通过。

## 取证边界

- Windows/macOS/Linux × Node 22.5.0／22／24 已加入原 CI，未运行远端 CI，不能宣称矩阵已通过；本轮无 PowerShell 实现变更。
- 首次真实资格仍从 5 个明确文档开始。Atelier 文档核实不证明数据库未知写的业务结果；进程退出、Cookie logout 和连接关闭不证明 License 回落。
- 旧 Caché／IRIS 的 Atelier Web doc、前端 BOM／换行字节、编译 Storage、数据库连接关闭及 License 前后观测须在另获授权的目标窗口取证。没有批量资格时不自动跑整份 XML。
- 本轮所有测试使用自己的隔离目录并清理。业务源码、连接、实例事实与许可观察均不进入框架；新旧业务恢复材料不搬移、不清理。
