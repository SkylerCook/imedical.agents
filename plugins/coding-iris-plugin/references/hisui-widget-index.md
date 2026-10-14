---
name: hisui-widget-index
description: HISUI 固定提交快照的控件与 JavaScript 源码索引，用于确认控件选型、API 参数、框架行为和自动翻译边界
task-affinity: [iris, frontend, hisui, reference, source-code]
tags: [HISUI, frontend, widget, coding-reference, source-code, line-number]
category: frontend
related:
  - ../rules/iris_coding_frontend.md
  - hisui-style-index.md
createdAt: 2026-04-24
updatedAt: 2026-10-14
---

# HISUI 前端编码参考与源码索引

本文用于日常 CSP / JavaScript / HISUI 前端开发。遇到控件选型、参数取值、继承关系、框架行为或框架文本处理边界不确定时，先查本索引，再按行号读取 JavaScript 源码确认。主题样式、语义 class、图标和多语言视觉资源改查同级 `hisui-style-index.md`。

| 项目 | 值 |
|---|---|
| **源码文件** | `.agents/vendor/hisui/dist/js/jquery.hisui.js` |
| **快速跳转** | 读取源码时按行号 slice，通常 `limit=100~200` |
| **校验日期** | 2026-10-14；固定提交 `4c09319c2daa09a25813c6e6af349e2791d79944` |
| **当前版本与行号** | `.agents/vendor/hisui/upstream.json`、`.agents/vendor/hisui/source-index.json` |

> 搜索时优先用 `.fn.控件名`、`.messager` 等稳定入口；jQuery 局部别名和行号随构建变化。表中行号只适用于上述提交，快照升级后以 source-index.json 与实际源码重新定位。

目标 HIS 可能加载不同的主库、主题和应用层 helper。先核对页面实际脚本与文件摘要，再选择兼容 API；当前上游主库未提供 `$.fn.getValue`，DataGrid editor 取值用其 `actions.getValue(editor.target)`，不得用 harness shim 将应用层 helper 的缺失算作真实客户端通过。

## 前端编码指南

- 弹窗和流程确认优先使用 `$.messager.alert()`、`$.messager.confirm()`、`$.messager.confirm3()`、`$.messager.prompt()`、`$.messager.progress()`，避免手写不一致的弹窗 DOM。
- 轻量成功、失败、校验提示优先使用 `$.messager.popover()`；`type` 仅支持 `info/success/alert/error`。
- 表格列表优先查 `datagrid` / `treegrid`；涉及属性编辑、树形结构、分页和大数据渲染时，先确认继承关系和独立插件能力。
- 下拉选择按数据形态选控件：普通列表用 `combobox`，树形用 `combotree`，表格用 `combogrid`，业务查找下拉优先确认 `lookup`。
- 普通按钮使用 `linkbutton`；下拉菜单按钮使用 `menubutton` / `splitbutton`；右键或下拉菜单使用 `menu`。
- 表单输入按控件体系选型：校验用 `validatebox`，数字用 `numberbox` / `numberspinner`，日期时间用 `datebox` / `dateboxq` / `timeboxq`，文件用 `filebox`，布尔值用 `checkbox` / `radio` / `switchbox`。
- 不确定参数、事件名或返回值时，以本地 HISUI 源码为准，不按 EasyUI 文档或记忆推断。

## 常见 API 陷阱

- `$.messager.popover()` 的 `type` 仅支持 `info/success/alert/error`。
- `$.messager.alert()` 的 `type` 支持 `warning/question/error/info`。
- `popover` 有两套入口：`$.messager.popover()` 是消息提示；`$(selector).popover()` 是基于 `webuiPopover` 的元素弹出提示。
- 带 `~` 或“搜索定位”的行号不是稳定 API 入口，使用前必须重新搜索源码确认。
- 历史文件可能存在编码显示问题，编辑前确认实际编码，避免整文件重写造成无关 diff。

## 源码目录结构

```text
.agents/vendor/hisui/
├── dist/
│   ├── js/jquery.hisui.js        ← 主 JS，控件 API 定义在此
│   └── css/                      ← 样式与图标资源
│       ├── hisui.css / hisui.lite.css / hisui.lightblue.css
│       ├── hisui.pure.css / hisui.vben.css
│       └── icons/、locale/、images/
└── dist/plugin/                  ← datagrid 等独立增强插件
```

## 一、布局与容器

