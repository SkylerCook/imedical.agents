---
name: hisui-widget-index
description: HISUI v0.1.0 前端编码参考与源码索引，用于确认控件选型、API 参数、框架行为和自动翻译边界
tags: [HISUI, frontend, widget, coding-reference, source-code, line-number]
category: frontend
related:
  - iris_coding_frontend.md
createdAt: 2026-04-24
updatedAt: 2026-05-21
---

# HISUI 前端编码参考与源码索引

本文用于日常 CSP / JavaScript / HISUI 前端开发。遇到控件选型、参数取值、继承关系、框架行为或框架文本处理边界不确定时，先查本索引，再按行号读取源码确认。

| 项目 | 值 |
|---|---|
| **源码文件** | `jquery.hisui.js`（实际 26,164 行） |
| **源码变量** | `${HISUI_SRC}`，从 `.agents/config/iris_project_profile.md` 的 HISUI 配置读取 |
| **完整路径** | `${HISUI_SRC}/dist/js/jquery.hisui.js` |
| **快速跳转** | 读取源码时按行号 slice，通常 `limit=100~200` |
| **校验日期** | 2026-05-21 |

> `${HISUI_SRC}` 是项目级 HISUI 安装路径，各工程不同，不在本文写死绝对路径。
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
${HISUI_SRC}/
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

## 九、图标参考 (iconCls)

HISUI 内置图标通过 `iconCls` 属性引用。选型时先查本节能用的图标，避免引入额外图标资源。

### 通用操作

| iconCls | 用途 |
|---|---|
| `icon-add` | 新增、添加、添加排班 |
| `icon-edit` | 修改、医嘱字典库录入 |
| `icon-save` | 保存 |
| `icon-cancel` | 删除 |
| `icon-remove` | 删除 |
| `icon-delete` | 删除（`icon-dustbin-red` 红色） |
| `icon-new` | 新建 |
| `icon-copy` | 复制 |
| `icon-cut` / `icon-cut-blue` | 剪切 |
| `icon-paste` | 粘贴 |
| `icon-undo` / `icon-redo` | 撤销 / 重做 |
| `icon-refresh` / `icon-reload` | 刷新 |
| `icon-search` / `icon-find` | 查询、查找 |
| `icon-clean` / `icon-clear` | 清除 |
| `icon-reset` | 重置 |
| `icon-submit` | 提交 |
| `icon-ok` | 通过、确认 |
| `icon-no` | 禁止 |
| `icon-help` | 帮助 |
| `icon-config` | 配置 |
| `icon-filter` | 过滤 |
| `icon-sort` | 排序 |
| `icon-switch` | 交换、切换 |
| `icon-back` | 回退 |
| `icon-init` | 初始化 |
| `icon-template` | 模板 |
| `icon-save-tmpl` | 保存模板 |
| `icon-sum` | 求和 |
| `icon-cal` / `icon-calc` | 计算、计算器 |
| `icon-key` / `icon-w-key` | 授权、钥匙 |
| `icon-unlock` | 解锁 |
| `icon-lock` | 锁死 |
| `icon-pause` | 暂停、停止 |
| `icon-run` | 启用、运行、启动 |
| `icon-forbid` | 禁用、禁止、配伍禁忌 |
| `icon-import` | 导入 |
| `icon-export` | 导出 |
| `icon-upload` / `icon-upload-cloud` | 上传 |
| `icon-download` / `icon-unload-cloud` | 下载 |
| `icon-print` | 打印 |
| `icon-eye` | 查看、预览 |
| `icon-star` | 红星 |
| `icon-stamp` | 印章 |
| `icon-batch-cfg` | 批量配置 |
| `icon-batch-add` | 批量添加 |
| `icon-multi-del` | 批量删除 |
| `icon-gen` | 生成 |
| `icon-verify` | 验证、核验 |
| `icon-reorder` | 排列、重新排序 |
| `icon-scanning` / `icon-w-scan-code` | 扫码 |

