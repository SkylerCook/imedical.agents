---
name: imedicalxc-doctor-dbdata
version: 1.0.0
description: 当医生站团队需要查询数据库数据时使用。提供基础数据查询（必须使用 DocCacheUtils）、配置数据查询（系统标准配置通过 hiscfsv-* 模块或自建配置通过 DocCacheUtils）以及业务数据查询的规范，包括 HIS（Hospital Information System，医院信息系统）中数据库查询的代码组织和最佳实践。特别关注 comoe-mediway Service 模式与独立 Boot 模块的差异。
triggers:
  - database query
  - base data query
  - config data query
  - business data query
  - comoe service
  - DocCacheUtils
  - 数据库查询
  - 基础数据查询
  - 配置数据查询
  - 系统标准配置
  - hiscfsv配置
  - 自建配置
  - 业务数据查询
  - SQL规范
  - MyBatis
  - 数据字典查询
  - 配置表查询
  - comoe
  - Service规范
  - 基础字典查询
  - DocCacheUtils
role: specialist
scope: implementation
output-format: code
---

# iMedicalXC 医生站数据库查询规范

医生站团队数据库查询开发专用技能。本技能提供查询不同类型数据的全面规范，以及组织数据库访问代码的指南，特别关注 comoe-mediway Service 模式。

## 概述

在 HIS 系统中，数据分为三大类型：
1. **基础数据（Base Data）** — 系统级基础数据
2. **配置数据（Configuration Data）** — 业务规则配置
3. **业务数据（Business Data）** — 事务性临床数据

## 模块架构

| 方面 | comoe-mediway（公共库） | Boot 模块（opcare/ipcare等） |
|------|------------------------|----------------------------|
| 部署方式 | JAR 依赖，不可独立部署 | 可独立部署的微服务 |
| REST API | 无 | 有 |
| Feign 客户端 | 无 | 有 |
| Service Bean 名称 | `comoe.{module}.{ServiceName}` | `{服务名}.{模块名}.{ServiceName}` |
| 业务职责 | 公共逻辑部分（Abstract 抽象类） | 实现门诊/住院差异业务（继承 Abstract，实现预留抽象方法，部分重写） |
| 缓存策略 | 全局统一策略（@DocThreadLocalCache / DocCacheUtils） | 同左，无模块差异 |

> comoe Service 为 opcare/ipcare/aggcare 共享。comoe 通过 Abstract 抽象类定义公共逻辑，Boot 模块继承 Abstract 并实现预留的抽象方法以处理门诊/住院差异，部分场景需重写 comoe 方法。

## 数据分类与查询规范

### 1. 基础数据（Base Data）
系统共享的核心字典数据（ICD诊断、药品、科室、用户、医院等），**必须使用 `DocCacheUtils`** 查询。详见下方"基础字典查询规范"章节。

### 2. 配置数据（Configuration Data）

可按医院/科室定制的业务规则配置。配置读取封装遵循以下原则：

**三大原则**：
1. **类似枚举值的读取方式**：每个配置项封装为常量类的 `public static final` 字段，调用方像读枚举一样使用
2. **内部使用本地缓存**：常量类内部自动使用线程缓存和 HOS 缓存，调用方无需关心缓存
3. **类的命名与配置目录保持一致**：常量类路径对应配置系统中的分类代码（`stCode`）

**使用方式**：

```java
// 直接通过常量类读取配置值，像枚举一样使用
Boolean notCheckLab = OeEntryCheckSavingConfigConstants.NOT_CHECK_SAME_LAB_SPEC_ITEM
    .get(BusinessEnum.busConvertEnum(businessCode), loginUserInfo);
List<Long> catList = OeEntryCheckSavingConfigConstants.ORD_NEED_MM_DIAG_CAT
    .getList(BusinessEnum.busConvertEnum(businessCode), loginUserInfo);
```

**参考实现**：`com.mediway.his.hiscfsv.ipcare.docconfig.constant.oe.entry.OeEntryCheckSavingConfigConstants`

**项目自建配置**（本地化设置）：

项目自建配置也需遵守上述三大原则，在项目模块中创建对应的常量类。需特殊备注为**本地化设置**，表示该配置仅在当前项目使用，非系统标准配置。

**禁止**：
- 直接调用配置 Service/Mapper 查询配置值
- 在业务代码中硬编码配置代码字符串

