# IRISGraph Schema

> 后端 ObjectScript 代码图谱 Schema，用于 IRIS-Local 工程的 AI HIS 研发知识中台。
> 与前端 CodeGraph（`.codegraph/codegraph.db`）共用 SQLite 四表结构：`files`、`nodes`、`edges`、`project_metadata`。

---

## 1. 设计目标

- **统一查询入口**：复用 `.agents/plugins/codegraph-query/scripts/cg-query.js` 的 SQLite schema 风格，便于阶段 3 统一中台查询。
- **覆盖后端核心实体**：Class / Method / Property / Parameter / Routine / Include / Global / SQLTable / RESTRoute / CSPPage / Macro。
- **支撑影响分析**：通过 `calls` / `reads` / `writes` / `uses` 等边回答“修改某代码影响哪些代码”。

---

## 2. SQLite 表结构

### 2.1 files

```sql
CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    language TEXT,
    module TEXT,
    last_modified INTEGER
);
```

| 字段 | 说明 |
|------|------|
| `path` | 文件相对项目根目录的路径，如 `src/backend/epmi/BL/DHCEPMI.CardMain.cls` |
| `language` | `objectscript` / `csp` / `mac` / `inc` |
| `module` | 子模块名，如 `epmi` / `doc` / `cure` |
| `last_modified` | 文件 mtime，用于增量更新 |

### 2.2 nodes

```sql
CREATE TABLE nodes (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    qualified_name TEXT,
    file_path TEXT,
    start_line INTEGER,
    end_line INTEGER,
    signature TEXT,
    visibility TEXT,
    is_exported INTEGER,
    is_static INTEGER,
    docstring TEXT,
    language TEXT,
    module TEXT,
    metadata TEXT
);
```

| 字段 | 说明 |
|------|------|
| `kind` | 节点类型，见下文“节点类型” |
| `name` | 短名称，如 `CardMain` / `SaveCard` |
| `qualified_name` | 全限定名，如 `DHCEPMI.CardMain` / `DHCEPMI.CardMain::SaveCard` |
| `file_path` | 所在文件路径 |
| `start_line` / `end_line` | 在文件中的起止行号 |
| `signature` | 方法签名/形式参数，如 `(%val:%RawString="") As %Library.Status` |
| `visibility` | `public` / `private` / `protected` |
| `is_exported` | 是否导出/公开，方法无 `Private` 关键字为 1 |
| `is_static` | 是否为 ClassMethod（1）或 Instance Method（0） |
| `docstring` | 类或方法的注释摘要 |
| `language` | `objectscript` / `csp` / `mac` / `inc` |
| `module` | 所属子模块 |
| `metadata` | JSON 附加字段（如参数默认值、返回类型、SQL 表名） |

### 2.3 edges

```sql
CREATE TABLE edges (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    source INTEGER NOT NULL,
    target INTEGER NOT NULL,
    file_path TEXT,
    start_line INTEGER,
    start_column INTEGER,
    end_column INTEGER,
    confidence REAL,
    metadata TEXT,
    FOREIGN KEY (source) REFERENCES nodes(id),
    FOREIGN KEY (target) REFERENCES nodes(id)
);
```

| 字段 | 说明 |
|------|------|
| `kind` | 边类型，见下文“边类型” |
| `source` / `target` | 源节点/目标节点 id |
| `file_path` | 边出现的文件路径 |
| `start_line` | 边出现的行号 |
| `start_column` / `end_column` | 调用表达式在源码中的列范围（可选） |
| `confidence` | 置信度 0-1，动态分发等无法精确解析的边可低于 1 |
| `metadata` | JSON 附加字段（如调用参数、宏展开上下文） |

### 2.4 project_metadata

