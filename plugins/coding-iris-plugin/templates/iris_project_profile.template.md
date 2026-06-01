# IRIS 项目适配配置

本文档记录目标工程的 IRIS 编码差异项。MCP 连接凭据以工程根目录 `.mcp.json` 为准，本文件不保存账号、密码、token。

## 基本信息

- 工程名称：TODO
- IRIS namespace：TODO
- 业务包前缀：TODO
- ObjectScript 基类继承链：TODO
- Web 技术：CSP / HISUI / TODO

## 本地目录

- 后端 ObjectScript 源码根目录：TODO
- CSP 本地目录：TODO
- 前端脚本/CSS 本地目录：TODO
- 部署包目录：TODO

## 后端约定

- BLH 类命名模板：TODO
- DATA 类命名模板：TODO
- SQL 类命名模板：TODO
- 公共 Super 类：TODO
- JSON 工具类：TODO
- Broker 入口或调用封装：TODO

## 前端约定

- CSP 框架页命名模板：TODO
- CSP 内容页命名模板：TODO
- JS 文件命名模板：TODO
- 公共 HEAD 标签或模板：TODO
- 后端调用 JS 封装：TODO
- 公共 CSS/布局类：TODO

## HISUI 配置

- 是否使用 HISUI：TODO
- `HISUI_SRC`：TODO
- HISUI 主 JS：`${HISUI_SRC}/dist/js/jquery.hisui.js`
- HISUI 主题 CSS：TODO

## 部署与编译

- 远端 Web 根路径：TODO
- CSP 远端目录：TODO
- 前端资源远端目录：TODO
- `.cls` 上传 MCP 能力：TODO
- `.cls` 编译 MCP 能力：TODO
- SFTP 上传 MCP 能力：TODO
- CSP 编译命令模板：`$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`，必须使用 WebApp 虚拟路径，不使用物理 Web 根路径

## 编码策略

- 本地源文件编码：UTF-8
- 服务器目标编码：TODO，常见为 GB2312
- 上传前是否运行 `convert-gb2312-upload.ps1`：TODO

## 风险边界

- 默认禁止远程写入，除非用户明确要求。
- 默认禁止数据库 DDL/DML，除非用户明确要求。
- 默认禁止批量覆盖远程文件，除非用户明确要求。
