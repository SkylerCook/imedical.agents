# 来源、证据类型与画板覆盖

本期基准为 IHOS／海蓝与 PURE／天蓝，资料版本固定于 [source-manifest.json](<../../../vendor/imedical-ui-standards/source-manifest.json>)。公司授权接收的底稿见 [vendor 说明](<../../../vendor/imedical-ui-standards/README.md>)；它是证据子集，不是运行时样式或完整原型查看器。

## 如何使用证据

| 类型 | 应如何使用 | 完成核查 |
|---|---|---|
| 明确文字 | 保留必须、默认、建议、可选及场景和例外；按对应条款执行 | 规则含适用条件及出处 |
| 构件图形参数 | 确认控件类别、状态、描边与盒模型；通过原生组件核对目标表现 | 对象和坐标口径一致 |
| 组合页面示例 | 提炼分区与承载关系，保留字段/数量/宽度的示例身份 | 未将样本内容固化为默认 |
| 设计器操作 | 只说明原型编辑方式，不进入产品交互要求 | 与产品规则分开 |

定位必须包含资料包/批次、画板和完整节点 GUID；IHOS/PURE 可能复用同一画板或节点 GUID。画板 globalBounds 含设计画布原点，测局部位置先减去该原点；预览图像素与画板坐标分开。

仅一方提供的规范保留其适用范围。需要同时适配两风格时优先采用明确的兼容条款；真正冲突时记录双方证据与待确认点，不按目录新旧静默覆盖。规范涉及默认值、必填、权限或编辑流程时，先对照业务契约登记差异。

## 来源适用范围

PDF 是 **IHOS 风格**说明书，其“必须／默认”等条款首先约束 IHOS。PURE 需要对应导出标注、构件证据或明确的跨风格兼容条款支持；不能仅凭本插件同时支持两风格，将 IHOS 单方明文升级为 PURE 强制要求。参考中标“PDF pXX”的内容遵守此边界；缺少 PURE 证据时可作核查参考，但不能据此直接判 PURE 违规。p52 的“兼容纯净时10px”是明确跨风格条款。

## PDF 说明书

[规范说明书 V1.0](<../../../vendor/imedical-ui-standards/ihos-ui-v1.0.pdf>)，2025-12-24，54 页；物理页码定位，不是浏览器缩放后的坐标。字体条款只约束设计字体；运行字体沿目标工程。

| 物理页 | 内容 | 参考去向 |
|---|---|---|
| 5–13 | 目标、多主题、尺寸与色彩；三主题同交互仅指 IHOS | [风格差异](<style-differences.md>) |
| 14–15 | 字号、字重、设计字体与圆角；非运行字体要求 | [表单与操作](<forms-and-actions.md>) |
| 20–26 | 按钮主次/例外、表单与单复选；默认值/必填涉及业务 | [表单与操作](<forms-and-actions.md>) |
| 27–36 | 面板、页签、导航、树形控件 | [布局与导航](<layout-and-navigation.md>) |
| 37–39 | 表格对齐/行高/斑马纹、编辑模式及通用/小分页 | [表格与反馈](<tables-and-feedback.md>) |
| 40–44 | 提示、弹窗、遮罩及固定顶部渐变 | [表格与反馈](<tables-and-feedback.md>) |
| 44–45 | 5px基准；同背景10px/异背景0px；行距与弹窗内边距 | [布局与导航](<layout-and-navigation.md>) |
| 45–51 | 登录、首页与导航组合；只在对应场景采用 | [布局与导航](<layout-and-navigation.md>) |
| 52 | 查询与表格：兼容PURE时10px，仅IHOS时0px | [布局与导航](<layout-and-navigation.md>) |
| 53–54 | 弹窗尺寸/范围与遮罩、关于页；交互变化需业务核对 | [布局与导航](<layout-and-navigation.md>) |

## 资料包与批次

原目录名、内部项目标题和画板导出时间是三个字段，存在历史名称差异；原文照录，不能将内部旧标题当成目录批次。导出时间的原始毫秒值保留在 manifest，以下另显示 UTC 便于复核。

### ihos-seablue

- 原目录：【iMedical+iHOS】（海蓝）控件+布局标注-2026.06.22
- 内部标题：【iMedical iHOS】（海蓝）控件+布局标注-2026.05.27
- 包 GUID：`8ffc1d69-8182-41aa-a5ce-7ddd908d97b0`；画板数：13；artScale：1
- 包清单：[res/data.js](<../../../vendor/imedical-ui-standards/ihos-seablue/res/data.js>)

