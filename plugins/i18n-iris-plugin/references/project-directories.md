# 项目 i18n 产物目录

本页管理 i18n 输出目录选择；能力默认目录、用途及创建时机以 owner manifest 的 projectDirectories 为准。框架源模板继续归插件，页面翻译 seed 继续归 backend SourceRoot。

## 先解析，再生成

在目标工作区调用只读解析器；JSON 中的绝对路径才是本次任务的输出位置。解析不创建目录、不移动既有资料，也不授予远端操作权限。

~~~powershell
node .agents/plugins/i18n-iris-plugin/scripts/resolve-project-directory.js xml --project-root .
node .agents/plugins/i18n-iris-plugin/scripts/resolve-project-directory.js terms --project-root .
node .agents/plugins/i18n-iris-plugin/scripts/resolve-project-directory.js csp-backups --project-root .
~~~

优先级：本次显式参数 > i18n profile 明确目录 > 已启用的目录治理声明 > legacy 默认。治理仅在当前 ContextRoot/config/documentation-layout.json 的 enabled 为 true 后生效；普通框架更新不启用治理，也不迁移旧文件。

| 用途 | 未接入治理 | 已接入治理且无覆盖 | 返回字段 |
|---|---|---|---|
| XML 原文 | references/xmlPrintTemp | docs/delivery/print-templates/source | referencesDir |
| XML 译文、manifest、版面报告 | docs/xmlPrintTemp | docs/delivery/print-templates | outputDir |
| 术语表及字典 SQL 交付 | docs | docs/delivery/i18n/terms | path |
| CSP 同步前的方法体恢复副本 | docs/i18n-csp-trans-sync/backups | docs/delivery/i18n/csp-trans-sync/backups | path |

XML 原文、译文使用同一次 xml 解析结果；同步脚本生成的 manifest.outputDir 可直接交给 i18n-xml-template，后续 Apply 使用同样目录。单个模板或业务对象需要独立目录时，在同步脚本显式传 ReferencesDir/OutputDir，并把 outputDir 传给翻译技能。多模板默认保留一个 manifest，目录整理不改变模板命名或 Apply 行为。

## 项目覆盖

现有有效 profile 保留。仅在项目确有路径差异时，在 .agents/config/i18n_project_profile.md 正文逐行设置下列可选键；不要把示例复制为默认配置：

~~~text
- xmlPrintReferencesDir: docs/delivery/print-templates/<对象>/source
- xmlPrintOutputDir: docs/delivery/print-templates/<对象>
- i18nTermsDir: docs/delivery/i18n/terms
- cspTransBackupsDir: docs/delivery/i18n/csp-trans-sync/backups
~~~

路径相对当前 WorkspaceRoot，也可使用明确的绝对路径。解析器接受 XML 的 ReferencesDir/OutputDir 旧键，以及“CSP 翻译同步配置”章节原有“备份目录”值；同键冲突停止。命令行 xml 支持 --references-dir/--output-dir；terms 和 csp-backups 支持 --output-dir；--profile 可指定其它 profile。已有自定义路径优先，不自动改写配置。

## 恢复与交付

XML Overwrite 的旧目标副本继续放在本次 outputDir/backups；CSP 同步使用 csp-backups 的解析结果。这些是业务对象的恢复资料，目录迁移的批次回退备份由框架目录治理单独管理，不能混用、自动删除或作为临时文件清理。

页面/CSP seed 仍从 profile 与 backend SourceRoot 定位。初始化只检查已有 seed，不创建或覆盖业务源码。术语表文件名保持 i18n_terms_{LANG}_YYYYMMDD_HHMM.md 或 i18n_terms_{LANG}_dict_YYYYMMDD_HHMM.md，在 terms 返回目录写入；本次明确指定文件名时沿用。

首次治理接入、预建目录、存量文件归类各自沿框架的明确授权与计划执行；仅更新本插件不会创建这些项目目录。旧任务继续使用记录中的原文、译文、备份和 manifest，不因默认值变化重新导出或覆盖。
