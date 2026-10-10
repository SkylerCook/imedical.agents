# CSP 页面开发

新建 CSP/HTML、JS、CSS 前读取[前端命名与格式规范](../references/frontend-coding-format.md)。以下是通用结构示例，不含特定工程的主题加载器、Broker 或生命周期封装。实际页面拆分、路径、控件和请求 API 按项目 profile 与[前端规则](../rules/iris_coding_frontend.md)选择；HISUI 项目优先复用其能力。

## 通用页面示例

示例使用同目录文件展示引用关系；落地时按 profile 的 CSP、JS、CSS 路径调整，不据此移动历史文件。页面内脚本位于主体之后，示例 JS 的 DOM 查询在元素创建后执行。

```csp
<!DOCTYPE html>
<html lang="zh-CN">
    <head>
        <meta charset="utf-8">
        <title>页面示例</title>
        <link rel="stylesheet" href="patient-search.css">
    </head>
    <body>
        <div id="patientSearch" class="patient-search">
            <p id="patientSummary" class="patient-search-summary"></p>
        </div>
        <script src="patient-search.js"></script>
    </body>
</html>
```

```javascript
(function () {
    var summaryElement = document.getElementById("patientSummary");

    function showSummary(displayName) {
        if (summaryElement !== null) {
            summaryElement.appendChild(document.createTextNode(displayName));
        }
    }

    showSummary("查询结果");
}());
```

```css
.patient-search {
    padding: 8px;
}

.patient-search-summary {
    margin: 0;
}
```

示例仅展示格式，文字进入实际项目时仍执行条件 i18n 门禁；不根据示例假设所有工程都已启用翻译 helper。DOM API、库与目标浏览器的兼容性仍需验证，不把 ES5 语法当作兼容性证据。

## CSP 混合区域

标准服务端脚本可使用 `<script language="cache" runat="server">`，内部按 [CLS 规范](../references/cls-coding-format.md)编写。下面只展示服务端定义与 HTML 文本上下文的输出，不把动态值直接拼入客户端 JS。

```csp
<script language="cache" runat="server">
    s displayName = "示例名称"
</script>
<p>#(..EscapeHTML(displayName))#</p>
```

| 语法 | 含义与边界 |
|---|---|
| `#(expression)#` | 运行期表达式；输出需按所在上下文处理 |
| `##(expression)##` | 编译期表达式，不是 HTML 转义 |
| `<csp:if>` / `<csp:elseif>` / `<csp:else>` | CSP 服务端条件结构，属性按目标版本核对 |
| `<csp:Include Page="...">` | 包含页面，路径和执行顺序按项目契约 |

HTML 文本、属性、JS 字符串和 URL 的转义不同；上例的 `EscapeHTML` 不作为其它上下文的通用编码器。语法依据及 Review 边界见[前端规范](../references/frontend-coding-format.md#html-与-csp)，未编译示例不得称为目标 IRIS 验证通过。

## 项目专属接入

页面 JS 的普通/闭包组织及初始化职责见[可选 JS 页面模板](javascript-page-template.md)；仅在目标项目具备其依赖和容器契约时采用。

- 框架页与内容页的拆分、文件命名和存放位置以 profile 为准，不固定某个子系统前缀或源码目录。
- `<DOC:HEAD>` 按目标工程实际 CSR 能力选用，不按新旧版本或 doctor-dev 类型推断。先在 profile 指向的 CSP 源码中查找 `DHCDOC.csr`，定位 `<csr:rule name="DOC.HEAD" match="DOC:HEAD">`；文件名只是定位线索，实际以匹配规则及 action 为准。
- 找到规则后核对 action 调用的后端实现及资源依赖，确认目标工程源码具备接入能力即可按该契约编写；本地存在不代表目标服务器已注册或编译生效，不要求为本地编码新增远程探测。部署获授权后再验证编译和运行结果。
- 规则缺失时，继续在目标工程相关 CSR 中查找相同 match；仍无实现时保留基础 HTML 骨架，按项目现有方式引入公共 JS/CSS，不插入未定义标签，也不为套模板自行升级框架。源码范围不完整时标记待确认，不断言项目一定不支持。
- `DOC:HEAD` 与 `DHCDOC:HEAD` 是不同的 match，不能因名字相近互换。参数与 `docBodyAttr` 等输出变量以命中的 action 及调用实现为准；`<server>` 等其它项目标签独立核对，不能由 HEAD 规则存在推断全部标签或生命周期均可用。
- `cspInitClosure`、`xhrRefresh`、`onBeforeCloseTab`、`chartOnBlur` 等生命周期入口仅在项目确有该契约时使用。先加载依赖、定义所需对象和参数，再初始化；不复制未定义的占位变量。
- 后端请求复用 profile 指定封装，逐项核对参数名、顺序、传输方式与响应结构，不固定 Broker 类名或服务器路径。
