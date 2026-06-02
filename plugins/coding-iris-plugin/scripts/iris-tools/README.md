# IRIS 开发主力脚本集合

这些 Node.js 脚本用于从 IRIS 服务器导出文件、编译类文件、调试方法调用以及同步环境配置。

## 配置说明

所有脚本都从业务项目 `.agents/config/project-env.json` 读取连接参数。首次使用前请先从 `.agents/plugins/coding-iris-plugin/templates/project-env.template.json` 复制并填写真实环境；该文件包含敏感信息，不应提交到版本控制系统。

工具优先级：

1. 优先使用本目录脚本完成导出、类编译、Broker 调试和环境同步。
2. 后端 MCP 用于补充脚本未覆盖的 introspect、只读 SQL、远端状态验证和 ObjectScript 执行。
3. `sftp-server` MCP 是可选前端上传能力；目标项目未配置时，不应阻塞开发或臆造上传能力。
4. CSP 编译不走 `compile.js`，上传后通过后端 MCP 执行 `$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`。

## 📁 脚本列表

### 1. export.js - 通用导出脚本（推荐）

**功能：** 智能检测文件类型并自动从 IRIS 服务器导出文件（支持类文件、JS 文件、CSP 文件）。

**使用方法：**
```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <文件标识符> [输出目录] [命名空间] [--basePath <前缀>]
```

**示例：**
```bash
# 导出类文件（通过点号自动识别）
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js DHCDoc.AI.KBase

# 导出 JS 文件（自动添加 project-env.json 中 web.basePath 前缀）
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/Alloc.ExaBorRoom.hui.js

# 导出 CSP 文件（自动添加 project-env.json 中 web.cspBasePath 前缀）
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js alloc.exaborroom.hui.csp

# 使用完整路径导出
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js --basePath "<web-root-prefix>"

# 自定义输出目录和命名空间
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js DHCDoc.AI.KBase my-output <namespace>

# 禁用自动 basePath 前缀
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js --basePath ""
```

**自动检测规则：**

脚本根据以下规则自动识别文件类型：

1. **类文件**：包含点号但不包含斜杠，且不以 `.js` 或 `.csp` 结尾
   - 示例：`DHCDoc.AI.KBase` → 导出为 `.cls` 文件

2. **JS 文件**：以 `.js` 结尾、包含 `.hui.js`，或位于 `scripts/` 目录下
   - 如果不存在则自动添加 `project-env.json` 中的 `web.basePath` 前缀
   - 示例：`scripts/test.js` → `<web-root-prefix>/scripts/test.js`

3. **CSP 文件**：以 `.csp` 结尾或位于 `csp/` 目录下
   - 如果不存在则自动添加 `project-env.json` 中的 `web.cspBasePath` 前缀
   - 示例：`test.csp` → `<web-root-prefix>/csp/test.csp`

**特性：**
- ✅ 自动创建目录（如不存在）
- ✅ 密码验证
- ✅ 完善的错误处理和清晰的错误提示
- ✅ 支持 HTTPS 和自签名证书
- ✅ 导出过程中的状态报告
- ✅ UTF-8 编码保存文件
- ✅ 检测文件存储类型 (@FS)
- ✅ 智能文件类型自动检测

---

### 2. compile.js - 文件同步编译脚本

**功能：** 将本地文件上传到 IRIS 服务器并自动编译，实现快速开发和测试。

> 注意：`compile.js` 面向 `.cls` 类文件同步编译，不作为 CSP 批量部署编译入口。CSP 应先通过 SFTP 上传到目标 Web 根，再用目标工程定义的 WebApp 虚拟路径执行 `$system.OBJ.Load("<web-app-virtual-root>/csp/<file>.csp","c")`，并检查内层 status 与生成类参数。
> 脚本会显式拒绝 `.csp` 输入，避免把 CSP 路径错误转换成 IRIS 点号文档名。

**工作原理：**
1. 读取本地文件内容
2. 通过 MCP 协议连接到 IRIS 服务器
3. 上传文件到指定命名空间
4. 执行编译操作
5. 返回编译结果（包括错误、警告信息）

**使用方法：**
```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js <文件名或路径> [命名空间]
```

**示例：**
```bash
# 通过类名编译（自动转换为路径）
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js DHCDoc.Util.String

# 通过相对路径编译
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js DHCDoc/Util/Date.cls

# 带 src 前缀的路径
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js src/DHCDoc/Util/Date.cls

# 指定命名空间
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js DHCDoc.Util.String <namespace>
```

**支持的输入格式：**

1. **类名格式**：`DHCDoc.Util.String`
   - 自动转换为：`src/DHCDoc/Util/String.cls`
   - 远程文档名：`DHCDoc.Util.String.cls`

