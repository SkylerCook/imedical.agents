---
name: imedicalxc-doctor-blh
version: 1.0.0
description: 医生站组 BLH（Business Logic Handler）编写规范，指导区域需求和项目组个性化需求的 BLH 开发
---

# 医生站组 BLH 编写规范

本技能定义了医生站组 BLH（Business Logic Handler）的完整编写规范，用于指导区域需求（RegionBLH）和项目组个性化需求（ProjectBLH）的开发工作。

## 何时使用

此技能应该在以下情况下使用：

- 任何需要调整医生站组 BLH 代码时
- 处理区域需求（RegionBLH）时
- 处理项目组个性化需求（ProjectBLH）时
- 处理无法被标准版收录的需求时
- 涉及医生站组三大系统（主索引/就诊/电子医嘱）的 BLH 层开发时
- 需要创建或修改 Abstract 类、CommonBLH、RegionBLH、ProjectBLH 时
- 需要创建或修改 DriverCom 跨业务复用模块时
- 需要 @BLH 注解进行版本化路由配置时

---

## ⚠️ 核心约束：BLH 具体逻辑的编写前提

**BLH 类（含 CommonBLH / RegionBLH / ProjectBLH / DriverCom）中如果存在具体的业务逻辑，一定是由于需要在某个具体项目上实现但不能影响到其他医院，并且无需添加配置而编写。**

该判定必须满足以下三项前提，**缺一不可**：

| 前提 | 含义 | 判定方法 |
|------|------|----------|
| **项目专属** | 该逻辑仅特定医院/项目需要，不影响其他已部署的医院 | 其他医院不使用该逻辑也能正常运行 |
| **不影响其他医院** | 该逻辑通过 BLH 版本路由隔离，其他医院的 Nacos 配置不指向此版本的 BLH | 不同医院的 Nacos 配置指向不同 `version` |
| **无需额外配置** | 该逻辑不需要在部署时额外添加环境配置、数据库表、开关项等 | 代码部署即生效，无运维依赖 |

**此过程必须经过用户明确确认后，方可在 BLH 类中编写具体业务逻辑。**

默认情况下，仅在 BLH Abstract 类中定义接口规范，或在 CommonBLH 中保留最小化的依赖注入/路由骨架代码，**不应新增具体实现代码**。

---

## 一、BLH 三层架构设计规范

### 1.1 四层架构总览

医生站组采用四层架构设计：

```
Controller → BLH（三层：Common/Region/Project）→ Service → Mapper
```

| 层级 | 职责 | 说明 |
|------|------|------|
| **Controller** | 接口暴露 | REST API 入口，负责请求分发和响应封装 |
| **BLH** | 业务逻辑处理 | 核心业务逻辑层，通过三层设计实现版本化路由 |
| **Service** | 数据服务 | 数据访问和业务服务，封装 Mapper 操作 |
| **Mapper** | 数据映射 | MyBatis 数据映射，直接操作数据库 |

### 1.2 BLH 三层设计

BLH 层包含三个层次的实现，通过 `@BLH` 注解和 Nacos 配置实现动态版本路由：

```
Abstract（业务抽象类）
    ├── CommonBLH（通用实现）— 标准版产品逻辑
    ├── RegionBLH（区域实现）— 区域级差异化逻辑
    └── ProjectBLH（项目实现）— 项目组个性化逻辑
```

#### 各层职责

| 层次 | 类名 | 职责 | 使用场景 |
|------|------|------|----------|
| **Abstract** | `{功能}Abstract` | 定义业务接口规范，包含通用业务逻辑 | 所有 BLH 的基类 |
| **CommonBLH** | `{功能}CommonBLH` | 通用标准实现，覆盖大部分业务场景 | 标准版产品需求 |
| **RegionBLH** | `{功能}RegionBLH` | 区域级差异化实现 | 区域级差异需求（如华南区、华北区等） |
| **ProjectBLH** | `{功能}ProjectBLH` | 项目组个性化实现 | 特定项目组无法被标准版收录的需求 |

### 1.3 分层策略

#### 何时需要 RegionBLH

