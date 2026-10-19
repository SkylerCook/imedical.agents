#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_IGNORES = new Set([
  'target', 'build', 'dist', 'node_modules', '.git', '.agents', 'hisfront'
]);

function usage() {
  console.log(`Feign API 文档审计（Node.js >= 22，仅使用内置模块）

用法:
  node feign-doc-audit.js <paths|fields|io|lint|all> --doc <文档.md> --src-root <Java源码根目录> [选项]

选项:
  --ignore <目录名>   追加忽略目录，可重复
  --verbose           输出解析统计
  -h, --help          显示帮助

检查项:
  paths   服务地址、相对地址、服务提供者
  fields  文档字段是否存在于对应 Feign DTO/VO（含继承与 @JsonProperty/@JsonAlias）
  io      文档标注的入参/出参类型与 FeignClient 签名是否一致（需人工复核）
  lint    文档格式基线（resultCode、代码块损坏、data. 前缀、H6 标题）

退出码: 0 未发现问题；1 发现候选问题；2 参数或运行错误。
所有结果均为候选问题；同名类、扁平包装等场景必须结合源码人工复核。`);
}

function parseArgs(argv) {
  const opts = { command: 'all', doc: '', srcRoot: '', ignores: [], verbose: false };
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
    usage();
    process.exit(0);
  }
  opts.command = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--doc') opts.doc = argv[++i];
    else if (arg === '--src-root') opts.srcRoot = argv[++i];
    else if (arg === '--ignore') opts.ignores.push(argv[++i]);
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '-h' || arg === '--help') { usage(); process.exit(0); }
    else throw new Error('未知参数: ' + arg);
  }
  if (!['paths', 'fields', 'io', 'lint', 'all'].includes(opts.command)) {
    throw new Error('未知命令: ' + opts.command);
  }
  if (!opts.doc || !opts.srcRoot) {
    usage();
    process.exit(2);
  }
  for (const key of ['doc', 'srcRoot']) {
    if (!fs.existsSync(opts[key])) throw new Error(`路径不存在: ${opts[key]}`);
  }
  return opts;
}

function walkJava(dir, ignore, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignore.has(entry.name)) continue;
      walkJava(path.join(dir, entry.name), ignore, out);
    } else if (entry.name.endsWith('.java')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function importsOf(src) {
  const imports = new Set();
  for (const match of src.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm)) {
    imports.add(match[1]);
  }
  return imports;
}

function packageOf(src) {
  const match = src.match(/^\s*package\s+([\w.]+)\s*;/m);
  return match ? match[1] : '';
}

function keysOf(file) {
  const parts = file.replace(/\\/g, '/').split('/');
  let scope = '';
  let module = '';
  for (const part of parts) {
    if (/^[a-z0-9]+-api-[a-z0-9-]+$/.test(part)) scope = part;
  }
  for (const part of parts) {
    if (/^[a-z0-9]+-mediway(?:-boot)?$/.test(part)) module = part.replace(/-mediway(?:-boot)?$/, '');
  }
  return { scope, module };
}

function annotationArgs(src, at) {
  const nameEnd = src.indexOf(' ', at) >= 0 ? at + src.slice(at).match(/^@[\w.]+/)[0].length : at;
  const open = src.indexOf('(', nameEnd);
  if (open < 0) return { args: '', end: nameEnd - 1 };
  if (!/^\s*$/.test(src.slice(nameEnd, open))) return { args: '', end: nameEnd - 1 };
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) return { args: src.slice(open + 1, i), end: i };
    }
  }
  return { args: '', end: nameEnd - 1 };
}

