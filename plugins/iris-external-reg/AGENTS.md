# AGENTS.md

## 插件定位

`iris-external-reg` 提供 IRIS 第三方预约挂号接口开发工作流，覆盖接口规范解析、执行计划编写、公共组件抽取、ObjectScript 实现、`DHCExternalService.RegInterface` 对接和测试验证。

文档读取和结构化落盘必须复用 `extract-doc` 插件；IRIS/ObjectScript 编码、上传、编译、部署和远端验证必须复用 `coding-iris-plugin` 及目标项目规则。

## 使用约束

- 接口规范文档解析由 `extract-doc` 生成 Markdown、结构化 JSON、字段摘要和诊断文件，不在对话上下文中粘贴完整文档。
- 本插件只保存可复用流程、参考资料和开发约束，不保存服务器地址、账号、密码、token、namespace、远端路径或项目私有连接事实。
- 涉及真实 HIS 数据源、Global 片段、院区映射、状态码和远端能力时，以目标项目按需导出的文件和用户确认结果为准。
- 执行计划必须先经用户确认，再进入代码实现。

## Skill 路由

- 第三方预约挂号接口开发：`skills/iris-external-reg/SKILL.md`

## 规则入口

- 总索引：`rules/iris_external_reg_index.md`

## 参考资料

- 执行计划写法：`references/execution-plan-guide.md`
- ObjectScript 开发规则：`references/external-dev-rules.md`
- JSON 对象互转：`references/json-to-obj.md`
- XML 对象互转：`references/xml-to-obj.md`
- RegInterface 索引：`references/reginterface-wiki-index.md`
- RegInterface 详细说明：`references/reginterface-wiki.md`

## 内置脚本

- `scripts/generate-plugin-thin-index.ps1`：thin-index wrapper，只委托根 `.agents/scripts/generate-plugin-thin-index.ps1`。
