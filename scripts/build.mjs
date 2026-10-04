// Builds the unpacked extension into dist/: bundles the TypeScript entry
// points with esbuild and copies static files plus the MediaPipe WASM runtime.
// Usage: node scripts/build.mjs [--watch]
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const out = 'dist';
const wasmSrc = 'node_modules/@mediapipe/tasks-vision/wasm';
const wasmFiles = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm'];

function copyAssets() {
  cpSync('static', out, { recursive: true });
  mkdirSync(`${out}/vendor/wasm`, { recursive: true });
  for (const f of wasmFiles) cpSync(`${wasmSrc}/${f}`, `${out}/vendor/wasm/${f}`);
  // Optional bundled models (npm run fetch-model); otherwise fetched at runtime.
  if (existsSync('models')) cpSync('models', `${out}/models`, { recursive: true });
}

const shared = { bundle: true, target: 'chrome120', logLevel: 'info', legalComments: 'none' };
const configs = [
  // Content scripts can't be ES modules.
  { ...shared, entryPoints: ['src/content/index.ts'], outfile: `${out}/content.js`, format: 'iife' },
  { ...shared, entryPoints: ['src/hook/index.ts'], outfile: `${out}/hook.js`, format: 'iife' },
  { ...shared, entryPoints: ['src/detector/index.ts'], outfile: `${out}/detector.js`, format: 'esm' },
];

rmSync(out, { recursive: true, force: true });
copyAssets();
if (watch) {
  for (const c of configs) await (await esbuild.context(c)).watch();
  console.log('watching… (static/ changes need a rebuild)');
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
