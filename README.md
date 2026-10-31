# saccade.js

Webcam eye tracking in the browser, built for [jsPsych](https://www.jspsych.org): MediaPipe
face landmarks → a small ONNX eye-embedding model → a per-participant ridge calibration.

A screen→webcam timing loopback measures the display and camera lag that JavaScript cannot see,
so gaze samples line up with the experiment clock.

On a computer too slow to run the model on every frame, deferred mode runs it in background
workers instead and fills in each trial's gaze once they catch up.

The core (`@saccadejs/core`) has no jsPsych dependency.

| package | what |
|---|---|
| `@saccadejs/core` | core tracker, calibration, timing loopback |
| `@saccadejs/extension` | jsPsych extension: per-trial gaze samples + target rectangles |
| `@saccadejs/plugin-preview` | start the camera; face + eye-crop preview |
| `@saccadejs/plugin-performance` | effective frame rate; exclude machines too slow to track |
| `@saccadejs/plugin-time-sync` | display + camera lag measurement (no flicker) |
| `@saccadejs/plugin-calibrate` | calibration trial |
| `@saccadejs/plugin-validate` | validation trial |
| `@saccadejs/plugin-catch-up` | deferred mode: wait for background processing to finish |

Docs and live demo: https://saccade.jspsych.org/

Development: `npm install`, `npm run build`, `npm test`. See `CONTRIBUTING.md` to contribute.
