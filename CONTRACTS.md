# saccade.js — interface contracts (for the initial build)

This file fixes the public interfaces so the core library, the jsPsych packages, and the
docs site can be built in parallel. It is a working document for the first release; the
reference docs in `docs/` are derived from it. **Do not drift from it without updating it.**

## Naming

| thing | value |
|---|---|
| product | **saccade.js** |
| repo | `jspsych/saccadejs` |
| core npm package | `@saccadejs/core` (jsPsych-agnostic), directory `packages/core` — global `Saccade` in the browser bundle |
| extension | `@saccadejs/extension` — global `jsPsychExtensionSaccade`, `info.name = "saccade"` |
| plugins | `@saccadejs/plugin-preview` (`jsPsychSaccadePreview`, type `saccade-preview`), `@saccadejs/plugin-calibrate` (`jsPsychSaccadeCalibrate`, `saccade-calibrate`), `@saccadejs/plugin-validate` (`jsPsychSaccadeValidate`, `saccade-validate`), `@saccadejs/plugin-time-sync` (`jsPsychSaccadeTimeSync`, `saccade-time-sync`) |
| docs site | `docs/` (Docusaurus, `@jspsych/docusaurus-preset`), deployed by `.github/workflows/publish-docs.yml` to GitHub Pages at `https://saccade.jspsych.org` (`baseUrl: "/"`; custom domain set by `docs/static/CNAME` and the repository Pages settings) |

Monorepo: npm workspaces under `packages/*`, built with `@jspsych/config` (rollup + jest +
tsconfig), same as `jspsych/jspsych-multiplayer`. Every package: `src/index.ts`, `README.md`,
`package.json` with `unpkg` pointing at `dist/index.browser.min.js`, `rollup.config.mjs`
(`makeRollupConfig("<Global>")`), `jest.config.cjs`, `tsconfig.json` extending
`@jspsych/config/tsconfig.contrib.json`. License MIT. Prettier printWidth 100.

## Provenance

The core is a port of `web/demo/src/` in the `eye-tracking` repo at commit `a6609ab`
(`~/Documents/GitHub/eye-tracking`). That code is the reference implementation and its tests
(`web/demo/test/*.test.ts`, vitest) are the reference tests; port them to jest. The model is
`packages/core/models/eye_embedding.onnx` (opset 17, input `eye_image` float32
`[1,36,144,1]` 0–255, output `embedding` float32 `[1,128]`), with
`src/generated/cal_weights.json` (`{kernel: number[128], bias}`) and `export_manifest.json`.

## Core: `@saccadejs/core`

All times are `performance.now()` milliseconds unless stated. Coordinates are viewport
fractions 0–1 (origin top-left) inside the core; pixel conversion is the caller's job.