| 画板 | 证据性质与覆盖去向 | 画板 GUID | 底稿与原图 |
|---|---|---|---|
| 布局-01登录页-03居右 | [组合示例：登录变体；不推广为所有页面的固定比例](<page-patterns-and-supplementary.md>) | `9060096e-9f46-4f24-b633-52ac87e74b42` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-03%E5%B1%85%E5%8F%B3/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-03%E5%B1%85%E5%8F%B3/preview.png>) |
| 布局-01登录页-02居左 | [组合示例：登录变体；不推广为所有页面的固定比例](<page-patterns-and-supplementary.md>) | `f81a142a-0bed-4b18-b0a2-4ff5b155996e` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-02%E5%B1%85%E5%B7%A6/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-02%E5%B1%85%E5%B7%A6/preview.png>) |
| 布局-01登录页-01居中-02有框 | [组合示例：登录变体；不推广为所有页面的固定比例](<page-patterns-and-supplementary.md>) | `3e4a4027-2e40-4bde-b68c-616188a31684` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-01%E5%B1%85%E4%B8%AD-02%E6%9C%89%E6%A1%86/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-01%E5%B1%85%E4%B8%AD-02%E6%9C%89%E6%A1%86/preview.png>) |
| 布局-01登录页-01居中-01无框 | [组合示例：登录变体；不推广为所有页面的固定比例](<page-patterns-and-supplementary.md>) | `ef343081-65ad-408b-b98e-b108666c60cd` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-01%E5%B1%85%E4%B8%AD-01%E6%97%A0%E6%A1%86/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-01%E5%B1%85%E4%B8%AD-01%E6%97%A0%E6%A1%86/preview.png>) |
| 布局-02首页 | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<page-patterns-and-supplementary.md>) | `92ecb839-50be-4b5f-9751-aaabc72d6e60` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-02%E9%A6%96%E9%A1%B5/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-02%E9%A6%96%E9%A1%B5/preview.png>) |
| 布局-03标准查询页面 | [组合示例：查询/操作/表格/分页；间距另有PDF兼容条款](<layout-and-navigation.md>) | `006f6c86-b8ed-4606-8a0f-a2db91af7357` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-03%E6%A0%87%E5%87%86%E6%9F%A5%E8%AF%A2%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-03%E6%A0%87%E5%87%86%E6%9F%A5%E8%AF%A2%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-04系统级标签页+多面板页面 | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<layout-and-navigation.md>) | `c2e9f18c-7feb-4a6c-967e-ef8a36dbc00f` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-04%E7%B3%BB%E7%BB%9F%E7%BA%A7%E6%A0%87%E7%AD%BE%E9%A1%B5+%E5%A4%9A%E9%9D%A2%E6%9D%BF%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-04%E7%B3%BB%E7%BB%9F%E7%BA%A7%E6%A0%87%E7%AD%BE%E9%A1%B5+%E5%A4%9A%E9%9D%A2%E6%9D%BF%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-07关于页面 | [组合示例：关于信息与语言变体；占位内容不成为业务契约](<page-patterns-and-supplementary.md>) | `14cd5dc3-3661-40e4-aac8-ccda7afc3b51` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-07%E5%85%B3%E4%BA%8E%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-07%E5%85%B3%E4%BA%8E%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-05固定左菜单+右侧标签页面 | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<layout-and-navigation.md>) | `1faeaf79-a8c2-4b86-814a-893f676cc018` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-05%E5%9B%BA%E5%AE%9A%E5%B7%A6%E8%8F%9C%E5%8D%95+%E5%8F%B3%E4%BE%A7%E6%A0%87%E7%AD%BE%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-05%E5%9B%BA%E5%AE%9A%E5%B7%A6%E8%8F%9C%E5%8D%95+%E5%8F%B3%E4%BE%A7%E6%A0%87%E7%AD%BE%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-06含按钮的弹窗页面(固定按钮组合） | [组合示例：固定按钮/多按钮；不强制示例尺寸或按钮数量](<tables-and-feedback.md>) | `435e1fee-f940-457a-829d-641e2fac9b61` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-06%E5%90%AB%E6%8C%89%E9%92%AE%E7%9A%84%E5%BC%B9%E7%AA%97%E9%A1%B5%E9%9D%A2(%E5%9B%BA%E5%AE%9A%E6%8C%89%E9%92%AE%E7%BB%84%E5%90%88%EF%BC%89/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E5%B8%83%E5%B1%80-06%E5%90%AB%E6%8C%89%E9%92%AE%E7%9A%84%E5%BC%B9%E7%AA%97%E9%A1%B5%E9%9D%A2(%E5%9B%BA%E5%AE%9A%E6%8C%89%E9%92%AE%E7%BB%84%E5%90%88%EF%BC%89/preview.png>) |
| 控件-01按钮+表格+表单+其他控件 | [明确文字＋构件参数：表单、按钮、表格、分页及状态](<forms-and-actions.md>) | `2a94f2f9-0201-4d10-849c-c47bb6cb7351` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E6%8E%A7%E4%BB%B6-01%E6%8C%89%E9%92%AE+%E8%A1%A8%E6%A0%BC+%E8%A1%A8%E5%8D%95+%E5%85%B6%E4%BB%96%E6%8E%A7%E4%BB%B6/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E6%8E%A7%E4%BB%B6-01%E6%8C%89%E9%92%AE+%E8%A1%A8%E6%A0%BC+%E8%A1%A8%E5%8D%95+%E5%85%B6%E4%BB%96%E6%8E%A7%E4%BB%B6/preview.png>) |
| 控件-02布局 | [明确文字＋构件参数：面板、导航、弹窗及渐变](<layout-and-navigation.md>) | `d523716c-e099-40e8-afdc-ad98a5988fd9` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E6%8E%A7%E4%BB%B6-02%E5%B8%83%E5%B1%80/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E6%8E%A7%E4%BB%B6-02%E5%B8%83%E5%B1%80/preview.png>) |
| 控件-03HOS组补充控件 | [补充构件/状态：按实际涉及控件取用，编辑器操作不转规则](<page-patterns-and-supplementary.md>) | `0ae03907-eaf0-48b5-a7cd-1a5a40517451` | [数据](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E6%8E%A7%E4%BB%B6-03HOS%E7%BB%84%E8%A1%A5%E5%85%85%E6%8E%A7%E4%BB%B6/data.js>) · [原图](<../../../vendor/imedical-ui-standards/ihos-seablue/res/%E6%8E%A7%E4%BB%B6-03HOS%E7%BB%84%E8%A1%A5%E5%85%85%E6%8E%A7%E4%BB%B6/preview.png>) |

