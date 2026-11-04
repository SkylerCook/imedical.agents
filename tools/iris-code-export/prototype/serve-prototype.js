#!/usr/bin/env node
'use strict';
// Local-only throwaway prototype server; never contacts an IRIS instance.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const port = Number(process.argv[2] || 4387);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('invalid preview port');
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/' && url.pathname !== '/index.html') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(fs.readFileSync(path.join(root, 'index.html')));
}).listen(port, '127.0.0.1', () => process.stdout.write(`Prototype: http://127.0.0.1:${port}/\nPID: ${process.pid}\n`));
