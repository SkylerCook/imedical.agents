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