画板及预览尺寸、globalBounds、逐画板导出时间见 manifest 的本包记录；布局为1920×1080，控件展示板有不同尺寸，整板不能直接像素差比较。

### pure-controls

- 原目录：【纯净】控件标注-2025.10.15
- 内部标题：2025.07.28-纯净风格-控件+布局
- 包 GUID：`ace0223a-1464-4757-8764-1c7610c4fac1`；画板数：3；artScale：1
- 包清单：[res/data.js](<../../../vendor/imedical-ui-standards/pure-controls/res/data.js>)

| 画板 | 证据性质与覆盖去向 | 画板 GUID | 底稿与原图 |
|---|---|---|---|
| 控件-01按钮+表格+表单+其他控件 | [明确文字＋构件参数：表单、按钮、表格、分页及状态](<forms-and-actions.md>) | `2a94f2f9-0201-4d10-849c-c47bb6cb7351` | [数据](<../../../vendor/imedical-ui-standards/pure-controls/res/%E6%8E%A7%E4%BB%B6-01%E6%8C%89%E9%92%AE+%E8%A1%A8%E6%A0%BC+%E8%A1%A8%E5%8D%95+%E5%85%B6%E4%BB%96%E6%8E%A7%E4%BB%B6/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-controls/res/%E6%8E%A7%E4%BB%B6-01%E6%8C%89%E9%92%AE+%E8%A1%A8%E6%A0%BC+%E8%A1%A8%E5%8D%95+%E5%85%B6%E4%BB%96%E6%8E%A7%E4%BB%B6/preview.png>) |
| 控件-02布局 | [明确文字＋构件参数：面板、导航、弹窗及渐变](<layout-and-navigation.md>) | `d523716c-e099-40e8-afdc-ad98a5988fd9` | [数据](<../../../vendor/imedical-ui-standards/pure-controls/res/%E6%8E%A7%E4%BB%B6-02%E5%B8%83%E5%B1%80/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-controls/res/%E6%8E%A7%E4%BB%B6-02%E5%B8%83%E5%B1%80/preview.png>) |
| 控件-03HOS组补充控件 | [补充构件/状态：按实际涉及控件取用，编辑器操作不转规则](<page-patterns-and-supplementary.md>) | `0ae03907-eaf0-48b5-a7cd-1a5a40517451` | [数据](<../../../vendor/imedical-ui-standards/pure-controls/res/%E6%8E%A7%E4%BB%B6-03HOS%E7%BB%84%E8%A1%A5%E5%85%85%E6%8E%A7%E4%BB%B6/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-controls/res/%E6%8E%A7%E4%BB%B6-03HOS%E7%BB%84%E8%A1%A5%E5%85%85%E6%8E%A7%E4%BB%B6/preview.png>) |