- 需求属于**区域级差异**，同一区域内的多个项目组都需要该逻辑
- 差异化逻辑具有**通用性**，不局限于单一项目组
- 示例：华南区特有的医保对接逻辑、华北区特有的诊断编码规则

#### 何时需要 ProjectBLH

- 需求属于**项目级个性化**，仅单一项目组需要该逻辑
- 差异化逻辑**无法被标准版收录**，具有较强的特殊性
- 示例：某医院的特殊排班规则、某项目的自定义审批流程

#### 何时仅需 CommonBLH

- 需求为**通用标准功能**，适用于所有项目组
- 不存在区域或项目级的差异化需求
- **默认原则**：如果需求中没有明确指出需要按照项目、区域需求进行处理，通常情况下仅创建通用实现（CommonBLH），不需要建立区域实现（RegionBLH）与项目实现（ProjectBLH）
- 大部分常规功能只需要 CommonBLH 实现

> **⚠️ 重要原则**：**默认仅创建 CommonBLH**。只有在需求明确说明需要支持区域差异化或项目个性化时，才需要创建 RegionBLH 或 ProjectBLH。不要过度设计，避免不必要的复杂性。

> **⚠️ 逻辑编写限制**：即使创建了 CommonBLH，其中包含的具体业务逻辑也同样受 **核心约束** 限制——必须先经过用户明确确认该逻辑属于项目专属、不影响其他医院、无需额外配置，方可编写。

---

## 二、命名规范

### 2.1 BLH 类命名

| 类型 | 命名规范 | 示例 |
|------|----------|------|
| Abstract（业务抽象类） | `{功能}Abstract` | `DiagnoseSearchAbstract` |
| CommonBLH（通用实现） | `{功能}CommonBLH` | `DiagnoseSearchCommonBLH` |
| RegionBLH（区域实现） | `{功能}RegionBLH` | `DiagnoseSearchRegionBLH` |
| ProjectBLH（项目实现） | `{功能}ProjectBLH` | `DiagnoseSearchProjectBLH` |

### 2.2 DriverCom 命名

| 类型 | 命名规范 | 示例 |
|------|----------|------|
| DriverCom 抽象类 | `{功能}DriverComAbstract` | `OrderEntryDriverComAbstract` |
| DriverCom 实现类 | `{功能}DriverCom` | `OrderEntryDriverCom` |

### 2.3 其他类命名

| 类型 | 命名规范 | 示例 |
|------|----------|------|
| Controller | `{功能}Controller` | `DiagnoseSearchController` |
| Service | `{领域}{功能}Service` | `OrderEntryService` |
| ServiceImpl | `{领域}{功能}ServiceImpl` | `OrderEntryServiceImpl` |
| Mapper | `{功能}Mapper` | `DiagnoseSearchMapper` |
| DTO | `{领域}{功能}DTO` | `MrIcddxDTO` |
| VO | `{领域}{功能}VO` | `MrIcddxVO` |

---

## 三、包路径规范

### 3.1 基础包路径

```
com.mediway.his.{模块}.{组件}.blh
```

### 3.2 各类文件包路径

| 类型 | 包路径 | 示例 |
|------|--------|------|
| Abstract 类 | `blh/{功能}/` | `com.mediway.his.opcare.doctor.blh.mrdia.DiagnoseSearchAbstract` |
| CommonBLH | `blh/{功能}/ext/` | `com.mediway.his.opcare.doctor.blh.mrdia.ext.DiagnoseSearchCommonBLH` |
| RegionBLH | `blh/{功能}/ext/` | `com.mediway.his.opcare.doctor.blh.mrdia.ext.DiagnoseSearchRegionBLH` |
| ProjectBLH | `blh/{功能}/ext/` | `com.mediway.his.opcare.doctor.blh.mrdia.ext.DiagnoseSearchProjectBLH` |
| DriverCom | `blh/{功能}/` | `com.mediway.his.opcare.doctor.blh.oeord.OrderEntryDriverCom` |

### 3.3 关键约束

> **⚠️ 重要：实现类必须放在 `blh/**/ext/**` 包下才能被扫描**

BLH 实现类（CommonBLH、RegionBLH、ProjectBLH）必须放置在 `ext` 子包下。这是框架扫描机制的要求，放在其他位置将无法被正确注册和注入。

