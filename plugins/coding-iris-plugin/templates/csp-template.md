# CSP 页面开发

> 适合创建或修改 CSP 页面时阅读。

## 标准 CSP 结构

```csp
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <DOC:HEAD></DOC:HEAD>
    <!--此处引入页面所需js、css-->
    <Server>
        // 服务端代码块 — 页面渲染前执行
        set Param1 = %request.Get("Param1")
    </Server>
</head>
<!--docBodyAttr为医生站增加属性,将默认带上主题样式，解决界面初始化样式闪烁问题-->
<body #($G(docBodyAttr))#>
    <!--布局csp引入-->
    <csp:Include Page="dhcdoc.template.show.csp">
</body>
<script language='javascript'>
    //1.绑定js全局变量
    var ServerObj = {
        EpisodeID:'#(EpisodeID)#',
        //...
    };
    //2.闭包业务js时,初始化调用、暴露xhrRefresh、onBeforeCloseTab、chartOnBlur等方法为全局方法
    cspInitClosure(rep.exam.view, opts);    //rep.exam.view页面闭包对象, opts未初始化参数
</script>
<!--业务js引入-->
<script type="text/javascript" src="../scripts/dhcdoc/产品线/业务.js"></script>
</html>
```

## 关键 CSP 指令

| 指令 | 说明 |
|---|---|
| `<Server>...</Server>` | 服务端 ObjectScript 代码块 |
| `#(variable)#` | 将服务端变量嵌入 HTML/JS |
| `##(expression)##` | 转义 HTML 特殊字符后嵌入 |
| `<csp:if>` / `<csp:elseif>` / `<csp:else>` | 条件服务端包含 |
| `<csp:Include Page="...">` | 服务端包含另一个 CSP 页面 |
| `%request.Get("name")` | 获取 HTTP 请求参数 |
| `%session.Data("key")` | 获取会话数据 |


## CSP 命名模式

`{子系统}.{模块}.{功能}.csp`

示例：`chemo.aform.main.csp`、`dhcant.aform.audit.csp`、`dhcant.cfg.docauth.csp`

## Broker 调用

前端通过 `DHCDoc.Util.Broker.cls` 与后端通信：

```
DHCDoc.Util.Broker.cls?ClassName=DHCAnt.AForm.Api&MethodName=GetAntApplyData&Parameters=...
```

流程：接收请求 → 实例化 ClassName → 调用 MethodName → 返回 JSON。

## CSP 参数说明

### DOC:HEAD 参数说明

```
    <!--基础平台验证、HISUI、医生站公共js、样式引入,支持打印、读卡、接口中间层相关环境引入-->
    <!--如无需默认combobox、datagrid等请求url，请增加属性 notdefurl=1 <DOC:HEAD notdefurl=1></DOC:HEAD> -->
    <!--如需打印，请增加属性 needprint=1 <DOC:HEAD needprint=1></DOC:HEAD> -->
    <!--如需引入接口中间层，请增加属性 productdomain="业务域" <DOC:HEAD productdomain="AdmReg"></DOC:HEAD> -->
    <!--如需读卡,请增加属性 medStepCode="业务节点" <DOC:HEAD medStepCode="OPAdmReg"></DOC:HEAD> -->
    <!--如需引入css文件 css="产品线/业务.css" 多个文件逗号分割 <DOC:HEAD css="opadm/regist.css"></DOC:HEAD> -->
```	
如：需要引用 `ant/aform/main.css` 样式文件时，则属性需增加 css="ant.css" `<DOC:HEAD css="ant/aform/main.css"></DOC:HEAD>`

## CSP 存放位置

**CSP 存放位置：`src/imedical/web/csp/`**
**CSS 存放位置：`src/imedical/web/css/`**
