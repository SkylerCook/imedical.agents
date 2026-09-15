---
name: imedicalxc-doctor-elechealthcard-vendor
description: |
  HIS「电子健康卡」接入新第三方厂家（新省份/新平台/新服务商）的全流程操作手册。
  由主编排器按需加载。输入新厂家对接文档（.doc/.docx/.pdf/md），在目标工程核实既有厂家实现后选择结构参照，
  生成本次范围内的前后端代码、厂家/扩展设定 SQL、基础数据统一对照 SQL 和操作维护文档。
  无对接文档、无服务总线 esb 接口码时先索取，禁止臆造报文/接口码。
triggers:
  - 电子健康卡
  - 电子健康码
  - 健康卡新厂家
  - 新平台电子健康卡
  - 增加厂家
  - 对接省份平台
role: implementer
scope: end-to-end
output-format: delivery
---

# iMedicalXC 电子健康卡 · 新厂家接入工作流

把「在 HIS 增加一家电子健康卡第三方厂家」做成可重复流水线。核心：
**结构镜像既有厂家；协议差异收敛在厂家私有包内；一切方法/DTO/VO/报文以新厂家对接文档为准。**

> 参照约定：**结构模板从目标工程当前源码选择，并记录参照路径与适用差异，不固定某个厂家为默认模板**；
> 只“抄”它的类结构/分层/路由写法，方法、字段、报文、成功码、字典全部按新文档实现，不得沿用模板厂家的报文。
> 历史厂家经验仅作为查找线索；是否可作结构参照须在目标工程核实。

本子 skill 由 `imedicalxc-doctor-extend-engineer` 在架构前置条件通过后加载。用户直接指定本子 skill 时，先读取主编排器并按其流程执行。

修改范围只包含本次新厂家及已确认的必要调用链。既有厂家或共享转换器的问题记录为独立影响项，只有明确纳入本次授权范围后才修改，不自动批量回补。

## 0. 输入与硬门禁（不满足就停下索取）

1. **对接文档必须提供**（.doc/.docx/.pdf/md/网页/粘贴文本）。未提供 → 停下索取，说明需要：接口地址/协议、
   各方法请求响应字段、加解密签名方式及“由谁做”、字典码表、医院备案参数。禁止凭记忆/猜测生成报文。
   `.doc/.docx` 读取失败 → 报告失败，不得跳过。
2. **服务总线 esb 接口码必须拿到**（用户提供或总线登记表）。未提供 → 在交付文档“待确认项”醒目提示
   “需在总线登记/提供 esb 接口码”，不得自行编造与总线不一致的 code。
3. **加密问题必须显式决策**：每次新生成都要考虑“加解密/签名由谁做”。默认 HIS 走服务总线前置“加密模式”
   （信封 signMode/encryptMode/headSign/bodySign=none，body 明文由总线代加解密签名）；若直连则我方实现
   SM3/SM4。把结论写进类注释与配置说明，不得照抄别的厂家被注释掉的加解密开关。
4. 产出《资料摘要》：厂家 code+名称、模块、**文档正文接口清单**、esb 接口码、请求/响应结构、
   加解密归属、字典、备案参数、待确认项。

## 1. 结构模板（从目标工程核实）

1. 找目标工程本模块（如 `ElecHealthCard`）下各厂家包，核实分层、调用链和近期变更后选择适用结构参照；
   若用户指定其它参照厂家则按用户指定，但仅作结构参照。
2. 模板包结构（照抄）：
   `{Company}Abstract`/`ext/{Company}BLH`、`controller/.../{Module}Controller`、
   `blh/.../{module}/behave/*`、`{module}/ElecHealthCardInvokeAbstract`、`{module}/ElecHealthCardConvertAbstract`、
   `constant/.../ElecHealthCardConstants`、`enums/.../MethodEnum`、`model/dto|vo/.../{module}`。
3. 复制模板 → token 改名：包/类/`@BLH`/`@RestController`/`@Resource` bean、Controller 路径、前端 url、注释。
4. 平台差异层全部重写（勿残留模板厂家的报文/方法/DTO/VO）。