### 3. 业务数据（Business Data）
临床事务性数据（医嘱、就诊、诊断等），使用标准 MyBatis Plus 查询（分页、LambdaQueryWrapper）。

业务数据查询中常见的三类专项场景：
- **需要同时获取多张关联表数据**（如就诊+患者、医嘱项+扩展）→ 优先使用已有的 **Merge Service**，详见下方「合并查询（Merge Query）」章节
- **需要将 HIS 代码映射为医保编码**（如科室→医保科室、诊断→医保诊断）→ 使用 **医保对照数据获取**，详见下方「医保对照数据获取」章节
- **需要将 HIS 代码映射为非医保的第三方编码**（如证件类型→卫健委编码）→ 使用 **基础数据统一对照**，详见下方「基础数据统一对照」章节

## 基础字典查询规范

基础字典数据（ICD诊断、药品、科室、用户、医院等）查询**必须使用 `DocCacheUtils`**，禁止直接 mapper 查询或使用 @Cacheable。`DocCacheUtils` 底层基于 Caffeine 高性能本地缓存，采用 W-TinyLFU 淘汰算法，支持并发读写。

**前提配置**：使用 DocCacheUtils 前，需在系统管理"代码表缓存"页面维护对应表的缓存规则（每个PO对应一条规则记录，配置表名、规则别名、规则列等）。

### DocCacheUtils 方法清单

#### 1. 根据唯一约束列获取单条PO（键有唯一约束）

适用场景：键与单条数据一一映射（如 id → PO）

**配置要求**：
- 在"代码表缓存"页面维护该表的缓存规则
- 默认规则：按主键 ID 查询，规则列填 `id`，无需规则别名
- 自定义列规则：按其他唯一列查询（如 code），需配置规则别名（如 `code`），规则列填 `code`

```java
// 按默认 ID 获取（无需规则别名，ID 为默认规则）
CtOeItmmastPO itmMastPO = DocCacheUtils.getByKey(CtOeItmmastPO.class, 1);

// 按指定列获取（需在代码表缓存中维护规则别名 "code"）
CtPhFreqPO ctPhFreqPO = DocCacheUtils.getByKey("code", CtPhFreqPO.class, CtPhConstants.Freq.ONCE);
```

| 方法 | 说明 |
|------|------|
| `getByKey(Class<T> t, Object key)` | 按 ID 获取单条 PO（默认规则，无需额外配置） |
| `getByKey(String ruleAlias, Class<T> t, Object... keys)` | 按指定列（规则别名）获取单条 PO（需配置规则别名） |

#### 2. 根据唯一约束列批量获取PO

适用场景：多个键值批量获取 PO

**配置要求**：
- 与方法1相同，需在"代码表缓存"页面维护该表的缓存规则
- 默认按主键 ID 批量查询，规则列填 `id`，无需规则别名

```java
// 批量获取列表
List<HosOrgBusinessUnitPO> list = DocCacheUtils.batchByTableIdsList(
    HosOrgBusinessUnitPO.class, locIdList);

// 批量获取 Map（指定 Map 的 key 提取函数）
Map<String, HosOrgBusinessUnitPO> map = DocCacheUtils.batchByTableIdsMap(
    HosOrgBusinessUnitPO.class, idSet, HosOrgBusinessUnitPO::getId);
```

| 方法 | 说明 |
|------|------|
| `batchByTableIdsList(Class<T> t, Collection<?> ids)` | 批量获取 PO 列表 |
| `batchByTableIdsMap(Class<T> t, Collection<?> ids, Function keyMapper)` | 批量获取 PO Map |

#### 3. 根据可重复键获取PO列表（键非唯一约束）

适用场景：一个键对应多个值（如医嘱大类 → 医嘱子类列表）

**配置要求**：
- 在"代码表缓存"页面维护该表的缓存规则
- 规则列样式必须为 `references:表的关联字段名称`（如规则别名 `category_dr`，规则列填 `references:category_dr`）
- 规则别名即关联字段名，用于方法调用时传入

```java
// 按关联字段批量获取列表（referencesFiled 为代码表缓存中配置的规则列字段名）
List<CtOrgLocationMedunitCarePO> list = DocCacheUtils.batchByReferencesIdsList(
    CtOrgLocationMedunitCarePO.class, "medunit_parref", medunitList);

// 按关联字段批量获取 Map
Map<String, CfPaadmOpIpbookLocCfgPO> map = DocCacheUtils.batchByReferencesIdsMap(
    CfPaadmOpIpbookLocCfgPO.class, "op_loc_dr", locList, CfPaadmOpIpbookLocCfgPO::getOpLocDr);
```

