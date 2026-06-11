# IRIS 项目适配配置

本文档记录目标工程的 IRIS 编码差异项。MCP 连接凭据以工程根目录 `.mcp.json` 为准，本文件不保存账号、密码、token。

> **项目类型默认值**：若目标工程属于已知类型（如 `doctor-dev`），优先从 `templates/profile-defaults/<type>.md` 加载默认值填充，减少 TODO。可用类型见 `templates/profile-defaults/` 目录。

## 通用配置

以下配置在工程级别统一。单仓库工程直接填写；多仓库工作区所有仓库共享。

- Web 技术：CSP / HISUI / TODO

### HISUI 配置

- 是否使用 HISUI：TODO
- HISUI 源码路径：`.agents/vendor/hisui/dist/js/jquery.hisui.js`
- HISUI 主题 CSS：TODO

### 编码策略

- 源文件编码：TODO（如"前端 GB2312, 后端 UTF-8"）
- 上传前是否运行 `convert-gb2312-upload.ps1`：TODO

### 部署能力

- 编码时从 `.mcp.json` 确认可用的 MCP 工具（iris_doc、iris_compile、sftp-server 等）
- CSP 编译命令模板：`$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`，必须使用 WebApp 虚拟路径，不使用物理 Web 根路径

### 远端部署路径

- 编码时从 `.agents/config/project-env.json` 确认

### 风险边界

- 默认禁止远程写入，除非用户明确要求。
- 默认禁止数据库 DDL/DML，除非用户明确要求。
- 默认禁止批量覆盖远程文件，除非用户明确要求。

## 仓库配置

单仓库工程直接填写下方字段。多仓库工作区复制下方字段为每组仓库各填一份，或改用末尾的差异表。

- 工程名称：TODO
- IRIS namespace：TODO
- 业务包前缀：编码时探索
- ObjectScript 基类继承链：TODO

### 目录路径

- 后端 ObjectScript 源码根目录：TODO
- CSP 本地目录：TODO
- 前端脚本/CSS 本地目录：TODO

### 后端约定

- BLH 类命名模板：TODO
- DATA 类命名模板：TODO
- SQL 类命名模板：TODO
- 公共 Super 类：TODO
- JSON 工具类：TODO
- Broker 入口或调用封装：TODO

### 前端约定

- CSP 框架页命名模板：TODO
- CSP 内容页命名模板：TODO
- JS 文件命名模板：TODO
- 公共 HEAD 标签或模板：TODO
- 后端调用 JS 封装：TODO
- 公共 CSS/布局类：TODO

---

### 多仓库差异表（可选）

多仓库工作区若不想为每组仓库复制上方字段，可用此表替代"仓库配置"段落。删除上方"仓库配置"段落后使用。不要在表格中写"同左""同上"等引用词。

| 配置项 | 仓库 1 | 仓库 2 | 仓库 3 |
|---|---|---|---|
| IRIS namespace | TODO | TODO | TODO |
| 业务包前缀 | 编码时探索 | 编码时探索 | 编码时探索 |
| ObjectScript 基类继承链 | TODO | TODO | TODO |
| 后端源码根目录 | TODO | TODO | TODO |
| CSP 本地目录 | TODO | TODO | TODO |
| 前端脚本/CSS 本地目录 | TODO | TODO | TODO |
