# InterSystems Language Server

用于公司授权范围内的 ObjectScript 离线开发。当前快照取自官方 VS Code 扩展 `intersystems.language-server` 的 `2.8.7` Windows x64 安装包，保留 server 目录及随包 [LICENSE.txt](2.8.7/win32-x64/LICENSE.txt)。[上游项目](https://github.com/intersystems/language-server)

从能力包根目录运行 `node vendor/intersystems-language-server/2.8.7/win32-x64/server/out/server.js --stdio` 可启动 LSP 服务。调用方通过 LSP 打开完整文档，再请求 `textDocument/diagnostic`。普通业务项目安装和更新沿现有 `/vendor/**` 规则取得这个目录。

升级时从对应平台的官方扩展整体替换 server，保留许可证，并用同一份类源码分别验证语法错误与修正版的诊断。当前验证环境为 Windows x64、Node.js 24.14.1，通过 Node IPC 完成离线单文档诊断。
