---
name: imedicalxc-doctor-print-template-design
description: HIS打印模板设计和生成技能。覆盖从Word/docx参考文档到可导入.xlsx模板文件的完整流程，包括主模板+扩展模板双生成、UUID全量重生成、Sheet4返回参数字段修正。触发词：设计打印模板、生成打印模板、新建打印模板、住院证打印、修改打印模板、打印模板适配、生成.xlsx模板、导出模板。
triggers:
  - 设计打印模板
  - 生成打印模板
  - 新建打印模板
  - 住院证打印
  - 修改打印模板
  - 打印模板适配
  - 生成.xlsx模板
  - 导出模板
  - 打印模板
  - xlsx模板
---

# imedicalxc-doctor-print-template-design

## 描述

HIS打印模板设计和生成技能。覆盖从Word/docx参考文档到可导入.xlsx模板文件的完整流程，包括主模板+扩展模板双生成、UUID全量重生成、Sheet4返回参数字段修正。

## 触发条件

- "设计打印模板"、"生成打印模板"、"新建打印模板"
- "住院证打印"、"修改打印模板"、"打印模板适配"
- "生成.xlsx模板"、"导出模板"

## 前置条件

用户需提供：
1. 新模板布局参考 — 可以是任意格式：`.docx`（Word文档）、`.png`/`.jpg`（截图/设计稿）、手绘草图扫描件等，只要有布局参考即可
2. 已有参考模板 — `.xlsx`文件：
   - **最少**：1个主模板管理导出文件（含6个Sheet）即可
   - **理想**：主模板管理 + 扩展模板管理两个文件，可参考完整的字段映射关系
3. 新模板编码 — 由使用者指定（如住院证场景可能是 `DHCDocIPBookPrt_XXX`，实际编码取决于业务类型和医院）
4. 新模板名称 — 由使用者指定（如 `XX医院-住院证打印`）

### 条件满足度提示

| 满足情况 | 提示 |
|----------|------|
| 🟢 全部满足（2个参考.xlsx + 布局参考） | 可执行完整11步工作流 |
| 🟡 仅有主模板管理.xlsx（无扩展模板） | 可生成主模板；扩展模板的Sheet4字段映射需根据API/VO自行推导，⚠️ 提示用户"仅有主模板，将根据VO推导扩展模板字段映射" |
| 🟡 布局参考为图片（非docx） | 提取字段需人工从图片中识别，⚠️ 提示用户"图片格式布局参考，请确认以下字段提取是否准确" |
| 🟠 仅有扩展模板.xlsx（无主模板） | ⚠️ 提示用户"缺少主模板管理，无法确定模板基本配置（apiUrl/数据源等），请补充主模板管理导出" |
| 🔴 缺少布局参考 | ⚠️ 提示用户"请提供新模板的布局参考（docx/png/设计稿等）" |
| 🔴 缺少参考模板 | ⚠️ 提示用户"请提供至少一个已有打印模板的.xlsx导出文件作为参考" |

## 核心工作流（11 步法）

### 第 1 步：解析布局参考提取字段

根据布局参考的格式选择不同提取方式：

**docx格式**：
```bash
unzip -p "模板.docx" word/document.xml | sed 's/<[^>]*>//g' | grep -v '^$'
```

**图片格式（png/jpg等）**：
直接查看图片内容，人工识别所有文本元素和布局位置。

**手绘草图/扫描件**：
查看图片，人工标注各个区域。

分类标注每个元素：固定标签文本、数据填充字段、选项展示（如"女/男"）、线条。

> ⚠️ 图片/非docx格式：提取字段后应提示用户确认字段列表是否完整准确，避免遗漏。

### 第 2 步：分析参考模板结构

解压参考模板，对比结构差异：

```bash
# 如果提供了主模板
unzip -l 主模板.xlsx  # 通常6 sheet：模板管理/模板扩展/数据集/数据集-请求参数/数据集-返回参数/模板参数配置

# 如果提供了扩展模板
unzip -l 扩展模板.xlsx  # 通常5 sheet（无"模板管理"sheet）
```

**关联关系**：主模板主键 = 扩展模板中"模板扩展id"/"模板id"列的引用值。

**仅主模板的情况**：
- 从主模板的"模板扩展"sheet（Sheet2）中可直接获取扩展配置
- 从"数据集"sheet（Sheet3）获取API url和方法
- 从"数据集-返回参数"sheet（Sheet5）获取字段映射
- 缺失的字段需根据API/VO自行推导补充

从模板sharedStrings提取当前字段映射：
```bash
# 有扩展模板时
unzip -p 扩展模板.xlsx xl/sharedStrings.xml | grep -oP '"title":"住院证.root.data.[^"]+"' | sort -u
# 仅有主模板时 — 从Sheet5（数据集-返回参数）提取
unzip -p 主模板.xlsx xl/sharedStrings.xml | grep -oP '"title":"[^"]*"' | sort -u
```

