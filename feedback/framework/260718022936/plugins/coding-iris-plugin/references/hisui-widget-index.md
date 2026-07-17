---
name: hisui-widget-index
description: HISUI v0.1.0 控件与 JavaScript 源码索引，用于确认控件选型、API 参数、框架行为和自动翻译边界
task-affinity: [iris, frontend, hisui, reference, source-code]
tags: [HISUI, frontend, widget, coding-reference, source-code, line-number]
category: frontend
related:
  - iris_coding_frontend.md
  - hisui-style-index.md
createdAt: 2026-04-24
updatedAt: 2026-07-18
---

# HISUI 前端编码参考与源码索引

本文用于日常 CSP / JavaScript / HISUI 前端开发。遇到控件选型、参数取值、继承关系、框架行为或框架文本处理边界不确定时，先查本索引，再按行号读取 JavaScript 源码确认。主题样式、语义 class、图标和多语言视觉资源改查同级 `hisui-style-index.md`。

| 项目 | 值 |
|---|---|
| **源码文件** | `.agents/vendor/hisui/dist/js/jquery.hisui.js` |
| **快速跳转** | 读取源码时按行号 slice，通常 `limit=100~200` |
| **校验日期** | 2026-05-21 |

> 源码使用局部变量别名（`v` / `c` / `a` / `f` / `r` / `h` / `n` / `d` / `o` / `s` / `l` / `u` / `p` / `b` / `Y` = jQuery），搜索时优先用 `.fn.控件名`、`$.messager` 或直接按行号跳转。

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
│   ├── js/jquery.hisui.js        ← 主 JS，控件 API 定义在此，26,164 行
│   └── css/                      ← 样式与图标资源
│       ├── themes/
│       │   ├── default/
│       │   └── metro-blue/
│       └── icons/big/
└── dist/plugin/                  ← datagrid 等独立增强插件
```

## 一、布局与容器

| 控件 | 定义行 | defaults | 继承关系 | 编码用途 |
|---|---:|---:|---|---|
| **panel** | 4420 | 4558 | 基类 | 基础面板容器，大多数容器控件的父类 |
| **window** | 4990 | 5067 | → panel | 浮动窗口 |
| **dialog** | 5200 | 5248 | → window | 对话框，常用于业务表单和二级操作 |
| **layout** | 7676 | 7743 | — | 五区布局（north/south/east/west/center） hisui-layout region 编写顺序必须是 north → south → east → west → center|
| **accordion** | 6074 | 6151 | — | 折叠面板 / 手风琴 |
| **tabs** | 6887 | 7027 | — | 标签页 / 选项卡 |

## 二、数据展示与表格

| 控件 | 定义行 | defaults | 继承关系 | 编码用途 |
|---|---:|---:|---|---|
| **datagrid** | 13227 | 14611 | → panel | 核心表格控件，列表、维护页、统计页优先确认 |
| **propertygrid** | 14883 | 15073 | → datagrid | 属性编辑表 |
| **treegrid** | 15869 | 16536 | → datagrid | 树形表格 |
| **pagination** | 2060 | 2126 | — | 分页栏 |
| **tree** | 3153 | 3450 | — | 树形控件 |

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
| **linkbutton** | 1757 | 1822 | — | 超链接按钮，支持图标和文本 |
| **validatebox** | 8983 | 9052 | — | 验证输入框基础 |
| **numberbox** | 9619 | 9715 | → validatebox | 数字输入框 |
| **spinner** | 10379 | 10486 | → validatebox | 微调器基类 |
| **numberspinner** | 10527 | 10581 | → spinner + numberbox | 数字微调器 |
| **timespinner** | 10787 | 10858 | → spinner | 时间微调器 |
| **searchbox** | 8683 | 8784 | — | 搜索输入框 |
| **filebox** | 21493 | 21573 | — | 文件选择框 |
| **switchbox** | 20588 | 20674 | — | 开关切换 |
| **checkbox** | 20863 | 20998 | — | 复选框美化 |
| **radio** | 21221 | 21363 | — | 单选框美化 |
| **slider** | 19567 | 19656 | — | 滑块 / 滑动条 |
| **triggerbox** | 22899 | 22992 | — | 触发按钮文本框 |
| **imedisabled** | 24488 | 24517 | — | 禁用 IME 输入法 |
| **label** | 25495 | 25521 | — | 表单标签增强 |

## 四、下拉组合框族

继承链优先按 `combo → combobox / combotree / combogrid / datebox` 理解；HISUI 增强查找类优先确认 `comboq` 和 `lookup`。

| 控件 | 定义行 | defaults | 继承关系 | 编码用途 |
|---|---:|---:|---|---|
| **combo** | 17072 | 17215 | — | 下拉组合框基类 |
| **comboq** | 21954 | 22108 | — | HISUI 增强版 combo 基类 |
| **combobox** | 17746 | 17880 | → combo | 下拉列表选择 |
| **combotree** | 18075 | 18164 | → combo + tree | 树形下拉 |
| **combogrid** | 18415 | 18490 | → combo + datagrid | 表格下拉 |
| **combogridmult** | 25733 | 25801 | → combo + datagrid | 多选表格下拉 |
| **datebox** | 18898 | 18947 | → combo | 日期选择 |
| **datetimebox** | 19230 | 19282 | → datebox | 日期时间选择 |
| **dateboxq** | 23601 | 搜索定位 | — | HISUI 增强版日期选择 |
| **timeboxq** | 24231 | 搜索定位 | — | HISUI 增强版时间输入 |
| **lookup** | 22527 | 22574 | → comboq + datagrid | 数据查找下拉 |
| **keywords** | 22712 | 22790 | — | 关键词标签云选择 |

## 五、消息提示系统

`$.messager` 入口在第 5529 行。业务提示、确认和进度遮罩优先使用该体系。

| 方法 | 定义行 | type 可选值 | 编码用途 |
|---|---:|---|---|
| **show** | 5530 | — | 显示自定义消息提示框 |
| **alert** | 5558 | `warning/question/error/info` | 警告或信息弹窗 |
| **confirm** | 5591 | — | 双按钮确认（OK / Cancel） |
| **confirm3** | 5624 | — | 三按钮确认（OK / No / Cancel） |
| **prompt** | 5651 | — | 输入提示弹窗 |
| **progress** | 5654 | — | 进度条遮罩 |
| **popoverSrcMsg** | 5701 | `info/success/alert/error` | popover 内部实现 |
| **popover** | 5791 | `info/success/alert/error` | 轻量气泡提示 |

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
| **menu** | 8163 | 8270 | — | 右键菜单 / 下拉菜单 |
| **menubutton** | 8380 | 8446 | → linkbutton | 下拉菜单按钮 |
| **splitbutton** | 8467 | 8509 | → linkbutton | 分裂按钮 |
| **menutree** | 25245 | 搜索定位 | — | 菜单树导航，含搜索和折叠能力 |
| **draggable** | 1182 | 1306 | — | 拖拽组件 |
| **droppable** | 1342 | 1384 | — | 放置目标 |
| **resizable** | 1395 | 1590 | — | 调整大小 |

## 七、辅助控件

| 控件 | 定义行 | defaults | 编码用途 |
|---|---:|---:|---|
| **progressbar** | 3564 | 3623 | 进度条 |
| **tooltip** | 3806 | 3877 | 工具提示 |
| **popover** | 21616 | 21681 | 元素弹出提示，基于 `webuiPopover` |
| **calendar** | 10191 | 10250 | 日历面板 |
| **form** | 9458 | 9508 | 表单提交、加载、校验 |
| **hstep** | 23998 | 24046 | 水平步骤条 |
| **vstep** | 24143 | 24191 | 垂直步骤条 |

## 八、全局工具与框架入口

| 名称 | 行号 | 说明 |
|---|---:|---|
| `parser` | 708 | HTML 解析器，自动解析 `data-options` 等 |
| `_remove` | 3897 | DOM 移除辅助 |
| `$.hisui.styleCodeConfig` | 345 | 主题风格配置（default / pure / vben / lite / lightblue） |
| `$URL` | 25925 | 默认 Broker URL：`websys.Broker.cls` |
| `Level` | 25927 | 日志级别枚举（DEBUG / INFO / WARN / ERROR） |
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
查 dialog 参数：       offset=5200  limit=100
查 datagrid 列定义：  offset=13227 limit=200
查 messager.alert：   offset=5558  limit=80
查 popover 实现：     offset=5701  limit=100
查 lookup 默认参数：  offset=22574 limit=120
查 menutree：         offset=25245 limit=120
```

## 维护要求

- 更新本文件时，先用本地 `.agents/vendor/hisui/dist/js/jquery.hisui.js` 校验关键行号。
- 若目标工程保留多个 HISUI 索引副本，需同步更新并校验内容一致。
- 本文件只记录通用 HISUI 前端编码经验和源码入口，不写入服务器、namespace、远程路径、业务页面清单或当前工程绝对路径。