画板及预览尺寸、globalBounds、逐画板导出时间见 manifest 的本包记录；布局为1920×1080，控件展示板有不同尺寸，整板不能直接像素差比较。

### pure-layouts

- 原目录：【纯净】布局标注-2025.10.15
- 内部标题：2025.07.28-纯净风格-控件+布局
- 包 GUID：`ace0223a-1464-4757-8764-1c7610c4fac1`；画板数：14；artScale：1
- 包清单：[res/data.js](<../../../vendor/imedical-ui-standards/pure-layouts/res/data.js>)

| 画板 | 证据性质与覆盖去向 | 画板 GUID | 底稿与原图 |
|---|---|---|---|
| 布局-12右侧页签  | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<layout-and-navigation.md>) | `80f7b4a5-2e05-4492-a6e4-ba8cbb47a58f` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-12%E5%8F%B3%E4%BE%A7%E9%A1%B5%E7%AD%BE/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-12%E5%8F%B3%E4%BE%A7%E9%A1%B5%E7%AD%BE/preview.png>) |
| 布局-02标准查询页面 | [组合示例：查询/操作/表格/分页；间距另有PDF兼容条款](<layout-and-navigation.md>) | `fb1a8f86-8061-4bb1-934d-eac47eeeeb3c` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-02%E6%A0%87%E5%87%86%E6%9F%A5%E8%AF%A2%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-02%E6%A0%87%E5%87%86%E6%9F%A5%E8%AF%A2%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-03系统级标签页+多面板页面 | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<layout-and-navigation.md>) | `998b3fb0-919a-4dce-a035-31d783045d03` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-03%E7%B3%BB%E7%BB%9F%E7%BA%A7%E6%A0%87%E7%AD%BE%E9%A1%B5+%E5%A4%9A%E9%9D%A2%E6%9D%BF%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-03%E7%B3%BB%E7%BB%9F%E7%BA%A7%E6%A0%87%E7%AD%BE%E9%A1%B5+%E5%A4%9A%E9%9D%A2%E6%9D%BF%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-04多面板页面 | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<layout-and-navigation.md>) | `7fdf59fd-1a20-43f8-b5f3-f0f823cb5a95` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-04%E5%A4%9A%E9%9D%A2%E6%9D%BF%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-04%E5%A4%9A%E9%9D%A2%E6%9D%BF%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-05固定左菜单+右侧标签页面 | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<layout-and-navigation.md>) | `1a823527-68ec-4378-b4e8-36e10a98a2fb` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-05%E5%9B%BA%E5%AE%9A%E5%B7%A6%E8%8F%9C%E5%8D%95+%E5%8F%B3%E4%BE%A7%E6%A0%87%E7%AD%BE%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-05%E5%9B%BA%E5%AE%9A%E5%B7%A6%E8%8F%9C%E5%8D%95+%E5%8F%B3%E4%BE%A7%E6%A0%87%E7%AD%BE%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-06可折叠带三级菜单+分离式标签页+多面板 | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<layout-and-navigation.md>) | `1df39580-3b31-4ac1-93a2-4a659248c72a` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-06%E5%8F%AF%E6%8A%98%E5%8F%A0%E5%B8%A6%E4%B8%89%E7%BA%A7%E8%8F%9C%E5%8D%95+%E5%88%86%E7%A6%BB%E5%BC%8F%E6%A0%87%E7%AD%BE%E9%A1%B5+%E5%A4%9A%E9%9D%A2%E6%9D%BF/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-06%E5%8F%AF%E6%8A%98%E5%8F%A0%E5%B8%A6%E4%B8%89%E7%BA%A7%E8%8F%9C%E5%8D%95+%E5%88%86%E7%A6%BB%E5%BC%8F%E6%A0%87%E7%AD%BE%E9%A1%B5+%E5%A4%9A%E9%9D%A2%E6%9D%BF/preview.png>) |
| 布局-07含按钮的弹窗页面(固定按钮组合） | [组合示例：固定按钮/多按钮；不强制示例尺寸或按钮数量](<tables-and-feedback.md>) | `8fc966d4-37ff-47fa-837b-0e76c2771b50` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-07%E5%90%AB%E6%8C%89%E9%92%AE%E7%9A%84%E5%BC%B9%E7%AA%97%E9%A1%B5%E9%9D%A2(%E5%9B%BA%E5%AE%9A%E6%8C%89%E9%92%AE%E7%BB%84%E5%90%88%EF%BC%89/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-07%E5%90%AB%E6%8C%89%E9%92%AE%E7%9A%84%E5%BC%B9%E7%AA%97%E9%A1%B5%E9%9D%A2(%E5%9B%BA%E5%AE%9A%E6%8C%89%E9%92%AE%E7%BB%84%E5%90%88%EF%BC%89/preview.png>) |
| 布局-08纯表格的弹窗页面(多按钮） | [组合示例：固定按钮/多按钮；不强制示例尺寸或按钮数量](<tables-and-feedback.md>) | `7cf6f7ef-5900-4487-86ae-f2949142cac1` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-08%E7%BA%AF%E8%A1%A8%E6%A0%BC%E7%9A%84%E5%BC%B9%E7%AA%97%E9%A1%B5%E9%9D%A2(%E5%A4%9A%E6%8C%89%E9%92%AE%EF%BC%89/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-08%E7%BA%AF%E8%A1%A8%E6%A0%BC%E7%9A%84%E5%BC%B9%E7%AA%97%E9%A1%B5%E9%9D%A2(%E5%A4%9A%E6%8C%89%E9%92%AE%EF%BC%89/preview.png>) |
| 布局-09申请表单录入 | [组合示例：申请分组、底栏；业务字段/行为保持样例身份](<page-patterns-and-supplementary.md>) | `f2f45a67-930b-436e-b90c-c125f2a1e9f0` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-09%E7%94%B3%E8%AF%B7%E8%A1%A8%E5%8D%95%E5%BD%95%E5%85%A5/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-09%E7%94%B3%E8%AF%B7%E8%A1%A8%E5%8D%95%E5%BD%95%E5%85%A5/preview.png>) |
| 布局-10关于页面 | [组合示例：关于信息与语言变体；占位内容不成为业务契约](<page-patterns-and-supplementary.md>) | `5ae21eaf-b679-483f-a7b5-9ff0cbb82a3d` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-10%E5%85%B3%E4%BA%8E%E9%A1%B5%E9%9D%A2/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-10%E5%85%B3%E4%BA%8E%E9%A1%B5%E9%9D%A2/preview.png>) |
| 布局-10关于页面-英文版 | [组合示例：关于信息与语言变体；占位内容不成为业务契约](<page-patterns-and-supplementary.md>) | `148b0946-839c-4f6f-aae3-9175b5a76a21` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-10%E5%85%B3%E4%BA%8E%E9%A1%B5%E9%9D%A2-%E8%8B%B1%E6%96%87%E7%89%88/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-10%E5%85%B3%E4%BA%8E%E9%A1%B5%E9%9D%A2-%E8%8B%B1%E6%96%87%E7%89%88/preview.png>) |
| 布局-11左侧页签 | [组合示例：面板/导航/页签/滚动；按责任层提炼结构](<layout-and-navigation.md>) | `53b99a0d-0427-4cd8-b80c-ee8810daa12a` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-11%E5%B7%A6%E4%BE%A7%E9%A1%B5%E7%AD%BE/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-11%E5%B7%A6%E4%BE%A7%E9%A1%B5%E7%AD%BE/preview.png>) |
| 布局-01登录页-01默认 | [组合示例：登录变体；不推广为所有页面的固定比例](<page-patterns-and-supplementary.md>) | `187b72d9-b19c-4df3-aa39-000247486f5a` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-01%E9%BB%98%E8%AE%A4/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-01%E9%BB%98%E8%AE%A4/preview.png>) |
| 布局-01登录页-02无特色介绍版 | [组合示例：登录变体；不推广为所有页面的固定比例](<page-patterns-and-supplementary.md>) | `221b5113-a780-463c-8d65-69d07953eaaf` | [数据](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-02%E6%97%A0%E7%89%B9%E8%89%B2%E4%BB%8B%E7%BB%8D%E7%89%88/data.js>) · [原图](<../../../vendor/imedical-ui-standards/pure-layouts/res/%E5%B8%83%E5%B1%80-01%E7%99%BB%E5%BD%95%E9%A1%B5-02%E6%97%A0%E7%89%B9%E8%89%B2%E4%BB%8B%E7%BB%8D%E7%89%88/preview.png>) |

画板及预览尺寸、globalBounds、逐画板导出时间见 manifest 的本包记录；布局为1920×1080，控件展示板有不同尺寸，整板不能直接像素差比较。

## 首期覆盖结论

30个画板均已遍历数据与说明文字，规范按五份场景参考及风格差异归并。布局示例保留为结构依据，未由此宣称所有几何值均为明文规范；源预览图用于回查，不等同真实业务页面验收。IHOS天蓝/夜间及其它未收录资料不在本期提炼范围。
