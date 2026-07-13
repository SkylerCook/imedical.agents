# 需求处理通用经验

> 积累自实际需求实施过程的通用检验清单与踩坑记录，按分类组织。

## 维护规则

1. **去重 + 累积**：新增经验前搜索已有条目。若知识点已存在，不重复内容，仅在「需求」行追加新需求号，并 `命中+1`。
2. **需求追溯**：每条经验记录「需求」行，列出命中该经验的所有需求号。跨多个需求沉淀的通用经验标注 `(通用)`。
3. **命中计数**：「命中」数字表示该经验被多少个需求触发过。没有具体需求号时只递增计数。
4. **分类追加**：新经验按分类（后端/前端/需求分析/检验清单）追加到对应章节末尾。
5. **经验粒度**：一条经验对应一个独立知识点，避免混合多个不相关主题。
6. **可操作性**：必须包含具体做法或示例代码，避免仅描述问题而无解决方案。
7. **反哺标记**：当候选经验被提升为 plugin rule 时，在本条目中追加「已提升: `rules/xxx.md`」标记，不删除原条目。
8. **领域标签**：如果某个领域独立性足够强（如纯 i18n 打印经验），在章节标题后标注类型标签（如 `(i18n)`），方便后续筛选或拆分。
9. **需求索引**：新增经验条目时，同步更新文档末尾的「需求索引」章节。

### 条目格式

```markdown
### x.x 标题
- 需求: #6990066 #7001234 | 命中: 2
- **正文**...
```

---

## 一、后端 - IRIS 持久化类修改

### 1.1 新增字段必须追加到末尾
- 需求: #6990066 | 命中: 1
- **规则**：`%Persistent` 类新增 Property 只能放在已有属性之后（updateDateTime 之后），绝不能插入中间位置。
- **原因**：ObjectScript Storage 使用 `$lg(global(id), position)` 按位置存取，中间插入会导致历史数据全部错位。
- **Storage 块**：编译持久化类时自动重新生成，无需手动修改 `<Value>` 节点。新增字段后编译器会自动追加到 Storage。
- **SqlColumnNumber**：新字段使用当前最大值 +1（如原最大 20，新字段用 21），但实际 SQL 映射由编译器管理，手动标注仅作文档用途。
- **已回归/已提升**：`plugins/coding-iris-plugin/rules/iris_coding_backend.md`

### 1.2 SQL 语句同步
- 需求: #6990066 | 命中: 1
- 新增字段后，所有涉及该表的 `INSERT`/`UPDATE` 语句（通常在 `*SQL.cls` 文件中）都需同步添加新字段。
- 检查清单：`Insert` 方法、`Update` 方法、`Import` 相关方法、`ImportTemplate` Query。
- **已回归/已提升**：`plugins/coding-iris-plugin/rules/iris_coding_backend.md`

### 1.3 查询排序中 NULL 值处理
- 需求: #6990066 | 命中: 1
- **问题**：`ORDER BY field` 在 IRIS SQL 中 NULL 值排在最前（升序），导致有值的记录反而沉底。
- **解决方案**：使用标准 SQL 函数 `COALESCE(field, fallback)` 替换 NULL。
  ```sql
  ORDER BY COALESCE(sort_no, 999999)
  ```
- **注意**：IRIS 不支持 ODBC 转义语法 `{fn COALESCE(...)}`，会报 `SQLCODE: -40 ODBC escape extension 'FN' not supported`。直接使用 `COALESCE()` 即可。

### 1.4 `GetCustomRows` 支持 ORDER BY
- 需求: #6990066 | 命中: 1
- `GetCustomRows` 的 `whereSQLStr` 参数支持附加 `ORDER BY` 子句。
- 参考项目中的已有用法（如 `ApplReworkDATA`、`MainworkBLH`），确认 `ORDER BY` 可以直接拼接到 `WHERE` 子句后面。

