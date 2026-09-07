# saccade.js

Webcam eye tracking in the browser: MediaPipe face landmarks → a small ONNX eye-embedding
model → a per-participant ridge calibration, at 30 fps on WebGPU, with a hardware-validated
screen→webcam timing loopback so gaze samples can be aligned with the experiment clock.

Built for [jsPsych](https://www.jspsych.org) but the core (`@saccadejs/core`) has no jsPsych
dependency.

| package | what |
|---|---|
| `@saccadejs/core` | core tracker, calibration, timing loopback |
| `@saccadejs/extension` | jsPsych extension: per-trial gaze samples + target rectangles |
| `@saccadejs/plugin-preview` | start the camera; face + eye-crop preview |
| `@saccadejs/plugin-calibrate` | calibration trial |
| `@saccadejs/plugin-validate` | validation trial |
| `@saccadejs/plugin-time-sync` | display + camera lag measurement (no flicker) |

Docs and live demo: https://saccade.jspsych.org/

Development: `npm install`, `npm run build`, `npm test`. Interface contracts for the first
release are in `CONTRACTS.md`.
