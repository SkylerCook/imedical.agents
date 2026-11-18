'use strict';

// XML dictionary fields and UDL keywords are not interchangeable. Keep the
// mappings explicit so a new field cannot disappear from a generated class.
const COMMON = ['Deprecated', 'Final', 'Internal'];
const KEYWORDS = {
  Class: {
    flags: 'Abstract DdlAllowed Hidden LegacyInstanceContext NoExtent ProcedureBlock SqlRowIdPrivate',
    tokens: 'ClassType CompileAfter Inheritance OdbcType PropertyClass SoapBindingStyle SoapBodyUse StorageStrategy System',
    strings: 'ClientDataType RoleList SoapAction SoapNameSpace',
    sqlNames: 'SqlRowIdName SqlTableName'
  },
  Method: {
    flags: 'Abstract ClientMethod ExternalProc ForceGenerate Private ProcedureBlock SqlProc WebMethod',
    tokens: 'CodeMode GenerateAfter Language PlaceAfter ReturnResultsets SoapBindingStyle SoapBodyUse SoapMessageStyle',
    strings: 'ExternalProcName SoapAction SoapNameSpace SoapRequestMessage SoapResponseMessage',
    sqlNames: 'SqlName'
  },
  Property: {
    flags: 'Calculated Identity MultiDimensional Private ReadOnly Required SqlComputed Transient',
    tokens: 'Cardinality Inverse OnDelete SqlColumnNumber SqlComputeOnChange SqlListType',
    strings: 'SqlListDelimiter',
    sqlNames: 'SqlFieldName',
    expressions: 'InitialExpression SqlComputeCode'
  },
  Parameter: {flags: 'Abstract Constraint'},
  Index: {
    flags: 'Abstract Bitmap Extent IdKey PrimaryKey SqlComputed Unique',
    tokens: 'Condition Fields Type',
    sqlNames: 'SqlName'
  },
  Query: {flags: 'Private ServerOnly SqlProc WebMethod', sqlNames: 'SqlName'},
  Trigger: {flags: 'ForeachRow', tokens: 'CodeMode Event Foreach Language Order Time UpdateColumnList'},
  XData: {flags: 'Abstract Private', strings: 'MimeType SchemaSpec XMLNamespace'},
  ForeignKey: {flags: 'NoCheck', tokens: 'OnDelete OnUpdate', sqlNames: 'SqlName'},
  Projection: {}
};

function unsupported(field) {
  throw Object.assign(new Error('unsupported-udl-field'), {code: 'unsupported-udl-field', field});
}

function plain(node, field) {
  if (node.children.length || Object.keys(node.attributes).length) unsupported(field);
  return node.content.join('');
}

function verifyAttributes(node, allowed, at) {
  for (const key of Object.keys(node.attributes)) {
    if (!allowed.includes(key)) unsupported(at + '/@' + key);
  }
}

function identifier(value, at) {
  if (!/^[%A-Za-z][%A-Za-z0-9]*$/.test(value || '')) unsupported(at);
  return value;
}

