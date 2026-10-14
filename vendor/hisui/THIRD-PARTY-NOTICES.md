# HISUI 第三方声明

HISUI 来源为 https://github.com/wanghc/hisui，固定提交见 `upstream.json`，上游根 LICENSE 原文随快照保留。HISUI 内含其它组件，根 MIT LICENSE 不替代这些组件各自的条款。

- EasyUI 派生组件：上游源码头部保留 jeasyui.com 的版权及 GPL / 其它授权说明，生成的主 JS 保留这些声明；实际工程沿用其适用授权。
- Bootstrap Switch 1.8.0：https://github.com/Bttstrp/bootstrap-switch/tree/b85606b3e4389276ab7818184a22ff3dd87a3892 ，Apache-2.0。上游 HISUI 的构建脚本引用此版本，但没有跟踪该输入。本仓保存固定版本原文和 LICENSE，生成 JS 保留声明。
- WebUI Popover 1.2.17：采用 HISUI 固定提交中已跟踪的 `lib/popover1.2.17/jquery.webui-popover.min.js`，保留其 MIT 声明。
- JSON2：采用 HISUI 同一固定提交根目录的 `json2.js`（构建脚本原路径 `lib/json2.js` 未跟踪），保留其 Public Domain 声明。
- jQuery、字体、图标等资产按 HISUI `dist/` 原样保留各自随附版权与许可证。
- 分发补充资产包含 Font Awesome Free 5.15.1；其 CSS 头部声明图标 CC BY 4.0、字体 SIL OFL 1.1、代码 MIT，原样保留 CSS 声明与字体。该组分发输入单独固定摘要，不宣称来自主库的 Git commit。

仅源仓构建工具：Less 3.13.1（Apache-2.0）、UglifyJS 3.19.3（BSD-2-Clause）、CleanCSS 5.3.3（MIT）；jsdom 26.1.0（MIT）仅用于离线 API 回归。版本及完整依赖摘要锁定在维护区 `package-lock.json`，业务项目不安装这些包。