```sql
CREATE TABLE project_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

| key | value |
|-----|-------|
| `index_state` | `complete` / `partial` / `incremental` |
| `indexed_with_version` | 构建脚本版本 |
| `indexed_with_extraction_version` | IRIS 元数据抽取版本 |
| `indexed_at` | ISO 8601 时间戳 |
| `namespace` | 抽取来源 namespace，如 `DHC-APP` |
| `total_classes` | 类总数 |
| `total_routines` | 例程总数 |

---

## 3. 节点类型（Node Kinds）

| kind | 说明 | 示例 |
|------|------|------|
| `class` | ObjectScript 类 | `DHCEPMI.CardMain` |
| `method` | 类方法（ClassMethod 或 Method） | `DHCEPMI.CardMain::SaveCard` |
| `property` | 类属性 | `DHCEPMI.CardMain::CardNo` |
| `parameter` | 类参数（Parameter） | `DHCEPMI.CardMain::DEBUG` |
| `routine` | 例程文件（.mac / .int） | `DHCEPMI123` |
| `include` | 包含文件（.inc） | `DHCEPMIInc` |
| `global` | Global 节点 | `^DHCEPMI.CardMainD` |
| `sql_table` | SQL 表 | `SQLUser.DHCEPMI_CardMain` |
| `rest_route` | REST 路由（URL + HTTP 方法） | `GET /api/card/{id}` |
| `csp_page` | CSP 页面 | `csp/dhcepmi/cardmain.csp` |
| `macro` | 宏定义 | `$$$LogError` |

---

## 4. 边类型（Edge Kinds）

| kind | 方向 | 说明 | 示例 |
|------|------|------|------|
| `contains` | class → method/property/parameter | 类包含成员 | `DHCEPMI.CardMain` contains `SaveCard` |
| `extends` | class → class | 继承 | `DHCEPMI.CardMain` extends `%RegisteredObject` |
| `implements` | class → class/interface | 实现接口/抽象 | `DHCEPMI.CardMain` implements `DHCEPMI.ICard` |
| `calls` | method/routine → method/routine | 方法/例程调用 | `SaveCard` calls `DHCEPMI.CardStore::Save` |
| `reads` | method/routine → global | 读取 Global | `SaveCard` reads `^DHCEPMI.CardStoreD` |
| `writes` | method/routine → global | 写入 Global | `SaveCard` writes `^DHCEPMI.CardStoreD` |
| `uses` | method/class → sql_table | 使用 SQL 表（&sql / 类投影） | `SaveCard` uses `SQLUser.DHCEPMI_CardStore` |
| `includes` | class/routine → include | 引用 .inc 文件 | `DHCEPMI.CardMain` includes `DHCEPMIInc` |
| `expands` | method/routine → macro | 展开宏 | `SaveCard` expands `$$$LogError` |
| `routes` | csp_page/rest_route → method | URL/路由映射到后端方法 | `cardmain.csp` routes `DHCEPMI.CardMain::SaveCard` |
| `override` | class(local) → class(submodule) | `src/local/` 覆盖主模块类 | `src/local/.../DHCEPMI.CardMain` override `src/backend/epmi/.../DHCEPMI.CardMain` |

---

## 5. 与前端 CodeGraph 的对应关系

| CodeGraph | IRISGraph | 说明 |
|-----------|-----------|------|
| `files` | `files` | 完全一致，新增 `module` / `last_modified` |
| `nodes` | `nodes` | 字段基本一致；IRISGraph `metadata` 存 JSON 扩展 |
| `edges` | `edges` | 字段基本一致；IRISGraph 新增 `confidence` / `metadata` |
| `project_metadata` | `project_metadata` | 完全一致，key 按 IRIS 场景扩展 |

---

## 6. 命名约定

- **节点 name**：使用 IRIS 短名或代码中实际名称。
- **qualified_name**：使用双冒号 `::` 分隔类与成员，如 `DHCEPMI.CardMain::SaveCard`。
- **Global 节点 name**：保留 `^` 前缀，如 `^DHCEPMI.CardStoreD`。
- **SQL 表节点 name**：使用 IRIS 字典中的 `SqlQualifiedNameQ` 或实际表名。
- **Routine 节点 name**：去掉扩展名，如 `DHCEPMI123`。

---

## 7. 分期实现建议

| 阶段 | 优先实现的节点/边 |
|------|------------------|
| 首版（MVP） | `class` / `method` / `property` / `parameter` + `contains` / `extends` / `calls`（##class） / `reads` / `writes` / `uses`（&sql） |
| 二期 | `routine` / `include` / `macro` + `includes` / `expands` / `do` / `$$entry^Routine` |
| 三期 | `rest_route` / `csp_page` + `routes`、业务流程消息边 |
