---
name: imedicalxc-doctor-business-understanding
version: 1.0.0
description: |
  HIS 医生站业务实现理解与变更影响分析。从前端界面入口定位 -> 前端逻辑追踪 -> 后端调用链追溯 -> 业务实现方法罗列 -> 变更影响评估 -> 跨业务依赖分析 -> 结论输出。
  Use when 需要理解一个HIS业务流程的前后端完整实现链路，或评估一项需求变更对当前工程实现的影响范围和改造方案。
role: analyst
scope: analysis-to-decision
output-format: evaluation-report
priority: high
---

# HIS 医生站业务实现理解与变更影响分析

## 概述
## 输出目录结构

所有分析报告、AST JSON 文件、评估文档统一输出到 `docs/imedicalxc-doctor-business-understanding/` 下，按阶段分目录存放。文件命名格式：`{YYYY-MM-DD}-{主题}.md`（日期 + 主题名称）。

```
docs/imedicalxc-doctor-business-understanding/
├── phase1-initial-explore/          # 初步探索
│   └── YYYY-MM-DD-初步探索报告.md
├── phase2-brainstorming/            # 需求头脑风暴
│   └── YYYY-MM-DD-头脑风暴文档.md
├── phase3-ui-entry/                 # 页面入口定位
│   ├── YYYY-MM-DD-HTML分析报告.json
│   └── YYYY-MM-DD-JS调用图.json
├── phase4-frontend-trace/           # 前端逻辑追踪
│   └── YYYY-MM-DD-后端调用链.md
├── phase5-backend-trace/            # 后端调用链追溯
│   └── YYYY-MM-DD-门禁审计报告.md
├── phase6-gate/                     # 质疑点门禁把关
│   └── YYYY-MM-DD-设计文档.md
├── phase7-design/                     # 综合分析与设计文档
│   └── YYYY-MM-DD-变更识别.md
               # 多方案评估
│   └── YYYY-MM-DD-评估报告.md
└── phase10-conclusion/              # 结论输出
    └── YYYY-MM-DD-结论报告.md
├── phase8-change-identification/    # 变更方法识别
│   └── {timestamp}_{name}_evaluation-report.md
└── phase9-conclusion/              # 结论输出
    └── {timestamp}_{name}_final-report.md

本 Skill 指导 Agent 从用户描述的业务场景出发，**从前端界面入口追踪到后端数据库**，完整还原业务的前后端实现链路，然后基于用户的目标需求评估变更影响范围和多种改造方案。

**核心原则**：
- 先理解当前实现，再评估变更影响 — 不跳过现状分析直接进入方案设计
- 每个追溯步骤必须用代码搜索命令验证，不接受推测
- 方法论参考自番薯(AI编码辅助)的企业工程实践：从前端入口到后端数据的跨层调用链追踪

## 何时使用

- 用户描述一个业务场景，需要你理解该场景的当前实现方式
- 用户提出需求变更，需要你评估影响范围和改造方案
- 排查 Bug 时需要理解完整的前后端调用链路
- 新接手模块需要快速掌握某业务流程的代码实现

## 核心流程（10 阶段）

本 Skill 将完整分析过程拆解为 10 个阶段，按顺序推进，每个阶段完成后才进入下一步。

```
Phase 1: 初步探索         Phase 2: 需求头脑风暴      Phase 3: UI入口定位
+-------------------+    +-------------------+     +-----------------------+
| 关键字检索工程      |  ->  | 业务界面范围        |  ->  | 用户业务描述 ->      |
| 罗列探索结果        |     | 功能点范围          |     | 页面URL/path定位     |
| 二次探索至全面      |     | 现状与目标          |     | 页面组件识别         |
+-------------------+    +-------------------+     +-----------------------+

