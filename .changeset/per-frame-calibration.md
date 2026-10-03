---
"@saccadejs/core": minor
"@saccadejs/extension": minor
"@saccadejs/plugin-calibrate": minor
---

Calibration now fits every frame recorded at each dot, rather than one averaged embedding per dot. The frames of one look vary while gaze does not, so fitting them all shows the ridge regression which of that variation is noise. Row weights (the model's per-frame quality scores, or a `calHead`) are rescaled to mean 1, and the ridge penalty is 3 at any number of points. Replayed on 200 sessions from the eyetracking cook-off, this cut median error by about 13%, and roughly halved it after a nine-point calibration. The kernel format and prediction are unchanged.

The fit up to 0.3 is still available as `"points"`: `SaccadeTrackerOptions.calibrationFit`, `fitCalibration({ fit })`, `extension.fitCalibration(lambda, fit)`, or the calibrate plugin's new `fit` parameter. `fitRidge` takes `fit` as a fifth argument, and `lambdaFor(nPoints, fit)` returns the matching penalty. `fitCalibration` now also returns `fit`, and the calibrate plugin records it as a `fit` data field. `FRAME_LAMBDA` and the `CalFit` type are exported.
