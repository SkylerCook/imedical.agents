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

最终 ZIP：`tools/dist/iris-code-export.zip`，SHA-256 `0AE7D92B6DB994978801363543218CD07776BF8F62AF534B4AB408208390685A`。保留原 ZIP 的本机示例，私有内容未写入共享源；ZIP 由 Git 忽略。0.24.0/0.24.1 初轮包摘要保留于对应 Git 历史，短路径修正后已重建并解压复验。

可重跑入口见 `.github/workflows/deployment-protection.yml`；新增专项为 scripts/tests/iris-development-mode.tests.js、iris-development-routing.tests.js、iris-offline-source.tests.cjs。沿 scripts/validation-evidence.js 保存与检查功能 scope 指纹；不要因无关 HEAD 变化重跑完整组。

## 版本与待验

coding 0.24.0 新能力及 0.24.1 兼容修正、agent-context-kit 0.8.2，七个直接依赖扩展到 coding <0.25.0 并各升 patch。完整 worktree 审计与 HEAD 对照：首批9个变更组件无新增问题；三份既有 imedicalxc-doctor-extend-engineer 发布记录 1.0.2/1.0.3/1.0.4 缺 commit 字段，产生相同6条历史错误，未修改不可变记录。提交前另以实际暂存区执行组件门禁。

已纳入 Windows/macOS/Linux × Node 22.5.0/22/24 矩阵。`7128e17` 首轮 Deployment CI 的 Linux 22.5/22/24 成功，macOS22失败，另外5项被 fail-fast 取消，原因正在定位；不能宣称完整矩阵通过。原生 MCP/外部 IDE 不在脚本拦截范围，Agent 规则禁止离线医院调用；真实宿主加载/行为与授权医院接入、导入编译及验收仍需分别取证。沿既有 P1/P2 backlog，不把静态路由和本机模拟当真实服务通过。

## 首轮 CI 与帮助兼容修正

[Sparse CI](https://github.com/SkylerCook/imedical.agents/actions/runs/40703590340) 检出前后端专项 skill 的模式分流段落位于帮助前。0.24.1 只恢复统一帮助优先顺序，不变更运行时或 ZIP。对同组 sparse refresh、documentation layout/entry、capability-help 加 IRIS 路由和 fast path 的本机复验共42/42通过；新装与升级薄入口也已覆盖。0.24.0 的发布记录保留，0.24.1 新增兼容 patch 记录。

[Deployment CI](https://github.com/SkylerCook/imedical.agents/actions/runs/40703590397) 的 macOS22 日志显示夹具经系统临时目录别名，触发 local-git-required、remote-coordination-link、publication-source-link-changed 等检查。受影响同步/发布/移植与远端测试复用已有 temp-directory helper，规范为物理路径；新增实际 Junction/符号链接对照，显式传给运行时的链接仍拒绝，未放宽安全检查。修正后矩阵结果沿后续 GitHub 回执核对。

同因检查覆盖 Deployment 后续的读取池、MCP、XML/基线及部署夹具。主回归组最终105/105通过；后续组139项通过，读取池15项的清理断言修正后定向通过，与别名对照联检16/16。两处清理钩子的旧变量引用均已修正；不重复无变化的139项，不将各组重叠项累计为唯一用例总数。源码助手、XML打包实现及最终ZIP字节不因本次测试夹具修复变化。

## Windows 8.3 路径最终修正

`8434073` 的 Windows22.5 日志中，ZIP 构建成功，实际失败为两组源码测试的路径误拒绝。本机只读对照确认 Node native realpath 展开 8.3 名称而普通 realpath 保留短名；PowerShell5.1 的 provider path 保留短名而 IO.GetFullPath 展开长名。0.24.2 修正声明目标/物理目标匹配，以及根/子路径的一致比较，未放宽链接、越界或远端权限。

修正后的实际 ZIP + 源码/XML全链路：PS5.1 与 PS7 各37通过、1非Windows项跳过；新增真实8.3源码归属、只读TEMP短名和越界拒绝对照。共享工作区/IRIS上下文及路由11/11通过。完整矩阵等待新回执，未验证医院导入编译与业务验收。已核对版本CI仍只报告既有三份xc发布记录缺 commit 的相同6条错误，不修改不可变历史记录。
