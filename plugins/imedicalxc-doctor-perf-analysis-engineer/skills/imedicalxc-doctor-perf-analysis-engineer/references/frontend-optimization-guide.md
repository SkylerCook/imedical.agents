# 模式 C：前端性能优化

## 核心原则

1. **先定位瓶颈再做优化** — 通过浏览器 DevTools 的 Network/Performance/Memory 面板定位根因，不靠猜测。
2. **前端优化不能脱离后端** — 前端慢的根因可能在后端接口（响应慢、返回数据量过大、N+1），先排除后端问题再优化前端。
3. **JS/HTML/CSS 通用原则** — 所有优化策略不依赖特定前端框架（Vue/React），适用于原生 JS + HTML + CSS。
4. **改动最小化** — 只优化"慢在哪"，不改"功能逻辑"。返回值、交互行为均不变。

## 诊断流程

```
用户反馈"页面慢/卡"
    │
    ├── 0. 优先用 MCP 自动化诊断（见第五章）
    │     ├── take_snapshot → 理解页面结构、iframe 嵌套、用户上下文
    │     ├── list_network_requests → 接口耗时、重复请求、N+1 模式
    │     └── list_console_messages → JS 报错定位
    │
    ├── 1. （备选）打开 Chrome DevTools → Network 面板
    │     ├── 看 waterfall：哪个请求耗时最长？
    │     ├── 看 DOMContentLoaded / Load 时间
    │     └── 判断是"接口慢"还是"资源加载慢"
    │
    ├── 2. 判断根因归属
    │     ├── 接口响应 > 1s → 转后端优化（见 optimization-guide.md）
    │     ├── 接口数据量过大（单次返回 > 1000 条） → 后端加分页 + 前端减少渲染量
    │     ├── JS 文件 > 500KB → 资源加载优化（策略 1~3）
    │     ├── 页面 DOM 节点 > 5000 → 渲染优化（策略 4~7）
    │     └── 页面卡顿/内存涨 → 运行时优化（策略 8~12）
    │
    └── 3. （备选）打开 Performance 面板录制操作过程
          ├── 看 Scripting（黄色）：JS 执行耗时
          ├── 看 Rendering（紫色）：重排/重绘耗时
          └── 看 Painting（绿色）：绘制耗时
```

---

## 一、页面加载优化

### 策略 1：减少 JS/CSS 文件体积

**问题特征**：Network 面板中单个 JS 文件 > 500KB，或 CSS 文件 > 100KB。

**优化方法**：

```
// 排查哪些文件最大
// Chrome DevTools → Network → 按 Size 排序 → 找到大文件

常见原因：
1. 未压缩 — 检查服务器是否开启 gzip（Response Headers 中应有 Content-Encoding: gzip）
2. 未去除注释/空格 — 检查 minify 是否生效
3. 引入了不需要的大型库 — 搜索代码中是否实际使用
```

**检查清单**：
- [ ] 服务器 Nginx 开启 `gzip on; gzip_types application/javascript text/css;`
- [ ] JS/CSS 文件经过 minify（文件名不含 `.min` 则可能未压缩）
- [ ] 排查是否有未使用的 npm 包仍被打包
- [ ] 确认 sourceMap 在生产环境已关闭（`devtool: false` 或不在生产配置中）

### 策略 2：减少 HTTP 请求数量

**问题特征**：Network 面板显示首屏请求数 > 30 个。

**优化方法**：

| 问题 | 表现 | 解决方法 |
|------|------|----------|
| 小图标/图片过多 | 大量 < 2KB 的图片请求 | 合并为雪碧图（sprite）或转为 Base64 内联 |
| CSS 文件拆太碎 | 5+ 个 CSS 文件 | 合并为一个 CSS 文件 |
| JS 文件未合并 | 10+ 个 script 标签 | 合并打包，减少 script 标签数量 |
| 字体文件请求多 | 多个 font 文件 | 确认只加载实际使用的字体格式（优先 WOFF2） |

### 策略 3：资源加载顺序优化

