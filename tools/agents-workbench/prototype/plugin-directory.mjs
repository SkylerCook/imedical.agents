/**
 * @typedef {{minVersion?: string, maxVersionExclusive?: string}} DependencyRange
 * @typedef {{name: string, displayName?: string, description?: string, version: string,
 *   dependencies: string[], dependencyVersions?: Record<string, DependencyRange>, initSkill?: string|null}} Plugin
 * @typedef {{name: string, status: string}} PluginState
 * @typedef {{plugins: Plugin[], basePlugins: string[], unavailable: string[]}} Catalog
 */

const names = {
  'agent-context-kit': '工程上下文',
  'agent-framework-evolution': '框架反馈与演进',
  'bos-plugin': 'BOS 需求与日志',
  'codegraph-query': '代码图查询',
  'coding-iris-plugin': 'IRIS 编码与部署',
  'demand-delivery-plugin': '需求交付',
  'extract-doc': '文档提取',
  'i18n-iris-plugin': 'IRIS 国际化',
  'imedicalxc-doctor-card-reader': '医生站卡片读取',
  'imedicalxc-doctor-codegraph': '医生站代码图',
  'imedicalxc-doctor-data-extraction': 'HIS 数据与接口映射',
  'imedicalxc-doctor-extend-engineer': '医生站扩展开发',
  'imedicalxc-doctor-perf-analysis-engineer': '医生站性能分析',
  'imedicalxc-doctor-print-template-design': 'HIS 打印模板',
  'iris-codegraph': 'IRIS 代码图',
  'iris-cure-form-dev': '治疗表单开发',
  'iris-external-reg': '外部挂号',
  'iris-imedical-doctor-ai': '医生站 AI',
  'iris-interface-dev': 'IRIS 接口开发',
};

/** @param {Pick<Plugin, 'name'|'displayName'>} plugin */
export function pluginName(plugin) {
  return Object.hasOwn(names, plugin.name) ? names[plugin.name] : (plugin.displayName || plugin.name);
}

/** @param {string | undefined} state */
export function pluginStatus(state) {
  switch (state) {
    case 'enabled': return '已启用';
    case 'disabled': return '已停用';
    case 'available': return '已安装';
    case 'pending': return '待初始化';
    default: return '未识别';
  }
}

/** @param {Plugin[]} plugins @param {string} query */
export function filterPlugins(plugins, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return plugins.filter(plugin => {
    const searchable = [pluginName(plugin), plugin.name, plugin.displayName, plugin.description]
      .join(' ').toLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}

/** @param {Plugin[]} plugins @param {PluginState[]} profile @param {string} targetName */
export function previewPluginDependencies(plugins, profile, targetName) {
  const byName = new Map(plugins.map(plugin => [plugin.name, plugin]));
  const states = new Map(profile.map(plugin => [plugin.name, plugin.status]));
  /** @type {Set<string>} */
  const visited = new Set();

  /** @param {string} name */
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    byName.get(name)?.dependencies.forEach(visit);
  }

  visit(targetName);
  return Array.from(visited, name => ({
    name,
    label: pluginName(byName.get(name) || {name}),
    status: states.get(name),
    impact: name === targetName ? '核对目标启用与配置' : '保留或补齐依赖',
  }));
}
