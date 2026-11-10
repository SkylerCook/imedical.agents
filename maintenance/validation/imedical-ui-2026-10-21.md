# 公司 UI 规范与适配层验证

日期：2026-10-21；taskKind：framework-maintenance。源仓基线 `a37ea2da39fbe9e385f254a979e7844aa13eaa71`。

## 交付与证据

- imedical-ui 0.1.0：技术栈无关规则、五类场景参考、风格差异及来源目录，提供规范/开发核对与截图/浏览器评审两个日常skill、一个纯init及一条共性rule。
- iris-ui 0.2.0：正式依赖imedical-ui 0.1.x和coding-iris-plugin 0.20.x，定位为IRIS CSP＋HISUI落地。主skill与frontend直接读rule均走同一依赖边界；既有编码owner无需改版。
- 本期IHOS海蓝13画板、PURE控件3/布局14画板，共30画板；PDF、包manifest、画板data.js和整板preview.png共64个原文件，61.62MiB。逐字节保留，来源摘要及PNG/画板口径可回查；未收录其它配色或完整查看器。
- 原始资料接收已获用户授权，保留公司版权和分发条件。未将资料推公开镜像；本轮没有修改业务源码、全局/模块生产CSS、部署器或更新器实现。

## 实际执行

| 检查 | 结果 | 覆盖和限制 |
|---|---|---|
| `node --test scripts/tests/imedical-ui.tests.js` | 9/9，0跳过 | 64源摘要、30画板/PNG、安全JSON读取、复用GUID、MD引用、无IRIS配置强制、依赖拓扑、双PowerShell薄索引、官方更新器四态 |
| `node --test scripts/tests/iris-ui.tests.js` | 8/8 | 既有只读测量及frontend条件路由/包归属，PS7/PS5.1预演、幂等与自定义内容保护 |
| `node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js` | 1/1 | 部署文档链接及非xc技能/规则目录完整性，非所有维护文档的语义校验 |
| 组件版本工具公开API，限定两UI owner，HEAD→worktree比较 | issues=0 | imedical-ui initial、iris-ui breaking minor及精确授权消费；非全仓发布审计 |
| UTF-8、链接/完整GUID、空白及diff检查 | 通过 | 新增文件与tracked文件同时覆盖；vendor按字节摘要核对 |

本机Node为24.14.1，PowerShell为7.6.6和5.1.26100.9711。专项已加入既有Windows/macOS/Linux×Node22/24 CI，但本轮未取得远端矩阵结果，不宣称非Windows或最低Node已验证。

两个专项的可复用内容指纹见 [验证证据](imedical-ui-2026-10-21-evidence.json)，覆盖实际读取的插件、底稿及框架runtime。它只记录成功测试与受测内容身份，不替代执行或真实部署；源码内容变化后按现有工具重新核对。

官方更新器隔离测试复制当前runtime与小型插件输入，不复制61MiB证据包：对依赖missing、available、disabled，实际确认`plugin-dependency-missing`且不生成iris-ui入口；enabled则生成并核对source映射。测试不以退出0替代状态，未写业务部署态。默认D盘临时根不可写时按既有测试约定回退系统临时目录；全部本任务fixture已独立确认删除。

## 规则可用性试读

一个独立Agent从skill按条件选读规范，对查询/列表及动态申请布局进行源码试读；样本入口一度被描述成查询页，Agent据实际树表结构识别适用条件，未机械套用查询分隔。补正查询组合后，能够应用10px兼容、边界所有权及剩余高度规则，同时识别已有组件适配，无依据重建同类机制。

另对一张PURE标准查询基准原图按review skill试评：保留原型样例身份，未将占位页码、条数和静态悬浮状态判作业务错误；IHOS、运行资源、视口/缩放、真实交互和动态状态列未覆盖。试读反馈已收敛“源码审查/视觉评审”路由，并增加规范图/设计稿/业务运行截图的来源身份确认。

样本量为一个Agent、两个源码场景及一张基准原图；没有对照实验，不推广为通用提效结论。工程源码位置、已有改动与详细差异记录留目标项目，不固化进本源仓。

## 完成边界与后续

本轮证明源仓资料可追溯、入口/依赖可发现、规则能支持上述有限试读。目标工程尚未正式升级这批插件，真实HIS运行、浏览器动态交互、双基准UI评审和用户结论均未由本轮替代。

正式分发继续走共享capability标准更新，再模块`-NoPull`完整刷新及项目验证；已有iris-ui工程先按runbook核对新增依赖的注册/profile集合。显式disabled冲突保留，不手工复制，不自动推送/部署。跨平台、实际宿主与双基准浏览器评审沿现有P2队列补证。
