---
name: imedicalxc-doctor-elechealthcard-vendor
description: |
  HIS「电子健康卡」接入新第三方厂家（新省份/新平台/新服务商）的全流程操作手册。
  输入新厂家对接文档（.doc/.docx/.pdf/md），自动在本仓库找到结构最完整、最近修订的既有厂家实现作为模板，
  生成前后端代码 + 厂家/扩展设定 SQL + 基础数据统一对照 SQL + 操作维护文档。
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

> 参照约定：**结构模板默认取仓库中结构最完整、最近修订的厂家**；
> 只"抄"它的类结构/分层/路由写法，方法、字段、报文、成功码、字典全部按新文档实现，不得沿用模板厂家的报文。
> 旧厂家仅作历史参考，不作为模板。

## 0. 输入与硬门禁（不满足就停下索取）

1. **对接文档必须提供**（.doc/.docx/.pdf/md/网页/粘贴文本）。未提供 → 停下索取，说明需要：接口地址/协议、
   各方法请求响应字段、加解密签名方式及"由谁做"、字典码表、医院备案参数。禁止凭记忆/猜测生成报文。
   `.doc/.docx` 读取失败 → 报告失败，不得跳过。
2. **服务总线 esb 接口码必须拿到**（用户提供或总线登记表）。未提供 → 在交付文档"待确认项"醒目提示
   "需在总线登记/提供 esb 接口码"，不得自行编造与总线不一致的 code。
3. **加密问题必须显式决策**：每次新生成都要考虑"加解密/签名由谁做"。默认 HIS 走服务总线前置"加密模式"
   （信封 signMode/encryptMode/headSign/bodySign=none，body 明文由总线代加解密签名）；若直连则我方实现
   SM3/SM4。把结论写进类注释与配置说明，不得照抄别的厂家被注释掉的加解密开关。
4. 产出《资料摘要》：厂家 code+名称、模块、**文档正文接口清单**、esb 接口码、请求/响应结构、
   加解密归属、字典、备案参数、待确认项。

## 1. 结构模板

1. 找本模块（如 `ElecHealthCard`）下各厂家包，**选最近修订且结构最完整的厂家作模板**；
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
- 患者"修改电子健康卡信息"取卡号：默认在建卡/查询链路里取；取不到时与用户确认方案（见规约 G）。

## 3. 生成后端代码（镜像结构 + 重写协议）

沿用 §1 结构，落地时遵守编码规约（见文末"相关规则与参考"，必读）。要点：
- MethodEnum.code=文档 method、interfaceCode=已确认 esb code；类头 `@description` 附**文档全名+版本**
  （如《XX省电子健康码管理平台医疗机构受理环境改造指引 V1.x》）；
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

> 完整数据流（前端读卡 → 后端注册 → 持久化）和前端布线清单见
> `references/register-elechealthcard-dataflow.md`。

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

**输出目录**：SQL 和文档统一放在非代码目录 `电子健康卡/{厂家名称}/`，
**不放 `src/main/resources/sql/`**（避免 Maven 打包进 JAR、避免随代码误提交）。
1. `01-厂家与模块链接.sql`：厂家(code=描述拼音)缺则插；company×module 链接缺则插并 activeflag='Y'，
   已存在 inactive 则激活；`hosp_dr` 按院区；**modulelink.product 指向 cf_doc_interface_product 中
   code='Card' 的 id，并按既有数据格式存 `',' || id`（如 ',4'，勿硬编码 id，用子查询
   `SELECT ',' || id FROM cf_doc_interface_product WHERE code='Card'`）**；UPDATE 分支同样补齐/修正 product。
2. `02-扩展设定.sql`：`cf_doc_interface_modulelinksub` 键值=代码常量，备案值 `REPLACE_*` 注释标清。
   **接口启用配置（`enableGetElecHealthCardNoByPat`/`enableAfterPatUpdate`/`enableRegisterElecHealthCard`）置于最前**，详见 §3.2。
3. `03-数据对照-建目录.sql`：`ct_dic_basedatamap` 建 `doctor→{Company}→{Company}.{Module}` + 各维度类别；
   - **code 命名（三级及以上加前级首拼）**：模块目录 code = `{厂家缩写}.{ModuleCode}`（如 `GXKJ.ElecHealthCard`，
     厂家缩写=拼音首字母大写）；维度类别 code = `{厂家缩写}.{模块缩写}.{dict}`
     （模块缩写=模块英文首字母，如 ElecHealthCard→EHC）。二级厂家目录 code 保持全拼。
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
   - **is_deleted 软删除处理**：按 `elechealthcard_integration` 规则中"数据对照 SQL > is_deleted 软删除处理"执行。
4. `04-数据对照-明细.sql`：`ct_dic_basedatamapdetail` 铺底，**自包含 VALUES**（避免同表 INSERT…SELECT
   自拷贝被部分库优化成 0 行）；**hiscode 取连接库对应 HIS 字典表的 code**（`hos_ct_identity_type_dict`/
   `hos_ct_gender`/`hos_ct_nationality`/`hos_ct_marriage_status`/`hos_ct_occu_category`，含 name），
   **extcode 取对接文档附录码表**，按语义映射并逐行核对描述，勿凭旧厂家数据照抄。
   覆盖与对照方式按**规约 N**：有 `his_table_name` 的字典双向"至少一个"覆盖、允许重复、取第一条；`medStepCode` 仅需单向。
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
- 无 Maven/编译环境时明示"待内网编译验证"；提示缓存前缀。

## 相关规则与参考

生成或修改电子健康卡代码时，必须先读取规则索引 `rules/elechealthcard_index.md`，再按索引读取对应规则和参考资料。

### 规则（rules/）

- `rules/elechealthcard_index.md` — 规则路由入口
- `rules/elechealthcard_coding_conventions.md` — 编码规约（A~AO），**每次生成代码前必读**
- `rules/elechealthcard_integration.md` — 第三方集成通用约束

### 参考资料（references/）

- `references/register-elechealthcard-dataflow.md` — registerElecHealthCard 完整数据流与前端布线清单
- `references/guangdong-envelope-structure.md` — 广东省嵌套 body 信封结构示例（规约 AD 参考）

### 相关技能

- `imedicalxc-doctor-extend-engineer` — 主编排器（架构/领域门禁）
- `imedicalxc-doctor-extend-architecture` → `references/domain-constraints.md`
- `imedicalxc-doctor-blh`、`imedicalxc-doctor-invoke`、`imedicalxc-doctor-dbdata`、`imedicalxc-doctor-extend-dataformat`
- `word-reader` — .doc/.docx 读取
