import { makeRollupConfig } from "@jspsych/config/rollup";

const config = makeRollupConfig("jsPsychExtensionSaccade");

// `@saccadejs/core` is a peer dependency, so it stays external in every build. In the browser
// (IIFE) builds it has to be read off the `Saccade` global that the core's browser bundle defines.
for (const entry of config) {
  const outputs = Array.isArray(entry.output) ? entry.output : [entry.output];
  for (const output of outputs) {
    if (output?.format === "iife") {
      output.globals = { ...output.globals, "@saccadejs/core": "Saccade" };
    }
  }
}

export default config;
