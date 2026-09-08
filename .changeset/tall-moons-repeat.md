---
"@saccadejs/extension": patch
---

Fixed the prediction API going dead when the extension is handed a tracker it did not build.

`getCurrentPrediction()`, `onGazeUpdate()`, `faceDetected()` and the gaze dot are all fed by a
persistent frame subscription that was only ever made inside `start()`. An experiment that
supplies its own tracker through the `tracker` parameter and never runs `saccade-preview` never
calls `start()`, so none of them ever saw a frame — and `saccade-validate`, which collects every
sample through `onGazeUpdate`, recorded an empty validation and reported no error at all.

The subscription now follows the tracker rather than `start()`: it is made as soon as the
extension has one, whether it was handed it or built it.
