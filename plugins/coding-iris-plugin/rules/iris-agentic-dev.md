# iris-agentic-dev 使用约束

## TOML 配置文件

- 配置文件通常位于目标工程根目录 `.iris-agentic-dev.toml`，用于声明 IRIS 连接参数，例如 host、web_port、scheme、namespace。
- 凭据，例如用户名、密码、TLS 验证、token，不写入 TOML，由目标工程 `.mcp.json` 或环境变量承载。
- TOML 注释必须使用 ASCII 字符；非 ASCII 注释可能导致解析器静默失败。
- 修改 TOML 后，调用任意相关 MCP 工具通常可触发热加载，无需重启会话。

## 诊断

- 使用目标工程 MCP 提供的配置检查能力确认配置是否加载成功。
- 若检查结果中配置文件为空但连接仍可用，说明工具可能回退到自动发现或环境变量，应检查 TOML 路径、编码和注释字符。
- 不把某个工程的 host、namespace 或端口写入插件规则。
