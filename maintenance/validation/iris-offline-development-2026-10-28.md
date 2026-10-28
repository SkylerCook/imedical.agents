# IRIS 开发方式与离线交付验证

本轮为 framework-maintenance。实现基点 `189d017`；独立源码助手迁移基线为已提交的 `adf249084724199e7837895020c3c32eed751dff`，后续版本工具提交 `b09de95` 保持。未更新业务副本、迁移医院目录或访问真实医院实例。

## 实现与边界

- developmentMode 的唯一配置为当前 ContextRoot/config/iris-development.json，contextMode 原取值保持。缺省旧行为兼容，非法值停止；offline 不要求连接或环境资格。
- 受管远端入口先检查方式，再读取连接或启动客户端。探针覆盖连接配置读取、child process 及 HTTP/TCP；旧在线计划可离线本地 status/verify，远端恢复仍执行原准入、冻结与配置漂移检查，切换不清锁、熔断或未知结果。
- 源码助手唯一实现迁入 coding 插件，人工 ZIP 从同一脚本构建。回执 v1 保持严格读取，新增回执/人工源码 v2 绑定接收批次、选定范围和真实工作区/Git 归属；未知回执字段与原字节不改。
- XML 复用原 helper，可编辑对象位于声明源码 Git，完整输入原包和 inventory 私有冻结；对象范围外改动不进交付，旧工作目录不自动迁移。框架 Pack 记录实际 Git 差异与逐文件摘要，Review/本地检查在实际说明中披露，不自动宣称通过。
- 首版只修改已接收对象。新增、删除、重命名、原件/范围漂移、缺说明均停止，无变化不生成空包。独立 Verify 不证明医院导入、编译、现场无漂移或业务验收；交付停在 acceptance-pending。

## 本机验证

环境：Windows，Node 24.14.1，Windows PowerShell 5.1.26100.9711，PowerShell 7.6.9。各组含重叠测试，不累加为唯一用例总数。

| 验证组 | 结果 |
|---|---|
| 开发方式与共享远端操作专项 | 21/21；覆盖 offline reconcile 提前阻断、注入 transport 不绕过、缺省兼容和旧锁保留 |
| 路由、规则索引与实际 sparse 新装/升级分发 | 11/11；核对唯一 helper、薄入口帮助、PS5.1 BOM 和整个 tools 排除 |
| 在线部署、恢复、source plan 发布及验收执行器回归 | 132 通过、1 浏览器用例因未配置运行时跳过 |
| XML/基线、MCP/读取池、旧计划接续与验收 worker | 109/109 |
| 最终旧计划本地检查与冻结发布定向复验 | 43/43；离线旧 plan 不读连接，恢复显式 connected 后拒绝旧配置指纹，缺省旧配置仍可接续 |
| 最终实际 ZIP 解压与源码/XML 全链路，PS5.1 / PS7 | 各 35/35；包含原独立工具 26 项及新增交付 9 项，ZIP helper 与 canonical 字节一致 |
| 最终源码/XML 交付专项，PS5.1 / PS7 | 各 9 通过，1 非 Windows 能力项在本机跳过；Git 原始 diff 摘要与错误停止已定向复验 |
| 更新器全套，PS5.1 / PS7 | 均通过；只用隔离项目，不更新真实工程 |
| 文档项目链接与目录清单 | 1/1；最终 diff whitespace 检查通过 |

ZIP：`tools/dist/iris-code-export.zip`，SHA-256 `1FB53790DA0BAF135A835878610907178797D012529B3E1EA25A691F0AE40980`。保留原 ZIP 的本机示例，私有内容未写入共享源；ZIP 由 Git 忽略。

可重跑入口见 `.github/workflows/deployment-protection.yml`；新增专项为 scripts/tests/iris-development-mode.tests.js、iris-development-routing.tests.js、iris-offline-source.tests.cjs。沿 scripts/validation-evidence.js 保存与检查功能 scope 指纹；不要因无关 HEAD 变化重跑完整组。

## 版本与待验

coding 0.24.0、agent-context-kit 0.8.2，七个直接依赖扩展到 coding <0.25.0 并各升 patch。完整 worktree 审计与 HEAD 对照：9 个变更组件无新增问题；三份既有 imedicalxc-doctor-extend-engineer 发布记录 1.0.2/1.0.3/1.0.4 缺 commit 字段，产生相同 6 条历史错误，未修改不可变记录。提交前另以实际暂存区执行组件门禁。

已纳入 Windows/macOS/Linux × Node 22.5.0/22/24 矩阵；本轮尚未取得非 Windows、Node22 或远端 CI 实跑结果。原生 MCP/外部 IDE 不在脚本拦截范围，Agent 规则禁止离线医院调用；真实宿主加载/行为与授权医院接入、导入编译及验收仍需分别取证。沿既有 P1/P2 backlog，不把静态路由和本机模拟当真实服务通过。