**问题特征**：首屏渲染需要等底部的大 JS 文件加载完成。

**优化方法**：

```html
<!-- CSS 放 <head>，JS 放 </body> 前 -->
<head>
  <link rel="stylesheet" href="critical.css">  <!-- 关键 CSS 优先 -->
</head>
<body>
  <!-- 页面内容 -->
  <script src="app.js"></script>              <!-- JS 放最后 -->
</body>

<!-- 非关键资源异步加载 -->
<script src="analytics.js" async></script>     <!-- 异步执行，不阻塞 -->
<script src="chart.js" defer></script>         <!-- 延迟到 HTML 解析完成后执行 -->
```

**关键区分**：
- `async`：下载完立即执行，执行顺序不保证，适合独立脚本（统计、监控）
- `defer`：HTML 解析完后按顺序执行，适合依赖 DOM 的业务脚本

---

## 二、页面渲染优化

### 策略 4：减少 DOM 操作频次（批量 DOM 更新）

**问题特征**：Performance 面板录制后，Scripting（黄色）占比 > 30%，且集中在 DOM 操作。

```js
// 优化前：循环内逐条 appendChild → 每次触发重排
for (let i = 0; i < data.length; i++) {
  const row = document.createElement('tr')
  row.innerHTML = '<td>' + data[i].name + '</td>'
  tableBody.appendChild(row)  // ← N 次重排
}

// 优化后：构建 HTML 字符串一次性插入，或 DocumentFragment 批量 append
let html = ''
for (let i = 0; i < data.length; i++) html += '<tr><td>' + data[i].name + '</td></tr>'
tableBody.innerHTML = html  // ← 仅 1 次重排
```

### 策略 5：减少重排（Reflow）和重绘（Repaint）

**问题特征**：Performance 面板中 Rendering（紫色）占比 > 20%。

```js
// 优化前：读写交叉 → 每次读触发强制同步重排
for (let i = 0; i < rows.length; i++) {
  rows[i].style.width = '100px'
  const h = rows[i].offsetHeight       // 写后读 → 强制重排！
  rows[i].style.height = h + 10 + 'px'
}

// 优化后：先批量读，再批量写
const heights = rows.map(r => r.offsetHeight)  // 批量读
rows.forEach((r, i) => { r.style.width = '100px'; r.style.height = heights[i] + 10 + 'px' })
```

**通用原则**：
- 避免在循环中读写交叉操作 offsetHeight/offsetWidth/scrollTop 等会触发重排的属性
- 动画元素使用 `position: fixed/absolute`，脱离文档流，不影响其他元素
- 批量修改样式时用 `cssText` 一次性设置，或先 `display: none` → 修改 → 恢复显示

### 策略 6：大数据量列表 / 表格按需渲染

**问题特征**：列表/表格数据 > 500 条时页面明显卡顿，DOM 节点 > 3000。

**常见于 HIS 场景**：医嘱列表、患者列表、收费明细等。

```js
// 方案 A（推荐）：后端分页，接口加 pageSize + pageNum
// 方案 B：前端分页，仅渲染当前页 slice(start, start + pageSize)
// 方案 C：虚拟滚动，仅渲染可视区 ± 缓冲区，可视起始 = scrollTop / 行高
```

**选择**：< 200 条直接渲染，200~2000 后端分页，> 2000 + 需滚动体验 → 虚拟滚动

### 策略 7：高频事件防抖节流

**问题特征**：搜索输入框、resize、scroll 触发过于频繁，导致卡顿。

```js
// 防抖：最后一次触发后延迟执行，适合搜索输入
input.addEventListener('input', debounce(handleSearch, 300))

// 节流：固定间隔执行一次，适合 scroll/resize
window.addEventListener('scroll', throttle(handleScroll, 100))

// HIS 项目内置：$.hisui.debounce(fn, delay)
```

---

## 三、请求后端优化

### 策略 8：前端侧 N+1 请求合并

