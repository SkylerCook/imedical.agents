'use strict';
// 日志语句定位已抽到 graylog-toolkit；此处注入本工程根目录与插件缓存目录，保持旧调用签名不变。
const path = require('node:path');
const base = require('../../../graylog-toolkit/lib/log-site-locate');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const CACHE_FILE = path.join(__dirname, '..', '..', 'config', '.cache', 'log-site-index.json');

module.exports = {
  ...base,
  locateLogSites: (cfg, clusters, opts = {}) => base.locateLogSites(cfg, clusters, { repoRoot: REPO_ROOT, cacheFile: CACHE_FILE, ...opts }),
  buildIndex: (cfg, opts = {}) => base.buildIndex(cfg, { repoRoot: REPO_ROOT, ...opts }),
  cachePath: () => CACHE_FILE,
};
