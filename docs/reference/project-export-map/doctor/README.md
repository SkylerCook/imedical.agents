# Doctor 版本导出清单

本目录保存经审查的版本 ProjectItem XML，供限定服务器源码或 XML 包的对象范围。清单不含历史源码，也不保证指定实例具备全部条目。实际内容来自本次确认实例的当前状态。

## 版本列表

| 版本 | 文件 | 项目名 | 范围 | 导出时间 |
|------|------|--------|------|----------|
| v8.4 | [prj_v8.4.xml](prj_v8.4.xml) | DHCDOC_PRJ | 医生站 | 2026-06-11 12:51:57 |
| v8.5 | [prj_v8.5.xml](prj_v8.5.xml) | DHCDOC_PRJ | 医生站 | 2026-06-11 13:04:25 |
| v9.0 | [prj_v9.0.xml](prj_v9.0.xml) | DHCDOC_PRJ | 医生站 | 2026-06-11 13:06:50 |
| v9.1 | [prj_v9.1.xml](prj_v9.1.xml) | DOCTOR_PRJ | 医生站 | 2026-05-12 08:26:23 |
| v9.2 | [prj_v9.2.xml](prj_v9.2.xml) | IMEDICAL_PRJ | 全仓 10 个产品 | 2026-10-26 17:31:03 |

## 来源与口径

- v8.4～v9.1 来自医生站实例工程及原有版本资料；v9.2 是离线扫描来源 checkout 生成的全仓清单。版本标签与生成时刻不是服务器当前版本证明，现有 XML 保持其原始资产身份，不重新生成冒充同一版本。
- CLS／MAC／INC 等对象由类型表达扩展名，Web 项沿 Studio 的 CSP 分类。v9.2 按 Class 声明取真实类名，既有版本的目录换算差异在比较时解释，不据名称自动认定删除。
- 没有对应版本时，明确核对备选清单和实际所需范围；不自动按较高版本扩张导出范围。项目增补条目和当前实例私有内容留目标工程，不自动发布到能力包。

## 使用入口

- [iris-code-baseline](../../../../plugins/coding-iris-plugin/skills/iris-code-baseline/SKILL.md)：离线生成／比较清单，或按清单采集当前实例代码。图片在请求前排除并统计，初始缺失保留完整 partial 报告；纯采集不自动初始化 Git 或提交。
- [iris-xml-export](../../../../plugins/coding-iris-plugin/skills/iris-xml-export/SKILL.md)：Agent 与用户确认准确对象集合后生成可导入 XML 包，支持图片等二进制 Web 资源，逐项核对身份与载荷。
- [项目开发协议](../../../../plugins/coding-iris-plugin/references/project-demand-development.md)：已确认 project＋按需上下文时建立开发基线，日常只刷新需求集合，部署前重新同步。提交与部署分别核对授权。

当前 CLI 从 CapabilityRoot 的 plugins/coding-iris-plugin/scripts/iris-tools/ 定位，参数以 baseline-catalog.js、code-baseline.js 和 xml-export.js 的 --help 为准；不再依赖用户级技能目录或旧 QTZ 导出入口。共享清单变更须另有审查及发布依据，普通采集不会回写本目录。
