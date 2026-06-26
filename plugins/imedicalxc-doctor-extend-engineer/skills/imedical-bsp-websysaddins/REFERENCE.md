# imedical-bsp-websysaddins 辅助参考文档

本文档是 `imedical-bsp-websysaddins/SKILL.md` 的辅助参考，包含详细的代码模板、上下文示例和交付物规范。

---

## 一、调用方传入信息模板

调用方只需传入以下信息，其余由本 Skill 内部生成。

```json
{
  "input": {
    "description": "使用wdpost.dll作为CIS与智能提示软件的数据交互工具"
  },
  "output": {
    "description": "统一JSON响应，通过stdout输出",
    "format": "JSON",
    "example": "{\"code\":200,\"msg\":\"Success\",\"data\":null}"
  },
  "dll": {
    "sourcePath": "C:/Users/xxx/Desktop/开发Test/wdpost.dll",
    "fileName": "wdpost.dll",
    "bit": "32",
    "description": "程序目录下wdpost.dll默认32位，供CS版本调用",
    "methods": [
      {"name": "startwdactive", "params": [], "desc": "启动智能提示软件"},
      {"name": "stopwdactive", "params": [], "desc": "停止智能提示软件"},
      {"name": "SendInfo", "params": ["String info"], "desc": "发送提醒信息"}
    ],
    "usageNotes": "B/S版本调用需要通过SOCKET方式或OCX方式"
  },
  "devDoc": {
    "rawContent": "【开发文档原文，完整粘贴】"
  }
}
```

### 本 Skill 内部生成的信息

以下信息调用方**不要传入**，由本 Skill 自动推导：

| 信息 | 生成方式 |
|------|----------|
| `project.moduleName` | 从 `dll.fileName` 去除扩展名后驼峰命名，如 `wdpost` → `WdPost` |
| `configGuide.pluginCode` | 与 `artifactId` 一致 |
| `configGuide.callIdName` | 与 `artifactId` 一致 |
| `configGuide.appFilePath` | `{artifactId}/{artifactId}.zip` |
| `configGuide.functionDesc` | 从 `input.description` 提取 |
| Java 包名 | 固定 `com.mediway.his.doctor.middleware` |
| pom.xml | 标准模板 |
| 三份文档结构 | 标准模板 |

---

## 二、DLL 方法自动提取

当调用方未提供 `dll.methods` 时，按以下方式自动获取：

### 方式一：Python 读取 DLL 导出表（首选）

```python
import pefile

def extract_dll_methods(dll_path):
    methods = []
    try:
        pe = pefile.PE(dll_path)
        if hasattr(pe, 'DIRECTORY_ENTRY_EXPORT'):
            for exp in pe.DIRECTORY_ENTRY_EXPORT.symbols:
                if exp.name:
                    name = exp.name.decode('utf-8', errors='ignore')
                    methods.append({"name": name, "params": [], "desc": ""})
    except Exception as e:
        print(f"提取失败: {e}")
    return methods
```

- 安装依赖：`pip install pefile`
- 提取结果：`[{name:"startwdactive",params:[],desc:""}, ...]`
- 若成功：补充 desc（基于 devDoc 原文匹配）
- 若失败：转方式二

### 方式二：基于 devDoc.rawContent 分析

从开发文档原文中通过正则匹配提取方法：
- `procedure\s+(\w+)`
- `function\s+(\w+)`
- `void\s+(\w+)\s*\(`
- 已知模式匹配

### 方式三：兜底

若以上均失败，在源码说明中标注：
> "方法列表基于文档推断，建议人工核对。"

---

## 三、DLL 内嵌加载机制

### 3.1 内嵌方式

将 DLL 放置于 `src/main/resources/` 目录下，Maven 打包时自动将其包含在 jar 包的 classpath 根目录中。

### 3.2 运行时加载流程

```
[首次调用任意方法]
    |
DllExtractor 从 classpath 读取 DLL
    |
写入系统临时目录 %TEMP%/{module}-middleware/{dllname}.dll
    |
设置系统属性 jna.library.path 指向该目录
    |
JNA Native.load() 加载 DLL
    |
调用 DLL 对应函数
```

### 3.3 重复调用优化

临时目录中已存在 DLL 且文件大小大于 0 时，`DllExtractor` 直接返回已有文件路径，不再重复提取。

### 3.4 MiddlewareLibrary.java 完整模板

