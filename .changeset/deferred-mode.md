---
"@saccadejs/core": minor
"@saccadejs/extension": minor
"@saccadejs/plugin-calibrate": minor
"@saccadejs/plugin-validate": minor
"@saccadejs/plugin-preview": patch
"@saccadejs/plugin-catch-up": minor
---

Deferred mode, for computers too slow to run the model on every frame as it arrives. The frame loop keeps reading the camera, finding the face and cutting the eye crop, and a pool of background workers runs the model on the crops while the experiment carries on. This is a port of the worker pool the validation study ran on its slower machines.

The extension takes `mode: "live" | "deferred" | "auto"` (default `"live"`) and `deferred_workers`. `"auto"` times the model when the camera starts and runs live only on WebGPU within 85% of a camera frame (30–80 ms). In deferred mode a recording trial's `saccade_data` is filled in once its frames have been embedded, and its new `saccade_deferred` field tracks progress. Every trial records `saccade_mode`. New methods: `getMode`, `getModeDecision`, `getDeferredPending`, `collectGaze`, `finishCalibration` and `catchUp`.

The new `saccade-catch-up` plugin waits for the workers before the data is saved. It shows a progress bar, can stop after `max_wait`, and can save the eye crops it gave up on for offline processing (`save_unprocessed_crops`). `saccade-calibrate` and `saccade-validate` wait for their own frames in deferred mode, show `processing_message` while they do, and record `processing_ms`. The preview labels the new `deferred` setup stage.

In core: `DeferredEmbedder`, `tracker.enableDeferred()` / `disableDeferred()` / `embedDeferred()` / `measureEmbedMs()` / `measureCameraFps()` / `getCenter()`, `chooseMode`, `predictSeries` and `recommendedWorkers`. `runCalibration` and `runValidation` work in both modes, and frames emitted without an inline embedding now carry their `crop`.