---

## 四、@BLH 注解使用规范

### 4.1 注解参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `value` | String | 是 | BLH 类名称，首字母小写，格式为 `{业务域}.{组件}.{功能}BLH` |
| `version` | String | 是 | 版本号，用于 Nacos 版本路由匹配 |
| `notes` | String | 否 | 功能描述 |
| `async` | boolean | 否 | 是否异步加载，默认为 false |

### 4.2 value 命名规范

`value` 的命名格式为：`{业务域}.{组件}.{功能}BLH`

- 业务域：所属工程简称，如 `opcare`、`ipcare`、`hispa`
- 组件：功能模块名，如 `doctor`、`adm`
- 功能：具体功能名，首字母大写

```
示例：
- opcare.doctor.DiagnoseSearchBLH
- ipcare.doctor.OrderEntryBLH
- hispa.adm.PatientMasterBLH
```

### 4.3 version 命名规范

| 实现类型 | version 格式 | 示例 |
|----------|-------------|------|
| CommonBLH | `1.0.0`（标准版本号） | `1.0.0`、`2.0.0` |
| RegionBLH | `{区域标识}` | `region_south`、`region_north` |
| ProjectBLH | `{项目标识}` | `project_hospital_a`、`project_custom` |

### 4.4 代码示例

#### CommonBLH 注解示例

```java
@BLH(value = "opcare.doctor.DiagnoseSearchBLH", version = "1.0.0", notes = "诊断查询通用实现")
public class DiagnoseSearchCommonBLH extends DiagnoseSearchAbstract {
    // 通用标准实现
}
```

#### RegionBLH 注解示例

```java
@BLH(value = "opcare.doctor.DiagnoseSearchBLH", version = "region_south", notes = "华南区诊断查询区域实现")
public class DiagnoseSearchRegionBLH extends DiagnoseSearchAbstract {
    // 华南区特有逻辑
}
```

#### ProjectBLH 注解示例

```java
@BLH(value = "opcare.doctor.DiagnoseSearchBLH", version = "project_hospital_a", notes = "A医院诊断查询项目实现")
public class DiagnoseSearchProjectBLH extends DiagnoseSearchAbstract {
    // A医院特有逻辑
}
```

---

## 五、@BLHScan 注解配置规范

### 5.1 注解参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `basePackages` | String[] | 是 | 需要扫描的 BLH 包路径 |
| `lazyInit` | boolean | 否 | 是否懒加载，默认为 false |

### 5.2 配置示例

```java
@Configuration
@BLHScan(
    basePackages = {
        "com.mediway.his.opcare.doctor.blh",
        "com.mediway.his.ipcare.doctor.blh"
    },
    lazyInit = false
)
public class BlhScanConfig {
    // BLH 扫描配置
}
```

### 5.3 注意事项

- `basePackages` 必须包含 `ext` 子包的父路径，框架会自动扫描 `ext` 子目录
- 多个业务域的 BLH 可以配置在同一个 `@BLHScan` 中
- `lazyInit` 建议设为 `false`，确保启动时即完成 BLH 注册

---

## 六、DriverCom 跨业务复用模式

> **⚠️ 核心定义**：DriverCom 是指可以**跨业务使用**的公共逻辑模块，供多个不同业务的 BLH 类共同调用。**仅服务于单一业务的类不能称为 DriverCom**，应直接在对应 BLH 中实现或封装为普通 Service。

### 6.1 使用场景

DriverCom 仅适用于以下场景，**不满足则不应创建**：

| 场景 | 说明 | 示例 |
|------|------|------|
| **跨业务共享逻辑** | 多个不同业务域的 BLH 类（如诊断查询 + 医嘱开立 + 治疗申请）都需要调用同一套逻辑 | 多个 BLH 共用患者过敏信息查询 |
| **外部服务接口封装** | 封装对其他微服务的 Feign 调用，且被多个业务 BLH 复用 | 对住院 ICD 查询的 Feign 封装 |
| **公共工具方法** | 跨业务通用的数据处理方法 | 字典数据转换、编码映射 |