| 方法 | 说明 |
|------|------|
| `batchByReferencesIdsList(Class<T> t, String referencesFiled, Collection<?> ids)` | 按关联字段批量获取 PO 列表 |
| `batchByReferencesIdsMap(Class<T> t, String referencesFiled, Collection<?> ids, Function keyMapper)` | 按关联字段批量获取 PO Map |

### 其他缓存注解

#### @DocThreadLocalCache（业务数据缓存）

与单次请求绑定的本地缓存，以 `traceId` 作为隔离标识，过期时间固定为 5 分钟。适用于单次请求内多次访问同一数据的场景。

```java
@DocThreadLocalCache(key = "'" + CACHE_CODE + "convPackFac_'+#dto.arcimItemId+#dto.packUomDr")
public ConvPackFacVO convPackFac(ConvPackFacDTO dto) {
    // ...
}
```

#### @DocLocalCache（自定义码表缓存，不推荐）

在 @HOSCacheable 基础上增加本地缓存，形成"本地+分布式"二级缓存。访问频率高、更新频率低的数据可用。通过 `DocLocalCacheUtil#clearByTableName` 清除，支持页面清除。

### 缓存同步机制

- **主动更新**：数据更新操作后，通过 Mybatis 拦截自动调用缓存删除
- **过期失效**：业务数据 5 分钟，码表数据 4 小时
- **消息订阅**：多实例场景通过 redis pub/sub 通知刷新本地缓存

### 注意事项

1. **数据量限制**：单缓存实例数据行数超过 10 万时不推荐使用本地缓存
2. **缓存清除**：修改基础数据后需通过界面清除缓存注解加的缓存；若界面清除无效，可临时关闭缓存（改为1），待失效时间过后再打开
3. **traceId 依赖**：`@DocThreadLocalCache` 依赖 traceId，需在请求前传递（`HisThreadContextHolder.capture()`），识别不到有效 traceId 时本地缓存不生效

### 禁止
- 直接 mapper 查询基础字典（无缓存）
- 使用 @Cacheable 替代 DocCacheUtils

## 查询最佳实践

- **分页**：列表查询始终分页，每页最大500
- **LambdaWrapper**：使用 LambdaQueryWrapper 保证类型安全，禁止字符串列名
- **防N+1**：循环中不查库，使用批量查询（`selectBatchIds` 或自定义批量Mapper方法）
- **comoe缓存**：comoe Service 使用 `@DocThreadLocalCache`

## 跨模块数据访问

| 场景 | 方式 | 特点 |
|------|------|------|
| 同一JVM内（同一Boot模块） | comoe Service 注入 | 无网络开销 |
| 跨微服务 | Feign 客户端 | 网络调用 |

注入 comoe Service 时使用全限定名：`@Resource(name = "comoe.{module}.{ServiceName}")`

## 医保对照数据获取

第三方医保相关集成经常需要把 HIS 内部标识转换为医保标准编码。HIS 中获取医保编码存在两种路径，不可混淆。

### 两类获取路径

| 路径 | 说明 | 数据来源 |
|------|------|---------|
| **实体直接字段** | 医院、医护人员的医保编码直接存储在实体字段中 | `DocCacheUtils.getByKey` 查询实体 |
| **字典对照映射** | 科室、诊断、医生级别等通用字典的医保编码 | `ct_ar_insu_dicdatacon` + Feign 调用 |

### 1. 实体直接字段获取

| 数据 | 实体 | 字段 | 方法 |
|------|------|------|------|
| 医院医保编码/名称 | `CtOrgHospitalPO` | `insuCode` / `insuDesc` | `DocCacheUtils.getByKey(CtOrgHospitalPO.class, hospId)` |
| 医护人员医保编码/名称 | `CtRbCareprovPO` | `insuCode` / `insuDesc` | `DocCacheUtils.getByKey(CtRbCareprovPO.class, docId)` |

### 2. 字典对照映射获取

**方法定义位置**：`com.mediway.his.comoe.ordinvoke.blh.ar.insu.ArInsuOpInvokeAbstract`
**可注入 BLH**：`arInsuOpInvokeBLH`（`com.mediway.his.comoe.ordinvoke.blh.ar.insu.ext.ArInsuOpInvokeBLH`，继承 `ArInsuOpInvokeAbstract`）
**注入方式**：`@Resource(name = "arInsuOpInvokeBLH") private ArInsuOpInvokeBLH arInsuOpInvokeBLH;`

