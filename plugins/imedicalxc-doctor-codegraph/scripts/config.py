"""
Maven 穿透分析配置文件
"""
import json
import os
import re
from pathlib import Path


def _find_maven_home_from_path():
    """从 PATH 环境变量中查找 Maven 安装目录"""
    path_env = os.environ.get("PATH", "")
    separator = ";" if os.name == "nt" else ":"
    for p in path_env.split(separator):
        p = p.strip()
        if "maven" in p.lower() or "mvn" in p.lower():
            maven_bin = Path(p)
            if maven_bin.exists():
                # 返回上一级作为 MAVEN_HOME
                return maven_bin.parent
    return None


def _read_maven_local_repo():
    """从 Maven settings.xml 读取 localRepository 配置"""
    settings_paths = []

    # 1. 从 MAVEN_HOME 读取全局配置
    maven_home = os.environ.get("MAVEN_HOME") or os.environ.get("M2_HOME")
    if not maven_home:
        maven_home = _find_maven_home_from_path()
    if maven_home:
        settings_paths.append(Path(maven_home) / "conf" / "settings.xml")

    # 2. 用户级配置
    settings_paths.append(Path.home() / ".m2" / "settings.xml")

    # 解析 settings.xml，提取 <localRepository>
    for settings_file in settings_paths:
        if settings_file.exists():
            try:
                content = settings_file.read_text(encoding="utf-8")
                # 移除 XML 注释块
                content_no_comments = re.sub(r"<!--.*?-->", "", content, flags=re.DOTALL)
                # 匹配 <localRepository> 标签
                match = re.search(r"<localRepository>([^<]+)</localRepository>", content_no_comments)
                if match:
                    repo_str = match.group(1).strip()
                    repo_path = Path(repo_str)
                    # Windows 路径处理（如 D:\java\maven）
                    if os.name == "nt" and not repo_path.is_absolute() and len(repo_str) >= 2 and repo_str[1] == ":":
                        repo_path = Path(repo_str)
                    if repo_path.exists():
                        return repo_path
            except Exception:
                continue
    return None


def _build_maven_repo_paths():
    """构建 Maven 仓库路径列表（优先级：环境变量 → settings.xml → 默认值）"""
    paths = []

    # 1. 环境变量 MAVEN_REPO 最高优先级
    env_repo = os.environ.get("MAVEN_REPO")
    if env_repo:
        paths.append(Path(env_repo))

    # 2. 从 settings.xml 读取
    xml_repo = _read_maven_local_repo()
    if xml_repo and xml_repo not in paths:
        paths.append(xml_repo)

    # 3. 常见默认位置（fallback）
    fallbacks = [
        Path(r"D:\java\maven\care\com\mediway"),  # 医生站主仓库
        Path(r"D:\java\maven"),
        Path(r"D:\java\maven\care"),
        Path.home() / ".m2" / "repository",
    ]
    for fb in fallbacks:
        if fb not in paths:
            paths.append(fb)

    return paths


# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent.parent.parent

# Maven 本地仓库路径
MAVEN_REPO_PATHS = _build_maven_repo_paths()

# 后端源码路径
BACKEND_ROOT = PROJECT_ROOT.parent / "src" / "backend"

# 要分析的模块（相对于 BACKEND_ROOT）
TARGET_MODULES = [
    "care/comoe-mediway/comoe-ord",
    "care/comoe-mediway/comoe-orddrivecom",
    "care/ipcare-mediway-boot/ipcare-oeord",
]

# 工作区仓库（穿透追踪起点）
WORKSPACE_REPOS = [
    # care/ 下核心业务仓库
    "care/comoe-mediway",
    "care/cfoe-mediway",
    "care/commr-mediway",
    "care/cfmr-mediway",
    "care/opcare-mediway-boot",
    "care/ipcare-mediway-boot",
    "care/aggcare-mediway-boot",
    # 其他业务仓库
    "curc-mediway-boot",
    "hispa-mediway-boot",
    "ma-mediway-boot",
    "opalloc-mediway-boot",
    "opreg-mediway-boot",
]

# 工作区业务服务名（包路径第 4 段），穿透数据只保留这些服务及它们的外部调用叶子
WORKSPACE_SERVICES = [
    "comoe", "cfoe", "commr", "cfmr", "opcare", "ipcare", "aggcare",
    "curc", "hispa", "ma", "tr", "opalloc", "opreg",
]

# 基础设施仓库（被动包含，不作为起点）
INFRA_REPOS = [
    "public/his-mediway-boot",
    "public/hisbase-mediway",
    "public/hiscore-mediway-boot",
    "public/cf/hiscf-mediway-boot",
    "public/cf/hiscfsv-mediway",
    "public/ct/hisct-mediway-boot",
    "public/ct/hisctsv-mediway",
]

# 穿透追踪最大深度
MAX_TRACK_DEPTH = 10

# 工作区根目录（含 src/backend 的仓库根），索引内路径以此为基准
WORKSPACE_ROOT = PROJECT_ROOT.parent


def to_repo_relative(path) -> str:
    """索引中的源码路径统一输出为工作区相对路径（POSIX 分隔符），与机器和克隆位置无关。"""
    p = Path(path)
    try:
        return p.resolve().relative_to(WORKSPACE_ROOT.resolve()).as_posix()
    except (ValueError, OSError):
        return Path(path).as_posix()


def _declared_output_dir() -> Path:
    """索引目录以插件 manifest 的 projectDirectories 为准，避免 manifest 与脚本各写一份路径。"""
    manifest = Path(__file__).resolve().parents[1] / ".agents-plugin" / "plugin.json"
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
        for entry in data.get("projectDirectories", []):
            if entry.get("id") == "codegraph-index" and entry.get("path"):
                return WORKSPACE_ROOT / entry["path"]
    except (OSError, ValueError):
        pass
    return WORKSPACE_ROOT / "docs" / "agents" / "imedicalxc-doctor-codegraph"


# 输出目录
OUTPUT_DIR = _declared_output_dir()
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 图数据库文件
GRAPH_DB_FILE = OUTPUT_DIR / "call_graph.graphml"

# 日志级别
LOG_LEVEL = "INFO"

