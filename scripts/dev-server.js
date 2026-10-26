/**
 * Dev server for the client.
 *
 * Serves the repo root so the client can reach the engine (`/js/engine/`),
 * the shared helpers (`/lib/`), the player pool (`/data/fixtures/`) and
 * itself (`/client/`) - and sends `/` to the client, because the repo root
 * still holds the old app and the player should never land on it by mistake.
 *
 * The real backend (rooms, Realtime, auth) arrives with the multiplayer
 * phase and replaces this file.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8099;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(302, { Location: '/client/' });
    res.end();
    return;
  }

  // The client is published at the web root, so its pages ask for
  // `/src/...`, `/styles/...` and so on. In development it lives under
  // `client/`; map those absolute paths so the page works as published.
  const CLIENT_PATHS = ['/src/', '/styles/', '/fonts/', '/icons/'];
  if (CLIENT_PATHS.some((prefix) => pathname.startsWith(prefix))
    || pathname === '/sw.js'
    || pathname === '/manifest.webmanifest') {
    pathname = `/client${pathname}`;
  }

  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  // A directory request means its index.html.
  let target = filePath;
  if (pathname.endsWith('/')) target = path.join(filePath, 'index.html');
  else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    target = path.join(filePath, 'index.html');
  }

  fs.readFile(target, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`⚽ Football Trivia — http://localhost:${PORT}/`);
});