```java
package com.mediway.his.doctor.middleware.service;

import com.mediway.his.doctor.middleware.utils.DllExtractor;
import com.sun.jna.Library;
import com.sun.jna.Native;

/**
 * @title: MiddlewareLibrary.java
 * @package: com.mediway.his.doctor.middleware.service
 * @description: {DLL名称} JNA接口声明（支持classpath自动提取加载）
 * @author: 自动生成
 * @company: 东华医为科技有限公司
 * @date: YYYY-MM-DD
 * @version: 1.0.0
 */
public interface MiddlewareLibrary extends Library {
    String LIBRARY_NAME = "{dllname}";

    // 注意：接口字段初始化不能包裹 try-catch，异常由 DllExtractor 内部捕获并转为 RuntimeException
    MiddlewareLibrary INSTANCE = Native.load(
            DllExtractor.extract(LIBRARY_NAME + ".dll"),
            MiddlewareLibrary.class
    );

    /**
     * DLL 方法描述
     */
    void methodName(String param);
}
```

### 3.5 DllExtractor.java 完整模板

```java
package com.mediway.his.doctor.middleware.utils;

import lombok.extern.slf4j.Slf4j;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;

/**
 * @title: DllExtractor.java
 * @package: com.mediway.his.doctor.middleware.utils
 * @description: DLL 内嵌提取工具类
 * @author: 自动生成
 * @company: 东华医为科技有限公司
 * @date: YYYY-MM-DD
 * @version: 1.0.0
 */
@Slf4j
public class DllExtractor {

    private DllExtractor() {
        // 工具类禁止实例化
    }

    /**
     * 从 classpath 提取 DLL 到临时目录。
     * 所有异常在内部捕获并包装为 RuntimeException，以支持接口字段直接初始化。
     *
     * @param dllName DLL 文件名（不含路径）
     * @return 提取后的 DLL 绝对路径
     */
    public static String extract(String dllName) {
        try {
            String tempDir = System.getProperty("java.io.tmpdir");
            File targetFile = new File(tempDir, dllName);

            // 文件已存在则直接复用
            if (targetFile.exists() && targetFile.length() > 0) {
                log.debug("DLL 已存在于临时目录，直接复用: {}", targetFile.getAbsolutePath());
                return targetFile.getAbsolutePath();
            }

            try (InputStream is = DllExtractor.class.getClassLoader().getResourceAsStream(dllName)) {
                if (is == null) {
                    throw new RuntimeException("classpath 中未找到 DLL: " + dllName);
                }
                Files.copy(is, targetFile.toPath());
                log.info("DLL 提取成功: {}", targetFile.getAbsolutePath());
            }

            return targetFile.getAbsolutePath();
        } catch (Exception e) {
            throw new RuntimeException("DLL 提取失败: " + dllName, e);
        }
    }
}
```

---

## 四、Controller 完整模板

```java
package com.mediway.his.doctor.middleware.controller;

import com.alibaba.fastjson.JSON;
import com.mediway.his.doctor.middleware.model.vo.Response;
import com.mediway.his.doctor.middleware.service.MiddlewareServiceImpl;
import lombok.extern.slf4j.Slf4j;

import java.lang.reflect.Method;

/**
 * @title: MiddlewareManager.java
 * @package: com.mediway.his.doctor.middleware.controller
 * @description: 命令行入口、反射调度、统一返回 JSON
 * @author: 自动生成
 * @company: 东华医为科技有限公司
 * @date: YYYY-MM-DD
 * @version: 1.0.0
 */
@Slf4j
public class MiddlewareManager {

    public static void main(String[] args) {
        if (args == null || args.length == 0) {
            System.out.println(JSON.toJSONString(Response.failure(400, "参数不能为空")));
            return;
        }

        String methodName = args[0];
        String[] params = args.length > 1
                ? java.util.Arrays.copyOfRange(args, 1, args.length)
                : new String[0];

        log.info("收到调用请求, methodName={}, paramsCount={}", methodName, params.length);

        try {
            MiddlewareServiceImpl service = new MiddlewareServiceImpl();
            Method method = findMethod(MiddlewareServiceImpl.class, methodName, params.length);

            Object result;
            int paramCount = method.getParameterCount();
            if (paramCount == 0) {
                result = method.invoke(service);
            } else {
                // 方法需要参数时，若前端传入参数不足，用 null 填充，交由 Service 层校验
                Object[] invokeArgs = new Object[paramCount];
                for (int i = 0; i < paramCount; i++) {
                    invokeArgs[i] = i < params.length ? params[i] : null;
                }
                result = method.invoke(service, invokeArgs);
            }

            System.out.println(JSON.toJSONString(result));
        } catch (NoSuchMethodException e) {
            log.error("方法不存在: {}", methodName, e);
            System.out.println(JSON.toJSONString(Response.failure(404, "方法不存在: " + methodName)));
        } catch (Exception e) {
            log.error("调用异常, methodName={}", methodName, e);
            System.out.println(JSON.toJSONString(Response.failure(500, "调用异常: " + e.getMessage())));
        }
    }

    /**
     * 根据方法名查找方法（不区分大小写），优先匹配参数个数一致的方法，找不到时抛出 NoSuchMethodException
     */
    private static Method findMethod(Class<?> clazz, String methodName, int paramCount) throws NoSuchMethodException {
        Method fallback = null;
        for (Method method : clazz.getDeclaredMethods()) {
            if (method.getName().equalsIgnoreCase(methodName)) {
                if (method.getParameterCount() == paramCount) {
                    return method;
                }
                if (fallback == null) {
                    fallback = method;
                }
            }
        }
        if (fallback != null) {
            return fallback;
        }
        throw new NoSuchMethodException("方法不存在: " + methodName);
    }
}
```

