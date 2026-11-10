# 公司 UI 规范证据快照

本目录是经用户授权纳入框架的公司内部规范资料，版权归原权利人。PDF 保留“请不要给第三方传阅”的原始声明；接收资料不改变其版权和分发条件，推送到公开镜像须另外取得相应授权。

## 本期范围

- IHOS／海蓝：控件与布局 13 画板。
- PURE／天蓝：控件 3 画板、布局 14 画板。
- iMedical iHOS 风格规范说明书 V1.0，2025-12-24，54 页。

[source-manifest.json](source-manifest.json)记录原目录名、内部项目标题、导出时间、画板尺寸及 64 个保留原文件的字节数和 SHA-256。原文件逐字节保留；目录名称与内部标题可能不同，两者均记录，不静默改版本。`.gitattributes` 防止 Git 自动换行改变底稿摘要。

这是**证据子集**：保留各包 `res/data.js`、各画板 `data.js`、整板 `preview.png` 和 PDF，没有复制查看器 JS/CSS、preview.js、缩略图、ZIP 或其它配色资料。子集不作为可运行 MarkLion 导出包；PNG 可直接查看，标注数据只用于查证。源目录保持原状。

## 查证

日常先读 [规则与参考](../../plugins/imedical-ui/README.md)，再沿 [来源目录](../../plugins/imedical-ui/references/source-catalog.md)进入相应画板。定位键使用“资料包/批次＋画板＋节点 GUID”；不同风格可能复用 GUID，不能仅按 GUID 全局定位。

`data.js` 是原始数据包装，不能通过执行脚本读取：包清单是 `var __marklionData={...}`；画板是 `marklion_artboard(aliasMap或null, document.currentScript, artboardObject)`，第三参数才是画板。画板坐标先减去画板 globalBounds 原点；预览图倍数根据 manifest 的原图尺寸核对，不能将倍图像素作为 CSS 尺寸。

更新资料时在源仓按明确的新批次接收，核对保留文件摘要、全部画板及受影响规则，再更新来源目录和 owner 版本。来源变化只提示重核，不自动生成 CSS、提升样本为规范或改业务默认。正式分发沿框架更新流程；资料存在不代表 UI 已通过评审。

## 完整公司原件（仅本地）

完整原件集中保存在 `originals/2026-10-21/`，保留 `BS端iMedical iHOS风格/`、`BS端纯净风格/`、`手机端活力蓝/` 三个资料目录的完整内容，沿用原目录层级及官方名称，与上述 64 文件证据子集分别管理。直接复制用户整理好的展开目录及 PDF，跳过压缩包；vendor 只保存展开后的一份资料。D 盘源目录及源 ZIP 保持原样，可供后续版本核对；本目录的 `.gitignore` 通过 `/originals/` 忽略本地副本，原件不提交、不随框架分发到项目。

批次内 `originals-manifest.json` 记录官方版本、本机来源及展开后每个文件的 SHA-256，用于后续升级核对；该清单随本地批次保留。框架 Git 中的 [originals-catalog.json](originals-catalog.json)仅保存这 3 个目录的批次、展开内容总量与摘要等元数据，不含原始内容。本机来源信息留本地清单，不进入共享目录索引。目录摘要取本地清单中该组的文件列表，保持清单顺序，将每项组内相对 `path`、`bytes`、`sha256` 按此字段顺序用 `JSON.stringify` 序列化，再取 UTF-8 字节的 SHA-256；它不是压缩包摘要。

公司发布新原件后，先保存新的本地批次并对比标注，再按需要升级规则、提炼证据、`source-manifest.json` 和 owner 插件版本；经核对的框架内容按标准更新流程提交和分发。完整原件集中保留，不逐项目复制；既有已入 Git 的证据子集保持原样。未来迁入公司 Git 时，完整原件是否入库须另行授权。
