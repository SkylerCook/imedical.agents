'use strict';

function parseConnectionUrl(skill, value) {
  const isLog = skill === 'bos-code-update-log';
  if (!isLog && skill !== 'bos-demand-query') throw new Error('未知 BOS 连接配置技能');
  let url;
  try { url = new URL(value); }
  catch { throw new Error(isLog ? '代码更新日志接口地址不是有效 URL' : 'BOS URL 无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || (isLog && (url.search || url.hash))) {
    throw new Error(isLog ? '代码更新日志接口地址必须为不含鉴权参数的 HTTPS 地址' : 'BOS URL 必须使用 HTTPS 且不含用户信息');
  }
  return url;
}

function connectionMode(section) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) return null;
  const hasConnection = Object.hasOwn(section, 'connection');
  const hasUrl = Object.hasOwn(section, 'url');
  if (hasConnection && section.connection === 'company' && !hasUrl) return 'company';
  if (!hasConnection && hasUrl) return 'custom';
  return null;
}

module.exports = { parseConnectionUrl, connectionMode };