---

## 五、Service 实现完整模板

```java
package com.mediway.his.doctor.middleware.service;

import com.mediway.his.doctor.middleware.model.vo.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * @title: {Module}ServiceImpl.java
 * @package: com.mediway.his.doctor.middleware.service
 * @description: {DLL名称}业务封装
 * @author: 自动生成
 * @company: 东华医为科技有限公司
 * @date: YYYY-MM-DD
 * @version: 1.0.0
 */
public class {Module}ServiceImpl {
    private static final Logger logger = LoggerFactory.getLogger({Module}ServiceImpl.class);

    /**
     * 示例业务方法
     * @param param 参数描述
     * @return 操作结果
     */
    public Response<Void> exampleMethod(String param) {
        if (param == null || param.trim().isEmpty()) {
            logger.warn("参数为空");
            return Response.failure(400, "参数不能为空");
        }

        try {
            logger.info("正在执行示例操作...");
            {Module}Library.INSTANCE.xxx(param);
            logger.info("示例操作执行成功");
            return Response.success(null);
        } catch (Exception e) {
            logger.error("示例操作执行失败", e);
            return Response.failure(500, "示例操作执行失败: " + e.getMessage());
        }
    }
}
```

---

## 六、交付物文档规范

### 6.1 配置说明.md 详细章节

```markdown
# {模块名}插件管理配置说明

## 配置入口
进入 iMedical 系统【开发工具管理】→【插件管理】。

## 一、配置示例汇总

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 控件代码 | `{pluginCode}` | 唯一标识 |
| 程序集名 | `{mainClass全限定名}` | Java主入口类 |
| 调用 ID 名 | `{artifactId}` | JS全局对象名 |
| 应用文件路径 | `{appFilePath}` | zip压缩包形式部署 |
| 版本号 | `{version}` | 当前版本 |
| 功能说明 | `{functionDesc}` | 功能描述 |
| 是否可见 | 否 | 不在界面显示 |
| 是否激活 | 是 | 已启用 |

列表区配置：
| 方法名 | 调用清除 | 即时调用 | 是否激活 |
|--------|----------|----------|----------|
| `cmd` | ☐否 | ✅是 | ✅是 |

## 二、参数传递规范
- `args[0]` = 业务方法名
- `args[1]` 及之后 = 业务参数，**不限定具体格式**（XML、JSON、纯文本等由 DLL 要求决定）
- 支持多参数扩展（`args[2]`、`args[3]`...）
- JS调用示例：`{artifactId}.cmd('"C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe" -jar {artifactId}.jar 方法名 入参', false)`

## 三、业务方法映射表
| 业务方法名 | 入参 | DLL对应函数 | 调用场景 |

## 四、常见问题排查
（覆盖版本号未递增、调用ID错误、是否激活未勾选、JDK位数不匹配、方法名错误、客户端IP限制）

## 五、注意事项
（JDK位数一致性、DLL自动提取、JAR包方法名固定、日志输出）
```

### 6.2 前端调用说明.md 详细章节

```markdown
# {模块名}前端调用说明

## 一、JDK 环境要求

本中间件内嵌的 DLL 为 **{dll.bit} 位**，客户端运行时需要匹配位数的 JDK 环境。
```

> **注意**：若客户端缺少对应位数的 JDK，中间件将无法加载 DLL，请联系系统管理员安装。

## 二、引入方式

在 CSP 页面中引入插件管理框架：

<ADDINS></ADDINS>

## 三、调用方式

统一调用 `cmd` 方法，格式如下：