### 方向与移动

| iconCls | 用途 |
|---|---|
| `icon-arrow-up` | 上移 |
| `icon-arrow-down` | 下移 |
| `icon-arrow-left` | 左移 |
| `icon-arrow-right` | 右移 |
| `icon-arrow-top` | 上移 |
| `icon-arrow-bottom` | 下移 |
| `icon-top-green` | 上移（绿色） |
| `icon-down-blue` | 下移（蓝色） |
| `icon-up-gray` | 向上收起（灰色） |
| `icon-down-gray` | 向下展开（灰色） |
| `icon-move-up-most` | 置顶 |
| `icon-move-left-most` | 移到最前 |
| `icon-blue-move` | 位置移动 |
| `icon-cancel-top` | 取消置顶 |
| `icon-skip-no` / `icon-w-skip-no` | 跳号、过号 |
| `icon-right-black` | 过号、撤销 |

### 文件与文档

| iconCls | 用途 |
|---|---|
| `icon-file` | 文件 |
| `icon-file-open` | 打开文件 |
| `icon-paper` | 文档、文件 |
| `icon-paper-new` | 新建方子 |
| `icon-paper-save` | 保存到模板 |
| `icon-paper-print` | 打印明细 |
| `icon-paper-eye` | 传阅、处方预览 |
| `icon-paper-pen` / `icon-pen-black` | 文书助手、书写 |
| `icon-paper-submit` | 生成评审报告 |
| `icon-paper-cfg` | 文档配置 |
| `icon-paper-link` | 关联 |
| `icon-paper-info` | 文档信息 |
| `icon-book` | 预约 |
| `icon-book-green` | 相关文献 |
| `icon-epr` | 电子病历 |
| `icon-attachment` | 附件 |
| `icon-list` | 列表 |
| `icon-list-word` | 查询列表 |
| `icon-img` / `icon-w-img` | 图片信息 |
| `icon-video` | 视频 |
| `icon-qr-code` (需确认) | — |
| `icon-fishbone-diagram` | 鱼骨图 |
| `icon-camera` / `icon-w-camera` | 拍照、照相机 |

### 消息与通知

| iconCls | 用途 |
|---|---|
| `icon-msg` | 信息、消息 |
| `icon-msg-unread` | 消息未读 |
| `icon-msg-read` | 消息已读 |
| `icon-msg-processed` | 消息已处理 |
| `icon-bell-blue` | 提醒 |
| `icon-bell-blue-no` | 不提醒 |
| `icon-bell-yellow` | 预警、警告、督办 |
| `icon-volume-up` / `icon-w-volume-up` | 呼叫、声音、通知 |
| `icon-alert` / `icon-alert-red` | 警告、注意事项 |
| `icon-tip` / `icon-tip-blue` | 提示 |
| `icon-alarm` | 指标预警、警报 |
| `icon-send-msg` | 发短信 |
| `icon-sound` | 语音 |
| `icon-have-message` | 回复 |

### 人员与用户

| iconCls | 用途 |
|---|---|
| `icon-person` | 人员、用户 |
| `icon-person-group` | 群组 |
| `icon-user` / `icon-user-black` | 用户 |
| `icon-doctor` | 医生 |
| `icon-doctor-green-pen` | 医生签名 |
| `icon-nurse-pen` | 护士签名 |
| `icon-patient` | 病人 |
| `icon-patient-info` | 病人信息 |
| `icon-pat-house` | 在院患者 |
| `icon-outhosp-patient` | 出院病人 |
| `icon-dbl-user` | 患者列表、多个用户 |
| `icon-pat-alert-red` | 危重患者 |
| `icon-pat-alert-yellow` | 纠纷患者 |
| `icon-person-seal` | 专家评审 |
| `icon-user-settings` | 用户管理、用户设置 |
| `icon-home` | 主页 |
| `icon-house` | 主页、本科室 |

### 医疗业务