**反面示例（不应创建 DriverCom）**：
- 仅被一个 BLH 调用的数据查询方法 → 在 BLH 中直接调用 Service
- 仅服务于医嘱开立流程的辅助逻辑 → 封装为 `oeord` 包下的 Service
- 单一业务的 Feign 封装 → 放在对应 invoke 模块中

### 6.2 命名规范

| 类型 | 命名 | 说明 |
|------|------|------|
| 抽象类 | `{功能}DriverComAbstract` | 定义接口规范和通用逻辑 |
| 实现类 | `{功能}DriverCom` | 具体实现 |

### 6.3 使用方式

DriverCom 作为公共模块被 BLH 类引用，通过 `@Resource` 或 `@Autowired` 注入：

```java
// DriverCom 定义
public class OrderEntryDriverCom {
    
    @Resource(name = "opcare.oeord.GetOrderDataService")
    private GetOrderDataService getOrderDataService;
    
    /**
     * 获取医嘱数据（跨流程复用）
     */
    public IPage<FeignOeOrdVO> getOrderData(FeignOeOrdDTO dto) {
        return getOrderDataService.queryPage(dto);
    }
    
    /**
     * 封装外部服务调用
     */
    public FeignResult callExternalService(FeignRequest request) {
        // 封装 Feign 调用逻辑
    }
}

// 在 BLH 中使用 DriverCom
@BLH(value = "opcare.doctor.OrderEntryBLH", version = "1.0.0")
public class OrderEntryCommonBLH extends OrderEntryAbstract {
    
    @Resource(name = "opcare.oeord.OrderEntryDriverCom")
    private OrderEntryDriverCom orderEntryDriverCom;
    
    @Override
    public IPage<OrderVO> queryOrders(OrderDTO dto) {
        // 使用 DriverCom 的公共方法
        return orderEntryDriverCom.getOrderData(dto);
    }
}
```

---

## 七、区域需求处理流程（RegionBLH 创建步骤）

### Step 0：用户确认（必须）

在进入技术实现前，必须向用户确认以下三点，**全部通过后方可继续**：

- [ ] 该逻辑是否仅特定区域/项目需要？（确认"项目专属"）
- [ ] 该逻辑是否不会影响其他已部署的医院？（确认"不影响其他医院"）
- [ ] 该逻辑是否不需要额外部署配置（环境配置、数据库表、开关等）？（确认"无需额外配置"）

**未获得用户明确确认 → 不得在 BLH 中编写任何具体业务逻辑。**

### Step 1：确认需求属于区域级差异

- 评估需求是否为**同一区域内多个项目组共有**的差异化需求
- 确认该差异化逻辑**不适用于标准版**通用功能
- 明确区域标识（如 `region_south`、`region_north`）

### Step 2：创建 RegionBLH 类，继承 Abstract

```java
@BLH(value = "{业务域}.{组件}.{功能}BLH", version = "{区域标识}", notes = "{功能描述}")
public class {功能}RegionBLH extends {功能}Abstract {
    // 区域特有逻辑实现
}
```

- 文件路径：`blh/{功能}/ext/{功能}RegionBLH.java`
- 必须继承对应的 Abstract 类
- 必须放在 `ext` 子包下

### Step 3：配置 @BLH 注解

- `value`：与 CommonBLH 保持一致（同一个功能的 BLH 名称）
- `version`：设置为区域标识，如 `region_south`
- `notes`：描述区域差异的功能说明

### Step 4：在 Nacos 中配置版本路由

在 Nacos 配置中心添加版本路由配置：

```yaml
imedical:
  blh:
    version:
      # BLH 名称: 版本标识
      opcare.doctor.DiagnoseSearchBLH: region_south
```

> **⚠️ 重要**：Nacos 中的配置决定了运行时加载哪个版本的 BLH 实现。配置的 `version` 值必须与 `@BLH` 注解的 `version` 值完全匹配。

### Step 5：实现区域特有逻辑

- 重写 Abstract 中定义的方法
- 只实现区域差异化的部分，通用逻辑复用 Abstract 或 CommonBLH 的实现
- 必要时可通过 `super` 调用父类的通用逻辑

---

## 八、项目组个性化需求处理流程（ProjectBLH 创建步骤）

### Step 0：用户确认（必须）

