# 项目知识库目录治理

用于项目资料查找、新建、目录接入、更新检查和存量归类。由 agent-context-kit 承接，传统 standard 与 Workspace Overlay 使用同一工作区解析器。框架 docs 是使用手册，项目 docs 是项目知识库，两者分开维护。

## 内容归属

| 位置 | 用途与生命周期 |
|---|---|
| 项目 `docs/README.md` | 人和 AI 共用总导航，链接用途目录和业务专题；不复制知识正文 |
| `docs/guides/` | 开发、操作、排障指南 |
| `docs/modules/` | 长期业务专题、接口与设计说明 |
| `docs/delivery/` | 需求、验收、演示和正式交付附件 |
| `docs/archive/` | 已被替代的历史资料；保留原适用日期和替代入口 |
| 当前 ContextRoot 的 `work/` | 工具持久运行状态、私有草稿、任务恢复资料 |
| 能力包的 plugins/templates/reference/vendor 等 | 框架自带能力和参考资产；不复制成项目知识正文 |
| 任务临时目录 | 一次性日志、转换和试验材料，用完清理 |

各工作区保留本地知识。跨模块资料由共同 owner 保存一份，其它导航引用；不把模块资料自动汇总复制到主项目。源码旁已有说明时优先引用，翻译 seed 等源码保持 SourceRoot 归属。正式交付可包含 XML 原始模板和必要业务恢复副本；它们不是整理验收后即可删除的迁移备份。

## 目录声明与预建

各插件 `.agents-plugin/plugin.json` 的 `projectDirectories` 是目录默认值的 owner 事实源。更新器读取当前工作区 plugin_profile 中 enabled 的声明；available/disabled 不产生项目目录。`inventory` 可盘点所有已声明目录，但不因盘点而启用插件。

每项声明包含 id、base（workspace/context/capability）、path、role、create（setup/task/never）、用途和可选 legacyPaths。结构见[声明 schema](../schemas/project-directories.schema.json)。框架源资产只读；项目生成目录限制在当前 docs 或 ContextRoot/work。项目显式路径仍由能力原有 profile 或参数选择，优先于新默认；不另维护重复的路径总表。

首次明确授权接入后，创建四个用途目录和 enabled 能力的 setup 固定父目录，允许为空。模板名、需求号等动态子目录按任务生成。登记的工作区扩展保留其名称和用途，并进入导航；不是按文件扩展名分类。

目录治理配置保存在本地 `ContextRoot/config/documentation-layout.json`，包含工作区身份和已登记扩展。配置复制到其它工作区、配置错误、链接路径或目录冲突都要求复核，不能默默回退为新默认。

## 授权与普通更新

首次部署需要用户明确授权。普通框架 Write、插件 enabled、同意目录设计均不代替首次部署授权。

- 未接入：只报告 setup-required，不创建骨架或迁移文件，框架更新继续。
- 已接入：Check/DryRun 只读；Write 可补齐声明的空目录，保留已有文件和项目规则。
- 待整理：更新给出未归属项提示；Agent 先准备实际旧→新路径、引用编辑、备份及跳过项，再询问用户是否执行该批计划。无人值守只提示。
- 已有目录异常：报告 review-required；目录整理问题不阻断其它框架更新。

严格离线只读仍使用更新器 `DryRun -NoPull`；普通 DryRun 的 capability 拉取语义保持原 runbook。更新不会自动移动旧文件、改写知识正文或改变项目 Git 跟踪策略。

## 操作入口

命令位于能力包 `scripts/project-docs.js`。以下 `<...>` 表示实际目标参数；不要把占位符直接执行。命令 JSON 输出中的计划可能含项目正文和私有草稿，保存在本机任务目录，不进入框架、Git 或对外报告。PowerShell 5.1 保存 JSON 时显式使用 UTF-8。

```text
node .agents/scripts/project-docs.js update --project-root <当前工作区> --mode DryRun
node .agents/scripts/project-docs.js inventory --project-root <当前工作区>
node .agents/scripts/project-docs.js setup-plan --project-root <当前工作区>
node .agents/scripts/project-docs.js extension-plan --project-root <当前工作区> --path docs/backlog --purpose 待治理事项
node .agents/scripts/project-docs.js plan --project-root <当前工作区> --mapping <归类映射JSON>
```

