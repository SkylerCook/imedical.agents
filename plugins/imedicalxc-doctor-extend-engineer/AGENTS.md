# iMedicalXC Doctor Extend Engineer

`imedicalxc-doctor-extend-engineer` 是 HIS 医生站第三方系统集成的全流程编排插件，覆盖需求头脑风暴 → 设计 → 实施 → 测试 → HIS 域验证 → CI/CD 交付的完整工作流。

## 插件定位

- 只承载医生站第三方集成的可复用流程和领域知识。
- 目标工程差异、连接信息、敏感配置必须写入目标工程本地文件，不硬编码在插件中。
- 编排器本身不包含 HIS 领域规则，所有领域知识按需从子 skill 加载。

## 使用约束

- 不在插件中硬编码服务器地址、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。
- 涉及项目差异时读取目标工程 `.agents/config/` 下的 project profile。
- 涉及 MCP、上传、编译、远程读取或只读 SQL 验证时读取目标工程 `.mcp.json`。
- 默认只做本地修改、只读验证和报告；上传、编译、远程写入、数据库变更必须由用户明确要求。

## Skill 路由

- 全流程编排入口：`skills/imedicalxc-doctor-extend-engineer/SKILL.md`
- 架构约束与代码组织：`skills/imedicalxc-doctor-extend-architecture/SKILL.md`
- 团队归属与范围分析：`skills/imedicalxc-doctor-extend-scope/SKILL.md`
- 数据格式与 XML/JSON 生成：`skills/imedicalxc-doctor-extend-dataformat/SKILL.md`
- BLH 编写规范：`skills/imedicalxc-doctor-blh/SKILL.md`
- 调用与接口规范：`skills/imedicalxc-doctor-invoke/SKILL.md`
- 医保/字典数据规范：`skills/imedicalxc-doctor-dbdata/SKILL.md`
- WebSysAddins 中间件开发：`skills/imedical-bsp-websysaddins/SKILL.md`
- Jenkins CI/CD 验证：`skills/imedicalxc-bsp-jenkins/SKILL.md`

普通第三方集成需求优先使用 `imedicalxc-doctor-extend-engineer` 统一入口，由编排器按步骤加载上述子 skill。

## 规则与参考入口

- 架构约束：`skills/imedicalxc-doctor-extend-architecture/references/domain-constraints.md`
- BLH 审查清单：`skills/imedicalxc-doctor-blh/references/blh-review-checklist.md`
- 命名约定：`skills/imedicalxc-doctor-blh/references/naming-conventions.md`

## 内置脚本

- `scripts/install-deps.py`：多模块 Maven 依赖安装脚本，按依赖拓扑序安装 `com.mediway.his` 传递依赖。

## 依赖的 Vendor 资产

本插件依赖以下 vendor 资产，部署时需确保它存在于 `.agents/vendor/`：

- `vendor/word-reader/`：用于读取 Word 格式接口文档（如厂商提供的 `.docx`/`.doc` 规格说明书）

此外，本插件工作流依赖 superpowers 技能集（`brainstorming`、`writing-plans`、`subagent-driven-development`、`finishing-a-development-branch`）。这些 skill 由用户自行安装到运行时的 skill 发现目录；`skills/imedicalxc-doctor-extend-engineer/SKILL.md` 会在工作流启动前检测其可用性，缺失时输出安装指引。
