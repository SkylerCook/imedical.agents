---
name: imedical-bsp-websysaddins
version: 2.0.0
description: >
  iMedical 插件管理中间件综合开发 Skill，覆盖编码→测试→交付全流程。
  同时也覆盖 WebSys Add-ins (医为插件) 前端插件架构开发知识，包括：
  plugin.xml 插件清单、plugin.js 入口点、插件钩子机制、UI 扩展等。
  本 Skill 应在此类场景触发：医为插件、WebSysAddins、插件开发、插件管理、DLL配置、ADDINS、
  中间件调用、中间件开发、JS调用中间件、CSP中间件、插件配置、中间件工程、
  程序集名、调用ID名、类中包含方法（列表区配置）、
  读卡器、读卡中间件、JavaReadDevice、身份证读卡、社保卡读卡、
  hardType、readPersonInfo、readMagCard、DeviceService、读卡器配置、
  客户端动态库维护、DynamicInvoker、JNA、Native.load、XxxLibrary、
  XxxServiceImpl、execStr、cmd方法、Thread attach。
  调用方（上层 Skill）必须传入：开发文档原文、DLL说明、输入输出要求；缺失则返回缺失清单。
user-invocable: false
triggers:
  - websysaddins
  - websys-addins
  - 医为插件
  - 东华插件
  - iMedical插件
  - HIS插件开发
  - 基础平台插件
  - bsp插件
  - addin开发
  - 插件对接
  - 中间件
  - middleware
  - JavaReadDevice
  - 读卡器
  - 客户端动态库
  - ADDINS
  - 读卡中间件
  - 程序集名
  - 调用ID名
  - plugin.xml
  - plugin.js
role: specialist
scope: implementation
output-format: code
---

# Skill: iMedical 插件管理（WebSys Add-ins + 中间件开发）

## 1. 技能定位

本 Skill 覆盖 iMedical 插件管理体系的**两大领域**：

| 领域 | 内容 | 角色 |
|------|------|------|
| **中间件开发** | 对接厂商 DLL/OCX 等 Native 组件，生成 Java 中间件供 iMedical 客户端（CSP 页面）调用 | 流程化开发（编码→测试→交付） |
| **WebSys Add-ins** | 前端插件架构知识，用于扩展 HIS 界面功能 | 知识参考（架构、模板、钩子） |

- 第 2-8 章为**中间件开发规则**（调用方必须传入必要信息）
- 第 9 章为 **WebSys Add-ins 知识参考**（plugin.xml、plugin.js、钩子机制等）

```
编码(CODING) -> 测试(TESTING) -> 交付(DELIVERING)
```

| 阶段 | 关键产出 |
|------|----------|
| 编码 | Java 源码 + pom.xml + 内嵌 DLL |
| 测试 | 编译通过的可执行 fat-jar |
| 交付 | ZIP({artifactId}.zip) + 配置说明.md + 前端调用说明.md + 源码说明.md（文档单独交付，ZIP 仅含运行时产物） |

**本 Skill 不设需求分析阶段**，调用方需在调用时直接提供开发所需的全部原始信息。

---

## 2. 调用接口规范

### 2.1 触发方式

本 Skill 可以由用户直接触发，也可以由上层 Skill 通过 `task` 工具调用。调用时通过 `prompt` 参数传入完整上下文。

### 2.2 调用方必须传入的信息

调用方必须在 `prompt` 中提供以下信息，**缺失任何一项都将导致开发中断**。

| 信息类别 | 字段 | 必填 | 说明 |
|----------|------|------|------|
| **输入要求** | `input.description` | 是 | 中间件用途，一句话描述 |
| **输出要求** | `output.description` | 是 | 输出内容的一句话描述 |
| | `output.format` | 否 | 输出格式，如 JSON/XML。未提供时根据 `output.example` 自动推断 |
| | `output.example` | 是 | 输出示例 |
| **DLL 说明** | `dll.sourcePath` | 是 | DLL 文件在磁盘上的绝对路径 |
| | `dll.fileName` | 推荐 | DLL 文件名。未提供时从 `dll.sourcePath` 自动提取 |
| | `dll.bit` | 推荐 | DLL 位数：`32` 或 `64`。未提供时尝试从文件名/路径推断，推断失败默认 `32` |
| | `dll.description` | 推荐 | DLL 版本、适用场景等说明。未提供时从 `devDoc.rawContent` 自动提取 |
| | `dll.methods` | 推荐 | DLL 暴露的方法列表，每项含 name/params/desc。未提供时本 Skill 尝试自动提取 |
| | `dll.usageNotes` | 否 | DLL 使用注意事项 |
| **开发文档** | `devDoc.rawContent` | 是 | **开发接口文档的完整原文**，调用方直接粘贴 |

> **注意**：
> - `input.argsFormat` **不需要传入**（这是 Java 源码内部格式，由本 Skill 自动生成）
> - 前端调用示例 `argsExample` **不是输入**，而是开发完成后在前端调用说明.md 中自动生成的内容

### 2.3 调用方**无需**传入的信息

以下信息由本 Skill 内部根据规范自动生成，调用方**不要**传入：