function genericArg(type, outer) {
  if (!type) return null;
  const match = type.match(new RegExp(outer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*<'));
  if (!match) return null;
  const open = type.indexOf('<', match.index);
  let depth = 0;
  for (let i = open; i < type.length; i++) {
    if (type[i] === '<') depth++;
    else if (type[i] === '>') {
      depth--;
      if (depth === 0) return type.slice(open + 1, i);
    }
  }
  return null;
}

function elementType(type) {
  if (!type) return null;
  const compact = type.trim().replace(/\s+/g, '');
  const match = compact.match(/^(?:List|IPage|Page|Collection|Set)<(.+)>$/);
  return match ? elementType(match[1]) : compact;
}

function cleanType(type) {
  return (type || '').replace(/@[\w.]+(?:\s*\([^)]*\))?/g, '').trim();
}

function parseClients(files) {
  const clients = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.includes('@FeignClient')) continue;
    const src = stripComments(raw);
    const annotation = src.match(/@FeignClient\b/);
    const nameMatch = src.match(/(?:public\s+)?interface\s+(\w+)/);
    if (!annotation || !nameMatch) continue;

    const { args } = annotationArgs(src, annotation.index);
    const pathValue = (args.match(/path\s*=\s*["']([^"']+)["']/) || [])[1] || '';
    const serviceValue = (args.match(/value\s*=\s*["']([^"']+)["']/) || [])[1] || '';
    const keys = keysOf(file);
    const methods = [];

    const re = /@PostMapping\b/g;
    let match;
    while ((match = re.exec(src)) !== null) {
      const annotationInfo = annotationArgs(src, match.index);
      const methodPath = (annotationInfo.args.match(/value\s*=\s*["']([^"']*)["']/) ||
        annotationInfo.args.match(/["']([^"']*)["']/) || [])[1] || '';

      let end = src.indexOf(';', annotationInfo.end + 1);
      const brace = src.indexOf('{', annotationInfo.end + 1);
      if (end < 0 || (brace >= 0 && brace < end)) end = brace;
      if (end < 0) continue;

      const signature = src.slice(annotationInfo.end + 1, end).trim();
      const openParen = signature.lastIndexOf('(');
      const closeParen = signature.lastIndexOf(')');
      if (openParen < 0 || closeParen < openParen) continue;

      const before = signature.slice(0, openParen).trim();
      const nameParts = before.match(/(\w+)\s*$/);
      if (!nameParts) continue;

      const returnType = before.slice(0, nameParts.index).trim();
      const params = signature.slice(openParen + 1, closeParen);
      const outRaw = genericArg(cleanType(returnType), 'EsbBaseResponse');
      const inRaw = genericArg(params, 'EsbBaseDTO');

      methods.push({
        name: nameParts[1],
        path: methodPath,
        returnType: cleanType(returnType),
        inType: elementType(inRaw),
        outType: elementType(outRaw)
      });
    }

    clients.push({
      name: nameMatch[1],
      file,
      path: pathValue,
      service: serviceValue,
      imports: importsOf(src),
      packageName: packageOf(src),
      ...keys,
      methods
    });
  }
  return clients;
}