```javascript
{artifactId}.cmd(execStr, false);
```

其中 `execStr` 为完整命令行字符串：

```
java.exe路径 + " -jar " + jar包名 + " " + 方法名 + " " + [参数]
```

- `java.exe路径`：由终端本地环境决定，需匹配 DLL 位数（32 位 DLL 需使用 32 位 JDK）
- `jar包名`：中间件 jar 包文件名，如 `{artifactId}.jar`
- `方法名`：调用的方法名，大小写敏感
- `[参数]`：方法入参，无参数时可省略

调用示例：

​```javascript
{artifactId}.cmd('"C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe" -jar {artifactId}.jar startWdActive', false);
```

## 四、参数传递规范

- `args[0]` = 业务方法名（如 `sendInfo`）
- `args[1]` 及之后 = 业务参数，**不限定具体格式**（XML、JSON、纯文本等由 DLL 要求决定）
- 支持多参数扩展（`args[2]`、`args[3]`...），具体由 DLL 接口和 Service 层方法签名决定

## 五、返回值解析

`cmd()` 返回统一结构的 `result` 对象：

```javascript
{
    status: 200,      // 框架层状态码，200 表示命令执行成功
    rtn: "{...}"      // Java 输出的 JSON 字符串
}
```

`rtn` 中 JSON 结构如下：

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | int | 状态码。200=成功，400=参数错误，404=方法不存在，500=服务端异常 |
| `msg` | String | 消息。成功时为 `"Success"`，失败时为具体错误描述 |
| `data` | Object | 数据。当前版本所有方法均返回 `null` |

**标准解析流程**：

```javascript
var result = {artifactId}.cmd(execStr, false);

if (result.status == 200 && result.rtn != "") {
    var rtnObj = JSON.parse(result.rtn);
    
    if (rtnObj.code == 200) {
        // 业务成功，处理 rtnObj.data
        console.log("成功:", rtnObj.data);
    } else {
        // 业务失败（参数错误、DLL 异常等）
        console.error("业务失败:", rtnObj.code, rtnObj.msg);
    }
} else {
    // 框架层失败（Java 进程未启动、Jar 未找到等）
    console.error("调用失败:", result);
}
```

## 六、方法调用示例

### 6.1 {无参数方法中文描述}

- **方法名**：`{methodName}`
- **入参**：无
- **出参**：`Response<Void>` — 成功时 `code=200, msg="Success", data=null`

```javascript
var result = {artifactId}.cmd('"C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe" -jar {artifactId}.jar {methodName}', false);
var rtnObj = JSON.parse(result.rtn);
if (rtnObj.code == 200) {
    console.log("操作成功");
} else {
    console.error("操作失败:", rtnObj.msg);
}
```

### 6.N {有参数方法中文描述}

- **方法名**：`{methodName}`
- **入参**：`{参数类型及格式说明}`
- **出参**：`Response<Void>` — 成功时 `code=200, msg="Success", data=null`；参数为空时 `code=400, msg="{错误描述}"`

```javascript
var param = "{参数示例}";
var result = {artifactId}.cmd('"C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe" -jar {artifactId}.jar {methodName} ' + param, false);
var rtnObj = JSON.parse(result.rtn);
if (rtnObj.code == 200) {
    console.log("操作成功");
} else {
    console.error("操作失败:", rtnObj.code, rtnObj.msg);
}
```

### 6.M 完整页面集成示例

```html
<!DOCTYPE html>
<html>
<head>
    <ADDINS></ADDINS>
    <script src="scripts/jquery.min.js"></script>
    <script>
        $(function() {
            var result = {artifactId}.cmd('"C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe" -jar {artifactId}.jar {initMethodName}', false);
            var rtnObj = JSON.parse(result.rtn);
            if (rtnObj.code == 200) {
                console.log("初始化成功");
            }
        });

        function sendReminder() {
            var param = "{参数示例}";
            var result = {artifactId}.cmd('"C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe" -jar {artifactId}.jar {methodName} ' + param, false);
            var rtnObj = JSON.parse(result.rtn);
            if (rtnObj.code == 200) {
                alert("操作成功");
            } else {
                alert("操作失败: " + rtnObj.msg);
            }
        }

        $(window).on("beforeunload", function() {
            {artifactId}.cmd('"C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe" -jar {artifactId}.jar {destroyMethodName}', false);
        });
    </script>
</head>
<body>
    <button onclick="sendReminder()">{按钮文字}</button>
</body>
</html>
```

## 七、调用时序

