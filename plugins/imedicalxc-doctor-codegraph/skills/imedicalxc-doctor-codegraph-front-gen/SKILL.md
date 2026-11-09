---
name: imedicalxc-doctor-codegraph-front-gen
description: |
  HIS 医生站前端链路索引构建与增量更新。扫描 static 下全部 HTML/JS，建立「界面 → 操作元素 → JS 方法 → HTTP 请求」链路，输出 front_chain_db.json / front_chains.jsonl；可选导入 Kingbase 菜单快照为页面补充业务角色；服务端配置下发的按钮/菜单按场景登记并从数据库导出快照。
  Use when 首次初始化前端链路索引、前端页面或脚本变化后重建/增量更新、front_chain_db.json 缺失或过期、需要查询某个按钮最终调用了哪些后端接口、或需要评估前端改造的影响范围。
  本期只输出 URL 路径，不关联后端 Controller。
---

# 医生站前端链路索引：构建与增量更新

## 职责边界

- 本 skill 只负责**生成/刷新前端链路数据**（离线批处理）与**链路查询脚本**。
- 链路口径：`页面 HTML → 操作元素（按钮/链接/输入控件）→ 事件 handler → JS 方法调用链 → HTTP 请求`。
- 界面之间也存在指向边：`界面 →(弹出) 界面`（`websys_showModal` / `ShowHISUIWindow` / `windowOpenFrame` / `commonShowWin` / `addTab` / `window.open` 等弹窗或新开页）、`界面 →(内嵌) 界面`（静态 `<iframe src>`）、`界面 →(跳转) 界面`（配置下发的纯跳转项）、`界面 →(包含) 界面`（服务端 `csp-include` 片段）。四类边与请求链路并存，写入 `page_links` 与 GraphML。
- 字面量钩子分派（`Common_ControlObj.BeforeUpdate("X")` → `BeforeUpdateFuncs.X`、`Interface("X")` → 插件 `Funcs.X`）属于链路的一部分；由 `cf_doc_interface_product` / `cf_doc_interface_modulelink` 在运行时下发的插件脚本本身尚未按配置展开，插件的 `OEOrd.BeforeUpdate` 等钩子实现只在 `comoe/interface/**` 内可见、不挂到具体页面。
- 请求只记录 URL 表达式与解析后的路径，**不关联后端 Controller / Feign**。后端影响分析使用 `imedicalxc-doctor-codegraph-gen` / `-search`；需要「HTML 页面 → 元素 → JS → 请求 → Controller」的完整五段链路时，用 search skill 的 `query_front_back_chain.py`（查询 8），它消费本 skill 产出的 `front_chain_db.json`，不回写。
- 扫描范围：`src/frontend/hisfront/static` 下**全部** HTML/JS（跳过 `scripts_lib`、`lib`、`node_modules`、`dist` 等第三方/构建目录）。
- 所有输出写入 `docs/agents/imedicalxc-doctor-front-codegraph/`（目录由插件 manifest 的 `projectDirectories` 声明，脚本从 manifest 解析）。
- 脚本目录：`.agents/plugins/imedicalxc-doctor-codegraph/scripts/front`。

## 前置条件

1. Python 3.8+。HTML/JS 扫描零第三方依赖（自带 JS 词法分析器）。
2. `psycopg2`（或 `psycopg2-binary`）仅用于 `import_menu_snapshot.py --from-db` 与 `explore_config_injection.py --from-db`。
3. 菜单与配置注入导入使用环境变量，脚本不读取任何本地凭据文件：

   ```bash
   KB_HOST=... KB_PORT=... KB_DATABASE=... KB_USER=... KB_PASSWORD=... [KB_SCHEMA=sm_his]
   ```

   缺失时脚本以 `NEED_CREDS` 退出。两者都是**可选输入**：不导入时页面角色走静态启发式，配置下发的按钮不并入链路。没有环境变量时走 Kingbase MCP（`--emit-sql` → 查询 → `--from-json`）。
4. `docs/agents/imedicalxc-doctor-front-codegraph/` 可写。

自检命令：

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts/front
python -c "from config import OUTPUT_DIR, FRONT_ROOT; print('前端根:', FRONT_ROOT); print('输出:', OUTPUT_DIR)"
```

## 初始化：全量构建

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts/front
python html_scan.py \
  && python js_scan.py \
  && python import_menu_snapshot.py --from-db \
  && python explore_config_injection.py --from-db \
  && python build_front_chain_db.py
```

没有数据库环境变量时跳过第 3、4 步（菜单与配置注入快照均为可选输入）：

```bash
python html_scan.py && python js_scan.py && python build_front_chain_db.py
```

| 步骤 | 脚本 | 耗时（2026-11-06 实测） | 输出 |
|---|---|---|---|
| Step 1 | `html_scan.py` | ~30s（6,253 页） | `front_pages.jsonl`、`front_elements.jsonl` |
| Step 2 | `js_scan.py` | ~3min（9,810 个 JS，8 进程） | `front_js_index.jsonl` |
| Step 3（可选） | `import_menu_snapshot.py --from-db` | ~5s（3,700 菜单 / 1,126 按钮） | `menu_snapshot.json` |
| Step 4（可选） | `explore_config_injection.py --from-db` | ~10s（5 个场景） | `config_injection_snapshot.json` |
| Step 5 | `build_front_chain_db.py [--graphml]` | ~2-3min | `front_chain_db.json`、`front_chains.jsonl`、`front_scan_stats.json`、可选 `front_chain.graphml` |

Step 1 / Step 2 互相独立，可并行；Step 3、Step 4 只依赖数据库，可与 Step 1/2 并行；Step 5 必须在 Step 1、2 之后。

### 实体存在性约束（必须保持）

链路里的界面和方法都必须是前端仓库中真实存在的东西，不允许用名称联想补出来：

