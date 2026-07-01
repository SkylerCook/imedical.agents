---
name: imedicalxc-doctor-data-extraction
description: |
  数据抽取与第三方接口对照文档生成。
  Use when 需要从 @OpenApi Controller 抽取接口数据，扫描分类现有接口并生成第三方接口与 Feign 标准接口的字段级对照文档（核心功能）。
  也可按需生成 Feign 标准接口代码和 API 文档（辅助功能）。
  Triggers: "数据抽取"、"接口对照"、"字段映射"、"对比文档"、"Feign接口对照"、"第三方接口映射"、
  "生成Feign接口"、"OpenApi接口改造"、"Feign化"、"API文档"。
---

# 数据抽取与对照文档生成工作流

## 工作流总览

本 skill 以 **数据抽取** 为核心，主要输出**第三方接口对照文档**；Feign 接口代码生成为辅助功能。

```
Phase 1: 数据抽取               Phase 2: 对照文档生成(核心)      Phase 3: Feign接口生成(辅助)
┌──────────────────────┐    ┌───────────────────────────┐    ┌──────────────────────────┐
│ 1.1 扫描 @OpenApi     │ → │ 2.1 解析第三方PDF/DOC       │ → │ 3.1 创建API模块            │
│ 1.2 分类统计          │    │ 2.2 确定责任组+接口优先级    │    │ 3.2 生成DTO/VO             │
│ 1.3 排除厂家专属       │    │ 2.3 字段级映射(读VO源码)    │    │ 3.3 生成Feign接口           │
│ 1.4 确定接口范围       │    │ 2.4 生成对照文档            │    │ 3.4 生成MapStruct           │
│                      │    │ 2.5 文档质量自检            │    │ 3.5 生成实现Controller      │
│                      │    │                           │    │ 3.6 API文档生成             │
│                      │    │                           │    │ 3.7 质量检查                │
└──────────────────────┘    └───────────────────────────┘    └──────────────────────────┘
```

> **使用指引**：如果只需要生成对照文档（不需要改代码），执行 Phase 1 → Phase 2 即可。
> 如果还需要生成/改造 Feign 接口，则执行 Phase 1 → Phase 3（Phase 2 的对照文档仍可独立使用）。

---

## Phase 1: 数据抽取——扫描与分析

从指定模块中抽取所有 @OpenApi 接口信息，形成待处理清单。

### Step 1.1: 扫描所有 @OpenApi Controller

```bash
grep -rl "@OpenApi" {target_directory} --include="*.java" | grep -v ".costrict\|CLAUDE\|generator"
```

### Step 1.2: 读取 @Api Tag 分类

```bash
grep -rn "@Api(tags\s*=" {target_directory} --include="*.java"
```

**分类规则**：

| 分类         | 判断依据                                                               | 处理        |
| ------------ | ---------------------------------------------------------------------- | ----------- |
| **通用接口** | @Api tag 描述通用业务功能                                               | ✅ 纳入     |
| **厂家专属** | 路径或 tag 含厂家名称（如积水潭、湖南、美康、北京、贵州、iMedical、创智和宇 等） | ❌ 排除     |

> 注意：`国家平台`、`集成平台` 等国家级/基础设施级接口通常应纳入通用接口，需根据实际情况判断。

### Step 1.3: 确定模块归属

```bash
ls -d {module}-api/{module}-api-{sub} 2>/dev/null || echo "需新建API模块"
```

### Step 1.4: 输出待处理清单

```
| # | 原Controller | @Api Tag | 所属模块 | 方法数 | 接口路径 | 备注 |
|---|-------------|----------|----------|--------|---------|------|
```

---

## Phase 2: 对照文档生成（核心功能）

将第三方接口文档（PDF/DOC）的字段，映射到已抽取的 Feign 标准接口 VO 字段，生成完整的字段级对照文档。

### Step 2.1: 提取第三方文档

```bash
pdftotext -layout "目标文档.pdf" content.txt
grep -n "接口说明\|接口定义\|http.*v[0-9]/" content.txt
```

> `pdftotext` 对中文标题提取效果差，优先从 JSON 示例反推字段名和顺序；标题需人工对齐确认。

从 PDF 文本中提取：
- 字段名、中文说明、数据类型、长度
- 字段顺序必须与 PDF JSON 示例一致
- `字段说明(PDF)` 列必须来自 PDF 原文，**不可自行编造**

### Step 2.2: 接口优先级与责任组

#### 接口选择优先级

| 优先级 | 数据源                      | 说明                                                                                       |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------ |
| 1      | **aggcare Feign 接口**      | 融合诊疗服务聚合了患者+就诊+医嘱+诊断等临床数据，一个接口可覆盖多个数据域                    |
| 2      | **opreg Feign 接口**        | 挂号预约底层业务接口，仅作**补充/兜底**使用（如详细地址、排班信息等 getPatQueryList 不提供的字段） |
| 3      | **opcare-ipbook 等**        | 住院证等特定业务。`IpBookQueryStandardClient.getIpBookInfo` 为主接口（50+字段），`getIpBookMedicalRecord` 获取住院证URL（取最后一条 `documentPath`），患者人口学字段用 `QueryPaPatClient.getPaPatMasStandard` 补充 |

**最小化原则**：
- 每个 PDF 接口优先用 **1个 aggcare 接口** 满足，不足再补
- 禁止对一个 PDF 接口使用 3 个以上的 Feign 接口拼装
- 例如：`AggcarePaadmInfoClient.getPatQueryList` 一次返回 FeignPatientVO + FeignEncounterVO，可同时满足患者信息 + 挂号就诊信息

#### 责任组标注

每个 PDF 接口需明确标注**数据提供方**：