```ts
// ---- assets ------------------------------------------------------------------
export interface SaccadeAssets {
  /** URL of eye_embedding.onnx. Default: resolved relative to the package (bundlers) or
   *  "https://cdn.jsdelivr.net/npm/@saccadejs/core@<version>/models/eye_embedding.onnx". */
  modelUrl?: string;
  /** Directory URL for onnxruntime-web's .wasm/.mjs. Default: jsdelivr onnxruntime-web@<pinned>/dist/. */
  ortWasmUrl?: string;
  /** Directory URL for @mediapipe/tasks-vision wasm. Default: jsdelivr tasks-vision@<pinned>/wasm. */
  mediapipeWasmUrl?: string;
  /** URL of face_landmarker.task. Default: Google's hosted model (float16, latest). */
  faceLandmarkerUrl?: string;
}

// ---- tracker -----------------------------------------------------------------
export interface Gaze { x: number; y: number }            // viewport fractions
export interface FrameTime {                              // as in eye-tracking tracker.ts
  capture: number; source: "captureTime" | "receiveTime" | "callback";
  receive: number | null; presentedFrames: number | null; dropped: number | null;
  callback: number; emit: number; meanCapture: number | null;
}
export interface TrackerFrame {
  gaze: Gaze | null;                 // null until calibrated
  faceFound: boolean;
  crop: Uint8Array | null;           // 36x144 gray, row-major
  embedding: Float32Array | null;    // 128
  meanEmbedding: Float32Array | null;
  timings: { landmark: number; crop: number; embed: number; total: number; wait?: number };
  time: FrameTime;
  fps: number;
  error: string | null;
}
export interface SaccadeTrackerOptions {
  assets?: SaccadeAssets;
  video?: { width?: number; height?: number };  // getUserMedia ideal; default 640x480
  tta?: number;                                  // ring-buffer mean, default 5
  executionProviders?: ("webgpu" | "wasm")[];    // default ["webgpu", "wasm"]
  onFrame?: (f: TrackerFrame) => void;
}
export class SaccadeTracker {
  constructor(opts?: SaccadeTrackerOptions);
  /** Requests the camera, loads MediaPipe + ONNX, warms up. Idempotent. */
  init(): Promise<{ ep: "webgpu" | "wasm"; videoWidth: number; videoHeight: number }>;
  readonly video: HTMLVideoElement;               // the live camera element (unmirrored); callers may display it
  start(): void; stop(): void; dispose(): void;
  get running(): boolean;
  onFrame(cb: (f: TrackerFrame) => void): () => void;   // returns unsubscribe
  nextFrame(): Promise<TrackerFrame>;
  nextEmbedding(): Promise<Float32Array | null>;
  // calibration
  addCalibrationPoint(target: Gaze, embeddings: Float32Array[]): void;
  clearCalibration(): void;
  getCalibrationPoints(): CalPoint[];
  fitCalibration(opts?: { lambda?: number; center?: number }): { lambda: number; nPoints: number } | null;
  get calibrated(): boolean;
  setTta(n: number): void;
  /** Latest gaze (viewport fractions) and its capture time, or null. */
  getCurrentGaze(): { gaze: Gaze; time: FrameTime } | null;
  /** The whole-frame luminance sampler the loopback needs, exposed so plugins can reuse the video. */
  sampleLuminance(): number;
}
export interface CalPoint { target: Gaze; embeddings: Float32Array[]; meanEmbedding: Float32Array }
export function defaultGrid13(): Gaze[]; export function trainingGrid20(): Gaze[]; export function validationGrid9(): Gaze[];
export function lambdaFor(nPoints: number): number;   // 3 when <= 9 points else 1

// ---- calibration / validation helpers (pure, DOM-free) -----------------------
export interface CollectOptions { settleMs: number; captureMs: number;
  /** Reject with `no camera frames for <ms> ms` if one frame takes longer. 0 = wait forever. Default 5000. */
  timeoutMs?: number }
/** Drives a point sequence: for each target, calls showTarget(target,"settle"), waits settleMs,
 *  showTarget(target,"capture"), collects embeddings for captureMs via nextEmbedding, then
 *  addCalibrationPoint. Resolves with the points. */
export function runCalibration(tracker: SaccadeTracker, targets: Gaze[], opts: CollectOptions,
  ui: { showTarget: (t: Gaze | null, phase: "settle" | "capture") => void }): Promise<CalPoint[]>;
export interface ValidationResult {
  points: { target: Gaze; samples: { gaze: Gaze; time: number }[]; meanGaze: Gaze; errorViewport: number; errorPx: number; percentInRoi: number }[];
  medianErrorViewport: number; meanErrorPx: number; percentInRoi: number;
}
export function runValidation(tracker: SaccadeTracker, targets: Gaze[], opts: CollectOptions & { roiRadiusPx: number; viewport: { width: number; height: number } },
  ui: { showTarget: (t: Gaze | null, phase: "settle" | "capture") => void }): Promise<ValidationResult>;

// ---- timing loopback (pure analysis + a DOM driver) --------------------------
export { sparseSchedule, seededRandom, estimateLagEdges, estimateLag, intervalStats, splitHalves } from "./loopback";
export interface LoopbackOptions {
  durationMs?: number;            // default 15000
  gapMinMs?: number; gapMaxMs?: number;   // default 500 / 1000
  levels?: [string, string];      // default ["#000", "#fff"]; reduced contrast ["#333", "#ccc"]
  seed?: number;
  /** Where to draw. Default: a fixed full-viewport div appended to document.body. */
  container?: HTMLElement;
  onProgress?: (fractionDone: number) => void;
}
export interface LoopbackResult {
  lagMs: number;                  // plateau center on captureTime
  plateauWidthMs: number; peakD: number; nEdges: number;
  halves: { first: number; second: number };
  cameraPeriodMs: number; cameraJitterMs: number; droppedFrames: number;
  rafPeriodMs: number; rafMaxMs: number;
  clockSource: FrameTime["source"];
  verdict: "OK" | "INCONCLUSIVE" | "UNRELIABLE"; reason: string | null;
  flips: { t: number; level: number }[]; samples: { t: number; lum: number }[];
  seed: number; settings: Required<Pick<LoopbackOptions, "durationMs" | "gapMinMs" | "gapMaxMs" | "levels">>;
}
/** Runs the no-flicker loopback using the tracker's video; the tracker must be initialised
 *  (it may be running — the loopback pauses gaze processing while it flashes). */
export function runLoopback(tracker: SaccadeTracker, opts?: LoopbackOptions): Promise<LoopbackResult>;
export const version: string;
```

