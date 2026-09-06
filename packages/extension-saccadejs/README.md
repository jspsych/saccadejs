# @saccadejs/extension

The [saccade.js](https://github.com/jspsych/saccadejs) eye-tracking extension for
[jsPsych](https://www.jspsych.org). Add it to a trial and the trial's data gains a gaze sample for
every camera frame, plus the on-screen position of any elements you name.

It mirrors [`@jspsych/extension-webgazer`](https://www.jspsych.org/latest/extensions/webgazer/)
closely enough that porting an existing eye-tracking experiment is mostly search-and-replace:
`webgazer` → `saccade`, `webgazer_data` → `saccade_data`, `webgazer_targets` →
`saccade_targets`.

## Installation

```
npm install saccadejs @saccadejs/extension
```

or from a CDN:

```html
<script src="https://unpkg.com/jspsych@8"></script>
<script src="https://unpkg.com/saccadejs"></script>
<script src="https://unpkg.com/@saccadejs/extension"></script>
```

## Usage

Register the extension once, then opt individual trials in:

```js
const jsPsych = initJsPsych({
  extensions: [{ type: jsPsychExtensionSaccade }],
});

const timeline = [
  { type: jsPsychSaccadePreview }, // start the camera
  { type: jsPsychSaccadeTimeSync }, // measure display + camera lag
  { type: jsPsychSaccadeCalibrate }, // calibrate

  {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<img id="face" src="face.png">',
    extensions: [{ type: jsPsychExtensionSaccade, params: { targets: ["#face"] } }],
  },
];

jsPsych.run(timeline);
```

## Initialization parameters

Pass these in `initJsPsych` as `{ type: jsPsychExtensionSaccade, params: { ... } }`.

| Parameter           | Type           | Default | Description                                                                                                                                                    |
| ------------------- | -------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `round_predictions` | boolean        | `true`  | Round the predicted `x`, `y` to whole pixels. Saves a lot of space in the data, and the predictions are nowhere near precise to a fraction of a pixel.         |
| `auto_initialize`   | boolean        | `false` | Request the camera and download the models as soon as the extension loads. Leave this `false` and use the `saccade-preview` plugin to control when it happens. |
| `tta`               | integer        | `5`     | Number of consecutive frames whose eye embeddings are averaged before a gaze prediction is made. Larger is smoother but adds group delay.                      |
| `assets`            | object         | `{}`    | `SaccadeAssets`: `modelUrl`, `ortWasmUrl`, `mediapipeWasmUrl`, `faceLandmarkerUrl`. Set these to self-host the model and wasm files instead of using a CDN.    |
| `tracker`           | SaccadeTracker | –       | A pre-built `SaccadeTracker` to use instead of letting the extension construct one. Useful when the page shares a tracker with non-jsPsych code.               |

## Trial parameters

Pass these on a trial as `extensions: [{ type: jsPsychExtensionSaccade, params: { ... } }]`.

| Parameter | Type             | Default | Description                                                                                    |
| --------- | ---------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `targets` | array of strings | `[]`    | CSS selectors for elements whose on-screen rectangles should be recorded in `saccade_targets`. |

## Data generated

| Name              | Type   | Description                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saccade_data`    | array  | One object per camera frame in which a face was found and a calibrated prediction was available: `{x, y, t}`. `x` and `y` are **pixels** relative to the top-left of the viewport; `t` is the time the prediction refers to, in ms since the start of the trial, with the timing offset already subtracted (see below). |
| `saccade_targets` | object | One key per selector in `targets`, whose value is `{x, y, width, height, top, bottom, left, right}` — the element's [bounding rectangle](https://developer.mozilla.org/en-US/docs/Web/API/Element/getBoundingClientRect) in viewport pixels.                                                                            |
| `saccade_timing`  | object | `{offset_ms, corrected, clock, dropped_frames, fps, tta}`. See below.                                                                                                                                                                                                                                                   |

### What `t` means

A camera frame carries a `captureTime`: the moment the browser says the sensor caught the light.
But the light left the screen some milliseconds _before_ that stamp — the display's own lag — and
the camera pipeline added more of its own. On top of that, the reported gaze is the average over
the last `tta` frames, so it refers to the _middle_ of that window, not the newest frame. `t` is

```
(frame.time.meanCapture ?? frame.time.capture) − trialStart − offset
```

where `offset` is the display + camera lag measured by the
[`saccade-time-sync`](../plugin-saccadejs-time-sync) plugin. Run that plugin before your trials
and `t` is directly comparable with jsPsych stimulus onset times. Skip it and `offset` is `0`, `t`
is uncorrected, and `saccade_timing.corrected` is `false` so you know.

`saccade_timing.clock` says where the camera timestamp came from: `"captureTime"` is the good one;
`"receiveTime"` and `"callback"` mean the browser gave a weaker stamp and the timing is looser.
`saccade_timing.tta` records the smoothing window the samples were averaged over, and
`dropped_frames` how many camera frames the browser reported dropping during the trial.

## Methods

Reach the extension with `jsPsych.extensions.saccade`.

| Method                                          | Description                                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start()`                                       | Build the tracker if needed, request the camera, load the models, start the frame loop. Returns a promise; idempotent.                                                              |
| `pause()` / `resume()`                          | Stop / restart frame processing. The camera stream stays open.                                                                                                                      |
| `isInitialized()`                               | Whether `start()` has completed.                                                                                                                                                    |
| `faceDetected()`                                | Whether the most recent frame contained a face.                                                                                                                                     |
| `getBackend()`                                  | The ONNX execution provider in use: `"webgpu"` or `"wasm"`.                                                                                                                         |
| `showVideo()` / `hideVideo()`                   | Show/hide a small mirrored camera preview in the bottom-left corner.                                                                                                                |
| `showPredictions()` / `hidePredictions()`       | Show/hide a dot at the current gaze prediction.                                                                                                                                     |
| `resetCalibration()`                            | Throw away all calibration points and the fitted model.                                                                                                                             |
| `calibratePoint(x, y, embeddings?, captureMs?)` | Add a calibration point at viewport pixel `(x, y)`. Without `embeddings`, collects them from the camera for `captureMs` (default 500) first. Returns the number of embeddings used. |
| `fitCalibration(lambda?)`                       | Fit the ridge regression. Omit `lambda` to let the core pick with `lambdaFor(nPoints)`. Returns `{lambda, nPoints}` or `null`.                                                      |
| `getCalibrationPoints()`                        | The calibration points collected so far (targets in viewport fractions, 0–1).                                                                                                       |
| `getCurrentPrediction()`                        | The latest `{x, y, t}` in viewport pixels, or `null`.                                                                                                                               |
| `onGazeUpdate(cb)`                              | Subscribe to gaze predictions. Returns a function that unsubscribes.                                                                                                                |
| `getTracker()`                                  | The underlying `SaccadeTracker` from the core package.                                                                                                                              |
| `getTimingOffset()` / `setTimingOffset(ms)`     | Read/write the display + camera lag subtracted from every `t`. `null` clears it.                                                                                                    |
| `getLastLoopback()` / `setLastLoopback(result)` | The full `LoopbackResult` from the most recent timing measurement.                                                                                                                  |

## Migrating from the WebGazer extension

| WebGazer                            | saccade.js                                                            |
| ----------------------------------- | --------------------------------------------------------------------- |
| `jsPsychExtensionWebgazer`          | `jsPsychExtensionSaccade`                                             |
| `webgazer_data`, `webgazer_targets` | `saccade_data`, `saccade_targets` (same shapes)                       |
| `sampling_interval`                 | _(gone)_ — samples arrive one per camera frame, not on a timer        |
| `setRegressionType()`               | _(gone)_ — the calibration is always ridge on the eye embedding       |
| `startMouseCalibration()`           | _(gone)_ — use `saccade-calibrate` with `calibration_mode: "click"`   |
| –                                   | `saccade_timing`, `getTimingOffset()`, the `saccade-time-sync` plugin |

## License

MIT
