'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { search } = require('../../../scripts/lib/knowledge-retrieval');
const { resolveWorkspaceContext, workspaceContextBlockers } = require('../../../scripts/lib/workspace-context');

class KnowledgeSearchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KnowledgeSearchError';
  }
}

function validSource(relative) {
  return typeof relative === 'string' && !/[\\:\u0000-\u001f\u007f]/u.test(relative) &&
    relative.split('/').every(part => part && part !== '.' && part !== '..');
}

function createKnowledgeSearch(boundRoot) {
  async function query(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(key => key !== 'query' && key !== 'domain')) {
      throw new KnowledgeSearchError('搜索请求无效，请重新输入关键词。');
    }
    const keyword = typeof request.query === 'string' && request.query.length <= 512 ? request.query.trim() : '';
    if (!keyword) throw new KnowledgeSearchError('请输入 1 至 512 个字符的搜索词。');
    const domain = request.domain === undefined ? 'all' : request.domain;
    if (!['all', 'business', 'ui'].includes(domain)) throw new KnowledgeSearchError('请选择有效的知识范围。');

    if (typeof boundRoot !== 'string' || !path.isAbsolute(boundRoot) || /^[\\/]{2}/.test(boundRoot)) {
      throw new KnowledgeSearchError('请先绑定一个本机工程。');
    }
    const agents = path.join(boundRoot, '.agents');
    if (!fs.lstatSync(agents, { throwIfNoEntry: false })?.isDirectory()) {
      throw new KnowledgeSearchError('工程缺少可读取的 .agents 目录，请先检查框架安装。');
    }
    const manifest = fs.lstatSync(path.join(agents, 'capability.json'), { throwIfNoEntry: false });
    if (manifest && !manifest.isFile()) throw new KnowledgeSearchError('请核对工程的工作区声明。');
    const context = resolveWorkspaceContext(boundRoot);
    if (context.manifestPath && (context.mode !== 'workspace-overlay' || workspaceContextBlockers(context).length)) {
      throw new KnowledgeSearchError('工程的工作区声明无法解析，请核对能力目录。');
    }

    const result = await search(context, keyword, { domain, limit: 6, maxChars: 12000, localOnly: true, settings: {} });
    const matches = result.matches.filter(match => validSource(match.path)).map(match => ({
      path: match.path, line: match.line, endLine: match.endLine, heading: match.heading, text: match.text,
    }));
    return {
      mode: result.mode,
      sourcesAvailable: !result.warnings.includes('knowledge-sources-not-installed'),
      truncated: result.truncated,
      matches,
    };
  }

  return { query };
}

module.exports = { createKnowledgeSearch };