| 信息 | 处理方式 |
|------|----------|
| 插件管理配置（控件代码、调用ID名、应用文件路径等） | 由本 Skill 根据 `dll.fileName` 和模块名自动推导生成 |
| Java 包名、类名 | 固定包结构 `com.mediway.his.doctor.middleware`，类名按规范命名 |
| pom.xml 依赖 | 按标准模板生成 |
| 三份文档的章节结构 | 按标准模板生成 |

---

## 3. 前置强制检查

### 3.1 检查清单

开始编码前，逐一确认调用方传入的信息。如果**必填字段**（非 methods）缺失或为空，**立即停止编码**，返回缺失清单给调用方。

对于 `dll.methods`（推荐字段）：
- 如果已提供：直接使用
- 如果未提供：尝试通过 Python 自动提取（见 3.4）
- 如果自动提取失败：基于 `devDoc.rawContent` 分析提取，或在返回中说明已推断的方法列表

```
❌ 无法开始编码：前置信息不完整

缺失字段：
- dll.sourcePath: DLL 文件路径未提供
- devDoc.rawContent: 开发文档原文未提供

调用方必须补充以下信息后才能继续：
1. DLL 文件路径（dll.sourcePath）及文件存在性
2. 开发文档原文（devDoc.rawContent）
3. 输入要求（input.description）
4. 输出要求（output.description / example）

注：DLL 文件名（fileName）、位数（bit）、描述（description）、方法列表（methods）为推荐字段，未提供时本 Skill 将尝试自动提取或推断。
```

### 3.2 DLL 文件存在性检查

验证 `dll.sourcePath` 指向的文件是否存在且大小 > 0：
- 若不存在：返回错误 `"DLL 文件未找到：{path}，请确认路径正确"`
- 若存在：继续后续流程

### 3.3 DLL 方法映射检查

从 `dll.methods`（或自动提取结果）提取方法列表，与 `devDoc.rawContent` 交叉核对：
- 方法名是否一致（注意大小写，如 `SendInfo` vs `sendInfo`）
- 参数类型是否匹配
- 不一致时以实际提取结果为准，在源码说明中标注差异

### 3.4 DLL 方法自动提取

当 `dll.methods` 未提供时，按以下优先级尝试获取方法列表：

**方式一：Python 读取 DLL 导出表**
```python
# 使用 pefile 或 ctypes 读取 DLL 的导出函数表
import pefile
pe = pefile.PE(dll_path)
for exp in pe.DIRECTORY_ENTRY_EXPORT.symbols:
    print(exp.name.decode() if exp.name else "")
```
- 若提取成功：生成 `dll.methods` 列表（name + 空 params + 空 desc）
- 若提取失败：继续方式二

**方式二：基于 devDoc.rawContent 分析**
- 从开发文档原文中提取 "procedure xxx"、"function xxx"、"void xxx()" 等模式
- 结合 DLL 描述中的方法说明
- 生成推断的 `dll.methods` 列表

**方式三：兜底处理**
- 若以上均失败：在源码说明中标注 "方法列表基于文档推断，建议人工核对"
- 不阻断开发流程，继续编码

### 3.5 与调用方的交互约定

本 Skill **无法直接与用户对话**，所有信息交互通过调用方中转：
- 必填信息缺失时 → 返回缺失清单 → 由调用方与用户交互补充 → 重新调用
- DLL 路径不存在时 → 返回错误信息 → 由调用方确认路径 → 重新调用
- methods 自动提取结果 → 在交付物中说明提取方式及可能的偏差

---

## 4. Java 编码规范

### 4.1 统一包结构

项目根包固定为 `com.mediway.his.doctor.middleware`：

| 层级 | 包名 | 职责 |
|------|------|------|
| Controller | `controller` | 命令行入口、反射调度、统一返回 JSON |
| Service 接口 | `service` | JNA DLL 接口声明 |
| Service 实现 | `service` | 业务封装、异常处理、日志记录 |
| VO | `model.vo` | 统一响应对象 |
| Utils | `utils` | DLL 提取工具类 |

### 4.2 文件头注释

```java
/**
 * @title: {文件名}.java
 * @package: {完整包名}
 * @description: {功能一句话描述}
 * @author: 自动生成
 * @company: 东华医为科技有限公司
 * @date: YYYY-MM-DD
 * @version: 1.0.0
 */
```

### 4.3 Controller 层（MiddlewareManager.java）

**职责**：
1. 参数解析：`args[0]` 为方法名，`args[1]` 及之后为可选入参（支持多参数）
2. 反射调用：`MiddlewareServiceImpl.class.getMethod()` 动态匹配
3. 统一响应：`JSON.toJSONString(Response)` 序列化到 stdout
4. 异常分层：`NoSuchMethodException` → 404，其他 → 500

**参数传递约定（核心约束）**：

- 前端 JS 侧调用 `cmd(execStr, false)`，其中 `execStr` 为完整命令行字符串
- `execStr` 格式：`{java.exe完整路径} -jar {artifactId}.jar 方法名 [参数1] [参数2] ...`
  - `{java.exe完整路径}` 由 E2E 测试阶段根据 DLL 位数扫描本地 JDK 确定（见 5.4），**不可写死为 `java`**