| 责任组               | 涉及接口                           | 说明                                                   |
| -------------------- | ---------------------------------- | ------------------------------------------------------ |
| **医生站组**         | 患者/就诊/医嘱/住院证相关          | 通过 aggcare / opcare-ipbook 接口满足                  |
| **电子病历组**       | 病历文书内容（主诉/现病史/体格检查等） | 由 EMR 系统提供                                      |
| **计费组**           | 结算/票据                          | 由门诊收费系统(opar)提供                               |
| **临床手麻组**       | 手术记录                           | 由临床手麻提供                                         |

非医生站组负责的接口，字段映射表全部置为 `--`，标注负责组名称。

### Step 2.3: 字段级映射

#### 映射表列结构（5+N列）

| PDF字段 | 字段说明(PDF) | 来源Feign接口 | 来源VO字段(实际字段名) | 获取方式 | 备注 |

#### 硬性规则

- `字段说明(PDF)` 列：必须从 PDF 文档提取（如 "就诊号"、"性别代码(GB/T 2261.1)"），**不可自行编造**
- `来源VO字段` 列：必须使用**实际源码中的 VO 字段名**，**严禁虚构字段名**。命名规范：嵌套对象用 `.` 分隔（如 `orderMaster.orderCode`、`medicationRequest.medPrescNo`、`documentList[].documentPath`）
- 字段顺序**必须与 PDF 入参顺序一致**（以 PDF 的 JSON 示例为准）
- 对于 PDF 中存在但 Feign VO 中无对应字段的，标注为 `--` 并说明原因
- `获取方式` 列取值：`直接映射` | `计算获取` | `补充获取` | `--`
- 对于嵌套 Array 类型（如 `orders[]`、`diagnoses[]`、`chargeItems[]`），需展开子字段到独立行

#### 字段校验流程

```
1. 读取 PDF JSON 示例 → 确定字段列表和顺序
2. 读取 Feign VO 源码 → 确定实际可用字段（grep 验证）
3. 建立映射 → 虚构字段标注为 --
4. 交叉验证 → 每个来源VO字段真实存在于源码
5. 以最新 API 文档校验 → 读取 Feign接口API文档 中对应接口的出参字段表，VO嵌套层级必须一致
   （如 paPatAddress.liveAddress.liveProvinceCode 而非凭空简化的 paPatAddress.liveProvinceCode）
6. 检查遗漏 → 确保所有PDF字段都有对应行
```

#### 常见VO字段路径陷阱

| 错误假设                               | 实际                                                             |
| -------------------------------------- | ---------------------------------------------------------------- |
| `FeignPatientInfoVO`                   | 实际是 `FeignPatientDataVO` 或 `FeignGetPaPatVO` — grep 确认    |
| `paPatAddress.liveProvinceCode`        | 实际路径含中间层：`paPatAddress.liveAddress.liveProvinceCode`    |
| `orderCode` 平展                       | 医嘱分 master 层：`orderMaster.orderCode`                        |
| `diagnoses` 列表名                     | 可能是 `diagnose` 或 `diagnosList` — 读源码确认                  |
| `FeignIpBookInfoRecordVO` 含患者信息   | 不含患者性别/出生日期/证件 — 需 QueryPaPatClient 补充            |

#### 常见计算字段模式

**状态→布尔值推导**：

```java
// 示例：isEffective 由 currentStateCode 推导
boolean isEffective = !List.of("Admission", "Cancel", "Void")
    .contains(record.getCurrentStateCode());
```

- 标注字典查询位置（如：通用字典 → 住院证状态）
- 列出完整枚举值和对应的布尔结果

**嵌套List取值**：

```
// 从诊断列表取主诊断
diagnosList → 过滤 diagTypeCode = "入院诊断" → 拼接 diagnosPrefix + icdDesc
```

**多接口串联取值**：

```
// URL字段通过第二个接口获取
Step 1: getIpBookInfo → 得到 ipEncounterID
Step 2: getIpBookMedicalRecord(encounterID=Step1.ipEncounterID) → 取 documentPath
```

#### 患者字段补充模式

当核心 VO 缺少患者人口学字段时，用 `QueryPaPatClient.getPaPatMasStandard` 补充：

| PDF字段            | → Feign VO字段    |
| ------------------ | ----------------- |
| genderCode         | `sexCode`         |
| birthDate          | `birthDay`        |
| identifierTypeCode | `credTypeCode`    |
| identifierValue    | `credNo`          |

### Step 2.4: 生成对照文档

#### 文档结构

```markdown
# Feign接口与{目标文档}对比文档
## 文档版本历史
## 一、概述（目的、范围、责任组、接口列表）
## 二、Feign接口全景（接口表 + VO类型表）
## 三、逐接口详细说明  ← 核心章节（无需单独的"接口映射总览表"，与详细映射表合并即可）
  ### 3.x {PDF标题} (url路径) -- PDF 章节
  #### 3.x.1 PDF接口定义（完整入参字段表，含字段说明PDF列）
  #### 3.x.2 可满足的Feign接口映射
    - 设计原则（aggcare优先 / 最小化接口数）
    - 涉及的Feign接口表（含优先级：核心/补充/兜底）
    - 完整字段级映射表（PDF字段 | 字段说明(PDF) | Feign接口 | VO字段 | 获取方式 | 备注）
    - 特殊规则说明（isEffective判定、字典位置等）
    - 调用流程（Step 1 → Step N）
    - 无可映射字段汇总
## 附录（责任组对照表、核心接口速查、Maven依赖）
```

**精简原则**：
- 聚焦**第三章逐接口详细说明**，其余章节按需保留
- 不重复 V5 API 文档已有的 Feign 接口详细定义（入参/出参字段表、JSON示例等）
- **不要**单独创建"接口映射总览表"章节——与详细映射表合并即可，避免重复维护
- 附录仅保留：责任组对照表 + 核心Feign接口速查 + 版本历史

