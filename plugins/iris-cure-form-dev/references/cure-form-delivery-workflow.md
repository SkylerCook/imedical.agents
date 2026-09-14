# 表单交付、预览与部署收敛

## 工作目录

`.agents/` 保留框架能力、项目配置与项目规则。具体需求产物和运行态不再默认写入其中；本规则不迁移 Overlay 配置/规则，也不修改安装器。

统一使用 `--task-id <任务名>`；同一批表单所有命令沿用相同 task-id。默认任务目录为 `docs/work/cure-form/<task-id>/`，未指定时使用 moduleId/mapCode，均缺失时使用 `default`（生产任务应显式命名）。`--work-root` 可指定整个任务目录；显式历史输出路径继续兼容，已有证据不自动移动或删除。

```text
<任务>/
  README.md
  <MapCode>/source/
  <MapCode>/preview/
  <MapCode>/verification/
  <MapCode>/manual-deploy/
  private/snapshots/
  private/deployment/
  private/rollback/
```

private 自动生成忽略全部内容的 `.gitignore`；已跟踪文件仍须人工检查，不把 ignore 当作权限机制。预览 HTTP 服务只暴露当前 preview 目录，并拒绝 private 和隐藏路径，不允许把任务根作为常规服务根。凭据始终从工程配置读取，不写入交付物。清理预览不能删除备份和未完成部署状态。

每次修改后必须在回复中列出每张表的绝对预览文件链接；canonical `preview` 同时输出 `previews[]` 和任务 README 索引。不要只给目录，不要拿 `file://` 加载结果充当 HTTP 验收。

## 只读 vendor 挂载

HISUI 默认从 CapabilityRoot/vendor/hisui 挂载到 `/__cure_vendor/hisui/`，可由 `PreviewVendorRoot` 或 `--vendor-root` 显式选择。profile 的四项 HISUI 引用必须位于该根；其它资源仍按项目配置解析。

- manifest 记录 vendor 原文件路径清单和 SHA-256；HTML 只有虚拟 URL，没有 Windows 文件路径。
- runner 与 preview-check 必须分别校验允许的根目录和原文件哈希；来源漂移必须重新生成预览并验收。
- 只允许 GET/HEAD，不允许写入、不跟随越界符号链接，不提供 manifest 未声明的文件。
- asscom/adaptation/业务 CSS 保留项目专属副本；六类必需资源门禁不减少。
- 旧 CSS 的越界依赖可用 `--preview-dependency-roots` 显式允许根目录，缺失引用可由 layout 配置的 `dependencyRemaps` 精确映射；只修改预览副本，不修改业务公共 CSS。

## 视觉质量

九档是基线，不代表覆盖市面全部设备。额外验证实际问题宽度、CSS 断点两侧、嵌入容器宽度，以及宽触控 PAD 与 fine-pointer PC。DPR、字体缩放、旧 WebView、软键盘和真实 HIS 保存/回显/打印不能由九档 Chromium 结果替代。

`preview --layout-config <json>` 可声明：`widths`、`breakpoints`、`resourceOrder=business-first`、`resources`、`cases`。业务资源放在唯一 `business/*.css|*.js` 路径；CSS 顺序按实际宿主，而不是按方便通过的顺序。

每个 case 声明 `name`、可选 `click`、`visible[]`（selector/minWidth/minHeight）和 `alignment[]`（selector/count/edges）。次数切换至少验证 1→2→3→1；日期应验证 HISUI 生成的可见 wrapper，而不是隐藏的原 input；同阶段标题和输入的 top/bottom 都要对齐。布局自动交互只允许在已授权的本地预览执行，不使用患者数据，不替代人工交互凭证。

runner 输出几何数据和截图，preview-check 强制案例完整且通过。Agent 必须实际查看关键截图；无横向溢出不等于没有错列、标签/控件分离或零宽日期。用户真实 HIS/手机/PDA/PAD 验收保留独立边界。

## 自动部署 / 手动部署

先展示 `deployment-options`。部署方式、通道、发布策略和静态资源方式是四个独立选择：

- 通道：transaction-package（完整事务包）/ lightweight-sql（轻量 SQL 覆盖）；后者只处理单个已有独占模板 content，见 [命令、安全边界和超时](cure-form-sql-cover.md)。下述 5/15 分钟和分块说明针对完整事务包；轻量通道为 60/120 秒，直接参数化传 content。

- 方式：automatic / manual；默认 manual，不因具备工具就自动写入。
- 现有模板策略：versioned-clone / in-place-overwrite；项目 `ResponsiveDeploymentStrategy` 可配置，默认 versioned-clone。新建模板仍直接创建正式 RowID。
- 静态资源：用户可自行上传现有 JS/CSS；自动上传委托 coding-iris，模板事务不要求先调用 SFTP。

