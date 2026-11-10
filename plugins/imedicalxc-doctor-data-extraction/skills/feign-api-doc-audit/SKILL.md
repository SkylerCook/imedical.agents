---
name: feign-api-doc-audit
description: |
  Use when 需要核对或修正《Feign接口API文档-集成平台标准接口》中的服务地址、入参/出参类型和字段，使其与 FeignClient、DTO/VO 源码一致；覆盖全量地址比对、同类型消歧、嵌套字段表校验和批量修正。
  Triggers: "Feign文档核对"、"服务地址校验"、"出入参校验"、"Feign接口文档纠错"、"Feign文档审计"、"API文档字段核对"。
---

# Feign 接口 API 文档审计与修正

帮助请求（`--help`、查看用法）：先读取[统一帮助协议](../../../../docs/guides/capability-help.md)，按当前定义展示帮助后结束；Overlay 未映射 `docs/` 时先按 `.agents/capability.json` 的 `CapabilityRoot` 定位协议；附带执行参数也不进入业务流程。

## 目标

把已有 API 文档当作待验证产物，以源码为唯一事实来源，逐接口核对并修正：

- **服务地址**：`@FeignClient.path` + `@PostMapping` 方法路径。
- **入参/出参类型**：`EsbBaseDTO<T>` / `EsbBaseResponse<T>` 中的真实类型。
- **字段表与 JSON 示例**：字段名、层级、类型、包装结构、缺失与重复。

> 本 skill 只负责**核对与修正已有文档**。首次生成 API 文档仍走主 skill `imedicalxc-doctor-data-extraction` 的 Phase 3.6。

## 输入

| 输入 | 必需 | 说明 |
| --- | :---: | --- |
| 目标文档 | 是 | `Feign接口API文档-集成平台标准接口.md` |
| Java 源码根目录 | 是 | 至少包含 FeignClient、DTO、VO 源码 |
| 模块/子模块范围 | 否 | 缺省扫描源码根下所有 `*.java` |
| 第三方或旧版文档 | 否 | 仅用于判断字段语义，不作为接口事实来源 |

前置检查：

1. 备份目标文档（工程非 Git 仓库时必须单独复制备份）。
2. Node.js `>= 22.5.0`；审计脚本仅使用内置模块，不安装依赖。
3. 先读主 skill 中“FeignClient 路径规则”“JSON 示例格式”“字段表格式”，本 skill 不重复定义生成规范。

## 核心原则

1. **源码优先**：文档、旧接口说明、Swagger 描述与源码冲突时，以 FeignClient 和 DTO/VO 源码为准。
2. **类型必须消歧**：Feign 类型同名跨包/跨模块非常普遍，禁止按简单类名取第一个，必须结合 import、package、模块和子模块解析。
3. **JSON 名合法**：`@JsonProperty`、`@JsonAlias` 声明的名称是合法文档字段名，不是错误。
4. **候选问题需复核**：脚本输出是候选问题，不是自动修复指令；同名类、扁平包装、刻意省略字段都要人工确认。
5. **不改业务语义**：只修正与源码不一致的事实，不顺手改写字段中文名、业务规则或示例数据风格。
6. **分批修正、每批复验**：地址、类型、字段、JSON 分开修，修完立即重跑审计，避免大面积互相覆盖。

---

## Phase 1：建立源码事实库

### 1.1 提取 FeignClient 与接口方法

对每个 `@FeignClient` 接口记录：

```text
ClientName
  path        = ${server.servlet.context-path}/<module>/api/<submodule>/<className>
  service     = ${mediway.application.<module>}
  scope       = 源码路径中的 <module>-api-<submodule>
  module      = 源码路径中的 <module>
  imports     = 当前 Java 文件的 import 集合
  packageName = 当前 Java 文件的 package
  methods[]
    name       方法名
    path       @PostMapping 的 value（可能带或不带前导 /）
    returnType EsbBaseResponse<T> 原始返回类型
    inType     EsbBaseDTO<T> 中的 T
    outType    EsbBaseResponse<T> 中的 T（List/IPage 已解包）
```

要点：