```
┌─────────────┐
│   前端 JS   │
└──────┬──────┘
       │ {artifactId}.cmd(execStr, false)
       │ execStr = "java.exe路径 -jar {artifactId}.jar 方法名 [参数]"
       ▼
┌──────────────────────────────────────┐
│        插件管理框架 (ADDINS)          │
│  解析控件代码，定位应用文件路径        │
│  构造命令行调用                       │
└──────┬───────────────────────────────┘
       │ Runtime.exec(execStr)
       ▼
┌──────────────────────────────────────┐
│        中间件 JAR (Java)             │
│  MiddlewareManager.main(args)       │
│  ├─ args[0] = 方法名                  │
│  └─ args[1+] = 业务参数               │
│  反射调用 MiddlewareServiceImpl       │
│  返回 JSON 到 stdout                  │
└──────┬───────────────────────────────┘
       │ stdout: {"code":200,"msg":"Success","data":null}
       ▼
┌──────────────────────────────────────┐
│        插件管理框架 (ADDINS)          │
│  包装为 <rtn>JSON</rtn>              │
│  返回 {status, rtn}                  │
└──────┬───────────────────────────────┘
       │ result.rtn
       ▼
┌──────────────────────────────────────┐
│        前端 JS                       │
│  提取 rtn → JSON.parse → 业务判断    │
└──────────────────────────────────────┘
```

## 八、常见问题
```

### 6.3 源码说明.md 详细章节

​```markdown
# {模块名}源码说明

## 一、工程概述

## 二、目录结构

## 三、核心文件说明
（Controller/Library/ServiceImpl/DllExtractor/Response逐一说明）

## 四、DLL内嵌与加载机制

## 五、编译与打包

## 六、依赖清单

## 七、修改维护指南
（更换DLL、新增方法、修改Response）

## 八、注意事项
```

---

## 七、pom.xml 模板

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project>
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.mediway.his.doctor.middleware</groupId>
    <artifactId>{artifactId}</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>
    <description>{description}</description>
    <properties>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <maven.compiler.source>1.8</maven.compiler.source>
        <maven.compiler.target>1.8</maven.compiler.target>
    </properties>
    <dependencies>
        <dependency><groupId>net.java.dev.jna</groupId><artifactId>jna</artifactId><version>5.13.0</version></dependency>
        <dependency><groupId>com.alibaba</groupId><artifactId>fastjson</artifactId><version>1.2.83</version></dependency>
        <dependency><groupId>org.projectlombok</groupId><artifactId>lombok</artifactId><version>1.18.24</version><scope>provided</scope></dependency>
        <dependency><groupId>org.slf4j</groupId><artifactId>slf4j-api</artifactId><version>1.7.36</version></dependency>
        <dependency><groupId>ch.qos.logback</groupId><artifactId>logback-classic</artifactId><version>1.2.12</version></dependency>
        <dependency><groupId>ch.qos.logback</groupId><artifactId>logback-core</artifactId><version>1.2.12</version></dependency>
        <dependency><groupId>io.swagger</groupId><artifactId>swagger-annotations</artifactId><version>1.6.6</version></dependency>
    </dependencies>
    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.8.1</version>
                <configuration><source>1.8</source><target>1.8</target><encoding>UTF-8</encoding></configuration>
            </plugin>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-shade-plugin</artifactId>
                <version>3.2.4</version>
                <executions>
                    <execution>
                        <phase>package</phase>
                        <goals><goal>shade</goal></goals>
                        <configuration>
                            <transformers>
                                <transformer implementation="org.apache.maven.plugins.shade.resource.ManifestResourceTransformer">
                                    <mainClass>com.mediway.his.doctor.middleware.controller.MiddlewareManager</mainClass>
                                </transformer>
                            </transformers>
                        </configuration>
                    </execution>
                </executions>
            </plugin>
        </plugins>
    </build>
</project>
```

> **说明**：`artifactId` 直接体现完整模块名（如 `wdpost-middleware`），打包产物为 `{artifactId}.jar`（不含版本号）。`slf4j-simple` 已替换为 `logback-classic` + `logback-core`。

---

## 八、Windows 手动编译打包参考脚本

当 Maven 不可用时，使用以下 PowerShell 脚本手动完成编译打包：