### 1.5 `while` 循环内不能 `q` + 返回值
- 需求: #6941550 | 命中: 1
- **错误**：在 `while` 循环内直接 `q msg` 试图同时退出循环并返回结果。
- **后果**：IRIS ObjectScript 中 `q` 在 `while` 内只退出循环体，返回值会被忽略或导致后续代码异常执行，使得 `ts`/`tc`/`tro` 和返回逻辑混乱。
- **正确做法**：循环内仅用 `q` 退出循环（不返回值），外层变量（如 `errMsg`）暂存错误信息，循环外统一判断：
  ```objectscript
  while (iterator.%GetNext(.key, .row)) {
      s ret = ..Save(row, sessionStr)
      if (+ret '= 0) {
          s errMsg = ret
          q   ; 只退出循环
      }
  }
  if (errMsg '= "") {
      tro
      q ..GetReturnJSON(2001, errMsg)
  }
  tc
  q ..GetReturnJSON(0, "success")
  ```

### 1.6 `$g()`/`$s()` 等内置函数不适用于 `%DynamicObject`
- 需求: #6941550 | 命中: 1
- **错误**：使用 `$g(row.remark)` 或 `$s(row.prop)` 访问 `%DynamicObject` 的属性。
- **后果**：`$g()` 面向局部变量/多维数组节点，对 `%DynamicObject` 报 `*Class '%Library.DynamicObject' does not support MultiDimensional operations`。
- **正确做法**：`%DynamicObject` 的属性访问直接用 `row.remark` 或 `row.%Get("remark")`，空值安全由 `%DynamicObject` 自身保证（不存在的属性返回 `""`）。
- **例外**：`%FromJSON()` 创建的对象在 JSON 中不存在该属性时，访问不存在的属性返回 `""`（与 `$g()` 行为一致），无需额外包装。

### 1.7 命令式 `i/e` 与块式 `if/else` 不能混用
- 需求: #6096150 | 命中: 1
- **问题**：将原单行命令式分支 `i condition s ...` 改为花括号块后，仍保留下一行的命令式 `e s ...`，会在类编译时报 `#1026: Invalid command : 'e'`。
- **规则**：同一条件分支必须完整采用一种结构；单行命令式使用配对的 `i ...` / `e ...`，块式统一使用 `if ... { ... } else { ... }`，不能交叉混用。
- **正确做法**：
  ```objectscript
  if condition {
      s value="A"
  } else {
      s value="B"
  }
  ```
- **验证**：重构条件分支后检查完整分支和缩进。`git diff --check` 只能发现空白问题，不能替代 ObjectScript 语法编译；未获远端编译授权时，应明确标注“仅完成本地静态检查”。
- **已回归/已提升**：`plugins/coding-iris-plugin/rules/iris_coding_backend.md`

---

## 二、前端 - HisUI DataGrid 修改

### 2.1 插入列后 editor 索引偏移
- 需求: #6990066 | 命中: 1
- **问题**：在 columns 数组中间插入新列后，保存逻辑中通过硬编码索引引用 editor 的代码需要同步调整。
- **示例**：
  ```javascript
  // 新增 sortNo 列前：unitPrice 在 editors[5]
  row.unitPrice = $(editors[5].target).val()
  // 新增 sortNo 列后：unitPrice 偏移到 editors[6]
  row.unitPrice = $(editors[6].target).val()
  ```
- **建议**：保存逻辑优先使用 `editors[j].field` 匹配字段名获取值，避免硬编码索引。但改造已有代码时需评估改动范围。
- **已回归/已提升**：`plugins/coding-iris-plugin/rules/iris_coding_frontend.md`

### 2.2 可编辑列 vs 仅展示列
- 需求: #6990066 | 命中: 1
- **字典维护页**（`ta.ct.material.js`）：列需要 `editor` 配置，用户可双击编辑。
- **关联页的材料目录**（`ta.apply.linkmaterial.js`）：仅展示，不需要 `editor`。
- **关联材料表**（linkMaterialTable）：视需求决定是否展示新字段。已保存数据通常不需要额外展示排序字段。

---

## 三、需求分析与边界确认

