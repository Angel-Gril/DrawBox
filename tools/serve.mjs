#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const port = Number.parseInt(process.env.PORT || '8080', 10);
const host = process.env.HOST || '127.0.0.1';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

let imageMap = {};
try {
  imageMap = JSON.parse(fs.readFileSync(path.join(root, 'data', 'image-map.json'), 'utf8'));
} catch {
  // Local preview still works without generated image shards.
}

function safePath(urlPath, base = root) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  const target = path.resolve(base, relative);
  return target === base || target.startsWith(`${base}${path.sep}`) ? target : null;
}

function shardImagePath(urlPath) {
  if (!urlPath.startsWith('/images/')) return null;
  const relativePath = urlPath.replace(/^\/+/, '');
  const repository = imageMap[relativePath];
  if (!repository) return null;
  return safePath(relativePath, path.join(root, 'image-shards', repository));
}

async function fileStat(filePath) {
  const stat = await fsp.stat(filePath);
  if (stat.isDirectory()) {
    const indexPath = path.join(filePath, 'index.html');
    return { filePath: indexPath, stat: await fsp.stat(indexPath) };
  }
  return { filePath, stat };
}

function sendFile(request, response, filePath, stat) {
  response.writeHead(200, {
    'content-type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-store'
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  let filePath = safePath(requestUrl.pathname);

  if (!filePath) {
    response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
    return;
  }

  try {
    let resolved;
    try {
      resolved = await fileStat(filePath);
    } catch {
      const mappedShardPath = shardImagePath(requestUrl.pathname);
      if (!mappedShardPath) throw new Error('not found');
      filePath = mappedShardPath;
      resolved = await fileStat(filePath);
    }

    if (!resolved.stat.isFile()) throw new Error('not a file');
    sendFile(request, response, resolved.filePath, resolved.stat);
  } catch {
    const notFound = path.join(root, '404.html');
    try {
      const body = await fsp.readFile(notFound);
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    }
  }
});

server.listen(port, host, () => {
  console.log(`DrawBox: http://${host}:${port}/`);
  console.log(`Root: ${root}`);
});