## 2. 决策点（与用户对齐后动手）
- 通道：服务总线(esb)还是直连；加解密归属（见 §0.3）；
- 范围：仅实现**对接文档正文列出的接口**。esb 清单里正文未给报文的接口（如曾见 exchangeChild/
  batchUploadPayInfo 只在 esb 清单出现）→ **不建方法/DTO/VO**，如需再按对应文档补；
- 医院备案值：占位符（用户后填）还是用户给真值；
- 患者“修改电子健康卡信息”取卡号：默认在建卡/查询链路里取；取不到时与用户确认方案（见规约 G）。

## 3. 生成后端代码（镜像结构 + 重写协议）
沿用 §1 结构，落地时遵守“既定编码规约”（见文末，必读）。要点：
- MethodEnum.code=文档 method、interfaceCode=已确认 esb code；类头 `@description` 附**文档全名+版本**
  （如《附件4：广东省电子健康码管理平台医疗机构受理环境改造指引（试行）V1.1.docx》）；
- InvokeAbstract 覆盖文档正文全部接口，方法名 = 文档 method；
- Request DTO / Return VO 类名 = 文档接口名；参数按文档顺序定义，赋不上的给 null；
- ConvertAbstract `SYSTEM` = `{NewCompany}.{ModuleCode}`，维度随文档增删；
- 配置键按新文档报文需要，备案值 `REPLACE_` 占位。

### 3.1 registerElecHealthCard 策略实现（必须）

新厂家 **必须** 在 `ElecHealthCardStrategyAbstract` 中覆写 `registerElecHealthCard(FeignPCAInfoDTO dto)` 方法。
接口默认实现为 no-op（返回 success=true 但无数据），不覆写则建卡时 `pa_card_ref.elec_pid` 不会存储。

**实现要点：**
- 若厂家的注册 API 与 `getElecHealthCardNoByPat` 相同（常见情况），可直接委托：
  ```java
  @Override
  public BaseVO<CardRegisterResponseVO> registerElecHealthCard(FeignPCAInfoDTO dto) {
      return getElecHealthCardNoByPat(dto);
  }
  ```
- 若注册 API 独立于取号 API，需单独实现，但返回值结构一致。
- **返回值契约**：`BaseVO<CardRegisterResponseVO>` 的 `data.elecCardNo` 必须包含电子健康卡 ID（即 elec_pid）；
  `data.qrCode` 可选，包含二维码图片 base64 数据。
- 若厂家 API 返回的字段名不同（如 `erhcCardNo`、`ehealthCardId`），必须映射到 `CardRegisterResponseVO.elecCardNo`。

**后端短路逻辑**：`SaveCardInfoAbstract.registerElecHealthCardIfIdCard` 在调用策略前检查
`paCardRefDto.getElecPid()` 是否已有值（由前端读卡传入）。若已有值则跳过注册，直接使用前端传入的 elecPid。
这避免了重复调用厂家注册接口。

**数据流（建卡时 elec_pid 写入路径，两条来源）：**

来源一：前端读卡（读卡号 / 读取信息）
```
ElecHealthCard.js ReadMagCard / ReadPersonInfo
  → 后端 GetElecHealthCardInfoAbstract.getElecHealthCardNo / getElecHealthCardInfo
    → 返回 ElecHealthCardNoVO / ElecHealthCardInfoVO（含 elecPid）
      → 前端 SetPatInfoByXML 映射到 hidden field（#elecPid）
        → GetCardRefInfo() 读取 hidden field → paCardRefDto.elecPid
          → 建卡请求传入后端
```

来源二：后端注册（当前端未传入 elecPid 时）
```
SaveCardInfoAbstract.registerElecHealthCardIfIdCard
  ├─ 若 paCardRefDto.elecPid 已有值 → 跳过注册，直接使用
  └─ 若为空 → cardInvoke(REGISTER_ELEC_HEALTH_CARD) → 厂家策略 registerElecHealthCard
      → 返回 CardRegisterResponseVO
        → paCardRefDto.setElecPid(responseVO.getElecCardNo())
```

