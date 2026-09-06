---
id: core-api
title: Core API — @saccadejs/core
sidebar_label: Core (@saccadejs/core)
description: SaccadeTracker, the calibration and validation helpers, runLoopback, and the core types.
---

# Core API — `@saccadejs/core`

The jsPsych-agnostic library: a camera, a face landmarker, an ONNX embedding model, a ridge
calibration, and a timing loopback. The [extension](extension) and the plugins are thin wrappers
over what is on this page.

```js
import { SaccadeTracker, runCalibration, runValidation, runLoopback } from "@saccadejs/core";
```

From a script tag the browser bundle defines one global, `Saccade`, holding the same named
exports: `new Saccade.SaccadeTracker()`, `await Saccade.runLoopback(tracker)`.

Times are `performance.now()` milliseconds. Coordinates are viewport fractions, 0–1, origin top
left; converting to pixels is the caller's job. Nothing touches the camera until `init()`.

## `SaccadeTracker`

```ts
new SaccadeTracker(options?: SaccadeTrackerOptions)
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `assets` | `SaccadeAssets` | `{}` | Model and runtime URLs. See [Hosting the assets](../guides/hosting-the-assets). |
| `video` | `{ width?, height? }` | `640 × 480` | `getUserMedia` ideals, user-facing camera. |
| `tta` | `number` | `5` | Embeddings averaged before predicting. |
| `executionProviders` | `("webgpu" \| "wasm")[]` | `["webgpu", "wasm"]` | ONNX Runtime providers, tried in order. |
| `onFrame` | `(f: TrackerFrame) => void` | — | Equivalent to calling `onFrame()` after construction. |
| `onProgress` | `(p: SaccadeProgress) => void` | — | Called during `init()` as each stage starts: `camera`, `mediapipe`, `landmarker`, `ort`, `model`, `session`, `ready`. The `model` stage also reports `loaded` and `total` bytes of the ONNX download, so you can show a progress bar. |
| `stream` | `MediaStream` | — | Use this camera stream instead of calling `getUserMedia`. The tracker will not stop a stream it did not open. |
| `model` | `EmbeddingModel` | — | Substitute the embedding model, for tests or a pre-warmed session. |

### Members

| Member | Signature | Notes |
| --- | --- | --- |
| `init` | `(): Promise<InitResult>` | Requests the camera, loads MediaPipe and ONNX, warms them up. Idempotent. Rejects if the camera is denied. |
| `initialized` | `boolean` (getter) | |
| `video` | `HTMLVideoElement` (readonly) | The live camera element, unmirrored. Mirror it with CSS if you show it; never mirror the pixels the model sees. |
| `start` | `(): void` | Starts the frame loop. Safe before `init()`. |
| `stop` | `(): void` | Stops the loop. The camera stays open. |
| `dispose` | `(): void` | Stops everything and releases the camera. Not reversible. |
| `running` | `boolean` (getter) | |
| `onFrame` | `(cb: (f: TrackerFrame) => void) => () => void` | Subscribe to every frame; returns the unsubscribe function. |
| `nextFrame` | `(): Promise<TrackerFrame>` | |
| `nextEmbedding` | `(): Promise<Float32Array \| null>` | |
| `nextGaze` | `(): Promise<Gaze \| null>` | |
| `addCalibrationPoint` | `(target: Gaze, embeddings: Float32Array[]): void` | Adds one observation. Does not fit. |
| `clearCalibration` | `(): void` | |
| `getCalibrationPoints` | `(): CalPoint[]` | |
| `fitCalibration` | `(opts?: { lambda?, center? }) => { lambda, nPoints } \| null` | Solves the ridge map from the points added so far. `null` when there is nothing to fit. |
| `calibrated` | `boolean` (getter) | `gaze` stays `null` until this is true. |
| `getKernel` | `(): Float32Array \| null` | The fitted 256-long kernel, x and y interleaved. |
| `setTta` / `getTta` | `(n: number): void` / `(): number` | |
| `getCurrentGaze` | `(): { gaze: Gaze; time: FrameTime } \| null` | |
| `sampleLuminance` | `(): number` | Mean luminance of the current camera frame. |

```ts
interface InitResult {
  ep: "webgpu" | "wasm";   // the execution provider that loaded
  videoWidth: number;
  videoHeight: number;
}
```

## `TrackerFrame`

One per camera frame, whether or not a face was found.

```ts
interface TrackerFrame {
  gaze: Gaze | null;                   // viewport fractions; null until calibrated
  faceFound: boolean;
  crop: Uint8Array | null;             // 144 x 36 grayscale, row-major
  embedding: Float32Array | null;      // 128 values, this frame only
  meanEmbedding: Float32Array | null;  // the TTA mean, which `gaze` came from
  timings: { landmark: number; crop: number; embed: number; total: number; wait?: number };
  time: FrameTime;
  fps: number;                         // smoothed
  error: string | null;
}

