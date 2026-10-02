// End-to-end: two browser clients matched through the real server; one move is played and observed.
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5173/?quality=low';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const open = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log(name, 'pageerror', e.message));
  await p.goto(url);
  await p.waitForFunction(() => window.__HC_READY === true, null, { timeout: 240000 });
  return p;
};
const [a, b] = await Promise.all([open('A'), open('B')]);
const info = (p) => p.evaluate(() => window.__HC_INFO());
await a.evaluate(() => window.__HC_DEBUG('online casual 5+0'));
await b.evaluate(() => window.__HC_DEBUG('online casual 5+0'));
await a.waitForFunction(() => window.__HC_INFO().kind === 'network', null, { timeout: 30000 });
await b.waitForFunction(() => window.__HC_INFO().kind === 'network', null, { timeout: 30000 });
const ia = await info(a), ib = await info(b);
console.log('A', ia.color, ia.id, '| B', ib.color, ib.id);
const [w, bl] = ia.color === 'w' ? [a, b] : [b, a];
await w.evaluate(() => window.__HC_DEBUG('move e2 e4'));
await bl.waitForFunction(() => window.__HC_INFO().moves.length === 1, null, { timeout: 30000 });
console.log('black sees', (await info(bl)).moves);
// black tries to move a white piece (client allows sending it via debug; server must reject)
await bl.evaluate(() => window.__HC_DEBUG('move d2 d4'));
await new Promise((r) => setTimeout(r, 1500));
console.log('after illegal attempt', (await info(w)).moves, (await info(bl)).moves);
await bl.evaluate(() => window.__HC_DEBUG('move e7 e5'));
await w.waitForFunction(() => window.__HC_INFO().moves.length === 2, null, { timeout: 30000 });
console.log('white sees', (await info(w)).moves);
await w.evaluate(() => window.__HC_DEBUG('resign'));
await bl.waitForFunction(() => window.__HC_INFO().status === 'resigned', null, { timeout: 30000 });
console.log('final', (await info(bl)).status);
await browser.close();
