---
name: elechealthcard_coding_conventions
description: |
  电子健康卡模块既定编码规约（A~AM）。
  适用于所有电子健康卡厂家接入与既有厂家维护，涵盖异常处理、命名、DTO/VO 结构、
  数据对照、Javadoc、校验、加密决策等约束。
task-affinity: [elechealthcard, coding, vendor-integration]
---

# 电子健康卡编码规约

每次生成或修改电子健康卡厂家代码时必读。

- **A. 异常统一**：入参/校验/协议异常一律
  `HisBusinessException.rpcException(HispaInvokeCardConstants.BUSINESS_CODE + "2000", msg)`
  （同类失败用同域码；勿散落裸数字 500/2000 与其它域码）。
- **B. 提示语统一"电子健康卡"**：异常/日志对用户提示一律写"电子健康卡"，**不出现具体厂家名**。
  日志可用厂家名，用户提示不用。
- **C. 只实现文档正文接口**：esb 清单多出而无正文的接口不建代码（占位也不要）；确需再按文档补。
- **D. 类头注明文档全名**：`ElecHealthCardInvokeAbstract` 等类头 `@description` 附文档全名与版本号。
- **E. 加密必考量**：每次生成显式写"加解密/签名由谁做、总线还是直连、是否 none+明文"，类注释与配置说明同步。
- **F. esb code 必索取**：未提供 → 总结文档"待确认项"高亮提醒，禁止编造。
- **G. 修改接口取卡号**：modifyVmcardInfo/afterPatUpdate 找不到 erhcCardNo 时，可从建卡/查询链路
  （按文档，如 createVmcardQRcode 返回或 getPersonInfo 按证件反查）获取；仍不可得 → 与用户确认方案后定。
- **H. 入参齐全/顺序/枚举**：每接口参数尽量都组织，拿不到就 null；**按文档字段顺序赋值，不调整顺序**；
  重要枚举在 DTO 字段注释里列出取值（或加字段/常量体现）。
- **I. @ApiModelProperty**：必填 → `required = true`；"某条件才必填" → 在 `notes` 说明。
- **J. 转换器无默认回退**：`ElecHealthCardConvertAbstract` 找不到映射仅 ① extname 含"其他"行兜底；
  其余 → null + log.error。**不为民族增加"汉族"默认**，也不为其它维度加默认回退码。
