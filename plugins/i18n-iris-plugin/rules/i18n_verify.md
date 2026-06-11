---
name: i18n_verify
description: Use when verifying completed i18n coding, extraction, translation seed, template, or sync work.
task-affinity: [i18n, verify, testing, review]
related:
  - i18n_index.md
---

# 国际化验证规则

本规则用于国际化需求处理的验证阶段，提供通用验证检查清单。各 skill 可引用本规则的通用项，但应保留自身特化检查。

## 适用范围

适用于国际化编码改造、翻译表生成、模板翻译和种子写入完成后的验证。按实际涉及的阶段选择检查项。

## 编码改造验证

- 扫描改造文件，确认没有新增 `b //`、`b ;`、`b ;xkl` 等 ObjectScript 调试断点。
- 扫描前端文件，确认没有新增 `console.log` 临时调试输出。
- 前端 `.csp` / `.js` / `.css` 文件编码必须符合 `iris_project_profile.md`；profile 要求 GB2312/GBK 时，使用 `coding-iris-plugin` 的 `check-frontend-encoding.ps1 -ExpectedEncoding gb2312 -ErrorOnMismatch` 或等价方式确认未被 i18n 改造永久转成 UTF-8。
- 扫描打印链路中的裸中文拼接，确认用户可见文本已按固定文案或字典展示值分流处理。
- 确认 UI 框架自动翻译文本（如 datagrid 列头 `title: "中文"`）未被错误包裹 `$g()` 或 `$trans()`。
- 确认字典展示值使用字典翻译 helper，未混用页面级翻译 helper。
- 字典展示值检查必须覆盖主方法调用的子方法；若子方法组装返回值或追加数组/JSON 行，也要检查其返回字段中的字典展示值是否贴近来源完成翻译。
- 确认页面级提示使用页面级翻译 helper，未混用字典翻译 helper。

## 翻译表验证

- UI 框架自动翻译文本即使代码未改，也已进入翻译表。
- JS datagrid 列头和消息提示已交叉比对。
- 后台类文案已追踪到入口主页面。
- 占位符文案（`{0}`、`{1}`）已写明语义。
- 翻译表使用目标语言命名，输出位置以项目 profile 为准。

## 模板验证（XML 打印模板）

以下检查项适用于已确认存在 XML 模板链路的打印需求：

- XML 解析：用 XML parser 加载输出文件，不只靠肉眼检查。
- defaultvalue 残留：`defaultvalue` 中不残留源语言文本（可接受残留数量为 0 或极少量配置项）。
- 编码一致：输出编码与 XML 声明一致；若不一致，报告说明原因。
- 保留项：字体名、打印机名、编码声明、业务占位符（如 `[PatName]`）未被误翻译。
- 坐标保留：标准版除 `defaultvalue` 外不改其它属性（`xcol`、`yrow`、`fontname`、`fontsize` 等）。
- layout 版调整：只调整报告列出的静态 label 和相关动态 value 坐标。
- fallback 行为：中文源语言、缺少目标语言模板、存在目标语言模板三种场景都应验证模板代码 fallback 行为。

## 种子验证（页面翻译种子）

- 写入/回滚数量与翻译表条目数一致。
- 引号转义正确（`'`、`"`、换行已按 ObjectScript 字符串规则转义）。
- 方法命名合法（是运行时允许的合法标识）。
- 回滚只按语言、页面、条目生成逐条 Kill，未生成按语言根节点整棵删除的逻辑。

## 种子验证（字典翻译 SQL）

- SQL 字段名使用运行时代码实际识别的属性名，不混用数据库列名。
- 多字段字典已分别生成条目和 SQL。
- 排除项（标准代码、人名、机构名、数值、测量值、内部占位值）未被误包含。

## 编译验证

- 后端 `.cls` 文件编码为 UTF-8。
- 前端文件编码按项目约定（通常 GB2312）。
- 用户明确要求时，才按 `.mcp.json` 映射的 IRIS 编译能力编译种子类或后端类。默认不做服务器编译、上传或加载。

## 完成报告

验证完成后，报告应包含：

- 涉及的文件和改造范围。
- 各检查项的通过/问题状态。
- 仍需人工确认的项（如 UI 框架自动翻译边界、外部接口返回值）。
- 源语言残留数量（模板场景）。
