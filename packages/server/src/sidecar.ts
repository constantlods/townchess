/**
 * Local TownChess core ("sidecar") for the native UE5 client's offline play.
 *
 * Launched by the game with:
 *   - the per-launch secret as the FIRST LINE on stdin (preferred: it never touches any environment block), or in
 *     TOWNCHESS_CORE_SECRET for tools/tests; every connection must present it;
 *   - `--data <dir>` (or TOWNCHESS_CORE_DATA): directory for players and the unfinished-game journal.
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

const argData = process.argv.indexOf('--data');
const dataDir = argData > 0 ? process.argv[argData + 1] : process.env.TOWNCHESS_CORE_DATA ?? path.join(os.homedir(), '.townchess', 'core');

/** First line of stdin, without consuming the stream's end (which still means "parent gone"). */
function firstStdinLine(timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => { process.stdin.off('data', onData); resolve(null); }, timeoutMs);
    const onData = (d: Buffer) => {
      buf += d.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl >= 0) { clearTimeout(t); process.stdin.off('data', onData); resolve(buf.slice(0, nl).trim()); }
    };
    process.stdin.on('data', onData);
  });
}

// stdout is the control channel: log to stderr only
console.log = (...a: unknown[]) => console.error(...a);

const envSecret = process.env.TOWNCHESS_CORE_SECRET;
delete process.env.TOWNCHESS_CORE_SECRET; // never inherited by anything this process starts
const secret = envSecret && envSecret.length >= 16 ? envSecret : await firstStdinLine(10_000);
if (!secret || secret.length < 16) {
  console.error('a per-launch secret (>= 16 chars) is required on the first stdin line or in TOWNCHESS_CORE_SECRET');
  process.exit(2);
}

const server = http.createServer((req, res) => {
  res.writeHead(req.url === '/health' ? 200 : 404, { 'content-type': 'text/plain' });
  res.end(req.url === '/health' ? 'ok' : 'not found');
});
const players = new PlayerStore(path.join(dataDir!, 'players.json'));
const hub = new Hub(server, players, '/ws', { secret, journalDir: path.join(dataDir!, 'journal') });

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
