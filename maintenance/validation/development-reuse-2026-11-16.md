# 开发复用行为验证记录

## 范围与方法

2026-11-16，由独立验收子 Agent 读取当前共享 execution-guidance、coding/planner/review 角色及 IRIS 三个 coding skill，按 Markdown 入口串行执行小型合成夹具任务。每场景一个样本，验证新流程可执行性；完整宿主自动路由、真实 IRIS 编译仍待验证。

临时目录为本机任务目录 `D:/tmp/Codex/reuse-behavior-20261116-a`。夹具由本次创建，包含公共 JS、旧消费者、重复实现、ObjectScript 公共类。未连接业务系统。工具记录在本次验收会话中。

## 已执行及结果

先执行 `rg -n 'trim|active|admin|Normalize' <fixture>`，读到 common.cjs 第 1–3 行的编码标准化、有效项筛选和带权限删除逻辑，以及 Common.cls 第 3 行 Normalize。修改后运行 `node <fixture>/test.cjs`，8 条 assert 均通过，再搜索实际消费者核对调用。

| 场景 | 实际行为与证据 | 验证层级 |
|---|---|---|
| 异名已有能力 | consumer.run 直接引用 common.renderCode，函数身份和输入 ` a ` 输出 `A` 均通过 | JS 运行通过 |
| 可扩展能力 | list 增加 includeInactive 默认 false，legacy.run 原过滤结果保持，新参数返回全部 | JS 新旧消费者通过 |
| 权限与副作用差异 | remove 要求 admin；previewRemoval 仅生成预览结果。无权限删除抛错，预览返回副本，原数组长度保持 | JS 运行通过 |
| 真实缺口 | 已查 common/legacy/duplicate，无 CSV 转义能力，新增 escapeCsv，嵌入引号用例通过 | JS 单边界用例通过 |
| HISUI 能力 | 实际读取 vendor/hisui/dist/js/jquery.hisui.js 第 1439、1446 行，draggable enable/disable 设置 disabled。page.js 使用既有方法 | 源码确认；另以 linkbutton 完成真实浏览器启停交互 |
| 图谱缺失 | 隔离目录未建图谱，使用 rg 和源码完成上述 JS 实现 | 无图谱流程通过，过期图谱分支未实测 |
| 共用能力规划 | 两个消费者都指向 common.renderCode，规划公共模块由 coding owner 维护，消费者依赖该接口 | 单 Agent 规划及调用确认，实际并发未测 |
| 新文件重复实现 | 按 review-agent 只读比较 duplicate.cjs:1 与 common.cjs:1，表达式及契约相同。建议直接引用 common.renderCode，避免后续规则更新遗漏一处 | 语义审查通过 |

IRIS 综合入口完成前后端分流，后端直入以 Page.cls 调用 Fixture.Common.Normalize，前端直入按真实 HISUI 源码选择已有 API。补验阶段建立隔离 offline 配置、standard/UTF-8 profile、HISUI 与 ES5 声明，并将 iris-ui/i18n 显式 disabled。实际读取项目 AGENTS、profile、plugin profile、规则索引、通用规则、前后端专项规则及两份格式规范，UI 与 i18n 前后检查沿 disabled 分支处理。前端 encoding check 在后续修正前后均 ready-to-edit，node --check 通过；CLS 检查首次提示分隔空行，修正后 issues 为空。原夹具首次编辑早于 profile 建立，补验只证明后续本地链路，不能追认首次编辑已通过门禁。完整人工离线交付的 Prepare/Pack/Verify 未执行。

## 独立审查

检查主 Agent 新增共享章节与各入口指针，覆盖触发、候选判断、停止条件、无图谱降级、串行执行和评审证据。未发现明确功能矛盾。建议将 skill 的触发指针与修改前步骤就近放置，减少只读到前半部分时漏载的机会。

Review 夹具自身由本验收 Agent 创建，属于预设反例核对；对主 Agent 框架修改的审查具有独立执行者身份。两种证据分别表达。

## 剩余验收

- 真实业务工程及首次冷启动完整入口样本，离线人工材料 Prepare/Pack/Verify。
- HISUI 真实业务页面及其他控件状态仍按项目需求验证。
- 过期图谱、正式并行任务及更多模型/宿主样本。

本记录支持已执行的局部行为，不推断总体重复实现率下降。