- 插件管理框架将 `execStr` 按空格切分后作为 `main(String[] args)` 传入
- `args[0]` = 方法名
- `args[1]` 及之后为业务参数，**不限定具体格式**（XML、JSON、纯文本等由 DLL 要求决定）
- 支持多参数扩展（`args[2]`、`args[3]`...），具体由 DLL 接口和 Service 层方法签名决定

**源码要点**：
```java
String methodName = args[0];
String[] params = args.length > 1 ? java.util.Arrays.copyOfRange(args, 1, args.length) : new String[0];
// 参数不限定格式，根据方法签名动态匹配（支持 0~N 个 String 参数）
```

**反射调用核心逻辑（必须包含参数自动填充）**：
```java
// 当传入参数个数 < 方法参数个数时，用 null 填充剩余参数，交由 Service 层校验
Object[] invokeArgs = new Object[paramCount];
for (int i = 0; i < paramCount; i++) {
    invokeArgs[i] = i < params.length ? params[i] : null;
}
result = method.invoke(service, invokeArgs);
```

> **禁止行为**：❌ 仅按传入参数个数匹配方法，导致 `sendInfo`（无参调用）返回 404 而非 400

### 4.4 JNA DLL 接口层（MiddlewareLibrary.java）

- DLL 接口类必须 `extends Library`
- `LIBRARY_NAME` 与目标 DLL 文件名一致（**不含 `.dll` 后缀**）
- 通过 `Native.load()` 加载，加载前先从 classpath 提取 DLL 到临时目录
- **重要**：Java 接口中不能使用 `try-catch` 块初始化字段。`DllExtractor.extract()` 必须在内部自行捕获 `Exception` 并包装为 `RuntimeException` 抛出
- 详见 `REFERENCE.md` → "DLL 内嵌加载机制"

**正确示例**：
```java
public interface MiddlewareLibrary extends Library {
    String LIBRARY_NAME = "wdpost";

    // 接口字段初始化不能包裹 try-catch，异常由 DllExtractor 内部处理
    MiddlewareLibrary INSTANCE = Native.load(
            DllExtractor.extract(LIBRARY_NAME + ".dll"),
            MiddlewareLibrary.class
    );
    // ...
}
```

**DllExtractor 异常处理要求**：
```java
public static String extract(String dllName) {
    try {
        // 提取逻辑...
    } catch (Exception e) {
        throw new RuntimeException("DLL 提取失败: " + dllName, e);
    }
}
```

### 4.5 Service 实现层（MiddlewareServiceImpl.java）

1. **方法命名**：驼峰命名，与 Controller 反射调用的方法名完全一致
2. **返回类型**：统一返回 `Response<T>`
3. **参数校验**：入参必须做空值、空串校验
4. **日志规范**：info（操作记录）、debug（数据内容）、error（异常，必须携带异常对象）
5. **异常捕获**：每个 DLL 调用包裹 `try-catch`，禁止向外抛出原始异常

### 4.6 Response 统一响应对象

- 成功码固定 `200`，成功消息固定 `"Success"`
- 失败时 `data` 必须为 `null`
- 错误码：`400` 参数错误、`404` 方法不存在、`500` 服务端/DLL 异常

### 4.7 依赖限制

允许：`jna`、`fastjson`、`lombok`、`swagger-annotations`、`slf4j-api`、`logback-classic`、`logback-core`

禁止：`slf4j-simple`（会输出到 stderr，但 logback 更可控）、Spring、Spring Boot 等 Web 框架

**日志配置要求**：
- 使用 `logback.xml` 配置，**仅 FILE appender，禁止 CONSOLE appender**
- 原因：stdout 用于输出 JSON 给前端解析，任何控制台日志都会污染 JSON 导致解析失败

### 4.8 禁止行为

- 禁止在 Controller 中写业务逻辑或 DLL 调用
- 禁止在 Service 中直接使用 `System.out.println`
- 禁止 Service 方法向外抛出原始异常（必须捕获并包装为 `Response.failure`）
- 禁止修改 `Response` 成功码 `200` 和成功消息 `"Success"`
- 禁止 JNA 接口类中出现业务逻辑
- 禁止遗漏 `logger.error("...", e)` 中的异常对象参数
- 禁止反射调用时方法签名与 `MiddlewareServiceImpl` 实际定义不一致

---

## 5. 编译与测试

### 5.1 编译步骤

#### 环境准备（Windows 环境必读）

执行编译前，先检测 `javac`/`jar` 命令是否可用。若不可用（常见 PowerShell 环境），**必须扫描常见 JDK 安装路径并使用完整路径调用**：

```powershell
# 检测 javac 是否存在
$javacPath = "javac"
if (-not (Get-Command javac -ErrorAction SilentlyContinue)) {
    # 按优先级扫描常见 JDK 路径
    $candidates = @(
        "C:/Program Files/Java/jdk-1.8/bin/javac.exe",
        "C:/Program Files (x86)/Java/jdk-1.8/bin/javac.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $javacPath = $c; break }
    }
}
# 同理扫描 jar.exe
```

