// Verifies the packaged core bundle (dist/core) on a stock Node runtime, away from the repo:
// ready line, secret enforcement, an engine move through the worker thread, and exit on stdin close.
// Usage: node tools/verify-core-bundle.mjs [bundleDir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const src = path.resolve(process.argv[2] ?? 'dist/core');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-bundle-'));
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dir, f));
const secret = 'bundle-check-0123456789abcdef';
const proc = spawn(process.execPath, [path.join(dir, 'townchess-core.mjs')], { cwd: os.tmpdir(), env: { ...process.env, TOWNCHESS_CORE_SECRET: secret, TOWNCHESS_CORE_DATA: path.join(dir, 'data'), HC_AI_MIN_THINK_MS: '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
let errs = '';
proc.stderr.on('data', (d) => { errs += d; });
const port = await new Promise((res, rej) => {
  let buf = '';
  const t = setTimeout(() => rej(new Error('no ready line; stderr: ' + errs)), 15000);
  proc.stdout.on('data', (d) => { buf += d; const m = buf.match(/TOWNCHESS_CORE_READY (\{.*\})/); if (m) { clearTimeout(t); res(JSON.parse(m[1]).port); } });
});
const fail = (m) => { console.error('BUNDLE CHECK FAILED:', m); proc.kill('SIGKILL'); process.exit(1); };
const refused = await new Promise((r) => { const w = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'x-townchess-secret': 'wrong-wrong-wrong-wrong-wrong' } }); w.on('open', () => r(false)); w.on('error', () => r(true)); w.on('unexpected-response', () => r(true)); });
if (!refused) fail('wrong secret accepted');
const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'x-townchess-secret': secret } });
const msgs = [];
ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
await new Promise((r) => ws.on('open', r));
const wait = (pred, ms = 20000) => new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { const m = msgs.find(pred); if (m) { clearInterval(i); res(m); } else if (Date.now() - t0 > ms) { clearInterval(i); rej(new Error('timeout')); } }, 50); });
ws.send(JSON.stringify({ type: 'HELLO', username: 'BUNDLE' }));
await wait((m) => m.type === 'WELCOME');
ws.send(JSON.stringify({ type: 'CREATE_AI_GAME', level: 'novice', color: 'w', timeControl: 'untimed' }));
const j = await wait((m) => m.type === 'GAME_JOINED');
ws.send(JSON.stringify({ type: 'MOVE', gameId: j.state.id, seq: 1, from: 'e2', to: 'e4', ply: 0 }));
const u = await wait((m) => m.type === 'GAME_STATE_UPDATED' && m.state.moveHistory.length === 2).catch(() => fail('engine did not reply (worker thread)'));
console.log('engine replied', u.state.moveHistory[1].san, '| opening', u.state.opening?.name ?? '-');
ws.close();
const code = await new Promise((r) => { proc.once('exit', r); proc.stdin.end(); });
if (code !== 0) fail('did not exit cleanly on stdin close: ' + code);
fs.rmSync(dir, { recursive: true, force: true });
console.log('BUNDLE CHECK OK (stock node', process.version + ')');