### 3.1 明确排序的作用范围
- 需求: #6990066 | 命中: 1
- **字典列表**：需排序 → 后端查询加 `ORDER BY`。
- **已保存的关联数据**：通常不需要排序，用户关注的是已保存的顺序。
- **确认方式**：在计划阶段明确每个界面/表格是否需要排序、是否展示新字段，避免过度修改。

### 3.2 参考已有代码模式
- 需求: #6990066 | 命中: 1
- 项目中已有类似功能实现时，优先参考其模式。例如排序实现参考 `DictionaryBlh` 的 `$tr($j(sortNo, N), " ", "0")` 补零排序 + `$o` 遍历。
- SQL 层面的排序优于应用层排序（性能更好、代码更简洁）。

### 3.3 调用链路梳理方法
- 需求: #6990066 | 命中: 1
- i18n 场景已部分提炼: `plugins/i18n-iris-plugin/rules/i18n_link_tracing.md`
1. 从入口 CSP 文件出发，找到 `<csp:Include>` 引入的 show 文件和 `<script>` 引入的 JS 文件。
2. 在 JS 文件中找到 `$cm({ ClassName, MethodName })` 调用，定位后端类和方法。
3. 在后端类中追踪完整调用链（BLH → SQL/DATA）。
4. 标注每层涉及的文件和修改点。
- **已覆盖**：`plugins/i18n-iris-plugin/rules/i18n_link_tracing.md`（i18n 场景）

---

## 四、检验清单

每次需求实施完成后，按以下清单自检（已提升通用部分: `plugins/i18n-iris-plugin/rules/i18n_verify.md`）：

| # | 检验项 | 说明 |
|---|--------|------|
| 1 | 新增字段是否放在末尾 | `%Persistent` 类新 Property 必须追加到最后 |
| 2 | Storage 是否还原 | 手动修改的 Storage 应还原，让编译器自动生成 |
| 3 | SQL 是否同步 | `Insert`/`Update`/`Import` 都要包含新字段 |
| 4 | 查询排序 NULL 处理 | `ORDER BY` 中使用 `COALESCE` 处理 NULL |
| 5 | 前端 editor 索引 | 插入列后检查硬编码索引是否需要调整 |
| 6 | 需求边界确认 | 确认每个界面是否需要排序/展示新字段 |
| 7 | 参考已有模式 | 优先复用项目中已验证的实现方式 |
| 8 | ObjectScript 条件分支 | 命令式 `i/e` 与块式 `if/else` 必须成对且不能混用 |

---

## 五、i18n XML 打印模板同步 (i18n)

### 5.1 PowerShell JsonLine framing + 中文 Windows 编码问题
- 需求: #6096272 | 命中: 1
- **问题**：`sync-xml-print-template.ps1` 使用 JsonLine framing 时，`ReadLine()` 按系统默认编码（中文 Windows 为 GB2312）解码 MCP 输出的 UTF-8 字节，导致含中文的 JSON 响应乱码，`ConvertFrom-Json` 失败。
- **根因**：`StandardOutput.ReadLine()` 使用 `Console.InputEncoding`（默认跟随系统区域设置），而非 UTF-8。
- **修复**：JsonLine 分支改用 `BaseStream` 逐字节读取 + `[System.Text.Encoding]::UTF8.GetString()` 显式解码：
  ```powershell
  $stream = $Client.Process.StandardOutput.BaseStream
  $bytes = New-Object System.Collections.Generic.List[byte]
  while ($true) {
      $b = $stream.ReadByte()
      if ($b -lt 0) { throw "MCP process closed stdout." }
      if ($b -eq 10) { break }
      if ($b -ne 13) { $bytes.Add([byte]$b) }
  }
  $line = [System.Text.Encoding]::UTF8.GetString($bytes.ToArray())
  ```
- **注意**：MCP 服务器 `iris-agentic-dev` 只支持 JsonLine framing，不支持 Content-Length framing。
- **已覆盖**：`plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1`

