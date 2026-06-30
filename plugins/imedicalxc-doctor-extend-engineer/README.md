# imedicalxc-doctor-extend-engineer

HIS 医生站第三方系统集成能力包，提供从需求头脑风暴到 CI/CD 交付的完整 10 步工作流。

## 能力范围

- 第三方系统集成的全流程编排
- 医生站组与医院信息平台组的范围拆分
- 中间件入口识别与前端契约提取
- HIS 架构约束与代码组织
- BLH / DriverCom 分层开发规范
- 医保/字典数据复用规范；`imedicalxc-doctor-dbdata` 已精简为数据库查询核心规范，重点覆盖医保对照、基础数据统一对照和合并查询。
- WebSysAddins（DLL/OCX/ActiveX）中间件开发
- Jenkins CI/CD 构建验证

## 标准目录

```text
imedicalxc-doctor-extend-engineer/
|-- .agents-plugin/
|   `-- plugin.json
|-- AGENTS.md
|-- README.md
|-- scripts/
|   `-- install-deps.py
`-- skills/
    |-- imedical-bsp-websysaddins/
    |-- imedicalxc-bsp-jenkins/
    |-- imedicalxc-doctor-blh/
    |-- imedicalxc-doctor-dbdata/
    |-- imedicalxc-doctor-extend-architecture/
    |-- imedicalxc-doctor-extend-dataformat/
    |-- imedicalxc-doctor-extend-engineer/
    |-- imedicalxc-doctor-extend-scope/
    `-- imedicalxc-doctor-invoke/
```

## 安装模式

默认使用 `plugin-reference-thin-index`：

1. 将本插件放到目标工程 `.agents/plugins/imedicalxc-doctor-extend-engineer/`。
2. 首次初始化时直接读取 `.agents/plugins/imedicalxc-doctor-extend-engineer/skills/imedicalxc-doctor-extend-engineer/SKILL.md`。
3. 运行插件 wrapper `scripts/generate-plugin-thin-index.ps1`，它会转发到根 `scripts/generate-plugin-thin-index.ps1`。
4. wrapper 默认只生成 `.agents/skills/imedicalxc-doctor-extend-engineer/SKILL.md` 主编排器浅层索引；8 个子 skill 不单独暴露，由主编排器按需读取。

## 依赖的 Vendor 资产

本插件引用以下 vendor 资产，与 `vendor/hisui/` 采用相同管理模式：

- `vendor/word-reader/`：读取 Word 格式接口文档。
- `vendor/superpowers/`：提供 `brainstorming`、`writing-plans`、`subagent-driven-development`、`finishing-a-development-branch` 等流程 skill。

这些 vendor 资产随 `/vendor/**` 部署到目标工程 `.agents/vendor/`。安装和更新流程会调用 `scripts/sync-vendor-skills.ps1`，把带 `SKILL.md` 的 vendor skill 同步到运行时 skill 发现目录；若运行时仍缺失 superpowers，按 `.agents/docs/update-agents.md` 的 vendor skill 同步和停止条件处理。

## 接入目标工程

1. 将本插件放入 `.agents/plugins/imedicalxc-doctor-extend-engineer/`。
2. 确保 `.agents/vendor/word-reader/` 和 `.agents/vendor/superpowers/` 已同步到目标工程。
3. 运行 `.agents/scripts/sync-vendor-skills.ps1 -AgentsRoot .agents -Mode DryRun|Write`，或通过常规 `update-agents.ps1` 完成 vendor skill 同步。
4. 运行 thin-index dry-run，确认只生成主编排器入口且无冲突后再 write。
5. 第三方集成任务优先使用 `imedicalxc-doctor-extend-engineer` 统一入口。

## 去项目化边界

本插件不保存服务器地址、namespace、账号、密码、token、远程路径、业务页面清单、业务类名前缀或项目专属基类。这些内容只能存在于目标工程本地配置中。

## 内置脚本

`scripts/install-deps.py` 是多模块 Maven 项目的依赖安装脚本：

```bash
# 首次全量安装
python .agents/plugins/imedicalxc-doctor-extend-engineer/scripts/install-deps.py <target-artifact-id>

# 增量安装
python .agents/plugins/imedicalxc-doctor-extend-engineer/scripts/install-deps.py <target-artifact-id> --changed-only

# 只看依赖顺序
python .agents/plugins/imedicalxc-doctor-extend-engineer/scripts/install-deps.py <target-artifact-id> --dry-run
```
