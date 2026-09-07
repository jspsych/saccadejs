/**
 * Copy jsPsych's stylesheet into `static/css/` so the live demo can load it as a page asset.
 *
 * The demo is a real jsPsych experiment and needs the real `jspsych.css`. Importing it from
 * the component would be simpler, but Docusaurus emits **one** stylesheet for the whole site,
 * and `jspsych.css` ships Open Sans as base64 `@font-face` data — about 460 kB, which would
 * then be downloaded on every page of the docs, not just the demo. Copying it here and linking
 * it from the demo page's `<Head>` keeps that cost on the one page that uses it.
 *
 * Run automatically by the `predev`/`prebuild` scripts. Idempotent. The destination is
 * gitignored: `node_modules` is the single source of truth, so the demo always styles itself
 * with the jsPsych version `docs/package.json` actually depends on.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../node_modules/jspsych/css/jspsych.css");
const destDir = resolve(here, "../static/css");
const dest = resolve(destDir, "jspsych.css");

if (!existsSync(src)) {
  // Not fatal: every page but the live demo is unaffected, and the demo degrades to unstyled
  // (but working) trials rather than failing to build.
  console.warn(`[copy-jspsych-css] ${src} not found — run npm install in docs/.`);
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });

const srcStat = statSync(src);
if (existsSync(dest)) {
  const destStat = statSync(dest);
  if (destStat.size === srcStat.size && destStat.mtimeMs >= srcStat.mtimeMs) {
    console.log("[copy-jspsych-css] static/css/jspsych.css is up to date.");
    process.exit(0);
  }
}

copyFileSync(src, dest);
console.log(
  `[copy-jspsych-css] copied jspsych.css (${(srcStat.size / 1e3).toFixed(0)} kB) into static/css/.`,
);
