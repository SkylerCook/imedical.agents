---
name: hisui-style-index
description: HISUI v0.1.0 CSS 样式与资源索引，用于确认主题 class、状态样式、图标、插图、多语言视觉资源和样式覆盖边界
task-affinity: [iris, frontend, hisui, css, theme, locale, reference]
tags: [HISUI, frontend, css, theme, locale, style-reference, source-code]
category: frontend
related:
  - ../rules/iris_coding_frontend.md
  - hisui-widget-index.md
createdAt: 2026-07-18
updatedAt: 2026-07-18
---

# HISUI CSS 样式与资源索引

本文用于日常 CSP / HTML / CSS / JavaScript / HISUI 前端开发。遇到主题颜色、边框、背景、控件状态、图标、插图或多语言视觉资源不确定时，先查本索引，再读取目标页面实际加载的主题 CSS 和 locale CSS 确认。

控件选型、API 参数、事件和 JavaScript 框架行为仍查同级 `hisui-widget-index.md`。

## 样式复用优先级

1. HISUI 控件 API、语义 class、状态 class、主题和 locale 资源。
2. 目标工程公共组件及公共样式适配层。
3. 页面级最小样式。
4. 框架没有稳定入口且必须跟随主题时，读取计算后样式并只复用必要的单项属性。

业务代码引用 HISUI 的稳定入口，不复制主题颜色、边框值、背景值或资源路径，也不维护页面级主题值映射。

## CSS 源码目录

| 能力 | 源码入口 | 查证重点 |
|---|---|---|
| 默认主题 | `dist/css/hisui.css` | 控件基础 class、状态 class、图标和插图 |
| 主题变体 | `dist/css/hisui.lite.css`、`hisui.lightblue.css`、`hisui.pure.css` 等 | 同一 selector 在不同主题中的实现差异 |
| 多语言视觉资源 | `dist/css/locale/hisui*.css` | 相同语义 class 是否在目标 locale 下替换图片资源 |
| 主题资源 | `dist/css/icons/<theme>/` | 仅用于追溯 class 的资源来源，业务代码不直接引用路径 |
| 字体资源 | `dist/fonts/` | `icon-*` 等字体图标的字体文件来源 |
| 主题风格配置 | JavaScript 中的 `$.hisui.styleCodeConfig` | 仅使用源码明确暴露的稳定配置，不自行追加主题值映射 |

目标工程可能使用 vendor 中没有收录的主题或经过构建的合并 CSS。最终事实以目标页面实际加载的 CSS 为准，不能仅根据 `styleCodeConfig` 中出现的主题名称推断能力存在。

## 控件样式检索锚点

| 能力 | 优先搜索 selector / 关键字 |
|---|---|
| panel / window / dialog | `.panel`、`.panel-header`、`.panel-body`、`.window`、`.dialog-content` |
| layout / tabs / accordion | `.layout`、`.layout-panel`、`.tabs`、`.accordion` |
| button / menu | `.l-btn`、`.l-btn-hover`、`.menu`、`.menu-item` |
| textbox / combo / form | `.textbox`、`.combo`、`.validatebox`、`.datebox`、`.numberbox` |
| datagrid / treegrid | `.datagrid`、`.datagrid-row`、`.datagrid-row-selected`、`.table-splitline` |
| tree | `.tree`、`.tree-node`、`.tree-node-hover`、`.tree-node-selected` |
| 状态 | `-hover`、`-selected`、`-disabled`、`-readonly`、`-focused` |
| 通用图标 | `.icon-*`、`.icon-w-*`、`.icon-big-*` |
| 系统插图 | `.pic-sysst-*` |

先在目标主题 CSS 中搜索稳定 selector，再对比其它已启用主题和 locale CSS；不要只检查单一主题的颜色值。

## 已验证的跨主题样式入口

以下行号基于当前 vendor，升级 HISUI 后需要重新校验。

| 语义入口 | default | lite | lightblue | pure | 说明 |
|---|---:|---:|---:|---:|---|
| `.pic-sysst-nodata-region` | 4983 | 8391 | 8337 | 6145 | 区域型无数据插图 |
| `.pic-sysst-nodata-msg` | 4989 | 8397 | 8343 | 6151 | 带提示信息的无数据插图 |
| `.table-splitline` | 未发现 | 10311 | 10270 | 9442 | DataGrid 表格竖向分割线；使用前确认当前主题是否定义 |

当前 locale 目录已提供 `hisui.en.css`、`hisui.lite.en.css`、`hisui.lightblue.en.css`、`hisui.pure.en.css`。多语言视觉资源需继续确认目标页面是否实际加载对应文件。

## 常用系统插图 class

| class | 语义 |
|---|---|
| `pic-sysst-nodata` | 通用无数据插图 |
| `pic-sysst-nodata-msg` | 带提示信息的无数据插图 |
| `pic-sysst-nodata-region` | 区域型无数据插图 |
| `pic-sysst-e403` / `e404` / `e500` | 系统错误插图 |
| `pic-sysst-timeout-relogon` | 登录超时提示插图 |
| `pic-sysst-welcome` | 欢迎插图 |

## 图标 class 索引 (iconCls)

控件的 `iconCls` 参数最终引用 HISUI CSS 中的图标 class。图标名称、语义和主题资源属于样式索引；控件如何配置 `iconCls` 仍按 `hisui-widget-index.md` 的对应 API 查证。

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



## 样式职责与覆盖边界

- 业务 class 负责定位、尺寸和页面差异，HISUI class 负责框架已有的视觉、状态和资源能力；优先组合 class，不在业务 CSS 中重写同一视觉能力。
- HISUI 已管理背景、边框、字体或盒模型时，只覆盖需求必需的单项属性，避免 `background`、`border`、`font` 等简写属性清空框架已有子属性。
- 使用语义 class 前检查目标页面实际加载的全部主题和 locale CSS；若部分变体缺失，先由目标工程公共适配层提供兼容回退，再由业务页面引用。
- 兼容回退不能只判断 DOM 是否带某个 class；还要确认目标主题确实加载了对应规则，否则 class 存在也可能没有视觉效果。
- 框架没有稳定 API、语义 class 或 CSS 变量时，如需跟随主题可读取计算后样式并只复用必要属性；不要维护页面级主题颜色表。
- 对 DataGrid 合并单元格、rowspan、冻结列等结构补样式时，不重复声明会改变盒模型的边框宽度、边框样式、高度或 padding；修改后检查行高、滚动和冻结列对齐。

## 查证流程

1. 确认目标页面实际加载的 HISUI 主题 CSS、locale CSS 及加载顺序。
2. 在本索引中选择 selector 锚点，并在目标主题 CSS 中确认定义。
3. 对比目标工程启用的其它主题和 locale 文件，确认同一语义入口均存在。
4. 优先组合 HISUI class 与业务布局 class；缺少能力时再查目标工程公共适配层。
5. 必须自定义时只覆盖单项属性，并验证默认、hover、selected、disabled、readonly 等相关状态。
6. 涉及表格、弹窗或复合控件时，同时检查 DOM 结构、盒模型、滚动及冻结区域对齐。

## 维护要求

- 更新本文件时，源仓态使用 `vendor/hisui/dist/css/`，业务项目部署态使用 `.agents/vendor/hisui/dist/css/`，校验 selector、主题覆盖范围和关键行号。
- 新增索引项应记录稳定语义入口和查证方法，不收录单一业务页面的私有 class。
- 主题或 locale 文件缺失时明确标记“未验证”，不得凭其它主题推断。
- 不写入服务器、namespace、远程路径、业务页面清单或当前工程绝对路径。
