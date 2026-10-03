// End-to-end: TownChess UE5 client (in the render VM) vs the browser client, both through one authoritative server.
// The UE side plays White with the in-game driver (ue5/TownChess/Scripts/autotest.py, scenario "script"); this script
// joins its private table in headless Chromium and plays Black's scripted replies, then optionally resigns/offers a draw.
// Usage: node tools/e2e-ue-browser.mjs <scenario>    scenarios: special | mate | stalemate | draw
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';

const VM = process.env.TC_VM ?? 'ue@192.168.0.223';
const WEB = process.env.TC_WEB ?? 'http://192.168.0.223:8787';
const SCEN = {
  special: { white: 'e2e4 e4e5 e5d6 d6c7 c7b8n g1f3 f1e2 e1g1 g1h2 h2g1 d2d4 f3h2', black: 'g8f6 d7d5 e7e6 d8d7 a8b8 f8d6 e8g8 d6h2 f6g4 d7d6 d6h2', end: 'resign' },
  mate: { white: 'e2e4 f1c4 d1h5 h5f7', black: 'e7e5 b8c6 g8f6', end: null },
  stalemate: { white: 'e2e3 d1h5 h5a5 h2h4 a5c7 c7d7 d7b7 b7b8 b8c8 c8e6', black: 'a7a5 a8a6 h7h5 a6h6 f7f6 e8f7 d8d3 d3h7 f7g6', end: null },
  draw: { white: 'e2e4 g1f3', black: 'e7e5 b8c6', end: 'offer-draw' },
};
const name = process.argv[2] ?? 'special';
const sc = SCEN[name];
const out = `~/tc-results/web-${name}`;
const ssh = (cmd) => execFileSync('ssh', ['-o', 'ConnectTimeout=5', VM, cmd], { encoding: 'utf8' });

ssh(`rm -rf ${out}`);
const extra = name === 'draw' ? '-TCAcceptDraw=1' : '';
const ue = spawn('ssh', [VM, `timeout 1500 ~/tctools/run_client.sh script ${out} -tcserver=ws://127.0.0.1:8787/ws -tcauto=private:10+0 -TCMoves=${sc.white.replaceAll(' ', ',')} ${extra}`], { stdio: ['ignore', 'pipe', 'inherit'] });
let ueOut = '';
ue.stdout.on('data', (d) => { ueOut += d; });

let code = '';
for (let i = 0; i < 600 && !code; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  try { code = ssh(`cat ${out}/code.txt 2>/dev/null`).trim(); } catch { /* not yet */ }
}
if (!code) { console.error('UE never created a table'); process.exit(1); }
console.log('table', code);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await browser.newContext({ viewport: { width: 480, height: 270 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`${WEB}/?quality=low`);
await p.waitForFunction(() => window.__HC_READY === true, null, { timeout: 240000 });
await p.evaluate((c) => window.__HC_DEBUG(`online private 10+0 ${c}`), code);
await p.waitForFunction(() => window.__HC_INFO().kind === 'network' && window.__HC_INFO().color === 'b', null, { timeout: 60000 });
console.log('browser seated as Black');
const replies = sc.black.split(' ');
for (let i = 0; i < replies.length; i++) {
  // wait for White's (UE) move number i+1
  await p.waitForFunction((n) => window.__HC_INFO().moves.length >= n, 2 * i + 1, { timeout: 180000 });
  const m = replies[i];
  await p.evaluate((mv) => window.__HC_DEBUG(`move ${mv.slice(0, 2)} ${mv.slice(2, 4)}${mv[4] ? ' ' + mv[4] : ''}`), m);
  await p.waitForFunction((n) => window.__HC_INFO().moves.length >= n, 2 * i + 2, { timeout: 60000 });
}
if (sc.end === 'resign') {
  await p.waitForFunction((n) => window.__HC_INFO().moves.length >= n, 2 * replies.length + 1, { timeout: 180000 });
  await p.evaluate(() => window.__HC_DEBUG('resign'));
}
if (sc.end === 'offer-draw') await p.evaluate(() => window.__HC_DEBUG('draw offer'));
await p.waitForFunction(() => window.__HC_INFO().status !== 'active', null, { timeout: 240000 });
const info = await p.evaluate(() => window.__HC_INFO());
console.log('browser sees', info.status, info.moves.join(' '));
await browser.close();
await new Promise((r) => ue.on('close', r));
console.log(ueOut.trim());
const ok = /RESULT PASS/.test(ueOut);
console.log(ok ? `E2E UE<->BROWSER ${name} OK` : `E2E UE<->BROWSER ${name} FAILED`);
process.exit(ok ? 0 : 1);
