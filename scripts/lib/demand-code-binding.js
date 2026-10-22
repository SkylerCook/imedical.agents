'use strict';

// Business hierarchy and code ownership are separate; shared by entry and acceptance.
function hasBindings(items, parentField = 'parentKey') {
  return Array.isArray(items) && items.some(item => Object.hasOwn(item, parentField) || Object.hasOwn(item, 'codeBinding'));
}
function normalizeBindings(items, { idField = 'key', parentField = 'parentKey' } = {}) {
  if (!Array.isArray(items) || !items.length) throw new Error('需求集合不能为空');
  const result = new Map();
  for (const item of items) {
    const id = item[idField];
    if (typeof id !== 'string' || !id.trim() || id !== id.trim() || /[\r\n\0]/.test(id) || result.has(id)) throw new Error('需求标识无效或重复');
    const parent = Object.hasOwn(item, parentField) ? item[parentField] : null;
    if (parent !== null && (typeof parent !== 'string' || !parent.trim() || parent !== parent.trim())) throw new Error('主需求引用无效');
    const raw = item.codeBinding === undefined ? { kind: parent === null ? 'own' : 'parent' } : item.codeBinding;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => !['kind', 'reason'].includes(key)) || !['own', 'parent', 'none'].includes(raw.kind)) throw new Error('codeBinding 必须明确 own、parent 或 none');
    const binding = { kind: raw.kind };
    if (raw.kind === 'none') {
      if (typeof raw.reason !== 'string' || !raw.reason.trim()) throw new Error('无代码需求必须说明原因，提交尚未完成或证据不明不能跳过');
      binding.reason = raw.reason.trim();
    } else if (Object.hasOwn(raw, 'reason')) throw new Error('reason 仅用于明确无代码的需求');
    result.set(id, { parent, codeBinding: binding });
  }
  for (const [id, item] of result) {
    if (item.parent !== null) {
      const parent = result.get(item.parent);
      if (!parent || id === item.parent) throw new Error('主需求不存在或需求引用自身');
      if (parent.parent !== null) throw new Error('首版仅支持一级主子关系，不能形成循环或嵌套');
      if (item.codeBinding.kind === 'parent' && parent.codeBinding.kind !== 'own') throw new Error('复用代码的主需求必须自身拥有代码');
    } else if (item.codeBinding.kind === 'parent') throw new Error('复用主需求代码必须提供主需求引用');
  }
  return result;
}
module.exports = { hasBindings, normalizeBindings };