| iconCls | 用途 |
|---|---|
| `icon-drug` | 推荐用药方案 |
| `icon-drug-eye` | 用药数据总览 |
| `icon-drug-audit` | 抗生素审核 |
| `icon-drug-link` | 联合用药 |
| `icon-stethoscope` | 诊断 |
| `icon-icd` | 诊断 ICD |
| `icon-adm-add` | 增加诊断 |
| `icon-adm-same` | 同义诊断 |
| `icon-inpatient` | 住院病人、住院部 |
| `icon-outpatient` | 门诊病人、门诊部 |
| `icon-emergency` | 紧急情况 |
| `icon-change` | 转科、转院 |
| `icon-change-loc` | 转科 |
| `icon-out` | 出院 |
| `icon-bed` | 床位 |
| `icon-fee` / `icon-fee-arrow` | 费用、缴费 |
| `icon-apply-adm` | 申请接诊 |
| `icon-apply-check` | 申请核查 |
| `icon-apply-opr` | 申请手术 |
| `icon-make-oppointment` | 预约 |
| `icon-check-reg` | 核对登记 |
| `icon-checkin` | 登记 |
| `icon-uncheckin` | 未登记 |
| `icon-end-adm` | 完成接诊 |
| `icon-read-card` | 读卡 |
| `icon-injector` | 推荐治疗方案 |
| `icon-injector_water` | 注射剂用法和剂型维护 |
| `icon-bottle-drug` | 用法用量 |
| `icon-durg-freq` | 给药频率 |
| `icon-drug-arrow-red` | 给药途径 |
| `icon-herb-pre` / `icon-herb-next` | 退药 / 发药 |
| `icon-herb-no` / `icon-herb-ok` | 拒绝发药 / 全发 |
| `icon-send-blood` / `icon-cancel-blood` | 发血 / 取消发血 |
| `icon-tooth` | 牙位图、牙齿 |
| `icon-allergy-word` | 过敏记录 |
| `icon-pat-opr` | 手术患者 |
| `icon-paper-opr-record` | 手术记录 |
| `icon-virus` | 细菌、病原学 |
| `icon-virus-drug` | 抗菌处方权 |
| `icon-macpw` | 临床路径 |
| `icon-macpworder` | 临床路径医嘱 |
| `icon-implant` | 植入物 |
| `icon-mass-injury` | 群伤 |
| `icon-gcp` | 临床药理实验患者 |
| `icon-paper-plane` | 发布 |
| `icon-undo-paper-plane` | 撤销发布 |
| `icon-needle-sticks` | 针刺伤 |
| `icon-contact-with-fluid` | 体液接触、洗手 |
| `icon-temperature` | 温度 |
| `icon-humidity` | 湿度 |

### 特殊人群标记

| iconCls | 用途 |
|---|---|
| `icon-disabler` | 残疾人 |
| `icon-pregnant-woman` | 孕妇 |
| `icon-children` | 儿童 |
| `icon-lung` | 肺结核 |
| `icon-high` | 高血压 |
| `icon-spirit` | 精神病 |
| `icon-old` | 老年人 |
| `icon-poor` | 贫困人口 |
| `icon-sugar` | 糖尿病 |
| `icon-free` | 脱贫（两免） |
| `icon-out-poverty` | 脱贫人口 |
| `icon-produce` | 产妇 |

### 状态标记