| 对照数据 | 方法（定义在 ArInsuOpInvokeAbstract） | 典型用途 |
|---------|--------------------------------------|---------|
| 医嘱项/收费项 → 医保目录 | `getArcimLinkInsuInfo(dto)` / `getArcimLinkInsuInfo(dtos)` | 医嘱项获取医保目录编码、自付比例 |
| 诊断 ICD → 医保诊断 | `selectIcdContInfoList(icdIds, hospId, chargetypeId)`（定义在 `MRDiagnosInsuInvokeAbstract`，BLH：`mRDiagnosInsuInvokeBLH`） | 诊断获取医保诊断编码 |
| HIS 字典编码 → 医保编码（通用，单条） | `queryDicdataconByChargetype(ArInsuDictypeConEnum, String dictCode, Long chargetypeId, Long hospitalDr)` | 单个 HIS 字典编码转医保编码 |
| HIS 字典编码 → 医保编码（通用，批量） | `queryDicdataconByChargetype(ArInsuDictypeConEnum, List<ArInsuQueryDicdataconParamDTO> params, Long hospitalDr)` | 批量 HIS 字典编码转医保编码 |

**queryDicdataconByChargetype 支持的对照类型**（`ArInsuDictypeConEnum`）：

| 枚举值 | 对照类型 | 典型用途 |
|--------|---------|---------|
| `DEPT_CON` | 科室对照 | HIS科室 → 医保科室 |
| `DOCTOR_LEVEL_CON` | 医生职称/级别对照 | HIS医生级别 → 医保医生级别 |
| `MED_CHRGITM_TYPE_CON` | 医疗收费项目类型对照 | HIS收费项类型 → 医保收费项类型 |

> 枚举完整清单见 `com.mediway.his.comoe.ordinvoke.constant.ArInsuDictypeConEnum`。该方法只适用于 `"baseType" + suffix` 模式的对照字典；新增枚举值前应在 `ct_ar_insu_dicdatacon` 中确认对应 `baseType` 真实存在。

**使用示例**：

```java
@Resource(name = "arInsuOpInvokeBLH")
private ArInsuOpInvokeBLH arInsuOpInvokeBLH;

// 单条：HIS科室编码 → 医保科室编码
List<FeginArInsuQueryDicdataconVO> result = arInsuOpInvokeBLH.queryDicdataconByChargetype(
    ArInsuDictypeConEnum.DEPT_CON, deptCode, chargetypeId, hospitalDr);
String insuDeptCode = result.get(0).getCodeCon();

// 批量：多个HIS科室编码 → 医保科室编码
List<ArInsuQueryDicdataconParamDTO> params = ...; // 每项填充 dictCode + chargetypeId
List<FeginArInsuQueryDicdataconVO> results = arInsuOpInvokeBLH.queryDicdataconByChargetype(
    ArInsuDictypeConEnum.DEPT_CON, params, hospitalDr);
```

### 3. 注意事项

- `dictype` 后缀由 HIS 费别（`ct_pa_chargetype`）映射而来，`queryDicdataconByChargetype` 内部自动处理，调用方只需传 `chargetypeId`
- 只有 HIS 字典 ID 时需先解析为 code 再调用（`queryDicdataconList` 只接受 `code`）
- 新增对照方法应在 `ArInsuOpInvokeAbstract` / `MRDiagnosInsuInvokeAbstract` 中扩展，不要在业务 BLH 直接调用 `ArInsuCtApi`
- `ArInsuCtApi` 属于医保服务对外暴露的 Feign 接口，新增方法前必须先确认医保服务侧已提供对应实现


## 基础数据统一对照（第三方代码映射）

第三方接口开发中，HIS 内部代码与第三方代码体系不一致时（证件类型、性别、科室、诊断编码等），必须通过"基础数据统一对照"功能进行映射转换，禁止硬编码或扩展设定 JSON。

> **与医保对照的区别**：医保对照走 `ct_ar_insu_dicdatacon` + `ArInsuOpInvokeAbstract`（见上方"医保对照数据获取"章节）；非医保的第三方代码映射走 `ct_dic_basedatamap` + `CtDicBasedatamapdetailService`（本章节）。

### 1. 数据模型（三级结构）