- `path` 可能跨行声明，先做空白归一化。
- 方法路径取 `@PostMapping(value = "...")` 或 `@PostMapping("...")`；不要误取 `consumes`。
- `EsbBaseResponse<List<X>>` 的出参元素类型是 `X`，不是 `List<X>`。
- 只扫描 `@PostMapping` 方法；`@RequestMapping` 方法单独确认后再纳入。

### 1.2 提取 DTO/VO 字段

对每个 `Feign*` 类型记录：

```text
TypeName
  file / packageName / imports
  parent         extends 父类简单名
  fields[]
    name   Java 字段名
    type   字段类型
    json   @JsonProperty / @JsonAlias 声明的 JSON 名（可能为空）
```

规则：

- 字段校验必须包含父类继承字段（递归 `extends`，注意循环保护）。
- `@JsonProperty("patientID") private String patientNo;` 时，文档写 `patientID` 是**正确**的。
- 同名类型有多份时，保留全部候选，后续按 `imports > packageName > scope > module > 唯一候选` 的顺序解析。
- 无法唯一解析时报告“未解析类型”，不要猜。

### 1.3 使用审计脚本建立事实并检查

脚本位置：`scripts/feign-doc-audit.js`（插件根目录下）。

```bash
node scripts/feign-doc-audit.js all \
  --doc <文档.md> \
  --src-root <Java源码根目录> \
  --verbose
```

首次运行先看统计：Java 文件数、FeignClient 数、文档方法章节数、Feign 类型数。数量明显偏小说明源码根或忽略目录配置不对。

---

## Phase 2：服务地址核对与修正

### 2.1 期望地址公式

```text
期望服务地址 = FeignClient.path（去掉尾部 /） + "/" + @PostMapping 方法路径（去掉前导 /）
```

`FeignClient.path` 必须包含：

```text
${server.servlet.context-path}/<module>/api/<submodule>/<clientClassName首字母小写>
```

其中：

- `api` 是固定段，不可省略。
- `<submodule>` 必须与实际 Maven 子模块一致（如 `doc`、`external`、`ipbook`、`conting`、`ant`）。
- `className` 是 **FeignClient 接口完整类名**首字母小写，不能截断业务前缀（`AggcareXxxClient` → `aggcareXxxClient`）。
- 必须使用 `${server.servlet.context-path}`，不能使用 `${sys.restfulPath}`。

### 2.2 高频错误

| 错误形态 | 典型表现 | 修正 |
| --- | --- | --- |
| 只有相对方法地址 | `\| 地址 \| /getXxx \|` | 替换为完整 `服务地址`，并补齐 `服务提供者`、`Maven依赖` |
| 缺少上下文前缀 | `/aggcare/api/...` | 补 `${server.servlet.context-path}` |
| 缺少 `api` 段 | `.../aggcare/doc/...` | 补为 `.../aggcare/api/doc/...` |
| 子模块错误 | 接口在 `api-doc`，地址写 `external` | 以 FeignClient 源码所在模块为准 |
| 类名截断 | `paCardTypeClient` | 完整类名首字母小写 `aggcarePaCardTypeClient` |
| 方法路径拼接错误 | 双斜杠、缺方法名、把方法路径当完整地址 | 按公式重新拼接 |
| 服务提供者写错 | `XxxClient.method` 与标题方法不一致 | 统一为 `ClientName.methodName()` |

### 2.3 修正格式

每个方法必须具备完整的接口定义表：

```markdown
| 请求方式 | POST |
| 服务地址 | ${server.servlet.context-path}/<module>/api/<submodule>/<clientClassName>/<methodPath> |
| 服务提供者 | <ClientName>.<methodName>() |
| Maven依赖 | <groupId>:<artifactId>:<version> |
| 调用时机 | <功能描述> |
```

若章节顶部的汇总表也写路径（如 `| methodName | /path | 说明 |`），一并改为完整地址，避免只修正文、漏掉汇总表。

### 2.4 地址验收

```bash
node scripts/feign-doc-audit.js paths --doc <文档.md> --src-root <源码根>
```

必须满足：

- `paths=0`。
- 全文不存在 `^| 地址 |` 相对地址行。
- 每个方法章节都有 `服务地址` 行。
- `服务提供者` 与标题方法名一致。
- 客户端汇总表（`| 方法名 | 请求路径 | 说明 |`）中的路径与正式 `服务地址` 一致；脚本以 `summary-path` / `relative-summary` 报告。

