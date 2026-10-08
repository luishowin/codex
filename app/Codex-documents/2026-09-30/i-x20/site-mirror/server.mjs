#!/usr/bin/env node
// Minimal local server for the mirrored ES-module application.
// Usage: node server.mjs [port]
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.argv[2] ?? 4173);
const types = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filename = path.resolve(root, requested);
  if (!filename.startsWith(`${root}${path.sep}`) && filename !== root) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(filename).pipe(response);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Space Bunny mirror: http://127.0.0.1:${port}`);
});
