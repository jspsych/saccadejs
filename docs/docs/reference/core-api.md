---
id: core-api
title: Core API — saccadejs
sidebar_label: Core (saccadejs)
description: SaccadeTracker, the calibration and validation helpers, runLoopback, and every type in the core package.
---

# Core API — `saccadejs`

The core is jsPsych-agnostic: a camera, a face landmarker, an ONNX embedding model, a ridge
calibration, and a timing loopback. The [extension](extension) and the plugins are thin
wrappers over what is on this page.

```js
import { SaccadeTracker, runCalibration, runValidation, runLoopback } from "saccadejs";
```

From a `<script>` tag, the browser bundle defines a single global, `Saccade`, which is a
**namespace of the same named exports** — not a default export and not a constructor:

```js
const tracker = new Saccade.SaccadeTracker({ tta: 5 });
const result = await Saccade.runLoopback(tracker);
```

Every name on this page is available as `Saccade.<name>`.

## Conventions

- **All times are `performance.now()` milliseconds** unless stated otherwise.
- **All coordinates are viewport fractions**, 0–1, origin top-left. Converting to pixels is the
  caller's job (`x * window.innerWidth`); the jsPsych extension does it for you.
- Nothing touches the camera until `init()`.

## `SaccadeTracker`

```ts
new SaccadeTracker(options?: SaccadeTrackerOptions)
```

### `SaccadeTrackerOptions`

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `assets` | `SaccadeAssets` | `{}` | Where to load the model and WebAssembly runtimes from. See [Hosting the assets](../guides/hosting-the-assets). |
| `video` | `{ width?, height? }` | `640 × 480` | `getUserMedia` ideals, user-facing camera. |
| `tta` | `number` | `5` | Ring-buffer length for test-time augmentation: how many embeddings are averaged before predicting. |
| `executionProviders` | `("webgpu" \| "wasm")[]` | `["webgpu", "wasm"]` | ONNX Runtime execution providers, tried in order. |
| `onFrame` | `(f: TrackerFrame) => void` | — | Convenience: equivalent to calling `onFrame()` after construction. |
| `stream` | `MediaStream` | — | Use this camera stream instead of calling `getUserMedia`, for when the page already owns the camera. The tracker will not stop a stream it did not open. |
| `model` | `EmbeddingModel` | — | Substitute the embedding model — for tests (`StubEmbeddingModel`) or a session you warmed up yourself. |

### Methods

| Member | Signature | Notes |
| --- | --- | --- |
| `init` | `(): Promise<InitResult>` | Requests the camera, loads MediaPipe and ONNX, warms them up. **Idempotent** — safe to call repeatedly; later calls return the same promise. Rejects if the camera is denied. |
| `initialized` | `boolean` (getter) | |
| `video` | `HTMLVideoElement` (readonly) | The live camera element, **unmirrored**. Append it to the DOM to show a preview; mirror it with CSS if you do. Never mirror the pixels the model sees. |
| `start` | `(): void` | Starts the frame loop. Safe before `init()`: the loop begins when init finishes. |
| `stop` | `(): void` | Stops the loop. The camera stays open. |
| `dispose` | `(): void` | Stops everything and releases the camera. **Not reversible** — construct a new tracker. |
| `running` | `boolean` (getter) | |
| `onFrame` | `(cb: (f: TrackerFrame) => void) => () => void` | Subscribe to every frame. Returns the unsubscribe function. |
| `nextFrame` | `(): Promise<TrackerFrame>` | Resolves with the next emitted frame. |
| `nextEmbedding` | `(): Promise<Float32Array \| null>` | |
| `nextGaze` | `(): Promise<Gaze \| null>` | |
| `addCalibrationPoint` | `(target: Gaze, embeddings: Float32Array[]): void` | Adds one observation. Does not fit. |
| `clearCalibration` | `(): void` | |
| `getCalibrationPoints` | `(): CalPoint[]` | |
| `fitCalibration` | `(opts?: { lambda?, center? }) => { lambda, nPoints } \| null` | Solves the ridge map from the points added so far. `null` when there is nothing to fit. `lambda` defaults to `lambdaFor(nPoints)`. |
| `calibrated` | `boolean` (getter) | `gaze` stays `null` until this is true. |
| `getKernel` | `(): Float32Array \| null` | The fitted 256-long kernel (x and y interleaved). |
| `setTta` / `getTta` | `(n: number): void` / `(): number` | |
| `getCurrentGaze` | `(): { gaze: Gaze; time: FrameTime } \| null` | The most recent estimate. |
| `sampleLuminance` | `(): number` | Mean luminance of the whole current camera frame (BT.601 on a 64 × 48 downsample). Public so the loopback and your own code can reuse the tracker's video rather than opening a second stream. |