setup-plan、extension-plan 和 plan 只输出预演，不写项目。保存原 JSON 后，先向用户展示 action 中将创建/修改/移动的准确路径和 skipped，再取得该批授权：

```text
node .agents/scripts/project-docs.js apply --project-root <当前工作区> --plan <计划JSON> --approve-plan <该计划id> --backup-root <工作区与能力包范围外的备份根>
```

`--approve-plan` 必须等于经过评审的原计划 id。内容、目录或配置发生变化时先重新预演；不能重新计算 id 后沿用旧授权。备份根必须与 workspace/capability 根分离、不是其祖先或后代，并为实体路径。备份按独立批次保存原文件、校验值、原计划和恢复 journal；检查读回后才修改项目。

归类映射示例：

```json
{
  "moves": [{"from": "docs/旧专题", "to": "docs/modules/专题"}],
  "references": ["docs/README.md", "README.md"]
}
```

moves 按目录整体识别附件，保留二进制字节及空子目录。references 显式列出允许修复的现行 Markdown；移动文档内部的相对链接同步调整，正文、代码示例、外部 URL 和冻结证据不做语义改写。预演遗漏的引用不会自动编辑，应在评审时补齐；不存在全库隐式重写。旧空目录保留，不递归清空源目录。

通用迁移只处理现行 docs。交接、run、work、验收冻结资料、private、嵌套 Git、链接及硬链接由工具保护，先核对 owner 的恢复/迁移契约；不以文件名或日期认定可清理。JSON 状态、旧任务载荷和源码不进入通用 Markdown 改写。

## 恢复、验收与备份清理

先用最小批次验证备份能从后续执行环境读回并恢复，再扩大执行。正式 apply 在写入前持久保存 journal；执行异常尝试回退，进程中断后通过同一 journal 恢复。并发内容、备份校验或日志身份异常时保留现场并报告，不覆盖用户新修改。

```text
node .agents/scripts/project-docs.js rollback --project-root <当前工作区> --journal <批次/journal.json> --approve-plan <原计划id>
node .agents/scripts/project-docs.js cleanup --project-root <当前工作区> --journal <批次/journal.json> --accept-batch <用户已验收的原计划id>
```

机器验证通过不等于用户验收通过。cleanup 只在该批用户验收后使用，严格限定为本批原计划和备份文件；出现额外内容则停止清理。业务模板覆盖前备份、活动任务状态和恢复快照不属于该清理范围。普通更新保存 work 的验证不等于 .agents 整体重装或磁盘故障恢复。

## 能力接入与兼容

| Owner | 接入方式与保护 |
|---|---|
| agent-context-kit | docs 骨架、新交接和 run 根声明；交接可发现和恢复本工作区旧根，旧 run 沿原显式目录 |
| i18n-iris-plugin | XML 原文/译文与报告、术语和 CSP 业务恢复目录由 owner resolver 选择；显式参数/profile 优先，seed 保持 backend 源码 |
| bos-plugin | 正式文本/Excel 与私有 draft 分离；旧草稿和显式输出保持兼容 |
| iris-cure-form-dev | 新任务选本地 work 根；已有任务/profile 保留；只把选定正式交付放知识库 |
| extract-doc / iris-interface-dev | 摄取结果与接口专题复用 extract owner 的目录；显式项目输出保留 |
| iris-imedical-doctor-ai | 正式 AI 集成交付用 owner 目录，业务数据和框架源分开 |
| coding-iris-plugin、codegraph 类 | 已有本地 work 和源码选择仍由 owner 负责；导出暂存不作为正式知识 |
| UI / 其它能力 | 原本只在对话交付的能力不强制生成报告；新增持久产物先声明用途与创建时机 |

未声明路径的能力保持其既有契约，不能靠通用分类器猜测。各 owner 逐步接入时，同步其脚本/profile/skill 示例与测试；旧业务材料只有在明确授权后迁移。项目自定义规则、忽略策略、凭据和私有配置不被目录初始化覆盖。
