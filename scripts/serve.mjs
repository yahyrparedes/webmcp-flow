// Servidor estático mínimo (sin dependencias) para docs/ y las pruebas.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon' };

export function serve(root, port) {
  const base = path.resolve(root);
  return http.createServer((req, res) => {
    let file = path.join(base, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(base)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(port);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root = 'docs', port = '8080'] = process.argv.slice(2);
  serve(root, Number(port));
  console.log(`http://localhost:${port}/`);
}