### 5.2 XML 模板 fontname 中文字符必须用 XML 数字实体
- 需求: #6096272 | 命中: 1
- **问题**：XML 打印模板中 `fontname="宋体"` 写入服务器后变成 `fontname="å®ä½"`（UTF-8 字节被当 Latin-1 解读）。
- **根因**：MCP 传输层对非 ASCII 字符有编码风险，尤其是 GB2312 编码的 XML 内容经过 PowerShell → MCP → IRIS 多层传递时编码不一致。
- **修复**：翻译 XML 模板时，将中文 fontname 替换为 XML 数字实体：
  ```python
  # 宋体 → &#23435;&#20307;  黑体 → &#40657;&#20307;
  text = re.sub(r'fontname="([^"]*[一-鿿][^"]*?)"', fontname_to_entities, text)
  ```
- **引用**：`i18n-xml-print-template-sync/SKILL.md` 中已有此规则："use XML numeric entities such as `fontname="&#23435;&#20307;"` to preserve the same XML value without storing raw Chinese bytes"。
- **已覆盖**：`plugins/i18n-iris-plugin/skills/i18n-xml-print-template-sync/SKILL.md`

### 5.3 IRIS GlobalCharacterStream 不需要编码转换
- 需求: #6096272 | 命中: 1
- **规则**：`%Library.GlobalCharacterStream` 在写入时已将 GB2312 转为 IRIS 内部 Unicode 存储。读取时直接 `w text` 输出即可，无需 `$zconvert` 转换。
- **反面示例**：
  - `$zconvert(text,"I","UTF8")` — 把已经是 Unicode 的码点当 UTF-8 字节重新解释，中文变 `??`
  - `$system.Encryption.Base64Encode(text)` — CharacterStream 内容直接 Base64 编码会报 `<ILLEGAL VALUE>`
- **正确做法**：直接读取、直接输出，MCP 传输层会正确处理 Unicode/UTF-8。

### 5.4 XML/Base64 长脚本出现临时代码 `<SYNTAX>` 后立即收敛
- 需求: #6096150 | 命中: 1
- **问题**：XML 已查询、导出并完成本地翻译后，继续把完整 XML 或 Base64 拼入单次 `iris_execute` 临时代码，可能在临时类编译阶段连续报 `Execute+...<SYNTAX>`；重复调整同类长脚本只会增加耗时。
- **判断**：必须检查 MCP 返回的内部 stdout/status。出现临时类 `Execute+...<SYNTAX>` 是 ObjectScript 代码载荷编译失败，不是 MCP 传输失败；已经完成的本地模板、manifest 和备份仍然有效，不应重新查询、导出或翻译。
- **收敛策略**：确认该错误后停止继续试探长段脚本，优先调用项目现有模板保存接口；没有可复用接口时，将 Base64 拆成多个短 MCP 调用写入带唯一任务键的临时 Global，最后用一段短 `iris_execute` 合并、解码并保存，随后清理临时 Global。
- **验收**：保存完成后只执行一次只读查询/导出，核对目标记录元数据、XML 可解析性和 `defaultvalue` 源语言残留，然后汇总结果。
- **自动化状态**：`sync-xml-print-template.ps1` 已实现临时类 `<SYNTAX>` 识别、单次内联尝试、Base64 分块写入 `^CacheTemp`、短调用合并保存、`finally` 清理和一次只读验收；离线回归覆盖正常保存、fallback 成功及 fallback 失败清理。
- **已回归/已提升**：`plugins/i18n-iris-plugin/skills/i18n-xml-print-template-sync/SKILL.md`、`plugins/i18n-iris-plugin/scripts/sync-xml-print-template.ps1`、`plugins/i18n-iris-plugin/scripts/tests/sync-xml-print-template.Tests.ps1`

---

## 六、i18n 前端编码与字典翻译 (i18n)

### 6.1 GB2312 编码文件的正确修改流程
- 需求: #6096272 | 命中: 1
- **问题**：Edit 工具会破坏 GB2312 编码，导致中文乱码。
- **正确流程**：
  1. 先用 PowerShell 将 GB2312 文件转为 UTF-8
  2. 在 UTF-8 编码下用 Edit 工具修改
  3. 运行 `convert-gb2312-upload.ps1` 转回 GB2312
  4. 用生成的 `.gb2312.js` 文件替换原文件
