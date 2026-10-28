# 人工独立工具

这里的工具面向人工使用，运行不依赖 Agent、skill 或 `.agents`。工具源与使用说明放在同一目录，可单独拷贝；不随业务项目能力包安装/更新分发。

| 工具 | 使用说明 | 交付包（本机生成） |
|---|---|---|
| IRIS 内网源码导出与离线交付 | [iris-code-export](iris-code-export/README.md) | `dist/iris-code-export.zip` |

导出包包含 `README.md`、`export-iris-code.ps1`、`export-version-baseline.ps1`、`source-delivery.ps1`、`files.example.txt`、生成的 `catalogs/` 与 `images/` 目录示例截图，不包含构建脚本、Node.js、XML 编辑器、框架文件、测试、连接配置或现场源码。XML 带回后由 AI 修改的流程继续归 coding 插件。

维护者从仓库根重建 ZIP（PowerShell，打包电脑需要 Node.js >=22.5.0；现场运行不需要）：

```powershell
& .\tools\iris-code-export\build-package.ps1
```

只长期保留一份工具源码和一个 ZIP。`tools/dist/` 只放正式压缩包，由 Git 忽略；打包、解压验证均使用任务专属临时目录，完成后立即清理，不在 dist 保留解压副本。

需要保留已获授权的本机连接示例时，将示例文本放任务临时目录，用 -LocalExampleFile 指定；构建器仅替换临时 README 的 local-atelier-example 标记，不改共享源。真实地址只留本机被忽略的 ZIP，账号密码始终不写文件。构建器逐文件核对归档摘要后清理自己的暂存目录；示例临时文件由调用任务清理。独立测试直接解压实际 ZIP，核对源脚本、生成清单、截图及 README 模板。

build-catalogs.js 是维护者构建步骤，复用 coding 的 XML 解析与类型规则，从 docs/reference/project-export-map/doctor 的唯一原清单和版本表生成包内执行清单。只合并相同规范身份，大小写冲突阻断，图片预筛并统计；生成清单不在 tools 再维护一份。source-delivery.ps1 从仓库唯一实现取入，兼容 owner 迁移前后的位置，出现两个实现则构建停止；ZIP 内名称固定。整个 tools/ 仍不随 .agents 部署。

版本入口默认医生站，v9.2 仅允许显式 all-products；支持医院补充 TXT、显式 Web 前缀映射和离线 PlanOnly。选定版本、原清单、执行清单、补充和映射摘要写入导出回执，Resume 不允许变更选择。版本表达范围，实际内容来自当前医院；不自动识别版本、初始化源码 Git 或启动全量采集。

新导出只记录必要的可读来源（Atelier URL 与 Namespace）；源码路线使用 source-delivery.ps1 的 Prepare/Pack/Verify 保存原件、增量源码/回退/说明及现场快照比较，全部离线阶段不需要框架或连接凭据。来源与现场代码仅保存在用户自己的导出/交付目录。

导出器串行复用 CSP 会话，Cookie 缺失或连续性异常时停止，不反复认证；退出响应与实际 License 释放分开报告。传输诊断只记录安全的异常类别、类型链和系统状态，原始异常消息不落盘。大批导出的真实会话/License 回落仍需现场按小批验证。