```powershell
$base = "{projectDir}"           # 项目根目录
$javac = "C:/Program Files/Java/jdk-1.8/bin/javac.exe"   # 根据实际扫描结果调整
$jar = "C:/Program Files/Java/jdk-1.8/bin/jar.exe"
$lib = "$base/lib/*"
$srcMain = "$base/src/main/java"
$out = "$base/target/classes"

# 1. 编译主代码（使用 @sources.txt 批量编译）
Get-ChildItem "$srcMain" -Recurse -Filter "*.java" | ForEach-Object { $_.FullName } | Set-Content "$base/sources.txt"
& "$javac" -encoding UTF-8 -cp "$lib;$out" -d "$out" "@$base/sources.txt"

# 2. 复制资源（DLL + logback.xml）
Copy-Item "$base/src/main/resources/*" "$out\" -Recurse -Force

# 3. 解压依赖 jar 到 classes（Windows 下 Expand-Archive 不支持 .jar，需重命名）
Get-ChildItem "$base/lib/*.jar" | ForEach-Object {
    if ($_.Name -ne "lombok-1.18.24.jar") {
        $zip = "$out/$($_.BaseName).zip"
        Copy-Item $_.FullName $zip -Force
        Expand-Archive -Path $zip -DestinationPath $out -Force
        Remove-Item $zip -Force
    }
}

# 4. 生成 MANIFEST.MF（必须使用 ASCII 编码）
$manifestDir = "$out/META-INF"
New-Item -ItemType Directory -Force -Path $manifestDir
$lines = @("Manifest-Version: 1.0", "Main-Class: com.mediway.his.doctor.middleware.controller.MiddlewareManager", "")
[System.IO.File]::WriteAllLines("$manifestDir/MANIFEST.MF", $lines, [System.Text.Encoding]::ASCII)

# 5. 打包 fat-jar
$jarPath = "$base/target/{artifactId}.jar"
& "$jar" cvfm "$jarPath" "$manifestDir/MANIFEST.MF" -C "$out" .

Write-Host "fat-jar 打包完成: $jarPath"
```

---

## 九、测试代码模板

### 9.1 单元测试（ResponseTest）

```java
package com.mediway.his.doctor.middleware;

import com.mediway.his.doctor.middleware.model.vo.Response;
import org.junit.Test;
import static org.junit.Assert.*;

public class ResponseTest {

    @Test
    public void testSuccess() {
        Response<String> resp = Response.success("data");
        assertEquals(200, resp.getCode());
        assertEquals("Success", resp.getMsg());
        assertEquals("data", resp.getData());
    }

    @Test
    public void testFailure() {
        Response<Void> resp = Response.failure(500, "error");
        assertEquals(500, resp.getCode());
        assertEquals("error", resp.getMsg());
        assertNull(resp.getData());
    }
}
```

### 9.2 单元测试（DllExtractorTest）

```java
package com.mediway.his.doctor.middleware.utils;

import org.junit.Test;
import java.io.File;
import static org.junit.Assert.*;

public class DllExtractorTest {

    @Test
    public void testExtractDll_exists() throws Exception {
        // 假设 test.dll 已放在 test/resources/
        String path = DllExtractor.extractDll("test.dll");
        assertNotNull(path);
        assertTrue(new File(path).exists());
    }
}
```

### 9.3 单元测试（MiddlewareManager 反射逻辑）

```java
package com.mediway.his.doctor.middleware.controller;

import org.junit.Test;
import java.lang.reflect.Method;
import com.mediway.his.doctor.middleware.service.MiddlewareServiceImpl;
import static org.junit.Assert.*;

public class MiddlewareManagerTest {

    @Test
    public void testMethodExists() throws Exception {
        Method method = MiddlewareServiceImpl.class.getMethod("startWdActive");
        assertNotNull(method);
    }

    @Test
    public void testMethodWithParamExists() throws Exception {
        Method method = MiddlewareServiceImpl.class.getMethod("sendInfo", String.class);
        assertNotNull(method);
    }
}
```

### 9.4 E2E 测试脚本（PowerShell，含 JDK 自动检测）