**问题特征**：Network 面板中短时间内对同一后端接口发起大量请求（如 50+ 次），每次仅参数不同。

这与后端 N+1 是对称的——前端循环内多次调用后端接口：

```js
// 优化前：循环内逐条请求 → N 次 HTTP 往返
for (let i = 0; i < ids.length; i++) {
  const result = await $.ajax({ url: '/api/getDetail', data: { id: ids[i] } })
  results.push(result)
}

// 优化后：一次批量请求
const results = await $.ajax({
  url: '/api/getDetailBatch',
  data: { ids: ids.join(',') }
})
// 如果后端没有批量接口 → 需要后端配合新增（转入 optimization-guide.md 策略1）
```

**诊断方法**：
1. Chrome DevTools → Network → 筛选 XHR/Fetch
2. 看同一 URL 是否短时间内被调多次
3. 确认是前端循环还是后端 N+1（看发起方：前端 → JS 调用栈；后端 → Graylog 日志）

#### 8.1 多个后端调用合并为一个聚合接口

**问题特征**：前端一个用户操作（如点击/勾选）触发了多个不同的后端 API 调用，每个都是一次 HTTP 往返。如果这几个调用之间没有先后依赖，可以合并为一个聚合接口。

**真实案例**（来自处方关联诊断分析）：

```js
// 用户勾选一个处方 → 触发 2 个后端调用
onSelect: function (rowIndex, rowData) {
    loadOrderList();   // → POST /findPrseOrderList   查询处方医嘱明细
    setDiagselect();   // → POST /getDia              查询处方的诊断关联
}
```

两次 HTTP 往返 = 2 × (DNS + TCP + TTFB + 下载)。如果后端新增一个聚合接口：

```
POST /getPrseOrderAndDiag  → 一次返回 { orderList: [...], diagList: [...] }
```

网络往返从 2 次降为 1 次。

**诊断方法**：

```
用户一个操作触发了哪些后端调用？
    │
    ├── Network 面板筛选 XHR/Fetch，看同一秒内发起了几个请求
    │
    ├── 判断是否有先后依赖
    │     调用 B 的参数来自调用 A 的返回值 → 不能合并（串行依赖）
    │     调用 B 的参数在调用 A 之前已确定 → 可以合并
    │
    └── 可以合并 → 建议后端新增聚合接口，前端改为一次调用
```

**判定**：

| 场景 | 结论 |
|------|------|
| 调用间有串行依赖（B 依赖 A 的返回值） | ❌ 不能合并 |
| 数据量大的接口（列表/明细/业务数据） | ❌ 不合并 — 合并后接口职责模糊，数据格式各异难以统一 |
| 小数据量 + 配置类（字典/开关/权限/参数） 2+ 个调用 | ⚠️ 可以合并 — 一次返回 kv 或分组配置对象 |
| 2 个调用，总耗时 < 100ms | ✅ 无需合并 |

**为什么数据量大的不合并**：
- 列表/明细接口返回数据差异大（表格行 vs 树节点 vs 统计），强行合并返回格式混乱
- 合并后后端接口职责模糊，出问题时定位困难
- 大接口 + 小接口合并 → 大接口慢会把小接口也拖慢

> 与策略 8 的区别：策略 8 是**同一接口循环调多次**（N+1），8.1 是**不同接口各调一次但可以合并**（1+1→1），且仅限小数据量配置接口。

### 策略 9：消除重复请求

**问题特征**：Network 面板中同一 URL + 同一参数被请求 2+ 次。

```js
// 方法：Promise 去重 — 同一请求在进行中时复用同一个 Promise
const pending = new Map()
function fetchDedup(url, params) {
  const key = url + JSON.stringify(params)
  if (pending.has(key)) return pending.get(key)
  const p = $.ajax({ url, data: params }).finally(() => pending.delete(key))
  pending.set(key, p)
  return p
}
```

### 策略 10：不必要的数据不在首屏加载

**问题特征**：Network 面板显示接口返回了大量数据（> 500 条或 JSON > 500KB），但首屏只展示了部分。