Phase 4: 前端逻辑追踪     Phase 5: 后端调用链追溯    Phase 6: 质疑点门禁把关
+-------------------+    +-------------------+     +-----------------------+
| Controller定位       |     | 审计所有质疑点       |  ->  | 前后端方法清单       |
| BLH/Service/DAO链    |     | 关联评分             |     | 调用关系图           |
| 数据映射追踪         |     | 用户确认             |     | 数据流组装           |
+-------------------+    +-------------------+     +-----------------------+
Phase 7: 综合分析设计文档         Phase 8: 变更方法识别     Phase 9: 多方案评估       Phase 10: 结论输出
+----------------------+  +--------------------+  +-------------------+
| 目标需求 ->           |     | 方案A/B/C...        |     | 各方案评估结论       |
| 需调整方法罗列        |     | 评估维度评分        |     | 建议与风险提示       |
| 依赖关系标注          |     | 跨业务影响分析      |     | 用户选择等待         |
+----------------------+  +--------------------+  +-------------------+
+------------------+
```

> **注意**：每个阶段都必须执行。不要跳过 Phase 1-2、Phase 3-5 和 Phase 6 直接进入方案设计。

---

### Phase 1：初步探索

从需求描述中提取关键字，对工程进行系统化检索探索。流程如下：

#### 1.1 关键字提取与检索

从用户需求描述中提取业务关键字，使用以下命令检索：

```
rg -i "{关键字}" src/frontend/hisfront/ -g "*.js" -g "*.html" -l
rg -rn "{关键字}" src/backend/ -g "*.java" -l
```

#### 1.2 探索结果罗列

将检索到的结果按维度整理。

#### 1.3 二次探索与业务关联

对每个检索结果进行二次探索，直到每个结果都能关联到其所有使用界面和业务。一个结果可能对应多个界面/业务，多个结果也可能对应同一个界面/业务。

#### 1.4 探索结论

汇总探索结果，形成全景关联图作为 Phase 2 的输入。

---
### Phase 2：需求头脑风暴

使用 superpowers:brainstorming skill 探索需求并生成设计文档。设计文档必须澄清以下内容：

- **业务界面范围**：需求涉及哪些前端页面、模块入口。例如"医嘱录入界面"对应到具体的 HTML 页面和 JS 文件。
- **功能点范围**：需求涉及哪些具体的功能点。例如"录入材料类型医嘱时不允许填写单次剂量"涉及医嘱类型判断逻辑、单次剂量字段控制。
- **现状与目标**：
  - 现状：当前代码是如何实现相关功能的（不需要深入细节，给出整体方向即可）
  - 目标：需求期望达到的效果，以及预期的验收标准

**前置条件**：确保 superpowers:brainstorming skill 已安装。

> **范围质疑**：用户描述的需求可能不全面，需对以下维度提出质疑：
> 1. **业务界面范围是否全面** — 用户提到的界面之外，是否有其他页面也涉及相同功能？
> 2. **功能点范围是否全面** — 用户提到的功能点之外，是否有上下游功能或关联功能被遗漏？
> 3. **现状描述是否符合当前功能设计** — 用户对当前实现的描述是否准确？是否存在误解或假设？
> 4. **目标是否与当前功能冲突** — 需求目标是否会与现有功能的正常逻辑产生冲突？
> 5. **是否有目标盲点** — 需求目标是否遗漏了某些边界情况或异常流程？
> 
> **必须列出质疑点**（强制），作为 Phase 3-4 的强制输入项；列出后不做结论，由 Phase 3-4 的代码探索来验证和补充。

设计文档需经用户批准后再进入 Phase 3。

---


### Phase 3：UI 入口定位

从用户的业务描述出发，在前端工程中找到对应的页面入口。

#### 前置步骤：阅读前端项目概览

先读取 `src/frontend/README.md`（如存在），获取前端项目结构概览、模块分类、页面路由约定和导航说明。这能帮助快速定位用户描述的业务在哪个模块/目录下，避免盲目搜索。

```bash
cat src/frontend/README.md
```

#### 搜索入口方法

```bash
# 方法0：在 README 中搜索模块/页面关键词，获取目录定位
rg -i "{关键词}" src/frontend/README.md

# 方法1：按 README 定位的模块目录缩小搜索范围后，通过菜单关键词搜索
# HISUI 菜单配置通常在 menu/ 或 nav/ 目录
rg -i "{关键词}" src/frontend/hisfront/ --type html -l
rg -i "{关键词}" src/frontend/hisfront/ --type js -l

# 方法2：按功能名称搜索页面标题
rg -i "页面标题|功能名称" src/frontend/hisfront/ -g "*.html" -g "*.jsp" -l

# 方法3：搜索 EasyUI data-options / href / url 中的页面引用
rg -i "页面文件名关键词" src/frontend/hisfront/ -g "*.js" -g "*.html" -l
```

#### 输出

| 项目 | 内容 |
|------|------|
| 页面路径 | `src/frontend/hisfront/.../xxx.html` 或 `xxx.jsp` |
| 对应 JS 文件 | `src/frontend/hisfront/.../xxx.js` |
| 菜单配置 | 对应 menu 配置项 |
| 页面功能简述 | 从页面元素和业务描述推断 |

---

### Phase 4：前端逻辑追踪
> **输出约束**：本阶段的分析报告仅描述现有代码的实现方式和调用关系。禁止包含任何倾向性的改造建议、修改方向或建议改造位置等涉及变更的表述。所有涉及"如何修改"的分析推迟到 Phase 7-9（变更方法识别、多方案评估、结论输出）。本阶段以"现状是什么"为终点，不以"如何改"为目标。
> 
> **必须回应 Phase 1 中列出的质疑点**（强制）——通过代码探索验证或补充质疑点中涉及的范围、功能、现状描述和目标冲突等维度，在报告中体现验证结论。


前端分析提供两种路径：**Node.js AST 静态分析**（推荐，适合复杂溯源）和**手动 grep 溯源**（轻量备选，适合简单场景）。复杂场景（跨文件调用链、接口逆向）优先使用 AST 分析；简单场景（单页面查询按钮逻辑）可手工 grep。

#### 前置校验（仅 AST 分析需要）

```bash
# 脚本路径
$script = ".agents/plugins/imedicalxc-doctor-business-understanding/scripts/frontend-analyze.js"

# 检查 Node.js 环境
node --version
if ($LASTEXITCODE -ne 0) { Write-Warning "Node.js 不可用，请使用手动 grep 溯源" }

# 检查前端分析脚本是否存在
if (Test-Path $script) {
    Write-Output "AST 分析脚本存在"
} else {
    Write-Warning "缺少 frontend-analyze.js，请先安装插件或使用手动 grep 溯源"
}

# 首次使用需安装 npm 依赖（仅一次）
$pkgDir = Split-Path (Split-Path $script -Parent) -Parent
if (-not (Test-Path "$pkgDir/node_modules/cheerio")) {
    Write-Host "正在安装 npm 依赖..."
    Push-Location $pkgDir
    npm install cheerio @babel/parser @babel/traverse @babel/types glob 2>&1
    Pop-Location
}
```

> 如果 Node.js 或脚本缺失，自动回退到 2.5 手动 grep 溯源方案。Windows 路径反斜杠与 glob 兼容问题在脚本中已内置 `.replace(/\\/g, '/')` 自动处理。

#### 4.1 生成 AST 分析报告

在前端工程目录下运行脚本，生成两份 JSON 报告：

```bash
# 脚本路径
$script = ".agents/plugins/imedicalxc-doctor-business-understanding/scripts/frontend-analyze.js"
# 前端静态目录（按需替换为具体模块路径，如 opcare/adm）
$frontendDir = "src/frontend/hisfront/static/opcare"
# 输出目录（按阶段自动创建）
$outputDir = "docs/imedicalxc-doctor-business-understanding/phase2-frontend-trace"
# 工作名称（用于文件命名，如 opcare_adm）
$workName = "module_name"