#### 接口表格式

```markdown
| 优先级 | 接口 | 方法 | 说明 |
|:---:|------|------|------|
| **核心** | `XxxClient` | `methodName` | 主要数据来源 |
| **补充** | `YyyClient` | `methodName` | 补充字段说明 |
| 备用 | `ZzzClient` | `methodName` | 不推荐使用 |
```

#### 调用流程格式

```
Step 1: 调用 {核心接口}(dto)
        入参: dto.{字段} = PDF.{对应字段}
        获取: {VO} (主数据)

Step 2: 调用 {补充接口}(dto)
        入参: dto.{字段} = Step1.{返回值字段}
        获取: {VO} (补充数据)
        → 取 {具体字段} 作为 {PDF字段}

Step N: 组装 PDF 出参
        N.1 直接映射 Step1 中的字段
        N.2 补充 Step2 中的字段
        N.3 计算派生字段（状态、拼接值等）
```

### Step 2.5: 对照文档质量自检

- [ ] 所有 PDF 字段都有对应行（无遗漏）
- [ ] 每个 `来源VO字段` 均可通过 `grep` 在源码中验证存在
- [ ] 字段顺序与 PDF JSON 示例一致
- [ ] `字段说明(PDF)` 来自 PDF 原文，未自行编造
- [ ] PDF 接口标题与 PDF 原文一致
- [ ] aggcare 接口优先于 opreg 接口
- [ ] 非医生站组接口已标注责任组，字段置 `--`
- [ ] 接口拼装数 ≤ 3（核心 1 + 补充 ≤ 2）
- [ ] 计算字段标注了推导规则和字典位置
- [ ] 无可映射字段汇总完整（含原因说明）
- [ ] 无重复章节（无单独的接口映射总览表）
- [ ] 映射表含 `字段说明(PDF)` 列
- [ ] 接口命名格式统一为 `ClassName.methodName`

---

## Phase 3: Feign 接口生成（辅助功能）

> **⚠️ 辅助功能**：仅在需要改造/新建 Feign 接口时执行此阶段。如果只需对照文档，跳过此阶段。

### Step 3.1: 创建 API 模块

```bash
mkdir -p {module}-api/{module}-api-{sub}/src/main/java/com/mediway/his/{module}/api/{sub}/{feign,dto,vo,model}
```

**pom.xml 模板**：

```xml
<parent>
    <groupId>com.mediway.his</groupId>
    <artifactId>{module}-api</artifactId>
    <version>1.0-SNAPSHOT</version>
</parent>
<artifactId>{module}-api-{sub}</artifactId>
<dependencies>
    <!-- 仅允许：Spring Cloud OpenFeign + Lombok + Swagger + Jackson -->
</dependencies>
```

**注册到父 pom**：在 `{module}-api/pom.xml` 的 `<modules>` 中添加：

```xml
<module>{module}-api-{sub}</module>
```

### Step 3.2: 生成 Feign DTO/VO

**核心规则**：

| 规则       | 说明                                                              |
| ---------- | ----------------------------------------------------------------- |
| 命名       | `Feign` + 原 DTO/VO 名                                            |
| 继承处理   | 不继承跨模块父类，平展父类字段并标注 `// 来自 {ParentClassName}` |
| 类注释     | `该类来自于 {@link 原始类FQCN}`                                   |
| 禁止注释   | DTO/VO **不要**添加 `【提供给集成平台】`（仅 Feign 接口类需要）   |
| 包路径     | `com.mediway.his.{module}.api.{sub}.dto.{domain}`                 |

```java
/**
 * 该类来自于 {@link com.mediway.his.xxx.xxx.OriginalDTO}
 *
 * @description: 功能描述 数据传输对象
 */
@Data
@ApiModel(value = "FeignXxxDTO", description = "功能描述 数据传输对象")
public class FeignXxxDTO {

    // 来自 ExternalStandardRootDTO（平展父类字段）
    @ApiModelProperty("渠道标识")
    private String channelType;
    @ApiModelProperty("终端编码")
    private String terminalId;
    @ApiModelProperty("操作用户代码")
    private String userCode;
    @ApiModelProperty("院区代码")
    private String hospCode;
    @ApiModelProperty(value = "操作用户id", hidden = true)
    private Long userId;
    @ApiModelProperty(value = "操作用户所属安全组id", hidden = true)
    private Long groupId;
    @ApiModelProperty(value = "院区id", hidden = true)
    private Long hospId;

    // --- 原始字段 ---
    @ApiModelProperty(value = "字段中文名")
    private String originalField;
}
```

**重复类型处理**：如果多个原 Controller 引用同一原始类型，Feign 版本只保留一份（放在主引用方包中），其他方通过 import 引用。

### Step 3.3: 生成 Feign 接口

```java
/**
 * 【提供给集成平台的标准接口】
 * {功能描述} Feign 客户端
 * <p>
 * 本接口为 OpenApi 接口 {@link {原ControllerFQCN}} 对应的 Feign 客户端接口
 *
 * @author {author}
 * @since {date}
 */
@FeignClient(value = "${mediway.application.{module}}",
    path = "${server.servlet.context-path}/{module}/api/{submodule}/{className}")
public interface {Name}Client {

    /**
     * {方法功能描述}
     *
     * @param dto 入参对象
     * @return {@link EsbBaseResponse}<{@link FeignXxxVO}>
     * @author {author}
     * @since {date}
     */
    @PostMapping(value = "{methodPath}", consumes = "application/json")
    EsbBaseResponse<FeignXxxVO> {methodName}(@RequestBody EsbBaseDTO<FeignXxxDTO> dto);
}
```

**方法注解规则**：