**常见于 HIS 场景**：
- 下拉框选项加载了几千条科室/药品数据
- 图表数据接口返回了几个月的明细，但首屏只显示当天汇总
- 表格一次性加载全量数据，但分页展示

```js
// 优化前：一次性加载全部数据
const allData = await $.ajax({ url: '/api/getAllPatients' })  // 返回 5000 条

// 优化后：按需分页加载
const pageData = await $.ajax({ url: '/api/getPatients', data: { pageSize: 50, pageNum: 1 } })

// 字典数据：首次加载后存 localStorage，1 小时内有效
function getDictData(dictType) {
  const key = 'dict_' + dictType, cached = localStorage.getItem(key)
  if (cached) {
    const { data, ts } = JSON.parse(cached)
    if (Date.now() - ts < 3600000) return Promise.resolve(data)
  }
  return $.ajax({ url: '/api/dict/' + dictType }).then(res => {
    localStorage.setItem(key, JSON.stringify({ data: res, ts: Date.now() }))
    return res
  })
}
```

### 策略 11：请求超时与错误重试

**问题特征**：某个接口偶发超时，页面卡住无响应，用户反复刷新。

```js
// 设置请求超时
$.ajax({ url: '/api/slowQuery', timeout: 15000, data: params })

// 带退避的重试（最多重试 2 次，间隔 1s → 2s）
async function fetchWithRetry(url, params, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try { return await $.ajax({ url, data: params, timeout: 10000 }) }
    catch (err) { if (i === retries) throw err; await sleep(1000 * (i + 1)) }
  }
}
```

---

## 四、代码错误与内存管理

### 策略 12：定时器与事件监听器的生命周期管理

**问题特征**：
- 离开页面后 CPU 使用率不降
- Memory 面板录制 → 页面切换后堆内存不释放（计时器持有引用）
- Performance 面板录制 → 页面已不在前台但仍有定时任务执行

```js
// 优化前：setInterval 离开页面后仍在跑 → 内存泄漏
setInterval(refreshPatientList, 10000)

// 优化后：记录 ID，离开时清理；visibility 变化时暂停/恢复
var timers = []
function startPolling() { timers.push(setInterval(refreshPatientList, 10000)) }
function stopPolling() { timers.forEach(clearInterval); timers = [] }
window.addEventListener('beforeunload', stopPolling)
document.addEventListener('visibilitychange', function () {
  document.hidden ? stopPolling() : startPolling()
})
```

### 策略 13：事件监听器累积

**问题特征**：同一个按钮点击后触发的函数执行次数越来越多（监听器重复绑定）。

```js
// 错误：每次 initPage 都多绑一次事件
function initPage() {
  $('#saveBtn').on('click', handleSave)
}

// 修正：先解绑再绑定，或用事件委托只绑一次
$('#saveBtn').off('click').on('click', handleSave)
// 或：$(document).on('click', '#saveBtn', handleSave)
```

### 策略 14：全局变量污染与闭包泄漏

**问题特征**：Memory 面板中 Detached DOM 树数量持续增长。

```js
// 错误 1：全局变量持有大对象引用，离开页面后不解绑
window.globalData = hugeDataList  // → let currentPageData = hugeDataList; 用完置 null

// 错误 2：闭包持有不需要的大数据引用
function createHandler() {
  const bigData = loadBigData()
  return function () { console.log('handler called') }  // bigData 被闭包持有，无法 GC
}
// → 只保留需要的部分：const needed = loadBigData().summary
```

### 策略 15：错误边界与异常处理

**问题特征**：单个 JS 报错导致整个页面功能失效（空白页、按钮无反应）。

```js
// 关键初始化包裹 try-catch，避免单点错误导致白屏
try { initPage() } catch (err) { console.error('页面初始化失败:', err.message) }

// AJAX 统一错误处理
$(document).ajaxError(function (event, xhr) {
  if (xhr.status === 401) window.location.href = '/login'
  else if (xhr.status >= 500) showToast('服务器异常')
})

// 全局 JS 错误上报
window.onerror = function (msg, src, line, col, err) {
  sendErrorReport({ msg, src, line, stack: err && err.stack })
}
```

