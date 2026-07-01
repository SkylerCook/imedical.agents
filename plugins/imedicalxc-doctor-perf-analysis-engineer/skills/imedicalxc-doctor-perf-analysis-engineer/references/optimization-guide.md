# 模式 B：优化策略实施

## 核心原则

1. **不改变原有业务逻辑** — 优化只改"怎么查"，不改"查什么"。返回值、副作用、调用方均不变。
2. **没有日志时更谨慎** — 逐行对比优化前后代码逻辑，画出"字段→赋值来源"映射。
3. **逐个优化、独立验证** — 区分"优化未触发"和"优化触发但没效果"。

## 优化策略

### 策略 1：批量合并 RPC/Feign 调用（收益最高）

循环内每条记录调用一次远程接口 → N 次 HTTP 往返。

**模式**：采集-合并-回填三阶段：
1. 循环内只收集请求参数，不调用远端
2. 主线程一次性批量调用，结果按唯一标识建索引
3. 遍历原始记录从索引回填

### 策略 2：循环前批量查询 + Map 回填

循环内逐条 DB 查询 → 收集全部入参 → 一次 `wrapper.in()` 批量查询 → `groupingBy` 构建 Map → 循环内只读 Map。

### 策略 3：写操作批量 INSERT/UPDATE

循环内逐条 INSERT/UPDATE → 收集 PO 列表 → MyBatis `insertBatch` / `updateBatchById`。

### 策略 4：循环内局部缓存

同一数据在循环内被多次查询，参数组合有限时，循环前用 Map 缓存。

### 策略 5：提前不变数据到入口方法

循环内每次都重新获取相同配置数据 → 入口获取一次，通过临时对象传入循环。

### 策略 6：子步骤合并（公共步骤外提）

循环内调用的方法大部分步骤对所有调用相同 → 公共步骤提到循环外，仅差异步骤保留。

### 策略 7：跨模块批量方法新增

共享模块需要新增批量方法 → 只新增、不修改已有方法。每层委托链路各新增一个。修改前搜索所有引用方。

### 策略 9：CT/CF 表评估接入本地缓存

`ct_`（码表）和 `cf_`（配置表）开头的表，通常变动频率低、数据量小，**适合接入本地缓存**。但不是所有都适合，需评估：

**适用条件**：
- 数据量小（通常 < 1000 条）
- 变动频率低（非实时性要求高的数据）
- 多请求间共享同一份数据

**不适用场景**：
- 数据实时性要求高、频繁变动
- 数据量大不适合全量加载到内存

**优化步骤**：
1. 确认表满足适用条件
2. 在查询方法上接入 `DocLocalCache` 或 `batchLocalCacheFirst`
3. 确认缓存失效策略（定时刷新 / 手动清除）

**预期收益**：消除 CT/CF 表的 DB 往返，单次查询从 ~10-50ms 降至 ~0.1ms（内存读取）。

**如何发现**：循环体内反复调用 `ct_`/`cf_` 表的 `selectList`/`selectOne`，且方法上无 `@DocLocalCache`。用 PostgreSQL 确认数据量 < 1000 且变动频率低 → 适合缓存。

### 策略 10：主键值一致的多表合并查询

同一业务主键值关联的多张一对一表，分开逐表查询会产生多次 DB 往返。应合并为一条 SQL 一次完成。

**识别方法**：同一方法内对多张不同表用同一主键值分别查询，适用于一对一关系表。

**示例**：
```java
// 优化前：3 次 DB 查询
Patient patient = patientMapper.selectById(patientId);
PatientExt ext = patientExtMapper.selectById(patientId);
PatientDetail detail = patientDetailMapper.selectById(patientId);

// 优化后：1 次 SQL
// SELECT p.*, e.*, d.*
// FROM tb_patient p
// LEFT JOIN tb_patient_ext e ON p.id = e.patient_id
// LEFT JOIN tb_patient_detail d ON p.id = d.patient_id
// WHERE p.id = #{patientId}
```

**优化步骤**：
1. 确认多表之间是一对一关系、主键值相同
2. 确认数据量不会导致 JOIN 结果膨胀
3. 在 Mapper XML 中新增合并查询 SQL
4. 返回结果用 resultMap 映射到各实体

**预期收益**：N 次 DB 往返合并为 1 次，减少 DB 连接开销和网络延迟。

**真实案例**：

`oe_ord_item`（医嘱主表）和 `oe_ord_itemext`（医嘱扩展表）共享主键 —— `oe_ord_itemext.id` = `oe_ord_item.id`。代码中普遍存在分开查询的模式：