interface Gaze { x: number; y: number }   // 0-1, origin top-left
```

`timings` is per-stage wall time in ms, diagnostic only.

## `FrameTime`

| Field | Type | Meaning |
| --- | --- | --- |
| `capture` | `number` | The frame's capture time: the sample time to record with a gaze estimate. |
| `source` | `"captureTime" \| "receiveTime" \| "callback"` | Which metadata field supplied `capture`. `"callback"` means the browser gave no video-frame metadata at all. |
| `receive` | `number \| null` | `VideoFrameCallbackMetadata.receiveTime`, if present. |
| `presentedFrames` | `number \| null` | The camera's frame counter, if present. |
| `dropped` | `number \| null` | Frames the camera presented but the loop never saw, since the previous frame. |
| `callback` | `number` | When JavaScript received the frame. |
| `emit` | `number` | When the prediction became available. |
| `meanCapture` | `number \| null` | Mean `capture` of the TTA ring buffer: the time the smoothed `gaze` refers to. Equals `capture` when `tta` is 1. Use this one. |

What `capture` cannot see is display lag plus camera lag, which is what
[`runLoopback`](#runloopback) measures.

## Calibration and validation helpers

Both walk a list of targets and call back into your UI. They contain no DOM of their own.

```ts
interface CollectOptions { settleMs: number; captureMs: number }
interface TargetUi { showTarget: (t: Gaze | null, phase: "settle" | "capture") => void }
```

For each target: `showTarget(target, "settle")`, wait `settleMs`, `showTarget(target,
"capture")`, collect for `captureMs`, then `showTarget(null, …)` at the end.

```ts
runCalibration(tracker, targets: Gaze[], opts: CollectOptions, ui: TargetUi): Promise<CalPoint[]>

interface CalPoint { target: Gaze; embeddings: Float32Array[]; meanEmbedding: Float32Array }
```

`runCalibration` collects embeddings and adds them to the tracker. It does not fit: call
`tracker.fitCalibration()` afterwards.

```ts
runValidation(
  tracker,
  targets: Gaze[],
  opts: CollectOptions & { roiRadiusPx: number; viewport: { width: number; height: number } },
  ui: TargetUi,
): Promise<ValidationResult>

