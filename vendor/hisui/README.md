# HISUI vendor 快照

来源：[wanghc/hisui](https://github.com/wanghc/hisui)。版本身份以 [upstream.json](upstream.json) 的完整 commit 为准；上游 package.json 的 `1.0.0` 和组件注释的 `0.1.0` 均不表示当前资产修订。

此目录随能力包更新部署到业务项目 `.agents/vendor/hisui/`，用于源码参考和本地预览。`dist/js/jquery.hisui.js`、当前主题 CSS、locale 和上游已跟踪资源来自同一上游提交；Git 未提供的分发补充资源另行固定摘要，见 upstream.json 的 build.distributionAssets。构建工具版本、完整文件清单及 SHA-256 一并记录。源码跳转见 [source-index.json](source-index.json)，行号只适用于该快照。版权见 [LICENSE](LICENSE) 和 [第三方声明](THIRD-PARTY-NOTICES.md)。

HISUI 上游不跟踪生成的主 JS 和主题 CSS。本仓按上游 gulpfile 的组件顺序、Less 列表和压缩选项生成，使用维护区锁定的构建工具；另生成上游已有源码的 vben 主题。不会修改上游控件实现或增加兼容 shim。

## 检查与升级

在能力包源仓根目录执行：

```powershell
node maintenance/hisui-build/update-hisui-vendor.js check
node maintenance/hisui-build/update-hisui-vendor.js verify
```

`check` 只读查询上游 master 并返回差异链接；`verify` 离线检查完整清单、哈希、JS 语法和源码索引。资产升级按同级 [AGENTS.md](AGENTS.md) 执行。完整构建方法在源仓 `maintenance/hisui-build/README.md`，构建脚本与 npm 依赖不部署到业务工程。

2026-10-14 首次补齐来源追踪，固定上游 `4c09319c2daa09a25813c6e6af349e2791d79944`（2026-10-12）。后续当前版本只查询 upstream.json，保留此条作为首次迁移记录。

本轮对照 HISUI 0.1.0 打包目录，主 JS 文件时间为 2026-09-22，核心仍采用较新的上述 Git 提交；补充其 26 个 Git 未跟踪分发资源（包括 Font Awesome 5.15.1/webfonts、历史 pure CSS 与图片），按文件摘要复用，不将打包目录认定为该 Git 提交的构建。后续优先采用 Git 新增的同路径资产；仍缺失时仅继承已记录且哈希一致的分发输入，不从已有 vendor 任意保留文件。

排除 CSS 注释中的非生效 URL 后，仍有 14 个资源目标未提供（93 处引用，包含历史变体与新增 locale），明细见 [resource-warnings.json](resource-warnings.json)。这些目标在旧 vendor 中也不存在，但并非所有引用在旧版已启用。保持上游资产原文，不伪造替代图片；后续新增缺项会阻断构建，已有缺项按实际页面使用范围验证。

## 与实际 HIS 的关系

上游快照更新不能证明目标 HIS 使用相同构建。开发或回归前，按任务核对页面实际加载的 JS/CSS、主题、locale、附加 helper 与文件摘要；目标工程已核实的运行文件优先决定兼容边界。应用层 `hisui.tools.js` 不在此上游快照中，不能因更新主库就认定 `$.fn.getValue` 等 helper 可用，也不能用测试 harness 补丁作为真实客户端验证。

业务工程通过正常能力包更新取得快照；不自动改写已有预览配置、业务页面引用或服务器文件。历史显式自定义预览路径仍按项目配置使用，需要时由项目自行核对。对能力包受管 dist 的旧文件收敛仅在源仓升级时进行；自定义资产应放目标工程，避免混入此快照。
