// End-to-end: offline play against the in-browser engine (LocalSession on the shared GameCore).
// Usage: node tools/e2e-offline.mjs [url]   (client must be served, e.g. npm run start)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await browser.newContext({ viewport: { width: 480, height: 270 } })).newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${process.argv[2] ?? 'http://localhost:8787'}/?quality=low&autostart=1`);
await p.waitForFunction(() => window.__HC_READY === true, null, { timeout: 240000 });
await p.waitForFunction(() => window.__HC_INFO().kind === 'local', null, { timeout: 30000 });
for (const mv of ['e2 e4', 'g1 f3', 'f1 c4']) {
  const n = (await p.evaluate(() => window.__HC_INFO().moves.length));
  await p.evaluate((m) => window.__HC_DEBUG('move ' + m), mv);
  await p.waitForFunction((k) => window.__HC_INFO().moves.length >= k + 2 || window.__HC_INFO().status !== 'active', n, { timeout: 60000 });
}
const info = await p.evaluate(() => window.__HC_INFO());
console.log('moves', info.moves.join(' '), 'status', info.status, 'errors', errs.length ? errs : 'none');
await browser.close();
if (info.moves.length < 6 || errs.length) { console.error('OFFLINE E2E FAILED'); process.exit(1); }
console.log('OFFLINE E2E OK');