> **禁止行为**：❌ 不检测环境直接调用 `javac`；❌ 扫描到路径后不使用完整路径调用

#### 编译步骤

1. 创建 Maven 目录结构：`src/main/java/...` + `src/main/resources/`
2. 将 DLL 拷贝到 `src/main/resources/{dllname}.dll`
3. 编写 `pom.xml`，标准格式如下：
   - `<groupId>`: `com.mediway.his.doctor.middleware`
   - `<artifactId>`: 直接体现完整模块名，如 `wdpost-middleware`
   - `<version>`: `1.0.0`
   - `<packaging>`: `jar`
   - `<description>`: 如 `万达信息智能提示中间件 — wdpost.dll JNA 封装`
   - 依赖：`jna`、`fastjson`、`lombok`、`slf4j-api`、`logback-classic`、`logback-core`、`swagger-annotations`
   - 使用 `maven-shade-plugin` 打包为 fat-jar，`Main-Class` 指向 `MiddlewareManager`
4. 添加 `src/main/resources/logback.xml`（仅 FILE，禁止 CONSOLE）
5. 编译所有 `.java` 文件到 `target/classes`
6. 将依赖 jar 解压合并到 `target/classes`
7. 将 DLL 复制到 `target/classes/`
8. 使用 `jar cvfm` 打包为 fat-jar，`MANIFEST.MF` 指定 `Main-Class`
9. 产物命名为 `{artifactId}.jar`（不含版本号，artifactId 直接体现完整模块名，如 `wdpost-middleware`）

#### 关键编译注意事项

**（1）依赖 jar 解压方式（Windows PowerShell）**

- `Expand-Archive` 在 PowerShell 5.1 中**不支持直接解压 `.jar` 文件**
- 正确做法：将 `.jar` 重命名为 `.zip`，再调用 `Expand-Archive`，完成后删除 `.zip`
- 或使用 `jar xf` 命令（需确保 `jar.exe` 完整路径正确）

**（2）编译顺序**

- 先编译 `utils` 包（DllExtractor）→ 再编译 `model.vo` 包（Response）→ 再编译其他包
- 或使用通配符一次性编译：`javac -encoding UTF-8 -cp "lib/*" -d target/classes @sources.txt`
- `sources.txt` 中每行一个 Java 文件完整路径

### 5.2 打包测试

验证 fat-jar 包的完整性和可执行性：

| 测试项 | 命令/方法 | 通过标准 |
|--------|-----------|----------|
| DLL 内嵌检查 | `jar tf {artifactId}.jar \| findstr dll` | 输出包含 `{dllname}.dll` |
| MANIFEST 检查 | `jar xf {artifactId}.jar META-INF/MANIFEST.MF` | `Main-Class` 指向 `MiddlewareManager` |
| 可执行性检查 | `java -jar {artifactId}.jar` | 无 JVM 启动异常，返回 `{"code":400,...}` |
| 依赖完整性 | `java -jar {artifactId}.jar --version` 或直接运行 | 不报错 `ClassNotFoundException` |

### 5.3 单元测试

对独立工具类和响应对象进行单元测试，不依赖实际 DLL 加载：

| 测试类 | 测试内容 |
|--------|----------|
| `ResponseTest` | `success()` / `failure()` 构造是否正确；code/msg/data 是否符合规范 |
| `DllExtractorTest` | 从 classpath 读取资源文件到临时目录；文件已存在时是否复用 |
| `MiddlewareManagerTest` | `args` 为空时返回 400；方法不存在时返回 404；反射参数传递是否正确 |

> **注意**：单元测试中**不实际调用 DLL 方法**（避免 DLL 位数不匹配导致 CI 失败），通过 Mock 或只测反射逻辑。

### 5.4 端端测试（E2E）

模拟完整的 JS → 框架 → Java → DLL 调用链路。**必须根据 DLL 位数自动检测本地 JDK 环境，不可直接跳过。**

**Step 1：检测当前默认 JDK 位数**

```bash
java -version 2>&1 | findstr "64-Bit"
```
- 输出包含 `64-Bit` → 当前为 **64 位 JDK**
- 输出不包含 `64-Bit` → 当前为 **32 位 JDK**（或无法确定）

**Step 2：与 `dll.bit` 比对**
- **位数匹配**：直接使用 `java -jar xxx.jar ...`
- **位数不匹配**：**必须执行 Step 3 扫描对应位数 JDK**，不可直接跳过

**Step 3：扫描常见 JDK 安装路径（强制）**

当位数不匹配时，按以下列表顺序扫描对应位数的 JDK：

