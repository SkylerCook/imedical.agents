# 治疗表单体验评审复验

在隔离项目使用匿名片段复验 [cure-form-review](../../plugins/iris-cure-form-dev/skills/cure-form-review/SKILL.md)。用目标项目的六类资源和 [完整预览流程](../../plugins/iris-cure-form-dev/references/cure-form-delivery-workflow.md#视觉质量) 跑 `preview → preview-run → preview-check`。截图用于复核首屏层级和控件状态。

## 匿名样例

| 样例 | 构造与评审预期 |
| --- | --- |
| CA 反例 | 「活动评估」两题，第一题预载一个选中项，`#review-progress` 写「已答 0/2」。将第二题包在 `.review-last` 中，在 `max-width: 430px` 时设高度、最小高度和内边距为零并隐藏溢出。评审定位选中与进度矛盾，以及窄屏末题不可达。 |
| CA 正例 | 保持同一选中项，进度显示「已答 1/2」，恢复末题内容和原有题组间距。评审核对标题、进度、题干和选项的层级与对齐。 |
| CR 重复录入 | 「活动训练记录」用两个 `.review-round` 区分「第 1 次」和「第 2 次」，预载持续时间 5 和 7 分钟。核对次数标题、字段及回显值的对应关系。追加记录和真实保存需要交互证据。 |
| 单张截图 | 仅提供 390px 的 CA 反例截图。应指出已选项与「已答 0/2」矛盾。末题裁切的原因、点击和保存行为标为未覆盖。 |

CA 题组和长选项保留常规 HISUI 初始化。下面的 `cases` 用于两版 CA 预览，阈值按本样例题组尺寸取值。

```json
{
  "cases": [
    {
      "name": "restored-progress",
      "text": [{ "selector": "#review-progress", "values": ["已答 1/2"] }]
    },
    {
      "name": "last-question",
      "visible": [{ "selector": ".review-last", "minWidth": 80, "minHeight": 36 }]
    }
  ]
}
```

CR 按实际记录顺序断言 `.review-round h3` 和对应回显文案，再查看窄宽度截图中两条记录是否一眼能区分。

## 本机结果

- Windows Chrome 九档预览。CA 反例全档检出进度问题，360、390、430px 检出末题裁切，`preview-check` 拒绝该反例。修正 CA 与两次录入 CR 均通过九档。三组的 Console、Network 与横向溢出检查均正常。
- 对照查看 390px 三组截图。CA 已选项和进度矛盾可从单张图发现。修正版的第二题可见。CR 两个条目的标题、标签和值对应清楚。真实 HIS 保存、重开、打印及旧 WebView 由业务项目按交互流程取证。
- 用 Windows PowerShell 5.1 和 PowerShell 7 分别执行隔离 standard、Overlay 的 `update-agents -Mode Write -NoPull`。四组均生成 `cure-form-review` thin-index，回读其描述和 source，源文件字节与插件定义一致。