- **K. 成功判定按本文档**：服务总线返回是否成功以**本厂家对接文档**的成功码为准，
  不要被其它电子健康卡厂家的成功码影响；返回信封 VO 含 `returnCode/returnDesc/signString/
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
  · **不得产生冗余补行**：补"其他"落点前先确认该侧码**确实没有对照**；若该码已有主对照行（如 occuCategory `8→8` 已覆盖 ext 8），
    就不要再补 `9→8` 之类的重复行——(hiscode,extcode) 组合必须唯一。
  · **生成后自检**：`(hiscode,extcode)` 组合唯一、H 行 hiscode 唯一、E 行 extcode 唯一；任一项有重复即为错误，需先消除冗余再交付。
- **O. 对不上的落到"其他"**：双方任意一侧无对应关系的码，一律对照到该字典中**语义为"其他"的那一行**
  （如 其他法定有效证件 / 其他 / 其他的 / 不便分类的其他从业人员 / 其他未识别民族 等）——
  即 HIS 侧多出的码 → 落到 ext 的"其他"码；ext 侧多出的码 → 落到 HIS 的"其他"码（允许重复，取第一条）。
  **若某字典没有"其他"行**：不要臆造，使用**语义最接近的等价码**收口，并在代码注释与交付文档中**明确指出收口码**。
  （已确认口径：**性别 sex** 无"其他"→ 用 **`9 未说明的性别`** 收口；
  **婚姻 marital** 无"其他"→ 用 **`90 未说明`** 收口。）
- **P. 运行时取值策略（多行命中不取第一条）**：框架 `convertData` / `getAllCodeMapData` **都不按 his_flag 过滤**、
  返回 VO 亦**不含 his_flag**，所以方向/主次只能由代码判定。约定：
  · 命中多行时**优先"对等码"行**（`hiscode == extcode`，如 `99↔99`、`8↔8`），其次才取第一条，并 `log.warn` 打出候选；
  · 因此生成对照时应让**主对照尽量为对等码**，把"落到其他"的补充行做成非对等码；
  · 业务上若只用到固定码（如电子健康卡建卡只走 `credType=01 居民身份证`）可不受影响，但**回向**
    （平台返回码→HIS）仍会命中多行（例：ext `99` 同时被 `08/09/99` 指向）→ 必须靠上述策略保证取到 `99`。
  · 若需要更强约束，可改调 `CtDicBasedatamapdetailService.convertData(systemCode,dictCode,code,type)`（按方向取值），
    或在 VO 上补 `his_flag` 后按 H/E 过滤——三选一，需在设计中明确。
  · **该策略要应用到所有既有厂家的转换器**（防止后续加码/改对照时冲突）；发现老厂家未做，应一并回补并说明。
- **Q. 禁止"项目/医院相关参数"的代码默认值**：`orgCode/appId/appSecret/appRecordNo/terminalCode/url` 等因医院/项目而异，
  **一律不在常量类里给 DEFAULT_\* 兜底**（否则其它项目会静默用错数据）。做法：
  · 常量类只保留 **key**；取值只读扩展设定；
  · 缺失时**fail-fast**：抛 `HisBusinessException.rpcException(BUSINESS_CODE + "2000", "电子健康卡扩展设定未配置: <desc>")`；
  · 只有**平台枚举类**值可留默认（如 刷卡终端类型 01/人工窗口、appMode=窗口3），并在注释中标明"非项目数据"。
- **R. 多值参数（如 terminalCode 识读终端编码）**：**单键逗号列表**存于扩展设定，不建多行；
  · 每个值只维护一遍（解析时去掉空值并**去重**）；
  · 取值：单值即用该值；多值**随机取一个**（记录所选日志）；如条件允许，优先按**当前客户端(IP/主机名)绑定**到具体终端；
  · 兼容"只有一台终端"的项目（填一个值即走同一逻辑）。
  · hiscode 一律取**连接库对应字典表 code**；extcode 取**对接文档附录**码表。
- **S. DTO 头部/业务字段分离**：Request DTO **只包含业务字段**，头部字段（appId/timestamp/nonceStr/version/
  method/headSign/bodySign/signMode/encryptMode）由 `InvokeAbstract.buildBaseRequest()`
  在运行时从扩展设定读取并拼装；`orgCode`/`appRecordNo` 由 `buildBody()` 放入嵌套 `body` 对象。
  **DTO 不得包含头部字段和 orgCode/appRecordNo**，请求报文采用嵌套结构（详见规约 AD）。
- **T. 自调用加 `this.` 前缀**：抽象类内部方法互调一律加 `this.` 前缀（如 `this.invoke(...)` / `this.buildBaseRequest(...)`
  / `this.fillVerifyDefaultConfig(...)`），提高可读性并便于 IDE 导航。
- **U. 方法 Javadoc（Easy Javadoc 格式）**：所有 public/protected/private 方法均需 Javadoc，含 `@param`/`@return`/
  `@author 张天文`/`@since <日期>`。Constants 类的每个常量字段需行尾注释说明用途。
- **V. DTO/VO 字段排版与注释增强**：
  · 字段之间**留空行**（每个字段声明前一个空行），提高可读性；
  · `@ApiModelProperty.notes` 需包含**运行时上下文提示**，如 SM4 加密字段标注"SM4加密字段；直连模式下自动加密"、
    缺省回填字段标注"缺省时运行时按平台扩展设定回填"、条件必填标注"无证件儿童(人员类型=2)时必填"。
- **W. StrategyAbstract 患者数据完整组装**：`getElecHealthCardNoByPat` 和 `afterPatUpdate` 必须从 FeignPCAInfoDTO
  提取**全部可用患者信息**组装 DTO，包括但不限于：
  · 基本信息：name/idCode/idCardTypeCode/sex/nation/birthday/phone
  · 联系人：linkman/telephone（取 paPatContacterList 最后一条）
  · 监护人/母亲：motherName/motherIdCode/motherPhone（通过 paPatMastPO.motherDr 查询）→ 同时映射到 guardian* 字段
  · 地址层级：provinceCode/addressCityCode/countyCode（分别从 liveProvinceDr/liveCityDr/liveAreaDr 查对应 PO）
  · 国籍/母语：nationality（从 originCountryDr 查 HosCtCountryPO）、language（从 langPrimDr 查 CtDicLanguagePO，含"中文"→"汉语"映射）
  · 婚姻/职业：maritalstatuscode（查 HosCtMarriageStatusPO）、professionType（职业dr→HosCtOccupationPO→parentId→HosCtOccuCategoryPO）
  · 照片：idPhoto/scenePhoto（从 paPatSocialDto.getPhoto()）
  · 其它：personnelType 默认 "1"、payAccType 默认 "0"、birthplace 从 paPatAddressDto.getBirthAddress()
  · **formatBirthday** 使用 `DateTimeFormatter.ofPattern("yyyyMMdd")` 格式化 LocalDate
  · 无法从 HIS 数据获取的字段（如 validStartdate/validEnddate/idInst/multifetalMark/multpripleBirths/motherEmpi/recognizeFlag）
    传 null 并在注释中标明"**待确认**：该字段需从何处获取"
- **X. interfaceConfig 取值策略**：`ElecHealthCardConvertAbstract.interfaceConfig(key)` 直接返回
  `getInterfaceConfigMap().get(key)`，**不在该方法内做非空校验/抛异常**。原因：
  · 不同调用场景对缺失的容忍度不同（如 signMode 有默认值、appId 必须存在）；
  · 由调用方（如 `buildBaseRequest` 或 `computeBodySign`）决定缺失时的行为；
  · 避免在 `getSignMode`/`getEncryptMode` 等已有 `blankToDefault` 的场景下重复抛异常。
  若需 fail-fast，在具体调用点（如 `buildBaseRequest` 中取 appId/orgCode）单独校验。
- **Y. DTO/VO 字段间空行**：所有 DTO、VO 类的**每个字段声明之间必须留一个空行**
  （即 `@ApiModelProperty` + `private` 为一组，组与组之间空一行）。单字段类不需要空行。
  此规则适用于 Request DTO、Return VO、Controller DTO、Controller VO 全部。
- **Z. DocCacheUtils 字典查询统一用 getByKey**：通过字典 code 查 PO 时，一律使用
  `DocCacheUtils.getByKey("code", XxxPO.class, codeValue)` 形式，**不使用 `getByCode(...)`**。
  变量命名规约：
  · 对照后的 HIS 代码变量名带 `Code` 后缀（如 `hisCredTypeCode`/`hisSexCode`/`hisNationCode`）；
  · 查出的 PO 变量名用完整语义名（如 `identityTypeDictPO`/`genderPO`/`nationalityPO`），不用缩略名（如 credPo/sexPo）。
- **AA. Javadoc 全覆盖（含外观层/门面层）**：规则 U 适用于**所有类**，包括外观层（如 `{Company}Abstract`）、
  控制器、枚举等。不仅方法需要 Javadoc，**类本身也必须有 `@description`/`@author`/`@since`**。
  生成代码后须自检：`grep` 所有 public/protected 方法前是否有 `/** ... */` 块，缺则补。
- **AB. JsonUtils 无 parseJsonToMap 方法**：项目 `JsonUtils` 只提供 `parseJsonToObject(json, clazz)` /
  `parseJson(json, clazz)` / `toJson(obj)`。需将 JSON 转为 `Map<String, Object>` 时，使用
  `(Map<String, Object>) JsonUtils.parseJsonToObject(json, Map.class)` 并加 `@SuppressWarnings("unchecked")`。
  **禁止调用不存在的 `JsonUtils.parseJsonToMap(...)`**。
- **AC. PaPatMastPO 患者编号字段**：取患者编号（如打印信息中的 `patNo`）时使用 `patMast.getNo()`，
  **不使用 `getMpiDr()`**。`mpiDr` 是 MPI 内部标识，不是业务编号。
- **AD. 请求报文嵌套 body 结构**：部分省份平台请求报文采用**嵌套结构**，业务字段放在 `body` 对象内，
  **不是扁平混在头部字段中**。具体头部字段列表、body 字段范围、version 值、encryptMode 值、签名计算范围
  以**该厂家对接文档**为准，不得沿用其它厂家的报文结构。
  · `buildBaseRequest()` 只构建头部；`buildBody(dto)` 构建业务字段 Map 并追加 orgCode/appRecordNo
  · 前置代理模式下 `signMode=none`/`encryptMode=none`/`headSign=none`/`bodySign=none`，body 内明文
  · 直连模式下签名/加密参数按文档实现，见 `references/guangdong-envelope-structure.md` 作为嵌套结构示例
- **AE. InvokeAbstract 方法 Javadoc 须含文档章节号**：Invoke 层每个接口方法的 Javadoc 首行
  必须标注对接文档中的**章节编号+名称**，格式为 `6.x接口名称`（不加括号）。
  如 `6.1电子健康码注册`、`6.5电子卡二维码验证`。
  便于从代码直接追溯到文档具体位置。DTO/VO 的 `@reference` 同理已含章节号。
- **AF. DTO 条件必填字段须着重说明**：当某字段的必填性依赖于另一个字段的值时
  （如 `payAmount`/`payChannel` 在诊疗环节=010105 收费时必填），`@ApiModelProperty.notes`
  必须明确标注**条件+必填**，并说明当前 HIS 是否能获取。**若 HIS 无法获取该字段，
  必须排除对应的诊疗环节对照**（不映射 010105），并在 notes 中注明原因。
  此类字段在交付文档中须单独列出**给开发的说明**。
- **AG. 诊疗环节对照排除不可支持环节**：若某诊疗环节需要 HIS 提供当前无法获取的数据
  （如收费环节需要 payAmount/payChannel），**不得在对照表中映射该环节**，
  避免运行时因缺少必填字段而报错。在对照 SQL 注释和交付文档中说明排除原因。
- **AH. 打印/读卡接口关键信息校验**：`getElecHealthCardPrintInfo` 等接口在调用平台前，
  必须校验关键业务字段是否有值（如 `cardRef.getElecPid()` 电子健康码ID、`patMast.getNo()` 患者编号），
  为空时抛 `HisBusinessException` 明确提示，不得传空值调用平台接口。
- **AI. SQL 扩展设定须赋实际值**：`02-扩展设定.sql` 中从平台文档/备案资料可获取的参数
  （appId/appSecret/orgCode/appRecordNo/url 等）**必须直接赋实际值**，不使用 `REPLACE_*` 占位符。
  仅当值来源为硬件设备/不可预知时才用占位符并注明取值来源。
- **AJ. ct_dic_basedatamap 必须含 parent_dr**：建目录 SQL 的每条 INSERT 必须包含 `parent_dr` 字段，
  通过子查询 `(SELECT id FROM ct_dic_basedatamap WHERE code = '父节点code')` 获取父节点 ID。
  根目录 parent_dr = NULL，二级取一级 ID，三级取二级 ID，以此类推。
- **AK. 对照明细 hisname 必须赋值**：`ct_dic_basedatamapdetail` 的 `hisname` 字段
  必须通过 `JOIN` 对应 HIS 字典表取 `name` 字段赋值（如 `JOIN hos_ct_identity_type_dict h ON h.code = v.hiscode`），
  **不得留空**。INSERT 须包含 `hisname` 列。
- **AL. 对照方式：按语义匹配，非按 code 对照**：`hiscode→extcode` 的映射应基于
  `hisname` 与 `extname` 的**语义含义**匹配，不是简单按 code 数值对应。
  例如性别：HIS `name='男'` ↔ ext `name='男'`（hiscode=1, extcode=1），
  而非假设 HIS code=1 一定对应 ext code=1。
- **AM. 诊疗环节对照方向**：诊疗环节 `medStepCode` 对照要求**每个 HIS 数据都能对照一个 ext 数据**
  （正向全覆盖），反向（ext→HIS）不要求。