```ts
interface InitResult {
  ep: "webgpu" | "wasm";   // the execution provider that actually loaded
  videoWidth: number;
  videoHeight: number;
}
```

`ep` is worth recording: a machine that silently fell back to `"wasm"` will run at a lower
frame rate, and that is usually a misconfigured asset URL rather than a missing GPU.

## `TrackerFrame`

One per camera frame, whether or not a face was found.

```ts
interface TrackerFrame {
  gaze: Gaze | null;              // viewport fractions; null until calibrated
  faceFound: boolean;
  crop: Uint8Array | null;        // 144 x 36 grayscale, row-major — the model's input
  embedding: Float32Array | null; // 128 values, this frame only
  meanEmbedding: Float32Array | null;  // the TTA ring-buffer mean, which is what `gaze` came from
  timings: { landmark: number; crop: number; embed: number; total: number; wait?: number };
  time: FrameTime;
  fps: number;                    // smoothed
  error: string | null;
}

interface Gaze { x: number; y: number }   // 0–1, origin top-left
```

`timings` is per-stage wall time in ms; it is diagnostic, not part of the timing correction.

## `FrameTime`

```ts
interface FrameTime {
  capture: number;
  source: "captureTime" | "receiveTime" | "callback";
  receive: number | null;
  presentedFrames: number | null;
  dropped: number | null;
  callback: number;
  emit: number;
  meanCapture: number | null;
}
```

| Field | Meaning |
| --- | --- |
| `capture` | The frame's capture time — the sample time to record with a gaze estimate. |
| `source` | Which metadata field supplied `capture`. `"captureTime"` is the camera's own stamp and the only one that supports a timing claim; `"receiveTime"` is arrival in the renderer; `"callback"` means the browser gave no `requestVideoFrameCallback` metadata at all. |
| `receive` | `VideoFrameCallbackMetadata.receiveTime`, if present. |
| `presentedFrames` | The camera's monotone frame counter, if present. |
| `dropped` | Frames the camera presented but this loop never saw, since the previous frame. |
| `callback` | When JavaScript received the frame. |
| `emit` | When the prediction became available. `emit − capture` is the processing latency, and matters only for gaze-contingent designs. |
| `meanCapture` | Mean `capture` of the frames in the TTA ring buffer — **the time the smoothed `gaze` actually refers to**. Equals `capture` when `tta` is 1. Use this one. |

