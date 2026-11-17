# UI 评审经验回流验证

本轮直接维护 canonical 源仓，基点为 313e549f5edfd23272f75703baaf093033bd2f96。来源为同一批已完成人工验收的 UI 返修；重复纠正不计为独立命中。业务原图、身份、部署及验收回执留在原项目，本文只保留匿名方法。

## 归属与修改

| 经验 | 归属及落地 | 推广边界 |
| --- | --- | --- |
| IHOS 与 PURE 既有共性也有差异 | imedical-ui 按对象语义分别判断分组结构与颜色、透明度、paint 开关 | 单主题证据不覆盖另一 family，也不缩小已明确的业务兼容范围 |
| 只要求描边透明 | 明确保留原背景、阴影及 hover/focus；公共组件自身外观归公共 owner | 不把某附件卡片的表面推广为所有卡片规范；患者信息条等共享组件不在业务页各自覆盖 |
| 表单间距及上下框体对齐 | 明确文字、label 盒、字段组、原生控件 wrapper 的测量端点，计入 padding | 不全局清零 label；上下对齐比较实际外框的左右边缘与外宽 |
| 子页贴边但宿主有条带 | iris-ui 同时检查父原生 wrapper、iframe 及子页局部坐标 | 隐藏 marker 为零和子页 left=0 都不能单独证明无父级占位 |
| 样式命中却未生效 | 对上最终长属性及胜出规则，检查简写和重要性；只在已确认范围处理 | 不全局堆重要声明；分隔色引用当前主题语义，不能复制单一色值 |

版本为 imedical-ui 0.2.2、iris-ui 0.3.15，后者最低依赖前者 0.2.2。已有 skill/rule/reference 路由补充触发条件，公开 collectUiMetrics API、生产 CSS、安装器与部署器均未改变。owner AGENTS、能力目录、使用指南和更新 runbook 的现有职责与入口仍有效，无新增配置或迁移。plugin catalog 完整重生成。

## 本机定向验证

Windows / Node 24.14.1：

- UI 三组专项 47/47，通过范围为 imedical-ui、iris-ui 与 theme-scope，含 PowerShell 7／Windows PowerShell 5.1 薄索引。原有依赖测试写死过期 minor 上限，基线已失败；改为使用现有 semver 范围验证当前依赖可被消费，继续保留依赖图环路检查。
- 复用现有匿名 loopback 夹具扩展四类反例，server 新路由先红后绿；卡片取色初次从透明 panel 取得，真实渲染暴露对照无效后改为从已初始化 combobox 外框取色。颜色和合成阴影均明确不是公司卡片规范。
- PURE 与 vben＋bgseablue 的实际 CSS、JS style 与 body theme 匹配；两者 label 右内距均为 10px，nominal gap=20px 时文字到框体为 30px，修正对照为 20px。当前 vendor 的此值仅作机制证据。
- 两主题原生 parent split 可见间距均为 10px，join 后为 0；子页 grid 局部 left 始终为 0，复现仅量子页会漏判的机制。
- 两主题 border-only 保留白色诊断背景及合成阴影，错误 whole-surface 对照透明且无阴影；vben 分隔基准为 rgb(207,213,245)，PURE 为 rgb(228,228,228)，普通透明覆盖输给 important 基准，局部长属性对照生效。
- 观察到的 HTTP 夹具与 vendor 资源均成功返回，Network 未见 loadingFailed。Console 有 MutationObserver 参数错误；调用栈为无 URL 的 script 4 并含 node:electron/js2c/sandbox_bundle，夹具及已加载 JS 未发现该 API。现有证据不能归因于夹具，也不声称 Console 全部无错；未为此更改产品或宿主。
- 匿名测试页与 loopback 服务已关闭；未操作业务页面或修改业务数据。
- 最终 16 份变更／新增 Markdown 的 320 个本地链接及锚点、UTF-8、plugin catalog check 和 diff 检查通过。独立复审发现一处测试仅断言 parseSemver 不抛错却未排除 null，已改为断言有效返回值并验证正反例；修正后 47/47，无剩余 P1/P2。
- 精确暂存 25 个本轮文件；staged 版本门禁核对两 changed owner 及一个直接依赖，component-version-ok。当前全仓既有信创历史债务不属于本次暂存范围，未改历史发布记录。

[匿名海蓝对照截图](ui-review-feedback-2026-11-18/anonymous-vben.jpg)保留诊断样本；真实工程版本、焦点／悬浮行为、不同宿主与跨平台仍须按实际变更验证。未执行新的业务副本部署或人工验收；不据本机夹具宣称所有主题或所有业务组件已通过。

## 资料与向量一致性

用户明确授权五份匿名 UI 参考约九个增量文本块发往现有公司 embedding 服务；其余资料复用缓存。provider=company、model=bge-m3、dimensions=1024。构建回执 complete=true、remainingVectors=0、embeddingTokens=5780、warnings=[]；价格未配置，费用保持未知。

本地固定题集出处命中与条件文本均 30/30，与原本地基线一致，semanticCases=0；四个新增 UI 机制问题也在 Top-6 命中预期 owner。未新增对外语义查询；条件出现不等于答案正确。现有 export 导出 3709 个片段／3706 个去重向量，独立只读 quick_check=ok。generation 为 484f249de8a8207381418e1101f6e5478602630190fa8ff492745215a5c91ce0；导出入口逐项校验当前内容的向量后原子替换。

## 交付边界

仅提交本轮源仓文件；保留已有无关工作台计划改动。正常框架更新取得两个 owner 及可选公司索引，Overlay 工程沿原刷新流程，未直接修补部署副本。未完成的真实副本／宿主及平台观察继续归既有 P2 UI 验证队列，不另建强制门禁。