## HISUI 浏览器补验

内置 IAB 访问仅绑定 127.0.0.1 的隔离页面，加载仓库真实 jquery-1.11.3.min.js、jquery.hisui.js 和 hisui.css。使用既有 linkbutton enable/disable，正常点击计数 0→1，禁用后点击保持 1，启用后点击变为 2。AX 状态及截图确认可见计数，浏览器 error/warn 日志为空。服务请求记录中 HTML、两份 JS 和 CSS 均 200，favicon.ico 404 不影响功能。临时浏览器已关闭，临时服务 session 2688 已 Ctrl-C 终止。

主 Agent 独立读取夹具 common.cjs 与 duplicate.cjs 后确认两者第 1 行同为 String(value).trim().toUpperCase()，无权限或副作用差异；建议 newCode 直接引用 common.renderCode，并核对函数身份及边界输入，防止标准化规则分叉。主 Agent 未参与夹具实现，此项具有独立 Review 证据。

## 重跑资产与证据边界

种子源码、任务和独立评估标准保存在 [测试夹具](../../scripts/tests/fixtures/development-reuse/tasks.md)。8 条 Node 断言证明夹具运行逻辑，Agent 的实际读取、搜索、修改及评审轨迹是本轮行为证据。每场景样本量 1，未进行模型间对照。

## 结构与部署验证汇总

主 Agent 提供的本轮独立验证结果如下。

- `node scripts/tests/agent-framework-contract.tests.js` 通过。
- `node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js` 通过。
- 全套文档测试沙箱外 7/8 通过，失败来自 HEAD 已缺失的 `docs/reference/project-export-map/doctor/prj_v8.4.xml`，本轮未改该项。
- Windows PowerShell 5.1 `update-agents.tests.ps1 -ReuseOnly` 通过 standard 与 Overlay 的 Write -NoPull；轻量 manifest 夹具验证文件保留和路径可达。
- 版本快照与 HEAD 比较确认 8 个变更组件 0 新增问题；全仓已有 7 项 xc 问题。7 个直接依赖 manifest 上限提升至 <0.33.0 并 PATCH 升版。获准提交后 staged 版本门禁通过，检查 11 个受影响组件。

## 清理

删除前已解析任务目录绝对路径并核对全部内容及无 ReparsePoint，按准确路径清理。独立 Test-Path 返回 False，临时夹具、隔离 Git 元数据和服务脚本均已删除。正式测试种子与本报告保留。

## 干净首次顺序样本

另建独立 `reuse-first-order-20261116` 微型合成工程，先创建及读回 AGENTS、offline 配置、standard/UTF-8/HISUI/ES5 profile、明确 disabled 的 UI/i18n 插件状态和隔离 Git 元数据。已加载当前 iris-coding，分流到此前读取且仍有效的前后端 skill、规则索引、专项规则、编码与格式规范。首次业务修改前执行 encoding check，结果 ready-to-edit，再搜索 Normalize、Code、setEnabled 并读取候选源码。

在既有 Page.cls 中只将 `Quit value` 改为 `Quit ##class(Fixture.Common).Normalize(value)`；既有 page.js 中将占位返回替换为 `$("#action").linkbutton(enabled ? "enable" : "disable")`。后端继承与签名保持，前端使用真实 vendor 已核实API，UI/i18n 前后判断均沿 disabled 分支。修改后 encoding check 仍 ready-to-edit，node --check 通过，check-cls-format.js 返回 issues 空数组。按共享review清单串行自审，确认两处调用复用既有能力，未复制标准化或控件状态实现。

该样本闭合微型本地开发的首次顺序，初始样本的先编辑后补配置局限仍保留为历史记录。真实IRIS编译与人工物料打包另属相应验证层，本轮没有执行。

主 Agent 对干净样本独立读回 Page.cls、Common.cls 与 page.js 并搜索调用者，指出 JS 占位函数原返回 enabled，首次实现会改为 undefined。已按建议保留 `return enabled`，再次 JS 语法检查通过、encoding check ready-to-edit。该发现与修复验证 Review 对消费者契约的实际作用。干净样本只证明 API 调用静态层，浏览器可见状态证据来自前一独立 HISUI 页面。

干净样本清理前解析准确绝对路径并递归核对无 ReparsePoint，删除后 Test-Path 返回 False，后续独立检查同样返回 False。