Behavioural requirements carried over from the reference implementation (do not lose):
- Preprocessing must stay **bit-exact** with `crop.ts` (OpenCV gray, INTER_LINEAR resize, CLAHE clipLimit 2.0 with 8×8 tiles — which OpenCV realises as 5×18 padded tiles with an effective clip of 1); port `crop.test.ts` fixtures (`web/demo/fixtures/preproc/*`) with the tests.
- Never mirror the frame that is cropped; the preview may be CSS-mirrored.
- `FrameTime.capture` from rVFC `captureTime`; ring-buffer mean stamped with `meanCapture`.
- Pipelined step (CPU capture of N+1 overlaps GPU embed of N); one `session.run` in flight.
- ORT: `graphOptimizationLevel: "all"`, `numThreads = 1`, wasm fallback; MediaPipe VIDEO mode, GPU delegate with CPU fallback, `numFaces 1`.
- Loopback: sparse schedule, edge-difference estimator (`estimateLagEdges`), plateau verdict
  (`peakD ≥ 0.5`, plateau ≤ 34 ms, halves within 8 ms when ≥ 15 edges/half else 20 ms).

Asset strategy: the ESM build treats `onnxruntime-web` and `@mediapipe/tasks-vision` as
dependencies (bundlers resolve them). The browser bundle (`dist/index.browser.min.js`, global
`Saccade`) must work from a plain `<script>` tag: it bundles nothing heavy, and at `init()`
dynamically `import()`s onnxruntime-web and tasks-vision from the jsdelivr URLs in
`SaccadeAssets` (overridable). `ort.env.wasm.wasmPaths` is set to `ortWasmUrl`.
`package.json` `files` includes `models/`. `models/eye_embedding.onnx` is committed.

## Extension: `@saccadejs/extension`

```ts
initialize({
  round_predictions = true,      // round x,y to integer pixels
  tta = 5,
  assets = {},                   // SaccadeAssets
  tracker,                       // optional pre-built SaccadeTracker
}): Promise<void>
on_start({ targets: string[] }); on_load(); on_finish() => ({ saccade_data, saccade_targets, saccade_timing })
```
`initialize()` never touches the camera: `initJsPsych` runs before any trial is on screen, so a
permission prompt there has nothing to explain itself with. `tracker.init()` happens at the
`saccade-preview` trial, or when the page calls `start()` itself. A trial that records with no
tracker in existence warns once on the console rather than silently returning empty `saccade_data`.

