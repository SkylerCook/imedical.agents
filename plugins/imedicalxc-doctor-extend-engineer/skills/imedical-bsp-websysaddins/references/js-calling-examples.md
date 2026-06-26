# JS 调用中间件实例

## 一、引入中间件

在 CSP 页面中通过 `<ADDINS>` 标签声明引入中间件组件：

```html
<ADDINS></ADDINS>
```

此标签告诉 iMedical 客户端加载【插件管理】→【客户端动态库维护】中配置的所有中间件组件，并将其注册为全局可用对象。

> ⚠️ `<ADDINS></ADDINS>` 标签应放在 CSP 页面的合适位置，确保在调用中间件方法之前已完成加载。

---

## 二、两种调用模式

iMedical 中间件支持 **JAR 包模式** 和 **C# 模式** 两种调用方式，语法差异较大：

### 模式对比总览

| 对比项 | JAR 包模式（Java） | C# 模式（DLL） |
|--------|-------------------|----------------|
| **调用方法** | 统一通过 `cmd()` 方法 | 直接调用具体方法名 |
| **参数格式** | `java.exe 路径 + " -jar " + jar包名 + " " + 入参JSON` | 直接传入参数对象 |
| **返回值** | 统一返回 result 对象，需手动解析 | 取决于具体 DLL 实现 |

---

## 三、JAR 包模式（Java 中间件）

### 3.1 调用语法

```javascript
var result = 对象ID.cmd(execStr, false);
```

**参数构造格式**：

```
java.exe文件路径 + " -jar " + jar包名字 + " " + 入参JSON字符串
```

### 3.2 完整示例

```javascript
// CSP 中引入
<ADDINS></ADDINS>

// 构造执行命令：java.exe路径 -jar jar包名 入参
var javaExe = "C:\\Program Files\\Java\\jdk-17\\bin\\java.exe";
var jarName = "JavaReadDevice.jar";
var params = JSON.stringify({ action: "readPersonInfo", cardType: "ID" });
var execStr = javaExe + " -jar " + jarName + " " + params;

// 调用中间件
var result = JavaReadDevice.cmd(execStr, false);
```

### 3.3 返回值解析

`cmd()` 返回一个统一结构的 `result` 对象：

```javascript
// result 对象结构
{
    status: 200,      // HTTP 状态码，200 表示调用成功
    rtn: "{...}"      // JSON 字符串，包含业务返回数据
}
```

**标准解析流程**（含异常处理）：

```javascript
var result = JavaReadDevice.cmd(execStr, false);
if ((result.status == 200) && (result.rtn != "")) {
    // 解析 JSON 业务结果
    var rtnObj = JSON.parse(result.rtn);
    if (rtnObj.code == 200) {
        // 根据不同 methodName 分别处理返回值
        if (methodName == "readMagCard") {
            // 读磁条卡 → 返回: 卡号 ^ 安全线
            rtn = "0" + "^" + rtnObj.data.cardNo + "^" + rtnObj.data.securityNo;
        } else if (methodName == "readPersonInfo") {
            // 读身份证 → 通过后端格式化为 XML
            var patXml = tkMakeServerCall(
                "DHCDoc.Reg.RWCard",
                "FormatPatInfoByJava",
                JSON.stringify(rtnObj.data),
                session['LOGON.HOSPID']
            );
            rtn = "0" + "^" + patXml;
        }
    }
}
```

### 3.4 返回值规范

| 返回参数 | 说明 | 返回值格式 |
|--------|------|-----------|
| `code` | 代码 | `200:成功,其它:失败` |
| `desc` | 描述 | `提示信息` |
| `data` | 具体数据 |  |

---

## 四、C# 模式（DLL 中间件）

### 4.1 调用语法

```javascript
var result = 对象ID.方法名(入参);
```

直接通过「调用 ID 名」调用类中注册的具体方法，参数直接传递。

### 4.2 完整示例

```javascript
// CSP 中引入
<ADDINS></ADDINS>

// 直接调用具体方法，参数按方法定义传入
var result = DeviceService.readCard("ID");
var result2 = DeviceService.writeData(cardNo, dataStr);
var result3 = Common_LogObj.Write(logObj);
```