在进入技术实现前，必须向用户确认以下三点，**全部通过后方可继续**：

- [ ] 该逻辑是否仅特定医院/项目需要？（确认"项目专属"）
- [ ] 该逻辑是否不会影响其他已部署的医院？（确认"不影响其他医院"）
- [ ] 该逻辑是否不需要额外部署配置（环境配置、数据库表、开关等）？（确认"无需额外配置"）

**未获得用户明确确认 → 不得在 BLH 中编写任何具体业务逻辑。**

### Step 1：确认需求属于项目级个性化

- 评估需求是否为**仅单一项目组**需要的个性化需求
- 确认该个性化逻辑**无法被标准版收录**
- 明确项目标识（如 `project_hospital_a`、`project_custom`）

### Step 2：创建 ProjectBLH 类，继承 Abstract

```java
@BLH(value = "{业务域}.{组件}.{功能}BLH", version = "{项目标识}", notes = "{功能描述}")
public class {功能}ProjectBLH extends {功能}Abstract {
    // 项目特有逻辑实现
}
```

- 文件路径：`blh/{功能}/ext/{功能}ProjectBLH.java`
- 必须继承对应的 Abstract 类
- 必须放在 `ext` 子包下

### Step 3：配置 @BLH 注解

- `value`：与 CommonBLH 保持一致（同一个功能的 BLH 名称）
- `version`：设置为项目标识，如 `project_hospital_a`
- `notes`：描述项目个性化的功能说明

### Step 4：在 Nacos 中配置版本路由

在 Nacos 配置中心添加版本路由配置：

```yaml
imedical:
  blh:
    version:
      # BLH 名称: 版本标识
      opcare.doctor.DiagnoseSearchBLH: project_hospital_a
```

### Step 5：实现项目特有逻辑

- 重写 Abstract 中定义的方法
- 只实现项目个性化的部分，通用逻辑复用 Abstract 或 CommonBLH 的实现
- 必要时可通过 `super` 调用父类的通用逻辑

---

## 九、代码示例

### 9.1 Abstract 定义示例

```java
package com.mediway.his.opcare.doctor.blh.mrdia;

/**
 * 诊断查询业务抽象类
 * 定义诊断查询的业务接口规范
 */
public abstract class DiagnoseSearchAbstract {

    /**
     * 诊断查询主入口
     * @param dto 查询参数
     * @return 诊断分页结果
     */
    public abstract IPage<MrIcddxVO> diagnoseSearch(EsbBaseDTO<MrIcddxDTO> dto);

    /**
     * 通用参数校验逻辑
     * 所有子类共享的参数校验
     */
    protected void validateParams(EsbBaseDTO<MrIcddxDTO> dto) {
        if (null == dto || null == dto.getData()) {
            throw HisBusinessException.build("参数不能为空");
        }
        MrIcddxDTO data = dto.getData();
        if (StrUtil.isBlank(data.getDiagItemID()) && StrUtil.isBlank(data.getInput())) {
            throw HisBusinessException.build("诊断项ID和输入内容不能同时为空");
        }
    }

    /**
     * 通用数据转换方法
     * 所有子类共享的数据转换逻辑
     */
    protected <T, E> IPage<E> convertIPageBeans2Beans(
            IPage<T> fromBean, Class<E> clazz, BiConsumer<T, E> biConsumer) {
        // 数据转换实现
    }
}
```

### 9.2 CommonBLH 实现示例

```java
package com.mediway.his.opcare.doctor.blh.mrdia.ext;

import com.mediway.his.opcare.doctor.blh.mrdia.DiagnoseSearchAbstract;

/**
 * 诊断查询通用实现
 * 覆盖大部分标准业务场景
 */
@BLH(value = "opcare.doctor.DiagnoseSearchBLH", version = "1.0.0", notes = "诊断查询通用实现")
public class DiagnoseSearchCommonBLH extends DiagnoseSearchAbstract {

    @Resource(name = "opcare.mrdia.DiagnoseSearchService")
    private DiagnoseSearchService diagnoseSearchService;

    @Override
    public IPage<MrIcddxVO> diagnoseSearch(EsbBaseDTO<MrIcddxDTO> dto) {
        // 1. 参数校验
        validateParams(dto);
        
        // 2. 构建查询条件
        MrIcddxDTO data = dto.getData();
        
        // 3. 调用 Service 层查询
        IPage<MrIcddxEntity> pageData = diagnoseSearchService.queryPage(data);
        
        // 4. 数据转换
        return convertIPageBeans2Beans(pageData, MrIcddxVO.class, (entity, vo) -> {
            vo.setDiagnoseID(entity.getId());
            vo.setDiagnoseCode(entity.getCode());
            vo.setDiagnoseDesc(entity.getDesc());
            vo.setDiagnoseICD10(entity.getIcd10());
        });
    }
}
```