| 控件 | 定义行 | defaults | 继承关系 | 编码用途 |
|---|---:|---:|---|---|
| **panel** | 4635 | 4773 | 基类 | 基础面板容器，大多数容器控件的父类 |
| **window** | 5211 | 5288 | → panel | 浮动窗口 |
| **dialog** | 5421 | 5469 | → window | 对话框，常用于业务表单和二级操作 |
| **layout** | 8096 | 8163 | — | 五区布局（north/south/east/west/center） hisui-layout region 编写顺序必须是 north → south → east → west → center|
| **accordion** | 6298 | 6375 | — | 折叠面板 / 手风琴 |
| **tabs** | 7277 | 7419 | — | 标签页 / 选项卡 |

## 二、数据展示与表格

| 控件 | 定义行 | defaults | 继承关系 | 编码用途 |
|---|---:|---:|---|---|
| **datagrid** | 13661 | 15045 | → panel | 核心表格控件，列表、维护页、统计页优先确认 |
| **propertygrid** | 15316 | 15506 | → datagrid | 属性编辑表 |
| **treegrid** | 16302 | 16969 | → datagrid | 树形表格 |
| **pagination** | 2229 | 2295 | — | 分页栏 |
| **tree** | 3322 | 3619 | — | 树形控件 |

### DataGrid 独立插件

| 插件文件 | 说明 |
|---|---|
| `dist/plugin/datagrid-cellediting.js` | 单元格点击 / 双击编辑 |
| `dist/plugin/datagrid-detailview.js` | 展开行显示详情 |
| `dist/plugin/datagrid-dnd.js` | 行拖拽排序 |
| `dist/plugin/datagrid-scrollview.js` | 大数据量虚拟滚动渲染 |

## 三、按钮与输入控件

| 控件 | 定义行 | defaults | 继承关系 | 编码用途 |
|---|---:|---:|---|---|
| **linkbutton** | 1926 | 1991 | — | 超链接按钮，支持图标和文本 |
| **validatebox** | 9412 | 9481 | — | 验证输入框基础 |
| **numberbox** | 10048 | 10144 | → validatebox | 数字输入框 |
| **spinner** | 10810 | 10917 | → validatebox | 微调器基类 |
| **numberspinner** | 10960 | 11014 | → spinner + numberbox | 数字微调器 |
| **timespinner** | 11220 | 11291 | → spinner | 时间微调器 |
| **searchbox** | 9111 | 9212 | — | 搜索输入框 |
| **filebox** | 21954 | 22034 | — | 文件选择框 |
| **switchbox** | 21049 | 21135 | — | 开关切换 |
| **checkbox** | 21324 | 21459 | — | 复选框美化 |
| **radio** | 21682 | 21824 | — | 单选框美化 |
| **slider** | 20003 | 20092 | — | 滑块 / 滑动条 |
| **triggerbox** | 23361 | 23454 | — | 触发按钮文本框 |
| **imedisabled** | 24950 | 24979 | — | 禁用 IME 输入法 |
| **label** | 25958 | 25984 | — | 表单标签增强 |

## 四、下拉组合框族

继承链优先按 `combo → combobox / combotree / combogrid / datebox` 理解；HISUI 增强查找类优先确认 `comboq` 和 `lookup`。

| 控件 | 定义行 | defaults | 继承关系 | 编码用途 |
|---|---:|---:|---|---|
| **combo** | 17506 | 17649 | — | 下拉组合框基类 |
| **comboq** | 22415 | 22569 | — | HISUI 增强版 combo 基类 |
| **combobox** | 18182 | 18316 | → combo | 下拉列表选择 |
| **combotree** | 18511 | 18600 | → combo + tree | 树形下拉 |
| **combogrid** | 18851 | 18926 | → combo + datagrid | 表格下拉 |
| **combogridmult** | 26196 | 26264 | → combo + datagrid | 多选表格下拉 |
| **datebox** | 19334 | 19383 | → combo | 日期选择 |
| **datetimebox** | 19666 | 19718 | → datebox | 日期时间选择 |
| **dateboxq** | 24063 | 24120 | — | HISUI 增强版日期选择 |
| **timeboxq** | 24693 | 24851 | — | HISUI 增强版时间输入 |
| **lookup** | 22989 | 23036 | → comboq + datagrid | 数据查找下拉 |
| **keywords** | 23174 | 23252 | — | 关键词标签云选择 |

## 五、消息提示系统

`$.messager` 入口在第 5750 行。业务提示、确认和进度遮罩优先使用该体系。

| 方法 | 定义行 | type 可选值 | 编码用途 |
|---|---:|---|---|
| **show** | 5751 | — | 显示自定义消息提示框 |
| **alert** | 5779 | `warning/question/error/info` | 警告或信息弹窗 |
| **confirm** | 5812 | — | 双按钮确认（OK / Cancel） |
| **confirm3** | 5845 | — | 三按钮确认（OK / No / Cancel） |
| **prompt** | 5872 | — | 输入提示弹窗 |
| **progress** | 5875 | — | 进度条遮罩 |
| **popoverSrcMsg** | 5922 | `info/success/alert/error` | popover 内部实现 |
| **popover** | 6013 | `info/success/alert/error` | 轻量气泡提示 |

