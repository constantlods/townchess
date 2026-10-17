// GPU benchmark: renders the client on the real GPU (ANGLE→Vulkan→RADV) in headless Chromium and records
// average FPS, frame time and 1% lows over 10 s per resolution. Needs a client on :5199 (npx vite --port 5199 packages/client).
// Usage: node tools/gpubench.mjs 1920x1080 2560x1440 ...   (ANGLE=gl to compare the OpenGL backend; SHOT=prefix saves PNGs)
import { chromium } from 'playwright-core';
const exe = process.env.CHROMIUM ?? process.env.HOME + '/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const angle = process.env.ANGLE ?? 'vulkan';
const browser = await chromium.launch({ executablePath: exe, args: [
  `--use-angle=${angle}`, '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu',
  '--disable-gpu-vsync', '--disable-frame-rate-limit', '--enable-unsafe-webgpu' ] });
const out = [];
for (const s of (process.argv.slice(2).length ? process.argv.slice(2) : ['1920x1080'])) {
  const [w,h] = s.split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('http://localhost:5199/?autostart=1', { timeout: 120000 });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__HC_READY === true, null, { timeout: 240000 });
  const load = (Date.now()-t0)/1000;
  const info = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  await page.waitForTimeout(3000);
  const r = await page.evaluate(() => new Promise(res => { const t=[]; let last=performance.now(); const end=last+10000;
    function f(now){ t.push(now-last); last=now; if(now<end) requestAnimationFrame(f); else res(t);} requestAnimationFrame(f); }));
  r.sort((a,b)=>a-b); const avg=r.reduce((a,b)=>a+b,0)/r.length; const p99=r[Math.floor(r.length*0.99)];
  const line = `${s} angle=${angle} renderer="${info}" load=${load.toFixed(1)}s frames=${r.length} avgFps=${(1000/avg).toFixed(1)} avgMs=${avg.toFixed(2)} 1%lowFps=${(1000/p99).toFixed(1)}`;
  console.log(line);
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}-${s}.png` });
  await page.close();
}
await browser.close();