### 9.3 RegionBLH 实现示例

```java
package com.mediway.his.opcare.doctor.blh.mrdia.ext;

import com.mediway.his.opcare.doctor.blh.mrdia.DiagnoseSearchAbstract;

/**
 * 华南区诊断查询区域实现
 * 华南区使用特定的 ICD 编码映射规则
 */
@BLH(value = "opcare.doctor.DiagnoseSearchBLH", version = "region_south", notes = "华南区诊断查询区域实现")
public class DiagnoseSearchRegionBLH extends DiagnoseSearchAbstract {

    @Resource(name = "opcare.mrdia.DiagnoseSearchService")
    private DiagnoseSearchService diagnoseSearchService;

    @Override
    public IPage<MrIcddxVO> diagnoseSearch(EsbBaseDTO<MrIcddxDTO> dto) {
        // 1. 参数校验（复用通用校验）
        validateParams(dto);
        
        // 2. 华南区特有逻辑：使用区域特定的编码映射
        MrIcddxDTO data = dto.getData();
        applyRegionSouthCodeMapping(data);
        
        // 3. 调用 Service 层查询
        IPage<MrIcddxEntity> pageData = diagnoseSearchService.queryPage(data);
        
        // 4. 华南区特有逻辑：结果中的编码转换
        return convertIPageBeans2Beans(pageData, MrIcddxVO.class, (entity, vo) -> {
            vo.setDiagnoseID(entity.getId());
            vo.setDiagnoseCode(convertToRegionCode(entity.getCode()));
            vo.setDiagnoseDesc(entity.getDesc());
            vo.setDiagnoseICD10(entity.getIcd10());
        });
    }

    /**
     * 应用华南区编码映射规则
     */
    private void applyRegionSouthCodeMapping(MrIcddxDTO data) {
        // 华南区特有的编码映射逻辑
    }

    /**
     * 转换为华南区编码
     */
    private String convertToRegionCode(String code) {
        // 编码转换逻辑
        return code;
    }
}
```

### 9.4 ProjectBLH 实现示例

```java
package com.mediway.his.opcare.doctor.blh.mrdia.ext;

import com.mediway.his.opcare.doctor.blh.mrdia.DiagnoseSearchAbstract;

/**
 * A医院诊断查询项目实现
 * A医院使用自定义的诊断排序规则和展示方式
 */
@BLH(value = "opcare.doctor.DiagnoseSearchBLH", version = "project_hospital_a", notes = "A医院诊断查询项目实现")
public class DiagnoseSearchProjectBLH extends DiagnoseSearchAbstract {

    @Resource(name = "opcare.mrdia.DiagnoseSearchService")
    private DiagnoseSearchService diagnoseSearchService;

    @Override
    public IPage<MrIcddxVO> diagnoseSearch(EsbBaseDTO<MrIcddxDTO> dto) {
        // 1. 参数校验（复用通用校验）
        validateParams(dto);
        
        // 2. A医院特有逻辑：自定义排序规则
        MrIcddxDTO data = dto.getData();
        data.setSortRule("HOSPITAL_A_CUSTOM_SORT");
        
        // 3. 调用 Service 层查询
        IPage<MrIcddxEntity> pageData = diagnoseSearchService.queryPage(data);
        
        // 4. A医院特有逻辑：添加科室推荐诊断标记
        return convertIPageBeans2Beans(pageData, MrIcddxVO.class, (entity, vo) -> {
            vo.setDiagnoseID(entity.getId());
            vo.setDiagnoseCode(entity.getCode());
            vo.setDiagnoseDesc(entity.getDesc());
            vo.setDiagnoseICD10(entity.getIcd10());
            // A医院特有：标记科室推荐诊断
            vo.setRecommended(isDeptRecommendation(entity.getCode()));
        });
    }

    /**
     * 判断是否为科室推荐诊断
     */
    private boolean isDeptRecommendation(String code) {
        // A医院自定义推荐逻辑
        return false;
    }
}
```

