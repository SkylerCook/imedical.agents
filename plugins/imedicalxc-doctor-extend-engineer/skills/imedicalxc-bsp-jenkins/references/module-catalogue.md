# Module Catalogue

## 1. 前端 / 静态资源

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `hisfront` | HIS 前端主工程（HISUI + jQuery + EasyUI） | Freestyle | success |
| `his-hos-app-web` | HOS 应用 Web 端 | Freestyle | success |
| `hisfront-guangxi` | 广西版本前端 | Freestyle | success |
| `hisfront-usermeeting` | 用户会议版前端 | Freestyle | success |
| `clart-front` | 临床艺术前端 | Freestyle | success |
| `lisfront-docker` | LIS 前端 Docker 镜像 | Freestyle | success |
| `pisfront-docker` | PIS 前端 Docker 镜像 | Freestyle | success |
| `ekg-front-web` | 心电图前端 Web | Freestyle | success |

## 2. 临床诊疗（医生站组核心）

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `opcare-mediway-boot` | 门诊临床诊疗（门诊医生工作站） | Maven | success |
| `ipcare-mediway-boot` | 住院临床诊疗（住院医生工作站） | Maven | success |
| `aggcare-mediway-boot` | 门诊与住院综合诊疗服务 | Maven | success |
| `aggregation-mediway-boot` | 聚合服务网关 | Maven | success |
| `opemr-mediway-boot` | 门诊电子病历 | Maven | success |
| `ipemr-mediway-boot` | 住院电子病历 | Maven | success |
| `ipnemr-mediway-boot` | 住院护理电子病历 | Maven | success |
| `emnemr-mediway-boot` | 急诊护理电子病历 | Maven | not_built |
| `ememr-mediway-boot` | 急诊电子病历 | Maven | success |
| `emrq-mediway-boot` | 急诊请求/病程 | Maven | success |
| `emoc-mediway` | 急诊观察室 | Maven | not_built |
| `emcare-mediway-boot` | 急诊诊疗核心 | Maven | success |
| `emtr-mediway-boot` | 急诊转运 | Maven | not_built |
| `curc-mediway-boot` | 治疗工作站系统 | Maven | success |

## 3. 医嘱与诊断（公共核心）

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `comoe-mediway` | 电子医嘱系统核心（Common Order Entry） | Maven | success |
| `cfoe-mediway` | 电子医嘱系统配置 | Maven | not_built |
| `commr-mediway` | 电子诊断系统核心（Common Medical Record） | Maven | aborted |
| `cfmr-mediway` | 电子诊断系统配置 | Maven | not_built |
| `cfemr-mediway` | 电子病历配置 | Maven | success |
| `comcons-mediway` | 公共会诊 | Maven | success |
| `comemr-mediway` | 公共电子病历 | Maven | success |

## 4. 患者管理与就诊流程

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `hispa-mediway-boot` | 患者主索引管理（EMPI） | Maven | success |
| `opreg-mediway-boot` | 门诊挂号预约管理 | Maven | success |
| `opalloc-mediway-boot` | 分诊排队与资源分配 | Maven | success |
| `peis-mediway-boot` | 体检系统 | Maven | success |
| `cons-mediway-boot` | 会诊管理 | Maven | success |

## 5. 护理组

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `ipnur-mediway-boot` | 住院护理 | Maven | success |
| `emnur-mediway-boot` | 急诊护理 | Maven | success |
| `comnur-mediway` | 公共护理模块 | Maven | success |
| `nurm-mediway-boot` | 护理管理 | Maven | success |
| `nurse-management` | 护理管理前端/综合 | Maven | not_built |