### 策略 16：控制台调试代码移除

**问题特征**：生产环境存在大量 `console.log` 输出，影响性能并泄漏数据。

```js
// 开发环境保留，生产环境移除
// 方法 1：使用 webpack terser 插件配置 drop_console: true（打包时自动移除）

// 方法 2：运行时覆盖
if (window.location.hostname !== 'localhost') {
  console.log = function () {}
  console.debug = function () {}
}
```

---

## 五、Chrome DevTools MCP 自动化页面分析

当浏览器已打开目标页面时，优先使用 MCP 工具进行自动化诊断，效率远高于手动点选 DevTools 面板。

### MCP 工具速查

| 工具 | 用途 | 典型调用 |
|------|------|----------|
| `take_snapshot` | 获取页面 a11y 树完整结构（替代手动审查元素） | `take_snapshot(verbose=true)` |
| `take_screenshot` | 截取页面全貌 | `take_screenshot(fullPage=true)` |
| `list_network_requests` | 列出所有网络请求（替代手动翻 Network 面板） | `list_network_requests(resourceTypes=["xhr","fetch"])` |
| `list_console_messages` | 收集控制台错误/警告 | `list_console_messages()` |
| `evaluate_script` | 在页面执行 JS 获取运行时数据 | `evaluate_script(function="()=>{return document.title}")` |
| `performance_start_trace` | 录制性能 Trace | `performance_start_trace(reload=true)` |
| `performance_stop_trace` | 停止录制并获取分析结果 | `performance_stop_trace()` |
| `performance_analyze_insight` | 深入分析某个性能 Insight | 分析 LCP/INP/CLS 等指标 |

### 标准分析流程

```
浏览器已打开目标页面
    │
    ├── 1. take_snapshot(verbose=true) → 理解页面结构
    │     ├── 识别页面标题、当前用户/角色（HIS 系统关键上下文）
    │     ├── 发现 iframe 嵌套层级（每层 iframe 是一个独立 RootWebArea）
    │     ├── 统计按钮、表单、表格等交互元素数量和类型
    │     └── 发现数据异常（如重复记录、异常数值）
    │
    ├── 2. list_network_requests → 诊断接口调用
    │     ├── 筛选 XHR/Fetch 请求，看接口数量、响应时间
    │     ├── 识别重复请求（同 URL + 同参数多次调用 → 策略 9）
    │     ├── 识别 N+1 模式（同接口短时间内大量调用 → 策略 8）
    │     └── 看未压缩大文件（JS > 500KB, JSON > 200KB → 策略 1/10）
    │
    ├── 3. list_console_messages → 排查 JS 报错
    │     ├── 红色 error → 可能导致功能失效
    │     └── 黄色 warn → 可能预示即将失效
    │
    ├── 4. take_screenshot(fullPage=true) → 视觉确认
    │     └── 对照快照理解页面布局、空白区域、溢出等问题
    │
    └── 5.（可选）evaluate_script → 提取运行时数据
          ├── DOM 节点数: document.querySelectorAll('*').length
          ├── 表格行数: document.querySelectorAll('table tr').length
          ├── iframe 数量: document.querySelectorAll('iframe').length
          └── 全局变量数: Object.keys(window).length
```

### 结合代码分析的关键步骤

MCP 分析完成后，必须结合代码确认：

1. **从快照提取 URL 定位源码**：
   - 外层页面 URL → 前端路由 → Vue/React 组件文件
   - iframe src → 对应模块的 HTML 模板文件
   - 图片/资源 URL → assets 目录位置

2. **从接口调用定位后端**：
   - Network 面板中的 API 路径 → Controller 映射
   - 请求参数格式 → DTO 类定义

3. **页面结构对比代码**：
   - 快照中的组件层级 → 代码中的组件嵌套关系
   - 识别哪些是前端渲染、哪些是后端模板生成

