# 需求交付与私有草稿目录

标版补录的文本、关系说明和 Excel 是可读交付；draft.json 可能内嵌源码补丁和取证，属于本机恢复资料。目录默认值与创建时机以 bos-plugin manifest 的 projectDirectories 为准。

## 选择本次目录

先沿目标工程约定选择目录。没有明确覆盖时，从当前工作区运行只读解析；Overlay 根据 capability.json 定位 CapabilityRoot 并使用其 scripts/project-docs.js，不假设本地 scripts 有独立副本。

~~~powershell
node .agents/scripts/project-docs.js resolve --project-root . --owner bos-plugin --id demand-delivery --fallback docs/work/standard-demand
node .agents/scripts/project-docs.js resolve --project-root . --owner bos-plugin --id demand-drafts --fallback docs/work/standard-demand
~~~

未接入治理或治理未启用时，两者沿用 docs/work/standard-demand；prepare/render 继续使用原单目录输出，草稿不自动加入 Git。当前 ContextRoot/config/documentation-layout.json 明确启用后，交付根为 docs/delivery/demands，私有根为 ContextRoot/work/standard-demand。解析不创建目录、不迁移文件。

在解析根下使用稳定任务子目录。治理任务通过 --draft-output 显式分离草稿，所有路径均传给实际脚本；旧项目约定与本次显式选择优先。

~~~powershell
node .agents/plugins/bos-plugin/scripts/demand-entry.js prepare --project-root . --spec <spec.json> --output <交付根>/<task> --draft-output <私有根>/<task>/draft.json --excel
node .agents/plugins/bos-plugin/scripts/demand-entry.js render --project-root . --draft <私有草稿.json> --output <新的交付目录> --draft-output <新的私有草稿.json>
node .agents/plugins/bos-plugin/scripts/demand-entry.js bind --project-root . --draft <私有草稿.json> --item r1 --demand <编号> --title <最终标题> --output <新的私有草稿.json>
~~~

prepare/render 的 --output 仍为新目录。--draft-output 必须在可读交付目录之外，已有草稿停止覆盖。未显式给 draft-output、且输出位于已启用治理声明的交付根下时，脚本自动在当前私有根按相同任务相对路径保存 draft.json，并在返回 JSON 的 draft 字段报告准确位置；该位置不写入公开交付正文。

旧的显式输出目录继续保留单目录语义；需要分离时显式给 draft-output。治理只允许私有草稿写入当前声明的 ContextRoot/work/standard-demand，其它 .agents 路径和能力源码仍被阻断。私有根使用只忽略本机产物的 .gitignore，不修改共享 Git 配置。自定义草稿位置的可见性沿项目明确约定，不混入正式交付目录。

## 恢复与迁移

bind 只保存新的私有草稿，不自动改写来源或旧草稿。render 从明确草稿读取，不扫描共享目录；旧输入可以原位读取。给 BOSS 的仍只有用户选用的文本或 Excel，不发送草稿、补丁或目录清单。

历史 docs/work/standard-demand 常同时含交付与私有恢复资料，因此不能将整个旧目录直接搬入知识库。存量迁移需明确授权并逐类列清单；本次插件更新不启用治理、不搬文件。临时 spec/取证沿任务临时目录，已内嵌进可恢复草稿后可清理本任务临时输入。