### 9.5 Nacos 配置示例

#### 标准版配置（使用 CommonBLH）

```yaml
imedical:
  blh:
    version:
      # 所有 BLH 使用标准版
      opcare.doctor.DiagnoseSearchBLH: 1.0.0
      opcare.doctor.OrderEntryBLH: 1.0.0
      ipcare.doctor.OrderEntryBLH: 1.0.0
```

#### 区域版配置（使用 RegionBLH）

```yaml
imedical:
  blh:
    version:
      # 华南区使用区域版诊断查询
      opcare.doctor.DiagnoseSearchBLH: region_south
      # 其他 BLH 使用标准版
      opcare.doctor.OrderEntryBLH: 1.0.0
```

#### 项目版配置（使用 ProjectBLH）

```yaml
imedical:
  blh:
    version:
      # A医院使用项目版诊断查询
      opcare.doctor.DiagnoseSearchBLH: project_hospital_a
      # A医院使用项目版医嘱开立
      opcare.doctor.OrderEntryBLH: project_hospital_a
      # 其他 BLH 使用标准版
      ipcare.doctor.OrderEntryBLH: 1.0.0
```

### 9.6 DriverCom 示例

```java
package com.mediway.his.opcare.doctor.blh.oeord;

/**
 * 医嘱开立 DriverCom（跨业务复用）
 * 封装跨业务复用的医嘱查询逻辑和外部服务调用，
 * 被诊断查询、医嘱开立、治疗申请等多个不同业务的 BLH 共同使用
 */
public class OrderEntryDriverCom {

    @Resource(name = "comoe.ordservice.OrderQueryService")
    private OrderQueryService orderQueryService;

    @Resource(name = "aggcare.invoke.ipcare.IpcareLookUpICDClientBLH")
    private IpcareLookUpICDClientBLH ipcareLookUpICDClientBLH;

    /**
     * 获取医嘱数据（跨流程复用）
     */
    public IPage<FeignOeOrdVO> getOrderData(FeignOeOrdDTO dto) {
        return orderQueryService.queryPage(dto);
    }

    /**
     * 封装住院 ICD 查询的外部服务调用
     */
    public IPage<FeignCtMrIcddxVO> lookupICD(FeignCtMrIcddxDTO icddxDTO) {
        return ipcareLookUpICDClientBLH.lookup(icddxDTO);
    }
}
```

---

## 十、质量审查门禁

> BLH 代码的质量审查清单已独立为门禁文件，供 Code Quality Reviewer 在审查阶段使用。

**门禁文件**：`references/blh-review-checklist.md`

| 清单 | 内容 | 说明 |
|------|------|------|
| BLH-1 | BLH 逻辑前提 | 核心约束：逻辑编写前提校验（必须首个通过） |
| BLH-2 | 类命名 | 类命名规范 |
| BLH-3 | @BLH 注解 | 注解完整性 |
| BLH-4 | 包路径 | 包路径规范 |
| BLH-5 | 配置 | Nacos / @BLHScan 配置 |

**门禁规则**：任何未勾选项 = REJECT，返回实现者修复。
**适用范围**：仅在实现任务涉及 BLH 类（Abstract / CommonBLH / RegionBLH / ProjectBLH / DriverCom）创建或修改时启用。

---

## 参考文档

本技能包含以下参考文档，位于 `references/` 目录下：

- **BLH 架构参考**：`references/blh-architecture.md` — 四层架构说明、动态加载机制、@BLH 注解原理、Nacos 配置与版本管理
- **命名约定参考**：`references/naming-conventions.md` — 工程命名、领域前缀、接口路径、类命名、包路径规范
- **BLH 审查清单**：`references/blh-review-checklist.md` — Code Quality Reviewer 门禁清单（5 项）
