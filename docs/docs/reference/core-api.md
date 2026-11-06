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

If you are using jsPsych and the plugins, you can skip this page.

Here is a minimal session. It runs the same four stages as the plugins: start the tracker,
measure the delay, calibrate, and read gaze. `ui` is your code for drawing calibration dots,
described [below](#calibration-and-validation-helpers).

```js
import { SaccadeTracker, runCalibration, runLoopback, defaultGrid13 } from "@saccadejs/core";

const tracker = new SaccadeTracker();
await tracker.init();          // ask for the camera, load the models
tracker.start();               // start processing frames

const lag = await runLoopback(tracker);                        // measure screen-to-camera delay
await runCalibration(tracker, defaultGrid13(), { settleMs: 1000, captureMs: 500 }, ui);
tracker.fitCalibration();                                      // map eyes to screen positions

tracker.onFrame((frame) => {
  if (frame.gaze) console.log(frame.gaze.x, frame.gaze.y);     // 0-1 fractions of the window
});
```

If you load the library with a `<script>` tag instead of `import`, everything lives on one
global, `Saccade`. For example, write `new Saccade.SaccadeTracker()` and
`await Saccade.runLoopback(tracker)`.

Three conventions hold across the whole API:

- **Positions are fractions of the window, not pixels.** `x` and `y` run from 0 to 1, with
  `{x: 0, y: 0}` at the top left and `{x: 1, y: 1}` at the bottom right. Multiply by
  `window.innerWidth` and `window.innerHeight` to get pixels: on a 1,600 × 900 window,
  `{x: 0.25, y: 0.5}` is pixel (400, 450). The jsPsych extension does this for you.
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
| `onProgress` | `(p: SaccadeProgress) => void` | — | Called during `init()` as each stage starts: `camera`, `mediapipe`, `landmarker`, `ort`, `model`, `session`, `ready`. Stages you have taken over (a supplied `stream` or `model`) are skipped. `enableDeferred()` reports `deferred`, then `ready` again. The `model` stage also reports `loaded` bytes of the ONNX download, and `total` when the size is known, so you can show a progress bar. See [`SaccadeProgress`](#saccadeprogress). Equivalent to calling `onProgress()` after construction. |
| `stream` | `MediaStream` | — | Use this camera stream instead of calling `getUserMedia`. The tracker will not stop a stream it did not open. |
| `model` | `EmbeddingModel` | — | Use an embedding model you have already loaded, instead of loading one from `assets.modelUrl`. Mainly useful in tests. Deferred mode cannot use it: the background threads load `assets.modelUrl` themselves, so `enableDeferred()` throws unless you also pass `createWorker`. |
| `calHead` | `CalHead \| null` | `null` | A separate scoring model that weights calibration frames, overriding the model's own scores. See [Row weighting](#row-weighting). |
| `calibrationFit` | `"frames" \| "points"` | `"frames"` | How calibration uses the frames recorded at each dot. `"frames"` uses each frame on its own. `"points"` averages each dot's frames first, which is how saccade.js calibrated up to 0.3. See [How the calibration is fit](#how-the-calibration-is-fit). |

### Members

| Member | Signature | Notes |
| --- | --- | --- |
| `init` | `(): Promise<InitResult>` | Asks for the camera, loads the face finder (MediaPipe) and the eye model (ONNX), and runs each once to warm it up. Calling it again returns the same promise. Rejects if camera access is denied, or with a `WebGLUnavailableError` if the browser has no WebGL. |
| `initialized` | `boolean` (getter) | Whether `init()` has finished. |
| `video` | `HTMLVideoElement` (readonly) | The live camera element, unmirrored. Mirror it with CSS if you show it; never mirror the pixels the model sees. **Keep it in the document:** Chrome delivers camera frames only for a rendered video, so hide it with `opacity: 0` / a 2×2 px size, never `display: none` or by unmounting it. The tracker re-attaches it to an invisible holder on `document.body` if it is detached. |
| `start` | `(): void` | Starts the frame loop. Safe before `init()`. |
| `stop` | `(): void` | Stops the loop. The camera stays open. |
| `dispose` | `(): void` | Stops everything and releases the camera. Not reversible. |
| `running` | `boolean` (getter) | Whether the frame loop is running. |
| `onFrame` | `(cb: (f: TrackerFrame) => void) => () => void` | Subscribe to every frame; returns the unsubscribe function. |
| `onProgress` | `(cb: (p: SaccadeProgress) => void) => () => void` | Subscribe to `init()`'s load progress. The most recent report is delivered straight away; returns the unsubscribe function. |
| `nextFrame` | `(): Promise<TrackerFrame>` | Resolves with the next frame. |
| `nextEmbedding` | `(): Promise<Float32Array \| null>` | The next frame's `embedding`. Always `null` in [deferred mode](#deferred-mode). |
| `nextGaze` | `(): Promise<Gaze \| null>` | The next frame's `gaze`. Always `null` in deferred mode. |
| `nextSample` | `(): Promise<{ embedding, weight } \| null>` | The next embedding with the model's per-frame weight for it; `weight` is `null` for a model that does not produce one. Always `null` in deferred mode: there, queue each frame's `crop` with `embedDeferred()` instead, as `runCalibration` does. |
| `addCalibrationPoint` | `(target: Gaze, embeddings: Float32Array[], weights?: number[] \| null): void` | Adds one calibration point, without refitting. `weights` are the model's per-frame quality scores. They set how much each frame counts in the fit. |
| `clearCalibration` | `(): void` | |
| `getCalibrationPoints` | `(): CalPoint[]` | |
| `fitCalibration` | `(opts?: { lambda?, center?, calHead?, fit? }) => { lambda, nPoints, weighting, fit } \| null` | Fits the calibration (a ridge regression) to the points added so far. `fit` overrides `calibrationFit` for this fit. Returns `null` when there is nothing to fit. |
| `calibrated` | `boolean` (getter) | `gaze` stays `null` until this is true. |
| `getKernel` | `(): Float32Array \| null` | The fitted coefficients (the kernel): `2 * d` numbers for an embedding of length `d`, with x and y interleaved. |
| `getCalWeighting` | `(): CalWeighting \| null` | How the last fit weighted its rows; `null` before one has run. |
| `getCenter` | `(): number` | The centering constant of the last fit, which `predict` needs alongside the kernel. |
| `setSmoothingFrames` / `getSmoothingFrames` | `(n: number): void` / `(): number` | Changeable while running. |
| `getCurrentGaze` | `(): { gaze: Gaze; time: FrameTime } \| null` | The most recent gaze estimate and its timing. Always `null` in deferred mode. |
| `sampleLuminance` | `(): number` | Mean luminance of the current camera frame. |
| `getModelIdentity` | `(): ModelIdentity \| null` | Which model actually ran, identified from the bytes that were loaded: its SHA-256, the published version it matched (if any), its embedding length and whether it rates frame quality. `null` before `init()`, and for a substituted `model` that cannot identify itself. See [The model](/models#recording-which-model-you-used). |
| `mode` | `"live" \| "deferred"` (getter) | See [Deferred mode](#deferred-mode). |
| `enableDeferred` / `disableDeferred` | `(opts?) => Promise<DeferredEmbedder>` / `(): void` | Switch to deferred mode and back. `disableDeferred()` drops the frames still waiting. See [Deferred mode](#deferred-mode). |
| `embedDeferred` | `(crop: Uint8Array) => Promise<EmbedResult>` | Deferred mode: queue one frame's `crop` for the background threads. Rejects in live mode. |
| `deferred` | `DeferredEmbedder \| null` (getter) | The background threads, in deferred mode. |
| `measureEmbedMs` | `(): Promise<{ ep, embedMs, samples }>` | Times the live model on this computer (the median of 5 to 15 runs). Pauses the frame loop while it runs. |
| `measureCameraFps` | `(ms = 1000): Promise<number \| null>` | Counts the camera's frames for `ms`. `null` without `requestVideoFrameCallback`, or if fewer than two frames arrived. |

```ts
interface InitResult {
  ep: "webgpu" | "wasm";   // the execution provider that loaded
  videoWidth: number;
  videoHeight: number;
}
```

### `SaccadeProgress`

```ts
interface SaccadeProgress {
  stage: "camera" | "mediapipe" | "landmarker" | "ort" | "model" | "session" | "ready" | "deferred";
  loaded?: number;   // bytes received; the model stage only
  total?: number;    // the file's size, when known; the model stage only
}
```

A stage can be reported more than once: `model` reports on every chunk of the download.

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
  quality: FrameQuality | null;        // distance and lighting measures; null with no eye crop
  meanEmbedding: Float32Array | null;  // averaged over smoothingFrames; `gaze` comes from this
  timings: TrackerTimings;             // { landmark, crop, embed, total, wait? }, in ms
  time: FrameTime;
  fps: number;                         // smoothed
  error: string | null;
}

interface Gaze { x: number; y: number }   // 0-1, origin top-left

interface FrameQuality {
  interocularDistance: number;  // outer eye corners (landmarks 33, 263), normalised image units
  eyeBrightness: number;        // mean gray of the raw eye region, 0-255
  eyeContrast: number;          // SD of the raw eye region's gray levels, 0-255
}
```

`quality` measures the two recording conditions that predicted accuracy in the saccade.js
validation study: how far the participant sits from the camera, and how well their eyes are lit.
saccade.js measures brightness and contrast on the eye region at the camera's full resolution,
before resizing and equalizing it, because equalization would flatten the contrast it is trying
to measure. The [`saccade-preview`](plugin-preview#distance-and-lighting-feedback) plugin turns
these numbers into advice for the participant, such as "move a little closer to the camera".

`timings` reports how long each processing stage took, in ms, for diagnostics. In deferred mode
`embed` is `0`, because the model runs on background threads instead.

`crop` is set on every frame where the tracker found the eyes, in both modes, and `null`
otherwise.

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
| `meanCapture` | `number \| null` | The average `capture` time of the frames averaged into `gaze`, so the time the smoothed estimate refers to. Equals `capture` when `smoothingFrames` is 1. Use this one. |

Record `meanCapture ?? capture` with each gaze estimate. That is the moment the camera captured
the frame (averaged over the combined frames, if `smoothingFrames` is above 1), which is earlier
than when the estimate was ready.

Even `capture` lags behind what was on screen. It cannot account for the time the monitor took to
show a change, or for the camera's own delay. [`runLoopback`](#runloopback) measures those two
delays together so you can subtract them.

## Calibration and validation helpers

`runCalibration` and `runValidation` step through a list of target positions and tell your code
when to show each one. They draw nothing themselves. You supply a `showTarget` function that
draws the dot however you like.

```ts
interface CollectOptions { settleMs: number; captureMs: number; timeoutMs?: number }
interface TargetUi {
  showTarget: (t: Gaze | null, phase: "settle" | "capture") => void;
  processing?: (done: number, total: number) => void;   // deferred mode only; see below
}
```

For each target, in order:

1. `showTarget(target, "settle")` asks you to draw the dot. The participant's eyes get `settleMs`
   to reach it.
2. `showTarget(target, "capture")` means recording has started and lasts `captureMs`. The plugins
   change the dot's color here, and you can too.

After the last target, `showTarget(null, …)` asks you to clear the screen. Here is a `ui` that
does all three with a single `#dot` element:

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

`timeoutMs` (default `5000`, or `0` to wait forever) keeps the run from hanging when the camera
stops delivering frames. That happens if the page stops displaying the `<video>`, another program
takes the camera, or someone unplugs it. If no frame arrives within `timeoutMs`, the run fails
with the error `no camera frames for 5000 ms` instead of leaving a dot on screen forever. The
plugins show that message to the participant. For your own loops over `nextFrame()`, the same
guard is exported as `withFrameTimeout(promise, ms = DEFAULT_FRAME_TIMEOUT_MS)`, where
`DEFAULT_FRAME_TIMEOUT_MS` is `5000`.

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
runValidation(tracker, targets: Gaze[], opts: ValidationOptions, ui: TargetUi): Promise<ValidationResult>

interface ValidationOptions extends CollectOptions {
  roiRadiusPx: number;
  viewport: { width: number; height: number };
}

interface ValidationResult {
  points: ValidationPoint[];
  medianErrorViewport: number;
  meanErrorPx: number;
  percentInRoi: number;
}

interface ValidationPoint {
  target: Gaze;
  samples: ValidationSample[];
  meanGaze: Gaze;
  errorViewport: number;   // Euclidean error in viewport fractions
  errorPx: number;         // the same error in pixels
  percentInRoi: number;    // 0-100, share of samples within roiRadiusPx
}

interface ValidationSample {
  gaze: Gaze;
  time: number;            // capture time (meanCapture when smoothing)
}
```

`runValidation` collects gaze estimates, so calibrate the tracker first. A target that produced
no gaze stays in `points` with `NaN` errors, so you can see which one failed.

In [deferred mode](#deferred-mode), both helpers queue their frames for the background threads.
They finish once the threads have processed every frame, which can take a while after the last
target. At that point `runCalibration` adds the points, and `runValidation` computes gaze with
the calibration that was in place during the run. The screen stays blank during that wait unless
you add a `processing(done, total)` function to `TargetUi` to show progress.

### Grids

```ts
defaultGrid13(): Gaze[]     // 3x3 at 5/50/95% plus 4 inner points at 27.5/72.5%
trainingGrid20(): Gaze[]    // 4x5, denser
validationGrid9(): Gaze[]   // 3x3 at 15/50/85%, off the calibration grid
lambdaFor(nPoints: number, fit?: CalFit): number   // "frames" (default): 3; "points": 3 when nPoints <= 9, else 1
countTargets(cal: CalPoint[]): number   // distinct targets: nine dots shown twice is 9
```

Validate on `validationGrid9()`. Its points sit away from the calibration grid, so validation
measures accuracy at positions the fit has never seen.

### How the calibration is fit

The calibration is a ridge regression (linear regression with a penalty that keeps the
coefficients small) from the eye model's output to the dot's position on the screen. By default
every frame recorded at every dot is one row of that regression. While a participant looks at one
dot their gaze holds still, but the model's output still varies a little from frame to frame.
Fitting every frame lets the regression learn that this variation is noise. The ridge penalty is
3 at any number of dots.

Up to version 0.3, saccade.js averaged each dot's frames into one row and used a penalty of 1,
or 3 with nine dots or fewer. Set `calibrationFit: "points"` to get that fit back, for example
to reproduce an earlier study. Replayed on 200 participants' recorded data, fitting every frame
cut the median error by about 13%, and roughly halved it after a nine-dot calibration.

### Row weighting

Calibration gives some frames more say than others, so that a frame caught mid-blink barely
affects the fit. You only need this section if you are changing that behavior or describing it in
a paper.

Each frame (or, with `calibrationFit: "points"`, each point) is one weighted row of the ridge
fit. The weight comes from the first of these sources that applies:

| Source | When | `weighting` |
| --- | --- | --- |
| A `CalHead` you supply (a separate scoring model; see below) | `SaccadeTrackerOptions.calHead`, or `fitCalibration({ calHead })`. If both are set, the argument to `fitCalibration` wins. | `"head"` |
| The model's second output | The loaded model produces a quality score for each frame. Each frame is weighted by its own score; with `"points"`, a point's weight is the average score over its frames. | `"model"` |
| Nothing | Neither of the above. Every row counts equally, which is plain unweighted ridge regression. | `"uniform"` |

`fitCalibration()` returns which source it used, and `getCalWeighting()` reports it afterwards.
Record it in your data. A weighted fit and an unweighted one are different analyses, and nothing
else in the data tells them apart. `saccade-calibrate` writes the `weighting` column for you.

When frames are averaged, saccade.js weights each frame **before** averaging. A low-scoring frame
therefore contributes little to a point's mean embedding. Smoothing during tracking uses the same
weights, so a smoothed gaze estimate and a calibration point are computed the same way.

`CAL_HEAD` is a separate scoring model (a logistic regression) exported alongside eye-embedding
1.0.0. It is off by default, and most experiments do not need it, because eye-embedding 1.0.0
already scores its own frames. A scoring model only works with the eye model it was trained on.
Given another model's embeddings, its scores are meaningless.

### Embedding width

This section matters only if you are using [your own model](../models#using-your-own-model).

Calibration works with embeddings of any length, not only 128. The fit and the frame averaging
both take their length from the embeddings they receive, so any model works as long as its
output length stays the same for the whole session. `EMB_DIM` is the published model's length,
handy for sizing a buffer.

For an embedding of length _d_, fitting takes memory proportional to _d_² and time proportional
to _d_³. The fit runs once, when calibration ends. At 128 the cost is negligible. At a few
thousand you would notice it.

saccade.js throws an error, instead of carrying on with bad numbers, for any of these:

- an embedding whose length changes during a session,
- calibration points whose embeddings have different lengths,
- a `CalHead` whose length does not match the embedding,
- a calibration set where some points have weights and others do not,
- a quality score that is not a number between 0 and 1.

`init()` catches the last one when it first runs the model, before you collect any participant
data.

## Deferred mode

Deferred mode is for computers too slow to run the model on every frame as it arrives. The frame
loop still does the live work of reading the camera, finding the face, and cutting out the eye
picture. A pool of background threads then runs the model on the pictures you submit, in the
order you submit them. Gaze arrives late, so you cannot change the display based on where the
participant is looking. The [guide](../guides/deferred-mode) explains when to use it. This
section covers the API.

```ts
const decision = chooseMode({ ...(await tracker.measureEmbedMs()), cameraFps: await tracker.measureCameraFps() });
if (decision.mode === "deferred") await tracker.enableDeferred();

// Frames with a face now carry `crop`; `embedding` and `gaze` are null.
const owed: Promise<TimedEmbedding>[] = [];
tracker.onFrame((f) => {
  if (f.crop) owed.push(tracker.embedDeferred(f.crop).then((r) => ({ ...r, time: f.time.capture })));
});
// ... later, once the tracker is calibrated ...
// A frame can be dropped (a full queue, a failed thread), so keep the ones that arrived.
const settled = await Promise.allSettled(owed);
const frames = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
const kernel = tracker.getKernel();
if (!kernel) throw new Error("Calibrate before predicting");
const gaze = predictSeries(frames, kernel, tracker.getSmoothingFrames(), tracker.getCenter());
```

| Export | What |
| --- | --- |
| `tracker.enableDeferred(opts?)` | Starts the background threads, times them, and stops running the model in the frame loop. Reports a `deferred` progress stage while it works. Rejects, leaving the tracker live, if no thread starts, or if the threads' model produces embeddings of a different length from the live model's. Throws if the tracker was given a `model` and `opts` has no `createWorker`. |
| `opts.workers` | How many threads. Default `recommendedWorkers()`. |
| `opts.maxQueue` | The most frames that may wait. Default `10000` (about 50 MB of crops). A frame past it is dropped with reason `"queue-full"`. |
| `opts.modelBytes` | The model file's bytes, if you already have them. Default: fetched from `assets.modelUrl`. |
| `opts.createWorker` | `() => WorkerLike`: start one thread yourself, for example from your own copy of `EMBED_WORKER_SOURCE`. |
| `tracker.embedDeferred(crop)` | Queues a crop. Resolves with `{ embedding, weight }`, or rejects with a `DeferredFrameDropped` if no thread will ever process it (its `reason` is `"queue-full"`, `"cancelled"`, `"failed"` or `"disposed"`). Rejects with a plain `Error` in live mode or for a crop of the wrong length. |
| `chooseMode({ ep, embedMs, cameraFps })` | The rule `mode: "auto"` uses. Live mode needs WebGPU, and one run of the model (`embedMs`) must fit within 85% of a camera frame, clamped to between 30 and 80 ms. At 30 fps that limit is about 28 ms, so it becomes 30. When the camera's rate is unknown, the limit is 30 ms. The constants are exported as `LIVE_FRAME_SHARE`, `LIVE_FLOOR_MS` and `LIVE_CEILING_MS`. Returns a `ModeDecision`: `mode`, `reason`, `ep`, `embedMs`, `cameraFps`, `limitMs`. |
| `predictSeries(frames, kernel, smoothingFrames?, center?)` | Gaze for a run of `{ embedding, weight, time }`, in capture order, smoothed the way the live loop smooths. Each result is `{ gaze, time }`. |
| `recommendedWorkers()` | The default thread count: processor cores minus two, between one and three (`MAX_DEFAULT_WORKERS`), and one with 4 GB of memory or less. Memory is only known in Chromium browsers; elsewhere the cores alone decide. |
| `DeferredEmbedder` | The thread pool on its own; see below. `tracker.deferred` is the tracker's pool. |
| `EMBED_WORKER_SOURCE` | The thread's code. The pool starts it from a `blob:` URL; a page whose Content-Security-Policy forbids that can serve this text itself and pass `createWorker`. |

### `DeferredEmbedder`

`new DeferredEmbedder(opts?)` takes the same options as `enableDeferred()`, plus `assets`.

| Member | Signature | Notes |
| --- | --- | --- |
| `init` | `(): Promise<{ workers, requested }>` | Starts the threads and waits for each to start or fail. A thread that fails (out of memory, say) is dropped. Resolves with how many started out of how many were asked for; rejects if none start. |
| `submit` | `(crop: Uint8Array): Promise<EmbedResult>` | Queues a crop. Frames are processed in the order submitted. |
| `measure` | `(rounds = 3): Promise<{ latencyMs, perFrameMs }>` | Times the pool. `latencyMs` is how long one thread takes to embed one frame. `perFrameMs` is the time per frame with every thread working. |
| `drain` | `(opts?: { deadlineMs?, onProgress?(left, total) }): Promise<DrainResult>` | Waits for the queue to empty, or for `deadlineMs`. Cancels nothing: whatever is left keeps going. Resolves with `{ left, timedOut }`. |
| `cancel` | `(): number` | Drops every frame still waiting, and returns how many. |
| `dispose` | `(): void` | Stops every thread; waiting frames reject with reason `"disposed"`. |
| `workers` | `number` (getter) | Threads running. |
| `pending` | `number` (getter) | Frames waiting or being processed. |
| `stats` | `DeferredStats` (getter) | `{ workers, queued, inFlight, embedded, failed, dropped }`. |
| `latencyMs` | `number \| null` (getter) | Running estimate of how long one thread takes to embed one frame. |
| `throughput` | `number \| null` (getter) | Frames per second the pool can process. |
| `info` | `{ dim, emitsWeight } \| null` | The embedding length and weight output the threads reported. |

## `runLoopback`

```ts
runLoopback(tracker: SaccadeTracker, opts?: LoopbackOptions): Promise<LoopbackResult>
```

Measures how long a change on the screen takes to show up in the camera image. The result
combines the monitor's delay and the camera's delay into one number. To measure it, the page
switches between dark and light at random moments while the camera records the light the screen
throws on the participant's face.
[How it works](../guides/how-it-works#measuring-the-screen-to-camera-delay) describes the method.
This is what the [`saccade-time-sync`](plugin-time-sync) plugin runs.

Call `tracker.init()` first. If the tracker is running, `runLoopback` pauses gaze processing
during the measurement and resumes it afterwards.

```js
const result = await runLoopback(tracker);
const lag = result.verdict === "OK" ? result.lagMs : 0;

tracker.onFrame((frame) => {
  if (!frame.gaze) return;
  const t = (frame.time.meanCapture ?? frame.time.capture) - lag;
  console.log(frame.gaze.x, frame.gaze.y, t);
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `durationMs` | `15000` | How long to measure, in ms. |
| `gapMinMs` / `gapMaxMs` | `500` / `1000` | The shortest and longest time between screen changes, in ms. Each gap is chosen at random between the two. |
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
| `cameraPeriodMs`, `cameraJitterMs`, `droppedFrames` | How regularly the camera delivered frames, and how many it dropped. |
| `rafPeriodMs`, `rafMaxMs` | The average and longest time between screen redraws (`requestAnimationFrame`). |
| `clockSource` | The `FrameTime.source` in use. With anything other than `"captureTime"`, treat `lagMs` as a rough guide. |
| `verdict` | `"OK"` \| `"INCONCLUSIVE"` \| `"UNRELIABLE"`. |
| `reason` | Why, when the verdict is not `"OK"`. |
| `flips`, `samples` | Raw flip times and per-frame luminance, for re-analysis. |
| `seed`, `settings` | What was actually run. |

The verdict is `"OK"` when `peakD` is at least 0.6, the plateau is at most 34 ms, and the halves
agree: within 8 ms when there are at least 15 edges per half, within 20 ms otherwise.

To re-analyze stored `flips` and `samples` after the experiment, use the same functions
`runLoopback` uses, which are exported too: `estimateLagEdges`, `estimateLag`, `refineLag`, `sparseSchedule`, `mSequence`, `seededRandom`,
`intervalStats`, `splitHalves`, `stimulusAt`.

## Assets

```ts
interface SaccadeAssets {
  modelUrl?: string;             // eye_embedding.onnx (see The model for the requirements)
  ortWasmUrl?: string;           // directory URL for onnxruntime-web's .wasm/.mjs
  mediapipeWasmUrl?: string;     // directory URL for @mediapipe/tasks-vision wasm
  faceLandmarkerUrl?: string;    // face_landmarker.task
  ortModuleUrl?: string;         // script-tag build, and deferred mode's threads in every build
  mediapipeModuleUrl?: string;   // script-tag build only
}
```

Leave a field out to use its default. [Hosting the assets](../guides/hosting-the-assets) lists
where each default comes from. The pinned versions and default URLs are exported as
`ORT_VERSION`, `MEDIAPIPE_VERSION`, `DEFAULT_ORT_WASM_URL`, `DEFAULT_MEDIAPIPE_WASM_URL` and
`DEFAULT_FACE_LANDMARKER_URL`.

## Lower-level exports

These are the pieces the tracker is built from. They are useful for tests, research, or building
a different pipeline, and most code never needs them.

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
| `FRAME_LAMBDA` (3) | The ridge penalty of the default `"frames"` fit. |
| `interocularDistance(lm)` | The distance measure in `FrameQuality`, from a landmark list. |
| `formatModelIdentity(id)` | The string written to `saccade_model`: `"eye-embedding@1.0.0"`, `"sha256:…"`, or `"unverified"`. |
| `SECOND_PEAK_MIN_SEPARATION_MS` (40) | How far from the peak a second peak must be to count, in the loopback analysis. |
| `version` | The package version, as published. |

Types exported alongside these, for TypeScript users: `ClaheOptions`, `LandmarkerOptions`,
`FaceDetection`, `HeadPose`, `EmbedResult` (`{ embedding, weight }`), `EmbeddingModel` (what the
`model` option takes), `ModelIdentity` (see [The model](/models#recording-which-model-you-used)),
`TimedEmbedding`, `WorkerLike`, `DeferredStats`, `DrainResult`, and the loopback's `LagOptions`,
`LagResult`, `Flip`, `LumSample`, `CurvePoint`, `Plateau`, `IntervalStats` and `SplitHalves`.