```java
// 常见模式：先查主表，再查扩展表，两次 DB 往返
List<OeOrdItemPO> items = oeOrdItemService.listByIds(ordItemIdList);          // 查 oe_ord_item
Map<Long, OeOrdItemextPO> extMap = oeOrdItemextService.getOrdItemextMapByOrdItemIds(ordItemIdList); // 查 oe_ord_itemext
// 应合并为：SELECT t.*, ext.* FROM oe_ord_item t LEFT JOIN oe_ord_itemext ext ON t.id = ext.id WHERE t.id IN (...)
```

此模式在 `CheckOrdItemExecAbstract`、`SaveOeOrdExecAbstract`、`GetOrdItemCalDataAbstract` 等多处出现。已有部分代码优化为例（`QueryOeOrdItemAbstract` 中注释掉了旧的分开查询，改为走 `oeOrdItemMergeExtService` 合并查询）。

**如何发现**：同方法内对多个 Service/Mapper 用同一 ID 调 `getById`/`listByIds`。用 PostgreSQL 查扩展表：`SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%_ext'`。关键区分：1:1 共享主键 → 合并 JOIN（本策略）；1:N 外键 → 策略2（批量+Map）。

### 策略 8：Feign 接口新增批量端点

远程服务无批量接口 → Feign Client 新增批量方法，服务端新增批量 Controller/SQL，用 `IN (...)` 代替逐条 `=`。

### 策略 11：反转查询方向

循环内逐条查 `A→B`，DTO 不支持 `in` → 反转方向查 `B→A`，循环外 1 次查询替代循环内 N 次。

```java
// 优化前：逐病区查 linkloc（父→子），N 次 DB
linklocDTO.setCtOrgLocationParref(ward.getLocationDr());
// 优化后：反转（子→父），1 次 DB。需 DTO 有反向字段
linklocDTO.setCtlocDr(locId);
Set<String> parents = service.getSelectList(linklocDTO).stream()
    .map(VO::getCtOrgLocationParref).collect(toSet());
// 循环内 O(1)：parents.contains(ward.getLocationDr())
```

### 策略 12：入参传递替代重复查询

方法内调 `getXxx(param)` 查 DB，但调用方已有数据 → 通过 DTO 已有字段传参，零 DB。

```java
// 优化前：方法内 getPatMastInfo(papmiDr) → DB
// 优化后：DTO 已有 paPatMastPO 字段，调用方 setPaPatMastPO(patMastMap.get(papmiDr))
// 方法内：dto.getPaPatMastPO().getNo()
```
**前提**：DTO 已有对应字段，调用方数据已就绪。

### 策略 13：批量预取两阶段

N+1 涉及多种查询 → 循环外收集 ID → 批量查（DB+Feign）→ 循环内纯内存。

```java
// 阶段一：循环外 3 次批量查询
ordersByEpisode = selectList(in(allEpisodeIds)).groupingBy(admDr);
allPriceMap = getOrderPrice(allOrdItemIds);
allPrescTypeMap = getPrescTitleByPrescNo(allPrescNoDTOs);
// 阶段二：循环内纯内存
oeOrdItemPOS = ordersByEpisode.getOrDefault(episodeId, emptyList);
```
**收益**：N 次 DB + 2N 次 Feign → 1 次 DB + 2 次 Feign。

## 验证方法

1. **日志验证**：相同入参请求优化前后，通过 traceId 对比关键日志
2. **字段逐项对比**：特别关注精度敏感字段、条件赋值字段、可空字段
3. **逐优化独立验证**：每个优化点搜日志确认是否触发，条件不满足时确认路径正确跳过

## 常见陷阱

| # | 陷阱 | 防范 |
|---|------|------|
| 1 | 重构时遗漏字段的累加或赋值 | 重构前列出所有被赋值字段，重构后逐一确认 |
| 2 | 数组返回值索引错位 | 返回处注释每个索引的语义 |
| 3 | 批量结果匹配 key 冲突 | 用能唯一定位的组合 key |
| 4 | 线程安全容器选型错误 | 写多读少用同步列表，读写并发用 ConcurrentHashMap |
| 5 | 文本替换意外扩大范围 | 手动审查每个替换位置；详细误伤模式见 frontend-optimization-guide.md §七 |
| 6 | 循环内初始值被"优化"掉 | 确保外层后处理中有对应赋值语句 |
| 7 | 前置条件短路导致优化未触发 | 先确认入参是否满足触发条件 |
| 8 | 共享模块修改未评估跨服务影响 | 修改前搜索所有引用方；优先新增方法 |
| 9 | 批量结果集未按原始入参维度分组 | 确认分组 key 唯一性，提供冲突合并策略 |
| 10 | 空值检查条件与查询集合不一致 | copy-paste 未改 guard | 每个 guard 检查自己的集合 |
| 11 | 本地缓存调用误标为 Feign | 高估收益 | 读方法实现确认调用链 |
| 12 | 方案查询方向写反 | 实施后数据不对 | 追踪 SQL，验证后再写方案 |
| 13 | DTO 已有字段但未利用 | 多一次 DB | 分析前检查 DTO 字段清单 |

