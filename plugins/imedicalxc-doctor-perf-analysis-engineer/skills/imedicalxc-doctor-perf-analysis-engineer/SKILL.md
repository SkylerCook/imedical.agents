---
name: imedicalxc-doctor-perf-analysis-engineer
version: 1.0.0
description: |
  HIS 医生站接口性能分析与优化。覆盖前后端全链路追踪（Controller → BLH → Service → Mapper）、N+1 查询与批量调用优化、Graylog 日志分析、性能报告输出。用于排查慢接口、分析 traceId、优化数据库调用和前端加载性能。
triggers:
  - 接口性能
  - 慢接口
  - traceId
  - N+1
  - 批量调用
  - 缓存优化
  - 前端卡顿
  - 页面加载慢
  - Graylog
  - 日志分析
  - 性能分析
  - 接口耗时
role: analyst
scope: end-to-end
output-format: report
priority: high
---

<SUBAGENT-STOP>
If you were dispatched as a subagent, skip this skill. It is for the primary agent.
</SUBAGENT-STOP>

**REQUIRED BACKGROUND:** You MUST understand [[using-superpowers]] before using this skill.

# 接口性能分析与优化

## 核心原则

1. **前后端联合** — 追踪 Controller → BLH → Service → Mapper 完整链路
2. **先读代码** — 不依赖旧报告，读当前代码确认问题是否仍存在
3. **先出文档再改** — 分析完输出 Markdown 报告，用户确认后再修改
4. **数值有来源** — 日志提取 > 代码推算 > 估算

## 路由