```
ct_dic_basedatamap（主表/对照类别）
  ├── parent_dr → ct_dic_basedatamap（上级目录，即 systemCode 对应的记录）
  │
  └── ct_dic_basedatamapdetail（明细表/对照数据）
        ├── basedatamap_dr → ct_dic_basedatamap.id
        ├── hiscode / hisname（HIS 内部代码/名称）
        ├── extcode / extname（外部第三方代码/名称）
        └── his_flag（对照方向：E=外部→HIS，H=HIS→外部，T=通用双向）
```

**主表 `ct_dic_basedatamap` 关键字段**：

| 字段 | 说明 |
|------|------|
| `code` | 对照类别代码（对应 `dictCode` 参数） |
| `displayname` | 对照类别名称 |
| `parent_dr` | 上级目录ID（上级目录的 `code` 对应 `systemCode` 参数） |

**明细表 `ct_dic_basedatamapdetail` 关键字段**：

| 字段 | 说明 |
|------|------|
| `basedatamap_dr` | 关联主表ID |
| `hiscode` / `hisname` | HIS 内部代码 / 名称 |
| `extcode` / `extname` | 外部第三方代码 / 名称 |
| `his_flag` | 对照方向：`E`=外部→HIS，`H`=HIS→外部，`T`=通用（双向） |

### 2. 后端 API

**Service 类**：`com.mediway.his.ctsv.dic.service.CtDicBasedatamapdetailService`
**Bean 名称**：`ctDicBasedatamapdetailService`
**Maven 依赖**：`hisctsv-dic`（comoe-external 已依赖）

**核心方法**：

| 方法 | 用途 | 返回类型 |
|------|------|---------|
| `convertData(systemCode, dictCode, code, type)` | **单条代码转换**（最常用） | `List<DictionaryVO>` |
| `convertDataByDesc(systemCode, dictCode, desc, type)` | 按名称转换 | `List<DictionaryVO>` |
| `getAllCodeListData(systemCode, dictCode)` | 批量获取全量对照列表 | `List<BaseDataMapDetailVO>` |

**convertData 参数详解**：

```java
List<DictionaryVO> convertData(String systemCode, String dictCode, String code, String type)
```

| 参数 | 含义 | 示例 |
|------|------|------|
| `systemCode` | 上级目录代码（主表中 parent 记录的 `code`） | `"BeiJingWeiJianWei"` |
| `dictCode` | 对照类别代码（主表中具体对照类别的 `code`） | `"CredType"` |
| `code` | 待转换的代码（type=H 传HIS代码；type=E 传外部代码） | `"01"` |
| `type` | 转换方向：`"H"`=HIS→外部，`"E"`=外部→HIS | `"H"` |

**返回值 DictionaryVO**：

| 字段 | type=H 时 | type=E 时 |
|------|-----------|-----------|
| `id` | extid | hisid |
| `code` | **extcode**（外部代码） | **hiscode**（HIS代码） |
| `text` | extname（外部名称） | hisname（HIS名称） |

**SQL 逻辑（type=H）**：

```sql
SELECT t.extid AS id, t.extcode AS code, t.extname AS text
FROM ct_dic_basedatamapdetail t
  LEFT JOIN ct_dic_basedatamap con ON t.basedatamap_dr = con.id
  LEFT JOIN ct_dic_basedatamap parent ON parent.id = con.parent_dr
WHERE t.hiscode = #{code}           -- 传入的 HIS 代码
  AND con.code = #{dictCode}        -- 对照类别代码
  AND parent.code = #{systemCode}   -- 上级目录代码
  AND t.is_deleted = 0
```

### 3. 现有调用模式

#### 3.1 ExternalDriveComAbstract 封装（批量转换，推荐复用）

**文件**：`comoe-external/.../blh/ExternalDriveComAbstract.java`

```java
@Resource(name = "ctDicBasedatamapdetailService")
private CtDicBasedatamapdetailService ctDicBasedatamapdetailService;

// 批量转换：HIS代码 → 外部代码
public Map<String, List<DictionaryVO>> getBSPMapData(List<String> datas, String systemCode, String dictCode) {
    return getBSPMapData(datas, systemCode, dictCode, "H");
}

// 批量转换：外部代码 → HIS代码
public Map<String, List<DictionaryVO>> getBSPMapDataByExternal(List<String> datas, String systemCode, String dictCode) {
    return getBSPMapData(datas, systemCode, dictCode, "E");
}
```

#### 3.2 单条转换模式

