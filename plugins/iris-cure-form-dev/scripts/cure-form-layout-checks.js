'use strict';

const BASE_WIDTHS = [360, 390, 430, 768, 810, 1024, 1080, 1194, 1280];
function previewWidths(extra = [], breakpoints = []) {
  const values = [...BASE_WIDTHS, ...extra, ...breakpoints.flatMap((n) => [Math.floor(n) - 1, Math.floor(n), Math.ceil(n), Math.ceil(n) + 1])];
  if (!values.every((n) => Number.isInteger(n) && n >= 240 && n <= 4096)) throw new Error('Invalid preview width.');
  return [...new Set(values)].sort((a, b) => a - b);
}
function validWidths(values) {
  return Array.isArray(values) && values.length === new Set(values).size && values.every((n) => Number.isInteger(n) && n >= 240 && n <= 4096) && BASE_WIDTHS.every((n) => values.includes(n));
}

// Executed in an isolated localhost preview. Selectors are declared by the form, not business-specific defaults.
async function inspectLayouts(config) {
  const results = [];
  const rect = (node) => {
    const bounds = node.getBoundingClientRect();
    return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
  };
  const cases = config.cases || [{ name: 'initial' }];
  for (const item of cases) {
    if (item.click) {
      const button = document.querySelector(item.click);
      if (!button) { results.push({ name: item.name, passed: false, error: 'Missing switch target' }); continue; }
      button.click();
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    const checks = [];
    for (const expected of item.text || []) {
      const nodes = Array.from(document.querySelectorAll(expected.selector));
      const actual = nodes.map((node) => node.textContent.trim());
      checks.push({ selector: expected.selector, kind: 'text', passed: JSON.stringify(actual) === JSON.stringify(expected.values), actual });
    }
    for (const required of item.visible || []) {
      const nodes = Array.from(document.querySelectorAll(required.selector));
      checks.push({ selector: required.selector, kind: 'visible', passed: nodes.length > 0 && nodes.every((node) => {
        const b = rect(node); return b.width >= (required.minWidth || 40) && b.height >= (required.minHeight || 30) && getComputedStyle(node).visibility !== 'hidden';
      }), bounds: nodes.map(rect) });
    }
    for (const group of item.alignment || []) {
      const nodes = Array.from(document.querySelectorAll(group.selector)).filter((node) => node.getBoundingClientRect().width > 0);
      const bounds = nodes.map(rect);
      const edges = group.edges || ['top', 'bottom'];
      checks.push({ selector: group.selector, kind: 'alignment', passed: nodes.length === (group.count || 4) && edges.every((edge) => Math.max(...bounds.map((b) => b[edge])) - Math.min(...bounds.map((b) => b[edge])) <= 1), bounds });
    }
    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    results.push({ name: item.name, passed: !overflow && checks.every((check) => check.passed), checks, overflow });
  }
  return results;
}
module.exports = { previewWidths, validWidths, inspectLayouts };
