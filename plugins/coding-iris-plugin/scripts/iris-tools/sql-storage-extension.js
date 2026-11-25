'use strict';

const {parseXml} = require('./xml-package-core');
const sqlStorageTypes = new Set(['%Storage.SQL', '%CacheSQLStorage', '%Library.CacheSQLStorage']);
const identifier = /^[%A-Za-z_][%A-Za-z0-9_]*$/;

// A UDL keyword belongs to the outer [...] list, not a type parameter,
// quoted value, comment, or embedded code block.
function keywords(source) {
  const list = new Map();
  let depth = 0, entry;
  for (const [token] of source.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"]|"")*"|[%\w]+|[^\s]/g)) {
    if (token.startsWith('//') || token.startsWith('/*')) continue;
    if (depth === 0 && token === '[') entry = [];
    else if (entry && depth === 1) {
      if (token === ',' || token === ']') {
        const [first, ...rest] = entry;
        const negated = first?.toLowerCase() === 'not';
        const [key, ...value] = negated ? [rest[0], 'not', ...rest.slice(1)] : entry;
        if (!key || list.has(key.toLowerCase())) return null;
        list.set(key.toLowerCase(), value);
        entry = [];
        if (token === ']') return list;
      } else entry.push(token);
    }
    if (['[', '(', '{'].includes(token)) depth++;
    if ([']', ')', '}'].includes(token)) depth--;
  }
  return entry ? null : list;
}

function keywordName(value) {
  if (value?.length !== 2 || value[0] !== '=') return null;
  const name = value[1].replace(/^"(.*)"$/, '$1');
  return identifier.test(name) ? name : null;
}

function activeBlock(parsed) {
  const attrs = keywords(parsed.header);
  if (!attrs) return undefined;
  const name = attrs.has('storagestrategy') ? keywordName(attrs.get('storagestrategy')) : 'Default';
  return parsed.blocks.find(block => block.name === name);
}

function fields(parsed) {
  const names = new Set(), sql = new Map();
  for (const declaration of parsed.declarations) {
    const [, kind, name] = /^\s*(Property|Relationship)\s+([%\w]+)\s+As\s/i.exec(declaration) || [];
    const attrs = keywords(declaration);
    if (!identifier.test(name || '') || !attrs) return null;
    const column = attrs.has('sqlfieldname') ? keywordName(attrs.get('sqlfieldname')) : name;
    if (!column || names.has(name.toLowerCase()) || sql.has(column.toLowerCase())) return null;
    names.add(name.toLowerCase());
    sql.set(column.toLowerCase(), {name: name.toLowerCase(), persistent: kind.toLowerCase() === 'property' &&
      !['transient', 'calculated', 'sqlcomputed'].some(key => attrs.has(key))});
  }
  return {names, sql};
}

function storageXml(block) {
  try { return parseXml('<Storage>' + block.xml + '</Storage>'); }
  catch (error) {
    if (/^(?:invalid-xml|xml-)/.test(error.code || '')) return null;
    throw error;
  }
}

function childText(node, tag) {
  const matches = node.children.filter(child => child.tag === tag);
  if (!matches.length) return undefined;
  const [child] = matches;
  if (matches.length !== 1 || child.children.length || Object.keys(child.attributes).length) return null;
  return child.content.join('');
}

function namedChildren(node, tag) {
  const result = new Map();
  for (const child of node.children.filter(item => item.tag === tag)) {
    const name = child.attributes.name?.toLowerCase();
    if (!name || result.has(name)) return null;
    result.set(name, child);
  }
  return result;
}

function shape(node, omit, sortData = false) {
  const attrs = Object.entries(node.attributes).sort();
  if (!node.children.length) return [node.tag, attrs, node.content.join('')];
  let content = node.content.filter(value => typeof value === 'string' ? value.trim() : !omit?.has(value));
  if (sortData && node.tag === 'SQLMap' && isCaretMap(node)) {
    const data = content.filter(value => value.tag === 'Data');
    data.sort((a, b) => String(a.attributes.name).localeCompare(String(b.attributes.name), 'en'));
    content = [...content.filter(value => value.tag !== 'Data'), ...data];
  }
  return [node.tag, attrs, content.map(value => typeof value === 'string' ? value : shape(value, omit, sortData))];
}

function rowPiece(data) {
  if (Object.keys(data.attributes).length !== 1 || data.children.length !== 2 ||
      data.content.some(value => typeof value === 'string' && value.trim()) || childText(data, 'Delimiter') !== '"^"') return null;
  const part = childText(data, 'Piece');
  if (!/^[1-9][0-9]*$/.test(part || '') || !Number.isSafeInteger(Number(part))) return null;
  return Number(part);
}

