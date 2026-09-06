import { makeRollupConfig } from "@jspsych/config/rollup";

/**
 * The shared jsPsych config assumes a package with a single default export (a plugin class);
 * `@saccadejs/core` is a library with named exports, and it must never bundle onnxruntime-web or
 * @mediapipe/tasks-vision.
 *
 * Two adjustments:
 *  1. `exports: "named"` on every output, so the iife build assigns the whole namespace to the
 *     global `Saccade` instead of erroring on the missing default export.
 *  2. the two heavy deps are external in *all* formats. The shared config makes dependencies
 *     external for the module builds but deliberately not for the browser builds, which would
 *     inline tens of MB of wasm loaders. src/assets.ts expects the bare specifiers to fail at
 *     runtime in the browser bundle and falls back to the pinned jsdelivr URLs.
 */
const HEAVY = ["onnxruntime-web", "@mediapipe/tasks-vision"];

export default makeRollupConfig("Saccade").map((entry) => {
  const outputs = Array.isArray(entry.output) ? entry.output : [entry.output];
  if (outputs.every((o) => String(o.file).endsWith(".d.ts"))) return entry;
  return {
    ...entry,
    external: [...new Set([...(entry.external ?? []), ...HEAVY])],
    output: outputs.map((o) => ({ ...o, exports: "named" })),
  };
});
