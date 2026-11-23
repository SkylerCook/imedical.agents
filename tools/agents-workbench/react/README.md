# .agents 工程工作台

## 解压运行

将 `tools/dist/agents-workbench-react.zip` 完整解压。在 Windows x64 双击新版 `start-workbench.cmd`。系统文件夹选择器支持在地址栏粘贴工程路径，选定后由默认浏览器打开工程首页。包内包含便携 Node.js 24.22.3、编译后的页面、Maple Mono NF CN 中文字体、手册和本地依赖。框架首装和更新需要本机 Git、Windows PowerShell 5.1，以及可访问的 Git 来源或已批准的完整离线能力包。

```powershell
& ./start-workbench.cmd --project "<工程根目录>"
```

使用上面的命令绑定实际工程。保存 Git 工程的私有配置时会使用 Git 检查跟踪状态。Windows 配置写入沿用既有工具的 PowerShell 5.1 与文件权限处理。

首次生成受管 IRIS MCP 入口时，工作台会选择独立安装的 Node.js。缺少兼容版本时，可通过 [AI 开发环境离线安装助手](../../ai-dev-offline/README.md) 准备 Node。已配置的 MCP 继续使用自身登记的命令。

双击启动器并选好工程后，浏览器打开工作台，命令窗口自动关闭。每个实例只监听 `127.0.0.1`，可以同时打开多个工程。同一实例最后一个工作台标签关闭后会自动收尾退出，刷新页面时有短暂的重连时间。已接受的操作会完成收尾，向量构建在当前批次保存并读回后暂停。需要查看启动输出时可在现有终端用 `--project` 指定工程，按 Ctrl+C 也可请求退出。直接运行 `serve.js` 默认使用 `4179`，可用 `PORT` 指定端口。

## 更新工作台

从团队发放渠道取得新版 `agents-workbench-react.zip` 和该 ZIP 对应的工作台发行记录。支持导入的 Windows 正式工作台可在工程首页点击「导入工作台新版」，先选择 ZIP，再选择工作台发行记录。框架离线发行记录用于 `capability.bundle`。工作台校验材料后并排导入，用包内 Node 启动新版并核对当前工程和界面。其他工程使用同一发行包时，可复用内容一致的版本目录。

检查通过后，可点击「打开新版工作台」。下次从原 `start-workbench.cmd` 打开当前工程时，启动器会优先使用已核验的新版。新版启动失败时，启动器自动打开旧版。也可在新版工程首页点击「恢复旧版工作台」，打开旧版并恢复该工程的默认版本。两个版本都可从各自安装目录启动，旧版页面可以继续处理已开始的工作。

通过工作台导入新版后，双击新版目录的 `start-workbench.cmd` 即可使用新版文件夹选择器。从该目录打开同一工程，也可以恢复这次更新前的默认版本。其他工程各自保留原来的选择。

早期工作台可按发放记录核对 ZIP 版本、大小和 SHA-256，再完整解压到新目录，从新版 `start-workbench.cmd` 绑定原工程。

Windows 试用 ZIP 直接解压到新目录，双击其中的 `start-workbench.cmd` 绑定原工程。需要继续使用原版时从原目录启动。正式版的导入入口只接受配有包外发行记录的正式 ZIP。

工作台随 ZIP 更新界面和手册，使用手册中可离线打开安装更新 Runbook 和 Overlay Runbook。工程能力包和工程 `.agents/docs/` 继续沿原框架更新入口取得。试点用户直接使用发布包。

在「使用手册」中可以离线搜索随包指南和 Runbook 的标题、文件名和正文。输入配置名或命令名，点击命中结果打开原文位置。

## 工程入口

