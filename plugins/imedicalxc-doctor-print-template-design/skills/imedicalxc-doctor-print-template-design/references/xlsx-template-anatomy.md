# 打印模板 .xlsx 解剖与脚本片段

本文件是 `imedicalxc-doctor-print-template-design` 的参考资料，按需读取；规则以 `SKILL.md` 为准。

## 1. 包与 Sheet 结构

| 导出文件 | Sheet 数 | Sheet 构成 |
|----------|----------|------------|
| 主模板管理 `打印模板管理 *.xlsx` | 6 | 模板管理 / 模板扩展 / 数据集 / 数据集-请求参数 / 数据集-返回参数 / 模板参数配置 |
| 扩展模板管理 `打印模板扩展管理 *.xlsx` | 5 | 模板扩展 / 数据集 / 数据集-请求参数 / 数据集-返回参数 / 模板参数配置 |

- 返回参数位置不固定：主模板常见第 5 张，扩展模板常见第 4 张。**按表头识别**：第 1 行 `A=主键id`、`D=父id`、`J=扩展字段`。
- 主模板主键 = 扩展模板“模板扩展id”/“模板id”列的引用值；两文件共享模板主键、数据集主键与数据集编码。
- 模板 JSON 存放在 `xl/sharedStrings.xml` 的单个 `<si><t>` 中（含 `printElements`）；主模板内是裸 `"`，扩展模板内是 `&quot;`。

## 2. 返回参数表（Sheet4/Sheet5）列语义

| 列 | 名称 | 含义 |
|----|------|------|
| A | 主键id | 参数 id；数据元素与表格列共用此值 |
| B | 数据集id | 数据集主键 |
| C | 数据集编码 | 模板编码 |
| D | 父id | 父节点 A 值；root 为空 |
| E | 参数字段 | VO / JSON 字段名（英文） |
| F | 参数名称 | 运行时绑定名（中文）；元素 title/testData 必须一致 |
| G | 字段类型 | String / Long / Date / BigDecimal / Object / Array |
| H | 数据是否展示 | 0/0.0 |
| I | 模板/扩展 id | 模板主键 |
| J | 扩展字段 | `{parentUid,uid,level,propPath[,disabled]}` |

数据树固定三层：`root` → `返回数据(data,Object)` → `详细数据(data,Array)` → `数据对象(items,Object)` → 明细字段；`root` 下还有 `返回编码(code)`、`返回信息(msg)`。

## 3. 模板 JSON 元素

- 文本数据元素：`{"options":{left,top,height,width,hideTitle,title,testData,id,field,dataType:"dataSet",fontFamily,fontSize,...},"printElementType":{"type":"text"}}`
- 固定标签：只有 `title` 文本，无 id/field。
- 线条：`type:"line"`（hlines/竖线），只含坐标。
- 表格：`type:"table"`（位于 `printElementType` 内），`options` 关键字段：
  - `field`：表格自身字段名（非 UUID，`table-...`）；
  - `columns`：二维数组，`[[{width,title,field,columnId,checked,rowspan,colspan,...}]]`；
  - `testData`：字符串化的 `[{"参数id":"{模板名.root.返回数据.详细数据.数据对象.字段名}",...}]`。
- 坐标单位为设计器像素；纸张 A4 常用 550 宽。`right/bottom/vCenter/hCenter` 为设计器缓存，勿与 left/width 联动修改。

## 4. propPath 规则

- 格式：`0.children.<返回数据子序>[.children.<详细数据子序>.children.<数据对象子序>.children.<字段序>]`
- 与 J 列 `parentUid`/`uid` 配合使用，仅用于设计器定位。
- **兄弟序号按插入顺序**，删除/插入兄弟节点后，后续 index 全部顺延；重建时要按最终顺序重新生成。
- 运行时解析不依赖 propPath，而依赖 F 列中文名。

## 5. XML 手术注意事项

1. 模板 JSON 在 sharedStrings 的 `<si><t>` 内，替换整体 JSON 时保留 `<si><t>` 外壳。
2. 主/扩展转义不同：主模板裸 `"`，扩展 `&quot;`；字符串级替换（改名、挪坐标）要同时覆盖。
3. 全局替换用**单次正则 + 键长降序**，避免替换结果被再次命中（如 `A_BZWY → A`）。
4. 替换范围包含所有 XML part：`xl/sharedStrings.xml`、`xl/worksheets/*.xml`、`docProps/*.xml`。
5. 增删行后更新 sheet `dimension`，以及 sharedStrings 的 `count`/`uniqueCount`。
6. 单元格可能是共享字符串（`t="s"`）或内联字符串（`t="inlineStr"`），读取时都要解码实体。

