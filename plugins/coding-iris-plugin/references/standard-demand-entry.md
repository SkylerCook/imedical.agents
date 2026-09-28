# Standard 需求草稿与工具协议

入口：`skills/iris-demand-entry/SKILL.md`。所有命令使用插件内 `scripts/iris-tools/demand-entry.js`（下文简写）；只用 Node 内置模块，无需 npm install、Python 或个人运行器路径。工具不调用 BOSS，也不修改 Git。`collect`、`prepare`、`bind`、`render` 的输出路径若落在 `.agents/` 或能力包源码中（包括通过目录链接到达），会在写入前停止；输入文件可从旧位置读取，以便迁出既有产物。

## 1. 读取代码事实

用户入口优先采用 skill 的 `--text / --bind <编号> / --plan / --commit / --help`，完整参数表以 SKILL.md 为准。下文为 Agent 内部脚本协议，不直接接受这些 skill 模式；历史来源在用户层使用 `--rev`，底层 collect 才使用 `--commit <hash>`，不得混淆。`--bind --same-title` 由 Agent 读取所选条目的 title，传给下方 bind 的 `--title`。现有脚本接口不变。

```text
node demand-entry.js collect --repo <GitRoot> --file src/a.cls --file src/b.js --output <临时目录>/facts.json
node demand-entry.js collect --repo <GitRoot> --commit <hash1> --commit <hash2> --output <临时目录>/history.json
node demand-entry.js collect --repo <GitRoot> --range <base>..<head> --output <临时目录>/history.json
```

`--repo` 必须是明确选定的 GitRoot。未提交来源覆盖指定文件的 staged、unstaged、非忽略 untracked；同时保存 HEAD、状态、补丁与文件字节指纹。历史来源解析为完整 hash，可加 `--file` 缩小范围；合并提交拒绝猜测主线。支持初始提交取证；尚无 HEAD 的新仓库不支持。删除/重命名要覆盖需求涉及的旧、新路径。

脚本不做业务推理；Agent 阅读实际 patch 后编写 spec。每个需求每仓库取证一次，避免把整次迭代的文件直接分配给每条需求。多条待提交需求共用文件，或多条历史需求共用同一提交的同一文件时，脚本阻止自动归属，需先拆分；不同历史提交修改同一文件可以分别提报。不支持同文件按 hunk 自动提交。

## 2. 编写 spec 并输出

```json
{
  "kind": "standard",
  "common": { "需求类型": "产品BUG", "模块编码": "用户提供的编码" },
  "requirements": [{
    "key": "r1",
    "name": "{IRIS} 模板维护-空内容暂存时仍提示成功",
    "title": "模板维护支持空内容提示",
    "description": {
      "format": "bug",
      "steps": ["进入模板维护界面，新增模板。", "填写其它必填项，保持模板内容为空，点击【暂存】。"],
      "expected": "提示模板内容必填并定位输入框，不保存空内容模板。",
      "actual": "模板内容为空时仍提示暂存成功。"
    },
    "type": "fix",
    "subject": "模板维护",
    "verification": "填写实际执行的验证与结果，不编造通过状态",
    "fields": {},
    "changes": [{
      "evidence": "facts.json",
      "modification": "增加模板内容必填校验，在空内容保存时显示提示并聚焦输入框，避免提交无效模板"
    }]
  }]
}
```

`evidence` 相对 spec 目录解析；prepare 将证据嵌入 draft，后续不依赖该临时文件。`key` 为稳定映射键；`name` 是 BOSS 需求名称，新模板须以 `{IRIS} ` 开头。`title` 留作编号回填与提交衔接，不在新描述中重复输出；缺省取 name 去除前缀后的文字。每个 change 对应一个仓库的事实与修改说明。

新 spec 使用 `description`，`format` 按业务目的选择，与 Git 提交 `type` 分开：

| format | 必填字段 | 描述顺序 |
|---|---|---|
| `bug` | `steps`、`expected`、`actual` | 操作步骤、预期结果、实际结果 |
| `change` | `summary`、`steps`、`expected` | 需求说明、操作步骤、预期结果 |

`steps` 是非空字符串数组，每项不预写序号，渲染时自动编号；其它正文支持字符串或段落数组。`bug` 不接受 `summary`，`change` 不接受 `actual`，避免正文被静默遗漏。功能/改进的 description 示例：

```json
{
  "format": "change",
  "summary": "模板列表支持按名称筛选，便于定位所需模板。",
  "steps": ["进入模板列表，输入已存在模板的名称并查询。", "清空查询条件并重新查询。"],
  "expected": ["按名称返回匹配模板。", "清空条件后恢复完整列表。"]
}
```

用户、安全组、科室按 skill 的可选规则处理，不设必填字段或空占位。必要条件直接融入步骤。`remarks` 可省略，仅影响复现或验收的限制才填写；实际验证记录存 `verification`，不会自动进入 BOSS 正文。示例是合成场景，真实现象、控件和结论须按当前需求取证。

