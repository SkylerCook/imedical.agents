# BLH 架构参考文档

本文档详细说明医生站组 BLH（Business Logic Handler）的架构设计原理、动态加载机制、注解底层原理和部署模式。

---

## 一、四层架构说明

### 1.1 架构总览

医生站组采用四层架构设计：

```
Controller → BLH（三层：Common/Region/Project）→ Service → Mapper
```

### 1.2 各层职责

| 层级 | 职责 | 关键特征 |
|------|------|----------|
| **Controller** | 接口暴露 | REST API 入口，负责请求分发和响应封装。使用 `@RestController` 注解，不包含业务逻辑 |
| **BLH** | 业务逻辑处理 | 核心业务逻辑层，通过三层设计（Abstract/Common/Region/Project）实现版本化路由。使用 `@BLH` 注解标识 |
| **Service** | 数据服务 | 数据访问和业务服务封装，封装 Mapper 操作。使用 `@Service` 注解标识 |
| **Mapper** | 数据映射 | MyBatis 数据映射，直接操作数据库。使用 `@Mapper` 注解标识 |

### 1.3 调用链路

```
HTTP Request
    → Controller（接收请求、参数校验、BLH 调用）
        → BLH（业务逻辑处理，动态路由到具体实现）
            → Service（数据服务）
                → Mapper（数据库操作）
```

### 1.4 数据流转

```
Controller 入参: DTO（Data Transfer Object）
    → BLH 处理: Entity ↔ VO（View Object）转换
        → Service: Entity 操作
            → Mapper: 数据库 Entity
```

---

## 二、BLH 三层架构详细设计

### 2.1 Abstract（业务抽象类）

**职责**：
- 定义业务接口规范（抽象方法）
- 提供通用业务逻辑实现（可被子类复用）
- 封装通用的参数校验、数据转换等公共方法

**特点**：
- 不使用 `@BLH` 注解（不参与版本路由）
- 包含抽象方法（子类必须实现）和具体方法（子类可直接复用）
- 位于 `blh/{功能}/` 包下

### 2.2 CommonBLH（通用实现）

**职责**：
- 实现标准版产品逻辑
- 覆盖大部分通用业务场景

**特点**：
- 使用 `@BLH` 注解，`version` 为标准版本号（如 `1.0.0`）
- 作为默认实现，当 Nacos 未配置特定版本时自动使用
- 位于 `blh/{功能}/ext/` 包下

### 2.3 RegionBLH（区域实现）

**职责**：
- 实现区域级差异化逻辑
- 覆盖同一区域内多个项目组共有的差异化需求

**特点**：
- 使用 `@BLH` 注解，`version` 为区域标识（如 `region_south`）
- 通过 Nacos 配置激活
- 位于 `blh/{功能}/ext/` 包下

### 2.4 ProjectBLH（项目实现）

**职责**：
- 实现项目组个性化逻辑
- 覆盖仅单一项目组需要的特殊需求

**特点**：
- 使用 `@BLH` 注解，`version` 为项目标识（如 `project_hospital_a`）
- 通过 Nacos 配置激活
- 位于 `blh/{功能}/ext/` 包下

### 2.5 三层继承关系图

```
DiagnoseSearchAbstract
    ├── DiagnoseSearchCommonBLH     (@BLH version="1.0.0")
    ├── DiagnoseSearchRegionBLH     (@BLH version="region_south")
    └── DiagnoseSearchProjectBLH    (@BLH version="project_hospital_a")
```

---

## 三、BLH 动态加载机制

### 3.1 加载流程

```
应用启动
    → @BLHScan 扫描指定包路径
        → 发现所有 @BLH 注解的类
            → 解析 value 和 version
                → 注册到 BLH 容器（Map<value, Map<version, Instance>>）
                    → 根据 Nacos 配置选择激活版本
```

### 3.2 版本路由机制

