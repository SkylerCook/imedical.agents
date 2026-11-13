# Plugin 按需部署实施记录

## 已落地行为

- 新安装以 on-demand 模式取得基础入口；全量既有项目保持 full，显式 migrate 后裁剪。每个 CapabilityRoot 统一 revision，安装、补装、更新和 profile 写入共用本地锁。
- manifest 生成 22 个正式插件的能力目录，维护通用、IRIS、XC（信创）、UI 四组。支持多组选取与 --all --exclude-group xc，反选 XC 展开为 16 个插件。基础入口被排除或传递必需依赖被排除时返回完整链路、版本约束和声明位置。
- 首次初始化集中确认自动补装偏好。ensure 获取依赖与资源并返回初始化技能，保持 available；按需模式只有已取得正文、发现入口验证通过且必需依赖已 enabled 才允许启用。停用移除受管入口，保留物理包和自定义内容。
- runtimeResources 与 required skillDependencies 参与 vendor 选择，optional skill 由任务显式选择。公司向量库保持独立选装。知识查询在没有对应资料时返回 knowledge-sources-not-installed。
- Overlay 初始化和 Write 更新登记当前成员；共享 root 保留所有已知项目需求。旧 Overlay 迁移显式提供关联工程清单，暂时离线或丢失已知 profile 的成员保留资源并阻止裁剪。
- 中断阶段记录在 Git 本地安装状态，可恢复下载；锁恢复只处理已确认退出的持有进程。未选插件 blob 在支持 filter 的测试远端保持缺失。

## 验证

- 部署专项 18 项通过，覆盖正选反选、声明和完整依赖链、真实 PS5.1/PS7 安装器、初始化和停用、自定义入口、vendor、真实 Overlay、多成员并集、版本依赖、并发锁、离线失败续接、更新新增依赖、独立向量选装及 BOM/换行兼容。
- 共享 sparse 专项 20 项通过，含 Windows PowerShell 5.1/7 bootstrap、完整 HISUI 字节校验及旧 checkout 收敛。
- Windows PowerShell 5.1 和 PowerShell 7 的 update-agents 完整回归通过。旧全量 profile 先登记后生成入口的路径保留，新就绪检查限定在 on-demand 模式。
- 知识检索与配置 24 项通过，知识库分发专项通过。
- 目录生成检查、脚本语法、部署文档链接及 diff 检查通过。全量组件版本审计仍报告既有 xc 内部 skill version 与旧 release commit 问题，沿既有治理队列处理。

专项测试从源仓复制当前实现到隔离仓库，通过 file 协议 partial clone 执行，并在结束时清理本任务夹具。真实业务工程和 Agent 宿主的最终加载尚待指定项目验证。

## 版本与接续

owner 版本为 agent-context-kit 0.10.0、coding 0.30.1、i18n 0.3.13、imedical-ui 0.2.1、iris-cure-form-dev 0.8.12、xc extend 1.0.6、xc performance 1.0.3。xc 本轮只增加依赖资源声明及对应版本，领域能力的既有暂缓事项继续保留。

Windows/macOS/Linux × Node22/24 已接入现有 CI，远端矩阵结果仍待实际运行。提交、推送与具体业务副本迁移沿后续授权执行。使用入口见[按需部署指南](../../docs/guides/plugin-deployment.md)。