### `$.messager.popover()` 关键参数

```js
$.messager.popover({
    msg: '',           // 必填：消息文本
    type: 'success',   // 仅支持 info/success/alert/error
    style: {
        top: 0,        // 空值为垂直居中，数字为距顶像素
        left: ''       // 空值为水平居中
    },
    timeout: 3000,     // 自动消失时间(ms)，>5000 才显示关闭按钮
    showSpeed: 'fast', // 动画速度：fast / slow
    showType: 'slide'  // 动画类型：slide / fade / show / null
});
```

## 六、菜单与交互控件

| 控件 | 定义行 | defaults | 继承关系 | 编码用途 |
|---|---:|---:|---|---|
| **menu** | 8591 | 8698 | — | 右键菜单 / 下拉菜单 |
| **menubutton** | 8808 | 8874 | → linkbutton | 下拉菜单按钮 |
| **splitbutton** | 8895 | 8937 | → linkbutton | 分裂按钮 |
| **menutree** | 25707 | 25769 | — | 菜单树导航，含搜索和折叠能力 |
| **draggable** | 1342 | 1466 | — | 拖拽组件 |
| **droppable** | 1502 | 1544 | — | 放置目标 |
| **resizable** | 1555 | 1750 | — | 调整大小 |

## 七、辅助控件

| 控件 | 定义行 | defaults | 编码用途 |
|---|---:|---:|---|
| **progressbar** | 3733 | 3792 | 进度条 |
| **tooltip** | 3979 | 4050 | 工具提示 |
| **popover** | 22077 | 22142 | 元素弹出提示，基于 `webuiPopover` |
| **calendar** | 10620 | 10679 | 日历面板 |
| **form** | 9887 | 9937 | 表单提交、加载、校验 |
| **hstep** | 24460 | 24508 | 水平步骤条 |
| **vstep** | 24605 | 24653 | 垂直步骤条 |

## 八、全局工具与框架入口

| 名称 | 行号 | 说明 |
|---|---:|---|
| `parser` | 868 | HTML 解析器，自动解析 `data-options` 等 |
| `_remove` | 4071 | DOM 移除辅助 |
| `$.hisui.styleCodeConfig` | 501 | 主题风格配置（default / pure / vben / lite / lightblue） |
| `$URL` | 26388 | 默认 Broker URL：`websys.Broker.cls` |
| `Level` | 26390 | 日志级别枚举（DEBUG / INFO / WARN / ERROR） |
| `Logger` | 搜索定位 | 控制台日志封装，使用前按源码搜索确认 |

## 框架文本处理边界

本节只记录 HISUI 前端编码时需要注意的框架文本处理边界；完整多语言改造规则应由目标工程自己的规则提供。

- `panel` / `window` / `dialog` 等容器标题通常由 HISUI 处理，改造前先查源码确认是否已经调用 `$.hisui.getTrans()`。
- `datagrid` / `treegrid` 列头 `title: "中文"` 默认属于 HISUI 自动翻译文本，通常不改成 `$g("中文")`。
- `$.messager.alert()`、`confirm()`、`prompt()`、`progress()` 等消息文本可能存在 HISUI 框架级文本处理；带变量、HTML 或动态拼接的文案需按目标工程规则判断。
- 含 HTML 标签且会被框架文本处理跳过的 tooltip / popover 文本，按目标工程前端规则处理。
- 即使代码不改，HISUI 自动翻译文本仍应进入翻译表，类型可记录为 `frontend-hisui`。

## 使用示例

```text
查 dialog 参数：       offset=5421  limit=100
查 datagrid 列定义：  offset=13661 limit=200
查 messager.alert：   offset=5779  limit=80
查 popover 实现：     offset=5922  limit=100
查 lookup 默认参数：  offset=23036 limit=120
查 menutree：         offset=25707 limit=120
```

## 维护要求

- 更新本文件时，先用源仓 `vendor/hisui/source-index.json` 和 `dist/js/jquery.hisui.js` 校验关键行号；业务项目读取对应 `.agents/vendor/hisui/` 路径。上游升级流程见 vendor/hisui/AGENTS.md，不能只覆盖旧 JS 或只同步图标。
- 若目标工程保留多个 HISUI 索引副本，需同步更新并校验内容一致。
- 本文件只记录通用 HISUI 前端编码经验和源码入口，不写入服务器、namespace、远程路径、业务页面清单或当前工程绝对路径。
