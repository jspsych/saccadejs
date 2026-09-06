---
id: migrating-from-webgazer
title: Migrating from WebGazer
sidebar_label: Migrating from WebGazer
description: A mapping from jsPsych's WebGazer extension and plugins to saccade.js, and the real differences.
---

# Migrating from WebGazer

Parameter and data field names match [WebGazer's](https://www.jspsych.org/latest/overview/eye-tracking/)
wherever the concept is the same, so most of a migration is search and replace.

## The mapping

| WebGazer | saccade.js |
| --- | --- |
| `@jspsych/extension-webgazer` | `@saccadejs/extension` |
| `jsPsychExtensionWebgazer` | `jsPsychExtensionSaccade` |
| `jsPsych.extensions.webgazer` | `jsPsych.extensions.saccade` |
| `@jspsych/plugin-webgazer-init-camera` | `@saccadejs/plugin-preview` |
| `jsPsychWebgazerInitCamera` | `jsPsychSaccadePreview` |
| `@jspsych/plugin-webgazer-calibrate` | `@saccadejs/plugin-calibrate` |
| `jsPsychWebgazerCalibrate` | `jsPsychSaccadeCalibrate` |
| `@jspsych/plugin-webgazer-validate` | `@saccadejs/plugin-validate` |
| `jsPsychWebgazerValidate` | `jsPsychSaccadeValidate` |
| the `webgazer.js` script tag | the `@saccadejs/core` script tag |
| `webgazer_data` | `saccade_data` |
| `webgazer_targets` | `saccade_targets` |
| `sampling_interval` | *(removed: one sample per camera frame, no resampling)* |
| `startMouseCalibration()` | *(removed: use `calibration_mode: "click"`)* |
| `showFaceOverlay()`, `showFaceFeedbackBox()` | *(removed: the preview plugin shows the eye crop instead)* |
| `stop()` | `pause()`, or `getTracker().stop()` |

Everything else on the extension keeps its WebGazer name and meaning: `start()`, `pause()`,
`resume()`, `isInitialized()`, `faceDetected()`, `showVideo()`, `hideVideo()`,
`showPredictions()`, `hidePredictions()`, `resetCalibration()`, `calibratePoint()`,
`getCurrentPrediction()`, `onGazeUpdate()`.

Plugin parameters carry over too: `instructions`, `button_text`, `calibration_points`,
`calibration_mode`, `repetitions_per_point`, `randomize_calibration_order`, `time_to_saccade`,
`time_per_point`, `validation_points`, `validation_point_coordinates`, `roi_radius`,
`randomize_validation_order`, `validation_duration`, `point_size`, `show_validation_data`.
Validation data keeps `raw_gaze`, `percent_in_roi`, `average_offset`, `validation_points` and
`samples_per_sec`.

Then add one trial with no WebGazer equivalent:

```js
timeline.push({ type: jsPsychSaccadeTimeSync });   // after preview, before calibration
```

## The real differences

- **Calibration is fitted once, not trained incrementally.** No gaze estimate exists until the
  fit runs. If you call `calibratePoint()` yourself, you must then call `fitCalibration()`;
  `saccade-calibrate` does it for you.
- **No mouse-movement calibration.** WebGazer can keep learning from the cursor throughout an
  experiment, which makes early and late trials incomparable. saccade.js does not.
- **A face is required for a sample.** WebGazer predicts continuously. saccade.js emits a row
  only for frames in which a face was found, so gaps in `saccade_data` are meaningful.
- **A 20 MB model download** on a participant's first visit, cached afterwards. See
  [Hosting the assets](hosting-the-assets).
- **Corrected timestamps.** WebGazer's `t` comes from when JavaScript received the frame.
  saccade.js uses the camera's own capture stamp with the measured display and camera lag
  subtracted. See [Timing and synchrony](timing-and-synchrony).

## New things worth knowing about

| Name | What it is |
| --- | --- |
| `tta` (extension, default `5`) | Frames averaged per estimate. Set `1` for gaze-contingent designs. |
| `assets` (extension) | Model and runtime URLs, for self-hosting. |
| `tracker` (extension) | Pass a pre-built `SaccadeTracker` instead of letting the extension construct one. Replaces WebGazer's `webgazer` parameter. |
| `saccade_timing` (trial data) | What timing correction was applied, and how healthy the camera was. |
| `median_error_px`, `median_error_viewport` (validation data) | Headline accuracy numbers. |
| `calibration_points_px` (calibration data) | The points shown, in pixels. The `calibration_points` parameter stays in percent. |
| `fitCalibration()`, `getCalibrationPoints()`, `getBackend()`, `getTracker()` | Extension methods with no WebGazer equivalent. |
| `getTimingOffset()`, `setTimingOffset()`, `getLastLoopback()` | The timing correction, exposed. |

Analysis code that hit-tests samples against target rectangles needs nothing beyond the field
rename.
