# 需求交付入口迁移

coding-iris-plugin 0.16.0 删除旧需求技能、CLI 和引用别名。框架内部统一使用新 owner；已部署项目通过更新器迁移，无需等待所有项目升级才移除源仓入口。

| 旧入口 | 新入口 |
|---|---|
| iris-demand-commit | [demand-commit](../plugins/demand-delivery-plugin/skills/demand-commit/SKILL.md) |
| iris-demand-entry | [bos-demand-entry](../plugins/bos-plugin/skills/bos-demand-entry/SKILL.md) |
| coding-iris-plugin/scripts/iris-tools/commit-demand.js | demand-delivery-plugin/scripts/commit-demand.js |
| coding-iris-plugin/scripts/iris-tools/demand-entry.js、demand-entry-xlsx.js | bos-plugin/scripts/ 下同名脚本 |

## 已部署项目更新

在目标 WorkspaceRoot 按 [更新说明](update-agents.md)执行完整更新：先 DryRun 检查，再 Write，最后 Check。首次迁移不要使用 -Plugin / -ExcludePlugin 过滤掉需要的新 owner。只有源仓改动提交并同步到目标能力包后，目标项目才取得迁移代码；本轮维护不会自动更新真实业务项目。

更新器在生成普通薄索引前调用根 scripts/migrate-demand-ownership.js；识别逻辑不读取已删除的 IRIS 源文件：

1. 检查工作区内普通目录中的 AGENTS.md，以及 ContextRoot/config、rules、skills、workflows 中的本地文档与配置，同时检查项目 scripts 与 .github 中的自动化引用。排除 .git、node_modules、vendor、dist、build，不递归目录链接；Overlay 声明且指向正确 CapabilityRoot 的共享框架目录不改写。源码仓库 Junction 内的项目入口属于另外的上下文，不跨工作区修改。
2. 定向替换 Markdown 中明确的旧技能名称、完整旧路径和可解析的相对链接，保留其它文字、UTF-8 BOM 与换行。非 Markdown 配置含旧引用、非 UTF-8 文件、链接、自定义旧/新索引或未知内容报告具体位置并阻断；不覆盖后宣称成功。任务草稿、历史计划、业务数据和外部用户级配置不扫描或改写。
3. 仅根据旧入口或旧引用的实际证据接入对应 owner。plugin_profile 尚无该 owner 时写 enabled；既有 enabled 保持；明确 available/disabled 保留并报告冲突，需按项目意图解决后重试。仅安装 coding-iris-plugin 不会自动启用两种新能力。旧 owner 已明确 available/disabled 时，不从残留入口推断启用新 owner，报告待明确选择。
4. 将旧配置中明确的 standard/project 交付类型复制到缺失的 demand_delivery_profile.md；旧补录入口的 IRIS 默认产品标识成为项目配置。已有该配置不覆盖；无法确定交付类型保留 TODO，新技能在生成计划前要求确认。
5. 使用现有 canonical 薄索引生成器生成新 owner 入口，验证可达后迁移引用和 profile，再删除已识别的旧受管入口。自定义旧目录不删除；新生成失败时旧入口保留，迁移未完成并返回非零。更新中断后可以重试，已完成迁移再次执行无额外改动。

项目接入只登记启用与发现入口，不自动执行 BOS 个人凭据初始化、不连接 BOS、不注册客户端 MCP。demand-delivery-plugin 没有专用 init；BOS 本地补录无需查询凭据。需要查询时再按 bos-init 完成个人配置。

嵌套工作区按事实标记停止递归：子目录存在 `.git`（仓库目录或 worktree/submodule 指针文件）、自己的 `.agents/capability.json`、`.agents/.git`，或 `.agents` 本身为链接时，归其独立上下文处理。当前 WorkspaceRoot 不因此跳过；不读取嵌套入口或跟随其中链接，也不以 `.worktrees` 等目录名作为豁免。JSON `skippedWorkspaces` 和更新器 `demand-workspace-skipped` 报告边界与原因，调用方按需独立更新这些工作区；标记存在不代表该工作区配置已验证。普通子目录仍扫描，当前项目范围内的自定义链接仍报冲突。

更新器的检查范围有明确边界：工程外的个人脚本、复制到其它位置的入口及不在上述范围中的调用方，需由其 owner 切换旧 CLI 路径。DryRun 显示文件级迁移清单；不输出项目配置全文。冲突报告代表迁移尚未完成，不能把能力包 Git 更新成功当作项目入口已生效。Git 拉取可能已移除旧源文件；保留下来的旧索引用于定位和恢复，并不保证旧命令仍可执行。解决报告的冲突并重新 Write / Check 后再继续使用。

## 外部编排与 Check

插件启用清单若由外部注册表维护，项目编排器必须先调用 `node <CapabilityRoot>/scripts/migrate-demand-ownership.js --project-root <WorkspaceRoot>`。JSON `schema=demand-ownership-plan/v1` 中，`stateChanges` 仅列本次拟新增的启用（`plugin/from/to`），`enabledBefore` / `enabledAfter` 为本地 profile 迁移前后完整启用集合（含旧 initialized 状态）；`owners` 是本次涉及的能力，不等于新增启用。`conflicts` 非空或退出码非零时停止，不消费冲突计划。

项目编排器按自身契约核对并更新注册表，保留其它配置；框架不发现、不读取、不改写外部注册表。批量工程先预检全部上下文，再逐个迁移及验收，记录已完成项，失败后从实际状态恢复；不保证跨工作区或注册表的原子事务。完成判据是注册表、profile、入口与项目自己的验证器一致。

可在 PowerShell 调用更新器时传入 `-ExpectedEnabledPlugin $expectedPlugins`（字符串数组，必须包含迁移后的全部启用插件，而非仅新增项）。更新器在新入口生成和需求引用/profile 写入前比较预期集合，差异返回非零；自更新重启保留该参数。省略参数时保留普通项目的自动接入行为。CLI 等价参数为 `--expected-enabled=plugin-a,plugin-b`，空集合用 `--expected-enabled=`。此门禁针对需求迁移，不能代替编排器最终验证其它更新步骤及私有注册表；此前 Git 拉取等更新步骤可能已执行。

`Check` 现在在仍有旧入口待迁移时返回非零；DryRun 用于预览，Write 用于迁移。迁移后即使没有旧名称，Check 仍检查本地 profile 中启用的新 owner 的日常薄索引、canonical skill、实际逻辑路径解析与需求 CLI 文件。缺失、改指或不可达返回非零；不修改索引、不执行业务 CLI、不访问 BOS，也不等于宿主已加载验收。框架不会从本地 profile 推断私有注册表是否同步；需要该校验时显式传入预期集合并运行项目验证器。

## 数据与验证

旧 iris-standard-demand/v2 草稿、iris-standard-demand-facts/v1 取证、iris-demand-commit-plan/v1 计划及默认计划目录保持原协议和摘要，不因入口删除而改写。v1 录入草稿原先就不受支持。数字编号、三段式描述、29 列可选 Excel 和 standard-only 补录保持不变；project 可用 demand-commit。

回归覆盖受管入口识别、引用迁移、显式状态与自定义内容保护、缺失目标、漂移、重复执行、standard/Overlay 与 PS5.1/PS7。CI 包含 Windows/macOS/Linux；矩阵配置不代表远端已执行。真实宿主加载与业务项目升级需在目标项目单独验收。