### HIS 系统特殊注意事项

- **iframe 嵌套**：HIS 页面常见 2-3 层 iframe，每层有独立 document，`take_snapshot` 会自动展开
- **患者上下文**：页面标题含当前患者/医生/科室信息，是性能分析的关键上下文
- **菜单来自后端**：菜单结构是后端权限接口返回的，不是前端硬编码
- **混合架构**：部分页面是 Vue SPA，部分页面是后端 JSP/HTML 模板，分析前需确认

### 示例：一次完整的 MCP 分析记录

```
目标页面: http://localhost:8090/imedical/his/hos/welcome
分析时间: 2026-06-04

1. take_snapshot 发现:
   - 系统: 标准版数字化医院[总院]
   - 用户: 医生01, 内分泌科门诊
   - 三层架构: GlobleLayout.vue → TabLayout.vue → iframe(CF框架) → iframe(患者列表)
   - 患者列表: 待就诊7人, 全部11人
   - 功能入口: 诊断录入、门诊病历、医嘱录入、草药录入、总览&打印、完成接诊

2. list_network_requests 发现:
   - 无异常 XHR/Fetch 请求（页面加载后无自动轮询）

3. list_console_messages 发现:
   - 无控制台报错

4. 代码定位:
   - 外层: hisfront/static/an/src/sys/hos-app-base/
   - CF框架: hispa/cf/html/doc.main.framework.html
   - 患者列表: opcare/adm/html/doc.receive.patient.list.html

5. 结论:
   - 页面架构清晰，无性能问题
   - iframe 嵌套层级较深，跨层通信依赖 postMessage
```

## 六、性能诊断工具速查（手动方式）

备用手动工具，当 MCP 不可用或需要精细操作时使用：

| 工具 | 快捷键 | 用途 |
|------|--------|------|
| Network | F12 → Network | 分析资源加载、接口耗时、请求数量 |
| Performance | F12 → Performance | 录制操作过程，分析 JS/Rendering/Painting 占比 |
| Memory | F12 → Memory | 拍堆快照，对比内存增长，定位泄漏 |
| Lighthouse | F12 → Lighthouse | 自动评分，给出优化建议 |
| Coverage | F12 → Ctrl+Shift+P → Coverage | 分析未使用的 JS/CSS 代码比例 |

### Network 面板关键指标

```
Waterfall 各阶段含义：
  Queueing      — 浏览器等待（并发限制）
  Stalled       — 请求排队
  DNS Lookup    — DNS 解析
  Initial connection — TCP 握手 + SSL
  Request sent  — 发送请求
  Waiting (TTFB) — 等待服务器响应（> 500ms 说明后端慢）
  Content Download — 下载响应体（> 200ms 说明响应数据大）
```

---

## 七、前端-后端联合诊断

### 判定流程

```
页面慢/卡
    │
    ├── Network → Waiting(TTFB) > 500ms → 后端接口慢
    │     └── 转 optimization-guide.md + diagnosis-workflow.md
    │
    ├── Network → Content Download > 200ms → 后端返回数据量过大
    │     └── 后端：加分页/精简字段 + 前端：减少渲染量
    │
    ├── Network → 同一接口短时间 N 次请求 → N+1
    │     ├── 请求由前端 JS 循环发起 → 前端策略8
    │     └── 请求由后端 Feign/DAO 循环发起 → 后端策略1/2
    │
    ├── Performance → Scripting > 30% → JS 执行慢
    │     ├── DOM 操作密集 → 策略4/5
    │     └── 数据处理逻辑重 → 策略7（防抖节流）/ Web Worker
    │
    └── Performance → Rendering > 20% → 渲染慢
          ├── DOM 节点过多 → 策略6（按需渲染）
          └── CSS 复杂 → 简化选择器 / 减少阴影滤镜
```

### 典型慢页面分析顺序