- **页面集合只来自磁盘扫描**：`pages` = `static/` 下实际扫描到的 HTML。菜单快照、配置注入、URL 模板都不能新增页面；弹窗 / 跳转 / iframe 目标不在页面集合时只计数（`unresolved_open_targets` / `open_targets_non_page`），不建边。
- **`.csp` / `.rpx` / 接口 / 外部协议不是页面**：归入 `open_targets_non_page`，不得进入 `pages`、`page_links` 或菜单归属。旧菜单快照里的 `.csp` 名称只代表历史产品页面。
- **脚本必须存在**：`pages[].scripts`、`chains[].path[].file` 都应是 `static/` 下的实体文件；解析不到文件的脚本引用不写入链路。
- **路径步骤的推进方式**：`chains[].path[]` 每步是 `{function,name,file,line}`；经回调边推进的一步额外带 `kind="callback"`（见踩坑 37），无该字段表示普通调用/入口。
- **合成节点不是方法名**：`__handler_N`（匿名事件处理）和 `__top_level__`（页面顶层代码）是扫描器内部编号，源码中没有同名函数。`functions` 里以 `kind` 区分，下游展示时名称留空并用「匿名事件处理 / 页面顶层代码」说明，不得当作 JS 方法名引用。
- **构建后校验**：运行 `audit_front_coverage.py --json`，`existence.missing` 必须为空；出现缺失说明构建引入了非实体页面/脚本，先修扫描或归一化逻辑，不放行。

数据库 MCP 不可直连时，用 `explore_config_injection.py --emit-sql` 取 SQL，经 MCP 查询后 `--from-json` 导入（MCP 单次最多 500 行，需按 `LIMIT 500 OFFSET n` 分页合并）：

```bash
python explore_config_injection.py --emit-sql --scenario doc_btnbar
python explore_config_injection.py --from-json rows.json --scenario doc_btnbar
```

## 增量更新

扫描脚本不做文件级缓存；增量 = **只重跑受影响的流水线段**。Step 4 需要全量重算（可达子图随入口变化）。

| 变更源 | 需重跑 | 说明 |
|---|---|---|
| HTML 页面（元素、iframe、脚本引用、`on*=`) | Step 1 → Step 5 | 页面元素与页面内嵌关系变化 |
| 业务/公共 JS（函数、事件绑定、请求封装） | Step 2 → Step 5 | 方法、绑定、URL 常量变化 |
| 菜单（Kingbase `hos_sys_resource`） | Step 3 → Step 5 | 页面角色与菜单归属变化 |
| 配置按钮栏 / 右键菜单 / 执行单按钮（Kingbase 配置表） | Step 4 → Step 5 | 配置项、handler、分组变化 |
| `config.py` / `config_injection.py` 的跳过规则、场景登记 | 全量 | 扫描范围或识别规则变化 |
| 无法判断 | 全量 | 执行初始化一键命令 |

### 新鲜度自检

```bash
# 前端源码比链路库新（有输出即索引落后）
find src/frontend/hisfront/static -name '*.html' -o -name '*.js' \
  | head -n 1 >/dev/null
find src/frontend/hisfront/static \( -name '*.html' -o -name '*.js' \) \
  -newer docs/agents/imedicalxc-doctor-front-codegraph/front_chain_db.json -print -quit
```

## 输出文件总览

| 文件 | 内容 | 来源 |
|---|---|---|
| `front_pages.jsonl` | 每页标题、注释标题、模块、脚本引用、iframe/导航引用、`csp-include` 片段引用（`includes`）、页面内元素 | Step 1 |
| `front_elements.jsonl` | 扁平化操作元素（页面、id/name、标签、文案、事件、handler 表达式） | Step 1 |
| `front_js_index.jsonl` | 每文件函数定义（含 parent/calls/requests）、URL 常量、事件绑定、datagrid 工具栏按钮、`marybtnbar` 配置、JS 字符串内联元素 | Step 2 |
| `menu_snapshot.json` | 菜单 → 页面、配置按钮栏 → handler；可选 | Step 3 |
| `config_injection_snapshot.json` | 服务端配置下发的按钮/菜单快照：场景 → 分组 → 配置项（handler/url/院区）；可选 | Step 4 |
| `front_chain_db.json` | **查询主数据源**：pages / elements / functions / requests / chains / page_links；页面带 `includes` 与合并后的 `scripts` 计数，片段带入的元素带 `origin_page`，请求记录带 `url_prefix`（未能静态解析的运行时前缀） | Step 5 |
| `front_chains.jsonl` | 每条链路的扁平视图（页面、元素、调用路径、请求） | Step 5 |
| `front_scan_stats.json` | 页面/元素/可达函数/请求/链路/界面关系规模与未解析计数 | Step 5 |
| `front_chain.graphml` | 有向图（Gephi）：节点=界面 / JS方法 / HTTP请求（界面节点另带标题/模块/页面角色/菜单/JS方法/HTTP请求地址/链路数属性）；边=界面→方法→请求调用链 + 界面→界面关系；工具类方法已剔除，当前 6,243 界面 / 19,050 JS方法 / 7,346 HTTP请求 / 44,070 边（界面→界面 1,570） | Step 5 `--graphml` |

`front_js_index.jsonl` 是函数级全量索引（约 177 MB），用于重算链路；日常查询只读 `front_chain_db.json`。

## 链路口径与解析规则

### 操作元素来源（优先级）

1. **HTML 内联 handler**：`onclick="saveCon()"`、`href="javascript:..."`、`data-options="onClick:fn"`。
2. **JS 事件绑定**：`$('#save').click(saveCon)`、`.on('click', fn)`、`.on('click', '#id', fn)`、`.bind`、`.delegate`、hisui 插件 `$("#x").linkbutton({onClick:fn})` 与 `$HUI.linkbutton("#x", {onClick:fn})`（`linkbutton`/`button`/`panel`/`datagrid` 等）。绑定按「页面 `<script src>` 列表」归属到页面，元素按 `#id` 对齐。
3. **JS 字符串拼出的元素**：业务 JS 里拼接的 `onclick=...` HTML，按所在脚本归属页面；元素 id 未知时用 `#__jsstr_<line>_<n>`。
4. **datagrid 工具栏按钮**：`$("#dg").datagrid({toolbar: [{text:'保存', handler:saveClick}]})` 或 `toolbar` 指向同文件数组变量（含 `cond ? toolbar : []` 三元）；HTML 里没有对应元素，合成 `#__toolbar_<line>_<n>`，`source=js_toolbar`。
5. **配置按钮栏**：`marybtnbar({queryParams:{code:'xxx'}})` 声明 bar code，链接 `cf_doc_config_btnbar_item.click_handler`；仅当 bar code 与页面脚本声明一致时并入。
6. **页面加载**：每个页面脚本的 `__top_level__` 作为合成元素 `#__page_load__`，覆盖初始化请求。
7. **`csp-include` 片段元素**：`<csp-include Page="x.html">` 是服务端片段包含，片段本身没有 `<script>`。构建时把片段（递归 ≤3 层、去环）的元素并入父页面，`origin_page` 标注来源片段；片段元素因此与父页面脚本绑定，不再成为孤立元素。