- **关键代码**：
  ```powershell
  # GB2312 → UTF-8
  $gb2312 = [System.Text.Encoding]::GetEncoding('GB2312')
  $utf8 = New-Object System.Text.UTF8Encoding ($false)
  $content = $gb2312.GetString([System.IO.File]::ReadAllBytes($file))
  [System.IO.File]::WriteAllText($file, $content, $utf8)
  ```
- **注意**：用户明确要求"不要转源文件为 utf-8"时，文件保持 GB2312 编码，上传前再用脚本转换。
- **已回归/已提升**：`plugins/coding-iris-plugin/rules/iris_coding_frontend.md`、`plugins/coding-iris-plugin/rules/iris_coding_workflow.md`、`plugins/coding-iris-plugin/scripts/check-frontend-encoding.ps1`、`plugins/i18n-iris-plugin/rules/i18n_coding_frontend.md`、`plugins/i18n-iris-plugin/rules/i18n_verify.md`

### 6.2 i18n 打印链路改造的分层处理
- 需求: #6096272 #6097879 | 命中: 2
- **固定文案**（金额单位、标签、状态标识）：
  - 后端：使用 `..%Trans()` 页面级翻译
  - 前端：使用 `$g()` 静态翻译
- **字典展示值**（科室、医生、医院等）：
  - 使用 `DHCDoc.Common.Translate.GetTransXxx()` 字典翻译门面
  - 翻译位置贴近原始字段来源（贴近原则）
- **区分标准**：固定文案是代码中硬编码的文本；字典展示值是从 Global/SQL/持久类字段取出的原文。
- **已覆盖**：`plugins/i18n-iris-plugin/rules/i18n_field_classification.md`、`plugins/i18n-iris-plugin/rules/i18n_coding_print_backend.md`

### 6.3 新增字典翻译方法的规范
- 需求: #6096272 | 命中: 1
- **触发条件**：首次遇到新的字典/表字段展示值翻译时
- **步骤**：
  1. 在 `DHCDoc.Common.Translate` 类中新增 `GetTransXxx` 方法
  2. 方法命名：`GetTrans{Domain?}{EntityAlias}{FieldAlias?}`
  3. 注释规范：desc/class/field/source/debug 五项必填
  4. 实现调用 `..%TranslateTableFieldValue(tClassName, fieldName, value, langid, qTrantable)`
- **示例**：
  ```objectscript
  /// desc:   会话类型/职称描述翻译
  /// class:  User.RBCSessionType
  /// field:  SESSDesc
  /// source: ^RBC("SESS",id) piece 2
  /// debug:  w ##class(DHCDoc.Common.Translate).GetTransSessionType("主任医师", 1)
  ClassMethod GetTransSessionType(SessionTypeDesc As %String, langid As %String = "", qTrantable As %String = "")
  {
      q ..%TranslateTableFieldValue("User.RBCSessionType", "SESSDesc", SessionTypeDesc, langid, qTrantable)
  }
  ```
- **已覆盖**：`plugins/i18n-iris-plugin/rules/i18n_dict_translate_facade.md`

### 6.4 XML 打印模板代码国际化
- 需求: #6096272 | 命中: 1
- **问题**：前端硬编码 XML 模板代码，无法根据语言选择对应模板。
- **解决方案**：
  1. 后端在打印数据中返回 `PrintTemplateCode` 字段
  2. 使用 `##class(DHCDoc.Util.Translate).GetI18nXMLPrintTemplate(xptCode, patientId)` 获取对应语言模板
  3. 前端从返回数据获取模板代码，而非硬编码
- **回退机制**：模板不存在时回退到原模板代码（如 `DHCOPAdmRegPrint`）
- **已覆盖**：`plugins/i18n-iris-plugin/rules/i18n_coding_print_backend.md`、`plugins/i18n-iris-plugin/rules/i18n_link_tracing.md`

