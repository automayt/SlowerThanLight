import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { WebSocketServer } from 'ws';
import { COOP_PORT, type ClientMessage } from '../src/net/protocol';
import { CoopServer, TICK } from './CoopServer';

/**
 * `npm run server`: the co-op server. It runs every crew's voyage and battles, and serves the built game (dist/)
 * so friends on the LAN can open http://<this machine>:8140. During development the Vite server proxies /ws here.
 */
const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: process.env.STL_PORT ?? String(COOP_PORT) },
    saves: { type: 'string', default: 'saves/coop' },
  },
});

const root = resolve(import.meta.dirname, '..');
const game = new CoopServer(resolve(root, args.saves!));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** Serve the built game from dist/, falling back to index.html. */
function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'index.html'))) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('The co-op server is running, but the game is not built.\nRun `npm run coop` (builds, then serves), or use `npm run dev` and open http://localhost:5173.');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(dist, decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.includes(join(dist, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(file).pipe(res);
}

const http = createServer(serveStatic);
const wss = new WebSocketServer({ server: http, path: '/ws', perMessageDeflate: { threshold: 1024 } });
wss.on('connection', (ws) => {
  const link = game.connect({ send: (msg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg)) });
  ws.on('message', (data) => {
    try {
      link.message(JSON.parse(String(data)) as ClientMessage);
    } catch (e) {
      console.error('Bad message:', e);
    }
  });
  ws.on('close', () => link.close());
});

const timer = setInterval(() => game.tick(), TICK * 1000);
const port = Number(args.port);
http.listen(port, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${port}`);
  console.log(`SlowerThanLight co-op server on http://localhost:${port}${lan.length ? `  (LAN: ${lan.join(', ')})` : ''}`);
});

function shutdown(): void {
  clearInterval(timer);
  wss.close();
  http.close();
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(sig, shutdown);