最终持久化：
```
paCardDefBLH.saveCardInfo (BeanUtil.copyProperties → saveOrUpdate)
  → pa_card_ref.elec_pid 持久化
```

**触发条件**：`registerElecHealthCardIfIdCard` 仅在卡类型为"卡号等效证件类型"（如身份证等效卡）时执行，
普通实体卡建卡不触发。注册失败不阻断建卡流程（try-catch 保护）。

**前端读卡返回 VO 必备字段**：`ElecHealthCardNoVO` 和 `ElecHealthCardInfoVO` 必须包含：
- `elecPid`（电子健康卡 ID）— 必须

**前端建卡页面布线清单**（新厂家接入时同步检查）：
- HTML hidden field：`#elecPid`
- `commonJson`（`doc.cardregconfig.json.js`）：`elecPid: 'elecPid'`
- `CardRefInfo`（`doc.cardref.entity.json.js`）：`"elecPid":"elecPid"`

### 3.2 接口启用配置（模块级）

三个电子健康卡接口通过 `cf_doc_interface_modulelinksub` 扩展设定控制启用/禁用，
**所有厂家均需配置**，配置值为 `Y`（启用）/ `N`（禁用）。

| configKey | 描述 | 对应枚举 |
|-----------|------|----------|
| `enableGetElecHealthCardNoByPat` | 启用通过患者信息获取电子健康卡卡号 | `GET_ELEC_HEALTH_CARD_NO_BY_PAT` |
| `enableAfterPatUpdate` | 启用修改患者信息后的操作 | `AFTER_PAT_UPDATE` |
| `enableRegisterElecHealthCard` | 启用通过患者信息注册电子健康卡 | `REGISTER_ELEC_HEALTH_CARD` |

**调度逻辑**：`ElecHealthCardAbstract.cardInvoke()` 在调用厂家策略前，
通过 `BusInterfaceConfigBLH.findAllLinkSubByCode()` 读取当前厂家的扩展设定，
检查对应 `configKey` 的值。值为 `N` 时跳过该厂家；配置不存在时默认启用（向后兼容）。

**新厂家接入 SQL 模板**（置于 `02-扩展设定.sql` 最前）：
```sql
INSERT INTO cf_doc_interface_modulelinksub (manage_parref, code, description, value, create_datetime, update_datetime)
SELECT v.manage_parref, cfg.code, cfg.description, cfg.value, now(), now()
FROM (
    SELECT link.id AS manage_parref
    FROM cf_doc_interface_modulelink link
    JOIN cf_doc_interface_company comp ON link.company_parref = comp.id
    JOIN cf_doc_interface_module   mod  ON link.module_parref  = mod.id
    WHERE comp.code = '{CompanyCode}'
      AND mod.code  = 'ElecHealthCard'
) v
CROSS JOIN (VALUES
    ('enableGetElecHealthCardNoByPat', '启用通过患者信息获取电子健康卡卡号(Y/N)', 'Y'),
    ('enableAfterPatUpdate',         '启用修改患者信息后的操作(Y/N)',         'Y'),
    ('enableRegisterElecHealthCard', '启用通过患者信息注册电子健康卡(Y/N)',   'Y')
) AS cfg(code, description, value)
WHERE NOT EXISTS (
    SELECT 1 FROM cf_doc_interface_modulelinksub sub
    WHERE sub.manage_parref = v.manage_parref AND sub.code = cfg.code
);
```

## 4. 生成前端代码
镜像模板前端接口层 JS → `hisfront/static/comoe/interface/{Company}/{Module}.js`：
`Name` = `{CompanyCode}_{ModuleCode}`；`urlObj` 路径 `hispa/external/{companyPath}/{module}/…`；
`GetQRCardFlag/ReadMagCard/ReadPersonInfo/PrintCardInfo` 契约保持不变（对业务层语义一致）。