# 分析选项
ANALYSIS_OPTIONS = {
    "extract_method_calls": True,  # 提取方法调用关系
    "extract_field_access": True,  # 提取字段访问
    "extract_class_hierarchy": True,  # 提取类继承关系
    "resolve_maven_deps": True,  # 解析 Maven 依赖
    "skip_test_classes": True,  # 跳过测试类
}

def get_maven_repo_paths():
    """获取存在的 Maven 仓库路径列表"""
    return [p for p in MAVEN_REPO_PATHS if p.exists()]


def get_primary_maven_repo():
    """获取医生站主 Maven 仓库路径（第一个存在的路径）"""
    for p in MAVEN_REPO_PATHS:
        if p.exists():
            return p
    # 所有路径都不存在，提醒设置环境变量
    print("=" * 60)
    print("错误: Maven 仓库路径不存在")
    print("=" * 60)
    print("已尝试的路径:")
    for p in MAVEN_REPO_PATHS:
        print(f"  - {p}")
    print()
    print("请设置环境变量 MAVEN_REPO 指向正确的 Maven 仓库路径:")
    print("  Windows:  set MAVEN_REPO=D:\\path\\to\\maven")
    print("  Linux:    export MAVEN_REPO=/path/to/maven")
    print("=" * 60)
    raise FileNotFoundError(f"Maven 仓库不存在，请设置环境变量 MAVEN_REPO")

def get_backend_path(module_path: str) -> Path:
    """获取后端模块的完整路径"""
    return BACKEND_ROOT / module_path


# 系统包前缀过滤列表（JDK/框架/第三方库，不纳入调用图）
SYSTEM_PACKAGES = (
    # JDK 标准库
    'java.', 'javax.', 'sun.', 'com.sun.',
    'org.xml.', 'org.w3c.', 'org.omg.',
    # 第三方工具库
    'cn.hutool.',
    'com.alibaba.fastjson.', 'com.alibaba.excel.', 'com.alibaba.druid.',
    'com.alibaba.nacos.',
    'com.google.common.', 'com.google.gson.', 'com.google.zxing.',
    'com.beust.jcommander.',
    'com.fhs.',
    'com.github.xiaoymin.knife4j.',
    'dm.jdbc.',
    'io.jsonwebtoken.', 'io.micrometer.',
    'jodd.',
    'kotlin.',
    'net.sourceforge.pinyin4j.',
    'org.bouncycastle.',
    # Spring 生态
    'org.springframework.', 'reactor.core.',
    # Apache 公共库
    'org.apache.commons.', 'org.apache.pdfbox.', 'org.apache.rocketmq.',
    'org.apache.http.', 'org.apache.poi.',
    'org.assertj.', 'org.eclipse.jetty.', 'org.junit.',
    # Jackson JSON
    'com.fasterxml.',
    # Elasticsearch
    'co.elastic.',
    # JSON.org
    'org.json.',
    # MyBatis Plus
    'com.baomidou.',
    # Mediway 框架/公共
    'com.mediway.hos.',
    'com.mediway.his.generator',
    'com.mediway.his.api.exception.',
    'com.mediway.his.api.entity.',
    'com.mediway.his.hisbase.',
    'com.mediway.his.server.',
    'com.mediway.his.common.cache.',
    'com.mediway.his.log.',
)


# Maven biz 服务名 → 工程模块名映射（35 个服务，2026-11-03 验证）
# 键: source_service（从包名 com.mediway.his.<svc>.xxx 提取）
# 值: 对应的 boot 模块或库模块名
SERVICE_MODULE_MAP = {
    # ── 手术 / 预约类（ipor-mediway-boot）──
    "admission":          "ipor-mediway-boot",
    "anappointment":      "ipor-mediway-boot",
    "ansurgeryschedule":  "ipor-mediway-boot",
    "appointment":        "ipor-mediway-boot",
    "dayappointment":     "ipor-mediway-boot",
    "daysurgeryschedule": "ipor-mediway-boot",
    "daysurgerystation":  "ipor-mediway-boot",
    "outappointment":     "ipor-mediway-boot",
    "outsurgeryschedule": "ipor-mediway-boot",
    "plannedoperation":   "ipor-mediway-boot",
    "postopdiagnosis":    "ipor-mediway-boot",
    "preopdiagnosis":     "ipor-mediway-boot",
    "statistic":          "ipor-mediway-boot",
    "surgeryschedule":    "ipor-mediway-boot",
    # ── 独立 boot 模块 ──
    "api":                "ipor-mediway-boot",
    "arinv":              "arinv-mediway",
    "ca":                 "hisca-mediway-boot",
    "comemr":             "comemr-mediway",
    "cpw":                "cpw-mediway-boot",
    "emar":               "emar-mediway-boot",
    "emrdata":            "emrdata-mediway-boot",
    "hisbasesv":          "hisbsp-mediway-boot",
    "hisbsp":             "hisbsp-mediway-boot",
    "hiscore":            "cpw-mediway-boot",
    "hispay":             "hispay-mediway-boot",
    "ihd":                "hisihd-mediway-boot",
    "ipar":               "ipar-mediway-boot",       # 住院收费服务（住院登记/出院结算）
    "ipbmc":              "ipbmc-mediway-boot",      # 床管中心服务
    "ipemr":              "ipemr-mediway-boot",
    "ipnemr":             "ipnemr-mediway-boot",
    "ipnur":              "ipnur-mediway-boot",
    "opar":               "opar-mediway-boot",
    "opemr":              "opemr-mediway-boot",
    "phm":                "phm-mediway-boot",
    "rmis":               "rmis-mediway-boot",       # 云诊所服务
    # ── 工作区服务（src/backend/ 下的子仓库）──
    "aggcare":            "aggcare-mediway-boot",
    "comoe":              "comoe-mediway",
    "commr":              "commr-mediway",
    "cfmr":               "cfmr-mediway",
    "cfoe":               "cfoe-mediway",
    "curc":               "curc-mediway-boot",
    "hispa":              "hispa-mediway-boot",
    "ma":                 "ma-mediway-boot",
    "opalloc":            "opalloc-mediway-boot",
    "opcare":             "opcare-mediway-boot",
    "ipcare":             "ipcare-mediway-boot",
    "opreg":              "opreg-mediway-boot",
    "hisbase":            "hisbase-mediway",
    "hiscf":              "hiscf-mediway-boot",
    "hiscfsv":            "hiscfsv-mediway",
    "hisct":              "hisct-mediway-boot",
    "hisctsv":            "hisctsv-mediway",
}


