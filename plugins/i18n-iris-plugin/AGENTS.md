# AGENTS.md

## 插件定位

`i18n-iris-plugin` 提供 IRIS/ObjectScript/CSP/HISUI 工程的通用 i18n agent 能力。

插件只承载通用 rules、skills、templates 和初始化说明；目标工程差异必须写入目标工程 `.agents/config/i18n_project_profile.md`，MCP 连接信息必须以目标工程 `.mcp.json` 为准。

## 使用约束

- 不在插件 rules/skills 中硬编码服务器、namespace、账号、密码、远程路径、业务页面清单或工程种子类。
- 前端编码必须复用 coding-iris profile 的 `standard-gb2312` / `project-utf8` 模式；实际文件字节检测是最终门禁。
- 涉及项目差异时读取目标工程 `.agents/config/i18n_project_profile.md`。
- 涉及服务器操作时读取目标工程 `.mcp.json`。
- 默认先做只读提取、生成和 report-only 校验；写入本地种子文件、上传、编译、加载翻译必须由用户明确要求。
- 页面级翻译默认使用 `^websys.TranslationD("PAGE",...)`，字典翻译默认使用 `BDP_Translation`；只有目标工程已有不同机制时才在 profile 中覆盖。

## Skill 路由

- 初始化目标工程：`skills/i18n-project-init/SKILL.md`
- 编码改造：`skills/i18n-coding/SKILL.md`
- 文本提取：`skills/i18n-text-extract/SKILL.md`
- 页面翻译种子：`skills/i18n-page-trans-seed/SKILL.md`
- 字典翻译种子：`skills/i18n-bdp-trans-seed/SKILL.md`
- XML 模板翻译：`skills/i18n-xml-template/SKILL.md`
- CSP 翻译同步：`skills/i18n-csp-trans-sync/SKILL.md`
- XML 打印模板同步：`skills/i18n-xml-print-template-sync/SKILL.md`（仅用于已确认存在 XML 模板记录的打印链路）

## 规则入口

- 总索引：`rules/i18n_index.md`
- 语言目录：`rules/i18n_language_catalog.md`
- 前端编码：`rules/i18n_coding_frontend.md`
- 后端编码：`rules/i18n_coding_backend.md`
- 前端提取：`rules/i18n_extract_frontend.md`
- 后端提取：`rules/i18n_extract_backend.md`
- 页面翻译种子：`rules/i18n_page_translation_seed.md`
- 字典翻译种子：`rules/i18n_dict_translation_seed.md`
- 链路定位：`rules/i18n_link_tracing.md`
- 数据分类：`rules/i18n_field_classification.md`
- 验证规则：`rules/i18n_verify.md`
