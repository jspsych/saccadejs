# @saccadejs/extension

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

## 0.3.0

### Minor Changes

- [#12](https://github.com/jspsych/saccadejs/pull/12) [`d6a0357`](https://github.com/jspsych/saccadejs/commit/d6a035768087fc2ccf66c9a2337f4c734c02b85b) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Calibration now fits every frame recorded at each dot, rather than one averaged embedding per dot. The frames of one look vary while gaze does not, so fitting them all shows the ridge regression which of that variation is noise. Row weights (the model's per-frame quality scores, or a `calHead`) are rescaled to mean 1, and the ridge penalty is 3 at any number of points. Replayed on 200 sessions from the eyetracking cook-off, this cut median error by about 13%, and roughly halved it after a nine-point calibration. The kernel format and prediction are unchanged.

  The fit up to 0.3 is still available as `"points"`: `SaccadeTrackerOptions.calibrationFit`, `fitCalibration({ fit })`, `extension.fitCalibration(lambda, fit)`, or the calibrate plugin's new `fit` parameter. `fitRidge` takes `fit` as a fifth argument, and `lambdaFor(nPoints, fit)` returns the matching penalty. `fitCalibration` now also returns `fit`, and the calibrate plugin records it as a `fit` data field. `FRAME_LAMBDA` and the `CalFit` type are exported.

## 0.2.0

### Minor Changes

- [`8c6a2fa`](https://github.com/jspsych/saccadejs/commit/8c6a2faaf6598eb2e67d4ea33defbf4be8bca109) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Experiment data now records which model produced the gaze, in a single `saccade_model`
  column added once per session.

  The tracker hashes the model bytes it actually loaded and looks that hash up in the registry
  that ships with the core package. A value of `eye-embedding@1.0.0` therefore means _the bytes
  matched that published release_ — it is not copied from a URL or a filename, which is what
  makes one column enough. A model that is not a published release is reported as
  `sha256:<prefix>` rather than `unknown`, so custom weights still identify themselves.

  Hashing costs one pass over the already-fetched bytes at startup. `crypto.subtle` needs a
  secure context, but so does `getUserMedia` — any page that can reach a camera can hash.

  New in core: `SaccadeTracker.getModelIdentity()` returns the full picture
  (`{ sha256, version, contract, url, resolvedFrom, dim, emitsWeight }`), plus the
  `ModelIdentity` type and the `formatModelIdentity()` helper the extension uses. The data column stays deliberately
  minimal; the API is where to go for detail.

  Only trials after the model loads carry the column — the camera is not touched until the
  first `saccade-preview` trial or an explicit `start()`. Trials before that have no gaze data.

- [`bafc003`](https://github.com/jspsych/saccadejs/commit/bafc00389e78362d58be36bce37d262771b2dcae) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Renamed `tta` to `smoothing_frames` (`smoothingFrames` in the core), and changed its default from
  5 to 1.

  `tta` stood for test-time augmentation, which described the technique rather than the setting: the
  number is how many consecutive camera frames are averaged into one gaze estimate. It is now
  `SaccadeTrackerOptions.smoothingFrames` with `setSmoothingFrames` / `getSmoothingFrames`, the
  extension's `smoothing_frames` initialize parameter, and `saccade_timing.smoothing_frames` in the
  trial data.

  The default of 5 bought a steadier estimate at the cost of ~67 ms of lag at 30 fps, and it was
  paid silently by every experiment, including gaze-contingent ones that could least afford it. The
  default is now 1: predict from the newest frame, and let a study that wants smoothing ask for it.

  `saccade_timing.smoothing_frames` now reports what the tracker was actually smoothing over rather
  than the extension's parameter, so it stays true when you supply your own `tracker` or call
  `setSmoothingFrames` mid-experiment.

- [#2](https://github.com/jspsych/saccadejs/pull/2) [`f1ed9d7`](https://github.com/jspsych/saccadejs/commit/f1ed9d760daeb673c8b57a807763455e171261e8) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - The embedding width is no longer fixed at 128, and calibration row weighting now comes from the
  model rather than from the library.

  **Any consistent embedding width.** The ridge solve and both mean-embedding paths read their
  width from the embeddings they are handed instead of from a compile-time constant, so a model
  of any output length works, provided that length is the same on every frame of a session.
  `EMB_DIM` stays exported as the shipped model's width, for reference rather than as a
  requirement. The crop
  side is unchanged and still exact: 36x144 gray, built by the preprocessing in `crop.ts`.

  **Calibration weights now come from the model.** A model may carry a per-frame quality score
  as a second graph output — `cal_weight`, sigmoid, in [0, 1]. The tracker weights the frames
  making up a calibration point's mean embedding by it, then averages it into that point's row
  weight in the fit. eye-embedding 1.0.0 now includes one.

  This removes a way for the weighting and the embedding to disagree. The model is fetched by
  URL at runtime, while the previous weights file was compiled into whichever `@saccadejs/core`
  a study installed, and the two version numbers move independently — so a study could pin one
  model version and score it with a different one's head. The sha256 that identifies the model
  now covers the head as well.

  `CAL_HEAD` is no longer applied automatically. It remains exported, and
  `SaccadeTrackerOptions.calHead` opts back into it; the default is the model's own weights, or
  none. `fitCalibration()` returns `weighting: "model" | "head" | "uniform"` saying which ran,
  `saccade-calibrate` records it as a `weighting` column, and `EmbeddingModel.embed()` resolves
  to `{ embedding, weight }`, which keeps the weight paired with the embedding it describes.

  **Five silent failures now throw.** A `CalHead` whose length did not match the embedding read
  past the end of its kernel and turned every coefficient of the fit into NaN, with no error
  anywhere; it throws now. So do an embedding whose width changes mid-session, a ragged set of
  calibration rows, a half-weighted calibration set (defaulting the unweighted points to 1 made
  them the highest-weighted rows in the fit), and a weight output that is not a finite number in
  [0, 1]. The last throws at `init()`, on the warm-up inference, before any participant data
  exists.

- [`5170be6`](https://github.com/jspsych/saccadejs/commit/5170be645cee8efc08cd2ac86b7b954cfa43e0fb) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - `saccade_timing.trial_start` records the `performance.now()` value that `saccade_data`'s `t` is
  measured from.

  Subtract it from a timestamp you take yourself — a mid-trial sound, a second display change, a
  moving target's positions — to put that event on the same axis as the gaze. Record the event in
  the trial's own data; the extension has no event API.

### Patch Changes

- [`d65654e`](https://github.com/jspsych/saccadejs/commit/d65654e95b406da868571b44722488422fede6ed) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Fixed the setup progress bar never moving when the page builds its own tracker and hands it to
  the extension through the `tracker` parameter. The extension only heard progress from a tracker
  it had built, so `saccade-preview` sat at "Starting…" until init finished. On a first visit
  that is a download of about 60 MB, which looked like a hang.

  `SaccadeTracker` now has `onProgress(cb)`, a subscription to `init()`'s load progress that
  works like `onFrame(cb)`. It delivers the most recent report straight away and returns the
  unsubscribe function. The extension subscribes through it whichever way it got its tracker.

- [`274b610`](https://github.com/jspsych/saccadejs/commit/274b610cea8f95b9a693736fea413f9acb6e5ef0) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Fixed `getCurrentPrediction()` and `onGazeUpdate` reporting a different `t` depending on whether
  the current trial had the extension attached.

  Their `t` is now always absolute: `(time.meanCapture ?? time.capture)` minus the timing offset,
  on the `performance.now()` scale. `saccade_data` is unchanged, and its `t` is still measured from
  the start of the trial.

  Previously, while a trial with the extension attached was running, the live `t` was measured from
  that trial's start instead, and from zero everywhere else. `saccade-validate` subtracts a start
  time it stamps itself, so attaching the extension to a validation trial filled `raw_gaze` with
  large negative `t` values.

  **Behavior change:** if you read `t` from `onGazeUpdate` or `getCurrentPrediction()` inside a
  trial that records with the extension and relied on it being trial-relative, subtract your own
  start time (`performance.now()` at the trial's load) instead.

- [`08a9960`](https://github.com/jspsych/saccadejs/commit/08a9960abd04ee7369d17fc50f98899d9efe826d) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Fixed the prediction API going dead when the extension is handed a tracker it did not build.

  `getCurrentPrediction()`, `onGazeUpdate()`, `faceDetected()` and the gaze dot are all fed by a
  persistent frame subscription that was only ever made inside `start()`. An experiment that
  supplies its own tracker through the `tracker` parameter and never runs `saccade-preview` never
  calls `start()`, so none of them ever saw a frame — and `saccade-validate`, which collects every
  sample through `onGazeUpdate`, recorded an empty validation and reported no error at all.

  The subscription now follows the tracker rather than `start()`: it is made as soon as the
  extension has one, whether it was handed it or built it.
