# MCP 配置指南

## Jenkins MCP Server 配置

### 环境变量

Jenkins MCP Server 通过以下环境变量连接 Jenkins：

| 变量 | 必填 | 说明 |
|------|------|------|
| `JENKINS_URL` | 是 | Jenkins 服务器地址，如 `http://localhost:8080` |
| `JENKINS_USER` | 是 | Jenkins 用户名 |
| `JENKINS_TOKEN` | 是 | Jenkins API Token（非密码，需在用户设置中生成） |
| `JENKINS_TIMEOUT` | 否 | 请求超时毫秒数，默认 `30000` |

### 生成 API Token

1. 登录 Jenkins Web UI
2. 点击右上角用户名 → **Configure**
3. 找到 **API Token** 部分
4. 点击 **Add new Token** → 输入名称 → 点击 **Generate**
5. 复制生成的 token（只显示一次）

### MCP 配置示例

#### costrict.json（本地开发）

```json
{
  "mcp": {
    "jenkins": {
      "type": "local",
      "command": ["node", "/path/to/mcp-jenkins/index.js"],
      "environment": {
        "JENKINS_URL": "http://<host>:<port>",
        "JENKINS_USER": "<username>",
        "JENKINS_TOKEN": "<api-token>",
        "JENKINS_TIMEOUT": "30000"
      },
      "timeout": 10000
    }
  }
}
```

#### Claude Desktop Config

```json
{
  "mcpServers": {
    "jenkins": {
      "command": "node",
      "args": ["/path/to/mcp-jenkins/index.js"],
      "env": {
        "JENKINS_URL": "http://<host>:<port>",
        "JENKINS_USER": "<username>",
        "JENKINS_TOKEN": "<api-token>"
      }
    }
  }
}
```

### MCP Server 实现要点

如果自行实现 Jenkins MCP Server，需处理以下关键逻辑：

**1. CSRF Crumb 支持**

Jenkins 默认启用 CSRF 保护，所有 POST 请求需要 crumb：

```javascript
async function getCrumb() {
  const res = await fetch(`${JENKINS_URL}/crumbIssuer/api/json`, {
    headers: { Authorization: authHeader }
  });
  return res.json(); // { crumb, crumbRequestField }
}

async function triggerBuild(jobName) {
  const crumb = await getCrumb();
  await fetch(`${JENKINS_URL}/job/${jobName}/build`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      [crumb.crumbRequestField]: crumb.crumb
    }
  });
}
```

> **注意**：crumb 需要与 session cookie 配合使用。如果 HTTP 客户端不自动保存 cookies，可能需要额外配置（如 `tough-cookie`）。

**2. 暴露的 MCP Tools**

建议实现以下 tools：

| Tool | 功能 |
|------|------|
| `jenkins_test_connection` | 测试连接 |
| `jenkins_list_jobs` | 列出所有 Job，支持过滤 |
| `jenkins_get_job` | 获取 Job 详情 |
| `jenkins_build` | 触发构建（支持参数） |
| `jenkins_build_status` | 查询构建状态 |
| `jenkins_build_history` | 查看构建历史 |
| `jenkins_console_log` | 获取构建日志 |
| `jenkins_queue` | 查看构建队列 |

**3. 状态转换**

Jenkins Job `color` 字段转状态：

| color | status |
|-------|--------|
| `blue` | `success` |
| `blue_anime` | `building` |
| `red` | `failure` |
| `red_anime` | `building` (曾失败) |
| `yellow` | `unstable` |
| `grey` / `disabled` | `disabled` |
| `notbuilt` | `not_built` |
| `aborted` | `aborted` |

### 验证配置

配置完成后，执行以下命令验证：

```
jenkins_jenkins_test_connection
```

预期返回：
```json
{
  "status": "connected",
  "config": {
    "url": "http://<host>:<port>",
    "user": "<username>"
  }
}
```