| iconCls | 用途 |
|---|---|
| `icon-ok` | 通过 |
| `icon-no` | 禁止 |
| `icon-star` / `icon-star-yellow` | 星标 |
| `icon-star-empty` / `icon-star-half` | 空星 / 半星 |
| `icon-star-orange-border` | 关注 |
| `icon-star-orange-body` | 已关注 |
| `icon-favorite` | 收藏 |
| `icon-check` | 多选 |
| `icon-checkbox` | 检验检查勾选 |
| `icon-radio` | 单选 |
| `icon-all-select` / `icon-all-unselect` | 全选 / 全不选 |
| `icon-compare-yes` / `icon-compare-no` | 已对照 / 未对照 |
| `icon-compare` | 对照 |
| `icon-lock` / `icon-unlock` | 锁死 / 解锁 |
| `icon-ignore` / `icon-re-ignore` | 忽略 / 撤销忽略 |
| `icon-unuse` | 停用 |
| `icon-share` / `icon-share-no` | 分享 / 取消分享 |
| `icon-public-word` / `icon-private-word` | 公有 / 私有 |
| `icon-contain` / `icon-no-conatin` | 包含 / 例外 |
| `icon-format-line` | 更多、配置 |
| `icon-have-son-node` | 包含子节点 |
| `icon-blue-edit` | 蓝色编辑（可用） |
| `icon-gray-edit` | 灰色编辑（禁用） |
| `icon-collect-img` | 收集图片 |

### 布局与视图

| iconCls | 用途 |
|---|---|
| `icon-all-screen` | 全屏、扩展 |
| `icon-arrow-zoom` | 放大、扩展 |
| `icon-arrow-shrink` | 缩小、收起 |
| `icon-arrow-left-top` | 向左折叠 |
| `icon-right-arrow` | 向右折叠 |
| `icon-tabs` | 页签 |
| `icon-panel-brand` | 默认功能区块图标 |
| `icon-show-set` | 显示设置 |
| `icon-set-col` | 列设置 |
| `icon-lt-rt-19` / `icon-lt-rt-28` | 1:9 / 2:8 布局 |
| `icon-lt-rt-37` / `icon-lt-rt-46` | 3:7 / 4:6 布局 |
| `icon-lt-rt-55` | 对半分布局 |
| `icon-lt-rt-73` / `icon-lt-rt-82` | 7:3 / 8:2 布局 |

### 图表与统计

| iconCls | 用途 |
|---|---|
| `icon-chart-pie` | 饼图 |
| `icon-chart-bar` | 柱状图 |
| `icon-chart-doughnut` | 环形图 |
| `icon-chart-radar` | 雷达图 |
| `icon-chart-sum` | 图表求和 |
| `icon-chart-year` | 年图表 |
| `icon-bar-graph` / `icon-bar-diag` | 条形图 |
| `icon-curve-diag` | 曲线图 |
| `icon-stacked-diag` | 堆叠图 |
| `icon-rose-diag` | 玫瑰图 |
| `icon-thermal-diag` | 热力图 |
| `icon-cloud-chart` | 云图 |
| `icon-data-stat` | 数据统计 |
| `icon-paper-stat` | 病例统计 |
| `icon-paper-chart` | 使用频次 |
| `icon-h24-stat` | 24小时统计 |
| `icon-green-chart` | 推荐检查方案 |

### 白色主题图标 (icon-w-*)

白色主题变体，语义与对应基础图标一致：

