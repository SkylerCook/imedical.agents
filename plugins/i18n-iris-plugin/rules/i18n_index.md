# 国际化规则索引

本文件只做通用入口索引。执行国际化任务时，先读取 `.agents/config/i18n_project_profile.md` 获取当前项目适配，再按任务类型读取对应规则，避免把编码、提取、翻译数据保存和 MCP 部署流程混在一起。

## 源语言与目标语言

- 源语言、默认目标语言、语言目录来源以 `.agents/config/i18n_project_profile.md` 为准。
- 默认约定是简体中文作为源文案 key，目标语言通过 `targetLanguage` 指定。
- 目标语言的 `langId` 或语言代码必须从项目 profile 指定的语言目录解析；不得把某个环境的语言 id 当作通用常量。

## 规则入口

- [前端国际化编码规则](i18n_coding_frontend.md)：CSP、JavaScript、CSS、UI 框架自动翻译边界、placeholder、tooltip、datagrid、messager。
- [后端国际化编码规则](i18n_coding_backend.md)：页面级翻译 helper、显式页面码、字典/表字段展示值翻译、跨页面归属。
- [国际化链路定位规则](i18n_link_tracing.md)：需求处理初期的调用链路定位、数据形态判断、渲染路径识别和中文残留位置标注。
- [国际化数据分类规则](i18n_field_classification.md)：用户可见文本的统一分类体系和处理方式映射。
- [后端打印国际化编码规则](i18n_coding_print_backend.md)：实际打印返回数据、XML 模板名、分页、条码数据、申请单/告知单/病理单打印链路。
- [国际化验证规则](i18n_verify.md)：编码改造、翻译表、模板、种子、调试断点和编译的通用验证检查清单。
- [字典翻译公共门面规则](i18n_dict_translate_facade.md)：`DHCDoc.Common.Translate.GetTransXxx`、命名唯一性、Global 到类字段定位、GetData 协同。
- [前端需翻译文本提取规则](i18n_extract_frontend.md)：从 CSP/JS/CSS 提取可见中文和 UI 框架自动翻译文本。
- [后端需翻译文本提取规则](i18n_extract_backend.md)：从后端程序和 CSP 服务端代码提取后台提示与占位符语义。
- [目标语言翻译质量规则](i18n_translation_quality.md)：中文 HIS/医疗系统 UI 文案翻译到目标语言时的术语、正字法、长度和结构化输出安全。
- [页面级翻译保存规则](i18n_page_translation_seed.md)：非字典页面级翻译种子与回滚。
- [字典数据翻译保存规则](i18n_dict_translation_seed.md)：字典/表字段展示值翻译保存。
- [HISUI i18n 自动翻译边界索引](i18n_hisui_widget_index.md)：当前项目使用 HISUI 时，用于确认框架自动翻译边界，避免重复包裹翻译 helper。

## 总原则

- 只翻译面向用户展示的文本；不翻译编码、字段名、类名、URL 或持久化标识。细节见 `i18n_coding_backend.md`、`i18n_coding_frontend.md` 和 `i18n_translation_quality.md`。
- 带 `{0}`、`{1}` 等占位符的文案可调整占位符顺序，但不得增删占位符；翻译前必须确认占位符语义。细节见 `i18n_translation_quality.md`。
- 多语言改造不得改变业务流程、权限判断、校验逻辑、数据库持久化或状态流转。
- 生成目标语言翻译前必须读取 `i18n_translation_quality.md`，不得牺牲医疗语义、目标语言正字法、UI 简洁性或结构化输出安全。
- 编辑历史乱码文件前先确认实际编码，尽量最小改动，避免整文件重写造成大面积无关 diff。

## MCP 与部署

- 涉及服务器的任务必须先读取工程根目录 `.mcp.json`。
- `.mcp.json` 是 MCP 连接配置唯一事实来源；rules/skills 不保存服务器、账号、密码、namespace 或远程路径。
- skill 只描述抽象能力，例如 IRIS 命令执行、文档编译、类方法执行、SQL 查询、SFTP 上传；具体工具由当前会话实际可用 MCP 与 `.mcp.json` 匹配。
- **默认只做只读验证和本地生成**。服务器写入、SFTP 上传、编译、加载翻译均为可选流程，仅用户明确要求时执行。

## 完成检查

- 编码改造已按前端/后端规则处理。
- 文本提取已覆盖 UI 框架自动翻译文本、JS datagrid 列头、messager 提示、后台翻译 helper 文案。
- 翻译表使用目标语言命名，输出位置以项目 profile 为准。
- 页面级翻译按语言、页面、条目写入或生成种子。
- 字典翻译按项目 profile 指定的字典翻译存储规则生成。
- 回滚只按语言、页面、条目处理，严禁删除整个语言根节点。
