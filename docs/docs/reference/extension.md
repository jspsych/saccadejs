---
id: extension
title: Extension — @saccadejs/extension
sidebar_label: Extension
description: The jsPsych extension that records gaze during any trial.
---

# `@saccadejs/extension`

The extension connects saccade.js to jsPsych. You use it in two places:

1. **Once, in `initJsPsych`**, to make eye tracking available to the experiment. Every
   saccade.js plugin needs this.
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

A trial records gaze only after the setup trials have started the camera and calibrated the
participant. [Getting started](/getting-started) shows them in order.

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
| `tracker` | `SaccadeTracker` | — | Use a tracker you have already created with the [core API](core-api), instead of letting the extension create one. The extension will not shut down a tracker it did not create. It ignores `assets` and `smoothing_frames` in this case, so set those on the tracker. It applies `mode` only when [`start()`](#methods) runs, so you still need a `saccade-preview` trial or your own call to `start()`. |
| `mode` | `"live" \| "deferred" \| "auto"` | `"live"` | Where the model runs. `"live"` runs it on every frame as it arrives. `"deferred"` runs it in background threads and fills in gaze after each trial, for computers too slow to keep up. `"auto"` times the model when the camera starts and picks one. See [Slow computers and deferred mode](../guides/deferred-mode). |
| `deferred_workers` | `number` | see description | Deferred mode only: how many background threads to run. The default is the number of processor cores minus two, between one and three, and one on a computer with 4 GB of memory or less. |

Registering the extension does not turn on the camera. The permission request and the model
download happen at the first [`saccade-preview`](plugin-preview) trial, where the participant
can see what you are asking for and why. Put one in the timeline before any trial that records
gaze. If you build your own camera setup screen instead, call [`start()`](#methods) from it.

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
| `saccade_deferred` | `{frames, embedded, lost, complete, crops?}` | Deferred mode only. `saccade_data` is filled in after the trial ends; this tracks how far along it is, and `complete` turns `true` when it is final. See [Slow computers and deferred mode](../guides/deferred-mode#what-changes-in-deferred-mode). |

The extension also adds two columns to **every** trial in the experiment, whether or not it
records gaze, including trials that ran before the model loaded:

- `saccade_model` names the eye model in use, for example `"eye-embedding@1.0.0"`. See
  [Recording which model you used](../models#recording-which-model-you-used).
- `saccade_mode` is `"live"` or `"deferred"`.

The extension fills both in when the camera starts, so they are missing only if the camera never
starts. If you supplied your own tracker through the `tracker` setting, `saccade_mode` appears
once `start()` runs.

### How `t` is calculated

`t` is the time the camera captured the frame, minus the trial's start time, minus the
screen-to-camera lag if [`saccade-time-sync`](plugin-time-sync) has measured one. When
`smoothing_frames` is above 1, the capture time is the average over the combined frames. In code:
`(time.meanCapture ?? time.capture) - trialStart - (offset ?? 0)`.

For example, if the trial started at `performance.now()` 48,213.7, the camera captured a frame at
48,342.7, and time sync measured a 78 ms lag, that sample's `t` is 48,342.7 − 48,213.7 − 78 = 51.

### When targets are measured

The extension measures each target once, the first time it appears on the page with a size. For
an `<img>`, that happens when the image file finishes loading, which can be after the trial
starts. So `saccade_targets` records where an element was when the participant could first see
it, and does not track it if it moves later. An element that never appears is left out of
`saccade_targets`, so check that it is there before testing gaze against it:

```js
const box = data.saccade_targets["#stim"];
if (box) {
  const onStim = data.saccade_data.filter(
    (s) => s.x >= box.left && s.x <= box.right && s.y >= box.top && s.y <= box.bottom,
  );
}
```

## Methods

Most experiments never need these. They are for custom plugins, gaze-contingent displays, and
debugging. You reach them through `jsPsych.extensions.saccade`, for example
`jsPsych.extensions.saccade.showPredictions()`.

### Camera and tracker

| Method | Returns | Description |
| --- | --- | --- |
| `start()` | `Promise<void>` | Ask for the camera, load the model, and start processing frames. With `mode: "auto"` or `"deferred"` it also times the model and starts the background threads before it resolves, which adds a few seconds. Calling it again once it has started does nothing. |
| `pause()` | `void` | Stop processing frames. The camera stays on. |
| `resume()` | `void` | Start processing frames again. |
| `isInitialized()` | `boolean` | Whether `start()` has finished successfully. |
| `faceDetected()` | `boolean` | Whether a face was found in the most recent frame. |
| `getBackend()` | `"webgpu" \| "wasm" \| null` | Whether the model is running on the graphics card (`"webgpu"`) or the slower processor path (`"wasm"`). |
| `getTracker()` | `SaccadeTracker` | The underlying [tracker from the core library](core-api). |
| `onSetupProgress(cb)` | `() => void` | Get progress updates while `start()` loads (see [`SaccadeProgress`](core-api#saccadeprogress)). You receive the latest update straight away. Returns a function that stops the updates. Also works for a tracker passed in through the `tracker` setting. |
| `getSetupProgress()` | `SaccadeProgress \| null` | The most recent progress update. |
| `dispose()` | `void` | Shut everything down: stop listening for frames, remove the camera preview and gaze dot, and turn off the camera (unless the tracker was passed in through the `tracker` setting). jsPsych has no clean-up step for extensions, so a page that runs more than one experiment must call this in between. |

### On-screen feedback

| Method | Returns | Description |
| --- | --- | --- |
| `showVideo()` / `hideVideo()` | `void` | Show or hide a small mirrored camera preview in the bottom-left corner. |
| `showPredictions()` / `hidePredictions()` | `void` | Show or hide a dot at the current gaze estimate. Useful while piloting. |

Hiding the video does not remove it from the page. Chrome only delivers camera frames to a video
that is on the page, so `hideVideo()` shrinks it to 2 × 2 pixels and makes it invisible. It also
takes the video back from any plugin that was displaying it. If you hide the video with your own
CSS, do not use `display: none`, or the tracker stops receiving frames.

### Calibration

The [`saccade-calibrate`](plugin-calibrate) plugin handles all of this for you. Use these methods
only if you are building your own calibration procedure.

| Method | Returns | Description |
| --- | --- | --- |
| `resetCalibration()` | `void` | Throw away all calibration points and the fitted calibration. |
| `calibratePoint(x, y, embeddings?, captureMs?, timeoutMs?)` | `Promise<number>` | Add one calibration point at pixel position (`x`, `y`). If you do not supply `embeddings`, it records them from the camera for `captureMs` (default `500`). If a single camera frame takes longer than `timeoutMs` (default `5000`) to arrive, it fails with the error `no camera frames for <ms> ms`. Returns how many frames it recorded. In deferred mode it returns how many frames it queued, and adds the point once the background threads have processed them (a few may still be lost). Call `finishCalibration()` before fitting. |
| `fitCalibration(lambda?, fit?)` | `{lambda, nPoints, weighting, fit} \| null` | Fit the calibration from the points added so far. You must call this after adding points with `calibratePoint`. `weighting` says whether frames were weighted by quality: `"model"`, `"head"` or `"uniform"` (not weighted). `fit` is `"frames"` (every frame, the default) or `"points"` (one average per dot, the method saccade.js used up to version 0.3). |
| `getCalibrationPoints()` | `CalPoint[]` | The calibration points, with positions as fractions of the window (0 to 1), and the eye data recorded at each. |

### Reading gaze live

| Method | Returns | Description |
| --- | --- | --- |
| `getCurrentPrediction()` | `{x, y, t} \| null` | The latest gaze estimate, in pixels. `t` is on the `performance.now()` clock, as for `onGazeUpdate`. |
| `onGazeUpdate(cb)` | `() => void` | Call `cb` with every new gaze estimate. Returns a function that stops the updates. |

Unlike `t` in `saccade_data`, `t` here does **not** count from the trial start. It is a
`performance.now()` time, `(time.meanCapture ?? time.capture) - (offset ?? 0)`, and these methods
report it during every trial, whether or not that trial is recording. To get a time relative to
some event, subtract that event's own `performance.now()` time:

```js
const shownAt = performance.now();
const stop = jsPsych.extensions.saccade.onGazeUpdate((g) => {
  console.log(g.x, g.y, g.t - shownAt); // ms since the stimulus appeared
});
// later: stop();
```

Deferred mode has no live gaze. These methods return nothing, and the gaze dot stays hidden.

### Deferred mode

| Method | Returns | Description |
| --- | --- | --- |
| `getMode()` | `"live" \| "deferred"` | The mode in effect. |
| `getModeDecision()` | `ModeDecision \| null` | How the mode was chosen: `mode`, `reason`, `ep`, `embedMs` (the median time to run the model on one frame), `cameraFps` and `limitMs`. Has an `error` if deferred mode was chosen but its threads would not start. With `mode: "deferred"` nothing is measured: `reason` is `"requested"`, `embedMs` and `limitMs` are `NaN` and `cameraFps` is `null`. `null` with `mode: "live"`. |
| `getDeferredPending()` | `number` | Frames waiting for, or being processed by, the background threads. Always `0` in live mode. |
| `collectGaze()` | `() => Promise<{x, y, t}[]>` | Start collecting gaze. Call the returned function to stop. It resolves with the samples, with `t` on the `performance.now()` clock. In live mode these are the samples `onGazeUpdate` delivered. In deferred mode it resolves once the frames have been processed, and resolves `[]` if the tracker was not calibrated when collection started. `saccade-validate` collects this way. |
| `finishCalibration(onProgress?)` | `Promise<void>` | In deferred mode, `calibratePoint` queues its frames and adds the point once the background threads have processed them. This waits for every queued point, so call it before `fitCalibration`. Resolves at once in live mode. |
| `catchUp(options?)` | `Promise<SaccadeCatchUpResult>` | Wait for the background threads to finish every queued frame. Options: `max_wait_ms` (default `null`, no limit), `save_unprocessed_crops`, `onProgress(pending, total)`. Resolves with `{ mode, frames_waiting, frames_lost, timed_out, crops_saved, wait_ms }`. [`saccade-catch-up`](plugin-catch-up) runs this and saves the result as its trial data. The plugin's page describes each field. |

### Timing correction

| Method | Returns | Description |
| --- | --- | --- |
| `getTimingOffset()` | `number \| null` | The screen-to-camera lag currently being subtracted from `t`, in ms. |
| `setTimingOffset(ms \| null)` | `void` | Set the lag yourself. `null` turns the correction off. |
| `getLastLoopback()` | `LoopbackResult \| null` | The full result of the most recent [`saccade-time-sync`](plugin-time-sync) measurement. |
| `setLastLoopback(result \| null)` | `void` | Store a loopback result for `getLastLoopback()`. The time-sync plugin calls this; call it yourself if you run [`runLoopback`](core-api#runloopback) directly. It does not change the offset. Use `setTimingOffset` for that. |

## Timing your own events

`t` in `saccade_data` counts from `saccade_timing.trial_start`. To line up an event of your own,
such as a sound played partway through the trial, call `performance.now()` when it happens and
save it minus `trial_start`. Your trial's `on_finish` can already read `data.saccade_timing`,
because jsPsych adds extension data first.
[Timing your own events](../guides/timing-and-synchrony#timing-your-own-events) has a complete
example and some pitfalls to avoid.