Trial data:
- `saccade_data: { x, y, t }[]` — x,y in **pixels** relative to the viewport;
  `t` = `FrameTime.capture` minus the trial start time, **minus the timing offset** (see below)
  when one has been measured, else uncorrected. One row per camera frame while a face is found.
- `saccade_targets: { [selector]: { x, y, width, height, top, bottom, left, right } }`.
- `saccade_timing: { offset_ms: number | null, corrected: boolean, clock: FrameTime["source"], dropped_frames: number, fps: number }`.

Methods (all public):
`start(): Promise<void>` (init tracker + start), `pause()`, `resume()`, `isInitialized()`,
`showVideo()`/`hideVideo()` (a small mirrored preview, bottom-left),
`showPredictions()`/`hidePredictions()` (gaze dot), `resetCalibration()`,
`calibratePoint(x_px, y_px, embeddings?)` (collects `captureMs` of embeddings if none given),
`fitCalibration(lambda?)`, `getCalibrationPoints()`, `getCurrentPrediction(): {x,y,t} | null`
(pixels), `onGazeUpdate(cb)` → unsubscribe, `getTracker(): SaccadeTracker`,
`getTimingOffset(): number | null`, `setTimingOffset(ms | null)`, `getLastLoopback(): LoopbackResult | null`.

## Plugins

Each plugin requires the extension to be registered (`extensions: [{ type: jsPsychExtensionSaccade }]`
in `initJsPsych`) and fetches it via `jsPsych.extensions.saccade`. All plugins record `rt`.

### `saccade-preview`
Parameters: `instructions` (HTML, default explains positioning), `button_text` ("Continue"),
`show_eye_crop` (true), `require_face` (true; the button is enabled only while a face is found),
`preview_width` (320).
Behaviour: calls `extension.start()` (camera prompt + model load with a progress line), shows
the mirrored camera preview and, beside it, the 144×36 eye crop scaled up, a face-found
indicator and fps/backend. Data: `load_time` (ms to first frame), `face_detected`, `fps`, `backend`.

### `saccade-calibrate`
Parameters: `calibration_points` (default the 13-point grid as `[x%, y%]` pairs),
`calibration_mode` ("view" | "click"; default "view"), `repetitions_per_point` (1),
`randomize_calibration_order` (false), `time_to_saccade` (1000 = settle), `time_per_point`
(500 = capture), `point_size` (20), `lambda` (null → `lambdaFor(n)`), `clear_previous` (true).
Behaviour: same ring/dot animation as the demo (ring shrinks during settle, turns green during
capture). "click" mode collects on click. Fits at the end via
`extension.fitCalibration`. Data: `calibration_points` (px), `n_points`, `lambda`.

### `saccade-validate`
Parameters: `validation_points`, `validation_point_coordinates` ("percent" |
"center-offset-pixels"), `roi_radius` (200), `randomize_validation_order`, `time_to_saccade`
(1000), `validation_duration` (2000), `point_size` (20), `show_validation_data` (false).
Data: `raw_gaze` (per point: `{x,y,dx,dy,t}[]`), `percent_in_roi[]`,
`average_offset[]` (`{x,y,r}`), `validation_points`, plus `median_error_px`,
`median_error_viewport`.

### `saccade-time-sync`
Parameters: `duration` (15000), `gap_min` (500), `gap_max` (1000), `contrast` ("full" |
"reduced"), `instructions` (HTML shown before the run; explains it's a brief screen brightness
test, no flicker), `button_text` ("Start"), `require_ok` (false; if true, UNRELIABLE reruns
once then continues), `apply_offset` (true → `extension.setTimingOffset(lag)`).
Data: `lag_ms`, `plateau_width_ms`, `peak_d`, `halves_ms` ([a,b]), `camera_period_ms`,
`camera_jitter_ms`, `dropped_frames`, `raf_period_ms`, `clock_source`, `verdict`, `reason`,
`applied`.

## Docs site