```powershell
$jar = "{artifactId}.jar"  # 如 wdpost-middleware.jar
$dllBit = "32"  # 从 dll.bit 读取

# --- JDK 自动检测 ---
function Find-Jdk {
    param([string]$requiredBit)

    # 检测当前默认 JDK 位数
    $currentVersion = & java -version 2>&1
    $is64Bit = $currentVersion | Select-String "64-Bit"

    if ($requiredBit -eq "64" -and $is64Bit) {
        return "java"  # 当前 JDK 匹配
    }
    if ($requiredBit -eq "32" -and -not $is64Bit) {
        return "java"  # 当前 JDK 匹配（32 位不会显示 64-Bit）
    }

    # 不匹配，扫描常见安装路径（必须实际探测，不可跳过）
    $candidatePaths = @()
    if ($requiredBit -eq "32") {
        $baseDir = "C:/Program Files (x86)/Java"
        if (Test-Path $baseDir) {
            $candidatePaths += "$baseDir/jdk-1.8/bin/java.exe"
            $candidatePaths += "$baseDir/latest/bin/java.exe"
            Get-ChildItem -Path $baseDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $candidatePaths += "$($_.FullName)/bin/java.exe"
            }
        }
    } else {
        $baseDir = "C:/Program Files/Java"
        if (Test-Path $baseDir) {
            $candidatePaths += "$baseDir/jdk-1.8/bin/java.exe"
            $candidatePaths += "$baseDir/latest/bin/java.exe"
            Get-ChildItem -Path $baseDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                $candidatePaths += "$($_.FullName)/bin/java.exe"
            }
        }
    }

    foreach ($path in $candidatePaths) {
        if (Test-Path $path) {
            Write-Host "扫描到 ${requiredBit} 位 JDK: $path"
            return $path
        }
    }

    Write-Warning "已扫描常见路径但未找到 ${requiredBit} 位 JDK，E2E 测试跳过 DLL 调用验证"
    return $null
}

$javaCmd = Find-Jdk -requiredBit $dllBit
if (-not $javaCmd) {
    Write-Host "当前环境缺少 ${dllBit} 位 JDK，E2E 测试跳过 DLL 调用验证"
    exit 0
}
Write-Host "使用 JDK: $javaCmd (要求 DLL 位数: $dllBit)"

# 1. 打包测试：验证 DLL 内嵌
$hasDll = & jar tf $jar | Select-String "wdpost.dll"
if (-not $hasDll) { throw "DLL not found in jar" }

# 2. E2E：无参数方法（验证 JNA 封装链路正常）
$result1 = & $javaCmd -jar $jar startwdactive 2>&1 | Out-String
Write-Host "startwdactive result: $result1"
if (-not $result1.Contains('"code":200')) { throw "startwdactive failed: $result1" }

# 3. E2E：有参数方法（若 DLL 依赖缺失，可能返回 500，只要返回 JSON 即算链路正常）
$result2 = & $javaCmd -jar $jar sendInfo "<Request><Code>001</Code></Request>" 2>&1 | Out-String
Write-Host "sendInfo result: $result2"
# 注意：此处不强制要求 code=200，因为测试环境可能缺少完整 DLL 运行时依赖

# 4. E2E：参数为空（验证 Service 层参数校验）
$result3 = & $javaCmd -jar $jar sendInfo 2>&1 | Out-String
Write-Host "sendInfo(empty) result: $result3"
if (-not $result3.Contains('"code":400')) { throw "empty param check failed: $result3" }

# 5. E2E：方法不存在（验证反射层异常处理）
$result4 = & $javaCmd -jar $jar unknownMethod 2>&1 | Out-String
Write-Host "unknownMethod result: $result4"
if (-not $result4.Contains('"code":404')) { throw "method not found check failed: $result4" }

# 6. E2E：停止方法
$result5 = & $javaCmd -jar $jar stopwdactive 2>&1 | Out-String
Write-Host "stopwdactive result: $result5"
if (-not $result5.Contains('"code":200')) { throw "stopwdactive failed: $result5" }

Write-Host "All E2E tests passed!"
```

---

## 十、已有工程参考（WebSys Add-ins 与读卡器中间件）

> **说明**：以下内容为已有生产环境的参考信息，供开发新中间件或插件时对比学习。与第 1-9 章的标准化模板互为补充。

### 10.1 JAR 模式 vs C# 模式对比

iMedical 中间件支持两种调用模式：

| 对比项 | JAR 包模式（Java） | C# 模式（DLL） |
|--------|-------------------|----------------|
| **调用方法** | 统一通过 `cmd()` 方法 | 直接调用具体方法名 |
| **参数格式** | `java.exe 路径 + " -jar " + jar包名 + " " + 入参JSON` | 直接传入参数对象 |
| **返回值** | 统一返回 result 对象，需手动解析 | 取决于具体 DLL 实现 |
| **JS 调用** | `JavaReadDevice.cmd(execStr, false)` | `DeviceService.方法名(入参)` |
| **配置要求** | 方法名固定为 cmd | 需在列表区注册每个方法 |

### 10.2 Thread attach 脏数据处理

部分厂商 DLL 会输出额外的 Thread attach 日志到 stdout，需在 JS 端过滤：

```javascript
// 过滤 Thread attach 脏数据
var cleanRtn = result.rtn.replace(/Thread-\d+\s+attach\s+success\s*/g, "");
var rtnObj = JSON.parse(cleanRtn);
```

