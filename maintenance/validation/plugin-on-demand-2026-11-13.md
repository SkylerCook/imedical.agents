# Plugin 按需部署实施记录

## 已落地行为

- 新安装以 on-demand 模式取得基础入口；全量既有项目保持 full，显式 migrate 后裁剪。每个 CapabilityRoot 统一 revision，安装、补装、更新和 profile 写入共用本地锁。
- manifest 生成 22 个正式插件的能力目录，维护通用、IRIS、XC（信创）、UI 四组。支持多组选取与 --all --exclude-group xc，反选 XC 展开为 16 个插件。基础入口被排除或传递必需依赖被排除时返回完整链路、版本约束和声明位置。
- 首次初始化集中确认自动补装偏好。ensure 获取依赖与资源并返回初始化技能，保持 available；领域配置验收后，按需 profile 工具检查正文、强依赖及自定义冲突，自动生成并验证发现入口后记录 enabled。停用移除受管入口，保留物理包和自定义内容。
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

## 0.11.1 审计修复验证

- 按根 AGENTS 首要原则收束用户操作：按需启用复用既有生成器完成预检、写入与读回，无新参数、状态或用户准备步骤。full 模式仍允许先注册再通过 updater 生成入口。
- 保留当前成员完整历史；当前 profile 缺失时 ensure 只补物理资源，不创建替代 profile，裁剪保持停止。plan、memberRoots、register 及离线判断统一目录身份；Windows 大小写变体按同一成员处理，其它平台保持大小写敏感。
- `plugin-profile-enablement.tests.js` 在 PS5.1/PS7 共 8 项通过，真实 BOS/UI 源资料覆盖接入、幂等、停用恢复、full 兼容、依赖未就绪、自定义冲突、生成器缺失及读回失败不启用。专用夹具无 Git/网络依赖。
- `plugin-deployment-member-history.tests.js` 14 项通过，覆盖 standard/Overlay 的计划、执行前阻断、连续 ensure 后裁剪/刷新、profile 恢复、新成员、其它离线成员和 Windows 路径大小写。使用真实文件、锁、状态及 plan/apply 流程，替换 Git transport 与 sparse materialization；前版对照在最初 9 项中有 8 项失败。
- 最终部署 19 项、成员历史 14 项与双宿主启用 8 项共 41 项在沙箱外通过；另有 sparse 20 项通过。实际 Git/partial clone 路径覆盖 PS5.1/PS7 安装、按需自动生成入口、停用冲突、Overlay 并集和更新。沙箱内 Git `sh.exe` 访问限制沿原证据区分，不计为功能失败。
- 两份新增专项已纳入现有 Windows/macOS/Linux × Node22/24 CI。能力目录检查、项目链接及差异检查通过。工作树组件校验识别 agent-context-kit 0.11.0→0.11.1，未发现本轮新增问题；整体仍受已登记 xc 历史问题影响。
- 本机验证与真实业务副本、宿主发现及远端矩阵分别验收；业务升级同时取得插件与根 scripts，无配置迁移或旧文件清理。本任务夹具及版本检查临时证据随测试清理。

## 0.11.2 首要原则复审修复

- 复审确认 0.11.1 未覆盖单插件启用的全局清理副作用、ensure 后 setter 重建 profile、普通 conflict 回执及无 initSkill 入口。保留当时测试记录，修复以跨入口实际行为验收。
- 根生成器不再凭 source 未落盘跨 owner 清理。仅当前 owner 声明的 legacyNames 迁移及 pure-init 兼容入口，在可证明未定制时清理；未知正文、字段、文件/目录冲突和链接保留，删除前重读。规则、技能及 ContextRoot 根链接均覆盖。
- 安装状态中的 lastRequired 是资源闭包，不是历史启用状态。共用读取逻辑识别缺行历史，所有 profile 写入入口省略这批默认 available 行，明确操作仅更新指定状态。部分 profile 可正常更新和裁剪无关资源，未知资源继续保留；明确 enabled 的依赖校验与历史资源闭包分别计算。旧 profile 的 BOM、缩进、反引号键与 notes 保留语义对齐。
- setter 检查生成、冲突、未知/异常输出及读回结果；updater 同样识别普通 conflict，最终成功前不写 profile。合法无 rules/skills 的 owner 保持可用。初始化 source 始终相对 owner：无 initSkill 时解析插件 entry；真实 general 组合逐一校验源文件可读。
- PS5.1/PS7 完整 `update-agents.tests.ps1` 均通过。修正旧 fixture 漏复制的既有部署运行文件及不符合新保护边界的清理断言；未通过放宽生产门禁让旧断言成功。PS5.1 子进程沿既有惯例去除继承的 PS7 模块路径，不修改全局环境。
- 单 owner 专项双宿主 12 项、根链接补测 2 项、thin-index refresh 双宿主及 owner 迁移定向 5 项通过。最终部署、成员历史、启用、真实恢复、初始化 source 和单 owner 共 69 项：合并运行通过 68 项，余下 Overlay 旧夹具以空 profile 表示释放的断言修正后定向通过；同一用例实际验证空 profile 保留、明确 available 后可裁剪、其它成员继续保留及重新注册补装。生产实现保持不变。
- 真实 Git 恢复专项覆盖 PS5.1/PS7 × standard/Overlay 的 ensure → setter → 普通 Write updater → 实际 prune/sparse，并验证明确状态及失败时 profile 字节保护。能力目录、项目链接和差异检查通过。组件工作树校验识别 0.11.1 → 0.11.2，无本轮新增问题；整体仍报告已登记的 xc 内部独立版本及三份历史 release commit 缺失/无效共 7 项。
- 新专项沿既有 Windows/macOS/Linux × Node22/24 CI 接入；真实 CI 与业务宿主发现仍待取得证据。更新同时取得 agent-context-kit 0.11.2 与根 scripts，无新增用户参数、配置或状态字段，无业务资料清理。
