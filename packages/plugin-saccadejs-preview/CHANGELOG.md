# @saccadejs/plugin-preview

## 1.0.0

### Major Changes

- [#22](https://github.com/jspsych/saccadejs/pull/22) [`6cd875d`](https://github.com/jspsych/saccadejs/commit/6cd875db9e28495cbcfc492c5ee0006d9ca70f3e) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - SaccadeJS 1.0. The packages now follow semantic versioning: a breaking change to any of them means a new major version.

  Every package now requires the 1.x versions of the others. The extension and `saccade-time-sync` take `@saccadejs/core` `^1.0.0` (previously any version), and every plugin takes `@saccadejs/extension` `^1.0.0` (previously `>=0.1.0`, or `>=0.4.0` for `saccade-catch-up`).

  Two extension methods changed:

  - `calibratePoint(x, y, options?)` takes an options object in place of its three optional positional arguments: `calibratePoint(x, y, { embeddings, captureMs, timeoutMs })`. Replace `calibratePoint(x, y, undefined, 1000)` with `calibratePoint(x, y, { captureMs: 1000 })`.
  - `catchUp(options?)` takes camelCase options, like the rest of the extension's methods: `maxWaitMs` (was `max_wait_ms`) and `saveUnprocessedCrops` (was `save_unprocessed_crops`). The `saccade-catch-up` plugin's own parameters, `max_wait` and `save_unprocessed_crops`, are unchanged.

### Patch Changes

- [#16](https://github.com/jspsych/saccadejs/pull/16) [`64308a5`](https://github.com/jspsych/saccadejs/commit/64308a5d571dd580312db0976cdaf277c3b076a5) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Deferred mode, for computers too slow to run the model on every frame as it arrives. The frame loop keeps reading the camera, finding the face and cutting the eye crop, and a pool of background workers runs the model on the crops while the experiment carries on. This is a port of the worker pool the validation study ran on its slower machines.

  The extension takes `mode: "live" | "deferred" | "auto"` (default `"live"`) and `deferred_workers`. `"auto"` times the model when the camera starts and runs live only on WebGPU within 85% of a camera frame (30–80 ms). In deferred mode a recording trial's `saccade_data` is filled in once its frames have been embedded, and its new `saccade_deferred` field tracks progress. Every trial records `saccade_mode`. New methods: `getMode`, `getModeDecision`, `getDeferredPending`, `collectGaze`, `finishCalibration` and `catchUp`.

  The new `saccade-catch-up` plugin waits for the workers before the data is saved. It shows a progress bar, can stop after `max_wait`, and can save the eye crops it gave up on for offline processing (`save_unprocessed_crops`). `saccade-calibrate` and `saccade-validate` wait for their own frames in deferred mode, show `processing_message` while they do, and record `processing_ms`. The preview labels the new `deferred` setup stage.

  In core: `DeferredEmbedder`, `tracker.enableDeferred()` / `disableDeferred()` / `embedDeferred()` / `measureEmbedMs()` / `measureCameraFps()` / `getCenter()`, `chooseMode`, `predictSeries` and `recommendedWorkers`. `runCalibration` and `runValidation` work in both modes, and frames emitted without an inline embedding now carry their `crop`.

## 0.3.0

### Minor Changes

- [#13](https://github.com/jspsych/saccadejs/pull/13) [`5cb663a`](https://github.com/jspsych/saccadejs/commit/5cb663a709569ef6950e3908c55229ea256c68ab) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - The preview now tells participants whether they are close enough to the camera and whether their eyes are lit well enough. In the validation study, participants who sat farther away (a smaller distance between the eyes in the image) or whose eye images had less contrast were tracked less accurately. Each measure is averaged over about a third of a second and compared with a threshold near the 10th percentile of the training participants; the advice never disables the continue button. New parameters `show_setup_feedback`, `min_interocular_distance`, `max_interocular_distance` and `min_eye_contrast`; new data fields `interocular_distance`, `eye_contrast`, `eye_brightness`, `distance_feedback` and `lighting_feedback`.

  In core, every `TrackerFrame` has a `quality` field (`FrameQuality`: `interocularDistance`, `eyeBrightness`, `eyeContrast`), `EyeCrop` gains `brightness` and `contrast` of the raw crop, and `interocularDistance(landmarks)` is exported.

## 0.2.1

### Patch Changes

- [#8](https://github.com/jspsych/saccadejs/pull/8) [`c4a3682`](https://github.com/jspsych/saccadejs/commit/c4a3682dd013df8ffa6d95e471df6342f9836d07) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Fail fast when the browser has no WebGL. MediaPipe's face landmarker needs WebGL even with its CPU delegate, because it reads every camera frame through a WebGL texture. Without WebGL it built and then threw on every frame, so the tracker never found a face and gave no reason. `createLandmarker()`, and so `tracker.init()`, now checks first and throws a `WebGLUnavailableError` before downloading MediaPipe. `webglAvailable()` is exported so an experiment can screen for it up front. The preview trial shows participants a message about the browser's graphics settings for this error, instead of suggesting a camera-permission problem. The browser-compatibility guide no longer says the face finder works without WebGL.

## 0.2.0

### Minor Changes

- [#6](https://github.com/jspsych/saccadejs/pull/6) [`1423c30`](https://github.com/jspsych/saccadejs/commit/1423c304038404a646251db9af44b779dbb4d4d5) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Participant-facing wording in the preview trial:

  - The face indicator reads "Face found" or "Looking for your face…" instead of "face: yes/no".
  - The loading labels describe what the participant is waiting for. For example, "Downloading the eye tracker (12.3 of 20.6 MB)…" replaces "Downloading eye model 12.3 / 20.6 MB", and "Starting the model runtime" is now "Loading…".
  - The frame rate and execution provider are hidden unless the new `show_diagnostics` parameter is `true`. Both are still recorded in the data.
  - The loading note and the failure message are reworded in plain language.

## 0.1.1

### Patch Changes

- [`d65654e`](https://github.com/jspsych/saccadejs/commit/d65654e95b406da868571b44722488422fede6ed) Thanks [@jodeleeuw](https://github.com/jodeleeuw)! - Fixed the eye-model download reporting the wrong total. GitHub Pages and jsDelivr compress the
  `.onnx` for browsers, so `Content-Length` is the compressed size, while the byte count is the
  file's. Against the site's model the bar filled early and the label read "20.6 / 19.0 MB".

  For a published release (the package's own model, or a versioned URL such as
  `/models/eye-embedding/1.0.0/eye_embedding.onnx`), `total` now comes from
  `models/releases.json`. Otherwise `Content-Length` is used only for an uncompressed response,
  and a total the byte count runs past is dropped. `saccade-preview`'s bar no longer moves
  backwards when that happens.