| 注解            |   是否必需   | 说明                                                     |
| --------------- | :----------: | -------------------------------------------------------- |
| `@PostMapping`  | **必需**     | `value = "方法路径"`, `consumes = "application/json"`    |

> `@ApiOperation` **不需要**加在 FeignClient 接口方法上。FeignClient 是声明式 HTTP 客户端，不暴露给 Swagger，`@ApiOperation` 仅在 Controller 实现类上生效。

**@FeignClient 路径规则（CRITICAL）**：

| 路径段        | 值                                                                                        | 说明                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `value`       | `"${mediway.application.{module}}"`                                                       | `{module}` = 父Maven模块名（如 aggcare、opreg、opcare、hispa、ipcare、opalloc、curc、ma）                                                              |
| `path` 前缀   | `"${server.servlet.context-path}/"`                                                       | **固定值**，禁止使用 `${sys.restfulPath}`                                                                                                             |
| `path` 模块   | `{module}/api/{submodule}/`                                                               | `{module}` 同 value；`api` 为固定段；`{submodule}` 为当前子模块路径（如 doc、external、adm、schedule、conting、ipbook、ant）                           |
| `path` 类名   | `{className}`                                                                             | FeignClient 接口类的完整类名首字母小写，**不可截断**（如 `AggcarePaCardTypeClient` → `aggcarePaCardTypeClient`，非 `paCardTypeClient`）               |

**完整示例**：

```java
// aggcare 模块，api-doctor 子模块
@FeignClient(value = "${mediway.application.aggcare}",
    path = "${server.servlet.context-path}/aggcare/api/doc/aggcareRisEntryClient")

// opreg 模块，api-external 子模块
@FeignClient(value = "${mediway.application.opreg}",
    path = "${server.servlet.context-path}/opreg/api/external/regInterfaceClient")

// opcare 模块，api-conting 子模块
@FeignClient(value = "${mediway.application.opcare}",
    path = "${server.servlet.context-path}/opcare/api/conting/initOeClient")
```

**关键规则**：
- 出入参类型：`EsbBaseDTO<FeignXxxDTO>` / `EsbBaseResponse<FeignXxxVO>`
- `@Valid`、`@Deprecated` 与原 Controller 保持一致
- **注解位置**：`@FeignClient` 必须在类 Javadoc 注释**之后**、类声明**之前**（Javadoc → 注解 → class）

### Step 3.4: 生成 MapStruct 转换器

位置：`{module}-{sub}/utils/{Module}MapStruct.java`

**方法命名规范**：

| 方向                                                   | 命名                                               |
| ------------------------------------------------------ | -------------------------------------------------- |
| FeignDTO → 原始DTO                                     | `to{Name}(Feign{Name} dto)`                        |
| 原始VO → FeignVO                                       | `toFeign{Name}({OriginalVO} vo)`                   |
| 原始VO List → FeignVO List                             | `toFeign{Name}List(List<{OriginalVO}> list)`       |
| EsbBaseDTO<FeignDTO> → EsbBaseDTO<原始DTO>             | `toEsbBase{Name}(EsbBaseDTO<Feign{Name}> dto)`     |

> `toEsbBase*` 方法利用 MapStruct 自动映射：逐字段 copy client/header 等 EsbBaseDTO 元数据 + 调用 `to{Name}()` 映射内部 data 字段。

```java
@Mapper(componentModel = "spring")
public interface {Module}MapStruct {

    // DTO映射
    {OriginalDTO} to{Name}({FeignDTO} dto);

    // EsbBaseDTO包装映射（完整复制client/header等元数据 + data字段映射）
    EsbBaseDTO<{OriginalDTO}> toEsbBase{Name}(EsbBaseDTO<{FeignDTO}> dto);

    // VO映射
    {FeignVO} toFeign{Name}({OriginalVO} vo);
    List<{FeignVO}> toFeign{Name}List(List<{OriginalVO}> list);
}
```

### Step 3.5: 生成实现 Controller

位置：`{module}-{sub}/controller/{domain}/external/{Name}ClientController.java`

```java
/**
 * {功能描述} Feign 客户端实现
 * 本接口对应的 Feign 客户端为 {@link {Name}Client}
 *
 * @author {author}
 * @since {date}
 */
@RestController
@RequestMapping("/{module}/api/{submodule}/{className}")
@Api(tags = "{功能描述}")
public class {Name}ClientController implements {Name}Client {

    @Resource
    private {Module}MapStruct mapStruct;

    @Resource(name = "{module}.{sub}.{blhName}")
    private {BLH} blh;

    @ApiOperation(value = "{描述}")
    @Override
    @PostMapping(value = "{methodPath}", consumes = "application/json")
    public EsbBaseResponse<{FeignVO}> {methodName}(
            @RequestBody EsbBaseDTO<{FeignDTO}> dto) {
        // 1. 完整转换 EsbBaseDTO（含client等元数据）
        EsbBaseDTO<{OriginalDTO}> originalDto = mapStruct.toEsbBase{Name}(dto);
        // 2. 调用BLH
        {OriginalVO} result = blh.{blhMethod}(originalDto);
        // 3. 转换返回值
        {FeignVO} feignVO = mapStruct.toFeign{Name}(result);
        return EsbBaseResponse.success(feignVO);
    }
}
```

**@RequestMapping 路径规则（CRITICAL）**：

| 规则     | 说明                                                                                  |
| -------- | ------------------------------------------------------------------------------------- |
| 路径来源 | 直接取 FeignClient `path` 中 `${server.servlet.context-path}` **之后**的部分          |
| 格式     | `"/{module}/api/{submodule}/{className}"` — 以 `/` 开头的硬编码路径                   |
| 禁止     | **严禁**使用 `${sys.restfulPath}` 占位符                                              |

**FeignClient 与 Controller 路径对应关系**：

