'use strict';
// 归属判定已抽到 graylog-toolkit；此处注入本工程根目录，保持旧引用与调用签名不变。
const path = require('node:path');
const base = require('../../../graylog-toolkit/lib/owner-index');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

module.exports = {
  ...base,
  buildIndex: (cfg, opts = {}) => base.buildIndex(cfg, { repoRoot: REPO_ROOT, ...opts }),
  calibrate: (cfg, opts = {}) => base.calibrate(cfg, { repoRoot: REPO_ROOT, ...opts }),
};
