# 命名约定参考文档

本文档定义了医生站组的完整命名约定，涵盖工程命名、领域前缀、接口路径、类命名和包路径规范。

---

## 一、工程命名规范

### 1.1 可部署工程

**命名格式**：`{业务域}-mediway-boot`

| 工程名 | 业务域 | 说明 |
|--------|--------|------|
| `hispa-mediway-boot` | 患者主索引 | 全院患者身份唯一标识管理 |
| `opreg-mediway-boot` | 门诊接诊 | 挂号预约管理 |
| `opalloc-mediway-boot` | 门诊分诊 | 分诊报道、排队管理 |
| `opcare-mediway-boot` | 门诊诊间诊疗 | 门诊医生工作站 |
| `ipcare-mediway-boot` | 住院诊疗 | 住院医生工作站 |
| `curc-mediway-boot` | 康复治疗 | 治疗工作站 |
| `ma-mediway-boot` | 医务管理 | 医务管理系统 |
| `aggcare-mediway-boot` | 融合服务 | 门诊与住院综合服务 |

### 1.2 公共库

**命名格式**：`{类型}-mediway`

| 公共库 | 类型 | 说明 |
|--------|------|------|
| `comoe-mediway` | com（公共） | 电子医嘱公共实现 |
| `cfoe-mediway` | cf（配置） | 电子医嘱配置算法 |
| `commr-mediway` | com（公共） | 电子诊断公共实现 |
| `cfmr-mediway` | cf（配置） | 电子诊断配置算法 |

**关键要点**：
- 严禁编写controller

### 1.3 命名规律

| 类型 | 后缀 | 说明 |
|------|------|------|
| 可部署微服务 | `-mediway-boot` | 可独立部署的 Spring Boot 微服务 |
| 公共库 | `-mediway` | 不可独立部署，被其他工程依赖 |
| `com` 前缀 | `com{领域}-mediway` | 公共业务实现库 |
| `cf` 前缀 | `cf{领域}-mediway` | 配置算法库 |

---

## 二、领域前缀规范

### 2.1 前缀总览

| 领域 | 前缀 | 所属系统 | 典型表名示例 |
|------|------|----------|--------------|
| 患者域 | `pa_*` | 主索引系统 | `pa_patmas`, `pa_person`, `pa_adm` |
| 就诊域-门诊 | `paadm_op_*` | 就诊系统 | `paadm_op_regist`, `paadm_op_alloc` |
| 就诊域-住院 | `paadm_ip_*` | 就诊系统 | `paadm_ip_admission`, `paadm_ip_transfer` |
| 医嘱域 | `oe_*` | 电子医嘱系统 | `oe_order`, `oe_item`, `oe_exec` |
| 诊断域 | `mr_dia_*` | 电子医嘱系统（配套） | `mr_dia_main`, `mr_dia_sub` |
| 康复治疗域 | `cu_rc_*` / `curc_*` | 电子医嘱系统（专科） | `cu_rc_apply`, `curc_schedule` |
| 医务管理域 | `ma_*` | 电子医嘱系统（规则） | `ma_antibiotics`, `ma_handover` |
| 医生站工具域 | `doc_*` | 各系统 | `doc_template`, `doc_favorite` |

### 2.2 前缀使用规则

#### 患者域（`pa_*`）

**所属系统**：主索引系统（`hispa-mediway-boot`）

**核心实体**：
- `PA_PatMas`：患者基本信息
- `PA_Person`：患者个人档案
- `PA_Adm`：就诊记录（门诊/住院）

#### 就诊域-门诊（`paadm_op_*`）

**所属系统**：就诊系统（`opreg-mediway-boot`、`opalloc-mediway-boot`、`opcare-mediway-boot`）

**核心实体**：
- `PA_Adm_OP`：门诊就诊记录
- `OP_Regist`：挂号记录
- `OP_Alloc`：分诊记录

#### 就诊域-住院（`paadm_ip_*`）