## 6. 药房组

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `phop-mediway-boot` | 门诊药房 | Maven | success |
| `phip-mediway-boot` | 住院药房 | Maven | success |
| `phopca-mediway-boot` | 门诊药房发药 | Maven | success |
| `phipca-mediway-boot` | 住院药房发药 | Maven | success |
| `phm-mediway-boot` | 药房管理 | Maven | success |
| `phkm-mediway-boot` | 药房库房 | Maven | success |
| `phherb-mediway-boot` | 草药房 | Maven | success |
| `phnarc-mediway-boot` | 麻醉/精神药品药房 | Maven | success |
| `phprev-mediway-boot` | 处方前置审核 | Maven | success |
| `phpreadt-mediway-boot` | 处方预审核 | Maven | success |
| `phpiva-mediway-boot` | 静脉用药调配中心(PIVAS) | Maven | success |
| `comcph-mediway-boot` | 公共药房 Boot | Maven | success |
| `comph-mediway` | 公共药房核心 | Maven | success |
| `ph-mediway-boot` | 药房主服务（未构建） | Maven | not_built |
| `phdec-mediway-boot` | 药房决策（未构建） | Maven | not_built |
| `phdum-mediway-boot` | 药房 dummy（未构建） | Maven | not_built |
| `phface-mediway-boot` | 药房 face（未构建） | Maven | not_built |
| `phin-mediway-boot` | 药房入库（未构建） | Maven | not_built |
| `phpaud-mediway-boot` | 药房审计（未构建） | Maven | not_built |

## 7. 检验与医技 (LIS / PACS)

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `lab-mediway-boot` | 检验实验室 | Maven | success |
| `lis-base-mediway-boot` | LIS 基础服务 | Maven | success |
| `liscommon-mediway` | LIS 公共模块（未构建） | Maven | not_built |
| `liscore-mediway` | LIS 核心模块（未构建） | Maven | not_built |
| `pacs-client` | PACS 影像客户端 | Maven | success |
| `pacs-server` | PACS 影像服务端 | Maven | success |
| `pacs-client-plugins` | PACS 客户端插件（未构建） | Maven | not_built |
| `cts-mediway-boot` | 医技传输系统 | Maven | success |
| `mic-mediway-boot` | 微生物系统 | Maven | success |
| `lqm-mediway-boot` | 检验质量管理 | Maven | success |
| `lqs-mediway-boot` | 检验质量系统 | Maven | success |
| `rmis-mediway-boot` | 放射信息管理系统 | Maven | success |

## 8. 收费与财务 (AR)

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `ar-mediway-boot` | 收费管理/应收管理 | Maven | success |
| `ar_Pipeline` | 收费组构建流水线 | Pipeline | success |
| `ar_流水线` | 收费组旧流水线（已废弃） | Pipeline | aborted |

## 9. 物资供应 (MSUP)

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `msup-pipeline` | 物资供应主流水线 | Pipeline | success |
| `msupPipeline_custom` | 物资供应自定义流水线 | Pipeline | success |
| `cssd-mediway-boot` | 消毒供应中心（未构建） | Maven | not_built |

## 10. 病案、质控与医务

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `mr-mediway-boot` | 病案管理 | Maven | success |
| `mrfs-mediway-boot` | 病案随访 | Maven | success |
| `cpw-mediway-boot` | 临床路径管理 | Maven | success |
| `ma-mediway-boot` | 医务管理 | Maven | success |
| `hai-mediway-boot` | 医院感染管理 | Maven | success |
| `drgdip-app` | DRG/DIP 应用 | Maven | success |
| `drgdip-cqc` | DRG/DIP 质控 | Maven | success |
| `drgdip-drgpa` | DRG/DIP 分组器 PA | Maven | success |
| `drgdip-es` | DRG/DIP 搜索引擎 | Maven | success |
| `drgdip-grouper` | DRG/DIP 分组器 | Maven | success |
| `drgdip-grouper-cn` | DRG/DIP 分组器-国版 | Maven | success |
| `drgdip-grouper-dip` | DRG/DIP 分组器-DIP | Maven | success |
| `drgdip-upload` | DRG/DIP 上报 | Maven | success |
| `drgdip-web` | DRG/DIP Web 端 | Maven | success |

## 11. 基础框架与公共配置

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `his-mediway-parent` | 父 POM（带 `BRANCH_NAME` 参数） | Maven | success |
| `hisbase-mediway` | 基础框架和公共工具 | Maven | success |
| `hiscf-mediway-boot` | 临床基础配置 Boot | Maven | success |
| `hiscfsv-mediway` | 临床基础配置服务 | Maven | success |
| `hisct-mediway-boot` | 临床术语与编码 | Maven | success |
| `hisctsv-mediway` | 临床术语服务 | Maven | success |
| `hiscore-mediway-boot` | 核心服务 Boot | Maven | success |
| `hisbsp-mediway-boot` | BSP 基础平台 | Maven | success |
| `hisca-mediway-boot` | CA 电子认证 | Maven | success |
| `hisihd-mediway-boot` | 交互健康文档 | Maven | success |
| `hissyscf-mediway-boot` | 系统配置服务 | Maven | success |
| `build-scripts` | 构建脚本工具 | Freestyle | success |