def get_module_for_service(service_name: str) -> str:
    """获取服务名对应的工程模块名，未知服务返回 '外部 Maven 依赖'"""
    return SERVICE_MODULE_MAP.get(service_name, "外部 Maven 依赖")


# 方法名 → 业务场景描述映射（用于影响分析报告）
# 数据来源：腾讯文档《信创版微服务接口清单》+ 方法名推断
# 键: Class.method 或完整方法名
# 值: 业务场景描述
METHOD_DESCRIPTION_MAP = {
    # ── ipar 住院收费服务（住院登记/出院结算） ──
    "ArIPRegCUDService.increasePatTimes": "办理住院业务时累计患者住院次数",
    "ArIPRegCUDService.savePatInfo": "保存患者住院登记信息时联动更新",
    "ArIPRegCUDService.cancelReg": "取消住院登记时回退住院次数",
    "ArIPRegCUDService.updatePaadmInfo": "更新患者住院信息",
    "ArPreIPAdmTransCUDService.admTransUpdateData": "预住院转住院时更新数据",
    # ── ipbmc 床管中心服务 ──
    "PaadmBmcIpTransLogServiceImpl.admTransCancel": "转科取消时回退住院次数",
    "PaadmBmcIpTransLogServiceImpl.admTransUpdateData": "转科更新时调整住院次数",
    # ── rmis 云诊所服务 ──
    "ReceiveAdmInfoBLH.savaAdmInfo": "接收外部挂号信息时更新住院次数",
    "ReceiveAdmInfoBLH.receiveAdmInfo": "接收 HIS 挂号信息",
    # ── hispa 患者主索引服务 ──
    "UpdateExemptionNumberAbstract.increasePatTimes": "更新患者住院累计次数（核心逻辑）",
    "UpdateExemptionNumberBLH.increasePatTimes": "更新患者住院累计次数（BLH 入口）",
    "PaPatManagerAbstract.increasePatTimes": "患者管理-更新住院次数",
    "SaveOrUpdatePaPatInfoAbstract.saveOrUpdatePatInfo": "保存或更新患者信息",
    "SaveIhdPaPatDataAbstract.saveInPatTimesMore": "IHD 设备数据导入时写入住院次数",
    # ── comoe 公共医嘱服务 ──
    "InsertOeOrdItemAbstract.insertMultiple": "批量插入医嘱项",
    "InsertOeOrdItemAbstract.checkExamItem": "检查医嘱项校验",
    "InsertOeOrdItemAbstract.checkOrdItem": "医嘱项校验",
    # ── ipnur 住院护理服务 ──
    "IPNurOrdBLH.confirmOrd": "护理站确认医嘱",
    # ── anappointment 预约服务 ──
    "AnAppointmentBLH.saveAppointmentForOrd": "为医嘱保存预约信息",
    # ── aggcare 综合诊疗服务 ──
    "AggcareOeOrdBLH.saveOrd": "综合诊疗保存医嘱",
}


def get_method_description(method_id: str) -> str:
    """
    获取方法的业务场景描述。
    支持完整方法 ID 或 Class.method 格式。
    未收录时返回空字符串，由智能体结合 Feign 接口描述和方法名自行推断。
    """
    if method_id in METHOD_DESCRIPTION_MAP:
        return METHOD_DESCRIPTION_MAP[method_id]
    cm = method_id.split(".")[-2] + "." + method_id.split(".")[-1] if "." in method_id else method_id
    cm = cm.split("(")[0]
    if cm in METHOD_DESCRIPTION_MAP:
        return METHOD_DESCRIPTION_MAP[cm]
    return ""


def is_system_class(class_name: str) -> bool:
    """判断是否是系统/JDK/框架类（需过滤）"""
    if not class_name:
        return False
    return any(class_name.startswith(pkg) for pkg in SYSTEM_PACKAGES)


# ═══════════════════════════════════════════════════════════════
#  Feign 接口业务描述（来源：腾讯文档《信创版微服务接口清单》219 条）
#  键: Feign 接口短名（Client 类名或方法名）
#  值: "功能描述｜场景描述"
# ═══════════════════════════════════════════════════════════════