```
FeignClient path:  ${server.servlet.context-path}/aggcare/api/doc/aggcareRisEntryClient
Controller path:                       /aggcare/api/doc/aggcareRisEntryClient
                                       ↑ 直接取后半部分
```

**注解位置**：`@RequestMapping` 必须在类 Javadoc 注释**之后**、类声明**之前**（Javadoc → @RestController → @RequestMapping → @Api → class）

**方法注解规则（CRITICAL）**：

| 注解              |   是否必需   |        顺序         | 说明                                                                            |
| ----------------- | :----------: | :-----------------: | ------------------------------------------------------------------------------- |
| `@ApiOperation`   | **必需**     |       最上方        | `value = "功能描述"`，不加 `httpMethod`（Swagger 从 @PostMapping 自动推断）     |
| `@Override`       | **必需**     | `@ApiOperation` 下方 | 实现 FeignClient 接口方法                                                       |
| `@PostMapping`    | **必需**     |  `@Override` 下方   | `value = "方法路径"`, `consumes = "application/json"`                           |

**注解顺序**：方法 Javadoc → `@ApiOperation` → `@Override` → `@PostMapping` → 方法签名

> `@ApiOperation` 只加 `value`，不需要 `httpMethod`（冗余）和 `notes`（按需）。

**Import 要求**：

```java
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.PostMapping;
```

**禁止的错误写法**：

```java
// ❌ 错误：手动提取data再new EsbBaseDTO，丢失client/header元数据
FeignXxxDTO feignData = dto.getData();
XxxDTO internalData = mapStruct.toXxxDTO(feignData);
EsbBaseDTO<XxxDTO> internalDto = new EsbBaseDTO<>();
internalDto.setData(internalData);
```

**正确写法**：

```java
// ✅ 正确：MapStruct完整转换整个EsbBaseDTO包装体
EsbBaseDTO<XxxDTO> internalDto = mapStruct.toEsbBaseXxxDTO(dto);
```

### Step 3.6: Feign接口API文档生成

**输出文件**：`Feign接口API文档-集成平台标准接口.md`

#### 标题层级规范（CRITICAL）

全文统一为 **5级结构**，不得跳级，不得使用文字型章节标题：

```
# 文档标题                                         (H1)
## N. 大章节                                        (H2 — 文档顶级章节)
### 4.X 模块名 — 服务名                              (H3 — 模块)
#### 4.X.Y 功能描述 — ClientName                     (H4 — Feign Client，描述在前名称在后)
##### 4.X.Y.Z 功能描述 — methodName                  (H5 — 方法，含完整序号)
```

**禁止**：
- 使用 `######` (H6) 级别标题
- 使用 "第三章"、"第一部分" 等非数字标题
- 同级标题含义混用（如同一层级既有Client又有方法）
- 标题格式 `ClientName — 功能描述`（名称在前）→ 必须 `功能描述 — ClientName`（描述在前）

#### JSON示例格式规范（CRITICAL）

**入参JSON** — 必须包含完整 EsbBaseDTO 包装：

```json
{
    "current": "1",
    "size": "20",
    "client": {
        "userCode": "会话创建用户工号",
        "deptCode": "会话创建科室代码",
        "hospCode": "会话创建院区代码",
        "channelType": "渠道代码",
        "terminalId": "终端编码"
    },
    "data": {
        "fieldName": "字段中文含义"
    }
}
```

**出参JSON** — 必须使用 `code`/`msg`/`version` 格式：

```json
{
    "code": "200",
    "msg": "成功",
    "version": "v1.0",
    "data": {
        "fieldName": "字段中文含义"
    }
}
```

**JSON格式硬性规则**：
- 每个字段的值 = 字段的**中文含义**（非示例数据如"张三"、"139xx"）
- 入参必须包含 `current`、`size`、`client`（含5个子字段）→ 不可省略
- 出参必须 `"code": "200"`、`"msg": "成功"`、`"version": "v1.0"`
- **严禁**使用 `resultCode`/`resultContent` 替代 `code`/`msg`
- List返回类型：`"data": [{...}]`，数组内只放1个元素
- Boolean值用 `true`/`false`（不加引号）
- 代码块使用3反引号（`` ```json `` / `` ``` ``），**严禁**4反引号

#### 字段表格式规范（CRITICAL）

**入参/出参字段表**统一列结构：

| 节点 | 名称 | 数据类型 | 长度 | 是否必需 | 备注 |

**规则**：
- 仅列出 `data` 内部的字段，**禁止** `data.` 前缀
- **出参表**：List/Array 类型子节点**必须**使用独立子表格，**绝对禁止**任何形式内联
- **入参表**：`data[].fieldName` 格式可用于描述数组入参的每个元素字段（如 `| data[].valueType | 条件类型 | String |`）。因为入参的数组元素没有独立的VO类名，用 `data[]` 前缀区分这是合法且推荐的
- **嵌套深度**：出参VO至少展开3级（如 records → patient → encounter → diagnose）
- **公共VO复用**：FeignPatientVO、FeignEncounterVO、FeignOrderMasterVO 等公共VO在文档多处引用时，每处都要独立展开（文档需自包含，避免交叉引用）

**出参正确示例**（独立子表）：

```
| records | 数据列表 | array | List<XxxVO> |

**records 子节点说明**（XxxVO）
| 字段 | 名称 | 数据类型 | 备注 |
|------|------|----------|------|
| field1 | 字段1 | String | |
```

**错误示例**（前缀式+内联式，禁止）：

```
| records.field1 | 字段1 | String | |  ← 禁止（前缀式）
| data[].field1  | 字段1 | String | |  ← 禁止（内联式）
| records[].mrDiaFavCat[].children[].diagItemID | ... | |  ← 禁止（深层内联，不可读）
```

