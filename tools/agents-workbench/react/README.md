# .agents 工程工作台

## 解压运行

将 `tools/dist/agents-workbench-react.zip` 完整解压。在 Windows x64 双击 `start-workbench.cmd`，选择工程目录后，默认浏览器打开工程首页。包内包含便携 Node.js 24.22.3、编译后的页面、Maple Mono NF CN 中文字体、手册和本地依赖。框架首装和更新需要本机 Git、Windows PowerShell 5.1，以及可访问的 Git 来源或已批准的完整离线能力包。

```powershell
& ./start-workbench.cmd --project "<工程根目录>"
```

使用上面的命令绑定实际工程。保存 Git 工程的私有配置时会使用 Git 检查跟踪状态。Windows 配置写入沿用既有工具的 PowerShell 5.1 与文件权限处理。

打包启动器为每次启动自动分配本机端口。可同时打开多个工程，启动地址显示在各自终端。服务仅监听 `127.0.0.1`，在对应终端按 Ctrl+C 停止。直接运行 `serve.js` 默认使用 `4179`，可用 `PORT` 指定端口。

## 更新工作台

从团队发放渠道取得新版 `agents-workbench-react.zip` 和包外发行记录。支持导入的 Windows 正式工作台可在工程首页点击「导入工作台新版」，选择这两个文件。工作台校验材料后并排导入，用包内 Node 启动新版并核对当前工程和界面。其他工程使用同一发行包时，可复用内容一致的版本目录。

检查通过后，可点击「打开新版工作台」。下次从原 `start-workbench.cmd` 打开当前工程时，启动器会优先使用已核验的新版。新版启动失败时，启动器自动打开旧版。也可在新版工程首页点击「恢复旧版工作台」，打开旧版并恢复该工程的默认版本。两个版本都可从各自安装目录启动，旧版页面可以继续处理已开始的工作。

早期工作台可按发放记录核对 ZIP 版本、大小和 SHA-256，再完整解压到新目录，从新版 `start-workbench.cmd` 绑定原工程。

工作台随 ZIP 更新界面和手册，使用手册中可离线打开安装更新 Runbook 和 Overlay Runbook。工程能力包和工程 `.agents/docs/` 继续沿原框架更新入口取得。试点用户直接使用发布包。

## 工程入口

0.3.1 的离线首装在部署框架后生成工程配置、技能入口和文档链接，并通过原更新器复查。已使用 0.3.0 离线首装的工程可重新应用同一份离线能力包补齐生成层。

0.3.0 的验收覆盖 Windows x64 标准工程首装、历史更新与离线包操作，以及共享 Overlay 的根更新、成员接续和独立窗口。0.2.1 可通过完整解压新 ZIP 升级，从新版开始可在页面导入后续发行包。