## 优化检查清单

**实施前**：
- [ ] 分段计时量化了每个环节的耗时？
- [ ] 识别了所有 N+1 查询和重复查询？
- [ ] 确认了哪些数据可在循环外获取？
- [ ] 列出了修改方法的所有调用方？
- [ ] 涉及共享模块时搜索了所有引用方？

**实施后**：
- [ ] 相同入参对比优化前后返回数据？
- [ ] 逐字段确认值完全一致？
- [ ] 验证边界场景（空列表、null、单条数据）？
- [ ] 批量调用的回填 key 唯一？
- [ ] 区分了"优化未触发"和"优化触发但没效果"？
- [ ] guard 条件检查的集合与查询的集合一致？
- [ ] 调用性质已确认（Feign / 本地缓存 / DB）？

## 无法启动时的后端代码验证方法

当后端服务无法启动（缺环境/缺数据库/缺依赖），但代码已修改时，按以下层次递进验证：

### 第一层：编译验证

```bash
# 仅编译修改的模块，确认语法、类型、依赖正确
mvn compile -pl comoe-mediway/comoe-ord -am -o
```

- [ ] 无编译错误
- [ ] 无 import 缺失
- [ ] 泛型类型匹配（如 `Map<Long, XxxVO>` 的 key 类型与 put 的 key 一致）

### 第二层：逻辑走读（用具体数据模拟执行）

拿一组典型输入数据，逐行推演代码：

```
输入: prescNoArr = ["P001","P002"], diagList = "2807,2808"

逐行跟踪:
  ① findByPrescNoS(["P001","P002"]) → Map{p1→PO(diagList="2807"), p2→PO(diagList="2808")}
  ② 循环 p1: diagData = "2807" → selectBatchIds({2807}) → [MrDiagnosPO(id=2807)]
  ③ 确认 2807 在结果中 → oneDiaId = "2807"
  ④ 循环 p2: 同上
  ⑤ 返回 ["2807", "2808"]

预期输出 vs 实际逻辑 → 逐项对照
```

- [ ] 正常路径（典型数据）走通
- [ ] 空输入路径（null / 空列表 / 空字符串）不报错
- [ ] 边界路径（单条 / 重复 / 不存在）行为符合预期

### 第三层：比对原 M 代码

HIS 项目中许多 Java 代码注释了对应的原 M (Cache/ObjectScript) 方法：

```java
// 原M代码: ##class(web.DHCDocDiagLinkToPrse).GetAllPrescList
```

如果修改涉及逻辑变化，去项目 M 代码目录找原始实现，对比：
- 原来的 SQL 查询条件和现在的是否等价
- 原来的循环处理和现在的是否等价

### 第四层：搜索已有测试

```bash
# 搜索相关测试文件
grep -r "DiagLinkToPrse\|getDia\|findPrseOrderList" --include="*Test*.java" --include="*Test*.xml"
```

即使测试跑不了，也能从已有测试代码中了解预期的输入输出格式、边界条件。

### 第五层：交叉验证清单

| 检查维度 | 验证方法 | 常见问题 |
|---------|---------|---------|
| **返回值** | 对比方法签名，确认类型不变 | `List<X>` 改 `Map<K,V>` 导致调用方编译失败 |
| **null 安全** | 检查每个 `.get()` 调用前是否有 null 判断 | `po.getXxx().toString()` 没判空 |
| **事务边界** | `@Transactional` 是否还在正确位置 | 新提取的方法没加事务注解 |
| **缓存 key** | `DocLocalCacheUtil` key 生成逻辑与原来一致 | key 多了/少了参数，缓存穿透 |
| **SQL 变更** | 对应 Mapper XML 或 LambdaWrapper 条件不变 | `eq()` 改成 `like()` 或漏了 `activeFlag=true` |
| **调用方兼容** | 搜索所有调用此方法的地方，确认入参结构没变 | Controller 传递给 BLH 的 DTO 字段名变了 |
| **异常传播** | `HisBusinessException` 抛出条件不变 | 原来抛异常的场景现在静默返回 null |

### 分层验证优先级

```
编译通过 ──→ 逻辑走读 ──→ 比对原 M 代码 ──→ 交叉验证清单
   ↓             ↓               ↓                ↓
 必须通过      必须通过       有原代码时必做     每次必做
```

如果前四层全部通过，代码质量置信度 > 80%。剩余风险只能通过启动服务 + 实际数据验证消除。
