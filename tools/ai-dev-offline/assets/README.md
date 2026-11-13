# ObjectScript 离线扩展原包

- `vscode-objectscript-3.8.3-SNAPSHOT.vsix` 由用户提供，用于其现场版本固定需求。原文件保持字节一致，现场缺陷修复效果由用户验收。
- `servermanager-3.16.0.vsix` 来自官方 Marketplace 固定版本 API，作为 ObjectScript manifest 声明的依赖。下载来源为 https://marketplace.visualstudio.com/_apis/public/gallery/publishers/intersystems-community/vsextensions/servermanager/3.16.0/vspackage 。上游 https://github.com/intersystems-community/intersystems-servermanager ，tag `v3.16.0`。
- 原包自带 LICENSE.txt 及第三方声明，分发保留完整 VSIX。身份、版本、大小及本地 SHA256 记录于 `../extensions.json`。SHA256 用于传输校验，来源分别为用户文件与上述官方接口。
- 构建后单独交付扩展 ZIP，解压到工具根目录形成 `packages/extensions/`。既有六项基础安装原包可复用。