### 界面关系（页面 → 页面）

`page_links` 记录界面之间的四种指向边，每条边带来源与触发点：

| 类型 | 来源 | 采集方式 |
|---|---|---|
| `弹出` | 操作元素 / 页面加载 | JS 里调用页面打开 API，实参中的 URL 解析后落到现存页面 |
| `内嵌` | 静态 iframe | HTML `<iframe src>` / `frames` |
| `跳转` | 配置注入 / 动态 iframe | 配置注入中 `merge: True` 且只有 `url` 的导航项；`$("#TabMain").attr("src", url)` 换主框架内容（opener=`iframe_src`） |
| `包含` | 服务端片段 | `<csp-include Page="x.html">`（opener=`csp-include`）；片段的脚本与元素在父页面同样生效，行为按父页面归属 |

- 识别的页面打开 API（`js_scan.py` 的 `_PAGE_OPENERS`）：`websys_showModal({url})`、`ShowHISUIWindow(title, src, …)` 或对象实参 `{src|url}`、`showHISUIWindow` / `openHISUIWindow`、`websys_addTab({url})`、`windowOpenFrame({url})`、`windowTopOpenFrame({url})`、`commonShowWin({url})`、`addTab(id, title, url, selected)`、`window.open(url)`（仅 `window.open` / `globalThis.open` / `top.open`，普通 `.open(...)` 不算）；`$(...).attr("src", url)` / `.prop("src", url)` 记为主框架换页（`opener=iframe_src`）。
- 地址先归一化再比对：剥 `${websys_frontPathCombine("x.html")}` 模板串（含尾随 `?query`）、`<iframe src='x.html'>` 片段、`x.htmlinput=` 拼接残留；绝对地址去掉 `/` 与 `/static/` 前缀，并逐层剥掉 `../` 与部署上下文前缀（`his/`、`imedical/his/`），按 `his/bsp/...`、`imedical/his/nr/...`、`../../his/opcare/...` 三种写法都能落到 static 内路径。
- 地址回退顺序：页面所在目录 → `base/`（多数弹窗按 base 解析，`../opcare/x.html` 即 `opcare/x.html`）→ 去 `./` 的裸相对路径；绝对地址先按 static 根、再按本页目录解释（`/referral.html`）。逐个候选与页面集合比对，命中的第一个才建边。
- 直接候选全不命中时依次尝试：路径尾段唯一匹配（解决部署根不同，`../../insu/ip/...` → `ar/insu/ip/...`；区域变体 `injr/43` 不会连到 `bj`）→ 首段不同但其余目录一致的唯一匹配（模块改名，`opspcol/nurm/exec` → `emnur/nurm/exec`）→ 同目录单字符差异的唯一页面（拼写错误，`single_docment.html` → `single_document.html`）→ 唯一同名页面。任一环节多义即放弃，不猜。
- 弹出 URL 的实参若是 `websys_frontPathCombine(...)` / `encodeURIComponent(...)` 等纯包装，剥一层继续解析。
- `websys_showModal("close" | "options")` 这类命令字符串不是 URL，直接忽略。
- 未落地的打开地址分三类计数：`open_targets_runtime`（无地址或运行时变量，如 `url` 形参）、`open_targets_non_page`（`.csp`/`.rpx` 报表、接口、外部协议）、`unresolved_open_targets`（看着像页面但工程内确实没有，或同名多义）。当前 37 处，典型目标：HNIS 外部登录页（`hnis/login/loginCtrl.htm`）、已下线页面（`pateduquote.html`、`dic.import.api.html`、`bill.ip.patientinfo.html`、`bill.ip.uppatinfo.html`、`insuipreg.html`、`insu.tableimportceshi.html`，以及只在 `hispa/pat` 存在的 `doc.cardverification.html`）、区域变体（`injr/43` 只有 `bj` 实现）、同名多义（`scoreformview.html` 有 phipca/phopca 两份）。
- `包含` 边不做 URL 落地比对：父页面实际执行的脚本 = 自身脚本 + 片段闭包内脚本（去重保序），事件绑定、配置分组、页面加载都按这份有效脚本列表归属；片段元素在链路里以父页面出现，`origin_page` 保留片段的原始路径。
- 边是**静态可达**语义：同一页面脚本里被多个元素共享的弹窗方法会挂到多个元素上，表示「该元素可达此界面」，不代表必触发。

### 服务端配置注入场景

工具栏按钮、右键菜单、执行单按钮不写在 HTML/JS 里，由服务端配置表下发；**各模块组的下发形式不一致**，必须按场景登记（`scripts/front/config_injection.py`），不能只认 `marybtnbar`。当前 5 个场景：

| 场景 | 配置表 | 前端识别方式 | 分组键 |
|---|---|---|---|
| `doc_btnbar` 按钮栏 | `cf_doc_config_btnbar` / `_item` | URL 命中 `getBtnCfgData` / `getCardRegBtnCfgData`；分组来自 `marybtnbar` 的 `queryParams.code`、`$.data({code})`、`x.attr('barurl')` 或 DOM 属性 `barurl`/`barcode` | bar `code`（= 页面名，如 `doc.oeorder.oplistcustom.new.html`） |
| `oe_view_right_menu` 医嘱右键菜单 | `cf_oe_ord_item_view_right_menu` | 页面初始化数据下发，无配置接口；靠渲染函数 `showGridRightMenu` 的第 4 个实参映射（`Ord` → 4 个 `DOC*/NUR*Order`，`OrdExec` → `NUR*Exec`） | `menu_type` |
| `oe_view_menu` 医嘱列表菜单 | `cf_oe_ord_item_view_menu` | 同上（无院区/角色维度） | `menu_type` |
| `nurse_exec_button` 护理执行单按钮 | `cf_nr_nurseexecute_buttoncolumn` + `_sheetset` + `_buttonconfig` | URL 命中 `getSheetButtons` / `getSheetButtonColumn`；运行时按键为变量（当前单据），页面承载该场景全部分组 | `nss_code` |
| `page_config` 通用页面配置 | `cf_dic_pageconfig` | 仅登记目录（`datagrid_url`），无点击 handler；`merge: False` 只做对照，不并入元素 | `code` |

