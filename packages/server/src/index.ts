import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hub } from './hub.js';
import { PlayerStore } from './players.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.HC_DATA ?? path.resolve(here, '../../../server-data/players.json');
const STATIC = process.env.HC_STATIC ?? path.resolve(here, '../../client/dist');

const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

/** HTTP server: serves the built client (if present) and hosts the WebSocket hub on /ws. */
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.normalize(path.join(STATIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(STATIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('Client not built. Run `npm run build`, or use `npm run dev` for the client.'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const players = new PlayerStore(DATA);
const hub = new Hub(server, players);
server.listen(PORT, () => console.log(`horror-chess server on :${PORT} (ws path /ws)`));

const shutdown = () => { players.flush(); hub.close(); server.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