| DLL 位数 | 扫描路径 |
|----------|----------|
| 32 位 | `C:/Program Files (x86)/Java/jdk-1.8/bin/java.exe` |
| 32 位 | `C:/Program Files (x86)/Java/jdk1.8.0_*/bin/java.exe` |
| 32 位 | `C:/Program Files (x86)/Java/jre1.8.0_*/bin/java.exe` |
| 32 位 | `C:/Program Files (x86)/Java/latest/bin/java.exe` |
| 64 位 | `C:/Program Files/Java/jdk-1.8/bin/java.exe` |
| 64 位 | `C:/Program Files/Java/jdk1.8.0_*/bin/java.exe` |
| 64 位 | `C:/Program Files/Java/jre1.8.0_*/bin/java.exe` |
| 64 位 | `C:/Program Files/Java/latest/bin/java.exe` |

> **重要**：扫描时必须使用 `ls` 或 `find` 等命令实际探测文件是否存在，**不可仅凭经验假设路径存在或不存在**。扫描到第一个存在的 `java.exe` 即使用其完整路径执行 E2E。

**Step 4：执行 E2E 测试**

```bash
# 1. 无参数方法 E2E
{javaCmd} -jar {artifactId}.jar startWdActive
# 期望返回：{"code":200,"msg":"Success","data":null}

# 2. 有参数方法 E2E（若智能提示软件未安装/未运行，DLL 内部可能返回 500）
{javaCmd} -jar {artifactId}.jar sendInfo "<Request><Code>001</Code></Request>"
# 正常期望返回：{"code":200,"msg":"Success","data":null}
# 若 DLL 依赖的运行时环境缺失，可能返回：{"code":500,"msg":"发送信息失败: ...","data":null}
# 只要返回的是 JSON 格式且 code 为 500（而非 JVM 崩溃），即证明中间件封装链路正常

# 3. 参数为空 E2E
{javaCmd} -jar {artifactId}.jar sendInfo
# 期望返回：{"code":400,"msg":"发送的信息不能为空","data":null}

# 4. 方法不存在 E2E
{javaCmd} -jar {artifactId}.jar unknownMethod
# 期望返回：{"code":404,"msg":"方法不存在: unknownMethod","data":null}
```

> **重要说明**：`startwdactive` / `stopwdactive` 的成功返回（code=200）即可证明 JNA 封装、DLL 加载、参数传递、JSON 序列化全部正常。`sendInfo` 返回 500 通常是因为测试环境缺少完整的智能提示软件前端运行依赖（如主程序、注册表配置等），属于 DLL 内部业务异常，**非中间件代码问题**。在交付文档中需明确标注此情况。

**Step 5：扫描失败处理**

仅当**实际执行了扫描命令且确认无对应位数 JDK 存在**时，才在测试结果中标注：
```
"当前环境缺少 {bit} 位 JDK，E2E 测试跳过 DLL 调用验证"
```

> **禁止行为**：
> - ❌ 未执行扫描命令就直接标注跳过
> - ❌ 仅根据当前JDK位数不匹配就假设不存在对应JDK
> - ❌ 忽略 `C:/Program Files (x86)/Java/` 或 `C:/Program Files/Java/` 目录下的任何子目录

> **环境要求**：E2E 测试需要与 DLL 位数匹配的 JDK（32 位 DLL 用 32 位 JDK，64 位 DLL 用 64 位 JDK）。扫描到对应JDK后必须使用完整路径调用。

### 5.5 测试不通过的处理

| 失败类型 | 处理方案 |
|----------|----------|
| 打包测试失败 | 检查 MANIFEST.MF、依赖 jar 是否合并、DLL 是否在 classpath |
| 单元测试失败 | 修复源码逻辑，重新编译 |
| E2E 测试失败（DLL 加载异常） | 检查 JDK 位数与 DLL 是否匹配；检查 DLL 是否已正确提取到临时目录 |
| E2E 测试失败（业务方法异常） | 检查 DLL 方法名大小写是否与 `MiddlewareLibrary` 声明一致 |
| `javac` / `jar` 命令找不到 | 扫描常见 JDK 安装路径，使用完整路径调用（如 `C:/Program Files/Java/jdk-1.8/bin/javac.exe`） |
| MANIFEST.MF 编码错误 | 使用 ASCII 编码重新生成，禁止 UTF-8 BOM |
| `jar cvfm` 报 invalid header | MANIFEST.MF 存在 BOM 或非 ASCII 字符，重新用 ASCII 编码写入 |
| 依赖 jar 解压失败 | Windows 下 `Expand-Archive` 不支持 `.jar`，先重命名为 `.zip` 再解压 |
| 编译报错 "未报告的异常 Exception" | `DllExtractor.extract()` 未声明 throws，检查是否已改为内部捕获 RuntimeException |
| 编译报错 "需要 <标识符>" | 接口中使用了 `try-catch` 块初始化字段，禁止此写法，改为 DllExtractor 内部处理异常 |

---

## 6. 交付物

### 6.1 交付物清单

| 产物 | 文件名 | 说明 |
|------|--------|------|
| 可执行 fat-jar | `{artifactId}.jar` | 已内嵌 DLL 及全部依赖，不含版本号。artifactId 直接体现模块名，如 `wdpost-middleware` |
| ZIP 部署包 | `{artifactId}.zip` | 含 `{artifactId}.jar`（fat-jar，已内嵌全部依赖及 DLL）+ 外置 DLL，**不含文档**（文档单独交付） |
| 插件管理配置说明 | `配置说明.md` | 面向系统管理员 |
| 前端调用说明 | `前端调用说明.md` | 面向 CSP 前端开发 |
| 源码说明 | `源码说明.md` | 面向 Java 后端开发 |