**所属系统**：就诊系统（`ipcare-mediway-boot`）

**核心实体**：
- `PA_Adm_IP`：住院就诊记录

#### 医嘱域（`oe_*`）

**所属系统**：电子医嘱系统（`comoe-mediway`、`cfoe-mediway`、`opcare-mediway-boot`、`ipcare-mediway-boot`）

**核心实体**：
- `OE_Order`：医嘱主记录
- `OE_Item`：医嘱明细
- `OE_Exec`：医嘱执行记录

#### 诊断域（`mr_dia_*`）

**所属系统**：电子医嘱系统配套（`commr-mediway`、`cfmr-mediway`）

**核心实体**：
- `MR_Dia`：诊断记录

---

## 三、接口路径规范

### 3.1 URL 前缀规范

| 系统 | URL 前缀 | 示例 |
|------|----------|------|
| 主索引系统 | `/api/hispa/**` | `/api/hispa/patient/query` |
| 门诊就诊系统 | `/api/opcare/**`、`/opreg/*`、`/opalloc/*` | `/api/opcare/patient/list`, `/opreg/appointment` |
| 住院就诊系统 | `/api/ipcare/**`、`/ipcare/*` | `/api/ipcare/patient/list`, `/ipcare/admission` |
| 康复治疗系统 | `/api/curc/**`、`/curc/*` | `/api/curc/apply/submit` |
| 医务管理系统 | `/api/ma/**`、`/ma/*` | `/api/ma/antibiotics/approval` |

### 3.2 接口分类规范

| 分类 | 路径格式 | 说明 | 示例 |
|------|----------|------|------|
| 内部接口 | `/api/{业务域}/{功能}/**` | 系统内部使用 | `/api/opcare/diagnose/search` |
| 对外接口 | `/api/{业务域}/external/{功能}/**` | 供其他系统调用 | `/api/hispa/external/patient/query` |
| 医嘱接口 | `/api/{opcare\|ipcare}/oeord/{类型}/**` | 医嘱相关操作 | `/api/opcare/oeord/pharmacy/**` |

### 3.3 医嘱接口子路径

| 子路径 | 说明 | 调用方 |
|--------|------|--------|
| `/oeord/pharmacy/**` | 药品医嘱相关 | 药房组 |
| `/oeord/charge/**` | 费用结算相关 | 收费组 |
| `/oeord/lis/**` | 检验医嘱相关 | 医技组 |
| `/oeord/ris/**` | 检查医嘱相关 | 医技组 |
| `/oeord/surgery/**` | 手术医嘱相关 | 手麻组 |

---

## 四、类命名规范

### 4.1 BLH 层类命名

| 类型 | 命名规范 | 示例 |
|------|----------|------|
| Abstract（业务抽象类） | `{功能}Abstract` | `DiagnoseSearchAbstract` |
| CommonBLH（通用实现） | `{功能}CommonBLH` | `DiagnoseSearchCommonBLH` |
| RegionBLH（区域实现） | `{功能}RegionBLH` | `DiagnoseSearchRegionBLH` |
| ProjectBLH（项目实现） | `{功能}ProjectBLH` | `DiagnoseSearchProjectBLH` |

### 4.2 DriverCom 命名

> **定义**：DriverCom 是跨业务复用的公共逻辑模块，仅供多个不同业务 BLH 共同调用的类才能命名为 DriverCom。单一业务使用的类不能称为 DriverCom。

| 类型 | 命名规范 | 示例 |
|------|----------|------|
| DriverCom 抽象类 | `{功能}DriverComAbstract` | `OrderEntryDriverComAbstract` |
| DriverCom 实现类 | `{功能}DriverCom` | `OrderEntryDriverCom` |

### 4.3 其他层类命名

