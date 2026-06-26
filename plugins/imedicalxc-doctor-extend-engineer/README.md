# imedicalxc-doctor-extend-engineer

HIS 医生站第三方系统集成能力包，提供从需求头脑风暴到 CI/CD 交付的完整 10 步工作流。

## 能力范围

- 第三方系统集成的全流程编排
- 医生站组与医院信息平台组的范围拆分
- 中间件入口识别与前端契约提取
- HIS 架构约束与代码组织
- BLH / DriverCom 分层开发规范
- 医保/字典数据复用规范
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
3. 运行根 `scripts/generate-plugin-thin-index.ps1` 生成 `.agents/skills/` 浅层索引。

## 依赖的 Vendor 资产

本插件引用以下 vendor 资产，与 `vendor/hisui/` 采用相同管理模式：

- `vendor/word-reader/`：读取 Word 格式接口文档

此外，本插件工作流依赖 superpowers 技能集：`brainstorming`、`writing-plans`、`subagent-driven-development`、`finishing-a-development-branch`。这些 skill 由用户自行安装到运行时的 skill 发现目录；`skills/imedicalxc-doctor-extend-engineer/SKILL.md` 会在工作流启动前检测其可用性，缺失时输出安装指引。

## 接入目标工程

1. 将本插件放入 `.agents/plugins/imedicalxc-doctor-extend-engineer/`。
2. 确保 `.agents/vendor/word-reader/` 已同步到目标工程。
3. 确保运行时已安装 superpowers 技能集。
4. 运行 thin-index dry-run，确认无冲突后再 write。
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