2. **相对路径**：`DHCDoc/Util/Date.cls`
   - 自动添加 `src/` 前缀
   - 本地路径：`src/DHCDoc/Util/Date.cls`
   - 远程文档名：`DHCDoc.Util.Date.cls`

3. **完整路径**：`src/DHCDoc/Util/Date.cls`
   - 直接使用指定路径
   - 远程文档名：`DHCDoc.Util.Date.cls`

**输出信息：**
- 本地文件路径
- 远程文档名称
- 目标命名空间
- 上传状态
- 编译控制台日志
- 编译错误（含行号和列号）
- 编译警告
- 最终编译结果

**特性：**
- ✅ 通过 MCP 协议与 IRIS 通信
- ✅ 智能路径转换（类名 ↔ 文件路径）
- ✅ 详细的编译反馈（错误、警告、控制台输出）
- ✅ 自动检测文件扩展名
- ✅ 支持自定义命名空间
- ✅ 本地文件存在性验证
- ✅ 完善的错误处理

**依赖：**
- 需要配置 `project-env.json` 中的 `mcp.serverPath`
- MCP 服务器可执行文件（如 `iris-dev.exe`）

---

### 3. debugger.js - 自动化测试脚本

**功能：** 向 IRIS Web Broker 接口发送 HTTP 请求，用于测试类方法的远程调用。支持交互模式和命令行模式。

**使用方法：**

**方式一：交互模式**
```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js
```
脚本会依次提示输入：
- Token（认证令牌）
- ClassName（类名，如 `DHCDoc.EPMI.SERV.PatMerge`）
- MethodName（方法名，如 `getPatMergeList`）
- serverUrl（可选，默认从 `project-env.json` 的 `web.basePath` + `web.brokerPath` 生成）
- 额外参数（格式：`key1=value1&key2=value2`）

**方式二：命令行模式**
```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --token <token> --class <ClassName> --method <MethodName> [--params <JSON>]
```

**示例：**
```bash
# 基本用法
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --token abc123 --class DHCDoc.Util.Date --method GetDateInfo

# 带参数调用
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class DHCDoc.Util.Date --method GetDateInfo --params 'UserId=12175&ForceQuery=0'

# 自定义 URL 路径
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class DHCDoc.Util.Date --method GetDateInfo --path csp/custom.Broker.cls
```

**命令行参数：**
- `--token`：认证令牌（可选，不提供则为空字符串）
- `--class`：要调用的类名（必需）
- `--method`：要调用的方法名（必需）
- `--params`：额外的 URL 参数，格式为 `key=value&key2=value2`（可选）
- `--url`：自定义 serverUrl 路径（可选，会按 `project-env.json` 的 `web.basePath` 补齐前缀）

**请求详情：**
- **请求方法**：POST
- **Content-Type**：`application/x-www-form-urlencoded`
- **请求体**：URL-encoded 表单数据（包含 ClassName、MethodName 和其他参数）
- **响应格式**：JSON

**输出信息：**
- 请求 URL
- 类名和方法名
- 请求体内容
- 响应状态码
- 响应内容（自动格式化 JSON 或显示原始文本）

**特性：**
- ✅ 双模式支持（交互式和命令行）
- ✅ 自动加载项目配置
- ✅ 支持 HTTPS 和 HTTP
- ✅ 彩色控制台输出
- ✅ 自动解析 JSON 响应
- ✅ 完善的错误处理
- ✅ 支持自定义请求头
- ✅ 忽略 SSL 证书验证（开发环境友好）

**典型应用场景：**
- 测试 IRIS 后端 API 接口
- 调试 Web Broker 方法调用
- 验证业务逻辑返回值
- 快速原型测试

---

### 4. sync-env-config.js - 环境配置同步脚本

**功能：** 从集中配置文件生成 MCP 服务器配置。

**使用方法：**
```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
```

**生成的文件：**

1. **.mcp.json** - MCP 服务器配置文件
   - 配置 iris-dev 或其他 MCP 服务
   - 设置环境变量（IRIS_HOST、IRIS_PORT、IRIS_USERNAME 等）
   - 供其他工具（如 compile.js）使用

**配置来源：**
所有配置均从 `.agents/config/project-env.json` 读取，包括：
- IRIS 服务器连接信息（host、port、username、password、namespace、scheme）
- Web 路径配置（`web.basePath`、`web.cspBasePath`、`web.brokerPath`、可选 `web.cookie`）
- MCP 服务器名称和路径
- 可选 SFTP MCP 配置（`sftp.enabled=true` 时生成 `sftp-server`）