interface ValidationResult {
  points: {
    target: Gaze;
    samples: { gaze: Gaze; time: number }[];
    meanGaze: Gaze;
    errorViewport: number;   // Euclidean error in viewport fractions
    errorPx: number;         // the same error in pixels
    percentInRoi: number;    // 0-100, share of samples within roiRadiusPx
  }[];
  medianErrorViewport: number;
  meanErrorPx: number;
  percentInRoi: number;
}
```

`runValidation` collects gaze rather than embeddings, so the tracker must already be calibrated.
Targets that produced no gaze are reported with `NaN` errors rather than dropped.

### Grids

```ts
defaultGrid13(): Gaze[]     // 3x3 at 5/50/95% plus 4 inner points at 27.5/72.5%
trainingGrid20(): Gaze[]    // 4x5, denser
validationGrid9(): Gaze[]   // 3x3 at 15/50/85%, off the calibration grid
lambdaFor(nPoints: number): number   // 3 when nPoints <= 9, else 1
```

Validate on `validationGrid9()`, not on the calibration points.

## `runLoopback`

```ts
runLoopback(tracker: SaccadeTracker, opts?: LoopbackOptions): Promise<LoopbackResult>
```

Measures display lag plus camera lag as one number by flashing the page and watching it with the
camera. The tracker must be initialised; if it is running, gaze processing pauses for the
duration and resumes after.

| Option | Default | Meaning |
| --- | --- | --- |
| `durationMs` | `15000` | |
| `gapMinMs` / `gapMaxMs` | `500` / `1000` | Random interval between flips. |
| `levels` | `["#000", "#fff"]` | `[dark, light]` CSS colours. `["#333", "#ccc"]` is gentler and needs a longer run. |
| `seed` | random | For a reproducible schedule. |
| `container` | a full-viewport `div` on `document.body` | Where to draw. |
| `onProgress` | — | `(fractionDone: number) => void`. |

| Result field | Meaning |
| --- | --- |
| `lagMs` | The correction: display lag plus camera lag. |
| `plateauWidthMs` | Width of the range of lags consistent with every edge. |
| `peakD` | Height of the edge-difference peak, 0–1. |
| `nEdges` | Usable edges found. |
| `halves` | `{ first, second }`, the estimate from each half of the run. |
| `cameraPeriodMs`, `cameraJitterMs`, `droppedFrames` | Camera health. |
| `rafPeriodMs`, `rafMaxMs` | Animation-frame interval and its worst case. |
| `clockSource` | The `FrameTime.source` in force. Anything but `"captureTime"` makes `lagMs` advisory. |
| `verdict` | `"OK"` \| `"INCONCLUSIVE"` \| `"UNRELIABLE"`. |
| `reason` | Why, when the verdict is not `"OK"`. |
| `flips`, `samples` | Raw flip times and per-frame luminance, for re-analysis. |
| `seed`, `settings` | What was actually run. |

The verdict is `"OK"` when `peakD` is at least 0.5, the plateau is at most 34 ms, and the halves
agree: within 8 ms when there are at least 15 edges per half, within 20 ms otherwise.

The estimator is exported so stored `flips` and `samples` can be re-analysed offline:
`estimateLagEdges`, `estimateLag`, `refineLag`, `sparseSchedule`, `mSequence`, `seededRandom`,
`intervalStats`, `splitHalves`, `stimulusAt`.

## Assets

```ts
interface SaccadeAssets {
  modelUrl?: string;             // eye_embedding.onnx
  ortWasmUrl?: string;           // directory URL for onnxruntime-web's .wasm/.mjs
  mediapipeWasmUrl?: string;     // directory URL for @mediapipe/tasks-vision wasm
  faceLandmarkerUrl?: string;    // face_landmarker.task
  ortModuleUrl?: string;         // script-tag build only
  mediapipeModuleUrl?: string;   // script-tag build only
}
```

Defaults resolve relative to the package under a bundler, and to jsDelivr otherwise. The pinned
versions and default URLs are exported as `ORT_VERSION`, `MEDIAPIPE_VERSION`,
`DEFAULT_ORT_WASM_URL`, `DEFAULT_MEDIAPIPE_WASM_URL` and `DEFAULT_FACE_LANDMARKER_URL`. See
[Hosting the assets](../guides/hosting-the-assets).

## Lower-level exports

| Export | What |
| --- | --- |
| `cropBBox(lm, W, H)` | The eye bounding box from a landmark list. |
| `rgbaToGray`, `resizeBilinearCv`, `clahe` | The three preprocessing steps, each matching OpenCV byte for byte. |
| `extractEyeCrop(frameRGBA, W, H, lm)` | All of the above in one call. |
| `solveRidge`, `predict`, `calWeight`, `fitRidge` | The calibration mathematics. |
| `Landmarker`, `createLandmarker(opts?)` | The MediaPipe wrapper on its own. |
| `OrtEmbeddingModel`, `StubEmbeddingModel` | The ONNX model, and a stub for tests. |
| `Pipeline` | The frame loop without camera management. |
| `loadOrt`, `loadVision`, `presetModules`, `modelUrl` | Asset loading, and a way to inject already-loaded modules. |
| `EYE_W` (144), `EYE_H` (36), `EMB_DIM` (128), `CENTER`, `CAL_HEAD` | Constants. |
| `DEFAULT_SETTLE_MS` (1000), `DEFAULT_CAPTURE_MS` (500) | Calibration timing defaults. |
| `median`, `meanEmbedding` | Small helpers. |
| `version` | The package version, as published. |