**内联展开（INLINE）为绝对禁止格式**。即使字段数少（如只有3个字段），也必须拆为独立子表。

#### 接口定义表格式

每个方法必须包含完整的接口定义表：

| 请求方式 | POST |
| 服务地址 | 完整路径（含${server.servlet.context-path}或实际路径） |
| 服务提供者 | ClientName.methodName() |
| Maven依赖 | groupId:artifactId:version（完整坐标，不可缩写） |
| 调用时机 | 功能描述 |
| @OpenApi | code值（从Controller提取） |

#### 文档组装策略（6阶段多轮修复）

| 阶段                    | 操作                                                            | 工具             | 预计修复量 |
| ----------------------- | --------------------------------------------------------------- | ---------------- | :--------: |
| 1. 分片生成             | 按模块/功能分组，每个Agent写一个temp文件                        | 并行Agent(3-6个) |  初始生成  |
| 2. 全局sed修复          | 修复 `resultCode→code`、`data.` 前缀、代码块损坏等通用问题      | sed              |  1000+处   |
| 3. 格式修正             | 补充缺失JSON示例、统一标题层级、修正子节点格式                  | 并行Agent(3-5个) |   100+处   |
| 4. 组装 + 标题统一      | 拼接temp文件 + awk脚本统一H层级                                 | bash + awk       |    全域    |
| 5. **出参内联扫描+修复** | grep扫描出参区域 `[]` 内联残留，Agent逐方法改为独立子表         | Agent(1-2个)     | 10-30个方法 |
| 6. 最终验证             | 按出参区域精确检查，确认0残留                                   | bash + awk       |    验证    |

**关键经验**：阶段5是必须的——Agent初次生成时倾向使用内联格式，必须单独扫描修复。

#### API文档自检命令

```bash
# 1. 检查代码块闭合损坏（```-- 是损坏标记）
grep -c '```--' output.md          # 必须为0

# 2. 检查残留 resultCode/resultContent（应为 code/msg）
grep -c 'resultCode\|resultContent' output.md  # 必须为0

# 3. 检查JSON入参是否缺少 current/size/client 包装
grep -c '"current"' output.md       # 应 >= 方法数

# 4. 检查字段表是否残留 data. 前缀
grep -c '| data\.' output.md        # 必须为0

# 5. 检查出参区域内的内联残留（CRITICAL——最容易遗漏）
#    精确限定在"出参说明"标记之间，不混入入参表
awk '/\*\*出参说明\*\*/,/^##### /' output.md | grep -cP '\|.*\[\]\..*\|'
# 必须为0！如果>0，需逐方法改为独立子表

# 5b. 检查空records数组
grep -c '"records": \[\]' output.md     # 必须为0

# 6. 整体内联参考值（入参表 `data[].xxx` 是合法的数组元素描述格式）
grep -cP '\|.*\[\]\..*\|' output.md  # 入参区域40-60处正常，出参区域必须为0
```

**常见问题速修命令**：

```bash
# 修复 resultCode → code
sed -i 's/"resultCode":/"code":/g; s/"resultContent":/"msg":/g; s/| resultCode |/| code |/g; s/| resultContent |/| msg |/g' output.md

# 修复 data. 字段前缀
sed -i 's/| data\./| /g' output.md

# 修复 ```-- 代码块损坏
sed -i 's/^```--$/```\n\n---/' output.md

# 修复双 #### 标题（awk误处理残留）
sed -i 's/^#### #### /#### /g' output.md
```

### Step 3.7: 质量检查清单

执行以下检查（**前5项为 CRITICAL 路径校验，必须通过**）：

- [ ] **FeignClient 每个方法有 `@PostMapping`**（仅此一个注解，不加 `@ApiOperation`）
- [ ] **Controller 每个方法有 `@ApiOperation`、`@Override`、`@PostMapping`**（三注解都必需，顺序：@ApiOperation → @Override → @PostMapping）
- [ ] **FeignClient path 含 `/api/` 段**（如 `.../aggcare/api/doc/...`，非 `.../aggcare/doc/...`）
- [ ] **FeignClient path 使用 `${server.servlet.context-path}`**（非 `${sys.restfulPath}`）
- [ ] **Controller @RequestMapping 为硬编码路径**（`"/{module}/api/{sub}/{className}"`，非 `${sys.restfulPath}/...`）
- [ ] **路径中 className 为完整 FeignClient 类名首字母小写**（如 `AggcarePaCardTypeClient` → `aggcarePaCardTypeClient`，非截断的 `paCardTypeClient`）
- [ ] **@FeignClient / @RequestMapping 在 Javadoc 之后、类声明之前**（非注解在前注释在后）
- [ ] API 模块 pom.xml **无任何** `hiscore-*` 依赖
- [ ] API 模块 pom.xml **无任何**业务模块依赖（opreg-adm、opar 等）
- [ ] DTO/VO 类注释含 `{@link 原类FQCN}`（正确格式，非纯文本）
- [ ] DTO 平展字段标注 `// 来自 {父类名}`
- [ ] Feign 接口类注释含 `【提供给集成平台的标准接口】`
- [ ] 无重复 Feign 类型（同原始类型只留一个 Feign 副本）
- [ ] 实现 Controller 使用 `toEsbBase*()`，**无** `new EsbBaseDTO<>() + setData()` 模式
- [ ] 原 Controller 注释含 `本接口对应的 Feign 客户端为 {@link FeignClientFQCN}`
- [ ] Feign 接口注释含 `本接口为 OpenApi 接口 {@link ControllerFQCN} 对应的 Feign 客户端接口`
- [ ] 实现 Controller **不添加**交叉引用注释（已通过 `implements` 关联）
- [ ] 删除所有空目录和未使用的 Java 文件