## 5. 生成 SQL（供用户手动执行，勿擅自落库）
1. `01-厂家与模块链接.sql`：厂家(code=描述拼音)缺则插；company×module 链接缺则插并 activeflag='Y'，
   已存在 inactive 则激活；`hosp_dr` 按院区；**modulelink.product 指向 cf_doc_interface_product 中
   code='Card' 的 id，并按既有数据格式存 `',' || id`（如 ',4'，勿硬编码 id，用子查询
   `SELECT ',' || id FROM cf_doc_interface_product WHERE code='Card'`）**；UPDATE 分支同样补齐/修正 product。
2. `02-扩展设定.sql`：`cf_doc_interface_modulelinksub` 键值=代码常量，备案值 `REPLACE_*` 注释标清。
   **接口启用配置（`enableGetElecHealthCardNoByPat`/`enableAfterPatUpdate`/`enableRegisterElecHealthCard`）置于最前**，详见 §3.2。
3. `03-数据对照-建目录.sql`：`ct_dic_basedatamap` 建 `doctor→{Company}→{Company}.{Module}` + 各维度类别；
   - **code 命名（三级及以上加前级首拼）**：模块目录 code = `{厂家缩写}.{ModuleCode}`（如 `GXKJ.ElecHealthCard`，
     厂家缩写=拼音首字母大写，如 冠新科技→GXKJ、湖南省平台→HNSPT）；维度类别 code = `{厂家缩写}.{模块缩写}.{dict}`
     （模块缩写=模块英文首字母，如 ElecHealthCard→EHC，故 `GXKJ.EHC.credType`）。二级厂家目录 code 保持全拼。
   - **必备字段**：`system_code` 默认 `'HIS'`；`py_code`=名称拼音首字母大写（电子健康卡→DZJKK、证件类型→ZJLX）；
     `wb_code`=名称逐字五笔首码大写（电子健康卡→JBWYH）；`his_table_name`=该维度 HIS 源字典表
     （credType=hos_ct_identity_type_dict、sex=hos_ct_gender、nation=hos_ct_nationality、
     marital=hos_ct_marriage_status、occuCategory=hos_ct_occu_category）；
     **该维度 HIS 侧无字典表（如诊疗环节，HIS 侧为电子凭证业务码）→ 置空(NULL)**。
   - **必须同步后台取值常量**：查找条件是 `con.code=dictCode AND parent.code=systemCode`，
     故 Java `ElecHealthCardConvertAbstract.SYSTEM` 须等于模块目录 code、`DICT_*` 须等于类别 code
     （如 SYSTEM="GXKJ.ElecHealthCard"、DICT_CRED_TYPE="GXKJ.EHC.credType"）；跨模块引用（如 opcare 支付处
     `convertData(...)`）同改。**DB 改名与代码常量必须同批上线**，否则对照失效。
   - **若目录已建过需重建**：先给出删除脚本（顺序：明细→类别→模块目录→厂家目录），再跑新 03。
4. `04-数据对照-明细.sql`：`ct_dic_basedatamapdetail` 铺底，**自包含 VALUES**（避免同表 INSERT…SELECT
   自拷贝被部分库优化成 0 行）；**hiscode 取连接库对应 HIS 字典表的 code**（`hos_ct_identity_type_dict`/
   `hos_ct_gender`/`hos_ct_nationality`/`hos_ct_marriage_status`/`hos_ct_occu_category`，含 name），
   **extcode 取对接文档附录码表**，按语义映射并逐行核对描述，勿凭旧厂家数据照抄。
   覆盖与对照方式按**规约 N/P/O**：覆盖方向由协议和调用链确定，多行命中须有明确主映射或判为歧义；`medStepCode` 按实际单向调用核实。
**SQL 验证纪律**：只读连接仅执行 SELECT 等只读校验，不以 ROLLBACK 授权 DML；事务内执行写 SQL 的验证仍需明确授权。无 DB 则注明未验证。

## 6. 生成文档
1. `{厂家}{模块}-改造说明.md`：目标、esb 映射表、报文差异、文件清单、优化总结、**待办（含 esb code 登记提醒、
   `REPLACE_*` 替换、加密/透传结论）**。
