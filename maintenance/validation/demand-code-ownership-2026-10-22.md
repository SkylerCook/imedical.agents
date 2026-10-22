# 主子需求与共享提交：框架验证

日期：2026-10-22。任务类型framework-maintenance，实施基线b40f4e83f23e620b856cb21a2ba9104dab90423f。变更位于canonical源仓，未改业务代码或项目部署态，未操作真实BOS，未暂存/commit/push。

## 能力与恢复边界

- BOS插件0.11.0→0.12.0，需求交付0.5.3→0.6.0；新增不可变发布记录，原记录不改。
- [共享代码归属](../../docs/demand-code-ownership.md)由技能入口直接触发；草稿v4、日志bindings及验收v2沿既有工具实现，根scripts/lib维护唯一关系校验，不新增插件、运行器或日志状态库。
- 业务范围与代码归属分开：主需求唯一持有代码证据，子项分别验收和记录日志，全部通过后正式提交一次；none有原因才跳过适用阶段。旧v2/v3草稿、原select及验收v1保持原行为，继承状态仅对parent条目有效。
- 日志目标号和代码所属号分开校验；完整hash、文件与行数来自真实提交，同仓不同worktree去重但不同目标保留。BOS回执分别记录目标、主需求、关联项目及选择；未知结果先核对，关联项目不能在恢复中替换。

## 已执行验证

Windows / Node.js 24.14.1，使用合成需求、隔离Git、mock HTTP及本地bare仓库；本轮唯一功能用例共71项：新增主子专项12项，既有直接受影响回归59项。调整验收状态兼容后，12项新专项及其中18项旧验收回归再次通过。

```text
node --test scripts/tests/demand-hierarchy.tests.js scripts/tests/standard-demand-entry.tests.js plugins/bos-plugin/tests/bos-code-update-log.tests.js plugins/bos-plugin/tests/bos-demand-log.tests.js plugins/demand-delivery-plugin/tests/acceptance-session.test.js
node --test scripts/tests/demand-hierarchy.tests.js plugins/demand-delivery-plugin/tests/acceptance-session.test.js
node --test --test-name-pattern="project links resolve" scripts/tests/documentation-layout.tests.js
```

第一条组合命令执行时新增专项为11项，共70/70通过；随后新增非BOS只提交场景，并收紧继承状态仅适用parent，第二条针对最终代码30/30通过。其余41项涉及的entry/log实现没有再变，复用既有通过证据。文档链接与目录定向用例通过，最终差异和新文件严格UTF-8、JSON、JS语法及diff检查通过。BOS插件发现/更新迁移专项另11/11通过，合计82项功能/接入用例及1项文档用例；其夹具补齐更新器既有契约所需docs目录并断言共享helper分发，没有修改生产更新器。

关键覆盖：一主三子同源正文/29列Excel/编号绑定；错误引用、循环、重复编号与文件归属；子项CLI只读显示主需求路由；明确无代码不加载提交依赖、空选择不伪装无代码；主提交真实编号与声明不一致停止；同仓多worktree去重；主子目标分别补录；整组未通过阻塞、其它独立需求继续；超时/未知与错误关联项目恢复；真实官方commit计划结果→四个mock BOS请求→本地bare单次push→子项继承回执；非BOS只提交不额外要求日志或push。

## 版本治理

工作树组件校验准确识别上述两个MINOR变更，无本轮新增问题。完整校验非零，原因为既有imedicalxc-doctor-extend-engineer发布记录1.0.2、1.0.3、1.0.4各缺失commit字段及有效对象，共6条历史错误；本轮未改这些记录，不声明全仓版本门禁通过。实施阶段未获提交授权，未执行暂存或staged门禁；用户随后授权本轮c + p，提交阶段复用有效功能证据并复核精确暂存、staged版本门禁和origin/master出站范围，结果以Git记录为准。本轮35个文件精确暂存后，staged组件门禁通过（2个组件），cached diff检查通过；该结果不代表历史完整审计债务已修复。

## 分发与待验证

既有更新器已分发scripts/lib/**，本轮只补正常更新说明和CI路径，不改安装/更新器实现。更新能力包后刷新enabled技能索引；Overlay沿共享能力更新一次、模块NoPull完整刷新。旧数据不自动迁移、无新私有配置及旧文件删除。本轮未更新任何业务副本。

现有Windows/macOS/Linux × Node22/24矩阵已纳入新专项及helper触发路径；只有本机结果，不声称其它平台CI通过。真实BOS对同一主提交按不同需求号登记的服务端行为、真实Agent按需加载/不强拆代码及普通项目升级后的接续，沿既有P2队列取得独立授权和证据。正式BOS父子关系仍由用户建立，不调用未知“沿用日志”接口。

本任务测试临时根D:/tmp/Codex/framework-demand-hierarchy-20261022已核实无剩余文件或链接并删除；夹具自清理，最后仅有空的测试父目录。未生成业务测试产物或凭据文件到仓库。已用validation-evidence记录并回读demand-code-ownership功能指纹，后续内容匹配时复用，不机械重跑。