- 场景登记字段：`binding`（绑定方式）/ `detect`（前端 URL 片段，长片段优先）/ `call_bindings`（渲染函数 + 实参映射）/ `dynamic_groups`（分组键为运行时变量）/ `merge`（是否并入链路）/ `sql`（列别名统一为 `grp/code/name/handler/display_handler/url/active/hosp_dr/seq/extra`）。
- SQL 统一按「分组」导出：`doc_btnbar` 的 grp 是按钮栏 code，`nurse_exec_button` 的 grp 是单据 `nss_code`，不是按钮自身 code。
- 多院区重复行按「有 handler > 有 url > active > 院区」保留一条，`variants` 记录重复数。
- 导出后写入 `config_injection_snapshot.json`（`groups["<scenario>::<grp>"]`），Step 5 按 `config_calls` 里的场景与分组键并入元素；纯跳转按钮进 `nav_url` / `nav_target`，不要求 handler。

### 函数解析

- 同名函数先在**页面脚本列表**内解析；页面内不唯一或不存在时再退回全局唯一名。
- `this.method` / `self.method` 按所属对象/类前缀展开。
- 事件绑定是**包装器调用**时解包首参：`DocToolsHUI.btn.throttle(fn, 300)`、`debounce/proxy/wrap(fn)` 取 `fn`；函数表达式登记为 `__handler_<n>` 匿名节点，限定名原样使用。单参调用（`loadTable("1")` 这类工厂）不解包，仍按无法静态解析处理。
- 调用链 BFS（按调用深度逐层展开）默认深度 6、单元素最多 40 个请求，并做环检测。**不要改回深度优先**：主操作（如保存）通常由 handler 直接调用，DFS 会让前面分支的深层请求先占满配额，把保存请求挤出链路。
- 链路库只保留**从界面可达**的函数（当前约 4.0 万 / 全量 19.3 万），未解析的库/DOM 调用只计数不建边。

### URL 解析

- 支持 `$ipost/$iget/$iput/$idelete/$ipost_enc/$iget_enc`、`$iexport`、`$.ajax/$.post/$.get/$.getJSON`、`fetch`、`XMLHttpRequest.open`。
- URL 常量按同文件递归回填（最多 6 层），覆盖对象成员（`urlObj.saveOrUpdateIpBook`）与普通赋值（`let appPath = menuWin.baseAppPath + "opcare/ipbook/ipBookCreate/"`）。同名常量优先取**当前函数作用域**的定义，其次取文件顶层，避免局部 `url` 串到别的函数。
- 函数体内的局部常量要单独补扫：`_scan_body_constants()` 遍历每个 def（含箭头函数、函数声明）的赋值语句，主循环只覆盖对象字面量方法体。弹窗与请求共用同一套 `url_terms` 解析。
- 未解析的裸变量（跨文件定义的 `rootUrl`、`menuWin.baseAppPath` 等）在拼接时丢弃，避免产生 `rootUrlar/...` 这类伪路径；只有能解析成路径常量的引用才保留。被丢弃的引用若是**前缀位**（`baseAppPath`、`appPath`、`baseURL` 等），记入请求记录的 `url_prefix`（逗号分隔、排序去重），作为「该接口前缀由哪个运行时变量提供」的定位线索，不参与链路。
- 解析结果必须是路径字符集（无空格、括号、引号），且长度 ≤ 300；不满足则视为未解析。
- 输出 `url_expr`（源码表达式）与 `url_paths`（全部可静态解析的路径；`url_path` 保留首个，兼容旧查询）。`url_paths` 为空表示常量无法静态解析，该请求不进入链路（计入 `unresolved_urls`）。
- 多路径变体的来源：① 等长三元分支无法按页面模块收敛时全部保留（`comoe/exam` 的 `PAAdmType=="I" ? "ipcare" : "opcare"` → 同时登记 ipcare / opcare 两个服务前缀）；② 同一函数作用域内同名变量多次赋值（`switchMainSrc` 里 if/else 给 `LinkUrl` 赋三个页面地址 → 三个跳转目标）。三元词项带条件文本，同一条件出现多次时收敛到同一分支，避免拼出 `ipcare + Opcare` 这类不可能组合。
- 单条请求最多保留 8 个 URL 变体（`MAX_URL_VARIANTS`）；页面模块能唯一匹配三元分支时（`opcare/...` 页面）只保留该分支，不产生跨服务噪声。

### 页面角色

| role | 判定 |
|---|---|
| `menu_page` | 在菜单快照中（`hos_sys_resource` 路由匹配页面） |
| `embedded_page` | 被其他页面 iframe / 导航调用引用 |
| `sub_page` | 文件名含 `.show.` / `.hui.` 等子界面约定 |
| `component` | `base/` 下的公共组件页面 |
| `unclassified` | 以上都不满足（未导入菜单时常见） |

### 工具类方法识别

医生站前端没有强制的工具类命名规范，但代码里存在稳定的约定。`config.utility_reason()` 按以下顺序判定，命中即标记 `category=utility`；GraphML 导出时剔除这些节点，链路按剩余业务方法重连（整条链路都是工具方法时退化为「界面 → 请求」）。