FEIGN_INTERFACE_DESC = {
    "CheckPatCardInfoClient": "校验证件号合法性、获取证件校验信息。｜急诊、住院收费在患者登记时校验身份证件号码。",
    "DeleteOpCareMRDiagnosClient": "删除门诊诊断信息。｜院前急救删除急诊患者的门诊诊断。",
    "IpCareMigrateOPExecClient": "将门诊医嘱执行记录按计费模式转为住院执行计费模式。｜计费、住院收费处理门诊转住院医嘱计费。",
    "IpCareReturnOrdExecClient": "住院执行记录退费。｜住院收费处理执行记录退费。",
    "LookUpICDClientController": "ICD 诊断分页检索查询。｜计费、住院收费录入诊断时检索 ICD 编码。",
    "OpCareOeOrdApplyDriveComClient": "获取医嘱部位串对应的描述。｜急诊、门诊护理展示医嘱部位信息时调用。",
    "PaAdmPortalClient": "新增就诊、更新病案号。｜住院收费、住院护理、rmis 创建就诊、维护病案号时调用。",
    "QueryPACardInfoClient": "获取患者有效卡记录。｜arinv 获取患者有效卡信息。",
    "QueryPaAdmClient": "批量获取基本/门诊/住院就诊标准数据模型、住院天数、就诊年龄等就诊信息。｜计费、住院护理、会诊、急诊、病历、医保结算、临床路径等多业务域跨域获取就诊标准数据。",
    "QueryPaAdmIPClient": "获取在科患者列表、出院患者列表。｜临床路径、公共卫生按科室查询住院患者清单。",
    "QueryPaAllergyInfoClient": "查询患者过敏信息、过敏列表，获取菜单过敏记录数量。｜急诊、病历、住院护理病历等模块查询患者过敏结果（hisui 调用）。",
    "QueryPaPatClient": "查询患者全量信息、基本信息（含分页）、社会信息、地址信息、联系人信息、有效卡信息及年龄日期串。｜计费、护理、药房、临床路径、急诊收费、住院收费等模块跨域查询患者主索引数据。",
    "SaveIpCareMRDiagnosClient": "保存住院诊断信息。｜计费、住院收费、rmis 保存住院诊断。",
    "SaveOpCareMRDiagnosClient": "保存门诊诊断信息。｜院前急救为急诊患者保存门诊诊断。",
    "SavePACardInfoClient": "患者建卡、急诊建卡（可不收卡费）。｜急诊、住院护理、rmis 为患者新建就诊卡时调用。",
    "SavePAInfoClient": "保存或更新患者基本信息及扩展信息（患者地址、患者社会信息）。｜急诊、住院收费、住院护理、院前急救等模块建档或更新患者信息时调用。",
    "SavePaAllergyInfoClient": "新增、批量新增患者过敏记录（置阳性），撤销护士置阳性记录产生的过敏记录。｜住院护理护士站维护患者过敏记录时调用。",
    "UpdatePaInfoClient": "更新患者住院累计次数。｜住院收费、床管中心、rmis 办理住院业务时累计患者住院次数。",
    "addOrDel0bsByRelateItmMast": "按体征与医嘱项关联配置新增或删除体征记录。｜医嘱执行或撤销执行联动体征记录时调用。",
    "addOrUpdateBGHandleRec": "新增或修改血糖记录关联的医嘱或会诊信息。｜血糖处置后登记关联医嘱、会诊记录时调用。",
    "admitNewborn": "统一处理新生儿涉及就诊、床位和转移记录的入院操作。｜护士站办理新生儿入院。",
    "antOrdItemInfoClient": "获取抗菌药超预防用药时间数据、按就诊查询抗菌药物使用信息。｜病历展示与质控抗菌药物使用情况。",
    "apptionmentClient": "预约（APP 正常预约、LOCK 锁号预约）。｜会诊、急诊为患者办理预约或锁号时调用。",
    "assessToQuestion": "根据护理病历记录、患者护理级别及触发配置生成护理问题。｜护理病历评估结果触发护理计划问题时调用。",
    "batchCheckOrdNeedSee": "医嘱待处理批量校验。｜按医嘱ID集合批量判断待处理状态。",
    "batchSaveNrOrdExec": "批量保存医嘱执行扩展信息。｜批量生成执行记录时同步护理扩展数据。",
    "batchSaveNrOrdItem": "批量保存护理医嘱扩展信息。｜医生批量保存医嘱时同步护理扩展数据。",
    "bedapointflagSaveOrUpdateBatch": "批量保存或更新预约床位状态变化记录。｜护理床位管理操作同步预约状态。",
    "bloodSugarSyncTemplate": "按血糖项目的模板及字段配置，将测量数据新增或更新到护理血糖监测记录。｜血糖测量结果需要同步形成护理监测记录时调用。",
    "cacelAdmInfo": "删除或取消护理侧患者登记相关信息。｜取消患者住院登记。",
    "cancelDoctorDischarge": "撤销医生出院相关业务处理。｜医生撤销已办理的出院。",
    "cancelPatAppBed": "取消患者的床位预约。｜医生取消预约床位或相关业务取消预约。",
    "cancelPatRegister": "取消患者预约信息。｜医生取消预约登记。",
    "cancelSeeOrder": "撤销医嘱处理。｜业务撤回已处理医嘱。",
    "cancelSeeOrderChunks": "批量撤销医嘱处理。｜护士站撤销已处理医嘱。",
    "cancleIPAppointment": "作废患者预约住院记录。｜取消患者预约住院、同步护理预约状态时调用。",
    "cancleIPAppointmentRegister": "取消预住院登记及预约床位。｜预住院患者转门诊。",
    "cfOeClient": "医嘱项类型相关配置查询（草药医嘱项分类、单个或批量判断是否草药医嘱）。｜计费、门诊收费判断医嘱项是否为草药。",
    "clearOverDueAppedInfo": "过期预约床位清理。｜护士站刷新床位图时清理过期预约。",
    "ctOeCmCookmodeTakeMethodClient": "煎药方式对应默认取药方式查询（列表、按ID、按煎药方式）。｜草药房根据煎药方式获取默认取药方式。",
    "ctOeDriveComClient": "查询草药取药方式下拉数据。｜草药房录入草药医嘱时选择取药方式。",
    "ctUnitDriveComClientController": "单位数据获取与运算（按剂量、频次、疗程或整包装数量计算基本单位总数，获取可用发药单位）。｜临床路径计算医嘱剂量单位。",
    "cuRcApplyClient": "新增保存治疗申请、医嘱审核后将医嘱信息更新至治疗申请。｜计费接收治疗申请及医嘱关联数据。",
    "cuRcDealApplyDataClient": "治疗申请数据处理（提供给计费组治疗部分退费）。｜计费、门诊收费处理治疗项目部分退费。",
    "cuRcGetApplyDataClient": "按医嘱ID获取治疗申请ID、查询治疗申请数量。｜计费、住院护理获取治疗申请数据。",
    "dealAdmClient": "取消挂号。｜会诊、急诊取消门诊挂号时调用。",
    "dealAppClient": "释放锁号记录、取消预约（解锁）、取消预挂号。｜会诊、急诊、门诊收费取消或释放预约时调用。",
    "deletePGD": "接收原始字节请求内容，作废护理单据。｜PDA护理病历作废已有护理单据时调用。",
    "doctorDischarge": "执行医生出院相关业务处理。｜医生办理患者出院。",
    "excuteBindOrder": "按病区绑定配置，按用法或医嘱执行绑定。｜业务触发病区预配置的医嘱绑定。",
    "execAttachAricm": "执行附加医嘱绑定。｜护士站执行附加或绑定医嘱。",
    "findAdmTransWard": "在院转科患者查询。｜护士住院患者列表筛选在院转科患者。",
    "findDeliveryPatientAdmIds": "返回登记到产房、产科的患者及小孩就诊号。｜医生站筛选产房、产科患者时调用。",
    "firstTransToBed": "患者首次分床。｜护士站办理首次分床。",
    "generateLaborPdf": "按就诊号、医院生成产程图 PDF，并返回 Base64 内容供归档使用。｜病案归档产程图时调用。",
    "generateLongOrderSheetPdf": "按就诊号、医院生成长期医嘱单 PDF，并返回 Base64 内容供归档使用。｜病案归档长期医嘱单时调用。",
    "generateTempOrderSheetPdf": "按就诊号、医院生成临时医嘱单 PDF，并返回 Base64 内容供归档使用。｜病案归档临时医嘱单时调用。",
    "generateTemperaturePdf": "生成指定就诊的体温单 PDF，并返回 Base64 内容供归档使用。｜病案归档体温单时调用。",
    "getAdminDateTime": "患者入院时间查询。｜业务页面引用患者入院日期和时间。",
    "getApplyInfoForConsult": "会诊申请信息查询与校验（校验申请是否可发起会诊）。｜会诊发起前校验申请单。",
    "getBabyInfoByAdmId": "按就诊号查询新生儿资料及1、5、10分钟 Apgar 评分。｜电子病历引用新生儿信息和 Apgar 评分时调用。",
    "getBatchHospLastVal": "按就诊号集合及体征代码返回各患者最后记录。｜批量展示患者最新体征时调用。",
    "getBatchPatLevelDetailByIds": "患者护理级别明细批量查询。｜需要护理级别明细的业务展示。",
    "getBedAppedInfo": "床位预约信息查询。｜床管中心或护理床位管理查询预约占用。",
    "getBedId": "批量查询患者对应床位ID。｜按就诊集合关联床位信息。",
    "getBedTypes": "床位类型批量查询。｜护士站组装床位展示或执行床位规则。",
    "getBeds": "床位列表查询。｜护士站查询和选择床位。",
    "getBloodGlucoseRecordsForEMR": "按就诊号集合及日期范围查询患者血糖记录。｜电子病历引用患者血糖记录时调用。",
    "getBloodPreData": "按就诊号及日期查询；未传项目代码时默认查询收缩压、舒张压。｜查看或引用患者指定日期范围的血压记录时调用。",
    "getBloodSugarRecorddata": "按就诊号查询血糖监测单，整理空腹、餐前后、睡前、夜间、随机血糖及时间和单位。｜电子病历等业务读取患者血糖监测历史或引用血糖记录时调用。",
    "getCancleReason": "按预约记录查询作废原因。｜医生查看住院预约作废情况。",
    "getChangeHead": "按患者、模板及科室获取动态表头数据。｜护理记录表格加载和动态列展示时调用。",
    "getCodeList": "接收原始字节请求内容，查询护理单据记录。｜PDA护理病历加载已有单据记录时调用。",
    "getColumns": "获取引用栏目以及护理病历、交班模块模板栏配置。｜构建护理记录引用界面时调用。",
    "getCurrentDischargeStatus": "查询出院日志表当前状态。｜出院流程展示与状态校验。",
    "getData": "查询患者生育资料。｜外部业务引用患者生育证号、生育类型、孕周、胎次等生育信息时调用。",
    "getDeliverStatus": "查询患者当前分娩业务状态。｜医生站展示或判断孕产妇分娩状态时调用。",
    "getDischargeDateTime": "患者出院时间查询。｜业务页面引用患者出院日期和时间。",
    "getEmptyBeds": "空床列表查询。｜护士站分床转床时选择空床。",
    "getEprContent": "按电子病历引用配置读取患者对应术语内容，组装名称及内容后分页返回。｜会诊等业务引用患者电子病历内容时调用。",
    "getEprList": "按电子病历引用配置读取患者对应术语内容，组装名称及内容后分页返回。｜护理记录引用医生电子病历内容时调用。",
    "getExecuteComConfig": "获取护士执行通用配置，包括非药品医嘱医技执行后撤销限制。｜执行或撤销非药品医嘱时读取规则。",
    "getFirstEvaluation": "查询患者固定首次评估模板中最早的有效记录，返回入院方式、疼痛等级、护理等级及生命体征等信息。｜电子病历等业务需要引用患者首次护理评估信息时调用。",
    "getFirstSomeVsItmVal": "查询体温、脉搏、心率、呼吸、血压、体重、身高及婴儿体重等首次记录。｜首次评估或病历引用首次体征时调用。",
    "getFirstToBedTime": "首次分床时间批量查询。｜多个患者信息展示或业务引用。",
    "getHospLastVal": "查询患者体温、血压、脉搏、身高、体重及婴儿体重的最近记录。｜患者信息展示、护理评估引用最近体征时调用。",
    "getIcons": "获取患者图标并补充患者相关链接参数。｜患者列表、患者卡片显示护理图标时调用。",
    "getIfNureseOrOrdersheet": "一次查询医嘱在医嘱单和护嘱单上的显示结果。｜同时判断两类单据显示内容时调用。",
    "getIfNuresesheetInsertData": "返回符合护嘱单显示规则的ID列表。｜HIS 跨工程校验护嘱单显示内容时调用。",
    "getIfOrdersheetInsertData": "返回符合医嘱单显示规则的ID列表。｜HIS 跨工程校验医嘱单显示内容时调用。",
    "getInsuOPRegistInfoClient": "获取医保挂号组织信息。｜医保结算获取挂号所需医保组织参数。",
    "getKnowledgeContent": "查询知识条目内容，并解析关联的数据源。｜护理记录引用知识库内容时调用。",
    "getKnowledgeLocs": "获取当前科室及关联知识库科室并去重。｜选择护理知识库的科室范围时调用。",
    "getKnowledgeTree": "按科室获取知识分类树并按筛选条件过滤。｜浏览和选择护理知识条目时调用。",
    "getLabOrdExecNeedPrintedFlag": "判断检验执行记录是否要求先打印再执行。｜执行检验医嘱前校验打印要求。",
    "getLabOrdList": "查询患者检验记录，按检验就诊号合并项目名称后分页返回。｜护理记录引用患者检验信息、选择检验报告时调用。",
    "getLabResult": "按选中的检验记录ID查询结果明细，并转换高低异常标记。｜护理记录查看或引用检验结果时调用。",
    "getLastItemValue": "按就诊号及体征代码返回最后记录值。｜业务引用患者某一项最新体征值时调用。",
    "getLastSomeVsItmVal": "查询体温、脉搏、心率、呼吸、血压、体重、身高等最近记录。｜患者评估、记录引用最新常用体征时调用。",
    "getLastTransLocHours": "获取距上次转科的时间间隔，单位为小时。｜判断患者转科时间间隔。",
    "getObsContent": "按入院日至当天的范围查询并组装患者生命体征数据。｜会诊等业务引用患者住院期间的生命体征时调用。",
    "getObsRules": "按体征代码集合查询各项目预警下限和上限。｜批量录入或展示体征时校验、提示数值范围。",
    "getOeOrdItemCMClient": "获取门诊草药录入数据（病历回插草药数据、草药处方类型查询）。｜病历回插门诊草药医嘱数据。",
    "getOperList": "按患者和手术日期范围查询手术预约、麻醉等信息，支持本次或历次就诊。｜护理记录引用患者手术相关信息时调用。",
    "getOrderDisposeStatCode": "医嘱处理状态批量查询。｜按医嘱ID集合查询处理状态代码。",
    "getOrders": "护士执行医嘱查询。｜护士站加载执行医嘱列表。",
    "getPatAbnormalInfo": "检查患者是否满足出院或转科条件。｜提交出院或转科操作前校验。",
    "getPatAction": "按就诊号、用户、模块和操作，结合出院时间、提交状态及授权配置校验操作权限。｜出院患者生命体征、产程图、血糖单等护理模块执行受控操作前调用。",
    "getPatApBed": "按就诊号查询登记状态及预约床位信息。｜费用业务展示或校验患者预约登记信息。",
    "getPatCurLocAndWard": "患者当前科室病区查询。｜护士站分床转床或展示患者当前位置。",
    "getPatIcons": "查询患者床位图展示图标。｜业务列表或床位图展示患者标识。",
    "getPatIllStateCode": "批量查询病危、病重等病情级别代码。｜患者列表展示病情标识。",
    "getPatInHospDays": "患者住院天数查询。｜住院天数展示或业务计算引用。",
    "getPatInfoById": "查询入出院时间、病案号、医生和当前床位等信息。｜单患者业务展示或资料引用。",
    "getPatInfoByIds": "批量查询入出院时间、病案号、医生和当前床位等信息。｜患者列表或批量资料引用。",
    "getPatLastBedCode": "优先返回当前在床床位，否则返回最后所在床位。｜业务展示患者当前或历史最后床位。",
    "getPatTempV2": "按患者集合、类型及日期范围分页查询体征或血糖记录明细，返回具体 Page 类型。｜业务通过 Feign 批量引用患者体征、血糖明细时调用。",
    "getPatTransferInfo": "查询入院时间、出院时间、住院天数及当前出院状态。｜患者信息展示及出入院状态判断。",
    "getPdaOrders": "PDA执行医嘱查询。｜移动护理加载执行医嘱列表。",
    "getPreviousLoc": "转科前科室查询。｜业务识别患者转科前科室。",
    "getPulseData": "按就诊号及日期查询；未传项目代码时默认查询脉搏。｜查看或引用患者指定日期范围的脉搏记录时调用。",
    "getReferRecordConfig": "返回记录ID、护理日期及时间和配置字段的列名、标题。｜会诊等业务构建护理记录引用表格时调用。",
    "getReferRecordContent": "按引用字段配置读取记录值并组装为分页内容。｜会诊等业务读取患者既有护理记录以供引用时调用。",
    "getReferTemplateTree": "获取护理模板目录，仅保留已配置引用字段的模板。｜会诊等业务选择可引用的护理记录模板时调用。",
    "getRisOrderList": "按检查类别配置查询患者PACS检查记录。｜护理记录选择和引用检查信息时调用。",
    "getRooms": "病房列表查询。｜护士站选择病房。",
    "getScheduleInfoClient": "查询排班信息（支持按日期批量查询）。｜会诊、急诊查询医生排班用于预约挂号。",
    "getTempData": "按就诊号、日期及项目代码查询；未传项目代码时默认查询腋温、口温、肛温。｜查看患者指定日期范围的体温或指定体征历史记录时调用。",
    "getTransDepRecords": "患者转科记录查询。｜业务页面展示患者转科记录。",
    "getTransDeptPatList": "查询符合条件的转出患者记录。｜医生站诊疗与病历患者列表展示转出患者。",
    "getTransLocList": "单患者转科记录查询。｜电子病历质控管理引用患者转科经历。",
    "getTransLocListAndTime": "转科科室及时间查询。｜查看患者转科经历。",
    "getWardAbbrevNoDeliveryRoom": "批量查询患者原病区简称。｜业务展示原病区简称。",
    "getWardBedPatInfo": "获取病区总床位数、在床人数和等候人数。｜住院证界面展示病区资源情况。",
    "getWardProGroupBeds": "查询病区专业组及各专业组对应床位。｜护士患者列表按专业组或床位展示。",
    "ifDrugNotAudit": "未审核领药状态查询。｜护士站校验患者是否仍有未审核领药。",
    "ifHasNotExecOrder": "未执行医嘱记录判断。｜相关业务办理前检查是否仍有未执行记录。",
    "ifHospNeedAppByWard": "判断病区所属院区是否启用床位预约。｜住院登记前确定是否需要校验床位预约。",
    "ifNursePlanNotStop": "按当前医院评价配置，查询指定就诊是否存在未评价护理问题或未停止护理计划。｜HIS 跨工程校验患者护理计划是否完成时调用。",
    "ifPatAppBed": "判断患者是否已预约到床位。｜住院登记或费用业务校验床位预约状态。",
    "ifRegister": "判断患者是否已完成分娩登记。｜医生站查询孕产妇分娩登记情况时调用。",
    "ifTransApply": "判断患者是否存在转科申请。｜转科申请及转入转出流程校验。",
    "insertAdmInfo": "校验登记数据、处理就诊时间并插入等候区和转移记录。｜患者办理住院登记。",
    "insuRx": "东软医保处方流转数据查询（处方信息、就诊信息、诊断、处方明细、处方视图）。｜计费、医保结算获取医保处方流转数据。",
    "ipBookCtOrgClient": "通过科室、病区标志查询病区列表。｜计费住院登记界面、住院收费、床管中心选择病区时调用。",
    "ipBookPortalClient": "获取住院证标准数据模型、住院证诊断标准模型、患者有效住院证列表、住院证有效性。｜计费、病历、住院收费、床管中心办理住院登记、退号校验、公众号小程序查询时调用。",
    "ipBookUpdateClient": "住院登记、预住院转住院时更新住院证状态并返回诊断信息，撤销住院证有效状态、撤销日间手术标识。｜住院收费、床管中心办理住院登记、预住院转住院、预入院转门诊时调用。",
    "ipBookUpdateForArClient": "退院时更新住院证状态。｜住院收费、床管中心办理退院时同步住院证状态。",
    "ipBookUpdateForNurseClient": "更新住院证状态（床位预约作废时置为 VOID）。｜床管中心床位预约操作时调用。",
    "ipCareArcimWardAppend": "根据医嘱明细ID获取绑定的病区信息 Map。｜住院护理查询医嘱执行绑定病区。",
    "ipCareOeOrdAppendItemCMClient": "获取草药录入需审核的医嘱项目绑定的医嘱列表并整合插入数据（煎药方式收费、煎药费信息）。｜草药房处理住院草药医嘱附加审核与收费项。",
    "ipCareOeOrdItemCMEntryClient": "住院保存草药医嘱标准接口、修改取药方式。｜草药房接收住院草药医嘱及取药方式变更。",
    "ipCareOeOrdItemEntryClient": "医嘱套维护信息查询、按医嘱套ID获取医嘱套明细。｜临床路径引用医嘱套开立医嘱。",
    "ipappointmentSaveOrUpdateBatch": "批量保存或更新床位预约记录。｜护理床位管理操作同步预约信息。",
    "isBabyBed": "按床位类型代码判断是否婴儿床。｜护士站处理母婴床位规则。",
    "isDead": "患者死亡状态查询。｜业务处理或定时任务检查患者死亡状态。",
    "isMaternalBaby": "母婴同室病区判断。｜护士站按病区执行母婴床位规则。",
    "isTransInPat": "判断患者是否属于转科转入状态。｜转科取消流程增加后校验转入状态。",
    "listMedInfo": "按就诊号和入科至当前的时间范围，读取符合筛选条件的最新护理记录中的意识、呼吸、脉搏、心率、血压和体温。｜急救中心获取患者最新护理观察信息时调用。",
    "oeOrdItemCMDriveComClient": "根据处方号（支持多个）返回煎药费对应的医嘱ID串。｜药房、草药房统计住院草药处方煎药费用时调用。",
    "omitAdverseInterface": "对医嘱、评估单或护理记录按疑似漏报配置进行识别和处理，避免重复生成。｜业务记录形成后触发不良事件疑似漏报检查时调用。",
    "opAllocQueueQueryClient": "获取门诊就诊队列状态的不同时间点。｜基础平台基础功能组件查询门诊就诊排队时间节点。",
    "opCareCheckAllergyOrderCanBeChargeClient": "门诊收费前校验皮试相关医嘱能否结算。｜计费、门诊收费前校验。",
    "opCareExamDealClient": "检查申请相关数据查询（检查报告、申请单明细、各阶段检验数量、报告状态与异常值、退费计费明细）。｜门诊收费查询检查检验进度、处理检查退费时调用。",
    "opCareHRPGetDataClient": "HRP 获取患者、就诊、医嘱信息数据。｜计费、门诊收费为 HRP 系统提供就医数据。",
    "opCareOeOrdAppendItemCMClient": "获取草药录入需审核的医嘱项目绑定的医嘱列表并整合插入数据（煎药方式收费、煎药费信息）。｜草药房处理草药医嘱附加审核与收费项。",
    "opCareOeOrdItemCMEntryClient": "门诊保存草药医嘱标准接口、修改取药方式。｜草药房接收门诊草药医嘱及取药方式变更。",
    "opCareOeOrdItemEntryClient": "门诊保存医嘱标准接口、更新医嘱备注。｜会诊、院前急救、临床手术管理、草药房保存门诊医嘱时调用。",
    "opCareOeOrdItemGetDataForInsuClient": "按药房规则取整处理后回转单次剂量（北京医保专属）。｜医保结算获取门诊医嘱剂量信息。",
    "opCareOrderDurationDriveComClient": "按医嘱明细计算可用天数及可用天数转换系数（北京医保门急诊向下取整）。｜医保结算上传时计算医嘱可用天数。",
    "opCarePaadmextAgencyGetDataForInsuClient": "根据就诊获取代开药（就诊代办人）信息。｜医保结算北京医保上传代开药信息。",
    "opCarePisDealClient": "获取病理申请单明细数据、病理申请打印的标本号。｜护理处理病理申请业务、打印标本号时调用。",
    "opCareStopItemClient": "停止医嘱（提供给计费模块调用）。｜计费、门诊收费在收费流程中停止医嘱。",
    "opDoctorRegistClient": "诊间加号获取排班、诊间加号。｜急诊、院前急救在诊间为患者加号挂号。",
    "opregistBrokerClient": "挂号全流程一体化处理（先诊疗后付费挂号、挂号确认）。｜急诊、门诊收费办理挂号及挂号确认时调用。",
    "opregistClient": "门诊挂号。｜会诊为患者办理门诊挂号时调用。",
    "orderFreqDriveComClient": "根据同频次、不同剂量串获取剂量显示信息。｜护理展示住院医嘱剂量。",
    "paAdmClient": "提供就诊检查、判断、限制相关公共方法。｜病历模块校验就诊时间限制。",
    "prescriptionClient": "获取保密处方、代办人（供应方式）信息，批量查询保密处方。｜会诊、药房获取住院处方相关数据。",
    "pushCdssMsg": "按配置转换生命体征、医嘱执行或护理记录变更数据，通过集成总线推送CDSS。｜业务数据变化后需要同步临床决策支持系统时调用。",
    "queryAdmOtherInfoClient": "查询门诊就诊其他信息（单个、批量）。｜临床手术管理获取门诊就诊扩展信息。",
    "queryIpAdmOtherInfoClient": "查询住院就诊其他信息（单个、批量）。｜临床手术管理获取住院就诊扩展信息。",
    "queryMRDiagnosClient": "获取本次就诊的所有诊断、诊断列表个数及所有 ICD 诊断。｜计费、急诊、病历、护理、医保结算、临床路径等多业务域跨域查询住院诊断。",
    "queryOeOrdClient": "按就诊、医嘱ID查询医嘱列表、主信息、用药信息、草药医嘱记录、重组医嘱、成组医嘱及附加医嘱列表。｜计费、急诊、病历、护理、药房、医保结算等模块查询住院医嘱。",
    "queryOeOrdExecForEmrq": "校验是否存在特殊医嘱项（病历质控执行记录相关）。｜电子病历质控管理调用。",
    "queryOeOrdForNurClient": "护理域专属医嘱查询（皮试相关治疗医嘱、治疗医嘱关联的皮试用医嘱、撤销皮试结果的关联医嘱）。｜护理、住院护理处理皮试相关医嘱。",
    "queryOpcarePrescDiagnosClient": "获取诊断以及关联的处方号。｜药房、医保结算按处方关联查询诊断。",
    "queryPaCardUnitClient": "根据病人ID或登记号查询患者合并日志。｜计费、急诊、病历、药房、临床路径、公共卫生等模块查询患者合并记录。",
    "recorddataSync": "按模板、患者和输入字段新增护理记录，并补充缺省操作人员、院区等信息。｜其他业务数据需要生成护理病历记录时调用。",
    "saveMaternalMedicalInfo": "新增或更新患者孕次、产次主数据。｜分娩管理同步产妇孕次、产次信息时调用。",
    "saveNewEmrData": "接收原始字节请求内容，保存护理单据。｜PDA护理病历录入或修改护理单据时调用。",
    "saveNrOrdExec": "保存医嘱执行扩展信息。｜保存医嘱执行记录时同步护理扩展数据。",
    "saveNrOrdItem": "保存护理医嘱扩展信息。｜医生保存单条医嘱时同步护理扩展数据。",
    "saveObsDataByDay": "按患者、日期保存多项体征或标题数据。｜批量录入、修改某日体征数据时调用。",
    "savePPDResult": "PPD结果保存。｜护士站记录PPD观察结果。",
    "saveVisitNumber": "将标本号、采集人、采集或运送及发送或撤销信息提交给检验标本同步接口。｜检验标本采集、申请前处理、运送或撤销流程保存数据时调用。",
    "schedulePortalClient": "查询排班医生坐诊信息。｜急诊诊疗查询医生坐诊排班。",
    "seeOrderChunks": "批量医嘱处理。｜护士站批量处理医嘱。",
    "selectList": "按患者、需测或需评类型及项目配置计算护理任务。｜HIS 跨工程展示护理任务总览时调用。",
    "sendOrdCloseLoopMsg": "医嘱闭环消息发送。｜护士站或公共护理组件在执行状态变化后同步闭环事件。",
    "setPdaSkinTestResult": "在护士执行本地事务内保存PDA皮试结果。｜移动护理录入皮试结果。",
    "syncWardPatients": "开启病区患者同步配置时，按医院、科室、病区获取在院及出院患者，并经集成接口推送给亚华系统。｜入院、出院、转科或患者信息变更后调用。",
    "threeCheckList": "护士分床时自动生成三级检诊科室医生患者记录。｜住院护理分床操作时调用。",
    "transToBed": "患者转床。｜护士站办理床位调整。",
    "updateAdmInfo": "修改护理侧就诊登记信息。｜住院登记信息变更。",
    "updateAntUseInfoClient": "保存申请单关联的病历ID（更新抗菌药物使用信息）。｜病历回写病历ID至抗菌药申请单。",
    "updateApplyInfoByConsultClient": "通过会诊结果更新申请状态。｜会诊完成后更新相关申请单。",
    "updateBedapointflag": "更新患者预约床位状态。｜退院修改住院证状态后同步预约状态。",
    "updateIPAppointmentInfo": "更新预约住院记录的入院就诊号和预约状态。｜患者完成住院登记后同步床位预约信息。",
    "updateIpCareMRDiagnosClient": "更新预住院患者诊断日期。｜计费、住院收费、床管中心办理预住院转住院时更新诊断日期。",
    "updateNewbornCoreInfo": "更新新生儿姓名、性别、出生日期，并按出生时间更新入院时间，返回就诊号。｜分娩管理更新新生儿核心就诊资料。",
    "updateOrdGroupChunks": "校验欠费、执行规则及记录状态后，批量更新医嘱执行状态。｜护士站批量执行或撤销执行医嘱时调用。",
    "updateOrderExecClient": "医嘱执行记录维护（执行、撤销、停止执行记录，更新小时医嘱时间、增加备注）及相关权限校验。｜急诊、住院护理维护住院医嘱执行记录。",
    "updateOrderStatusClient": "停止、撤销、作废医嘱，撤销预停、停止虚拟长期，增加备注与执行记录，医技执行及撤销（含权限校验）。｜会诊、住院护理、临床手术管理、草药房、静配中心更新住院医嘱状态。",
    "updateOrderStatusForConsClient": "撤销医嘱（面向会诊域）。｜会诊撤销住院医嘱时调用。",
    "updateOrderStatusForMDTClient": "撤销医嘱（面向 MDT 多学科会诊）。｜会诊 MDT 撤销住院医嘱时调用。",
    "updateOrderStatusForMuspClient": "停止医嘱（面向药房域）。｜草药房、门诊药房停止医嘱时调用。",
    "updateRegistionFeeInvClient": "更新挂号表发票数据、挂号费用全退、结算模式下处理挂号费。｜门诊收费处理挂号收费、退费时调用。",
    "updateSpacer": "按医嘱明细、操作人更新采血相关数据。｜采血采集流程同步采血时间时调用。",
}


def get_feign_interface_desc(feign_short_name: str) -> str:
    """
    获取 Feign 接口的业务描述（来源：腾讯文档《信创版微服务接口清单》）。
    返回: "功能描述｜场景描述" 或空字符串。
    """
    if not feign_short_name:
        return ""
    return FEIGN_INTERFACE_DESC.get(feign_short_name, "")