```java
private String mapCredType(String hisCredTypeCode) {
    if (StrUtil.isBlank(hisCredTypeCode)) {
        return DEFAULT_CRED_TYPE;  // 默认值
    }
    String systemCode = getConfigValue("credTypeContrastSystemCode");
    String dictCode = getConfigValue("credTypeContrastDictCode");
    try {
        List<DictionaryVO> result = ctDicBasedatamapdetailService.convertData(
            systemCode, dictCode, hisCredTypeCode, "H");
        if (ObjectUtil.isNotEmpty(result)) {
            String extCode = result.get(0).getCode();
            if (StrUtil.isNotBlank(extCode)) {
                return extCode;
            }
        }
    } catch (Exception e) {
        log.warn("证件类型对照查询失败: hisCode={}", hisCredTypeCode, e);
    }
    return DEFAULT_CRED_TYPE;  // 映射失败返回默认值
}
```

### 4. 前端配置操作步骤

**菜单路径**：系统管理 → 基础数据 → 基础数据统一对照

**配置页面**：
- 主表管理：`ct/dic/html/ct_dic_basedatamap.html`（"基础数据统一对照类别"）
- 明细管理：`ct/dic/html/ct_dic_basedatamapdetail.html`（"基础数据统一对照"）

**配置步骤**：

1. **创建上级目录（systemCode）**：主表管理页面新增记录，代码填厂商标识（如 `BeiJingWeiJianWei`），名称填描述（如 `北京市卫健委`），上级目录留空
2. **创建对照类别（dictCode）**：主表管理页面新增记录，代码填对照类型标识（如 `CredType`），名称填描述（如 `证件类型对照`），上级目录选择步骤1的记录
3. **维护对照数据**：明细管理页面逐条添加，填写 HIS代码/名称、外部代码/名称、对照方式选 `T`（通用双向）

**systemCode 与 dictCode 的关系**：

```
上级目录（systemCode = "BeiJingWeiJianWei"）
  └── 对照类别（dictCode = "CredType"）
        ├── 对照数据：HIS code "01" → 外部 code "01"
        ├── 对照数据：HIS code "02" → 外部 code "02"
        └── ...
```

一个上级目录下可以有多个对照类别（如证件类型、性别、科室等）。

### 5. 第三方接口开发标准步骤

| 步骤 | 操作 | 产出 |
|------|------|------|
| 1. 识别映射需求 | 分析第三方接口文档，找出代码不一致的字段 | 映射字段清单 |
| 2. 前端配置对照 | 系统管理→基础数据统一对照，创建上级目录+对照类别+对照数据 | systemCode、dictCode |
| 3. 扩展设定配置 | 外部接口管理→扩展设定，配置 `{paramName}ContrastSystemCode` 和 `{paramName}ContrastDictCode` | 两个扩展设定参数 |
| 4. 后端调用 | 从扩展设定读取 systemCode/dictCode，调用 `convertData` 转换 | 映射后的代码 |
| 5. 异常处理 | 映射缺失返回默认值，配置缺失记日志返回默认值 | 健壮性保证 |

**后端调用代码模板**：

```java
// 1. 从扩展设定读取对照配置
String systemCode = getConfigValue("credTypeContrastSystemCode");
String dictCode = getConfigValue("credTypeContrastDictCode");

// 2. 调用 convertData 进行转换（HIS→外部）
List<DictionaryVO> result = ctDicBasedatamapdetailService.convertData(
    systemCode, dictCode, hisCode, "H");

// 3. 取值
String extCode = (ObjectUtil.isNotEmpty(result)) ? result.get(0).getCode() : defaultValue;
```

### 6. 注意事项

1. **不要硬编码映射**：禁止 `if ("01".equals(hisCode)) return "01"` 之类的硬编码
2. **不要用扩展设定 JSON**：禁止在扩展设定中配置 `{"01":"01"}` 格式的 JSON 映射
3. **统一使用基础数据统一对照**：所有非医保的第三方代码映射都应通过 `convertData` 查询
4. **缓存**：`convertData` 内部直接查库，频繁调用时考虑在业务层缓存结果
5. **pom 依赖**：使用前确认模块 pom.xml 已依赖 `hisctsv-dic`
6. **对照方向**：`his_flag` 字段控制对照方向，配置时选 `T`（通用）最灵活

## 合并查询（Merge Query）

