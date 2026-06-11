# 部署通用经验

> 积累自实际部署过程的通用检验清单与踩坑记录，按分类组织。

已提升通用入口：`plugins/coding-iris-plugin/skills/iris-deploy/SKILL.md`；已提升清单脚本：`plugins/coding-iris-plugin/scripts/iris-tools/prepare-deploy-manifest.js`。

## 维护规则

1. **去重 + 累积**：新增经验前搜索已有条目。若知识点已存在，不重复内容，仅在「需求」行追加新场景，并 `命中+1`。
2. **场景追溯**：每条经验记录「场景」行，列出命中该经验的所有部署场景。跨多个场景沉淀的通用经验标注 `(通用)`。
3. **命中计数**：「命中」数字表示该经验被多少个部署场景触发过。
4. **分类追加**：新经验按分类（后端编译/前端上传/CSP 编译/SFTP/检验清单）追加到对应章节末尾。
5. **经验粒度**：一条经验对应一个独立知识点，避免混合多个不相关主题。
6. **可操作性**：必须包含具体做法或示例代码，避免仅描述问题而无解决方案。
7. **反哺标记**：当候选经验被提升为 plugin rule 时，在本条目中追加「已提升: `rules/xxx.md`」标记，不删除原条目。
8. **领域标签**：如果某个领域独立性足够强（如纯 SFTP 经验），在章节标题后标注类型标签，方便后续筛选或拆分。
9. **场景索引**：新增经验条目时，同步更新文档末尾的「场景索引」章节。

### 条目格式

```markdown
### x.x 标题
- 场景: dental-ws 首次全量部署 | 命中: 1
- **正文**...
```

---

## 一、后端 - IRIS 类编译

### 1.1 实体类 Storage Default 块导致编译 #5559
- 场景: dental-ws 首次全量部署 | 命中: 1
- **问题**：含 `SqlComputeCode = { s {*} = ... }` 属性的持久化实体类，编译时报 `ERROR #5550: class definition could not be parsed correctly`。
- **根因**：`Storage Default { ... }` 块中的 XML 内容与 `SqlComputeCode` 的嵌套大括号冲突，IRIS 解析器无法正确识别。
- **解决方案**：上传前剥离 `Storage Default` 块。编译后 IRIS 会根据类定义自动重新生成 Storage。
- **剥离代码**（行级大括号计数器，不依赖正则）：
  ```javascript
  function stripStorageDefault(content) {
    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const result = [];
    let inStorage = false, braceDepth = 0;
    for (const line of lines) {
      if (!inStorage && line === 'Storage Default') { inStorage = true; continue; }
      if (inStorage) {
        if (line.trim() === '{') { braceDepth++; continue; }
        if (line.trim() === '}' && braceDepth > 0) { braceDepth--; if (braceDepth === 0) { inStorage = false; continue; } }
        continue;
      }
      result.push(line);
    }
    return result.join('\n');
  }
  ```
- **判断标准**：如果 `.cls` 文件包含 `Storage Default` 关键字且含有 `SqlComputeCode`，需要剥离。非实体类（BLH/DATA/SQL/COM）通常不含 Storage Default，无需处理。

### 1.2 实体类跨包依赖需先全部上传再编译
- 场景: dental-ws 首次全量部署 | 命中: 1
- **问题**：按包分批编译时，CF 包实体类先编译，但其引用的 CT 包实体类仍处于旧状态（已去 Storage Default 但未编译），导致类型引用不一致，编译失败。
- **解决方案**：将所有实体类合并为单组，先全部上传（去 Storage Default），再统一编译，确保依赖链完整后再编译非实体类。
- **编译顺序**：实体类（全部上传 → 全部编译）→ COM 公共类 → CF BLH → CT BLH → DHCDoc BLH。

### 1.3 Windows CRLF 换行导致文本处理失败
- 场景: dental-ws 首次全量部署 | 命中: 1
- **问题**：正则 `/\nStorage Default\n\{[\s\S]*?\n\}\n/g` 无法匹配任何内容。
- **根因**：Windows 本地 `.cls` 文件使用 `\r\n` (CRLF) 换行，正则只匹配 `\n` (LF)。
- **解决方案**：处理文本前统一换行：`content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')`。
- **通用原则**：Node.js 脚本处理来自 Windows 文件系统的文本时，必须先统一换行符。

### 1.4 实体类上传需先删除旧版本
- 场景: dental-ws 首次全量部署 | 命中: 1
- **问题**：直接 `iris_doc put` 覆盖含 Storage Default 的实体类时，新旧内容可能混在一起。
- **解决方案**：对实体类使用 delete-then-reupload 策略：先 `iris_doc delete`，再 `iris_doc put`。
- **注意**：非实体类（BLH/DATA/SQL/COM）可直接 put 覆盖，无需先 delete。

---

## 二、前端 - SFTP 上传 (SFTP)

### 2.1 sync_directory 的 IGNORE_PATTERNS 在 Windows 上对 .git/ 目录模式失效
- 场景: dental-ws 首次全量部署 | 命中: 1
- **问题**：`IGNORE_PATTERNS` 设置了 `.git/`，但 `sync_directory` 仍然上传了 `.git/` 目录下的 160+ 个文件。
- **根因**：`sftp-server` 的 `_should_ignore` 使用 Python `os.path.relpath`，在 Windows 上返回反斜杠路径（如 `.git\COMMIT_EDITMSG`），但目录模式 `.git/` 用正斜杠做子串匹配，导致不匹配。
- **解决方案**：不依赖全局 ignore，改为分目录 `sync_directory`：
  ```javascript
  // 只同步 csp/ 和 scripts/，不碰 .git/
  await mcp.callTool('sync_directory', {
    local_dir: path.join(frontendDir, 'csp'),
    remote_dir: '/dthealth/app/dthis/web/csp'
  });
  await mcp.callTool('sync_directory', {
    local_dir: path.join(frontendDir, 'scripts'),
    remote_dir: '/dthealth/app/dthis/web/scripts'
  });
  ```
