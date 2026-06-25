---
name: imedicalxc-doctor-invoke
version: 1.0.0
description: Use when the doctor station team needs to call Feign interfaces or Service interfaces from other INTERNAL product teams (收费组、护理组、手术组、药房组等东华医为内部产品组). This skill provides guidelines for invoke module organization, preventing circular dependencies, unified interface encapsulation, and standardized exception handling. Note: This applies to internal HIS product teams only, NOT third-party vendors.
triggers:
  - 调用其他产品组
  - 内部产品组对接
  - 收费组接口
  - 护理组接口
  - 手术组接口
  - 药房组接口
  - 患者组接口
  - 病案组接口
  - 物资组接口
  - 床位组接口
  - 东华内部对接
  - HIS产品组调用
  - feign接口
  - service接口
  - 循环依赖
  - invoke模块
role: specialist
scope: implementation
output-format: code
---

# iMedicalXC Doctor Station Internal Team Invoke Guidelines

医生站组(opcare/ipcare/aggcare/comoe/commr)调用**东华医为内部其他产品组**接口时的规范指南。

**适用范围**: 仅适用于东华医为内部产品组之间的对接（收费组、护理组、手术组、药房组、患者组、病案组、物资组、床位组等）

**不适用范围**: 第三方厂商对接（SPD、医保、外部检验系统等），请参考 `imedicalxc-doctor-extend-engineer` skill

## 内部产品组清单

| 产品组 | 模块名 | 职责 | 医生站组调用场景 |
|--------|--------|------|------------------|
| **收费组** | opar/ipar | 门诊/住院收费 | 医嘱收费、费用查询、结算 |
| **护理组** | ipnur/emnur | 住院/急诊护理 | 转科转床、医嘱执行、护理记录 |
| **手术组** | ipor/emor | 住院/急诊手术 | 手术申请、手术安排、日间手术 |
| **药房组** | pha | 药房管理 | 药品库存、发药、退药 |
| **患者组** | hispa | 患者主索引 | 患者信息查询、卡管理 |
| **病案组** | mrm | 病案管理 | 病案号分配、病案归档 |
| **物资组** | opmsup/ipmsup | 门诊/住院物资 | 物资库存、领用 |
| **床位组** | ipbmc | 床位管理 | 床位分配、床位状态 |

## 核心规范

### 1. 调用位置规范

所有对内部产品组的调用必须封装在独立的 **invoke模块** 中：

```
{调用方}-invoke-{被调用方}/
├── src/main/java/com/mediway/his/{调用方}/invoke/{被调用方}/
│   ├── blh/
│   │   ├── {功能}Abstract.java              # 抽象类封装调用逻辑
│   │   └── ext/
│   │       └── {功能}BLH.java               # 实现类带@BLH注解
│   └── model/
│       ├── dto/                             # 请求DTO
│       └── vo/                              # 响应VO
└── pom.xml
```

**模块命名示例**:
- `opcare-invoke-opar` - 门诊调用收费组
- `opcare-invoke-ipnur` - 门诊调用护理组
- `comoe-paadminvoke` - 医嘱调用护理组(转科)
- `aggcare-invoke-opcare` - 融合服务调用门诊

### 2. 代码结构规范

#### Abstract类模板

```java
package com.mediway.his.{调用方}.invoke.{被调用方}.blh;

import com.mediway.his.api.exception.HisBusinessException;
import com.mediway.his.ctsv.dic.constant.CtApplicationEnum;
import com.mediway.his.{被调用方}.api.{FeignClient};
import com.mediway.his.http.RequestEntity;
import com.mediway.hos.base.model.BaseResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@RequiredArgsConstructor
@Slf4j
public abstract class {功能}Abstract {

    private final String BUSINESS_CODE = "{调用方}.{业务域}.{功能码}";
    private final {FeignClient} {feignClient};

    /**
     * {功能描述}
     */
    public {返回类型} {方法名}({参数类型} dto) {
        // 1. 构建请求
        RequestEntity<{参数类型}> entity = new RequestEntity<>();
        entity.setData(dto);
        
        // 2. 调用Feign接口
        BaseResponse<{返回类型}> response = {feignClient}.{方法名}(entity);
        
        // 3. 统一异常处理
        if (!response.isSuccess()) {
            log.error("{功能描述}失败,code:{},msg:{}", 
                    response.getCode(), response.getMsg());
            throw HisBusinessException.rpcException(response.getCode(),
                    CtApplicationEnum.{被调用服务}.getErrNamePre("{功能描述}") 
                    + response.getMsg());
        }
        
        return response.getData();
    }
}
```

#### BLH实现类模板

```java
package com.mediway.his.{调用方}.invoke.{被调用方}.blh.ext;

import com.mediway.his.hisbase.doc.annotation.BLH;
import com.mediway.his.{调用方}.invoke.{被调用方}.blh.{功能}Abstract;
import com.mediway.his.{被调用方}.api.{FeignClient};

@BLH(value = "{调用方}.invoke.{被调用方}.{功能}BLH", 
     version = "1.0.0", 
     notes = "{功能描述}")
public class {功能}BLH extends {功能}Abstract {
    
    public {功能}BLH(final {FeignClient} {feignClient}) {
        super({feignClient});
    }
}
```

