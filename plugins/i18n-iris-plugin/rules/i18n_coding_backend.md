---
name: i18n_coding_backend
description: Use when applying backend i18n changes to ObjectScript, server-side CSP blocks, prompts, errors, or table display values.
task-affinity: [i18n, iris, objectscript, backend, coding]
related:
  - i18n_index.md
  - i18n_dict_translate_facade.md
---

# 后端国际化编码支持规则

执行本规则前必须先读取 `.agents/config/i18n_project_profile.md`，确认当前项目的后端翻译 helper、页面码来源和字典/表字段翻译方式。

## 适用范围

适用于后端程序、页面服务端代码块、后台返回前端的提示/校验/错误信息，以及表字段展示值翻译。

## 页面级非字典提示

后台提示、校验信息、错误信息、状态操作提示统一使用 project profile 指定的页面级翻译 helper。

明确需要指定页面码时，使用 project profile 指定的显式页面码 helper。

要求：

- 源文案使用完整源语言 key。
- 变量使用 `{0}`、`{1}` 等占位符。
- 不要把源语言提示直接拼接后返回前端。
- 页面服务端代码块中的后台提示同样按后端规则处理，翻译表类型记为 `backend-message` 或 profile 指定的等价类型。

## 页面码归属

- 非字典翻译保存归属必须是入口主页面。
- 局部页面、被引用页面、后台类文件本身不是默认翻译归属页面。
- 多页面共用后台接口时，必须追踪调用链，确认所有可能触发该文案的入口主页面。
- 自动上下文不可靠时，使用显式页面码 helper。

## 表数据与字典展示值

表字段展示值、字典名称、描述等不使用页面级翻译 helper，统一使用 project profile 指定的字典/表字段展示值翻译 helper。详细分类和处理方式映射见 `i18n_field_classification.md`。

涉及字典/表字段展示值时，必须继续读取 `i18n_dict_translate_facade.md`，优先使用项目 profile 指定的公共字典翻译门面。当前 IRIS 医生站默认门面为 `DHCDoc.Common.Translate.GetTransXxx`。

要求：

- 只翻译展示值，不改变保存值。
- 实体名使用运行时代码实际识别的名称。
- 字段名使用运行时代码实际识别的属性名。
- 输出到 HTML/JS/JSON 且存在特殊字符风险时，按场景传入转义参数或等价选项。
- 首次遇到新的字典/表字段展示值翻译时，优先补公共 `GetTransXxx` 方法，再改业务代码调用。
- 只有公共门面不存在且本次不适合新增时，才临时使用 `%TranslateTableFieldValue(...)`，并在输出中说明原因。

## 禁止翻译

- `id`、`code`、状态码、字典编码。
- 类名、表名、字段名、方法名、URL、接口参数名。
- 用于保存、查询、关联的持久化标识。

## 输出要求

后端非字典页面级文案进入页面级翻译表，类型为 `backend-message`。字典/表字段展示值进入字典翻译表，类型为 `backend-dict`。