## 6. 结构键 BFS 映射（路径 B）

```javascript
// key = parentField + '/' + field
const idMap = {}, uidMap = {};
const rootB = bzwy.list.find(n => n.D === '');
const rootO = orig.list.find(n => n.D === '');
idMap[rootB.A] = rootO.A; uidMap[rootB.uid] = rootO.uid;
const q = [rootB];
while (q.length) {
  const cur = q.shift();
  const oCur = orig.byId[idMap[cur.A]];
  for (const b of bzwy.list.filter(x => x.D === cur.A)) {
    let field = b.E === 'diagnose' ? 'diagnose1' : b.E; // 显式别名
    let o = orig.list.find(x => x.D === oCur.A && x.E === field);
    if (!o) {
      const cand = orig.list.filter(x => x.E === field);
      if (cand.length === 1) o = cand[0]; // 全局唯一兜底
    }
    if (o) { idMap[b.A] = o.A; uidMap[b.uid] = o.uid; }
    q.push(b);
  }
}
```

替换映射追加：模板主键、数据集主键、编码。新增字段不在映射表中，保持新 id。

## 7. 读取工作簿（无需第三方依赖）

```javascript
const fs = require('fs');
const dec = t => t.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function sheetRows(dir, n) { // dir 为解压目录
  const sst = fs.readFileSync(dir + '/xl/sharedStrings.xml', 'utf8');
  const texts = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => dec(m[1].replace(/<[^>]+>/g, '')));
  const xml = fs.readFileSync(dir + `/xl/worksheets/sheet${n}.xml`, 'utf8');
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {};
    for (const cm of rm[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (cm[1].match(/r="([A-Z]+)\d+"/) || [])[1];
      const t = (cm[1].match(/t="([^"]+)"/) || [])[1];
      const body = cm[2] || '';
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      let val = v ? v[1] : '';
      if (t === 's' && val !== '') val = texts[+val] || '';
      else if (t === 'inlineStr') { const tm = body.match(/<t[^>]*>([\s\S]*?)<\/t>/); val = tm ? dec(tm[1]) : ''; }
      else val = dec(val);
      cells[ref] = val;
    }
    rows.push(cells);
  }
  return rows;
}
// 定位返回参数表：for (n=1..6) 若 rows[0].J === '扩展字段' 则命中
```

提取模板 JSON：

```javascript
const si = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)]
  .map(m => m[1]).find(x => x.includes('printElements'));
const tpl = JSON.parse(dec(si.replace(/^<t[^>]*>/, '').replace(/<\/t>$/, '')));
```

## 8. 打包（Windows / PowerShell）

```powershell
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# ZipArchive 需要上面两个程序集，只加载 FileSystem 会报 ZipArchiveMode 类型不存在
# 条目名用正斜杠；[Content_Types].xml 先写入
```

- 含中文路径的 `.ps1` 必须保存为 UTF-8 with BOM，否则 PowerShell 5.1 按 ANSI 读取导致路径乱码。
- 也可用 `tar -cf out.xlsx --format=zip -T filelist`；不要用 `jar`（会带 MANIFEST/目录条目）。
- 打包后重新以 `ZipFile.OpenRead` + `XmlDocument.LoadXml` 验证全部 XML。

## 9. 校验清单（可直接落成脚本）

```
1. 无残留：旧编码、旧 id、旧 uid 在所有 XML part 中出现次数为 0
2. 模板 JSON：JSON.parse 成功；关键元素坐标符合预期
3. 元素 id：所有 dataType=dataSet 元素 id ∈ 返回参数 A 列
4. 层级：D ∈ A；J.parentUid ∈ uid 集合（root 的 parentUid 为 "0"）
5. 表格：column.field === column.columnId === 参数 A 值
6. Sheet：返回参数行数与元素引用一致；dimension 覆盖实际行列
7. 压缩包：条目数、正斜杠、[Content_Types].xml 首位、全部 XML 可解析
```
