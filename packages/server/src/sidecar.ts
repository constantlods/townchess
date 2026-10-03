/**
 * Local TownChess core ("sidecar") for the native UE5 client's offline play.
 *
 * Launched by the game with:
 *   - TOWNCHESS_CORE_SECRET (env, never on the command line): per-launch secret every connection must present;
 *   - TOWNCHESS_CORE_DATA (env, optional): directory for players and the unfinished-game journal.
 * Contract (docs/NETWORKING.md "Local core"):
 *   - listens on 127.0.0.1 only, on an ephemeral port;
 *   - prints exactly one line `TOWNCHESS_CORE_READY {"port":N,"pid":P,"protocolVersion":V}` on stdout when ready;
 *   - exits when stdin closes (the parent died or closed the pipe), so a crashed game never leaves an orphan;
 *     on Windows the game additionally puts this process in a Job Object with KILL_ON_JOB_CLOSE;
 *   - unfinished games are journaled and restored on restart (crash recovery).
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { PROTOCOL_VERSION } from '@hc/shared';
import { Hub } from './hub.js';
import { PlayerStore } from './players.js';

const secret = process.env.TOWNCHESS_CORE_SECRET;
if (!secret || secret.length < 16) {
  console.error('TOWNCHESS_CORE_SECRET (>= 16 chars) is required');
  process.exit(2);
}
const dataDir = process.env.TOWNCHESS_CORE_DATA ?? path.join(os.homedir(), '.townchess', 'core');
// stdout is the control channel: log to stderr only
console.log = (...a: unknown[]) => console.error(...a);

const server = http.createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'text/plain' });
  res.end(req.url === '/health' ? 'ok' : 'not found');
});
const players = new PlayerStore(path.join(dataDir, 'players.json'));
const hub = new Hub(server, players, '/ws', { secret, journalDir: path.join(dataDir, 'journal') });

const shutdown = (why: string) => {
  console.error(`[sidecar] shutting down: ${why}`);
  players.flush();
  hub.close();
  server.close();
  process.exit(0);
};
process.stdin.on('end', () => shutdown('stdin closed (parent gone)'));
process.stdin.on('error', () => shutdown('stdin error'));
process.stdin.resume();
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address() as AddressInfo;
  process.stdout.write(`TOWNCHESS_CORE_READY ${JSON.stringify({ port, pid: process.pid, protocolVersion: PROTOCOL_VERSION })}\n`);
});
