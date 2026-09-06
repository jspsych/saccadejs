---
id: extension
title: Extension — @saccadejs/extension
sidebar_label: Extension
description: The jsPsych extension that records gaze during any trial.
---

# `@saccadejs/extension`

Register it in `initJsPsych` to make eye tracking available to the experiment; attach it to a
trial to record a gaze sample for every camera frame of that trial. Every plugin on this site
requires it.

| | |
| --- | --- |
| Package | `@saccadejs/extension` |
| Browser global | `jsPsychExtensionSaccade` |
| Name | `"saccade"`, so it is reached as `jsPsych.extensions.saccade` |

## `initialize` parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `round_predictions` | `boolean` | `true` | Round `x` and `y` to whole pixels in the recorded data. |
| `auto_initialize` | `boolean` | `false` | Prompt for the camera and download the model during `initJsPsych` instead of at the [`saccade-preview`](plugin-preview) trial. |
| `tta` | `number` | `5` | Frames whose embeddings are averaged before predicting. Higher is smoother and laggier; set `1` for gaze-contingent designs. |
| `assets` | `SaccadeAssets` | `{}` | Model and runtime URLs. See [Hosting the assets](../guides/hosting-the-assets). |
| `tracker` | `SaccadeTracker` | — | Use a pre-built tracker instead of constructing one. The extension will not dispose a tracker it did not create. |

## Trial parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `targets` | `string[]` | `[]` | CSS selectors. Each element's bounding rectangle is recorded in `saccade_targets`. |

## Data

| Field | Type | Description |
| --- | --- | --- |
| `saccade_data` | `{x, y, t}[]` | One row per camera frame in which a face was found and a calibrated prediction was available. `x` and `y` are viewport pixels; `t` is ms since the trial started. |
| `saccade_targets` | `{ [selector]: {x, y, width, height, top, bottom, left, right} }` | Bounding rectangle of each `targets` element, in viewport pixels. |
| `saccade_timing` | `{offset_ms, corrected, clock, dropped_frames, fps, tta}` | What timing correction was applied, and camera health. See [Timing and synchrony](../guides/timing-and-synchrony). |

`t` is `(time.meanCapture ?? time.capture) - trialStart - (offset ?? 0)`: the camera's own
capture stamp, averaged over the `tta` frames the estimate came from, with the measured lag
subtracted when [`saccade-time-sync`](plugin-time-sync) has run.

## Methods

Reached as `jsPsych.extensions.saccade`.

| Method | Returns | Description |
| --- | --- | --- |
| `start()` | `Promise<void>` | Prompt for the camera, load the model, start the frame loop. Idempotent. |
| `pause()` | `void` | Stop the frame loop; the camera stays open. |
| `resume()` | `void` | Restart it. |
| `isInitialized()` | `boolean` | Whether `start()` has completed successfully. |
| `faceDetected()` | `boolean` | Whether the most recent frame contained a face. |
| `getBackend()` | `"webgpu" \| "wasm" \| null` | The execution provider the model is running on. |
| `getTracker()` | `SaccadeTracker` | The underlying [tracker](core-api). |
| `showVideo()` / `hideVideo()` | `void` | A small mirrored camera preview, bottom left. |
| `showPredictions()` / `hidePredictions()` | `void` | A dot at the current gaze estimate. |
| `resetCalibration()` | `void` | Discard all points and the fitted map. |
| `calibratePoint(x, y, embeddings?, captureMs?)` | `Promise<number>` | Add one point at a viewport pixel location, collecting embeddings for `captureMs` (default `500`) when none are supplied. Returns how many were recorded. |
| `fitCalibration(lambda?)` | `{lambda, nPoints} \| null` | Fit the ridge map. Required after manual `calibratePoint` calls. |
| `getCalibrationPoints()` | `CalPoint[]` | Targets in viewport fractions, with their embeddings. |
| `getCurrentPrediction()` | `{x, y, t} \| null` | The latest estimate, in viewport pixels. |
| `onGazeUpdate(cb)` | `() => void` | Subscribe to every estimate; returns an unsubscribe function. |
| `getTimingOffset()` | `number \| null` | The offset currently subtracted from `t`. |
| `setTimingOffset(ms \| null)` | `void` | Set it manually. `null` turns the correction off. |
| `getLastLoopback()` | `LoopbackResult \| null` | The full result of the last time-sync run. |

## Example

```js
const jsPsych = initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade, params: { tta: 1 } }],
});

timeline.push({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: "<img id='stim' src='face.png'>",
  extensions: [{ type: jsPsychExtensionSaccade, params: { targets: ["#stim"] } }],
});
```

## Trial order

```js
timeline.push({ type: jsPsychSaccadePreview });    // camera and model
timeline.push({ type: jsPsychSaccadeTimeSync });   // needs a camera
timeline.push({ type: jsPsychSaccadeCalibrate });  // needs a camera
timeline.push({ type: jsPsychSaccadeValidate });   // needs a fitted calibration
```
