'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const {safePath} = require('./configure-vscode');

function progress(request, text, canStop = true) {
  if (request.progressFile) fs.appendFileSync(request.progressFile, JSON.stringify({text, canStop}) + '\n', 'utf8');
}
function checkCancelled(request) {
  if (request.cancelFile && fs.existsSync(request.cancelFile)) throw new Error('操作已取消，可以重新开始。');
}
function pipeName(key) {
  if (process.platform !== 'win32') throw new Error('此离线安装助手的互斥入口需要 Windows。');
  const name = crypto.createHash('sha256').update(fs.realpathSync.native(path.resolve(key)).toLowerCase()).digest('hex');
  return '\\\\.\\pipe\\AiDevOffline-' + name;
}
async function withLock(key, request, operation, legacyFile) {
  const name = pipeName(key);
  let server;
  while (!server) {
    checkCancelled(request);
    const candidate = net.createServer(socket => socket.destroy());
    const acquired = await new Promise((resolve, reject) => {
      candidate.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      candidate.listen(name, () => resolve(true));
    });
    if (acquired) server = candidate;
    else {
      progress(request, '正在等待同一目标的其他操作结束…');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  try {
    checkCancelled(request);
    if (legacyFile && fs.existsSync(legacyFile)) {
      // Updates require closing the previous helper. Old releases left empty
      // marker files; the OS-held pipe now owns mutual exclusion.
      safePath(legacyFile);
      fs.unlinkSync(legacyFile);
      progress(request, '已清理旧版遗留状态，继续处理。');
    }
    return await operation();
  } finally { await new Promise(resolve => server.close(resolve)); }
}
module.exports = {withLock, pipeName, progress, checkCancelled};