### 第 3 步：定位后台API和VO

从主模板Sheet3数据集配置中获取：
- **url列** — API路径（如`/opcare/ipbook/ipBookCreate/printIpBookData`）
- **接口方式列** — POST/GET

```bash
# 搜索Controller
grep -r "接口路径末段" --include="*.java" -l

# 读取VO和BLH
# VO: 获取所有字段的@ApiModelProperty描述
# BLH: 追踪字段赋值来源和逻辑
```

输出：VO字段列表（字段名→类型→中文描述→数据来源）。

### 第 4 步：字段映射

建立Word字段 → API响应字段的映射表：

| Word模板字段 | API路径 | VO字段名 | 类型 | 置信度 | 说明 |
|-------------|---------|---------|------|--------|------|

**命名约定**：
- 数据绑定路径使用中文描述名：`住院证.root.data.患者姓名`
- 中文名优先取VO的`@ApiModelProperty`值
- 少数字段保留英文名（如`ipdeposit`）

**参考规则**：优先参考数据绑定正确的模板（如JSTGZ版），从其模板JSON和Sheet4中提取已有字段的命名和UUID对应关系。

### 第 5 步：设计新模板JSON布局

基于Word坐标系(mm)，生成printElements数组：

```javascript
// 标签元素（固定文本）
{"options":{"left":57.5,"top":75,"height":30,"width":46.5,"hideTitle":true,"title":"患者姓名:"},
 "printElementType":{"title":"文本","type":"text","tid":"defaultModule.text"}}

// 数据元素（绑定字段）
{"options":{"left":105,"top":75,"height":31,"width":102,"hideTitle":true,
  "title":"住院证.root.data.患者姓名","testData":"住院证.root.data.患者姓名",
  "id":"UUID","field":"UUID","dataType":"dataSet"},
 "printElementType":{"title":"文本","type":"text","tid":"defaultModule.text"}}
```

- 复用参考模板的数据字段UUID（保持与Sheet4映射一致）
- 新增字段使用新UUID（后续在Sheet4中补充映射）
- 纸张：A4通常 297×210mm，A5横向 148×210mm

### 第 6 步：UUID 全量重生成（双模板同步）

**这是最关键的步骤，必须正确处理 UUID 关联。**

```javascript
// 1. 从两个模板收集所有32位hex字符串
let allUuids = new Set([...mainUuids, ...extUuids]);

// 2. 生成共享的新UUID
const NEW_MAIN_PK = randhex(32);    // 主模板主键
const NEW_DATASET_PK = randhex(32); // 数据集主键

// 3. 构建替换映射
uuidMap[OLD_MAIN_PK] = NEW_MAIN_PK;       // 主模板PK → 新值
uuidMap[OLD_DATASET_PK] = NEW_DATASET_PK; // 数据集PK → 新值
for (let u of allUuids) {
    if (u !== OLD_MAIN_PK && u !== OLD_DATASET_PK)
        uuidMap[u] = randhex(32);  // 其他全换
}

// 4. 短UID（propPath中的uid）全部重生成
for (let u of shortUids) shortMap[u] = randhex(10);

// 5. 在两个模板的所有XML文件和sharedStrings.xml中全局替换
// 6. 同步替换模板编码、名称
```

**关键规则**：
- 两个模板必须共享相同的 `NEW_MAIN_PK` 和 `NEW_DATASET_PK`
- 所有UUID必须全量替换，不能残留旧值
- 扩展字段JSON中的短uid也需一并替换

### 第 7 步：替换模板JSON

将两个模板sharedStrings中的模板JSON（开头为`{"index":0,`）替换为第5步设计的新布局JSON。

```javascript
// 从sharedStrings找到JSON并替换
let tmplIdx = strings.findIndex(s => s.startsWith('{"index":0,'));
strings[tmplIdx] = JSON.stringify(newTemplate);
```

### 第 8 步：修正 Sheet4 返回参数字段

扩展模板Sheet4定义了API返回值到模板的字段映射关系。必须逐字段校验：

| 列 | 检查规则 |
|----|---------|
| 参数字段(E) | 必须与VO Java字段名精确一致 |
| 参数名称(F) | 使用VO `@ApiModelProperty`描述值 |
| 字段类型(G) | String/Long/Date/BigDecimal，与VO一致 |

**常见错误及修正**：
- 描述型字段误标Long → 改为String（adminitStateDesc、inSorceDesc等）
- 参数名用英文 → 改为中文描述（treatedPrinciple→收治原则）
- 字段名与VO不一致 → 修正为VO字段名

