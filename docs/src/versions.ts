// The current version of each package, read from the workspace at build time, so the `<script>`
// tags on Getting started always pin versions that exist. The site is rebuilt on every push to
// main, including the release commit that bumps these.
import core from "../../packages/core/package.json";
import extension from "../../packages/extension-saccadejs/package.json";
import calibrate from "../../packages/plugin-saccadejs-calibrate/package.json";
import catchUp from "../../packages/plugin-saccadejs-catch-up/package.json";
import performance from "../../packages/plugin-saccadejs-performance/package.json";
import preview from "../../packages/plugin-saccadejs-preview/package.json";
import timeSync from "../../packages/plugin-saccadejs-time-sync/package.json";
import validate from "../../packages/plugin-saccadejs-validate/package.json";

export const versions = {
  core: core.version,
  extension: extension.version,
  calibrate: calibrate.version,
  catchUp: catchUp.version,
  performance: performance.version,
  preview: preview.version,
  timeSync: timeSync.version,
  validate: validate.version,
};
