# cure-form-interaction-report/v1

新建 CA/CR 表单以人工交互验收为默认路径。`interaction-prepare` 生成 JSON 报告骨架和同名 Markdown 清单；`interaction-check` 只校验人工记录完整性、测试方式和 artifact 哈希绑定，不点击、输入、选择或修改页面状态。

## 两阶段

- `pre-deploy`：绑定已批准规格、changes、snapshot、`cure-form-preview-verification/v1` 和 preview manifest。工具从 numberbox、选择控件、`calculations[]`、`visibilityRules[]` 生成必测项，并固定加入单位及左右侧去重检查。业务专属联动写入 `customCases[]`，canonical 不保存业务字段 ID。
- `post-deploy`：绑定 `cure-form-package/v1` 与 operation ID。CA/CR 均验证保存、重开、回显和打印；CR 另验证 `SaveCureRecord`、`CureExpJsonStr`、`MapID`。

number 字段可在字段自身或 `validation` 对象中声明 `min`、`max`；声明后清单增加对应边界用例。整数、小数和空值始终生成。`requiredCases[]` 由工具生成且不得修改或删除；额外业务用例只能追加到 `customCases[]`。

## 人工结果模式

- `user-attested`：用户亲自测试后明确告知已通过。`execution` 必须记录 `testedBy`、有效 `testedAt`、非空 `summary` 和 `overallStatus=passed`；无需逐项填写 `results[]`，截图或录像可选。
- `agent-manual`：Agent 在本地完整预览中逐步操作。必须记录测试环境，并为全部必测项和自定义用例填写 `status=passed`、非空 `actualResult`；`evidence[]` 可选。
- `automated`：v1 不接受。任何批量脚本化点击、输入或选择必须先向用户说明范围、页面状态影响和清理方式，取得明确确认后才能另行设计或执行；canonical `preview-run` 只读采集不属于自动交互。

`interaction-check` 生成 `cure-form-interaction-verification/v1`。新表单是最终 package 的 `expectedVersion=NEW`；此时 `plan` 必须提供 `--interaction-verification`，并把通过凭证写入 package。存量表单改造不强制该凭证。

部署后验证失败时停止交付并报告，不自动回滚。真实服务器上的保存操作仍受写入授权约束；用户未授权时由用户执行并提供 `user-attested` 结果。