Docusaurus in `docs/` cloned from `jspsych/jspsych-multiplayer/docs` (same preset, theme,
scripts, `typecheck`), `title: "saccade.js"`, `url: "https://saccade.jspsych.org"`, `baseUrl:
"/"`, `projectName: "saccadejs"`. Sections: Introduction (landing), **Live demo**
(central: preview → time sync → calibrate → validate → free gaze with dot, in the page, using
the built `@saccadejs/core` package via a workspace dependency and the model served from
`docs/static/models/` copied by a `predev`/`prebuild` script), Getting started, Guides
(timing & synchrony — the loopback, what `t` means, the bounded uncertainty; hosting assets),
Reference (core API, extension, each plugin, data fields).

## Amendments from the core build (2026-09-05)

The core landed with these additive deviations; the extension, plugins and docs must follow them:
- `LoopbackResult.verdict` is the enum (`"OK" | "INCONCLUSIVE" | "UNRELIABLE"`) with a separate `reason` (`null` only when OK).
- `runValidation` reports `percentInRoi` on a **0–100** scale (per point and aggregate); points with no gaze are kept with `NaN` errors. `ValidationSample.time` is `meanCapture ?? capture`.
- The browser global `Saccade` is a namespace of named exports (`Saccade.SaccadeTracker`, `Saccade.runLoopback`, …), not a default export.
- Extra optional inputs: `SaccadeAssets.ortModuleUrl` / `mediapipeModuleUrl`; `SaccadeTrackerOptions.stream` (an existing `MediaStream`) and `.model`. Extra members: `tracker.nextGaze()`, `getTta()`, `getKernel()`, `initialized`. Extra exports: `Pipeline`, `Landmarker`, `OrtEmbeddingModel`, `StubEmbeddingModel`, `fitRidge`, `CENTER`, `CAL_HEAD`, `mSequence`, `stimulusAt`, `refineLag`, `modelUrl`, `loadOrt`, `loadVision`, `DEFAULT_*_URL`.

## Decisions on ambiguities raised by the docs build (2026-09-05)

1. **`t` in `saccade_data` uses the smoothed sample's own time**: `t = (time.meanCapture ?? time.capture) − trialStart − (offset ?? 0)`. With the default TTA of 5 that is the mean capture time of the ring buffer — the instant the reported gaze actually refers to. `saccade_timing` also records `tta`.
2. **`saccade-calibrate` data**: the pixel list is `calibration_points_px` (not `calibration_points`, which stays the parameter in percent). `n_points` = number of distinct targets; data also records `repetitions_per_point`.
3. **`saccade-validate` data**: `raw_gaze` is `{x, y, dx, dy, t}[][]` (one array per validation point, in presentation order); add `samples_per_sec` (mean over points).
4. **`saccade-time-sync`** runs the loopback on a full-viewport overlay appended to `document.body` (the core default), not the jsPsych display element — the whole screen must light the face. It hides the jsPsych content underneath for the duration and restores it.
5. **`saccade-preview`** gains `face_timeout` (ms, default `null`): when set, the Continue button enables after that long even if no face has been found, and the data records `face_detected: false`. `fps` is a number, `backend` is `"webgpu" | "wasm"`.
6. Directory names are `packages/plugin-saccadejs-<name>` and `packages/extension-saccadejs`; npm names are `@saccadejs/plugin-<name>` and `@saccadejs/extension`. Intentional.
7. `publish-docs.yml` must trigger on `packages/core/**` as well as `docs/**`, since the demo ships the core.
8. **The core npm package was renamed `saccadejs` → `@saccadejs/core`, and its directory `packages/saccadejs` → `packages/core` (2026-09-06)**, to bring it under the same `@saccadejs/*` scope as the extension and plugins. The browser global stays `Saccade`; the repo name (`jspsych/saccadejs`), the docs site's `baseUrl`/`projectName` (`saccadejs`), and the `packages/plugin-saccadejs-<name>` / `packages/extension-saccadejs` directory names are unaffected.
