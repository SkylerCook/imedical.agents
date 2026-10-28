# Doctor 文件导出图谱

本目录存放医生站各版本的项目导出文件 XML 图谱，用于快速从服务器导出医生站常用文件。

## 版本列表

| 版本 | 文件 | 项目名 | 范围 | 导出时间 |
|------|------|--------|------|----------|
| v8.4 | [prj_v8.4.xml](prj_v8.4.xml) | DHCDOC_PRJ | 医生站 | 2026-06-11 12:51:57 |
| v8.5 | [prj_v8.5.xml](prj_v8.5.xml) | DHCDOC_PRJ | 医生站 | 2026-06-11 13:04:25 |
| v9.0 | [prj_v9.0.xml](prj_v9.0.xml) | DHCDOC_PRJ | 医生站 | 2026-06-11 13:06:50 |
| v9.1 | [prj_v9.1.xml](prj_v9.1.xml) | DOCTOR_PRJ | 医生站 | 2026-05-12 08:26:23 |
| v9.2 | [prj_v9.2.xml](prj_v9.2.xml) | IMEDICAL_PRJ | 全仓 10 个产品 | 2026-10-26 17:31:03 |

## 说明

- 图谱只表达"某版本包含哪些文档"，不含代码内容；导出代码用 `iris-xml-package` skill 的 `export` / `export-doc`。
- v8.4~v9.1 为人工从实例工程导出后整理，来源为原医生站 `svn\tags` 与 Git 仓库；v9.2 起改为**离线扫描当前 checkout 生成**，可重复、可 diff，不连接服务器、不占用 IRIS license。
- v9.2 生成命令（skills 维护源在 `~/.agent-config/skills/`，本项目通过 Junction 提供给 CodeBuddy）：

  ```powershell
  node "$env:USERPROFILE\.agent-config\skills\iris-xml-package\scripts\iris-xml-scope.js" `
    baseline --write-xml .agents/docs/reference/project-export-map/doctor/prj_v9.2.xml `
    --project-name IMEDICAL_PRJ --json
  ```

- 口径：`CLS`/`MAC`/`INC` 只存文档名，扩展名由 `type` 表达；Web 文件统一写成 `imedical/web/<相对路径>`，`type` 记为 `CSP`（与 Studio 的 Web 文件分类一致）。同名同类型条目按首次出现保留并去重，v9.2 去重 10 条。
- v9.2 与 v9.1 的差异不止版本：v9.1 的 `CF.`、`DOC.DOC.AI.AI.` 等条目来自旧目录路径换算，v9.2 一律按类声明取真实类名；两者交集 2365 条，导入前按实际文档名核对。
- 项目使用时若没有对应版本，可采取就高原则，例如：v8.3 使用 v8.4 的图谱。
- 若需其他版本或专科系统的代码图谱，可提 issue 或 PR 补充。
- 导出代码前建议先在本地目录执行 `git init` 初始化仓库；导出完成后统一提交一次作为基线。后续每次修改代码前，先拉取最新代码并提交到本地仓库，保留完整变更历史，再开始修改。
- 图谱未覆盖的文件可自行补充到本地 XML 图谱中，但请勿提交到 agents 仓库。
