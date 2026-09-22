'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
function runnerFingerprint() {
  const digest = crypto.createHash('sha256');
  for (const name of ['cure-form-browser-runner.js', 'cure-form-layout-checks.js', 'cure-form-preview-mounts.js', 'cure-form-runner-fingerprint.js']) {
    digest.update(name); digest.update(fs.readFileSync(path.join(__dirname, name)));
  }
  return digest.digest('hex');
}
module.exports = { runnerFingerprint };
