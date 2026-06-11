---
name: i18n_link_tracing
description: Use at the start of page-level or print-level i18n work to locate actual call chains and data shapes.
task-affinity: [i18n, tracing, discovery, planning]
related:
  - i18n_field_classification.md
---

# 国际化链路定位规则

执行本规则前必须先读取 `.agents/config/i18n_project_profile.md`。本规则用于在国际化需求处理初期定位实际调用链路和数据形态，为后续数据分类和编码改造提供事实基础。

## 适用范围

适用于页面级和打印级国际化需求的链路定位。不绑定具体渲染路径，不做链路预设。

## 定位顺序

按以下顺序逐步确认，不要跳步：

1. 从入口页或按钮事件定位实际调用的后端方法。
2. 抓取实际返回的数据，先判断数据形态。
3. 查找是否存在模板字段。
4. 判断渲染路径。
5. 标注中文残留位置。

## 入口定位

- 从 CSP 文件出发，找到 `<csp:Include>` 引入的 show 文件和 `<script>` 引入的 JS 文件。
- 在 JS 文件中找到 `$cm({ ClassName, MethodName })` 或等价调用，定位后端类和方法。
- 在后端类中追踪完整调用链（例如 BLH → SQL/DATA）。
- 标注每层涉及的文件。

## 数据形态判断

抓取实际返回数据后，先判断形态，不预设为 JSON：

| 形态 | 判断标准 | 典型场景 |
|---|---|---|
| JSON 对象 | 返回值可直接 `.%ToJSON()` 或已是 JSON 字符串 | 打印数据对象 |
| 字符串拼接 | 使用 `$C(2)`、`^`、`\|` 等分隔符组合字段 | 申请单参数 |
| HTML/XML 片段 | 返回值包含 HTML 标签或 XML 结构 | 直出打印页面 |
| 类 JSON 字符串 | 看似 JSON 但包含非标准转义或嵌套拼接 | 历史遗留 |
| 其它 | 无法归入以上类别 | 标记待确认 |

## 模板字段查找

在后端代码和返回数据中查找是否存在模板标识字段：

- 常见字段名：`PrintTemp`、`PreviewXMLName`、`templateId`、`xptCode`、`XPC_Code`。
- 项目可能使用特有字段名，以 project profile 或实际代码为准。
- 找到模板字段后，继续追踪该字段是否经过国际化模板匹配 helper（如 `GetI18nXMLPrintTemplate`）。

## 渲染路径判断

根据链路事实判断实际渲染路径：

| 路径 | 判断依据 | 后续处理 |
|---|---|---|
| XML 打印模板 | 存在模板字段，且模板记录存储在 `User.DHCXMLPConfig` 或等价表 | 可触发 `i18n-xml-print-template-sync` |
| HTML/CSP 直出 | 后端直接输出 HTML 片段到 CSP 页面 | 按后端编码规则处理 |
| 字符串直出 | 后端返回拼接字符串，前端直接展示 | 按后端编码规则处理 |
| 第三方打印接口 | 调用当前工程无法看到源码的外部接口 | 标记"外部接口返回"，不改代码 |

不要用某个历史需求的链路替代当前需求的实际链路。

## 中文残留位置标注

对链路中发现的每个用户可见中文文本，标注其位置和来源：

- 模板层：XML 打印模板的 `defaultvalue`。
- 后端固定文案：代码中硬编码的标题、页码、标签、金额单位。
- 字典展示值：从 Global、SQL、持久类字段、字典表字段取出的原文展示值。
- 业务输入：备注、用户手工录入、病人或医生临时输入。
- 外部接口返回：当前工程无法看到源码或归属其他业务组的接口返回值。

## 输出格式

链路定位完成后，输出链路事实报告供后续阶段使用：

```markdown
# 链路事实报告 - {需求号}
## 入口
- 入口 CSP: xxx.csp
- 触发事件: 按钮点击 / 页面加载 / 打印预览
## 调用链
- JS 方法: xxx.js:methodName → $cm({ ClassName, MethodName })
- 后端类: Package.Class.Method
## 数据形态
- 返回类型: JSON / string / HTML 片段
- 包含模板字段: PrintTemp=xxx / 无
## 渲染路径
- XML 模板 / HTML 直出 / 字符串直出 / 第三方
## 中文残留位置
- [位置1]: 模板 defaultvalue
- [位置2]: 后端固定文案
- [位置3]: 字典展示值
```

## 禁止事项

- 不要预设 `PrintTemp`、`templateId` 或 `GetXMLTemplateId` 存在于所有打印链路。
- 不要预设打印返回数据一定是 JSON。
- 不要预设所有打印都使用 XML 打印模板。
- 不要预设预览和打印共用同一模板解析路径。
- 无法确认的链路环节标记"待确认"，不猜测。