**特性：**
- ✅ 从单一配置文件同步多个配置
- ✅ 自动生成 `.mcp.json`
- ✅ 使用标准 JSON 格式（2 空格缩进）
- ✅ UTF-8 编码
- ✅ 详细的日志输出

**注意事项：**
- 修改 `.agents/config/project-env.json` 后运行此脚本
- 确保 `mcp.serverPath` 指向有效的可执行文件路径

---

## 🔄 工作流程建议

### 日常开发流程

1. **首次设置：**
   ```bash
   # 1. 配置项目环境
   # 编辑 .agents/config/project-env.json
   
   # 2. 同步 MCP 配置
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
   ```

2. **开发 IRIS 类文件：**
   ```bash
   # 编辑本地 src/ 目录下的 .cls 文件
   
   # 上传并编译到 IRIS 服务器
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js DHCDoc.Util.MyClass
   
   # 查看编译结果，如有错误则修复后重新编译
   ```

3. **导出 IRIS 文件到本地：**
   ```bash
   # 使用通用导出脚本
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js DHCDoc.AI.KBase
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js test.csp
   ```

4. **测试后端方法：**
   ```bash
   # 交互式测试
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js
   
   # 或命令行快速测试
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class DHCDoc.Util.Date --method GetDateInfo --params 'UserId=12175'
   ```

### 配置文件管理

所有敏感配置（用户名、密码等）统一存储在 `.agents/config/project-env.json` 中：
- ✅ 单一配置源，避免重复
- ✅ 便于版本控制管理（建议添加到 .gitignore）
- ✅ 所有脚本共享同一配置

---

## 💡 常见问题

### Q: 如何查看导出/编译进度？
A: 所有脚本都会在控制台输出详细的进度信息和状态报告。

### Q: 导出的文件保存在哪里？
A: 
- `export.js`：默认保存到 `src/` 目录，可通过第二个参数指定
- `compile.js`：不保存文件，仅上传到 IRIS 服务器
- `debugger.js`：不保存文件，仅显示响应结果
- `sync-env-config.js`：保存到项目根目录

### Q: 如何处理 HTTPS 自签名证书？
A: 所有脚本默认启用 `rejectUnauthorized: false`，支持自签名证书。

### Q: compile.js 编译失败怎么办？
A: 
1. 检查本地文件是否存在
2. 确认 IRIS 服务器可访问
3. 查看编译输出的错误信息（包含行号和列号）
4. 验证 `project-env.json` 中的 MCP 服务器路径是否正确
5. 确认 MCP 服务器可执行文件存在且可运行

### Q: debugger.js 返回 401 错误？
A: 
1. 确认 Token 是否正确
2. 检查 IRIS 服务器是否正常运行
3. 验证用户名和密码配置
4. 确认网络连接正常

### Q: 如何调试脚本问题？
A: 
1. 检查 `.agents/config/project-env.json` 配置是否正确
2. 确认 IRIS 服务器可访问
3. 查看控制台输出的错误信息
4. 验证网络连接和防火墙设置
5. 对于 compile.js，确认 MCP 服务器路径正确且可执行

---

## 📝 技术说明

### 使用的技术和 API

1. **Atelier API**（export.js）
   - 用于导出 IRIS 类、JS、CSP 文件
   - RESTful 接口，支持 HTTPS
   - 基于 InterSystems IRIS 内置的 Atelier 服务

2. **MCP 协议**（compile.js）
   - Model Context Protocol，用于与 IRIS 工具通信
   - 通过 stdio 传输 JSON-RPC 消息
   - 支持 `iris_doc` 和 `iris_compile` 工具调用
   - 提供详细的编译反馈

3. **HTTP/HTTPS 请求**（debugger.js）
   - 直接向 IRIS Web Broker 发送 POST 请求
   - 使用 URL-encoded 表单格式
   - 模拟浏览器请求头

4. **文件系统操作**（所有脚本）
   - 读写 JSON 配置文件
   - 生成工作区和设置文件
   - 自动创建目录结构

### 依赖项

- Node.js 14+（使用内置模块：https、http、fs、path、child_process、readline）
- 无需安装额外的 npm 包
- compile.js 需要 MCP 服务器可执行文件
- debugger.js 需要有效的 IRIS Web 服务

### 编码规范

- 所有脚本使用 UTF-8 编码
- JSON 文件使用 2 空格缩进
- 统一的错误处理机制
- 详细的控制台日志输出
- 彩色文本提示（debugger.js）

### 安全注意事项

- ⚠️ `project-env.json` 包含敏感信息（密码），不应提交到版本控制系统
- ⚠️ 建议将 `.agents/config/project-env.json` 添加到 `.gitignore`
- ⚠️ 生产环境请使用强密码和 HTTPS
- ⚠️ 定期更新和轮换凭据