function splitTopLevel(value, delimiter, at, firstOnly = false) {
  const items = [];
  const brackets = [];
  const closing = {'(': ')', '[': ']', '{': '}'};
  let quoted = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      if (quoted && value[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (closing[char]) brackets.push(closing[char]);
      else if (')]}'.includes(char)) {
        if (brackets.pop() !== char) unsupported(at);
      } else if (!brackets.length && char === delimiter) {
        if (firstOnly && items.length) continue;
        items.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  if (quoted || brackets.length) unsupported(at);
  items.push(value.slice(start).trim());
  return items;
}

function quoted(value, at) {
  if (/[\r\n]/.test(value)) unsupported(at);
  return '"' + value.replace(/"/g, '""') + '"';
}

function literal(value, at) {
  return /^(?:0|-?(?:[1-9]\d*(?:\.\d*[1-9])?|\.\d*[1-9]))$/.test(value) ? value : quoted(value, at);
}

function objectList(value, at) {
  const items = splitTopLevel(value, ',', at);
  if (items.some(item => !item)) unsupported(at);
  return items.length === 1 ? items[0] : '(' + items.join(', ') + ')';
}

function flag(value, at) {
  if (/^(1|true)$/i.test(value)) return true;
  if (/^(0|false)$/i.test(value)) return false;
  unsupported(at);
}

function formalSpec(value, at) {
  if (!value.trim()) return '';
  return splitTopLevel(value, ',', at).map(argument => {
    // The dictionary uses & for ByRef, * for Output, and : for the type.
    const header = /^([&*]?)([%A-Za-z][%A-Za-z0-9]*)(\.\.\.)?\s*(.*)$/s.exec(argument);
    if (!header) unsupported(at);
    const [, mode, name, variadic, tail] = header;
    const [type, defaultValue] = splitTopLevel(tail, '=', at, true);
    if (type && (type[0] !== ':' || !type.slice(1).trim())) unsupported(at);
    if (defaultValue === '') unsupported(at);
    return (mode === '&' ? 'ByRef ' : mode === '*' ? 'Output ' : '') + name + (variadic || '') +
      (type ? ' As ' + type.slice(1).trim() : '') + (defaultValue === undefined ? '' : ' = ' + defaultValue);
  }).join(', ');
}

function keyword(node, kind, at) {
  const value = plain(node, at), name = node.tag;
  const mapping = KEYWORDS[kind];
  const matches = group => mapping[group]?.split(' ').includes(name);
  if (name === 'ServerOnly' && ['Class', 'Method', 'Property'].includes(kind)) {
    return 'ServerOnly = ' + Number(flag(value, at));
  }
  if (COMMON.includes(name) || matches('flags')) {
    return flag(value, at) ? name : 'Not ' + name;
  }
  if (matches('strings')) return name + ' = ' + quoted(value, at);
  if (matches('sqlNames')) return name + ' = ' + (/^[%A-Za-z_][%A-Za-z0-9_.]*$/.test(value) ? value : quoted(value, at));
  if (kind === 'Class' && name === 'Owner') {
    return name + ' = ' + (/^[%A-Za-z_][%A-Za-z0-9_]*$/.test(value) ? '{' + value + '}' : quoted(value, at));
  }
  if (matches('expressions')) return value ? name + ' = {' + value + '}' : '';
  if (matches('tokens')) {
    if (!value) return kind === 'Class' && name === 'ClassType' ? 'ClassType = ""' : '';
    return name + ' = ' + objectList(value, at);
  }
  unsupported(at);
}

function fields(node, special, at) {
  const named = Object.create(null), keywords = [], parameters = [];
  const seen = new Set();
  for (const field of node.children) {
    const key = field.tag, location = at + '/' + key;
    if (key === 'Parameter' && ['Property', 'Query', 'Projection'].includes(node.tag)) {
      verifyAttributes(field, ['name', 'value'], location);
      const name = identifier(field.attributes.name, location + '/@name');
      const identity = 'Parameter:' + name.toLowerCase();
      if (seen.has(identity) || field.content.length || !Object.hasOwn(field.attributes, 'value')) unsupported(location);
      seen.add(identity);
      parameters.push(name + ' = ' + literal(field.attributes.value, location));
    } else if (special.includes(key)) {
      if (seen.has(key)) unsupported(location);
      seen.add(key);
      named[key] = plain(field, location);
    } else {
      if (seen.has(key)) unsupported(location);
      seen.add(key);
      const setting = keyword(field, node.tag, location);
      if (setting) keywords.push(setting);
    }
  }
  if (node.content.some(value => typeof value === 'string' && value.trim())) unsupported(at);
  return {named, settings: keywords.length ? ' [ ' + keywords.join(', ') + ' ]' : '',
    parameters: parameters.length ? '(' + parameters.join(', ') + ')' : ''};
}

function description(value) {
  if (!value) return '';
  return value.replace(/^\n|\n$/g, '').split('\n').map(line => line ? '/// ' + line : '///').join('\n') + '\n';
}

function block(heading, body = '') {
  return heading + '\n{' + (body.startsWith('\n') ? '' : '\n') + body +
    (!body || body.endsWith('\n') ? '' : '\n') + '}';
}

function xmlMarkup(value) {
  const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#13;');
  if (typeof value === 'string') return escape(value);
  const attrs = Object.entries(value.attributes).map(([key, text]) => ' ' + key + '="' +
    escape(text).replace(/"/g, '&quot;').replace(/\n/g, '&#10;').replace(/\t/g, '&#9;') + '"').join('');
  if (!value.content.length) return '<' + value.tag + attrs + '/>';
  return '<' + value.tag + attrs + '>' + value.content.map(xmlMarkup).join('') + '</' + value.tag + '>';
}

function renderStorage(node, name, at) {
  const keywords = [], body = [];
  for (const child of node.children) {
    if (child.tag === 'Description' || COMMON.includes(child.tag)) keywords.push(child);
    else body.push(child);
  }
  if (node.content.some(value => typeof value === 'string' && value.trim())) unsupported(at);
  const {named, settings} = fields({...node, children: keywords, content: []}, ['Description'], at);
  // The UDL storage body uses the XML dictionary representation verbatim in
  // structure, including nested SQLMap, Data and Property entries.
  return description(named.Description) + block('Storage ' + name + settings, body.map(xmlMarkup).join('\n'));
}

function renderMember(node) {
  const at = node.tag + '[' + (node.attributes.name || '?') + ']';
  verifyAttributes(node, ['name'], at);
  if (node.tag === 'UDLText') {
    if (node.children.length !== 1 || node.children[0].tag !== 'Content' ||
        node.content.some(value => typeof value === 'string' && value.trim())) unsupported(at);
    return plain(node.children[0], at + '/Content');
  }
  const name = identifier(node.attributes.name, at + '/@name');
  if (node.tag === 'Storage') return renderStorage(node, name, at);
  if (!Object.hasOwn(KEYWORDS, node.tag) || node.tag === 'Class') unsupported(at);
  if (node.tag === 'XData') {
    const data = node.children.filter(child => child.tag === 'Data');
    if (data.length !== 1 || Object.keys(data[0].attributes).length) unsupported(at + '/Data');
    const {named, settings} = fields({...node, children: node.children.filter(child => child.tag !== 'Data')}, ['Description'], at);
    const content = data[0].content.map(value => typeof value === 'string' ? value : xmlMarkup(value)).join('');
    return description(named.Description) + block('XData ' + name + settings, content);
  }
  const special = {
    Method: ['ClassMethod', 'FormalSpec', 'ReturnType', 'Implementation'],
    Property: ['Collection', 'Relationship', 'Type'],
    Parameter: ['Type', 'Default'],
    Query: ['Type', 'FormalSpec', 'SqlQuery'],
    Index: ['Properties'],
    Trigger: ['Code'],
    ForeignKey: ['Properties', 'ReferencedClass', 'ReferencedKey'],
    Projection: ['Type']
  };
  const {named, settings, parameters} = fields(node, ['Description', ...special[node.tag]], at);
  const docs = description(named.Description);
  const typed = named.Type ? ' As ' + named.Type + parameters : '';
  if (parameters && !named.Type) unsupported(at + '/Type');
  switch (node.tag) {
    case 'Property': {
      const relationship = named.Relationship !== undefined && flag(named.Relationship, at + '/Relationship');
      const collection = named.Collection || '';
      if (collection && !/^(list|array)$/i.test(collection)) unsupported(at + '/Collection');
      if (!named.Type) unsupported(at + '/Type');
      return docs + (relationship ? 'Relationship ' : 'Property ') + name + ' As ' +
        (collection ? (collection.toLowerCase() === 'list' ? 'List Of ' : 'Array Of ') : '') +
        named.Type + parameters + settings + ';';
    }
    case 'Parameter': {
      let value = '';
      if (named.Default !== undefined) {
        // The native UDL serializer emits zero-padded untyped class constants
        // as written in XML, even though type-parameter values use strings.
        const constant = !named.Type && /^0\d+$/.test(named.Default)
          ? named.Default : literal(named.Default, at + '/Default');
        value = ' = ' + constant;
      }
      return docs + 'Parameter ' + name + typed + settings + value + ';';
    }
    case 'Method': {
      const kind = named.ClassMethod !== undefined && flag(named.ClassMethod, at + '/ClassMethod') ? 'ClassMethod ' : 'Method ';
      const result = named.ReturnType ? ' As ' + named.ReturnType : '';
      return docs + block(kind + name + '(' + formalSpec(named.FormalSpec || '', at + '/FormalSpec') + ')' + result + settings,
        named.Implementation);
    }
    case 'Query':
      if (!named.Type) unsupported(at + '/Type');
      return docs + block('Query ' + name + '(' + formalSpec(named.FormalSpec || '', at + '/FormalSpec') + ')' + typed + settings, named.SqlQuery);
    case 'Trigger':
      return docs + block('Trigger ' + name + settings, named.Code);
    case 'Index':
      return docs + 'Index ' + name + (named.Properties ? ' On ' + objectList(named.Properties, at + '/Properties') : '') + settings + ';';
    case 'ForeignKey':
      if (!named.Properties || !named.ReferencedClass) unsupported(at);
      return docs + 'ForeignKey ' + name + '(' + named.Properties + ') References ' + named.ReferencedClass +
        (named.ReferencedKey ? '(' + named.ReferencedKey + ')' : '') + settings + ';';
    case 'Projection':
      if (!named.Type) unsupported(at + '/Type');
      return docs + 'Projection ' + name + typed + settings + ';';
  }
}

function classUdl(node, name) {
  verifyAttributes(node, ['name', 'deployed'], 'Class');
  if (node.attributes.deployed !== undefined && flag(node.attributes.deployed, 'Class/@deployed')) unsupported('Class/@deployed');
  const members = [], options = [];
  for (const child of node.children) {
    if (['TimeChanged', 'TimeCreated'].includes(child.tag)) plain(child, 'Class/' + child.tag);
    else if (child.tag !== 'Class' && (Object.hasOwn(KEYWORDS, child.tag) || ['UDLText', 'Storage'].includes(child.tag))) members.push(child);
    else options.push(child);
  }
  const {named, settings} = fields({...node, children: options}, ['Description', 'Super', 'Import', 'Include', 'IncludeGenerator'], 'Class');
  const preamble = ['Import', 'Include', 'IncludeGenerator'].filter(key => named[key]).map(key =>
    key + ' ' + objectList(named[key], 'Class/' + key) + '\n').join('');
  const superclass = named.Super ? ' Extends ' + objectList(named.Super, 'Class/Super') : '';
  let contents = '';
  for (let index = 0; index < members.length; index++) {
    const current = members[index];
    const text = renderMember(current);
    if (contents && members[index - 1].tag === 'UDLText') {
      if (!contents.endsWith('\n') && !text.startsWith('\n')) contents += '\n';
    } else if (contents) {
      contents += current.tag === 'UDLText' && text.startsWith('\n') ? '\n' : '\n\n';
    }
    contents += text;
  }
  const heading = 'Class ' + name + superclass + settings;
  return (preamble ? preamble + '\n' : '') + description(named.Description) +
    block(heading, contents ? '\n\n' + contents + (contents.endsWith('\n') ? '\n' : '\n\n') : '') + '\n';
}

module.exports = {classUdl, xmlMarkup};