1. **Network 面板** → 确认不是后端接口慢（TTFB < 500ms）
2. **Network 面板** → 看接口返回数据量（Content Download < 200ms，JSON < 200KB）
3. **Performance 面板** → 录制页面加载/操作过程，看 Scripting/Rendering 占比
4. **Memory 面板** → 如果怀疑内存问题，拍两个快照对比
5. **确定根因归属** → 前端问题用本文档，后端问题转 optimization-guide.md

---

## 八、JS 代码重构安全实践

> **真实案例**：将 `opdoc.treatprint.js` 中 15 个全局变量封装到 `serverObj` 命名空间时，用 `replace_all` 批量替换，引出 7 类问题（含 2 个运行时故障）。核心教训：**文本替换不理解代码语义，会匹配任何位置的子串，包括字符串字面量**。

### 误伤类型速查表（按破坏性排序）

| # | 误伤类型 | 错误示例 | 正确写法 | 语法报错 | 运行时故障 |
|---|---------|---------|---------|---------|-----------|
| 1 | **jQuery 选择器字符串** | `$("#serverObj.rightSegmentPanel")` | `$("#rightSegmentPanel")` | ❌ 无 | ✅ 页面白屏 |
| 2 | 对象字面量 key | `{ serverObj.orderPrescNo: val }` | `{ orderPrescNo: val }` | ❌ 无 | ✅ 参数错乱 |
| 3 | `var/let/const` 声明 | `var serverObj.treeData = []` | `var treeData = []` | ✅ `Unexpected token '.'` | - |
| 4 | 函数参数名 | `function foo(serverObj.orderPrescNo)` | `function foo(orderPrescNo)` | ✅ `Unexpected token '.'` | - |
| 5 | 函数名子串匹配 | `function indexserverObj.OETableConfig` | `function indexOETableConfig` | ✅ `Unexpected token '.'` | - |
| 6 | 变量名子串匹配 | `let checkserverObj.htmlStrFlag` | `let checkHtmlStrFlag` | ✅ `Unexpected token '.'` | - |
| 7 | 日志/字符串中的文本 | `console.log("serverObj.htmlStrFlag :")` | `console.log("htmlStrFlag :")` | ❌ 无 | ❌ 无害（仅文本） |

**关键发现**：类型 1 和 2 **语法检查无法发现**（`node -c` 通过），但会导致严重的运行时故障。类型 1 尤其危险——变量名若恰好与 DOM `id` 同名（如 `rightSegmentPanel` → `<div id="rightSegmentPanel">`），选择器静默失效，后续所有 DOM 操作在空 jQuery 对象上执行，页面看似正常但实际无内容。

### 安全做法

**方案 A（推荐）**：用正则词边界批量替换
```bash
# 用 sed 做词边界替换，避免子串误伤
# \b 保证替换的是完整标识符，不会匹配 myVarArr 中的 myVar
sed -i 's/\boldVar\b/newObj.oldVar/g' file.js
```
但 `\b` 仍有局限：`_`、`$` 视为词内字符。替换后仍需验证。

**方案 B（最安全但慢）**：逐个 `Edit` 替换，每次人工确认上下文。

**方案 C（折中）**：`replace_all` 后立即运行完整验证流程。

### 替换后验证流程（必须全部通过）

```bash
# 1. 语法检查（能发现类型 3~6）
node -c file.js

# 2. 检查选择器字符串被误伤（发现类型 1）—— 最重要！
grep -n '\$([^)]*"[^"]*\.' file.js | grep -v '\.js\|\.html\|\.css'
# 解读：$() 内的字符串中含点号 → 大概率是误替换的选择器

# 3. 检查对象 key 被误伤（发现类型 2）
grep -n '^\s*[a-zA-Z_]\+\.\w\+:' file.js
# 解读：行首缩进后出现 xxx.yyy: 模式 → 可能是 key 被替换

# 4. 检查 var/let/const 残留
grep -n '\b(var|let|const)\s\+\w\+\.' file.js

# 5. 检查函数签名残留
grep -n 'function\s\+\w*\.\w*\(' file.js

# 6. 检查原始全局变量名是否还有残留（可能遗漏未替换的）
grep -n '\boldVarName\b' file.js
```

