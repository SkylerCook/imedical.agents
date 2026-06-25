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

**关键架构区分**：系统包含两种根本不同的模块类型：
- **公共库模块（Public Library Modules）** — 如 `comoe-mediway`，提供共享的 Service 实现
- **独立 Boot 应用（Independent Boot Applications）** — 如 `opreg-mediway-boot`、`hispa-mediway-boot`，可部署的微服务

**重要查询模式区分**：
- **业务数据查询（Business Data Query）**：使用标准 MyBatis Plus 查询模式，带分页
- **基础字典查询（Base Dictionary Query）**：**必须使用 `DocCacheUtils` 缓存工具类** — 参见 [基础字典查询规范](#基础字典查询规范)
- **配置数据查询（Configuration Data Query）** — 两种场景：
  1. **系统标准配置（System Standard Config）**：**必须使用 `hiscfsv-*` 模块服务**（如 `hiscfsv-ipcare-docconfig`）
  2. **自建配置（Custom Config）**：**必须使用 `DocCacheUtils`** — 参见 [配置数据](#2-配置数据)

## 模块架构分析

### 1. comoe-mediway — 公共库模式

**模块类型**：公共库（Public Library）— **不可独立部署**

**用途**：为电子医嘱系统提供共享的 Service 实现

**关键特性**：

| 特性 | 说明 |
|----------------|-------------|
| **打包方式（Packaging）** | `pom`（聚合模块） |
| **部署方式（Deployment）** | 不可独立部署，作为 Maven 依赖使用 |
| **服务暴露（Service Exposure）** | 仅提供 Service 接口，无 REST API 或 Feign |
| **Bean 命名（Bean Naming）** | 必须使用全限定名：`@Service("comoe.{module}.{ServiceName}")` |
| **使用模式（Usage Pattern）** | 其他模块依赖 comoe JAR 并注入 Services |

**模块结构**：
```
comoe-mediway/
├── comoe-papatservice/          # 患者域服务
│   └── service/
│       ├── PaPatMastService.java
│       └── PaCardRefService.java
├── comoe-paadmservice/          # 就诊/住院域服务
│   └── service/
│       ├── PaAdmService.java
│       └── PaadmOpService.java
├── comoe-ordservice/            # 医嘱域服务
│   └── service/
│       ├── OeOrderService.java
│       └── OeOrdItemService.java
└── ...
```

**为何将 Service 组织于此**：

1. **通用 SQL 可复用性**：comoe Service 中的 SQL 查询是通用的，可在多个业务模块中复用
2. **跨模块共享**：opcare-mediway-boot、ipcare-mediway-boot、aggcare-mediway-boot 均依赖 comoe Services
3. **统一数据访问**：为患者、就诊、医嘱域提供一致的数据访问模式
4. **无业务流程**：纯数据访问层，无业务工作流编排

**Service 实现模式**：
```java
/**
 * comoe Service — 公共库模式
 * 特点：
 * 1. 需要全限定 Bean 名称
 * 2. 继承 BaseServiceImpl 实现基础 CRUD
 * 3. 使用 @DocThreadLocalCache 进行缓存
 * 4. 无 Feign 客户端，纯数据访问
 */
@Service("comoe.papatservice.PaPatMastService")
public class PaPatMastServiceImpl extends BaseServiceImpl<PaPatMastMapper, PaPatMastPO> 
    implements PaPatMastService {
    
    /**
     * 基础数据缓存模式
     */
    @Override
    @DocThreadLocalCache(key="'comoe.paPatMastService.getPatInfoByPANo'+#patientNo")
    public PaPatMastPO getPatInfoByPANo(String patientNo) {
        LambdaQueryWrapper<PaPatMastPO> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PaPatMastPO::getNo, patientNo);
        return this.baseMapper.selectOne(wrapper);
    }
    
    /**
     * 批量查询模式
     */
    @Override
    public Map<Long, PaPatMastPO> getPatMapByIds(Collection<Long> patientIds) {
        if (CollUtil.isEmpty(patientIds)) {
            return Collections.emptyMap();
        }
        return this.listByIds(patientIds).stream()
            .collect(Collectors.toMap(PaPatMastPO::getId, p -> p));
    }
}
```

**依赖关系**：
```
opcare-mediway-boot (门诊诊疗)
    ├── comoe-paadmservice (JAR 依赖)
    ├── comoe-papatservice (JAR 依赖)
    └── comoe-ordservice (JAR 依赖)

ipcare-mediway-boot (住院诊疗)
    ├── comoe-paadmservice (JAR 依赖)
    ├── comoe-papatservice (JAR 依赖)
    └── comoe-ordservice (JAR 依赖)
```

### 2. 独立 Boot 模块 — 业务应用模式

**模块类型**：独立 Spring Boot 应用（Independent Spring Boot Application）— **可独立部署**

**模块**：
- `opreg-mediway-boot` — 门诊挂号预约（Outpatient registration）
- `opalloc-mediway-boot` — 门诊分诊（Triage queue management）
- `ma-mediway-boot` — 医务管理（Medical administration）
- `hispa-mediway-boot` — 患者主索引（Patient master index）

**关键特性**：

| 特性 | 说明 |
|----------------|-------------|
| **打包方式（Packaging）** | `pom` 带 `-runner` 子模块（可执行 JAR） |
| **部署方式（Deployment）** | 可作为微服务独立部署 |
| **服务暴露（Service Exposure）** | 提供 REST API + Feign 客户端 |
| **Bean 命名（Bean Naming）** | 简单的 `@Service` 或短名称 |
| **使用模式（Usage Pattern）** | 其他模块通过 Feign 或 REST API 调用 |

**Service 实现模式**：
```java
/**
 * opreg-mediway-boot Service — 独立 Boot 模式
 * 特点：
 * 1. 简单的 Bean 命名
 * 2. 可能包含 Feign 客户端用于跨服务调用
 * 3. 业务流程编排
 * 4. 通过依赖注入调用 comoe Services
 */
@Service
public class PaadmOpAppointmentServiceImpl 
    extends BaseServiceImpl<PaadmOpAppointmentMapper, PaadmOpAppointmentPO> 
    implements PaadmOpAppointmentService {
    
    // 通过 JAR 依赖注入 comoe Service
    @Resource(name = "comoe.papatservice.PaPatMastService")
    private PaPatMastService paPatMastService;
    
    // 跨服务调用的 Feign 客户端
    @Resource
    private QueryPaPatClient queryPaPatClient;
    
    /**
     * 带跨服务编排的业务方法
     */
    @Override
    public AppointmentVO createAppointment(AppointmentDTO dto) {
        // 1. 使用 comoe Service 获取患者数据
        PaPatMastPO patient = paPatMastService.getPatInfoByPANo(dto.getPatientNo());
        
        // 2. 通过 Feign 调用其他服务
        PatientDetailVO detail = queryPaPatClient.getPatientDetail(patient.getId());
        
        // 3. 业务逻辑
        // ...
    }
}
```

**与 comoe 的关键差异**：

| 方面 | comoe-mediway | Boot 模块（opreg/opalloc/ma/hispa） |
|--------|---------------|--------------------------------------|
| **部署方式（Deployment）** | 库（JAR） | 微服务（Boot JAR） |
| **REST API** | 无 | 有 |
| **Feign 客户端（Feign Clients）** | 无 | 有（大量使用） |
| **Service Bean 名称（Service Bean Name）** | 全限定：`comoe.xxx.XxxService` | 简单：`xxxService` |
| **业务逻辑（Business Logic）** | 纯数据访问 | 流程编排 |
| **跨服务调用（Cross-Service Call）** | 直接 Service 注入 | Feign + Service 注入 |
| **缓存策略（Cache Strategy）** | @DocThreadLocalCache | Redis/Cache 较少使用 |

### 3. curc-mediway-boot — 独立产品模式

**模块类型**：独立产品开发（Independent Product Development）

**特殊特性**：

| 方面 | curc-mediway-boot | opcare/ipcare |
|--------|-------------------|---------------|
| **业务域（Business Domain）** | 康复治疗（Rehabilitation/Treatment） | 门诊/住院诊疗（Outpatient/Inpatient Care） |
| **模块结构（Module Structure）** | 简化：curc-business（单一模块） | 细粒度：opcare-oeord、opcare-adm 等 |
| **comoe 依赖（comoe Dependency）** | 最小（使用自有数据模型） | 重度（依赖所有 comoe 服务） |
| **代码生成器（Code Generator）** | 有 curc-generator（特有） | 无 |
| **域前缀（Domain Prefix）** | `cu_rc_*`、`curc_*` | `oe_*`、`paadm_op/ip_*` |
| **BLH 继承（BLH Inheritance）** | 独立的 Abstract 类 | 继承自 comoe Abstract |

**为何独立**：
1. **完整业务闭环**：覆盖治疗申请 → 预约 → 执行 → 评估
2. **可选部署**：无康复治疗需求的医院可跳过部署
3. **独立迭代**：可独立版本发布
4. **选择性集成**：通过服务调用与 ipcare/opcare 集成，非紧耦合

**Service 模式**：
```java
/**
 * curc Service — 独立产品模式
 * 特点：
 * 1. 自有数据模型（CuRcApplyPO，不使用 comoe 的）
 * 2. 独立的 Service 层
 * 3. 可能引用 ipcare 配置但业务逻辑独立
 */
@Service(value = "curc.apply.ApplyService")
public class RcApplyServiceImpl extends BaseServiceImpl<CuRcApplyMapper, CuRcApplyPO> 
    implements RcApplyService {
    
    // 使用 curc 自己的 mapper 和 PO，非 comoe 的
    @Override
    public List<CuRcApplyVO> findList(GetCuRcApplyDTO dto) {
        return this.baseMapper.findList(dto);
    }
}
```

## 数据分类与查询规范

### 1. 基础数据（Base Data）

**定义**：整个系统共享的核心系统数据，相对稳定。

**表**：
| 表 | 说明 | Service 位置 |
|-------|-------------|------------------|
| `ss_user` | 用户/人员信息 | hisbase-mediway |
| `ct_loc` | 科室/位置 | hisbase-mediway |
| `ct_hospital` | 医院基本信息 | hisbase-mediway |

**查询模式**：
```java
@Service
public class BaseDataService {
    @Autowired
    private CtLocMapper ctLocMapper;
    
    @Cacheable(value = "base:loc", key = "#locId")
    public CtLoc getLocationById(String locId) {
        return ctLocMapper.selectById(locId);
    }
}
```

### 2. 配置数据（Configuration Data）

**定义**：可按医院/科室定制的业务规则配置。

**⚠️ 关键**：配置数据查询根据配置类型有**两种截然不同的模式**：

#### 2.1 系统标准配置（System Standard Configuration）

**位置**：`hiscfsv-mediway` 模块（如 `hiscfsv-ipcare-docconfig`）

**必须使用**：`hiscfsv-*` 模块封装的配置服务

**原因**：
- 全系统统一的配置管理
- 内置缓存和性能优化
- 支持医院级和科室级定制
- 配置继承（医院 > 科室 > 全局）

**查询模式**：
```java
@Service
public class OrderConfigService {
    
    // 注入 hiscfsv 配置服务（非直接 mapper）
    @Resource
    private DocConfigService docConfigService;  // 来自 hiscfsv-ipcare-docconfig
    
    /**
     * 获取系统标准配置
     * 使用内置缓存和优先级逻辑的 hiscfsv 封装服务
     */
    public String getOrderConfig(String configCode, String hospitalId, String deptId) {
        // 使用 hiscfsv 服务 — 内置缓存和优先级逻辑
        return docConfigService.getConfigValue(configCode, hospitalId, deptId);
    }
    
    /**
     * 获取配置并带默认值
     */
    public boolean isOrderAutoSubmit(String hospitalId) {
        String value = docConfigService.getConfigValue(
            "ORDER_AUTO_SUBMIT", 
            hospitalId, 
            null  // 无科室特定配置
        );
        return "Y".equals(value);
    }
}
```

**可用的 hiscfsv 模块**：
| 模块 | 路径 | 用途 |
|--------|------|---------|
| hiscfsv-ipcare-docconfig | `hiscfsv-mediway/hiscfsv-ipcare/hiscfsv-ipcare-docconfig` | 住院医生站配置 |
| hiscfsv-opcare-docconfig | `hiscfsv-mediway/hiscfsv-opcare/hiscfsv-opcare-docconfig` | 门诊医生站配置 |
| hiscfsv-common | `hiscfsv-mediway/hiscfsv-common` | 系统通用配置 |

#### 2.2 自建配置（Custom Configuration）

**定义**：系统标准配置未覆盖的项目特定或自定义业务配置。

**必须使用**：`DocCacheUtils` 缓存工具类（与基础字典相同）

**原因**：
- 避免直接 Service/Mapper 调用导致性能问题
- 与基础字典数据保持一致的缓存策略
- 降低数据库压力

**查询模式**：
```java
@Service
public class CustomConfigService {
    
    @Autowired
    private CustomCfgMapper customCfgMapper;
    
    /**
     * 获取自建配置 — 必须使用 DocCacheUtils
     */
    public String getCustomConfig(String configCode, String hospitalId) {
        // 使用 DocCacheUtils，非直接 mapper 查询
        CustomCfgPO config = DocCacheUtils.get(
            "cfg:custom:" + configCode + ":" + hospitalId,
            () -> customCfgMapper.selectByCodeAndHospital(configCode, hospitalId),
            3600  // 缓存 1 小时
        );
        
        return config != null ? config.getConfigValue() : null;
    }
    
    /**
     * 按优先级获取配置：医院 > 全局
     */
    public String getConfigWithFallback(String configCode, String hospitalId) {
        // 先尝试医院特定配置
        String value = getCustomConfig(configCode, hospitalId);
        if (StrUtil.isNotBlank(value)) {
            return value;
        }
        
        // 回退到全局配置
        CustomCfgPO globalConfig = DocCacheUtils.get(
            "cfg:custom:" + configCode + ":global",
            () -> customCfgMapper.selectByCode(configCode),
            3600
        );
        
        return globalConfig != null ? globalConfig.getConfigValue() : null;
    }
}
```

#### 配置查询决策矩阵

| 配置类型 | 位置 | 查询方法 | 缓存策略 |
|-------------------|----------|--------------|----------------|
| 系统标准（System Standard） | hiscfsv-* 模块 | 使用 hiscfsv Service | 内置缓存 |
| 自建/项目特定（Custom/Project-specific） | 自定义表 | DocCacheUtils | DocCacheUtils |

**反模式 — 直接 Service/Mapper 查询**：
```java
// 错误：直接 mapper 查询导致性能问题
@Service
public class BadConfigService {
    @Autowired
    private CfgParameterMapper cfgMapper;  // 错误！
    
    public String getConfig(String code) {
        // 错误！无缓存，每次命中数据库
        return cfgMapper.selectByCode(code);
    }
}

// 错误：直接 Service 调用无缓存
@Service
public class BadConfigService {
    @Resource
    private CfgParameterService cfgService;  // 错误！应使用 hiscfsv
    
    public String getConfig(String code) {
        // 错误！Service 调用无缓存层
        return cfgService.getByCode(code);
    }
}

// 正确：通过 hiscfsv 获取系统标准配置
@Service
public class GoodConfigService {
    @Resource
    private DocConfigService docConfigService;  // 正确！
    
    public String getConfig(String code, String hospitalId) {
        return docConfigService.getConfigValue(code, hospitalId, null);
    }
}

// 正确：通过 DocCacheUtils 获取自建配置
@Service
public class GoodCustomConfigService {
    @Autowired
    private CustomCfgMapper customCfgMapper;  // 自建配置可以
    
    public String getConfig(String code, String hospitalId) {
        return DocCacheUtils.get(  // 正确！使用缓存
            "cfg:custom:" + code + ":" + hospitalId,
            () -> customCfgMapper.selectByCodeAndHospital(code, hospitalId),
            3600
        );
    }
}
```

### 3. 业务数据（Business Data）

**定义**：来自临床操作的事务性数据。

**按模块的数据**：

#### 3.1 患者域（hispa-mediway-boot）
| 表前缀 | 示例 | Service |
|--------------|----------|---------|
| `pa_` | pa_patient, pa_patmas | PaPatMastService (comoe) |
| `paadm_` | paadm | PaAdmService (comoe) |

#### 3.2 门诊诊疗（opcare-mediway-boot）
| 表前缀 | 示例 | Service |
|--------------|----------|---------|
| `oe_op_` | oe_op_order | 使用 comoe-ordservice |
| `mr_op_` | mr_op_diagnosis | 使用 commr-mediway |

#### 3.3 住院诊疗（ipcare-mediway-boot）
| 表前缀 | 示例 | Service |
|--------------|----------|---------|
| `oe_ip_` | oe_ip_order | 使用 comoe-ordservice |
| `mr_ip_` | mr_ip_diagnosis | 使用 commr-mediway |

#### 3.4 通用医嘱（comoe-mediway）
| 表前缀 | 示例 | Service 位置 |
|--------------|----------|------------------|
| `oe_` | oe_orditem, oe_ordexec | comoe-ordservice |

**comoe 中的查询模式**：
```java
@BLH(value="opcare.doctor.OrderQueryBLH", version="1.0.0")
public class OrderQueryBLH extends OrderQueryAbstract {
    
    // 注入 comoe Service
    @Resource(name = "comoe.ordservice.OeOrdItemService")
    private OeOrdItemService oeOrdItemService;
    
    public IPage<OeOrditemVO> queryOrders(EsbBaseDTO<OrderQueryDTO> dto) {
        // 参数校验
        if (dto == null || dto.getData() == null) {
            throw HisBusinessException.build("查询参数不能为空");
        }
        
        OrderQueryDTO queryDTO = dto.getData();
        
        // 通过 comoe Service 构建查询
        LambdaQueryWrapper<OeOrdItemPO> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(OeOrdItemPO::getEpisodeId, queryDTO.getEpisodeId());
        
        if (StrUtil.isNotBlank(queryDTO.getOrderType())) {
            wrapper.eq(OeOrdItemPO::getOrderType, queryDTO.getOrderType());
        }
        
        wrapper.orderByDesc(OeOrdItemPO::getOrderDate);
        
        // 执行查询
        IPage<OeOrdItemPO> page = new Page<>(queryDTO.getPageNum(), queryDTO.getPageSize());
        page = oeOrdItemService.page(page, wrapper);
        
        return convertToVO(page);
    }
}
```

## 基础字典查询规范（Base Dictionary Query Guidelines）

**⚠️ 关键**：对于基础字典数据查询（基础字典读取），**必须使用 `DocCacheUtils` 缓存工具类**，禁止直接查询数据库。

### 什么是基础字典数据

基础字典数据包括：
| 字典类型 | 表示例 | 说明 |
|----------------|----------------|-------------|
| ICD 诊断 | `mr_icddx`、`mr_icddx_ext` | 诊断编码 |
| 药品目录 | `phc_drug`、`phc_drugmast` | 药品信息 |
| 检查项目 | `dhc_examitem`、`dhc_examcat` | 检查项目 |
| 检验项目 | `dhc_labitem`、`dhc_labcat` | 检验项目 |
| 科室 | `ct_loc`、`ct_locgroup` | 科室/位置信息 |
| 用户/人员 | `ss_user`、`ss_group` | 用户信息 |
| 医院 | `ct_hospital` | 医院基本信息 |

### DocCacheUtils 使用模式

**位置**：`com.mediway.his.base.cache.utils.DocCacheUtils`

```java
/**
 * 基础字典查询 — 必须使用 DocCacheUtils
 * 确保一致的缓存和性能
 */
@Service
public class DictionaryQueryService {
    
    /**
     * 按编码获取字典 — 使用 DocCacheUtils
     */
    public MrIcddxPO getDiagnosisByCode(String icdCode) {
        // 使用 DocCacheUtils 替代直接 mapper 查询
        return DocCacheUtils.get(
            "mr:icddx:code:" + icdCode,
            () -> mrIcddxMapper.selectByCode(icdCode),
            3600  // 缓存秒数
        );
    }
    
    /**
     * 按 ID 获取科室 — 使用 DocCacheUtils
     */
    public CtLocPO getLocationById(String locId) {
        return DocCacheUtils.get(
            "ct:loc:id:" + locId,
            () -> ctLocMapper.selectById(locId),
            7200  // 缓存 2 小时
        );
    }
    
    /**
     * 获取药品信息 — 使用 DocCacheUtils
     */
    public PhcDrugPO getDrugByCode(String drugCode) {
        return DocCacheUtils.get(
            "phc:drug:code:" + drugCode,
            () -> phcDrugMapper.selectByCode(drugCode),
            3600
        );
    }
    
    /**
     * 带缓存的批量获取 — 使用 DocCacheUtils
     */
    public Map<String, MrIcddxPO> getDiagnosisMapByCodes(List<String> codes) {
        Map<String, MrIcddxPO> result = new HashMap<>();
        
        for (String code : codes) {
            MrIcddxPO diagnosis = DocCacheUtils.get(
                "mr:icddx:code:" + code,
                () -> mrIcddxMapper.selectByCode(code),
                3600
            );
            if (diagnosis != null) {
                result.put(code, diagnosis);
            }
        }
        
        return result;
    }
}
```

### DocCacheUtils API 参考

```java
/**
 * DocCacheUtils — 基础字典数据缓存工具
 */
public class DocCacheUtils {
    
    /**
     * 从缓存获取或从数据库加载
     * @param key 缓存键
     * @param loader 数据加载函数
     * @param expireSeconds 缓存过期时间（秒）
     * @return 缓存或加载的数据
     */
    public static <T> T get(String key, Supplier<T> loader, long expireSeconds);
    
    /**
     * 从缓存获取或从数据库加载（使用默认过期时间）
     * @param key 缓存键
     * @param loader 数据加载函数
     * @return 缓存或加载的数据
     */
    public static <T> T get(String key, Supplier<T> loader);
    
    /**
     * 将数据放入缓存
     * @param key 缓存键
     * @param value 要缓存的数据
     * @param expireSeconds 缓存过期时间（秒）
     */
    public static <T> void put(String key, T value, long expireSeconds);
    
    /**
     * 从缓存移除
     * @param key 缓存键
     */
    public static void evict(String key);
    
    /**
     * 按模式清除缓存
     * @param pattern 键模式（支持通配符 *）
     */
    public static void clear(String pattern);
}
```

### 缓存键命名规范

```
{domain}:{entity}:{field}:{value}

示例：
- mr:icddx:code:A01.001          # 按编码查询 ICD 诊断
- ct:loc:id:1001                 # 按 ID 查询科室
- phc:drug:code:DRG001           # 按编码查询药品
- ss:user:id:5001                # 按 ID 查询用户
```

### 常用字典查询示例

```java
@Service
public class CommonDictionaryService {
    
    @Autowired
    private MrIcddxMapper mrIcddxMapper;
    @Autowired
    private CtLocMapper ctLocMapper;
    @Autowired
    private PhcDrugMapper phcDrugMapper;
    @Autowired
    private SsUserMapper ssUserMapper;
    
    // ICD 诊断
    public MrIcddxPO getIcdDiagnosis(String icdCode) {
        return DocCacheUtils.get(
            "mr:icddx:code:" + icdCode,
            () -> mrIcddxMapper.selectByCode(icdCode),
            3600
        );
    }
    
    // 科室
    public CtLocPO getDepartment(String locId) {
        return DocCacheUtils.get(
            "ct:loc:id:" + locId,
            () -> ctLocMapper.selectById(locId),
            7200
        );
    }
    
    // 药品
    public PhcDrugPO getDrug(String drugCode) {
        return DocCacheUtils.get(
            "phc:drug:code:" + drugCode,
            () -> phcDrugMapper.selectByCode(drugCode),
            3600
        );
    }
    
    // 用户
    public SsUserPO getUser(String userId) {
        return DocCacheUtils.get(
            "ss:user:id:" + userId,
            () -> ssUserMapper.selectById(userId),
            1800  // 用户数据缓存时间较短
        );
    }
}
```

### 字典查询反模式

```java
// 错误：无缓存直接查询数据库
@Service
public class BadDictionaryService {
    @Autowired
    private MrIcddxMapper mrIcddxMapper;
    
    public MrIcddxPO getDiagnosis(String code) {
        // 错误！无缓存，每次命中数据库
        return mrIcddxMapper.selectByCode(code);
    }
}

// 错误：使用 @Cacheable 替代 DocCacheUtils
@Service
public class BadDictionaryService {
    @Cacheable(value = "icd", key = "#code")  // 错误！应使用 DocCacheUtils
    public MrIcddxPO getDiagnosis(String code) {
        return mrIcddxMapper.selectByCode(code);
    }
}

// 正确：使用 DocCacheUtils（必需）
@Service
public class GoodDictionaryService {
    @Autowired
    private MrIcddxMapper mrIcddxMapper;
    
    public MrIcddxPO getDiagnosis(String code) {
        return DocCacheUtils.get(
            "mr:icddx:code:" + code,
            () -> mrIcddxMapper.selectByCode(code),
            3600
        );
    }
}
```

### 何时使用 DocCacheUtils

**必须使用 DocCacheUtils**：
- ICD 诊断查询
- 药品目录查询
- 科室/位置查询
- 用户/人员查询
- 医院信息查询
- 任何基础字典表查询

**不要使用 DocCacheUtils**（改用标准模式）：
- 业务数据查询（医嘱、就诊、记录）
- 患者特定数据
- 事务性数据
- 实时变化的数据

## 代码组织规范

### 目录结构

```
com.mediway.his.{module}.{component}/
├── blh/                           # Business Logic Handler（业务逻辑处理器）
│   ├── base/                      # 基础数据 BLH
│   ├── config/                    # 配置 BLH
│   └── {domain}/                  # 业务域 BLH
│       ├── {Feature}Abstract.java # 抽象基类
│       └── {Feature}BLH.java      # 具体实现
├── service/                       # Service 层
│   ├── base/                      # 基础数据 service
│   ├── config/                    # 配置 service
│   └── {domain}/                  # 业务域 service
│       └── {Entity}Service.java
├── mapper/                        # 数据访问层
│   ├── base/                      # 基础数据 mapper
│   ├── config/                    # 配置 mapper
│   └── {domain}/                  # 业务域 mapper
│       └── {Entity}Mapper.java
└── model/                         # 数据模型
    ├── dto/                       # Data Transfer Objects（数据传输对象）
    ├── vo/                        # View Objects（视图对象）
    └── entity/                    # Entity classes（实体类）
```

### Service 层模式

#### 模式 1：comoe 公共库 Service

**适用场景**：为患者/就诊/医嘱域创建通用、可复用的 Services

```java
/**
 * comoe Service 模板
 * - 全限定 Bean 名称
 * - 通用数据访问
 * - 缓存支持
 * - 无业务工作流
 */
public interface PaAdmService extends BaseService<PaadmPO> {
    List<PaadmInfoVO> getPaadmByPatId(PaadmGetByPatientIdDTO dto);
    Map<Long, String> getAdmType(Collection<Long> episodeIds);
}

@Service("comoe.adm.paAdmService")
public class PaAdmServiceImpl extends BaseServiceImpl<PaadmMapper, PaadmPO> 
    implements PaAdmService {
    
    @Override
    @DocThreadLocalCache(key = "'comoe.paadmservice.getAdmType'+#episodeId")
    public String getAdmType(Long episodeId) {
        return lambdaQuery()
            .select(PaadmPO::getAdmtype)
            .eq(PaadmPO::getId, episodeId)
            .one().getAdmtype();
    }
}
```

#### 模式 2：Boot 模块业务 Service

**适用场景**：在独立 Boot 模块中创建业务特定的 Services

```java
/**
 * Boot 模块 Service 模板
 * - 简单的 Bean 命名
 * - 业务编排
 * - Feign 客户端集成
 * - 调用 comoe Services
 */
@Service
public class OpregRegServiceImpl implements OpregRegService {
    
    // 注入 comoe Service
    @Resource(name = "comoe.adm.paAdmService")
    private PaAdmService paAdmService;
    
    // 跨服务调用的 Feign 客户端
    @Resource
    private QueryPaPatClient queryPaPatClient;
    
    // 复杂业务逻辑的 BLH
    @Resource
    private SchedulePortalBLH schedulePortalBLH;
    
    @Override
    public RegistrationVO registerPatient(RegistrationDTO dto) {
        // 1. 通过 comoe 获取患者
        PaadmPO adm = paAdmService.getById(dto.getEpisodeId());
        
        // 2. 通过 Feign 调用其他服务
        PatientVO patient = queryPaPatClient.getPatient(adm.getPatientId());
        
        // 3. 通过 BLH 执行业务逻辑
        return schedulePortalBLH.processRegistration(dto);
    }
}
```

#### 模式 3：独立产品 Service（curc）

**适用场景**：为 curc 等独立产品创建 Services

```java
/**
 * 独立产品 Service 模板
 * - 自有数据模型
 * - 独立于 comoe
 * - 可能引用其他配置
 */
@Service(value = "curc.apply.ApplyService")
public class RcApplyServiceImpl extends BaseServiceImpl<CuRcApplyMapper, CuRcApplyPO> 
    implements RcApplyService {
    
    // 使用 curc 自己的 PO 和 mapper
    @Override
    public List<CuRcApplyVO> findList(GetCuRcApplyDTO dto) {
        return this.baseMapper.findList(dto);
    }
}
```

## 查询最佳实践

### 1. 模块选择规范

**何时将 Service 添加到 comoe-mediway**：
- SQL 是通用的，可在多个模块中复用
- 属于患者/就诊/医嘱核心域
- 无业务流程逻辑，纯数据访问
- 被 opcare、ipcare、aggcare 使用

**何时将 Service 添加到 Boot 模块**：
- 业务特定逻辑
- 需要 Feign 调用其他服务
- 需要工作流编排
- 特定于某一业务域（挂号、分诊等）

### 2. 正确使用 MyBatis Plus

```java
// 正确：使用 LambdaQueryWrapper 保证类型安全
LambdaQueryWrapper<OrderPO> wrapper = new LambdaQueryWrapper<>();
wrapper.eq(OrderPO::getStatus, "A")
       .ge(OrderPO::getCreateDate, startDate)
       .orderByDesc(OrderPO::getCreateDate);

// 错误：避免基于字符串的列名
wrapper.eq("status", "A")
       .ge("create_date", startDate);
```

### 3. 分页规则

```java
// 正确：始终使用分页
public IPage<OrderVO> queryOrders(OrderQueryDTO dto) {
    IPage<OrderPO> page = new Page<>(dto.getPageNum(), dto.getPageSize());
    // 最大分页大小限制
    if (dto.getPageSize() > 500) {
        dto.setPageSize(500);
    }
    return orderMapper.selectPage(page, wrapper);
}
```

### 4. 防止 N+1 查询

```java
// 错误：N+1 查询
List<OrderPO> orders = orderMapper.selectList(wrapper);
for (OrderPO order : orders) {
    PatientPO patient = patientMapper.selectById(order.getPatientId());
    order.setPatientName(patient.getName());
}

// 正确：批量查询
List<OrderPO> orders = orderMapper.selectList(wrapper);
List<String> patientIds = orders.stream()
    .map(OrderPO::getPatientId)
    .distinct()
    .collect(Collectors.toList());
Map<String, PatientPO> patientMap = patientMapper
    .selectBatchIds(patientIds)
    .stream()
    .collect(Collectors.toMap(PatientPO::getId, p -> p));
```

### 5. 按模块类型的缓存策略

```java
// comoe-mediway：使用 @DocThreadLocalCache
@Service("comoe.papatservice.PaPatMastService")
public class PaPatMastServiceImpl implements PaPatMastService {
    @Override
    @DocThreadLocalCache(key="'comoe.paPatMastService.getById'+#id")
    public PaPatMastPO getById(Long id) {
        return super.getById(id);
    }
}

// Boot 模块：业务数据使用 Redis 或不使用缓存
@Service
public class OpregRegServiceImpl implements OpregRegService {
    @Cacheable(value = "opreg:schedule", key = "#scheduleId")
    public ScheduleVO getSchedule(String scheduleId) {
        // 带 Redis 缓存的业务数据
    }
}
```

## 跨模块数据访问

### 从 Boot 模块调用 comoe Services

```java
@Service
public class OpCareOrderServiceImpl implements OpCareOrderService {
    
    // 通过全限定名注入 comoe Service
    @Resource(name = "comoe.ordservice.OeOrdItemService")
    private OeOrdItemService oeOrdItemService;
    
    @Resource(name = "comoe.paadmservice.PaAdmService")
    private PaAdmService paAdmService;
    
    public OrderDetailVO getOrderDetail(Long orderId) {
        // 使用 comoe Service 进行通用数据访问
        OeOrdItemPO order = oeOrdItemService.getById(orderId);
        PaadmPO adm = paAdmService.getById(order.getEpisodeId());
        
        // 转换为 VO 并添加业务逻辑
        return convertToVO(order, adm);
    }
}
```

### Feign 客户端 vs Service 注入

**使用 Service 注入（comoe）**：
- 同一 JVM 内（同一 Boot 模块）
- 通用数据访问
- 无网络开销

**使用 Feign 客户端**：
- 跨微服务调用
- 不同的 Boot 模块
- 需要网络通信

```java
@Service
public class OpregServiceImpl {
    // Service 注入 — 同一 JVM，无网络
    @Resource(name = "comoe.papatservice.PaPatMastService")
    private PaPatMastService paPatMastService;
    
    // Feign 客户端 — 跨服务，网络调用
    @Resource
    private QueryPaPatClient queryPaPatClient;
    
    public PatientVO getPatient(String patientNo) {
        // 选项 1：使用 comoe Service（更快，同一 JVM）
        PaPatMastPO patient = paPatMastService.getPatInfoByPANo(patientNo);
        
        // 选项 2：使用 Feign（跨服务，如需要）
        PatientVO vo = queryPaPatClient.getPatientByNo(patientNo);
    }
}
```

## 常见反模式

### 1. Service 放错模块

```java
// 错误：将业务特定 Service 添加到 comoe
@Service("comoe.opreg.AppointmentService")  // 错误！opreg 是业务特定的
public class AppointmentServiceImpl { }

// 正确：业务 Services 应放在 Boot 模块
@Service
public class PaadmOpAppointmentServiceImpl  // 在 opreg-mediway-boot 中
    implements PaadmOpAppointmentService { }
```

### 2. comoe 中缺少 Bean 名称

```java
// 错误：comoe Service 无全限定名
@Service  // 缺少名称！
public class PaAdmServiceImpl implements PaAdmService { }

// 正确：全限定 Bean 名称
@Service("comoe.adm.paAdmService")
public class PaAdmServiceImpl implements PaAdmService { }
```

### 3. 循环中查询

```java
// 错误：N+1 查询
for (String orderId : orderIds) {
    OrderPO order = orderMapper.selectById(orderId);  // N 次查询
}

// 正确：批量查询
List<OrderPO> orders = orderMapper.selectBatchIds(orderIds);  // 1 次查询
```

## 输出模板

### 模板：comoe Service 创建

```markdown
## comoe Service 创建规范

### 服务信息
- **服务名称**：{ServiceName}
- **所属模块**：comoe-{module} (papatservice/paadmservice/ordservice)
- **数据域**：{patient/admission/order}
- **通用性**：[是否被多个模块使用]

### 代码实现

#### 1. 接口定义
```java
public interface {Entity}Service extends BaseService<{Entity}PO> {
    /**
     * 批量查询方法
     */
    Map<Long, {Entity}PO> getMapByIds(Collection<Long> ids);
    
    /**
     * 带缓存的单个查询
     */
    {Entity}PO getByCode(String code);
}
```

#### 2. 实现类
```java
@Service("comoe.{module}.{Entity}Service")
public class {Entity}ServiceImpl extends BaseServiceImpl<{Entity}Mapper, {Entity}PO> 
    implements {Entity}Service {
    
    @Override
    @DocThreadLocalCache(key="'comoe.{module}.{Entity}Service.getByCode'+#code")
    public {Entity}PO getByCode(String code) {
        LambdaQueryWrapper<{Entity}PO> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq({Entity}PO::getCode, code);
        return this.baseMapper.selectOne(wrapper);
    }
    
    @Override
    public Map<Long, {Entity}PO> getMapByIds(Collection<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            return Collections.emptyMap();
        }
        return this.listByIds(ids).stream()
            .collect(Collectors.toMap({Entity}PO::getId, e -> e));
    }
}
```

### 使用说明
- **Bean 名称**：`comoe.{module}.{Entity}Service`
- **注入方式**：`@Resource(name = "comoe.{module}.{Entity}Service")`
- **缓存策略**：使用 `@DocThreadLocalCache`
- **适用场景**：基础数据查询，被 opcare/ipcare/aggcare 共用
```

### 模板：Boot 模块 Service 创建

```markdown
## Boot 模块 Service 创建规范

### 服务信息
- **服务名称**：{ServiceName}
- **所属模块**：{module}-mediway-boot
- **业务域**：{registration/triage/medical-admin/patient-index}
- **是否调用 comoe**：[是/否]

### 代码实现

#### 1. 接口定义
```java
public interface {Business}Service {
    {Business}VO process{Action}({Business}DTO dto);
}
```

#### 2. 实现类
```java
@Service
public class {Business}ServiceImpl implements {Business}Service {
    
    // 注入 comoe Services
    @Resource(name = "comoe.{module}.{Entity}Service")
    private {Entity}Service {entity}Service;
    
    // 跨服务调用的 Feign 客户端
    @Resource
    private {Other}Client {other}Client;
    
    // 复杂逻辑的 BLH
    @Resource
    private {Business}BLH {business}BLH;
    
    @Override
    public {Business}VO process{Action}({Business}DTO dto) {
        // 1. 从 comoe 获取基础数据
        {Entity}PO entity = {entity}Service.getById(dto.getId());
        
        // 2. 如需要，通过 Feign 调用其他服务
        {Other}VO other = {other}Client.getData(dto.getOtherId());
        
        // 3. 通过 BLH 执行业务逻辑
        return {business}BLH.process(dto, entity, other);
    }
}
```

### 依赖说明
- **comoe 依赖**：通过 Maven 引入，直接 Service 注入
- **跨服务调用**：使用 Feign Client
- **业务逻辑**：委托给 BLH 层处理
```

### 模板：基础字典查询（Base Dictionary Query）

```markdown
## 基础字典查询规范（使用 DocCacheUtils）

### 字典信息
- **字典类型**：[ICD/Drug/Department/User/Hospital 等]
- **数据表**：[表名]
- **查询场景**：[场景描述]

### 代码实现

#### 1. Service 层
```java
@Service
public class {DictType}DictionaryService {
    
    @Autowired
    private {Entity}Mapper {entity}Mapper;
    
    /**
     * 按编码查询 — 使用 DocCacheUtils（必需）
     */
    public {Entity}PO getByCode(String code) {
        // 必须使用 DocCacheUtils，禁止直接 mapper 查询
        return DocCacheUtils.get(
            "{domain}:{entity}:code:" + code,
            () -> {entity}Mapper.selectByCode(code),
            3600  // 缓存 1 小时
        );
    }
    
    /**
     * 按 ID 查询 — 使用 DocCacheUtils（必需）
     */
    public {Entity}PO getById(String id) {
        return DocCacheUtils.get(
            "{domain}:{entity}:id:" + id,
            () -> {entity}Mapper.selectById(id),
            7200  // 缓存 2 小时
        );
    }
    
    /**
     * 批量查询 — 使用 DocCacheUtils（必需）
     */
    public Map<String, {Entity}PO> getMapByCodes(List<String> codes) {
        Map<String, {Entity}PO> result = new HashMap<>();
        
        for (String code : codes) {
            {Entity}PO entity = DocCacheUtils.get(
                "{domain}:{entity}:code:" + code,
                () -> {entity}Mapper.selectByCode(code),
                3600
            );
            if (entity != null) {
                result.put(code, entity);
            }
        }
        
        return result;
    }
    
    /**
     * 清除缓存
     */
    public void clearCache(String code) {
        DocCacheUtils.evict("{domain}:{entity}:code:" + code);
    }
}
```

#### 2. 使用示例
```java
@Service
public class OrderService {
    
    @Autowired
    private IcdDictionaryService icdDictionaryService;
    
    public OrderVO enrichWithDiagnosis(OrderPO order) {
        OrderVO vo = new OrderVO();
        BeanUtil.copyProperties(order, vo);
        
        // 使用 DocCacheUtils 查询基础字典
        MrIcddxPO diagnosis = icdDictionaryService.getByCode(order.getDiagCode());
        if (diagnosis != null) {
            vo.setDiagName(diagnosis.getName());
            vo.setDiagDesc(diagnosis.getDescription());
        }
        
        return vo;
    }
}
```

### 规范要点
1. **必须使用 DocCacheUtils**：所有基础字典查询必须通过 DocCacheUtils
2. **缓存键格式**：使用 `{domain}:{entity}:{field}:{value}` 格式
3. **过期时间**：根据数据变化频率设置，通常 3600-7200 秒
4. **批量查询**：循环中每个查询都要使用 DocCacheUtils
5. **缓存清除**：数据变更时及时清除缓存

### 常见字典类型参考
| 字典类型 | Domain | Entity | 缓存时间 |
|---------|--------|--------|---------|
| ICD 诊断 | mr | icddx | 3600s |
| 药品 | phc | drug | 3600s |
| 科室 | ct | loc | 7200s |
| 用户 | ss | user | 1800s |
| 医院 | ct | hospital | 7200s |
```

### 模板：配置数据查询（Configuration Data Query）

```markdown
## 配置数据查询规范

### 配置类型判断
- **配置类型**：[系统标准配置 / 自建配置]
- **配置编码**：[configCode]
- **使用场景**：[场景描述]

### 场景 1：系统标准配置（使用 hiscfsv-* 模块）

#### 1. 确定 hiscfsv 模块
- **所属模块**：[hiscfsv-ipcare-docconfig / hiscfsv-opcare-docconfig / hiscfsv-common]
- **配置分类**：[医生站配置 / 系统通用配置]

#### 2. 代码实现
```java
@Service
public class {Feature}ConfigService {
    
    // 注入 hiscfsv 配置服务（必需）
    @Resource
    private DocConfigService docConfigService;  // 来自 hiscfsv-* 模块
    
    /**
     * 获取系统标准配置
     */
    public String get{Feature}Config(String hospitalId, String deptId) {
        // 使用带内置缓存的 hiscfsv 服务
        return docConfigService.getConfigValue(
            "{CONFIG_CODE}", 
            hospitalId, 
            deptId
        );
    }
    
    /**
     * 获取配置并转换为特定类型
     */
    public boolean is{Feature}Enabled(String hospitalId) {
        String value = docConfigService.getConfigValue(
            "{FEATURE_ENABLED}", 
            hospitalId, 
            null
        );
        return "Y".equalsIgnoreCase(value) || "true".equalsIgnoreCase(value);
    }
}
```

#### 3. 配置优先级
系统自动处理优先级：
1. 科室级配置（deptId）
2. 院级配置（hospitalId）
3. 全局默认配置

### 场景 2：自建配置（使用 DocCacheUtils）

#### 1. 配置信息
- **配置表**：[custom_cfg / project_cfg]
- **配置级别**：[医院级 / 全局]
- **缓存策略**：[缓存时间]

#### 2. 代码实现
```java
@Service
public class {Project}CustomConfigService {
    
    @Autowired
    private {Project}CfgMapper {project}CfgMapper;
    
    /**
     * 获取自建配置 — 使用 DocCacheUtils（必需）
     */
    public String getCustomConfig(String configCode, String hospitalId) {
        // 必须使用 DocCacheUtils
        {Project}CfgPO config = DocCacheUtils.get(
            "cfg:{project}:" + configCode + ":" + hospitalId,
            () -> {project}CfgMapper.selectByCodeAndHospital(configCode, hospitalId),
            3600  // 缓存 1 小时
        );
        
        if (config != null && StrUtil.isNotBlank(config.getConfigValue())) {
            return config.getConfigValue();
        }
        
        // 回退到全局配置
        {Project}CfgPO globalConfig = DocCacheUtils.get(
            "cfg:{project}:" + configCode + ":global",
            () -> {project}CfgMapper.selectByCode(configCode),
            3600
        );
        
        return globalConfig != null ? globalConfig.getConfigValue() : null;
    }
    
    /**
     * 清除配置缓存
     */
    public void clearConfigCache(String configCode, String hospitalId) {
        DocCacheUtils.evict("cfg:{project}:" + configCode + ":" + hospitalId);
        DocCacheUtils.evict("cfg:{project}:" + configCode + ":global");
    }
}
```

### 规范要点
1. **系统标准配置**：必须使用 hiscfsv-* 模块的封装 Service
2. **自建配置**：必须使用 DocCacheUtils，禁止直接调用 Service/Mapper
3. **缓存键格式**：使用 `cfg:{project}:{code}:{scope}` 格式
4. **配置优先级**：医院级 > 全局，通过代码或 hiscfsv 自动处理
5. **缓存清除**：配置变更时必须清除缓存

### 常见 hiscfsv 模块参考
| 模块 | 路径 | 用途 |
|------|------|------|
| hiscfsv-ipcare-docconfig | hiscfsv-mediway/hiscfsv-ipcare/hiscfsv-ipcare-docconfig | 住院医生站配置 |
| hiscfsv-opcare-docconfig | hiscfsv-mediway/hiscfsv-opcare/hiscfsv-opcare-docconfig | 门诊医生站配置 |
| hiscfsv-common | hiscfsv-mediway/hiscfsv-common | 系统通用配置 |
```

## 医保对照数据获取

第三方医保相关集成（如医保上传、医保控费、医保支付等）经常需要把 HIS 内部标识转换为医保标准编码。以下是医生站常见医保对照数据的获取路径与代码示例。

> **⚠️ 两类医保数据获取路径**：HIS 中获取医保编码存在两种截然不同的路径，不可混淆：
> - **实体直接字段**（§1–§2）：医院、医护人员的医保编码直接存储在对应实体表字段中（`CtOrgHospitalPO.insuCode`、`CtRbCareprovPO.insuCode`），通过 `DocCacheUtils.getByKey` 直接查询实体即可获取，**不走** `ct_ar_insu_dicdatacon` 字典对照流程。
> - **字典对照映射**（§3–§6）：科室、诊断类型、医生级别、性别、票据类型、用药频次等通用字典的医保编码，存储在 `ct_ar_insu_dicdatacon` 表中，必须通过 `ArInsuOpInvokeAbstract.queryDicdataconByChargetype()` 的两步 Feign 调用（`getInsuListType` → `queryDicdataconList`）获取，不可用 `DocCacheUtils` 直接查。

### 1. 医院医保编码 / 名称

- **数据实体**：`com.mediway.his.hiscore.ct.model.entity.org.CtOrgHospitalPO`
- **字段**：`insuCode`（医保标准编码）、`insuDesc`（医保标准名称）
- **数据类型**：基础字典
- **获取方式**：`DocCacheUtils.getByKey`（基础字典统一缓存）

```java
import com.mediway.his.hisbase.doc.utils.DocCacheUtils;
import com.mediway.his.hiscore.ct.model.entity.org.CtOrgHospitalPO;

CtOrgHospitalPO hospital = DocCacheUtils.getByKey(
    CtOrgHospitalPO.class,
    loginUserInfo.getHospId()   // 院区/医院 ID
);
if (hospital != null) {
    String hosInsuCode = hospital.getInsuCode(); // 医院医保编码
    String hosInsuDesc = hospital.getInsuDesc(); // 医院医保名称
}
```

### 2. 医护人员医保编码 / 名称

- **数据实体**：`com.mediway.his.hiscore.ct.model.entity.rb.CtRbCareprovPO`
- **字段**：`insuCode`（医保标准编码）、`insuDesc`（医保标准名称）
- **数据类型**：基础字典
- **获取方式**：`DocCacheUtils.getByKey`

```java
import com.mediway.his.hiscore.ct.model.entity.rb.CtRbCareprovPO;

CtRbCareprovPO careprov = DocCacheUtils.getByKey(
    CtRbCareprovPO.class,
    docId   // 医护人员 ID（如就诊主表中的 admDocDr）
);
if (careprov != null) {
    String drInsuCode = careprov.getInsuCode(); // 医师医保编码
    String drInsuDesc = careprov.getInsuDesc(); // 医师医保名称
}
```

### 3. 医嘱项 / 收费项与医保目录对照

- **入口抽象类**：`com.mediway.his.comoe.ordinvoke.blh.ar.insu.ArInsuOpInvokeAbstract`
- **可注入 BLH**：`arInsuOpInvokeBLH`（实现类位于 `com.mediway.his.comoe.ordinvoke.blh.ar.insu.ext.ArInsuOpInvokeBLH`）
- **数据类型**：业务数据（医保目录对照）
- **已封装方法**：
  - `getArcimLinkInsuInfo(GetArcimLinkInsuInfoDTO dto)` — 单个医嘱项获取关联医保目录信息
  - `getArcimLinkInsuInfo(List<CtOeItmmastLinkInsuDTO> dtos)` — 批量获取，返回 `Map<itmmastId, List<CtArInsuTaritemsLinkVO>>`
  - `getItmmastLinkInsuForSpecial(GetArcimLinkInsuInfoDTO dto)` — 特殊对照项目
- **内部调用**：通过 `ArInsuCtApi`（`com.mediway.his.insu.api`）Feign 接口访问医保服务

```java
@Resource(name = "arInsuOpInvokeBLH")
private ArInsuOpInvokeBLH arInsuOpInvokeBLH;

public void enrichOrderItemInsuInfo(List<OeOrdItemDTO> orderItems) {
    List<CtOeItmmastLinkInsuDTO> dtos = orderItems.stream()
        .map(item -> {
            CtOeItmmastLinkInsuDTO dto = new CtOeItmmastLinkInsuDTO();
            dto.setItmmastId(item.getItmMastDr());
            dto.setStartDate(new Date());
            // 按需设置 hospitalDr、chargetypeId 等
            return dto;
        }).collect(Collectors.toList());

    Map<Long, List<CtArInsuTaritemsLinkVO>> insuMap =
        arInsuOpInvokeBLH.getArcimLinkInsuInfo(dtos);

    orderItems.forEach(item -> {
        List<CtArInsuTaritemsLinkVO> insuList = insuMap.get(item.getItmMastDr());
        if (CollUtil.isNotEmpty(insuList)) {
            CtArInsuTaritemsLinkVO vo = insuList.get(0);
            item.setInsuItemCode(vo.getItemCode());
            item.setInsuItemName(vo.getItemName());
        }
    });
}
```

### 4. 诊断 ICD 与医保目录对照

- **入口抽象类**：`com.mediway.his.commr.diainvoke.blh.insu.MRDiagnosInsuInvokeAbstract`
- **可注入 BLH**：`mRDiagnosInsuInvokeBLH`（实现类位于 `commr-diainvoke/blh/insu/ext`）
- **已封装方法**：
  - `selectIcdContInfoList(List<Long> icdIds, Long hospId, Long chargetypeId)` — 批量获取诊断医保对照信息
- **内部调用**：同样通过 `ArInsuCtApi` Feign 接口

### 5. 新增医保对照查询方法的原则

如果 `ArInsuOpInvokeAbstract`（医嘱/收费项）或 `MRDiagnosInsuInvokeAbstract`（诊断）中**不存在**需要的医保对照接口：

1. **优先在对应的 Abstract 类中新增方法**，不要在 Controller/BLH 业务层直接调用 `ArInsuCtApi`。
2. **遵循已有模式**：
   - 将业务 DTO 转换为医保模块 DTO（`CtXxxDTO`）
   - 调用 `arInsuCtApi.xxx(...)`
   - 判断 `BaseResponse.isSuccess()`
   - 成功：将结果 VO 复制到业务 VO 后返回
   - 失败：抛出 `HisBusinessException.rpcException(...)`，错误前缀使用 `CtApplicationEnum.INSU.getErrNamePre("...")`
3. **将方法暴露为 BLH**：在 `comoe-ordinvoke` 或 `commr-diainvoke` 的 `ext` 包下创建/使用 `@BLH` 实现类，使 opcare/ipcare 可以通过 `@Resource(name = "...")` 注入复用。

示例模板（在 `ArInsuOpInvokeAbstract` 中新增方法）：

```java
public List<XxxInsuVO> getXxxLinkInsuInfo(XxxInsuDTO dto) {
    if (dto.getStartDate() == null) {
        dto.setStartDate(new Date());
    }
    CtXxxInsuDTO ctDto = BeanUtil.copyProperties(dto, CtXxxInsuDTO.class);
    BaseResponse<List<CtXxxInsuVO>> response = arInsuCtApi.getXxxLinkInsuList(ctDto);
    if (response.isSuccess()) {
        return BeanUtil.copyToList(response.getData(), XxxInsuVO.class);
    }
    throw HisBusinessException.rpcException(
        response.getCode(),
        CtApplicationEnum.INSU.getErrNamePre("获取XXX医保对照信息") + response.getMsg()
    );
}
```

> **注意**：`ArInsuCtApi` 属于医保产品组内部 Feign 接口，新增方法前应先确认医保服务侧已提供对应 API。

### 6. `ArInsuCtApi` 完整方法清单与直接使用

当 `ArInsuOpInvokeAbstract` / `MRDiagnosInsuInvokeAbstract` 的封装方法不能满足需求时，可以在对应 Abstract 中直接调用 `ArInsuCtApi`。本节列出该 Feign 接口的全部方法、对应数据库表及使用示例，供扩展封装时参考。

#### 6.1 接口定位

```java
@FeignClient(
    "${mediway.application.insu}",
    path = "${server.servlet.context-path}/ar/insu/api/ct/biz/arInsuCt",
    contextId = "ArInsuCtApi"
)
public interface ArInsuCtApi {
    // ... 见下表
}
```

- **完整限定名**：`com.mediway.his.insu.api.ArInsuCtApi`
- **所属 JAR**：`insu-api`（医保服务对外暴露的 Feign API）
- **目标服务**：`${mediway.application.insu}`（医保中心服务）

#### 6.2 方法速查表

| # | 方法签名 | HTTP 路径 | 数据域 | 对应数据库表 | 典型用途 |
|---|---------|-----------|--------|-------------|---------|
| 1 | `getItmmastLinkInsu(CtOeItmmastLinkInsuDTO)` | 默认 POST | 医嘱/收费项医保目录对照 | `ct_ar_insu_tarcontrast` + `ct_ar_insu_taritems` | 单个医嘱项获取医保目录信息 |
| 2 | `getItmmastLinkInsuList(List<CtOeItmmastLinkInsuDTO>)` | 默认 POST | 医嘱/收费项医保目录对照 | `ct_ar_insu_tarcontrast` + `ct_ar_insu_taritems` | 批量医嘱项获取医保目录信息 |
| 3 | `getArItemLinkInsu(CtArItemLinkInsuDTO)` | 默认 POST | 收费项医保目录对照 | `ct_ar_insu_tarcontrast` + `ct_ar_insu_taritems` | 按收费项 ID 获取医保目录信息 |
| 4 | `getInsuListType(CtArItemLinkInsuDTO)` | `/getInsuListType` | 医保目录类型 | `ct_ar_insu_dicdatacon`（`dictype='insu_list_type'`） | **根据费别获取医保目录类型**（决定 `dictype` 后缀） |
| 5 | `getInsuIntfType(CtArItemLinkInsuDTO)` | `/getInsuIntfType` | 医保接口类型 | `ct_ar_insu_dicdatacon`（`dictype='insu_intf_type'`） | **根据费别获取医保接口类型** |
| 6 | `getItmmastLinkInsuForSpecial(CtOeItmmastLinkInsuDTO)` | 默认 POST | 特殊项目医保目录对照 | `ct_ar_insu_tarcontrast` + `ct_ar_insu_taritems` | 特殊对照项目查询 |
| 7 | `queryDicDataList(CtArInsuDicdataDTO)` | `/queryDicDataList` | 医保字典主数据 | `ct_ar_insu_dicdata` | 查询医保字典主数据（返回医保侧编码/名称） |
| 8 | `queryDicdataconList(List<FeginArInsuQueryDicdataconDTO>)` | `/queryDicdataconList` | 医保字典对照 | `ct_ar_insu_dicdatacon` | **按 HIS 字典编码查询对应的医保编码** |
| 9 | `selectIcdContInfoList(CtArInsuIcdcontrastSelectDTO)` | `/selectIcdContInfoList` | 诊断 ICD 医保对照 | `ct_ar_insu_icdcontrast` | 批量诊断 ICD 医保对照 |
| 10 | `queryIcdContInfoByhisIcdId(CtArInsuIcdcontrastDTO)` | `/queryIcdContInfoByhisIcdId` | 诊断 ICD 医保对照 | `ct_ar_insu_icdcontrast` | 按 HIS ICD ID 单条查询医保对照 |
| 11 | `updateSelfpro(Map<String, Object>)` | `/updateSelfpro` | 自付比例更新 | `ct_ar_insu_tarcontrast` | 更新医保自付比例 |

#### 6.3 核心 DTO / VO 字段说明

**输入 DTO**

- `CtOeItmmastLinkInsuDTO`（医嘱项医保对照查询）
  - `itmmastId` — HIS 医嘱项 ID（单条查询时必填）
  - `itmmastIds` — HIS 医嘱项 ID 列表（批量查询时必填）
  - `chargetypeId` — 收费类型 ID（医保类型，如职工医保、居民医保）
  - `insuIntfType` — 医保接口类型
  - `startDate` — 生效日期，通常传 `new Date()`
  - `hospitalDr` — 医院/院区 ID

- `CtArItemLinkInsuDTO`（收费项医保对照查询）
  - `itemId` / `itemIds` — HIS 收费项 ID / 列表
  - `chargetypeId` / `chargetypeCode` — 收费类型 ID 或编码
  - `insuIntfType` — 医保接口类型
  - `admId` — 就诊 ID（部分场景需要）
  - `startDate` — 生效日期
  - `hospitalDr` — 医院/院区 ID

- `CtArInsuIcdcontrastSelectDTO`（诊断 ICD 批量医保对照）
  - `icdIds` — HIS ICD ID 列表
  - `chargetypeId` — 收费类型 ID
  - `insuIntfType` — 医保接口类型
  - `startDate` — 生效日期
  - `hospitalDr` — 医院/院区 ID

- `CtArInsuIcdcontrastDTO`（诊断 ICD 单条医保对照）
  - `hisIcdId` — HIS ICD ID
  - `icdCode` / `icdName` — HIS ICD 编码/名称
  - `insuIntfType` — 医保接口类型
  - `chargetypeId` — 收费类型 ID
  - `startDate` / `endDate` — 生效/失效日期
  - `hospitalDr` — 医院/院区 ID

- `CtArInsuDicdataDTO`（医保字典查询）
  - `dictype` — 字典类型（必填）
  - `code` — 字典编码
  - `displayname` — 字典显示名称
  - `opIpFlag` — 门诊/住院标志
  - `isActivity` — 是否有效
  - `startDate` / `endDate` — 生效/失效日期
  - `hospitalDr` / `hospId` — 医院/院区 ID

- `FeginArInsuQueryDicdataconDTO`（医保字典对照查询）
  - `dictype` — 字典类型
  - `code` — 源字典编码
  - `isActivity` — 是否有效
  - `startDate` — 生效日期
  - `hospitalDr` / `defHospId` — 医院/院区 ID

**输出 VO**

- `CtArInsuTaritemsLinkVO`（医嘱/收费项医保目录对照结果）
  - `itmmastId` / `itemId` — HIS 医嘱项/收费项 ID
  - `itemCode` / `itemName` — HIS 项目编码/名称
  - `insuItemDr` — 医保目录项 ID
  - `medListCode` / `medListName` — 医保目录编码/名称
  - `hilistCode` / `hilistName` — 医保统一目录编码/名称
  - `selfpayProp` — 自付比例
  - `lmtPric` — 限价
  - `chrgitmLv` — 收费项目等级
  - `chrgitmType` — 收费项目类型
  - `spItemFlag` / `lmtUsedFlag` / `injrUsedFlag` / `matnUsedFlag` — 特殊项目/限额/工伤/生育标志
  - `conId` / `conMemo` / `conStartDate` / `conEndDate` — 对照关系信息
  - `insuIntfType` / `chargetypeId` / `hospitalDr` — 医保接口/收费类型/医院

- `CtArInsuIcdcontrastVO`（诊断 ICD 医保对照结果）
  - `hisIcdId` / `icdCode` / `icdName` — HIS ICD ID/编码/名称
  - `insuDiagnosisDr` — 医保诊断 ID
  - `diagCode` / `diagName` — 医保诊断编码/名称
  - `insuIntfType` / `hisVer` / `insuVer` — 医保接口/版本
  - `autoconFlag` / `chkFlag` / `conType` / `grayCodeFlag` — 自动对照/校验/对照类型/灰码标志
  - `startDate` / `endDate` / `hospitalDr` — 生效/失效/医院

- `CtArInsuDicdataVO`（医保字典主数据）
  - `id` / `dictype` / `code` / `displayname` / `memo`
  - `opIpFlag` / `defaultFlag` / `isActivity`
  - `startDate` / `endDate`
  - `hospitalDr` / `hospName`

- `FeginArInsuQueryDicdataconVO`（医保字典对照结果）
  - `dictype` — 字典类型
  - `code` / `displayname` — 源字典编码/名称
  - `codeCon` / `displaynameCon` — 医保字典编码/名称
  - `isActivity` / `startDate` / `endDate`
  - `hospitalDr` / `hospitalName`

#### 6.3.1 医保字典查询的两种场景（重要）

`ArInsuCtApi` 提供了两个看似相近、实则职责不同的字典接口，封装时不可混淆：

| 场景 | 应使用 API | 数据表 | 入参特点 | 返回内容 |
|------|-----------|--------|---------|---------|
| **查医保字典主数据** | `queryDicDataList` | `ct_ar_insu_dicdata` | `dictype` + `code`/`displayname` + `hospitalDr` | 医保侧编码/名称（`code` / `displayname`） |
| **HIS 字典 ↔ 医保字典对照** | `queryDicdataconList` | `ct_ar_insu_dicdatacon` | `dictype` + `code`（HIS 源编码）+ `hospitalDr` | 源编码/名称 + 对照后的医保编码/名称（`codeCon` / `displaynameCon`） |

**因此**：
- 若需求是“根据 HIS 字典 ID/Code 查对应的医保编码”，**优先使用 `ArInsuOpInvokeAbstract.queryDicdataconByChargetype`**；如需更底层控制，可直接封装 `queryDicdataconList`。
- `queryDicDataList` 仅用于“枚举/查询医保字典本身有哪些值”，不解决 HIS → 医保映射问题。

**常见 `dictype` 示例**（从 `ct_ar_insu_dicdata` 统计，实际值随医保接口版本/地区变化， suffix `00A` 通常为国家平台，`BJ`/`GZA`/`SHC` 等为地方平台）：

| 字典类型 | 典型 `dictype` | 含义 |
|---------|---------------|------|
| 人员类别 | `psn_type00A` / `psn_typeBJ` | 职工、居民等参保身份 |
| 险种类型 | `insutype00A` / `insutypeBJ` | 职工基本医疗保险、城乡居民基本医疗保险等 |
| 医疗类别 | `med_type00A` / `med_typeBJ` / `med_typeGZA` | 普通门诊、住院、急诊等 |
| 科室 | `dept00A` / `deptBJ` | 医保标准科室 |
| 就诊类型 | `adm_typeBJ` | 普通住院、特殊病住院等 |
| 病种类型 | `dise_type_code00A` | 门慢门特、按病种结算等 |
| 业务类型 | `business_type` / `business_typeBJ` | 挂号、结算、取药等 |
| 药品剂型 | `drug_dosform00A` / `drug_dosformBJ` | 片剂、注射剂等 |
| 用药频次 | `used_frqu00A` / `used_frquBJ` | 每日一次、每日两次等 |
| 麻醉方式 | `anst_mtd_code00A` / `anst_mtd_codeBJ` | 全麻、局麻等 |
| 手术操作部位 | `oprn_oper_part_code00A` | 手术部位字典 |
| 离院方式 | `dscg_way00A` / `dscg_way00E` | 医嘱离院、转院等 |
| 证件类型 | `psn_cert_type00A` / `id_typeBJ` | 身份证、社保卡等 |
| 血缘关系 | `patn_rlts00A` / `patn_rltsBJ` | 配偶、子女等 |
| 民族 | `naty00A` | 民族字典 |
| 行政区划 | `admdvs` / `admdvs00A` | 省市县区划 |

> 实际项目中 `dictype` 没有全国统一的固定编码表，必须以现场医保接口配置和 `ct_ar_insu_dicdata.dictype` 实际数据为准。上述列表仅供快速识别常见类型。

#### 6.3.2 `dictype` 后缀与费别的关系（重要）

`ct_ar_insu_dicdata.dictype` 的后缀（`00A` / `BJ` / `GZA` / `00E` 等）**本质上是医保接口/目录类型**，它由 HIS **费别（`ct_pa_chargetype`）** 映射而来。医保产品组已在 `ct_ar_insu_dicdatacon` 中维护好该映射关系。

**映射关系表**：

| 源表 | 源 ID | 字典类型 | 返回字段 | 含义 |
|------|------|---------|---------|------|
| `ct_pa_chargetype` | `chargetypeId` | `insu_intf_type` | `code_con` | 医保接口类型（如 `BJ`、`00A`、`GZA`） |
| `ct_pa_chargetype` | `chargetypeId` | `insu_list_type` | `code_con` | 医保目录类型（如 `BJ`、`00A`、`00E`） |

**对应 `ArInsuCtApi` 方法**：

| 方法 | 输入 | 输出 | 数据表 |
|------|------|------|--------|
| `getInsuIntfType(CtArItemLinkInsuDTO)` | `chargetypeId` / `chargetypeCode` + `hospitalDr` | 医保接口类型 | `ct_ar_insu_dicdatacon`（`dictype='insu_intf_type'`） |
| `getInsuListType(CtArItemLinkInsuDTO)` | `chargetypeId` / `chargetypeCode` + `hospitalDr` | 医保目录类型 | `ct_ar_insu_dicdatacon`（`dictype='insu_list_type'`） |

**示例数据**（`ct_ar_insu_dicdatacon`）：

| 费别 ID | 费别编码 | 费别名称 | `insu_intf_type` | `insu_list_type` |
|---------|---------|---------|------------------|------------------|
| 2 | 9901 | 省医保 | `BJ` | `BJ` |
| 4 | 9903 | 市医保 | `00E` | `00A` |
| 56 | GZA-0100 | 市医保(贵阳) | `GZA` | `00A` |
| 52 | GSFB | 工伤 | `00E` | `00E` |

**如何根据费别 + HIS 字典编码查询医保对照编码**：

对于遵循 `"baseType" + suffix` 模式的医保字典对照（如 `deptConBJ`、`med_chrgitm_typeCon00A`），应优先使用 `ArInsuOpInvokeAbstract.queryDicdataconByChargetype(...)`。该方法已封装好以下流程：

1. 根据入参中的每个 `chargetypeId` 调用 `getInsuListType` 获取 suffix；
2. 将 `ArInsuDictypeConEnum.baseType` 与 suffix 拼接成完整 `dictype`；
3. 批量调用 `queryDicdataconList`，返回 HIS 字典编码对应的医保编码。

```java
import com.mediway.his.comoe.ordinvoke.blh.ar.insu.ext.ArInsuOpInvokeBLH;
import com.mediway.his.comoe.ordinvoke.constant.ArInsuDictypeConEnum;
import com.mediway.his.comoe.ordinvoke.model.dto.ar.insu.ArInsuQueryDicdataconParamDTO;
import com.mediway.his.insu.api.model.vo.FeginArInsuQueryDicdataconVO;

@Resource(name = "arInsuOpInvokeBLH")
private ArInsuOpInvokeBLH arInsuOpInvokeBLH;

public List<FeginArInsuQueryDicdataconVO> queryDeptInsuCodes(
        List<String> deptCodes, List<Long> chargetypeIds, Long hospitalDr) {
    List<ArInsuQueryDicdataconParamDTO> params = new ArrayList<>();
    for (Long chargetypeId : chargetypeIds) {
        for (String deptCode : deptCodes) {
            params.add(new ArInsuQueryDicdataconParamDTO()
                .setDictCode(deptCode)
                .setChargetypeId(chargetypeId));
        }
    }
    return arInsuOpInvokeBLH.queryDicdataconByChargetype(
        ArInsuDictypeConEnum.DEPT_CON, params, hospitalDr);
    // 结果中 FeginArInsuQueryDicdataconVO.codeCon 即为医保侧编码
}
```

单条查询可使用便捷重载：

```java
List<FeginArInsuQueryDicdataconVO> result =
    arInsuOpInvokeBLH.queryDicdataconByChargetype(
        ArInsuDictypeConEnum.DEPT_CON, deptCode, chargetypeId, hospitalDr);
```

**注意**：
- `ArInsuDictypeConEnum` 位于 `com.mediway.his.comoe.ordinvoke.constant`，定义了当前支持的 `baseType`，如 `DEPT_CON`（科室对照）、`DOCTOR_LEVEL_CON`（医生职称/级别对照）、`MED_CHRGITM_TYPE_CON`（医疗收费项目类型对照）等。新增枚举值前应在 `ct_ar_insu_dicdatacon` 中确认对应 `baseType` 真实存在。
- 该方法只适用于 `"baseType" + suffix` 模式的对照字典；特殊命名如 `business_type`、`dicTypeConBJ`、`chargeTypeToMedTypeBJ` 等不能直接使用。
- 医保目录/项目/诊断对照类接口（`getItmmastLinkInsu*`、`selectIcdContInfoList` 等）已在内部完成费别到目录类型的转换，调用方只需传 `chargetypeId` 即可。
- `ArInsuCtApi` 属于医保服务对外暴露的 Feign 接口，新增方法前必须先确认医保服务侧已提供对应实现。

**只有 HIS 字典 ID 时的处理**：

`queryDicdataconList` 只接受 `code`，若只有 HIS 字典 ID，需要先在业务侧解析成编码再调用。例如：

```java
// 示例：根据字典 ID 获取 code（实际表名/字段按具体字典调整）
CtArDictionaryPO dict = ctArDictionaryMapper.selectById(hisDictId);
String hisDictCode = dict != null ? dict.getCode() : null;
if (StrUtil.isBlank(hisDictCode)) {
    return Collections.emptyList();
}
// 然后再调用 queryDicdataconByChargetype
return arInsuOpInvokeBLH.queryDicdataconByChargetype(
    ArInsuDictypeConEnum.DEPT_CON, hisDictCode, chargetypeId, hospitalDr);
```

如果多个字典都走这种模式，建议为每种源字典表封装一个 `id -> code` 的私有方法，保持 `queryDicdataconByChargetype` 只关心医保对照逻辑。

#### 6.4 数据库对照关系说明

| 数据库表 | 业务含义 | 与 API 的对应关系 |
|---------|---------|------------------|
| `ct_ar_insu_tarcontrast` | HIS 收费项 ↔ 医保目录对照关系 | 被 `getItmmastLinkInsu*` / `getArItemLinkInsu` / `getItmmastLinkInsuForSpecial` 使用 |
| `ct_ar_insu_taritems` | 国家/地方医保目录主数据 | 与 `tarcontrast` 联合返回 `medListCode`、`hilistCode`、`selfpayProp` 等 |
| `ct_ar_insu_icdcontrast` | HIS ICD ↔ 医保诊断对照关系 | 被 `selectIcdContInfoList` / `queryIcdContInfoByhisIcdId` 使用 |
| `ct_ar_insu_dicdata` | 医保字典主数据（险种、待遇类型等） | 被 `queryDicDataList` 使用 |
| `ct_ar_insu_dicdatacon` | 源字典 ↔ 医保字典对照 | 被 `queryDicdataconList` 使用 |
| `ct_ar_insu_opercontrast` | HIS 手术操作 ↔ 医保手术操作对照 | 当前 `ArInsuCtApi` 未直接暴露方法，如有需要需新增封装 |

#### 6.5 直接使用 `ArInsuCtApi` 示例

在 `ArInsuOpInvokeAbstract` 或业务 BLH 中注入 `ArInsuCtApi`：

```java
import com.mediway.his.insu.api.ArInsuCtApi;
import com.mediway.his.base.common.response.BaseResponse;
import com.mediway.his.common.exception.HisBusinessException;
import com.mediway.his.hiscore.ct.enums.CtApplicationEnum;

public abstract class ArInsuOpInvokeAbstract {

    @Resource
    protected ArInsuCtApi arInsuCtApi;

    /**
     * 示例：查询医保字典数据
     */
    public List<CtArInsuDicdataVO> queryInsuDicData(CtArInsuDicdataDTO dto) {
        BaseResponse<List<CtArInsuDicdataVO>> response = arInsuCtApi.queryDicDataList(dto);
        if (response.isSuccess()) {
            return response.getData();
        }
        throw HisBusinessException.rpcException(
            response.getCode(),
            CtApplicationEnum.INSU.getErrNamePre("查询医保字典数据") + response.getMsg()
        );
    }

    /**
     * 示例：批量查询诊断 ICD 医保对照
     */
    public List<CtArInsuIcdcontrastVO> selectIcdContInfoList(List<Long> icdIds,
                                                             Long chargetypeId,
                                                             Long hospitalDr) {
        CtArInsuIcdcontrastSelectDTO dto = new CtArInsuIcdcontrastSelectDTO();
        dto.setIcdIds(icdIds);
        dto.setChargetypeId(chargetypeId);
        dto.setHospitalDr(hospitalDr);
        dto.setStartDate(new Date());

        BaseResponse<List<CtArInsuIcdcontrastVO>> response =
            arInsuCtApi.selectIcdContInfoList(dto);
        if (response.isSuccess()) {
            return response.getData();
        }
        throw HisBusinessException.rpcException(
            response.getCode(),
            CtApplicationEnum.INSU.getErrNamePre("查询诊断医保对照") + response.getMsg()
        );
    }
}
```

#### 6.6 扩展封装示例（新增方法到 Abstract）

当需要查询 `ArInsuCtApi` 中已存在但 `ArInsuOpInvokeAbstract` 未封装的方法时，按以下模板扩展：

```java
public List<CtArInsuDicdataVO> queryInsuDicDataByType(String dictype, Long hospitalDr) {
    CtArInsuDicdataDTO dto = new CtArInsuDicdataDTO();
    dto.setDictype(dictype);
    dto.setHospitalDr(hospitalDr);
    dto.setIsActivity("Y");
    dto.setStartDate(new Date());

    BaseResponse<List<CtArInsuDicdataVO>> response = arInsuCtApi.queryDicDataList(dto);
    if (response.isSuccess()) {
        return response.getData();
    }
    throw HisBusinessException.rpcException(
        response.getCode(),
        CtApplicationEnum.INSU.getErrNamePre("查询医保字典") + response.getMsg()
    );
}
```

**注意要点**：
- 入参优先使用业务侧熟悉的名字，内部转换为医保模块 DTO。
- 必须判断 `BaseResponse.isSuccess()`。
- 失败时统一使用 `CtApplicationEnum.INSU.getErrNamePre(...)` 作为错误前缀，并抛出 `HisBusinessException.rpcException(...)`。
- 不要在 Controller/业务 BLH 中直接调用 `ArInsuCtApi`，应通过 `comoe-ordinvoke` / `commr-diainvoke` 的 Abstract/BLH 封装后复用。
- `queryDicDataList` 与 `queryDicdataconList` 职责不同：
  - `queryDicDataList` 用于枚举/查询医保字典主数据本身；
  - `queryDicdataconList` 用于 HIS 源字典编码 → 医保编码的对照；
  - 日常“费别 + HIS 字典编码 → 医保编码”优先使用 `ArInsuOpInvokeAbstract.queryDicdataconByChargetype(...)`，不要直接混用两个底层接口。

## 约束

### 必须遵守
- **comoe Services**：必须使用全限定 Bean 名称 `@Service("comoe.{module}.{Name}")`
- **通用 SQL**：将通用、可复用的 SQL 放在 comoe Services 中
- **分页**：列表查询始终使用分页（每页最大 500）
- **校验**：查询前校验参数
- **LambdaWrapper**：使用 LambdaQueryWrapper 保证类型安全
- **空值处理**：优雅处理空结果
- **模块选择**：根据可复用性选择正确的模块类型（comoe vs Boot）
- **⚠️ 基础字典查询**：所有基础字典数据查询（ICD、药品、科室、用户等）**必须使用 `DocCacheUtils`**
- **⚠️ 配置查询 — 系统标准**：**必须使用 hiscfsv-* 模块服务**（如 `hiscfsv-ipcare-docconfig`）
- **⚠️ 配置查询 — 自建**：自建/项目特定配置**必须使用 `DocCacheUtils`**
- **缓存键规范**：缓存键使用 `{domain}:{entity}:{field}:{value}` 格式

### 禁止
- **业务逻辑在 comoe 中**：不要在 comoe Services 中添加业务工作流
- **Feign 在 comoe 中**：不要在 comoe-mediway 中使用 Feign 客户端
- **缺少 Bean 名称**：comoe Services 必须有全限定名称
- **N+1 查询**：不要在循环中查询
- **SELECT ***：生产环境不要使用 select all columns
- **硬编码 SQL**：避免硬编码 SQL 语句
- **模块错误**：不要将业务特定的 Services 放在 comoe 中
- **⚠️ 直接字典查询**：**禁止不使用 DocCacheUtils 直接查询基础字典表**
- **⚠️ 字典缓存错误**：**禁止对基础字典查询使用 @Cacheable 或直接 mapper** — 仅使用 DocCacheUtils
- **⚠️ 直接配置 Service 调用**：**禁止直接调用配置 Service/Mapper** — 系统配置使用 hiscfsv-*，自建配置使用 DocCacheUtils

## 知识参考

MyBatis Plus, Spring Cache, MySQL 优化, SQL 性能, 数据字典, HIS 领域知识, 数据库索引, 查询优化, 分页, 批量查询, comoe-mediway, 微服务架构, Feign Client

## 相关技能

- **imedicalxc-doctor-extend-engineer** — 医生站第三方集成全流程编排器
- **imedicalxc-doctor-blh** — BLH 模式专家