| 层 | 规则 | 依据 |
|---|---|---|
| 框架目录 | `base/scripts/**`（排除 `base/scripts/doc/plugins/**` 业务共享插件）；任意路径含 `/utils/`、`/util/`、`/tools/`、`/tool/`、`/hisui/`、`/third-party/`、`/ueditor/`、`/xlsx/` | `base/scripts` 是基础框架（hisui、websys、session、pagemgr、hui.ext） |
| 公共组件文件 | `hai/scripts/component.js`、`detail-table.js`、`floatwindow.js`、`mr/common/scripts/fs.desktopprint.js`、`emtr/common/js/iconCommon.js`、`ct/common/scripts/dict.js` | 逐个确认过的通用 UI 组件；同名文件在业务目录也存在，不能按 basename 全局判定 |
| 模块公共目录 | `iphis/common/scripts/`、`msup/common/scripts/`、`phm/common/scripts/`、`clor/com/scripts/`、`mrnr/nuremr/scripts/plugin/`、`ar/common/scripts/plugin/` | 白名单内的 UI 组件/公共封装，不含业务页面逻辑 |
| 加载器 | `ar/insu/basesrv/scripts/insu.port.js` | 只做脚本装载与缓存（Proxy 排队），不含业务动作 |
| 框架副本 | 文件名匹配 `jquery*`、`*min.js`、`websys*`、`*.websys.js`、`hisui*`、`*.hisui.js`、`*.sysmgr.js`、`common[._-]*.js`、`datagrid*.js`、`validatebox*`、`framework.js`、`jspdf*`、`xc.*` | 各业务模块都复制了一份 `jquery.hisui.js` / `websys.js`，散落在 `*/scripts/` 下 |
| 公共函数库 | `pubfunction.js`、`funlib*.js`、`session.js`、`laybutton.js`、`mock.js`、`extend.js`；文件名含 `util`；`common` 目录下的 `common.js` / `public.js` / `tools.js` / `ux.js` | 日期、弹窗、按钮、Ajax 封装等公共方法 |
| 插件命名 | 函数名 `$` 前缀（hisui/jQuery 插件约定，如 `$g`、`$get_loginInfo`） | 约定式扩展方法 |

不做目录级 `common` 一刀切：`ar/common/scripts/interface.js`（医保接口）、`lock.js`（就诊加锁）、`mchs/common/scripts/mchs_adm.js`（慢病就诊公共业务）、`mr/mrm/ip/common/scripts/volselect.js`（病案卷选择）都是业务共享代码。也不按 `check`、`date`、`grid` 等词根过滤文件名，误杀率高（如 `bill.checkout.js`、`hm_ar_bill_checkout.js` 都是业务结算）。

`front_chain_db.json` 的每个函数带 `category`（`business`/`utility`），工具类另带 `utility_rule` 说明命中哪条规则；`front_chains.jsonl` 保留完整路径（含工具方法）作为原始证据，需要业务视图时按 `category` 过滤。

## 构建后验证

```bash
cd .agents/plugins/imedicalxc-doctor-codegraph/scripts/front

# 1. 规模统计
python query_front_chain.py summary

# 2. 已知链路冒烟：开住院证「保存」→ saveCon → save → $ipost
python query_front_chain.py page doc.ipbook.create

# 3. 配置注入冒烟：门诊/住院医嘱「审核医嘱(S)」→ 保存
python query_front_chain.py url saveOeOrdItem
#   期望（每条链路以 [HTML 页面] 开头）：
#         [门诊/住院医嘱页] [click] 审核医嘱#...  (UpdateClickHandler → InsertOrderItem) ⇒ POST OeOrdItemEntryHandle/saveOeOrdItem
#         [门诊/住院医嘱页] [click] 审核医嘱#...  (UpdateClickHandler → SaveOrderItems)  ⇒ POST OeOrdItemCMEntry/saveOeOrdItem

# 4. 按方法反查调用链
python query_front_chain.py function saveCon

# 5. 按 URL 反查触发入口
python query_front_chain.py url saveOrUpdateIpBook

# 6. 界面关系冒烟：开医嘱页应弹出检查申请、诊断选择、治疗申请等界面
python query_front_chain.py links doc.oeorder.oplistcustom.new

# 7. 归属审计：确认每个已解析 URL 都有「页面 → 元素 → JS 方法」链路
python audit_front_coverage.py
python audit_front_coverage.py --json

# 8. 原始统计（未解析计数；从项目根执行）
cd "$(git rev-parse --show-toplevel)"
python -c "import json; print(json.load(open('docs/agents/imedicalxc-doctor-front-codegraph/front_scan_stats.json')))"

# 9. 片段合并冒烟：挂号主页包含 adm/appt 两个 csp-include 片段
python query_front_chain.py page doc.opregistmain
#   期望「指向界面: 包含 2（doc.opregistadm.html, doc.opregistappt.html）」；
#   片段元素在 front_chain_db.json 的 elements 里带 origin_page（如 #Update → doc.opregistadm.html）
```

`audit_front_coverage.py` 的五段口径：

| 段 | 口径 |
|---|---|
| 已解析 URL | 请求记录是否都进了链路、页面/元素/函数引用是否悬空、handler 是否属于页面脚本 |
| 未解析 URL | 界面可达但 URL 解析失败的请求点（按运行时变量/拼接/成员常量/字面量校验分类）+ 不可达请求点 |
| 触发点 | 有可操作元素的页面是否产出链路、handler 解析率、有 handler 但 0 请求的拆分 |
| 配置注入 | 分组绑定与缺失 |
| 界面关系 | 界面→界面边总数与类型分布、有弹出关系的页面数、完全孤立页面数、弹窗地址落不到现存页面的数量 |

## 查询命令

```bash
python query_front_chain.py summary                 # 总览、按模块统计、角色分布
python query_front_chain.py page <路径片段>          # 页面元素与操作链路（含指向界面）
python query_front_chain.py element <id或文案>       # 操作元素 → 处理函数 → 请求
python query_front_chain.py function <方法名>        # 函数定义、调用方、相关链路
python query_front_chain.py url <URL片段>            # 请求 → 触发入口与调用路径（每条链路带 [HTML 页面]）
python query_front_chain.py links <路径片段>         # 界面 → 界面：出边与入边（弹出/内嵌/跳转/包含）
python query_front_chain.py menu <菜单名片段>         # 菜单 → 页面（需菜单快照）
```

> 方法名可能同名多义，`function` 命令按包含匹配列出所有候选，需结合 `file` / `parent` 判定。

## 关键配置（`scripts/front/config.py`）

