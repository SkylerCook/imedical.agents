---
name: imedicalxc-doctor-elechealthcard-vendor
description: |
  HIS「电子健康卡」接入新第三方厂家（新省份/新平台/新服务商）的全流程操作手册。
  输入新厂家对接文档（.doc/.docx/.pdf/md），自动在本仓库找到结构最完整、最近修订的既有厂家实现作为模板
  （当前模板 = GuanXinKeJi/冠新科技），生成前后端代码 + 厂家/扩展设定 SQL + 基础数据统一对照 SQL + 操作维护文档。
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

> 参照约定：**结构模板默认取仓库中结构最完整、最近修订的厂家——目前是 `GuanXinKeJi`（冠新科技）**；
> 只“抄”它的类结构/分层/路由写法，方法、字段、报文、成功码、字典全部按新文档实现，不得沿用模板厂家的报文。
> 湖南省/上海等旧厂家仅作历史参考，不作为模板。

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

## 1. 结构模板（默认 = 冠新科技 GuanXinKeJi）

1. 找本模块（如 `ElecHealthCard`）下各厂家包，**选最近修订且结构最完整的厂家作模板**（当前推荐 GuanXinKeJi）；
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
   覆盖与对照方式按**规约 N**：有 `his_table_name` 的字典双向“至少一个”覆盖、允许重复、取第一条；`medStepCode` 仅需单向。
**SQL 验证纪律**：给只读 DB 仅用事务内执行+ROLLBACK 校验语法与行数，绝不 commit；无 DB 则注明未验证。

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
- **J. 转换器无默认回退**：`ElecHealthCardConvertAbstract` 找不到映射仅 ① extname 含“其他”行兜底；
  其余 → null + log.error。**不为民族增加“汉族”默认**，也不为其它维度加默认回退码。
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
- **N. 对照方式(his_flag)与覆盖规则**：默认 `H`(His→外部)。
  · **有 `his_table_name` 的字典**（credType/sex/nation/marital/occuCategory）：要求**双向覆盖**——
    每个 hiscode **至少**对照一个 extcode，每个 extcode **至少**对照一个 hiscode；**允许重复**
    （同一 hiscode 或同一 extcode 可出现在多行）；取值时**默认取第一条**匹配数据。
    覆盖基准：hiscode 覆盖连接库对应字典表的**全部有效 code**（`coalesce(is_deleted,0)=0`）。
  · **`medStepCode`（诊疗环节）**：只需 `hiscode→extcode` 单向可对照，不要求反向（extcode 可重复）。
  · **同一 hiscode 出现多行时**（如 一个 HIS 码对应多个平台码 / 收口导致的重复）：**首行保留 `H`，其余行改为 `E`**
    （`E` 要求 extcode 唯一，这些补充行的 extcode 恰好各不相同，故 E 合法）；这样 H 行 hiscode 唯一、E 行 extcode 唯一，
    两类校验都不报重复。
  · **不得产生冗余补行**：补“其他”落点前先确认该侧码**确实没有对照**；若该码已有主对照行（如 occuCategory `8→8` 已覆盖 ext 8），
    就不要再补 `9→8` 之类的重复行——(hiscode,extcode) 组合必须唯一。
  · **生成后自检**：`(hiscode,extcode)` 组合唯一、H 行 hiscode 唯一、E 行 extcode 唯一；任一项有重复即为错误，需先消除冗余再交付。
- **P. 运行时取值策略（多行命中不取第一条）**：框架 `convertData` / `getAllCodeMapData` **都不按 his_flag 过滤**、
  返回 VO 亦**不含 his_flag**，所以方向/主次只能由代码判定。约定：
  · 命中多行时**优先“对等码”行**（`hiscode == extcode`，如 `99↔99`、`8↔8`），其次才取第一条，并 `log.warn` 打出候选；
  · 因此生成对照时应让**主对照尽量为对等码**，把“落到其他”的补充行做成非对等码；
  · 业务上若只用到固定码（如电子健康卡建卡只走 `credType=01 居民身份证`）可不受影响，但**回向**（平台返回码→HIS）
    仍会命中多行（例：ext `99` 同时被 `08/09/99` 指向）→ 必须靠上述策略保证取到 `99`。
  · 若需要更强约束，可改调 `CtDicBasedatamapdetailService.convertData(systemCode,dictCode,code,type)`（按方向取值），
    或在 VO 上补 `his_flag` 后按 H/E 过滤——三选一，需在设计中明确。
  · **该策略要应用到所有既有厂家的转换器**（防止后续加码/改对照时冲突）；发现老厂家未做，应一并回补并说明。
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
- **O. 对不上的落到“其他”**：双方任意一侧无对应关系的码，一律对照到该字典中**语义为“其他”的那一行**
  （如 其他法定有效证件 / 其他 / 其他的 / 不便分类的其他从业人员 / 其他未识别民族 等）——
  即 HIS 侧多出的码 → 落到 ext 的“其他”码；ext 侧多出的码 → 落到 HIS 的“其他”码（允许重复，取第一条）。
  **若某字典没有“其他”行**：不要臆造，使用**语义最接近的等价码**收口，并在代码注释与交付文档中**明确指出收口码**。
  （已确认口径：**性别 sex** 无“其他”→ 用 **`9 未说明的性别`** 收口，广东 `5 女性改为男性`/`6 男性改为女性` 落 HIS 9；
  **婚姻 marital** 无“其他”→ 用 **`90 未说明`** 收口。）

## 相关技能
- `imedicalxc-doctor-extend-engineer` — 主编排器（架构/领域门禁）
- `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md`
- `imedicalxc-doctor-blh`、`imedicalxc-doctor-invoke`、`imedicalxc-doctor-dbdata`、`imedicalxc-doctor-extend-dataformat`
- `word-reader` — .doc/.docx 读取
