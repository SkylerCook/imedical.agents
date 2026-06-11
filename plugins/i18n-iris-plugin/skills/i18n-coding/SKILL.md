---
name: i18n-coding
description: Use when applying frontend or backend internationalization coding changes for files, directories, or project scopes while preserving source-language keys.
---

# I18N Coding — 国际化编码改造

## 触发条件

当任务要求对单文件、多文件、目录或整个工程做国际化编码改造时使用本 Skill。

编码改造只保留源语言文案 key，不绑定具体目标语言。源语言、默认目标语言和项目 helper 以 `.agents/config/i18n_project_profile.md` 为准。

## 必读规则

1. `.agents/config/i18n_project_profile.md`
2. i18n 规则索引：优先读取目标工程 `.agents/rules/i18n_index.md`；引用插件时读取插件 `rules/i18n_index.md`

按条件继续读取：

- 前端文件读取 `i18n_coding_frontend.md`。
- 前端文件写入 `.csp` / `.js` / `.css` 时，同时读取 `coding-iris-plugin/rules/iris_coding_frontend.md`；涉及上传、编码转换或远端验证时继续读取 `coding-iris-plugin/rules/iris_coding_workflow.md`。
- 后端文件读取 `i18n_coding_backend.md`。
- 后端涉及字典/表字段展示值时读取 `i18n_dict_translate_facade.md`。
- 后端打印链路、实际打印返回数据读取 `i18n_coding_print_backend.md`。
- 涉及打印或复杂页面链路时，先读取 `i18n_link_tracing.md` 定位实际调用链路。
- 涉及多种数据形态时，读取 `i18n_field_classification.md` 对用户可见文本分类。
- 验证阶段读取 `i18n_verify.md`。
- UI 框架行为不确定时读取 profile 指定的控件索引或源码索引。

## 输入范围

支持：

- 单个 CSP / JS / CSS / CLS 等程序文件。
- 多个指定文件。
- 目录。
- 工程范围。

开始前先确认实际文件编码。历史乱码文件只做最小改动；GB2312/GBK 前端文件必须保持原编码，除非用户明确要求永久转码。

## 前端改造

- 改造前先判断文本是否属于 UI 框架自动翻译；属于时不改代码，只记录到后续翻译表。
- 改造前后确认前端文件编码；profile 要求前端 GB2312 时，收尾使用 `check-frontend-encoding.ps1 -ExpectedEncoding gb2312 -ErrorOnMismatch` 或等价方式确认未漂移为 UTF-8。
- 静态文案使用 profile 指定的前端静态翻译 helper。
- 带变量文案使用 profile 指定的占位符翻译 helper。
- 已确认由 UI 框架自动翻译的文本不改代码，但记录到后续翻译表。
- 含变量拼接、动态文案、非 UI 框架自动处理文本必须改造。
- datagrid / treegrid 列头 `title: "中文"` 默认属于 UI 框架自动翻译，禁止改成 `$g("中文")`。

## 后端改造

- 页面级后台提示使用 profile 指定的页面级翻译 helper。
- 必须显式页面上下文时使用 profile 指定的显式页面码 helper。
- 表字段/字典展示值使用 profile 指定的字典/表字段翻译 helper，分类规则见 `i18n_field_classification.md`。
- 首次遇到新的字典/表字段展示值翻译时，计划或实现必须包含“补公共 `GetTransXxx` 方法 + 注释 + 业务调用”。
- 打印链路按 `i18n_coding_print_backend.md` 处理模板 fallback、文案分类和调试断点扫描。XML 模板同步只在链路定位确认存在 XML 模板记录后触发。
- 不改变业务流程、权限、校验、持久化或状态流转。

## 阶段化执行（复杂需求推荐）

当需求涉及多个文件、多种数据形态或打印链路时，按以下阶段执行：

1. 先读 `i18n_link_tracing.md`，定位实际调用链路，输出链路事实报告。
2. 再读 `i18n_field_classification.md`，对用户可见文本分类，输出字段分类清单。
3. 按清单执行编码改造（前端 + 后端）。
4. 按需执行 template/seed 技能（仅当链路定位确认需要时）。
5. 按 `i18n_verify.md` 验证。

阶段化执行是推荐模式，不强制。简单需求（单文件、明确链路）仍可直接执行编码改造。

## 产出

- 完成代码改造。
- 列出需进入翻译表的文案范围。
- 标记无法确认的主页面、占位符语义或 UI 框架自动翻译边界。
- 提醒继续执行 `i18n-text-extract` 和对应的翻译种子 skill。
- 复杂需求应产出链路事实报告和字段分类清单。

## 需求完成后的经验沉淀

需求处理完成后，检查本次是否产生可跨需求复用的经验，并按需更新 `feedback/experience/demand-com-exp.md`。

需要沉淀的情况：

- 本次遇到现有 rules/skills 未覆盖的坑、边界或判断标准。
- 本次验证出可复用的工程模式、处理顺序或检查项。
- i18n 场景包括链路定位、字段分类、模板 fallback、字典翻译位置、UI 自动翻译边界或翻译种子验证经验。
- 已有经验条目再次命中本次需求：追加需求号并 `命中+1`；没有明确需求号时，记录可追溯的任务标题或不更新命中计数。

沉淀要求：

- 先搜索已有条目，能合并就合并，不重复新增。
- 按 `feedback/experience/demand-com-exp.md` 的分类和条目格式记录。
- 不写服务器、账号、namespace、远程路径、患者样本等敏感信息。
- 不复制长段命令输出、完整 diff 或一次性排障流水。
- 没有可复用经验时不写；不强制每次需求都沉淀。