第三方接口开发中经常需要同时获取多张表的数据（如患者信息+就诊信息、医嘱项+医嘱扩展）。comoe Service 模块提供了一批 **Merge 方法**，通过 SQL JOIN 或应用层合并，将本来需要多次查询的表合并到一次查询中，减少数据库往返。

### 两类合并场景

| 场景 | 说明 | 表关系 | 示例 |
|------|------|--------|------|
| **场景1：非1:1表合并** | 按业务场景合并查询关联表，表间为1:N或N:1关系 | pa_pat_mast(1) : paadm(N) | 一起查出来 pa_pat_mast 与 paadm |
| **场景2：1:1表合并** | 合并查询主表与其1:1扩展表 | paadm(1) : paadm_ip(1) : paadm_op(1) | 把 paadm、paadm_ip、paadm_op 一起查出来 |

### 命名规范

合并查询方法统一以 **`Merge`** 作为 Service 类名和方法语义标识：

- **Service 类名**：`{主表}Merge{关联表}Service`（如 `PaadmMergePatService`、`OeOrdItemMergeService`）
- **方法名**：`get{主表}Merge{关联表}Info`（如 `getPaadmMergePatInfo`、`getPaadmIpMergePatInfo`）
- **返回 VO 名**：`{主表}Merge{关联表}InfoVO`（如 `PaadmMergePatInfoVO`）

### 已有 Merge Service 清单

#### 1. PaadmMergePatService（就诊+患者合并查询）

**所在模块**：`comoe-paadmservice`
**Bean 名称**：`comoe.paadmservice.PaadmMergePatService`
**注入方式**：`@Resource(name = "comoe.paadmservice.PaadmMergePatService")`

| 方法 | 返回VO | 包含的PO | 场景 | SQL JOIN |
|------|--------|---------|------|----------|
| `getPaadmMergePatInfo(Long episodeId)` | `PaadmMergePatInfoVO` | paadm + pa_pat_mast | 场景1：就诊+患者基础 | `paadm INNER JOIN pa_pat_mast` |
| `getPaadmOpMergePatInfo(Long episodeId)` | `PaadmOpMergePatInfoVO` | paadm + paadm_op + pa_pat_mast | 场景1+2：门诊就诊全量 | `paadm INNER JOIN pa_pat_mast LEFT JOIN paadm_op` |
| `getPaadmIpMergePatInfo(Long episodeId)` | `PaadmIpMergePatInfoVO` | paadm + paadm_ip + pa_pat_mast | 场景1+2：住院就诊全量 | `paadm INNER JOIN pa_pat_mast LEFT JOIN paadm_ip` |
| `getPaadmIPOPMergePatInfo(Long episodeId)` | `PaadmIPOPMergePatInfoVO` | paadm + paadm_op + paadm_ip + pa_pat_mast | 场景1+2：就诊全量（IP+OP） | `paadm INNER JOIN pa_pat_mast LEFT JOIN paadm_op LEFT JOIN paadm_ip` |
| `getPaadmAgencyMergePatInfo(Long episodeId)` | `PaadmAgencyMergePatInfoVO` | paadm + paadm_op + paadm_ip + paadm_agency + pa_pat_mast | 场景1+2：就诊+代办人 | `paadm INNER JOIN pa_pat_mast LEFT JOIN paadm_op LEFT JOIN paadm_ip LEFT JOIN paadm_agency` |

**使用示例**：

```java
@Resource(name = "comoe.paadmservice.PaadmMergePatService")
private PaadmMergePatService paadmMergePatService;

// 获取住院就诊+患者完整信息（1次SQL替代3次）
PaadmIpMergePatInfoVO info = paadmMergePatService.getPaadmIpMergePatInfo(episodeId);
PaadmPO paadm = info.getPaadmPO();
PaadmIpPO paadmIp = info.getPaadmIpPO();      // 住院扩展信息
PaPatMastPO patMast = info.getPaPatMastPO();   // 患者基本信息
```

#### 2. PaPatMastMergeMedicalService（患者+诊疗信息合并查询）

**所在模块**：`comoe-papatservice`
**Bean 名称**：`comoe.papatservice.PaPatMastMergeMedicalService`

| 方法 | 返回VO | 包含的表 | 场景 |
|------|--------|---------|------|
| `selectPatMastSimpleInfoAbout(List<Long> ids)` | `List<PaPatMastMergeMedicalSimpleInfoVO>` | pa_pat_mast + pa_pat_medical_info | 场景1：患者基本信息+诊疗信息 |

