# saccade.js

Webcam eye tracking in the browser, built for [jsPsych](https://www.jspsych.org): MediaPipe
face landmarks → a small ONNX eye-embedding model → a per-participant ridge calibration, at
30 fps on WebGPU.

A screen→webcam timing loopback measures the display and camera lag that JavaScript cannot see,
so gaze samples line up with the experiment clock. That measurement is checked against a
hardware reference.

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

Docs and live demo: https://saccade.jspsych.org/

Development: `npm install`, `npm run build`, `npm test`. Interface contracts for the first
release are in `CONTRACTS.md`.
