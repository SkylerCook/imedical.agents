# 连接信息在哪里：查看与排查

本页供使用者和 Agent 共用。找不到服务地址、Token、账号、人员或组，或者修改配置后没有生效时，从这里开始。无需记住各插件的目录，也无需先向 Agent 解释配置结构。

本页集中提供查找入口与排查逻辑。真实信息仍保存在各自的本机、项目私有配置或凭据存储中，不复制到本页或另建一份配置。

## 我现在要找什么

工程配置已有 `irisConnections.active` 时，当前开发库以该档案为准。初始化、MCP 同步和会话迁移先核对绑定来源；遇到冲突，提示中会列出文件和字段。切库沿工作台的档案切换入口完成。无档案工程仍沿原流程维护连接。

已有 VS Code 服务器条目时，新增开发库档案可以填写原服务器名，沿用原条目的主机、Web 端口和协议，再确认该库的命名空间及私有凭据。目标与已有条目一致时，工作台保留该服务器条目，只切换当前服务器和命名空间，并按绑定范围同步其他入口。

在标准根的「工程配置 → 编辑工程连接 → 开发库档案」选择目标后，预览会列出根工程和参与切换的模块。确认后，同一次操作覆盖这些成员当前生效的 IRIS 连接，包括模块单独设置过的连接。切换范围由登记关系与指向标准根的 `projectEnvFallback` 决定。其他工程配置字段仍从各自工作台维护。

需要单独切某个模块时，从该模块的工作台选择或新增档案。保存只作用于该模块，下次标准根批量切库时会再次统一。首次为继承模块建立独立档案时，若提示共享框架版本过旧，先更新标准根的 `.agents`。保存后重连正在使用的 Agent 客户端，用 `check_config` 核对实际目标。VS Code 使用用户级服务器配置时，从 VS Code 核对当前服务器。