---

## Phase 3：入参与出参核对

### 3.1 先核对包装与 data 形状

| 检查点 | 正确做法 |
| --- | --- |
| 入参包装 | `EsbBaseDTO<T>`，JSON 含 `current` / `size` / `client`（5 个子字段）/ `data` |
| 出参包装 | `EsbBaseResponse<T>`，JSON 含 `code` / `msg` / `version` / `data` |
| data 直出 | `data` 直接是对象或数组（`List<T>`） |
| data 分页包装 | `data` 是 `{ records, total, size, current }`，且 `records` 类型与源码一致 |
| 重复行 | 同一 `records`/`data` 行不得出现两次 |
| 成功码 | JSON 示例统一 `"code": "200"`；旧文中的 `"0"表示成功` 属风格差异，确认契约后再统一 |

常见错误：

- 实际返回 `List<T>`，文档却写成 `{ records, total, size, current }`。
- 实际返回分页包装，文档却直接写对象。
- 删除了 `records` 行但 JSON 仍保留 `records`。
- `data` 行写成 `array`，但备注/JSON 与源码的 `List<T>` 不一致。

### 3.2 字段表的类型归属

字段表本身通常不写标题，类型来自最近的上下文：

1. `**入参说明 - FeignXxxDTO**` / `**出参说明 - FeignXxxVO**` → 该表类型。
2. `**xxx子节点 - FeignXxxVO**` → 子表类型。
3. `**xxx 子节点说明**（FeignXxxVO）` → 子表类型。
4. `**xxx 子节点说明**` 未写类型 → 从**父表对应行**推导：
   `| xxx | ... | List<FeignXxxVO> |` → 子表类型 `FeignXxxVO`。

第 4 条是高频场景（`records`、`waitData`、`cureList`、`diagnosList`、`data`），必须从父表行取类型，不能回退到方法出参类型。

### 3.3 字段比对规则

- 文档字段必须能在目标类型自身字段或父类字段中找到。
- 比较时同时接受 Java 字段名和 `@JsonProperty`/`@JsonAlias` 名。
- 文档中的 `data`、`code`、`msg`、`version`、`total`、`size`、`current`、`records` 等包装字段按包装层处理，不参与业务 VO 字段比对。
- 子表必须展开，不能把 `records.xxx`、`data[].xxx` 这类内联路径当作字段名直接比较。
- 源码有、文档没有的字段先列“缺失候选”，再区分：公共字段、内部字段、刻意不暴露字段、真实遗漏。

### 3.4 同名类型消歧

Feign 类型同名非常普遍，必须按以下顺序解析：

```text
1. 当前文件/父类型的 imports 中是否有该类型的 FQCN
2. 当前文件/父类型的 packageName 是否与候选一致
3. 候选的 scope（<module>-api-<submodule>）是否与接口一致
4. 候选的 module 是否与接口一致
5. 仅剩一个候选时才采用
```

典型陷阱：

| 同名类型 | 正确选择依据 |
| --- | --- |
| `FeignWaitRegisterVO`（普通版 / `list` 版） | 父类型 `FeignQueryWaitRegisterVO` 的 import 指向 `list` 版 |
| `FeignCancelPreOpRegistDTO`（adm / external） | 接口所在子模块和 import |
| `FeignPatientDataVO`（curc / opalloc / opreg / opcare） | 客户端 import 与 scope |
| `FeignIpBookMedicalRecordVO`（`model/vo` / `vo/standard`） | FeignClient 的 import |

禁止“取第一个同名类”后直接判定文档错误。

### 3.5 类型名纠错

文档出现源码中不存在的类型名时，先 `find/grep` 确认真实类型，再改文档：

```bash
find <src-root> -name "FeignXxxVO.java"
grep -rn "class FeignXxxVO" <src-root> --include="*.java"
```

常见错误：使用旧版 VO 名、把包装类当业务 VO、把 `List<T>` 简写成 `T`。改名后必须同步字段表、JSON 示例和类型说明。

### 3.6 JSON 示例核对

