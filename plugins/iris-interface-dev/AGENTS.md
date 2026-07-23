# AGENTS.md

## 插件定位

`iris-interface-dev` 提供 IRIS 接口开发的文档优先能力：接口文档落盘、结构化抽取、字段匹配诊断、接口开发计划、接口实现和离线审查。

本插件先明确文档和字段事实，再执行范围/计划门禁，并由 `iris-interface-build` 编排本地实现。IRIS/ObjectScript、CSP、JavaScript、HISUI 编码规则与代码审查必须复用 `coding-iris-plugin`；上传、编译、部署和远端验证继续交给该插件且需要用户明确授权。

## 使用约束

- 文档解析结果必须写入目标项目 `docs/interface/<doc-name>/`，不得把完整文档内容默认塞进会话上下文。
- MarkItDown 只是可选转换器；文档转换与解析统一委托 `extract-doc`。
- `.doc` 文件只做可选转换；缺少可用转换器时提示用户另存为 DOCX。
- `rules/` 只承载路由、流程和审查硬约束；大体量 HIS 数据流、MOC、接口索引、历史规则库和样例进入 `references/`。
- 来源工程的大生成器不进入 v1；任何生成物若包含点号循环体，必须在离线审查阶段失败。
- 不在插件内保存连接、账号、密钥、远端路径、项目专属包路径或接口注册事实。

## Skill 路由

- 首次初始化：`skills/iris-interface-init/SKILL.md`
- 文档落盘和结构化抽取：`skills/iris-interface-doc-ingest/SKILL.md`
- 字段匹配诊断：`skills/iris-interface-field-match/SKILL.md`
- 接口开发计划：`skills/iris-interface-dev-plan/SKILL.md`
- 接口实现（写代码）：`skills/iris-interface-build/SKILL.md`

## 规则入口

- 总索引：`rules/iris_interface_index.md`
- 八步工作流：`rules/iris_interface_workflow.md`
- 离线审查：`rules/iris_interface_review.md`

## 内置脚本

- `scripts/generate-plugin-thin-index.ps1`：thin-index wrapper，只委托根 canonical 脚本。
- `scripts/iris-interface-field-match.py`：字段语义匹配、候选诊断和人工确认摘要。
- `scripts/iris-interface-review.py`：字段产物和生成代码风险离线审查。
