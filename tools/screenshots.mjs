// Visual iteration helper: renders the client at the spec's target resolutions in headless Chromium.
// Usage: node tools/screenshots.mjs [url] [outDir] [sizes...]   (sizes like 1920x1080)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/?autostart=1';
const out = process.argv[3] ?? 'shots';
const sizes = process.argv.slice(4).length ? process.argv.slice(4) : ['1920x1080'];
const wait = Number(process.env.WAIT ?? 6000);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`,
  args: [process.env.SOFTWARE ? '--use-angle=swiftshader' : '--use-angle=vulkan', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
for (const s of sizes) {
  const [w, h] = s.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  try {
    await page.waitForFunction(() => window.__HC_READY === true, null, { timeout: 180000 });
  } catch { logs.push('[timeout] __HC_READY not set'); }
  if (process.env.ACTIONS) {
    for (const a of process.env.ACTIONS.split(';')) {
      await page.evaluate((code) => window.__HC_DEBUG?.(code), a);
      await page.waitForTimeout(Number(process.env.ACTION_WAIT ?? 1500));
    }
  }
  if (url.includes('frames=')) {
    try { await page.waitForFunction(() => window.__HC_DONE === true, null, { timeout: 600000, polling: 1000 }); } catch { logs.push('[timeout] __HC_DONE'); }
  } else await page.waitForTimeout(wait);
  const file = `${out}/${process.env.PREFIX ?? 'shot'}-${s}.png`;
  await page.screenshot({ path: file, timeout: 300000 });
  const stats = await page.evaluate(() => window.__HC_STATS ?? null);
  console.log(file, JSON.stringify(stats));
  for (const l of logs.slice(0, 40)) console.log('  ', l.slice(0, 300));
  await page.close();
}
await browser.close();