- 入参 JSON：完整包装 + `data` 结构与 DTO 一致。
- 出参 JSON：`code`/`msg`/`version`/`data`；`data` 形状与真实返回一致。
- `List` 返回用数组，数组内只放 1 个元素。
- 布尔值不加引号。
- 不出现源码中不存在的字段；不遗漏 JSON 中已出现的嵌套层。
- 值使用字段中文含义，不使用“张三”“139xx”等示例数据。
- 出参嵌套表字段与 JSON 必须能逐层对应。

### 3.7 字段与类型验收

```bash
node scripts/feign-doc-audit.js fields --doc <文档.md> --src-root <源码根>
node scripts/feign-doc-audit.js io --doc <文档.md> --src-root <源码根>
```

- `fields=0`，或剩余项已逐条人工确认是同名类/别名/刻意省略。
- `io` 输出为“人工复核”项；扁平包装、聚合包装允许与签名类型名不同，但 `data` 实际结构必须一致。
- 脚本提示“未解析类型”时，先补 import/package 解析依据，不要直接改文档。

---

## Phase 4：执行修正

1. **先备份**：`doc-backup.md`，并记录修正前统计。
2. **地址优先**：先修服务地址/服务提供者，再修类型和字段；地址错误会干扰后续定位。
3. **按章节批处理**：同类错误用脚本或批量替换；涉及同名类、JSON 结构的逐节人工改。
4. **保留文档风格**：已有中文名、表头列顺序、章节编号不改；只改事实错误。
5. **不虚构**：源码没有的字段不能为了“补全”而编造；确实无法映射时标注 `--` 或说明原因。
6. **每批复验**：每修 1 个 Phase 运行一次对应审计命令，确认问题数单调下降。
7. **记录清单**：按“服务地址 / 类型 / 字段 / JSON / 未改动项”记录修正条目，便于交付说明。

危险操作边界：

- 不要用整段文档重写替代定点修正。
- 不要全局替换 `"0"` → `"200"`，除非确认所有接口契约一致。
- 不要批量删除“源码没有的字段”前不做同名类复核。
- 不要在未备份时执行大范围 `sed`。

---

## Phase 5：最终验收

```bash
# 全量审计（地址 + 字段 + 类型 + 格式）
node scripts/feign-doc-audit.js all --doc <文档.md> --src-root <源码根>

# 相对地址必须为 0
grep -c '^| 地址 |' <文档.md>

# 服务地址行数量应等于接口方法数
grep -c '^| 服务地址 |' <文档.md>

# 代码块与字段前缀基线
grep -c '```--' <文档.md>
grep -c '| data\.' <文档.md>
```

验收清单：

- [ ] 所有 `服务地址` 与 `@FeignClient.path + @PostMapping` 一致
- [ ] 不存在 `| 地址 |` 相对地址行
- [ ] 每个方法都有 `请求方式`/`服务地址`/`服务提供者`/`Maven依赖`/`调用时机`
- [ ] 入参/出参类型与 FeignClient 签名一致
- [ ] `data` 的直出/分页包装结构与源码一致
- [ ] 所有文档字段都能在源码或 `@JsonProperty` 别名中找到
- [ ] 嵌套子表类型来自正确的父表行，而不是错误回退到方法出参
- [ ] JSON 示例与字段表、源码三方一致
- [ ] 剩余候选问题均已人工归类为“已修/误报/刻意省略”
- [ ] 修正清单已完成，可向用户说明修正范围与未改动项

## 交付报告模板

```markdown
## 服务地址
- 共核对 N 处，修正 M 处。
- 主要问题：相对地址、缺少 context-path、缺少 /api 段、子模块错误、类名截断。

## 出入参
- 类型修正：...
- 字段补充/删除：...
- 包装与 JSON 修正：...

## 未改动项
- 同名类误报：...
- @JsonProperty 合法别名：...
- 旧成功码风格：...
```

## 与其它 skill 的关系

| 场景 | 使用 |
| --- | --- |
| 首次生成 API 文档 | 主 skill `imedicalxc-doctor-data-extraction` Phase 3.6 |
| 生成/改造 Feign 代码 | 主 skill Phase 3.1–3.5 |
| 已有文档核对与批量纠错 | 本 skill |
| 第三方接口字段映射 | 主 skill Phase 2 |
