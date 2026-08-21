---
name: cure-form-responsive
description: 将服务器或本地已有 CA/CR 治疗表单改造成 PC、手机/PDA、PAD 响应式模板，同时保持所有运行时契约；也用于公共模板的版本化响应式迁移。
---

# Cure Form Responsive

1. 先通过 `inspect` 或本地文件建立完整快照，确认 MapType 是 CA/CR。
2. 列出 DOM ID、缓存标签、radio `name/value`、函数入口、模板组成和公共模板引用基线。
3. 先从目标工程配置与现有资源引用识别公共响应式样式文件；不得在插件规则中写死工程路径。公共响应式样式只允许保存跨表单复用的断点、伸缩、触控和 HISUI 兼容规则。
   - 表单专属配色、字段布局、业务矩阵、提示区和模块选择器必须进入独立 `<moduleId>.css`。
   - 宿主不能直接声明业务 stylesheet 时，由表单 JavaScript 幂等加载该外部 CSS；禁止把 CSS 文本拼进 JavaScript。
   - 生成和验收必须检查公共响应式样式未出现 moduleId、业务根 ID 或仅由单一表单使用的 class。
4. 不改变 CA/CR 保存、回显、打印和初始化接口。
5. 先区分生命周期：新开发表单直接创建正式模板，不使用灰度；只有现有模板改造才创建响应式灰度 RowID。
   - 单 Map 独占灰度模板验收通过后执行 `consolidate`，把响应式内容合并回 `APP_LastID` 指向的正式 RowID。
   - 多 Map 共用公共灰度模板验收通过后执行 `consolidate-shared`，一次性切换全部受影响 Map 并回归已有正式 RowID。
   - 合并后执行 `verify` 并重新检查 Map 组成；正式 RowID 已生效、灰度引用数为 `0`、灰度模板及缓存均不存在，才可完成现有模板改造。
   - `cleanup` 只处理引用切换后遗留的零引用旧模板，不能替代正式 RowID 合并，也不用于新开发表单。
6. 遇到 radio、表格内控件或公共 CSS 改动时，完整阅读 `../../references/cure-form-responsive-compatibility.md`；保留 `label.radio`、`i-label-box` / `m-label-box` 与对应 `input` 的完整配对，不得无条件隐藏 HISUI 原生圆圈。
7. 旧 WebView 不支持用于条件重绘的选择器时，保留 HISUI 原生 radio 作为 fallback；若窄宽度仍把圆圈与文字拆行，仅对 `for/id` 一致的完整三节点做幂等原子包装，且必须连同 input 一起移动以保持 `input + label.radio` 邻接。具体 wrapper/class 属于目标工程，不进入插件；不得以现代浏览器视觉通过替代旧内核验证。
8. 运行静态契约检查后，用 canonical `preview` 生成完整页面；资源必须从目标 profile 或 `--page-html` 解析，不得使用临时脚本补齐。
9. 使用 canonical `preview-run` 通过 Chromium CDP 在九档宽度调用页面的 `window.__cureFormPreviewCheck()`，再用 `preview-check` 生成绑定当前 gate、runner、六类资源、CSS 依赖及结果哈希的验收凭证；不得用人工拼装 JSON 代替。普通布局和表格单元格都要覆盖完整配对、点击同步、选中态与横向溢出。旧内核另验包装幂等、未配对节点不变和圆圈/文字不拆行。
10. `plan --changes` 必须传入通过的 `--preview-verification`；浏览器模拟结果与旧 WebView、真实触控设备结果分别记录。