### 6.2 三份文档规范概要

详见 `REFERENCE.md` → "交付物文档规范"。

**配置说明.md** 必须覆盖：配置入口、配置示例汇总（放最前，含表头区+列表区示例）、参数传递规范、业务方法映射表、统一返回格式及错误码、常见问题排查、注意事项。

**前端调用说明.md** 必须覆盖：JDK 环境要求（第一章节）、ADDINS 引入、调用方式（`cmd(execStr, false)`）、execStr拼接规范（含JDK路径）、参数传递规范、返回值解析（含 rtn JSON 结构表格）、方法调用示例（合并无参数/有参数/完整示例，每个标注入参/出参）、调用时序、常见问题。

**源码说明.md** 必须覆盖：工程概述、目录结构、核心文件说明、DLL 内嵌加载机制、编译打包、依赖清单、维护指南、注意事项。

### 6.3 文档格式强制要求（关键）

三份交付文档必须**严格按 `REFERENCE.md` 中的模板格式输出**，禁止擅自增删章节、改变表格结构、展开括号说明为详细内容。

#### 配置说明.md 格式红线

| 章节 | 模板要求 | 禁止行为 |
|------|----------|----------|
| **配置示例汇总** | 必须严格三列表格（配置项/值/说明），含**程序集名、版本号、是否可见、是否激活** | ❌ 缺少列或行；❌ 写成两列 |
| **列表区配置** | "列表区配置："后立即接表格，含**调用清除**列 | ❌ 省略"列表区配置："字样；❌ 缺少"调用清除"列 |
| **参数传递规范** | 严格按模板格式，JS调用示例使用 `{artifactId}.cmd(...)` 格式 | ❌ 改变参数说明格式；❌ 使用其他调用方式示例 |

#### 前端调用说明.md 格式红线

| 章节 | 模板要求 | 禁止行为 |
|------|----------|----------|
| **JDK 环境要求** | 必须为第一个章节（一） | ❌ 放在其他章节之后 |
| **引入方式** | 严格仅写：`<ADDINS></ADDINS>` | ❌ 添加额外说明文字 |
| **调用方式** | `cmd(execStr, false);` 格式 | ❌ 使用其他方法名或参数 |
| **方法调用示例** | 合并为一个章节（六），每个子方法必须列出方法名、入参、出参说明 | ❌ 拆分为无参数/有参数/完整示例三个独立章节 |

#### 反面教材

- **配置示例汇总** 写成两列（缺少"说明"列），且缺少"程序集名"、"版本号"等关键行
- **引入方式** 添加了额外的说明段落，而非仅写 `<ADDINS></ADDINS>`

> **核心原则**：`REFERENCE.md` 中模板用什么格式，交付文档就用什么格式，**逐字对应**，不得发挥。

---

## 7. 自我检查清单

每次执行前检查：
- [ ] 调用方传入了完整的必填信息（input.description / output.description / output.example / dll.sourcePath / devDoc.rawContent），无缺失
- [ ] `dll.sourcePath` 指向的文件真实存在
- [ ] `dll.methods` 非空或已尝试自动提取
- [ ] `devDoc.rawContent` 非空
- [ ] DLL 已拷贝到 `src/main/resources/`
- [ ] 生成的 Java 源码符合所有强制规则（尤其：MiddlewareLibrary 无 try-catch 块初始化、MiddlewareManager 支持参数自动填充）
- [ ] **编译环境已检查**：`javac` / `jar` 命令可用或已扫描到完整路径
- [ ] fat-jar 内包含 DLL 文件
- [ ] fat-jar 命名为 `{artifactId}.jar`（不含版本号，artifactId 直接体现完整模块名）
- [ ] ZIP 包 `{artifactId}.zip` 含 `{artifactId}.jar`（fat-jar，已内嵌全部依赖及 DLL）+ 外置 DLL，**不含文档**
- [ ] 三份文档（配置说明.md / 前端调用说明.md / 源码说明.md）单独交付
- [ ] logback.xml 仅 FILE appender，无 CONSOLE
- [ ] E2E 测试中已**实际扫描**常见JDK路径，找到与DLL位数匹配的JDK并执行验证（未找到才标注跳过）
- [ ] E2E 中 `startwdactive` / `stopwdactive` 返回 200（证明 JNA 封装链路正常）

---

## 8. 异常阻断模板

### 前置信息缺失

```
❌ 无法开始编码：前置信息不完整

缺失字段：
- {字段}: {原因}

调用方必须传入以下信息后才能继续：
1. 输入要求（input.description）
2. 输出要求（output.description / example）
3. DLL 文件路径（dll.sourcePath）及文件存在性
4. 开发文档原文（devDoc.rawContent）

注：DLL 文件名（fileName）、位数（bit）、描述（description）、方法列表（methods）为推荐字段，未提供时本 Skill 将尝试自动提取或推断。
请由调用方与用户交互补充以上信息后重新调用。
```

