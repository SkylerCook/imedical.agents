# HISUI 源仓构建

此目录仅维护能力包快照，不随业务项目 sparse checkout 部署。安装器/更新器继续分发完整 `vendor/`，不安装 npm 依赖，也不在业务项目构建 HISUI。

上游生成文件不进 Git，直接同步 dist 会缺少主 JS/CSS。采用 [HISUI gulpfile](https://github.com/wanghc/hisui/blob/4c09319c2daa09a25813c6e6af349e2791d79944/gulpfile.js) 的组件顺序、Less 列表、`compress:false` / `ie8:true` 选项；用固定版本 [Less](https://github.com/less/less.js)、[UglifyJS](https://github.com/mishoo/UglifyJS) 和 [CleanCSS](https://github.com/clean-css/clean-css) 直接生成，不引入完整旧 Gulp 链。依赖及传递依赖的完整性摘要由 package-lock.json 锁定，安装禁用生命周期脚本。jsdom 仅服务合成 DOM 回归。

缺失的 `lib/json2.js` 使用同一 HISUI commit 根目录 json2.js；缺失的 Bootstrap Switch 输入采用 [上游 v1.8.0](https://github.com/Bttstrp/bootstrap-switch/tree/b85606b3e4389276ab7818184a22ff3dd87a3892) 原文，许可证原样保留。其它库仍取 HISUI 固定提交。构建源码不改控件行为，不从旧 vendor 拼接新旧 HISUI 实现。

上游 Less 列表包含未跟踪的 combogrid/numberspinner/timespinner 条目及部分主题的 input.hover，使用已存在的基础组件样式，不生成占位文件；本轮逐项核实并记录在 upstream.json，其它缺项停止。图标别名使用源码已有的内联字符串 split/join，构建需启用 Less JavaScript；升级前继续审查选定提交。CSS 的 14 个生效资源目标未提供，known-resource-gaps.json 是本轮核实的明确例外，完整引用报告进入 vendor/resource-warnings.json；注释不算请求，不自动扩大例外，新缺项停止。

分发参考：HISUI 0.1.0 打包目录的主 JS 文件时间为 2026-09-22，比本轮 Git 固定提交早；不覆盖较新的主库。仅补充 Git 不包含的 26 个分发文件，清单及摘要在 distribution-assets.json，涵盖 Font Awesome/webfonts、历史 pure CSS 和图片。构建时同路径 Git 文件优先，否则从当前 vendor 读取已固定的输入并严格比对哈希；不是任意保留旧文件。这样可从受版本控制的 vendor 重复生成完整分发快照，无需保留使用者下载目录。新打包来源或摘要变化必须另行核查后更新该清单。

## 本次或后续升级

先执行只读 `check` 并阅读差异，选定完整 SHA。Node.js 使用仓库基线 `>=22.5.0`；Node 是能力包维护工具依赖，不是 HIS 生产依赖。

以下 PowerShell 在仓根执行；`$taskDir` 每次换成独立任务目录。临时目录不可用时按根 AGENTS.md 记录权限允许的 fallback，不能使用共享 node_modules。

```powershell
$taskDir = Join-Path 'D:/tmp/Codex' ('hisui-' + [guid]::NewGuid().ToString('N'))
$toolsDir = Join-Path $taskDir 'tools'
New-Item -ItemType Directory -Path $toolsDir | Out-Null
Copy-Item maintenance/hisui-build/package.json,maintenance/hisui-build/package-lock.json -Destination $toolsDir
npm ci --prefix $toolsDir --ignore-scripts --no-audit --no-fund --cache (Join-Path $taskDir 'npm-cache')
if ($LASTEXITCODE -ne 0) { throw 'Build tool installation failed' }
# 将 <完整SHA> 替换为本次核实的提交，不使用浮动版本。
node maintenance/hisui-build/update-hisui-vendor.js update --commit <完整SHA> --tools-dir $toolsDir --temp-root $taskDir
if ($LASTEXITCODE -ne 0) { throw 'HISUI upgrade failed' }
$env:HISUI_BUILD_TOOLS = $toolsDir
$env:HISUI_TEST_TEMP = $taskDir
node --test scripts/tests/hisui-vendor.tests.js
```

macOS/Linux 使用同一 Node 脚本和锁文件，在各自任务临时目录准备 tools；不维护等价 shell 实现。Git fetch 使用固定来源和提交，checkout 禁用自动换行转换，保留资产原始字节。检查/verify 不需要构建工具；update 只在明确提供 tools 后运行，不自动安装依赖。源码目录通过 `--source-dir` 复用时必须是干净、HEAD 与 SHA 一致的独立上游 checkout。

升级后运行 `verify`、检查 diff 及源码索引与参考一致性，记录验证，删除已记录的本任务目录并确认成功；清理前先确认绝对路径、归属及无 Junction/symlink。`update` 自建的 staging 会在结束时清理，调用者准备的 tools/cache 由调用者收尾。不会提交、推送、改写业务项目配置或访问业务服务器。

## 验证边界

专项测试覆盖受管快照篡改/新增/缺失、链接拒绝、替换失败回滚、源码索引、主/压缩 JS 的控件初始化与 datagrid editor 取值、getValue helper 缺失边界及基础 CSS 资源；三平台 Node 22/24 矩阵由 HISUI CI 执行。配置矩阵不代表实跑通过。本机 browser 冒烟与 jsdom 合成 DOM 不等同真实 HIS/WebView/PAD，后者沿目标工程授权验证。