function isCaretMap(map) {
  const structure = childText(map, 'Structure');
  if (childText(map, 'Type') !== 'data' || (structure !== 'delimited' && structure !== undefined)) return false;
  const data = map.children.filter(child => child.tag === 'Data');
  return data.length > 0 && data.every(child => child.attributes.name && rowPiece(child) !== null);
}

function rowGlobal(map) {
  const global = childText(map, 'Global');
  return /^\^?%?[A-Za-z][\w.]*$/.test(global || '') ? global.replace(/^\^/, '').toLowerCase() : null;
}

function addMapFields(map, oldData, newFields, allMaps, knownFields, omitted) {
  const global = rowGlobal(map);
  if (!isCaretMap(map) || !global ||
      [...allMaps.values()].some(other => other !== map &&
        (childText(other, 'Type') === 'data' || other.children.some(child => child.tag === 'Data')) &&
        (!rowGlobal(other) || rowGlobal(other) === global))) return false;

  const pieces = new Set([...oldData.values()].map(rowPiece));
  let last = 0;
  for (const piece of pieces) last = Math.max(last, piece);
  for (const [name, data] of newFields) {
    const piece = rowPiece(data);
    if (!knownFields.delete(name) || piece === null || piece <= last || pieces.has(piece)) return false;
    pieces.add(piece);
    omitted.add(data);
  }
  return true;
}

function layout(block, xml) {
  return {name: block.name, layout: JSON.stringify(shape(xml, null, true))};
}

function compare(baseline, candidate, remote) {
  const before = activeBlock(baseline), after = activeBlock(candidate);
  if (!before || !after || before.header !== after.header ||
      remote && activeBlock(remote)?.name !== before.name ||
      baseline.blocks.length !== candidate.blocks.length ||
      baseline.blocks.some((block, i) => block === before ? candidate.blocks[i] !== after : candidate.blocks[i].content !== block.content)) return null;

  const oldXml = storageXml(before), newXml = storageXml(after);
  if (!oldXml || !newXml || !sqlStorageTypes.has(childText(oldXml, 'Type'))) return null;
  const oldMaps = namedChildren(oldXml, 'SQLMap'), newMaps = namedChildren(newXml, 'SQLMap');
  if (!oldMaps || !newMaps || oldMaps.size !== newMaps.size) return null;
  const intended = layout(after, newXml);
  if ([...oldMaps.values()].some(isCaretMap) && intended.layout === layout(before, oldXml).layout) return intended;

  const oldFields = fields(baseline), newFields = fields(candidate), serverFields = remote ? fields(remote) : oldFields;
  if (!oldFields || !newFields || !serverFields) return null;
  const declared = new Set([...newFields.sql].filter(([column, field]) => field.persistent &&
    !oldFields.names.has(field.name) && !oldFields.sql.has(column) &&
    !serverFields.names.has(field.name) && !serverFields.sql.has(column)).map(([column]) => column));
  const oldMappings = new Map();
  for (const [name, map] of oldMaps) {
    const data = namedChildren(map, 'Data');
    if (!data) return null;
    oldMappings.set(name, data);
    for (const column of data.keys()) declared.delete(column);
  }
  const omitted = new Set();
  for (const [name, oldData] of oldMappings) {
    const newMap = newMaps.get(name);
    if (!newMap) return null;
    const newData = namedChildren(newMap, 'Data');
    if (!newData) return null;
    const added = [...newData].filter(([column]) => !oldData.has(column));
    if (added.length && !addMapFields(oldMaps.get(name), oldData, added, oldMaps, declared, omitted)) return null;
  }
  if (!omitted.size || JSON.stringify(shape(newXml, omitted)) !== JSON.stringify(shape(oldXml))) return null;
  return intended;
}

function existingLayout(parsed) {
  const block = activeBlock(parsed);
  const xml = block && storageXml(block);
  if (!xml || !sqlStorageTypes.has(childText(xml, 'Type'))) return null;
  const maps = namedChildren(xml, 'SQLMap');
  return maps && [...maps.values()].some(isCaretMap) ? layout(block, xml) : null;
}

function reviewStorageKind(parsed) {
  const block = activeBlock(parsed);
  const xml = block && storageXml(block);
  if (!xml) return;
  const type = childText(xml, 'Type');
  if (type === '%Storage.Persistent') return 'persistent';
  const maps = sqlStorageTypes.has(type) && namedChildren(xml, 'SQLMap');
  if (maps && [...maps.values()].some(isCaretMap)) return 'sql-caret';
}

function matchesReadback(expected, blocks) {
  const block = blocks.find(item => item.name === expected.name);
  const xml = block && storageXml(block);
  return !!xml && JSON.stringify(shape(xml, null, true)) === expected.layout;
}

module.exports = {compare, existingLayout, matchesReadback, reviewStorageKind};