### DLL 文件不存在

```
❌ 无法开始编码：DLL 文件未找到
路径：{dll.sourcePath}

请确认 DLL 文件已放置到该路径后重新调用。
```

### 编译失败

```
❌ 编译失败：{错误信息}

常见原因及解决方案：
1. javac/jar 命令找不到
   → 扫描常见 JDK 路径，使用完整路径调用（如 C:/Program Files/Java/jdk-1.8/bin/javac.exe）

2. MANIFEST.MF 编码错误（invalid header field name）
   → 使用 ASCII 编码重新生成：
     [System.IO.File]::WriteAllText(path, "Manifest-Version: 1.0\nMain-Class: ...\n", [System.Text.Encoding]::ASCII)

3. 依赖 jar 解压失败
   → Windows 下 Expand-Archive 不支持 .jar，先重命名为 .zip 再解压

4. 编译报错 "未报告的异常 Exception"
   → DllExtractor.extract() 必须在内部捕获异常并转为 RuntimeException
   → MiddlewareLibrary 接口中禁止使用 try-catch 块初始化字段

5. 检查依赖 jar 是否下载完整
6. 检查 JDK 版本是否 1.8+
7. 检查源码编码是否为 UTF-8
```

---

## 9. WebSys Add-ins 前端插件开发（知识参考）

> **说明**：本章为 iMedical **WebSys Add-ins 前端插件架构**的知识参考，与第 2-8 章的中间件开发流程相互独立。
> 前端插件无需 DLL/JNA，使用纯 JavaScript + HTML + CSS 实现，用于扩展 HIS 界面功能。

### 9.1 架构概述

WebSys Add-ins 是 iMedical 的插件架构，支持：
- **模块化扩展**：不修改核心代码即可添加功能
- **热部署**：动态加载/卸载插件
- **标准化接口**：一致的插件间通信 API
- **多租户支持**：按医院/部署配置插件

```
┌─────────────────────────────────────────────────────────────┐
│                    iMedical HIS Platform                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  HIS Core    │  │  WebSys      │  │  Plugin      │      │
│  │  Modules     │  │  Framework   │  │  Manager     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│           │               │                  │             │
│           └───────────────┼──────────────────┘             │
│                           │                                 │
│              ┌────────────┴────────────┐                   │
│              │      Plugin Layer       │                   │
│              │  ┌─────┐ ┌─────┐ ┌─────┐│                   │
│              │  │ P1  │ │ P2  │ │ P3  ││                   │
│              │  └─────┘ └─────┘ └─────┘│                   │
│              └─────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### 9.2 插件类型

| 插件类型 | 描述 | 示例 |
|---------|------|------|
| **UI 插件** | 扩展用户界面 | 自定义数据表格、按钮、对话框 |
| **业务插件** | 业务逻辑扩展 | 自定义校验、计算 |
| **集成插件** | 第三方系统集成 | 外部 API 调用、数据同步 |
| **报表插件** | 自定义报表 | 特殊报表、导出 |
| **工作流插件** | 工作流定制 | 审批流程、通知 |

### 9.3 插件目录结构

```
websysaddins/
├── {PluginName}/                    # 插件目录
│   ├── config/                      # 配置文件
│   │   ├── plugin.xml              # 插件清单
│   │   └── settings.json           # 插件设置
│   ├── src/                         # 源代码
│   │   ├── main/                   # 主插件代码
│   │   │   ├── plugin.js           # 插件入口
│   │   │   └── controller.js       # 插件控制器
│   │   ├── ui/                     # UI 组件
│   │   │   ├── toolbar.js          # 工具栏扩展
│   │   │   ├── dialog.js           # 自定义对话框
│   │   │   └── grid.js             # 数据表格扩展
│   │   └── service/                # 业务服务
│   │       ├── api.js              # API 调用
│   │       └── data.js             # 数据处理
│   ├── resources/                   # 静态资源
│   │   ├── css/                    # 样式表
│   │   ├── images/                 # 图片
│   │   └── templates/              # HTML 模板
│   └── lib/                         # 第三方库
│       └── vendor/                 # 厂商特定库
```

### 9.4 插件清单（plugin.xml）模板

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plugin>
    <!-- 基本信息 -->
    <id>com.mediway.addins.{pluginId}</id>
    <name>{Plugin Name}</name>
    <version>1.0.0</version>
    <description>{Plugin description}</description>

    <!-- 开发者信息 -->
    <vendor>{Vendor Name}</vendor>
    <author>{Author Name}</author>
    <contact>{Contact Email}</contact>

    <!-- 兼容性 -->
    <target-platform>
        <min-version>6.0</min-version>
        <max-version>7.0</max-version>
    </target-platform>

    <!-- 模块依赖 -->
    <dependencies>
        <module name="opcare" version="6.0+"/>
        <module name="comoe" version="6.0+"/>
    </dependencies>

    <!-- 插件钩子 -->
    <hooks>
        <hook point="init" script="src/main/plugin.js" method="init"/>
        <hook point="pageLoad" script="src/main/plugin.js" method="onPageLoad"/>
        <hook point="beforeSave" script="src/main/plugin.js" method="beforeSave"/>
        <hook point="afterSave" script="src/main/plugin.js" method="afterSave"/>
        <hook point="toolbar" script="src/ui/toolbar.js" method="addButtons"/>
    </hooks>

    <!-- UI 扩展 -->
    <ui-extensions>
        <toolbar location="opcare.oeord.main">
            <button id="customBtn" label="Custom Action" icon="images/icon.png"/>
        </toolbar>
        <menu location="opcare.mrdia.context">
            <item id="menuItem" label="Custom Menu"/>
        </menu>
    </ui-extensions>

    <!-- 资源 -->
    <resources>
        <script path="src/main/plugin.js"/>
        <script path="lib/vendor/special-lib.js"/>
        <stylesheet path="resources/css/plugin.css"/>
    </resources>
</plugin>
```

