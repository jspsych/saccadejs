/**
 * Copy the ONNX eye-embedding model into `static/models/` so the live demo can fetch it
 * from the site's own origin.
 *
 * The model is ~20 MB and is committed once, in `packages/core/models/`. Copying it
 * (rather than committing a second copy, or symlinking — Docusaurus's static-file copy does
 * not follow symlinks on every platform) keeps a single source of truth; the destination is
 * gitignored at the repo root (`docs/static/models/*.onnx`).
 *
 * Run automatically by the `predev`/`prebuild` scripts. Idempotent: it re-copies only when
 * the source is newer or the sizes differ, so `npm start` stays fast.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../packages/core/models/eye_embedding.onnx");
const destDir = resolve(here, "../static/models");
const dest = resolve(destDir, "eye_embedding.onnx");

if (!existsSync(src)) {
  // Not fatal: the site builds and every page but the live demo works without the model.
  // The demo component reports a missing model to the visitor rather than crashing.
  console.warn(
    `[copy-model] ${src} not found — building the site without the model.\n` +
      "[copy-model] The live demo will not run until the core package's models/ directory exists.",
  );
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

const srcStat = statSync(src);
if (existsSync(dest)) {
  const destStat = statSync(dest);
  if (destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs) {
    console.log("[copy-model] static/models/eye_embedding.onnx is up to date.");
    process.exit(0);
  }
}

copyFileSync(src, dest);
console.log(
  `[copy-model] copied eye_embedding.onnx (${(srcStat.size / 1e6).toFixed(1)} MB) into static/models/.`,
);
