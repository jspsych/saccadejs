---
id: extension
title: Extension — @saccadejs/extension
sidebar_label: Extension
description: The jsPsych extension that records gaze during any trial — initialize parameters, trial parameters, methods and data.
---

# `@saccadejs/extension`

The jsPsych extension. Registering it makes eye tracking available to the whole experiment;
attaching it to a trial records a gaze sample for every camera frame of that trial.

| | |
| --- | --- |
| Package | `@saccadejs/extension` |
| Browser global | `jsPsychExtensionSaccade` |
| `info.name` | `"saccade"` — so it is reached as `jsPsych.extensions.saccade` |
| Replaces | `@jspsych/extension-webgazer` |

```js
import jsPsychExtensionSaccade from "@saccadejs/extension";

const jsPsych = initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade, params: { round_predictions: true } }],
});
```

Every plugin on this site requires the extension to be registered and fetches it via
`jsPsych.extensions.saccade`.

## `initialize` parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `round_predictions` | `boolean` | `true` | Round `x` and `y` to whole pixels in the recorded data. |
| `auto_initialize` | `boolean` | `false` | Call `tracker.init()` — and therefore prompt for the camera — during `initJsPsych`, rather than waiting for [`saccade-preview`](plugin-preview). Leave this `false` unless you have a reason: a camera prompt with no explanation on top of it is the fastest way to lose a participant. |
| `tta` | `number` | `5` | Embeddings averaged before predicting. Higher is smoother and laggier; set `1` for gaze-contingent designs. |
| `assets` | `SaccadeAssets` | `{}` | Model and runtime URLs. See [Hosting the assets](../guides/hosting-the-assets). |
| `tracker` | `SaccadeTracker` | — | Use a pre-built tracker instead of constructing one. The extension will not dispose a tracker it did not create. |

`initialize` returns a promise, which jsPsych awaits.

## Trial parameters

```js
{
  type: jsPsychHtmlKeyboardResponse,
  stimulus: "<img id='stim' src='face.png'>",
  extensions: [{ type: jsPsychExtensionSaccade, params: { targets: ["#stim"] } }],
}
```

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `targets` | `string[]` | `[]` | CSS selectors. The bounding rectangle of each is measured when the trial's display is ready and recorded in `saccade_targets`, so that samples can be hit-tested against elements whose position depends on the participant's window. |

## Data

Three fields are added to the trial.

### `saccade_data`

```ts
{ x: number; y: number; t: number }[]
```

One row per camera frame **in which a face was found** — so gaps are meaningful, not padding.

- `x`, `y` are **pixels relative to the viewport**, directly comparable to `saccade_targets`.
  Integers when `round_predictions` is `true`.
- `t` is **milliseconds since the trial started**, on `performance.now()` — the same clock as
  `rt`:

  ```
  t = (time.meanCapture ?? time.capture) − trialStart − (offset ?? 0)
  ```

  `meanCapture` rather than `capture` because the reported gaze is computed from the mean of
  the last `tta` embeddings, so it refers to the mean of *their* capture times — the instant
  the estimate is actually about. With `tta: 1` the two are identical. The offset is the
  measured loopback lag, subtracted only when one has been measured; see
  `saccade_timing.corrected`.

### `saccade_targets`

```ts
{ [selector: string]: { x, y, width, height, top, bottom, left, right } }
```

The same shape as WebGazer's `webgazer_targets`, in viewport pixels.

### `saccade_timing`

```ts
{
  offset_ms: number | null;                              // the applied loopback lag
  corrected: boolean;                                    // whether t had it subtracted
  clock: "captureTime" | "receiveTime" | "callback";     // where capture times came from
  dropped_frames: number;                                // camera frames the loop never saw
  fps: number;
  tta: number;                                           // embeddings averaged per estimate
}
```

`tta` is recorded because it is what makes `t` a `meanCapture` rather than a `capture`, and
because it sets the effective temporal smoothing of the whole trace: an analysis that compares
data collected under different `tta` settings is comparing differently smoothed signals.

This is the field that makes a timing claim auditable after the fact. It travels with **every**
trial, so an analysis can separate corrected from uncorrected trials, and can exclude
participants whose browser fell back to the animation-frame clock or whose camera dropped
frames. See [Timing and synchrony](../guides/timing-and-synchrony) for suggested criteria.

## Methods

Reached as `jsPsych.extensions.saccade`. Names match WebGazer's where the concept is the same.

### Lifecycle

| Method | Returns | Description |
| --- | --- | --- |
| `start()` | `Promise<void>` | Initialise the tracker (camera prompt, model load) and start the frame loop. Idempotent. This is what `saccade-preview` calls. |
| `pause()` | `void` | Stop the frame loop; the camera stays open. |
| `resume()` | `void` | Restart it. |
| `isInitialized()` | `boolean` | |
| `getTracker()` | `SaccadeTracker` | The underlying tracker, for anything not wrapped here. |

### Display

| Method | Description |
| --- | --- |
| `showVideo()` / `hideVideo()` | A small mirrored camera preview, bottom-left, as WebGazer's. |
| `showPredictions()` / `hidePredictions()` | A dot at the current gaze estimate. Useful in piloting; distracting in a real trial. |

### Calibration

| Method | Returns | Description |
| --- | --- | --- |
| `resetCalibration()` | `void` | Discard all points and the fitted map. |
| `calibratePoint(x_px, y_px, embeddings?)` | `Promise<void>` | Add one point at a pixel location. With no `embeddings`, collects a short burst from the live camera. |
| `fitCalibration(lambda?)` | `{ lambda, nPoints } \| null` | **Required after manual `calibratePoint` calls.** `lambda` defaults to `lambdaFor(nPoints)`. |
| `getCalibrationPoints()` | `CalPoint[]` | |

WebGazer trains incrementally, so a WebGazer script that only calls `calibratePoint` will
appear to do nothing here until `fitCalibration()` runs. `saccade-calibrate` handles this for
you.

### Predictions

| Method | Returns | Description |
| --- | --- | --- |
| `getCurrentPrediction()` | `{ x, y, t } \| null` | The latest estimate, in viewport pixels, with `t` corrected the same way `saccade_data` is. |
| `onGazeUpdate(cb)` | `() => void` | Subscribe to every estimate; returns an unsubscribe function. |

### Timing

| Method | Returns | Description |
| --- | --- | --- |
| `getTimingOffset()` | `number \| null` | The offset currently being subtracted from `t`, or `null` if none. |
| `setTimingOffset(ms \| null)` | `void` | Set it manually — for example from a stored measurement. Setting `null` turns the correction off and makes `saccade_timing.corrected` false. |
| `getLastLoopback()` | `LoopbackResult \| null` | The full result of the last [`saccade-time-sync`](plugin-time-sync) run: verdict, plateau, halves, raw flips and samples. |

## A note on ordering

The setup trials are order-dependent, and getting it wrong fails quietly:

```js
timeline.push({ type: jsPsychSaccadePreview });    // 1. camera + model
timeline.push({ type: jsPsychSaccadeTimeSync });   // 2. needs the camera; not calibration
timeline.push({ type: jsPsychSaccadeCalibrate });  // 3. needs the camera
timeline.push({ type: jsPsychSaccadeValidate });   // 4. needs a fitted calibration
```

Time sync only needs a working camera, so it can go before or after calibration. Putting it
second gets the awkward flashing out of the way while the participant is still in setup mode.
