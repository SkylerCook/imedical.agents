# 接入与迁移

## 项目接入

框架能力通过既有安装/更新流程分发，见 [更新说明](../../../docs/update-agents.md)。插件初始 available，不因更新而启用。首次接入读取 CapabilityRoot/plugins/bos-plugin/skills/bos-init/SKILL.md。

解析工作区后，使用 CapabilityRoot/scripts/update-plugin-profile.ps1，传入 -ProjectRoot、-ContextRoot、-CapabilityRoot、-Plugin bos-plugin、-Status enabled、-InitSkill bos-init。保留其它插件及用户配置；未知同名内容停止覆盖。

再用 CapabilityRoot/scripts/update-agents.ps1 -ProjectRoot <WorkspaceRoot> -Plugin bos-plugin -Mode DryRun -NoPull，检查无冲突后以 -Mode Write -NoPull 生成发现入口，最后 -Mode Check -NoPull。这是目标工程接入操作，不在源仓维护时自动运行。Overlay 共享能力只更新一次，项目配置和 thin-index 写 ContextRoot。无 PowerShell 的宿主可按相同契约定点维护 profile 和四份 thin-index，需逐一验证引用；不声称自动工具已运行。

## 用户级复用

框架是唯一代码维护源，用户级技能引用插件内技能。遵循本机既有 skills-sync/宿主适配流程，先核对来源、链接目标和同名入口，再在获授权的客户端范围切换；不用项目 updater 写用户目录。

若宿主会将技能实体复制且不能解析外部引用，应分发整个插件并生成指向该安装位置的薄入口，不只复制 SKILL.md。本地补录还调用同一能力包内 demand-delivery-plugin；分发补录能力时须保留该同级插件及根 scripts/lib，纯查询的个人入口不依赖提交能力。目录链接依赖真实插件布局；查验脚本与 references 可访问，并通过新进程的 defaults 验证配置定位，再按授权测试真实查询。链接成功不等于运行中宿主刷新。

个人配置通过 BOS_MCP_CONFIG 显式指定；0.4.0 只接受按 skill 分段的共享文件。旧平铺配置须明确运行 migrate-config 原地转换，未识别的包装人工核对，详见 usage.md。不兼容旧版“代码目录向上找 local”的隐式配置：切换前配置环境变量，再验收。保护旧有效入口直到新入口验证完成；未知定制不覆盖，不清理共享缓存。

普通框架更新不自动修改用户级链接、私有配置或业务工程；明确迁移请求可按上述步骤执行。Windows/macOS/Linux 及各宿主实际发现分别取证。

## 公司推广与更新

组织统一发布框架版本及接入说明，每位使用者安装该版本、选择仓外个人配置路径（Windows 默认 LOCALAPPDATA），按 [个人配置](usage.md)初始化；不复制他人私有 JSON。每个工程独立选择是否启用插件，个人查询也可只使用用户级入口。

项目通过既有框架更新流程更新插件，保留个人配置；用户级入口引用本机框架安装目录，更新该目录即可获取技能变化。使用薄入口时必须解析 canonical SKILL.md 的真实目录再定位脚本。只复制技能子目录会破坏插件相对引用。保持一个同名发现入口，已有目录先比对，不覆盖未知定制。

维护者直接修改框架，运行查询、配置和发现回归，递增插件版本后按授权发布。不同电脑不依赖维护者本机路径；旧自建版本的来源与适配见 [来源登记](origin.md)。验收使用全新进程分别验证配置、入口引用和真实宿主加载；真实 BOS 查询须另有查询授权。