`imported: true` 表示已录 BOSS，文本/Excel 不重复输出；bind 后也自动排除。`common`、`fields` 仅供 Excel，不改变默认文本流程。

```text
node demand-entry.js prepare --spec <spec.json> --output <新交付目录>
node demand-entry.js prepare --spec <spec.json> --output <新交付目录> --excel
node demand-entry.js render --draft <draft.json> --output <新交付目录> --Excel
```

输出 `draft.json`、逐条 `r1.txt`，可选 `requirements.xlsx`。输出目录必须尚不存在，脚本不覆盖旧产物。文本默认不要求模块编码；Excel 缺字段时先不带标志生成文本，再补充 draft.common/requirements[].fields 并 render 到新目录。草稿正文允许人工编辑，证据不能编辑，代码变化必须重新 collect/prepare。回填后的草稿和旧草稿区分保存，向用户说明最新路径。

新文本分为“需求名称”和“需求描述”两个填写块，正文使用 `【小标题】`、编号步骤和段落间空行；Excel 需求名称列与文本同源，需求描述列仅包含同一三段式正文及可选备注。Agent 在聊天交付时分别展示两块内容，不再次改写生成文本。标版修复可以独立提报。

草稿使用 `iris-standard-demand/v2`，仅接受上述三段式 description；旧草稿不兼容，需根据当前需求重新生成，不提供迁移分支。已有 Git 提交记录不受影响。

## 3. 回填及提交衔接

```text
node demand-entry.js bind --draft <draft.json> --item r1 --demand <需求号> --title <BOSS最终标题> --output <bound.json>
node demand-entry.js message --draft <bound.json> --item r1
node demand-entry.js plan --draft <bound.json> --item r1 --project-root <WorkspaceRoot>
```

bind 只记录用户给定编号与最终标题，不要求 Git 当前无漂移；message/plan 才校验，以便等待期间先保存编号。不同条目不能绑定同一编号；已绑定编号/标题不会静默覆盖。需要纠正时由 Agent 按用户明确指示复制并编辑新草稿中的 boss 映射，再校验，不修改证据。

message 复用 `commit-demand.js` 的 buildMessage/validateModification。plan 仅适用于全部为 worktree 的来源，由原提交工具重新校验 WorkspaceRoot/Overlay 和实际 GitRoot，生成标准计划；不做 pull/add/commit。历史来源即使当前出现其它未提交修改也拒绝 plan。用户明确提交后按 iris-demand-commit 运行 apply/verify；本工具没有 apply/commit/rewrite 命令。

## Excel 导入契约

按原 `requirement-entry` 产品需求模板的 Sheet1、29 列 A–AC 输出：

```text
需求类型, 需求名称, 发起组, 发起人, 模块编码, 模块, 产品组, 指派人,
创建日期, 执行日期, 最后更新日期, 紧急程度, 标志工作量, 难度系数,
加入标准版, 严重等级, 需求描述, 内部项目工作包编号, 模块页面信息编号,
需求截图1\n(仅单元格图片), 需求截图2 … 需求截图10
```

- 必填需求名称/模块编码；发起组与发起人可空，由 BOSS 登录信息处理。
- 指派人不设 horizontal=center，不复制示例行特殊白色填充；不含模板示例数据，数据后空一行保留原“注：”说明。
- 难度系数限定 0.2/0.5/1/2/3/4/5，严重等级限定 1–5；日期为有效 `yyyy-mm-dd`，使用日期显示格式。未知列拒绝，避免拼写错误造成静默丢失。
- 单元格文字按 inline string 写入，`=...` 等文本不会变成公式；单元格超过 Excel 32767 字符上限时停止。
- 截图十列保留为空，本版不生成单元格内嵌图片；拒绝用文件名、图片路径或普通文本冒充截图。其它模板、自定义列与截图导入不在本版范围。
- 复用原列与语义，不依赖个人模板绝对路径；实现使用 Node 内置模块输出 OOXML，无共享运行时新增依赖。源模板表头来自用户授权提供的本地 skill，未复制样例中的人员或私有业务数据。

## 验证与兼容范围

维护专项：`node --test scripts/tests/standard-demand-entry.tests.js`。CI 定义于 `.github/workflows/standard-demand-entry.yml`，Windows/macOS/Linux × Node 22/24；CI 文件存在不代表矩阵已运行。BOSS 实际导入须用户在业务系统确认，结构读取通过不等同于 BOSS 验收。

已部署工程更新能力包后，对 enabled coding-iris-plugin 重建 thin-index 可发现新入口；旧 iris-demand-commit --plan/--commit 不变，无旧文件删除或配置迁移。本轮不自动更新业务副本或修改个人 requirement-entry skill。