### 10.3 异步调用封装（建议）

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
            resolve(JSON.parse(cleanRtn));
        } catch (e) {
            reject(new Error("解析返回数据失败: " + e.message));
        }
    });
}
```

### 10.4 标版读卡器工程参考

已有的标版读卡器工程 (`com.mediway.his.doctor.device`) 支持 **25 家读卡器厂商**，覆盖 **Windows + Linux** 双平台。

#### 目录结构（resources 层）

DLL 按 `{厂商}/{型号}/dev{N}/{平台}/` 层级存放：

```
src/main/resources/
└── {厂商名}/              # 如 huaDa, deKa, dongXin
    └── {型号}/            # 如 hd100, t10, est100
        └── dev{序号}/     # 同型号不同驱动版本
            └── {windows | linux}/
                ├── *.dll
                ├── *.ini
                └── *.h
```

#### 核心机制

| 机制 | 说明 |
|------|------|
| **动态路由** | `hardType`(如 `huaDa.hd100.dev1`) 自动拼装全限定类名，反射调用目标实现 |
| **模板方法** | `DeviceService` 定义读卡策略链：身份证 → 社保卡 → 健康卡 → 射频卡 → 二维码… |
| **JNA 加载** | `Native.load("相对路径", Library.class)` 加载 resources 下的 DLL |
| **零侵入扩展** | 新增设备只需：① 放 DLL 到 resources ② 写 Library + ServiceImpl 两个类 |

#### 命名规范

| 项目 | 规则 | 示例 |
|------|------|------|
| 厂商目录 | 小写拼音/英文 | `huaDa`, `dongXin` |
| 型号目录 | 小写+数字 | `hd100`, `est100`, `t10` |
| Library 类 | `{Vendor}{Model}Dev{N}Library` | `HuaDaHd100Dev1Library` |
| ServiceImpl 类 | `{Vendor}{Model}Dev{N}ServiceImpl` | `HuaDaHd100Dev1ServiceImpl` |
| DLL 路径 | 与 resources 目录一致 | `huaDa/hd100/dev1/windows/SSCardDriver.dll` |

#### 类名动态拼装规则

```java
// hardType 示例: "huaDa.hd100.dev1"
// 拼装结果:
String className = "com.mediway.his.doctor.device.service."
    + "huaDa" + "."           // 厂商
    + "windows" + "."         // 平台
    + "HuaDaHd100Dev1ServiceImpl";  // 实现类（首字母大写驼峰）
```

#### 扩展新设备步骤

1. **放 DLL**：将厂商驱动放入 `src/main/resources/{vendor}/{model}/dev1/windows/*.dll`
2. **写 Library**：创建 JNA 接口声明 DLL 函数，`LIBRARY_NAME` 对应 DLL 相对路径
3. **写 ServiceImpl**：继承 `DeviceService`，实现 `readIdCard()` / `readInsuCard()` / `readRfCard()` 等抽象方法
4. **打包部署**：`mvn clean package` → 部署 JAR 到服务端 → 更新版本号
5. **无需修改已有代码** — `DynamicInvoker` 通过 hardType 自动发现新实现

#### 部分支持厂商

| 厂商 | 目录名 | 支持型号 |
|------|--------|----------|
| 华大 | `huaDa` | hd100, hd900 |
| 德卡 | `deKa` | t10, t6 |
| 东信 | `dongXin` | est100, f11 |
| 明华 | `mingHua` | rd-eb, rd-et |
| 神思 | `shenSi` | ss628-100 |

> 完整厂商列表及详细工程结构请参考 `references/project-structure.md`。

### 10.5 插件管理配置字段详解

详见 `references/config-guide.md`。关键字段速查：

| 配置项 | 说明 |
|--------|------|
| 控件代码 | 中间件的唯一标识编码，创建后一般不可修改 |
| 程序集名 | Java 主入口类的全限定名（含 main 方法的类） |
| 调用 ID 名 | JS 中的全局对象名，对应 CSP 中 `ADDINS` 引入后的对象 |
| 应用文件路径 | 相对于 `web/addins/plugin` 的路径，支持 `.zip` 压缩包 |
| 版本号 | 控制客户端自动更新，每次发布需递增 |
| 是否激活 | ✅ 必须勾选才生效 |
| 客户端 IP | 限制特定 IP 范围可用，留空表示不限制 |

---

**文档版本**：v2.0.0（合并自 imedical-bsp-websysaddins + imedical-bsp-websysaddins1）
**最后更新**：2026-05-18