| iconCls | 用途 |
|---|---|
| `icon-w-add` | 新增 |
| `icon-w-edit` | 修改 |
| `icon-w-save` | 保存 |
| `icon-w-cancel` | 取消 |
| `icon-w-close` | 关闭 |
| `icon-w-find` | 查找 |
| `icon-w-update` | 更新 |
| `icon-w-print` | 打印 |
| `icon-w-export` / `icon-w-import` | 导出 / 导入 |
| `icon-w-upload` / `icon-w-download` | 上传 / 下载 |
| `icon-w-eye` | 查看 |
| `icon-w-home` | 主页 |
| `icon-w-list` | 列表 |
| `icon-w-new` | 新建 |
| `icon-w-ok` | 完成 |
| `icon-w-key` | 授权 |
| `icon-w-cal` / `icon-w-calc` | 计算 / 计算器 |
| `icon-w-config` | 配置 |
| `icon-w-filter` | 过滤 |
| `icon-w-clock` | 时钟 |
| `icon-w-switch` | 交换 |
| `icon-w-copy` | 复制 |
| `icon-w-msg` | 信息 |
| `icon-w-star` | 星标 |
| `icon-w-stamp` | 印章 |
| `icon-w-card` | 卡片 |
| `icon-w-clean` | 清除 |
| `icon-w-file` / `icon-w-file-open` | 文件 / 打开文件 |
| `icon-w-paper` | 文档 |
| `icon-w-plus` | 附加 |
| `icon-w-other` | 其他 |
| `icon-w-back` | 回退 |
| `icon-w-submit` | 提交 |
| `icon-w-reset` | 重置 |
| `icon-w-zoom` | 放大 |
| `icon-w-arrow-up` / `icon-w-arrow-down` | 上移 / 下移 |
| `icon-w-arrow-left` / `icon-w-arrow-right` | 左移 / 右移 |
| `icon-w-batch-cfg` / `icon-w-batch-add` | 批量配置 / 批量添加 |
| `icon-w-epr` | 电子病历 |
| `icon-w-img` | 图片 |
| `icon-w-predrug` | 备药 |
| `icon-w-paid` | 支付、出院结算 |
| `icon-w-pen-paper` | 申请类 |
| `icon-w-scan-code` | 扫码 |
| `icon-w-camera` | 照相机 |
| `icon-w-stop` | 停止、停止医嘱 |
| `icon-w-volume-up` | 通知 |
| `icon-w-book` | 个性化宣教内容 |
| `icon-w-trigger-box` | 触发 |
| `icon-w-rent` | 租用单 |
| `icon-w-run` | 执行计划 |
| `icon-w-line-key` | 论证 |
| `icon-w-takes` | 接送单 |
| `icon-w-setting` | 附属设备、设置 |
| `icon-w-skip-no` | 跳号 |
| `icon-w-pause-circle` | 暂停 |
| `icon-w-canceldrug` | 撤销退药 |

### 大图标 (icon-big-*)

用于大尺寸场景（工具栏、卡片、功能入口等），语义与基础图标对应：