> 注：此方法在应用层合并（分别查两张表后在内存中组装），非SQL JOIN。

#### 3. PaadmMergeIpService（就诊+住院扩展合并查询）

**所在模块**：`comoe-paadmservice`

| 方法 | 返回 | 用途 | 场景 |
|------|------|------|------|
| `getCurrPaadmIpListExcludRunDay(dto)` | `List<Long>` | 获取当前在院就诊（过滤当日入院），用于滚医嘱 | 场景2：paadm + paadm_ip |
| `getCurrWardAndBedPaadmList(dto)` | `List<Long>` | 获取当前在院在床就诊，用于滚床位费 | 场景2：paadm + paadm_ip |

#### 4. OeOrdItemMergeService（医嘱项+扩展合并查询）

**所在模块**：`comoe-ordservice`

医嘱域的合并查询，将医嘱项主表与扩展表（如 `oe_orditem` + `oe_orditem_ext`）合并查询，避免分开查询医嘱项和扩展属性。

### 何时使用 Merge 方法

**必须使用 Merge 方法**：
- 第三方接口需要同时获取就诊+患者信息 → `PaadmMergePatService.getPaadmIpMergePatInfo` / `getPaadmOpMergePatInfo`
- 第三方接口需要患者基本信息+诊疗信息 → `PaPatMastMergeMedicalService.selectPatMastSimpleInfoAbout`
- 任何需要同时获取多张关联表数据的场景

**不要使用 Merge 方法**：
- 只需要单张表数据时，使用对应的单表 Service（如 `PaAdmService.getById`、`PaPatMastService.getById`）
- 需要批量查询时，确认 Merge 方法是否支持批量参数

### 新增 Merge 方法的原则

如果现有 Merge Service 不满足需求（如需要合并新的表组合）：

1. **在对应的 comoe Service 模块中新增 Merge Service**，不要在业务 BLH 中手动多次查询后组装
2. **遵循命名规范**：`{主表}Merge{关联表}Service`
3. **SQL 实现优先**：能用一条 SQL JOIN 完成的，不要在应用层分查后合并
4. **返回 VO 包含完整 PO**：VO 中包含各表的完整 PO 对象（如 `PaadmIpMergePatInfoVO` 包含 `paadmPO` + `paadmIpPO` + `paPatMastPO`），而非扁平化字段
5. **Mapper XML 放在 merge 子目录**：如 `mapper/paadm/merge/PaadmMergePatMapper.xml`

## 约束

### 必须遵守
- **comoe Services**：必须使用全限定 Bean 名称 `@Service("comoe.{module}.{Name}")`
- **通用 SQL**：通用可复用 SQL 放在 comoe Services 中
- **分页**：列表查询始终分页（每页最大 500）
- **LambdaWrapper**：使用 LambdaQueryWrapper 保证类型安全
- **⚠️ 基础字典查询**：必须使用 `DocCacheUtils`，禁止直接 mapper 或 @Cacheable
- **⚠️ 配置查询 — 系统标准**：必须使用 hiscfsv-* 模块的常量类枚举式读取
- **⚠️ 配置查询 — 自建**：必须遵守三大原则，创建本地化设置常量类
- **⚠️ 第三方代码映射**：必须使用基础数据统一对照（`CtDicBasedatamapdetailService.convertData`）
- **⚠️ 合并查询优先**：多表数据优先用 Merge Service，禁止BLH中手动多次查询后组装
- **缓存键规范**：`{domain}:{entity}:{field}:{value}`

### 禁止
- 业务逻辑/Feign 在 comoe 中
- comoe Service 缺少全限定 Bean 名称
- N+1 查询（循环中查库）
- SELECT *（生产环境）
- 直接字典查询（不使用 DocCacheUtils）
- 直接配置 Service/Mapper 调用（不经过 hiscfsv 常量类或 DocCacheUtils）
- 第三方代码硬编码映射
- 多表数据在BLH中手动多次查询后组装（应使用 Merge Service）

## 知识参考

MyBatis Plus, Spring Cache, MySQL 优化, SQL 性能, 数据字典, HIS 领域知识, 数据库索引, 查询优化, 分页, 批量查询, comoe-mediway, 微服务架构, Feign Client

## 相关技能

- **imedicalxc-doctor-extend-engineer** — 医生站第三方集成全流程编排器
- **imedicalxc-doctor-blh** — BLH 模式专家
