# 项目目录说明与持续更新验证

维护类型为 framework-maintenance，实施基点为 `d3e22de`。仅验证框架和隔离夹具；不修改业务工程、不迁移资料、不连接 BOS/IRIS，也不调整连接配置。提交与远端发布按本批人类用户授权执行。

## 实现与实际前后内容

- owner `projectDirectories` 保持路径、role 和创建时机，补齐 purpose、examples、boundary、lifecycle；七个 owner 版本与新发布记录共同维护，未改既有不可变记录。项目特有说明继续由本地 extensions 提供。
- 原无用途声明曾输出 `delivery/demands/ | delivery`；当前模拟生成明确的“BOS 需求正式文本和 Excel 交付”、需求文本/导入 Excel 示例、私有草稿归本地 work 的边界和按需求保留规则。task 目录尚不存在时只显示路径与创建时机。
- 旧自定义 `docs/README.md` 含 BOM、CRLF、业务链接：普通 Check/DryRun/Write 保持字节不变，提示 navigation-plan。精确评审 apply 后，原文保留，追加一个受管区；更新 owner 用途后 DryRun 展示受管区前后内容，Write 更新且保留人工尾部，再次 Write 无变更。
- 总导航、四个用途入口、扩展入口及本地 work 汇总入口按实际需要生成；嵌套能力目录在所属主要用途入口列出。旧 handoff/run 等仅在已存在且由 enabled owner 声明时说明兼容原因，保留原恢复路径。
- `docs-layout-ok` 只覆盖声明目录、受管说明及生成导航。顶层 unclassified 仍为提示，不证明逐文件分类、全部人工链接有效、业务现行性或用户验收。

## 验证入口与范围

Node 目录集成使用 `.github/workflows/project-docs.yml` 原有七组 suite；说明与升级专项在 `scripts/tests/project-docs.tests.js`。standard 与 Overlay 均覆盖新接入、旧 README、明确接管、受管区更新、BOM/换行及自定义正文保留、扩展登记、导航链接、说明缺失/过期、重复执行和冲突可见。

并发保护覆盖预演后出现的新文件、普通 Write 创建瞬间出现的新文件、规划读入正文时并发变化；均保留用户新内容。标记残缺、重复、被代码块隐藏、链接/硬链接、嵌套 Git 和目录阻挡按具体边界停止。业务文件与旧运行恢复资料逐字节保持。

更新器集成沿 `scripts/tests/update-agents.tests.ps1`，通过真实 `project-docs.js` 调用，覆盖两种模式的 Check/DryRun 只读、普通 Write 刷新、再次 Write 幂等及目录冲突可见。夹具补齐现有 iris-mcp.js 的共享库依赖；缺失目录场景先精确移除本测试生成的 README，再模拟整个目录丢失，不放宽生产保护。

文档专项验证部署链接、锚点及安装/更新稀疏清单覆盖新运行时。组件治理使用原校验器 API 做只读工作区预检：七个变更 owner、十一项受影响组件，无新增版本/发布或直接依赖兼容问题；它不替代获得提交授权后的 `validate --staged`。

用户随后授权本批提交与双远端推送。精确暂存 41 个文件后，实际 `validate --staged --budget-ms 60000` 覆盖 7 个变更 owner、11 项受影响组件并通过；暂存差异检查通过。推送前核对两远端 master 均在 d3e22de，无需携带其它历史。任务临时目录已清理，正式记录和本机验证缓存保留。

本机环境为 Windows、Node 24.14.1。跨平台专项已由既有 Windows/macOS/Linux × Node 22/24 workflow 覆盖；配置存在不等于这些矩阵已实跑。本批未取得其它平台或真实业务副本接入证据。

最终 Node 目录集成 92/92，其中说明/迁移专项 35 项；文档链接与分发定向 2/2，27 份变更 Markdown 的 645 个本地链接/锚点检查通过。Windows PowerShell 5.1 与 PowerShell 7 的更新器全套回归均退出 0 并输出完成行。三项功能证据通过既有 validation-evidence 工具记录到本机 `.git/validation-evidence-project-docs-navigation.json` 并核对 fingerprint-match，供后续授权提交复用；不进入 Git 历史。

## 旧工程升级

先更新共享或独立能力包，再在每个当前工作区分别运行：

```text
node .agents/scripts/project-docs.js update --project-root . --mode DryRun
node .agents/scripts/project-docs.js navigation-plan --project-root .
```

无标记 README 通过第二条命令生成计划，保存原 JSON 并审查准确 action。取得该批授权后按[目录治理](../../docs/guides/project-knowledge-layout.md#操作入口)执行 apply 和单独备份；再运行 update Check。后续普通更新 Write 即可维护受管说明。无旧导航或人工内容的缺失 README 可直接由已接入工程普通 Write 补齐。项目扩展可按实际用途补充 examples、boundary 和 lifecycle，普通更新保留配置。

此路径不需要 Force，不复制框架规则到项目，不移动旧业务目录；Overlay 仍 capability-once/context-many，每个模块的说明更新只写本地 WorkspaceRoot/ContextRoot。