---

## 附录：快速参考

### 命名速查

| 原始              | Feign版本                         |
| ----------------- | --------------------------------- |
| `XxxController`   | `XxxClient`                       |
| —                | `XxxClientController`（实现类）   |
| `XxxDTO`          | `FeignXxxDTO`                     |
| `XxxVO`           | `FeignXxxVO`                      |

### 路径速查

| 层级           | 位置                                                    |
| -------------- | ------------------------------------------------------- |
| Feign接口      | `{module}-api/{module}-api-{sub}/.../feign/`            |
| Feign DTO      | `{module}-api/{module}-api-{sub}/.../dto/{domain}/`     |
| Feign VO       | `{module}-api/{module}-api-{sub}/.../vo/{domain}/`      |
| 跨模块副本     | `{module}-api/{module}-api-{sub}/.../model/`            |
| 实现Controller | `{module}-{sub}/.../controller/{domain}/external/`      |
| MapStruct      | `{module}-{sub}/.../utils/`                             |

### 常用检查命令

```bash
# 扫描 @OpenApi（排除厂家、CLAUDE.md、wiki）
grep -rl "@OpenApi" {dir} --include="*.java" | grep -v "beijing\|guizhou\|hunan\|meiKang\|powersi\|iMedical\|CLAUDE\|\.costrict"

# 检查API模块是否有禁止的跨模块引用
grep -rn "com\.mediway\.his\.hiscore\|com\.mediway\.his\.opreg\.adm\|com\.mediway\.his\.opar" {api_module} --include="*.java"

# 检查是否还有"该类来自于"是纯文本（应为 {@link} 格式）
grep -rn "该类来自于 com\." {api_module} --include="*.java"

# 检查是否有错误的手动 EsbBaseDTO 构造模式
grep -rn "new EsbBaseDTO<>()" {controller_dir} --include="*.java"
```

### 代码生成常见错误（CRITICAL — 每次生成后必须校验）

#### 路径类错误

| # | 错误现象                                                                                                                    | 正确写法                                               | 说明                                     |
| - | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| 1 | `path = "{module}/{sub}/{name}"` 缺少 `api` 段                                                                              | `path = ".../{module}/api/{sub}/{name}"`               | `/api/` 是固定段，不可省略               |
| 2 | `path = "{module}/api/external/..."` 但接口在 doctor 模块                                                                   | `path = ".../api/doc/..."`                             | 子模块路径必须与实际 Maven 模块对应      |
| 3 | `path = "aggcare/api/doc/..."` 缺少 `${server.servlet.context-path}`                                                        | `path = "${server.servlet.context-path}/aggcare/api/doc/..."` | FeignClient 必须包含完整上下文路径 |
| 4 | FeignClient 使用 `${sys.restfulPath}`                                                                                       | `${server.servlet.context-path}`                       | FeignClient 只能用 `${server.servlet.context-path}` |
| 5 | Controller 使用 `${sys.restfulPath}/...`                                                                                    | `"/..."`（硬编码路径）                                 | Controller 必须用硬编码路径，以 `/` 开头 |

#### 类名错误

| # | 错误现象                                                  | 正确写法                     | 说明                                                           |
| - | --------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| 6 | className = `paCardTypeClient`（截断了前缀）              | `aggcarePaCardTypeClient`    | className 必须取**完整**类名首字母小写                         |
| 7 | className = `risEntryControllerClient`（含 Controller）   | `aggcareRisEntryClient`      | className 来自**FeignClient 接口**类名，非 Controller 名       |

#### 注解位置错误

| # | 错误现象                                                              | 正确写法                                           | 说明                               |
| - | --------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| 8 | `@FeignClient` 或 `@RequestMapping` 在 Javadoc 注释**之前**           | 注解在 Javadoc**之后**、类声明**之前**             | 正确顺序：Javadoc → 注解 → class  |

#### 注解缺失错误

| # | 错误现象                                                     | 正确写法                                                    | 说明                                       |
| - | ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------ |
| 9 | Controller 只有 `@RestController`，缺少 `@RequestMapping`    | 添加 `@RequestMapping("/{module}/api/{sub}/{className}")`    | 每个实现 Controller 必须有 @RequestMapping |

#### 校验命令

```bash
# 检查 FeignClient 是否存在缺少 api 段
grep -rn "path\s*=.*\"\${.*}/{module}/[^a]" {api_module} --include="*.java"

# 检查 FeignClient 是否误用 ${sys.restfulPath}
grep -rn 'sys\.restfulPath' {api_module}/**/feign/*.java

# 检查 Controller 是否误用 ${sys.restfulPath}
grep -rn 'sys\.restfulPath' {module}-{sub}/**/external/*ClientController.java

# 检查 className 是否截断了前缀（以 aggcare 为例）
grep -rn "path.*/doc/[a-z]" {api_module} --include="*.java" | grep -v "aggcare"

# 检查 Controller 是否缺少 @RequestMapping
for f in {module}-{sub}/**/external/*ClientController.java; do
  grep -q "@RequestMapping" "$f" || echo "MISSING: $f"
done
```

### FAQ

| 问题                           | 解决方案                                                     |
| ------------------------------ | ------------------------------------------------------------ |
| DTO 继承跨模块父类             | 平展父类所有字段到当前类，标注来源                           |
| 引用 hiscore 类型              | 创建 Feign 本地副本到 model/ 包                              |
| 同名不同包类型                 | 保留两份（与原结构一致，它们是不同类）                       |
| 多个Controller引用同一类型     | 只在主引用方保留一个Feign副本，其他方import                  |
| EsbBaseDTO/EsbBaseResponse     | 工具模块可直接引用，无需创建副本                             |
| 实现Controller丢失client元数据 | 用 `toEsbBase*()` 替代手动 `new EsbBaseDTO() + setData()`    |