node $script $frontendDir --outputDir $outputDir --name $workName

# Windows 路径中 path.join 使用反斜杠，glob 需要正斜杠
# 脚本已内置 .replace(/\\/g, '/') 自动处理
```

- `html-js-load-report.json`：每个页面的 JS 引入列表、内联脚本、DOM 事件绑定
- `js-call-graph.json`：全工程 JS 函数定义、跨文件调用关系、网络请求集合

#### 4.2 场景 A：定向分析页面功能（精准溯源）

当用户描述一个具体的页面功能时（如"患者查询"、"医嘱保存"），用此方案定位完整实现链路。

```bash
# 前置约束：仅读写当前前端工程目录，沙盒隔离，禁止访问外部网络与系统配置。
#
# 任务：定位页面的功能查询/保存等入口按钮的完整实现逻辑，步骤如下：
# 1. 确认 html-js-load-report.json 和 js-call-graph.json 已生成
# 2. 从 html-js-load-report.json 提取该页面全部 JS 引入、内联脚本、按钮绑定的点击事件
# 3. 根据事件绑定的函数名，去 js-call-graph.json 逆向溯源完整调用链：
#    ① 向上：哪些页面/函数会触发这个查询方法
#    ② 向下：该函数内部调用了哪些子方法、发起了哪些后端接口请求
# 4. 输出结构化内容：
#    - 页面 JS 加载顺序（外部脚本、延迟模块、内联执行代码）
#    - 查询按钮 DOM 绑定的事件与入口函数
#    - 完整调用链（从上到下逐级展示函数依赖）
#    - 该功能用到的所有后端接口、请求参数位置
#
# 安全规则：只做静态源码解析，不启动本地服务、不发起真实接口请求。
```

#### 4.3 场景 B：逆向接口完整调用链路（接口溯源）

当知道一个后端接口 URL（如 `/api/order/save`），要找到所有前端调用路径时使用。

```bash
# 沙盒权限约束：仅可读取当前前端工程源码，无外网、内网访问权限，禁止执行高危系统命令。
#
# 分析目标：找出工程内所有调用特定接口的代码与完整执行链路，执行流程：
# 1. 确认 js-call-graph.json 已生成
# 2. 在调用图谱里筛选所有包含该接口URL的网络请求记录，拿到对应的调用函数、所属文件
# 3. 对每一个触发接口的函数，向上递归追溯所有上层调用者，直到页面 DOM 绑定事件
# 4. 整理输出：
#    - 所有发起该接口的页面路径、页面 JS 加载依赖
#    - 每条完整调用链（页面点击事件 -> 入口函数 -> 子方法 -> 接口请求）
#    - 每个链路对应的源码文件位置
#
# 安全规则：无需运行页面、无需发起网络请求，仅基于 AST 静态源码分析。
```

#### 4.4 场景 C：纯 JS 函数调用关系分析（不解析 HTML）

当只需要分析 JS 函数间的调用关系，不涉及页面 HTML 绑定时使用。

```bash
# 当前运行在管理员隔离沙盒，仅允许读取前端工程源码，禁止外部网络访问。
# 只使用脚本内 AST 分析模块，执行以下任务：
# 1. 确认 js-call-graph.json 已生成
# 2. 梳理全局所有函数定义、跨文件调用关系
# 3. 输入目标函数名，输出：
#    - 该函数所在文件路径
#    - 所有调用该函数的上层函数（上游调用链）
#    - 函数内部调用的全部子函数、网络请求
# 4. 用层级树状结构展示完整调用链路，标注每一层对应的源码文件
#
# 安全规则：仅读取当前前端工程目录下 .html/.js/.ts/.jsx/.tsx/.json 文件。
```

#### 4.5 手动 grep 溯源（轻量备选）

当 Node.js 环境不可用、脚本不存在或只需要快速查看时，使用手动方式：

##### 4.5.1 页面结构分析

读取页面 HTML/JSP 源文件，识别：
- EasyUI `datagrid` / `combobox` / `dialog` / `form` 等组件及其数据源绑定
- 页面上的按钮、操作入口（`onclick`、`data-options`、`href`）
- 页面初始化的 JS 调用（`onBeforeLoad`、`onLoadSuccess`、`onClickRow`）

```bash
cat src/frontend/hisfront/.../xxx.html
```

##### 4.5.2 JS 方法分析

读取关联的 JS 文件，提取：
- **页面初始化方法**（`$(function(){}`、`init()`、`onBeforeLoad`）
- **按钮事件绑定**（`onclick="methodName"`、`$("#id").click(...)`）
- **数据加载方法**（`$("#dg").datagrid("load", params)`、`$.post`、`$.ajax`）
- **交互操作方法**（CRUD 函数、弹窗、提交）

```bash
cat -n src/frontend/hisfront/.../xxx.js
rg -n "function.*方法名|方法名\s*=" src/frontend/hisfront/ -g "*.js"
```

##### 4.5.3 AJAX 请求提取

从 JS 代码中提取所有服务端 API 调用：

| 请求方式 | URL 模式 | 入参来源 | 回调处理 | 调用时机 |
|----------|----------|----------|----------|----------|
| `$.post` | `/xx/...` | 页面表单/选中行 | success 刷新 datagrid | 查询/保存 |
| `$.ajax` | `/xx/...` | 组合参数 | 刷新关联组件 | 联动/加载 |
| datagrid url | `{...}` | queryParams | 自动绑定 | 页面加载 |
| combobox url | `{...}` | 查询参数 | 自动绑定 | 下拉加载 |

```bash
rg -n "url.*['\"](api|rest|openApi)/" src/frontend/hisfront/ -g "*.js"
rg -n "\.post\(" src/frontend/hisfront/ -g "*.js"
rg -n "\.ajax\(" src/frontend/hisfront/ -g "*.js"
```

#### 4.6 前端输出清单

无论使用 AST 分析还是手动 grep，最终输出统一格式。**每项方法/事件必须标注关联性评级**，根据该方法与用户描述功能的相关程度打分：

| 评级 | 含义 | 判定标准 | 示例场景 |
|------|------|----------|----------|
| ★★★★★ | **直接关联** | 方法就是用户描述功能的直接实现位置，包含核心判断逻辑或字段控制 | `if (orderType != "R")` 块中的 `StyleConfigObj.xxx = false` |
| ★★★★☆ | **串联关联** | 直接关联方法的**上游控制器** — 哪些方法串联调用了直接关联方法，形成了从用户操作到功能实现的完整链路 | `AddItemDataToRow` / `EditRow` → 调用 `GetStyleConfigObj` → 触发 `if (orderType != "R")` 块 |
| ★★★☆☆ | **联合关联** | 两个或多个方法**首尾协作** — 先头方法的返回值或执行结果导致后续方法的触发，或触发了后续方法的逻辑分支 | `OrderDoseQtychangehandler` 调用 `IsAvailableDose`，`IsAvailableDose` 的返回结果决定是否弹出剂量错误提示 |
| ★★☆☆☆ | **弱关联** | 仅部分参与该功能的某个子环节，但并非功能链路的核心 | `ChangeorderFreqTimeDoseList` 在频次变化时才联动剂量 |
| ★☆☆☆☆ | **最小关联** | 背景基础设施，所有功能共享 | `getURLParamsObj()`, `websys_getSession()` 等全局工具函数 |

**评级方式**：分析完成后对照用户描述的功能来逐个判断。不依赖 AST 自动推导，由 Agent 基于对业务逻辑的理解人工判定。

**输出表格格式**：

| # | 评级 | 类别 | 方法/代码段 | 文件:行号 | 作用 | 关联 API / URL |
|---|------|------|-----------|----------|------|---------------|
| 1 | ★★★★★ | 配置 | `GetStyleConfigObj:6393` `if(orderType != "R")` 块 | OEOrder.List.Custom.js:6393 | **直接控制**非药品（含材料）的剂量字段显隐 | — |
| 2 | ★★★★☆ | 串联 | `AddItemDataToRow` → `GetStyleConfigObj` | OEOrder.List.Custom.js | **上游链** — 新增医嘱行时触发配置函数 | — |
| 3 | ★★★★☆ | 串联 | `EditRow` → `GetStyleConfigObj` | OEOrder.List.Custom.js | **上游链** — 编辑医嘱行时触发配置函数 | — |
| 4 | ★★★☆☆ | 联合 | `OrderDoseQtychangehandler` → `IsAvailableDose` | OEOrder.List.Custom.js | **首尾协作** — 剂量改变处理器调用校验函数，校验结果决定是否弹错 | — |
| 5 | ★★☆☆☆ | 联动 | `ChangeorderFreqTimeDoseList` | OEOrder.List.Custom.js | 频次变化时联动剂量列表，非核心控制路径 | — |
| 6 | ★☆☆☆☆ | 工具 | `GetCellData` | OEOrder.Common.js | 全局行数据读取函数，所有功能共享 | — |

> **说明**：评级必须在 Phase 7（变更方法识别）中使用 — 高星方法（★★★★★/★★★★☆）的调整对用户功能影响最大，低星方法（★☆☆☆☆）通常可以安全调整而不影响目标功能。

#### 4.7 关联方法调用链说明

在输出关联方法表格后，对 ★★★★★（直接关联）和 ★★★★☆（联合关联）的方法，逐条输出基于 AST 报告的调用链说明。调用链说明包含三个维度：

| 维度 | 数据来源 | 说明 |
|------|----------|------|
| **向上调用链**（谁触发了我） | `js-call-graph.json` → funcCall 反向查找 | 找出哪些函数调用了当前方法，递归到页面 DOM 绑定事件 |
| **向下调用链**（我调用了谁） | `js-call-graph.json` → funcCall[方法名] | 当前方法内部调用的子函数和网络请求 |
| **API 请求**（我发起了谁） | `js-call-graph.json` → apiRequest | 当前方法直接发起的后端 API 请求 |

**调用链图格式**（树状缩进）：

`
用户操作: 具体的用户动作描述                     ← 必须追溯到一个用户操作入口
    └─ DOM事件绑定入口函数 (文件:行号)
        └─ 中间处理函数a
            └─ ... 逐层递归 ...

★ 直接关联方法 (文件:行号)                      ← ★★★★★ 或 ★★★★☆
    ├──[向上] 完整调用链 (从用户操作到当前方法)
    │   ├─ 用户操作: {动作描述}
    │   │   └─ 上层函数A (文件)
    │   │       └─ 上层函数B (文件)
    │   │           └─ ... (逐层到当前方法)
    │   └─ (多个入口路径时分行展示)
    │
    ├──[向下] 当前方法内部调用
    │   ├─ 子函数A1
    │   ├─ 子函数A2
    │   └─ \ → /api/xxx/yyy  ← API 请求
    │
    └── 归属页面: xxx.html → JS 文件:xxx.js
`

**调用链追踪规则**:
- 必须从 ★★★★★ 方法开始向上递归调用链，直到追踪到至少一个具体的用户操作
- 用户操作用 [用户操作: 动作描述] 标注在链首
- 多个入口路径时按分支展示（如 ├─ 或: addSelectedFav 从收藏夹）
- ★★★★☆ 串联关联的调用链图同样按此格式输出，5 星和 4 星的链仅在评级分类上区分

信息获取方式：
```

**信息获取方式**：

```bash
# 从 AST 报告中获取指定方法的向下调用链
node -e "
const g = require('{js-call-graph.json路径}');
console.log('向下调用链:', JSON.stringify(g.funcCall['{方法名}'], null, 2));
"

# 从 AST 报告中获取指定方法调用的 API 请求
node -e "
const g = require('{js-call-graph.json路径}');
var apis = g.apiRequest.filter(function(a) { return a.caller === '{方法名}'; });
console.log('API请求:', JSON.stringify(apis, null, 2));
"

# 从 AST 报告中查找谁调用了指定方法（向上调用链）
node -e "
const g = require('{js-call-graph.json路径}');
var callers = [];
Object.keys(g.funcCall).forEach(function(fn) {
  if (g.funcCall[fn].indexOf('{方法名}') >= 0) callers.push(fn);
});
console.log('上级调用者:', JSON.stringify(callers, null, 2));
"
```

**调用链输出规则**：

1. **★ 和 ★★★★ 方法必须输出**完整双向调用链；★★★ 及以下可选
2. 向上递归到至少一个具体的用户操作入口（如搜索选择医嘱项目、点击保存按钮、双击编辑行），用户操作用 [用户操作: 动作描述] 标注在链首。不满足时继续向上递归直到追踪到一个可识别的用户动作
3. 向下递归只展开当前方法直接调用的子函数，不递归展开子函数（避免爆炸）
4. API 请求标注在后端 URL 路径（从 UrlList 定义映射）
5. 归属页面信息来自 html-js-load-report.json 的 externalJs 反向关联

**调用链替代 `rg` 的场景**：

```
rg 无法做的事                    ← AST 报告可做
─────────────────────────────────┼────────────────────────
"这个方法是被谁调用的？"        → funcCall 反向查找所有调用者
"这几个方法之间的关系？"        → 双向调用链递归展示
"这个方法发起了哪些 API？"      → apiRequest 按 caller 筛选
"这个 API 被哪些页面调用了？"    → url→函数→页面 三级反向追溯
```

> 注意：对象属性赋值不触发 `CallExpression`，不在 AST 调用链中。这类配置型逻辑仍需配合 `rg` 定位。

#### 4.8 关键逻辑初始化链路说明

对 Phase 4.7 定位到的关键逻辑位置（★★★★★ 代码块），追溯其依赖的所有变量/参数的初始化来源。这回答了"这个判断逻辑中用到的变量值是从哪里来的"。

**变量来源类型**：

| 类型 | 说明 | 判定方式 |
|------|------|----------|
| API 响应 | 变量值来自后端接口返回 | 在赋值上下文中搜索 `$ipost` / `$iget` 的回调 |
| 用户输入 | 变量值来自页面操作（点击、输入、选择） | 搜索 DOM 事件绑定 `onclick` / `$().click` / `$().keyup` |
| 计算派生 | 变量值由其他变量计算得出 | 搜索赋值语句中是否引用其他变量或函数 |
| 配置常量 | 来自代码中的硬编码或全局配置对象 | 搜索 `GlobalObj.aboutStaticParam` 等配置容器 |
| 行数据读取 | 来自 datagrid 行数据的 `GetCellData` | 搜索 `GetCellData(rowid, "字段名")` |

**追踪方法**：

```
从关键逻辑代码块提取所有外部依赖变量
    │
    ├─ 变量A
    │   └─ 在源码中搜索 变量A 的赋值来源
    │       ├─ 如果是 GetCellData → 追踪行数据填充来源
    │       │   └─ 行数据来自 AddItemDataToRow → ParamObj
    │       │       └─ ParamObj 来自 API 响应 (终端: API)
    │       ├─ 如果是用户操作 → 追踪事件绑定
    │       │   └─ 用户点击/输入 (终端: 用户)
    │       ├─ 如果是计算派生 → 递归追踪派生来源的变量
    │       │   └─ 变量B + 变量C → 变量A
    │       │       ├─ 变量B → (继续递归)
    │       │       └─ 变量C → (继续递归)
    │       └─ 如果是配置常量 → 终端: 配置
    │
    └─ 变量B (同上)
```

**输出格式**：

```
关键逻辑: {文件名:行号} {代码段}
  │
  ├─ 变量A (在 {行号} 使用)
  │   └─ 来源: {类型}
  │       └─ 具体赋值语句 / 调用链
  │           └─ 终端来源: API / 用户 / 配置
  │
  ├─ 变量B (在 {行号} 使用)
  │   └─ 来源: {类型}
  │       ├─ 具体赋值语句或函数调用
  │       └─ (递归展开派生变量)
  │           ├─ 子变量B1 → 终端: {类型}
  │           └─ 子变量B2 → 终端: {类型}
  │
  └─ ...
```

**信息获取方式**：

```bash
# 查找变量在所在函数中的赋值来源
rg -n "{变量名}\s*=" <文件名> | head -10

# 查找变量在 API 响应中的赋值
rg -n "{变量名}" <文件名> | Select-String "data\.{变量名}|resp\.{变量名}|result\.{变量名}" | head -5

# 查找变量从 GetCellData 读取
rg -n "GetCellData.*{字段名}" <文件名> | head -5
```

**示例**（基于材料剂量分析）：

```
关键逻辑: OEOrder.List.Custom.js:6393 if(orderType != "R") 块
  │
  ├─ orderType (行6393 条件判断)
  │   └─ 来源: 行数据读取
  │       └─ GetCellData(rowid, "orderType")    ← 从 datagrid 当前行读取
  │           └─ 行数据来源: AddItemDataToRow → DefaultParamObj
  │               └─ DefaultParamObj 填充自 OrderItemLookupSelect 的 API 响应
  │                   └─ 终端: API 响应 (opcare/oeord/opCare/OeOrdItemEntryGrid/...)
  │
  ├─ orderPHPrescType (行6438 子类判断)
  │   └─ 来源: 行数据读取
  │       └─ ParamObj.orderPHPrescType 来自 GetCellData(rowid, "orderPHPrescType")
  │           └─ 终端: API 响应中 ItmCat 子类编码映射
  │
  ├─ orderPriorCode (行6450 医嘱类型判断)
  │   └─ 来源: 行数据读取 + 用户选择
  │       └─ GetCellData(rowid, "orderPrior")
  │           ├─ 默认值: API 返回的长/短期医嘱默认值
  │           └─ 用户可修改: 通过医嘱类型按钮切换
  │               └─ 终端: 用户 (或 API 默认)
  │
  └─ orderItemCatRowId (行6415 子类ID判断)
      └─ 来源: 行数据读取
          └─ ParamObj.orderItemCatRowId
              └─ 终端: API 响应中 ARCIM 项目的主数据
```

> **初始化链路的作用**：Phase 7（变更方法识别）中评估变更影响时，需要判断改变一个变量是否需要修改其初始化来源。例如要改变 `orderDoseQty` 的禁用逻辑，不仅需要修改行 6454，还需要确认 `orderType` 的赋值不受影响 — 而 `orderType` 来自 API 响应，只需要前端逻辑判断即可，不需要改后端。

---

### Phase 5：后端调用链追溯
> **输出约束**：本阶段的分析报告仅描述现有代码的实现方式和调用关系。禁止包含任何倾向性的改造建议、修改方向或建议改造位置等涉及变更的表述。所有涉及"如何修改"的分析推迟到 Phase 7-9（变更方法识别、多方案评估、结论输出）。本阶段以"现状是什么"为终点，不以"如何改"为目标。

> **必须回应 Phase 1 中列出的质疑点**（强制）——通过代码探索验证或补充质疑点中涉及的范围、功能、现状描述和目标冲突等维度，在报告中体现验证结论。

#### 5.1 Controller 定位

根据前端 AJAX URL 路径追踪到后端 Controller：

```bash
rg -rn "前端URL路径中的关键词" src/backend/ -g "*.java" -l
rg -n "@RequestMapping|@PostMapping|@GetMapping" src/backend/.../Controller.java
```

#### 5.2 BLH -> Service -> Mapper 链路追溯

```bash
rg -n "xxxBlh|xxxService\." src/backend/.../Controller.java
rg -n "xxxService\." src/backend/.../XxxBlh.java
rg -n "xxxMapper\." src/backend/.../XxxServiceImpl.java
rg -n "select|insert|update|delete" src/backend/.../XxxMapper.java
```

#### 5.3 Feign 跨服务调用追踪

如果接口通过 Feign 跨服务调用：

```bash
rg -rn "FeignClient|@FeignClient" src/backend/.../feign/ -g "*.java" -l
rg -rn "class.*Impl implements.*Client" src/backend/ -g "*.java" -l
```

#### 5.4 后端输出清单

| 层级 | 类名 | 方法 | 文件:行号 | 入参 | 出参 | 备注 |
|------|------|------|----------|------|------|------|
| Controller | `XxxController` | `getXxx()` | XxxController.java:35 | `@RequestBody XxxDTO` | `XxxVO` | URL: `/api/...` |
| BLH | `XxxBlh` | `queryXxx()` | XxxBlh.java:52 | `XxxParam` | `XxxResult` | 参数组装 |
| Service | `XxxServiceImpl` | `findXxx()` | XxxServiceImpl.java:88 | `XxxQueryDTO` | `List<Xxx>` | 分页查询 |
| Mapper | `XxxMapper` | `selectXxx()` | XxxMapper.java:12 | `XxxQueryDTO` | `List<Xxx>` | SQL: join a,b,c |

---

### Phase 6：质疑点门禁把关

对质疑点清单（初始 + 新增）进行统一审计，确认是否在 Phase 3-5 的探索中得到了充分验证。执行流程：

### 步骤 A：质疑点补充

基于 Phase 1-4 的探索结果，识别是否有新的质疑点出现，补充到清单中：

- 审查 Phase 3-5 的输出报告，对比 Phase 1 的质疑点清单，判断是否存在未被 Phase 1 覆盖的新范围质疑
- 例如：Phase 2 中发现某个页面也实现了相关功能但未在 Phase 1 中提及，则补充为该页面的质疑点

### 步骤 B：自动化遗漏审查

对 Phase 2-4 检索到的关联内容进行审查，判断是否因工具特性导致遗漏或忽略：

| 检查项 | 说明 | 判定方式 |
|--------|------|----------|
| AST 函数定义捕获 | 脚本只捕获 FunctionDeclaration，嵌套函数可能被忽略 | 对关键文件以 rg 全文搜索交叉验证 |
| AST 路径兼容 | Windows 下 path.join 产生反斜杠影响 glob 匹配 | 确认报告中文件数是否合理 |
| rg 编码 | rg 对 UTF-8 无 BOM 文件中的中文搜索可能失效 | 对未匹配项以 Select-String 验证 |
| API 关键字遗漏 | 脚本 keyword 列表可能不完整 | 检查前端自定义 AJAX 封装方法名 |
| 搜索范围遗漏 | 子模块未被纳入搜索路径 | 确认 submodule 状态并补充搜索 |

> 记录遗漏项：如发现遗漏，说明遗漏原因并记录到报告。严重的遗漏需从 Phase 2 重新探索。

### 步骤 C：统一审计

1. 逐条比对：将质疑点清单（含新增）与 Phase 2-4 的输出报告逐条核对
2. 关联评分：对每条质疑点按 5 星标准进行关联性评估
   - ★★★★★ 强关联
   - ★★★★☆ 关联
   - ★★★☆☆ 弱关联
   - ★★☆☆☆ 微弱关联
   - ★☆☆☆☆ 无关联
3. 门禁判断：未探索的质疑点从 Phase 2 重新开始探索
4. 用户确认：展示评分表，用户确认后方可进入 Phase 6

> 注意：此步骤不产生新的代码分析，仅对 Phase 3-5 的探索结果做审计和评分。

> 记录遗漏项：如发现遗漏，说明遗漏原因并记录到报告。严重的遗漏需从 Phase 2 重新探索。

### 步骤 C：统一审计

1. 逐条比对：将质疑点清单（含新增）与 Phase 2-4 的输出报告逐条核对
2. 关联评分：对每条质疑点按 5 星标准进行关联性评估：
   - ★★★★★ 强关联：质疑点对应的功能/界面被明确验证存在直接关联
   - ★★★★☆ 关联：质疑点的内容在探索中被部分验证
   - ★★★☆☆ 弱关联：质疑点有间接参考价值
   - ★★☆☆☆ 微弱关联：仅有边缘性参考
   - ★☆☆☆☆ 无关联：质疑点经过验证与当前需求无关
3. 门禁判断：如果存在未探索的质疑点，将该质疑点作为提示词，从 Phase 2 重新开始探索；循环直到所有质疑点都完成探索
4. 用户确认：将最终的评分表展示给用户，请用户确认关联关系是否需要调整。用户确认后方可进入 Phase 7。

> 注意：此步骤不产生新的代码分析，仅对 Phase 3-5 的探索结果做审计和评分。
对 Phase 2-4 检索到的关联内容进行审查，判断是否因工具特性导致**遗漏或忽略**：

| 检查项 | 说明 | 判定方式 |
|--------|------|----------|
| AST 函数定义捕获 | 脚本只捕获 FunctionDeclaration/FunctionExpression，嵌套函数或闭包中的函数可能被忽略 | 对关键文件以 rg 全文搜索交叉验证 |

> **记录遗漏项**：如发现遗漏，说明遗漏原因并记录到报告。严重的遗漏需从 Phase 2 重新探索。

### 步骤 C：统一审计

1. **逐条比对**：将质疑点清单（含新增）与 Phase 2-4 的输出报告逐条核对
2. **关联评分**：对每条质疑点按 5 星标准进行关联性评估：
   - ★★★★★ 强关联：质疑点对应的功能/界面被明确验证存在直接关联
   - ★★★★☆ 关联：质疑点的内容在探索中被部分验证
   - ★★★☆☆ 弱关联：质疑点有间接参考价值
   - ★★☆☆☆ 微弱关联：仅有边缘性参考
   - ★☆☆☆☆ 无关联：质疑点经过验证与当前需求无关
3. **门禁判断**：如果存在**未探索**的质疑点，将该质疑点作为提示词，从 Phase 2 重新开始探索；循环直到所有质疑点都完成探索
4. **用户确认**：将最终的评分表展示给用户，请用户确认关联关系是否需要调整。用户确认后方可进入 Phase 6。

> **注意**：此步骤不产生新的代码分析，仅对 Phase 2-4 的探索结果做审计和评分。
> **注意**：此步骤不产生新的代码分析，仅对 Phase 2-4 的探索结果做审计和评分。

---
### Phase 7：综合分析与设计文档

结合 Phase 1-6 的所有报告（初步探索、头脑风暴、UI入口定位、前端逻辑追踪、后端调用链追溯、质疑点门禁把关），使用 `superpowers:brainstorming` skill 探索需求并生成设计文档。


---

### Phase 8：变更方法识别

基于用户描述的目标需求，分析当前实现中哪些方法需要调整。

#### 8.1 需求分析与方法映射

```
用户需求: {用户描述的需求变更}

影响判断:
需求变化 -> 影响的数据字段
  |-> 哪些SQL/映射需要调整
    |-> 对应的Service/BLH方法
      |-> 对应的Controller接口
        |-> 对应的前端JS/页面组件
```

#### 8.2 可能存在的多种调整方向

对每一处需要调整的方法，列出所有可行的改造路径：

| 需调整环节 | 调整方向 A | 调整方向 B | 调整方向 C |
|-----------|-----------|-----------|-----------|
| Mapper SQL | 在原SQL加JOIN | 新写一个Mapper方法 | 在Service层二次处理 |
| BLH 逻辑 | 修改现有BLH方法 | 新增BLH方法复用 | 调用另一个Feign接口 |
| Controller | 扩展返回值VO | 新增Controller方法 | 改造入参DTO |
| 前端 JS | 修改现有方法 | 新增JS方法 | 增加页面组件 |

> 最少列出 **2 种** 调整方案，最多 **3 种**。

---

### Phase 9：多方案评估

#### 9.1 评估维度

| 维度 | 说明 | 评分标准（1-5） |
|------|------|----------------|
| **健壮性 (Robustness)** | 改动后系统的容错能力、异常处理完整性、是否引入新的失败风险 | 5=改动最小化，不影响现有路径；1=高风险，影响面广 |
| **可维护性 (Maintainability)** | 代码结构的清晰度、后续维护的成本、是否符合现有代码风格 | 5=清晰扩展，与现有模式一致；1=代码复杂，埋下技术债 |
| **可扩展性 (Extensibility)** | 方案对未来需求变化的适应能力、复用程度 | 5=抽象良好，易于扩展；1=硬编码，难以复用 |
| **影响范围 (Impact Scope)** | 对其他现有业务功能的影响程度 | 5=仅限于当前业务；1=多个模块需要联动修改 |
| **工作量 (Effort)** | 实施所需的代码变更量 | 5=小范围改动(1-2文件)；1=跨模块、大量改动 |

#### 9.2 方案评分

| 维度 | 方案 A (改造现有) | 方案 B (新增扩展) | 方案 C (重构) |
|------|-----------------|-----------------|-----------------|
| 健壮性 | 3/5 | 4/5 | 4/5 |
| 可维护性 | 3/5 | 5/5 | 3/5 |
| 可扩展性 | 2/5 | 5/5 | 4/5 |
| 影响范围 | 4/5 | 5/5 | 2/5 |
| 工作量 | 5/5 | 3/5 | 2/5 |
| **综合评分** | **中** | **高** | **中-高** |

> 评分不能凭空判断，必须在 Phase 3-5 的探索结果基础上给出依据。

#### 9.3 跨业务影响分析

针对方案中每一处方法调整，排查：

```bash
# 排查该方法被哪些其他前端页面/JS调用
rg -n "方法名\(" src/frontend/hisfront/ -g "*.js"

# 排查该方法接口被哪些其他后端模块引用（Feign调用方）
rg -rn "FeignClient" src/backend/ -g "*.java" -l
rg -rn "Client\.方法名\(" src/backend/ -g "*.java"

# 排查该方法调用的Mapper被哪些其他Service使用
rg -rn "XxxMapper\." src/backend/ -g "*.java"
```

#### 9.4 影响分析输出

| 方法 | 被哪些业务环节使用 | 调整后的影响 | 是否需要同时调整 |
|------|------------------|-------------|----------------|
| `XxxService.findList()` | 门诊医生站(患者列表)、住院医生站(入院记录) | 新增字段后可能与现有前端展示冲突 | 住院医生站前端需评估 |
| `XxxMapper.selectList()` | `XxxService.findList()`, `ExportService.export()` | SQL 加 join 可能影响 export 性能 | ExportService 需评估分页 |
| `xxx.js:42 searchPat()` | 页面加载、手动点击查询、双击患者 | 如果后端返回结构变化，JS解析逻辑需调整 | 无其他前端依赖 |

---

### Phase 10：结论输出

#### 10.1 输出报告结构

```
# 业务实现分析报告

## 一、业务概述与现状
- 用户描述的业务场景
- 当前实现的核心流程（1-2句话）

## 二、前后端实现链路（Phase 2-4 汇编结果：UI入口定位、前端逻辑追踪、后端调用链追溯）
- UI入口：{页面路径}
- 前端关键方法：表格式列出
- 后端关键方法：表格式列出
- 完整调用链图

## 三、需求变更范围（Phase 6-7 分析结果：业务实现汇编、变更方法识别）
- 用户目标需求摘要
- 需要调整的方法清单（含依赖关系）
- 多种可能的调整方向

## 四、方案评估（Phase 8 分析结果）
### 方案 A：{方案名称}
- 核心思路：...
- 修改清单：{文件:行号} 列表
- 评估得分：健壮性 X/5, 可维护性 X/5, 可扩展性 X/5, 影响范围 X/5, 工作量 X/5
- 综合风险：低/中/高

### 方案 B：{方案名称}
- ...

## 五、综合建议
- 推荐方案及理由
- 如果选择推荐方案，需要确认的事项
- 备选方案什么情况下更适合

> 请选择以上方案中的一种，或提出你的其他想法。
```

#### 10.2 输出规范

1. 不包含 "TODO"、"占位符"、"后续完善" 等未完成表述
2. 评估评分必须附上依据（引用 Phase 2-4 的探索结果）
3. 影响范围分析必须具体到文件和行号
4. 最终以用户选择确定下一步行动方向

---

## 通用搜索命令速查

| 目的 | 命令 |
|------|------|
| 搜索前端文件 | `rg -i "关键词" src/frontend/hisfront/ -g "*.js" -g "*.html" -l` |
| 搜索后端Java | `rg -rn "关键词" src/backend/路径/ -g "*.java"` |
| 搜索Mapper XML | `rg -rn "关键词" src/backend/路径/ -g "*.xml"` |
| 搜索调用方 | `rg -n "被调方法名|类名\." src/backend/ -g "*.java"` |
| 搜索前端调用 | `rg -n "URL路径" src/frontend/hisfront/ -g "*.js"` |
| 搜索Feign客户端 | `rg -rn "FeignClient|interface.*Client" src/backend/ -g "*.java" -l` |
| 搜索Spring Bean | `rg -n "@Service|@Component|@Repository" src/backend/ -g "*.java"` |

## 引用说明

本 Skill 的业务实现探索方法论参考自番薯(AI编码辅助)的企业工程实践文章（腾讯云开发者社区，文章 ID: 2676110），其从前端界面入口到后端数据的跨层调用链追踪策略与本文 Phase 1-2 + Phase 3-5 的追溯流程一致。在此基础上扩展了变更影响评估（Phase 7-8）和多方案结论输出（Phase 9），形成完整的 analysis-to-decision 工作流。