| 常量 | 作用 |
|---|---|
| `FRONT_ROOT` | 前端静态根（`src/frontend/hisfront/static`） |
| `SKIP_DIR_NAMES` | 跳过的第三方/构建目录（`scripts_lib`、`lib`、`dist` 等） |
| `MAX_JS_FILE_MB` / `MAX_HTML_FILE_MB` | 单文件扫描上限（2 MB / 4 MB） |
| `MINIFIED_LINE_LEN` | 压缩文件判定阈值（单行 > 1000 字符且行数少） |
| `UTILITY_*` / `utility_reason()` | 工具类方法判定规则（框架目录、公共组件、模块公共目录、加载器、框架副本、公共函数库、`$` 插件前缀） |
| `OUTPUT_DIR` | 从插件 manifest 的 `front-codegraph-index` 解析 |
| `CONFIG_INJECTION_FILE` | 配置注入快照路径（`OUTPUT_DIR/config_injection_snapshot.json`） |

## 当前规模（2026-11-09 全量构建）

| 指标 | 数值 |
|---|---|
| HTML 页面 | 6,243 |
| 操作元素（HTML 解析） | 183,361（其中可交互 27,535；链路库元素记录 33,603，含 `csp-include` 片段带入元素） |
| handler 解析 | 27,520 个 handler 槽位：26,022 绑定到函数，1,498 未解析（归属审计口径：27,345 个元素带 handler，1,485 未解析） |
| JS 文件 | 9,810 发现 / 9,328 扫描 / 482 跳过（压缩、超限、pdf.js / babel-polyfill 等第三方包） |
| 函数定义（全量） | 193,188 |
| 可达函数（进入链路库） | 39,633（业务 38,812 / 工具类 821） |
| 工具类方法进入链路 | 236 个节点（按 `category` 过滤，GraphML 剔除并重连） |
| HTTP 请求（已解析 URL） | 12,515 / 7,346 个「方法+路径」（未解析 URL 5,751） |
| 链路 | 30,323 |
| 界面→界面关系 | 1,570 条（弹出 1,045 / 跳转 416 / 内嵌 81 / 包含 28），有弹出关系的界面 461 |
| 配置注入 | 5 场景 / 99 组 / 366 项并入链路（跳转 15 / 页面跳转边 10），缺失分组 0 |
| 未解析被调方法 | 240,526 |
| `front_chain_db.json` | 60.5 MiB（`front_js_index.jsonl` 177 MB，不进链路库交付口径） |
| `front_chain.graphml` | ~18.8 MB（6,243 界面 / 19,050 JS方法 / 7,346 HTTP请求节点 / 44,070 边，其中界面→界面 1,570 条，`--graphml` 生成） |

> 页面数比 2026-11-06 少 10 个、元素少 1,584 个，来自 pdf.js 目录跳过规则（踩坑 30），与包装器解包 / 片段合并改造无关。

### 归属审计结果（2026-11-09）

| 口径 | 结果 |
|---|---|
| 已解析 URL 的归属 | 12,515 条请求全部进入链路，0 条无链路；页面/元素/函数引用 0 悬空 |
| 实体存在性 | 页面 / JS 文件 / 界面关系端点 0 缺失（`existence.ok=true`） |
| handler 作用域 | 120 条链路（24 页 / 51 个 URL）的入口方法不在页面 `<script src>` 列表内（`<addins>` 运行时注入的公共脚本） |
| 界面可达但 URL 未解析 | 1,240 处 / 1,056 个函数 / 567 种表达式（运行时变量 525、其他 359、成员常量 158、拼接含未解析项 146、字面量校验 52） |
| 无界面入口的请求点 | 7,150 处（库/共享函数，不属于任何页面操作链路） |
| 有可操作元素但无链路的页面 | 1,067 |
| 有 handler 但 0 请求的元素 | 20,273：URL 全部未解析 231 / handler 本身不发请求 20,042 |
| 界面关系 | 1,570 条边；有弹出关系 461 页；无任何界面关系 5,163 页；弹窗/跳转地址未落地 37 处（运行时变量 771 / 非静态页面 379） |

## 构建踩坑

