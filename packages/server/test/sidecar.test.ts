import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import type { ServerMessage } from '@hc/shared';

/**
 * The local core contract the UE5 client relies on (docs/NETWORKING.md "Local core"): ready line on stdout,
 * per-launch secret, exit on stdin close, and journal-based recovery after a crash.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, '../src/sidecar.ts');
// Launch exactly like the UE client does (UTCLocalCore): `node --import <tsx loader as file:// URL> sidecar.ts`.
// (node_modules/.bin/tsx is a .cmd shim on Windows and cannot be spawned directly.)
const tsxLoader = pathToFileURL(path.resolve(here, '../../../node_modules/tsx/dist/esm/index.mjs')).href;
const SECRET = 'test-secret-0123456789abcdef';
const procs: ChildProcess[] = [];
afterEach(() => { for (const p of procs) p.kill('SIGKILL'); procs.length = 0; });

/** `viaStdin`: deliver the secret as the first stdin line and the data dir as --data (how the UE client launches). */
function launch(dataDir: string, viaStdin = false): Promise<{ proc: ChildProcess; port: number }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, HC_AI_MIN_THINK_MS: '0' } as Record<string, string>;
    if (!viaStdin) { env.TOWNCHESS_CORE_SECRET = SECRET; env.TOWNCHESS_CORE_DATA = dataDir; }
    const args = ['--import', tsxLoader, entry, ...(viaStdin ? ['--data', dataDir] : [])];
    const proc = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    if (viaStdin) proc.stdin!.write(SECRET + '\n');
    procs.push(proc);
    let buf = '';
    const t = setTimeout(() => reject(new Error('sidecar did not report ready')), 20_000);
    proc.stdout!.on('data', (d) => {
      buf += String(d);
      const m = buf.match(/^TOWNCHESS_CORE_READY (\{.*\})$/m);
      if (m) { clearTimeout(t); resolve({ proc, port: JSON.parse(m[1]).port }); }
    });
    proc.on('exit', (code) => reject(new Error(`sidecar exited early (${code})`)));
  });
}

function connect(port: number, secret?: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, secret ? { headers: { 'x-townchess-secret': secret } } : {});
  const inbox: ServerMessage[] = [];
  const waiters: { pred: (m: ServerMessage) => boolean; res: (m: ServerMessage) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMessage;
    const i = waiters.findIndex((w) => w.pred(m));
    if (i >= 0) waiters.splice(i, 1)[0].res(m); else inbox.push(m);
  });
  const next = <T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) =>
    new Promise<Extract<ServerMessage, { type: T }>>((res, rej) => {
      const i = inbox.findIndex((m) => m.type === type && pred(m as never));
      if (i >= 0) { res(inbox.splice(i, 1)[0] as never); return; }
      const t = setTimeout(() => rej(new Error('timeout ' + type)), 15_000);
      waiters.push({ pred: (m) => m.type === type && pred(m as never), res: (m) => { clearTimeout(t); res(m as never); } });
    });
  return { ws, next, send: (m: object) => ws.send(JSON.stringify(m)), opened: new Promise<void>((r, j) => { ws.once('open', () => r()); ws.once('error', j); ws.once('unexpected-response', () => j(new Error('rejected'))); }) };
}