### 3. 循环依赖防止

**禁止场景**:
```
❌ 双向依赖: opcare ↔ opar (A调用B，B也调用A)
❌ 间接循环: opcare → ipnur → ipar → opcare
❌ 下层调上层: comoe → opcare (公共库调用业务模块)
```

**允许场景**:
```
✅ 单向调用: opcare → opar → ipnur
✅ 上层调下层: aggcare → opcare → comoe
```

**层级架构**:
```
aggcare (融合层) → opcare/ipcare (业务层) → comoe/commr (公共库层) → 其他产品组
```

**创建invoke模块前必须检查**:
1. 被调用方是否已依赖调用方？
2. 是否存在间接循环依赖？
3. 是否符合层级架构（上层→下层）？

### 4. 异常信息规范

**格式**: `[{产品组}][{功能}] {错误信息}`

**示例**:
```
【收费组】【创建结算订单】患者信息不存在
【护理组】【获取病区床位】服务调用超时
【手术组】【验证日间手术】参数校验失败
```

**代码实现**:
```java
// 使用CtApplicationEnum获取产品组前缀
CtApplicationEnum.OPAR.getErrNamePre("创建结算订单") + response.getMsg()
// 结果: 【收费组】【创建结算订单】患者信息不存在
```

**CtApplicationEnum参考**:
```java
public enum CtApplicationEnum {
    OPAR("opar", "【收费组】"),      // 门诊收费
    IPAR("ipar", "【收费组】"),      // 住院收费
    IPNUR("ipnur", "【护理组】"),    // 住院护理
    EMNUR("emnur", "【护理组】"),    // 急诊护理
    IPOR("ipor", "【手术组】"),      // 住院手术
    EMOR("emor", "【手术组】"),      // 急诊手术
    PHA("pha", "【药房组】"),        // 药房
    HISPA("hispa", "【患者组】"),    // 患者主索引
    MRM("mrm", "【病案组】"),        // 病案管理
    OPMSUP("opmsup", "【物资组】"),  // 门诊物资
    IPMSUP("ipmsup", "【物资组】"),  // 住院物资
    IPBMC("ipbmc", "【床位组】");    // 床位管理
}
```

## 实际案例

### 案例1: 门诊调用收费组创建结算单

**模块**: `opcare-invoke-opar`

```java
// Abstract类
@Slf4j
@RequiredArgsConstructor
public abstract class ArOPChargeAPIAbstract {
    
    private final ArOPChargeAPI arOPChargeAPI;
    
    public ArOpOrderVO createSetlOrder(FeignOPCreateSetlOrderDTO dto) {
        BaseResponse<ArOpOrderVO> response = arOPChargeAPI.createSetlOrder(dto);
        
        if (!response.isSuccess()) {
            log.error("创建交易单号失败,code:{},msg:{}", 
                    response.getCode(), response.getMsg());
            throw HisBusinessException.rpcException(response.getCode(),
                    CtApplicationEnum.OPAR.getErrNamePre("创建结算订单") + response.getMsg());
        }
        
        return response.getData();
    }
}

// BLH实现类
@BLH(value = "opcare.invoke.opar.ArOPChargeAPIBLH", version = "1.0.0")
public class ArOPChargeAPIBLH extends ArOPChargeAPIAbstract {
    public ArOPChargeAPIBLH(final ArOPChargeAPI arOPChargeAPI) {
        super(arOPChargeAPI);
    }
}
```

### 案例2: 门诊调用手术组验证日间手术

**模块**: `opcare-invoke-ipor`

```java
// Abstract类
@Slf4j
@RequiredArgsConstructor
public abstract class AppointmentClientAbstract {
    
    private final AppointmentClient appointmentClient;
    
    public DayOperVO checkValidDayOper(DayOperDTO dto) {
        RequestEntity<DayOperDTO> entity = new RequestEntity<>();
        entity.setData(dto);
        
        BaseResponse<DayOperVO> response = appointmentClient.checkValidDayOper(entity);
        
        if (!response.isSuccess()) {
            log.error("验证日间手术有效性失败,code:{},msg:{}", 
                    response.getCode(), response.getMsg());
            throw HisBusinessException.rpcException(response.getCode(),
                    CtApplicationEnum.IPOR.getErrNamePre("验证日间手术有效性") + response.getMsg());
        }
        
        return response.getData();
    }
}

// BLH实现类
@BLH(value = "opcare.invoke.ipor.AppointmentClientBLH", version = "1.0.0")
public class AppointmentClientBLH extends AppointmentClientAbstract {
    public AppointmentClientBLH(final AppointmentClient appointmentClient) {
        super(appointmentClient);
    }
}
```