function parseTypes(files) {
  const types = new Map();
  for (const file of files) {
    const base = path.basename(file, '.java');
    if (!/^Feign/.test(base)) continue;
    const src = stripComments(fs.readFileSync(file, 'utf8'));
    const classMatch = src.match(/(?:class|interface|enum)\s+(\w+)/);
    if (!classMatch) continue;

    const extendsMatch = src.match(/class\s+\w+\s+extends\s+([\w<>,.\s]+?)(?:\s+implements|\s*\{)/);
    const parent = extendsMatch ? extendsMatch[1].trim().split(/[<\s]/)[0].split('.').pop() : '';
    const classIndex = src.indexOf(classMatch[0]);
    const bodyStart = src.indexOf('{', classIndex);
    const body = bodyStart >= 0 ? src.slice(bodyStart) : '';
    const fields = [];

    const fieldRe = /((?:@[\w.]+(?:\s*\([^)]*\))?\s*)*)(private|protected|public)\s+((?:(?:static|final|transient|volatile)\s+)*)([\w<>,.[\]? ]+?)\s+(\w+)\s*(?:=[^;]*)?;/g;
    let match;
    while ((match = fieldRe.exec(body)) !== null) {
      if (/\bstatic\b/.test(match[3])) continue;
      if (match[5] === 'serialVersionUID') continue;
      const annotations = match[1] || '';
      const json = (annotations.match(/@JsonProperty\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/) || [])[1] ||
        (annotations.match(/@JsonAlias\s*\(\s*(?:value\s*=\s*)?\{?\s*["']([^"']+)["']/) || [])[1] ||
        null;
      fields.push({ name: match[5], type: match[4].trim(), json });
    }

    const entry = {
      name: classMatch[1],
      file,
      parent,
      fields,
      imports: importsOf(src),
      packageName: packageOf(src),
      ...keysOf(file)
    };
    if (!types.has(entry.name)) types.set(entry.name, []);
    types.get(entry.name).push(entry);
  }
  return types;
}

function pickType(types, name, scope, module, context) {
  const candidates = types.get(name);
  if (!candidates || !candidates.length) return { type: null };

  if (context) {
    if (context.imports && context.imports.size) {
      const imported = candidates.filter(item => {
        const fqcn = item.packageName ? `${item.packageName}.${item.name}` : '';
        return fqcn && context.imports.has(fqcn);
      });
      if (imported.length === 1) return { type: imported[0] };
    }
    if (context.packageName) {
      const samePackage = candidates.filter(item => item.packageName === context.packageName);
      if (samePackage.length === 1) return { type: samePackage[0] };
    }
  }

  if (scope) {
    const sameScope = candidates.filter(item => item.scope === scope);
    if (sameScope.length === 1) return { type: sameScope[0] };
    if (sameScope.length > 1) return { type: null, ambiguous: sameScope };
  }
  if (module) {
    const sameModule = candidates.filter(item => item.module === module);
    if (sameModule.length === 1) return { type: sameModule[0] };
    if (sameModule.length > 1) return { type: null, ambiguous: sameModule };
  }
  if (candidates.length === 1) return { type: candidates[0] };
  return { type: null, ambiguous: candidates };
}

function fieldsOf(types, name, scope, module, context, seen = new Set()) {
  const key = `${scope}|${module}|${name}`;
  if (seen.has(key)) return { fields: [], resolved: true };
  seen.add(key);
  const picked = pickType(types, name, scope, module, context);
  if (!picked.type) return { fields: [], resolved: false, ambiguous: picked.ambiguous };
  const fields = picked.type.fields.slice();
  if (picked.type.parent) {
    const parentContext = { imports: picked.type.imports, packageName: picked.type.packageName };
    const parent = fieldsOf(types, picked.type.parent, picked.type.scope, picked.type.module, parentContext, seen);
    fields.push(...parent.fields);
  }
  return { fields, resolved: true, type: picked.type };
}

function readDoc(docPath) {
  const lines = fs.readFileSync(docPath, 'utf8').split(/\r?\n/);
  const sections = [];
  let client = null;
  let current = null;
  const methodHead = /^#####\s+(4\.[\d.]+)\s+(.+?)\s*[-—]\s*(\w+)\s*$/;
  const clientHead = /^####\s+(4\.[\d.]+)\s+(.+?)\s*[-—]\s*(\w+)\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const methodMatch = line.match(methodHead);
    if (methodMatch) {
      if (current) sections.push(current);
      current = {
        num: methodMatch[1],
        title: methodMatch[2],
        method: methodMatch[3],
        client,
        start: i + 1,
        lines: []
      };
      continue;
    }
    const clientMatch = line.match(clientHead);
    if (clientMatch) {
      if (current) { sections.push(current); current = null; }
      client = { num: clientMatch[1], name: clientMatch[3], start: i + 1, lines: [] };
      continue;
    }
    if (/^###\s/.test(line)) {
      if (current) { sections.push(current); current = null; }
      client = null;
      continue;
    }
    if (current) current.lines.push({ n: i + 1, text: line });
    else if (client) client.lines.push({ n: i + 1, text: line });
  }
  if (current) sections.push(current);
  return { lines, sections };
}

function expectedPath(client, method) {
  const base = (client.path || '').replace(/\/+$/, '');
  const suffix = (method.path || '').replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

function auditPaths(doc, clients) {
  const byName = new Map(clients.map(client => [client.name, client]));
  const issues = [];

  for (const section of doc.sections) {
    if (!section.client) continue;
    const client = byName.get(section.client.name);
    if (!client) {
      issues.push({ type: 'missing-client', section, detail: `源码未找到 FeignClient: ${section.client.name}` });
      continue;
    }
    const method = client.methods.find(item => item.name === section.method);
    let addressRows = 0;

    for (const row of section.lines) {
      const address = row.text.match(/^\|\s*服务地址\s*\|\s*(.+?)\s*\|/);
      if (address) {
        addressRows++;
        const actual = address[1].trim();
        if (!method) {
          issues.push({ type: 'missing-method', section, line: row.n, detail: `源码未找到方法: ${client.name}.${section.method}()` });
          continue;
        }
        const expected = expectedPath(client, method);
        if (actual !== expected) {
          const type = /^\//.test(actual) ? 'relative' : 'path';
          issues.push({ type, section, line: row.n, actual, expected });
        }
      }

      const relative = row.text.match(/^\|\s*地址\s*\|\s*(.+?)\s*\|/);
      if (relative) {
        const expected = method ? expectedPath(client, method) : '无法推导（方法缺失）';
        issues.push({ type: 'relative', section, line: row.n, actual: relative[1].trim(), expected });
      }

      const provider = row.text.match(/^\|\s*服务提供者\s*\|\s*(.+?)\s*\|/);
      if (provider) {
        const actual = provider[1].replace(/`/g, '').trim();
        const expected = `${client.name}.${section.method}()`;
        if (actual !== expected) {
          issues.push({ type: 'provider', section, line: row.n, actual, expected });
        }
      }
    }

    if (!addressRows && section.lines.some(row => /^\|\s*请求方式\s*\|/.test(row.text))) {
      issues.push({ type: 'missing-address', section, detail: '存在接口定义表但缺少“服务地址”行' });
    }
  }

  const checkedClients = new Set();
  for (const section of doc.sections) {
    if (!section.client) continue;
    const client = byName.get(section.client.name);
    if (!client || checkedClients.has(client)) continue;
    checkedClients.add(client);
    for (const row of section.client.lines || []) {
      const match = row.text.match(/^\|\s*(\w+)\s*\|\s*([^|]+?)\s*\|/);
      if (!match) continue;
      const method = client.methods.find(item => item.name === match[1]);
      if (!method) continue;
      const actual = match[2].trim();
      if (!/^(\$\{|https?:|\/)/.test(actual)) continue;
      const expected = expectedPath(client, method);
      if (actual !== expected) {
        issues.push({
          type: actual.startsWith('/') ? 'relative-summary' : 'summary-path',
          section: { num: section.client.num, method: method.name },
          line: row.n,
          actual,
          expected
        });
      }
    }
  }
  return issues;
}

function tableContext(section, index) {
  for (let i = index - 1; i >= Math.max(0, index - 15); i--) {
    const text = section.lines[i].text.trim();
    if (!text) continue;
    let match;
    if ((match = text.match(/^\*\*([^*]+?)子节点[^\n]*?[-—]\s*(Feign\w+)/))) {
      return { field: match[1].trim(), typeName: match[2] };
    }
    if ((match = text.match(/^\*\*([^*]+?)子节点[^\n]*?[（(][^）)\n]*?(Feign\w+)/))) {
      return { field: match[1].trim(), typeName: match[2] };
    }
    if ((match = text.match(/^\*\*(?:入参|出参)说明\s*[-—]\s*(Feign\w+)\*\*/))) {
      return { field: null, typeName: match[1] };
    }
    if ((match = text.match(/^\*\*([^*]+?)子节点/))) {
      return { field: match[1].trim(), typeName: null };
    }
  }
  return { field: null, typeName: null };
}

function auditFields(doc, clients, types) {
  const byName = new Map(clients.map(client => [client.name, client]));
  const issues = [];
  const unknownTypes = new Set();
  const wrapperFields = new Set(['code', 'msg', 'message', 'version', 'data', 'total', 'size', 'current', 'records']);

  for (const section of doc.sections) {
    const client = section.client ? byName.get(section.client.name) : null;
    if (!client) continue;
    const method = client.methods.find(item => item.name === section.method);
    if (!method) continue;

    let phase = 'in';
    let tableCount = 0;
    let lastFieldTypes = new Map();
    let lastTypeEntry = null;
    const clientContext = { imports: client.imports, packageName: client.packageName };

    for (let i = 0; i < section.lines.length; i++) {
      const text = section.lines[i].text;
      if (/入参说明|入参JSON示例/.test(text) && phase !== 'in') {
        phase = 'in';
        lastFieldTypes = new Map();
        lastTypeEntry = null;
      }
      if (/出参说明|出参JSON示例/.test(text) && phase !== 'out') {
        phase = 'out';
        lastFieldTypes = new Map();
        lastTypeEntry = null;
      }
      if (!text.startsWith('|')) continue;
      if (i + 1 >= section.lines.length) continue;
      if (!/^\|\s*:?-{2,}/.test(section.lines[i + 1].text)) continue;

      const header = text.split('|').map(cell => cell.trim());
      if (header[1] !== '节点' && header[1] !== '字段') continue;

      tableCount++;
      const context = tableContext(section, i);
      let typeName = context.typeName;
      if (!typeName && context.field && lastFieldTypes.has(context.field)) {
        typeName = lastFieldTypes.get(context.field);
      }
      if (!typeName) typeName = phase === 'in' ? method.inType : method.outType;
      if (!typeName) continue;

      const resolveContext = (context.field || context.typeName) && lastTypeEntry
        ? { imports: lastTypeEntry.imports, packageName: lastTypeEntry.packageName }
        : clientContext;
      const resolved = fieldsOf(types, typeName, client.scope, client.module, resolveContext);
      if (!resolved.resolved && /^Feign/.test(typeName)) {
        unknownTypes.add(typeName);
      }

      const allowed = new Set();
      for (const field of resolved.fields) {
        allowed.add(field.name);
        if (field.json) allowed.add(field.json);
      }

      const typeColumn = header.indexOf('数据类型');
      const fieldTypes = new Map();
      const missing = [];
      let j = i + 2;
      for (; j < section.lines.length; j++) {
        const row = section.lines[j];
        if (!row.text.startsWith('|')) break;
        const cells = row.text.split('|').map(cell => cell.trim());
        const rawField = cells[1];
        if (rawField && !/^-+$/.test(rawField)) {
          const fieldName = rawField.replace(/\[\]$/, '');
          const typeCell = typeColumn >= 0 ? (cells[typeColumn] || '') : (cells[2] || '');
          const nested = typeCell.match(/Feign\w+/);
          if (fieldName && nested) fieldTypes.set(fieldName, nested[0]);
        }

        if (!resolved.resolved) continue;
        if (!rawField || /^-+$/.test(rawField)) continue;
        const name = rawField.replace(/\[\]$/, '');
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
        if (wrapperFields.has(name)) continue;
        if (!allowed.has(name)) missing.push(`${name}@${row.n}`);
      }

      if (missing.length) {
        issues.push({
          type: 'field',
          section,
          typeName,
          detail: `文档字段未在 ${typeName} 源码中找到: ${[...new Set(missing)].join(', ')}`
        });
      }

      lastFieldTypes = fieldTypes;
      lastTypeEntry = resolved.resolved ? resolved.type : null;
      i = j - 1;
    }

    const hasJsonExample = section.lines.some(row => /JSON示例/.test(row.text));
    if (!tableCount && !hasJsonExample && section.lines.some(row => /^\|\s*请求方式\s*\|/.test(row.text))) {
      issues.push({ type: 'missing-table', section, detail: '未找到入参/出参字段表' });
    }
  }
  return { issues, unknownTypes };
}

function auditIo(doc, clients) {
  const byName = new Map(clients.map(client => [client.name, client]));
  const issues = [];

  for (const section of doc.sections) {
    const client = section.client ? byName.get(section.client.name) : null;
    if (!client) continue;
    const method = client.methods.find(item => item.name === section.method);
    if (!method) continue;

    let docIn = null;
    let docOut = null;
    for (const row of section.lines) {
      const inMatch = row.text.match(/^\*\*入参说明\s*[-—]\s*(Feign\w+)\*\*/);
      const outMatch = row.text.match(/^\*\*出参说明\s*[-—]\s*(Feign\w+)\*\*/);
      if (inMatch) docIn = inMatch[1];
      if (outMatch) docOut = outMatch[1];
    }

    if (docIn && method.inType && docIn !== method.inType) {
      issues.push({ type: 'io-in', section, doc: docIn, source: method.inType });
    }
    if (docOut && method.outType && docOut !== method.outType) {
      issues.push({ type: 'io-out', section, doc: docOut, source: method.outType });
    }
  }
  return issues;
}

function auditLint(doc, docPath) {
  const text = doc.lines.join('\n');
  const issues = [];
  const count = pattern => (text.match(pattern) || []).length;

  const resultCodeCount = count(/resultCode|resultContent/g);
  if (resultCodeCount) issues.push({ type: 'lint', detail: `发现 resultCode/resultContent ${resultCodeCount} 处，应为 code/msg` });

  const brokenFence = count(/^```--$/gm);
  if (brokenFence) issues.push({ type: 'lint', detail: `发现代码块损坏标记 \`\`\`-- ${brokenFence} 处` });

  const dataPrefix = count(/^\|\s*data\./gm);
  if (dataPrefix) issues.push({ type: 'lint', detail: `字段表残留 data. 前缀 ${dataPrefix} 处` });

  const h6 = count(/^######\s/gm);
  if (h6) issues.push({ type: 'lint', detail: `发现 H6 标题 ${h6} 处，标题层级应为 H1-H5` });

  const zeroCode = count(/"code"\s*:\s*"0"/g);
  if (zeroCode) issues.push({ type: 'lint', detail: `JSON 示例使用 "code": "0" ${zeroCode} 处，核对是否应统一为 "200"` });

  if (!issues.length) issues.push({ type: 'lint-ok', detail: `文档格式基线检查通过: ${path.basename(docPath)}` });
  return issues;
}

function formatIssue(issue) {
  const prefix = issue.section ? `${issue.section.num} ${issue.section.method}` : 'lint';
  const line = issue.line ? ` (line ${issue.line})` : '';
  switch (issue.type) {
    case 'path':
    case 'summary-path':
      return `[${issue.type}] ${prefix}${line}: ${issue.actual}  ==>  ${issue.expected}`;
    case 'relative':
    case 'relative-summary':
      return `[${issue.type}] ${prefix}${line}: 相对地址 ${issue.actual}  ==>  ${issue.expected}`;
    case 'provider':
      return `[provider] ${prefix}${line}: ${issue.actual}  ==>  ${issue.expected}`;
    case 'missing-client':
    case 'missing-method':
    case 'missing-address':
    case 'missing-table':
    case 'field':
      return `[${issue.type}] ${prefix}: ${issue.detail}`;
    case 'io-in':
    case 'io-out':
      return `[${issue.type}] ${prefix}: 文档=${issue.doc} 源码=${issue.source}（需人工复核扁平包装/同义类型）`;
    default:
      return `[${issue.type}] ${issue.detail}`;
  }
}

function run(argv) {
  const opts = parseArgs(argv);
  const ignore = new Set([...DEFAULT_IGNORES, ...opts.ignores]);
  const files = walkJava(opts.srcRoot, ignore);
  const clients = parseClients(files);
  const types = parseTypes(files);
  const doc = readDoc(opts.doc);

  if (!clients.length) throw new Error(`未在 ${opts.srcRoot} 找到 @FeignClient 接口`);
  if (!doc.sections.length) throw new Error(`未在 ${opts.doc} 解析到方法章节（##### 4.x.y.z ... — method）`);

  if (opts.verbose) {
    console.log(`Java 文件: ${files.length}`);
    console.log(`FeignClient: ${clients.length}`);
    console.log(`文档方法章节: ${doc.sections.length}`);
    console.log(`Feign 类型: ${types.size}`);
  }

  let pathIssues = [];
  let fieldIssues = [];
  let unknownTypes = new Set();
  let ioIssues = [];
  let lintIssues = [];

  if (opts.command === 'paths' || opts.command === 'all') {
    pathIssues = auditPaths(doc, clients);
    console.log(`\n== 服务地址 ==`);
    if (pathIssues.length) pathIssues.forEach(issue => console.log(formatIssue(issue)));
    else console.log('未发现服务地址问题。');
  }

  if (opts.command === 'fields' || opts.command === 'all') {
    const result = auditFields(doc, clients, types);
    fieldIssues = result.issues;
    unknownTypes = result.unknownTypes;
    console.log(`\n== 出入参字段 ==`);
    if (fieldIssues.length) fieldIssues.forEach(issue => console.log(formatIssue(issue)));
    else console.log('未发现文档多余字段。');
    if (unknownTypes.size) {
      console.log(`未解析类型（可能为包装类或同名字段表）: ${[...unknownTypes].sort().join(', ')}`);
    }
  }

  if (opts.command === 'io' || opts.command === 'all') {
    ioIssues = auditIo(doc, clients);
    console.log(`\n== 出入参类型（人工复核） ==`);
    if (ioIssues.length) ioIssues.forEach(issue => console.log(formatIssue(issue)));
    else console.log('文档标注类型与源码签名一致。');
  }

  if (opts.command === 'lint' || opts.command === 'all') {
    lintIssues = auditLint(doc, opts.doc);
    console.log(`\n== 文档格式 ==`);
    lintIssues.forEach(issue => console.log(formatIssue(issue)));
  }

  const total = pathIssues.length + fieldIssues.length + ioIssues.length +
    lintIssues.filter(issue => issue.type !== 'lint-ok').length;
  console.log(`\n汇总: paths=${pathIssues.length}, fields=${fieldIssues.length}, io=${ioIssues.length}, ` +
    `lint=${lintIssues.filter(issue => issue.type !== 'lint-ok').length}`);
  return total ? 1 : 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (error) {
  console.error(`feign-doc-audit: ${error.message}`);
  process.exitCode = 2;
}
