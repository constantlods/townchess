// Bundles the TownChess core (local "sidecar" for the native client) into plain JavaScript for packaged builds:
//   dist/core/townchess-core.mjs   entry (packages/server/src/sidecar.ts)
//   dist/core/aiWorker.mjs         engine worker thread (loaded next to the entry via new URL('./aiWorker.mjs'))
// The result runs on a stock Node.js runtime (no tsx, no node_modules, no repo layout).
// Usage: node tools/bundle-core.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist/core');
fs.rmSync(out, { recursive: true, force: true });
const common = {
  bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: true, logLevel: 'warning',
  // ws has optional native helpers; leave them out (pure-JS fallback)
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __tcRequire } from 'node:module'; const require = __tcRequire(import.meta.url);" },
};
await build({ ...common, entryPoints: [path.join(root, 'packages/server/src/sidecar.ts')], outfile: path.join(out, 'townchess-core.mjs') });
await build({ ...common, entryPoints: [path.join(root, 'packages/server/src/aiWorker.ts')], outfile: path.join(out, 'aiWorker.mjs') });
fs.copyFileSync(path.join(root, 'packages/shared/data/openings/COPYING.txt'), path.join(out, 'OPENINGS-CC0-COPYING.txt'));
const size = (f) => `${(fs.statSync(path.join(out, f)).size / 1024).toFixed(0)} KB`;
console.log(`core bundle: townchess-core.mjs ${size('townchess-core.mjs')}, aiWorker.mjs ${size('aiWorker.mjs')} -> ${path.relative(root, out)}`);