1. **注册阶段**：启动时扫描所有 `@BLH` 注解的类，按 `value` 分组，注册到 BLH 容器
2. **配置阶段**：从 Nacos 读取 `imedical.blh.version` 配置，确定每个 BLH 激活的版本
3. **注入阶段**：当 Controller 通过 `@Resource` 引用 BLH 时，根据 Nacos 配置注入对应版本的实现类
4. **运行阶段**：请求到达时，调用已注入的具体 BLH 实例的方法

### 3.3 版本匹配规则

| Nacos 配置 | 匹配结果 |
|------------|----------|
| `opcare.doctor.DiagnoseSearchBLH: 1.0.0` | 注入 `DiagnoseSearchCommonBLH` |
| `opcare.doctor.DiagnoseSearchBLH: region_south` | 注入 `DiagnoseSearchRegionBLH` |
| `opcare.doctor.DiagnoseSearchBLH: project_hospital_a` | 注入 `DiagnoseSearchProjectBLH` |
| 未配置 | 注入 `version` 值最小的 CommonBLH |

---

## 四、@BLH 注解底层原理

### 4.1 注解定义

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
public @interface BLH {
    /**
     * BLH 类名称，格式为 {业务域}.{组件}.{功能}BLH
     */
    String value();

    /**
     * 版本号，用于版本路由匹配
     */
    String version() default "1.0.0";

    /**
     * 功能描述
     */
    String notes() default "";

