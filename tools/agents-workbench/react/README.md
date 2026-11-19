# .agents 工程工作台

## 解压运行

将 `tools/dist/agents-workbench-react.zip` 完整解压。在 Windows x64 双击 `start-workbench.cmd`，选择工程目录后，默认浏览器打开工程首页。包内包含便携 Node.js 24.22.3、编译后的页面、Maple Mono NF CN 中文字体、手册和本地依赖，首装和更新另需本机 Git、Windows PowerShell 5.1 及可访问的框架源。

```powershell
& ./start-workbench.cmd --project "<工程根目录>"
```

使用上面的命令绑定[实际工程](http://127.0.0.1:4179/#home)。保存 Git 工程的私有配置时会使用 Git 检查跟踪状态。Windows 配置写入沿用既有工具的 PowerShell 5.1 与文件权限处理。

服务仅监听 `127.0.0.1`。在启动终端按 Ctrl+C 停止，端口冲突时可在启动前设置 `PORT`。

## 更新工作台

从团队发放渠道取得新版 `agents-workbench-react.zip` 和配套发行记录，核对版本、文件大小和 SHA-256。等旧工作台的写入任务结束，将新版解压到新目录，启动并选择原工程。新版暂时无法启动时，可从旧目录启动。

工作台随 ZIP 更新界面和手册，使用手册中可离线打开安装更新 Runbook 和 Overlay Runbook。工程能力包和工程 `.agents/docs/` 继续沿原框架更新入口取得。试点用户直接使用发布包。

## 工程入口

- 实际工程提供总览、工程配置、插件、Agent 客户端、MCP 与连接、知识与向量、使用手册、能力目录和任务与恢复。页面标题来自绑定工程。
- 工程配置可预览和保存 IRIS、Web 与已有 SFTP 的选定字段。BOS 与知识 Key 复用个人配置，保存前展示共享影响和凭据操作，读取与预览仅显示凭据状态。[配置来源与写入边界](../prototype/README.md)
- 能力目录和任务页提供当前执行边界与 Agent 接续。standard 工程可在首页首装、检查、本地预演、获取新版、应用和复查。插件执行、Overlay 写入、宿主自动派发、MCP 认证和向量构建沿 [工作台计划](../../../docs/agents-workbench-plan.md)推进。
- 虚构工程用 `/#/项目标识/页面` 直接打开。可从 `/#/clinic/config` 体验开发库切换，从 `/#/root/modules` 进入 Overlay 模块，从 `/#/fresh/home` 体验首次部署及 Agent 接续。演示状态按工程保存，可由左下角演示控制重置。
- 原有 `/actual.html#config`、`/index.html#/clinic/scope` 和 `/react/#plugins` 收藏地址进入同一界面。插件搜索、状态与依赖预览可直接通过页面地址恢复。
- 公共顶栏可选深色、浅色或跟随系统，默认深色并保存在浏览器。页面直接加载随包交付的 Maple Mono NF CN 7.9 WOFF2，无需安装系统字体。[字体来源与许可](src/fonts/UPSTREAM.md)

## standard 试点操作

使用 `start-workbench.cmd --demo` 打开演示。

新工程在首页点击“安装基础框架”。已有工程可先“检查工程”或“本地预演”。“获取新版并预演”允许原更新器快进共享框架目录；随后“应用更新并复查”使用落盘版本，并在同一部署锁内完成 Write 和 Check。浏览器刷新或锁冲突后可继续已经通过的预演，关闭服务后需重新观测和预演。模块、医院 Overlay 保持只读。

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

Windows 隔离验收需要 Python Playwright、Edge 和 Git。此命令核对正式包内手册与 Git 原文，验证离线跳转，并在临时目录创建 bare 源和非空工程，实测无系统 Node 时的安装、取版和本地写入。

```powershell
python tools/agents-workbench/tests/standard-pilot.py "<待验收 ZIP 路径>" --require-formal
```

## 开发预览

开发预览沿用 `npm run build` 和 `npm run stage -- "<新暂存目录>"`，可传入 `--node-runtime` 带上便携 Node。省略该参数时，暂存目录可用现有 Node 24 执行 `tools/agents-workbench/prototype/serve.js`。正式交付使用上一节的 `stage:release` 和 ZIP 验收流程。后端回归命令见[服务与配置适配器](../prototype/README.md)。

## 组件来源

界面使用 React、Tailwind、Radix 和 Lucide。shadcn/ui 组件来自官方 `new-york-v4` 注册表的 2026-11-18 快照，项目内调整了 import、中文标签与 Sidebar 偏好处理。依赖版本见 `package-lock.json`，组件许可与快照见 [LICENSE-shadcn.md](LICENSE-shadcn.md) 和 [registry-snapshot.sha256](registry-snapshot.sha256)。运行包附带编译资源与本地库的许可。
