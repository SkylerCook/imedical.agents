# AGENTS.md

## 插件定位

`i18n-iris-plugin` 提供 IRIS/ObjectScript/CSP/HISUI 工程的通用 i18n agent 能力。

插件只承载通用 rules、skills、templates 和初始化说明；目标工程差异必须写入目标工程 `.agents/config/i18n_project_profile.md`，MCP 连接信息必须以目标工程 `.mcp.json` 为准。

## 使用约束

- 不在插件 rules/skills 中硬编码服务器、namespace、账号、密码、远程路径或业务页面清单。页面翻译种子默认使用 canonical `DHCDoc.I18n.PageTranslationSeed`；目标工程已有兼容机制时才在 profile 中覆盖类名、相对源码路径或方法名。
- 前端编码必须复用 coding-iris profile 的 canonical `utf8` 模式；`project-utf8` 仅兼容读取，`standard-gb2312` 仅用于用户明确指定的历史工程，实际文件字节检测是最终门禁。
- 涉及项目差异时读取目标工程 `.agents/config/i18n_project_profile.md`。
- 涉及服务器操作时读取目标工程 `.mcp.json`。
- 默认先做只读提取、生成和 report-only 校验；远程翻译数据写入与业务代码部署必须分别获得当前运行、目标环境和明确 scope 的授权，扩大范围、覆盖、删除或回滚需重新确认。
- 页面级翻译默认使用 `^websys.TranslationD("PAGE",...)`，字典翻译默认使用 `BDP_Translation`；只有目标工程已有不同机制时才在 profile 中覆盖。
- 页面翻译种子类固定默认公共契约：`SetPageTrans` / `KillPageTrans` 负责单条写入与回滚，`Load{LANG}Translation` / `Kill{LANG}Translation` 负责语言聚合；需求批次方法继续使用带批次号的动态命名。字典翻译 SQL 与 XML 模板同步不并入该类。
- canonical 类模板位于 `templates/DHCDoc/I18n/PageTranslationSeed.cls`。目标文件不存在时只能在明确的页面翻译种子实现任务中按模板创建；已有文件必须校验并增量修改，不得由初始化器或更新器覆盖。
- 前端翻译 helper 的 key 必须保持稳定字面量；运行时值只能作为占位符参数传入。修改 JS/CSP helper 后使用 `scripts/check-i18n-helper-usage.js` 做只读静态检查，失败不得继续交付。

## Skill 路由

- 初始化目标工程：`skills/i18n-project-init/SKILL.md`
- 编码改造：`skills/i18n-coding/SKILL.md`
- 文本提取：`skills/i18n-text-extract/SKILL.md`
- 页面翻译种子：`skills/i18n-page-trans-seed/SKILL.md`
- 字典翻译种子：`skills/i18n-bdp-trans-seed/SKILL.md`
- XML 模板翻译：`skills/i18n-xml-template/SKILL.md`
- CSP 翻译同步：`skills/i18n-csp-trans-sync/SKILL.md`
- XML 打印模板同步：`skills/i18n-xml-print-template-sync/SKILL.md`（仅用于已确认存在 XML 模板记录的打印链路；远端保存遇到临时类 `Execute+...<SYNTAX>` 时按 skill 的分块 fallback 收敛，不重跑前序产物）

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

## 内置脚本

- `scripts/check-i18n-helper-usage.js`：只读扫描指定 JS/CSP 文件，阻断动态翻译 key；支持从项目 profile 传入静态 helper 与占位符 helper 名称。
- `scripts/generate-plugin-thin-index.ps1`：转发根 canonical thin-index 生成器。
- `scripts/sync-xml-print-template.ps1`：XML 打印模板同步与受控 fallback。
