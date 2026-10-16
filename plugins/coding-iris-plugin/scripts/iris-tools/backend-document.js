'use strict';
const path = require('node:path');

function documentName(file, content) {
    const ext = path.extname(file).toLowerCase();
    const expression = ext === '.cls' ? /^\s*Class\s+([%\w.]+)/mi : /^\s*ROUTINE\s+([%\w.]+)/mi;
    const match = String(content).replace(/^\uFEFF/, '').match(expression);
    if (!match) throw Object.assign(new Error('backend-document-name-unknown'), { reason: 'backend-document-name-unknown' });
    return match[1] + ext;
}
module.exports = { documentName };