`in-place-overwrite` 必须绑定完整当前快照，保持模板 RowID 和组成顺序，仅更新目标 content 和明确的 Map showJS；其它模板 referenceOnly，历史 APP_LastID/缓存/字段契约保持不变。它不创建灰度，也不调用 consolidate。共享模板不得在未核实全部影响 Map 的情况下覆盖。

```text
cure-form deployment-options
cure-form handoff --package <package> --task-id <task>
cure-form deploy --package <package> --output-root <task> --deployment-mode manual
cure-form deploy --package <package> --output-root <new-run> --deployment-mode automatic --confirm-write --operator <operator> --reason <reason>
```

自动部署统一使用 deploy 编排，而不是让 Agent 无限重复 apply：同批 Map 按批准顺序串行 Validate → Apply → Verify；任何一张失败停止后续，不自动回滚已通过的其它张。

时间预算涵盖编排开始后的校验、传输、Apply 和 Verify：5 分钟没有确认进展或总计 15 分钟即停止。分块按 UTF-8 字节限额，不拆 Unicode 字符；确认序号才算进展。超时或返回丢失可能意味着服务器仍在执行：标记 `write-outcome-unknown`，保留 stage/operation 信息，先核实状态，禁止再次 Apply。当前保守实现不自动重试写入，也不宣称旧服务端支持 request-id 幂等查询。

当前兼容传输使用 600 字节上传块和带结束标记的 Base64 响应；显式处理服务器 Base64 折行。只读快照采用 600 字符分片，每片最多两次读取，完整 JSON 的 SHA-256 必须与读取前后服务器指纹一致。写入和回滚均不自动重试；HTTP success/空 output 不能算成功，回滚结果未知时须独立只读核对内容及元数据。

手动交付始终先生成：每个目标的纯 content HTML 与 README；README 列出目标 RowID、Map showJS、JS/CSS 工作区来源和部署路径、哈希、备份/回读要求。不得交付 preview.html、包 JSON 或重复的 JS/CSS 副本让用户猜。交付按 package 哈希建立不可变目录，不能以最后修改时间冒充版本。

## 并行质量与效率

先读取一次服务器基线并冻结字节；每张 Map 独立 source/preview/verification，独占各自业务资源。并行成员不得修改共享 CSS、对方产物、Git index 或最终 package。不能提供隔离写边界时串行执行，不虚称并行。

结构化交付至少包含 Map、基线快照哈希、原始字段契约与差异、产物路径/哈希、静态检查结果、preview-check 凭证及未决项。主任务为唯一集成者，检查重复路径、共享文件污染、资源哈希、保存/回显/打印契约及三路证据后生成独立包。

普通 plan 机械比较原模板与目标的输入顺序、重复 ID、缺失 value、radio name/type/value、label for 和缓存标签；差异阻断。runner 指纹绑定执行器、布局检查和 vendor 校验实现，改变任一实现必须重新验收。

快照、HTML、业务资源、公共 CSS 和 runner 指纹没有变化时复用凭证；只重跑发生变化的表单，不为同一字节另建镜像预览。发现基础设施阻断立即说明，不用临时传输脚本反复试探。服务端恢复演练必须单独明确授权、完整备份和预验证恢复通道；普通部署绝不先清空 content。

### 显式恢复演练

`recovery-test --package <恢复包> --row-id <明确RowID> --output-root <新演练目录> --confirm-clear-content --confirm-write --confirm-remote-execution --operator <operator> --reason <reason>` 只用于用户明确授权的单模板清空/恢复测试。恢复包必须为通过正常门禁的原 RowID 包，且 content 与当次服务器基线完全一致。先备份回读，再验证恢复包和专用 clear-test 包，最后清空、回读空值、用普通自动部署恢复并逐字段核对全部配置。

clear-test 包显式记录 recoveryTest/备份/恢复包哈希，previewVerification 为 null：空白测试页没有视觉验收凭证，禁止伪装成已验收部署。该例外只存在于显式恢复演练入口，普通 apply 仍拒绝。已知恢复失败可按本次演练恢复授权回滚 clear operation；写入结果未知不得盲目重试或并发回滚。保留所有 operation 与备份证据，不修改 JS/CSS、不触碰患者记录。

演练各阶段共享 15 分钟截止时间，不能每阶段重新获得 15 分钟。若清空已确认但恢复已知失败，允许单独最多 2 分钟的安全回滚请求；该请求不用于继续部署。回滚响应丢失明确标记 rollback-outcome-unknown，随后只能只读核实；演练回滚成功不等于正常自动部署验收通过，两份结果分开记录。
