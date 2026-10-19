// A tiny static server for working on Placard. `npm run dev` serves the
// source; `node scripts/serve.mjs dist` serves the built site.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const mode = process.argv[2] === 'dist' ? 'dist' : 'src';
const port = Number(process.env.PORT || (mode === 'dist' ? 4174 : 5173));
const host = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export function startServer({ dir = mode, listenPort = port } = {}) {
  const base = dir === 'dist' ? join(root, 'dist') : root;
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (dir === 'src' && path === '/') path = '/src/app/index.html';
    if (dir === 'dist' && path.endsWith('/')) path += 'index.html';
    const file = normalize(join(base, path));
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });
  return new Promise((ok) => server.listen(listenPort, host, () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
  console.log(`Placard (${mode}) on http://${host}:${port}/`);
}