2. `{厂家}{模块}-操作维护说明.md`：【对外接口管理】加厂家/启用【电子健康卡】/维护扩展设定；【卡类型配置】
   身份证等卡类型 → 关联读卡按钮 + 关联读取信息选该厂家外部接口；常见问题表。
3. canonical 配置说明：`comoe-doc/src/main/resources/接口/{厂家名称}/{功能}-配置说明.md`
   （接口注册、扩展设定参数表、前端部署、数据对照、验证方法）。

## 7. 收尾校验
- Grep 厂家包无残留模板厂家 token/类名/报文/方法名；无对已删类引用；
- Invoke 公开方法 与 行为层调用 一一对应；反射 bean 名/路径/前端 url 一致；
- `registerElecHealthCard` 已覆写且成功时返回非空 `elecCardNo`（见 §3.1）；
- 无 Maven/编译环境时明示”待内网编译验证”；提示缓存前缀。

## 附录：既定编码规约（每次生成必读）

- **A. 异常统一**：入参/校验/协议异常一律
  `HisBusinessException.rpcException(HispaInvokeCardConstants.BUSINESS_CODE + "2000", msg)`
  （同类失败用同域码；勿散落裸数字 500/2000 与其它域码）。
- **B. 提示语统一“电子健康卡”**：异常/日志对用户提示一律写“电子健康卡”，**不出现具体厂家名**
  （如 不写“冠新科技……”）。日志可用厂家名，用户提示不用。
- **C. 只实现文档正文接口**：esb 清单多出而无正文的接口不建代码（占位也不要）；确需再按文档补。
- **D. 类头注明文档全名**：`ElecHealthCardInvokeAbstract` 等类头 `@description` 附文档全名与版本号。
- **E. 加密必考量**：每次生成显式写“加解密/签名由谁做、总线还是直连、是否 none+明文”，类注释与配置说明同步。
- **F. esb code 必索取**：未提供 → 总结文档“待确认项”高亮提醒，禁止编造。
- **G. 修改接口取卡号**：modifyVmcardInfo/afterPatUpdate 找不到 erhcCardNo 时，可从建卡/查询链路
  （按文档，如 createVmcardQRcode 返回或 getPersonInfo 按证件反查）获取；仍不可得 → 与用户确认方案后定。
- **H. 入参齐全/顺序/枚举**：每接口参数尽量都组织，拿不到就 null；**按文档字段顺序赋值，不调整顺序**；
  重要枚举在 DTO 字段注释里列出取值（或加字段/常量体现）。
- **I. @ApiModelProperty**：必填 → `required = true`；“某条件才必填” → 在 `notes` 说明。
- **J. 转换器无隐式回退**：找不到映射时记录错误并遵循接口错误处理契约；只有按规约 O 明确确认的语义映射才可作为回退。
  **不为民族增加“汉族”默认**，不凭描述子串或历史厂家经验补其它维度默认码。
- **K. 成功判定按本文档**：服务总线返回是否成功以**本厂家对接文档**的成功码为准（如广东 `returnCode=0`），
  不要被其它电子健康卡厂家（如湖南 `code=000`）影响；返回信封 VO 含 `returnCode/returnDesc/signString/
  timestamp/msg/datas`，其中 `msg` 为总线返回的报错，接口自身报错描述为空时用它拼接提示。