### 文档常见错误速查

| 错误现象                                                  | 根因                                         | 修复                                                |
| --------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `` ```-- `` 代码块闭合损坏                                | sed替换时反引号与 `---` 合并                 | `sed -i 's/^\`\`\`--$/\`\`\`\n\n---/' output.md`  |
| 出参显示 `resultCode`/`resultContent`                     | Agent生成时用了错误的字段名                  | 全局sed替换为 `code`/`msg`                          |
| JSON入参只有 `data` 无外层包装                            | Agent未包含 `current`/`size`/`client`        | 需Agent补充完整 EsbBaseDTO 结构                     |
| 字段表含 `data.` 前缀                                     | Agent复制了嵌套字段的完整路径                | `sed -i 's/\| data\./\| /g' output.md`              |
| 标题出现 `#### #### 4.1.1` 双前缀                         | awk替换时保留了原标题的 `#### `              | `sed -i 's/^#### #### /#### /g' output.md`          |
| 标题层级跳级/混乱                                         | 不同Agent生成的临时文件格式不一致            | 统一用awk脚本重新编号+统一H层级                     |
| 出参records数组为 `[{}]`                                  | Agent未从VO字段表填充具体字段                | 需Agent读取VO字段后补充到records元素                |
| 子节点使用 `records.xxx` 内联                             | Agent未展开子节点为独立表格                  | 需Agent提取子节点字段到独立表格                     |
| 深层嵌套VO未展开（如 `patient(FeignPatientVO)` 无子字段） | Agent只引用了VO类名                          | 需Agent从源码读取VO完整字段并展开                   |
| 出参表字段内联在父表                                      | Agent偷懒未建子表                            | 必须改为独立子表，与全文档格式统一                  |

### 批量执行策略（Agent 并行方案）

| 批次  | 任务                                                        |        并行度        |
| ----- | ----------------------------------------------------------- | :------------------: |
| 第1批 | 数据抽取：调研扫描 + 分类统计                               |       1个Agent       |
| 第2批 | 对照文档：字段映射 + 生成对照文档                           |   2-3个Agent(按章节) |
| 第3批 | [可选] Feign接口生成：按模块并行生成全套代码                 |  N个Agent（N=模块数） |
| 第4批 | [可选] API文档：按模块分段并行生成（写temp文件）            |      3-6个Agent      |
| 第5批 | [可选] 质量检查 + 依赖清理 + 注释修正                       |       1个Agent       |
| 第6批 | [可选] 全局sed修复 + 格式修正Agent                          |      3-5个Agent      |
| 第7批 | [可选] 组装最终文档 + 文档质量自检                          |       1个Agent       |

### Agent 提示词模板

**数据抽取 + 对照文档 Agent**：

```
对 {module} 模块执行数据抽取：扫描所有 @OpenApi Controller（排除厂家专属接口），
与第三方 PDF 文档进行字段级对照。

Controller目录：{controller_dir}
Feign接口目录：{feign_directory}
DTO/VO目录：{dto_vo_directory}
第三方文档：{pdf_path}

任务清单：
1. 扫描所有 @OpenApi Controller，输出接口清单
2. 读取 Feign VO 源码获取实际字段列表
3. 解析第三方 PDF 的入参/出参字段
4. 建立字段级映射（每个 VO 字段必须 grep 验证真实存在）
5. 按 aggcare 优先原则选择核心/补充/备用接口
6. 生成对照文档（字段映射表 + 调用流程 + 无可映射字段汇总）
7. 执行质量自检（字段顺序一致、无虚构字段、接口数≤3）

严格遵循规范文档中的所有规则。
```

**生成 Feign 代码的 Agent**：

```
为 {module} 模块下所有 @OpenApi Controller（排除厂家专属接口）生成 Feign 接口代码。

Controller目录：{controller_dir}
API模块位置：{api_dir}

任务清单：
1. 创建/更新 API 子模块（pom.xml + 目录结构）
2. 读取所有原 Controller 源码获取方法签名
3. 读取所有原 DTO/VO 源文件获取字段列表
4. 生成 Feign DTO/VO（平展跨模块父类，类注释用 {@link} 引用原类）
5. 生成 Feign 接口（@FeignClient，类注释含【提供给集成平台的标准接口】和双向 {@link}）
6. 生成 MapStruct（DTO映射 + VO映射 + EsbBaseDTO包装映射）
7. 生成实现Controller（implements Feign接口，使用 toEsbBase* 完整转换）
8. 确保 API模块 pom.xml 无 hiscore 等业务模块依赖

严格遵循规范文档中的所有规则。
```

**生成 API 文档的 Agent**：

```
为 {module} 的 Feign 接口生成 API 文档段落，写入临时文件 temp/{module}_{group}.md。

Feign接口目录：{feign_directory}
DTO/VO目录：{dto_vo_directory}

## 标题层级（严格遵守）
- H3: ### 4.X 模块名 — 服务名
- H4: #### 4.X.Y 功能描述 — ClientName  （描述在前！）
- H5: ##### 4.X.Y.Z 功能描述 — methodName  （含完整序号！）
- 禁止使用 H6、禁止文字型章节标题（"第三章"等）

## JSON示例（严格遵守）
入参：必须含 current/size/client 包装
出参：{"code": "200", "msg": "成功", "version": "v1.0", "data": {...}}
严禁用 resultCode/resultContent！

## 字段表格式
- 列：| 节点 | 名称 | 数据类型 | 长度 | 备注 |
- List子节点用独立表格，严禁 data. 前缀和内联 records.xxx
- 公共VO每处引用独立展开，嵌套至少3级
- 每个方法都要有入参JSON和出参JSON
- JSON值=字段中文描述，非示例数据
```
