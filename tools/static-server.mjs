// Dependency-free static server for previewing public/ without wrangler.
// The /api/chat function is NOT served here; use `npm run dev` (wrangler) for that.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const port = Number(process.env.PORT) || 8788;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Chat is not configured in the static preview. Run `npm run dev` to serve the function.' }));
    }
    let p = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
    const st = await stat(p).catch(() => null);
    if (st?.isDirectory()) p = path.join(p, 'index.html');
    // single-page app: paths without a file extension fall back to index.html (mirrors public/_redirects)
    else if (!st && !path.extname(p)) p = path.join(root, 'index.html');
    const body = await readFile(p);
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(port, () => console.log(`Static preview at http://localhost:${port}`));