## 12. 手术与麻醉

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `ipor-mediway-boot` | 住院手术/手术室管理 | Maven | success |
| `opar-api` | 门诊手术 API | Maven | success |

## 13. 医保与第三方接口

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `insu-province-client-runner` | 医保省客户端运行器 | Maven | success |
| `insu-province-client-流水线` | 医保省客户端流水线 | Pipeline | success |
| `thirdparty-mediway-boot` | 第三方系统接入（未构建） | Maven | not_built |

## 14. 运维与定时任务

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `restart-all-hisapps` | 重启所有 HIS 应用 | Freestyle | success |
| `job-mediway-boot` | 定时任务调度 Boot | Maven | success |
| `job-mediway-boot-usermeeting` | 用户会议版定时任务 | Maven | success |
| `scheduledTasks-boot` | 计划任务 Boot | Maven | success |
| `selfserviceprint-boot` | 自助打印服务 Boot | Maven | success |
| `managecenter-gateway` | 管理中心网关（未构建） | Maven | not_built |
| `meta-mediway-boot` | 元数据服务（未构建） | Maven | not_built |
| `initlizer-his-import-nacos` | Nacos 配置导入初始化（未构建） | Freestyle | not_built |

## 15. 报表系统

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `runqian-report-ar` | 润乾报表-收费组 | Freestyle | success |
| `runqian-report-msup` | 润乾报表-物资供应 | Freestyle | success |

## 16. 其他业务模块

| Job 名称 | 模块说明 | 构建类型 | 状态 |
|----------|---------|---------|------|
| `his-mediway-boot` | HIS 统一运行入口 | Maven | success |
| `his-mediway-boot-guangxi` | 广西版本 HIS | Maven | success |
| `his-mediway-boot-usermeeting` | 用户会议版 HIS | Maven | success |
| `copilot-mediway-boot` | 智能 Copilot 助手 | Maven | success |
| `doctor-custorm` | 医生站定制化 | Freestyle | success |
| `bis-mediway-boot` | 商业智能/运营分析 | Maven | success |
| `bqs-mediway-boot` | 病区综合管理 | Maven | success |
| `ipbmc-mediway-boot` | 住院 BMC | Maven | success |
| `mchs-mediway-boot` | 母婴健康系统 | Maven | success |
| `pis-mediway-boot` | 患者信息系统(PIS) | Maven | success |
| `pis-job-mediway-boot` | PIS 定时任务 | Maven | success |
| `rps-app` / `rps-mediway-boot` | 预约系统（未构建） | Maven | not_built |
| `clan-mediway-boot-yhdh` | 临床艺术-宇航大华 | Maven | failure |
| `clart-mediway-boot` | 临床艺术后端 | Maven | failure |
| `imedical-project` | iMedical 项目总包（未构建） | Maven | not_built |
| `test` | 测试占位任务（未构建） | Freestyle | not_built |

## 模块名与业务域速查表

| 前缀/关键词 | 业务域 |
|------------|--------|
| `op*` | 门诊 |
| `ip*` | 住院 |
| `agg*` / `aggregation*` | 综合/聚合 |
| `em*` / `emr*` | 急诊 / 电子病历 |
| `nur*` | 护理 |
| `ph*` / `cph*` / `comph*` | 药房 |
| `lab*` / `lis*` | 检验 (LIS) |
| `pacs*` / `rmis*` | 影像 / 放射 |
| `ar*` | 收费/应收 |
| `msup*` | 物资供应 |
| `mr*` / `mrfs*` / `cpw*` | 病案 / 随访 / 临床路径 |
| `ma*` / `hai*` | 医务管理 / 院感 |
| `hispa*` | 患者主索引 |
| `opreg*` / `opalloc*` | 挂号 / 分诊 |
| `hisbase*` / `hiscf*` / `hisct*` | 基础框架 / 配置 / 术语 |
| `drgdip*` | DRG/DIP 医保付费 |
| `insu*` | 医保接口 |
| `hisfront*` / `*-front*` | 前端静态资源 |
| `*-runner` | 可独立运行的 Spring Boot 启动模块 |