describe('local core (sidecar)', () => {
  it('requires the per-launch secret, survives a crash and resumes the game from its journal', async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-'));
    const first = await launch(data);
    await expect(connect(first.port).opened).rejects.toThrow();
    await expect(connect(first.port, 'wrong-secret-0123456789abcd').opened).rejects.toThrow();

    const c = connect(first.port, SECRET);
    await c.opened;
    c.send({ type: 'HELLO', username: 'OFFLINE' });
    const w = await c.next('WELCOME');
    c.send({ type: 'CREATE_AI_GAME', level: 'novice', color: 'w', timeControl: '5+0' });
    const j = await c.next('GAME_JOINED');
    c.send({ type: 'MOVE', gameId: j.state.id, seq: 1, from: 'e2', to: 'e4', ply: 0 });
    const afterReply = await c.next('GAME_STATE_UPDATED', (m) => m.state.moveHistory.length === 2);

    first.proc.kill('SIGKILL'); // crash
    await new Promise((r) => first.proc.once('exit', r));
    const second = await launch(data);
    const c2 = connect(second.port, SECRET);
    await c2.opened;
    c2.send({ type: 'HELLO', token: w.token });
    const w2 = await c2.next('WELCOME');
    expect(w2.player.id).toBe(w.player.id);
    expect(w2.activeGameId).toBe(j.state.id);
    c2.send({ type: 'JOIN_GAME', gameId: j.state.id });
    const rj = await c2.next('GAME_JOINED');
    expect(rj.state.moveHistory.map((m) => m.san)).toEqual(afterReply.state.moveHistory.map((m) => m.san));
    expect(rj.state.fen).toBe(afterReply.state.fen);
    expect(rj.state.status).toBe('active');
    // and the game goes on
    const mv = rj.state.legalMoves[0];
    c2.send({ type: 'MOVE', gameId: j.state.id, seq: 2, from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4], ply: 2 });
    await c2.next('GAME_STATE_UPDATED', (m) => m.state.moveHistory.length === 4);
    c2.ws.close();
  }, 60_000);

  it('takes the secret from stdin; a clean quit keeps used thinking time (no refund)', async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-'));
    const first = await launch(data, true);
    const c = connect(first.port, SECRET);
    await c.opened;
    c.send({ type: 'HELLO', username: 'CLOCKS' });
    const w = await c.next('WELCOME');
    c.send({ type: 'CREATE_AI_GAME', level: 'novice', color: 'w', timeControl: '5+0' });
    const j = await c.next('GAME_JOINED');
    expect(j.state.clockRunning).toBeNull(); // before both first moves
    c.send({ type: 'MOVE', gameId: j.state.id, seq: 1, from: 'e2', to: 'e4', ply: 0 });
    const s2 = await c.next('GAME_STATE_UPDATED', (m) => m.state.moveHistory.length === 2);
    expect(s2.state.clockRunning).toBe('w');
    await new Promise((r) => setTimeout(r, 1500)); // White thinks for 1.5 s
    const exited = new Promise((r) => first.proc.once('exit', r));
    first.proc.stdin!.end(); // clean quit
    await exited;
    const second = await launch(data, true);
    const c2 = connect(second.port, SECRET);
    await c2.opened;
    c2.send({ type: 'HELLO', token: w.token });
    await c2.next('WELCOME');
    c2.send({ type: 'JOIN_GAME', gameId: j.state.id });
    const rj = await c2.next('GAME_JOINED');
    expect(rj.state.whiteClockMs).toBeLessThan(300_000 - 1200); // the 1.5 s was spent, not refunded
    expect(rj.state.clockRunning).toBe('w');
    c2.ws.close();
  }, 60_000);

  it('a game saved before both first moves restores without a running clock', async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-'));
    const first = await launch(data, true);
    const c = connect(first.port, SECRET);
    await c.opened;
    c.send({ type: 'HELLO', username: 'EARLY' });
    const w = await c.next('WELCOME');
    c.send({ type: 'CREATE_AI_GAME', level: 'novice', color: 'b', timeControl: '5+0' });
    const j = await c.next('GAME_JOINED');
    await c.next('GAME_STATE_UPDATED', (m) => m.state.moveHistory.length === 1); // engine (White) moved; Black to move
    first.proc.kill('SIGKILL');
    await new Promise((r) => first.proc.once('exit', r));
    const second = await launch(data, true);
    const c2 = connect(second.port, SECRET);
    await c2.opened;
    c2.send({ type: 'HELLO', token: w.token });
    await c2.next('WELCOME');
    c2.send({ type: 'JOIN_GAME', gameId: j.state.id });
    const rj = await c2.next('GAME_JOINED');
    expect(rj.state.moveHistory.length).toBe(1);
    expect(rj.state.clockRunning).toBeNull();
    expect(rj.state.firstMoveDeadline).not.toBeNull();
    expect(rj.state.blackClockMs).toBe(300_000);
    c2.ws.close();
  }, 60_000);

  it('exits when its stdin closes (parent gone): no orphan process', async () => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-core-'));
    const { proc } = await launch(data);
    const exited = new Promise<number | null>((r) => proc.once('exit', (code) => r(code)));
    proc.stdin!.end();
    expect(await exited).toBe(0);
  }, 30_000);
});