| 用户意图 | 读取 |
|----------|------|
| 分析接口/traceId、查找慢接口 | [[references/diagnosis-workflow.md]] |
| 优化后端 N+1/批量/缓存 | [[references/optimization-guide.md]] |
| 后端修改后无法启动如何验证 | [[references/optimization-guide.md#无法启动时的后端代码验证方法]] |
| 前端页面慢/卡/报错 | [[references/frontend-optimization-guide.md]] |
| 查 Graylog | [[references/graylog-search.md]] |
| 输出报告 | [[references/report-template.md]] |
| 产品组归属 | [[references/application-mapping.md]] |

## 硬性规则

<HARD-GATE>
- **先读代码再判断** — 分析前读当前代码确认问题仍存在，禁止凭旧报告复述
- **建议前验证可行性** — 检查依赖链和架构约束，不可行就标"架构约束"
- **区分调用性质** — 读方法实现确认 Feign/本地缓存/DB，不得猜测
- **Graylog 仅用 MCP** — `mcp__graylog__*`，禁止 curl/http
- **未指定目标不自动全量分析** — 先列出让用户选
- **msup 目录 JS 属药房模块** — 只标注调用关系，不深入分析修改
- **位置精确到 `文件名:行号`**
- **先出文档再修改** — 禁止先改代码再补报告
- **保留已有报告** — 仅新增不覆盖
</HARD-GATE>

## 代码追踪防误判三步法

分析循环/重复调用时，**必须**对每个子调用执行以下三步，禁止只看方法名就定性能问题：

### 第一步：读被调用方法的实现

```
看到 xxxBLH.xxxMethod() → 打开对应文件读方法体
不猜测、不推断、不看旧报告
```

### 第二步：检查 guard clause — 调用方传了什么？

```java
// 这种代码不能直接把 getById 算 DB 次数：
if (dto.getPrescNo() == null) {
    prescNo = oeOrdItemService.getById(id).getPrescNo();  // ← guard clause
}
// 必须回到调用方确认 dto.setPrescNo(...) 是否已执行
// 若调用方已传值 → guard 永不触发 → DB 次数 = 0
```

### 第三步：检查缓存层 — 调到底了吗？

```
每个 DB 相关调用追踪到底层数据访问，确认走的是：
  DocCacheUtils.getByKey()         → L1 Caffeine + L2 Redis  → 不计 DB
  DocLocalCacheUtil.get()          → L1 Caffeine + L2 Redis  → 不计 DB（首次除外）
  @DocLocalCache 注解方法           → 首次 DB，后续 L1        → 循环内只计 0-1 次
  baseMapper.selectList() 裸调用    → 每次 DB                 → 实打实计数
  xxxService.getById() 裸调用       → 每次 DB（PK 索引）       → < 3ms，可忽略
  msupFindComInfoBLH.xxx()         → 外部药房 RPC             → 10-40ms，需标注
```

### 判定矩阵

| 实际执行情况 | 判定 |
|-------------|------|
| 全缓存（L1+L2 均有） + 数据量少 | ✅ 无需优化 |
| 仅首次 DB，后续 L1 Caffeine | ✅ 无需优化（除非首次在热点路径） |
| 每次 DB 但 PK 查询 + 循环 < 10 次 | ✅ 无需优化 |
| 每次 DB + 循环 > 50 次 | ⚠️ 待修复 |
| 每次外部 RPC + 循环内 | ⚠️ 待修复（能批量则批量） |

## 报告标记规范

汇总表中每个问题必须用一个状态标记：

| 标记 | 含义 | 何时使用 |
|------|------|---------|
| `✅ 无需优化` | 分析后确认非问题 | 缓存已覆盖 / 数据量小 / guard 跳过 |
| `✅ 已修复` | 代码已修改 | 改动已写入文件 |
| `⚠️ 待修复` | 确认是真问题 | 真 DB N+1 / 同步阻塞 / 缺缓存 |
| `⚠️ 待修复（需评估）` | 真问题但成本高 | 需改公共库 / 影响多模块 |

**规则**：
- 分析确认是伪问题后**立即**标记 `✅ 无需优化`，标题加删除线，不在后续讨论中重复出现
- 汇总表只保留最终状态，不保留 `~~高→低→已完成~~` 这类中间过程

## 报告输出

- 默认对话展示，用户明确说"输出文件"/"生成 MD"才写文件
- 输出前提示用户将输出到当前项目目录，用户可另行指定
- 目录格式：`{项目目录}\{产品组}\{模块}_{方法名}性能分析报告.md`

## 常见错误

| 错误 | 后果 | 正确做法 |
|------|------|---------|
| 只分析前端不看后端 | 遗漏 N+1/缓存缺失 | 追踪完整链路 |
| 凭经验估耗时 | 误判根因 | 日志提取 > 代码推算 |
| 给框架脚本加 defer/async | 依赖链断裂，页面白屏 | 先检查依赖，不可行标架构约束 |
| 没读代码就复述旧报告 | 已修问题当未修 | 分析前读当前代码 |
| 本地缓存调用标成 Feign | 高估收益 | 读方法实现确认 |
| 方案查询方向写反 | 实施后数据不对 | 追踪 SQL/调用方向 |
| guard 条件 copy-paste 未改 | 空集合时静默丢数据 | 每个 guard 检查自己的集合 |
| 报告输出到随机目录 | 找不到 | 输出前提示默认目录，用户可调整 |
| **guard clause DB 查询计入统计** | 高估 DB 次数，把防御性代码当性能问题 | 回到调用方确认传入值，`if (x==null) getById()` 在调用方已传值时永不触发 |
| **没追踪到底层就标"查 DB"** | 把缓存命中的调用当 DB 查询 | 每个 Service 调用追踪到底：`DocCacheUtils`(L1+L2)/`DocLocalCacheUtil`(L1 Caffeine)/`@DocLocalCache` |
| **循环内重复调用没检查缓存** | 报告 N+1 冗余，实际 L1 覆盖 | 追踪方法内部是否有 `DocLocalCacheUtil.get()` → 首次 DB，后续 < 0.01ms |
| **分析完伪问题不立即标记关闭** | 反复讨论已排除的问题 | 确认无问题后立即在报告中标记 `✅ 无需优化`，汇总表同步更新 |

## 何时不用

- 纯代码生成/功能开发 → 非性能分析
- 配置修改/部署 → 运维问题
- 架构评审/重构 → 用 [[brainstorming]]
- msup 药房模块 → 药房团队范围
