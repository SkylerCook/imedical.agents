# 统一帮助入口与项目分发验证

本轮为 framework-maintenance，实施基线 `9682193122902e55ba1111ee14208c3f49db1d5e`。规则唯一来源为[统一帮助协议](../../docs/guides/capability-help.md)，已部署项目沿[更新说明](../../docs/update-agents.md#统一-skill--agent-帮助)取得能力；本记录不代表业务副本已升级。

## 改动与分发

- 71 个项目自有 skill（19 个 owner，含 init、xc）、8 个 canonical Agent 和源仓维护 skill 在业务步骤前分流帮助。默认简明，显式要求时展开；附带执行参数也只展示帮助。完整参数仍归 owner，vendor 保持上游契约。
- 19 个 manifest 仅递增 PATCH，发布记录新增不修改历史；全部 skill frontmatter 与实施基线相同。xc 两处主技能原有的标题前声明/背景要求移至帮助之后，原业务内容保留。
- 协议随 docs、源定义随 plugins/agents 正常 sparse 分发。薄索引模板、生产安装/更新器和 vendor 无差异，旧索引继续解引用新源定义，无帮助专项索引迁移、状态迁移或旧文件清理。源仓维护 skill 仍不分发。
- Overlay 未映射 docs 时，源路由在读取协议前已给出 capability.json / CapabilityRoot 定位条件；解析后按实际源文件目录解释相对链接，输出可访问的文件链接。
- 新专项加入原 sparse-refresh 的 Windows/macOS/Linux × Node 22/24 矩阵，未创建平行运行器或改变业务任务授权。

## 已完成验证

本机 Windows / Node.js 24.14.1；PowerShell 7.6.6 及 Windows PowerShell 5.1。以下是本轮实际执行结果，跨平台 CI 配置不视为实际通过。

| 检查 | 结果与范围 |
|---|---|
| 新帮助专项 | PS7、PS5.1 各 4/4：动态枚举所有自有入口（含新增文件）、真实安装 sparse、新旧 sparse 快进、旧插件/Agent 索引字节保留仍可达源定义、无私有配置、Overlay 无 docs 映射 |
| 文档布局专项 | 7/7：项目链接和能力清单、新装/既有项目分发、源仓维护区排除、自定义及 dirty 保护；最终文档链接定向检查再次通过 |
| 既有插件索引专项 | PS5.1 通过：元数据刷新、DryRun 只读、幂等、自定义正文保留、链接目标保护 |
| 更新器全套 | PS7、PS5.1 均通过：复用原只读/写入/幂等、标准/Overlay、启用状态及自定义保护场景 |
| 静态检查 | 变更与新增文件严格 UTF-8/JSON、Node 语法、skill frontmatter 保持、受保护运行时无差异及 git diff --check 通过 |
| 版本校验 | 工作树比较识别 19 个 PATCH，本轮无新增版本、依赖或发布记录问题；完整检查退出 1，仅报告既已登记的 xc 历史发布记录缺 commit 共 6 项错误，未修改历史记录，不宣称全仓版本门禁通过 |

新专项命令：`node --test scripts/tests/capability-help.tests.js`，分别以 `TEST_POWERSHELL=pwsh.exe` 和 `powershell.exe` 执行；`AGENTS_TEST_TEMP` 指向本任务 D 盘隔离目录。

其余命令：

```powershell
node --test scripts/tests/documentation-layout.tests.js
node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/plugin-thin-index-refresh.tests.ps1
pwsh.exe -NoProfile -File scripts/tests/update-agents.tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/update-agents.tests.ps1
node .agents/skills/agent-kit-maintenance/scripts/validate-component-versions.js validate --repo-root . --base-ref HEAD --worktree --budget-ms 60000 --format json
```

初次回归发现 xc 集成技能的标题前同步声明，已保留原文并移至帮助之后；更新器全套另暴露旧夹具漏复制当前 orchestrator 的四个依赖，已仅在原测试复制清单补齐 night-convergence、night-plan、night-integration、night-capability，PS5.1 BOM 保留，生产实现和断言未改。修正后的对应测试已复跑通过。

## 实际 Agent 帮助抽样

一名未继承父对话历史的 Agent 在同一宿主依次响应六类请求，每类样本量为 1：

| 请求 | 观察结果 |
|---|---|
| bos-demand-entry --help --commit | 展示参数和示例，明确未执行 commit、未读取 Git 改动 |
| iris-deploy 查看用法 | 介绍部署输入及前提，区分 skill 请求与脚本 CLI，无配置或连接探测 |
| demand-acceptance --help | 明确帮助不产生交付授权，不创建批次或执行提交/日志/push |
| bos-init 查看用法 | 说明个人初始化与项目接入差异，不初始化配置或启用插件 |
| xc 性能技能 --help | 给自然语言输入示例，无虚构参数；未进入背景技能或性能诊断流程 |
| coordinator-agent 查看用法 | 介绍职责、输入输出和串行方式，未创建 run、加载 workflow 或派发业务任务 |

抽样读取仅包括六个入口、本协议及指南相关章节；工具为 Get-Content、rg，未运行业务脚本、Git 或远程工具，未读取 profile、私有配置、业务代码/草稿/记忆，未写文件。独立 review 指出的相对链接基准歧义已修正。

这些是当前 Agent 的源码直接调用样本，不替代其它模型、宿主选择器发现、业务副本升级后的实际调用或非 Windows 验证。后续复验并入既有 P2 宿主/兼容队列。

## 证据与边界

成功功能检查的内容指纹记录于[验证证据](capability-help-2026-10-22.evidence.json)，可用既有 validation-evidence 工具 check 复用；版本检查失败未记录为通过。正式记录不保留完整测试日志。

测试合成仓库均在任务隔离目录；旧文档布局测试固定使用系统临时路径并由自身 finally 清理。实施阶段未暂存或提交源仓、未推送、未写真实 BOS，也未更新真实业务项目。用户随后授权本批 c + p，复用有效功能证据，补做精确暂存、staged 版本校验与 origin/master 完整出站范围核对；提交和推送结果以 Git 记录为准，不改变业务副本未更新的边界。

收尾已核对任务专属目录 `D:\tmp\Codex\capability-help-20261022-3b8ad7` 仅剩本任务两份更新器日志，清理后通过独立命令确认目录不存在；无本任务测试临时产物保留。