What `capture` cannot see is display lag plus camera lag; that is what
[`runLoopback`](#runloopback) measures. See [Timing and synchrony](../guides/timing-and-synchrony).

## Calibration and validation helpers

Pure drivers: they walk a list of targets, call back into your UI, and collect samples. They
contain no DOM of their own, so the same functions drive the demo on this site, the jsPsych
plugins, and anything you write.

```ts
interface CollectOptions { settleMs: number; captureMs: number }
interface TargetUi { showTarget: (t: Gaze | null, phase: "settle" | "capture") => void }
```

For each target: `showTarget(target, "settle")`, wait `settleMs`, `showTarget(target,
"capture")`, collect for `captureMs`, then `showTarget(null, …)` at the end.

### `runCalibration`

```ts
runCalibration(tracker, targets: Gaze[], opts: CollectOptions, ui: TargetUi): Promise<CalPoint[]>
```

Collects embeddings and calls `addCalibrationPoint` for each target. **It does not fit** — call
`tracker.fitCalibration()` afterwards.

```ts
interface CalPoint { target: Gaze; embeddings: Float32Array[]; meanEmbedding: Float32Array }
```

### `runValidation`

```ts
runValidation(
  tracker,
  targets: Gaze[],
  opts: CollectOptions & { roiRadiusPx: number; viewport: { width: number; height: number } },
  ui: TargetUi,
): Promise<ValidationResult>
```

Collects *gaze* rather than embeddings, so the tracker must already be calibrated. Points that
produced no gaze are reported with `NaN` errors rather than dropped, so you can see which
targets failed.

```ts
interface ValidationResult {
  points: {
    target: Gaze;
    samples: { gaze: Gaze; time: number }[];
    meanGaze: Gaze;
    errorViewport: number;   // Euclidean error in viewport fractions
    errorPx: number;         // the same error in pixels, using the viewport passed in
    percentInRoi: number;    // 0–100, share of samples within roiRadiusPx of the target
  }[];
  medianErrorViewport: number;
  meanErrorPx: number;
  percentInRoi: number;
}
```

### Grids and λ

```ts
defaultGrid13(): Gaze[]     // 3×3 at 5/50/95% plus 4 inner points at 27.5/72.5%
trainingGrid20(): Gaze[]    // 4×5, denser
validationGrid9(): Gaze[]   // 3×3 at 15/50/85% — deliberately off the calibration grid
lambdaFor(nPoints: number): number   // 3 when nPoints <= 9, else 1
```

Validate on `validationGrid9()`, not on the calibration points: fitting and scoring on the same
targets measures the fit, not the participant.

## `runLoopback`

```ts
runLoopback(tracker: SaccadeTracker, opts?: LoopbackOptions): Promise<LoopbackResult>
```

Measures display lag plus camera lag as one number by flashing the page and watching it with
the camera. The tracker must be initialised; it may be running, in which case gaze processing
is paused for the duration and resumed after.

### `LoopbackOptions`

| Option | Default | Meaning |
| --- | --- | --- |
| `durationMs` | `15000` | |
| `gapMinMs` / `gapMaxMs` | `500` / `1000` | The random interval between flips. Sparse by design: it never looks like flicker, and it de-aliases the camera's frame clock. |
| `levels` | `["#000", "#fff"]` | `[dark, light]` CSS colours. `["#333", "#ccc"]` is the gentler option; it lowers `peakD` and may need a longer run. |
| `seed` | random | For a reproducible schedule. |
| `container` | a fixed full-viewport `div` on `document.body` | Where to draw. |
| `onProgress` | — | `(fractionDone: number) => void`. |

### `LoopbackResult`

| Field | Meaning |
| --- | --- |
| `lagMs` | **The correction.** Plateau centre on the `captureTime` clock: display lag + camera lag. |
| `plateauWidthMs` | Width of the interval of lags consistent with every edge — the uncertainty, bounded below by one camera frame. |
| `peakD` | Height of the edge-difference peak, 0–1. Below 0.5 the screen change was not clearly visible to the camera. |
| `nEdges` | Usable edges found. |
| `halves` | `{ first, second }` — the estimate from each half of the run. Large disagreement means something changed mid-run. |
| `cameraPeriodMs`, `cameraJitterMs`, `droppedFrames` | Camera health. |
| `rafPeriodMs`, `rafMaxMs` | Display health: the animation-frame interval and its worst case. |
| `clockSource` | The `FrameTime.source` in force. Anything but `"captureTime"` makes `lagMs` advisory. |
| `verdict` | `"OK"` \| `"INCONCLUSIVE"` \| `"UNRELIABLE"`. |
| `reason` | Why, when the verdict is not `"OK"`. |
| `flips`, `samples` | The raw data: flip times and per-frame luminance. Keep these if you want to re-analyse. |
| `seed`, `settings` | What was actually run. |

The verdict is `"OK"` when `peakD ≥ 0.5`, the plateau is at most 34 ms, and the halves agree —
within 8 ms when there are at least 15 edges per half, within 20 ms otherwise.

### Analysis functions

The estimator is exported so that stored `flips`/`samples` can be re-analysed offline, and so
that the statistics are testable:

```ts
sparseSchedule(durationMs, minGapMs, maxGapMs, rand?): number[]
seededRandom(seed): () => number
estimateLagEdges(flips, samples, opts?): LagResult   // the one runLoopback uses
estimateLag(flips, samples, opts?): LagResult        // level-based, for comparison
intervalStats(ts: number[]): IntervalStats
splitHalves(flips, samples, opts?, estimator?): SplitHalves
```

## Assets

```ts
interface SaccadeAssets {
  modelUrl?: string;             // eye_embedding.onnx
  ortWasmUrl?: string;           // directory URL for onnxruntime-web's .wasm/.mjs
  mediapipeWasmUrl?: string;     // directory URL for @mediapipe/tasks-vision wasm
  faceLandmarkerUrl?: string;    // face_landmarker.task
  ortModuleUrl?: string;         // explicit ESM URL for onnxruntime-web
  mediapipeModuleUrl?: string;   // explicit ESM URL for @mediapipe/tasks-vision
}
```

The last two are only consulted by the **`<script>`-tag build**, which cannot resolve a bare
module specifier and so has to `import()` the runtimes from a URL. Under a bundler they are
ignored, because the bundler has already resolved `onnxruntime-web` and
`@mediapipe/tasks-vision` as ordinary dependencies. `ortModuleUrl` defaults to the
`ort.bundle.min.mjs` inside `ortWasmUrl`, so if you self-host ORT into one directory you
usually do not need to set it; set it only when the ESM entry point lives somewhere other than
alongside the `.wasm` files.

Defaults resolve relative to the package under a bundler, and to jsDelivr otherwise. The
pinned versions and default URLs are exported as `ORT_VERSION`, `MEDIAPIPE_VERSION`,
`DEFAULT_ORT_WASM_URL`, `DEFAULT_MEDIAPIPE_WASM_URL` and `DEFAULT_FACE_LANDMARKER_URL`. See
[Hosting the assets](../guides/hosting-the-assets).

## Lower-level exports

Useful if you are building something other than a gaze estimator on top of the same pieces.
All of these are pure and unit-tested.

| Export | What |
| --- | --- |
| `cropBBox(lm, W, H)` | The eye bounding box from a landmark list. |
| `rgbaToGray`, `resizeBilinearCv`, `clahe` | The three preprocessing steps, each matching OpenCV byte for byte. |
| `extractEyeCrop(frameRGBA, W, H, lm)` | All of the above in one call: the 144 × 36 strip. |
| `solveRidge(rows, lambda, center?)`, `predict(e, kernel, center?)`, `calWeight`, `fitRidge` | The calibration mathematics. |
| `Landmarker`, `createLandmarker(opts?)` | The MediaPipe wrapper on its own. |
| `OrtEmbeddingModel`, `StubEmbeddingModel` | The ONNX model, and a stub for tests. |
| `Pipeline` | The frame loop without the camera management. |
| `loadOrt`, `loadVision`, `presetModules`, `modelUrl` | Asset loading, and a way to inject already-loaded modules. |
| `EYE_W` (144), `EYE_H` (36), `EMB_DIM` (128), `CENTER`, `CAL_HEAD` | Constants. |
| `median(values)`, `meanEmbedding(embeddings)` | Small helpers. |
| `version` | The package version, as published. |