1. **不要用 ripgrep 从项目根搜索前端**：`src/frontend` 是独立 git 仓库，ripgrep 默认跳过嵌套仓库；搜索请进入 `src/frontend/hisfront/static`。
2. **跳过第三方目录**：`scripts_lib`（Lodop 等，约 126 MB）与 `lib` 不含业务链路；纳入会显著放大索引且全是噪声。
3. **压缩文件必须跳过**：`*.min.js` 与单行超长的打包产物会让 token 数爆炸；`is_probably_minified` 同时看文件名与行形态。
4. **handler 解析必须绑定页面脚本上下文**：直接在全局按方法名查找会把 `saveCon` 这类同名函数解析到其他模块。正确顺序是「页面 `<script src>` → 同文件精确/唯一名 → 全局唯一名」。
5. **`$(document).on('click','#id',fn)` 是委托绑定**：选择器在第二个参数，不能只认 `$('#id').click(fn)`。
6. **HTML 注释与脚本块**：抽取元素前要屏蔽 `<!-- -->`、`<script>`、`<style>`，但抽取 `<script src>` 时不能把 script 标签一起屏蔽（否则脚本引用全为空）。
7. **配置按钮不在 HTML 里，且各模块下发形式不同**：`marybtnbar` 只是 `doc_btnbar` 一种；右键菜单靠页面初始化数据 + `showGridRightMenu` 的类型实参，护理执行单按钮靠 `getSheetButtons`，分组键是单据 `nss_code` 而不是按钮 code。新模块务必按场景登记到 `config_injection.py`，并同时确认「前端识别方式 + 配置表 + 分组键」三件事，缺一个就会整组漏掉。
8. **配置分组键可能是运行时变量**：`state.sheetCode`、`ebcNurheetParref` 无法静态求值，这类场景标 `dynamic_groups`，页面承载该场景全部分组；不要试图按变量名去配置表反查。
9. **MCP 查询单次最多 500 行**：`kb_query` 返回 `truncated: true` 时实际行数可能远大于 500，必须用 `LIMIT 500 OFFSET n` 分页取全再合并，否则配置项被静默截断。数据库凭据只走 MCP 或环境变量，不写进脚本。
10. **BFS 不是可选项**：保存类请求通常由 handler 直接调用（如 `UpdateClickHandler → InsertOrderItem`），DFS 会先走完前面分支的深层请求、占满 40 条配额，把保存请求挤出链路。换回 DFS 后表现为「保存按钮查不到 saveOeOrdItem」。
11. **URL 常量可能跨行、带前缀变量**：`appPath + "OeOrdItemEntry/getOrdList"` 需丢弃前缀变量；`urlObj.xxx` 与普通 `let appPath = ...` 都要递归展开。解析不出的请求宁可丢弃（`url_path` 为空）也不要回退到原始拼接表达式——`menuWin.baseAppPath+url` 不是接口路径。常量取值要截到语句结束（`;`/`,`），否则会把后续整段代码吞进表达式。
12. **静态分析不执行代码**：`eval`、运行时字符串分发、动态 `src`、运行时拼接的 URL 无法解析，只统计在 `front_scan_stats.json`；不要把这些当成漏扫缺陷（字面量钩子分派按第 21 条单独建边）。
13. **iframe 动态 src 无法静态追踪**：只采集静态 `<iframe src>` 与 `window.open/ShowHISUIWindow` 字面量；`$('#frame').attr('src', url)` 由函数链路体现，不落到 `frames`。
14. **页面可被多脚本绑定**：同一 selector 多个绑定取**最后加载**的脚本（与浏览器覆盖语义一致），原始绑定全部保留在 `front_js_index.jsonl`。
15. **菜单是可选输入**：未导入 `menu_snapshot.json` 时页面角色大多为 `unclassified`，不影响「元素→方法→请求」链路；不要把角色缺失当成构建失败。
16. **确定性输出**：所有 JSONL 按文件/页面/行排序，JSON 使用 `sort_keys`；同一源码重建应逐字节一致（除 `meta.generated_at`）。
17. **`new X()` 不是业务调用**：`new Event('storage')`、`new Date()` 等构造表达式曾按同名函数解析到其他模块（`Event` → `assessConfig.js`），产生 2,700+ 条跨页面假链路。词法阶段必须跳过前导 `new`。
18. **页面「链路」计数包含页面加载**：`chain_count = 操作元素链路 + 页面加载链路`，查询页面时两者都会列出。
19. **括号配对缓存不能只用 `id(tokens)` 做 key**：旧 token 列表释放后 id 会被下一个文件复用，复用到其他文件的配对表会导致函数/元素计数漂移；缓存需持有 tokens 强引用。
20. **正则字面量必须在词法阶段整体吞掉**：`/\\'/g`、`/"/g` 这类带引号或反斜杠的正则若交给字符串规则处理，会从引号处一路吞到后文，破坏括号配对；`_find_matching` 返回 EOF 后整个文件尾部（函数、事件绑定、请求）会被静默丢弃。表现为「某文件索引停在中途、后半段的方法查不到」，2026-11-05 曾因此漏掉 477 个文件的尾部（约 2.3 万个函数）。`js_tokens.tokenize()` 遇到 `/` 且上一 token 允许正则时调用 `_scan_regex()` 整段消费；改动词法层后必须用 `audit_front_coverage.py` 对比函数总数与 handler 解析率。
21. **动态分派要单独建边**：`*_Common_ControlObj.BeforeUpdate("X")` / `AfterUpdate` / `BeforeStop` / `AfterStop` / `AfterAdd` / `Interface` 的字符串实参由 `eval("BeforeUpdateFuncs."+f)` 等注册表消费，普通调用边到 `BeforeUpdate` 就断了。`js_scan.py` 为字面量首参生成 `@dispatch:<Registry>.<key>` 边；`build_front_chain_db.py` 按页面脚本作用域优先解析，其次全局唯一后缀（插件脚本是运行时注入，页面 `<script src>` 里没有）。首参不是字面量（变量、`this.xxx`）时不建边。
22. **常量回填必须按词法作用域**：同名 `url` 在多个函数里各有一份，按「本函数 → 外层 → 文件顶层」就近取，取不到就放弃；旧实现回退 `consts[0]` 会把 `checkOrderLock` 的请求错误解析成 `OpenSelectDia` 的弹窗地址。跨文件只回填限定名（`UrlList.orderLock`）且限定在页面脚本集合内，裸变量不跨文件。
23. **三元表达式按字符串权重取分支**：`'undefined'==typeof(appExamPath) ? fallback : appExamPath + "/real/path"` 取字面量更长的分支；权重相等时（如 `PAAdmType=="I" ? "ipcare" : "opcare"`）保留两个分支（term 类型 `x`），构建阶段按页面所属模块（`opcare`/`ipcare`）选择。
24. **弹窗地址必须与现存页面集合比对**：弹窗相对地址按 `base/` 解析（`../opcare/x.html` → `opcare/x.html`），配置下发跳转按页面所在目录解析，绝对路径去掉 `/static/` 前缀；逐个候选与页面集合比对，不命中的按 `runtime` / `non_page` / `unresolved` 分类计数。不要直接把 `normpath` 结果当页面键——`../` 残留会被误当成合法页面。落地兜底按「尾段唯一 → 首段不同其余一致唯一 → 同目录单字符差异唯一 → 同名唯一」逐级放宽，多义一律放弃；`unresolved` 应只剩工程内确实不存在的页面（2026-11-05 全量修复后 734 → 17）。
25. **页面加载只认页面自己的初始化脚本**：共享 IIFE/回调里的弹窗方法会挂到 `__top_level__`，若据此建「页面加载即弹窗」边，`bill.acct.groupacct` 等约 100 个页面会被误连到 `bill.checkout.html`。构建时跳过 `fn["qualified"] == "__top_level__"` 的 page-load opens；元素级弹窗不受影响（页面关系 1,115→982，地址归一化后 1,027）。
26. **箭头函数/函数声明里的局部 URL 常量要单独扫**：主循环只捕获对象字面量方法体里的 `let url = ...`，`showPersonList` 这类箭头函数内的常量会漏掉，弹窗和请求都落不了地。`_scan_body_constants()` 对所有 def 体补扫赋值（去重，跳过含函数的 RHS）；加上后请求 9,795→13,010、链路 31,334→53,458。
27. **页面打开 API 的实参形态各不相同**：`ShowHISUIWindow` 的 URL 在第 2 个实参或对象实参的 `src`/`url`；`websys_showModal` 的 `"close"`/`"options"` 是命令字符串、不是地址；`window.open` 只认 `window/globalThis/top.open`，普通 `.open(...)` 不算。漏掉任一形态会整类弹窗缺失。
28. **远端边界**：本 skill 只读前端源码与可选只读查询 Kingbase，不触发编译、上传、发布或数据库写入。
29. **形参/局部变量同名的裸调用不是全局函数**：`card.common.control.js::Init` 里的 `CallBackFun(rtnObj)` 是 `argObj.CallBackFun` 局部变量，却按全局名解析到 `patchecklev.hisui.js::CallBackFun`，造出 355 条跨页假边。`js_scan.py` 为每个 def 记录 `params` 与函数体内 `var/let/const` 名（`_locals_for_body`），裸调用命中即丢弃；`CallBackFun` 入边 363→0。
30. **第三方库不参与业务链路**：pdf.js 内部的 `call()` 命中业务文件里的 `call` 函数（pdfview 等页 42 条假链路）。`iter_front_files` 跳过 `pdfjs*` 目录与 `babel-polyfill*`；全量函数 197,908→188,414、假 `call` 节点消失。排除后仍保留页面自己的 `pdfview.js` / `FS.PDFView.Util.js` 链路。
31. **成员调用不能回退到裸全局名**：`dg.datagrid(...)` 曾解析到 `common.dict.js::datagrid`（3,560 条入边）。`_resolve_call` 对 member 的裸方法名只认同文件唯一定义；`Obj.method` 先按命名空间后缀唯一匹配，再用「定义文件确实声明了该顶层变量」守卫的 2 段回退（兼容 `var X=(function(){...return{"GetAccInfo":GetAccInfo}})()`）。
32. **命名空间扩展要扫对象字面量实参**：`BILL_INF.apply(BILL_INF,{ showCheckout(){...} })` 的方法体若不算独立 def，内部调用会挂到 `__top_level__`，产生支付弹窗假链路。`_scan_namespace_extends()` 识别 `X.apply/X.extend/Object.assign(X,{...})` 并把方法登记为 `X.method`。
33. **工具方法按「方法 + 归属文件」双重判定**：只看方法名（`init`/`get`/`save`）会误杀业务初始化与保存；只看文件名会误杀 `common.js` 里的业务公共逻辑。当前 822 个工具方法被标记 `category=utility` 并在 GraphML 中排除（`loader_script` 占 241 个节点、`common_component` 134 个），业务入度 Top 均为读卡、医嘱、挂号、结算等真实枢纽。`front_chains.jsonl` 保留含工具节点的完整路径，作为原始证据。
34. **初始化里注册的回调仍按页面加载计入**：`card.common.control.js::Init` 通过 `marybtnbar({onClick: ...})` 注册读卡回调，回调里的 `GetAccInfo` 会让「页面加载 → 读卡接口 / 选择卡类型」成立，实际要用户点读卡按钮。当前保留这类链路以维持弹窗可达性（`doc.cardtypelist.html` 的 153 条入边里 90 条来自此路径），查询时应结合 `source=page_load` 与调用路径中的 `Init` 判断是否真在加载时执行；如需严格区分，后续可把对象字面量回调登记为匿名 handler 节点。
35. **包装器绑定必须解包首参**：`DocToolsHUI.btn.throttle(function(){...})`、`debounce(fn, 300)` 按旧逻辑「以 `)` 结尾的调用无法解析」直接丢弃，元素就没有 handler。`js_scan.py::_unwrap_handler_call` 取调用的第一个实参：函数表达式 / 箭头函数登记为 `__handler_<n>`，限定名原样使用；只在 callee 是 `throttle/debounce/proxy/wrap` 或调用带多个实参时才解包，避免把 `loadTable("1")` 的工厂实参误当 handler。改后 11 个空 handler 解出 10 个。
36. **`csp-include` 片段不是独立页面**：片段 HTML 没有 `<script>`，元素按页面归属会变成孤立元素——`doc.opregistmain.html` 的「更新/保存」等按钮在旧索引里完全查不到链路，挂号改造影响面因此评估偏小。构建时按 `includes` 建「包含」边，把片段闭包（≤3 层、去环）的元素并入父页面，事件绑定 / 配置分组 / 页面加载改用「自身脚本 + 片段脚本」的有效脚本列表；片段元素保留 `origin_page`（`doc.opregistmain` 合并后元素 16→137、链路 174→288）。`includes` 里可能混有 `CustomObj.InPageFlag` 这类非页面引用，构建时按页面集合过滤，不建边；不要给片段单独建页面节点，那会把同一按钮算两次。
37. **把函数当实参传出的链路要建回调边**：`ShowChangeCookType("ChangeCookTypeWin", DoExchange, prescNo)`（`msup/herb/scripts/ipdisp.js`）只把 `DoExchange` 当引用传出，请求写在 `DoExchange` 体内，普通调用边到 `ShowChangeCookType` 就断了——药房 ipdisp / opdisp / batchexecute 三页的煎药转换请求因此查不到。`js_scan.py::_callback_args` 对每个调用点收集「单 token 标识符实参」，`_export_functions` 只保留同名于本文件声明、且不是本函数形参/局部的名字，写入 `functions[].callbacks`；`build_front_chain_db.py::resolve_callbacks()` 用成员调用口径（同文件唯一定义）解析成 `callback_targets` 与 `callback_edges`。探索分两阶段：阶段一保持原 BFS 结果不变，阶段二用独立预算把回调目标可达的请求/弹窗追加在后——把回调并入主 BFS 会挤占 `max_requests`，实测丢 33 条既有链路（emtr `__page_load__` 卡请求、ipcare `Add_Order_btn` 医嘱保存）。两阶段方案重建后链路 30,386→33,172、页面 94→100，原链路零丢失。`chains[].path[]` 与 `uiEntries[].jsPath` 的回调步标 `kind="callback"`。重建后必须做「新旧链路三元组差集」比对，确认新增只来自回调目标。