### 9.5 插件入口（plugin.js）模板

```javascript
/**
 * {PluginName} Plugin Entry Point
 */
(function() {
    'use strict';

    var PluginName = window.PluginName || {};

    /**
     * 插件初始化
     */
    PluginName.init = function() {
        console.log('[PluginName] Plugin initialized');
        this.registerEvents();
        this.initUI();
        this.loadConfig();
    };

    /**
     * 注册事件监听
     */
    PluginName.registerEvents = function() {
        websys_addEventListener('patientSelected', this.onPatientSelected.bind(this));
        websys_addEventListener('orderSaved', this.onOrderSaved.bind(this));
        $(document).on('custom.event', this.handleCustomEvent.bind(this));
    };

    /**
     * 初始化 UI 组件
     */
    PluginName.initUI = function() {
        this.addToolbarButtons();
        this.addCustomPanels();
    };

    /**
     * 页面加载处理
     */
    PluginName.onPageLoad = function(pageId, pageData) {
        console.log('[PluginName] Page loaded:', pageId);
        if (pageId === 'opcare.oeord.entry') {
            this.initOrderEntryPage(pageData);
        }
    };

    /**
     * 保存前/后处理
     */
    PluginName.beforeSave = function(data) {
        if (!this.validateData(data)) return false;
        return this.performPreSaveLogic(data);
    };
    PluginName.afterSave = function(data, result) {
        this.syncToExternalSystem(data, result);
    };

    window.PluginName = PluginName;
})();
```

### 9.6 插件钩子参考

| 钩子点 | 触发时机 | 参数 | 用途 |
|-------|---------|------|------|
| `init` | 插件加载时 | 无 | 插件初始化 |
| `pageLoad` | 页面加载时 | pageId, pageData | 页面特定设置 |
| `pageUnload` | 页面卸载时 | pageId | 清理 |
| `beforeSave` | 保存前 | data | 校验、修改 |
| `afterSave` | 保存后 | data, result | 后处理 |
| `beforeDelete` | 删除前 | data | 校验 |
| `afterDelete` | 删除后 | data, result | 清理 |
| `toolbar` | 工具栏渲染时 | toolbar | 添加按钮 |
| `gridLoad` | 数据表格加载时 | grid, data | 表格定制 |
| `dialogOpen` | 对话框打开时 | dialogId | 对话框定制 |
| `patientChange` | 患者变更时 | patientId | 患者特定操作 |

### 9.7 UI 扩展示例

**添加工具栏按钮**：
```javascript
PluginName.addToolbarButtons = function() {
    var toolbar = websys_getToolbar('opcare.oeord.main');
    if (toolbar) {
        toolbar.addButton({
            id: 'plugin-custom-btn',
            text: 'Custom Action',
            iconCls: 'icon-custom',
            handler: this.onCustomAction.bind(this)
        });
    }
};
```

**添加右键菜单：**
```javascript
PluginName.addContextMenuItems = function() {
    var grid = websys_getGrid('opcare.oeord.grid');
    if (grid) {
        grid.addContextMenuItem({
            id: 'plugin-context-item',
            text: 'Custom Menu Item',
            handler: this.onContextMenuClick.bind(this)
        });
    }
};
```

### 9.8 平台定位说明

**WebSysAddins 是平台，不是应用**：
- 本 Skill 提供 WebSysAddins 平台和中间件的技术支持
- 业务团队（如医生站组）在此平台上开发自己的插件应用
- 平台级问题（CEFSharp 兼容性、桥接失败、配置）使用本 Skill
- 应用级开发，业务团队应参考各自的领域特定 Skill

---

## 10. 相关技能

- **imedicalxc-doctor-extend-engineer** — 医生站第三方集成全流程编排器（HTTP/REST/WebSocket/DLL 接口）
- **imedicalxc-doctor-blh** — 医生站 BLH 模式
- **imedicalxc-doctor-invoke** — 服务调用模式
- **imedicalxc-doctor-dbdata** — 数据库查询模式

---

**Skill 版本**：v2.0.0（合并自 imedical-bsp-websysaddins + imedical-bsp-websysaddins1）
**最后更新**：2026-05-18
