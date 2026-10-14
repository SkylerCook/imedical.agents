# IRIS 开发主力脚本集合

需求提交与补录已移交独立 owner，原 CLI 已移除。使用 CapabilityRoot 下 plugins/demand-delivery-plugin/scripts/commit-demand.js 与 plugins/bos-plugin/scripts/demand-entry.js。

这些 Node.js 脚本用于生成部署清单、从 IRIS 服务器导出文件、编译类文件、调试方法调用以及同步环境配置。

## 配置说明

所有脚本都从业务项目 `.agents/config/project-env.json` 读取连接参数。首次使用前先确认配置事实来源：已有 `.mcp.json` 时，从 `.mcp.json` 反向生成或补齐 `project-env.json`；没有 `.mcp.json` 时，才从 `.agents/plugins/coding-iris-plugin/templates/project-env.template.json` 复制并填写真实环境，再运行 `sync-env-config.js` 生成 `.mcp.json`。模板默认使用内置 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe` 作为后端 MCP server 路径。这些文件包含敏感信息，不应提交到版本控制系统。

工具优先级：

1. 优先使用本目录脚本完成导出、类编译、Broker 调试和环境同步。
2. 后端 MCP 用于补充脚本未覆盖的 introspect、只读 SQL、远端状态验证和 ObjectScript 执行。
3. `sftp-server` MCP 是可选前端上传能力；目标项目未配置时，不应阻塞开发或臆造上传能力。
4. CSP 编译使用 `compile-csp.js`，上传后按明确的 WebApp 虚拟路径通过 Atelier 编译，不走 `compile.js` 或任意代码执行。

## 📁 脚本列表

- `query-knowledge.js`：从 CapabilityRoot 的共享参考库与指定 sourceId 的当前项目菜单中按字面量检索，返回来源、行号和有界片段。
- `sync-menu.js`：接受完整采集 JSON，plan 只读比较，apply 校验指纹后写入 ContextRoot/work/menu-sync。采集由 iris-menu-sync skill 复用原生 MCP，脚本自身不联网。用法与输入见 [菜单同步](../../references/menu-knowledge-sync.md)。

### 1. export.js - 通用导出脚本（推荐）

**功能：** 智能检测文件类型并自动从 IRIS 服务器导出文件（支持 `.cls/.mac/.inc/.int/.js/.csp/.css`）。

**使用方法：**
```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <文件标识符> [输出目录] [命名空间] [--basePath <前缀>]
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <文件标识符> --probe --json
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js <文件标识符> --staging-dir <临时目录> --json
```

**示例：**
```bash
# 导出类文件（通过点号自动识别）
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js Sample.Package.Class

# 导出 JS 文件（自动添加 project-env.json 中 web.basePath 前缀）
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/Alloc.ExaBorRoom.hui.js

# 导出 CSP 文件（自动添加 project-env.json 中 web.cspBasePath 前缀）
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js alloc.exaborroom.hui.csp

# 使用完整路径导出
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js --basePath "<web-root-prefix>"

# 自定义输出目录和命名空间
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js Sample.Package.Class my-output <namespace>