> **注意**：C# 模式下可调用的方法名需要在【客户端动态库维护】的列表区「类中包含的方法」中注册配置。

---

## 五、调用链路图解

### 5.1 JAR 包模式链路

```
CSP 页面
  │
  ├── <ADDINS> 引入 → 注册全局对象 JavaReadDevice
  │
  └── JavaReadDevice.cmd(execStr, false)
          │
          ├── execStr = java.exe路径 + " -jar " + jar包名 + " " + JSON入参
          │
          ▼
      客户端执行 java -jar 命令
          │
          ▼
      返回 { status: 200, rtn: "JSON字符串" }
          │
          ▼
      解析 rtn → JSON.parse() → rtnObj.data → 业务处理
```

### 5.2 C# 模式链路

```
CSP 页面
  │
  ├── <ADDINS> 引入 → 注册全局对象 DeviceService
  │
  └── DeviceService.方法名(入参)
          │
          ▼
      客户端直接调用 DLL 方法
          │
          ▼
      返回结果（取决于 DLL 方法实现）
```

---

## 六、与配置项的对应关系

| 代码中的标识 | 配置界面位置 | 说明 |
|-------------|-------------|------|
| `JavaReadDevice`（对象ID） | 表头区 → **调用 ID 名** | JS 中的全局对象实例名 |
| `.cmd()` | JAR 包模式的通用入口方法 | 配置为空时默认使用 cmd |
| `.readPersonInfo()` 等 | 列表区 → **类中包含的方法** | C# 模式下直接使用的方法名 |

---

## 七、注意事项

### 7.1 对象存在性检查

调用前建议检查中间件对象是否存在，避免未部署时页面报错：

```javascript
if (typeof JavaReadDevice !== "undefined") {
    // 安全调用
    var result = JavaReadDevice.cmd(execStr, false);
} else {
    console.warn("JavaReadDevice 中间件未加载");
    alert("读卡器服务未就绪，请联系管理员");
}
```

### 7.2 Thread attach 脏数据处理

部分厂商 DLL 会输出额外的 Thread attach 日志到 stdout，需要在解析 JSON 前过滤：

```javascript
// 过滤 Thread attach 脏数据
var cleanRtn = result.rtn.replace(/Thread-\d+\s+attach\s+success\s*/g, "");
var rtnObj = JSON.parse(cleanRtn);
```

### 7.3 异步调用封装

建议将中间件调用封装为 Promise：

```javascript
function callMiddleware(execStr) {
    return new Promise(function(resolve, reject) {
        if (typeof JavaReadDevice === "undefined") {
            reject(new Error("中间件未加载"));
            return;
        }
        
        var result = JavaReadDevice.cmd(execStr, false);
        
        if (result.status !== 200) {
            reject(new Error("调用失败: " + result.status));
            return;
        }
        
        try {
            var cleanRtn = result.rtn.replace(/Thread-\d+\s+attach\s+success\s*/g, "");
            var rtnObj = JSON.parse(cleanRtn);
            resolve(rtnObj);
        } catch (e) {
            reject(new Error("解析返回数据失败: " + e.message));
        }
    });
}

// 使用
callMiddleware(execStr)
    .then(function(data) {
        console.log("读卡成功:", data);
    })
    .catch(function(error) {
        console.error("读卡失败:", error);
    });
```

### 7.4 参数构造辅助函数

```javascript
/**
 * 构造中间件调用参数
 * @param {string} hardType - 硬件类型，如 "huaDa.hd100.dev1"
 * @param {string} methodName - 方法名，如 "readPersonInfo"
 * @param {object} params - 参数对象
 * @returns {string} execStr
 */
function buildExecStr(hardType, methodName, params) {
    var javaExe = "C:\\Program Files\\Java\\jdk-17\\bin\\java.exe";
    var jarName = "JavaReadDevice.jar";
    
    var args = {
        hardType: hardType,
        method: methodName,
        params: params
    };
    
    return javaExe + " -jar " + jarName + " " + JSON.stringify(args);
}

// 使用示例
var execStr = buildExecStr("huaDa.hd100.dev1", "readPersonInfo", {
    enableIdCard: true,
    enableInsuCard: true
});
```