### 案例3: 医嘱调用护理组判断转科医嘱

**模块**: `comoe-paadminvoke`

```java
// Abstract类
public abstract class IpNurTransAbstract {
    
    @Resource(name = "hiscfsv.ipcare.doctor.busGeneralConfigBLH")
    private BusGeneralConfigBLH busGeneralConfigBLH;
    
    @Nullable
    public String getTransOrdType(GetTransOrdTypeDTO dto) {
        // 从护理组配置获取转科/转病区子类
        BusGeneralConfigDTO configDTO = new BusGeneralConfigDTO();
        configDTO.setModuleCode("nr.ipnur.transfer");
        configDTO.setConfigCode("medorder_id_transfer_dep");
        String transDepOrdCat = busGeneralConfigBLH.getParamStr(configDTO);
        
        configDTO.setConfigCode("medorder_id_transfer_ward");
        String transWardOrdCat = busGeneralConfigBLH.getParamStr(configDTO);
        
        // 判断逻辑...
        return transType;
    }
}

// BLH实现类
@BLH(value = "comoe.ord.IpNurTransBLH", version = "1.0.0",
     notes = "住院护理转科相关信息_与护理组交互的相关接口")
public class IpNurTransBLH extends IpNurTransAbstract {
}
```

## 使用方式

### 在业务BLH中注入

```java
public abstract class OpCareOeOrdItemEntryAbstract {
    
    // 使用@Resource注入invoke模块
    @Resource(name = "opcare.invoke.opar.ArOPChargeAPIBLH")
    private ArOPChargeAPIBLH arOPChargeAPIBLH;
    
    @Resource(name = "opcare.invoke.ipor.AppointmentClientBLH")
    private AppointmentClientBLH appointmentClientBLH;
    
    public void processOrder() {
        // 调用收费组接口
        ArOpOrderVO order = arOPChargeAPIBLH.createSetlOrder(dto);
        
        // 调用手术组接口
        DayOperVO dayOper = appointmentClientBLH.checkValidDayOper(dto);
    }
}
```

## pom.xml 依赖

```xml
<dependencies>
    <!-- 1. 被调用产品组的 API 模块 -->
    <dependency>
        <groupId>com.mediway.his</groupId>
        <artifactId>{opar/ipar/ipnur/ipor/pha/hispa/mrm}-api</artifactId>
        <version>${project.parent.version}</version>
    </dependency>
    
    <!-- 2. 基础框架 -->
    <dependency>
        <groupId>com.mediway.his</groupId>
        <artifactId>hisbase-doctor</artifactId>
        <version>${project.parent.version}</version>
    </dependency>
    
    <!-- 3. 字典服务（用于 CtApplicationEnum） -->
    <dependency>
        <groupId>com.mediway.his</groupId>
        <artifactId>hisctsv-dic</artifactId>
        <version>1.0-SNAPSHOT</version>
    </dependency>
</dependencies>
```

## 约束清单

### 必须遵守

- [ ] 所有对内部产品组的调用必须封装在独立的 invoke 模块中
- [ ] Abstract 类必须使用 `@RequiredArgsConstructor` 和 `@Slf4j`
- [ ] BLH 实现类必须使用 `@BLH` 注解
- [ ] 异常信息必须包含产品组标识和功能标识：`【{产品组}】【{功能}】{错误}`
- [ ] 必须使用 `CtApplicationEnum` 获取错误前缀
- [ ] 创建 invoke 模块前必须检查循环依赖
- [ ] 必须使用 `@Resource(name = "...")` 注入 invoke 模块
- [ ] 必须使用 `HisBusinessException.rpcException` 包装 RPC 异常

### 禁止事项

- [ ] 禁止在业务 BLH 中直接注入其他产品组的 FeignClient
- [ ] 禁止使用 `@Autowired` 注入依赖
- [ ] 禁止出现循环依赖（A↔B）
- [ ] 禁止下层模块调用上层模块（comoe 禁止调用 opcare）
- [ ] 禁止直接返回 Feign 响应而不处理异常
- [ ] 禁止将第三方厂商对接混入此规范（第三方使用 external 模块）

## 与第三方对接的区别

| 场景 | 处理方式 | 参考文档 |
|------|----------|----------|
| **内部产品组对接** | 使用 invoke 模块，遵循本规范 | 本 skill |
| **第三方厂商对接** | 使用 external 模块，遵循三层架构 | `imedicalxc-doctor-extend-engineer` |

**第三方厂商示例**：SPD 系统、医保系统、外部检验系统、外部影像系统等

## 相关技能

- **imedicalxc-doctor-extend-engineer** — 第三方厂商对接全流程编排器（External 模块、三层架构）
- **imedicalxc-doctor-blh** — BLH 模式开发规范
- **imedicalxc-doctor-dbdata** — 数据库查询规范

本 skill 基础目录：file:///C:/Users/tanxi/.config/costrict/skills/imedicalxc-doctor-invoke