- 实际工程提供总览、工程配置、插件、Agent 客户端、MCP 与连接、知识与向量、使用手册、能力目录和任务与恢复。页面标题来自绑定工程。
- 「Agent 客户端」可复制带当前工程目录和框架归属的接入请求。已具备适配脚本的工程附只读预演和检查命令，其余宿主按实际入口核对。处理后可回同页重新读取文件入口，实际加载结果由宿主会话确认。
- 当前源码的「知识与向量」可以搜索已绑定工程的业务知识和界面参考，结果显示原文片段、来源路径和行号。本地关键词检索无需向量索引或配置模型凭据。
- 已验证的 Windows standard 工程可在同页选装或移除公司分发索引，逐项读回供应、选装、落盘和格式。共享模块显示继承的索引状态，调整从所属标准工程执行。
- 同页的「构建与续建」复用原索引缓存。预览显示待外发目录、提供方和模型，确认后才开始，已保存的向量可在下次构建时复用。
- 工程配置可预览和保存 IRIS、Web 与已有 SFTP 的选定字段。BOS 与知识 Key 复用个人配置，保存前展示共享影响和凭据操作，读取与预览仅显示凭据状态。[配置来源与写入边界](../prototype/README.md)
- 能力目录和任务页提供当前执行边界与 Agent 接续。standard 工程可在首页首装、检查、本地预演、获取新版、应用和复查。插件执行、Overlay 写入、宿主自动派发、MCP 认证和向量构建沿 [工作台计划](../../../docs/agents-workbench-plan.md)推进。
- Windows standard 源码暂存版的工程首页已接入[离线首装与更新](#离线首装与更新)。
- 虚构工程用 `/#/项目标识/页面` 直接打开。可从 `/#/clinic/config` 体验开发库切换，从 `/#/root/modules` 进入 Overlay 模块，从 `/#/fresh/home` 体验首次部署及 Agent 接续。演示状态按工程保存，可由左下角演示控制重置。
- 原有 `/actual.html#config`、`/index.html#/clinic/scope` 和 `/react/#plugins` 收藏地址进入同一界面。插件搜索、状态与依赖预览可直接通过页面地址恢复。
- 公共顶栏可选深色、浅色或跟随系统，默认深色并保存在浏览器。页面直接加载随包交付的 Maple Mono NF CN 7.9 WOFF2，无需安装系统字体。[字体来源与许可](src/fonts/UPSTREAM.md)

## standard 试点操作

使用 `start-workbench.cmd --demo` 打开演示。

新工程在首页点击“安装基础框架”。已有工程可先“检查工程”或“本地预演”。“获取新版并预演”允许原更新器快进共享框架目录；随后“应用更新并复查”使用落盘版本，并在同一部署锁内完成 Write 和 Check。浏览器刷新或锁冲突后可继续已经通过的预演，关闭服务后需重新观测和预演。

候选暂存版在标准根首页列出已登记的 Overlay 成员。可以从成员行打开该工程的独立工作台，也可以在模块首页点击“打开标准根工作台”。两个窗口分别绑定各自的工程和会话。标准根应用更新后可刷新所选成员，部分失败时可仅刷新失败成员。源码目录暂不可用的成员仍可打开核对，刷新暂停到目录就绪。

已有模块首次接入时，从启动器直接打开模块，在首页点“刷新本工程”。工作台使用当前共享版本刷新模块并读回登记。回到标准根点击“重新读取”，即可从成员列表统一管理该模块。

### 离线首装与更新

绑定 Windows standard 工程，在首页点击「选择并预演离线能力包」。先在文件窗口选择从批准渠道另行取得的离线发行记录，再选择对应的 `capability.bundle`。页面核对工程和目标版本后，按需点击「确认离线首装」或「应用离线更新」。预演保持工程原样，更新保留已有远端、上游和私有配置。

该入口已在 Windows PowerShell 5.1 暂存包中验证。复验运行 `node --test tools/agents-workbench/tests/deployment.test.js`，正式候选 ZIP 及 Overlay 离线写入另有验收路径。[实施与验收范围](../../../docs/agents-workbench-plan.md#任务17真正的离线能力包安装更新独立可验收切片)

## 维护者发布

从 0.2.1 起，正式发行的源码、编译后的界面、安装器和随包手册必须来自同一 Git 提交。先提交发布所需的代码和文档，再从该提交的干净工作区运行 `stage:release`。它先自动重建界面，再暂存发行所需文件。选用已按 [AI 开发离线环境](../../ai-dev-offline/README.md)清单校验的 Windows x64 Node 原包，解压后将其目录传给打包入口。暂存目录使用工作区外的任务专属新目录。

```powershell
Push-Location tools/agents-workbench/react
npm ci --ignore-scripts
npm run stage:release -- "<新暂存目录>" --node-runtime "<已校验 Node 目录>"
Pop-Location
```

替换正式 ZIP 前完成以下核对。

1. 在暂存目录核对 `workbench-release.json` 的版本、完整 Git 提交 SHA、Node 版本、安装器和随包文档摘要。团队使用手册、`docs/update-agents.md` 和 `docs/workspace-overlay.md` 均取自该提交，保留原路径。
2. 将暂存内容压成待验收的 `agents-workbench-react.zip`，记录 ZIP 字节数和 SHA-256。用同一 ZIP 在独立中文空格目录解包，验证启动、工程绑定、离线打开使用手册及跳转更新恢复和 Overlay 两阶段流程。使用隔离工程验证首装、取版和应用复查，核对工程与已有文件读回。
3. 校验通过后，核对现有 ZIP 与原发行记录的 SHA-256，再一并移入 `tools/dist/history/agents-workbench-react/<旧版本>/`。将验证过的新版 ZIP 和 `agents-workbench-react.release.json` 放到 `tools/dist/`，再次核对文件大小、SHA-256 和记录内的源码提交。历史版本在各自目录保留同名 ZIP。

Windows 隔离验收需要 Python Playwright、Edge 和 Git。此命令对照包外发行记录与 Git 核对候选 ZIP、手册和固定的框架运行树。它从同一个 ZIP 验证离线手册跳转、历史工程升级和新工程安装，并将隔离来源推进到未核验的提交，检查工作台能否继续使用实际发布版本。验收路径不使用系统 Node。

```powershell
python tools/agents-workbench/tests/standard-pilot.py "<待验收 ZIP 路径>" --require-formal --require-runtime-pin --release-record "<对应包外发行记录>"
```

新版本同时验证试点工程当前使用的已核验版本。用 `--installed-revision <原工程的完整框架提交>` 可在隔离镜像复现该升级起点。需要继续支持的前序版本应登记完整提交和对应运行树，避免下次发包时丢失正常接续路径。

## 开发预览

开发预览沿用 `npm run build` 和 `npm run stage -- "<新暂存目录>"`，可传入 `--node-runtime` 带上便携 Node。省略该参数时，暂存目录可用现有 Node 24 执行 `tools/agents-workbench/prototype/serve.js`。正式交付使用上一节的 `stage:release` 和 ZIP 验收流程。后端回归命令见[服务与配置适配器](../prototype/README.md)。

## 组件来源

界面使用 React、Tailwind、Radix 和 Lucide。shadcn/ui 组件来自官方 `new-york-v4` 注册表的 2026-11-18 快照，项目内调整了 import、中文标签与 Sidebar 偏好处理。依赖版本见 `package-lock.json`，组件许可与快照见 [LICENSE-shadcn.md](LICENSE-shadcn.md) 和 [registry-snapshot.sha256](registry-snapshot.sha256)。运行包附带编译资源与本地库的许可。

发布包含新框架提交的运行包时，先在隔离源验证该完整提交的首装、原更新取版和插件迁移，记录实际运行树摘要。将这对提交号与摘要加入 `src/framework-worker.js` 的已验收映射后再构建工作台。解包验证目标提交的 Check、取版预演及写入复查。工作台构建提交与已验收的框架提交分别记录。

### 在源码工作区隔离试用

Windows 安装本项目的 React 构建依赖、Python Playwright 与 Edge 后，在仓库根目录执行 `npm --prefix tools/agents-workbench/react run build`，然后运行 `python -X utf8 tools/agents-workbench/tests/project-policy-pilot.py --try`。试用使用本地 Git 镜像创建独立工程；完成迁移与保存检查后保留浏览器窗口。可在工程配置页编辑部署策略，在插件页核对工程状态。回到终端按 Enter 清理。