```javascript
const fixes = {
    'treatedPrinciple':     { name: '收治原则',   type: 'String' },
    'adminitStateDesc':     { name: '入院病情',   type: 'String' },
    'patindoctor':          { name: '主治医师',   type: 'String' },
    // ... 逐字段校验
};
// 在sharedStrings中查找/创建正确值，更新sheet4.xml中的cell引用
```

**缺失字段补充**：对比模板JSON中所有`dataType:"dataSet"`元素与Sheet4行，缺失的字段需新增Sheet4行（含新UUID、父id引用、扩展字段JSON的propPath）。

### 第 9 步：打包 .xlsx

```bash
cd workdir
find . -type f | sed 's|^\./||' > files.txt
tar -cf ../输出模板.xlsx --format=zip -T files.txt
```

**打包工具对照**：
| 工具 | 结果 | 说明 |
|------|------|------|
| `tar.exe --format=zip -T filelist` | ✅ | 路径干净，无目录/无MANIFEST |
| `jar cfM` | ❌ | 有空目录条目 |
| `jar cf` | ❌ | 有META-INF/MANIFEST.MF |

**打包前检查**：删除所有 .bak 文件，否则POI报 `does not have any content type`。

### 第 10 步：验证

```bash
# 1. 文件数检查
unzip -l 主模板.xlsx | grep "files"  # 应为 13-14
unzip -l 扩展模板.xlsx | grep "files" # 应为 13（如果生成了扩展模板）

# 2. MANIFEST检查
unzip -l *.xlsx | grep -i manifest  # 应为空

# 3. UUID一致性（如果生成了扩展模板）
unzip -p 主模板.xlsx xl/sharedStrings.xml | grep -c "主模板PK值"
unzip -p 扩展模板.xlsx xl/sharedStrings.xml | grep -c "主模板PK值"
# 两个值应相等

# 4. 旧UUID清除
unzip -p 扩展模板.xlsx xl/sharedStrings.xml | grep -c "旧UUID"  # 应为0

# 5. 字段类型验证
unzip -p 扩展模板.xlsx xl/sharedStrings.xml | grep -c "adminitStateDesc.*Long"  # 应为0
```

### 第 11 步：导入HIS系统

```bash
# 先导入主模板（文件名根据实际模板编码替换 {模板编码}）
curl -F "file=@{模板编码}_主模板.xlsx" \
  ".../sys/import?importType=insertOrUpdate&code=hos_print_template"

# 再导入扩展模板（仅在有扩展模板时执行；文件名同上规则）
curl -F "file=@{模板编码}_扩展模板.xlsx" \
  ".../sys/import?importType=insertOrUpdate&code=hos_print_template_extend"
```

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 打印字段无数据 | 模板JSON的id/field UUID与Sheet4不一致 | UUID必须全局统一替换 |
| 导入报MANIFEST error | 用了jar打包 | 改用tar.exe |
| 导入报.bak error | 工作目录有备份文件 | 打包前清理 |
| 描述字段显示数字而非文字 | 字段类型误标为Long | 改为String |
| 主模板导入后扩展模板关联不上 | 主模板PK不一致 | 确保两模板使用同一主模板PK |

## 交付物

根据用户提供的参考模板决定产出范围：

**始终产出**：
- 字段映射文档（布局字段→API字段对照表）
- 修正清单（Sheet4类型/名称修正明细）

**根据参考模板决定**：

| 用户提供了 | 产出 |
|-----------|------|
| 仅主模板管理 .xlsx | `{模板编码}_主模板.xlsx`（导入code: `hos_print_template`） |
| 主模板 + 扩展模板 .xlsx | 上述主模板 + `{模板编码}_扩展模板.xlsx`（导入code: `hos_print_template_extend`）+ 缺失字段清单 |

> `{模板编码}` 替换为使用者指定的实际编码，如住院证场景可能是 `DHCDocIPBookPrt_BJHDFY`。

## 开始前请确认

开始工作流前，请确认以下信息已就绪（可跳过不适用项）：

1. **布局参考文件**：请提供新模板的布局参考文档（.docx / .png / .jpg / 设计稿等），路径是什么？
2. **参考模板 .xlsx**：请提供已有的主模板管理导出文件（至少1个），如有扩展模板管理导出文件也请一并提供。文件路径分别是什么？
3. **新模板编码和名称**：请提供新模板的编码和名称（编码取决于业务类型+医院，如住院证场景可能是 `DHCDocIPBookPrt_XXX`，检验报告场景可能是 `DHCDocLisReportPrt_XXX`）。
4. **（可选）历史工作产物**：如果之前做过类似模板，是否有可复用的生成脚本（如 `build_v7.js`）或修正脚本（如 `fix_sheet4.js`）？如有请提供路径；没有则从零开始生成。
5. **（可选）工作流参考文档**：是否需要参考额外的流程说明文档？如有请提供路径。