| 要找的信息 | 从哪里查看 | 如何核对 |
|---|---|---|
| BOS 查询地址、访问密钥、Token、人员和组 | 默认打开 `%LOCALAPPDATA%\imedical-agents\bos\config.json`，查看 `bos-demand-query` 段。自定义路径见下方 BOS 小节 | `defaults` 离线校验；`check` 连接远端并发现查询工具 |
| BOS 代码日志地址、Token、关联项目 | 同一文件的 `bos-code-update-log` 段 | 按[日志说明](../../plugins/bos-plugin/references/code-update-log.md)使用 `defaults`，两类 Token 不互相代用 |
| 知识检索提供方、公司网关和 Embedding 凭据 | `KNOWLEDGE_RAG_CONFIG` 指向的仓外 JSON，按 providers 分段，默认 company | 无服务时直接本地检索；配置与公司索引选装见[检索指南](knowledge-retrieval.md) |
| MCP 名称、启动命令、URL、headers、启用状态 | 当前客户端实际加载的用户级或项目级 MCP 配置 | 核对客户端工具发现结果，文件存在不等于已加载 |
| IRIS MCP 目标、凭据来源和启动参数 | 当前工程已有 `.mcp.json`、客户端实际注册与 `check_config`；是否使用 `.iris-agentic-dev.toml` 以运行时来源为准 | 按 [IRIS 诊断](../../plugins/coding-iris-plugin/rules/iris_agentic_dev.md#诊断)检查 `connection_source` 等字段 |
| IRIS 部署、导出、Web/Broker 脚本参数 | 当前 `ContextRoot/config/project.jsonc` 或现有 `project-env.json` | 按[工具说明](../../plugins/coding-iris-plugin/scripts/iris-tools/README.md)核对，Overlay 回退规则见下节 |
| IRIS 开发方式与项目环境 | 当前 `ContextRoot/config/iris-development.json` | [初始化](../../plugins/coding-iris-plugin/skills/coding-iris-init/SKILL.md#本地配置初始化与已有项目补齐)或已启用项目更新自动补缺文件；模式和环境按明确事实由 Agent 填写，旧缺省保留 |
| IRIS 远端准入与资格证据 | 当前 `ContextRoot/config/iris-remote-policy.json` | connected 按需上下文自动生成缺失骨架，保持禁用/pending；协调目录、许可池及资格证据沿[接入协议](../../plugins/coding-iris-plugin/references/project-demand-development.md#首次接入)准备，真实验证后启用 |
| 其它 MCP 或服务 | 先查实际调用入口及 owner 文档，再定位客户端注册、引用的环境变量、文件或系统凭据项 | 按对应读取代码判断，不套用 BOS 或 IRIS 优先级 |

需要查看敏感值时，在自己的本地编辑器或凭据管理器打开原始来源。聊天、截图和排查报告默认隐藏密码、Token、Authorization、Cookie，以及 URL 查询参数中的密钥；不输出配置全文。分享时只保留字段名、来源、是否已填写和脱敏结果。

## BOS：一个私有文件，两种用途

**去哪里改 BOS 配置？** 在 Windows 文件资源管理器地址栏粘贴 `%LOCALAPPDATA%\imedical-agents\bos`，用文本编辑器打开 `config.json`。这是首次初始化的默认位置。

**在哪里设置文件路径？** 在 Windows 开始菜单搜索“编辑帐户的环境变量”，在“用户变量”中找到 `BOS_MCP_CONFIG`。它的值是配置文件的完整路径。如果这里指定了其他位置，打开该路径。首次使用可让 Agent 执行“初始化 BOS 个人配置”，它会创建配置文件、设置用户变量并返回实际路径。

要核对当前 PowerShell 实际继承的路径（`CurrentProcess`）和用户变量保存的路径（`User`），运行：

```powershell
[pscustomobject]@{
    CurrentProcess = $env:BOS_MCP_CONFIG
    User = [Environment]::GetEnvironmentVariable('BOS_MCP_CONFIG', 'User')
}
```

打开对应文件，按下表填写。**【必填】只针对正在使用的功能；【按需】按查询口径或连接方式填写；【保留】表示公司连接通常无需修改。** 初始化生成的 `TODO` 是待填写标记，不是可用值。只使用查询时，不必先填写代码日志段。JSONC 注释与旧客户端共用时的格式要求见[共享私有配置](../../plugins/bos-plugin/references/usage.md#共享私有配置)。

| 填写标记 | 私有文件字段 | 应填内容与注意事项 |
|---|---|---|
| 【保留／按需】查询连接 | `bos-demand-query.connection`；自定义连接使用该段 `url` | 公司连接保留 `company`；自定义连接填写实际服务 URL，与公司连接二选一 |
| 【必填】公司查询访问密钥 | `bos-demand-query.access_key` | 公司接入当前使用统一值，无需个人申请；向框架维护者通过内部安全渠道获取并替换 `TODO`，与个人查询 Token 分开填写 |
| 【必填】BOS 查询 Token | `bos-demand-query.headers.X-Gateway-Upstream-BOS-MCP-TOKEN` | 在 BOS「接口访问凭证申请」申请个人需求查询凭证；替换 `TODO`，不能用代码日志 Token 代替 |
| 【个人待办必填】默认当前人 | `bos-demand-query.cuser` | **填写 BOS 账号／工号，不填中文显示姓名**；以 BOS 实际识别的完整账号为准，不自行拼接或删掉账号中的数字 |
| 【个人待办必填】默认当前组 | `bos-demand-query.cgroup` | 本人在 BOS 中所属的当前组名称，按系统实际值填写；明确跨组查询时在调用参数中传 `cgroup: ""` |
| 【保留／按需】日志连接 | `bos-code-update-log.connection`；自定义连接使用该段 `url` | 公司连接保留 `company`；自定义连接按日志接口配置，不直接复用查询 URL |
| 【写日志必填】日志 Token | `bos-code-update-log.token` | 在 BOS「代码更新日志接口」获取日志 Key；页面有「我的 Key」按钮，具体对应关系尚待核实，以页面说明或管理员确认为准；与查询凭证独立 |
| 【写日志必填】关联项目 | `bos-code-update-log.linkProject` | 实际关联的研发项目，按日志接口约定填写 |
| 【保留】日志超时 | `bos-code-update-log.timeout` | 可选，默认 `30000` 毫秒，通常无需修改 |

凭证获取与字段处理的 owner 说明见[凭证来源与填写](../../plugins/bos-plugin/references/usage.md#凭证来源与填写)。只使用日志时也可暂不填写查询段。初始化返回实际配置路径、待填字段和取值指引，已有配置无需为取得新提示而迁移；真实凭据仍只填写到仓外私有文件。

**容易填错：`cuser` 的“当前人”是账号身份，不是页面上显示的姓名。** 使用人员反馈过将显示姓名改为完整账号后查询恢复的情况；此反馈不代表其它人员字段也已验证使用相同格式。若连接成功却查不到自己的需求，优先核对实际采用的 `cuser` 和 `cgroup`，不要只检查 Token。

按编号查详情不要求默认人员与组；按其它人员或组查列表时，按[查询参数契约](../../plugins/bos-plugin/references/usage.md#查询参数契约)明确筛选条件，不需要补填不使用的默认身份。填写完成后先运行对应的 `defaults` 离线核对；**离线校验通过不代表账号正确或远端查询成功**，仍须在授权范围内验证实际查询。

`connection: company` 从[公司默认值](../../plugins/bos-plugin/references/company-defaults.json)取地址：查询使用 `url`，日志使用 `codeUpdateLogUrl`。查询运行时再将私有配置中的 `access_key` 加入 URL，所以私有文件中未必有完整 URL。自定义 `url` 与 `connection: company` 按[配置契约](../../plugins/bos-plugin/references/usage.md)二选一。

初始化选路径与日常读取不同：

- 初始化：显式参数 → 当前进程 `BOS_MCP_CONFIG` → 用户级同名变量 → `%LOCALAPPDATA%/imedical-agents/bos/config.json`。
- 日常调用：读取当前进程的 `BOS_MCP_CONFIG`，不会因为默认目录存在文件就自动使用。修改用户级变量后，已运行客户端可能仍持有旧值；先对比两级路径，再按宿主机制重启客户端。
- 人员与组：分别按显式入参（含空字符串）→ `BOS_CUSER` / `BOS_CGROUP` → 私有文件取值。连接正确但列表不对时，检查实际筛选条件。
- 日常 skill → CLI 调用不要求原生 MCP 注册。客户端直接保存的远端 `url/headers` 不会与私有文件自动同步；接入见[客户端注册](../../plugins/bos-plugin/references/client-mcp.md)。

脚本从已加载技能的真实目录解析，先处理链接或薄索引，不依赖当前工作目录猜路径。查询 `defaults` 不联网，会校验连接配置并输出默认人员和组；它不输出 URL 或 Token，也不证明连接成功。初始化、迁移与详细命令复用[使用与配置](../../plugins/bos-plugin/references/usage.md)，不为了查看而重新初始化。

## 项目与客户端：确认谁在读取

同名服务可能同时出现在客户端注册、项目文件和插件脚本里。以本次调用链为准，不能把“搜到了文件”当作“该文件正在生效”。不同客户端的注册位置、格式、覆盖顺序与刷新方式按实际宿主核对，不假定所有人的安装路径相同。

标准项目使用自己的上下文。Overlay 按[工作区说明](../workspace-overlay.md)解析 `WorkspaceRoot`、`ContextRoot`、`CapabilityRoot`。部署脚本先读取模块自己的工程连接，缺少本地连接时按 manifest 声明的 `projectEnvFallback` 取得标准根配置。模块配置无效时先修复该配置。由工作台首次建立独立 IRIS 档案的模块继续从声明的标准根取得未配置的 Web 和 SFTP 服务分节。

IRIS 同步有方向：已有 `.mcp.json` 时按该事实补齐 `project-env.json`；没有 `.mcp.json` 且已确定 `project-env.json` 为事实来源时，才用现有同步工具生成 MCP 配置。查阅不执行同步或覆盖，详见[工具说明](../../plugins/coding-iris-plugin/scripts/iris-tools/README.md)。

## 找不到或不生效时

| 现象 | 下一步 |
|---|---|
| 不知道配置在哪 | 用上表定位读取方，解析环境变量或项目上下文，取得原始来源的可点击入口 |
| BOS 路径为空或文件不存在 | 比较当前进程与用户级绑定；确实未初始化时再使用 `bos-init`，不凭默认路径认定已配置 |
| 字段缺失、为空或 `TODO` | 明确缺哪项及所属段，在本地安全填写；不索要聊天明文密钥或整份配置 |
| 改了文件却没效果 | 核对实际路径、进程环境、显式参数与宿主刷新状态，不再复制一份配置 |
| 同一服务有多份配置 | 列出来源及本次读取证据；覆盖关系未证实时标记待确认，不删除所谓旧文件 |
| BOS 能查需求却不能写日志 | 分别检查两个技能段与凭据，不用查询成功推断日志权限 |
| IRIS 返回 `config_file=null` | 结合 `connection_source` 判断，自动发现或环境变量可能已生效，不能单凭此值判失败 |
| 本地检查通过但连接失败 | 在连接测试授权范围内使用该服务的最小检查，分开报告网络、认证、工具发现和业务调用结果 |

## 交给 Agent 时不用解释目录

直接说“帮我查看 BOS 连接信息在哪里”“这个工程的 MCP 为什么没生效”或“盘点当前客户端 MCP 配置入口，凭据脱敏”即可。

Agent 按顺序执行：

1. 从会话、当前工程与已加载工具确定服务和宿主，按上表读取对应 owner 文档。盘点多个服务时复用宿主已有服务清单，只查有关来源，不扫描全盘或全部业务仓。
2. 解析真实路径与读取顺序，检查存在性、格式、必填项、占位符、禁用状态和重复来源。复用已有解析器与离线检查，不创建配置副本。
3. 交付“服务／调用入口、原配置可点击入口、字段位置、采用来源的证据、检查结果、下一步”。敏感字段只报告已设置、缺失或占位；需要明文时打开原始本地来源，不复制到聊天或共享文档。
4. 既有授权覆盖连接测试时直接使用现有最小检查；仅查看配置时保持本地只读。明确区分本地解析通过、宿主已加载和远端已连通。
5. 仅在目标确有歧义、必要信息无法取得或动作超出已有授权时提问，带上已查范围、具体阻碍和推荐选项。不要求使用者重述可自行读取的事实。

## 维护与分发

本页是统一导航，字段和执行契约由链接的 owner 文档及读取代码维护。新增服务或改变来源时同步导航行及排查差异，不复制整套插件说明，不记录个人路径和值。

随既有 `docs/` 安装与更新分发，无新配置或迁移。已有工程更新能力包后取得新版；文档分发不代表宿主自动加载本页或真实连接已验证。本页提供查看和排查说明，尚无独立图形面板或全服务自动扫描器。
