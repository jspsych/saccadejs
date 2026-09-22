---
id: extension
title: Extension — @saccadejs/extension
sidebar_label: Extension
description: The jsPsych extension that records gaze during any trial.
---

# `@saccadejs/extension`

The extension is what connects saccade.js to jsPsych. You use it in two places:

1. **Once, in `initJsPsych`**, to make eye tracking available to the experiment. All the
   saccade.js plugins need this.
2. **On each trial you want to record**, by listing it in the trial's `extensions`. That trial's
   data then gets a gaze sample for every camera frame.

```js
// 1. Make eye tracking available.
const jsPsych = initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade }],
});

// 2. Record gaze during this trial, and note where #stim was on screen.
timeline.push({
  type: jsPsychHtmlKeyboardResponse,
  stimulus: "<img id='stim' src='face.png'>",
  extensions: [{ type: jsPsychExtensionSaccade, params: { targets: ["#stim"] } }],
});
```

A trial records gaze only once the camera has been started and the participant calibrated, by
the setup trials. [Getting started](/getting-started) shows them in order.

| | |
| --- | --- |
| Package | `@saccadejs/extension` |
| Browser global | `jsPsychExtensionSaccade` |
| Name | `"saccade"`, so it is reached as `jsPsych.extensions.saccade` |

## Settings in `initJsPsych`

These go in `params` where you register the extension, and apply to the whole experiment.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `round_predictions` | `boolean` | `true` | Round `x` and `y` to whole pixels in the saved data. |
| `smoothing_frames` | `number` | `1` | How many camera frames to average into each gaze estimate. `1` means no averaging. Higher values give steadier estimates that lag slightly behind the eyes. Keep it at `1` if the display reacts to gaze. |
| `assets` | `SaccadeAssets` | `{}` | Where to download the model and its supporting files from. See [Hosting the assets](../guides/hosting-the-assets). |
| `tracker` | `SaccadeTracker` | — | Use a tracker you have already created with the [core API](core-api), instead of letting the extension create one. The extension will not shut down a tracker it did not create. |