- **通用原则**：SFTP MCP 的 `IGNORE_PATTERNS` 目录模式在 Windows 上有路径分隔符 bug，分目录同步是更可靠的方式。

### 2.2 upload_file 是全量覆盖的可靠方式
- 场景: dental-ws 首次全量部署 | 命中: 1
- **问题**：`sync_directory` 只上传比远端更新的文件（时间戳比较），无法保证"全量覆盖"。
- **解决方案**：如果需要强制覆盖，使用 `upload_file` 逐个上传（总是覆盖远端文件）。
- **选择建议**：
  - 首次部署或确认远端版本较旧：`sync_directory`（高效，一次调用）
  - 要求强制全量覆盖：`upload_file` 逐个调用（可靠，但调用次数多）

---

## 三、CSP 编译

### 3.1 iris_execute 默认在 USER 命名空间执行，CSP 编译必须显式传 namespace 参数
- 场景: dental-ws 首次全量部署 | 命中: 1
- **问题**：CSP 编译报 `ERROR #5920: Must use web page '/imedical/web/csp/xxx.csp' from namespace 'DHC-APP' and not current namespace 'USER'`。
- **根因**：`iris_execute` 工具默认在 `USER` 命名空间执行代码（即使 MCP 配置了 `IRIS_NAMESPACE=DHC-APP`），而 CSP Web 应用注册在 `DHC-APP` 命名空间。
- **失败尝试**：在 ObjectScript 代码中加 `zn "DHC-APP"`——无效，因为 `iris_execute` 在临时生成类（`User.IrisDevRun*.G1`）中运行，`zn` 不持久化且返回空 output。
- **正确方案**：`iris_execute` 调用时显式传 `namespace` 参数：
  ```javascript
  // ❌ 错误：默认 namespace=USER
  await mcp.callTool('iris_execute', {
    code: 's result=$system.OBJ.Load("imedical/web/csp/xxx.csp","c") w result'
  });

  // ✅ 正确：显式指定 namespace
  await mcp.callTool('iris_execute', {
    code: 's result=$system.OBJ.Load("imedical/web/csp/xxx.csp","c") w result',
    namespace: 'DHC-APP'  // 关键参数！
  });
  ```
- **成功判断**：编译成功时输出包含 `Load finished successfully.` + `Compiling file`。

### 3.2 CSP 文件虚拟路径格式
- 场景: dental-ws 首次全量部署 | 命中: 1
- **路径映射**：
  - 本地文件：`frontend/csp/doc.dental.ta.wks.csp`
  - 远程物理路径：`/dthealth/app/dthis/web/csp/doc.dental.ta.wks.csp`
  - `$system.OBJ.Load` 虚拟路径：`imedical/web/csp/doc.dental.ta.wks.csp`（无前导 `/`）
- **虚拟路径拼接**：`{cspBasePath}/{filename}`，其中 `cspBasePath = imedical/web/csp`（来自 `web.cspBasePath` 配置）。
- **注意**：不要用 `iris_doc` 上传 CSP 文件，CSP 上传走 SFTP，编译走 `iris_execute`。

---

## 四、检验清单

每次部署完成后，按以下清单自检：

| # | 检验项 | 说明 |
|---|--------|------|
| 1 | 实体类是否去 Storage Default | 含 `SqlComputeCode` 的实体类上传前必须剥离 Storage Default 块 |
| 2 | 实体类是否合并编译 | 跨包依赖的实体类先全部上传再统一编译 |
| 3 | 换行符是否统一 | Windows 文件处理前 CRLF → LF |
| 4 | SFTP 上传范围是否正确 | 只上传 csp/ 和 scripts/，不传 .git/ |
| 5 | CSP 编译 namespace 参数 | `iris_execute` 必须传 `namespace` 参数，不能依赖 `IRIS_NAMESPACE` 环境变量 |
| 6 | CSP 虚拟路径是否正确 | `imedical/web/csp/xxx.csp`，不含前导 `/` |
| 7 | 编译结果确认 | 成功标志：`Load finished successfully.` |

---

## 场景索引

| 场景 | 描述 | 关联文件 | 命中经验 |
|---|------|----------|----------|
| dental-ws 首次全量部署 | 口腔技工单前后端首次部署到 159 服务器 | [`.agents/docs/deploy/dental-ta-159/`](/.agents/docs/deploy/dental-ta-159/README.md) | [1.1](#11-实体类-storage-default-块导致编译-5559), [1.2](#12-实体类跨包依赖需先全部上传再编译), [1.3](#13-windows-crlf-换行导致文本处理失败), [1.4](#14-实体类上传需先删除旧版本), [2.1](#21-sync_directory-的-ignore_patterns-在-windows-上对-git-目录模式失效), [2.2](#22-upload_file-是全量覆盖的可靠方式), [3.1](#31-iris_execute-默认在-user-命名空间执行csp-编译必须显式传-namespace-参数), [3.2](#32-csp-文件虚拟路径格式) |
