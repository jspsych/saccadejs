# @saccadejs/plugin-validate

## 1.0.0

### Major Changes

- [#22](https://github.com/jspsych/saccadejs/pull/22) [`6cd875d`](https://github.com/jspsych/saccadejs/commit/6cd875db9e28495cbcfc492c5ee0006d9ca70f3e) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - SaccadeJS 1.0. The packages now follow semantic versioning: a breaking change to any of them means a new major version.

  Every package now requires the 1.x versions of the others. The extension and `saccade-time-sync` take `@saccadejs/core` `^1.0.0` (previously any version), and every plugin takes `@saccadejs/extension` `^1.0.0` (previously `>=0.1.0`, or `>=0.4.0` for `saccade-catch-up`).

  Two extension methods changed:

  - `calibratePoint(x, y, options?)` takes an options object in place of its three optional positional arguments: `calibratePoint(x, y, { embeddings, captureMs, timeoutMs })`. Replace `calibratePoint(x, y, undefined, 1000)` with `calibratePoint(x, y, { captureMs: 1000 })`.
  - `catchUp(options?)` takes camelCase options, like the rest of the extension's methods: `maxWaitMs` (was `max_wait_ms`) and `saveUnprocessedCrops` (was `save_unprocessed_crops`). The `saccade-catch-up` plugin's own parameters, `max_wait` and `save_unprocessed_crops`, are unchanged.

### Minor Changes

- [#16](https://github.com/jspsych/saccadejs/pull/16) [`64308a5`](https://github.com/jspsych/saccadejs/commit/64308a5d571dd580312db0976cdaf277c3b076a5) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Deferred mode, for computers too slow to run the model on every frame as it arrives. The frame loop keeps reading the camera, finding the face and cutting the eye crop, and a pool of background workers runs the model on the crops while the experiment carries on. This is a port of the worker pool the validation study ran on its slower machines.

  The extension takes `mode: "live" | "deferred" | "auto"` (default `"live"`) and `deferred_workers`. `"auto"` times the model when the camera starts and runs live only on WebGPU within 85% of a camera frame (30–80 ms). In deferred mode a recording trial's `saccade_data` is filled in once its frames have been embedded, and its new `saccade_deferred` field tracks progress. Every trial records `saccade_mode`. New methods: `getMode`, `getModeDecision`, `getDeferredPending`, `collectGaze`, `finishCalibration` and `catchUp`.

  The new `saccade-catch-up` plugin waits for the workers before the data is saved. It shows a progress bar, can stop after `max_wait`, and can save the eye crops it gave up on for offline processing (`save_unprocessed_crops`). `saccade-calibrate` and `saccade-validate` wait for their own frames in deferred mode, show `processing_message` while they do, and record `processing_ms`. The preview labels the new `deferred` setup stage.

  In core: `DeferredEmbedder`, `tracker.enableDeferred()` / `disableDeferred()` / `embedDeferred()` / `measureEmbedMs()` / `measureCameraFps()` / `getCenter()`, `chooseMode`, `predictSeries` and `recommendedWorkers`. `runCalibration` and `runValidation` work in both modes, and frames emitted without an inline embedding now carry their `crop`.

## 0.2.0

### Minor Changes

- [#4](https://github.com/jspsych/saccadejs/pull/4) [`40dc478`](https://github.com/jspsych/saccadejs/commit/40dc47836a8f1bc4600abc7314a2b70d46366d39) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - - `median_error_viewport` is now the error as a fraction of the viewport's diagonal, instead of x/width and y/height combined. The same pixel error no longer counts for more in the viewport's shorter direction, and on a 16:9 viewport the value is in the unit the model's held-out error is reported in.
  - `lambdaFor` is now given the number of distinct calibration targets rather than rows, so nine dots shown twice still get the nine-point penalty. `fitCalibration()`'s `nPoints` counts distinct targets too, and the new `countTargets()` helper does the counting.
  - The time-sync trial applies the measured lag only when the verdict is `OK`. Any other verdict is recorded with `applied: false`.
  - Corrected the time-sync flash-rate wording: at most two changes, or one flash, per second.