# 禁用自动 basePath 前缀
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js --basePath ""
```

**自动检测规则：**

脚本根据以下规则自动识别文件类型：

1. **类文件**：包含点号但不包含斜杠，且不以 `.js` 或 `.csp` 结尾
   - 示例：`Sample.Package.Class` → 导出为 `.cls` 文件

2. **JS 文件**：以 `.js` 结尾、包含 `.hui.js`，或位于 `scripts/` 目录下
   - 如果不存在则自动添加 `project-env.json` 中的 `web.basePath` 前缀
   - 示例：`scripts/test.js` → `<web-root-prefix>/scripts/test.js`

3. **CSP 文件**：以 `.csp` 结尾
   - 如果不存在则自动添加 `project-env.json` 中的 `web.cspBasePath` 前缀
   - 示例：`test.csp` → `<web-root-prefix>/csp/test.csp`

4. **CSS 文件**：以 `.css` 结尾，使用 `web.basePath`；其它静态资源不会按扩展名自动推断。

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

### 2. compile.js - 后端上传与编译

复用项目 Atelier 连接，默认 direct 按指定 .cls/.mac/.inc 本地文件完成条件上传、回读和编译。源码及暂存区保持不变。

    node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js --project-root . --files src/Sample/Util/Date.cls --execute

direct 无需需求号或 Git 会话。需要三方合并时先按部署契约建立会话，再使用 `--mode guarded --demand <需求号>`；旧命令仅带 `--demand` 保持 guarded。原类名/位置参数调用被拒绝，环境来自私有配置。没有 --execute 只生成计划。

direct 输出 verified、blocked、compile-failed 或 failed-or-unknown；guarded 可返回 needs-user-input。具体文件、哈希、人工决定及恢复流程见 [部署保护](../../references/deployment-protection.md)。CSP 沿用 compile-csp.js，不进入后端文档入口。

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
- ClassName（类名，如 `Sample.Package.Service`）
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
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --token abc123 --class Sample.Util.Date --method GetDateInfo

# 带参数调用
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class Sample.Util.Date --method GetDateInfo --params 'UserId=12175&ForceQuery=0'

# 自定义 URL 路径
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class Sample.Util.Date --method GetDateInfo --path csp/custom.Broker.cls
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

**功能：** 从 `.agents/config/project-env.json` 生成 MCP 服务器配置。仅当 `project-env.json` 是配置事实来源时使用；已有 `.mcp.json` 的工程不要用它覆盖运行时配置。

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
- 仅当 `.agents/config/project-env.json` 是事实来源时，修改后运行此脚本
- 若 `.mcp.json` 已是事实来源，先从 `.mcp.json` 反向补齐 `project-env.json`，不要运行此脚本覆盖 `.mcp.json`
- 确保 `mcp.serverPath` 指向有效的可执行文件路径

---

### 5. prepare-deploy-manifest.js - 部署清单生成脚本

**功能：** 根据文件列表或 git diff 生成 IRIS 部署 JSON 清单。脚本只做本地分析，不执行上传、编译、SFTP 同步或远端写入。

**使用方法：**
```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --files <path...>
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js --from-git --base HEAD
```

**输出内容：**
- `schema`：清单格式版本。
- `namespace`：来自 `.agents/config/project-env.json -> iris.namespace`。
- `items[]`：每个文件的类型、相对路径、存在性和部署路径信息。
- `.cls/.mac/.inc`：生成 IRIS 文档名。
- `.csp`：生成 WebApp 虚拟路径，用于后续 CSP 编译。
- `.js/.css/.html`：生成 Web 资源路径，用于后续上传映射确认。

**注意事项：**
- 本脚本不是部署执行器，不读取或输出账号、密码、token、Cookie。
- 清单用于部署前评审和确认；远端写入仍必须按 `iris-deploy` 和 `rules/iris_deploy_checklist.md` 执行。
- `requiresStorageStrip=true` 表示部署前必须检查实体类或 Storage Default 风险，不代表脚本已改写源文件。

---

## 🔄 工作流程建议

### 日常开发流程

1. **首次设置：**
   - 已有 `.mcp.json`：从 `.mcp.json` 反向补齐 `.agents/config/project-env.json`。
   - 没有 `.mcp.json`：编辑 `.agents/config/project-env.json` 后运行同步脚本。
   ```bash
   # 1. 配置项目环境
   # 编辑 .agents/config/project-env.json
    
   # 2. 仅当 project-env.json 是事实来源时同步 MCP 配置
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/sync-env-config.js
   ```

2. **开发 IRIS 类文件：**
   ```bash
   # 编辑本地 src/ 目录下的 .cls 文件
   
   # 上传并编译到 IRIS 服务器
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/compile.js --files src/Sample/Util/MyClass.cls --execute
   
   # 查看编译结果，如有错误则修复后重新编译
   ```

3. **导出 IRIS 文件到本地：**
   ```bash
   # 使用通用导出脚本
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js Sample.Package.Class
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js scripts/test.js
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/export.js test.csp
   ```

4. **测试后端方法：**
   ```bash
   # 交互式测试
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js
   
   # 或命令行快速测试
   node .agents/plugins/coding-iris-plugin/scripts/iris-tools/debugger.js --class Sample.Util.Date --method GetDateInfo --params 'UserId=12175'
   ```

### 配置文件管理

敏感配置（用户名、密码等）只保存在目标工程本地私有文件中：
- ✅ 已有 `.mcp.json` 时以 `.mcp.json` 为事实来源，`project-env.json` 作为脚本可读副本
- ✅ 无 `.mcp.json` 时以 `project-env.json` 为填写来源，再生成 `.mcp.json`
- ✅ 两个文件都不得提交到业务项目版本库

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
5. 确认 MCP 服务器可执行文件存在且可运行；Windows x64 默认路径是 `.agents/vendor/iris-agentic-dev/windows-x64/iris-agentic-dev.exe`

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
5. 对于 compile.js，核对模式、Atelier 连接与失败阶段；仅 guarded 检查基线会话及 needs-user-input 原因

---

## 📝 技术说明

### 使用的技术和 API

1. **Atelier API**（export.js）
   - 用于导出 IRIS 类、JS、CSP 文件
   - RESTful 接口，支持 HTTPS
   - 基于 InterSystems IRIS 内置的 Atelier 服务

2. **Atelier API**（compile.js）
   - 文档导出、携带版本时间戳的上传、回读和现有 action/compile 编译
   - 不设置 ignoreConflict，不自动重试

3. **HTTP/HTTPS 请求**（debugger.js）
   - 直接向 IRIS Web Broker 发送 POST 请求
   - 使用 URL-encoded 表单格式
   - 模拟浏览器请求头

4. **文件系统操作**（所有脚本）
   - 读写 JSON 配置文件
   - 生成工作区和设置文件
   - 自动创建目录结构

### 依赖项

- Node.js 22.5.0+（使用内置模块：https、http、fs、path、child_process、readline）
- 无需安装额外的 npm 包
- compile.js 使用 .mcp.json 中已配置的 Atelier 连接
- debugger.js 需要有效的 IRIS Web 服务

### 编码规范

- 所有脚本使用 UTF-8 编码
- JSON 文件使用 2 空格缩进
- 统一的错误处理机制
- 详细的控制台日志输出
- 彩色文本提示（debugger.js）

### 安全注意事项

- ⚠️ `project-env.json` 和 `.mcp.json` 包含敏感信息（密码），不应提交到版本控制系统
- ⚠️ 建议确认 `.agents/.git/info/exclude` 已忽略 `/config/`
- ⚠️ 生产环境请使用强密码和 HTTPS
- ⚠️ 定期更新和轮换凭据


## 前端固定部署入口

前端上传加编译统一调用 `scripts/iris-tools/deploy-frontend.js`。默认生成本地计划；已有明确部署授权后加 `--execute`，无需逐步骤重复确认。禁止为常规部署临时生成上传脚本或逐次探索编译工具。

```bash
node .agents/plugins/coding-iris-plugin/scripts/iris-tools/deploy-frontend.js --source-root <frontend-root> --files <project-relative-file...> --execute
```

`--source-root` 对应包含 `csp/`、`scripts/`、`css/` 的目录，映射到私有配置 `REMOTE_PATH`；省略时读取 SFTP 的 `LOCAL_PATH`。文件列表必须明确，CSP 虚拟路径取 `web.cspBasePath`。direct 固定顺序：本地 UTF-8/语法/路径/配置校验 → 一次 SFTP 连接整批比较 SHA-256 → 仅差异文件原子上传并立即校验最终目标 → 汇总全部逐文件证据 → 一次 Atelier 编译指定 CSP。保留上传前本地与远端变化检查，并在临时文件上传完成、替换前再次检查远端摘要；连接中断即停止，不重新连接。未变化 CSP 仍执行编译；JS/CSS 不触发编译。不自动扩展父页面，不重试、不切换通道；部分上传成功后失败不自动回滚。

Python 默认使用 `.mcp.json` 对应 SFTP 的 `command`，可用 `--python <interpreter>` 明确覆盖；解释器须已安装 vendor 锁定依赖。可信主机密钥使用配置或 `--known-hosts <file>`；本次明确核实的指纹可用 `--host-key-sha256 <SHA256:fingerprint>`，不写入信任库，不自动接受未知密钥。两个参数互斥。

默认 direct 返回文件哈希、逐文件状态和编译诊断；guarded 另提供 merged、sourceUnchanged 及 needs-user-input 的私有证据。verified 仅证明回读及指定编译完成，页面功能另行验收；混合产物不能视为纯 Git 版本验收。仅编译继续使用 compile-csp.js，不转换历史 GB2312。

2026-09-15：更新自动刷新既有标准 SFTP 启动参数为 vendor，不要求 runtime opt-in；保留解释器、env、disabled 和其它服务。显式 custom 或自定义参数不覆盖，不创建缺失服务，不安装 Python 依赖。

## 开发部署与可选基线保护

日常开发部署默认 direct：明确目标、文件和授权后执行，不要求需求号、Git 基线会话或 fetch/pull；保留编码、Storage、并发变化、回读和编译检查。需要三方合并时显式使用 `--mode guarded --demand <id>` 并建立会话。旧命令仅带 `--demand` 继续使用 guarded。完整契约见 references/deployment-protection.md（从插件根解析）；无 `--execute` 只生成本地计划。

部署 Question 兼容：停止结果提供工具无关 question 协议，固定决定代码；Agent 按能力采用选项或文字确认。暂停/查看/无效决定不写入。详见 references/deployment-protection.md。

部署传输治理（0.15.8）：direct 保留批处理，guarded 保留 Git 基线、三方合并、逐文件持久化和编译后检查；两者共用 vendor `deployment.py` 与 `Operations.transfer`。guarded 在一次执行内保持一个 Python 会话和一条 SFTP 连接，最终目标摘要由 worker 返回供外层复用，不再为同阶段验证启动进程回读。旧单请求 worker 输入仍可用；不新增 Python 依赖或远端 Shell 权限。

结果中 `uploaded` 表示最终目标已校验，`unchanged` 表示本次摘要确认相同且零写入；`failed` 表示已确认的失败，`failed-or-unknown` 表示替换可能发生但结果无法确认，`not-executed` 表示未执行。每个计划文件仅一条结果，保留已成功取得的证据；这不是服务器持续不变的承诺。失败停止，不自动重试或回滚。guarded 编译后检查继续独立执行。

耗时先看 `timings.totalMs`（本次 CLI main 入口至连接/本地临时文件清理结束），再看 `localPreflightMs`、`uploadVerifyMs`、`compileMs` 及 `transport.startupMs`、`transport.timings`。worker-start 包含 Python 启动与模块导入；connect 包含 SSH 握手/认证和 SFTP 打开；compare、before-upload、before-replace、upload、temporary-verify、final-verify 分别计时。各字段存在包含关系，不可简单相加。用户等待、工具修复及多次命令累计另计，不能用单批上传时间替代。

`transport.counts` 记录连接尝试数、文件读/写打开尝试数和应用层成功读取/写入字节数（不含协议开销；中断时可能只是已确认下界）。stderr 逐行 JSON 进度只包含文件序号、总数、阶段及耗时；stdout 保持单个最终 JSON，不输出源码和凭据。强杀时保留已收到的逐文件证据和本次已知临时路径，未完成结果保守标为不明。

替换前摘要检查与 rename 之间仍有竞争窗口，不是原子条件写入。正常及可处理异常会关闭连接、清理本次临时文件；断线或强杀不能保证 finally 执行。`transport.cleanupPending` 是需要人工核实的本次远端临时路径；恢复先检查最终目标和临时文件实际状态，不能依据名字批量删除或盲目补传。

已部署工程通过正常能力包更新同时取得插件脚本及完整 `vendor/sftp-server/src/`，不可只复制一个入口；无配置/状态迁移和旧文件清理。源仓修改不会自动更新业务副本，也不要求重新部署已完成的业务文件。

### 工作区预检与提交复核

部署、CSP 编译和 SFTP 配置入口共用 workspace 校验结果；目录缺失、错误链接及无效 manifest 在配置读取和远端连接前停止并返回非零退出码。能力包必须为有效安装（含 CapabilityRoot 的 .git）；direct 仍不要求业务源码 Git 仓库或基线会话。

`plugins/demand-delivery-plugin/scripts/commit-demand.js verify --plan <plan.json>` 接受 committed 和 verified 状态，重试仍重新读取提交消息与完整文件集合；缺少或额外路径均失败。路径按 NUL 分隔读取，重命名按删除与新增两端比较。

部署配置支持 Overlay 显式 `projectEnvFallback`：模块文件优先，仅缺失时读取声明的主仓文件；具体范围、冲突停止与源码隔离规则以 [部署清单](../../rules/iris_deploy_checklist.md#部署配置继承) 为准，不切换项目根或生成副本。
