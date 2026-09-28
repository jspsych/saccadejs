---
id: core-api
title: Core API — @saccadejs/core
sidebar_label: Core (@saccadejs/core)
description: SaccadeTracker, the calibration and validation helpers, runLoopback, and the core types.
---

# Core API — `@saccadejs/core`

The core library is saccade.js without jsPsych. The [extension](extension) and the plugins are
thin wrappers around what is on this page. You need it if you are:

- building an experiment with something other than jsPsych,
- writing your own jsPsych plugin that uses gaze, or
- re-analyzing stored timing measurements.

If you are using jsPsych and the plugins, you probably do not need this page.

A minimal session looks like this: the same four stages the plugins run. `ui` is your code for
drawing calibration dots, described [below](#calibration-and-validation-helpers).

```js
import { SaccadeTracker, runCalibration, runLoopback, defaultGrid13 } from "@saccadejs/core";

const tracker = new SaccadeTracker();
await tracker.init();          // ask for the camera, load the models
tracker.start();               // start processing frames

const lag = await runLoopback(tracker);                        // measure screen-to-camera delay
await runCalibration(tracker, defaultGrid13(), { settleMs: 1000, captureMs: 500 }, ui);
tracker.fitCalibration();                                      // fit the calibration

tracker.onFrame((frame) => {
  if (frame.gaze) console.log(frame.gaze.x, frame.gaze.y);     // 0-1 fractions of the window
});
```

If you load the library with a `<script>` tag instead of `import`, everything is available on one
global, `Saccade`: `new Saccade.SaccadeTracker()`, `await Saccade.runLoopback(tracker)`.

Three conventions apply throughout:

- **Positions are fractions of the window, not pixels.** `x` and `y` run from 0 to 1, with
  `{x: 0, y: 0}` at the top left and `{x: 1, y: 1}` at the bottom right. Multiply by
  `window.innerWidth` and `window.innerHeight` to get pixels. (The jsPsych extension does this for
  you.)
- **Times are `performance.now()` milliseconds**, the browser's high-resolution clock.
- **Nothing touches the camera until `init()`.** Creating a tracker is safe at any time.

## `SaccadeTracker`

```ts
new SaccadeTracker(options?: SaccadeTrackerOptions)
```

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `assets` | `SaccadeAssets` | `{}` | Model and runtime URLs. See [Hosting the assets](../guides/hosting-the-assets). |
| `video` | `{ width?, height? }` | `640 × 480` | The camera resolution to ask for. The browser treats it as a preference and may deliver something else. Always uses the front-facing camera. |
| `smoothingFrames` | `number` | `1` | How many frames to average into each estimate. `1` means no averaging: each estimate comes from the newest frame alone. |
| `executionProviders` | `("webgpu" \| "wasm")[]` | `["webgpu", "wasm"]` | How to run the eye model, tried in order: on the graphics card (`"webgpu"`), then on the processor (`"wasm"`). |
| `onFrame` | `(f: TrackerFrame) => void` | — | Equivalent to calling `onFrame()` after construction. |
| `onProgress` | `(p: SaccadeProgress) => void` | — | Called during `init()` as each stage starts: `camera`, `mediapipe`, `landmarker`, `ort`, `model`, `session`, `ready`. The `model` stage also reports `loaded` and `total` bytes of the ONNX download, so you can show a progress bar. Equivalent to calling `onProgress()` after construction. |
| `stream` | `MediaStream` | — | Use this camera stream instead of calling `getUserMedia`. The tracker will not stop a stream it did not open. |
| `model` | `EmbeddingModel` | — | Substitute the embedding model, for tests or a pre-warmed session. |

### Members

| Member | Signature | Notes |
| --- | --- | --- |
| `init` | `(): Promise<InitResult>` | Requests the camera, loads MediaPipe and ONNX, warms them up. Idempotent. Rejects if the camera is denied. |
| `initialized` | `boolean` (getter) | |
| `video` | `HTMLVideoElement` (readonly) | The live camera element, unmirrored. Mirror it with CSS if you show it; never mirror the pixels the model sees. **Keep it in the document:** Chrome delivers camera frames only for a rendered video, so hide it with `opacity: 0` / a 2×2 px size, never `display: none` or by unmounting it. The tracker re-attaches it to an invisible holder on `document.body` if it is detached. |
| `start` | `(): void` | Starts the frame loop. Safe before `init()`. |
| `stop` | `(): void` | Stops the loop. The camera stays open. |
| `dispose` | `(): void` | Stops everything and releases the camera. Not reversible. |
| `running` | `boolean` (getter) | |
| `onFrame` | `(cb: (f: TrackerFrame) => void) => () => void` | Subscribe to every frame; returns the unsubscribe function. |
| `onProgress` | `(cb: (p: SaccadeProgress) => void) => () => void` | Subscribe to `init()`'s load progress. The most recent report is delivered straight away; returns the unsubscribe function. |
| `nextFrame` | `(): Promise<TrackerFrame>` | |
| `nextEmbedding` | `(): Promise<Float32Array \| null>` | |
| `nextGaze` | `(): Promise<Gaze \| null>` | |
| `nextSample` | `(): Promise<{ embedding, weight } \| null>` | The next embedding with the model's per-frame weight for it; `weight` is `null` for a model that emits none. What calibration collects through. |
| `addCalibrationPoint` | `(target: Gaze, embeddings: Float32Array[], weights?: number[] \| null): void` | Adds one observation. Does not fit. `weights` are the model's per-frame scores; they weight the point's mean embedding and, averaged, its row in the fit. |
| `clearCalibration` | `(): void` | |
| `getCalibrationPoints` | `(): CalPoint[]` | |
| `fitCalibration` | `(opts?: { lambda?, center?, calHead? }) => { lambda, nPoints, weighting } \| null` | Solves the ridge map from the points added so far. `null` when there is nothing to fit. |
| `calibrated` | `boolean` (getter) | `gaze` stays `null` until this is true. |
| `getKernel` | `(): Float32Array \| null` | The fitted kernel, `2 * d` long for a `d`-dimensional embedding, x and y interleaved. |
| `getCalWeighting` | `(): CalWeighting \| null` | How the last fit weighted its rows; `null` before one has run. |
| `setSmoothingFrames` / `getSmoothingFrames` | `(n: number): void` / `(): number` | Changeable while running. |
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

What `onFrame` callbacks receive: one object per camera frame, whether or not a face was found.
Most code only needs `gaze`, `faceFound` and `time`. The rest is for diagnostics and research.

An _embedding_, below, is the list of numbers the eye model produces to describe how the eyes look
in a frame. Calibration maps embeddings to screen positions; see
[How it works](../guides/how-it-works).

```ts
interface TrackerFrame {
  gaze: Gaze | null;                   // viewport fractions; null until calibrated
  faceFound: boolean;
  crop: Uint8Array | null;             // 144 x 36 grayscale, row-major
  embedding: Float32Array | null;      // the model's width (128 for eye-embedding 1.0.0)
  weight: number | null;               // the model's score for this frame, [0, 1]; null if none
  meanEmbedding: Float32Array | null;  // the smoothing mean, which `gaze` came from
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
| `meanCapture` | `number \| null` | Mean `capture` of the smoothing ring buffer: the time the smoothed `gaze` refers to. Equals `capture` when `smoothingFrames` is 1. Use this one. |

**Which time to use:** record `meanCapture ?? capture` with each gaze estimate. It is when the
camera captured the frame (averaged over the frames combined, if `smoothingFrames` is above 1),
not when the estimate was ready.

Even `capture` is later than the moment the screen changed: it cannot include the time the
monitor took to show the change, or the camera's own delay. [`runLoopback`](#runloopback)
measures those two together, so you can subtract them.

## Calibration and validation helpers

Both step through a list of target positions, telling your code when to show each one. They do
not draw anything themselves: you supply a `showTarget` function that draws the dot however you
like.

```ts
interface CollectOptions { settleMs: number; captureMs: number; timeoutMs?: number }
interface TargetUi { showTarget: (t: Gaze | null, phase: "settle" | "capture") => void }
```

For each target, in order:

1. `showTarget(target, "settle")`: draw the dot. The eyes have `settleMs` to reach it.
2. `showTarget(target, "capture")`: data is collected for `captureMs`. You might change the dot's
   color here, as the plugins do.

After the last target, `showTarget(null, …)` tells you to clear the screen.

```js
const dot = document.getElementById("dot");
const ui = {
  showTarget: (target, phase) => {
    if (!target) {
      dot.style.display = "none";
      return;
    }
    // #dot is styled with position: fixed and translate(-50%, -50%).
    dot.style.display = "block";
    dot.style.left = `${target.x * 100}%`;
    dot.style.top = `${target.y * 100}%`;
    dot.style.background = phase === "capture" ? "green" : "black";
  },
};
```

`timeoutMs` (default `5000`; `0` waits forever) stops the run from hanging if the camera stops
delivering frames, for example because the page stopped displaying the `<video>`, another program
took the camera, or the camera was unplugged. If a single frame takes longer than `timeoutMs`,
the run fails with the error `no camera frames for 5000 ms` instead of leaving a dot on screen
forever. The plugins show that message to the participant.

```ts
runCalibration(tracker, targets: Gaze[], opts: CollectOptions, ui: TargetUi): Promise<CalPoint[]>

interface CalPoint {
  target: Gaze;
  embeddings: Float32Array[];
  weights: number[] | null;     // the model's per-frame scores, when it emits them
  meanEmbedding: Float32Array;  // already weighted by them
}
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
countTargets(cal: CalPoint[]): number   // distinct targets: nine dots shown twice is 9
```

Validate on `validationGrid9()`, not on the calibration points.

### Row weighting

This section explains how frames of different quality (for example, a frame caught mid-blink)
are weighted during calibration. You only need it if you are changing the default behavior or
describing it in a paper.

Each calibration point contributes one weighted row to the ridge fit. The weight comes from the
first of these that applies:

| Source | When | `weighting` |
| --- | --- | --- |
| A `CalHead` you supply | `SaccadeTrackerOptions.calHead`, or `fitCalibration({ calHead })`. An explicit argument wins. | `"head"` |
| The model's second output | The loaded model emits a per-frame weight, averaged over the point's capture window. | `"model"` |
| Nothing | Neither of the above. Every row at 1, which is plain unweighted ridge. | `"uniform"` |

`fitCalibration()` returns which one ran, and `getCalWeighting()` reports it afterwards. Record
it: a weighted fit and an unweighted one are different analyses, and nothing else in the data
tells them apart. `saccade-calibrate` writes the `weighting` column for you.

Weights apply **before** the mean, so a low-scoring frame drops out of the point's embedding
instead of only discounting the finished point. The live smoothing ring uses the same weights,
so a smoothed gaze and a calibration point are computed the same way.

`CAL_HEAD` — the logistic head exported alongside eye-embedding 1.0.0 — is off by default. A
head is trained against one model's embedding space and produces meaningless scores on another
model's embeddings. eye-embedding 1.0.0 now carries its weighting in the graph, so most
experiments do not need this option.

### Embedding width

This section matters only if you are using [your own model](../models#using-your-own-model).

The fit is not fixed at 128. The ridge solve and both mean-embedding paths read their width
from the embeddings they are handed, so a model of any output length works, provided that
length is the same on every frame of a session. `EMB_DIM` is the shipped model's width, useful
for sizing a buffer, and is not a limit.

The solve costs O(d²) in memory and O(d³) to factorise, once, when calibration ends. At 128
that is negligible; at a few thousand it would not be.

Five conditions throw rather than continue with bad numbers: an embedding whose width changes
mid-session, a ragged set of calibration rows, a `CalHead` whose length does not match the
embedding, a half-weighted calibration set, and a weight output that is not a finite number in
`[0, 1]`. The last throws at `init()`, on the warm-up inference, before any participant data
exists.

## `runLoopback`

```ts
runLoopback(tracker: SaccadeTracker, opts?: LoopbackOptions): Promise<LoopbackResult>
```

Measures the delay from a change on the screen to that change appearing in the camera: the
monitor's delay and the camera's delay, as one number. It does this by switching the page
between dark and light at random moments while the camera watches the screen.
[How it works](../guides/how-it-works#measuring-the-screen-to-camera-delay) describes the method.
This is what the [`saccade-time-sync`](plugin-time-sync) plugin runs.

The tracker must be initialized first. If it is running, gaze processing pauses during the
measurement and resumes afterwards.

```js
const result = await runLoopback(tracker);
if (result.verdict === "OK") {
  // subtract result.lagMs from every capture time from now on
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `durationMs` | `15000` | How long to measure, in ms. |
| `gapMinMs` / `gapMaxMs` | `500` / `1000` | Random interval between flips. |
| `levels` | `["#000", "#fff"]` | `[dark, light]` CSS colors. `["#333", "#ccc"]` is gentler and needs a longer run. |
| `seed` | random | For a reproducible schedule. |
| `container` | a full-viewport `div` on `document.body` | Where to draw. |
| `onProgress` | — | `(fractionDone: number) => void`. |

| Result field | Meaning |
| --- | --- |
| `lagMs` | The measured delay, in ms: display lag plus camera lag. Subtract it from capture times. |
| `plateauWidthMs` | How uncertain `lagMs` is: the width of the range of delays that fit every brightness change equally well. |
| `peakD` | How clearly the camera saw the brightness changes, 0–1. |
| `nEdges` | How many brightness changes (edges) were usable. |
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

The functions that compute the estimate are exported too, so you can re-analyze stored `flips`
and `samples` later, outside the experiment:
`estimateLagEdges`, `estimateLag`, `refineLag`, `sparseSchedule`, `mSequence`, `seededRandom`,
`intervalStats`, `splitHalves`, `stimulusAt`.

## Assets

```ts
interface SaccadeAssets {
  modelUrl?: string;             // eye_embedding.onnx (see The model for the requirements)
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

The building blocks the tracker is made of, for testing, research, or building a different
pipeline. Most code never needs them.

| Export | What |
| --- | --- |
| `cropBBox(lm, W, H)` | The eye bounding box from a landmark list. |
| `rgbaToGray`, `resizeBilinearCv`, `clahe` | The three preprocessing steps, each matching OpenCV byte for byte. |
| `extractEyeCrop(frameRGBA, W, H, lm)` | All of the above in one call. |
| `solveRidge`, `predict`, `calWeight`, `fitRidge` | The calibration mathematics. |
| `Landmarker`, `createLandmarker(opts?)` | The MediaPipe wrapper on its own. With `{ headPose: true }`, `detectFace()` also returns the head-pose matrix (4x4, column-major). |
| `headPoseFromMatrix(m)` | Yaw, pitch and roll in degrees, and position, from that matrix. |
| `webglAvailable()` | Whether the page can create a WebGL context (`null` where there is no DOM to ask). The face tracker cannot run without one. |
| `WebGLUnavailableError` | Thrown by `createLandmarker()`, and so by `tracker.init()`, when there is no WebGL. Its `name` is `"WebGLUnavailableError"`. |
| `OrtEmbeddingModel`, `StubEmbeddingModel` | The ONNX model, and a stub for tests. |
| `Pipeline` | The frame loop without camera management. |
| `loadOrt`, `loadVision`, `presetModules`, `modelUrl` | Asset loading, and a way to inject already-loaded modules. |
| `EYE_W` (144), `EYE_H` (36), `EMB_DIM` (128), `CENTER`, `CAL_HEAD` | Constants. `EMB_DIM` is the shipped model's width, not a limit. |
| `DEFAULT_SETTLE_MS` (1000), `DEFAULT_CAPTURE_MS` (500) | Calibration timing defaults. |
| `median`, `meanEmbedding` | Small helpers. |
| `version` | The package version, as published. |