### 6.5 字典翻译检查需覆盖被调用子方法
- 需求: #6096272 | 命中: 1
- **问题**：主方法中的字典字段已翻译，但被调用的子方法中的字典字段遗漏。
- **示例**：`GetOPPrintData` 中的字典字段都已翻译，但调用的 `GetRegitems` 方法中的 `ARCIMDesc`（医嘱项描述）遗漏。
- **检查清单**：
  1. 追踪主方法中调用的子方法
  2. 检查子方法返回值中是否包含字典展示值
  3. 子方法中的字典字段也需要翻译，翻译位置贴近原始字段来源
- **已回归/已提升**：`plugins/i18n-iris-plugin/rules/i18n_verify.md`

---

## 七、代码差异治理与提交卫生

### 7.1 历史重写时仅保留功能差异
- 需求: #6950154 | 命中: 1
- **问题**：在已有文件上做需求修改时，混入大量空格、空行、缩进抖动等无意义差异，导致评审噪音高、风险定位困难。
- **做法**：当该噪音已进入历史提交，使用“父提交起新分支 + 最小补丁重提 + rebase --onto 替换旧提交”的方式清理，而不是在原噪音提交上继续叠加修补。
- **最小补丁原则**：
  1. 只改需求直接相关的函数、参数位、控件。
  2. 禁止整文件格式化、禁止批量空白调整。
  3. 逐文件用 `git diff` 人工确认不存在仅空白变化块。
- **提交前检查命令**：
  ```bash
  git diff --check
  git show --stat <commit>
  git show -w <commit>
  ```
- **替换验证命令**：
  ```bash
  git merge-base --is-ancestor <old_commit> master
  git merge-base --is-ancestor <new_commit> master
  ```
  期望结果：旧提交不再是祖先，新提交是祖先。
- **适用范围**：所有“改已有文件”的需求开发，尤其是 ObjectScript/CSP/老 JS 文件。
- **已回归/已提升**：`hooks/pre-commit`、`scripts/check-functional-diff.ps1`、`scripts/install-git-hooks.ps1`、`docs/update-agents.md`

---

## 需求索引

| 需求号 | 描述 | 命中经验 |
|---|------|----------|
| #6990066 | 材料字典排序功能 | [1.1](#11-新增字段必须追加到末尾), [1.2](#12-sql-语句同步), [1.3](#13-查询排序中-null-值处理), [1.4](#14-getcustomrows-支持-order-by), [2.1](#21-插入列后-editor-索引偏移), [2.2](#22-可编辑列-vs-仅展示列), [3.1](#31-明确排序的作用范围), [3.2](#32-参考已有代码模式), [3.3](#33-调用链路梳理方法) |
| #6096272 | 挂号小条打印多语言 | [5.1](#51-powershell-jsonline-framing--中文-windows-编码问题), [5.2](#52-xml-模板-fontname-中文字符必须用-xml-数字实体), [5.3](#53-iris-globalcharacterstream-不需要编码转换), [6.1](#61-gb2312-编码文件的正确修改流程), [6.2](#62-i18n-打印链路改造的分层处理), [6.3](#63-新增字典翻译方法的规范), [6.4](#64-xml-打印模板代码国际化), [6.5](#65-字典翻译检查需覆盖被调用子方法) |
| #6097879 | 门诊诊断证明书打印多语言 | [6.2](#62-i18n-打印链路改造的分层处理) |
| #6941550 | 技工申请关联材料牙位录入 | [1.5](#15-while-循环内不能-q--返回值), [1.6](#16-ggs-等内置函数不适用于-dynamicobject) |
| #6950154 | 检查报告查看增加医嘱项查询（差异降噪重写） | [7.1](#71-历史重写时仅保留功能差异) |
| #6096150 | 预约条打印多语言 | [1.7](#17-命令式-ie-与块式-ifelse-不能混用), [5.4](#54-xmlbase64-长脚本出现临时代码-syntax-后立即收敛) |
