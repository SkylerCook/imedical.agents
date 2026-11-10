# 项目知识库目录治理：源仓验证

日期：2026-10-24。任务类型 framework-maintenance；源仓起始基线 467cf3f。实施阶段仅授权框架实现，未部署主项目或模块、未迁移业务文件；用户随后另行授权提交并推送Gitee origin/master。使用契约见[项目目录治理](../../docs/guides/project-knowledge-layout.md)，不在本记录复制规则。

## 实现范围

- 根 project-docs CLI 与 project-directories resolver：owner目录声明、enabled能力目录预建、首次接入和扩展计划、精确hash批准、映射迁移、持久备份与中断回退、验收后批次清理。
- 更新器在 standard/Overlay 当前工作区共用入口；未接入只提示，已接入 Write 可补空目录；冲突只报告待复核。
- agent-context-kit、i18n、BOS、表单、文档摄取、接口与医生AI owner 接入及说明；external-reg 接纳摄取版本兼容。旧任务、显式配置和业务恢复备份保持边界。

## 本机验证

Windows，Node 24.14.1。最终集成命令：

```text
node --test scripts/tests/project-docs.tests.js scripts/tests/i18n-directory-layout.tests.js scripts/tests/task-handoff.tests.js scripts/tests/cure-form-workspace.tests.js scripts/tests/extract-doc-layout.tests.js plugins/bos-plugin/tests/demand-directories.tests.js plugins/iris-imedical-doctor-ai/scripts/tests/directory-layout.test.js
```

81/81，exit 0：核心24、i18n10、交接27、表单3、摄取/接口8、BOS/AI9。包含未接入零写入、标准/Overlay隔离、目录冲突预检、字节与附件保持、live Markdown引用修复、代码示例保护、目录拓扑/空子目录、精确计划审批、配置/文件漂移、嵌套Git/链接/硬链接、journal篡改、真正子进程中断后的备份恢复、并发内容保留和限定清理。

- 更新器完整 suite：PS7.6.6、Windows PowerShell5.1 均 exit 0，打印 update-agents tests passed；修复既有测试fixture遗漏的夜跑依赖闭包后完成终态。
- i18n既有XML fallback、接口既有suite分别在PS7/PS5.1通过；BOS既有标版补录29项通过。未连接IRIS或外部业务服务。
- 部署文档链接检查通过；本次95个新增/修改文件严格UTF-8通过，PowerShell BOM正确，按仓库换行配置执行 git diff --check 通过。
- 当前组件版本工作区校验与HEAD基线对照：8个owner版本变更，无新增问题；原有历史发布字段欠项保持原样，不据此宣称全仓版本审计通过。发布commit字段记录源仓起始基线，本次未创建提交。

最终Node集成测试证据使用 scripts/validation-evidence.js 记录在源仓私有 `.git/validation/project-docs.json`，以实际受测scope内容指纹供后续提交复用。此文件不随能力包部署。测试fixture由各suite清理，子任务D盘临时目录已独立确认不存在。

## 验证局限与下一步

Windows/macOS/Linux × Node22/24 CI 已配置在 project-docs workflow，本轮未推送，尚无远端矩阵结果。本机通过不替代跨平台、真实宿主读取导航、业务部署或实际项目迁移验收。

后续项目接入先准备具体setup计划并取得首次部署授权；迁移则另列旧→新路径、引用编辑、备份和跳过项，按批授权及小批恢复验证。框架中未声明的能力保持原契约，由owner定点接入，通用分类器不猜测其输出或恢复数据。

## 提交前衔接

提交前HEAD为已推送的并行UI提交bf0904f，保留其共享入口与feedback授权正文，0.6.0发布草稿衔接previousVersion 0.5.4。旧集成证据因共享文档/模板及版本基线变化失效，提交前补跑81项集成并全部通过；另补查入口/两版thin-index共3项及部署文档链接1项通过。PS7/PS5.1更新器、XML与接口等未变化的既有suite复用原证据。提交门禁按本次精确暂存内容取证，实际commit与push结果以Git回执为准。
