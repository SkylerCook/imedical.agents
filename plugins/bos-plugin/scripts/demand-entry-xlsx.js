'use strict';

// Fixed BOSS import contract, derived from the supplied 29-column template.
// Store-only ZIP + inline strings keep the deployed tool free of npm/Python dependencies.
const HEADERS = ['需求类型', '需求名称', '发起组', '发起人', '模块编码', '模块', '产品组', '指派人', '创建日期', '执行日期', '最后更新日期', '紧急程度', '标志工作量', '难度系数', '加入标准版', '严重等级', '需求描述', '内部项目工作包编号', '模块页面信息编号', '需求截图1\n(仅单元格图片)', ...Array.from({ length: 9 }, (_, i) => `需求截图${i + 2}`)];
const NOTE = '<模块编码必填、模块非必填 >   <难度系数仅支持：0.2 、0.5 、1 、2 、3 、4 、5 >   <严重等级仅支持：1 、2 、3 、4 、5 （建议、较小、一般、严重、致命）>   <发起组、发起人 未填写时取当前登录信息>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function escapeXml(value) {
  const string = String(value);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(string)) throw new Error('Excel 字段含 XML 不支持的控制字符');
  return string.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;');
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const chunks = [], directory = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name), bytes = Buffer.from(text), crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(offset, 42);
    chunks.push(local, filename, bytes); directory.push(central, filename);
    offset += local.length + filename.length + bytes.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, central, end]);
}
function column(index) {
  let result = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function rowXml(values, row, header = false) {
  const cells = values.map((value, col) => {
    const style = header ? 1 : [8, 9, 10].includes(col) ? 3 : 2;
    const ref = `${column(col)}${row}`;
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" s="${style}" t="n"><v>${value}</v></c>`;
    const string = String(value ?? '');
    if (string.length > 32767) throw new Error('Excel 单元格超过 32767 字符，请拆分需求');
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(string)}</t></is></c>`;
  }).join('');
  return `<row r="${row}" ht="${header ? 36 : Math.min(260, Math.max(32, String(values[16] || '').split('\n').length * 15))}" customHeight="1">${cells}</row>`;
}
function buildWorkbook(items, common, renderText) {
  const rows = [rowXml(HEADERS, 1, true)];
  items.forEach((item, index) => {
    const fields = { ...common, ...item.fields, 需求名称: item.name, 需求描述: renderText(item, false) };
    if (!String(fields.模块编码 || '').trim()) throw new Error(`${item.key}: Excel 模块编码必填；默认文本不要求此字段`);
    for (const key of Object.keys(fields)) {
      if (!HEADERS.includes(key)) throw new Error(`未知 Excel 列: ${key}`);
      if (key.startsWith('需求截图') && fields[key]) throw new Error('本版不生成单元格图片，不能用路径或文字代替截图');
    }
    for (const [key, allowed] of [['难度系数', [0.2, 0.5, 1, 2, 3, 4, 5]], ['严重等级', [1, 2, 3, 4, 5]]]) {
      if (fields[key] !== undefined && fields[key] !== '') {
        if (!allowed.includes(Number(fields[key]))) throw new Error(`${key} 超出模板允许范围`);
        fields[key] = Number(fields[key]);
      }
    }
    for (const key of ['创建日期', '执行日期', '最后更新日期']) {
      if (fields[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(fields[key]) || !Number.isFinite(Date.parse(fields[key])) || new Date(fields[key]).toISOString().slice(0, 10) !== fields[key])) throw new Error(`${key} 必须为有效 yyyy-mm-dd`);
    }
    rows.push(rowXml(HEADERS.map((key) => fields[key] ?? ''), index + 2));
  });
  rows.push(rowXml(['注：', NOTE], items.length + 3));
  const widths = HEADERS.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 16 ? 70 : i === 1 ? 40 : 18}" customWidth="1"/>`).join('');
  return zip({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': `${XML}<styleSheet xmlns="${NS}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="${NS}"><dimension ref="A1:AC${items.length + 3}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`,
  });
}
module.exports = { HEADERS, buildWorkbook };
