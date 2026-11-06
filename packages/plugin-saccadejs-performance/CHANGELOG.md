# @saccadejs/plugin-performance

## 1.0.0

### Major Changes

- [#22](https://github.com/jspsych/saccadejs/pull/22) [`6cd875d`](https://github.com/jspsych/saccadejs/commit/6cd875db9e28495cbcfc492c5ee0006d9ca70f3e) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - SaccadeJS 1.0. The packages now follow semantic versioning: a breaking change to any of them means a new major version.

  Every package now requires the 1.x versions of the others. The extension and `saccade-time-sync` take `@saccadejs/core` `^1.0.0` (previously any version), and every plugin takes `@saccadejs/extension` `^1.0.0` (previously `>=0.1.0`, or `>=0.4.0` for `saccade-catch-up`).

  Two extension methods changed:

  - `calibratePoint(x, y, options?)` takes an options object in place of its three optional positional arguments: `calibratePoint(x, y, { embeddings, captureMs, timeoutMs })`. Replace `calibratePoint(x, y, undefined, 1000)` with `calibratePoint(x, y, { captureMs: 1000 })`.
  - `catchUp(options?)` takes camelCase options, like the rest of the extension's methods: `maxWaitMs` (was `max_wait_ms`) and `saveUnprocessedCrops` (was `save_unprocessed_crops`). The `saccade-catch-up` plugin's own parameters, `max_wait` and `save_unprocessed_crops`, are unchanged.

## 0.2.0

### Minor Changes

- [`de4915f`](https://github.com/jspsych/saccadejs/commit/de4915f541106513f373256a976eadacce2a8833) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - New plugin: `saccade-performance`. Measures the tracker's effective frame rate on the
  participant's machine — `fps_median`, `fps_p10`, dropped camera frames, median inference time and
  the execution provider — and can end the experiment for machines too slow for the study.

  Exclusion follows `browser-check`: an `inclusion_function` over the measured data and an
  `exclusion_message` built from the same data. The default includes everyone, so the trial is a
  pure measurement until you give it a threshold.

  Frames with no face in them are kept out of the rates: they never reach the model, so counting
  them would report a rate the machine cannot sustain while it is actually tracking.