### 验证清单

- [ ] `node -c` 语法检查通过
- [ ] 选择器无新点号（`grep '\$([^)]*"[^"]*\.'` 无异常）
- [ ] `var/let/const` 无 `xxx.yyy` 模式
- [ ] `function` 无 `xxx.yyy(` 模式（函数名/参数被误伤）
- [ ] 原始全局变量名 0 处残留

### 事件回调守卫陷阱

| 陷阱 | 表现 | 案例 | 修复 |
|------|------|------|------|
| 守卫变量在异步回调前被重置 | 级联触发（如勾选一行导致所有行被勾选） | `selRowIndex` 循环后立即重置，`checkRow` 异步触发时守卫已失效 | 布尔锁 + 先收集索引再批量操作 |
| 守卫条件包含永远 truthy 的子条件 | 守卫永远触发，联动逻辑完全跳过 | `if (selRowIndex !== "" \|\| OEItemID)` 中 `OEItemID` 总是有值 | 只保留防递归判断，移除冗余条件 |

**教训**：修 condition bug 时要验证整套守卫机制——不仅条件对不对，还要确认锁的时序在同步/异步下都正确。

---

## 九、常见 JS 逻辑缺陷模式

### 模式 1：事件回调重复初始化插件

每次回调重建插件（DOM + 事件），但插件已内置触发机制。

```js
// 优化前：每次 mouseover 重建 webuiPopover
$(el).webuiPopover({ trigger: 'hover', ... }); $(el).webuiPopover('show');
// 优化后：首次标记跳过，内置 trigger: 'hover' 自动接管
if ($(el).data('popover-inited')) return;
$(el).webuiPopover({ trigger: 'hover', ... }).data('popover-inited', true).webuiPopover('show');
```

### 模式 2：循环内重复 DOM 查询

循环不改变 DOM 状态 → 查询提到循环外。

```js
// 优化前：do { let nodes = $('#tbl').treegrid('getCheckedNodes'); ... } while (...)
// 优化后：let nodes = $('#tbl').treegrid('getCheckedNodes'); do { ... } while (...)
```

### 模式 3：嵌套 if-else 扁平化 + 不可达 return

```js
// 优化前：3 层嵌套 + 末尾不可达 return true
if (valid) return true;
if (hasDash) { ... } else { if (len!=11) { ... } else { ... } }
return true;  // 不可达
// 优化后：扁平 guard clause
if (valid) return true;
if (hasDash) { ... return false; }
if (len != 11) { ... return false; }
...
```

### 模式 4：异步加载前检查依赖链

给 `<script>` 加 `defer`/`async` 前确认下游不依赖其全局变量。基础框架脚本（如 hisUi）不能异步化——优化方向应为强缓存 + CDN。

---

## 十、优化检查清单

### 页面加载
- [ ] JS/CSS 文件已 minify 且服务器开启 gzip
- [ ] 首屏请求数 < 20
- [ ] JS 文件 > 500KB 已拆分或懒加载
- [ ] 非首屏 JS 使用 defer/async

### 页面渲染
- [ ] 循环内没有逐条 appendChild 操作
- [ ] 没有交叉读写触发强制重排的代码
- [ ] 列表 > 500 条有分页或虚拟滚动
- [ ] 搜索/滚动/resize 事件有防抖节流

### 后端请求
- [ ] 没有循环内多次调用同一后端接口
- [ ] 同一请求没有被重复发起
- [ ] 首屏接口返回数据量合理（< 500 条）
- [ ] 字典/码表数据有缓存策略

### 代码质量
- [ ] 页面离开时定时器已清理
- [ ] 事件监听器不会重复绑定
- [ ] 关键代码有 try-catch 错误边界
- [ ] 生产环境无 console.log 输出
- [ ] 全局变量没有持有大对象引用

---

> 通用 JS/HTML/CSS，不依赖特定框架。后端优化见 [[optimization-guide.md]]