Registering the extension does not turn on the camera. The permission request and the model
download happen at the first [`saccade-preview`](plugin-preview) trial, where the participant
can see what is being asked and why. Put one in the timeline before any trial that records gaze.
If you would rather start the camera another way, call [`start()`](#methods) yourself, for
example from a [`call-function`](https://www.jspsych.org/latest/plugins/call-function/) trial.

## Settings on a trial

These go in `params` where you attach the extension to a trial.

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `targets` | `string[]` | `[]` | CSS selectors for elements on the page, such as `"#left"`. The position and size of each element on this participant's screen is saved in `saccade_targets`. |

## Data

A trial with the extension attached gets these fields:

| Field | Type | Description |
| --- | --- | --- |
| `saccade_data` | `{x, y, t}[]` | The gaze samples. One row per camera frame in which a face was found (and calibration had run). `x` and `y` are pixels from the top-left of the browser window. `t` is milliseconds since the trial started. |
| `saccade_targets` | `{ [selector]: {x, y, width, height, top, bottom, left, right} }` | Where each `targets` element was, in the same pixel coordinates as `saccade_data`. |
| `saccade_timing` | `{offset_ms, corrected, clock, dropped_frames, fps, smoothing_frames, trial_start}` | How the timestamps were produced, and how well the camera kept up. `trial_start` is the moment `t` counts from. See [Timing and synchrony](../guides/timing-and-synchrony). |

The extension also adds one column to **every** trial that runs after the model has loaded,
whether or not it records gaze: `saccade_model`, naming the eye model in use, for example
`"eye-embedding@1.0.0"`. See [Recording which model you used](../models#recording-which-model-you-used).

**How `t` is calculated.** It is the time the camera captured the frame, minus the trial's start
time, minus the screen-to-camera lag if [`saccade-time-sync`](plugin-time-sync) has measured one.
When `smoothing_frames` is above 1, the capture time is the average over the frames that were
combined. In code: `(time.meanCapture ?? time.capture) - trialStart - (offset ?? 0)`.

**When targets are measured.** Each target's position is measured once, the first time it
appears on the page with a size. For an `<img>`, that is when the image file finishes loading,
which can be after the trial starts. So `saccade_targets` records where an element was when the
participant could first see it. If the element moves afterwards, that is not recorded. An element
that never appears is left out of `saccade_targets` entirely, so check that it is there before
testing gaze against it.

## Methods

Most experiments never need these. They are for custom plugins, gaze-contingent displays, and
debugging. Reach them through `jsPsych.extensions.saccade`, for example
`jsPsych.extensions.saccade.showPredictions()`.

### Camera and tracker

| Method | Returns | Description |
| --- | --- | --- |
| `start()` | `Promise<void>` | Ask for the camera, load the model, and start processing frames. Calling it again once it has started does nothing. |
| `pause()` | `void` | Stop processing frames. The camera stays on. |
| `resume()` | `void` | Start processing frames again. |
| `isInitialized()` | `boolean` | Whether `start()` has finished successfully. |
| `faceDetected()` | `boolean` | Whether a face was found in the most recent frame. |
| `getBackend()` | `"webgpu" \| "wasm" \| null` | Whether the model is running on the graphics card (`"webgpu"`) or the slower processor path (`"wasm"`). |
| `getTracker()` | `SaccadeTracker` | The underlying [tracker from the core library](core-api). |
| `onSetupProgress(cb)` | `() => void` | Get progress updates while `start()` loads (see [`SaccadeProgress`](core-api)). You receive the latest update straight away. Returns a function that stops the updates. Also works for a tracker passed in through the `tracker` setting. |
| `getSetupProgress()` | `SaccadeProgress \| null` | The most recent progress update. |
| `dispose()` | `void` | Shut everything down: stop listening for frames, remove the camera preview and gaze dot, and turn off the camera (unless the tracker was passed in through the `tracker` setting). jsPsych has no clean-up step for extensions, so a page that runs more than one experiment must call this in between. |

### On-screen feedback

| Method | Returns | Description |
| --- | --- | --- |
| `showVideo()` / `hideVideo()` | `void` | Show or hide a small mirrored camera preview in the bottom-left corner. |
| `showPredictions()` / `hidePredictions()` | `void` | Show or hide a dot at the current gaze estimate. Useful while piloting. |

Hiding the video does not remove it from the page. Chrome only delivers camera frames to a video
that is on the page, so `hideVideo()` shrinks it to 2 × 2 pixels and makes it invisible instead.
It also takes the video back from any plugin that was displaying it. If you hide it yourself,
never use `display: none`, or the tracker stops receiving frames.

### Calibration

The [`saccade-calibrate`](plugin-calibrate) plugin handles all of this for you. These are for
building your own calibration procedure.

| Method | Returns | Description |
| --- | --- | --- |
| `resetCalibration()` | `void` | Throw away all calibration points and the fitted calibration. |
| `calibratePoint(x, y, embeddings?, captureMs?, timeoutMs?)` | `Promise<number>` | Add one calibration point at pixel position (`x`, `y`). If you do not supply `embeddings`, it records them from the camera for `captureMs` (default `500`). If a single camera frame takes longer than `timeoutMs` (default `5000`) to arrive, it fails with the error `no camera frames for <ms> ms`. Returns how many frames it recorded. |
| `fitCalibration(lambda?)` | `{lambda, nPoints, weighting} \| null` | Fit the calibration from the points added so far. You must call this after adding points with `calibratePoint`. `weighting` says whether frames were weighted by quality: `"model"`, `"head"` or `"uniform"` (not weighted). |
| `getCalibrationPoints()` | `CalPoint[]` | The calibration points, with positions as fractions of the window (0 to 1), and the eye data recorded at each. |

### Reading gaze live

| Method | Returns | Description |
| --- | --- | --- |
| `getCurrentPrediction()` | `{x, y, t} \| null` | The latest gaze estimate, in pixels. `t` is on the `performance.now()` clock, as for `onGazeUpdate`. |
| `onGazeUpdate(cb)` | `() => void` | Call `cb` with every new gaze estimate. Returns a function that stops the updates. |

Note that `t` here is **not** measured from the trial start, unlike `t` in `saccade_data`. It is
a `performance.now()` time, and it is reported in every trial, whether or not that trial is
recording. It is calculated as `(time.meanCapture ?? time.capture) - (offset ?? 0)`. To get a time
relative to some event, subtract that event's own `performance.now()` time.

### Timing correction

| Method | Returns | Description |
| --- | --- | --- |
| `getTimingOffset()` | `number \| null` | The screen-to-camera lag currently being subtracted from `t`, in ms. |
| `setTimingOffset(ms \| null)` | `void` | Set the lag yourself. `null` turns the correction off. |
| `getLastLoopback()` | `LoopbackResult \| null` | The full result of the most recent [`saccade-time-sync`](plugin-time-sync) measurement. |

## Timing your own events

`t` in `saccade_data` counts from `saccade_timing.trial_start`. To line up an event of your own,
such as a sound played partway through the trial, call `performance.now()` when it happens and
save it in the trial's data minus `trial_start`. `data.saccade_timing` is already available in
your trial's `on_finish`, because jsPsych adds extension data first.
[Timing your own events](../guides/timing-and-synchrony#timing-your-own-events) has a complete
example and some pitfalls to avoid.