| 类型 | 命名规范 | 示例 |
|------|----------|------|
| Controller | `{功能}Controller` | `DiagnoseSearchController` |
| Service 接口 | `{领域}{功能}Service` | `OrderEntryService` |
| Service 实现 | `{领域}{功能}ServiceImpl` | `OrderEntryServiceImpl` |
| Mapper | `{功能}Mapper` | `DiagnoseSearchMapper` |
| DTO | `{领域}{功能}DTO` | `MrIcddxDTO` |
| VO | `{领域}{功能}VO` | `MrIcddxVO` |
| Entity | `{领域前缀大写}{功能}` | `PaPatMas`、`OeOrder` |

### 4.4 @BLH 注解 value 命名

**格式**：`{业务域}.{组件}.{功能}BLH`

**规则**：
- 业务域：工程简称，如 `opcare`、`ipcare`、`hispa`
- 组件：功能模块名，如 `doctor`、`adm`
- 功能：具体功能名，首字母大写
- 首字母小写（整个 value 的首字母）

**示例**：
```
opcare.doctor.DiagnoseSearchBLH
ipcare.doctor.OrderEntryBLH
hispa.adm.PatientMasterBLH
aggcare.doctor.DiagnoseSearchBLH
```

---

## 五、包路径规范

### 5.1 基础包结构

```
com.mediway.his.{模块}.{组件}.{层级}
```

### 5.2 各层包路径

| 层级 | 包路径格式 | 示例 |
|------|-----------|------|
| Controller | `controller/{功能}/` | `com.mediway.his.opcare.doctor.controller.mrdia` |
| Abstract | `blh/{功能}/` | `com.mediway.his.opcare.doctor.blh.mrdia` |
| BLH 实现 | `blh/{功能}/ext/` | `com.mediway.his.opcare.doctor.blh.mrdia.ext` |
| Service | `service/{功能}/` | `com.mediway.his.opcare.doctor.service.mrdia` |
| Mapper | `mapper/{功能}/` | `com.mediway.his.opcare.doctor.mapper.mrdia` |
| DTO | `model/dto/{功能}/` | `com.mediway.his.opcare.doctor.model.dto.mrdia` |
| VO | `model/vo/{功能}/` | `com.mediway.his.opcare.doctor.model.vo.mrdia` |

### 5.3 BLH 包路径示例

以诊断查询功能为例：

```
com.mediway.his.opcare.doctor.blh.mrdia/
├── DiagnoseSearchAbstract.java          # 业务抽象类
├── OrderEntryDriverCom.java             # DriverCom（如有）
└── ext/
    ├── DiagnoseSearchCommonBLH.java     # 通用实现
    ├── DiagnoseSearchRegionBLH.java     # 区域实现（如有）
    └── DiagnoseSearchProjectBLH.java    # 项目实现（如有）
```

### 5.4 关键约束

> **⚠️ 重要：BLH 实现类必须放在 `blh/**/ext/**` 包下**

- `ext` 子包是框架扫描的必要条件
- Abstract 类放在 `blh/{功能}/` 包下（不在 ext 中）
- DriverCom 放在 `blh/{功能}/` 包下（不在 ext 中）
- 只有 CommonBLH、RegionBLH、ProjectBLH 需要放在 `ext` 子包中

### 5.5 各业务域完整包路径示例

#### opcare-mediway-boot（门诊诊疗）

```
com.mediway.his.opcare.doctor.blh.mrdia/          # 诊断相关 BLH
com.mediway.his.opcare.doctor.blh.oeord/           # 医嘱相关 BLH
com.mediway.his.opcare.adm.blh.regist/             # 挂号相关 BLH
```

#### ipcare-mediway-boot（住院诊疗）

```
com.mediway.his.ipcare.doctor.blh.mrdia/           # 诊断相关 BLH
com.mediway.his.ipcare.doctor.blh.oeord/           # 医嘱相关 BLH
com.mediway.his.ipcare.adm.blh.admission/          # 入院相关 BLH
```

#### hispa-mediway-boot（患者主索引）

```
com.mediway.his.hispa.adm.blh.pat/                 # 患者相关 BLH
com.mediway.his.hispa.adm.blh.adm/                 # 就诊相关 BLH
```