| iconCls | 用途 |
|---|---|
| `icon-big-home` | 主页 |
| `icon-big-save` | 保存 |
| `icon-big-del` | 删除 |
| `icon-big-clear` | 清除 |
| `icon-big-refresh` | 刷新 |
| `icon-big-print` | 打印 |
| `icon-big-unlock` | 解锁 |
| `icon-big-stop` | 禁止通行 |
| `icon-big-start` | 开始 |
| `icon-big-return` | 返回 |
| `icon-big-help` | 帮助 |
| `icon-big-search` (→ `icon-big-paper-search`) | 信息搜索 |
| `icon-big-paper` | 文档 |
| `icon-big-paper-pen` | 修改、医嘱录入 |
| `icon-big-paper-arrow` | 上交文档 |
| `icon-big-paper-print` | 打印处方 |
| `icon-big-paper-time` | 报表展示 |
| `icon-big-paper-search` | 病例查询 |
| `icon-big-book-eye` | 查看病历 |
| `icon-big-book-ref` | 引用文档 |
| `icon-big-book-arrow` | 返回就诊信息 |
| `icon-big-open-eye` / `icon-big-close-eye` | 打开/关闭预览 |
| `icon-big-img` | 图片信息 |
| `icon-big-tooth` | 牙齿 |
| `icon-big-card` / `icon-big-card-reader` | 卡 / 读卡器 |
| `icon-big-read-card` | 读卡 |
| `icon-big-idcard` | 身份证 |
| `icon-big-patient` (→ `icon-big-pat-list`) | 病人列表 |
| `icon-big-doctor-green` | 急诊绿色通道 |
| `icon-big-doctor-adm` | 医生接诊 |
| `icon-big-position` | 定位 |
| `icon-big-omega` | 特殊符号 |
| `icon-big-favorite` / `icon-big-favorite-add` | 收藏 / 增加收藏 |
| `icon-big-fee-arrow` | 费用、缴费 |
| `icon-big-paid` | 付款、交押金 |
| `icon-big-stamp` | 盖章 |
| `icon-big-change-account` | 账单修改 |
| `icon-big-inspect` | 医生检查 |
| `icon-big-disuse` | 弃用 |
| `icon-big-maint` | 维护 |
| `icon-big-meterage` | 测量 |
| `icon-big-bar` | 扫描 |
| `icon-big-rad` | 放射 |
| `icon-big-balance` | 天平、称重 |
| `icon-big-alert` / `icon-big-alert-yellow` | 警告 / 指标预警 |
| `icon-big-tip` | 暂无回复、提示 |
| `icon-big-msg` | 报告提醒 |
| `icon-big-question` | 问题提问 |
| `icon-big-ring-blue` / `icon-big-ring` | 蓝色/橙色预警广播 |
| `icon-big-ca-green` | CA 认证、签名 |
| `icon-big-pre` / `icon-big-next` | 上/下一页 |
| `icon-big-open-file` | 资料归档 |
| `icon-big-save-next` / `icon-big-save-add` | 保存&下例 / 保存&新建 |
| `icon-big-insert-table` / `icon-big-delete-table` | 插入/删除表格 |
| `icon-big-insert-row` / `icon-big-delete-row` | 插入/删除行 |
| `icon-big-insert-col` / `icon-big-delete-col` | 插入/删除列 |
| `icon-big-split-cells` | 划分单元格 |
| `icon-big-font-size` | 字体大小 |
| `icon-big-lt-rt-*` | 布局比例（19/28/37/46/55/73/82） |
| `icon-big-drug-ok` / `icon-big-drug-x` | 发药 / 拒绝发药 |
| `icon-big-drug-back` / `icon-big-drug-forbid` | 退药 / 拒绝退药 |
| `icon-big-medibottle` / `icon-big-medibottle-run` | 配药 / 自动配药 |
| `icon-big-card-money` | 卡消费 |
| `icon-big-printer-refresh` | 重新打印 |
| `icon-big-redlabel-refresh` | 打印标签 |
| `icon-big-upload-img` / `icon-big-collect-img` / `icon-big-capture-img` | 上传/收集/截取图片 |
| `icon-big-insert-local-image` / `icon-big-edit-picture` / `icon-big-image-properties` | 插入/编辑/属性 图片 |
| `icon-big-creating-a-pedigree-map` / `icon-big-edit-pedigree-chart` | 创建/编辑谱系图 |
| `icon-big-spec-clean` | 标本清理 |
| `icon-big-print-slides` | 玻片打印 |
| `icon-big-material-coll` | 耗材收集、取材 |
| `icon-big-prev-diag` | 历次诊断 |
| `icon-big-molecular-order` / `icon-big-tec-order` | 分子/技术 医嘱 |
| `icon-big-insert-spec` | 插入标本 |
| `icon-big-miss-img` | 默认图片（未找到图片时） |

### 文本格式

| iconCls | 用途 |
|---|---|
| `icon-bold` | 加粗 |
| `icon-incline` | 斜体 |
| `icon-underline` | 下划线 |
| `icon-strikethrough` | 删除线 |
| `icon-subscript` / `icon-superscript` | 下标 / 上标 |
| `icon-indentation` / `icon-unindent` | 缩进 / 取消缩进 |
| `icon-align-left` / `icon-align-center` / `icon-align-right` | 左/中/右对齐 |
| `icon-align-justify` | 两端对齐 |
| `icon-font` | 字体 |
| `icon-double-quotes` | 双引号 |

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

- 更新本文件时，先用本地 `${HISUI_SRC}/dist/js/jquery.hisui.js` 校验关键行号。
- 若目标工程保留多个 HISUI 索引副本，需同步更新并校验内容一致。
- 本文件只记录通用 HISUI 前端编码经验和源码入口，不写入服务器、namespace、远程路径、业务页面清单或当前工程绝对路径。
