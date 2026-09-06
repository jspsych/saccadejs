---
id: migrating-from-webgazer
title: Migrating from WebGazer
sidebar_label: Migrating from WebGazer
description: A parameter-by-parameter and field-by-field mapping from jsPsych's WebGazer extension and plugins to saccade.js.
---

# Migrating from WebGazer

saccade.js was designed so that an existing
[WebGazer experiment](https://www.jspsych.org/latest/overview/eye-tracking/) ports mostly by
search-and-replace. The extension and plugin parameter names match WebGazer's wherever the
concept is the same, and the trial data has the same shape with a different prefix.

## The one-minute version

| Replace | With |
| --- | --- |
| `@jspsych/extension-webgazer` | `@saccadejs/extension` |
| `jsPsychExtensionWebgazer` | `jsPsychExtensionSaccade` |
| `@jspsych/plugin-webgazer-init-camera` | `@saccadejs/plugin-preview` |
| `jsPsychWebgazerInitCamera` | `jsPsychSaccadePreview` |
| `@jspsych/plugin-webgazer-calibrate` | `@saccadejs/plugin-calibrate` |
| `jsPsychWebgazerCalibrate` | `jsPsychSaccadeCalibrate` |
| `@jspsych/plugin-webgazer-validate` | `@saccadejs/plugin-validate` |
| `jsPsychWebgazerValidate` | `jsPsychSaccadeValidate` |
| `webgazer_data` | `saccade_data` |
| `webgazer_targets` | `saccade_targets` |
| `jsPsych.extensions.webgazer` | `jsPsych.extensions.saccade` |
| the `webgazer.js` `<script>` tag | the `saccadejs` `<script>` tag |

Then add one trial that has no WebGazer equivalent:

```js
timeline.push({ type: jsPsychSaccadeTimeSync });   // after preview, before calibration
```

And drop the WebGazer-specific extension parameter `sampling_interval` — see below.

## Extension: `initialize` parameters

| WebGazer | saccade.js | Note |
| --- | --- | --- |
| `round_predictions` (`true`) | `round_predictions` (`true`) | Same meaning: round `x`, `y` to whole pixels. |
| `auto_initialize` (`false`) | `auto_initialize` (`false`) | Same meaning: request the camera at `initJsPsych` time instead of at the preview trial. |
| `sampling_interval` (`34`) | *(removed)* | saccade.js emits one sample per camera frame and does not resample. The frame rate is whatever the camera delivers, recorded in `saccade_timing.fps`. |
| `webgazer` (an instance) | `tracker` (a `SaccadeTracker`) | Same escape hatch: pass a pre-built instance instead of letting the extension construct one. |
| — | `tta` (`5`) | New: how many frames the embedding is averaged over. |
| — | `assets` (`{}`) | New: where to load the model and WebAssembly runtimes from. See [Hosting the assets](hosting-the-assets). |

Trial-level parameters are unchanged: `params: { targets: ["#stim"] }`.

## Extension: methods

`jsPsych.extensions.saccade` keeps WebGazer's method names where the concept survives.

| WebGazer | saccade.js | Note |
| --- | --- | --- |
| `start()` | `start()` | Both return a promise. |
| `pause()` / `resume()` | `pause()` / `resume()` | Same. |
| `isInitialized()` | `isInitialized()` | Same. |
| `showVideo()` / `hideVideo()` | `showVideo()` / `hideVideo()` | Same small mirrored preview, bottom-left. |
| `showPredictions()` / `hidePredictions()` | `showPredictions()` / `hidePredictions()` | Same gaze dot. |
| `resetCalibration()` | `resetCalibration()` | Same. |
| `calibratePoint(x, y)` | `calibratePoint(x, y, embeddings?)` | Pixels in, as before. saccade.js collects a short burst of embeddings if you do not supply them, then you must call `fitCalibration()`. |
| `getCurrentPrediction()` | `getCurrentPrediction()` | Returns `{x, y, t}` in pixels, or `null`. |
| `onGazeUpdate(cb)` | `onGazeUpdate(cb)` | Returns an unsubscribe function. |
| `stop()` | — | Use `pause()`, or `getTracker().stop()`. |
| `faceDetected()` | — | Read `faceFound` from a frame via `getTracker().onFrame(...)`. |
| `showFaceOverlay()` / `showFaceFeedbackBox()` | — | No landmark overlay or feedback box. The preview plugin shows the actual model input (the eye crop) and a face-found indicator instead, which is more informative about whether the pipeline is working. |
| `startMouseCalibration()` | — | Use `plugin-calibrate` with `calibration_mode: "click"`. |
| — | `fitCalibration(lambda?)` | New, and **required** after manual `calibratePoint` calls. WebGazer trains incrementally; saccade.js solves a ridge regression once, at the end. |
| — | `getCalibrationPoints()` | New. |
| — | `getTimingOffset()` / `setTimingOffset(ms)` | New. The measured loopback lag. |
| — | `getLastLoopback()` | New. The full `LoopbackResult` from the last time-sync run. |
| — | `getTracker()` | New. The underlying `SaccadeTracker`. |

## Trial data

| WebGazer | saccade.js |
| --- | --- |
| `webgazer_data: {x, y, t}[]` | `saccade_data: {x, y, t}[]` — identical shape and units (viewport pixels; `t` in ms from trial start) |
| `webgazer_targets: {selector: {x, y, width, height, top, bottom, left, right}}` | `saccade_targets`, identical |
| — | `saccade_timing: {offset_ms, corrected, clock, dropped_frames, fps, tta}` |

The only behavioural difference in `saccade_data` is `t`: it is
`(meanCapture ?? capture) − trialStart − offset` — the camera's own capture stamp, averaged
over the test-time-augmentation window the estimate actually came from, with the measured lag
subtracted. WebGazer's `t` is uncorrected and derived from when JavaScript received the frame.
`saccade_timing.corrected` tells you which convention a given trial used. If you want the old, uncorrected behaviour, do
not run `saccade-time-sync` — but see [Timing and synchrony](timing-and-synchrony) for why you
should.

Existing analysis code that hit-tests samples against target rectangles needs no changes beyond
the field rename.

## Plugin parameters

### `webgazer-init-camera` → `saccade-preview`

| WebGazer | saccade.js | Default |
| --- | --- | --- |
| `instructions` | `instructions` | HTML explaining head positioning |
| `button_text` | `button_text` | `"Continue"` |
| — | `show_eye_crop` | `true` |
| — | `require_face` | `true` |
| — | `preview_width` | `320` |

WebGazer's camera step shows a face-box overlay; saccade.js shows the 144 × 36 eye crop that
actually goes into the model, which makes lighting and framing problems obvious.

### `webgazer-calibrate` → `saccade-calibrate`

| WebGazer | saccade.js | Default | Note |
| --- | --- | --- | --- |
| `calibration_points` | `calibration_points` | the 13-point grid | Same `[x%, y%]` pairs. WebGazer's default is 9 points at 10/50/90%. |
| `calibration_mode` | `calibration_mode` | `"view"` | Same `"click"` \| `"view"`. |
| `repetitions_per_point` | `repetitions_per_point` | `1` | Same. |
| `randomize_calibration_order` | `randomize_calibration_order` | `false` | Same. |
| `time_to_saccade` | `time_to_saccade` | `1000` | Same: the settle interval before sampling. |
| `time_per_point` | `time_per_point` | `500` | Same: the capture interval. |
| — | `point_size` | `20` | |
| — | `lambda` | `null` | Ridge penalty; `null` picks it from the number of points. |
| — | `clear_previous` | `true` | |

### `webgazer-validate` → `saccade-validate`

Parameters are the same names with the same meanings: `validation_points`,
`validation_point_coordinates` (`"percent"` \| `"center-offset-pixels"`), `roi_radius` (200),
`randomize_validation_order`, `time_to_saccade` (1000), `validation_duration` (2000),
`point_size` (20), `show_validation_data` (false).

Data keeps WebGazer's fields — `raw_gaze`, `percent_in_roi`, `average_offset`,
`validation_points`, `samples_per_sec` — and adds `median_error_px` and
`median_error_viewport`.

One rename to watch in `saccade-calibrate`: WebGazer's calibration data reuses the parameter
name for the pixel list, while saccade.js records it as **`calibration_points_px`** and leaves
`calibration_points` as the percentage input, so the two units never silently swap. The data
also records `n_points` (distinct targets that yielded an observation) and
`repetitions_per_point`.

## Things that behave differently

- **Calibration is fitted, not trained.** WebGazer updates a running regression on every click;
  saccade.js collects embeddings and solves a ridge regression once. In practice this means
  calibration points must all be collected before anything is predicted, and a mid-experiment
  top-up needs another `fitCalibration()`.
- **There is no mouse-movement calibration.** WebGazer can quietly keep learning from cursor
  position throughout an experiment. saccade.js does not, because a fitted model that changes
  underneath your trials makes gaze data from early and late trials incomparable.
- **The model is a 20 MB download.** WebGazer ships as a small script and builds its regression
  from scratch per participant. saccade.js downloads a pre-trained embedding model once, cached
  by the browser thereafter. Budget for that on the first page load — see
  [Hosting the assets](hosting-the-assets).
- **A face is required for a sample.** WebGazer emits predictions continuously; saccade.js
  emits a row only for frames in which a face was found, so gaps in `saccade_data` are
  meaningful and worth checking.
- **WebGPU when available.** With WebGPU the model runs at camera rate; without it, on the
  WebAssembly fallback, expect a lower frame rate. Both are recorded (`saccade_timing.fps`).