- **L. 文档/接口命名**：方法、DTO、VO 一律按文档接口名，模板厂家名只用于包结构。
- **M. 对照目录命名与后台常量同步**：`ct_dic_basedatamap` 三级及以上 code 加前级首拼
  （模块=`{厂家缩写}.{ModuleCode}`、类别=`{厂家缩写}.{模块缩写}.{dict}`），并填 `system_code='HIS'`、
  `py_code`（拼音首字母大写）、`wb_code`（逐字五笔首码大写）、`his_table_name`；后台 `SYSTEM`/`DICT_*`
  及跨模块 `convertData(...)` 引用必须与节点 code **完全一致**，DB 与代码同批上线。改造既有厂家同理，
  并提供改名/回滚（或删除重建）脚本。
  **py/wb 补码**：任何建目录/改名/重建脚本都要同时维护 `py_code`、`wb_code`（不要留下空值）；
  为既有节点补码用幂等的 `UPDATE … SET py_code=v.py,wb_code=v.wb FROM (VALUES('名称','拼音首字母','五笔首码'),…) v
  WHERE displayname=v.displayname AND <限定该厂家子树>`；规则 py=名称拼音首字母(大写)、wb=逐字五笔首码(大写)，
  如 湖南省平台→HNSPT/IFIGC、电子健康卡→DZJKK/JBWYH、证件类型→ZJLX/YWOG。
- **N. 对照方式(his_flag)与覆盖规则**：先核实目标工程当前 schema、有效码过滤条件和转换 API 的方向语义。
  · 对接文档和实际调用链需要的方向必须覆盖；双向调用分别检查 HIS→外部与外部→HIS，不因字典存在就臆定双向需求。
  · 每行记录两侧 code、描述、来源与方向；相同数字或字符串不证明语义相同，映射必须按文档含义核对。
  · `(hiscode,extcode)` 组合不得冗余重复；H/E 标记依目标工程契约填写，不为绕过唯一性校验把补行任意改成 E。
  · 一对多或多对一可以表达已确认的协议关系，但每个实际查询方向都须按规约 P 确定唯一结果或报告歧义。
- **P. 运行时取值策略（方向明确、结果确定）**：在目标工程核实 `convertData` / `getAllCodeMapData` 的过滤、排序和 VO 字段，不将历史行为当成通用事实。
  · 按实际方向和已确认的主映射取值；多行无法确定唯一结果时报告歧义并停止该转换，不按首行或 `hiscode == extcode` 猜测。
  · 优先复用已验证的方向接口；接口无法表达方向/主次时，在设计中明确本次必要适配和影响范围，并验证正反向歧义、缺失映射及错误处理。
  · 既有厂家或共享转换器的缺口单独报告，遵循本 skill 的修改范围约束。
- **Q. 禁止“项目/医院相关参数”的代码默认值**：`orgCode/appId/appSecret/appRecordNo/terminalCode/url` 等因医院/项目而异，
  **一律不在常量类里给 DEFAULT_\* 兜底**（否则其它项目会静默用错数据）。做法：
  · 常量类只保留 **key**；取值只读扩展设定；
  · 缺失时**fail-fast**：抛 `HisBusinessException.rpcException(BUSINESS_CODE + "2000", "电子健康卡扩展设定未配置: <desc>")`；
  · 只有**平台枚举类**值可留默认（如 刷卡终端类型 01/人工窗口、appMode=窗口3），并在注释中标明“非项目数据”。
- **R. 多值参数（如 terminalCode 识读终端编码）**：**单键逗号列表**存于扩展设定，不建多行；
  · 每个值只维护一遍（解析时去掉空值并**去重**）；
  · 取值：单值即用该值；多值**随机取一个**（记录所选日志）；如条件允许，优先按**当前客户端(IP/主机名)绑定**到具体终端；
  · 兼容“只有一台终端”的项目（填一个值即走同一逻辑）。
  · hiscode 一律取**连接库对应字典表 code**；extcode 取**对接文档附录**码表。
- **O. 无对应语义的码**：只有对接文档与目标字典明确支持且本次设计已确认时，才映射到“其他”或“未说明”，记录适用方向与依据。
  不存在明确落点时列为待确认或缺失映射，不自动选择“最接近”码；历史省份的性别、婚姻等收口不能作为其它工程默认值。多行结果仍按规约 P 处理。

## 相关技能
- `imedicalxc-doctor-extend-engineer` — 主编排器（架构/领域门禁）
- `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md`
- `imedicalxc-doctor-blh`、`imedicalxc-doctor-invoke`、`imedicalxc-doctor-dbdata`、`imedicalxc-doctor-extend-dataformat`
- `word-reader` — .doc/.docx 读取
