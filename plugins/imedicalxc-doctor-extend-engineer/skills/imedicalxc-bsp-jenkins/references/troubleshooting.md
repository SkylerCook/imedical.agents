# 问题排查

## 常见问题排查

### 1. 触发构建返回 403 Forbidden

**现象**：`jenkins_jenkins_build` 返回 `HTTP 403 No valid crumb was included`

**原因**：Jenkins 启用了 CSRF 保护，POST 请求需要携带 crumb token 和 session cookie。

**解决**：
- **首选**：确保 MCP Server 已正确处理 crumb（更新 MCP Server 代码）
- **备用**：使用 curl 手动携带 crumb + cookie jar

```bash
curl -s -c cookies.txt -b cookies.txt \
  -u $JENKINS_USER:$JENKINS_TOKEN \
  $JENKINS_URL/crumbIssuer/api/json

curl -s -c cookies.txt -b cookies.txt \
  -u $JENKINS_USER:$JENKINS_TOKEN \
  -H "Jenkins-Crumb: <crumb-value>" \
  -X POST \
  $JENKINS_URL/job/<job-name>/build
```

### 2. 构建长时间卡在队列中不执行

**现象**：`jenkins_jenkins_queue` 显示 `why: "Waiting for next available executor"`

**原因**：Jenkins master 节点只有 2 个 executor，可能都被占用。

**排查**：
1. 检查当前运行中的构建：
   ```
   jenkins_jenkins_list_jobs
   ```
   查找 `status: "building"` 的 Job
2. 如果无可见运行构建但 executor 仍忙，可能是 Pipeline 内部子阶段占用了 executor
3. 等待或取消卡住的队列项

**解决**：
- 等待当前构建完成
- 或联系 Jenkins 管理员增加 executor 数量

### 3. 构建失败常见原因

| 失败类型 | 排查方向 | 查看位置 |
|---------|---------|---------|
| Maven 依赖下载失败 | Nexus 网络/私服可用性 | 构建日志开头的 `Downloading from nexus` |
| 编译错误 | 代码语法/API 变更 | 构建日志中的 `[ERROR]` |
| 单元测试失败 | 测试代码问题 | `maven-surefire-plugin` 输出（多数模块目前 `No tests to run`） |
| 打包/部署失败 | 磁盘空间、Nexus 写入权限 | 日志末尾的 `maven-deploy-plugin` |
| 内存溢出 | JVM 参数不足 | `OutOfMemoryError` |

### 4. 找不到对应模块的 Job

**排查步骤**：
1. 使用模块名关键词过滤：
   ```
   jenkins_jenkins_list_jobs filter="opcare"
   ```
2. 参考 `module-catalogue.md` 中的业务域速查表，根据前缀定位
3. 如果模块未找到，可能是：
   - 模块名拼写错误
   - 该模块尚未在 Jenkins 上创建 Job（状态 `not_built`）
   - 模块已合并到其他 Pipeline 中构建

### 5. 下游流水线未按预期触发

**排查**：
1. 检查上游构建的 threshold 配置：
   - `base→common` 和 `ar→msup` 是 `FAILURE` threshold（失败也会触发）
   - 其余链路是 `SUCCESS` threshold（只有成功才触发）
2. 检查上游构建的实际结果：
   ```
   jenkins_jenkins_build_status name="<upstream-pipeline>"
   ```
3. 检查下游 Pipeline 的 `buildable` 状态是否为 `true`

### 6. 构建成功但服务未更新

**原因**：Jenkins 构建仅将 SNAPSHOT 包 deploy 到 Nexus，服务端不会自动加载新包。

**解决**：
- 执行 `restart-all-hisapps` 重启服务
- 或联系运维执行对应模块的独立重启脚本