0.3.1 的离线首装在部署框架后生成工程配置、技能入口和文档链接，并通过原更新器复查。已使用 0.3.0 离线首装的工程可沿[更新中断与续接](../../../docs/update-agents.md#更新中断与续接)补齐生成层。

0.3.0 的验收覆盖 Windows x64 标准工程首装、历史更新与离线包操作，以及共享 Overlay 的根更新、成员接续和独立窗口。0.2.1 可通过完整解压新 ZIP 升级，从新版开始可在页面导入后续发行包。

- 实际工程提供总览、工程配置、插件、Agent 客户端、MCP 与连接、知识与向量、使用手册、能力目录和任务与恢复。页面标题来自绑定工程。
- 「Agent 客户端」可复制带当前工程目录和框架归属的接入请求。已具备适配脚本的工程附只读预演和检查命令，其余宿主按实际入口核对。处理后可回同页重新读取文件入口，实际加载结果由宿主会话确认。
- 插件、连接、知识、手册和恢复页面的接续请求带当前工程目录、配置根、能力来源及任务所需的入口。在共享工作区中，Agent 按请求核对本地配置与共享能力范围。发起请求后可复制给当前工程的 Agent，完成后回原页面复查。
- 当前源码的「知识与向量」可以搜索已绑定工程的业务知识和界面参考，结果显示原文片段、来源路径和行号。本地关键词检索无需向量索引或配置模型凭据。
- 已验证的 Windows standard 工程可在同页选装或移除公司分发索引，逐项读回供应、选装、落盘和格式。共享模块显示继承的索引状态，调整从所属标准工程执行。
- 「重新读取索引」同时核对分发索引和本地构建缓存。构建完成或暂停后，同页自动刷新缓存列表。已核验归属的 Overlay 成员可在缓存列表看到共享能力根的实际文件。
- 同页的「构建与续建」复用原索引缓存。预览显示待外发目录、提供方和模型，确认后才开始。点击「暂停构建」会在当前批次保存并读回后停止，重新预览即可按剩余范围续建。
- 工程配置可预览和保存开发库、Web、已绑定 SFTP、插件参数和新增的 JSONC 分节表单。待迁移字段提示通过原更新器接续。BOS 与知识 Key 从「MCP 与连接」进入，保存前显示共享作用范围和凭据操作。[配置迁移](../../../docs/update-agents.md#工程配置迁移)
- 首页区分工作台直办与 Agent 接续。首装和检查复用原安装更新入口，已部署工程统一使用固定更新提示词。插件、连接和向量的直接执行以各页可核验的入口为准；宿主自动派发及真实宿主内加载沿[工作台计划](../../../docs/agents-workbench-plan.md)验收。
- Windows standard 工程可从首页[离线首装](#离线首装与更新)。
- 虚构工程用 `/#/项目标识/页面` 直接打开。可从 `/#/clinic/config` 体验开发库切换，从 `/#/root/modules` 进入 Overlay 模块，从 `/#/fresh/home` 体验首次部署及 Agent 接续。演示状态按工程保存，可由左下角演示控制重置。
- 原有 `/actual.html#config`、`/index.html#/clinic/scope` 和 `/react/#plugins` 收藏地址进入同一界面。插件搜索、状态与依赖预览可直接通过页面地址恢复。
- 公共顶栏可选深色、浅色或跟随系统，默认深色并保存在浏览器。页面直接加载随包交付的 Maple Mono NF CN 7.9 WOFF2，无需安装系统字体。[字体来源与许可](src/fonts/UPSTREAM.md)

## standard 试点操作

使用 `start-workbench.cmd --demo` 打开演示。

新工程在首页「在工作台完成」点「安装基础框架」。工作台直接完成基础安装、生成入口和复查，无需打开 Agent 会话。已有标准工程可在同一区域点「检查工程」，检查落盘版本。已有工程通过「交给 Agent」查看只读上游观测，发现候选提交时显示「发现框架新版」及提交号。点「复制更新提示词」，粘贴到同一工程的 Agent 会话。Agent 按[原更新手册](../../../docs/update-agents.md#使用工作台安装与更新)核对来源、按授权更新并在会话报告复查结果。工作台总览回到前台时自动读取本地状态，也可点「重新读取」主动检查。

首页显示「框架部署不完整」「无法读取框架版本」或「框架来源待核对」时，可复制当前工程的恢复提示词，并离线打开[恢复手册](../../../docs/update-agents.md#更新中断与续接)。恢复先核对已有 `.agents`、本地配置与可信来源，再按授权处理。

首页显示「Overlay 声明待核对」时，从「交给 Agent」复制恢复提示词，只从当前工程核对自身声明和共享能力归属。修复后从启动器重新选择成员工程。

已有项目规则会保留。需要依据代码和业务约定补规则时，可从首页「交给 Agent」或「任务与恢复」点「准备工程检查请求」，把当前工程的核对请求复制到 Agent 会话。知道具体约定时也可以由项目维护者直接补写。

编辑时遇到外部修改，可在当前对话框重新读取并保留未冲突的非敏感草稿。发生同字段冲突时，选定使用来源值或保留自己的修改后，再预览确认。替换凭据仍需重新输入。

需要跨刷新或重启继续编辑时，点「保存本机草稿」。草稿按当前工程和配置域保存在本机用户目录，重新进入表单时以最新来源比对。凭据和凭据复用选择需重新填写或确认。草稿只能作为编辑候选，实际保存仍需重新预览。损坏或不兼容的草稿可从表单清除，原配置仍可读取。

工程配置保存中断后，重新打开同一工程的「任务与恢复」。可恢复的部分写入提供「恢复配置」和确认窗口。已全部写入时可点「核验保存结果」，通过后只补记回执。存在后续修改或结果仍待核对时，页面保留原回执并提供 Agent 接续。从保存提示可以直接进入回执页面。插件补装中断沿原插件页核对。

最近一次保存与实际文件一致时，回执行会提供「撤销本次保存」。工作台用同一配置工具核对并按原字节恢复。撤销中断后可在重开的同一工程里继续处理；需要核对的后续变更保留给用户或 Agent。

「任务与恢复」可导出当前工程的非敏感状态，一次下载用于排查和交接。文件保留框架版本、插件和入口观测、索引状态及回执引用；换机时连接和凭据沿原配置来源设置。

标准根首页列出已登记的 Overlay 成员。可以从成员行打开该工程的独立工作台，也可以从模块首页打开标准根。两个窗口分别绑定各自的工程和会话。Agent 按提示词从标准根更新共享能力，再从项目已有清单核对获授权的模块和医院成员，逐个刷新和复查。历史全量工程没有共享登记时，沿项目已有管理入口和成员声明核对归属；部分失败的成员按[原 Overlay 流程](../../../docs/workspace-overlay.md)接续。

### 离线首装与更新

绑定尚无 `.agents` 的 Windows standard 工程，在首页点「选择并预演离线能力包」。把 `capability.bundle` 和随包的 `manifest.json` 保存在同一解压目录，将从批准渠道取得的独立离线发行记录保存在该目录外。先选择发行记录，再选对应的 `capability.bundle`。核对目标后点「确认离线首装」。预演保持工程原样。

退出工作台时，尚未完成的离线首装和工作台新版文件选择会取消。重新打开后可以再次选择。

已有工程断网更新时，把提示词、批准的 `capability.bundle` 和独立发行记录交给 Agent，沿[原离线更新入口](../../../docs/update-agents.md#更新中断与续接)核对、预演、应用和复查。复验运行 `node --test tools/agents-workbench/tests/deployment.test.js`。[实施与验收范围](../../../docs/agents-workbench-plan.md#任务17真正的离线能力包安装更新独立可验收切片)

遇到旧更新器的 Git 换行差异时，Agent 先核对工程 HEAD 和受管运行文件，再用已核验的新版工作台完整运行包里的 `scripts/update-agents.ps1` 对原工程重新预演。运行该脚本的 PowerShell 进程可使用同包的 `runtime/node.exe`，沿原离线物料、参数和授权范围执行。

## 维护者发布

### 生成框架离线物料

使用保有完整历史的源仓或裸仓构建到新目录。按团队已确认的分支、完整提交和包摘要复核物料，生成独立发行记录。

```powershell
node tools/agents-workbench/build/build-offline-package.js build --source "<完整 Git 仓>" --output "<新物料目录>" --ref refs/heads/master --revision "<完整提交 SHA>"
node tools/agents-workbench/build/build-offline-package.js verify --package "<物料目录>" --ref refs/heads/master --revision "<已批准的完整提交 SHA>" --sha256 "<已批准的包 SHA-256>" --release-record "<包外新记录.json>"
```

验证会核对分支、提交、包摘要和完整 Git 对象。按原批准渠道独立发放记录，并交付物料目录中的 `capability.bundle` 与 `manifest.json`。工作台的可执行版本范围仍由试点支持的提交决定。

### 构建工作台发行包

改动影响工作台或随包文件时，`c + p` 包含提交、推送、从同一提交打包验收并更新 `tools/dist/` 的正式包和发行记录。

从 0.2.1 起，正式发行的源码、编译后的界面、安装器和随包手册必须来自同一 Git 提交。先提交发布所需的代码和文档，再从该提交的干净工作区运行 `stage:release`。它先自动重建界面，再暂存发行所需文件。选用已按 [AI 开发离线环境](../../ai-dev-offline/README.md)清单校验的 Windows x64 Node 原包，解压后将其目录传给打包入口。暂存目录使用工作区外的任务专属新目录。

```powershell
Push-Location tools/agents-workbench/react
npm ci --ignore-scripts
npm run stage:release -- "<新暂存目录>" --node-runtime "<已校验 Node 目录>"
Pop-Location
```

替换正式 ZIP 前完成以下核对。

1. 在暂存目录核对 `workbench-release.json` 的版本、完整 Git 提交 SHA、Node 版本、安装器和随包文档摘要。团队使用手册、`docs/update-agents.md` 和 `docs/workspace-overlay.md` 均取自该提交，保留原路径。
2. 将暂存内容压成待验收的 `agents-workbench-react.zip`，记录 ZIP 字节数和 SHA-256。用同一 ZIP 在独立中文空格目录解包，验证启动、工程绑定、离线打开使用手册及跳转更新恢复和 Overlay 两阶段流程。使用隔离工程验证首装、发现版本和复制提示词，核对只读发现前后的 Git 引用及落盘状态。
3. 校验通过后，核对现有 ZIP 与原发行记录的 SHA-256，再一并移入 `tools/dist/history/agents-workbench-react/<旧版本>/`。将验证过的新版 ZIP 和 `agents-workbench-react.release.json` 放到 `tools/dist/`，再次核对文件大小、SHA-256 和记录内的源码提交。历史版本在各自目录保留同名 ZIP。

Windows 隔离验收需要 Python Playwright、Edge 和 Git。此命令对照包外发行记录与 Git 核对候选 ZIP、手册和固定的框架运行树。它从同一个 ZIP 验证离线手册跳转、历史工程更新接续和新工程安装，并检查上游观测与实际落盘版本的区别。验收路径不使用系统 Node。

```powershell
python tools/agents-workbench/tests/standard-pilot.py "<待验收 ZIP 路径>" --require-formal --require-runtime-pin --release-record "<对应包外发行记录>"
```

新版本同时验证试点工程当前使用的已核验版本。用 `--installed-revision <原工程的完整框架提交>` 可在隔离镜像复现该升级起点。需要继续支持的前序版本应登记完整提交和对应运行树，避免下次发包时丢失正常接续路径。

可用 `python tools/agents-workbench/tests/release-browser-pilot.py "<待验收 ZIP>" "<对应包外发行记录>"` 复验换版。它从 `tools/dist` 当前正式包导入候选包，也可用 `--old-archive` 和 `--old-record` 指定历史正式包。验收通过原 PowerShell 导入器和 Windows Edge 检查工程独立、从新版入口回退，以及候选目录不可用或新版进程启动后退出时的自动回退。测试预先提供文件路径，现场选择窗口另行验证。

## 开发预览

在 Windows 源仓根目录使用 Node 24 构建并绑定一个已有工程，可以直接试用首页更新提示词。

```powershell
npm --prefix tools/agents-workbench/react run build
node tools/agents-workbench/prototype/serve.js --project "<工程根目录>" --open
```

开发预览沿用 `npm run build` 和 `npm run stage -- "<新暂存目录>"`，可传入 `--node-runtime` 带上便携 Node。省略该参数时，暂存目录可用现有 Node 24 执行 `tools/agents-workbench/prototype/serve.js`。正式交付使用上一节的 `stage:release` 和 ZIP 验收流程。后端回归命令见[服务与配置适配器](../prototype/README.md)。

Windows 独立试用包从已核验的公开框架提交构建时，在线首装优先采用已核验的发布版本。若发布分支已经快进到尚未核验的版本，工作台可安装它的已核验基线，并在首页显示实际安装版本和后续更新入口。已核验基线不在发布分支历史中时，由 Agent 核对来源。

## 组件来源

界面使用 React、Tailwind、Radix 和 Lucide。shadcn/ui 组件来自官方 `new-york-v4` 注册表的 2026-11-18 快照，项目内调整了 import、中文标签与 Sidebar 偏好处理。依赖版本见 `package-lock.json`，组件许可与快照见 [LICENSE-shadcn.md](LICENSE-shadcn.md) 和 [registry-snapshot.sha256](registry-snapshot.sha256)。运行包附带编译资源与本地库的许可。

发布包含新框架提交的运行包时，先在隔离源验证该完整提交的首装、原更新取版和插件迁移，记录实际运行树摘要。将这对提交号与摘要加入 `src/framework-worker.js` 的已验收映射后再构建工作台。解包验证首装、目标提交的只读检查和更新提示词交接。工作台构建提交与已验收的框架提交分别记录。

### 在源码工作区隔离试用

Windows 安装本项目的 React 构建依赖、Python Playwright 与 Edge 后，在仓库根目录执行 `npm --prefix tools/agents-workbench/react run build`，然后运行 `python -X utf8 tools/agents-workbench/tests/project-policy-pilot.py --try`。试用使用本地 Git 镜像创建独立工程；完成迁移与保存检查后保留浏览器窗口。可在工程配置页编辑部署策略，在插件页核对工程状态。回到终端按 Enter 清理。
