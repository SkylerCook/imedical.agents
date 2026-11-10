---
name: iris-xml-export
description: 导出指定 IRIS 环境当前对象的 XML 部署包；将已确认的文件范围或 Studio 工程清单导成合包或分文件，支持文本与图片 Web 资源。
---

# IRIS XML 导出

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，展示用途、输入、输出、两条通道和授权边界后结束；不检查连接、读取凭据或创建任务。

## 输入与完成标准

先解析当前 `ContextRoot/config/iris-development.json`。offline 不执行医院导出，带回的实际源码或完整源码 XML 进入[离线开发与交付](../../references/iris-offline-development.md)；范围清单不当源码。connected（含旧配置缺省）继续本页，非法开发方式停止。

- 输入：目标工程、明确的来源环境、对象清单，以及合包／分文件和格式选择。页面、Git 差异、关键字只用于发现候选。
- 输出：目标工程正式交付目录中的 XML、准确对象清单、逐项结果和校验回执；恢复资料归当前 ContextRoot 的私有任务目录。
- 完成：确认范围的每个对象均出现在产物中，身份、数量和载荷核对通过，服务器临时状态有退出／清理结果。缺失、重复、额外对象或空包均不能报告完整交付。

## 执行

1. 读取项目 AGENTS、IRIS profile 和插件状态；用 workspace resolver 定位各根。读取[XML 导出协议](../../references/iris-xml-export.md)，沿项目既有连接配置核对目标；不将本地未上传内容算入服务器导出包。
2. 与用户确定准确对象集合。需要探索时用 `xml-scope.js`，逐项解释未解析引用、动态依赖和模块交付缺口；候选清单经核对后才进入导出计划。
3. 选择专用类或原生执行通道。类通道依赖兼容的 `DHCDoc.Util.XmlPackage`；启用时提供 canonical 类源及安装说明，部署沿有效授权执行。原生执行默认同进程 WS terminal，按协议核对 API／服务器版本及命令上限；HTTP MCP 是显式接受其内部重试的资格选项。两者无需预部署该类，均预检实际 namespace 和取回能力；通道失败保留现场并停止。
4. 先生成本地计划，再在覆盖目标、范围及服务器临时文件操作的有效授权下执行。长批次先验证持久落盘与新进程读回；按任务保存服务器产物身份和断点，下载中断时取回原产物。
5. 用结构化 XML 校验逐项比对范围，图片等二进制载荷按字节摘要核对。保存正式交付物，按回执清理本任务服务器文件与临时会话，分别报告导出、校验和清理状态。

CLI 位于 CapabilityRoot 的 `plugins/coding-iris-plugin/scripts/iris-tools/xml-export.js`；参数以其 `--help` 为准。需要本地源码基线时使用 [iris-code-baseline](../iris-code-baseline/SKILL.md)；上传、编译及正式部署沿 [iris-deploy](../iris-deploy/SKILL.md)。本入口只导出包，不提供导入能力。
