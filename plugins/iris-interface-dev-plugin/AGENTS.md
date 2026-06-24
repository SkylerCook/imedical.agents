# AGENTS.md

## 插件定位

`iris-interface-dev-plugin` 提供 IRIS 接口开发的文档优先能力：接口文档落盘、结构化抽取、字段匹配诊断、接口开发计划和离线审查。

本插件 v1 不承诺自动生成可编译 ObjectScript 代码。IRIS/ObjectScript 编码、代码审查、上传、编译、部署和远端验证必须复用 `coding-iris-plugin`。

## 使用约束

- 文档解析结果必须写入目标项目 `docs/output/iris-interface/<doc-name>/`，不得把完整文档内容默认塞进会话上下文。
- MarkItDown 只是可选转换器；不可用时使用插件脚本内置的 DOCX、PDF、XLSX 解析链路。
- `.doc` 文件只做可选转换；缺少可用转换器时提示用户另存为 DOCX。
- `rules/` 只承载路由、流程和审查硬约束；大体量 HIS 数据流、MOC、接口索引、历史规则库和样例进入 `references/`。
- 来源工程的大生成器不进入 v1；任何生成物若包含点号循环体，必须在离线审查阶段失败。
- 不在插件内保存连接、账号、密钥、远端路径、项目专属包路径或接口注册事实。

## Skill 路由

- 首次初始化：`skills/iris-interface-init/SKILL.md`
- 文档落盘和结构化抽取：`skills/iris-interface-doc-ingest/SKILL.md`
- 字段匹配诊断：`skills/iris-interface-field-match/SKILL.md`
- 接口开发计划：`skills/iris-interface-dev-plan/SKILL.md`

## 规则入口

- 总索引：`rules/iris_interface_index.md`
- 七步工作流：`rules/iris_interface_workflow.md`
- 离线审查：`rules/iris_interface_review.md`

## 内置脚本

- `scripts/generate-plugin-thin-index.ps1`：thin-index wrapper，只委托根 canonical 脚本。
- `scripts/iris-interface-doc-ingest.py`：文档转换、结构化抽取和落盘。
- `scripts/iris-interface-field-match.py`：字段语义匹配、候选诊断和人工确认摘要。
- `scripts/iris-interface-review.py`：字段产物和生成代码风险离线审查。
