import { makeRollupConfig } from "@jspsych/config/rollup";

const config = makeRollupConfig("jsPsychSaccadeTimeSync");

// `saccadejs` is a peer dependency (this plugin calls `runLoopback`), so it stays external in
// every build. In the browser (IIFE) builds it is read off the `Saccade` global that the core's
// browser bundle defines.
for (const entry of config) {
  const outputs = Array.isArray(entry.output) ? entry.output : [entry.output];
  for (const output of outputs) {
    if (output?.format === "iife") {
      output.globals = { ...output.globals, saccadejs: "Saccade" };
    }
  }
}

export default config;
