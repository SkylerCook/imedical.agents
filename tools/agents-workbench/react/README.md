# .agents 工程工作台

## 解压运行

将 `tools/dist/agents-workbench-react.zip` 完整解压。在 Windows x64 双击 `start-workbench.cmd`，默认浏览器打开[演示首页](http://127.0.0.1:4179/#/clinic/home)。包内包含便携 Node.js 24.22.3、编译后的页面、Maple Mono NF CN 中文字体、手册和本地依赖，现场仅需已有浏览器。

```powershell
& ./start-workbench.cmd --project "<工程根目录>"
```

使用上面的命令绑定[实际工程](http://127.0.0.1:4179/#home)。保存 Git 工程的私有配置时会使用 Git 检查跟踪状态。Windows 配置写入沿用既有工具的 PowerShell 5.1 与文件权限处理。

服务仅监听 `127.0.0.1`。在启动终端按 Ctrl+C 停止，端口冲突时可在启动前设置 `PORT`。

## 工程入口

- 实际工程提供总览、工程配置、插件、Agent 客户端、MCP 与连接、知识与向量、使用手册、能力目录和任务与恢复。页面标题来自绑定工程。
- 工程配置可预览和保存 IRIS、Web 与已有 SFTP 的选定字段。BOS 与知识 Key 复用个人配置，保存前展示共享影响和凭据操作，读取与预览仅显示凭据状态。[配置来源与写入边界](../prototype/README.md)
- 能力目录和任务页提供当前执行边界与 Agent 接续。插件依赖可预览，真实部署更新、插件执行、宿主自动派发、MCP 认证和向量构建沿 [工作台计划](../../../docs/agents-workbench-plan.md)推进。
- 虚构工程用 `/#/项目标识/页面` 直接打开。可从 `/#/clinic/config` 体验开发库切换，从 `/#/root/modules` 进入 Overlay 模块，从 `/#/fresh/home` 体验首次部署及 Agent 接续。演示状态按工程保存，可由左下角演示控制重置。
- 原有 `/actual.html#config`、`/index.html#/clinic/scope` 和 `/react/#plugins` 收藏地址进入同一界面。插件搜索、状态与依赖预览可直接通过页面地址恢复。
- 公共顶栏可选深色、浅色或跟随系统，默认深色并保存在浏览器。页面直接加载随包交付的 Maple Mono NF CN 7.9 WOFF2，无需安装系统字体。[字体来源与许可](src/fonts/UPSTREAM.md)

## 源码构建

在源仓根运行，下列 npm 命令只用于维护源码和重建运行包。

```powershell
Push-Location tools/agents-workbench/react
npm ci --ignore-scripts
npm run build
npm run stage -- "<尚未创建的发布暂存目录>" --node-runtime "<已解压的 Windows x64 Node 目录>"
Pop-Location
```

便携运行时取自 [AI 开发离线环境](../../ai-dev-offline/README.md)清单固定并校验过的当前 Node ZIP。只打包 `node.exe` 和对应许可。省略 `--node-runtime` 时，运行目录可由现有 Node 24 直接执行 `tools/agents-workbench/prototype/serve.js`，用于源码预览或已有运行环境。

将暂存目录内容打包为固定名称 `tools/dist/agents-workbench-react.zip`，从独立解压目录复验后交付。插件目录、版本和手册来自打包时的仓库快照，启用状态和配置来源从绑定工程读取。后端回归命令见[服务与配置适配器](../prototype/README.md)。

## 组件来源

界面使用 React、Tailwind、Radix 和 Lucide。shadcn/ui 组件来自官方 `new-york-v4` 注册表的 2026-11-18 快照，项目内调整了 import、中文标签与 Sidebar 偏好处理。依赖版本见 `package-lock.json`，组件许可与快照见 [LICENSE-shadcn.md](LICENSE-shadcn.md) 和 [registry-snapshot.sha256](registry-snapshot.sha256)。运行包附带编译资源与本地库的许可。