    /**
     * 是否异步加载
     */
    boolean async() default false;
}
```

### 4.2 处理流程

1. **类扫描**：`@BLHScan` 通过 Spring 的 `ClassPathBeanDefinitionScanner` 扫描指定包路径
2. **注册为 Bean**：`@BLH` 注解包含 `@Component` 元注解，自动注册为 Spring Bean
3. **版本注册**：`BeanFactoryPostProcessor` 在 Bean 注册后，解析 `@BLH` 的 `value` 和 `version`，注册到 BLH 容器
4. **动态代理**：通过 `FactoryBean` 或 `BeanPostProcessor` 实现，根据 Nacos 配置返回对应版本的实例

### 4.3 关键约束

- **`ext` 包约束**：实现类必须放在 `blh/**/ext/**` 包下，这是扫描过滤的条件
- **唯一性约束**：同一个 `value` + `version` 组合必须唯一，否则启动报错
- **继承约束**：所有实现类必须继承对应的 Abstract 类

---

## 五、Nacos 配置与版本管理

### 5.1 配置格式

在 Nacos 配置中心，BLH 版本路由使用以下 YAML 格式：

```yaml
imedical:
  blh:
    version:
      {BLH名称1}: {版本标识1}
      {BLH名称2}: {版本标识2}
```

### 5.2 配置示例

#### 标准版配置

```yaml
imedical:
  blh:
    version:
      opcare.doctor.DiagnoseSearchBLH: 1.0.0
      opcare.doctor.OrderEntryBLH: 1.0.0
      ipcare.doctor.OrderEntryBLH: 1.0.0
```

#### 混合配置（标准版 + 区域版 + 项目版）

```yaml
imedical:
  blh:
    version:
      # 诊断查询使用华南区版本
      opcare.doctor.DiagnoseSearchBLH: region_south
      # 医嘱开立使用A医院项目版
      opcare.doctor.OrderEntryBLH: project_hospital_a
      # 住院医嘱使用标准版
      ipcare.doctor.OrderEntryBLH: 1.0.0
```

### 5.3 配置更新

- Nacos 配置支持**动态刷新**，修改配置后无需重启服务
- 配置变更后，新的请求会自动路由到更新后的 BLH 实现
- 正在处理的请求不受影响（请求级隔离）

### 5.4 配置管理建议

- 每个环境（dev/test/prod）维护独立的 Nacos 命名空间
- 配置变更应通过配置中心进行版本管理
- 建议为每个 BLH 配置添加注释说明使用原因

---

## 六、部署模式说明

### 6.1 微服务模式

**适用场景**：标准生产环境

**特点**：
- 以 `-boot` 结尾的工程可独立部署
- 服务间通过 Feign 接口通信
- 使用 Seata AT 模式实现分布式事务
- 各服务可独立扩缩容

**通信方式**：
```
opcare-mediway-boot --Feign--> hispa-mediway-boot
opcare-mediway-boot --Feign--> ipcare-mediway-boot
```

### 6.2 单体模式

**适用场景**：小型医院、演示环境、开发测试

**特点**：
- 所有工程整体打包部署
- Feign 调用变更为 jar 包本地调用
- 无需独立的注册中心和配置中心（可简化 Nacos 部署）
- 部署简单，资源占用少

**通信方式**：
```
opcare-mediway-boot --jar包调用--> hispa-mediway-boot（同一进程内）
```

### 6.3 部署模式对 BLH 的影响

| 方面 | 微服务模式 | 单体模式 |
|------|-----------|----------|
| BLH 扫描 | 各服务独立扫描 | 统一扫描 |
| Nacos 配置 | 通过 Nacos 配置中心管理 | 可使用本地配置文件 |
| 版本路由 | 支持动态刷新 | 需重启生效 |
| Feign 调用 | HTTP 远程调用 | 本地方法调用 |
| 事务管理 | Seata AT 分布式事务 | 本地事务 |

---

## 七、业务域工程清单和领域前缀

### 7.1 主索引系统

| 业务域工程 | 职责描述 | 核心功能 | 领域前缀 |
|------------|----------|----------|----------|
| `hispa-mediway-boot` | 患者主索引服务 | 患者信息管理、就诊基础数据、患者主索引维护 | `pa_*` |

### 7.2 就诊系统

| 业务域工程 | 职责描述 | 核心功能 | 领域前缀 |
|------------|----------|----------|----------|
| `opreg-mediway-boot` | 门诊接诊 | 医生排班、预约挂号、诊间预约、就诊卡管理 | `paadm_op_*` |
| `opalloc-mediway-boot` | 门诊分诊 | 分诊报道、过号管理、复诊管理 | `paadm_op_*` |
| `opcare-mediway-boot` | 门诊诊间诊疗 | 门诊病人列表、门诊诊断录入、门诊电子医嘱管理 | `paadm_op_*`、`oe_*`、`mr_dia_*` |
| `ipcare-mediway-boot` | 住院诊疗 | 住院病人列表、住院诊断录入、住院电子医嘱管理 | `paadm_ip_*`、`oe_*`、`mr_dia_*` |

### 7.3 电子医嘱系统

| 业务域工程 | 职责描述 | 核心功能 | 领域前缀 |
|------------|----------|----------|----------|
| `comoe-mediway` | 电子医嘱公共实现 | 医嘱公共实现（存储、状态管理、基础算法） | `oe_*` |
| `cfoe-mediway` | 电子医嘱配置算法 | 配合 comoe-mediway 使用 | `oe_*` |
| `curc-mediway-boot` | 康复治疗系统 | 治疗申请、治疗预约、治疗执行、治疗评估 | `cu_rc_*`、`curc_*` |
| `ma-mediway-boot` | 医务管理 | 抗菌药物分级管理、非药品医嘱分级管理 | `ma_*` |

### 7.4 配套公共库

| 公共库 | 职责描述 | 使用方 | 领域前缀 |
|--------|----------|--------|----------|
| `commr-mediway` | 电子诊断公共实现 | opcare-mediway-boot、ipcare-mediway-boot | `mr_dia_*` |
| `cfmr-mediway` | 电子诊断配置算法 | 配合 commr-mediway 使用 | `mr_dia_*` |
| `aggcare-mediway-boot` | 融合服务接口 | 门诊与住院融合接口（仅对外服务） | - |
